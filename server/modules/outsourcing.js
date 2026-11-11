import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit, auditBusinessRejection } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';
import {
  executeOutsourcingBackflush, executeOutsourcingMove,
  recordOpeningWipSupply, resolveOutsourcingIdentity,
} from './outsourcing-inventory.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { createPurchaseOrderDraftCanonical } from './procurement-orders.js';
import { assertSupplierQualification } from './procurement-sourcing.js';
import { assertFinanceBusinessDateOpen } from './finance-business-close.js';
import { assertSourceControl, assertSupplierCategoryAllows } from './procurement-policy.js';
import { resolvePurchaseLinePricing } from './procurement-pricing.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import { roundRational } from './commercial-golive.js';
import { resolveEffectiveBomForCaller } from './engineering-bom.js';
import {
  listOutsourcingOptions, listOutsourcingReceivingQueue, readOutsourcingReceiptQualityContext,
  readOutsourcingReceivingContext, resolveOutsourcingOrderId,
} from './outsourcing-read-models.js';
import { deriveQualityState } from './quality-gates.js';

const VIEW_PERMISSIONS = ['OUTSOURCING_VIEW', 'OUTSOURCING_MANAGE', 'OUTSOURCING_RELEASE'];
const MATERIAL_PERMISSIONS = ['OUTSOURCING_MATERIAL_EXECUTE'];

function assertViewPermission(actor) { allowAny(actor, VIEW_PERMISSIONS); }
function assertManagePermission(actor) { allow(actor, 'OUTSOURCING_MANAGE'); }
function assertReleasePermission(actor) { allowAny(actor, ['OUTSOURCING_RELEASE', 'OUTSOURCING_MANAGE']); }
function assertMaterialPermission(actor) { allowAny(actor, MATERIAL_PERMISSIONS); }
function assertReceivingPermission(actor) { allow(actor, 'OUTSOURCING_RECEIVING_MANAGE'); }
function assertQualityViewPermission(actor) { allowAny(actor, ['IQC_VIEW', 'IQC_MANAGE']); }

function businessConflict(code, message) {
  return new HttpError(409, message, { code });
}

// 加工费金额输入口径（M1C-WP2–WP6-R1 / P1）：复用既有“安全整数分 + 非负”规则，
// 并拒绝非法字符串的隐式转换。NaN / Infinity / 负数 / 非安全整数 / 溢出都必须
// 在进入收货与成品估值之前被拒绝；未提供时沿用既有收货合同按 0 处理。
function outsourcingAmountCents(value, label) {
  if (value === undefined || value === null) return 0;
  let candidate;
  if (typeof value === 'number') {
    candidate = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    candidate = Number(value);
  } else {
    throw new HttpError(400, `${label}必须是非负安全整数分`, { code: 'OUTSOURCING_RECEIPT_AMOUNT_INVALID' });
  }
  if (!Number.isSafeInteger(candidate) || candidate < 0) {
    throw new HttpError(400, `${label}必须是非负安全整数分`, { code: 'OUTSOURCING_RECEIPT_AMOUNT_INVALID' });
  }
  return candidate;
}

/**
 * OUTSOURCE 完工通知行的剩余容量占用（M1C-WP2–WP6-R1 / P0-01）。
 *
 * 权威口径（Active Design §5.2.2、Requirement MC-REQ-02 / MC-REQ-09）：
 *   通知行数量 ≥ 同一通知行的历史有效收货占用量 + 本次拟收货量
 *
 * - 按**真实通知行 ID** 逐行累计，不按整个订单粗略分配；
 * - 待检（`PENDING_INSPECTION`）与已生效（`EFFECTED`）都仍占用来源容量，
 *   只有 `CANCELLED` 不占用；
 * - 历史收货若无法证明其通知行来源（`source_notice_item_source_id` 为 NULL 或
 *   指向已不存在的通知行），该通知行的剩余容量**不可证明** ⇒ fail closed。
 */
function outsourcingNoticeLineUsage(db, orderId) {
  const rows = db.prepare(`SELECT ori.source_notice_item_source_id notice_item_id,
      SUM(ori.quantity) quantity,
      MAX(CASE WHEN rni.id IS NULL THEN 1 ELSE 0 END) unprovable
    FROM outsourcing_receipt_items ori
    JOIN outsourcing_receipts orc ON orc.id = ori.receipt_id
    LEFT JOIN receipt_notice_items rni ON rni.id = ori.source_notice_item_source_id
    WHERE orc.order_id=? AND orc.business_status<>'CANCELLED'
    GROUP BY ori.source_notice_item_source_id`).all(orderId);
  const usage = new Map();
  let unprovable = false;
  for (const row of rows) {
    if (Number(row.unprovable) > 0 || !row.notice_item_id) {
      unprovable = true;
      continue;
    }
    usage.set(row.notice_item_id, Number(row.quantity));
  }
  return { usage, unprovable };
}

function auditRejectedBusinessRule(db, actor, entityType, entityId, action, error) {
  auditBusinessRejection(db, actor, { entityType, entityId: entityId || null, action }, error);
}

// 订单生命周期动作合同（Requirement §31.15 `OUT-WB-REQ-06/07`；Design §26.35.5）。
// 动作与目标态一一对应：请求必须给出明确动作，动作必须与当前状态相符。
// 旧客户端的 `NEXT` 不再被静默推进——它固定 400，不会推进任何状态。
const TRANSITION_TARGETS = Object.freeze({
  CONFIRM_PLAN: { from: 'DRAFT', to: 'PLAN_CONFIRMED' },
  RELEASE: { from: 'PLAN_CONFIRMED', to: 'RELEASED' },
  COMPLETE: { from: 'RELEASED', to: 'COMPLETED' },
  CLOSE: { from: 'COMPLETED', to: 'CLOSED' },
});

function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderNo: row.order_no,
    supplierId: row.supplier_id,
    supplierCode: row.supplier_code || null,
    supplierName: row.supplier_name || null,
    productId: row.product_id,
    productCode: row.product_code || null,
    productName: row.product_name || null,
    orderQuantity: row.order_quantity,
    requiredQuantity: row.required_quantity,
    unit: row.unit,
    sourceType: row.source_type,
    planningHandoffId: row.planning_handoff_id,
    status: row.status,
    businessDate: row.business_date,
    expectedCompletionDate: row.expected_completion_date,
    bomId: row.bom_id,
    bomVersion: row.bom_version,
  };
}

function rowToMaterialList(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    requiredQuantity: row.required_quantity,
    unit: row.unit,
    issuedQuantity: row.issued_quantity,
    supplementedQuantity: row.supplemented_quantity,
    returnedQuantity: row.returned_quantity,
    backflushedQuantity: row.backflushed_quantity,
    bomSnapshot: row.bom_snapshot_json ? JSON.parse(row.bom_snapshot_json) : null,
    supplierWipRemaining: Math.max(0, Number(row.issued_quantity) + Number(row.supplemented_quantity) - Number(row.returned_quantity) - Number(row.backflushed_quantity)),
  };
}

export function listOutsourcingOrders(db, res, actor, url) {
  assertViewPermission(actor);
  const status = url.searchParams.get('status');
  const search = String(url.searchParams.get('q') || '').trim();
  const where = [];
  const params = [];
  if (status) { where.push('o.status=?'); params.push(status); }
  if (search) {
    // 现场按单号、供应商或成品检索，不要求记忆原始数据库 ID。
    const term = `%${search.replace(/[%_]/g, (character) => `\\${character}`)}%`;
    where.push("(o.order_no LIKE ? ESCAPE '\\' OR s.code LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')");
    params.push(term, term, term, term, term);
  }
  const orders = db.prepare(`SELECT o.*, s.code supplier_code, s.name supplier_name,
      p.code product_code, p.name product_name
    FROM outsourcing_orders o
    LEFT JOIN suppliers s ON s.id=o.supplier_id
    LEFT JOIN products p ON p.id=o.product_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY o.created_at DESC LIMIT 100`).all(...params).map(rowToOrder);
  return send(res, 200, { outsourcingOrders: orders });
}

