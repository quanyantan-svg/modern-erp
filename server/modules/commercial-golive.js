import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { HttpError, allowAny, readJson, send } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { applyCreditAdjustment, ensurePayableSource, ensureReceivableSource } from './settlement-core.js';
import { assertFinancialPeriodsOpen, createSystemVoucher, inventoryAccountRole, receiveValue, systemHealth } from './financial-inventory.js';

const stamp = () => new Date().toISOString();
const int = (value, label, { min = 0 } = {}) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min) throw new HttpError(400, `${label}必须为不小于${min}的安全整数`);
  return number;
};
const positiveInt = (value, label) => int(value, label, { min: 1 });
const gcd = (a, b) => { let x = Math.abs(a); let y = Math.abs(b); while (y) [x, y] = [y, x % y]; return x || 1; };
export function rational(num, den = 1) {
  const n = int(num, '分子'); const d = positiveInt(den, '分母'); const factor = gcd(n, d);
  return { num: n / factor, den: d / factor };
}
export function multiplyRational(left, right) { return rational(left.num * right.num, left.den * right.den); }
export function compareRational(left, right) {
  const value = BigInt(left.num) * BigInt(right.den) - BigInt(right.num) * BigInt(left.den);
  return value < 0n ? -1 : value > 0n ? 1 : 0;
}
export function addRational(left, right) { return rational(left.num * right.den + right.num * left.den, left.den * right.den); }
export function roundRational(num, den) {
  const n = BigInt(num); const d = BigInt(den); const sign = n < 0n ? -1n : 1n; const abs = n < 0n ? -n : n;
  return Number(sign * ((abs * 2n + d) / (2n * d)));
}

export function calculateLineTax({ amountCents, mode = 'NO_TAX', rateNumerator = 0, rateDenominator = 1 }) {
  const amount = int(amountCents, '行金额'); const rn = int(rateNumerator, '税率分子'); const rd = positiveInt(rateDenominator, '税率分母');
  if (mode === 'NO_TAX' || rn === 0) return { netCents: amount, taxCents: 0, grossCents: amount };
  if (mode === 'EXCLUSIVE') { const tax = roundRational(BigInt(amount) * BigInt(rn), rd); return { netCents: amount, taxCents: tax, grossCents: amount + tax }; }
  if (mode === 'INCLUSIVE') { const net = roundRational(BigInt(amount) * BigInt(rd), BigInt(rd) + BigInt(rn)); return { netCents: net, taxCents: amount - net, grossCents: amount }; }
  throw new HttpError(400, '无效税模式');
}

export function allocateDocumentNumber(db, documentType, businessDate, idempotencyKey) {
  const existing = db.prepare('SELECT document_no FROM document_number_allocations WHERE idempotency_key=?').get(idempotencyKey);
  if (existing) return existing.document_no;
  const period = String(businessDate).slice(0, 7).replace('-', '');
  const row = db.prepare(`INSERT INTO document_sequences(document_type,period_key,next_value) VALUES(?,?,2)
    ON CONFLICT(document_type,period_key) DO UPDATE SET next_value=next_value+1 RETURNING next_value-1 allocated`).get(documentType, period);
  const number = `${documentType}-${period}-${String(row.allocated).padStart(5, '0')}`;
  db.prepare('INSERT INTO document_number_allocations(idempotency_key,document_type,document_no,created_at) VALUES(?,?,?,?)').run(idempotencyKey, documentType, number, stamp());
  return number;
}

function atomic(db, work) { return db.isTransaction ? work() : transaction(db, work); }
function taxSnapshot(db, code, date) {
  if (!code) return { code: null, rateNumerator: 0, rateDenominator: 1, version: 0, name: '无税' };
  const row = db.prepare(`SELECT * FROM tax_codes WHERE code=? AND active=1 AND effective_from<=?
    AND (effective_to IS NULL OR effective_to>=?) ORDER BY version DESC LIMIT 1`).get(code, date, date);
  if (!row) throw new HttpError(409, `税码 ${code} 在单据日期无效`);
  return { code: row.code, name: row.name, rateNumerator: row.rate_numerator, rateDenominator: row.rate_denominator, version: row.version };
}
function conversionSnapshot(db, productId, uomCode, date) {
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(productId);
  if (!product) throw new HttpError(400, '产品不存在');
  const unit = uomCode || product.base_uom_code;
  if (unit === product.base_uom_code) return { uomCode: unit, baseUomCode: unit, numerator: 1, denominator: 1, version: 0 };
  const row = db.prepare(`SELECT * FROM product_uom_conversions WHERE product_id=? AND uom_code=? AND active=1 AND effective_from<=?
    AND (effective_to IS NULL OR effective_to>=?) ORDER BY version DESC LIMIT 1`).get(productId, unit, date, date);
  if (!row) throw new HttpError(409, `产品缺少 ${unit} 到基础单位的有效换算`);
  return { uomCode: unit, baseUomCode: row.base_uom_code, numerator: row.numerator, denominator: row.denominator, version: row.version };
}
export function quantitySnapshot(db, productId, input, date) {
  const doc = rational(input.quantityNumerator ?? input.quantity ?? input.documentQuantity, input.quantityDenominator ?? 1);
  if (doc.num <= 0) throw new HttpError(400, '数量必须大于 0');
  const conversion = conversionSnapshot(db, productId, input.uomCode, date);
  const base = multiplyRational(doc, { num: conversion.numerator, den: conversion.denominator });
  const product = db.prepare('SELECT tracking_policy FROM products WHERE id=?').get(productId);
  if (product?.tracking_policy === 'SERIAL' && base.den !== 1) throw new HttpError(409, 'SERIAL 换算后基础数量必须为整数');
  return { doc, base, conversion };
}
function lineAmount(quantity, unitPriceCents) { return roundRational(BigInt(quantity.num) * BigInt(int(unitPriceCents, '单价')), quantity.den); }
function sumLines(lines) { return lines.reduce((totals, line) => ({ netCents: totals.netCents + line.netCents, taxCents: totals.taxCents + line.taxCents, grossCents: totals.grossCents + line.grossCents }), { netCents: 0, taxCents: 0, grossCents: 0 }); }

