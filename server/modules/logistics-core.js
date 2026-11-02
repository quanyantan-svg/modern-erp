// Canonical shared logistics primitives for sourced logistics documents
// (purchase receipts, sales deliveries, sales invoices).
//
// These helpers were previously local to server/app.js. M1C-WP-1 needs the
// same primitives from server/modules/procurement-notice-conversion.js, which
// must reuse the canonical purchase-receipt writer instead of duplicating
// its SQL. Moving them here keeps exactly one active implementation of each
// primitive (AGENTS.md §6) while server/app.js stays the HTTP lifecycle.
//
// Behaviour is unchanged: this is a relocation, not a rewrite.

import { id } from '../db.js';
import { HttpError } from '../lib/http.js';
import { rational, roundRational } from './commercial-golive.js';
import { freezeQualityPolicy, saveTrackedAllocations } from './traceability-quality.js';

export function requireActiveReference(db, table, referenceId, label) {
  if (!referenceId || !db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND active=1`).get(referenceId)) throw new HttpError(400, `请选择有效${label}`);
}

export function normalizeDocumentDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z'))) throw new HttpError(400, `${label}不正确`);
  return value;
}

export function replaceLogisticsItems(db, table, foreignKey, documentId, items, sourceColumn = null) {
  db.prepare(`DELETE FROM ${table} WHERE ${foreignKey}=?`).run(documentId);
  const hasUomSnapshot = db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name='document_uom_code'`).get(table);
  const uomColumns = hasUomSnapshot
    ? ',document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den'
    : '';
  // M1C-WP-1: receipt lines may carry the notice source row and the bound
  // delivery schedule. The columns are additive (M-03) and only exist on the
  // receipt item tables, so they are written when present.
  const hasNoticeSource = db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name='source_notice_item_source_id'`).get(table);
  const noticeSourceColumns = hasNoticeSource ? ',source_notice_item_source_id,delivery_schedule_id' : '';
  const columns = sourceColumn
    ? `id,${foreignKey},product_id,quantity,unit_price_cents,amount_cents,line_no,${sourceColumn}${uomColumns}${noticeSourceColumns}`
    : `id,${foreignKey},product_id,quantity,unit_price_cents,amount_cents,line_no${uomColumns}${noticeSourceColumns}`;
  const placeholderCount = 7 + (sourceColumn ? 1 : 0) + (hasUomSnapshot ? 7 : 0) + (hasNoticeSource ? 2 : 0);
  const statement = db.prepare(`INSERT INTO ${table}(${columns}) VALUES(${Array(placeholderCount).fill('?').join(',')})`);
  const inserted = [];
  for (const item of items) {
    const itemId = id();
    const values = [itemId, documentId, item.productId, item.quantity, item.unitPriceCents, item.amountCents, item.lineNo];
    if (sourceColumn) values.push(item.sourceItemId);
    if (hasUomSnapshot) values.push(item.documentUomCode, item.documentQuantityNumerator, item.documentQuantityDenominator,
      item.conversionNumerator, item.conversionDenominator, item.baseQuantityNumerator, item.baseQuantityDenominator);
    if (hasNoticeSource) values.push(item.sourceNoticeItemSourceId ?? null, item.deliveryScheduleId ?? null);
    statement.run(...values);
    inserted.push({ id: itemId, ...item });
  }
  return inserted;
}

export function configureTrackedDraftLines(db, { sourceType, sourceId, itemTable, foreignKey, rawItems, businessDate }) {
  const persisted = db.prepare(`SELECT * FROM ${itemTable} WHERE ${foreignKey}=? ORDER BY line_no,id`).all(sourceId);
  for (const [index, item] of persisted.entries()) {
    freezeQualityPolicy(db, { sourceType, sourceId, sourceItemId: item.id, productId: item.product_id, businessDate });
    saveTrackedAllocations(db, {
      sourceType, sourceId, sourceItemId: item.id, productId: item.product_id, quantity: item.quantity,
      allocations: rawItems?.[index]?.trackingAllocations || rawItems?.[index]?.tracking_allocations || [],
    });
  }
}

export function configureTrackedDocumentLines(db, { sourceType, sourceId, itemTable, foreignKey, rawItems }) {
  const persisted = db.prepare(`SELECT * FROM ${itemTable} WHERE ${foreignKey}=? ORDER BY line_no,id`).all(sourceId);
  for (const [index, item] of persisted.entries()) saveTrackedAllocations(db, {
    sourceType, sourceId, sourceItemId: item.id, productId: item.product_id, quantity: item.quantity,
    allocations: rawItems?.[index]?.trackingAllocations || rawItems?.[index]?.tracking_allocations || [],
  });
}

export function sourceLineId(item, camel, snake) {
  return item?.[camel] ?? item?.[snake] ?? item?.sourceItemId ?? item?.source_item_id ?? null;
}

export function normalizeSourcedLogisticsItems(db, items, {
  sourceTable, sourceHeaderColumn, sourceHeaderId, sourceIdCamel, sourceIdSnake, useSourceAmountRatio = false,
  allowDuplicateSourceItems = false,
}) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, '请添加来源明细');
  const sourceStmt = db.prepare(`SELECT id,product_id,quantity,unit_price_cents,amount_cents,document_uom_code,document_quantity_num,
    document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den
    FROM ${sourceTable} WHERE id=? AND ${sourceHeaderColumn}=?`);
  let totalCents = 0;
  const seen = new Set();
  const normalized = items.map((item, index) => {
    const itemId = sourceLineId(item, sourceIdCamel, sourceIdSnake);
    if (!itemId) throw new HttpError(400, `第 ${index + 1} 行来源明细无效或重复`);
    // The notice conversion may map several notice source rows of the SAME
    // purchase order line onto several receipt lines. It therefore opts out of
    // the "one receipt line per order line" rule and relies on its own
    // one-source-row-per-receipt-line guarantee.
    if (!allowDuplicateSourceItems && seen.has(itemId)) throw new HttpError(400, `第 ${index + 1} 行来源明细无效或重复`);
    seen.add(itemId);
    const source = sourceStmt.get(itemId, sourceHeaderId);
    if (!source) throw new HttpError(400, `第 ${index + 1} 行来源明细不属于来源单据`);
    if (item.productId !== undefined && item.productId !== source.product_id) throw new HttpError(400, `第 ${index + 1} 行货品与来源不一致`);
    if (item.unitPriceCents !== undefined && item.unitPriceCents !== null && item.unitPriceCents !== '' && Number(item.unitPriceCents) !== source.unit_price_cents) {
      throw new HttpError(400, `第 ${index + 1} 行单价与来源商业价格不一致`);
    }
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new HttpError(400, `第 ${index + 1} 行数量必须为正整数`);
    const conversionNumerator = Number(source.conversion_numerator || 1);
    const conversionDenominator = Number(source.conversion_denominator || 1);
    const documentQuantity = rational(BigInt(quantity) * BigInt(conversionDenominator), conversionNumerator);
    const baseQuantity = rational(quantity, 1);
    const amountCents = useSourceAmountRatio
      ? roundRational(BigInt(source.amount_cents) * BigInt(quantity) * 1_000_000n, BigInt(Math.round(Number(source.quantity) * 1_000_000)))
      : roundRational(BigInt(documentQuantity.num) * BigInt(source.unit_price_cents), documentQuantity.den);
    totalCents += amountCents;
    if (!Number.isSafeInteger(totalCents)) throw new HttpError(400, '单据金额超出安全范围');
    return { sourceItemId: source.id, productId: source.product_id, quantity, unitPriceCents: source.unit_price_cents, amountCents, lineNo: index + 1,
      sourceQuantity: Number(source.quantity), documentUomCode: source.document_uom_code,
      documentQuantityNumerator: documentQuantity.num, documentQuantityDenominator: documentQuantity.den,
      conversionNumerator, conversionDenominator, baseQuantityNumerator: baseQuantity.num, baseQuantityDenominator: baseQuantity.den,
      deliveryScheduleId: item.deliveryScheduleId ?? item.delivery_schedule_id ?? null,
      sourceNoticeItemSourceId: item.sourceNoticeItemSourceId ?? item.source_notice_item_source_id ?? null };
  });
  return { items: normalized, totalCents };
}

export function assertImmutableSourceItems(db, table, foreignKey, documentId, sourceColumn, items) {
  const stored = db.prepare(`SELECT ${sourceColumn} id FROM ${table} WHERE ${foreignKey}=? ORDER BY line_no`).all(documentId).map((row) => row.id);
  const incoming = items.map((item) => item.sourceItemId);
  if (stored.length !== incoming.length || stored.some((value, index) => value !== incoming[index])) {
    throw new HttpError(409, '来源明细不可修改；请取消草稿后重新创建');
  }
}

export function confirmedQuantity(db, { itemTable, sourceColumn, headerTable, headerForeignKey, status = 'CONFIRMED' }, sourceItemId, excludeHeaderId = null) {
  let sql = `SELECT COALESCE(SUM(i.quantity),0) quantity FROM ${itemTable} i JOIN ${headerTable} h ON h.id=i.${headerForeignKey} WHERE i.${sourceColumn}=? AND h.status=?`;
  const params = [sourceItemId, status];
  if (excludeHeaderId) { sql += ' AND h.id<>?'; params.push(excludeHeaderId); }
  return Number(db.prepare(sql).get(...params).quantity);
}

export function assertRemainingQuantity(db, input, quantityConfig, label) {
  for (const item of input.items) {
    const already = confirmedQuantity(db, quantityConfig, item.sourceItemId);
    if (already + item.quantity > item.sourceQuantity) throw new HttpError(409, `${label}数量超过来源剩余可执行数量`);
  }
}

export function authoritativeLogisticsTotal(db, table, foreignKey, documentId, { preserveAmount = false } = {}) {
  const items = db.prepare(`SELECT * FROM ${table} WHERE ${foreignKey}=? ORDER BY line_no`).all(documentId);
  if (!items.length) throw new HttpError(409, '单据没有明细，无法确认');
  let totalCents = 0;
  for (const item of items) {
    const quantity = Number(item.quantity);
    const unitPriceCents = Number(item.unit_price_cents);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new HttpError(409, '单据明细数量或单价不正确');
    const amountCents = preserveAmount ? Number(item.amount_cents) : quantity * unitPriceCents;
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new HttpError(409, '单据明细金额不正确');
    if (Number(item.amount_cents) !== amountCents) db.prepare(`UPDATE ${table} SET amount_cents=? WHERE id=?`).run(amountCents, item.id);
    item.amount_cents = amountCents;
    totalCents += amountCents;
    if (!Number.isSafeInteger(totalCents)) throw new HttpError(409, '单据金额超出安全范围');
  }
  return { items, totalCents };
}

export function fulfillmentState(executed, sourceQuantity, labels) {
  if (executed <= 0) return labels[0];
  return executed >= sourceQuantity ? labels[2] : labels[1];
}