export function getOutsourcingOrder(db, res, actor, orderId) {
  assertViewPermission(actor);
  const order = db.prepare(`SELECT o.*, s.code supplier_code, s.name supplier_name,
      p.code product_code, p.name product_name
    FROM outsourcing_orders o
    LEFT JOIN suppliers s ON s.id=o.supplier_id
    LEFT JOIN products p ON p.id=o.product_id
    WHERE o.id=?`).get(orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  const materials = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=?').all(orderId).map(rowToMaterialList);
  const issues = db.prepare("SELECT * FROM outsourcing_issues WHERE order_id=?").all(orderId);
  const supplements = db.prepare("SELECT * FROM outsourcing_supplements WHERE order_id=?").all(orderId);
  const returns = db.prepare("SELECT * FROM outsourcing_returns WHERE order_id=?").all(orderId);
  const receipts = db.prepare("SELECT * FROM outsourcing_receipts WHERE order_id=?").all(orderId);
  // 委外业务详情组合加工费 PO 与完工通知引用（Design §26.35.2）。
  // 这是委外业务岗位的宽投影：委外收货员没有该权限，只能走受限收货投影。
  const processingPoRow = db.prepare(`SELECT id, order_no, status, total_cents, supplier_id
    FROM purchase_orders WHERE business_type='OUTSOURCE_PROCESSING' AND source_outsourcing_order_id=?
    ORDER BY created_at, id`).get(orderId);
  let processingPo = null;
  if (processingPoRow) {
    const poItems = db.prepare(`SELECT id, product_id, quantity, unit_price_cents, amount_cents, line_no, document_uom_code
      FROM purchase_order_items WHERE order_id=? ORDER BY line_no, id`).all(processingPoRow.id);
    processingPo = {
      id: processingPoRow.id,
      poNo: processingPoRow.order_no,
      status: processingPoRow.status,
      totalCents: Number(processingPoRow.total_cents || 0),
      items: poItems.map((item) => ({
        id: item.id,
        productId: item.product_id,
        quantity: Number(item.quantity),
        unitPriceCents: Number(item.unit_price_cents),
        amountCents: Number(item.amount_cents),
        unitCode: item.document_uom_code || null,
        lineNo: item.line_no,
      })),
    };
  }
  const notices = db.prepare(`SELECT n.id, n.notice_no, n.status, n.warehouse_id, n.notice_date,
      COALESCE(SUM(i.quantity),0) quantity
    FROM receipt_notices n LEFT JOIN receipt_notice_items i ON i.notice_id=n.id
    WHERE n.outsourcing_order_id=? AND n.business_type='OUTSOURCE'
    GROUP BY n.id ORDER BY n.created_at, n.id`).all(orderId).map((notice) => ({
    id: notice.id,
    noticeNo: notice.notice_no,
    status: notice.status,
    warehouseId: notice.warehouse_id,
    noticeDate: notice.notice_date,
    quantity: Number(notice.quantity || 0),
  }));
  return send(res, 200, { outsourcingOrder: rowToOrder(order), materials, issues, supplements, returns, receipts, processingPo, notices });
}

/**
 * OUT-05: Consume one `planning_outsource_handoffs` row exactly-once.
 *
 * Authoritative invariants:
 *   - handoff.status MUST be 'PENDING' on consume (else 409 already consumed)
 *   - no row may exist in `outsourcing_orders` where planning_handoff_id = id (UNIQUE)
 *   - handoff.status is moved to 'CONSUMED' with target_outsourcing_order_id,
 *     consumed_at, consumed_by set
 *   - For PLANNING source orders, the canonical product / quantity / need_date
 *     are derived from the handoff row, NOT from client-supplied values.
 *
 * Returns the authoritative handoff row plus caller-supplied order fields.
 * Re-throws HTTP 404 / 409 for missing / already-consumed handoffs.
 */
function consumePlanningHandoff(db, { handoffId, actor, supplierId, bodyOrderId, bodyOrderNo, bodyBusinessDate, bodyExpectedCompletionDate, bodyBomId, bodyBomVersion, bodyRemark }) {
  // Lock handoff row for atomic consume (works on both SQLite BEGIN IMMEDIATE
  // and MySQL SELECT ... FOR UPDATE rows once wrapped in `transaction(db, …)`).
  db.prepare(`UPDATE planning_outsource_handoffs SET id=id WHERE id=?`).run(handoffId);
  const handoff = db.prepare('SELECT * FROM planning_outsource_handoffs WHERE id=?').get(handoffId);
  if (!handoff) throw new HttpError(404, '计划移交单不存在');
  if (handoff.status !== 'PENDING') {
    throw new HttpError(409, `handoff 已不可消费：status=${handoff.status}`);
  }
  const existingOrder = db.prepare('SELECT id FROM outsourcing_orders WHERE planning_handoff_id=?').get(handoffId);
  if (existingOrder) {
    throw new HttpError(409, 'planning_handoff_id 已被消费，不得重复');
  }
  // Authoritative product / quantity / need_date come from the handoff.
  // Client-supplied values for these fields are IGNORED on PLANNING source.
  const orderId = bodyOrderId;
  const orderNo = bodyOrderNo;
  const now = new Date().toISOString();
  try {
    db.prepare(`INSERT INTO outsourcing_orders(id,order_no,supplier_id,product_id,order_quantity,required_quantity,unit,source_type,planning_handoff_id,status,business_date,expected_completion_date,bom_id,bom_version,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?)`).run(
      orderId, orderNo, supplierId, handoff.product_id, Number(handoff.quantity), Number(handoff.quantity), 'EA',
      'PLANNING', handoffId, bodyBusinessDate || now.slice(0, 10), bodyExpectedCompletionDate || handoff.need_date || null,
      bodyBomId || null, bodyBomVersion || null, bodyRemark || '', actor.id, now, now,
    );
  } catch (err) {
    if (/UNIQUE constraint failed: outsourcing_orders.planning_handoff_id/i.test(String(err.message))) {
      throw new HttpError(409, 'planning_handoff_id 已被消费，不得重复');
    }
    throw err;
  }
  // Mark the handoff CONSUMED. Even if the order is later CANCELLED, the
  // handoff must remain CONSUMED — Planning truth is immutable; produce a
  // fresh planned order → fresh handoff if a new ORDER is needed.
  db.prepare(`UPDATE planning_outsource_handoffs
    SET status='CONSUMED', target_outsourcing_order_id=?, consumed_at=?, consumed_by=?
    WHERE id=? AND status='PENDING'`).run(orderId, now, actor.id, handoffId);
  audit(db, actor.id, 'CONSUMED', 'PLANNING_OUTSOURCE_HANDOFF', handoffId, `→ ${orderId}`);
  return { handoff };
}

/**
 * Create outsourcing order.
 *
 *   source_type='PLANNING': consume `planning_outsource_handoffs(id)` exactly-once.
 *                           Authoritative product / quantity / need_date are
 *                           taken from the handoff row.
 *   source_type='MANUAL':   planning_handoff_id MUST be NULL; client supplies
 *                           all canonical order fields.
 */
/**
 * The canonical engineering resolver owns the "which BOM is effective" rule.
 *
 * An outsourcing order names the BOM it consumes; the server proves that this
 * BOM satisfies the same canonical criteria the resolver applies (approved,
 * effective at the business date, `purpose=OUTSOURCE`, same product). An
 * implicit "first ACTIVE row" pick is exactly what the requirement forbids
 * (Requirement §31.3.3 OUT-08), so a bound BOM that is not canonical
 * eligible fails closed instead of being silently replaced.
 */
function resolveOutsourcingBasisBom(db, productId, businessDate, boundBomId) {
  const effective = resolveEffectiveBomForCaller(db, productId, 'OUTSOURCE', businessDate);
  if (!effective || String(effective.purpose || '').toUpperCase() !== 'OUTSOURCE') return null;
  if (!boundBomId) return null;
  const bound = db.prepare(`SELECT * FROM boms WHERE id=? AND product_id=? AND purpose='OUTSOURCE'
    AND status='ACTIVE' AND approval_status='APPROVED'
    AND (effective_from IS NULL OR effective_from<=?) AND (effective_to IS NULL OR effective_to>=?)`)
    .get(boundBomId, productId, businessDate, businessDate);
  return bound || null;
}

export async function createOutsourcingOrder(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'productId', 'orderQuantity', 'unit', 'planningHandoffId', 'businessDate', 'expectedCompletionDate', 'remark', 'bomId']);
  const hasHandoff = Boolean(body.planningHandoffId);
  const sourceType = hasHandoff ? 'PLANNING' : 'MANUAL';
  if (sourceType === 'MANUAL' && hasHandoff) throw new HttpError(400, 'MANUAL 订单不允许携带 planningHandoffId');
  const today = new Date().toISOString().slice(0, 10);
  const businessDate = body.businessDate || today;
  // The BOM binding is validated when the order is created, not only when the
  // material snapshot is taken: an order must never be able to carry an
  // unapproved or wrongly-purposed BOM.
  if (body.bomId) {
    const basisBom = resolveOutsourcingBasisBom(db, body.productId, businessDate, body.bomId);
    if (!basisBom || (body.bomVersion != null && Number(body.bomVersion) !== Number(basisBom.version))) {
      throw businessConflict('OUTSOURCING_BASIS_INVALID', '委外订单必须绑定当前业务日期有效的 OUTSOURCE BOM');
    }
  }
  const orderId = randomUUID(); const now = new Date().toISOString();
  const orderNo = 'OS-' + Date.now().toString().slice(-10);
  try {
    transaction(db, () => {
      // 委外供应商资格按**订单业务日期**与有效起止日判断，不按系统当前日；
      // 复用采购域唯一资格原语，避免第二份不一致规则（Design §26.35.3）。
      assertSupplierQualification(db, body.supplierId, 'OUTSOURCE', businessDate);
      // PRC-02：委外类供应商才可承接委外业务；普通类供应商不得承接。
      assertSupplierCategoryAllows(db, { supplierId: body.supplierId, businessType: 'OUTSOURCE' });
      // OUT-02：委外订单必须消费**有效 OUTSOURCE 货源**。货源控制的采购参数
      // 开关对委外同样生效（同一参数、同一判定），委外与采购共用同一份货源
      // 解析实现，不存在第二套规则。
      assertSourceControl(db, {
        supplierId: body.supplierId, productId: body.productId, businessDate, sourceType: 'OUTSOURCE',
      });
      if (sourceType === 'PLANNING') {
        consumePlanningHandoff(db, {
          handoffId: body.planningHandoffId, actor,
          supplierId: body.supplierId,
          bodyOrderId: orderId, bodyOrderNo: orderNo,
          bodyBusinessDate: body.businessDate, bodyExpectedCompletionDate: body.expectedCompletionDate,
          bodyBomId: body.bomId, bodyBomVersion: body.bomVersion, bodyRemark: body.remark,
        });
      } else {
        // MANUAL source: canonical fields come from the client body.
        try {
          db.prepare(`INSERT INTO outsourcing_orders(id,order_no,supplier_id,product_id,order_quantity,required_quantity,unit,source_type,planning_handoff_id,status,business_date,expected_completion_date,bom_id,bom_version,remark,creator_id,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,NULL,'DRAFT',?,?,?,?,?,?,?,?)`).run(
            orderId, orderNo, body.supplierId, body.productId, Number(body.orderQuantity), Number(body.orderQuantity), body.unit || 'EA',
            sourceType, body.businessDate || today, body.expectedCompletionDate || null,
            body.bomId || null, body.bomVersion || null, body.remark || '', actor.id, now, now,
          );
        } catch (err) {
          if (/UNIQUE constraint failed: outsourcing_orders.planning_handoff_id/i.test(String(err.message))) {
            throw new HttpError(409, 'planning_handoff_id 已被消费，不得重复');
          }
          throw err;
        }
        audit(db, actor.id, 'CREATE', 'OUTSOURCING_ORDER', orderId, orderNo);
      }
    });
  } catch (error) {
    // 业务拒绝写恰好一条拒绝审计（事务已回滚，业务零副作用）。
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', null, '创建委外订单', error);
    throw error;
  }
  return send(res, 201, { id: orderId, orderNo });
}

// 用料快照基数的可证明性。历史不可证明的快照返回 null，不得以 0 取得容量。
function parseSnapshotBasis(material) {
  try {
    const snapshot = JSON.parse(material.bom_snapshot_json || '{}');
    return snapshot && typeof snapshot === 'object' ? snapshot : null;
  } catch {
    return null;
  }
}

/**
 * `CONFIRM_PLAN` 门禁：快照必须已在 DRAFT 阶段形成，且逐行可证明
 * （Requirement §31.15 `OUT-WB-REQ-02/06`；已批准 `MC-REQ-03`）。
 */
function assertMaterialSnapshotProvable(db, order) {
  const materials = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=? ORDER BY id').all(order.id);
  if (!materials.length) {
    throw businessConflict('OUTSOURCING_MATERIAL_SNAPSHOT_REQUIRED', '委外订单必须先建立用料清单快照才能确认计划');
  }
  for (const material of materials) {
    const snapshot = parseSnapshotBasis(material);
    if (!snapshot
      || !Number.isFinite(Number(snapshot.per_unit_quantity))
      || !Number.isFinite(Number(snapshot.required_quantity))
      || Math.abs(Number(snapshot.required_quantity) - Number(material.required_quantity)) > 1e-9
      || !material.source_warehouse_id) {
      throw businessConflict('OUTSOURCING_MATERIAL_SNAPSHOT_REQUIRED', '委外用料快照缺少可证明的 BOM 版本、来源仓或总量基数');
    }
    if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(material.source_warehouse_id)) {
      throw businessConflict('OUTSOURCING_MATERIAL_SNAPSHOT_REQUIRED', '委外用料快照的来源仓不存在或已停用');
    }
  }
  return materials;
}

/**
 * `RELEASE` 门禁：快照未被替换，且仍与订单绑定的已批准 OUTSOURCE BOM 一致。
 * 快照只能在 DRAFT 阶段首次建立，因此此处不存在“已确认计划后补建快照”的路径。
 */
function assertMaterialSnapshotUnchanged(db, order) {
  const materials = assertMaterialSnapshotProvable(db, order);
  for (const material of materials) {
    const snapshot = parseSnapshotBasis(material);
    if (!snapshot.bomId || String(snapshot.bomId) !== String(order.bom_id)) {
      throw businessConflict('OUTSOURCING_MATERIAL_SNAPSHOT_REPLACED', '委外用料快照与订单绑定的 BOM 不一致');
    }
  }
}

/**
 * `COMPLETE` 门禁：已生效收货净量必须恰好达到订单数量。
 * 待检、取消与来源不可证明的收货都不计入；确有已确认成品退货的按历史事实扣减。
 */
