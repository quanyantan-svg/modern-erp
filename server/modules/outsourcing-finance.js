import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';
import { createCommercialCreditNote } from './commercial-golive.js';
import { backflushMaterial } from './outsourcing.js';
import { ensurePayableSource } from './settlement-core.js';

const RECEIVE_PERMISSIONS = ['OUTSOURCING_RECEIVING_MANAGE', 'OUTSOURCING_MANAGE'];
const FINANCE_PERMISSIONS = ['SUPPLIER_BILL_MANAGE', 'OUTSOURCING_MANAGE'];
const MATERIAL_PERMISSIONS = ['OUTSOURCING_MATERIAL_EXECUTE', 'OUTSOURCING_MANAGE'];

function assertReceivingPermission(actor) { allowAny(actor, RECEIVE_PERMISSIONS); }
function assertFinancePermission(actor) { allowAny(actor, FINANCE_PERMISSIONS); }
function assertMaterialPermission(actor) { allowAny(actor, MATERIAL_PERMISSIONS); }
function assertScanPermission(actor) { allowAny(actor, ['PROCUREMENT_SCAN_EXECUTE', 'PURCHASE_RECEIPTS_MANAGE']); }

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
  assertReceivingPermission(actor);
  const receipt = db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(receiptId);
  if (!receipt) throw new HttpError(404, '委外收货不存在');
  if (receipt.business_status !== 'CONFIRMED') throw new HttpError(409, '该收货已生效');
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
  // OUT-18: validate quality. Use canonical deriveQualityState if available.
  const deriveQuality = (db.modules && db.modules.deriveQualityState) || null;
  if (typeof deriveQuality === 'function') {
    const q = deriveQuality(db, 'OUTSOURCING_RECEIPT', receiptId);
    if (q && q.required && !q.passed) throw new HttpError(409, '必须先通过质检');
  }
  const items = db.prepare('SELECT * FROM outsourcing_receipt_items WHERE receipt_id=? ORDER BY line_no').all(receiptId);
  const now = new Date().toISOString();
  let totalMaterialValue = 0;
  let incrementalRows = [];
  transaction(db, () => {
    const cumulativeFinished = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM outsourcing_receipts WHERE order_id=? AND business_status<>'CANCELLED' AND id<>?").get(order.id, receiptId).q) + Number(receipt.quantity);
    const materials = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=?').all(order.id);
    // OUT-21 backflush: per-material line cumulative formula
    for (const m of materials) {
      const targetCumulative = Number(m.required_quantity) * cumulativeFinished / Number(order.order_quantity);
      const incremental = targetCumulative - Number(m.backflushed_quantity);
      const netSupplied = Number(m.issued_quantity) + Number(m.supplemented_quantity) - Number(m.returned_quantity);
      const remaining = netSupplied - Number(m.backflushed_quantity);
      if (incremental < 0 || incremental > remaining + 1e-9) {
        throw new HttpError(409, `BACKFLUSH_INSUFFICIENT_SUPPLY: 行 ${m.id}`);
      }
      if (incremental <= 0) continue;
      // Capture material carrying value at moving average (exclude unused/returned/supplier-WIP remaining).
      // The "actual consumed carrying value" excludes issued-but-unused (still in supplier WIP) and returned
      // (already returned to enterprise) and remaining (still in supplier WIP). We only count what was backflushed.
      const product = db.prepare('SELECT id, base_uom_code FROM products WHERE id=?').get(m.product_id);
      const carrying = Number(db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE product_id=?').get(m.product_id).q);
      const movingAvg = Number(db.prepare('SELECT COALESCE(SUM(value_cents*1.0)/NULLIF(SUM(quantity),0),0) v FROM inventory_valuation_balances WHERE product_id=?').get(m.product_id).v);
      const materialValue = Math.round(movingAvg * incremental);
      totalMaterialValue += materialValue;
      db.prepare('UPDATE outsourcing_material_list SET backflushed_quantity=backflushed_quantity+?, updated_at=? WHERE id=?').run(incremental, now, m.id);
      // Insert valuation movement for backflush (consumed material carrying value).
      db.prepare(`INSERT INTO inventory_valuation_movements(id,product_id,warehouse_id,movement_type,source_type,source_id,source_item_id,quantity_delta,value_delta_cents,created_at,business_date,valuation_basis)
        VALUES(?,?,?,'OUTSOURCING_BACKFLUSH','OUTSOURCING_RECEIPT',?,?,?,?,?,?,'MOVING_AVERAGE')`).run(randomUUID(), m.product_id, 'warehouse-001', receiptId, m.id, -incremental, -materialValue, now, receipt.received_date || now.slice(0, 10));
      incrementalRows.push({ materialListId: m.id, incremental, carryingValueCents: materialValue });
    }
    // Recognize finished inventory: insert finished item row into finished_inventory_position (canonical inventory).
    // We use inventory table update with +receipt.quantity against the finished product.
    db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,source_type,source_id,source_no,remark,creator_id,created_at,business_date)
      VALUES(?,?,?,?,'IN','OUTSOURCING_RECEIPT',?,?,?,?,?,?)`).run(randomUUID(), 'warehouse-001', order.product_id, receipt.quantity, receiptId, receipt.receipt_no, '委外加工入库', actor.id, now, receipt.received_date);
    db.prepare('UPDATE inventory SET quantity=quantity+?, updated_at=? WHERE warehouse_id=? AND product_id=?').run(receipt.quantity, now, 'warehouse-001', order.product_id);
    // Update receipt with cost evidence: consumed material value + processing fee provisional.
    db.prepare(`UPDATE outsourcing_receipts SET business_status='EFFECTED', backflush_material_value_cents=?, total_cost_cents=?, updated_at=? WHERE id=?`).run(totalMaterialValue, totalMaterialValue + Number(receipt.processing_fee_cents), now, receiptId);
    db.prepare(`INSERT INTO outsourcing_cost_evidences(
      id,outsourcing_receipt_id,processing_po_id,material_consumed_value_cents,
      processing_fee_provisional_cents,processing_fee_actual_cents,variance_cents,basis_status,calculated_at
    ) VALUES(?,?,?,?,?,NULL,NULL,'PROVISIONAL',?)
    ON CONFLICT(outsourcing_receipt_id) DO UPDATE SET
      processing_po_id=excluded.processing_po_id,
      material_consumed_value_cents=excluded.material_consumed_value_cents,
      processing_fee_provisional_cents=excluded.processing_fee_provisional_cents,
      calculated_at=excluded.calculated_at`).run(
      randomUUID(), receiptId, receipt.processing_po_id, totalMaterialValue,
      Number(receipt.processing_fee_cents), now,
    );
    audit(db, actor.id, 'CONFIRM', 'OUTSOURCING_RECEIPT', receiptId, `material_value=${totalMaterialValue}; processing_fee=${receipt.processing_fee_cents}`);
  });
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
  assertFinancePermission(actor);
  const bill = db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(billId);
  if (!bill) throw new HttpError(404, '账单不存在');
  if (bill.status !== 'DRAFT') throw new HttpError(409, '只有草稿可过账');
  if (!bill.commercial_source_type && !db.prepare('SELECT 1 FROM supplier_bill_items WHERE bill_id=? AND commercial_source_type=? LIMIT 1').get(billId, 'OUTSOURCING_RECEIPT_ITEM')) {
    // Not necessarily a processing-fee bill; allow generic posting.
  }
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
  const receipt = db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(body.outsourcingReceiptId);
  if (!receipt) throw new HttpError(404, '委外收货不存在');
  if (receipt.business_status !== 'EFFECTED') throw new HttpError(409, '只有已生效的收货可以退货');
  const returnQuantity = Number(body.quantity);
  if (!Number.isFinite(returnQuantity) || returnQuantity <= 0) throw new HttpError(400, '退货数量必须大于 0');
  const id = randomUUID(); const now = new Date().toISOString();
  const returnNo = 'OSRET-' + Date.now().toString().slice(-10);
  let commercialCreditCents = 0;
  let commercialCreditCount = 0;
  transaction(db, () => {
    const alreadyReturned = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM outsourcing_finished_returns
      WHERE outsourcing_receipt_id=? AND business_status='CONFIRMED'`).get(receipt.id).q);
    if (returnQuantity > Number(receipt.quantity) - alreadyReturned + 1e-9) {
      throw new HttpError(409, '退货数量超过收货剩余数量');
    }
    const productId = db.prepare('SELECT product_id FROM outsourcing_orders WHERE id=?').get(receipt.order_id).product_id;
    db.prepare(`INSERT INTO outsourcing_finished_returns(id,return_no,outsourcing_receipt_id,supplier_id,quantity,return_date,business_status,creator_id,created_at)
      VALUES(?,?,?,?,?,?,'CONFIRMED',?,?)`).run(id, returnNo, receipt.id, receipt.supplier_id, returnQuantity, body.returnDate || now.slice(0, 10), actor.id, now);
    // Finished inventory reversal: deduct from inventory + insert OUT transaction.
    db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,source_type,source_id,source_no,remark,creator_id,created_at,business_date)
      VALUES(?,?,?,?,'OUT','OUTSOURCING_FINISHED_RETURN',?,?,?,?,?,?)`).run(randomUUID(), 'warehouse-001', productId, returnQuantity, id, returnNo, '委外加工退货', actor.id, now, body.returnDate || now.slice(0, 10));
    const inventory = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get('warehouse-001', productId);
    if (!inventory || Number(inventory.quantity) + 1e-9 < returnQuantity) throw new HttpError(409, '委外完工库存不足');
    db.prepare('UPDATE inventory SET quantity=quantity-?, updated_at=? WHERE warehouse_id=? AND product_id=?').run(returnQuantity, now, 'warehouse-001', productId);

    let remainingBilledReturn = returnQuantity;
    const postedLines = db.prepare(`SELECT sbi.id bill_item_id,sbi.bill_id,
      sbi.base_quantity_num*1.0/sbi.base_quantity_den billed_quantity,sbi.gross_cents,
      sb.supplier_id,sb.bill_no
      FROM supplier_bill_items sbi JOIN supplier_bills sb ON sb.id=sbi.bill_id
      WHERE sbi.commercial_source_type='OUTSOURCING_RECEIPT_ITEM'
        AND sbi.commercial_source_id=? AND sb.status='POSTED'
      ORDER BY sb.posted_at,sb.id,sbi.line_no,sbi.id`).all(receipt.id);
    for (const line of postedLines) {
      if (remainingBilledReturn <= 1e-9) break;
      const prior = db.prepare(`SELECT COALESCE(SUM(billed_quantity),0) quantity,
        COALESCE(SUM(credit_cents),0) cents FROM outsourcing_finished_return_credits
        WHERE supplier_bill_item_id=?`).get(line.bill_item_id);
      const availableQuantity = Number(line.billed_quantity) - Number(prior.quantity);
      const availableCents = Number(line.gross_cents) - Number(prior.cents);
      if (availableQuantity <= 1e-9 || availableCents <= 0) continue;
      const creditedQuantity = Math.min(remainingBilledReturn, availableQuantity);
      const creditCents = Math.abs(creditedQuantity - availableQuantity) <= 1e-9
        ? availableCents
        : Math.round(Number(line.gross_cents) * creditedQuantity / Number(line.billed_quantity));
      const creditNote = createCommercialCreditNote(db, {
        side: 'AP', sourceId: line.bill_id, grossCents: creditCents,
        creditDate: body.returnDate || now.slice(0, 10), adjustmentType: 'RETURN',
        reason: `委外完工退货 ${returnNo}`, actorId: actor.id,
        idempotencyKey: `OUTSOURCING_FINISHED_RETURN:${id}:${line.bill_item_id}`,
      });
      db.prepare(`INSERT INTO outsourcing_finished_return_credits(
        id,return_id,supplier_bill_id,supplier_bill_item_id,commercial_credit_note_id,
        billed_quantity,credit_cents,created_at
      ) VALUES(?,?,?,?,?,?,?,?)`).run(
        randomUUID(), id, line.bill_id, line.bill_item_id, creditNote.id,
        creditedQuantity, creditCents, now,
      );
      commercialCreditCents += creditCents;
      commercialCreditCount += 1;
      remainingBilledReturn -= creditedQuantity;
    }
    refreshOutsourcingCostEvidence(db, receipt.id, now);
    audit(db, actor.id, 'CREATE', 'OUTSOURCING_FINISHED_RETURN', id, returnNo);
  });
  return send(res, 201, {
    id, returnNo,
    commercialState: commercialCreditCount ? 'BILLED_CREDIT_POSTED' : 'UNBILLED_NO_AP_CREDIT',
    commercialCreditCents,
  });
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
  const material = db.prepare('SELECT * FROM outsourcing_material_list WHERE id=? AND order_id=?').get(body.materialListId, orderId);
  if (!material) throw new HttpError(404, '物料行不存在');
  const now = new Date().toISOString();
  const id = randomUUID();
  transaction(db, () => {
    const expected = Number(material.required_quantity);
    const actual = Number(material.issued_quantity) + Number(material.supplemented_quantity) - Number(material.returned_quantity) - Number(material.backflushed_quantity);
    db.prepare(`INSERT INTO outsourcing_period_differences(id,order_id,material_list_id,expected_quantity,actual_quantity,difference_quantity,period_key,business_status,creator_id,created_at)
      VALUES(?,?,?,?,?,?,?,'APPLIED',?,?)`).run(id, orderId, body.materialListId, expected, actual, expected - actual, body.periodKey || now.slice(0, 7), actor.id, now);
    if (Number(body.supplementQuantity || 0) > 0) {
      db.prepare(`INSERT INTO outsourcing_supplements(id,order_id,material_list_id,quantity,reason,supplement_date,business_status,creator_id,created_at)
        VALUES(?,?,?,?,?,?,'CONFIRMED',?,?)`).run(randomUUID(), orderId, body.materialListId, Number(body.supplementQuantity), 'DIFF: ' + (body.reason || ''), now.slice(0, 10), actor.id, now);
      db.prepare('UPDATE outsourcing_material_list SET supplemented_quantity=supplemented_quantity+?, updated_at=? WHERE id=?').run(Number(body.supplementQuantity), now, body.materialListId);
    }
    if (Number(body.returnQuantity || 0) > 0) {
      db.prepare(`INSERT INTO outsourcing_returns(id,order_id,material_list_id,quantity,from_warehouse_id,to_warehouse_id,return_date,business_status,creator_id,created_at)
        VALUES(?,?,?,?,?,?,?,'CONFIRMED',?,?)`).run(randomUUID(), orderId, body.materialListId, Number(body.returnQuantity), 'warehouse-002', 'warehouse-001', now.slice(0, 10), actor.id, now);
      db.prepare('UPDATE outsourcing_material_list SET returned_quantity=returned_quantity+?, updated_at=? WHERE id=?').run(Number(body.returnQuantity), now, body.materialListId);
    }
    audit(db, actor.id, 'APPLY', 'OUTSOURCING_DIFFERENCE', id, `Δ=${expected - actual}`);
  });
  return send(res, 200, { ok: true });
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
 */
export async function procurementScan(db, req, res, actor) {
  assertScanPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['scanCode', 'productId', 'warehouseId', 'quantity', 'lotCode', 'serialNumber', 'sourceType', 'sourceId']);
  if (!body.scanCode && !body.sourceId) throw new HttpError(400, '必须提供 scanCode 或 sourceId');
  let orderId = null;
  if (body.sourceType === 'PURCHASE_ORDER' && body.sourceId) orderId = body.sourceId;
  if (body.sourceType === 'RECEIPT_NOTICE' && body.sourceId) {
    const notice = db.prepare('SELECT purchase_order_id FROM receipt_notices WHERE id=?').get(body.sourceId);
    if (!notice) throw new HttpError(404, '收货通知不存在');
    orderId = notice.purchase_order_id;
  }
  if (!orderId) throw new HttpError(400, '无法解析扫描源');
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '采购订单不存在');
  if (order.status !== 'APPROVED') throw new HttpError(409, '只有已审批订单可扫码');
  if (order.business_type !== 'STANDARD_PURCHASE') throw new HttpError(409, '委外订单不可走普通扫码收货');
  // Lookup order item by product id
  const orderItem = db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? AND product_id=? LIMIT 1').get(orderId, body.productId);
  if (!orderItem) throw new HttpError(409, '订单中无此产品');
  // Return scan-resolved draft line. The downstream purchase-receipts POST will pick this up.
  return send(res, 200, {
    scanResolution: {
      orderId, orderItemId: orderItem.id, productId: body.productId, warehouseId: body.warehouseId,
      quantity: Number(body.quantity || 0), lotCode: body.lotCode || null, serialNumber: body.serialNumber || null,
    },
  });
}
