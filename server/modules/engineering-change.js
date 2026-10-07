// V17 Master & Engineering Domain Closure — Wave E: Engineering Change.
//
// Implements a bounded ECO flow:
//   - Change type IMMEDIATE / EFFECTIVE_DATE / USE_UP_OLD
//   - Allowed operations per change type (per solution.md §23.11.WaveE)
//   - Submit / approve / reject / withdraw / apply lifecycle
//   - Impact preview lists affected BOMs / new effective BOM version
//   - Atomic apply within transaction + audit, history preserved
//   - Historical production snapshots remain untouched

import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, optionalText, readJson, requiredCode, requiredText, send } from '../lib/http.js';

const CHANGE_TYPES = new Set(['IMMEDIATE', 'EFFECTIVE_DATE', 'USE_UP_OLD']);
const ECO_STATUSES = new Set(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'APPLIED', 'CANCELLED']);
const OP_TYPES = new Set(['ADD_COMPONENT', 'MODIFY_COMPONENT', 'DELETE_COMPONENT', 'INVALIDATE_COMPONENT', 'MODIFY_HEADER']);

const ALLOWED_OPS_BY_TYPE = Object.freeze({
  IMMEDIATE: new Set(['ADD_COMPONENT', 'MODIFY_COMPONENT', 'DELETE_COMPONENT', 'INVALIDATE_COMPONENT', 'MODIFY_HEADER']),
  EFFECTIVE_DATE: new Set(['ADD_COMPONENT', 'MODIFY_COMPONENT', 'INVALIDATE_COMPONENT', 'MODIFY_HEADER']),
  USE_UP_OLD: new Set(['MODIFY_COMPONENT', 'MODIFY_HEADER']),
});

function normalizeChangeType(value) {
  const upper = String(value || 'IMMEDIATE').toUpperCase();
  if (!CHANGE_TYPES.has(upper)) throw new HttpError(400, '变更类型不正确');
  return upper;
}

function normalizeOpType(value) {
  const upper = String(value || '').toUpperCase();
  if (!OP_TYPES.has(upper)) throw new HttpError(400, '变更操作类型不正确');
  return upper;
}

function validateOpForType(changeType, opType) {
  const allowed = ALLOWED_OPS_BY_TYPE[changeType];
  if (!allowed.has(opType)) {
    throw new HttpError(409, `${changeType} 变更不允许 ${opType} 操作`);
  }
}

function loadChangeOrder(db, changeId) {
  const eco = db.prepare('SELECT * FROM engineering_change_orders WHERE id=?').get(changeId);
  if (!eco) throw new HttpError(404, '工程变更单不存在');
  eco.items = db.prepare('SELECT * FROM engineering_change_items WHERE change_order_id=? ORDER BY line_no').all(changeId);
  return eco;
}

function validateItemPayload(db, changeType, item, index) {
  const opType = normalizeOpType(item.opType ?? item.op_type);
  validateOpForType(changeType, opType);
  const productId = item.productId ?? item.product_id;
  switch (opType) {
    case 'ADD_COMPONENT':
      if (!productId) throw new HttpError(400, `第 ${index + 1} 行 ADD_COMPONENT 必须指定 product_id`);
      break;
    case 'MODIFY_COMPONENT':
      if (!productId) throw new HttpError(400, `第 ${index + 1} 行 MODIFY_COMPONENT 必须指定 product_id`);
      break;
    case 'DELETE_COMPONENT':
    case 'INVALIDATE_COMPONENT':
      if (!productId) throw new HttpError(400, `第 ${index + 1} 行 ${opType} 必须指定 product_id`);
      break;
    case 'MODIFY_HEADER':
      // ok
      break;
    default:
      throw new HttpError(400, `第 ${index + 1} 行操作类型不支持`);
  }
  return {
    opType,
    productId: productId || null,
    quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
    scrapRate: Number.isFinite(Number(item.scrapRate ?? item.scrap_rate)) ? Number(item.scrapRate ?? item.scrap_rate) : null,
    oldValue: optionalText(item.oldValue ?? item.old_value, 200) || '',
    newValue: optionalText(item.newValue ?? item.new_value, 200) || '',
    fromProductId: item.fromProductId ?? item.from_product_id ?? null,
    toProductId: item.toProductId ?? item.to_product_id ?? null,
    notes: optionalText(item.notes, 500) || '',
  };
}

