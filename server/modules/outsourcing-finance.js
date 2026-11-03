import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit, auditBusinessRejection } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';
import { ensurePayableSource } from './settlement-core.js';
import { assertQualityGate } from './quality-gates.js';
import { assertSupplierBillGlPostable } from './outsourcing-gl-policy.js';
import { executeOutsourcingBackflush, receiveOutsourcingFinishedGoods } from './outsourcing-inventory.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';

// 收货域动作只认收货管理权限：委外业务操作权限不得代行收货职责
// （MC-REQ-10；Active Design §8.1.2 收紧项）。
const RECEIVE_PERMISSIONS = ['OUTSOURCING_RECEIVING_MANAGE'];
const FINANCE_PERMISSIONS = ['SUPPLIER_BILL_MANAGE', 'OUTSOURCING_MANAGE'];
// 材料执行只认材料执行权限；委外业务员同时持有委外业务与材料执行权限
// （Active Design §8.1.2）。
const MATERIAL_PERMISSIONS = ['OUTSOURCING_MATERIAL_EXECUTE'];
// 收货生效只认收货管理权限：委外业务操作权限不得自行使收货生效
// （MC-REQ-10；Active Design §8.1.2 收紧项，M1C-WP0-R1）。
const RECEIVE_EFFECT_PERMISSIONS = ['OUTSOURCING_RECEIVING_MANAGE'];
// 加工费正式过账只认过账权限：委外业务操作权限不得持有加工费正式过账权
// （MC-REQ-10；Active Design §8.1.2）。
const POSTING_PERMISSIONS = ['SUPPLIER_BILL_MANAGE'];

function assertReceivingPermission(actor) { allowAny(actor, RECEIVE_PERMISSIONS); }
function assertReceiveEffectPermission(actor) { allowAny(actor, RECEIVE_EFFECT_PERMISSIONS); }
function assertFinancePermission(actor) { allowAny(actor, FINANCE_PERMISSIONS); }
function assertPostingPermission(actor) { allowAny(actor, POSTING_PERMISSIONS); }
function assertMaterialPermission(actor) { allowAny(actor, MATERIAL_PERMISSIONS); }
function assertScanPermission(actor) { allowAny(actor, ['PROCUREMENT_SCAN_EXECUTE', 'PURCHASE_RECEIPTS_MANAGE']); }

function rejectDeferredWrite(db, actor, entityType, entityId, action, code, message) {
  const error = new HttpError(409, message, { code });
  auditBusinessRejection(db, actor, { entityType, entityId: entityId || null, action }, error);
  throw error;
}