function assertCompletionQuantityReached(db, order) {
  const receipts = db.prepare("SELECT * FROM outsourcing_receipts WHERE order_id=? AND business_status='EFFECTED' ORDER BY id").all(order.id);
  let effectedQuantity = 0;
  for (const receipt of receipts) {
    const proven = db.prepare("SELECT 1 FROM inventory_transactions WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=? LIMIT 1").get(receipt.id)
      || db.prepare("SELECT 1 FROM inventory_valuation_movements WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=? LIMIT 1").get(receipt.id)
      || db.prepare('SELECT 1 FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=? LIMIT 1').get(receipt.id);
    if (!proven) {
      throw businessConflict('OUTSOURCING_COMPLETION_HISTORY_UNPROVEN', `已生效收货 ${receipt.receipt_no} 的库存与成本证据不可证明`);
    }
    effectedQuantity += Number(receipt.quantity || 0);
  }
  const returnedQuantity = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM outsourcing_finished_returns
    WHERE business_status='CONFIRMED' AND outsourcing_receipt_id IN (SELECT id FROM outsourcing_receipts WHERE order_id=?)`).get(order.id).q);
  const netQuantity = effectedQuantity - returnedQuantity;
  const orderQuantity = Number(order.order_quantity);
  if (Math.abs(netQuantity - orderQuantity) > 1e-9) {
    throw businessConflict('OUTSOURCING_COMPLETION_QUANTITY_NOT_REACHED',
      `已生效收货净量 ${netQuantity} 未达到订单数量 ${orderQuantity}`);
  }
}

/**
 * `CLOSE` 门禁：无待检收货、无仍可转换的完工通知剩余量、材料 WIP 净量为零，
 * 且与 canonical WIP 身份余额逐项一致。延期的 AP/GL、跨期成本与复杂差异
 * 不是关闭前提，也不得被伪造为已结清（Requirement §31.15 `OUT-WB-REQ-07`）。
 */
function assertCloseGates(db, order) {
  const pendingReceipts = Number(db.prepare("SELECT COUNT(*) c FROM outsourcing_receipts WHERE order_id=? AND business_status='PENDING_INSPECTION'").get(order.id).c);
  if (pendingReceipts > 0) {
    throw businessConflict('OUTSOURCING_CLOSE_PENDING_RECEIPT', '委外订单仍有待检收货，不能关闭');
  }
  const notices = db.prepare("SELECT id, notice_no FROM receipt_notices WHERE outsourcing_order_id=? AND business_type='OUTSOURCE' AND status IN ('DRAFT','CONFIRMED')").all(order.id);
  for (const notice of notices) {
    const noticeQuantity = Number(db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM receipt_notice_items WHERE notice_id=?').get(notice.id).q);
    const receivedQuantity = Number(db.prepare(`SELECT COALESCE(SUM(ori.quantity),0) q FROM outsourcing_receipt_items ori
      JOIN outsourcing_receipts orc ON orc.id=ori.receipt_id
      JOIN receipt_notice_items rni ON rni.id=ori.source_notice_item_source_id
      WHERE rni.notice_id=? AND orc.business_status<>'CANCELLED'`).get(notice.id).q);
    if (noticeQuantity - receivedQuantity > 1e-9) {
      throw businessConflict('OUTSOURCING_CLOSE_OPEN_NOTICE', `完工通知 ${notice.notice_no} 仍有未收货数量，不能关闭`);
    }
  }
  const materials = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=? ORDER BY id').all(order.id);
  for (const material of materials) {
    if (material.legacy_unverified_wip_quantity === null || material.legacy_unverified_wip_quantity === undefined) {
      throw businessConflict('OUTSOURCING_CLOSE_WIP_UNPROVEN', '委外物料行的历史 WIP 不可证明，不能关闭');
    }
    const transfers = db.prepare(`SELECT event_type, COALESCE(SUM(ABS(signed_quantity)),0) q FROM outsourcing_wip_identity_effects
      WHERE material_list_id=? AND event_type IN ('TRANSFER_IN','TRANSFER_OUT') GROUP BY event_type`).all(material.id);
    const transferIn = Number(transfers.find((item) => item.event_type === 'TRANSFER_IN')?.q || 0);
    const transferOut = Number(transfers.find((item) => item.event_type === 'TRANSFER_OUT')?.q || 0);
    const netQuantity = Number(material.issued_quantity) + Number(material.supplemented_quantity) + transferIn
      - Number(material.returned_quantity) - Number(material.backflushed_quantity) - transferOut;
    if (netQuantity < -1e-9) {
      throw businessConflict('OUTSOURCING_CLOSE_WIP_NEGATIVE', '委外物料行的 WIP 净量为负，事实不可证明，不能关闭');
    }
    if (Math.abs(netQuantity) > 1e-9) {
      throw businessConflict('OUTSOURCING_CLOSE_WIP_REMAINING', '委外订单仍有未处理的材料 WIP 余量，不能关闭');
    }
    const balances = db.prepare('SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id=?').all(material.id);
    for (const balance of balances) {
      if (Math.abs(Number(balance.available_quantity)) > 1e-9) {
        throw businessConflict('OUTSOURCING_CLOSE_WIP_IDENTITY_REMAINING', '委外物料行仍有可证明的 WIP 身份余额，不能关闭');
      }
      if (Math.abs(Number(balance.supplied_quantity) - Number(balance.consumed_quantity) - Number(balance.available_quantity)) > 1e-9) {
        throw businessConflict('OUTSOURCING_CLOSE_WIP_UNPROVEN', '委外物料行的 WIP 身份账不可证明，不能关闭');
      }
    }
  }
}

export async function transitionOutsourcingOrder(db, req, res, actor, orderId) {
  assertReleasePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['action']);
  const action = String(body.action || '').trim().toUpperCase();
  if (!action || !Object.prototype.hasOwnProperty.call(TRANSITION_TARGETS, action)) {
    throw new HttpError(400, '必须提供明确动作：CONFIRM_PLAN / RELEASE / COMPLETE / CLOSE', { code: 'OUTSOURCING_TRANSITION_ACTION_INVALID' });
  }
  const target = TRANSITION_TARGETS[action];
  const now = new Date().toISOString();
  try {
    transaction(db, () => {
      // 事务内权威重读：请求前的读取不是权威状态（Design §26.35.5）。
      const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
      if (!order) throw new HttpError(404, '委外订单不存在');
      if (order.status !== target.from) {
        throw businessConflict('OUTSOURCING_TRANSITION_STATE_CONFLICT',
          `动作 ${action} 只允许从 ${target.from} 执行，当前状态为 ${order.status}`);
      }
      if (action === 'CONFIRM_PLAN') assertMaterialSnapshotProvable(db, order);
      else if (action === 'RELEASE') assertMaterialSnapshotUnchanged(db, order);
      else if (action === 'COMPLETE') assertCompletionQuantityReached(db, order);
      else assertCloseGates(db, order);
      // 条件更新：受影响行数不为 1 表示并发已改变状态，必须失败而非静默成功。
      const updated = db.prepare('UPDATE outsourcing_orders SET status=?,updated_at=? WHERE id=? AND status=?')
        .run(target.to, now, orderId, target.from);
      if (Number(updated.changes ?? updated.affectedRows) !== 1) {
        throw businessConflict('OUTSOURCING_TRANSITION_STATE_CONFLICT', '委外订单状态已被并发改变，请重新读取后再操作');
      }
      audit(db, actor.id, action, 'OUTSOURCING_ORDER', orderId, `${target.from}→${target.to}`);
    });
  } catch (error) {
    // 400/403/404 不是业务拒绝，不写 Domain 拒绝审计；409 写恰好一条。
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, `委外订单${action}`, error);
    throw error;
  }
  return send(res, 200, { ok: true, status: target.to });
}

export async function cancelOutsourcingOrder(db, req, res, actor, orderId) {
  assertManagePermission(actor);
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  if (!['DRAFT', 'PLAN_CONFIRMED'].includes(order.status)) throw new HttpError(409, '当前状态不可取消');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE outsourcing_orders SET status=?,updated_at=? WHERE id=?').run('CANCELLED', now, orderId);
    audit(db, actor.id, 'CANCEL', 'OUTSOURCING_ORDER', orderId, order.order_no);
  });
  return send(res, 200, { ok: true });
}

const PROCESSING_PO_BUSINESS_FIELDS = ['unitPriceCents', 'orderDate', 'expectedDeliveryDate', 'paymentTerms', 'paymentTermsDays',
  'supplierContactName', 'supplierContactPhone', 'supplierAddress', 'remark'];

// ---------------------------------------------------------------------------
// OUT-03 加工费价格来源（Requirement §31.3.3 OUT-03；Active Design §26.36.3）
// ---------------------------------------------------------------------------
//
// 加工费是**委外加工对价**，不是成品全部材料成本，也不是普通采购价格。
// 因此加工费 PO 的价格来源必须能被读出来，且来源只能是下列两者之一：
//
//   1. **委外价格表条目**（`purchase_price_list_entries.source_type='OUTSOURCE'`）：
//      业务日期上有效的唯一 OUTSOURCE 条目即为权威价格。此时客户端传入的
//      `unitPriceCents` **只作断言** —— 与权威单价不一致固定 409。
//   2. **委外合同冻结来源**：没有有效 OUTSOURCE 价格条目时，金额来自已批准的
//      委外合同。`price_entry_id` **保持 NULL**（不得为缺失的价格编造价格条目），
//      但价格证据里必须能读出「来源 = 委外合同 + 委外订单号 + 金额」。
//
// **禁止**：普通 `PURCHASE` 价格表静默替换委外价格来源。
// `resolvePurchaseLinePricing` 的 `sourceType` 是显式入参，调用方只传
// `'OUTSOURCE'`，因此 PURCHASE 条目在解析层面根本不可见；`assertProcessingPoPriceSource`
// 再做一次显式反例守卫，防止将来有人把 `sourceType` 改成 'PURCHASE'。
//
// 证据冻结形态（`purchase_order_items.pricing_evidence_json`）：
//
//   {
//     "contractVersion": "OUTSOURCING_PROCESSING_PRICE_V1",
//     "sourceKind": "OUTSOURCE_PRICE_LIST" | "OUTSOURCE_CONTRACT",
//     "sourceType": "OUTSOURCE",
//     "priceEntryId": "<id>" | null,
//     "priceVersion": <n> | null,
//     "unitPriceCents": <int>,
//     "amountCents": <int>,
//     "businessDate": "YYYY-MM-DD",
//     "outsourcingOrderId": "...", "outsourcingOrderNo": "...",
//     ...
//   }
//
// `purchase_order_items.price_entry_id` 只在来源确实是价格条目时才写 ID；
// 委外合同来源下它保持 NULL，`discount_source` 也保持 NULL。
export const OUTSOURCING_PROCESSING_PRICE_CODES = Object.freeze({
  PRICE_NOT_CONFIGURED: 'OUTSOURCING_PROCESSING_PRICE_NOT_CONFIGURED',
  PRICE_ASSERTION_MISMATCH: 'OUTSOURCING_PROCESSING_PRICE_ASSERTION_MISMATCH',
  PRICE_SOURCE_INVALID: 'OUTSOURCING_PROCESSING_PRICE_SOURCE_INVALID',
});

/**
 * 该供应商 / 成品 / 业务日期上是否存在**有效**的 OUTSOURCE 价格条目。
 *
 * 只用于**分流**（走价格表还是走委外合同），不用于定价。定价本身由
 * canonical `resolvePurchaseLinePricing(sourceType='OUTSOURCE')` 完成，
 * 本函数不另立一套解析规则。
 */
function hasEffectiveOutsourcePriceEntry(db, { supplierId, productId, businessDate }) {
  const row = db.prepare(`SELECT 1 FROM purchase_price_list_entries
    WHERE supplier_id=? AND product_id=? AND source_type='OUTSOURCE' AND status='ACTIVE'
      AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)
    LIMIT 1`).get(supplierId, productId, businessDate, businessDate);
  return Boolean(row);
}

/**
 * OUT-03 加工费价格来源的**唯一**权威解析点。
 *
 * 在写事务内调用（权威重读价格表与委外订单）。
 *
 * 返回 `{ unitPriceCents, amountCents, pricingEvidence }`：
 *   - `unitPriceCents` —— 加工费 PO 行的权威单价（安全整数分）；
 *   - `amountCents` —— 按订单数量折算的行金额（安全整数分）；
 *   - `pricingEvidence` —— 冻结到 `purchase_order_items.pricing_evidence_json` 的来源证据。
 */
export function resolveOutsourcingProcessingPrice(db, {
  order, supplier, product, quantity, assertedUnitPriceCents, businessDate, documentUomCode,
}) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new HttpError(400, '委外数量必须大于 0');
  }
  if (!Number.isSafeInteger(assertedUnitPriceCents) || assertedUnitPriceCents < 0) {
    throw new HttpError(400, '加工费单价必须为非负安全整数分');
  }
  const priceEntryAvailable = hasEffectiveOutsourcePriceEntry(db, {
    supplierId: order.supplier_id, productId: order.product_id, businessDate,
  });

  if (priceEntryAvailable) {
    // 权威单价来自委外价格表条目。客户端传入值**只作断言**。
    const pricing = resolvePurchaseLinePricing(db, {
      supplierId: order.supplier_id,
      productId: order.product_id,
      sourceType: 'OUTSOURCE',
      businessDate,
      documentUomCode,
      documentQuantity: { num: quantity, den: 1 },
      giftLine: false,
    });
    if (Number(pricing.unitPriceCents) !== Number(assertedUnitPriceCents)) {
      throw businessConflict(OUTSOURCING_PROCESSING_PRICE_CODES.PRICE_ASSERTION_MISMATCH,
        `客户端加工费单价 ${assertedUnitPriceCents} 与委外价格表权威单价 ${pricing.unitPriceCents} 不一致`);
    }
    // 行金额按**委外订单数量**与权威单价精确相乘（安全整数分）。
    const amountCents = roundRational(BigInt(assertedUnitPriceCents) * BigInt(quantity), 1n);
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
      throw new HttpError(400, '加工费金额无法用安全整数分精确表示');
    }
    return {
      unitPriceCents: assertedUnitPriceCents,
      amountCents,
      priceEntryId: pricing.priceEntryId,
      priceVersion: pricing.priceVersion ?? null,
      pricingUomCode: pricing.pricingUomCode || null,
      pricingEvidence: {
        contractVersion: 'OUTSOURCING_PROCESSING_PRICE_V1',
        sourceKind: 'OUTSOURCE_PRICE_LIST',
        sourceType: 'OUTSOURCE',
        priceEntryId: pricing.priceEntryId,
        priceVersion: pricing.priceVersion ?? null,
        pricingUomCode: pricing.pricingUomCode || null,
        unitPriceCents: assertedUnitPriceCents,
        amountCents,
        quantity,
        businessDate,
        outsourcingOrderId: order.id,
        outsourcingOrderNo: order.order_no,
        supplierId: order.supplier_id,
        productId: order.product_id,
        appliedDiscount: pricing.appliedDiscount || null,
        roundingContract: 'HALF_UP_CENT_V1',
      },
    };
  }

  // 没有有效 OUTSOURCE 价格条目：以**委外合同**冻结来源。
  // `price_entry_id` 保持 NULL —— 不得为缺失的价格编造价格条目。
  const amountCents = roundRational(BigInt(assertedUnitPriceCents) * BigInt(quantity), 1n);
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new HttpError(400, '加工费金额无法用安全整数分精确表示');
  }
  return {
    unitPriceCents: assertedUnitPriceCents,
    amountCents,
    priceEntryId: null,
    priceVersion: null,
    pricingUomCode: null,
    pricingEvidence: {
      contractVersion: 'OUTSOURCING_PROCESSING_PRICE_V1',
      sourceKind: 'OUTSOURCE_CONTRACT',
      sourceType: 'OUTSOURCE',
      priceEntryId: null,
      priceVersion: null,
      pricingUomCode: null,
      unitPriceCents: assertedUnitPriceCents,
      amountCents,
      quantity,
      businessDate,
      outsourcingOrderId: order.id,
      outsourcingOrderNo: order.order_no,
      supplierId: order.supplier_id,
      productId: order.product_id,
      supplierCode: supplier?.code || null,
      contractRemark: order.remark || '',
      roundingContract: 'HALF_UP_CENT_V1',
    },
  };
}

/**
 * 反例守卫：加工费 PO **不得**被普通 `PURCHASE` 价格表静默替换
 * （Active Design §26.36.3 的冻结边界）。
 *
 * 这是一次**读断言**，不新增第二套定价：它证明本行冻结的价格来源确实是
 * OUTSOURCE（价格表条目或委外合同），且没有引用任何 PURCHASE 价格条目。
 */
export function assertProcessingPoPriceSource(db, purchaseOrderId) {
  const po = db.prepare('SELECT id, business_type FROM purchase_orders WHERE id=?').get(purchaseOrderId);
  if (!po) throw new HttpError(404, '采购订单不存在');
  if (po.business_type !== 'OUTSOURCE_PROCESSING') return null;
  const items = db.prepare('SELECT id, price_entry_id, pricing_evidence_json FROM purchase_order_items WHERE order_id=?').all(purchaseOrderId);
  for (const item of items) {
    let evidence = null;
    try { evidence = item.pricing_evidence_json ? JSON.parse(item.pricing_evidence_json) : null; } catch { evidence = null; }
    if (!evidence || evidence.sourceType !== 'OUTSOURCE') {
      throw businessConflict(OUTSOURCING_PROCESSING_PRICE_CODES.PRICE_SOURCE_INVALID,
        '加工费采购订单的价格来源必须是委外价格表条目或委外合同');
    }
    if (item.price_entry_id) {
      const entry = db.prepare('SELECT source_type FROM purchase_price_list_entries WHERE id=?').get(item.price_entry_id);
      if (!entry || entry.source_type !== 'OUTSOURCE') {
        throw businessConflict(OUTSOURCING_PROCESSING_PRICE_CODES.PRICE_SOURCE_INVALID,
          '加工费采购订单不得引用普通采购价格条目');
      }
    }
  }
  return true;
}

// 加工费 PO 创建的规范化 fingerprint（Active Design §6）：
// 只含路由委外订单 ID 与规范化商业输入；可选文本 trim 后缺省为空，
// 日期统一 YYYY-MM-DD|null，单价为安全整数；不含 actor/tenant 与服务端主数据快照。
function normalizeProcessingPoFingerprint(orderId, body) {
  const text = (value) => (value === undefined || value === null ? '' : String(value).trim());
  const date = (value) => {
    const raw = text(value);
    return raw === '' ? null : raw;
  };
  const unitPriceCents = Number(body.unitPriceCents);
  return {
    outsourcingOrderId: String(orderId),
    unitPriceCents: Number.isSafeInteger(unitPriceCents) ? unitPriceCents : null,
    orderDate: date(body.orderDate),
    expectedDeliveryDate: date(body.expectedDeliveryDate),
    paymentTerms: text(body.paymentTerms),
    supplierContactName: text(body.supplierContactName),
    supplierContactPhone: text(body.supplierContactPhone),
    supplierAddress: text(body.supplierAddress),
    remark: text(body.remark),
  };
}

export async function createOutsourcingProcessingPurchaseOrder(db, req, res, actor, orderId) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, PROCESSING_PO_BUSINESS_FIELDS);
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
  if (!idempotencyKey) throw new HttpError(400, 'Idempotency-Key 必填');
  const unitPriceCents = Number(body.unitPriceCents);
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new HttpError(400, '加工费单价必须为非负安全整数分');
  const fingerprint = requestFingerprint(normalizeProcessingPoFingerprint(orderId, body));
  const operation = 'OUTSOURCING_PROCESSING_PO_CREATE';
  try {
    const replay = idempotencyReplay(db, operation, orderId, idempotencyKey, fingerprint);
    if (replay) return send(res, 200, { ...replay, replayed: true });
  } catch (error) {
    if (error?.status !== 409) throw error;
    const conflict = new HttpError(409, error.message, { code: 'PROCESSING_PO_IDEMPOTENCY_CONFLICT' });
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '创建加工费采购订单', conflict);
    throw conflict;
  }
  let result;
  try {
    transaction(db, () => {
      db.prepare('UPDATE outsourcing_orders SET updated_at=updated_at WHERE id=?').run(orderId);
      const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
      if (!order) throw new HttpError(404, '委外订单不存在');
      if (order.status !== 'RELEASED') throw businessConflict('PROCESSING_PO_SOURCE_STATE_INVALID', '只有已下达委外订单可以创建加工费采购订单');
      if (db.prepare('SELECT id FROM purchase_orders WHERE source_outsourcing_order_id=?').get(orderId)) {
        throw businessConflict('OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS', '该委外订单终身已创建加工费采购订单，不得重建');
      }
      const supplier = db.prepare(`SELECT * FROM suppliers WHERE id=? AND active=1 AND outsourcing_enabled=1`).get(order.supplier_id);
      const today = new Date().toISOString().slice(0, 10);
      // 加工费 PO 的委外供应商资格同样按**订单业务日期**判定（Design §26.35.3）。
      if (!supplier) throw businessConflict('PROCESSING_PO_SUPPLIER_NOT_QUALIFIED', '委外供应商资质无效');
      try {
        assertSupplierQualification(db, order.supplier_id, 'OUTSOURCE', order.business_date);
      } catch (error) {
        throw businessConflict('PROCESSING_PO_SUPPLIER_NOT_QUALIFIED', `委外供应商资质在订单业务日期 ${order.business_date} 无效`);
      }
      // PRC-02：普通类供应商不得承接委外加工费采购订单。
      assertSupplierCategoryAllows(db, { supplierId: order.supplier_id, businessType: 'OUTSOURCE_PROCESSING' });
      // OUT-02：加工费 PO 同样消费有效 OUTSOURCE 货源（同一参数、同一判定）。
      assertSourceControl(db, {
        supplierId: order.supplier_id, productId: order.product_id,
        businessDate: order.business_date, sourceType: 'OUTSOURCE',
      });
      const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(order.product_id);
      if (!product) throw businessConflict('PROCESSING_PO_PRODUCT_INVALID', '委外成品不存在或已停用');
      const quantity = Number(order.order_quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new HttpError(400, '委外数量或加工费金额无法精确表示');
      }
      const unitCode = String(product.base_uom_code || product.unit || order.unit || 'EA').toUpperCase();
      const quantityNum = Number.isSafeInteger(quantity) ? quantity : null;
      if (quantityNum === null) throw businessConflict('PROCESSING_PO_QUANTITY_UNSUPPORTED', '首期加工费采购订单仅支持整数基础数量');
      // OUT-03：加工费价格来源的权威解析（委外价格表条目 → 委外合同冻结）。
      // 价格表条目存在时客户端单价只作断言；否则冻结为委外合同来源，
      // `price_entry_id` 保持 NULL。普通 PURCHASE 价格表不参与。
      const price = resolveOutsourcingProcessingPrice(db, {
        order, supplier, product, quantity,
        assertedUnitPriceCents: unitPriceCents,
        businessDate: body.orderDate || today,
        documentUomCode: unitCode,
      });
      const amountCents = price.amountCents;
      result = createPurchaseOrderDraftCanonical(db, actor, {
        supplierId: order.supplier_id, totalCents: amountCents, businessType: 'OUTSOURCE_PROCESSING',
        sourceOutsourcingOrderId: order.id, orderDate: body.orderDate || today,
        expectedDeliveryDate: body.expectedDeliveryDate || order.expected_completion_date || null,
        // PRC-02：付款天数在客户端未指定时由供应商采购档案默认值驱动；此处
        // 交给 canonical 采购订单写者解析（同一份实现），不在委外域重复规则。
        paymentTerms: body.paymentTerms || '', paymentTermsDays: body.paymentTermsDays ?? null,
        supplierContactName: body.supplierContactName || supplier.contact || '',
        supplierContactPhone: body.supplierContactPhone || supplier.phone || '', supplierAddress: body.supplierAddress || supplier.address || '',
        supplierContactSnapshot: `${body.supplierContactName || supplier.contact || ''}|${body.supplierContactPhone || supplier.phone || ''}`,
        supplierAddressSnapshot: body.supplierAddress || supplier.address || '', paymentTermsSnapshot: body.paymentTerms || '',
        remark: body.remark || '', auditDetail: `由委外订单 ${order.order_no} 创建加工费采购订单草稿`,
        items: [{ productId: order.product_id, quantity, unitPriceCents: price.unitPriceCents, amountCents, lineNo: 1,
          pricingUomCode: price.pricingUomCode, priceEntryId: price.priceEntryId, priceVersion: price.priceVersion,
          pricingEvidence: price.pricingEvidence,
          documentUomCode: unitCode, documentQuantityNumerator: quantityNum, documentQuantityDenominator: 1,
          conversionNumerator: 1, conversionDenominator: 1, baseQuantityNumerator: quantityNum, baseQuantityDenominator: 1 }],
      });
      // 反例守卫：冻结后立即证明本行价格来源确实是 OUTSOURCE，
      // 没有被普通 PURCHASE 价格表静默替换。
      assertProcessingPoPriceSource(db, result.id);
      saveIdempotency(db, operation, orderId, idempotencyKey, fingerprint, result);
    });
  } catch (error) {
    if (/source_outsourcing_order_id|uq_purchase_orders_source_outsourcing/i.test(String(error.message))) {
      error = businessConflict('OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS', '该委外订单终身已创建加工费采购订单，不得重建');
    }
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '创建加工费采购订单', error);
    throw error;
  }
  return send(res, 201, result);
}

export async function snapshotMaterialList(db, req, res, actor, orderId) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['items']);
  const bindings = Array.isArray(body.items) ? body.items : [];
  const now = new Date().toISOString();
  let snapshotCount = 0;
  try {
    transaction(db, () => {
      // 事务内重读订单：状态、BOM 绑定与业务日期都以权威重读为准
      // （Design §26.35.3；Requirement §31.15 `OUT-WB-REQ-02/06`）。
      const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
      if (!order) throw new HttpError(404, '委外订单不存在');
      if (order.status !== 'DRAFT') {
        throw businessConflict('OUTSOURCING_MATERIAL_SNAPSHOT_STATE_INVALID', '只有草稿状态的委外订单可以建立用料快照');
      }
      if (db.prepare('SELECT 1 FROM outsourcing_material_list WHERE order_id=? LIMIT 1').get(orderId)) {
        throw businessConflict('OUTSOURCING_MATERIAL_SNAPSHOT_IMMUTABLE', '委外用料快照已建立，不得随 BOM 变化重写');
      }
      if (!order.bom_id) throw businessConflict('OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED', '委外订单未绑定已批准 OUTSOURCE BOM');
      const bom = resolveOutsourcingBasisBom(db, order.product_id, order.business_date, order.bom_id);
      if (!bom || (order.bom_version != null && Number(order.bom_version) !== Number(bom.version))) {
        throw businessConflict('OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED', '委外 BOM 未批准、未生效、用途不符或版本不一致');
      }
      const bomItems = db.prepare('SELECT * FROM bom_items WHERE bom_id=? ORDER BY line_no,id').all(bom.id);
      if (!bomItems.length) throw businessConflict('OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED', '委外 BOM 没有有效用料行');
      const bindingByProduct = new Map(bindings.map((item) => [item.productId, item]));
      for (const item of bomItems) {
        if (Number(item.scrap_rate || 0) !== 0
          || Number(item.conversion_numerator || 1) !== 1
          || Number(item.conversion_denominator || 1) !== 1) {
          throw businessConflict('OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED', '首期不支持 BOM 损耗或单位换算');
        }
        const product = db.prepare('SELECT base_uom_code,unit FROM products WHERE id=? AND active=1').get(item.product_id);
        const unit = String(item.uom_code_snapshot || product?.base_uom_code || product?.unit || 'EA').toUpperCase();
        const base = String(product?.base_uom_code || product?.unit || 'EA').toUpperCase();
        if (!product || unit !== base) throw businessConflict('OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED', 'BOM 用料单位与产品基础单位不一致');
        const binding = bindingByProduct.get(item.product_id);
        if (!binding?.sourceWarehouseId) throw businessConflict('OUTSOURCING_WIP_SOURCE_WAREHOUSE_UNPROVEN', `物料 ${item.product_id} 缺少来源仓绑定`);
        if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(binding.sourceWarehouseId)) {
          throw businessConflict('OUTSOURCING_WIP_WAREHOUSE_MISSING', `物料 ${item.product_id} 来源仓不存在或已停用`);
        }
      }
      const stmt = db.prepare(`INSERT INTO outsourcing_material_list(
        id,order_id,product_id,required_quantity,unit,bom_snapshot_json,source_warehouse_id,legacy_unverified_wip_quantity,identity_evidence_state,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,0,'NONE',?,?)`);
      bomItems.forEach((item) => {
        const product = db.prepare('SELECT base_uom_code,unit FROM products WHERE id=?').get(item.product_id);
        const unit = String(item.uom_code_snapshot || product.base_uom_code || product.unit || 'EA').toUpperCase();
        const perUnitQuantity = Number(item.quantity);
        const requiredQuantity = perUnitQuantity * Number(order.order_quantity);
        stmt.run(randomUUID(), orderId, item.product_id, requiredQuantity, unit,
          JSON.stringify({ bomId: bom.id, bomVersion: bom.version, bomItemId: item.id, per_unit_quantity: perUnitQuantity, required_quantity: requiredQuantity }),
          bindingByProduct.get(item.product_id).sourceWarehouseId, now, now);
      });
      snapshotCount = bomItems.length;
      audit(db, actor.id, 'SNAPSHOT', 'OUTSOURCING_MATERIAL_LIST', orderId, `OUTSOURCE BOM ${bom.id} 快照 ${bomItems.length} 行`);
    });
  } catch (error) {
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '建立委外用料快照', error);
    throw error;
  }
  return send(res, 200, { ok: true, count: snapshotCount });
}

// 委外材料动作的规范化 fingerprint：可选身份字段缺省与 null 等价，
// 键序固定，避免等价请求被误判为"同键异内容"。
function normalizeMaterialFingerprint(body) {
  const identity = (value) => (value === undefined || value === null ? '' : String(value).trim());
  return {
    materialListId: String(body.materialListId || ''),
    quantity: Number(body.quantity),
    lotId: identity(body.lotId),
    serialId: identity(body.serialId),
  };
}

// 历史物料行的 `legacy_unverified_wip_quantity` 为 NULL 表示"历史不可验证"
// （Active Design §10）；这类行不得被新的负向动作（退料/倒冲）消费。
function assertWipHistoryProvable(material) {
  if (material.legacy_unverified_wip_quantity === null || material.legacy_unverified_wip_quantity === undefined) {
    throw businessConflict('OUTSOURCING_WIP_HISTORY_UNPROVEN', '该委外物料行的历史 WIP 不可证明，不得被新的转出或倒冲消费');
  }
}

export async function issueMaterial(db, req, res, actor, orderId) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['materialListId', 'quantity', 'issuedDate', 'idempotencyKey', 'lotId', 'serialId']);
  const qty = Number(body.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, '数量必须大于 0');
  if (!body.idempotencyKey) throw new HttpError(400, 'idempotencyKey 必填');
  const operation = 'OUTSOURCING_ISSUE';
  const fingerprint = requestFingerprint(normalizeMaterialFingerprint(body));
  let replay;
  try {
    replay = idempotencyReplay(db, operation, orderId, body.idempotencyKey, fingerprint);
  } catch (error) {
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '委外发料', error);
    throw error;
  }
  if (replay) return send(res, 200, { ...replay, replayed: true });
  const id = randomUUID(); const now = new Date().toISOString(); const businessDate = body.issuedDate || now.slice(0, 10);
  try {
    transaction(db, () => {
      const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
      if (!order) throw new HttpError(404, '委外订单不存在');
      if (!['RELEASED'].includes(order.status)) throw businessConflict('OUTSOURCING_ORDER_STATE_INVALID', '只有下达状态可发料');
      const material = db.prepare('SELECT * FROM outsourcing_material_list WHERE id=? AND order_id=?').get(body.materialListId, orderId);
      if (!material) throw new HttpError(404, '物料清单行不存在');
      const movement = executeOutsourcingMove(db, { actor, order, material, sourceType: 'OUTSOURCING_ISSUE', eventType: 'ISSUE', eventId: id, quantity: qty, businessDate, identityInput: body, direction: 'SUPPLY' });
      db.prepare(`INSERT INTO outsourcing_issues(id,order_id,material_list_id,quantity,issued_date,from_warehouse_id,to_warehouse_id,business_status,idempotency_key,creator_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'CONFIRMED',?,?,?,?)`).run(id, orderId, body.materialListId, qty, businessDate, movement.fromWarehouseId, movement.toWarehouseId, body.idempotencyKey, actor.id, now, now);
      db.prepare("UPDATE outsourcing_material_list SET issued_quantity=issued_quantity+?,identity_evidence_state='VERIFIED',updated_at=? WHERE id=?").run(qty, now, body.materialListId);
      audit(db, actor.id, 'ISSUE', 'OUTSOURCING_ISSUE', id, `${orderId}:${body.materialListId}:${qty}`);
      saveIdempotency(db, operation, orderId, body.idempotencyKey, fingerprint, { id });
    });
  } catch (error) {
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '委外发料', error);
    throw error;
  }
  return send(res, 201, { id });
}

export async function supplementMaterial(db, req, res, actor, orderId) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['materialListId', 'quantity', 'reason', 'supplementDate', 'idempotencyKey', 'lotId', 'serialId']);
  const qty = Number(body.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, '数量必须大于 0');
  if (!body.idempotencyKey) throw new HttpError(400, 'idempotencyKey 必填');
  const operation = 'OUTSOURCING_SUPPLEMENT';
  const fingerprint = requestFingerprint(normalizeMaterialFingerprint(body));
  let replay;
  try {
    replay = idempotencyReplay(db, operation, orderId, body.idempotencyKey, fingerprint);
  } catch (error) {
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '委外补料', error);
    throw error;
  }
  if (replay) return send(res, 200, { ...replay, replayed: true });
  const id = randomUUID(); const now = new Date().toISOString(); const businessDate = body.supplementDate || now.slice(0, 10);
  try { transaction(db, () => {
    const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
    if (!order) throw new HttpError(404, '委外订单不存在');
    if (!['RELEASED'].includes(order.status)) throw businessConflict('OUTSOURCING_ORDER_STATE_INVALID', '只有下达状态可补料');
    const material = db.prepare('SELECT * FROM outsourcing_material_list WHERE id=? AND order_id=?').get(body.materialListId, orderId);
    if (!material) throw new HttpError(404, '物料清单行不存在');
    const movement = executeOutsourcingMove(db, { actor, order, material, sourceType: 'OUTSOURCING_SUPPLEMENT', eventType: 'SUPPLEMENT', eventId: id, quantity: qty, businessDate, identityInput: body, direction: 'SUPPLY' });
    db.prepare(`INSERT INTO outsourcing_supplements(id,order_id,material_list_id,quantity,reason,supplement_date,business_status,creator_id,created_at)
      VALUES(?,?,?,?,?,?,'CONFIRMED',?,?)`).run(id, orderId, body.materialListId, qty, body.reason || '', businessDate, actor.id, now);
    db.prepare("UPDATE outsourcing_material_list SET supplemented_quantity=supplemented_quantity+?,identity_evidence_state='VERIFIED',updated_at=? WHERE id=?").run(qty, now, body.materialListId);
    audit(db, actor.id, 'SUPPLEMENT', 'OUTSOURCING_SUPPLEMENT', id, body.reason || '');
    saveIdempotency(db, operation, orderId, body.idempotencyKey, fingerprint, { id });
  }); } catch (error) { auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '委外补料', error); throw error; }
  return send(res, 201, { id });
}

export async function returnMaterial(db, req, res, actor, orderId) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['materialListId', 'quantity', 'returnDate', 'idempotencyKey', 'lotId', 'serialId']);
  const qty = Number(body.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, '数量必须大于 0');
  if (!body.idempotencyKey) throw new HttpError(400, 'idempotencyKey 必填');
  const operation = 'OUTSOURCING_RETURN';
  const fingerprint = requestFingerprint(normalizeMaterialFingerprint(body));
  let replay;
  try {
    replay = idempotencyReplay(db, operation, orderId, body.idempotencyKey, fingerprint);
  } catch (error) {
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '委外退料', error);
    throw error;
  }
  if (replay) return send(res, 200, { ...replay, replayed: true });
  const id = randomUUID(); const now = new Date().toISOString(); const businessDate = body.returnDate || now.slice(0, 10);
  try { transaction(db, () => {
    const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
    if (!order) throw new HttpError(404, '委外订单不存在');
    // 材料终态约束（Requirement §31.15 `OUT-WB-REQ-07`）：退料只允许已下达或已完工，
    // 用于清零真实未耗用 WIP 以便关闭；关闭后一律拒绝。
    if (!['RELEASED', 'COMPLETED'].includes(order.status)) {
      throw businessConflict('OUTSOURCING_ORDER_STATE_INVALID', '只有已下达或已完工状态的委外订单可以退料');
    }
    const material = db.prepare('SELECT * FROM outsourcing_material_list WHERE id=? AND order_id=?').get(body.materialListId, orderId);
    if (!material) throw new HttpError(404, '物料清单行不存在');
    assertWipHistoryProvable(material);
    const wipRemaining = Number(material.issued_quantity) + Number(material.supplemented_quantity)
      - Number(material.returned_quantity) - Number(material.backflushed_quantity);
    if (qty > wipRemaining + 1e-9) throw businessConflict('OUTSOURCING_WIP_INSUFFICIENT', '退料数量超过供应商 WIP 剩余');
    const movement = executeOutsourcingMove(db, { actor, order, material, sourceType: 'OUTSOURCING_RETURN', eventType: 'RETURN', eventId: id, quantity: qty, businessDate, identityInput: body, direction: 'CONSUME' });
    db.prepare(`INSERT INTO outsourcing_returns(id,order_id,material_list_id,quantity,from_warehouse_id,to_warehouse_id,return_date,business_status,creator_id,created_at)
      VALUES(?,?,?,?,?,?,?,'CONFIRMED',?,?)`).run(id, orderId, body.materialListId, qty, movement.fromWarehouseId, movement.toWarehouseId, businessDate, actor.id, now);
    db.prepare('UPDATE outsourcing_material_list SET returned_quantity=returned_quantity+?, updated_at=? WHERE id=?').run(qty, now, body.materialListId);
    audit(db, actor.id, 'RETURN', 'OUTSOURCING_RETURN', id, `${orderId}:${body.materialListId}:${qty}`);
    saveIdempotency(db, operation, orderId, body.idempotencyKey, fingerprint, { id });
  }); } catch (error) { auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '委外退料', error); throw error; }
  return send(res, 201, { id });
}

/**
 * Per-material cumulative backflush. Backflush target for each material list row:
 *   target_cumulative_i = required_i × cumulative_confirmed_finished_receipt_qty / order_quantity
 *   incremental_i = target_cumulative_i - already_backflushed_i
 * Guards: incremental_i >= 0 AND incremental_i <= (net_supplied_i - already_backflushed_i)
 * Materials of different UOM/scale must NEVER be aggregated.
 */
export async function backflushMaterial(db, req, res, actor, orderId) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['receiptId', 'identities', 'idempotencyKey']);
  if (!body.idempotencyKey) throw new HttpError(400, 'idempotencyKey 必填');
  const operation = 'OUTSOURCING_BACKFLUSH';
  const fingerprint = requestFingerprint(body);
  const replay = idempotencyReplay(db, operation, orderId, body.idempotencyKey, fingerprint);
  if (replay) return send(res, 200, { ...replay, replayed: true });
  const identities = new Map((Array.isArray(body.identities) ? body.identities : []).map((item) => [item.materialListId, item]));
  const now = new Date().toISOString();
  const results = [];
  let cumulativeFinished = 0;
  try { transaction(db, () => {
    const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
    if (!order) throw new HttpError(404, '委外订单不存在');
    // 倒冲与退料同属材料终态约束：已关闭订单不得再改变材料事实。
    if (!['RELEASED', 'COMPLETED'].includes(order.status)) {
      throw businessConflict('OUTSOURCING_ORDER_STATE_INVALID', '只有已下达或已完工状态的委外订单可以执行倒冲复核');
    }
    const lockedReceipt = db.prepare('SELECT * FROM outsourcing_receipts WHERE id=? AND order_id=?').get(body.receiptId, orderId);
    if (!lockedReceipt || lockedReceipt.business_status !== 'EFFECTED') throw businessConflict('OUTSOURCING_RECEIPT_NOT_EFFECTED', '仅已生效收货可执行倒冲复核');
    cumulativeFinished = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM outsourcing_receipts WHERE order_id=? AND business_status='EFFECTED'").get(orderId).q);
    const materials = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=? ORDER BY id').all(orderId);
    for (const m of materials) {
      assertWipHistoryProvable(m);
      // 增量倒冲基数必须与收货生效路径同口径：每单位用量 × 累计合格收货量。
      const snapshot = JSON.parse(m.bom_snapshot_json || '{}');
      if (!Number.isFinite(Number(snapshot.per_unit_quantity)) || !Number.isFinite(Number(snapshot.required_quantity))
        || Math.abs(Number(snapshot.required_quantity) - Number(m.required_quantity)) > 1e-9) {
        throw businessConflict('OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED', '委外用料快照缺少已批准的每单位/总量基数');
      }
      const targetCumulative = Number(snapshot.per_unit_quantity) * cumulativeFinished;
      const incremental = targetCumulative - Number(m.backflushed_quantity);
      const netSupplied = Number(m.issued_quantity) + Number(m.supplemented_quantity) - Number(m.returned_quantity);
      const remaining = netSupplied - Number(m.backflushed_quantity);
      if (incremental < 0) {
        throw businessConflict('OUTSOURCING_WIP_INSUFFICIENT', `行 ${m.id} 增量倒冲数量小于 0`);
      }
      if (incremental > remaining + 1e-9) {
        throw businessConflict('OUTSOURCING_WIP_INSUFFICIENT', `行 ${m.id} 净供应不足`);
      }
      if (incremental <= 0) {
        results.push({ materialListId: m.id, incremental: 0 });
        continue;
      }
      const execution = executeOutsourcingBackflush(db, { actor, order, material: m, receipt: lockedReceipt, quantity: incremental, businessDate: lockedReceipt.business_date || lockedReceipt.received_date || now.slice(0, 10), identityInput: identities.get(m.id) || {} });
      db.prepare('UPDATE outsourcing_material_list SET backflushed_quantity=backflushed_quantity+?, updated_at=? WHERE id=?').run(incremental, now, m.id);
      audit(db, actor.id, 'BACKFLUSH', 'OUTSOURCING_BACKFLUSH', m.id, `+${incremental}`);
      results.push({ materialListId: m.id, incremental, carryingValueCents: execution.valuation.issuedValueCents });
    }
    saveIdempotency(db, operation, orderId, body.idempotencyKey, fingerprint, { ok: true, cumulativeFinished, results });
  }); } catch (error) { auditRejectedBusinessRule(db, actor, 'OUTSOURCING_RECEIPT', body.receiptId, '委外倒冲', error); throw error; }
  return send(res, 200, { ok: true, cumulativeFinished, results });
}

export async function createOutsourcingReceipt(db, req, res, actor) {
  assertReceivingPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['orderId', 'quantity', 'receivedDate', 'businessDate', 'processingFeeCents', 'processingPoId', 'sourceNoticeId', 'warehouseId', 'items', 'remark']);
  if (!Array.isArray(body.items) || !body.items.length) {
    throw new HttpError(400, '委外收货明细不能为空', { code: 'OUTSOURCING_RECEIPT_ITEMS_REQUIRED' });
  }
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
  if (!idempotencyKey) throw new HttpError(400, 'Idempotency-Key 必填');
  const operation = 'OUTSOURCING_RECEIPT_CREATE';
  const documentId = `create-request:${idempotencyKey}`;
  const fingerprint = requestFingerprint(body);
  const replay = idempotencyReplay(db, operation, documentId, idempotencyKey, fingerprint);
  if (replay) return send(res, 200, { ...replay, replayed: true });
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(body.orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  if (!['RELEASED'].includes(order.status)) throw new HttpError(409, '只有下达状态可收货');
  // OUT-23：委外收货登记的是**加工费金额基准**（收货生效时确认，§26.20
  // C-P01），它是 AP 侧敞口的起点。因此它必须受既有 AP 业务关闭门禁约束：
  // 复用 `assertFinanceBusinessDateOpen('AP', ...)`（canonical 单一实现），
  // 不新建第二套关闭规则，也不新增 close_type。
  assertFinanceBusinessDateOpen(db, 'AP', body.businessDate || body.receivedDate || new Date().toISOString().slice(0, 10));
  const quantity = Number(body.quantity);
  const itemQuantity = body.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  if (!Number.isFinite(quantity) || quantity <= 0 || body.items.some((item) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
    throw new HttpError(400, '委外收货数量必须大于 0');
  }
  if (Math.abs(quantity - itemQuantity) > 1e-9) throw new HttpError(400, '收货表头数量必须等于明细数量之和');
  if (!body.processingPoId || !body.sourceNoticeId || !body.warehouseId) throw new HttpError(400, '委外收货必须提供加工费 PO、完工通知和目标仓库');
  const processingFeeCents = outsourcingAmountCents(body.processingFeeCents, '加工费金额');
  const itemUnitPriceCents = body.items.map((item, index) => outsourcingAmountCents(item.unitPriceCents, `第 ${index + 1} 行单价`));
  const id = randomUUID(); const now = new Date().toISOString();
  const receiptNo = 'OS-RCPT-' + Date.now().toString().slice(-10);
  try { transaction(db, () => {
    const lockedOrder = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(body.orderId);
    if (!lockedOrder || lockedOrder.status !== 'RELEASED') throw businessConflict('OUTSOURCING_RECEIPT_SOURCE_MISMATCH', '委外订单状态已变化');
    const processingPo = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.processingPoId);
    const processingPoItems = processingPo ? db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY line_no').all(processingPo.id) : [];
    if (!processingPo || processingPo.status !== 'APPROVED' || processingPo.business_type !== 'OUTSOURCE_PROCESSING'
      || processingPo.source_outsourcing_order_id !== lockedOrder.id || processingPo.supplier_id !== lockedOrder.supplier_id
      || processingPoItems.length !== 1) {
      throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', '加工费 PO 与委外订单来源不匹配');
    }
    const notice = db.prepare('SELECT * FROM receipt_notices WHERE id=?').get(body.sourceNoticeId);
    if (!notice || notice.business_type !== 'OUTSOURCE' || notice.outsourcing_order_id !== lockedOrder.id
      || notice.processing_po_id !== processingPo.id || notice.supplier_id !== lockedOrder.supplier_id
      || notice.warehouse_id !== body.warehouseId || notice.status !== 'CONFIRMED') {
      throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', '委外完工通知与订单/加工费 PO/仓库不匹配');
    }
    if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(body.warehouseId)) throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', '目标仓库不存在或已停用');
    const existingQuantity = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM outsourcing_receipts WHERE order_id=? AND business_status<>'CANCELLED'").get(lockedOrder.id).q);
    if (existingQuantity + quantity > Number(lockedOrder.order_quantity) + 1e-9) throw businessConflict('RECEIPT_NOTICE_CAPACITY_EXCEEDED', '委外累计收货数量超过订单容量');
    // 通知行剩余容量（M1C-WP2–WP6-R1 / P0-01）：同一完工通知行的历史有效收货
    // 占用量 + 本次拟收货量必须 <= 通知行数量。权威口径在事务内重读。
    const noticeLine = outsourcingNoticeLineUsage(db, lockedOrder.id);
    if (noticeLine.unprovable) {
      throw businessConflict('RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN', '委外收货历史来源不可证明，无法证明完工通知行剩余容量');
    }
    db.prepare(`INSERT INTO outsourcing_receipts(
      id,receipt_no,order_id,processing_po_id,quantity,received_date,supplier_id,business_status,
      processing_fee_cents,total_cost_cents,creator_id,created_at,updated_at,warehouse_id,source_notice_id,business_date,version
    ) VALUES(?,?,?,?,?,?,?,'PENDING_INSPECTION',?,?,?,?,?,?,?,?,0)`).run(
      id, receiptNo, lockedOrder.id, processingPo.id, quantity, body.receivedDate || now.slice(0, 10), lockedOrder.supplier_id,
      processingFeeCents, processingFeeCents, actor.id, now, now,
      body.warehouseId, notice.id, body.businessDate || body.receivedDate || now.slice(0, 10),
    );
    const insertItem = db.prepare(`INSERT INTO outsourcing_receipt_items(
      id,receipt_id,product_id,quantity,unit_price_cents,line_no,lot_id,serial_id,unit_code,processing_po_item_id,source_notice_item_source_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    const seenNoticeItems = new Set();
    body.items.forEach((item, index) => {
      assertAllowedFields(item, ['productId', 'quantity', 'unitCode', 'unitPriceCents', 'processingPoItemId', 'sourceNoticeItemId', 'lotId', 'serialId']);
      const poItem = db.prepare('SELECT * FROM purchase_order_items WHERE id=? AND order_id=?').get(item.processingPoItemId, processingPo.id);
      const noticeItem = db.prepare('SELECT * FROM receipt_notice_items WHERE id=? AND notice_id=?').get(item.sourceNoticeItemId, notice.id);
      const product = db.prepare('SELECT tracking_policy,base_uom_code,unit FROM products WHERE id=? AND active=1').get(item.productId);
      const unitCode = String(item.unitCode || product?.base_uom_code || product?.unit || 'EA').toUpperCase();
      const baseUnit = String(product?.base_uom_code || product?.unit || 'EA').toUpperCase();
      if (!poItem || !noticeItem || !product || poItem.product_id !== item.productId || noticeItem.product_id !== item.productId
        || noticeItem.purchase_order_item_id !== poItem.id || item.productId !== lockedOrder.product_id
        || unitCode !== baseUnit || (poItem.document_uom_code && unitCode !== String(poItem.document_uom_code).toUpperCase())
        || seenNoticeItems.has(noticeItem.id)) {
        throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', `第 ${index + 1} 行来源、产品或单位不匹配`);
      }
      // 通知行剩余容量按真实通知行 ID 逐行累计：历史占用 + 本次拟收货 <= 通知行数量。
      const noticeLineQuantity = Number(noticeItem.quantity);
      const noticeLineUsed = Number(noticeLine.usage.get(noticeItem.id) || 0);
      const requestedQuantity = Number(item.quantity);
      if (noticeLineUsed + requestedQuantity > noticeLineQuantity + 1e-9) {
        throw businessConflict('RECEIPT_NOTICE_CAPACITY_EXCEEDED',
          `第 ${index + 1} 行超过完工通知行剩余容量：通知行 ${noticeLineQuantity}、已占用 ${noticeLineUsed}、本次 ${requestedQuantity}`);
      }
      noticeLine.usage.set(noticeItem.id, noticeLineUsed + requestedQuantity);
      if (product.tracking_policy === 'LOT' && (!item.lotId || item.serialId)) throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', 'LOT 成品必须提供批次身份');
      if (product.tracking_policy === 'SERIAL' && (!item.serialId || item.lotId || Number(item.quantity) !== 1)) throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', 'SERIAL 成品必须逐行提供唯一序列号');
      if (product.tracking_policy === 'NONE' && (item.lotId || item.serialId)) throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', '非跟踪成品不得携带 LOT/SERIAL');
      seenNoticeItems.add(noticeItem.id);
      insertItem.run(randomUUID(), id, item.productId, Number(item.quantity), itemUnitPriceCents[index], index + 1,
        item.lotId || null, item.serialId || null, unitCode, poItem.id, noticeItem.id);
    });
    audit(db, actor.id, 'CREATE', 'OUTSOURCING_RECEIPT', id, `${receiptNo} 待检，${body.items.length} 行`);
    saveIdempotency(db, operation, documentId, idempotencyKey, fingerprint, { id, receiptNo });
  }); } catch (error) { auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', body.orderId, '创建委外收货', error); throw error; }
  return send(res, 201, { id, receiptNo });
}

