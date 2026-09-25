// M12 — Production Instruction, Purchase Instruction, Purchase Requisition.
//
// Three new document families that bridge the immutable M11 MRP
// snapshot to existing execution documents. The MRP run results
// (mrp_run_results) are read-only and never mutated; new documents
// only REFERENCE them via mrp_result_id.
//
// Contracts:
//   - Production Instruction: DRAFT -> RELEASED -> CANCELLED.
//     RELEASED + no generated production_order -> cancellable.
//     RELEASED + production_order exists -> cancel rejected (409).
//     DRAFT cancellable (no effect).
//   - Purchase Instruction: DRAFT -> RELEASED -> CANCELLED. Same rule.
//   - Purchase Requisition: DRAFT -> SUBMITTED -> APPROVED or REJECTED.
//     APPROVED + no generated purchase_order -> cancellable.
//     APPROVED + purchase_order exists -> cancel rejected (409).
//
// Conversion accounting for partial conversion:
//   Each MRP result row carries suggested_quantity. New instruction
//   items insert quantity <= (suggested_quantity - sum of items that
//   are still "active" against the same mrp_result_id). Active means
//   header status in (DRAFT, RELEASED, SUBMITTED, APPROVED) — i.e. not
//   CANCELLED and not yet rejected. Conversion metadata
//   (suggested/converted/remaining) is computed read-only by joining
//   the live state of the planning documents; we never write a
//   "remaining" back into mrp_run_results.

import { id as genId, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, readJson, requiredText, send,
} from '../lib/http.js';
import { lifecycleArchiveFilter } from './lifecycle-engine.js';

const PI_STATUS = { DRAFT: '草稿', RELEASED: '已下达', CANCELLED: '已取消' };
const PUI_STATUS = { DRAFT: '草稿', RELEASED: '已下达', CANCELLED: '已取消' };
const PR_STATUS = {
  DRAFT: '草稿', SUBMITTED: '待审批', APPROVED: '已审批', REJECTED: '已驳回', CANCELLED: '已取消',
};

const ACTIVE_PI_STATUSES = new Set(['DRAFT', 'RELEASED']);
const ACTIVE_PUI_STATUSES = new Set(['DRAFT', 'RELEASED']);
const ACTIVE_PR_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'APPROVED']);

const MAX_NOTE = 200;
const MAX_DATE = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nowIso() {
  return new Date().toISOString();
}

function readString(value, max, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  if (text.length > max) throw new HttpError(400, `内容长度不能超过 ${max}`);
  return text;
}

function readDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!DATE_RE.test(text)) throw new HttpError(400, `${label}格式应为 YYYY-MM-DD`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new HttpError(400, `${label}不正确`);
  }
  return text;
}

function readPositiveQuantity(value, label) {
  if (value === undefined || value === null || value === '') {
    throw new HttpError(400, `${label}不能为空`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `${label}必须大于 0`);
  return n;
}

function makeCode(db, table, prefix) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(
    db.prepare(`SELECT COUNT(*) cnt FROM ${table}`).get().cnt + 1
  ).padStart(4, '0');
  return `${prefix}-${today}-${seq}`;
}

function findMrpResult(db, resultId) {
  const row = db.prepare(`
    SELECT r.*, p.code productCode, p.name productName, p.unit productUnit, p.active productActive
      FROM mrp_run_results r JOIN products p ON p.id = r.product_id
     WHERE r.id = ?
  `).get(resultId);
  if (!row) throw new HttpError(404, 'MRP 建议不存在');
  return row;
}

function findMrpRun(db, runId) {
  const run = db.prepare("SELECT * FROM mrp_runs WHERE id=?").get(runId);
  if (!run) throw new HttpError(404, 'MRP 计算不存在');
  return run;
}

function assertActiveProduct(db, productId) {
  const product = db.prepare("SELECT id, active FROM products WHERE id=?").get(productId);
  if (!product) throw new HttpError(400, '产品不存在');
  if (!product.active) throw new HttpError(400, '产品已停用，不能参与计划');
  return product;
}

function convertedQtyForMrpResult(db, itemTable, headerTable, itemMrpColumn, activeStatuses, resultId) {
  const placeholders = Array.from(activeStatuses, () => '?').join(',');
  const sql = `
    SELECT COALESCE(SUM(i.quantity), 0) qty
      FROM ${itemTable} i JOIN ${headerTable} h ON h.id = i.${joinColumnFor(itemTable, headerTable)}
     WHERE i.${itemMrpColumn} = ?
       AND h.status IN (${placeholders})
  `;
  return Number(db.prepare(sql).get(resultId, ...activeStatuses).qty);
}

function joinColumnFor(itemTable, headerTable) {
  if (itemTable === 'production_instruction_items' && headerTable === 'production_instructions') return 'instruction_id';
  if (itemTable === 'purchase_instruction_items' && headerTable === 'purchase_instructions') return 'instruction_id';
  throw new Error('Unknown item/header pair');
}

function readInstructionItems(body) {
  const raw = body.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, '指令明细不能为空');
  }
  return raw.map((entry, index) => {
    const mrpResultId = requiredText(entry.mrpResultId ?? entry.mrp_result_id, `第${index + 1}行 MRP 建议`, 100);
    const quantity = readPositiveQuantity(entry.quantity, `第${index + 1}行指令数量`);
    return {
      mrpResultId,
      quantity,
      needByDate: readDate(entry.needByDate ?? entry.need_by_date, `第${index + 1}行需求日期`),
      bomId: entry.bomId ?? entry.bom_id ?? null,
      routingId: entry.routingId ?? entry.routing_id ?? null,
    };
  });
}

function findActiveBom(db, productId) {
  return db.prepare("SELECT id FROM boms WHERE product_id=? AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1").get(productId);
}

function findActiveRouting(db, productId) {
  return db.prepare("SELECT id FROM product_routings WHERE product_id=? AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1").get(productId);
}

// ============================================================
// Production Instruction
// ============================================================

