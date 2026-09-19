// M14 — Sales / Purchase Discount / Allowance.
//
// Two related but independent operational finance adjustments that
// reuse the existing canonical AR/AP subledgers without inventing a
// parallel finance ledger:
//
//   1. Sales Discount (sales_discounts)
//      - DRAFT -> CONFIRMED / CANCELLED.
//      - DRAFT create / edit / cancel allowed with SALES_DISCOUNT_MANAGE.
//      - CONFIRM allowed exactly once per document. A repeated
//        confirm returns 409. CONFIRMED and CANCELLED are immutable.
//      - Confirm runs in a single transaction: re-reads the canonical
//        document, validates that source_receivable_id is a positive
//        AR row belonging to the same customer, enforces the source
//        cap (cumulative economic reductions <= source_amount_cents),
//        validates the accounting period, creates exactly one
//        negative AR adjustment row (via ensureSubledger with
//        effectCents = -amount_cents), writes one canonical reversal
//        voucher, and marks CONFIRMED.
//      - Inventory / MRP / Approval Center impact = NONE.
//
//   2. Purchase Discount (purchase_discounts)
//      - Symmetric for suppliers and account_payables.
//
// Source cap (sales):
//   Original AR (positive) amount minus all linked economic reductions
//   (SALES_RETURN + SALES_DISCOUNT on the same source) must remain
//   non-negative after this discount is committed. The economic
//   reduction for a discount = its amount_cents. Collections do NOT
//   reduce the cap because a discount may legitimately occur after
//   settlement (post-settlement credit case).
//
// Settlement-credit safety:
//   M14 added a customer-level / supplier-level net balance gate to
//   confirmSettlementDocument. Discounts feed that gate by creating
//   negative adjustments to the customer's / supplier's total
//   balance. Over-collection and over-payment against an
//   existing discount are rejected with 409.

import { id as genId, transaction } from '../db.js';
import { ensureReceivableSource, ensurePayableSource } from './settlement-core.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, readJson, requiredText, optionalText, send,
} from '../lib/http.js';

const SALES_STATUS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const PURCHASE_STATUS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REASON = 200;
const MAX_NOTE = 200;

function nowIso() { return new Date().toISOString(); }

function makeNumber(prefix) {
  return `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
}

function readBusinessDate(value, fallback) {
  if (!value) return fallback;
  const text = String(value).trim();
  if (!DATE_RE.test(text)) throw new HttpError(400, '业务日期格式应为 YYYY-MM-DD');
  if (Number.isNaN(Date.parse(text + 'T00:00:00Z'))) throw new HttpError(400, '业务日期不正确');
  return text;
}

function readAmount(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new HttpError(400, `${label}必须是大于0的整数分`);
  return number;
}

// =====================================================================
// Sales Discount — list / detail / create / update / confirm / cancel
// =====================================================================

function fetchSalesDiscountHeader(db, discountId) {
  return db.prepare(`
    SELECT d.*, c.code customerCode, c.name customerName, creator.display_name creatorName,
           confirmed.display_name confirmedByName, cancelled.display_name cancelledByName
      FROM sales_discounts d
      JOIN customers c ON c.id = d.customer_id
      JOIN users creator ON creator.id = d.creator_id
      LEFT JOIN users confirmed ON confirmed.id = d.confirmed_by
      LEFT JOIN users cancelled ON cancelled.id = d.cancelled_by
     WHERE d.id = ?
  `).get(discountId);
}

function fetchSourceReceivable(db, discount) {
  return db.prepare(`SELECT id, voucher_no documentNo, customer_id customerId, amount_cents amountCents, adjustment_cents adjustmentCents, paid_cents paidCents, write_off_cents writeOffCents, status, source_type sourceType, source_id sourceId, business_date businessDate FROM account_receivables WHERE id = ?`).get(discount.source_receivable_id);
}

function computeSourceCapacity(db, receivable) {
  // Sum of SALES_RETURN + SALES_DISCOUNT reductions linked to the
  // same source AR row. Returns total negative economic reductions.
  // The AR row carries source_type + source_id pointing at the
  // original sales_delivery (for SALES_DELIVERY) or the return id
  // (for SALES_RETURN). For SALES_RETURN rows, the source_id is
  // the return id; the linked delivery_id lives on return_orders.
  const linkedReturnCents = Number(db.prepare(`SELECT COALESCE(SUM(ABS(amount_cents)),0) n FROM account_receivables WHERE source_type='SALES_RETURN' AND source_id IN (SELECT id FROM return_orders WHERE source_type='SALES' AND (delivery_id=? OR (delivery_id IS NULL AND source_id=?)))`).get(receivable.source_id, receivable.source_id).n);
  const discountCents = Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM sales_discounts WHERE source_receivable_id=? AND status='CONFIRMED'`).get(receivable.id).n);
  return linkedReturnCents + discountCents;
}