function refreshOutsourcingCostEvidence(db, receiptId, calculatedAt = new Date().toISOString()) {
  const receipt = db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(receiptId);
  if (!receipt) throw new HttpError(404, 'Outsourcing receipt not found');
  const billed = db.prepare(`SELECT
    COALESCE(SUM(sbi.base_quantity_num*1.0/sbi.base_quantity_den),0) billed_quantity,
    COALESCE(SUM(sbi.gross_cents),0) actual_cents
    FROM supplier_bill_items sbi JOIN supplier_bills sb ON sb.id=sbi.bill_id
    WHERE sbi.commercial_source_type='OUTSOURCING_RECEIPT_ITEM'
      AND sbi.commercial_source_id=? AND sb.status='POSTED'`).get(receiptId);
  const returned = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) quantity
    FROM outsourcing_finished_returns WHERE outsourcing_receipt_id=? AND business_status='CONFIRMED'`).get(receiptId).quantity);
  const credits = db.prepare(`SELECT COALESCE(SUM(c.billed_quantity),0) credited_quantity,
    COALESCE(SUM(c.credit_cents),0) credit_cents
    FROM outsourcing_finished_return_credits c
    JOIN outsourcing_finished_returns r ON r.id=c.return_id
    WHERE r.outsourcing_receipt_id=? AND r.business_status='CONFIRMED'`).get(receiptId);
  const netBilledQuantity = Number(billed.billed_quantity) - Number(credits.credited_quantity);
  const netActualCents = Number(billed.actual_cents) - Number(credits.credit_cents);
  const retainedQuantity = Math.max(0, Number(receipt.quantity) - returned);
  const basisStatus = netBilledQuantity + 1e-9 >= retainedQuantity ? 'FINAL' : 'PROVISIONAL';
  const actualCents = Number(billed.billed_quantity) > 0 ? netActualCents : null;
  const varianceCents = actualCents === null ? null : actualCents - Number(receipt.processing_fee_cents);
  db.prepare(`INSERT INTO outsourcing_cost_evidences(
    id,outsourcing_receipt_id,processing_po_id,material_consumed_value_cents,
    processing_fee_provisional_cents,processing_fee_actual_cents,variance_cents,basis_status,calculated_at
  ) VALUES(?,?,?,?,?,?,?,?,?)
  ON CONFLICT(outsourcing_receipt_id) DO UPDATE SET
    processing_po_id=excluded.processing_po_id,
    material_consumed_value_cents=excluded.material_consumed_value_cents,
    processing_fee_provisional_cents=excluded.processing_fee_provisional_cents,
    processing_fee_actual_cents=excluded.processing_fee_actual_cents,
    variance_cents=excluded.variance_cents,
    basis_status=excluded.basis_status,
    calculated_at=excluded.calculated_at`).run(
    randomUUID(), receiptId, receipt.processing_po_id,
    Number(receipt.backflush_material_value_cents), Number(receipt.processing_fee_cents),
    actualCents, varianceCents, basisStatus, calculatedAt,
  );
  return db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receiptId);
}

/**
 * OUT-17 / OUT-19 atomic outsourcing receipt confirm.
 * Inside a single canonical transaction:
 *   1. validate order remaining
 *   2. validate processing PO compatibility (OUTSOURCE_PROCESSING + supplier match)
 *   3. validate quality required = PASS or valid WAIVED
 *   4. atomic backflush (per-material cumulative)
 *   5. capture consumed material carrying value (excluding issued-but-unused / returned / supplier-WIP remaining)
 *   6. recognize finished inventory (raw insert of finished item into finished inventory_position table)
 *   7. record processing fee provisional evidence
 *   8. update outsourcing execution quantity/state
 *   9. audit
 */
export async function confirmOutsourcingReceipt(db, req, res, actor, receiptId) {
  assertReceiveEffectPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['materialIdentities']);
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
  if (!idempotencyKey) throw new HttpError(400, 'Idempotency-Key 必填');
  const operation = 'OUTSOURCING_RECEIPT_CONFIRM';
  const fingerprint = requestFingerprint(body);
  const replay = idempotencyReplay(db, operation, receiptId, idempotencyKey, fingerprint);
  if (replay) return send(res, 200, { ...replay, replayed: true });
  const receipt = db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(receiptId);
  if (!receipt) throw new HttpError(404, '委外收货不存在');
  if (receipt.business_status === 'EFFECTED') throw new HttpError(409, '已生效收货必须使用原 Idempotency-Key 重放');
  if (receipt.business_status !== 'PENDING_INSPECTION') throw new HttpError(409, '只有待检收货可以生效');
  const materialIdentities = new Map((Array.isArray(body.materialIdentities) ? body.materialIdentities : []).map((item) => [item.materialListId, item]));
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(receipt.order_id);
  if (!order) throw new HttpError(404, '委外订单不存在');
  if (order.status !== 'RELEASED') throw new HttpError(409, '只有下达状态可收货');
  // Validate processing PO compatibility
  if (receipt.processing_po_id) {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(receipt.processing_po_id);
    if (!po || po.business_type !== 'OUTSOURCE_PROCESSING' || po.supplier_id !== order.supplier_id) {
      throw new HttpError(409, '处理 PO 与委外订单不兼容');
    }
  }
  const items = db.prepare('SELECT * FROM outsourcing_receipt_items WHERE receipt_id=? ORDER BY line_no').all(receiptId);
  if (!items.length) throw new HttpError(409, '委外收货缺少正式明细', { code: 'OUTSOURCING_RECEIPT_ITEMS_REQUIRED' });
  const now = new Date().toISOString();
  let totalMaterialValue = 0;
  let incrementalRows = [];
  try { transaction(db, () => {
    const lockedReceipt = db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(receiptId);
    if (lockedReceipt.business_status === 'EFFECTED') return;
    if (lockedReceipt.business_status !== 'PENDING_INSPECTION') throw new HttpError(409, '只有待检收货可以生效');
    const lockedOrder = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(lockedReceipt.order_id);
    if (!lockedOrder || lockedOrder.status !== 'RELEASED') throw new HttpError(409, '委外订单状态不允许收货生效');
    const lockedItems = db.prepare('SELECT * FROM outsourcing_receipt_items WHERE receipt_id=? ORDER BY line_no').all(receiptId);
    if (!lockedItems.length || Math.abs(lockedItems.reduce((sum, item) => sum + Number(item.quantity), 0) - Number(lockedReceipt.quantity)) > 1e-9) {
      throw new HttpError(409, '委外收货明细缺失或数量不守恒', { code: 'OUTSOURCING_RECEIPT_ITEMS_REQUIRED' });
    }
    const lockedPo = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(lockedReceipt.processing_po_id);
    if (!lockedPo || lockedPo.status !== 'APPROVED' || lockedPo.business_type !== 'OUTSOURCE_PROCESSING'
      || lockedPo.source_outsourcing_order_id !== lockedOrder.id || lockedPo.supplier_id !== lockedOrder.supplier_id) {
      throw new HttpError(409, '委外收货生效时加工费采购订单来源或审批状态已变化', { code: 'OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH' });
    }
    for (const item of lockedItems) {
      const poItem = db.prepare('SELECT * FROM purchase_order_items WHERE id=? AND order_id=?').get(item.processing_po_item_id, lockedReceipt.processing_po_id);
      const noticeItem = db.prepare('SELECT ni.*,n.business_type,n.status,n.outsourcing_order_id,n.processing_po_id FROM receipt_notice_items ni JOIN receipt_notices n ON n.id=ni.notice_id WHERE ni.id=?').get(item.source_notice_item_source_id);
      if (!poItem || !noticeItem || poItem.product_id !== item.product_id || noticeItem.product_id !== item.product_id
        || noticeItem.business_type !== 'OUTSOURCE' || noticeItem.status !== 'CONFIRMED'
        || noticeItem.outsourcing_order_id !== lockedOrder.id || noticeItem.processing_po_id !== lockedReceipt.processing_po_id
        || (poItem.document_uom_code && String(item.unit_code || '').toUpperCase() !== String(poItem.document_uom_code).toUpperCase())) {
        throw new HttpError(409, '委外收货正式明细来源失效', { code: 'OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH' });
      }
    }
    const alreadyEffective = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM outsourcing_receipts WHERE order_id=? AND business_status='EFFECTED' AND id<>?").get(lockedOrder.id, receiptId).q);
    const cumulativeFinished = alreadyEffective + Number(lockedReceipt.quantity);
    if (cumulativeFinished > Number(lockedOrder.order_quantity) + 1e-9) throw new HttpError(409, '委外累计合格收货超过订单容量', { code: 'RECEIPT_NOTICE_CAPACITY_EXCEEDED' });
    try {
      assertQualityGate(db, 'IQC', receiptId, 'OUTSOURCING_RECEIPT');
    } catch (error) {
      throw new HttpError(409, error.message, { code: 'OUTSOURCING_QUALITY_GATE_NOT_PASSED' });
    }
    const materials = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=? ORDER BY id').all(lockedOrder.id);
    // OUT-21 backflush: per-material line cumulative formula
    for (const m of materials) {
      if (m.legacy_unverified_wip_quantity === null || m.legacy_unverified_wip_quantity === undefined) {
        throw new HttpError(409, '该委外物料行的历史 WIP 不可证明，不得被新的转出或倒冲消费', { code: 'OUTSOURCING_WIP_HISTORY_UNPROVEN' });
      }
      const snapshot = JSON.parse(m.bom_snapshot_json || '{}');
      if (!Number.isFinite(Number(snapshot.per_unit_quantity)) || !Number.isFinite(Number(snapshot.required_quantity))
        || Math.abs(Number(snapshot.required_quantity) - Number(m.required_quantity)) > 1e-9) {
        throw new HttpError(409, '委外用料快照缺少已批准的每单位/总量基数', { code: 'OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED' });
      }
      const targetCumulative = Number(snapshot.per_unit_quantity) * cumulativeFinished;
      const incremental = targetCumulative - Number(m.backflushed_quantity);
      const netSupplied = Number(m.issued_quantity) + Number(m.supplemented_quantity) - Number(m.returned_quantity);
      const remaining = netSupplied - Number(m.backflushed_quantity);
      if (incremental < 0 || incremental > remaining + 1e-9) {
        throw new HttpError(409, `BACKFLUSH_INSUFFICIENT_SUPPLY: 行 ${m.id}`, { code: 'OUTSOURCING_WIP_INSUFFICIENT' });
      }
      if (incremental <= 0) continue;
      const identityInput = materialIdentities.get(m.id) || {};
      const backflush = executeOutsourcingBackflush(db, {
        actor, order: lockedOrder, material: m, receipt: lockedReceipt, quantity: incremental,
        businessDate: lockedReceipt.business_date || lockedReceipt.received_date, identityInput,
      });
      const materialValue = backflush.valuation.issuedValueCents;
      totalMaterialValue += materialValue;
      db.prepare('UPDATE outsourcing_material_list SET backflushed_quantity=backflushed_quantity+?, updated_at=? WHERE id=?').run(incremental, now, m.id);
      incrementalRows.push({ materialListId: m.id, incremental, carryingValueCents: materialValue });
    }
    const totalFinishedValue = totalMaterialValue + Number(lockedReceipt.processing_fee_cents);
    let remainingValue = totalFinishedValue;
    lockedItems.forEach((item, index) => {
      const itemValue = index === lockedItems.length - 1
        ? remainingValue
        : Math.round(totalFinishedValue * Number(item.quantity) / Number(lockedReceipt.quantity));
      remainingValue -= itemValue;
      receiveOutsourcingFinishedGoods(db, { actor, order: lockedOrder, receipt: lockedReceipt, item, valueCents: itemValue, businessDate: lockedReceipt.business_date || lockedReceipt.received_date });
    });
    // Update receipt with cost evidence: consumed material value + processing fee provisional.
    db.prepare(`UPDATE outsourcing_receipts SET business_status='EFFECTED', backflush_material_value_cents=?, total_cost_cents=?, version=version+1, updated_at=? WHERE id=? AND business_status='PENDING_INSPECTION'`).run(totalMaterialValue, totalFinishedValue, now, receiptId);
    db.prepare(`INSERT INTO outsourcing_cost_evidences(
      id,outsourcing_receipt_id,processing_po_id,material_consumed_value_cents,
      processing_fee_provisional_cents,processing_fee_actual_cents,variance_cents,basis_status,calculated_at
    ) VALUES(?,?,?,?,?,NULL,NULL,'PROVISIONAL',?)
    ON CONFLICT(outsourcing_receipt_id) DO UPDATE SET
      processing_po_id=excluded.processing_po_id,
      material_consumed_value_cents=excluded.material_consumed_value_cents,
      processing_fee_provisional_cents=excluded.processing_fee_provisional_cents,
      calculated_at=excluded.calculated_at`).run(
      randomUUID(), receiptId, lockedReceipt.processing_po_id, totalMaterialValue,
      Number(lockedReceipt.processing_fee_cents), now,
    );
    audit(db, actor.id, 'CONFIRM', 'OUTSOURCING_RECEIPT', receiptId, `material_value=${totalMaterialValue}; processing_fee=${lockedReceipt.processing_fee_cents}`);
    saveIdempotency(db, operation, receiptId, idempotencyKey, fingerprint, {
      ok: true, totalMaterialValueCents: totalMaterialValue, incrementalRows,
    });
  }); } catch (error) {
    auditBusinessRejection(db, actor, { entityType: 'OUTSOURCING_RECEIPT', entityId: receiptId, action: '确认委外收货' }, error);
    throw error;
  }
  return send(res, 200, { ok: true, totalMaterialValueCents: totalMaterialValue, incrementalRows });
}

/**
 * OUT-20: Processing Fee Supplier Bill with item-level commercial source.
 * Supports:
 *   - multi-receipt per bill: one bill with multiple OUTSOURCING_RECEIPT_ITEM lines
 *   - multi-bill per item: cumulative quantity guard with reserved (DRAFT + WAITING_MATCH + POSTED) status
 *   - race-safe: row-lock source receipt item, re-read + SUM reservation, validate remaining
 */
export async function createProcessingFeeBill(db, req, res, actor) {
  assertFinancePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'supplierInvoiceNo', 'billDate', 'lines', 'idempotencyKey']);
  if (!Array.isArray(body.lines) || !body.lines.length) throw new HttpError(400, '账单至少需要一行');
  // Validate all items are from same supplier and are OUTSOURCING_RECEIPT_ITEM source
  const receiptItemIds = body.lines.map((l) => l.outsourcingReceiptItemId).filter(Boolean);
  if (receiptItemIds.length !== body.lines.length) throw new HttpError(400, '每行必须包含 outsourcingReceiptItemId');
  const billId = randomUUID(); const billNo = 'SB-PROC-' + Date.now().toString().slice(-10);
  const now = new Date().toISOString();
  let totalNet = 0; let totalGross = 0;
  transaction(db, () => {
    // Idempotency check
    if (body.idempotencyKey) {
      const existing = db.prepare('SELECT id FROM supplier_bills WHERE idempotency_key=?').get(body.idempotencyKey);
      if (existing) throw new HttpError(409, '账单已存在');
    }
    // Verify same supplier
    for (const line of body.lines) {
      const item = db.prepare(`SELECT ori.*, orr.supplier_id FROM outsourcing_receipt_items ori JOIN outsourcing_receipts orr ON orr.id=ori.receipt_id WHERE ori.id=?`).get(line.outsourcingReceiptItemId);
      if (!item) throw new HttpError(404, `委外收货明细 ${line.outsourcingReceiptItemId} 不存在`);
      if (item.supplier_id !== body.supplierId) throw new HttpError(409, '所有明细必须属于同一供应商');
    }
    db.prepare(`INSERT INTO supplier_bills(id,bill_no,supplier_id,supplier_invoice_no,bill_date,status,tax_mode,net_cents,gross_cents,grni_cents,variance_cents,tax_snapshot_json,creator_id,created_at,idempotency_key)
      VALUES(?,?,?,?,?,'DRAFT','NO_TAX',0,0,0,0,'[]',?,?,?)`).run(billId, billNo, body.supplierId, body.supplierInvoiceNo, body.billDate, actor.id, now, body.idempotencyKey || null);
    const insertItem = db.prepare(`INSERT INTO supplier_bill_items(id,bill_id,commercial_source_type,commercial_source_id,commercial_source_item_id,product_id,document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den,unit_price_cents,net_cents,tax_cents,gross_cents,line_no,source_outsourcing_receipt_item_id,source_outsourcing_receipt_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (let i = 0; i < body.lines.length; i += 1) {
      const line = body.lines[i];
      const item = db.prepare(`SELECT ori.*, orr.received_date, orr.processing_fee_cents, orr.supplier_id FROM outsourcing_receipt_items ori JOIN outsourcing_receipts orr ON orr.id=ori.receipt_id WHERE ori.id=?`).get(line.outsourcingReceiptItemId);
      // Row lock via UPDATE; SQLite serializes via BEGIN IMMEDIATE.
      const returnedQty = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM outsourcing_finished_returns
        WHERE outsourcing_receipt_id=? AND business_status='CONFIRMED'`).get(item.receipt_id).q);
      const priorItemQty = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM outsourcing_receipt_items
        WHERE receipt_id=? AND line_no<?`).get(item.receipt_id, item.line_no).q);
      const returnedAgainstItem = Math.min(Number(item.quantity), Math.max(0, returnedQty - priorItemQty));
      const eligibleQty = Number(item.quantity) - returnedAgainstItem;
      const existingReserved = Number(db.prepare(`SELECT COALESCE(SUM(sbi.base_quantity_num*1.0/sbi.base_quantity_den),0) q
        FROM supplier_bill_items sbi JOIN supplier_bills sb ON sb.id=sbi.bill_id
        WHERE sbi.source_outsourcing_receipt_item_id=? AND sb.status IN ('DRAFT','WAITING_MATCH','POSTED')`).get(item.id).q);
      const remainingBillable = eligibleQty - existingReserved;
      if (Number(line.quantity) > remainingBillable + 1e-9) {
        throw new HttpError(409, `Billable quantity exceeded: 剩余可计费 ${remainingBillable}`);
      }
      const unitPrice = Number(line.unitPriceCents || Math.floor(Number(item.processing_fee_cents) / eligibleQty));
      const netCents = unitPrice * Number(line.quantity);
      const taxCents = 0; const grossCents = netCents;
      insertItem.run(randomUUID(), billId,
        'OUTSOURCING_RECEIPT_ITEM', item.receipt_id, item.id,
        item.product_id,
        'EA', Number(line.quantity), 1, 1, 1,
        Number(line.quantity), 1,
        unitPrice, netCents, taxCents, grossCents, i + 1,
        item.id, item.receipt_id);
      totalNet += netCents; totalGross += grossCents;
    }
    db.prepare('UPDATE supplier_bills SET net_cents=?, gross_cents=? WHERE id=?').run(totalNet, totalGross, billId);
    audit(db, actor.id, 'CREATE', 'SUPPLIER_BILL', billId, `processing-fee ${body.lines.length} lines`);
  });
  return send(res, 201, { id: billId, billNo, totalNet, totalGross });
}

