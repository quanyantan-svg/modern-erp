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
import { applyCreditAdjustment, reverseCreditAdjustment } from './settlement-core.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, readJson, requiredText, optionalText, send,
} from '../lib/http.js';
import { lifecycleArchiveFilter } from './lifecycle-engine.js';

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
  return db.prepare(`SELECT id, voucher_no documentNo, customer_id customerId, amount_cents amountCents, adjustment_cents adjustmentCents, paid_cents paidCents, write_off_cents writeOffCents, open_amount_cents openAmountCents, due_date dueDate, status, source_type sourceType, source_id sourceId, source_no sourceNo, business_date businessDate FROM account_receivables WHERE id = ?`).get(discount.source_receivable_id);
}

function computeSourceCapacity(db, receivable) {
  // Sum of SALES_RETURN + SALES_DISCOUNT reductions linked to the
  // same source AR row. Returns total negative economic reductions.
  // The AR row carries source_type + source_id pointing at the
  // original sales_delivery (for SALES_DELIVERY) or the return id
  // (for SALES_RETURN). For SALES_RETURN rows, the source_id is
  // the return id; the linked delivery_id lives on return_orders.
  return Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM financial_credit_adjustments WHERE side='AR' AND target_open_item_id=? AND status='CONFIRMED'`).get(receivable.id).n);
}

export function listSalesDiscounts(db, res, actor, url) {
  allowAny(actor, ['AR_VIEW', 'SALES_DISCOUNT_MANAGE']);
  const archiveFilter = lifecycleArchiveFilter('SALES_DISCOUNT', { includeArchived: url?.searchParams?.get('includeArchived') === 'true', idExpression: 'd.id' });
  const rows = db.prepare(`
    SELECT d.id, d.discount_no discountNo, d.status, d.business_date businessDate,
           d.amount_cents amountCents, d.reason, d.notes, d.created_at createdAt,
           d.confirmed_at confirmedAt, c.code customerCode, c.name customerName,
           creator.display_name creatorName, ar.source_no sourceNo, ar.business_date sourceDate,
           ar.due_date dueDate, ar.amount_cents originalCents, ar.open_amount_cents openCents,fc.status creditStatus
      FROM sales_discounts d
      JOIN customers c ON c.id = d.customer_id
      JOIN account_receivables ar ON ar.id=d.source_receivable_id
      LEFT JOIN financial_credit_adjustments fc ON fc.side='AR' AND fc.source_type='SALES_DISCOUNT' AND fc.source_id=d.id
     JOIN users creator ON creator.id = d.creator_id
     ${archiveFilter.clause ? `WHERE ${archiveFilter.clause}` : ''}
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
  const customerOpen = Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN item_class='SOURCE' THEN open_amount_cents ELSE MAX(0,amount_cents+adjustment_cents-paid_cents-write_off_cents) END),0) n FROM account_receivables WHERE customer_id=?`).get(header.customer_id).n);
  const customerCredit = Number(db.prepare("SELECT COALESCE(SUM(unapplied_cents),0) n FROM financial_credit_adjustments WHERE side='AR' AND party_id=? AND status='CONFIRMED'").get(header.customer_id).n);
  const customerNet = customerOpen - customerCredit;
  const credit = db.prepare("SELECT applied_cents appliedCents,unapplied_cents unappliedCents,status,reversal_date reversalDate,reversal_reason reversalReason FROM financial_credit_adjustments WHERE side='AR' AND source_type='SALES_DISCOUNT' AND source_id=?").get(discountId);
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
        outstandingCents: Number(source.openAmountCents),
        creditCents: Math.max(0, -(source.amountCents + source.adjustmentCents - source.paidCents - source.writeOffCents)),
      } : null,
      sourceCapacity: {
        originalCents: source ? Number(source.amountCents) : 0,
        consumedCents: usedCents,
        remainingCents: remainingCapacityCents,
      },
      customerNetCents: customerNet,
      credit,
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
  const source = db.prepare(`SELECT id, customer_id, amount_cents, adjustment_cents, paid_cents, write_off_cents FROM account_receivables WHERE id=? AND item_class='SOURCE'`).get(sourceId);
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
  const source = db.prepare(`SELECT id, customer_id, amount_cents FROM account_receivables WHERE id=? AND item_class='SOURCE'`).get(sourceId);
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

    const source = db.prepare(`SELECT id, source_type, source_id, customer_id, amount_cents, adjustment_cents, paid_cents, write_off_cents FROM account_receivables WHERE id=? AND item_class='SOURCE'`).get(discount.source_receivable_id);
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

    applyCreditAdjustment(db, {
      side: 'AR', adjustmentType: 'DISCOUNT', sourceType: 'SALES_DISCOUNT', sourceId: discountId,
      sourceNo: discount.discount_no, targetOpenItemId: source.id, partyId: discount.customer_id,
      businessDate: discount.business_date, amountCents: Number(discount.amount_cents), actorId: actor.id, createdAt: now,
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
  return db.prepare(`SELECT id, voucher_no documentNo, supplier_id supplierId, amount_cents amountCents, adjustment_cents adjustmentCents, paid_cents paidCents, write_off_cents writeOffCents, open_amount_cents openAmountCents, due_date dueDate, status, source_type sourceType, source_id sourceId, source_no sourceNo, business_date businessDate FROM account_payables WHERE id = ?`).get(discount.source_payable_id);
}

function computePurchaseSourceCapacity(db, payable) {
  // Sum of PURCHASE_RETURN + PURCHASE_DISCOUNT reductions linked to
  // the same source AP row.
  return Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM financial_credit_adjustments WHERE side='AP' AND target_open_item_id=? AND status='CONFIRMED'`).get(payable.id).n);
}