export function listSalesDiscounts(db, res, actor) {
  allowAny(actor, ['AR_VIEW', 'SALES_DISCOUNT_MANAGE']);
  const rows = db.prepare(`
    SELECT d.id, d.discount_no discountNo, d.status, d.business_date businessDate,
           d.amount_cents amountCents, d.reason, d.notes, d.created_at createdAt,
           d.confirmed_at confirmedAt, c.code customerCode, c.name customerName,
           creator.display_name creatorName
      FROM sales_discounts d
      JOIN customers c ON c.id = d.customer_id
      JOIN users creator ON creator.id = d.creator_id
     ORDER BY d.created_at DESC
     LIMIT 100
  `).all().map((row) => ({
    ...row,
    amountCents: Number(row.amountCents),
    statusLabel: SALES_STATUS[row.status] || row.status,
  }));
  return send(res, 200, { salesDiscounts: rows });
}

export function getSalesDiscount(db, res, actor, discountId) {
  allowAny(actor, ['AR_VIEW', 'SALES_DISCOUNT_MANAGE']);
  const header = fetchSalesDiscountHeader(db, discountId);
  if (!header) throw new HttpError(404, '销售折让单不存在');
  const source = fetchSourceReceivable(db, header);
  const usedCents = computeSourceCapacity(db, source);
  const remainingCapacityCents = Math.max(0, Number(source.amountCents) - usedCents);
  const customerNet = db.prepare(`SELECT COALESCE(SUM(amount_cents + adjustment_cents - paid_cents - write_off_cents),0) n FROM account_receivables WHERE customer_id=?`).get(header.customer_id).n;
  return send(res, 200, {
    salesDiscount: {
      ...header,
      amountCents: Number(header.amount_cents),
      statusLabel: SALES_STATUS[header.status] || header.status,
      source: source ? {
        id: source.id,
        documentNo: source.documentNo,
        businessDate: source.businessDate,
        amountCents: Number(source.amountCents),
        outstandingCents: Math.max(0, source.amountCents + source.adjustmentCents - source.paidCents - source.writeOffCents),
        creditCents: Math.max(0, -(source.amountCents + source.adjustmentCents - source.paidCents - source.writeOffCents)),
      } : null,
      sourceCapacity: {
        originalCents: source ? Number(source.amountCents) : 0,
        consumedCents: usedCents,
        remainingCents: remainingCapacityCents,
      },
      customerNetCents: customerNet,
    },
  });
}