export function getMaterialPosition(db, res, actor, orderId) {
  assertViewPermission(actor);
  const materials = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=?').all(orderId).map(rowToMaterialList);
  return send(res, 200, { materials });
}

/**
 * 委外业务侧的选项读模型（Requirement §31.15 `OUT-WB-REQ-02`）。
 * 只读既有权威主数据；保存时 Writer 仍按业务日期、资格、BOM 版本与来源重新校验。
 */
export function getOutsourcingOptions(db, res, actor, url) {
  assertViewPermission(actor);
  const result = listOutsourcingOptions(db, {
    kind: url.searchParams.get('kind'),
    query: url.searchParams.get('q'),
    businessDate: url.searchParams.get('businessDate'),
    productId: url.searchParams.get('productId'),
    limit: url.searchParams.get('limit'),
  });
  return send(res, 200, result);
}

/**
 * 委外收货员任务队列（Requirement §31.15 `OUT-WB-REQ-04`）。
 * 只有 `OUTSOURCING_RECEIVING_MANAGE` 可读；返回白名单投影，
 * 不含材料成本、Supplier WIP 身份或订单的其他敏感字段。
 */
export function getOutsourcingReceivingQueue(db, res, actor, url) {
  assertReceivingPermission(actor);
  const result = listOutsourcingReceivingQueue(db, {
    limit: url.searchParams.get('limit'),
    offset: url.searchParams.get('offset'),
  });
  return send(res, 200, result);
}