export function createTaxCode(db, input) {
  const date = input.effectiveFrom || new Date().toISOString().slice(0, 10); const now = stamp();
  const version = Number(db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM tax_codes WHERE code=?').get(input.code).n);
  const id = randomUUID();
  db.prepare('INSERT INTO tax_codes(id,code,name,rate_numerator,rate_denominator,active,effective_from,effective_to,version,created_at) VALUES(?,?,?,?,?,1,?,?,?,?)')
    .run(id, input.code, input.name, int(input.rateNumerator, '税率分子'), positiveInt(input.rateDenominator, '税率分母'), date, input.effectiveTo || null, version, now);
  return db.prepare('SELECT * FROM tax_codes WHERE id=?').get(id);
}

export function createUomConversion(db, input) {
  const now = stamp(); const id = randomUUID();
  db.prepare('INSERT OR IGNORE INTO uoms(code,name,created_at,updated_at) VALUES(?,?,?,?)').run(input.uomCode, input.uomName || input.uomCode, now, now);
  const product = db.prepare('SELECT base_uom_code FROM products WHERE id=?').get(input.productId); if (!product) throw new HttpError(404, '产品不存在');
  const version = Number(db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM product_uom_conversions WHERE product_id=? AND uom_code=?').get(input.productId, input.uomCode).n);
  db.prepare('INSERT INTO product_uom_conversions(id,product_id,uom_code,base_uom_code,numerator,denominator,version,effective_from,effective_to,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, input.productId, input.uomCode, product.base_uom_code, positiveInt(input.numerator, '换算分子'), positiveInt(input.denominator, '换算分母'), version, input.effectiveFrom || new Date().toISOString().slice(0, 10), input.effectiveTo || null, now);
  return db.prepare('SELECT * FROM product_uom_conversions WHERE id=?').get(id);
}

function prepareSalesLines(db, customerId, date, mode, inputs) {
  if (!Array.isArray(inputs) || !inputs.length) throw new HttpError(400, '销售发票至少需要一行');
  return inputs.map((input, index) => {
    const source = db.prepare(`SELECT i.*,d.customer_id,d.status delivery_status FROM sales_delivery_items i
      JOIN sales_deliveries d ON d.id=i.delivery_id WHERE i.id=?`).get(input.deliveryItemId);
    if (!source || source.delivery_status !== 'CONFIRMED') throw new HttpError(409, '只能对已确认出货开票');
    if (source.customer_id !== customerId) throw new HttpError(409, '合并开票必须属于同一客户');
    const qty = quantitySnapshot(db, source.product_id, input, date);
    const billed = db.prepare(`SELECT COALESCE(SUM(i.base_quantity_num*1.0/i.base_quantity_den),0) n FROM sales_invoice_items i
      JOIN sales_invoices h ON h.id=i.invoice_id WHERE i.delivery_item_id=? AND h.status IN ('POSTED','DRAFT')`).get(source.id).n;
    if (Number(billed) + qty.base.num / qty.base.den > Number(source.quantity) + 1e-9) throw new HttpError(409, '开票数量超过已确认交付剩余数量');
    const tax = taxSnapshot(db, input.taxCode, date); const amount = lineAmount(qty.doc, input.unitPriceCents ?? source.unit_price_cents);
    return { id: randomUUID(), deliveryId: source.delivery_id, deliveryItemId: source.id, productId: source.product_id, qty,
      unitPriceCents: int(input.unitPriceCents ?? source.unit_price_cents, '单价'), tax, ...calculateLineTax({ amountCents: amount, mode, rateNumerator: tax.rateNumerator, rateDenominator: tax.rateDenominator }), lineNo: index + 1 };
  });
}

export function createSalesInvoice(db, input) {
  return atomic(db, () => {
    const existing = input.idempotencyKey && db.prepare('SELECT * FROM sales_invoices WHERE idempotency_key=?').get(input.idempotencyKey); if (existing) return existing;
    const date = input.invoiceDate; assertFinancialPeriodsOpen(db, date); const lines = prepareSalesLines(db, input.customerId, date, input.taxMode || 'NO_TAX', input.items); const totals = sumLines(lines);
    const invoiceId = randomUUID(); const now = stamp(); const invoiceNo = allocateDocumentNumber(db, 'SI', date, input.idempotencyKey || `SI:${invoiceId}`);
    db.prepare(`INSERT INTO sales_invoices(id,invoice_no,customer_id,invoice_date,status,tax_mode,net_cents,tax_cents,gross_cents,tax_snapshot_json,creator_id,created_at,idempotency_key)
      VALUES(?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?)`).run(invoiceId, invoiceNo, input.customerId, date, input.taxMode || 'NO_TAX', totals.netCents, totals.taxCents, totals.grossCents, JSON.stringify(lines.map(x => x.tax)), input.actorId, now, input.idempotencyKey || null);
    const insert = db.prepare(`INSERT INTO sales_invoice_items(id,invoice_id,delivery_id,delivery_item_id,product_id,document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den,unit_price_cents,net_cents,tax_cents,gross_cents,tax_code,tax_rate_numerator,tax_rate_denominator,line_no) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const line of lines) insert.run(line.id, invoiceId, line.deliveryId, line.deliveryItemId, line.productId, line.qty.conversion.uomCode, line.qty.doc.num, line.qty.doc.den, line.qty.conversion.numerator, line.qty.conversion.denominator, line.qty.base.num, line.qty.base.den, line.unitPriceCents, line.netCents, line.taxCents, line.grossCents, line.tax.code, line.tax.rateNumerator, line.tax.rateDenominator, line.lineNo);
    audit(db, input.actorId, 'CREATE', 'SALES_INVOICE', invoiceId, `创建销售发票 ${invoiceNo}`);
    return db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(invoiceId);
  });
}

export function postSalesInvoice(db, invoiceId, actorId) {
  return atomic(db, () => {
    const invoice = db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(invoiceId); if (!invoice) throw new HttpError(404, '销售发票不存在'); if (invoice.status === 'POSTED') return invoice; if (invoice.status !== 'DRAFT') throw new HttpError(409, '只能过账草稿发票');
    assertFinancialPeriodsOpen(db, invoice.invoice_date); const lines = db.prepare('SELECT * FROM sales_invoice_items WHERE invoice_id=?').all(invoiceId);
    for (const line of lines) {
      const delivered = db.prepare('SELECT quantity FROM sales_delivery_items WHERE id=?').get(line.delivery_item_id)?.quantity;
      const posted = db.prepare(`SELECT COALESCE(SUM(i.base_quantity_num*1.0/i.base_quantity_den),0) n FROM sales_invoice_items i JOIN sales_invoices h ON h.id=i.invoice_id WHERE i.delivery_item_id=? AND h.status='POSTED' AND h.id<>?`).get(line.delivery_item_id, invoiceId).n;
      if (Number(posted) + line.base_quantity_num / line.base_quantity_den > Number(delivered) + 1e-9) throw new HttpError(409, '累计开票数量超过已交付数量');
    }
    createSystemVoucher(db, { sourceType: 'SALES_INVOICE', sourceId: invoiceId, businessDate: invoice.invoice_date, actorId, entries: [
      { role: 'ACCOUNTS_RECEIVABLE', direction: 'DEBIT', amountCents: invoice.gross_cents, summary: `销售发票 ${invoice.invoice_no}` },
      { role: 'SALES_REVENUE', direction: 'CREDIT', amountCents: invoice.net_cents, summary: '销售收入' },
      ...(invoice.tax_cents ? [{ role: 'OUTPUT_TAX_PAYABLE', direction: 'CREDIT', amountCents: invoice.tax_cents, summary: '销项税' }] : []),
    ] });
    ensureReceivableSource(db, { id: invoiceId, sourceType: 'SALES_INVOICE', sourceNo: invoice.invoice_no, partyId: invoice.customer_id, businessDate: invoice.invoice_date, effectCents: invoice.gross_cents, creatorId: invoice.creator_id, createdAt: invoice.created_at });
    db.prepare("UPDATE sales_invoices SET status='POSTED',posted_by=?,posted_at=? WHERE id=?").run(actorId, stamp(), invoiceId); audit(db, actorId, 'POST', 'SALES_INVOICE', invoiceId, `过账 ${invoice.invoice_no}`);
    return db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(invoiceId);
  });
}

function prepareBillLines(db, supplierId, date, mode, inputs) {
  if (!Array.isArray(inputs) || !inputs.length) throw new HttpError(400, '供应商账单至少需要一行');
  return inputs.map((input, index) => {
    const source = input.receiptItemId ? db.prepare(`SELECT i.*,r.supplier_id,r.status receipt_status FROM purchase_receipt_items i JOIN purchase_receipts r ON r.id=i.receipt_id WHERE i.id=?`).get(input.receiptItemId) : null;
    const productId = source?.product_id || input.productId; const qty = quantitySnapshot(db, productId, input, date); const tax = taxSnapshot(db, input.taxCode, date);
    if (source && source.supplier_id !== supplierId) throw new HttpError(409, '收货与账单供应商不一致');
    if (source) { const billed = db.prepare(`SELECT COALESCE(SUM(i.base_quantity_num*1.0/i.base_quantity_den),0) n FROM supplier_bill_items i JOIN supplier_bills h ON h.id=i.bill_id WHERE i.receipt_item_id=? AND h.status IN ('POSTED','DRAFT','WAITING_MATCH')`).get(source.id).n; if (Number(billed) + qty.base.num / qty.base.den > Number(source.quantity) + 1e-9) throw new HttpError(409, '账单数量超过已收货剩余数量'); }
    const unit = int(input.unitPriceCents ?? source?.unit_price_cents, '单价'); const amount = lineAmount(qty.doc, unit); const calculated = calculateLineTax({ amountCents: amount, mode, rateNumerator: tax.rateNumerator, rateDenominator: tax.rateDenominator });
    const grni = source ? roundRational(BigInt(source.unit_price_cents) * BigInt(qty.base.num), qty.base.den) : 0;
    return { id: randomUUID(), source, productId, qty, tax, unitPriceCents: unit, grniCents: grni, ...calculated, lineNo: index + 1 };
  });
}

export function createSupplierBill(db, input) {
  return atomic(db, () => {
    const existing = input.idempotencyKey && db.prepare('SELECT * FROM supplier_bills WHERE idempotency_key=?').get(input.idempotencyKey); if (existing) return existing;
    const lines = prepareBillLines(db, input.supplierId, input.billDate, input.taxMode || 'NO_TAX', input.items); const totals = sumLines(lines); const grni = lines.reduce((sum, x) => sum + x.grniCents, 0); const matched = lines.every(x => x.source?.receipt_status === 'CONFIRMED');
    const id = randomUUID(); const now = stamp(); const no = allocateDocumentNumber(db, 'PB', input.billDate, input.idempotencyKey || `PB:${id}`);
    db.prepare(`INSERT INTO supplier_bills(id,bill_no,supplier_id,supplier_invoice_no,bill_date,status,tax_mode,net_cents,tax_cents,gross_cents,grni_cents,variance_cents,tax_snapshot_json,creator_id,created_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, no, input.supplierId, input.supplierInvoiceNo, input.billDate, matched ? 'DRAFT' : 'WAITING_MATCH', input.taxMode || 'NO_TAX', totals.netCents, totals.taxCents, totals.grossCents, grni, totals.netCents - grni, JSON.stringify(lines.map(x => x.tax)), input.actorId, now, input.idempotencyKey || null);
    const insert = db.prepare(`INSERT INTO supplier_bill_items(id,bill_id,receipt_id,receipt_item_id,purchase_order_item_id,product_id,document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den,unit_price_cents,matched_unit_price_cents,net_cents,tax_cents,gross_cents,tax_code,tax_rate_numerator,tax_rate_denominator,line_no) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const x of lines) insert.run(x.id, id, x.source?.receipt_id || null, x.source?.id || null, x.source?.purchase_order_item_id || null, x.productId, x.qty.conversion.uomCode, x.qty.doc.num, x.qty.doc.den, x.qty.conversion.numerator, x.qty.conversion.denominator, x.qty.base.num, x.qty.base.den, x.unitPriceCents, x.source?.unit_price_cents ?? null, x.netCents, x.taxCents, x.grossCents, x.tax.code, x.tax.rateNumerator, x.tax.rateDenominator, x.lineNo);
    return db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(id);
  });
}

export function postSupplierBill(db, billId, actorId) {
  return atomic(db, () => {
    const bill = db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(billId); if (!bill) throw new HttpError(404, '供应商账单不存在'); if (bill.status === 'POSTED') return bill; if (bill.status === 'WAITING_MATCH') throw new HttpError(409, '发票尚未完成收货匹配'); if (bill.status !== 'DRAFT') throw new HttpError(409, '只能过账草稿账单');
    assertFinancialPeriodsOpen(db, bill.bill_date); const variance = Number(bill.variance_cents);
    createSystemVoucher(db, { sourceType: 'SUPPLIER_BILL', sourceId: billId, businessDate: bill.bill_date, actorId, entries: [
      { role: 'GRNI', direction: 'DEBIT', amountCents: bill.grni_cents, summary: `结转 GRNI ${bill.bill_no}` },
      ...(bill.tax_cents ? [{ role: 'INPUT_TAX_RECEIVABLE', direction: 'DEBIT', amountCents: bill.tax_cents, summary: '进项税' }] : []),
      ...(variance > 0 ? [{ role: 'PURCHASE_PRICE_VARIANCE', direction: 'DEBIT', amountCents: variance, summary: '采购价差' }] : variance < 0 ? [{ role: 'PURCHASE_PRICE_VARIANCE', direction: 'CREDIT', amountCents: -variance, summary: '采购价差' }] : []),
      { role: 'ACCOUNTS_PAYABLE', direction: 'CREDIT', amountCents: bill.gross_cents, summary: `供应商账单 ${bill.bill_no}` },
    ] });
    ensurePayableSource(db, { id: billId, sourceType: 'SUPPLIER_BILL', sourceNo: bill.bill_no, partyId: bill.supplier_id, businessDate: bill.bill_date, effectCents: bill.gross_cents, creatorId: bill.creator_id, createdAt: bill.created_at });
    db.prepare("UPDATE supplier_bills SET status='POSTED',posted_by=?,posted_at=? WHERE id=?").run(actorId, stamp(), billId); return db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(billId);
  });
}

export function matchSupplierBill(db,billId,input){return atomic(db,()=>{const bill=db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(billId);if(!bill||!['WAITING_MATCH','DRAFT'].includes(bill.status))throw new HttpError(409,'账单状态不允许匹配');for(const match of input.items||[]){const line=db.prepare('SELECT * FROM supplier_bill_items WHERE id=? AND bill_id=?').get(match.billItemId,billId);const receipt=db.prepare(`SELECT i.*,h.supplier_id,h.status receipt_status FROM purchase_receipt_items i JOIN purchase_receipts h ON h.id=i.receipt_id WHERE i.id=?`).get(match.receiptItemId);if(!line||!receipt||receipt.receipt_status!=='CONFIRMED'||receipt.supplier_id!==bill.supplier_id||receipt.product_id!==line.product_id)throw new HttpError(409,'三单匹配来源不一致');const billed=Number(db.prepare("SELECT COALESCE(SUM(i.base_quantity_num*1.0/i.base_quantity_den),0)n FROM supplier_bill_items i JOIN supplier_bills h ON h.id=i.bill_id WHERE i.receipt_item_id=? AND h.status IN ('DRAFT','WAITING_MATCH','POSTED') AND h.id<>?").get(receipt.id,billId).n);const qty=line.base_quantity_num/line.base_quantity_den;if(billed+qty>Number(receipt.quantity)+1e-9)throw new HttpError(409,'匹配数量超过已收货数量');db.prepare('UPDATE supplier_bill_items SET receipt_id=?,receipt_item_id=?,purchase_order_item_id=?,matched_unit_price_cents=? WHERE id=?').run(receipt.receipt_id,receipt.id,receipt.purchase_order_item_id,receipt.unit_price_cents,line.id);}const unmatched=Number(db.prepare('SELECT COUNT(*)n FROM supplier_bill_items WHERE bill_id=? AND receipt_item_id IS NULL').get(billId).n);const grni=Number(db.prepare('SELECT COALESCE(SUM(matched_unit_price_cents*base_quantity_num/base_quantity_den),0)n FROM supplier_bill_items WHERE bill_id=?').get(billId).n);db.prepare('UPDATE supplier_bills SET status=?,grni_cents=?,variance_cents=net_cents-? WHERE id=?').run(unmatched?'WAITING_MATCH':'DRAFT',grni,grni,billId);return db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(billId);});}

export function createCommercialCreditNote(db, input) {
  return atomic(db, () => {
    const sales = input.side === 'AR'; const header = db.prepare(`SELECT * FROM ${sales ? 'sales_invoices' : 'supplier_bills'} WHERE id=? AND status='POSTED'`).get(input.sourceId); if (!header) throw new HttpError(409, '只能对已过账发票/账单开具贷项');
    const gross = int(input.grossCents ?? header.gross_cents, '贷项总额', { min: 1 }); if (gross > header.gross_cents) throw new HttpError(409, '贷项不能超过原单');
    const net = roundRational(BigInt(gross) * BigInt(header.net_cents), header.gross_cents); const tax = gross - net; const id = randomUUID(); const no = allocateDocumentNumber(db, sales ? 'SCN' : 'PCN', input.creditDate, input.idempotencyKey || `CN:${id}`); const now = stamp();
    db.prepare(`INSERT INTO commercial_credit_notes(id,credit_no,side,source_type,source_id,party_id,credit_date,reason,status,net_cents,tax_cents,gross_cents,tax_snapshot_json,creator_id,created_at,posted_by,posted_at,idempotency_key) VALUES(?,?,?,?,?,?,?,?, 'POSTED',?,?,?,?,?,?,?,?,?)`)
      .run(id, no, input.side, sales ? 'SALES_INVOICE' : 'SUPPLIER_BILL', header.id, sales ? header.customer_id : header.supplier_id, input.creditDate, input.reason || '调整', net, tax, gross, header.tax_snapshot_json, input.actorId, now, input.actorId, now, input.idempotencyKey || null);
    createSystemVoucher(db, { sourceType: sales ? 'SALES_CREDIT_NOTE' : 'SUPPLIER_CREDIT_NOTE', sourceId: id, businessDate: input.creditDate, actorId: input.actorId, entries: sales ? [
      { role: 'SALES_REVENUE', direction: 'DEBIT', amountCents: net, summary: no }, ...(tax ? [{ role: 'OUTPUT_TAX_PAYABLE', direction: 'DEBIT', amountCents: tax, summary: no }] : []), { role: 'ACCOUNTS_RECEIVABLE', direction: 'CREDIT', amountCents: gross, summary: no },
    ] : [{ role: 'ACCOUNTS_PAYABLE', direction: 'DEBIT', amountCents: gross, summary: no }, { role: 'GRNI', direction: 'CREDIT', amountCents: net, summary: no }, ...(tax ? [{ role: 'INPUT_TAX_RECEIVABLE', direction: 'CREDIT', amountCents: tax, summary: no }] : [])] });
    const open = db.prepare(`SELECT id FROM ${sales ? 'account_receivables' : 'account_payables'} WHERE source_type=? AND source_id=?`).get(sales ? 'SALES_INVOICE' : 'SUPPLIER_BILL', header.id);
    applyCreditAdjustment(db, { side: input.side, adjustmentType: input.adjustmentType || 'RETURN', sourceType: sales ? 'SALES_CREDIT_NOTE' : 'SUPPLIER_CREDIT_NOTE', sourceId: id, sourceNo: no, targetOpenItemId: open.id, partyId: sales ? header.customer_id : header.supplier_id, businessDate: input.creditDate, amountCents: gross, actorId: input.actorId, createdAt: now });
    return db.prepare('SELECT * FROM commercial_credit_notes WHERE id=?').get(id);
  });
}

export function autoInvoiceDelivery(db, deliveryId, actorId, idempotencyKey) {
  const delivery = db.prepare('SELECT * FROM sales_deliveries WHERE id=?').get(deliveryId); const items = db.prepare('SELECT * FROM sales_delivery_items WHERE delivery_id=? ORDER BY line_no').all(deliveryId);
  return postSalesInvoice(db, createSalesInvoice(db, { customerId: delivery.customer_id, invoiceDate: delivery.delivery_date, taxMode: 'NO_TAX', items: items.map(x => ({ deliveryItemId: x.id, quantity: x.quantity, uomCode: x.document_uom_code || undefined, unitPriceCents: x.unit_price_cents })), actorId, idempotencyKey }).id, actorId);
}
export function autoBillReceipt(db, receiptId, actorId, idempotencyKey) {
  const receipt = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(receiptId); const items = db.prepare('SELECT * FROM purchase_receipt_items WHERE receipt_id=? ORDER BY line_no').all(receiptId);
  return postSupplierBill(db, createSupplierBill(db, { supplierId: receipt.supplier_id, supplierInvoiceNo: `AUTO-${receipt.receipt_no}`, billDate: receipt.receipt_date, taxMode: 'NO_TAX', items: items.map(x => ({ receiptItemId: x.id, quantity: x.quantity, uomCode: x.document_uom_code || undefined, unitPriceCents: x.unit_price_cents })), actorId, idempotencyKey }).id, actorId);
}

export function commercialReconciliation(db) {
  const checks = [];
  const specs = [
    ['SALES_INVOICE', 'sales_invoices', 'account_receivables', 'gross_cents', 'ACCOUNTS_RECEIVABLE'],
    ['SUPPLIER_BILL', 'supplier_bills', 'account_payables', 'gross_cents', 'ACCOUNTS_PAYABLE'],
  ];
  for (const [source, table, ledger, amount, role] of specs) for (const row of db.prepare(`SELECT h.id,h.${amount} amount,COALESCE(o.amount_cents,0) subledger FROM ${table} h LEFT JOIN ${ledger} o ON o.source_type=? AND o.source_id=h.id WHERE h.status='POSTED'`).all(source)) {
    const gl = Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN e.direction=(SELECT direction FROM accounting_subjects s JOIN account_role_mappings m ON m.subject_id=s.id WHERE m.role_code=?) THEN e.amount_cents ELSE -e.amount_cents END),0) n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE v.source_type=? AND v.source_id=? AND v.status='POSTED' AND e.subject_id=(SELECT subject_id FROM account_role_mappings WHERE role_code=?)`).get(role, source, row.id, role).n);
    checks.push({ code: `${source}_TO_SUBLEDGER_GL`, sourceId: row.id, expectedCents: row.amount, subledgerCents: row.subledger, glCents: gl, status: row.amount === row.subledger && row.amount === gl ? 'PASS' : 'FAIL', severity: 'BLOCKING' });
  }
  for (const [code, role, column, table] of [['OUTPUT_TAX_TO_GL','OUTPUT_TAX_PAYABLE','tax_cents','sales_invoices'],['INPUT_TAX_TO_GL','INPUT_TAX_RECEIVABLE','tax_cents','supplier_bills']]) {
    const side=role==='OUTPUT_TAX_PAYABLE'?'AR':'AP'; const expected = Number(db.prepare(`SELECT COALESCE(SUM(${column}),0) n FROM ${table} WHERE status='POSTED'`).get().n)-Number(db.prepare("SELECT COALESCE(SUM(tax_cents),0)n FROM commercial_credit_notes WHERE side=? AND status='POSTED'").get(side).n); const subject = db.prepare('SELECT subject_id FROM account_role_mappings WHERE role_code=?').get(role)?.subject_id;
    const sources=role==='OUTPUT_TAX_PAYABLE'?"'SALES_INVOICE','SALES_CREDIT_NOTE'":"'SUPPLIER_BILL','SUPPLIER_CREDIT_NOTE'"; const actual = subject ? Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE e.subject_id=? AND v.status='POSTED' AND v.source_type IN (${sources})`).get(subject).n) : 0;
    const normalized = role === 'OUTPUT_TAX_PAYABLE' ? -actual : actual; checks.push({ code, expectedCents: expected, glCents: normalized, status: expected === normalized ? 'PASS' : 'FAIL', severity: 'BLOCKING' });
  }
  const uomMismatch = Number(db.prepare(`SELECT COUNT(*) n FROM (SELECT base_quantity_num,base_quantity_den,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator FROM sales_invoice_items UNION ALL SELECT base_quantity_num,base_quantity_den,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator FROM supplier_bill_items) x WHERE base_quantity_num*document_quantity_den*conversion_denominator<>document_quantity_num*conversion_numerator*base_quantity_den`).get().n);
  checks.push({ code: 'UOM_DOCUMENT_TO_BASE', count: uomMismatch, status: uomMismatch ? 'FAIL' : 'PASS', severity: 'BLOCKING' });
  const grniExpected=Number(db.prepare("SELECT COALESCE(SUM(total_cents),0)n FROM purchase_receipts WHERE status='CONFIRMED' AND billing_mode<>'LEGACY_DIRECT'").get().n)-Number(db.prepare("SELECT COALESCE(SUM(grni_cents),0)n FROM supplier_bills WHERE status='POSTED'").get().n); const grniSubject=db.prepare("SELECT subject_id FROM account_role_mappings WHERE role_code='GRNI'").get()?.subject_id; const grniGl=grniSubject?Number(db.prepare("SELECT COALESCE(SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE -e.amount_cents END),0)n FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE e.subject_id=? AND v.status='POSTED' AND v.source_type IN ('PURCHASE_RECEIPT','SUPPLIER_BILL','SUPPLIER_CREDIT_NOTE')").get(grniSubject).n):0; checks.push({code:'RECEIPT_GRNI_TO_GL',expectedCents:grniExpected,glCents:grniGl,status:grniExpected===grniGl?'PASS':'FAIL',severity:'BLOCKING'});
  return { checkOnly: true, autoRepair: false, status: checks.some(x => x.status === 'FAIL') ? 'FAIL' : 'PASS', checks };
}

export function createOpeningBatch(db, input) {
  if (db.prepare("SELECT status FROM go_live_control WHERE singleton_id=1").get().status === 'ACTIVE') throw new HttpError(409, '已启用 GO_LIVE，不可再创建期初批次');
  return atomic(db, () => { const id = randomUUID(); const now = stamp(); const no = allocateDocumentNumber(db, 'OB', input.goLiveDate, input.idempotencyKey || `OB:${id}`); db.prepare("INSERT INTO opening_batches(id,batch_no,status,go_live_date,creator_id,created_at,updated_at) VALUES(?,?,'DRAFT',?,?,?,?)").run(id, no, input.goLiveDate, input.actorId, now, now); const insert = db.prepare('INSERT INTO opening_batch_lines(id,batch_id,line_type,party_id,product_id,warehouse_id,lot_code,serial_number,quantity_num,quantity_den,amount_cents,debit_role,credit_role,reference_no,line_no) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'); (input.lines || []).forEach((x, i) => insert.run(randomUUID(), id, x.lineType, x.partyId || null, x.productId || null, x.warehouseId || null, x.lotCode || null, x.serialNumber || null, x.quantityNumerator ?? null, x.quantityDenominator || 1, int(x.amountCents ?? 0, '期初金额'), x.debitRole || null, x.creditRole || null, x.referenceNo || '', i + 1)); return db.prepare('SELECT * FROM opening_batches WHERE id=?').get(id); });
}
export function validateOpeningBatch(db, id) {
  const batch = db.prepare('SELECT * FROM opening_batches WHERE id=?').get(id); if (!batch || !['DRAFT','VALIDATED'].includes(batch.status)) throw new HttpError(409, '批次状态不允许校验'); const lines = db.prepare('SELECT * FROM opening_batch_lines WHERE batch_id=?').all(id); const errors = [];
  if (!lines.length) errors.push('期初批次不能为空');
  for (const line of lines) { if (['INVENTORY','AR','AP','CASH','BANK','TRIAL_BALANCE'].includes(line.line_type) === false) errors.push(`第${line.line_no}行类型无效`); if (line.line_type === 'INVENTORY' && (!line.product_id || !line.warehouse_id || !line.quantity_num)) errors.push(`第${line.line_no}行存货信息不完整`); }
  const debits = lines.reduce((s,x)=>s+(x.debit_role ? x.amount_cents : 0),0); const credits=lines.reduce((s,x)=>s+(x.credit_role ? x.amount_cents : 0),0); if (debits !== credits) errors.push(`试算不平衡：借${debits}贷${credits}`);
  const health = systemHealth(db); if (health.checks?.some(x => x.severity === 'BLOCKING' && x.status === 'FAIL' && x.code !== 'LEGACY_UNVALUED')) errors.push('系统健康存在阻断项');
  db.prepare("UPDATE opening_batches SET status=?,validation_json=?,updated_at=? WHERE id=?").run(errors.length ? 'DRAFT' : 'VALIDATED', JSON.stringify({ errors, debitCents: debits, creditCents: credits }), stamp(), id); return { valid: !errors.length, errors, debitCents: debits, creditCents: credits };
}
export function transitionOpeningBatch(db, id, action, actorId) {
  return atomic(db, () => { const batch=db.prepare('SELECT * FROM opening_batches WHERE id=?').get(id); if(!batch)throw new HttpError(404,'批次不存在'); const now=stamp();
    if(action==='submit'){if(batch.status!=='VALIDATED')throw new HttpError(409,'只有已校验批次可提交');db.prepare("UPDATE opening_batches SET status='SUBMITTED',submitted_by=?,updated_at=? WHERE id=?").run(actorId,now,id);}
    else if(action==='approve'){if(batch.status!=='SUBMITTED')throw new HttpError(409,'只有已提交批次可审批');if(batch.creator_id===actorId)throw new HttpError(409,'创建人不得自批');db.prepare("UPDATE opening_batches SET status='APPROVED',approved_by=?,updated_at=? WHERE id=?").run(actorId,now,id);}
    else if(action==='post'){if(batch.status!=='APPROVED')throw new HttpError(409,'只有已审批批次可过账');if(batch.creator_id===actorId)throw new HttpError(409,'创建人不得过账');postOpening(db,batch,actorId);db.prepare("UPDATE opening_batches SET status='POSTED',posted_by=?,updated_at=? WHERE id=?").run(actorId,now,id);}
    else if(action==='activate'){if(batch.status!=='POSTED')throw new HttpError(409,'只有已过账批次可启用');db.prepare("UPDATE go_live_control SET status='ACTIVE',activated_batch_id=?,activated_by=?,activated_at=? WHERE singleton_id=1").run(id,actorId,now);}
    else throw new HttpError(400,'无效动作'); return db.prepare('SELECT * FROM opening_batches WHERE id=?').get(id); });
}
function postOpening(db,batch,actorId){const lines=db.prepare('SELECT * FROM opening_batch_lines WHERE batch_id=? ORDER BY line_no').all(batch.id);const entries=[];for(const x of lines){if(x.debit_role)entries.push({role:x.debit_role,direction:'DEBIT',amountCents:x.amount_cents,summary:`期初 ${x.reference_no}`});if(x.credit_role)entries.push({role:x.credit_role,direction:'CREDIT',amountCents:x.amount_cents,summary:`期初 ${x.reference_no}`});if(x.line_type==='INVENTORY'){const q=x.quantity_num/x.quantity_den;const current=db.prepare('SELECT * FROM inventory WHERE warehouse_id=? AND product_id=?').get(x.warehouse_id,x.product_id);if(current)db.prepare('UPDATE inventory SET quantity=quantity+?,updated_at=? WHERE id=?').run(q,stamp(),current.id);else db.prepare('INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,?)').run(randomUUID(),x.warehouse_id,x.product_id,q,stamp());receiveValue(db,{businessDate:batch.go_live_date,productId:x.product_id,warehouseId:x.warehouse_id,quantity:q,valueCents:x.amount_cents,movementType:'OPENING_BALANCE',sourceType:'OPENING_BATCH',sourceId:batch.id,sourceItemId:x.id,valuationBasis:'CONTROLLED_OPENING'});}if(x.line_type==='AR')ensureReceivableSource(db,{id:x.id,sourceType:'OPENING_BALANCE',sourceNo:x.reference_no||batch.batch_no,partyId:x.party_id,businessDate:batch.go_live_date,effectCents:x.amount_cents,creatorId:batch.creator_id,createdAt:batch.created_at});if(x.line_type==='AP')ensurePayableSource(db,{id:x.id,sourceType:'OPENING_BALANCE',sourceNo:x.reference_no||batch.batch_no,partyId:x.party_id,businessDate:batch.go_live_date,effectCents:x.amount_cents,creatorId:batch.creator_id,createdAt:batch.created_at});}createSystemVoucher(db,{sourceType:'OPENING_BATCH',sourceId:batch.id,businessDate:batch.go_live_date,actorId,entries});}

function parseCsv(text){const lines=String(text).trim().split(/\r?\n/);if(!lines.length)return[];const parse=line=>{const out=[];let value='',quoted=false;for(let i=0;i<=line.length;i++){const c=line[i];if(c==='"'&&line[i+1]==='"'&&quoted){value+='"';i++;}else if(c==='"')quoted=!quoted;else if((c===','||i===line.length)&&!quoted){out.push(value);value='';}else value+=c??'';}return out;};const heads=parse(lines[0]);return lines.slice(1).filter(Boolean).map(line=>Object.fromEntries(parse(line).map((v,i)=>[heads[i],v])));}
export function stageCsvImport(db,input){return atomic(db,()=>{const existing=db.prepare('SELECT * FROM import_batches WHERE idempotency_key=?').get(input.idempotencyKey);if(existing)return existing;const id=randomUUID(),now=stamp();db.prepare("INSERT INTO import_batches(id,entity_type,status,idempotency_key,created_by,created_at) VALUES(?,?,'STAGED',?,?,?)").run(id,input.entityType,input.idempotencyKey,input.actorId,now);const insert=db.prepare('INSERT INTO import_rows(id,batch_id,row_number,raw_json) VALUES(?,?,?,?)');parseCsv(input.csv).forEach((row,i)=>insert.run(randomUUID(),id,i+2,JSON.stringify(row)));return db.prepare('SELECT * FROM import_batches WHERE id=?').get(id);});}
export function validateImport(db,id){const batch=db.prepare('SELECT * FROM import_batches WHERE id=?').get(id);if(!batch)throw new HttpError(404,'导入批次不存在');const required={customers:['code','name'],suppliers:['code','name'],products:['code','name','base_uom'],uoms:['code','name'],warehouses:['code','name'],opening_balance:['line_type','amount_cents']}[batch.entity_type];if(!required)throw new HttpError(400,'不支持的导入类型');let valid=true;for(const row of db.prepare('SELECT * FROM import_rows WHERE batch_id=? ORDER BY row_number').all(id)){const raw=JSON.parse(row.raw_json);const errors=required.filter(k=>!String(raw[k]??'').trim()).map(k=>`缺少 ${k}`);valid&&=!errors.length;db.prepare('UPDATE import_rows SET normalized_json=?,errors_json=? WHERE id=?').run(JSON.stringify(raw),JSON.stringify(errors),row.id);}db.prepare("UPDATE import_batches SET status=? WHERE id=?").run(valid?'VALIDATED':'STAGED',id);return{valid,rows:db.prepare('SELECT row_number,normalized_json,errors_json FROM import_rows WHERE batch_id=? ORDER BY row_number').all(id).map(x=>({...x,errors:JSON.parse(x.errors_json)}))};}
export function commitImport(db,id){return atomic(db,()=>{
  const batch=db.prepare('SELECT * FROM import_batches WHERE id=?').get(id);if(batch?.status==='COMMITTED')return batch;if(batch?.status!=='VALIDATED')throw new HttpError(409,'导入必须先通过校验');
  const rows=db.prepare('SELECT normalized_json FROM import_rows WHERE batch_id=? ORDER BY row_number').all(id).map(x=>JSON.parse(x.normalized_json));const now=stamp();
  if(batch.entity_type==='opening_balance'){
    const opening=createOpeningBatch(db,{goLiveDate:rows[0]?.go_live_date||new Date().toISOString().slice(0,10),actorId:batch.created_by,idempotencyKey:`IMPORT:${batch.id}`,lines:rows.map(x=>({lineType:x.line_type,partyId:x.party_id||null,productId:x.product_id||null,warehouseId:x.warehouse_id||null,lotCode:x.lot_code||null,serialNumber:x.serial_number||null,quantityNumerator:x.quantity_num?Number(x.quantity_num):null,quantityDenominator:x.quantity_den?Number(x.quantity_den):1,amountCents:Number(x.amount_cents),debitRole:x.debit_role||null,creditRole:x.credit_role||null,referenceNo:x.reference_no||''}))});
    db.prepare("UPDATE import_batches SET status='COMMITTED',committed_at=? WHERE id=?").run(now,id);return{...db.prepare('SELECT * FROM import_batches WHERE id=?').get(id),openingBatchId:opening.id};
  }
  for(const x of rows){
    if(batch.entity_type==='customers')db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES(?,?,?,'','','',1,?,?)").run(randomUUID(),x.code,x.name,now,now);
    else if(batch.entity_type==='suppliers')db.prepare("INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at,email) VALUES(?,?,?,'','','',1,?,?,'')").run(randomUUID(),x.code,x.name,now,now);
    else if(batch.entity_type==='warehouses')db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,'','',1,?,?)").run(randomUUID(),x.code,x.name,now,now);
    else if(batch.entity_type==='uoms'){db.prepare('INSERT OR IGNORE INTO uoms(code,name,created_at,updated_at) VALUES(?,?,?,?)').run(x.code,x.name,now,now);if(x.product_code){const product=db.prepare('SELECT id FROM products WHERE code=?').get(x.product_code);if(!product)throw new HttpError(409,`UOM 换算产品 ${x.product_code} 不存在`);createUomConversion(db,{productId:product.id,uomCode:x.code,uomName:x.name,numerator:Number(x.numerator),denominator:Number(x.denominator),effectiveFrom:x.effective_from});}}
    else if(batch.entity_type==='products')db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code) VALUES(?,?,?,'IMPORT',?,0,0,1,?,?,?)").run(randomUUID(),x.code,x.name,x.base_uom,now,now,x.base_uom);
  }
  db.prepare("UPDATE import_batches SET status='COMMITTED',committed_at=? WHERE id=?").run(now,id);return db.prepare('SELECT * FROM import_batches WHERE id=?').get(id);
});}

export function canonicalExport(db,type){const queries={inventory:`SELECT p.code product_code,w.code warehouse_code,i.quantity,COALESCE(v.value_cents,0) value_cents FROM inventory i JOIN products p ON p.id=i.product_id JOIN warehouses w ON w.id=i.warehouse_id LEFT JOIN inventory_valuation_balances v ON v.product_id=i.product_id AND v.warehouse_id=i.warehouse_id`,ar:`SELECT voucher_no,source_type,source_no,amount_cents,open_amount_cents,status FROM account_receivables`,ap:`SELECT voucher_no,source_type,source_no,amount_cents,open_amount_cents,status FROM account_payables`,gl:`SELECT v.voucher_no,v.business_date,s.code subject_code,e.direction,e.amount_cents,v.source_type,v.source_id FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id JOIN accounting_subjects s ON s.id=e.subject_id WHERE v.status='POSTED'`,tax:`SELECT 'OUTPUT' tax_type,invoice_no document_no,tax_cents FROM sales_invoices WHERE status='POSTED' UNION ALL SELECT 'INPUT',bill_no,tax_cents FROM supplier_bills WHERE status='POSTED'`};if(type==='system-health')return commercialReconciliation(db);if(!queries[type])throw new HttpError(400,'不支持的导出类型');return db.prepare(queries[type]).all();}

export async function commercialApiHandler(db, req, res, actor, url) {
  allowAny(actor, ['ACCOUNTING_VIEW','AR_VIEW','AP_VIEW']); const path=url.pathname; let match;
  if(path==='/api/tax-codes'&&req.method==='POST')return send(res,201,createTaxCode(db,{...(await readJson(req)),actorId:actor.id}));
  if(path==='/api/tax-codes'&&req.method==='GET')return send(res,200,{taxCodes:db.prepare('SELECT * FROM tax_codes ORDER BY code,version DESC').all()});
  if(path==='/api/uom-conversions'&&req.method==='POST')return send(res,201,createUomConversion(db,{...(await readJson(req)),actorId:actor.id}));
  if(path==='/api/sales-invoices'&&req.method==='POST')return send(res,201,createSalesInvoice(db,{...(await readJson(req)),actorId:actor.id}));
  if(path==='/api/sales-invoices'&&req.method==='GET')return send(res,200,{salesInvoices:db.prepare('SELECT h.*,c.code customerCode,c.name customerName FROM sales_invoices h JOIN customers c ON c.id=h.customer_id ORDER BY h.created_at DESC').all()});
  if((match=path.match(/^\/api\/sales-invoices\/([^/]+)$/))&&req.method==='GET'){const invoice=db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(match[1]);if(!invoice)throw new HttpError(404,'销售发票不存在');invoice.items=db.prepare('SELECT i.*,p.code productCode,p.name productName FROM sales_invoice_items i JOIN products p ON p.id=i.product_id WHERE i.invoice_id=? ORDER BY i.line_no').all(match[1]);return send(res,200,{salesInvoice:invoice});}
  if((match=path.match(/^\/api\/sales-invoices\/([^/]+)\/post$/))&&req.method==='POST')return send(res,200,postSalesInvoice(db,match[1],actor.id));
  if(path==='/api/supplier-bills'&&req.method==='POST')return send(res,201,createSupplierBill(db,{...(await readJson(req)),actorId:actor.id}));
  if(path==='/api/supplier-bills'&&req.method==='GET')return send(res,200,{supplierBills:db.prepare('SELECT h.*,s.code supplierCode,s.name supplierName FROM supplier_bills h JOIN suppliers s ON s.id=h.supplier_id ORDER BY h.created_at DESC').all()});
  if((match=path.match(/^\/api\/supplier-bills\/([^/]+)$/))&&req.method==='GET'){const bill=db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(match[1]);if(!bill)throw new HttpError(404,'供应商账单不存在');bill.items=db.prepare('SELECT i.*,p.code productCode,p.name productName FROM supplier_bill_items i JOIN products p ON p.id=i.product_id WHERE i.bill_id=? ORDER BY i.line_no').all(match[1]);return send(res,200,{supplierBill:bill});}
  if((match=path.match(/^\/api\/supplier-bills\/([^/]+)\/post$/))&&req.method==='POST')return send(res,200,postSupplierBill(db,match[1],actor.id));
  if((match=path.match(/^\/api\/supplier-bills\/([^/]+)\/match$/))&&req.method==='POST')return send(res,200,matchSupplierBill(db,match[1],await readJson(req)));
  if(path==='/api/commercial-credit-notes'&&req.method==='POST')return send(res,201,createCommercialCreditNote(db,{...(await readJson(req)),actorId:actor.id}));
  if(path==='/api/commercial-reconciliation'&&req.method==='GET')return send(res,200,commercialReconciliation(db));
  if(path==='/api/opening-batches'&&req.method==='POST')return send(res,201,createOpeningBatch(db,{...(await readJson(req)),actorId:actor.id}));
  if(path==='/api/opening-batches'&&req.method==='GET')return send(res,200,{openingBatches:db.prepare('SELECT * FROM opening_batches ORDER BY created_at DESC').all(),goLive:db.prepare('SELECT * FROM go_live_control WHERE singleton_id=1').get()});
  if((match=path.match(/^\/api\/opening-batches\/([^/]+)\/(validate|submit|approve|post|activate)$/))&&req.method==='POST')return send(res,200,match[2]==='validate'?validateOpeningBatch(db,match[1]):transitionOpeningBatch(db,match[1],match[2],actor.id));
  if(path==='/api/imports'&&req.method==='POST')return send(res,201,stageCsvImport(db,{...(await readJson(req)),actorId:actor.id}));
  if((match=path.match(/^\/api\/imports\/([^/]+)\/(validate|preview|commit)$/))){if(match[2]==='validate'&&req.method==='POST')return send(res,200,validateImport(db,match[1]));if(match[2]==='preview'&&req.method==='GET')return send(res,200,{rows:db.prepare('SELECT row_number,normalized_json,errors_json FROM import_rows WHERE batch_id=? ORDER BY row_number').all(match[1])});if(match[2]==='commit'&&req.method==='POST')return send(res,200,commitImport(db,match[1]));}
  if(path==='/api/exports'&&req.method==='GET')return send(res,200,{type:url.searchParams.get('type'),rows:canonicalExport(db,url.searchParams.get('type'))});
  throw new HttpError(404,'商业财务接口不存在');
}