export async function listProductionInstructions(db, res, actor, url) {
  allow(actor, 'PRODUCTION_INSTRUCTION_VIEW');
  const status = url.searchParams.get('status');
  const runId = url.searchParams.get('mrpRunId') || url.searchParams.get('mrp_run_id');
  let where = '1=1';
  const params = [];
  const archiveFilter = lifecycleArchiveFilter('PRODUCTION_INSTRUCTION', { includeArchived: url.searchParams.get('includeArchived') === 'true', idExpression: 'pi.id' });
  if (archiveFilter.clause) where += ` AND ${archiveFilter.clause}`;
  if (status) { where += ' AND pi.status = ?'; params.push(status); }
  if (runId) { where += ' AND pi.mrp_run_id = ?'; params.push(runId); }
  const rows = db.prepare(`
    SELECT pi.id, pi.instruction_no instructionNo, pi.mrp_run_id mrpRunId,
           pi.status, pi.planned_date plannedDate, pi.notes, pi.created_at createdAt,
           pi.released_at releasedAt,
           mr.run_code productName,
           creator.display_name creatorName,
           releaser.display_name releaserName,
           (SELECT COUNT(*) FROM production_instruction_items WHERE instruction_id=pi.id) itemCount,
           (SELECT COALESCE(SUM(quantity), 0) FROM production_instruction_items WHERE instruction_id=pi.id) totalQuantity,
           (SELECT COUNT(*) FROM production_instruction_items WHERE instruction_id=pi.id AND production_order_id IS NOT NULL) convertedItemCount
      FROM production_instructions pi
      JOIN mrp_runs mr ON mr.id = pi.mrp_run_id
      JOIN users creator ON creator.id = pi.created_by
      LEFT JOIN users releaser ON releaser.id = pi.released_by
     WHERE ${where}
     ORDER BY pi.created_at DESC
     LIMIT 100
  `).all(...params);
  const items = rows.map((row) => ({
    ...row,
    statusLabel: PI_STATUS[row.status] || row.status,
    totalQuantity: Number(row.totalQuantity),
    convertedItemCount: Number(row.convertedItemCount),
  }));
  return send(res, 200, { instructions: items });
}

export async function getProductionInstruction(db, res, actor, instructionId) {
  allow(actor, 'PRODUCTION_INSTRUCTION_VIEW');
  const header = db.prepare(`
    SELECT pi.*, mr.run_code runCode, mr.run_name runName, mr.status runStatus,
           creator.display_name creatorName, releaser.display_name releaserName
      FROM production_instructions pi
      JOIN mrp_runs mr ON mr.id = pi.mrp_run_id
      JOIN users creator ON creator.id = pi.created_by
      LEFT JOIN users releaser ON releaser.id = pi.released_by
     WHERE pi.id = ?
  `).get(instructionId);
  if (!header) throw new HttpError(404, '生产指令不存在');
  header.items = db.prepare(`
    SELECT i.*, p.code productCode, p.name productName, p.unit productUnit,
           bom.version bomVersion, bom.status bomStatus,
           routing.routing_code routingCode, routing.routing_name routingName,
           po.order_no productionOrderNo, po.status productionOrderStatus,
           r.suggestion_type mrpSuggestionType, r.suggested_quantity mrpSuggestedQuantity, r.need_by_date mrpNeedByDate
      FROM production_instruction_items i
      JOIN products p ON p.id = i.product_id
      LEFT JOIN boms bom ON bom.id = i.bom_id
      LEFT JOIN product_routings routing ON routing.id = i.routing_id
      LEFT JOIN production_orders po ON po.id = i.production_order_id
      JOIN mrp_run_results r ON r.id = i.mrp_result_id
     WHERE i.instruction_id = ?
     ORDER BY i.created_at, i.id
  `).all(instructionId);
  header.items = header.items.map((row) => ({
    ...row,
    quantity: Number(row.quantity),
    mrpSuggestedQuantity: Number(row.mrpSuggestedQuantity),
  }));
  header.statusLabel = PI_STATUS[header.status] || header.status;
  // Compute conversion metadata per item (read-only).
  for (const item of header.items) {
    const converted = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) qty FROM production_orders WHERE production_instruction_item_id=? AND status<>'CANCELLED'").get(item.id).qty);
    item.convertedQuantity = converted;
    item.remainingQuantity = Math.max(0, Number(item.quantity) - converted);
  }
  return send(res, 200, { instruction: header });
}