export async function postProcessingFeeBill(db, req, res, actor, billId) {
  assertPostingPermission(actor);
  const bill = db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(billId);
  if (!bill) throw new HttpError(404, '账单不存在');
  // 来源级 Business Policy Guard（MC-REQ-15 / Active Design §9.4）：委外来源
  // 账单的正式过账一律拒绝，且拒绝发生在任何状态、AP、凭证与成本证据写入之前。
  assertSupplierBillGlPostable(db, billId, actor.id, 'POST_PROCESSING_FEE_BILL');
  if (bill.status !== 'DRAFT') throw new HttpError(409, '只有草稿可过账');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("UPDATE supplier_bills SET status='POSTED', posted_by=?, posted_at=? WHERE id=?").run(actor.id, now, billId);
    ensurePayableSource(db, {
      id: billId, sourceType: 'SUPPLIER_BILL', sourceNo: bill.bill_no,
      partyId: bill.supplier_id, businessDate: bill.bill_date,
      effectCents: Number(bill.gross_cents), creatorId: bill.creator_id, createdAt: bill.created_at,
    });
    const receiptIds = db.prepare(`SELECT DISTINCT commercial_source_id receipt_id FROM supplier_bill_items
      WHERE bill_id=? AND commercial_source_type='OUTSOURCING_RECEIPT_ITEM'`).all(billId);
    for (const row of receiptIds) refreshOutsourcingCostEvidence(db, row.receipt_id, now);
    audit(db, actor.id, 'POST', 'SUPPLIER_BILL', billId, bill.bill_no);
  });
  return send(res, 200, { ok: true });
}