/**
 * 单个委外订单的收货上下文（同一受限岗位）。
 * 与宽的 `getOutsourcingOrder()` 分离：受限岗位不得调用宽订单详情。
 */
export function getOutsourcingReceivingContext(db, res, actor, orderId) {
  assertReceivingPermission(actor);
  const context = readOutsourcingReceivingContext(db, orderId);
  if (!context) throw new HttpError(404, '委外订单不存在');
  return send(res, 200, { receivingContext: context });
}

/**
 * 收货上下文的深链接入口：可按订单、完工通知或委外收货定位同一投影，
 * 使 URL 成为业务身份的唯一来源（Design §26.35.2）。
 */
export function resolveOutsourcingReceivingContext(db, res, actor, url) {
  assertReceivingPermission(actor);
  const orderId = resolveOutsourcingOrderId(db, {
    orderId: url.searchParams.get('orderId'),
    noticeId: url.searchParams.get('noticeId'),
    receiptId: url.searchParams.get('receiptId'),
  });
  if (!orderId) throw new HttpError(404, '委外收货上下文不存在');
  const context = readOutsourcingReceivingContext(db, orderId);
  if (!context) throw new HttpError(404, '委外订单不存在');
  return send(res, 200, { receivingContext: context });
}

/**
 * 委外收货的检验上下文（IQC 岗位只读，Requirement §31.15 `OUT-WB-REQ-05`）。
 * 质量门禁状态由 canonical `deriveQualityState` 给出，委外工作面不得伪造结论。
 */