export async function createProductionInstruction(db, req, res, actor) {
  allow(actor, 'PRODUCTION_INSTRUCTION_MANAGE');
  const body = await readJson(req);
  const mrpRunId = requiredText(body.mrpRunId ?? body.mrp_run_id, 'MRP 计算', 100);
  const run = findMrpRun(db, mrpRunId);
  if (run.status !== 'COMPLETED') {
    throw new HttpError(409, '只有已完成的 MRP 才能生成生产指令');
  }
  const items = readInstructionItems(body);
  const plannedDate = readDate(body.plannedDate ?? body.planned_date, '计划日期');
  const notes = readString(body.notes, MAX_NOTE);

  const now = nowIso();
  const newHeaderId = genId();
  const newNo = makeCode(db, 'production_instructions', 'PI');

  transaction(db, () => {
    const existing = db.prepare("SELECT id FROM production_instructions WHERE mrp_run_id=? AND status<>'CANCELLED' LIMIT 1").get(mrpRunId);
    // Allow many DRAFT instructions per MRP run; no header-level
    // uniqueness constraint required.
    void existing;

    db.prepare(`
      INSERT INTO production_instructions(id, instruction_no, mrp_run_id, status, planned_date, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)
    `).run(newHeaderId, newNo, mrpRunId, plannedDate, notes, actor.id, now, now);

    const insertItem = db.prepare(`
      INSERT INTO production_instruction_items(id, instruction_id, mrp_result_id, product_id, quantity, need_by_date, bom_id, routing_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      const mrp = findMrpResult(db, item.mrpResultId);
      if (mrp.run_id !== mrpRunId) {
        throw new HttpError(400, '指令明细中的 MRP 建议与表头 MRP 不匹配');
      }
      if (mrp.suggestion_type !== 'MAKE') {
        throw new HttpError(400, '生产指令只能基于 MAKE 建议');
      }
      if (mrp.net_requirement <= 0) {
        throw new HttpError(400, '净需求为 0 或负数，无需生成生产指令');
      }
      assertActiveProduct(db, mrp.product_id);
      const bomId = item.bomId || (findActiveBom(db, mrp.product_id) || {}).id || null;
      const routingId = item.routingId || (findActiveRouting(db, mrp.product_id) || {}).id || null;
      const already = convertedQtyForMrpResult(
        db, 'production_instruction_items', 'production_instructions', 'mrp_result_id', ACTIVE_PI_STATUSES, item.mrpResultId,
      );
      const remaining = Math.max(0, Number(mrp.suggested_quantity) - already);
      if (item.quantity > remaining) {
        throw new HttpError(409, `MRP 建议剩余可下达数量为 ${remaining}，本次 ${item.quantity} 超出`);
      }
      insertItem.run(genId(), newHeaderId, item.mrpResultId, mrp.product_id, item.quantity, item.needByDate || mrp.need_by_date, bomId, routingId, now);
    }
    audit(db, actor.id, 'CREATE', 'PRODUCTION_INSTRUCTION', newHeaderId, `创建生产指令 ${newNo}`);
  });

  return send(res, 201, { id: newHeaderId, instructionNo: newNo });
}

export async function releaseProductionInstruction(db, res, actor, id) {
  allow(actor, 'PRODUCTION_INSTRUCTION_MANAGE');
  const header = db.prepare("SELECT * FROM production_instructions WHERE id=?").get(id);
  if (!header) throw new HttpError(404, '生产指令不存在');
  if (header.status === 'RELEASED') return send(res, 200, { ok: true, status: 'RELEASED' });
  if (header.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的生产指令可以下达');
  const itemCount = db.prepare("SELECT COUNT(*) cnt FROM production_instruction_items WHERE instruction_id=?").get(id).cnt;
  if (!itemCount) throw new HttpError(409, '生产指令至少需要一条明细');
  const now = nowIso();
  transaction(db, () => {
    db.prepare("UPDATE production_instructions SET status='RELEASED', released_by=?, released_at=?, updated_at=? WHERE id=?").run(actor.id, now, now, id);
    audit(db, actor.id, 'RELEASE', 'PRODUCTION_INSTRUCTION', id, `下达生产指令 ${header.instruction_no}`);
  });
  return send(res, 200, { ok: true, status: 'RELEASED' });
}

export async function cancelProductionInstruction(db, res, actor, id) {
  allow(actor, 'PRODUCTION_INSTRUCTION_MANAGE');
  const header = db.prepare("SELECT * FROM production_instructions WHERE id=?").get(id);
  if (!header) throw new HttpError(404, '生产指令不存在');
  if (header.status === 'CANCELLED') return send(res, 200, { ok: true, status: 'CANCELLED' });
  const hasGeneratedPo = db.prepare("SELECT COUNT(*) cnt FROM production_instruction_items WHERE instruction_id=? AND production_order_id IS NOT NULL").get(id).cnt;
  if (hasGeneratedPo) {
    throw new HttpError(409, '已生成制令单的生产指令不可取消');
  }
  const now = nowIso();
  transaction(db, () => {
    db.prepare("UPDATE production_instructions SET status='CANCELLED', updated_at=? WHERE id=?").run(now, id);
    audit(db, actor.id, 'CANCEL', 'PRODUCTION_INSTRUCTION', id, `取消生产指令 ${header.instruction_no}`);
  });
  return send(res, 200, { ok: true, status: 'CANCELLED' });
}

export async function generateProductionOrderFromInstruction(db, req, res, actor, instructionId, itemId) {
  allow(actor, 'PRODUCTION_INSTRUCTION_MANAGE');
  allow(actor, 'PRODUCTION_ORDERS_CREATE');
  const header = db.prepare("SELECT * FROM production_instructions WHERE id=?").get(instructionId);
  if (!header) throw new HttpError(404, '生产指令不存在');
  if (header.status !== 'RELEASED') throw new HttpError(409, '只有已下达的生产指令可以生成制令单');
  const body = itemId ? { itemId } : await readJson(req).catch(() => ({}));
  const targetItemId = body.itemId || body.item_id || itemId;
  if (!targetItemId) throw new HttpError(400, '请选择指令明细');
  const item = db.prepare("SELECT * FROM production_instruction_items WHERE id=? AND instruction_id=?").get(targetItemId, instructionId);
  if (!item) throw new HttpError(404, '指令明细不存在');
  if (!item.bom_id) throw new HttpError(400, '指令明细缺少有效 BOM，无法生成制令单');
  const bom = db.prepare("SELECT id, status, product_id FROM boms WHERE id=?").get(item.bom_id);
  if (!bom) throw new HttpError(400, 'BOM 不存在');
  if (bom.status !== 'ACTIVE') throw new HttpError(400, 'BOM 未启用，无法生成制令单');
  if (bom.product_id !== item.product_id) throw new HttpError(400, 'BOM 与产品不匹配');

  const converted = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) qty FROM production_orders WHERE production_instruction_item_id=? AND status<>'CANCELLED'").get(item.id).qty);
  const remaining = Math.max(0, Number(item.quantity) - converted);
  const orderQuantity = body.quantity == null ? remaining : readPositiveQuantity(body.quantity, '制令单数量');
  if (orderQuantity > remaining + 1e-9) throw new HttpError(409, `生产指令剩余可转数量为 ${remaining}，本次 ${orderQuantity} 超出`);
  if (remaining <= 0) throw new HttpError(409, '该生产指令明细已全部转为制令单');

  const now = nowIso();
  const poId = genId();
  const poNo = 'MO-' + Date.now().toString(36).toUpperCase();

  transaction(db, () => {
    db.prepare(`
      INSERT INTO production_orders(id, order_no, product_id, bom_id, quantity, status, planned_start, planned_finish, remark, creator_id, created_at, updated_at,
        source_type,production_instruction_id,production_instruction_item_id,bom_version_snapshot,routing_id_snapshot,routing_version_snapshot)
      VALUES (?, ?, ?, ?, ?, 'PENDING', ?, NULL, ?, ?, ?, ?,'INSTRUCTION',?,?,?,?,?)
    `).run(poId, poNo, item.product_id, item.bom_id, orderQuantity, item.need_by_date, `来自生产指令 ${header.instruction_no}`, actor.id, now, now,
      header.id, item.id, db.prepare('SELECT version FROM boms WHERE id=?').get(item.bom_id)?.version || '', item.routing_id || null,
      item.routing_id ? db.prepare('SELECT version FROM product_routings WHERE id=?').get(item.routing_id)?.version || '' : '');
    const bomItems = db.prepare('SELECT * FROM bom_items WHERE bom_id=? ORDER BY line_no').all(item.bom_id);
    if (!bomItems.length) throw new HttpError(409, 'BOM 没有物料明细，不能生成制令单');
    const itemStmt = db.prepare('INSERT INTO production_order_items(id,order_id,product_id,quantity,consumed_quantity,line_no,bom_item_id,quantity_per_unit,scrap_rate_snapshot) VALUES(?,?,?,?,0,?,?,?,?)');
    let lineNo = 1;
    for (const bomItem of bomItems) {
      const perUnit = Number(bomItem.quantity) * (1 + Number(bomItem.scrap_rate || 0));
      itemStmt.run(genId(), poId, bomItem.product_id, perUnit * orderQuantity, lineNo++, bomItem.id, perUnit, Number(bomItem.scrap_rate || 0));
    }
    if (!item.production_order_id) db.prepare('UPDATE production_instruction_items SET production_order_id=? WHERE id=?').run(poId, targetItemId);
    if (item.routing_id) {
      const routingInsert = db.prepare(`INSERT INTO production_order_routing_snapshots(id,production_order_id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
      for (const op of db.prepare('SELECT * FROM product_routing_operations WHERE routing_id=? ORDER BY sequence_no').all(item.routing_id)) {
        routingInsert.run(genId(), poId, item.routing_id, op.sequence_no, op.operation_code, op.operation_name, op.work_center, op.setup_minutes, op.run_minutes_per_unit, op.notes, now);
      }
    }
    audit(db, actor.id, 'GENERATE', 'PRODUCTION_ORDER', poId, `由生产指令 ${header.instruction_no} 生成 ${poNo}`);
  });

  return send(res, 201, { id: poId, orderNo: poNo });
}

// ============================================================
// Purchase Instruction
// ============================================================

export async function listPurchaseInstructions(db, res, actor, url) {
  allow(actor, 'PURCHASE_INSTRUCTION_VIEW');
  const status = url.searchParams.get('status');
  const runId = url.searchParams.get('mrpRunId') || url.searchParams.get('mrp_run_id');
  let where = '1=1';
  const params = [];
  const archiveFilter = lifecycleArchiveFilter('PURCHASE_INSTRUCTION', { includeArchived: url.searchParams.get('includeArchived') === 'true', idExpression: 'pi.id' });
  if (archiveFilter.clause) where += ` AND ${archiveFilter.clause}`;
  if (status) { where += ' AND pi.status = ?'; params.push(status); }
  if (runId) { where += ' AND pi.mrp_run_id = ?'; params.push(runId); }
  const rows = db.prepare(`
    SELECT pi.id, pi.instruction_no instructionNo, pi.mrp_run_id mrpRunId,
           pi.status, pi.planned_date plannedDate, pi.notes, pi.created_at createdAt,
           pi.released_at releasedAt,
           mr.run_code runCode,
           creator.display_name creatorName,
           releaser.display_name releaserName,
           (SELECT COUNT(*) FROM purchase_instruction_items WHERE instruction_id=pi.id) itemCount,
           (SELECT COALESCE(SUM(quantity), 0) FROM purchase_instruction_items WHERE instruction_id=pi.id) totalQuantity,
           (SELECT COUNT(*) FROM purchase_instruction_items WHERE instruction_id=pi.id AND purchase_requisition_id IS NOT NULL) convertedItemCount
      FROM purchase_instructions pi
      JOIN mrp_runs mr ON mr.id = pi.mrp_run_id
      JOIN users creator ON creator.id = pi.created_by
      LEFT JOIN users releaser ON releaser.id = pi.released_by
     WHERE ${where}
     ORDER BY pi.created_at DESC
     LIMIT 100
  `).all(...params);
  const items = rows.map((row) => ({
    ...row,
    statusLabel: PUI_STATUS[row.status] || row.status,
    totalQuantity: Number(row.totalQuantity),
    convertedItemCount: Number(row.convertedItemCount),
  }));
  return send(res, 200, { instructions: items });
}

export async function getPurchaseInstruction(db, res, actor, id) {
  allow(actor, 'PURCHASE_INSTRUCTION_VIEW');
  const header = db.prepare(`
    SELECT pi.*, mr.run_code runCode, mr.run_name runName, mr.status runStatus,
           creator.display_name creatorName, releaser.display_name releaserName
      FROM purchase_instructions pi
      JOIN mrp_runs mr ON mr.id = pi.mrp_run_id
      JOIN users creator ON creator.id = pi.created_by
      LEFT JOIN users releaser ON releaser.id = pi.released_by
     WHERE pi.id = ?
  `).get(id);
  if (!header) throw new HttpError(404, '采购指令不存在');
  header.items = db.prepare(`
    SELECT i.*, p.code productCode, p.name productName, p.unit productUnit,
           pr.requisition_no purchaseRequisitionNo, pr.status purchaseRequisitionStatus,
           r.suggestion_type mrpSuggestionType, r.suggested_quantity mrpSuggestedQuantity, r.need_by_date mrpNeedByDate
      FROM purchase_instruction_items i
      JOIN products p ON p.id = i.product_id
      LEFT JOIN purchase_requisitions pr ON pr.id = i.purchase_requisition_id
      JOIN mrp_run_results r ON r.id = i.mrp_result_id
     WHERE i.instruction_id = ?
     ORDER BY i.created_at, i.id
  `).all(id);
  header.items = header.items.map((row) => ({
    ...row,
    quantity: Number(row.quantity),
    mrpSuggestedQuantity: Number(row.mrpSuggestedQuantity),
  }));
  header.statusLabel = PUI_STATUS[header.status] || header.status;
  for (const item of header.items) {
    const converted = convertedQtyForMrpResult(
      db, 'purchase_instruction_items', 'purchase_instructions', 'mrp_result_id', ACTIVE_PUI_STATUSES, item.mrp_result_id,
    );
    item.convertedQuantity = converted;
    item.remainingQuantity = Math.max(0, item.mrpSuggestedQuantity - converted);
  }
  return send(res, 200, { instruction: header });
}

export async function createPurchaseInstruction(db, req, res, actor) {
  allow(actor, 'PURCHASE_INSTRUCTION_MANAGE');
  const body = await readJson(req);
  const mrpRunId = requiredText(body.mrpRunId ?? body.mrp_run_id, 'MRP 计算', 100);
  const run = findMrpRun(db, mrpRunId);
  if (run.status !== 'COMPLETED') {
    throw new HttpError(409, '只有已完成的 MRP 才能生成采购指令');
  }
  const items = readInstructionItems(body);
  const plannedDate = readDate(body.plannedDate ?? body.planned_date, '计划日期');
  const notes = readString(body.notes, MAX_NOTE);

  const now = nowIso();
  const newHeaderId = genId();
  const newNo = makeCode(db, 'purchase_instructions', 'PUI');

  transaction(db, () => {
    db.prepare(`
      INSERT INTO purchase_instructions(id, instruction_no, mrp_run_id, status, planned_date, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)
    `).run(newHeaderId, newNo, mrpRunId, plannedDate, notes, actor.id, now, now);

    const insertItem = db.prepare(`
      INSERT INTO purchase_instruction_items(id, instruction_id, mrp_result_id, product_id, quantity, need_by_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      const mrp = findMrpResult(db, item.mrpResultId);
      if (mrp.run_id !== mrpRunId) {
        throw new HttpError(400, '指令明细中的 MRP 建议与表头 MRP 不匹配');
      }
      if (mrp.suggestion_type !== 'BUY') {
        throw new HttpError(400, '采购指令只能基于 BUY 建议');
      }
      if (mrp.net_requirement <= 0) {
        throw new HttpError(400, '净需求为 0 或负数，无需生成采购指令');
      }
      assertActiveProduct(db, mrp.product_id);
      const already = convertedQtyForMrpResult(
        db, 'purchase_instruction_items', 'purchase_instructions', 'mrp_result_id', ACTIVE_PUI_STATUSES, item.mrpResultId,
      );
      const remaining = Math.max(0, Number(mrp.suggested_quantity) - already);
      if (item.quantity > remaining) {
        throw new HttpError(409, `MRP 建议剩余可下达数量为 ${remaining}，本次 ${item.quantity} 超出`);
      }
      insertItem.run(genId(), newHeaderId, item.mrpResultId, mrp.product_id, item.quantity, item.needByDate || mrp.need_by_date, now);
    }
    audit(db, actor.id, 'CREATE', 'PURCHASE_INSTRUCTION', newHeaderId, `创建采购指令 ${newNo}`);
  });

  return send(res, 201, { id: newHeaderId, instructionNo: newNo });
}

export async function releasePurchaseInstruction(db, res, actor, id) {
  allow(actor, 'PURCHASE_INSTRUCTION_MANAGE');
  const header = db.prepare("SELECT * FROM purchase_instructions WHERE id=?").get(id);
  if (!header) throw new HttpError(404, '采购指令不存在');
  if (header.status === 'RELEASED') return send(res, 200, { ok: true, status: 'RELEASED' });
  if (header.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的采购指令可以下达');
  const itemCount = db.prepare("SELECT COUNT(*) cnt FROM purchase_instruction_items WHERE instruction_id=?").get(id).cnt;
  if (!itemCount) throw new HttpError(409, '采购指令至少需要一条明细');
  const now = nowIso();
  transaction(db, () => {
    db.prepare("UPDATE purchase_instructions SET status='RELEASED', released_by=?, released_at=?, updated_at=? WHERE id=?").run(actor.id, now, now, id);
    audit(db, actor.id, 'RELEASE', 'PURCHASE_INSTRUCTION', id, `下达采购指令 ${header.instruction_no}`);
  });
  return send(res, 200, { ok: true, status: 'RELEASED' });
}

export async function cancelPurchaseInstruction(db, res, actor, id) {
  allow(actor, 'PURCHASE_INSTRUCTION_MANAGE');
  const header = db.prepare("SELECT * FROM purchase_instructions WHERE id=?").get(id);
  if (!header) throw new HttpError(404, '采购指令不存在');
  if (header.status === 'CANCELLED') return send(res, 200, { ok: true, status: 'CANCELLED' });
  const hasGeneratedReq = db.prepare("SELECT COUNT(*) cnt FROM purchase_instruction_items WHERE instruction_id=? AND purchase_requisition_id IS NOT NULL").get(id).cnt;
  if (hasGeneratedReq) {
    throw new HttpError(409, '已生成请购单的采购指令不可取消');
  }
  const now = nowIso();
  transaction(db, () => {
    db.prepare("UPDATE purchase_instructions SET status='CANCELLED', updated_at=? WHERE id=?").run(now, id);
    audit(db, actor.id, 'CANCEL', 'PURCHASE_INSTRUCTION', id, `取消采购指令 ${header.instruction_no}`);
  });
  return send(res, 200, { ok: true, status: 'CANCELLED' });
}

// ============================================================
// Purchase Requisition (with approval)
// ============================================================

function readRequisitionItems(body) {
  const raw = body.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, '请购单明细不能为空');
  }
  return raw.map((entry, index) => {
    const productId = requiredText(entry.productId ?? entry.product_id, `第${index + 1}行产品`, 100);
    const quantity = readPositiveQuantity(entry.quantity, `第${index + 1}行数量`);
    const rawUnitPrice = entry.unitPriceCents ?? entry.unit_price_cents ?? 0;
    const unitPriceCents = Number(rawUnitPrice);
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
      throw new HttpError(400, `第${index + 1}行参考单价必须为非负整数分`);
    }
    const amountCents = quantity * unitPriceCents;
    if (!Number.isSafeInteger(amountCents)) {
      throw new HttpError(400, `第${index + 1}行参考金额无法精确到分`);
    }
    return {
      productId,
      quantity,
      preferredSupplierId: entry.preferredSupplierId ?? entry.preferred_supplier_id ?? null,
      unitPriceCents,
      amountCents,
      purchaseInstructionItemId: entry.purchaseInstructionItemId ?? entry.purchase_instruction_item_id ?? null,
    };
  });
}

export async function listPurchaseRequisitions(db, res, actor, url) {
  allow(actor, 'PURCHASE_REQUISITION_VIEW');
  const status = url.searchParams.get('status');
  let where = '1=1';
  const params = [];
  const archiveFilter = lifecycleArchiveFilter('PURCHASE_REQUISITION', { includeArchived: url.searchParams.get('includeArchived') === 'true', idExpression: 'pr.id' });
  if (archiveFilter.clause) where += ` AND ${archiveFilter.clause}`;
  if (status) { where += ' AND pr.status = ?'; params.push(status); }
  const rows = db.prepare(`
    SELECT pr.id, pr.requisition_no requisitionNo, pr.source_instruction_id sourceInstructionId,
           pi.instruction_no sourceInstructionNo,
           pr.status, pr.request_date requestDate, pr.required_date requiredDate, pr.notes, pr.created_at createdAt,
           pr.submitted_at submittedAt, pr.reviewed_at reviewedAt,
           pr.purchase_order_id purchaseOrderId,
           po.order_no purchaseOrderNo,
           creator.display_name creatorName, reviewer.display_name reviewerName,
           (SELECT COUNT(*) FROM purchase_requisition_items WHERE requisition_id=pr.id) itemCount,
           (SELECT COALESCE(SUM(quantity), 0) FROM purchase_requisition_items WHERE requisition_id=pr.id) totalQuantity,
           (SELECT COALESCE(SUM(amount_cents), 0) FROM purchase_requisition_items WHERE requisition_id=pr.id) totalAmountCents
      FROM purchase_requisitions pr
      LEFT JOIN purchase_instructions pi ON pi.id = pr.source_instruction_id
      LEFT JOIN purchase_orders po ON po.id = pr.purchase_order_id
      JOIN users creator ON creator.id = pr.creator_id
      LEFT JOIN users reviewer ON reviewer.id = pr.reviewer_id
     WHERE ${where}
     ORDER BY pr.created_at DESC
     LIMIT 100
  `).all(...params);
  const items = rows.map((row) => ({
    ...row,
    sourceType: row.sourceInstructionId ? 'PURCHASE_INSTRUCTION' : 'MANUAL',
    statusLabel: PR_STATUS[row.status] || row.status,
    totalQuantity: Number(row.totalQuantity),
    totalAmountCents: Number(row.totalAmountCents),
  }));
  return send(res, 200, { requisitions: items });
}

export async function getPurchaseRequisition(db, res, actor, id) {
  allow(actor, 'PURCHASE_REQUISITION_VIEW');
  const header = db.prepare(`
    SELECT pr.*, pi.instruction_no sourceInstructionNo, po.order_no purchaseOrderNo,
           creator.display_name creatorName, reviewer.display_name reviewerName
      FROM purchase_requisitions pr
      LEFT JOIN purchase_instructions pi ON pi.id = pr.source_instruction_id
      LEFT JOIN purchase_orders po ON po.id = pr.purchase_order_id
      JOIN users creator ON creator.id = pr.creator_id
      LEFT JOIN users reviewer ON reviewer.id = pr.reviewer_id
     WHERE pr.id = ?
  `).get(id);
  if (!header) throw new HttpError(404, '请购单不存在');
  header.items = db.prepare(`
    SELECT i.*, p.code productCode, p.name productName, p.unit productUnit,
           s.code supplierCode, s.name supplierName,
           pii.id purchaseInstructionItemId, pii.instruction_id purchaseInstructionId,
           pin.instruction_no purchaseInstructionNo
      FROM purchase_requisition_items i
      JOIN products p ON p.id = i.product_id
      LEFT JOIN suppliers s ON s.id = i.preferred_supplier_id
      LEFT JOIN purchase_instruction_items pii ON pii.id = i.purchase_instruction_item_id
      LEFT JOIN purchase_instructions pin ON pin.id = pii.instruction_id
     WHERE i.requisition_id = ?
     ORDER BY i.created_at, i.id
  `).all(id);
  header.items = header.items.map((row) => ({
    ...row,
    quantity: Number(row.quantity),
    unitPriceCents: Number(row.unit_price_cents),
    amountCents: Number(row.amount_cents),
  }));
  header.totalAmountCents = header.items.reduce((sum, item) => sum + item.amountCents, 0);
  header.totalQuantity = header.items.reduce((sum, item) => sum + item.quantity, 0);
  header.sourceType = header.source_instruction_id ? 'PURCHASE_INSTRUCTION' : 'MANUAL';
  header.statusLabel = PR_STATUS[header.status] || header.status;
  return send(res, 200, { requisition: header });
}

export async function createPurchaseRequisition(db, req, res, actor) {
  allow(actor, 'PURCHASE_REQUISITION_MANAGE');
  const body = await readJson(req);
  const items = readRequisitionItems(body);
  const requestDate = readDate(body.requestDate ?? body.request_date, '请购日期') || nowIso().slice(0, 10);
  const requiredDate = readDate(body.requiredDate ?? body.required_date, '需求日期');
  if (requiredDate && requiredDate < requestDate) throw new HttpError(400, '要求到货日不能早于请购日期');
  const notes = readString(body.notes, MAX_NOTE);
  const sourceInstructionId = body.sourceInstructionId ?? body.source_instruction_id ?? null;
  if (sourceInstructionId) {
    const source = db.prepare("SELECT id, status FROM purchase_instructions WHERE id=?").get(sourceInstructionId);
    if (!source) throw new HttpError(400, '来源采购指令不存在');
    if (source.status !== 'RELEASED') throw new HttpError(400, '只有已下达的采购指令可以作为请购单来源');
  }

  const now = nowIso();
  const newIdValue = genId();
  const newNo = makeCode(db, 'purchase_requisitions', 'PREQ');

  transaction(db, () => {
    db.prepare(`
      INSERT INTO purchase_requisitions(id, requisition_no, source_instruction_id, status, request_date, required_date, notes, creator_id, created_at, updated_at)
      VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)
    `).run(newIdValue, newNo, sourceInstructionId, requestDate, requiredDate, notes, actor.id, now, now);

    const insertItem = db.prepare(`
      INSERT INTO purchase_requisition_items(id, requisition_id, product_id, quantity, preferred_supplier_id, unit_price_cents, amount_cents, purchase_instruction_item_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      assertActiveProduct(db, item.productId);
      if (item.preferredSupplierId) {
        const sup = db.prepare("SELECT id, active FROM suppliers WHERE id=?").get(item.preferredSupplierId);
        if (!sup) throw new HttpError(400, '供应商不存在');
        if (!sup.active) throw new HttpError(400, '供应商已停用');
      }
      if (item.purchaseInstructionItemId) {
        if (!sourceInstructionId) throw new HttpError(400, '采购指令明细必须同时提供来源采购指令');
        const pii = db.prepare("SELECT id, instruction_id, product_id, quantity, need_by_date, purchase_requisition_id FROM purchase_instruction_items WHERE id=?").get(item.purchaseInstructionItemId);
        if (!pii) throw new HttpError(400, '关联的采购指令明细不存在');
        if (pii.instruction_id !== sourceInstructionId) throw new HttpError(400, '采购指令明细不属于来源采购指令');
        if (pii.product_id !== item.productId) throw new HttpError(400, '请购货品与采购指令明细不一致');
        if (Number(item.quantity) > Number(pii.quantity)) throw new HttpError(400, '请购数量不得超过采购指令建议数量');
        if (requiredDate && pii.need_by_date && requiredDate !== pii.need_by_date) throw new HttpError(400, '来源请购单需求日期必须继承采购指令日期');
        if (pii.purchase_requisition_id) throw new HttpError(409, '该采购指令明细已经生成过请购单');
        // Bind the back-link so future reuse cannot happen.
      }
      insertItem.run(genId(), newIdValue, item.productId, item.quantity, item.preferredSupplierId, item.unitPriceCents, item.amountCents, item.purchaseInstructionItemId, now);
      if (item.purchaseInstructionItemId) {
        db.prepare("UPDATE purchase_instruction_items SET purchase_requisition_id=? WHERE id=?").run(newIdValue, item.purchaseInstructionItemId);
      }
    }
    audit(db, actor.id, 'CREATE', 'PURCHASE_REQUISITION', newIdValue, `创建请购单 ${newNo}`);
  });

  return send(res, 201, { id: newIdValue, requisitionNo: newNo });
}

export async function updatePurchaseRequisition(db, req, res, actor, id) {
  allow(actor, 'PURCHASE_REQUISITION_MANAGE');
  const header = db.prepare("SELECT * FROM purchase_requisitions WHERE id=?").get(id);
  if (!header) throw new HttpError(404, '请购单不存在');
  if (header.status !== 'DRAFT') throw new HttpError(409, '只有草稿请购单可以编辑');

  const body = await readJson(req);
  const requestedSourceId = body.sourceInstructionId ?? body.source_instruction_id;
  if (requestedSourceId !== undefined && requestedSourceId !== header.source_instruction_id) {
    throw new HttpError(409, '采购指令来源不可修改；请取消草稿后重新创建');
  }
  const requestDate = readDate(body.requestDate ?? body.request_date ?? header.request_date, '请购日期');
  const requiredDate = readDate(body.requiredDate ?? body.required_date ?? header.required_date, '需求日期');
  if (!requestDate) throw new HttpError(400, '请购日期不能为空');
  if (requiredDate && requiredDate < requestDate) throw new HttpError(400, '要求到货日不能早于请购日期');
  const notes = readString(body.notes, MAX_NOTE, header.notes || '');
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, '请购单明细不能为空');

  const storedItems = db.prepare("SELECT id, quantity, purchase_instruction_item_id FROM purchase_requisition_items WHERE requisition_id=?").all(id);
  const storedById = new Map(storedItems.map((item) => [item.id, item]));
  const updates = body.items.map((entry, index) => {
    const itemId = requiredText(entry.id, `第${index + 1}行明细`, 100);
    const stored = storedById.get(itemId);
    if (!stored) throw new HttpError(400, `第${index + 1}行明细不属于当前请购单`);
    const requestedItemSource = entry.purchaseInstructionItemId ?? entry.purchase_instruction_item_id;
    if (requestedItemSource !== undefined && requestedItemSource !== stored.purchase_instruction_item_id) {
      throw new HttpError(409, '采购指令来源明细不可修改；请取消草稿后重新创建');
    }
    const unitPriceCents = Number(entry.unitPriceCents ?? entry.unit_price_cents);
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
      throw new HttpError(400, `第${index + 1}行参考单价必须为非负整数分`);
    }
    const amountCents = Number(stored.quantity) * unitPriceCents;
    if (!Number.isSafeInteger(amountCents)) throw new HttpError(400, `第${index + 1}行参考金额无法精确到分`);
    return { itemId, unitPriceCents, amountCents };
  });
  if (new Set(updates.map((item) => item.itemId)).size !== storedItems.length || updates.length !== storedItems.length) {
    throw new HttpError(400, '必须提交当前请购单的全部明细');
  }

  const now = nowIso();
  transaction(db, () => {
    db.prepare("UPDATE purchase_requisitions SET request_date=?, required_date=?, notes=?, updated_at=? WHERE id=?")
      .run(requestDate, requiredDate, notes, now, id);
    const updateItem = db.prepare("UPDATE purchase_requisition_items SET unit_price_cents=?, amount_cents=? WHERE id=? AND requisition_id=?");
    for (const item of updates) updateItem.run(item.unitPriceCents, item.amountCents, item.itemId, id);
    audit(db, actor.id, 'UPDATE', 'PURCHASE_REQUISITION', id, `编辑请购单 ${header.requisition_no}`);
  });
  return send(res, 200, { ok: true });
}