export function listPurchaseDiscounts(db, res, actor, url) {
  allowAny(actor, ['AP_VIEW', 'PURCHASE_DISCOUNT_MANAGE']);
  const archiveFilter = lifecycleArchiveFilter('PURCHASE_DISCOUNT', { includeArchived: url?.searchParams?.get('includeArchived') === 'true', idExpression: 'd.id' });
  const rows = db.prepare(`
    SELECT d.id, d.discount_no discountNo, d.status, d.business_date businessDate,
           d.amount_cents amountCents, d.reason, d.notes, d.created_at createdAt,
           d.confirmed_at confirmedAt, s.code supplierCode, s.name supplierName,
           creator.display_name creatorName, ap.source_no sourceNo, ap.business_date sourceDate,
           ap.due_date dueDate, ap.amount_cents originalCents, ap.open_amount_cents openCents,fc.status creditStatus
      FROM purchase_discounts d
      JOIN suppliers s ON s.id = d.supplier_id
      JOIN account_payables ap ON ap.id=d.source_payable_id
      LEFT JOIN financial_credit_adjustments fc ON fc.side='AP' AND fc.source_type='PURCHASE_DISCOUNT' AND fc.source_id=d.id
     JOIN users creator ON creator.id = d.creator_id
     ${archiveFilter.clause ? `WHERE ${archiveFilter.clause}` : ''}
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
  const supplierOpen = Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN item_class='SOURCE' THEN open_amount_cents ELSE MAX(0,amount_cents+adjustment_cents-paid_cents-write_off_cents) END),0) n FROM account_payables WHERE supplier_id=?`).get(header.supplier_id).n);
  const supplierCredit = Number(db.prepare("SELECT COALESCE(SUM(unapplied_cents),0) n FROM financial_credit_adjustments WHERE side='AP' AND party_id=? AND status='CONFIRMED'").get(header.supplier_id).n);
  const supplierNet = supplierOpen - supplierCredit;
  const credit = db.prepare("SELECT applied_cents appliedCents,unapplied_cents unappliedCents,status,reversal_date reversalDate,reversal_reason reversalReason FROM financial_credit_adjustments WHERE side='AP' AND source_type='PURCHASE_DISCOUNT' AND source_id=?").get(discountId);
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
        outstandingCents: Number(source.openAmountCents),
        creditCents: Math.max(0, -(source.amountCents + source.adjustmentCents - source.paidCents - source.writeOffCents)),
      } : null,
      sourceCapacity: {
        originalCents: source ? Number(source.amountCents) : 0,
        consumedCents: usedCents,
        remainingCents: remainingCapacityCents,
      },
      supplierNetCents: supplierNet,
      credit,
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
  const source = db.prepare(`SELECT id, supplier_id, amount_cents FROM account_payables WHERE id=? AND item_class='SOURCE'`).get(sourceId);
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
  const source = db.prepare(`SELECT id, supplier_id, amount_cents FROM account_payables WHERE id=? AND item_class='SOURCE'`).get(sourceId);
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

    const source = db.prepare(`SELECT id, source_type, source_id, supplier_id, amount_cents FROM account_payables WHERE id=? AND item_class='SOURCE'`).get(discount.source_payable_id);
    if (!source) throw new HttpError(400, '来源应付不存在');
    if (source.supplier_id !== discount.supplier_id) throw new HttpError(409, '来源应付必须属于同一供应商');
    if (Number(source.amount_cents) <= 0) throw new HttpError(409, '来源应付必须为正数应付');

    const usedCents = computePurchaseSourceCapacity(db, source);
    if (usedCents + Number(discount.amount_cents) > Number(source.amount_cents)) {
      throw new HttpError(409, `折让金额超过来源应付剩余可折让额度 ${Math.max(0, Number(source.amount_cents) - usedCents)}`);
    }

    checkPeriodNotClosedForVoucher(db, discount.business_date, '生成业务');

    applyCreditAdjustment(db, {
      side: 'AP', adjustmentType: 'DISCOUNT', sourceType: 'PURCHASE_DISCOUNT', sourceId: discountId,
      sourceNo: discount.discount_no, targetOpenItemId: source.id, partyId: discount.supplier_id,
      businessDate: discount.business_date, amountCents: Number(discount.amount_cents), actorId: actor.id, createdAt: now,
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

async function reverseDiscount(db, req, res, actor, side, discountId, generateVoucher, checkPeriodNotClosedForVoucher) {
  const sales = side === 'AR';
  allow(actor, sales ? 'SALES_DISCOUNT_MANAGE' : 'PURCHASE_DISCOUNT_MANAGE');
  const table = sales ? 'sales_discounts' : 'purchase_discounts';
  const sourceType = sales ? 'SALES_DISCOUNT' : 'PURCHASE_DISCOUNT';
  const body = await readJson(req);
  const reversalDate = readBusinessDate(body.businessDate ?? body.business_date, nowIso().slice(0, 10));
  const reason = requiredText(body.reason, '冲销原因', MAX_REASON);
  checkPeriodNotClosedForVoucher(db, reversalDate, '生成折让冲销');
  transaction(db, () => {
    const discount = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(discountId);
    if (!discount) throw new HttpError(404, sales ? '销售折让单不存在' : '采购折让单不存在');
    if (discount.status !== 'CONFIRMED') throw new HttpError(409, '只有已确认折让可以冲销');
    let credit;
    try { credit = reverseCreditAdjustment(db, side, sourceType, discountId, actor.id, reversalDate, reason); }
    catch (error) { throw new HttpError(409, error.message); }
    const originalVoucher = db.prepare('SELECT id FROM accounting_vouchers WHERE source_type=? AND source_id=?').get(sourceType, discountId);
    if (!originalVoucher) throw new HttpError(409, '折让原始凭证不存在');
    const entries = db.prepare('SELECT subject_id subjectId,direction,amount_cents amountCents,summary FROM accounting_entries WHERE voucher_id=?').all(originalVoucher.id)
      .map((entry) => ({ ...entry, direction: entry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT', summary: `${entry.summary} 冲销` }));
    generateVoucher(db, `${sourceType}_REVERSAL`, discountId, entries, actor, reversalDate);
    audit(db, actor.id, 'REVERSE', sourceType, discountId, `${sales ? '销售' : '采购'}折让冲销 ${credit.amount_cents} 分：${reason}`);
  });
  return send(res, 200, { ok: true, status: 'REVERSED' });
}

export function reverseSalesDiscount(db, req, res, actor, discountId, generateVoucher, checkPeriodNotClosedForVoucher) {
  return reverseDiscount(db, req, res, actor, 'AR', discountId, generateVoucher, checkPeriodNotClosedForVoucher);
}

export function reversePurchaseDiscount(db, req, res, actor, discountId, generateVoucher, checkPeriodNotClosedForVoucher) {
  return reverseDiscount(db, req, res, actor, 'AP', discountId, generateVoucher, checkPeriodNotClosedForVoucher);
}