/**
 * OUT-22 Finished Return: source-trace confirmed outsourcing receipt, finish inventory reversal,
 * return-against-processing-fee commercial credit (handled via canonical AP primitive in app.js).
 */
export async function createFinishedReturn(db, req, res, actor) {
  assertReceivingPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['outsourcingReceiptId', 'quantity', 'returnDate', 'remark']);
  rejectDeferredWrite(db, actor, 'OUTSOURCING_RECEIPT', body.outsourcingReceiptId || null,
    '委外完工退货', 'OUTSOURCING_FINISHED_RETURN_NOT_APPROVED', '委外完工退货不在首期批准范围内');
}

/**
 * OUT-23 sub-capability: Difference Allocation.
 * Preview → Allocate → Apply
 */
export async function previewOutsourcingDifference(db, req, res, actor, orderId) {
  assertMaterialPermission(actor);
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  const materials = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=?').all(orderId);
  const items = materials.map((m) => {
    const expected = Number(m.required_quantity) * Number(order.order_quantity) / Number(order.order_quantity);
    const actual = Number(m.issued_quantity) + Number(m.supplemented_quantity) - Number(m.returned_quantity) - Number(m.backflushed_quantity);
    return {
      materialListId: m.id,
      productId: m.product_id,
      expectedQuantity: expected,
      actualQuantity: actual,
      difference: expected - actual,
    };
  });
  return send(res, 200, { preview: items });
}