export async function submitPurchaseRequisition(db, res, actor, id) {
  allow(actor, 'PURCHASE_REQUISITION_MANAGE');
  const header = db.prepare("SELECT * FROM purchase_requisitions WHERE id=?").get(id);
  if (!header) throw new HttpError(404, '请购单不存在');
  if (header.status === 'SUBMITTED') return send(res, 200, { ok: true, status: 'SUBMITTED' });
  if (header.status !== 'DRAFT' && header.status !== 'REJECTED') {
    throw new HttpError(409, '只有草稿或已驳回的请购单可以提交');
  }
  const itemCount = db.prepare("SELECT COUNT(*) cnt FROM purchase_requisition_items WHERE requisition_id=?").get(id).cnt;
  if (!itemCount) throw new HttpError(409, '请购单至少需要一条明细');
  const now = nowIso();
  transaction(db, () => {
    db.prepare("UPDATE purchase_requisitions SET status='SUBMITTED', rejection_reason='', submitted_at=?, reviewed_at=NULL, reviewer_id=NULL, updated_at=? WHERE id=?").run(now, now, id);
    audit(db, actor.id, 'SUBMIT', 'PURCHASE_REQUISITION', id, `提交请购单 ${header.requisition_no}`);
  });
  return send(res, 200, { ok: true, status: 'SUBMITTED' });
}