export async function createSalesDiscount(db, req, res, actor) {
  allow(actor, 'SALES_DISCOUNT_MANAGE');
  const body = await readJson(req);
  const customerId = requiredText(body.customerId ?? body.customer_id, '客户', 100);
  if (!db.prepare('SELECT 1 FROM customers WHERE id=? AND active=1').get(customerId)) {
    throw new HttpError(400, '客户无效');
  }
  const sourceId = requiredText(body.sourceReceivableId ?? body.source_receivable_id, '来源应收', 100);
  const source = db.prepare(`SELECT id, customer_id, amount_cents, adjustment_cents, paid_cents, write_off_cents FROM account_receivables WHERE id=?`).get(sourceId);
  if (!source) throw new HttpError(400, '来源应收不存在');
  if (source.customer_id !== customerId) throw new HttpError(400, '来源应收必须属于同一客户');
  if (Number(source.amount_cents) <= 0) throw new HttpError(400, '来源应收必须为正数应收');
  const amountCents = readAmount(body.amountCents, '折让金额');
  const businessDate = readBusinessDate(body.businessDate ?? body.business_date, nowIso().slice(0, 10));
  const reason = optionalText(body.reason ?? '', MAX_REASON);
  const notes = optionalText(body.notes ?? '', MAX_NOTE);
  const discountId = genId();
  const discountNo = makeNumber('SD');
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO sales_discounts(id, discount_no, customer_id, source_receivable_id,
        amount_cents, status, business_date, reason, notes, creator_id, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)
    `).run(discountId, discountNo, customerId, sourceId, amountCents, businessDate, reason, notes, actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'SALES_DISCOUNT', discountId, `创建销售折让 ${discountNo}`);
  });
  return send(res, 201, { id: discountId, discountNo, status: 'DRAFT' });
}

export async function updateSalesDiscount(db, req, res, actor, discountId) {
  allow(actor, 'SALES_DISCOUNT_MANAGE');
  const current = fetchSalesDiscountHeader(db, discountId);
  if (!current) throw new HttpError(404, '销售折让单不存在');
  if (current.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的销售折让单可以修改');
  const body = await readJson(req);
  const customerId = requiredText(body.customerId ?? body.customer_id, '客户', 100);
  if (!db.prepare('SELECT 1 FROM customers WHERE id=? AND active=1').get(customerId)) {
    throw new HttpError(400, '客户无效');
  }
  const sourceId = requiredText(body.sourceReceivableId ?? body.source_receivable_id, '来源应收', 100);
  const source = db.prepare(`SELECT id, customer_id, amount_cents FROM account_receivables WHERE id=?`).get(sourceId);
  if (!source) throw new HttpError(400, '来源应收不存在');
  if (source.customer_id !== customerId) throw new HttpError(400, '来源应收必须属于同一客户');
  if (Number(source.amount_cents) <= 0) throw new HttpError(400, '来源应收必须为正数应收');
  const amountCents = readAmount(body.amountCents, '折让金额');
  const businessDate = readBusinessDate(body.businessDate ?? body.business_date, nowIso().slice(0, 10));
  const reason = optionalText(body.reason ?? current.reason, MAX_REASON);
  const notes = optionalText(body.notes ?? current.notes, MAX_NOTE);
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      UPDATE sales_discounts
         SET customer_id=?, source_receivable_id=?, amount_cents=?, business_date=?,
             reason=?, notes=?, updated_at=?
       WHERE id=?
    `).run(customerId, sourceId, amountCents, businessDate, reason, notes, now, discountId);
    audit(db, actor.id, 'UPDATE', 'SALES_DISCOUNT', discountId, `修改销售折让 ${current.discount_no}`);
  });
  return send(res, 200, { ok: true });
}