export async function applyOutsourcingDifference(db, req, res, actor, orderId) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['materialListId', 'supplementQuantity', 'returnQuantity', 'periodKey']);
  rejectDeferredWrite(db, actor, 'OUTSOURCING_ORDER', orderId,
    '倒冲差异生效', 'OUTSOURCING_DIFFERENCE_APPROVAL_PENDING', '倒冲差异审核生效政策尚未批准');
}

/**
 * OUT-23 sub-capability: WIP Transfer between outsourcing orders.
 * Enterprise ownership unchanged. No cross-order overdraw.
 */
export async function createWipTransfer(db, req, res, actor) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['sourceOrderId', 'targetOrderId', 'materialListId', 'quantity', 'transferDate']);
  if (body.sourceOrderId === body.targetOrderId) throw new HttpError(400, '源/目标订单必须不同');
  const sourceMaterial = db.prepare('SELECT * FROM outsourcing_material_list WHERE id=? AND order_id=?').get(body.materialListId, body.sourceOrderId);
  if (!sourceMaterial) throw new HttpError(404, '源订单物料行不存在');
  // Target material line is identified by product_id within target order.
  const targetMaterial = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=? AND product_id=?').get(body.targetOrderId, sourceMaterial.product_id);
  if (!targetMaterial) throw new HttpError(404, '目标订单无同产品物料行');
  // 跨单 WIP 转移的成本携带与身份归属属延期能力（B-P01 / M1-GB03 DEFERRED）：
  // 源行一旦存在身份证据余额，计数转移会破坏 INV-WIP-1 与来源追溯，必须 fail closed。
  const identityBalances = db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_identity_balances WHERE material_list_id=?').get(sourceMaterial.id);
  if (Number(identityBalances.n) > 0) {
    const error = new HttpError(409, '该委外物料行存在身份证据余额，跨单 WIP 转移的身份归属尚未批准', { code: 'OUTSOURCING_WIP_TRANSFER_IDENTITY_UNSUPPORTED' });
    auditBusinessRejection(db, actor, { entityType: 'OUTSOURCING_ORDER', entityId: body.sourceOrderId || null, action: '委外跨单 WIP 转移' }, error);
    throw error;
  }
  const wipRemaining = Number(sourceMaterial.issued_quantity) + Number(sourceMaterial.supplemented_quantity) - Number(sourceMaterial.returned_quantity) - Number(sourceMaterial.backflushed_quantity);
  if (Number(body.quantity) > wipRemaining) throw new HttpError(409, '转移数量超过源订单 supplier WIP 剩余');
  const id = randomUUID(); const now = new Date().toISOString();
  const transferNo = 'WIP-XFER-' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare(`INSERT INTO outsourcing_wip_transfers(id,transfer_no,source_order_id,target_order_id,material_list_id,quantity,transfer_date,business_status,creator_id,created_at)
      VALUES(?,?,?,?,?,?,?,'CONFIRMED',?,?)`).run(id, transferNo, body.sourceOrderId, body.targetOrderId, targetMaterial.id, Number(body.quantity), body.transferDate || now.slice(0, 10), actor.id, now);
    // Decrement source supplier WIP, increment target by reusing canonical inventory movements (enterprise ownership unchanged).
    db.prepare('UPDATE outsourcing_material_list SET issued_quantity=issued_quantity-?, updated_at=? WHERE id=?').run(Number(body.quantity), now, sourceMaterial.id);
    db.prepare('UPDATE outsourcing_material_list SET issued_quantity=issued_quantity+?, updated_at=? WHERE id=?').run(Number(body.quantity), now, targetMaterial.id);
    audit(db, actor.id, 'TRANSFER', 'OUTSOURCING_WIP_TRANSFER', id, transferNo);
  });
  return send(res, 201, { id, transferNo });
}