export function listEngineeringChanges(db, res, actor, url) {
  allowAny(actor, ['ENGINEERING_CHANGE_VIEW', 'PRODUCTION_ORDERS_VIEW']);
  const status = String(url.searchParams.get('status') || '').toUpperCase();
  const where = ['1=1'];
  const params = [];
  if (ECO_STATUSES.has(status)) { where.push('eco.status=?'); params.push(status); }
  const rows = db.prepare(`SELECT eco.*, creator.display_name creator_name, approver.display_name approver_name,
    target_p.code target_bom_product_code
    FROM engineering_change_orders eco
    LEFT JOIN users creator ON creator.id=eco.creator_id
    LEFT JOIN users approver ON approver.id=eco.approver_id
    LEFT JOIN boms target ON target.id=eco.target_bom_id
    LEFT JOIN products target_p ON target_p.id=target.product_id
    WHERE ${where.join(' AND ')}
    ORDER BY eco.created_at DESC LIMIT 200`).all(...params);
  return send(res, 200, { changes: rows });
}

export function getEngineeringChange(db, res, actor, changeId) {
  allowAny(actor, ['ENGINEERING_CHANGE_VIEW', 'PRODUCTION_ORDERS_VIEW']);
  const eco = loadChangeOrder(db, changeId);
  return send(res, 200, { change: eco });
}