export function confirmSalesDiscount(db, res, actor, discountId, generateVoucher, checkPeriodNotClosedForVoucher) {
  allow(actor, 'SALES_DISCOUNT_MANAGE');
  const now = nowIso();
  transaction(db, () => {
    const discount = db.prepare('SELECT * FROM sales_discounts WHERE id=?').get(discountId);
    if (!discount) throw new HttpError(404, '销售折让单不存在');
    if (discount.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的销售折让单可以确认');

    const source = db.prepare(`SELECT id, source_type, source_id, customer_id, amount_cents, adjustment_cents, paid_cents, write_off_cents FROM account_receivables WHERE id=?`).get(discount.source_receivable_id);
    if (!source) throw new HttpError(400, '来源应收不存在');
    if (source.customer_id !== discount.customer_id) throw new HttpError(409, '来源应收必须属于同一客户');
    if (Number(source.amount_cents) <= 0) throw new HttpError(409, '来源应收必须为正数应收');

    // Source cap: total economic reductions attributable to one
    // original positive AR source must not exceed source.amount_cents.
    // SALES_RETURN + SALES_DISCOUNT both count. Collections do NOT.
    const usedCents = computeSourceCapacity(db, source);
    if (usedCents + Number(discount.amount_cents) > Number(source.amount_cents)) {
      throw new HttpError(409, `折让金额超过来源应收剩余可折让额度 ${Math.max(0, Number(source.amount_cents) - usedCents)}`);
    }

    // Closed period guard.
    checkPeriodNotClosedForVoucher(db, discount.business_date, '生成业务');

    // Create negative AR adjustment row.
    ensureReceivableSource(db, {
      id: discountId,
      sourceType: 'SALES_DISCOUNT',
      sourceNo: discount.discount_no,
      partyId: discount.customer_id,
      businessDate: discount.business_date,
      effectCents: -Number(discount.amount_cents),
      creatorId: discount.creator_id,
      createdAt: now,
    });

    // Canonical reversal voucher — Dr 6001 / Cr 1122, identical to
    // SALES_RETURN. Safe because the source voucher (SALES_DELIVERY
    // and SALES_RETURN both use subject-006 / subject-003) is already
    // canonical.
    const customerName = db.prepare('SELECT name FROM customers WHERE id=?').get(discount.customer_id)?.name || '';
    generateVoucher(db, 'SALES_DISCOUNT', discountId, [
      { subjectId: 'subject-006', direction: 'DEBIT', amountCents: Number(discount.amount_cents), summary: '销售折让 ' + discount.discount_no + ' 收入冲减' },
      { subjectId: 'subject-003', direction: 'CREDIT', amountCents: Number(discount.amount_cents), summary: '销售折让 ' + discount.discount_no + ' ' + customerName },
    ], actor, discount.business_date);

    db.prepare(`UPDATE sales_discounts SET status='CONFIRMED', confirmed_by=?, confirmed_at=?, updated_at=? WHERE id=?`).run(actor.id, now, now, discountId);
    audit(db, actor.id, 'CONFIRM', 'SALES_DISCOUNT', discountId, `确认销售折让 ${discount.discount_no}`);
  });
  return send(res, 200, { ok: true, status: 'CONFIRMED' });
}

export function cancelSalesDiscount(db, res, actor, discountId) {
  allow(actor, 'SALES_DISCOUNT_MANAGE');
  const now = nowIso();
  transaction(db, () => {
    const discount = db.prepare('SELECT * FROM sales_discounts WHERE id=?').get(discountId);
    if (!discount) throw new HttpError(404, '销售折让单不存在');
    if (discount.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的销售折让单可以取消');
    db.prepare(`UPDATE sales_discounts SET status='CANCELLED', cancelled_by=?, cancelled_at=?, updated_at=? WHERE id=?`).run(actor.id, now, now, discountId);
    audit(db, actor.id, 'CANCEL', 'SALES_DISCOUNT', discountId, `取消销售折让 ${discount.discount_no}`);
  });
  return send(res, 200, { ok: true, status: 'CANCELLED' });
}

// =====================================================================
// Purchase Discount — list / detail / create / update / confirm / cancel
// =====================================================================

function fetchPurchaseDiscountHeader(db, discountId) {
  return db.prepare(`
    SELECT d.*, s.code supplierCode, s.name supplierName, creator.display_name creatorName,
           confirmed.display_name confirmedByName, cancelled.display_name cancelledByName
      FROM purchase_discounts d
      JOIN suppliers s ON s.id = d.supplier_id
      JOIN users creator ON creator.id = d.creator_id
      LEFT JOIN users confirmed ON confirmed.id = d.confirmed_by
      LEFT JOIN users cancelled ON cancelled.id = d.cancelled_by
     WHERE d.id = ?
  `).get(discountId);
}

function fetchSourcePayable(db, discount) {
  return db.prepare(`SELECT id, voucher_no documentNo, supplier_id supplierId, amount_cents amountCents, adjustment_cents adjustmentCents, paid_cents paidCents, write_off_cents writeOffCents, status, source_type sourceType, source_id sourceId, business_date businessDate FROM account_payables WHERE id = ?`).get(discount.source_payable_id);
}

function computePurchaseSourceCapacity(db, payable) {
  // Sum of PURCHASE_RETURN + PURCHASE_DISCOUNT reductions linked to
  // the same source AP row.
  const returnCents = Number(db.prepare(`SELECT COALESCE(SUM(ABS(amount_cents)),0) n FROM account_payables WHERE source_type='PURCHASE_RETURN' AND source_id IN (SELECT id FROM purchase_returns WHERE receipt_id=? OR (receipt_id IS NULL AND source_id=?))`).get(payable.source_id, payable.source_id).n);
  const discountCents = Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM purchase_discounts WHERE source_payable_id=? AND status='CONFIRMED'`).get(payable.id).n);
  return returnCents + discountCents;
}

export function listPurchaseDiscounts(db, res, actor) {
  allowAny(actor, ['AP_VIEW', 'PURCHASE_DISCOUNT_MANAGE']);
  const rows = db.prepare(`
    SELECT d.id, d.discount_no discountNo, d.status, d.business_date businessDate,
           d.amount_cents amountCents, d.reason, d.notes, d.created_at createdAt,
           d.confirmed_at confirmedAt, s.code supplierCode, s.name supplierName,
           creator.display_name creatorName
      FROM purchase_discounts d
      JOIN suppliers s ON s.id = d.supplier_id
      JOIN users creator ON creator.id = d.creator_id
     ORDER BY d.created_at DESC
     LIMIT 100
  `).all().map((row) => ({
    ...row,
    amountCents: Number(row.amountCents),
    statusLabel: PURCHASE_STATUS[row.status] || row.status,
  }));
  return send(res, 200, { purchaseDiscounts: rows });
}

export function getPurchaseDiscount(db, res, actor, discountId) {
  allowAny(actor, ['AP_VIEW', 'PURCHASE_DISCOUNT_MANAGE']);
  const header = fetchPurchaseDiscountHeader(db, discountId);
  if (!header) throw new HttpError(404, '采购折让单不存在');
  const source = fetchSourcePayable(db, header);
  const usedCents = source ? computePurchaseSourceCapacity(db, source) : 0;
  const remainingCapacityCents = source ? Math.max(0, Number(source.amountCents) - usedCents) : 0;
  const supplierNet = db.prepare(`SELECT COALESCE(SUM(amount_cents + adjustment_cents - paid_cents - write_off_cents),0) n FROM account_payables WHERE supplier_id=?`).get(header.supplier_id).n;
  return send(res, 200, {
    purchaseDiscount: {
      ...header,
      amountCents: Number(header.amount_cents),
      statusLabel: PURCHASE_STATUS[header.status] || header.status,
      source: source ? {
        id: source.id,
        documentNo: source.documentNo,
        businessDate: source.businessDate,
        amountCents: Number(source.amountCents),
        outstandingCents: Math.max(0, source.amountCents + source.adjustmentCents - source.paidCents - source.writeOffCents),
        creditCents: Math.max(0, -(source.amountCents + source.adjustmentCents - source.paidCents - source.writeOffCents)),
      } : null,
      sourceCapacity: {
        originalCents: source ? Number(source.amountCents) : 0,
        consumedCents: usedCents,
        remainingCents: remainingCapacityCents,
      },
      supplierNetCents: supplierNet,
    },
  });
}

export async function createPurchaseDiscount(db, req, res, actor) {
  allow(actor, 'PURCHASE_DISCOUNT_MANAGE');
  const body = await readJson(req);
  const supplierId = requiredText(body.supplierId ?? body.supplier_id, '供应商', 100);
  if (!db.prepare('SELECT 1 FROM suppliers WHERE id=? AND active=1').get(supplierId)) {
    throw new HttpError(400, '供应商无效');
  }
  const sourceId = requiredText(body.sourcePayableId ?? body.source_payable_id, '来源应付', 100);
  const source = db.prepare(`SELECT id, supplier_id, amount_cents FROM account_payables WHERE id=?`).get(sourceId);
  if (!source) throw new HttpError(400, '来源应付不存在');
  if (source.supplier_id !== supplierId) throw new HttpError(400, '来源应付必须属于同一供应商');
  if (Number(source.amount_cents) <= 0) throw new HttpError(400, '来源应付必须为正数应付');
  const amountCents = readAmount(body.amountCents, '折让金额');
  const businessDate = readBusinessDate(body.businessDate ?? body.business_date, nowIso().slice(0, 10));
  const reason = optionalText(body.reason ?? '', MAX_REASON);
  const notes = optionalText(body.notes ?? '', MAX_NOTE);
  const discountId = genId();
  const discountNo = makeNumber('PD');
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO purchase_discounts(id, discount_no, supplier_id, source_payable_id,
        amount_cents, status, business_date, reason, notes, creator_id, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)
    `).run(discountId, discountNo, supplierId, sourceId, amountCents, businessDate, reason, notes, actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'PURCHASE_DISCOUNT', discountId, `创建采购折让 ${discountNo}`);
  });
  return send(res, 201, { id: discountId, discountNo, status: 'DRAFT' });
}