/**
 * PRC-26 Procurement Scan: bounded wedge input from scanner/PDA.
 * Resolves document (PO or Notice) + product → adds to canonical Purchase Receipt draft.
 *
 * Cross-conversion guard (OUT-17):
 *   - STANDARD_PURCHASE notice must never resolve to an Outsourcing Receipt;
 *   - OUTSOURCE notice must never resolve to a Purchase Receipt.
 *   The notice's business_type must match the requested conversion path.
 */
export async function procurementScan(db, req, res, actor) {
  assertScanPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['scanCode', 'productId', 'warehouseId', 'quantity', 'lotCode', 'serialNumber', 'sourceType', 'sourceId', 'targetBusinessType']);
  if (!body.scanCode && !body.sourceId) throw new HttpError(400, '必须提供 scanCode 或 sourceId');
  const targetBusinessType = String(body.targetBusinessType || 'STANDARD_PURCHASE').toUpperCase();
  if (!['STANDARD_PURCHASE', 'OUTSOURCE'].includes(targetBusinessType)) {
    throw new HttpError(400, 'targetBusinessType 必须是 STANDARD_PURCHASE 或 OUTSOURCE');
  }
  let orderId = null;
  let outsourceOrderId = null;
  if (body.sourceType === 'PURCHASE_ORDER' && body.sourceId) orderId = body.sourceId;
  if (body.sourceType === 'RECEIPT_NOTICE' && body.sourceId) {
    const notice = db.prepare('SELECT id, business_type, purchase_order_id, outsourcing_order_id FROM receipt_notices WHERE id=?').get(body.sourceId);
    if (!notice) throw new HttpError(404, '收货通知不存在');
    if (notice.business_type !== targetBusinessType) {
      throw new HttpError(409, `通知单 business_type=${notice.business_type || 'STANDARD_PURCHASE'} 与目标 ${targetBusinessType} 不兼容`);
    }
    if (targetBusinessType === 'STANDARD_PURCHASE') {
      orderId = notice.purchase_order_id;
    } else {
      outsourceOrderId = notice.outsourcing_order_id;
    }
  }
  if (targetBusinessType === 'STANDARD_PURCHASE') {
    if (!orderId) throw new HttpError(400, '无法解析扫描源');
    const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
    if (!order) throw new HttpError(404, '采购订单不存在');
    if (order.status !== 'APPROVED') throw new HttpError(409, '只有已审批订单可扫码');
    if (order.business_type !== 'STANDARD_PURCHASE') throw new HttpError(409, '委外订单不可走普通扫码收货');
    const orderItem = db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? AND product_id=? LIMIT 1').get(orderId, body.productId);
    if (!orderItem) throw new HttpError(409, '订单中无此产品');
    return send(res, 200, {
      scanResolution: {
        businessType: 'STANDARD_PURCHASE',
        orderId, orderItemId: orderItem.id, productId: body.productId, warehouseId: body.warehouseId,
        quantity: Number(body.quantity || 0), lotCode: body.lotCode || null, serialNumber: body.serialNumber || null,
      },
    });
  }
  // OUTSOURCE path
  if (!outsourceOrderId) throw new HttpError(400, '无法解析扫描源');
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(outsourceOrderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  if (order.status !== 'RELEASED') throw new HttpError(409, '只有下达状态委外订单可扫码收货');
  // Lookup an existing / auto-resolved DRAFT outsourcing receipt for the order,
  // or return a stub pointer so the caller can create one downstream.
  return send(res, 200, {
    scanResolution: {
      businessType: 'OUTSOURCE',
      outsourcingOrderId: order.id, productId: body.productId, warehouseId: body.warehouseId,
      quantity: Number(body.quantity || 0),
    },
  });
}