export function getOutsourcingReceiptQualityContext(db, res, actor, receiptId) {
  assertQualityViewPermission(actor);
  const context = readOutsourcingReceiptQualityContext(db, receiptId);
  if (!context) throw new HttpError(404, '委外收货不存在');
  const qualityState = deriveQualityState(db, 'IQC', receiptId, 'OUTSOURCING_RECEIPT');
  return send(res, 200, { qualityContext: { ...context, qualityState } });
}

// ---------------------------------------------------------------------------
// OUT-23 期初委外订单 / 期初委外 WIP
// ---------------------------------------------------------------------------
//
// Requirement §31.3.3 OUT-23 要求覆盖「opening outsourcing order」与
// 「opening outsourcing WIP」。本节是它们的**唯一** canonical 实现。
//
// **期初单据是什么**：一张已经存在于上线日之前、尚未在本系统内走完
// 生命周期的委外订单，以及它在供应商 WIP **位置**上的材料结余。
//
// **期初单据不是什么**（Active Design §26.20：`opening records 标记 OPENING，
// 不得虚构历史 voucher`）：
//   - 不生成历史会计凭证；
//   - 不生成历史应付 / 应收；
//   - 不伪造业务单据（发料 / 补料 / 退料 / 倒冲）流水；
//   - 不推定历史 BOM 快照（期初单据的 `bom_snapshot_json` 明确标记为
//     `OPENING`，表示「无已批准 BOM 依据」，不得被当作已批准快照使用）。
//
// **数量口径**：数量用有理数（分子 / 分母），比较与折算一律走
// `roundRational`（HALF_UP）。金额一律安全整数分。
//
// **身份口径**：期初 WIP 的 LOT / SERIAL 身份必须可证明：
//   - LOT 物料必须给出已存在的批次 ID；
//   - SERIAL 物料必须给出已存在的序列号 ID，且每行数量为 1；
//   - 非跟踪物料不得携带 LOT / SERIAL。
//   身份解析复用 `resolveOutsourcingIdentity`（§26.34.15.2 的唯一身份口径）。
//
// **WIP 余额**：期初结余写入**同一本** `outsourcing_wip_identity_balances`
// 身份账（`event_type='OPENING'` 的 SUPPLY 事实），因此既有供应商 WIP
// 余额读模型**不需要第二套 SQL**。
//
// **物理库存**：期初 WIP 的物料确实在供应商 WIP 仓，因此期初建账必须
// 在该仓建立**物理库存事实**（`OPENING_INVENTORY` 来源），否则库存账与
// WIP 身份账互相矛盾，期间关闭读模型会看见无法解释的差额。
// 该物理事实**不带估值金额**（期初价值口径是会计政策，见报告中的裁定点）。
export const OUTSOURCING_OPENING_CODES = Object.freeze({
  SOURCE_INVALID: 'OUTSOURCING_OPENING_SOURCE_INVALID',
  MATERIAL_REQUIRED: 'OUTSOURCING_OPENING_MATERIAL_REQUIRED',
  IDENTITY_UNPROVEN: 'OUTSOURCING_OPENING_IDENTITY_UNPROVEN',
  QUANTITY_INVALID: 'OUTSOURCING_OPENING_QUANTITY_INVALID',
  WIP_WAREHOUSE_MISSING: 'OUTSOURCING_OPENING_WIP_WAREHOUSE_MISSING',
});