export async function createEngineeringChange(db, req, res, actor) {
  allow(actor, 'ENGINEERING_CHANGE_MANAGE');
  const body = await readJson(req);
  const docNo = requiredCode(body.docNo ?? body.doc_no, '变更单号');
  const title = requiredText(body.title, '变更标题', 200);
  const reason = optionalText(body.reason, 500) || '';
  const changeType = normalizeChangeType(body.changeType ?? body.change_type);
  const effectiveDate = optionalText(body.effectiveDate ?? body.effective_date, 10) || null;
  if (changeType === 'EFFECTIVE_DATE' && !effectiveDate) {
    throw new HttpError(400, 'EFFECTIVE_DATE 类型必须指定 effective_date');
  }
  const versionUpgrade = Math.max(1, Math.round(Number(body.versionUpgrade ?? body.version_upgrade ?? 1)));
  const targetBomId = body.targetBomId ?? body.target_bom_id ?? null;
  if (targetBomId) {
    const bom = db.prepare('SELECT 1 FROM boms WHERE id=?').get(targetBomId);
    if (!bom) throw new HttpError(400, '目标 BOM 不存在');
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.map((item, index) => validateItemPayload(db, changeType, item, index));
  const ecoId = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_change_orders(id,doc_no,title,reason,change_type,effective_date,version_upgrade,status,target_bom_id,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(ecoId, docNo, title, reason, changeType, effectiveDate, versionUpgrade, 'DRAFT', targetBomId, actor.id, now, now);
    const itemStmt = db.prepare(`INSERT INTO engineering_change_items(id,change_order_id,line_no,op_type,product_id,quantity,scrap_rate,old_value,new_value,from_product_id,to_product_id,notes,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    items.forEach((item, idx) => itemStmt.run(id(), ecoId, idx + 1, item.opType, item.productId || null, item.quantity, item.scrapRate,
      item.oldValue, item.newValue, item.fromProductId, item.toProductId, item.notes, now));
    audit(db, actor.id, 'CREATE', 'ENGINEERING_CHANGE', ecoId, docNo);
  });
  return send(res, 201, { id: ecoId });
}

export async function submitEngineeringChange(db, res, actor, changeId) {
  allow(actor, 'ENGINEERING_CHANGE_MANAGE');
  const eco = loadChangeOrder(db, changeId);
  if (eco.status !== 'DRAFT' && eco.status !== 'PENDING') {
    throw new HttpError(409, '仅 DRAFT / PENDING 状态可提交');
  }
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("UPDATE engineering_change_orders SET status='PENDING', updated_at=? WHERE id=?").run(now, changeId);
    audit(db, actor.id, 'SUBMIT', 'ENGINEERING_CHANGE', changeId, eco.doc_no);
  });
  return send(res, 200, { ok: true });
}

export async function approveEngineeringChange(db, res, actor, changeId) {
  allow(actor, 'ENGINEERING_CHANGE_APPROVE');
  const eco = loadChangeOrder(db, changeId);
  if (eco.status !== 'PENDING') {
    throw new HttpError(409, '仅 PENDING 状态可审批');
  }
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("UPDATE engineering_change_orders SET status='APPROVED', approver_id=?, approved_at=?, updated_at=? WHERE id=?")
      .run(actor.id, now, now, changeId);
    audit(db, actor.id, 'APPROVE', 'ENGINEERING_CHANGE', changeId, eco.doc_no);
  });
  return send(res, 200, { ok: true });
}

export async function rejectEngineeringChange(db, req, res, actor, changeId) {
  allow(actor, 'ENGINEERING_CHANGE_APPROVE');
  const eco = loadChangeOrder(db, changeId);
  if (eco.status !== 'PENDING') {
    throw new HttpError(409, '仅 PENDING 状态可驳回');
  }
  const body = await readJson(req);
  const reason = requiredText(body.reason, '驳回原因', 200);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("UPDATE engineering_change_orders SET status='REJECTED', reason=?, updated_at=? WHERE id=?")
      .run(`${eco.reason}\n[REJECT] ${reason}`, now, changeId);
    audit(db, actor.id, 'REJECT', 'ENGINEERING_CHANGE', changeId, eco.doc_no);
  });
  return send(res, 200, { ok: true });
}

// Impact preview: project the ECO into a simulated final BOM without
// mutating anything. Returns diff summary.
export async function previewImpactEngineeringChange(db, res, actor, changeId) {
  allowAny(actor, ['ENGINEERING_CHANGE_VIEW', 'ENGINEERING_CHANGE_MANAGE']);
  const eco = loadChangeOrder(db, changeId);
  if (!eco.target_bom_id) return send(res, 200, { change: eco, affectedBoms: [], diff: [], note: 'no target BOM' });
  const bom = db.prepare('SELECT * FROM boms WHERE id=?').get(eco.target_bom_id);
  if (!bom) return send(res, 200, { change: eco, affectedBoms: [], diff: [], note: 'target BOM missing' });
  const currentItems = db.prepare('SELECT * FROM bom_items WHERE bom_id=? ORDER BY line_no').all(eco.target_bom_id);
  const projected = currentItems.map((it) => ({ ...it }));
  const diff = [];
  for (const item of eco.items) {
    if (item.op_type === 'MODIFY_HEADER') {
      diff.push({ op: item.op_type, summary: item.notes || item.new_value || 'header change' });
      continue;
    }
    const productId = item.product_id;
    if (item.op_type === 'ADD_COMPONENT') {
      projected.push({ product_id: productId, quantity: item.quantity || 1, scrap_rate: item.scrap_rate || 0 });
      diff.push({ op: item.op_type, product_id: productId, summary: `add ${item.quantity || 1}` });
    } else if (item.op_type === 'MODIFY_COMPONENT') {
      const target = projected.find((it) => it.product_id === productId);
      if (target) {
        target.quantity = item.quantity ?? target.quantity;
        target.scrap_rate = item.scrap_rate ?? target.scrap_rate;
        diff.push({ op: item.op_type, product_id: productId, summary: `modify qty=${item.quantity} scrap=${item.scrap_rate}` });
      } else {
        diff.push({ op: item.op_type, product_id: productId, summary: 'modify target not found' });
      }
    } else if (item.op_type === 'DELETE_COMPONENT' || item.op_type === 'INVALIDATE_COMPONENT') {
      const idx = projected.findIndex((it) => it.product_id === productId);
      if (idx >= 0) projected.splice(idx, 1);
      diff.push({ op: item.op_type, product_id: productId, summary: `${item.op_type}` });
    }
  }
  return send(res, 200, { change: eco, affectedBoms: [bom.id], diff, projectedItemCount: projected.length });
}

// Apply the ECO atomically. This creates a new BOM version derived from
// the target BOM + the ECO items, and never mutates existing historical
// production snapshots.
export async function applyEngineeringChange(db, res, actor, changeId) {
  allow(actor, 'ENGINEERING_CHANGE_MANAGE');
  const eco = loadChangeOrder(db, changeId);
  if (eco.status !== 'APPROVED') {
    throw new HttpError(409, '仅 APPROVED 状态可应用');
  }
  if (!eco.target_bom_id) {
    throw new HttpError(409, '工程变更单未指定目标 BOM');
  }
  const targetBom = db.prepare('SELECT * FROM boms WHERE id=?').get(eco.target_bom_id);
  if (!targetBom) throw new HttpError(404, '目标 BOM 不存在');
  const currentItems = db.prepare('SELECT * FROM bom_items WHERE bom_id=? ORDER BY line_no').all(eco.target_bom_id);
  const projected = currentItems.map((it) => ({ ...it }));
  for (const item of eco.items) {
    if (item.op_type === 'MODIFY_HEADER') continue;
    const productId = item.product_id;
    if (item.op_type === 'ADD_COMPONENT') {
      if (!projected.find((p) => p.product_id === productId)) {
        projected.push({ product_id: productId, quantity: item.quantity || 1, scrap_rate: 0 });
      }
    } else if (item.op_type === 'MODIFY_COMPONENT') {
      const t = projected.find((it) => it.product_id === productId);
      if (t) {
        t.quantity = item.quantity ?? t.quantity;
        t.scrap_rate = item.scrap_rate ?? t.scrap_rate;
      }
    } else if (item.op_type === 'DELETE_COMPONENT' || item.op_type === 'INVALIDATE_COMPONENT') {
      const idx = projected.findIndex((it) => it.product_id === productId);
      if (idx >= 0) projected.splice(idx, 1);
    }
  }
  const newVersion = String(Number(targetBom.version || '1') + Math.max(1, eco.version_upgrade)) + '.0';
  const newBomId = id();
  const now = new Date().toISOString();
  let appliedBomId;
  transaction(db, () => {
    db.prepare(`INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at,
        purpose,effective_from,effective_to,approval_status,approved_by,approved_at,change_request_id,eco_change_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      newBomId, targetBom.product_id, newVersion, 'ACTIVE', `由工程变更单 ${eco.doc_no} 生成`,
      actor.id, now, now,
      targetBom.purpose || 'GENERAL',
      eco.change_type === 'EFFECTIVE_DATE' ? eco.effective_date : targetBom.effective_from,
      targetBom.effective_to,
      'APPROVED', actor.id, now,
      `ECO-${changeId}`,
      changeId,
    );
    const insert = db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no,uom_code_snapshot,conversion_numerator,conversion_denominator,is_selectable,is_replaceable,is_modifiable,config_group,config_constraint,eco_change_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    projected.forEach((item, idx) => {
      insert.run(
        id(), newBomId, item.product_id, item.quantity, item.scrap_rate, idx + 1,
        item.uom_code_snapshot || null, item.conversion_numerator || 1, item.conversion_denominator || 1,
        item.is_selectable || 0, item.is_replaceable || 0, item.is_modifiable || 0,
        item.config_group || null, item.config_constraint || '',
        changeId,
      );
    });
    db.prepare(`UPDATE boms SET status='DISCONTINUED', updated_at=? WHERE product_id=? AND id<>? AND status='ACTIVE' AND COALESCE(purpose,'GENERAL')=COALESCE(?, 'GENERAL')`)
      .run(now, targetBom.product_id, newBomId, targetBom.purpose || 'GENERAL');
    db.prepare("UPDATE engineering_change_orders SET status='APPLIED', applied_at=?, updated_at=? WHERE id=?")
      .run(now, now, changeId);
    audit(db, actor.id, 'APPLY', 'ENGINEERING_CHANGE', changeId, `${eco.doc_no} → ${newVersion}`);
    appliedBomId = newBomId;
  });
  return send(res, 200, { ok: true, appliedBomId, newVersion });
}

// Use-Up-Old cleanup log: records cleanup events derived from USE_UP_OLD
// ECOs. The full expected-supply view is deferred to future Domains
// (Procurement / Planning / Inventory).
export async function recordCleanup(db, req, res, actor, changeId) {
  allow(actor, 'ENGINEERING_CHANGE_MANAGE');
  const eco = loadChangeOrder(db, changeId);
  if (eco.change_type !== 'USE_UP_OLD') {
    throw new HttpError(409, '仅 USE_UP_OLD 类型支持清理日志');
  }
  const body = await readJson(req);
  const productId = body.productId ?? body.product_id;
  const reason = requiredText(body.reason, '清理原因', 200);
  const cleanupId = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_change_items(id,change_order_id,line_no,op_type,product_id,old_value,new_value,notes,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      cleanupId, changeId, (eco.items.length + 1), 'INVALIDATE_COMPONENT', productId, 'IN_USE', 'CLEANED', reason, now);
    audit(db, actor.id, 'CLEANUP', 'ENGINEERING_CHANGE', changeId, productId);
  });
  return send(res, 201, { id: cleanupId });
}