export async function updatePurchaseDiscount(db, req, res, actor, discountId) {
  allow(actor, 'PURCHASE_DISCOUNT_MANAGE');
  const current = fetchPurchaseDiscountHeader(db, discountId);
  if (!current) throw new HttpError(404, '采购折让单不存在');
  if (current.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的采购折让单可以修改');
  const body = await readJson(req);
  const supplierId = requiredText(body.supplierId ?? body.supplier_id, '供应商', 100);
  if (!db.prepare('SELECT 1 FROM suppliers WHERE id=? AND active=1').get(supplierId)) {
    throw new HttpError(400, '供应商无效');
  }
  const sourceId = requiredText(body.sourcePayableId ?? body.source_payable_id, '来源应付', 100);
  const source = db.prepare(`SELECT id, supplier_id, amount_cents FROM account_payables WHERE id=?`).get(sourceId);
  if (!source) throw new HttpError(400, '来源应付不存在');
  if (source.supplier_id !== supplierId) throw new HttpError(400, '来源应付必须属于同一供应商');
  if (Number(source.amount_cents) <= 0) throw new HttpError(400, '来源应付必须为正数应付');
  const amountCents = readAmount(body.amountCents, '折让金额');
  const businessDate = readBusinessDate(body.businessDate ?? body.business_date, nowIso().slice(0, 10));
  const reason = optionalText(body.reason ?? current.reason, MAX_REASON);
  const notes = optionalText(body.notes ?? current.notes, MAX_NOTE);
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      UPDATE purchase_discounts
         SET supplier_id=?, source_payable_id=?, amount_cents=?, business_date=?,
             reason=?, notes=?, updated_at=?
       WHERE id=?
    `).run(supplierId, sourceId, amountCents, businessDate, reason, notes, now, discountId);
    audit(db, actor.id, 'UPDATE', 'PURCHASE_DISCOUNT', discountId, `修改采购折让 ${current.discount_no}`);
  });
  return send(res, 200, { ok: true });
}

export function confirmPurchaseDiscount(db, res, actor, discountId, generateVoucher, checkPeriodNotClosedForVoucher) {
  allow(actor, 'PURCHASE_DISCOUNT_MANAGE');
  const now = nowIso();
  transaction(db, () => {
    const discount = db.prepare('SELECT * FROM purchase_discounts WHERE id=?').get(discountId);
    if (!discount) throw new HttpError(404, '采购折让单不存在');
    if (discount.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的采购折让单可以确认');

    const source = db.prepare(`SELECT id, source_type, source_id, supplier_id, amount_cents FROM account_payables WHERE id=?`).get(discount.source_payable_id);
    if (!source) throw new HttpError(400, '来源应付不存在');
    if (source.supplier_id !== discount.supplier_id) throw new HttpError(409, '来源应付必须属于同一供应商');
    if (Number(source.amount_cents) <= 0) throw new HttpError(409, '来源应付必须为正数应付');

    const usedCents = computePurchaseSourceCapacity(db, source);
    if (usedCents + Number(discount.amount_cents) > Number(source.amount_cents)) {
      throw new HttpError(409, `折让金额超过来源应付剩余可折让额度 ${Math.max(0, Number(source.amount_cents) - usedCents)}`);
    }

    checkPeriodNotClosedForVoucher(db, discount.business_date, '生成业务');

    ensurePayableSource(db, {
      id: discountId,
      sourceType: 'PURCHASE_DISCOUNT',
      sourceNo: discount.discount_no,
      partyId: discount.supplier_id,
      businessDate: discount.business_date,
      effectCents: -Number(discount.amount_cents),
      creatorId: discount.creator_id,
      createdAt: now,
    });

    // Canonical reversal voucher — Dr 2202 / Cr 1405, identical to
    // PURCHASE_RETURN. Safe because PURCHASE_RECEIPT and PURCHASE_RETURN
    // already use subject-005 / subject-004 in the same canonical
    // pattern.
    const supplierName = db.prepare('SELECT name FROM suppliers WHERE id=?').get(discount.supplier_id)?.name || '';
    generateVoucher(db, 'PURCHASE_DISCOUNT', discountId, [
      { subjectId: 'subject-005', direction: 'DEBIT', amountCents: Number(discount.amount_cents), summary: '采购折让 ' + discount.discount_no + ' ' + supplierName },
      { subjectId: 'subject-004', direction: 'CREDIT', amountCents: Number(discount.amount_cents), summary: '采购折让 ' + discount.discount_no + ' 存货冲减' },
    ], actor, discount.business_date);

    db.prepare(`UPDATE purchase_discounts SET status='CONFIRMED', confirmed_by=?, confirmed_at=?, updated_at=? WHERE id=?`).run(actor.id, now, now, discountId);
    audit(db, actor.id, 'CONFIRM', 'PURCHASE_DISCOUNT', discountId, `确认采购折让 ${discount.discount_no}`);
  });
  return send(res, 200, { ok: true, status: 'CONFIRMED' });
}

export function cancelPurchaseDiscount(db, res, actor, discountId) {
  allow(actor, 'PURCHASE_DISCOUNT_MANAGE');
  const now = nowIso();
  transaction(db, () => {
    const discount = db.prepare('SELECT * FROM purchase_discounts WHERE id=?').get(discountId);
    if (!discount) throw new HttpError(404, '采购折让单不存在');
    if (discount.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的采购折让单可以取消');
    db.prepare(`UPDATE purchase_discounts SET status='CANCELLED', cancelled_by=?, cancelled_at=?, updated_at=? WHERE id=?`).run(actor.id, now, now, discountId);
    audit(db, actor.id, 'CANCEL', 'PURCHASE_DISCOUNT', discountId, `取消采购折让 ${discount.discount_no}`);
  });
  return send(res, 200, { ok: true, status: 'CANCELLED' });
}