export async function approvePurchaseRequisition(db, res, actor, id) {
  allow(actor, 'PURCHASE_REQUISITION_APPROVE');
  const header = db.prepare("SELECT * FROM purchase_requisitions WHERE id=?").get(id);
  if (!header) throw new HttpError(404, '请购单不存在');
  if (header.status === 'APPROVED') return send(res, 200, { ok: true, status: 'APPROVED' });
  if (header.status !== 'SUBMITTED') throw new HttpError(409, '只有待审批的请购单可以审批');
  if (header.creator_id === actor.id) {
    throw new HttpError(409, '创建人不能审核自己的请购单');
  }
  const now = nowIso();
  transaction(db, () => {
    db.prepare("UPDATE purchase_requisitions SET status='APPROVED', reviewer_id=?, reviewed_at=?, rejection_reason='', updated_at=? WHERE id=?").run(actor.id, now, now, id);
    audit(db, actor.id, 'APPROVE', 'PURCHASE_REQUISITION', id, `审批通过请购单 ${header.requisition_no}`);
  });
  return send(res, 200, { ok: true, status: 'APPROVED' });
}

export async function rejectPurchaseRequisition(db, req, res, actor, id) {
  allow(actor, 'PURCHASE_REQUISITION_APPROVE');
  const header = db.prepare("SELECT * FROM purchase_requisitions WHERE id=?").get(id);
  if (!header) throw new HttpError(404, '请购单不存在');
  if (header.status !== 'SUBMITTED') throw new HttpError(409, '只有待审批的请购单可以驳回');
  if (header.creator_id === actor.id) {
    throw new HttpError(409, '创建人不能审核自己的请购单');
  }
  const body = await readJson(req);
  const reason = requiredText(body.reason ?? body.rejection_reason, '驳回原因', 200);
  const now = nowIso();
  transaction(db, () => {
    db.prepare("UPDATE purchase_requisitions SET status='REJECTED', reviewer_id=?, reviewed_at=?, rejection_reason=?, updated_at=? WHERE id=?").run(actor.id, now, reason, now, id);
    audit(db, actor.id, 'REJECT', 'PURCHASE_REQUISITION', id, `驳回请购单 ${header.requisition_no}`);
  });
  return send(res, 200, { ok: true, status: 'REJECTED' });
}

