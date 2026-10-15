import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, normalizeBusinessDate, readJson, send } from '../lib/http.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { buildAuthoritativeSalesLines, createSalesOrderCanonical } from './sales-orders.js';
import { assertGroupScope, currentCommercialExtension, lockSuffix, requireSalesPermission } from './sales-scope.js';

const NOW = () => new Date().toISOString();
const DAY = () => NOW().slice(0, 10);
const makeNo = (prefix) => `${prefix}-${Date.now()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
const parse = (value, label) => { try { return JSON.parse(value); } catch { throw new HttpError(409, `${label}损坏`, { code: 'SALES_SNAPSHOT_CORRUPT' }); } };
const safe = (value, label, min = 0) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < min) throw new HttpError(422, `${label}不正确`); return n; };
const halfUp = (numerator, denominator) => Number((BigInt(numerator) + BigInt(denominator) / 2n) / BigInt(denominator));

function detail(db, quotationId) {
  const quotation = db.prepare('SELECT * FROM sales_quotations WHERE id=?').get(quotationId);
  if (!quotation) throw new HttpError(404, '销售报价不存在');
  const lines = db.prepare(`SELECT ql.*,
    ql.quantity_micros-ql.converted_qty_micros remaining_qty_micros
    FROM sales_quotation_lines ql WHERE quotation_id=? ORDER BY line_no`).all(quotationId)
    .map((line) => ({ ...line, priceSnapshot: parse(line.pricing_evidence_json, '报价价格证据'), discountSnapshot: parse(line.discount_snapshot_json, '报价折扣证据') }));
  return { ...quotation, lines };
}

function scopeQuotation(db, actor, quotation) {
  if (quotation.sales_group_id) assertGroupScope(db, actor, { salesGroupId: quotation.sales_group_id, businessDate: quotation.valid_from, documentType: 'SALES_QUOTATION' });
}

export function listSalesQuotations(db, res, actor, url) {
  requireSalesPermission(actor, 'ORDERS_VIEW');
  const status = String(url.searchParams.get('status') || '');
  const rows = db.prepare(`SELECT q.*,c.code customer_code,c.name customer_name FROM sales_quotations q
    JOIN customers c ON c.id=q.customer_id WHERE (?='' OR q.status=?) ORDER BY q.created_at DESC`).all(status, status)
    .filter((row) => { try { scopeQuotation(db, actor, row); return true; } catch (error) { if (error.status === 403) return false; throw error; } });
  return send(res, 200, { quotations: rows });
}

export function getSalesQuotation(db, res, actor, quotationId) {
  requireSalesPermission(actor, 'ORDERS_VIEW');
  const value = detail(db, quotationId); scopeQuotation(db, actor, value);
  return send(res, 200, { quotation: value });
}

function quotationInput(db, body, actor) {
  const validFrom = normalizeBusinessDate(body.validFrom || DAY(), '报价生效日期');
  const validTo = normalizeBusinessDate(body.validTo, '报价失效日期');
  if (validTo < validFrom) throw new HttpError(422, '报价失效日期不得早于生效日期');
  const customer = db.prepare('SELECT * FROM customers WHERE id=? AND active=1').get(body.customerId);
  if (!customer) throw new HttpError(422, '客户不存在或已停用');
  const extension = currentCommercialExtension(db, customer.id, validFrom);
  const salespersonId = body.salespersonId || extension.default_salesperson_id;
  const salesGroupId = body.salesGroupId || extension.default_sales_group_id;
  if (!salespersonId || !salesGroupId) throw new HttpError(409, '客户缺少有效销售员或销售组默认值');
  assertGroupScope(db, actor, { salesGroupId, businessDate: validFrom, documentType: 'SALES_QUOTATION', write: true });
  const lines = buildAuthoritativeSalesLines(db, { ...body, orderDate: validFrom }, actor, validFrom, customer.id, salespersonId, { enforceCreatorOverrideSod: false });
  return { validFrom, validTo, customer, extension, salespersonId, salesGroupId, lines };
}

export async function createSalesQuotation(db, req, res, actor) {
  requireSalesPermission(actor, 'SALES_QUOTATION_MANAGE');
  const body = await readJson(req); let result;
  transaction(db, () => {
    const value = quotationInput(db, body, actor); const quotationId = id(); const quotationNo = makeNo('QT'); const stamp = NOW();
    const total = value.lines.reduce((sum, line) => sum + line.amountCents, 0);
    db.prepare(`INSERT INTO sales_quotations(id,quotation_no,customer_id,salesperson_id,sales_group_id,status,currency_code,
      valid_from,valid_to,payment_terms,payment_terms_days,commercial_tax_code,tax_inclusive,total_cents,converted_total_cents,
      remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?,0,?,?,?,?)`)
      .run(quotationId, quotationNo, value.customer.id, value.salespersonId, value.salesGroupId, String(body.currencyCode || 'CNY'),
        value.validFrom, value.validTo, String(body.paymentTerms || value.extension.default_settlement_method || ''),
        safe(body.paymentTermsDays ?? value.extension.default_payment_terms_days ?? 0, '付款账期'), body.commercialTaxCode || null,
        body.taxInclusive ?? null, total, String(body.remark || '').slice(0, 500), actor.id, stamp, stamp);
    const insert = db.prepare(`INSERT INTO sales_quotation_lines(id,quotation_id,line_no,material_id,commercial_uom_code,
      quantity_micros,converted_qty_micros,unit_price_cents,amount_cents,pricing_evidence_json,discount_snapshot_json,
      tax_basis_assumption,planned_delivery_date,upper_delivery_tolerance_bps,lower_delivery_tolerance_bps,remark)
      VALUES(?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?)`);
    for (const line of value.lines) insert.run(line.id, quotationId, line.lineNo, line.productId, line.documentUomCode,
      line.quantityMicros, line.unitPriceCents, line.amountCents, JSON.stringify(line.priceSnapshot), JSON.stringify(line.discountSnapshot),
      line.taxBasis, line.plannedDate || value.validTo, line.upperTolerance, line.lowerTolerance, String(line.remark || ''));
    audit(db, actor.id, 'CREATE', 'SALES_QUOTATION', quotationId, quotationNo);
    result = { quotation: detail(db, quotationId) };
  });
  return send(res, 201, result);
}

export async function updateSalesQuotation(db, req, res, actor, quotationId) {
  requireSalesPermission(actor, 'SALES_QUOTATION_MANAGE'); const body = await readJson(req); let result;
  transaction(db, () => {
    const current = db.prepare(`SELECT * FROM sales_quotations WHERE id=?${lockSuffix(db)}`).get(quotationId);
    if (!current) throw new HttpError(404, '销售报价不存在'); scopeQuotation(db, actor, current);
    if (current.status !== 'DRAFT') throw new HttpError(409, '只有草稿报价可以编辑');
    const value = quotationInput(db, { ...body, customerId: body.customerId || current.customer_id }, actor);
    db.prepare('DELETE FROM sales_quotation_lines WHERE quotation_id=?').run(quotationId);
    const total = value.lines.reduce((sum, line) => sum + line.amountCents, 0);
    db.prepare(`UPDATE sales_quotations SET customer_id=?,salesperson_id=?,sales_group_id=?,valid_from=?,valid_to=?,payment_terms=?,
      payment_terms_days=?,commercial_tax_code=?,tax_inclusive=?,total_cents=?,remark=?,updated_at=? WHERE id=?`)
      .run(value.customer.id, value.salespersonId, value.salesGroupId, value.validFrom, value.validTo,
        String(body.paymentTerms || value.extension.default_settlement_method || ''), safe(body.paymentTermsDays ?? value.extension.default_payment_terms_days ?? 0, '付款账期'),
        body.commercialTaxCode || null, body.taxInclusive ?? null, total, String(body.remark || '').slice(0, 500), NOW(), quotationId);
    const insert = db.prepare(`INSERT INTO sales_quotation_lines(id,quotation_id,line_no,material_id,commercial_uom_code,quantity_micros,
      converted_qty_micros,unit_price_cents,amount_cents,pricing_evidence_json,discount_snapshot_json,tax_basis_assumption,
      planned_delivery_date,upper_delivery_tolerance_bps,lower_delivery_tolerance_bps,remark) VALUES(?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?)`);
    for (const line of value.lines) insert.run(line.id, quotationId, line.lineNo, line.productId, line.documentUomCode, line.quantityMicros,
      line.unitPriceCents, line.amountCents, JSON.stringify(line.priceSnapshot), JSON.stringify(line.discountSnapshot), line.taxBasis,
      line.plannedDate || value.validTo, line.upperTolerance, line.lowerTolerance, String(line.remark || ''));
    audit(db, actor.id, 'UPDATE', 'SALES_QUOTATION', quotationId, current.quotation_no); result = { quotation: detail(db, quotationId) };
  });
  return send(res, 200, result);
}

export async function salesQuotationAction(db, req, res, actor, quotationId, action) {
  requireSalesPermission(actor, 'SALES_QUOTATION_MANAGE'); const body = await readJson(req); let result;
  transaction(db, () => {
    const row = db.prepare(`SELECT * FROM sales_quotations WHERE id=?${lockSuffix(db)}`).get(quotationId);
    if (!row) throw new HttpError(404, '销售报价不存在'); scopeQuotation(db, actor, row);
    if (action === 'effective-publish') {
      if (row.status !== 'DRAFT') throw new HttpError(409, '只有草稿报价可以生效');
      db.prepare("UPDATE sales_quotations SET status='EFFECTIVE',reviewer_id=?,published_at=?,updated_at=? WHERE id=?").run(actor.id, NOW(), NOW(), quotationId);
    } else if (action === 'cancel') {
      const reason = String(body.reason || '').trim(); if (!reason) throw new HttpError(422, '关闭原因必填');
      if (!['DRAFT', 'EFFECTIVE'].includes(row.status)) throw new HttpError(409, '报价当前状态不可关闭');
      db.prepare("UPDATE sales_quotations SET status='CLOSED',close_reason=?,closed_at=?,updated_at=? WHERE id=?").run(reason, NOW(), NOW(), quotationId);
    } else throw new HttpError(400, '无效报价动作');
    audit(db, actor.id, 'STATE_TRANSITION', 'SALES_QUOTATION', quotationId, action); result = { quotation: detail(db, quotationId) };
  });
  return send(res, 200, result);
}

function conversionLine(db, line, quantityMicros, businessDate) {
  const price = parse(line.pricing_evidence_json, '报价价格证据'); const discount = parse(line.discount_snapshot_json, '报价折扣证据');
  const convertedAmount = Number(db.prepare('SELECT COALESCE(SUM(converted_amount_cents),0) value FROM sales_quotation_conversions WHERE quotation_line_id=?').get(line.id).value);
  const afterQty = Number(line.converted_qty_micros) + quantityMicros;
  const cumulativeAmount = afterQty === Number(line.quantity_micros) ? Number(line.amount_cents) : halfUp(BigInt(line.amount_cents) * BigInt(afterQty), line.quantity_micros);
  const amount = cumulativeAmount - convertedAmount;
  const gross = halfUp(BigInt(price.grossAmountCents) * BigInt(quantityMicros), line.quantity_micros);
  const priceSnapshot = { ...price, businessDate, quantityMicros, grossAmountCents: gross, sourceQuotationLineId: line.id };
  const discountSnapshot = { ...discount, businessDate, lineId: line.id, grossAmountCents: gross, finalAmountCents: amount,
    sourceQuotationLineId: line.id, sourceQuotationDiscountFingerprint: discount.requestFingerprint };
  return { sourceLineId: line.id, productId: line.material_id, documentUomCode: line.commercial_uom_code, quantityMicros,
    unitPriceCents: Number(line.unit_price_cents), amountCents: amount, grossAmountCents: gross,
    documentQuantityNum: quantityMicros, documentQuantityDen: 1_000_000,
    conversionNumerator: price.evidence.requestedUomEvidence.numerator, conversionDenominator: price.evidence.requestedUomEvidence.denominator,
    baseQuantityNum: quantityMicros * price.evidence.requestedUomEvidence.numerator,
    baseQuantityDen: 1_000_000 * price.evidence.requestedUomEvidence.denominator,
    isGiftLine: price.giftLine ? 1 : 0, taxBasis: line.tax_basis_assumption, taxInclusive: null,
    pricingUom: price.evidence.pricingUomEvidence.uomCode, qtyMin: price.evidence.qtyBreakApplied.min,
    qtyMax: price.evidence.qtyBreakApplied.max, plannedDate: line.planned_delivery_date,
    upperTolerance: line.upper_delivery_tolerance_bps, lowerTolerance: line.lower_delivery_tolerance_bps,
    priceSnapshot, discountSnapshot };
}

export async function convertSalesQuotation(db, req, res, actor, quotationId) {
  requireSalesPermission(actor, 'ORDERS_CREATE'); const body = await readJson(req);
  const key = String(req.headers['idempotency-key'] || '').trim(); if (!key) throw new HttpError(422, 'Idempotency-Key 必填');
  const fingerprint = requestFingerprint(body); const replay = idempotencyReplay(db, 'QUOTATION_CONVERT', quotationId, key, fingerprint);
  if (replay) return send(res, 200, { ...replay, replayed: true });
  let result;
  transaction(db, () => {
    const quotation = db.prepare(`SELECT * FROM sales_quotations WHERE id=?${lockSuffix(db)}`).get(quotationId);
    if (!quotation) throw new HttpError(404, '销售报价不存在'); scopeQuotation(db, actor, quotation);
    const businessDate = normalizeBusinessDate(body.businessDate || DAY(), '转换业务日期');
    if (quotation.status !== 'EFFECTIVE' || quotation.valid_from > businessDate || quotation.valid_to < businessDate) throw new HttpError(409, '报价未生效或已过期');
    if (!Array.isArray(body.lineSelections) || !body.lineSelections.length) throw new HttpError(422, '至少选择一条报价明细');
    const selectedLineIds = new Set();
    const selected = [];
    for (const input of body.lineSelections) {
      const selectedLineId = String(input.quotationLineId || '');
      if (!selectedLineId || selectedLineIds.has(selectedLineId)) throw new HttpError(422, '同一转换请求不得重复选择报价行', { code: 'DUPLICATE_QUOTATION_LINE' });
      selectedLineIds.add(selectedLineId);
      const line = db.prepare(`SELECT * FROM sales_quotation_lines WHERE id=? AND quotation_id=?${lockSuffix(db)}`).get(input.quotationLineId, quotationId);
      if (!line) throw new HttpError(422, '报价明细不存在');
      const quantityMicros = safe(input.quantityMicros, '转换数量', 1);
      if (Number(line.converted_qty_micros) + quantityMicros > Number(line.quantity_micros)) throw new HttpError(409, '转换数量超过报价剩余数量');
      selected.push({ row: line, orderLine: conversionLine(db, line, quantityMicros, businessDate), quantityMicros });
    }
    const order = createSalesOrderCanonical(db, { body: { ...body, customerId: quotation.customer_id, salespersonId: quotation.salesperson_id,
      salesGroupId: quotation.sales_group_id, orderDate: businessDate, requestedDeliveryDate: body.requestedDeliveryDate || businessDate,
      paymentTerms: quotation.payment_terms, paymentTermsDays: quotation.payment_terms_days, commercialTaxCode: quotation.commercial_tax_code,
      taxInclusive: quotation.tax_inclusive, remark: body.remark || `来源报价 ${quotation.quotation_no}` }, actor,
      quotationLines: selected.map((item) => item.orderLine) });
    const stamp = NOW();
    selected.forEach((item, index) => {
      const orderItemId = order.itemIds[index];
      db.prepare(`INSERT INTO sales_quotation_conversions(id,quotation_id,quotation_line_id,sales_order_id,sales_order_item_id,
        converted_qty_micros,converted_unit_price_cents,converted_amount_cents,converted_uom_code,business_date,converted_at,converted_by,idempotency_key)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id(), quotationId, item.row.id, order.id, orderItemId, item.quantityMicros,
          item.orderLine.unitPriceCents, item.orderLine.amountCents, item.orderLine.documentUomCode, businessDate, stamp, actor.id,
          `LINE:${requestFingerprint({ requestKey: key, quotationLineId: item.row.id })}`);
      db.prepare('UPDATE sales_quotation_lines SET converted_qty_micros=converted_qty_micros+? WHERE id=?').run(item.quantityMicros, item.row.id);
    });
    const remaining = Number(db.prepare('SELECT COALESCE(SUM(quantity_micros-converted_qty_micros),0) value FROM sales_quotation_lines WHERE quotation_id=?').get(quotationId).value);
    const convertedTotal = Number(db.prepare('SELECT COALESCE(SUM(converted_amount_cents),0) value FROM sales_quotation_conversions WHERE quotation_id=?').get(quotationId).value);
    db.prepare('UPDATE sales_quotations SET status=?,converted_total_cents=?,updated_at=? WHERE id=?').run(remaining === 0 ? 'FULLY_CONVERTED' : 'EFFECTIVE', convertedTotal, stamp, quotationId);
    result = { quotationId, salesOrderId: order.id, salesOrderNo: order.orderNo };
    saveIdempotency(db, 'QUOTATION_CONVERT', quotationId, key, fingerprint, result);
    audit(db, actor.id, 'CONVERT_TO_SO', 'SALES_QUOTATION', quotationId, JSON.stringify(result));
  });
  return send(res, 201, result);
}