const OPENING_PO_BUSINESS_FIELDS = ['orderNo', 'supplierId', 'productId', 'orderQuantity', 'unit',
  'businessDate', 'remark', 'openingSourceReference', 'items'];

// 期初数量：正有理数。分子/分母均为安全整数，分母 > 0。
function normalizeOpeningQuantity(raw, label) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new HttpError(400, `${label}必须是有限正数`, { code: OUTSOURCING_OPENING_CODES.QUANTITY_INVALID });
  }
  const scaled = value * 1e6;
  if (!Number.isFinite(scaled) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, `${label}超出可表示范围`, { code: OUTSOURCING_OPENING_CODES.QUANTITY_INVALID });
  }
  const normalized = Math.round(scaled) / 1e6;
  if (Math.abs(value - normalized) > 1e-9) {
    throw new HttpError(400, `${label}精度超出允许的小数位`, { code: OUTSOURCING_OPENING_CODES.QUANTITY_INVALID });
  }
  return normalized;
}

/**
 * OUT-23 期初委外订单的 canonical 写入器。
 *
 * 调用方负责权限与 HTTP 语义；本函数在**单一事务**内完成：
 *   1. 权威重读供应商（委外资质 + 供应商 WIP 位置）与成品；
 *   2. 写 `outsourcing_orders`（`is_opening=1`，`status='COMPLETED'`）；
 *   3. 写 `outsourcing_opening_material_lines`（期初物料行头）；
 *   4. 写 `outsourcing_material_list`（期初用料行，WIP 数量为**可证明**值）；
 *   5. 写 WIP 身份账（`event_type='OPENING'` 的 SUPPLY + 身份余额）；
 *   6. 在供应商 WIP 仓建立**物理库存事实**（`OPENING_INVENTORY`）。
 *
 * 失败时整笔回滚：业务零副作用。
 */