export async function cancelPurchaseRequisition(db, res, actor, id) {
  allow(actor, 'PURCHASE_REQUISITION_MANAGE');
  const header = db.prepare("SELECT * FROM purchase_requisitions WHERE id=?").get(id);
  if (!header) throw new HttpError(404, '请购单不存在');
  if (header.status === 'CANCELLED') return send(res, 200, { ok: true, status: 'CANCELLED' });
  if (header.status === 'APPROVED' && header.purchase_order_id) {
    throw new HttpError(409, '已生成采购订单的请购单不可取消');
  }
  if (!['DRAFT', 'REJECTED'].includes(header.status)) {
    throw new HttpError(409, '只有草稿或已驳回的请购单可以取消');
  }
  const now = nowIso();
  transaction(db, () => {
    db.prepare("UPDATE purchase_requisitions SET status='CANCELLED', updated_at=? WHERE id=?").run(now, id);
    audit(db, actor.id, 'CANCEL', 'PURCHASE_REQUISITION', id, `取消请购单 ${header.requisition_no}`);
  });
  return send(res, 200, { ok: true, status: 'CANCELLED' });
}

export async function generatePurchaseOrderFromRequisition(db, req, res, actor, id) {
  allow(actor, 'PURCHASE_REQUISITION_MANAGE');
  allow(actor, 'PURCHASE_ORDERS_CREATE');
  const header = db.prepare("SELECT * FROM purchase_requisitions WHERE id=?").get(id);
  if (!header) throw new HttpError(404, '请购单不存在');
  if (header.status !== 'APPROVED') throw new HttpError(409, '只有已审批的请购单可以生成采购订单');
  if (header.purchase_order_id) throw new HttpError(409, '该请购单已经生成过采购订单');
  const body = await readJson(req);
  const supplierId = requiredText(body.supplierId ?? body.supplier_id, '供应商', 100);
  const supplier = db.prepare("SELECT id, active, contact, phone, address FROM suppliers WHERE id=?").get(supplierId);
  if (!supplier) throw new HttpError(400, '供应商不存在');
  if (!supplier.active) throw new HttpError(400, '供应商已停用');

  const items = db.prepare("SELECT * FROM purchase_requisition_items WHERE requisition_id=? ORDER BY created_at, id").all(id);
  if (!items.length) throw new HttpError(409, '请购单至少需要一条明细');

  const now = nowIso();
  const poId = genId();
  const ts = Date.now();
  const orderNo = `PO-${now.slice(0, 10).replaceAll('-', '')}-${String(ts).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const orderDate = readDate(body.orderDate ?? body.order_date, '订单日期') || now.slice(0, 10);
  const requestedExpectedDate = readDate(body.expectedDeliveryDate ?? body.expected_delivery_date, '预计交期');
  const expectedDeliveryDate = requestedExpectedDate || (header.required_date >= orderDate ? header.required_date : null);
  const paymentTerms = readString(body.paymentTerms ?? body.payment_terms, 200);
  const supplierContactName = readString(body.supplierContactName ?? body.supplier_contact_name, 50, supplier.contact || '');
  const supplierContactPhone = readString(body.supplierContactPhone ?? body.supplier_contact_phone, 30, supplier.phone || '');
  const supplierAddress = readString(body.supplierAddress ?? body.supplier_address, 200, supplier.address || '');
  if (expectedDeliveryDate && expectedDeliveryDate < orderDate) throw new HttpError(400, '预计交期不能早于订单日期');

  transaction(db, () => {
    let totalCents = 0;
    for (const item of items) {
      const qty = Number(item.quantity);
      const unit = Number(item.unit_price_cents) || 0;
      totalCents += qty * unit;
    }
    db.prepare(`
      INSERT INTO purchase_orders(id, order_no, supplier_id, status, total_cents, remark, creator_id, created_at, updated_at,
        order_date, expected_delivery_date, payment_terms, supplier_contact_name, supplier_contact_phone, supplier_address, purchase_requisition_id)
      VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(poId, orderNo, supplierId, totalCents, `来自请购单 ${header.requisition_no}`, actor.id, now, now,
      orderDate, expectedDeliveryDate, paymentTerms, supplierContactName, supplierContactPhone, supplierAddress, id);
    const insertItem = db.prepare(`
      INSERT INTO purchase_order_items(id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no, purchase_requisition_item_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    items.forEach((item, index) => {
      const qty = Number(item.quantity);
      const unit = Number(item.unit_price_cents) || 0;
      const amount = qty * unit;
      insertItem.run(genId(), poId, item.product_id, qty, unit, amount, index + 1, item.id);
    });
    db.prepare("UPDATE purchase_requisitions SET purchase_order_id=?, updated_at=? WHERE id=?").run(poId, now, id);
    audit(db, actor.id, 'GENERATE', 'PURCHASE_ORDER', poId, `由请购单 ${header.requisition_no} 生成 ${orderNo}`);
  });

  return send(res, 201, { id: poId, orderNo });
}

// ============================================================
// Conversion metadata for MRP result rows
// ============================================================

export function conversionMetadataForMrpResult(db, resultId) {
  const result = db.prepare("SELECT id, suggested_quantity, suggestion_type FROM mrp_run_results WHERE id=?").get(resultId);
  if (!result) return null;
  const suggested = Number(result.suggested_quantity);
  if (result.suggestion_type === 'MAKE') {
    const converted = convertedQtyForMrpResult(
      db, 'production_instruction_items', 'production_instructions', 'mrp_result_id', ACTIVE_PI_STATUSES, resultId,
    );
    return {
      suggestedQuantity: suggested,
      convertedQuantity: converted,
      remainingQuantity: Math.max(0, suggested - converted),
      canConvert: suggested - converted > 0,
    };
  }
  if (result.suggestion_type === 'BUY') {
    const converted = convertedQtyForMrpResult(
      db, 'purchase_instruction_items', 'purchase_instructions', 'mrp_result_id', ACTIVE_PUI_STATUSES, resultId,
    );
    return {
      suggestedQuantity: suggested,
      convertedQuantity: converted,
      remainingQuantity: Math.max(0, suggested - converted),
      canConvert: suggested - converted > 0,
    };
  }
  return { suggestedQuantity: suggested, convertedQuantity: 0, remainingQuantity: suggested, canConvert: false };
}

// Expose the helper for testing.
export const __test__ = {
  convertedQtyForMrpResult,
  ACTIVE_PI_STATUSES,
  ACTIVE_PUI_STATUSES,
  ACTIVE_PR_STATUSES,
};
