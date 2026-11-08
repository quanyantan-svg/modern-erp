import { randomUUID } from 'node:crypto';
import { releaseMySqlIdempotencyLocks, transaction } from '../db.js';
import { audit, auditBusinessRejection } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';
import { ensurePayableSource } from './settlement-core.js';
import { assertQualityGate } from './quality-gates.js';
import { assertSupplierBillGlPostable } from './outsourcing-gl-policy.js';
import { executeOutsourcingBackflush, receiveOutsourcingFinishedGoods, recordWipTransferIdentity } from './outsourcing-inventory.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { assertInventoryPeriodOpen } from '../lib/inventory-mutation.js';

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

// 委外收货生效的业务门禁拒绝：409 必须写恰好一条 Domain 拒绝审计，且审计含
// 业务单据标识与精确 error code（MC-REQ-11）。400 输入错误不写 Domain 审计。
//
// 事务前拒绝还必须释放 MySQL 幂等命名锁：`idempotencyReplay` 在未命中记录时
// 会持有该锁直到事务提交/回滚，若在进入事务前拒绝却不释放，同一
// Idempotency-Key 的后续请求会被 GET_LOCK 阻塞并退化成 503，而不是稳定的 409。
function rejectReceiptConfirm(db, actor, receiptId, error) {
  if (db?.dialect === 'mysql') releaseMySqlIdempotencyLocks(db);
  auditBusinessRejection(db, actor, { entityType: 'OUTSOURCING_RECEIPT', entityId: receiptId, action: '确认委外收货' }, error);
  return error;
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
  // 精确重放只返回已记录的真实结果；同键异内容是 409 业务门禁拒绝。
  let replay = null;
  try {
    replay = idempotencyReplay(db, operation, receiptId, idempotencyKey, fingerprint);
  } catch (error) {
    if (error?.status !== 409) throw error;
    const conflict = new HttpError(409, error.message, { code: 'OUTSOURCING_RECEIPT_IDEMPOTENCY_CONFLICT' });
    throw rejectReceiptConfirm(db, actor, receiptId, conflict);
  }
  if (replay) return send(res, 200, { ...replay, replayed: true });
  const receipt = db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(receiptId);
  if (!receipt) throw rejectReceiptConfirm(db, actor, receiptId, new HttpError(404, '委外收货不存在'));
  // 已生效收货只接受原 Idempotency-Key 的精确重放；换 Key 重复确认是 409 拒绝。
  if (receipt.business_status === 'EFFECTED') {
    throw rejectReceiptConfirm(db, actor, receiptId,
      new HttpError(409, '已生效收货必须使用原 Idempotency-Key 重放', { code: 'OUTSOURCING_RECEIPT_ALREADY_EFFECTED' }));
  }
  if (receipt.business_status !== 'PENDING_INSPECTION') {
    throw rejectReceiptConfirm(db, actor, receiptId, new HttpError(409, '只有待检收货可以生效'));
  }
  const materialIdentities = new Map((Array.isArray(body.materialIdentities) ? body.materialIdentities : []).map((item) => [item.materialListId, item]));
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(receipt.order_id);
  if (!order) throw rejectReceiptConfirm(db, actor, receiptId, new HttpError(404, '委外订单不存在'));
  if (order.status !== 'RELEASED') {
    throw rejectReceiptConfirm(db, actor, receiptId, new HttpError(409, '只有下达状态可收货'));
  }
  // Validate processing PO compatibility
  if (receipt.processing_po_id) {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(receipt.processing_po_id);
    if (!po || po.business_type !== 'OUTSOURCE_PROCESSING' || po.supplier_id !== order.supplier_id) {
      throw rejectReceiptConfirm(db, actor, receiptId, new HttpError(409, '处理 PO 与委外订单不兼容'));
    }
  }
  const items = db.prepare('SELECT * FROM outsourcing_receipt_items WHERE receipt_id=? ORDER BY line_no').all(receiptId);
  if (!items.length) {
    throw rejectReceiptConfirm(db, actor, receiptId, new HttpError(409, '委外收货缺少正式明细', { code: 'OUTSOURCING_RECEIPT_ITEMS_REQUIRED' }));
  }
  const now = new Date().toISOString();
  let totalMaterialValue = 0;
  let incrementalRows = [];
  try { transaction(db, () => {
    const lockedReceipt = db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(receiptId);
    // 并发第二请求进入本事务时状态已被另一请求改变：不得静默返回并由外层
    // 报告成功，必须明确失败（MC-REQ-05 / MC-REQ-09）。
    if (lockedReceipt.business_status === 'EFFECTED') {
      throw new HttpError(409, '已生效收货必须使用原 Idempotency-Key 重放', { code: 'OUTSOURCING_RECEIPT_ALREADY_EFFECTED' });
    }
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
    // 成品估值金额必须仍是安全整数分：溢出金额不得进入库存估值。
    if (!Number.isSafeInteger(totalFinishedValue) || totalFinishedValue < 0) {
      throw new HttpError(409, '委外收货成品成本金额溢出安全整数分', { code: 'OUTSOURCING_RECEIPT_AMOUNT_OVERFLOW' });
    }
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
    throw rejectReceiptConfirm(db, actor, receiptId, error);
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
 *
 * 合同来源：docs/design/procurement-outsourcing.md §26.34.15（OUT-001 有界批准）、
 * §26.34.13.2（I3a-S 安全加固）、§26.34.8（幂等）、§26.34.9（MySQL 命名锁）、
 * §26.34.14.2（transferNo）、§26.34.15.2（身份链权威正文）。
 *
 * 语义：这是**逻辑数量归属转移**——源减目标增、总量守恒、物理仓位不变、
 * 企业所有权不变、成本零携带（`B-P01` 延期）。它**不是**物理库存移动，
 * 因此不产生 canonical Inventory movement。身份链由 §26.34.15.2 固定：
 * TRANSFER_OUT = 源行 CONSUME（TRANSFER_ORIGIN 分配指向合法原始 SUPPLY effect）；
 * TRANSFER_IN = 目标行 SUPPLY（经 source_effect_id 关联对应 TRANSFER_OUT）；
 * 禁止把 TRANSFER_OUT 当作 source_supply_effect_id 的供给来源。
 */
const WIP_TRANSFER_OPERATION = 'OUTSOURCING_WIP_TRANSFER';
// 定点规范化标度（6 位小数）：浮点尾差不得参与幂等指纹比较与数量比较。
const WIP_TRANSFER_SCALE = 1e6;
const WIP_TRANSFER_EPS = 1e-9;
const WIP_TRANSFER_KEY_MAX_LENGTH = 200;

function wipTransferConflict(code, message) {
  return new HttpError(409, message, { code });
}

// 有限正数 + 定点精度校验：拒绝 0、负数、NaN、Infinity 与超出标度的精度。
function normalizeWipTransferQuantity(raw) {
  const quantity = Number(raw);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new HttpError(400, '转移数量必须是有限正数', { code: 'OUTSOURCING_WIP_TRANSFER_INVALID_QUANTITY' });
  }
  const scaled = quantity * WIP_TRANSFER_SCALE;
  if (!Number.isFinite(scaled) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, '转移数量超出可表示范围', { code: 'OUTSOURCING_WIP_TRANSFER_INVALID_QUANTITY' });
  }
  const normalized = Math.round(scaled) / WIP_TRANSFER_SCALE;
  if (Math.abs(quantity - normalized) > WIP_TRANSFER_EPS) {
    throw new HttpError(400, '转移数量精度超出允许的小数位', { code: 'OUTSOURCING_WIP_TRANSFER_INVALID_QUANTITY' });
  }
  return normalized;
}

// 业务日期：缺失与显式空值归一为同一表示（默认当日）；非法格式或非日历日 400。
function normalizeWipTransferDate(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new HttpError(400, '转移业务日期格式必须为 YYYY-MM-DD', { code: 'OUTSOURCING_WIP_TRANSFER_INVALID_DATE' });
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  // 日历日回环校验：JS 会把 2026-02-31 进位成 03-03，必须显式拒绝。
  const roundTrip = Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toISOString().slice(0, 10);
  if (roundTrip !== text) {
    throw new HttpError(400, '转移业务日期不是有效日历日', { code: 'OUTSOURCING_WIP_TRANSFER_INVALID_DATE' });
  }
  return text;
}

// §26.34.14.2：业务日期作可读前缀，UUID 随机源承担唯一性；不得用毫秒时间戳。
function buildWipTransferNo(businessDate) {
  return `WIP-XFER-${businessDate.replace(/-/g, '')}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

function isWipTransferUniqueConstraintError(error) {
  if (!error) return false;
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.errno === 19) return true;
  if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) return true;
  if (/UNIQUE constraint failed|Duplicate entry/i.test(error.message || '')) return true;
  return false;
}

// 业务门禁拒绝的单一边界（§26.34.9.2 第 8 条）：事务回滚之后记录**恰好一条**
// Domain 拒绝审计；400 / 403 / 404 沿既有合同不写 Domain 拒绝审计。
function rejectWipTransfer(db, actor, sourceOrderId, error) {
  auditBusinessRejection(db, actor, {
    entityType: 'OUTSOURCING_ORDER', entityId: sourceOrderId || null, action: '委外跨单 WIP 转移',
  }, error);
  return error;
}

// 物料行 WIP 数量账（issued+supplemented-returned-backflushed）与 canonical WIP 身份账
// 必须逐项对账（§26.34.4.3 / I3a-P-3）。不一致即表示该行的 WIP 数量不可证明，
// 一律 fail closed —— 不得以任一侧单独为准推定另一侧。
function readReconciledWipIdentity(db, materialRow, capacity, code) {
  const balance = db.prepare('SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id=? AND identity_key=?')
    .get(materialRow.id, 'NONE');
  if (!balance) {
    if (Math.abs(capacity) > WIP_TRANSFER_EPS) {
      throw wipTransferConflict(code, '该委外物料行的 WIP 数量没有可证明的身份证据');
    }
    return null;
  }
  if (String(balance.evidence_state) !== 'QUANTITY_ONLY') {
    throw wipTransferConflict(code, '该委外物料行的 WIP 身份证据状态与产品跟踪策略不一致');
  }
  if (Math.abs(Number(balance.available_quantity) - capacity) > WIP_TRANSFER_EPS) {
    throw wipTransferConflict(code, '该委外物料行的数量账与身份账不一致');
  }
  return balance;
}

export async function createWipTransfer(db, req, res, actor) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['sourceOrderId', 'targetOrderId', 'materialListId', 'quantity', 'transferDate', 'idempotencyKey']);
  const idempotencyKey = String(body.idempotencyKey ?? '').trim();
  if (!idempotencyKey) throw new HttpError(400, '幂等键必填', { code: 'IDEMPOTENCY_KEY_REQUIRED' });
  if (idempotencyKey.length > WIP_TRANSFER_KEY_MAX_LENGTH) {
    throw new HttpError(400, '幂等键长度超限', { code: 'IDEMPOTENCY_KEY_INVALID' });
  }
  const sourceOrderId = String(body.sourceOrderId ?? '').trim();
  const targetOrderId = String(body.targetOrderId ?? '').trim();
  const materialListId = String(body.materialListId ?? '').trim();
  if (!sourceOrderId || !targetOrderId || !materialListId) {
    throw new HttpError(400, 'sourceOrderId、targetOrderId 与 materialListId 必填', { code: 'OUTSOURCING_WIP_TRANSFER_INVALID_INPUT' });
  }
  if (sourceOrderId === targetOrderId) {
    throw new HttpError(400, '源/目标订单必须不同', { code: 'OUTSOURCING_WIP_TRANSFER_SAME_ORDER' });
  }
  const quantity = normalizeWipTransferQuantity(body.quantity);
  const businessDate = normalizeWipTransferDate(body.transferDate);
  // 源物料行在事务外只读一次，且**仅**用于 404 判定与幂等指纹的 UOM。
  // 写入依据（余额、身份、订单状态、期间状态）一律以事务内重读为准。
  const fingerprintSource = db.prepare('SELECT id,unit FROM outsourcing_material_list WHERE id=? AND order_id=?')
    .get(materialListId, sourceOrderId);
  if (!fingerprintSource) throw new HttpError(404, '源订单物料行不存在');
  const fingerprint = requestFingerprint({
    sourceOrderId,
    targetOrderId,
    materialListId,
    quantity,
    uom: String(fingerprintSource.unit || '').toUpperCase(),
    transferDate: businessDate,
    identityKey: 'NONE',
  });
  let transferId = null;
  let transferNo = null;
  try {
    let replay = null;
    try {
      replay = idempotencyReplay(db, WIP_TRANSFER_OPERATION, sourceOrderId, idempotencyKey, fingerprint);
    } catch (error) {
      if (error?.status !== 409) throw error;
      throw new HttpError(409, error.message, { code: 'OUTSOURCING_WIP_TRANSFER_IDEMPOTENCY_CONFLICT' });
    }
    // 精确重放只返回已记录的真实结果，不新增转移、身份、数量或成功审计。
    if (replay) return send(res, 201, { ...replay, replayed: true });
    transaction(db, () => {
      const now = new Date().toISOString();
      // ── 事务内权威重读（§26.34.5.1 第 2 条）──
      const sourceOrder = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(sourceOrderId);
      if (!sourceOrder) throw new HttpError(404, '委外订单不存在');
      const targetOrder = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(targetOrderId);
      if (!targetOrder) throw new HttpError(404, '目标委外订单不存在');
      if (sourceOrder.status !== 'RELEASED' || targetOrder.status !== 'RELEASED') {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_ORDER_STATE_INVALID', '只有下达状态的委外订单可发生 WIP 数量归属转移');
      }
      const sourceMaterial = db.prepare('SELECT * FROM outsourcing_material_list WHERE id=? AND order_id=?')
        .get(materialListId, sourceOrderId);
      if (!sourceMaterial) throw new HttpError(404, '源订单物料行不存在');
      // 目标行按 (targetOrderId, product_id) 判定，候选数必须严格为 1。
      const targetCandidates = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=? AND product_id=?')
        .all(targetOrderId, sourceMaterial.product_id);
      if (!targetCandidates.length) throw new HttpError(404, '目标订单无同产品物料行');
      if (targetCandidates.length !== 1) {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_TARGET_NOT_UNIQUE', '目标订单存在多行同产品物料行');
      }
      const targetMaterial = targetCandidates[0];
      const product = db.prepare('SELECT id,tracking_policy,base_uom_code,unit,active FROM products WHERE id=?')
        .get(sourceMaterial.product_id);
      if (!product || !Number(product.active)) throw new HttpError(404, '委外物料不存在或已停用');
      if (String(product.tracking_policy || 'NONE').toUpperCase() !== 'NONE') {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_IDENTITY_UNSUPPORTED', 'LOT/SERIAL 跟踪产品的 WIP 转移身份归属尚未批准');
      }
      const baseUom = String(product.base_uom_code || product.unit || 'EA').toUpperCase();
      const sourceUom = String(sourceMaterial.unit || '').toUpperCase();
      const targetUom = String(targetMaterial.unit || '').toUpperCase();
      // 源行、目标行与产品基础 UOM 必须三者一致：跨 UOM 的数量归属不是同一物料的数量转移。
      if (sourceUom !== baseUom || targetUom !== baseUom || targetUom !== sourceUom) {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_UOM_MISMATCH', '源/目标物料行单位与产品基础单位不一致');
      }
      // 同一供应商 WIP 物理位置不变：跨供应商或跨 WIP 仓位都不是逻辑数量归属。
      const sourceSupplier = db.prepare('SELECT id,supplier_wip_warehouse_id FROM suppliers WHERE id=?').get(sourceOrder.supplier_id);
      const targetSupplier = db.prepare('SELECT id,supplier_wip_warehouse_id FROM suppliers WHERE id=?').get(targetOrder.supplier_id);
      if (!sourceSupplier || !targetSupplier || sourceOrder.supplier_id !== targetOrder.supplier_id) {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_SUPPLIER_MISMATCH', 'WIP 数量归属转移不得跨供应商');
      }
      if (!sourceSupplier.supplier_wip_warehouse_id
        || sourceSupplier.supplier_wip_warehouse_id !== targetSupplier.supplier_wip_warehouse_id) {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_WAREHOUSE_MISMATCH', '源/目标供应商 WIP 仓位不一致');
      }
      // 历史可证明性：NULL 表示未证明，绝不 COALESCE 成 0 取得转移容量。
      if (sourceMaterial.legacy_unverified_wip_quantity === null
        || sourceMaterial.legacy_unverified_wip_quantity === undefined) {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED', '该委外物料行的历史 WIP 不可证明');
      }
      if (targetMaterial.legacy_unverified_wip_quantity === null
        || targetMaterial.legacy_unverified_wip_quantity === undefined) {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED', '目标委外物料行的历史 WIP 不可证明');
      }
      const capacity = Number(sourceMaterial.issued_quantity) + Number(sourceMaterial.supplemented_quantity)
        - Number(sourceMaterial.returned_quantity) - Number(sourceMaterial.backflushed_quantity);
      if (capacity + WIP_TRANSFER_EPS < quantity) {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_OVERDRAW', '转移数量超过源订单 supplier WIP 剩余');
      }
      if (String(sourceMaterial.identity_evidence_state || '') !== 'VERIFIED') {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED', '源物料行缺少已验证的 WIP 身份证据状态');
      }
      // 身份账与数量账对账：两侧都必须可证明，且彼此一致（§26.34.4.3 / I3a-P-3）。
      const sourceIdentity = readReconciledWipIdentity(db, sourceMaterial, capacity, 'OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED');
      if (!sourceIdentity) {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED', '源物料行没有可证明的 WIP 身份证据');
      }
      if (Number(sourceIdentity.available_quantity) + WIP_TRANSFER_EPS < quantity) {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_OVERDRAW', '转移数量超过源订单 supplier WIP 剩余');
      }
      const targetCapacity = Number(targetMaterial.issued_quantity) + Number(targetMaterial.supplemented_quantity)
        - Number(targetMaterial.returned_quantity) - Number(targetMaterial.backflushed_quantity);
      readReconciledWipIdentity(db, targetMaterial, targetCapacity, 'OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED');
      assertInventoryPeriodOpen(db, businessDate);
      // ── 转移事实：既有 `material_list_id` 继续表示**目标行**（§26.34.4.2 / I3b-2）──
      transferId = randomUUID();
      transferNo = buildWipTransferNo(businessDate);
      try {
        db.prepare(`INSERT INTO outsourcing_wip_transfers(id,transfer_no,source_order_id,target_order_id,material_list_id,quantity,transfer_date,business_status,creator_id,created_at)
          VALUES(?,?,?,?,?,?,?,'CONFIRMED',?,?)`).run(
          transferId, transferNo, sourceOrderId, targetOrderId, targetMaterial.id, quantity, businessDate, actor.id, now);
      } catch (error) {
        if (!isWipTransferUniqueConstraintError(error)) throw error;
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_NO_CONFLICT', 'WIP 转移单号冲突');
      }
      // ── 身份效力（I3b-1 / §26.34.15.2）：同一事务内形成配对的 TRANSFER_OUT / TRANSFER_IN
      //    与 TRANSFER_ORIGIN 分配。物理库存零新增移动，企业所有权不变，成本零携带。
      recordWipTransferIdentity(db, {
        sourceMaterial, targetMaterial, quantity, transferId, businessDate,
      });
      // ── 数量守恒与并发守卫：源减目标增成对，CAS 条件更新保证不超额 ──
      const decremented = db.prepare(`UPDATE outsourcing_material_list SET issued_quantity=issued_quantity-?, updated_at=?
        WHERE id=? AND (issued_quantity+supplemented_quantity-returned_quantity-backflushed_quantity) >= ? - ?`)
        .run(quantity, now, sourceMaterial.id, quantity, WIP_TRANSFER_EPS);
      if (Number(decremented.changes ?? decremented.affectedRows) !== 1) {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_CONCURRENT_CONFLICT', '源订单 WIP 余额已被并发占用');
      }
      const incremented = db.prepare("UPDATE outsourcing_material_list SET issued_quantity=issued_quantity+?, identity_evidence_state='VERIFIED', updated_at=? WHERE id=?")
        .run(quantity, now, targetMaterial.id);
      if (Number(incremented.changes ?? incremented.affectedRows) !== 1) {
        throw wipTransferConflict('OUTSOURCING_WIP_TRANSFER_CONCURRENT_CONFLICT', '目标订单物料行已被并发占用');
      }
      // 幂等记录、转移事实、身份效力、数量效力与成功审计同一事务提交。
      saveIdempotency(db, WIP_TRANSFER_OPERATION, sourceOrderId, idempotencyKey, fingerprint, { id: transferId, transferNo });
      audit(db, actor.id, 'TRANSFER', 'OUTSOURCING_WIP_TRANSFER', transferId, transferNo);
    });
  } catch (error) {
    throw rejectWipTransfer(db, actor, sourceOrderId, error);
  } finally {
    // §26.34.9.2 第 4 条：外层释放保障。正常 COMMIT/ROLLBACK 后事务已自行释放，
    // 此时锁登记已清空，本调用是空操作；admission 拒绝等路径由这里收敛。
    releaseMySqlIdempotencyLocks(db);
  }
  return send(res, 201, { id: transferId, transferNo });
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