export function createOpeningOutsourcingOrderCanonical(db, actor, body) {
  const orderNo = String(body.orderNo || '').trim() || ('OS-OPEN-' + Date.now().toString().slice(-10));
  const supplierId = String(body.supplierId || '').trim();
  const productId = String(body.productId || '').trim();
  if (!supplierId) throw new HttpError(400, '期初委外订单必须指定供应商', { code: OUTSOURCING_OPENING_CODES.SOURCE_INVALID });
  if (!productId) throw new HttpError(400, '期初委外订单必须指定委外成品', { code: OUTSOURCING_OPENING_CODES.SOURCE_INVALID });
  const orderQuantity = normalizeOpeningQuantity(body.orderQuantity, '期初委外数量');
  const businessDate = String(body.businessDate || '').trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new HttpError(400, '期初业务日期格式应为 YYYY-MM-DD', { code: OUTSOURCING_OPENING_CODES.SOURCE_INVALID });
  }
  const items = Array.isArray(body.items) ? body.items : [];
  // 期初物料行是**可选**的：期初单据可以是「只有订单、没有供应商 WIP 结余」
  // 的历史事实（既有合同允许），也可以带物料行承载期初委外 WIP。
  // 带物料行时，每行都必须可证明（物料 / 数量 / 身份 / 位置）。
  if (items.some((item) => item === null || typeof item !== 'object')) {
    throw new HttpError(400, '期初委外物料行格式不正确', { code: OUTSOURCING_OPENING_CODES.MATERIAL_REQUIRED });
  }

  const orderId = randomUUID();
  const now = new Date().toISOString();
  const created = { id: orderId, orderNo, materialLines: [] };

  transaction(db, () => {
    // ── 权威重读：供应商资质与 WIP 位置 ──
    const supplier = db.prepare(`SELECT * FROM suppliers WHERE id=? AND active=1 AND outsourcing_enabled=1`).get(supplierId);
    if (!supplier) {
      throw new HttpError(409, '期初委外订单的供应商不存在、已停用或未开通委外', { code: OUTSOURCING_OPENING_CODES.SOURCE_INVALID });
    }
    try {
      assertSupplierQualification(db, supplierId, 'OUTSOURCE', businessDate);
    } catch (error) {
      throw new HttpError(409, `期初委外订单的供应商在业务日期 ${businessDate} 不具备有效委外资质`, { code: OUTSOURCING_OPENING_CODES.SOURCE_INVALID });
    }
    const wipWarehouseId = supplier.supplier_wip_warehouse_id;
    if (!wipWarehouseId || !db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(wipWarehouseId)) {
      throw new HttpError(409, '期初委外订单的供应商未配置可用的委外 WIP 仓库', { code: OUTSOURCING_OPENING_CODES.WIP_WAREHOUSE_MISSING });
    }
    const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(productId);
    if (!product) {
      throw new HttpError(409, '期初委外订单的委外成品不存在或已停用', { code: OUTSOURCING_OPENING_CODES.SOURCE_INVALID });
    }

    // ── 写期初委外订单头 ──
    const remark = body.remark
      ? `OPENING: ${body.remark}`
      : 'OPENING: 历史期初委外订单，不生成历史凭证';
    db.prepare(`INSERT INTO outsourcing_orders(
        id,order_no,supplier_id,product_id,order_quantity,required_quantity,unit,source_type,planning_handoff_id,status,
        business_date,expected_completion_date,bom_id,bom_version,remark,creator_id,created_at,updated_at,
        is_opening,opening_business_date,opening_source_reference)
      VALUES(?,?,?,?,?,?,?,'MANUAL',NULL,'COMPLETED',?,NULL,NULL,NULL,?,?,?,?,1,?,?)`).run(
      orderId, orderNo, supplierId, productId, orderQuantity, orderQuantity,
      String(body.unit || product.base_uom_code || product.unit || 'EA').toUpperCase(),
      businessDate, remark, actor.id, now, now, businessDate,
      String(body.openingSourceReference || '').trim() || null,
    );

    const insertMaterial = db.prepare(`INSERT INTO outsourcing_material_list(
        id,order_id,product_id,required_quantity,unit,issued_quantity,supplemented_quantity,returned_quantity,
        backflushed_quantity,bom_snapshot_json,source_warehouse_id,legacy_unverified_wip_quantity,
        identity_evidence_state,created_at,updated_at,opening_line_id,is_opening)
      VALUES(?,?,?,?,?,0,0,0,0,?,?,?,'VERIFIED',?,?,?,1)`);
    const insertOpeningLine = db.prepare(`INSERT INTO outsourcing_opening_material_lines(
        id,order_id,product_id,quantity_num,quantity_den,unit,source_warehouse_id,supplier_wip_warehouse_id,
        opening_business_date,identity_type,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);

    for (const [index, item] of items.entries()) {
      assertAllowedFields(item, ['productId', 'quantity', 'sourceWarehouseId', 'lotId', 'serialId', 'unit']);
      const materialProductId = String(item.productId || '').trim();
      if (!materialProductId) {
        throw new HttpError(400, `第 ${index + 1} 行必须指定物料`, { code: OUTSOURCING_OPENING_CODES.MATERIAL_REQUIRED });
      }
      const materialProduct = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(materialProductId);
      if (!materialProduct) {
        throw new HttpError(409, `第 ${index + 1} 行的物料不存在或已停用`, { code: OUTSOURCING_OPENING_CODES.SOURCE_INVALID });
      }
      const quantity = normalizeOpeningQuantity(item.quantity, `第 ${index + 1} 行期初数量`);
      const sourceWarehouseId = String(item.sourceWarehouseId || '').trim() || null;
      if (sourceWarehouseId && !db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(sourceWarehouseId)) {
        throw new HttpError(409, `第 ${index + 1} 行的来源仓不存在或已停用`, { code: OUTSOURCING_OPENING_CODES.SOURCE_INVALID });
      }
      const unit = String(item.unit || materialProduct.base_uom_code || materialProduct.unit || 'EA').toUpperCase();
      const baseUnit = String(materialProduct.base_uom_code || materialProduct.unit || 'EA').toUpperCase();
      if (unit !== baseUnit) {
        throw new HttpError(409, `第 ${index + 1} 行的单位与物料基础单位不一致`, { code: OUTSOURCING_OPENING_CODES.SOURCE_INVALID });
      }

      const lineId = randomUUID();
      const materialListId = randomUUID();
      // 期初 BOM 快照：明确标记为「无已批准 BOM 依据」。它**不是**已批准快照，
      // 因此后续 `CONFIRM_PLAN` / `RELEASE` 的快照证明门禁对期初单据不成立
      // （期初单据已经是 COMPLETED，不再走计划门禁）。
      const snapshot = JSON.stringify({
        opening: true, bomId: null, bomVersion: null, bomItemId: null,
        per_unit_quantity: null, required_quantity: quantity,
        opening_business_date: businessDate,
      });
      insertOpeningLine.run(
        lineId, orderId, materialProductId, Math.round(quantity * 1e6), 1e6, unit,
        sourceWarehouseId, wipWarehouseId, businessDate, 'NONE', now, now,
      );
      insertMaterial.run(
        materialListId, orderId, materialProductId, quantity, unit, snapshot,
        sourceWarehouseId, quantity, now, now, lineId,
      );

      // 身份事实：期初结余必须可证明（复用 canonical 身份解析）。
      const identity = resolveOutsourcingIdentity(db, materialProductId, {
        lotId: item.lotId || null, serialId: item.serialId || null,
      });
      db.prepare(`UPDATE outsourcing_opening_material_lines SET identity_type=? WHERE id=?`)
        .run(identity.identityType, lineId);
      recordOpeningWipSupply(db, {
        material: { id: materialListId },
        identity,
        quantity,
        openingOrderId: orderId,
        openingLineId: lineId,
        businessDate,
        idempotencyKey: `OUTSOURCING_OPENING:${orderId}:${lineId}:${identity.identityKey}`,
      });

      // 物理库存事实：期初材料确实在供应商 WIP 位置。
      // 不带估值金额（期初价值口径属会计政策，见报告裁定点）。
      applyInventoryMutation({
        db,
        actor,
        sourceType: 'OPENING_INVENTORY',
        sourceId: orderId,
        sourceItemId: lineId,
        sourceNo: orderNo,
        movementKind: 'IN',
        quantity,
        businessDate,
        idempotencyKey: `OUTSOURCING_OPENING_INV:${orderId}:${lineId}:${identity.identityKey}`,
        toPosition: {
          productId: materialProductId,
          warehouseId: wipWarehouseId,
          ownerType: 'ENTERPRISE',
          ownerId: null,
          stockStatus: 'AVAILABLE',
          lotId: identity.lotId,
          serialId: identity.serialId,
        },
        trackingMode: 'EXTERNAL',
        valuationMode: 'EXTERNAL',
        remark: `期初委外 WIP ${orderNo}`,
      });

      created.materialLines.push({
        id: lineId, materialListId, productId: materialProductId, quantity,
        identityType: identity.identityType, lotId: identity.lotId, serialId: identity.serialId,
        sourceWarehouseId, supplierWipWarehouseId: wipWarehouseId,
      });
    }

    audit(db, actor.id, 'OPENING', 'OUTSOURCING_ORDER', orderId,
      `期初委外订单 ${orderNo}：${created.materialLines.length} 条物料行`);
  });

  return created;
}

export {
  rowToOrder,
  rowToMaterialList,
};
