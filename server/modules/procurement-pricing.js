import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, requiredText, send,
} from '../lib/http.js';
import { quantitySnapshot, roundRational } from './commercial-golive.js';

const VIEW_PERMISSIONS = ['PROCUREMENT_CONFIG_VIEW', 'PROCUREMENT_CONFIG_MANAGE'];
const SOURCES = new Set(['PURCHASE', 'OUTSOURCE']);
const STATUS = new Set(['ACTIVE', 'INACTIVE']);
const DISCOUNT_BASIS = new Set(['PERCENT', 'FLAT']);

function assertViewPermission(actor) { allowAny(actor, VIEW_PERMISSIONS); }
function assertManagePermission(actor) { allow(actor, 'PROCUREMENT_CONFIG_MANAGE'); }

function normalizeSourceType(value, label = '采购类型') {
  const text = String(value ?? '').trim().toUpperCase();
  if (!SOURCES.has(text)) throw new HttpError(400, `${label}不正确`);
  return text;
}

function normalizeStatus(value, label = '状态') {
  const text = String(value ?? '').trim().toUpperCase();
  if (!STATUS.has(text)) throw new HttpError(400, `${label}不正确`);
  return text;
}

function normalizeDiscountBasis(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!DISCOUNT_BASIS.has(text)) throw new HttpError(400, '折扣基础不正确');
  return text;
}

function ensureProductAndUom(db, productId, uomCode) {
  const product = db.prepare('SELECT id, base_uom_code FROM products WHERE id=?').get(productId);
  if (!product) throw new HttpError(409, '产品不存在');
  return product;
}

function rowToPriceEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    supplierId: row.supplier_id,
    productId: row.product_id,
    sourceType: row.source_type,
    pricingUomCode: row.pricing_uom_code,
    unitPriceCents: row.unit_price_cents,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function rowToDiscount(row) {
  if (!row) return null;
  return {
    id: row.id,
    supplierId: row.supplier_id,
    productId: row.product_id,
    sourceType: row.source_type,
    basis: row.basis,
    value: { num: row.value_numerator, den: row.denominator },
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function listPriceList(db, res, actor, url) {
  assertViewPermission(actor);
  const conditions = [];
  const params = [];
  const supplierId = url.searchParams.get('supplierId');
  const productId = url.searchParams.get('productId');
  const sourceType = url.searchParams.get('sourceType');
  const status = url.searchParams.get('status');
  const date = url.searchParams.get('date');
  if (supplierId) { conditions.push('supplier_id=?'); params.push(supplierId); }
  if (productId) { conditions.push('product_id=?'); params.push(productId); }
  if (sourceType) { conditions.push('source_type=?'); params.push(normalizeSourceType(sourceType)); }
  if (status) { conditions.push('status=?'); params.push(normalizeStatus(status)); }
  if (date) { conditions.push('effective_from<=? AND (effective_to IS NULL OR effective_to>=?)'); params.push(date, date); }
  const sql = `SELECT * FROM purchase_price_list_entries ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY product_id, version DESC`;
  const rows = db.prepare(sql).all(...params).map(rowToPriceEntry);
  return send(res, 200, { priceList: rows });
}

export async function createPriceListEntry(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'productId', 'sourceType', 'pricingUomCode', 'unitPriceCents', 'effectiveFrom', 'effectiveTo', 'status']);
  const supplierId = requiredText(body.supplierId, '供应商', 100);
  const productId = requiredText(body.productId, '产品', 100);
  const sourceType = normalizeSourceType(body.sourceType);
  const uom = requiredText(body.pricingUomCode, '定价单位', 20);
  const priceCents = Number(body.unitPriceCents);
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw new HttpError(400, '价格必须为非负整数');
  ensureProductAndUom(db, productId, uom);
  const date = body.effectiveFrom || new Date().toISOString().slice(0, 10);
  const status = body.status ? normalizeStatus(body.status) : 'ACTIVE';
  const version = Number((db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM purchase_price_list_entries WHERE supplier_id=? AND product_id=? AND source_type=? AND pricing_uom_code=?').get(supplierId, productId, sourceType, uom).n) || 1);
  const entryId = randomUUID(); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE purchase_price_list_entries SET effective_to=? WHERE supplier_id=? AND product_id=? AND source_type=? AND pricing_uom_code=? AND effective_to IS NULL').run(date, supplierId, productId, sourceType, uom);
    db.prepare(`INSERT INTO purchase_price_list_entries(id,supplier_id,product_id,source_type,pricing_uom_code,unit_price_cents,status,effective_from,effective_to,version,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(entryId, supplierId, productId, sourceType, uom, priceCents, status, date, body.effectiveTo || null, version, actor.id, now);
    db.prepare(`INSERT INTO purchase_price_list_versions(id,entry_id,version,snapshot_json,created_by,created_at)
      VALUES(?,?,?,?,?,?)`).run(randomUUID(), entryId, version, JSON.stringify({ supplierId, productId, sourceType, uom, priceCents, status }), actor.id, now);
    audit(db, actor.id, 'CREATE', 'PURCHASE_PRICE_LIST_ENTRY', entryId, `${supplierId}:${productId}:${sourceType}:${uom}`);
  });
  return send(res, 201, { id: entryId });
}

export async function adjustPriceList(db, req, res, actor, entryId) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['unitPriceCents', 'effectiveFrom', 'effectiveTo']);
  const existing = db.prepare('SELECT * FROM purchase_price_list_entries WHERE id=?').get(entryId);
  if (!existing) throw new HttpError(404, '价格条目不存在');
  const nextPriceCents = Number(body.unitPriceCents);
  if (!Number.isSafeInteger(nextPriceCents) || nextPriceCents < 0) throw new HttpError(400, '价格必须为非负整数');
  const date = body.effectiveFrom || new Date().toISOString().slice(0, 10);
  const version = Number((db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM purchase_price_list_entries WHERE supplier_id=? AND product_id=? AND source_type=? AND pricing_uom_code=?').get(existing.supplier_id, existing.product_id, existing.source_type, existing.pricing_uom_code).n) || 1);
  const newEntryId = randomUUID(); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE purchase_price_list_entries SET effective_to=? WHERE supplier_id=? AND product_id=? AND source_type=? AND pricing_uom_code=? AND effective_to IS NULL').run(date, existing.supplier_id, existing.product_id, existing.source_type, existing.pricing_uom_code);
    db.prepare(`INSERT INTO purchase_price_list_entries(id,supplier_id,product_id,source_type,pricing_uom_code,unit_price_cents,status,effective_from,effective_to,version,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(newEntryId, existing.supplier_id, existing.product_id, existing.source_type, existing.pricing_uom_code, nextPriceCents, existing.status, date, body.effectiveTo || null, version, actor.id, now);
    db.prepare(`INSERT INTO purchase_price_list_versions(id,entry_id,version,snapshot_json,created_by,created_at)
      VALUES(?,?,?,?,?,?)`).run(randomUUID(), newEntryId, version, JSON.stringify({ unitPriceCents: nextPriceCents, effectiveFrom: date, effectiveTo: body.effectiveTo || null }), actor.id, now);
    audit(db, actor.id, 'ADJUST', 'PURCHASE_PRICE_LIST_ENTRY', newEntryId, `价格调整 ${existing.unit_price_cents} -> ${nextPriceCents}`);
  });
  return send(res, 201, { id: newEntryId });
}

export function listDiscounts(db, res, actor, url) {
  assertViewPermission(actor);
  const conditions = [];
  const params = [];
  const supplierId = url.searchParams.get('supplierId');
  const productId = url.searchParams.get('productId');
  const sourceType = url.searchParams.get('sourceType');
  const status = url.searchParams.get('status');
  const date = url.searchParams.get('date');
  if (supplierId) { conditions.push('supplier_id=?'); params.push(supplierId); }
  if (productId) { conditions.push('product_id=?'); params.push(productId); }
  if (sourceType) { conditions.push('source_type=?'); params.push(normalizeSourceType(sourceType)); }
  if (status) { conditions.push('status=?'); params.push(normalizeStatus(status)); }
  if (date) { conditions.push('effective_from<=? AND (effective_to IS NULL OR effective_to>=?)'); params.push(date, date); }
  const rows = db.prepare(`SELECT * FROM pricing_discount_schemes ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY product_id, version DESC`).all(...params).map(rowToDiscount);
  return send(res, 200, { discounts: rows });
}

export async function upsertDiscount(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'productId', 'sourceType', 'basis', 'value', 'effectiveFrom', 'effectiveTo']);
  const supplierId = requiredText(body.supplierId, '供应商', 100);
  const productId = requiredText(body.productId, '产品', 100);
  const sourceType = normalizeSourceType(body.sourceType);
  const basis = normalizeDiscountBasis(body.basis);
  const num = Number(body.value?.num ?? body.value?.numerator ?? body.value);
  const den = Number(body.value?.den ?? body.value?.denominator ?? 1);
  if (!Number.isFinite(num) || !Number.isFinite(den) || num < 0 || den <= 0) throw new HttpError(400, '折扣值必须为非负有理数');
  const date = body.effectiveFrom || new Date().toISOString().slice(0, 10);
  const status = body.status ? normalizeStatus(body.status) : 'ACTIVE';
  const version = Number((db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM pricing_discount_schemes WHERE supplier_id=? AND product_id=? AND source_type=?').get(supplierId, productId, sourceType).n) || 1);
  const discountId = randomUUID(); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE pricing_discount_schemes SET effective_to=? WHERE supplier_id=? AND product_id=? AND source_type=? AND effective_to IS NULL').run(date, supplierId, productId, sourceType);
    db.prepare(`INSERT INTO pricing_discount_schemes(id,supplier_id,product_id,source_type,basis,value_numerator,denominator,formula_json,status,effective_from,effective_to,version,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(discountId, supplierId, productId, sourceType, basis, num, den, body.formula ? JSON.stringify(body.formula) : null, status, date, body.effectiveTo || null, version, actor.id, now);
    audit(db, actor.id, 'UPSERT', 'PRICING_DISCOUNT_SCHEME', discountId, `${supplierId}:${productId}:${sourceType}:${basis}`);
  });
  return send(res, 201, { id: discountId });
}

function safeRational(num, den, label) {
  let numerator = BigInt(num); let denominator = BigInt(den);
  if (denominator <= 0n) throw new HttpError(409, `${label}分母必须大于 0`);
  const gcd = (left, right) => { let a = left < 0n ? -left : left; let b = right; while (b) [a, b] = [b, a % b]; return a || 1n; };
  const factor = gcd(numerator, denominator); numerator /= factor; denominator /= factor;
  const n = Number(numerator); const d = Number(denominator);
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) throw new HttpError(409, `${label}超出安全整数范围`);
  return { num: n, den: d };
}

export function resolvePurchaseLinePricing(db, input) {
  const supplierId = requiredText(input.supplierId, '供应商', 100);
  const productId = requiredText(input.productId, '产品', 100);
  const sourceType = normalizeSourceType(input.sourceType);
  const product = db.prepare('SELECT id,base_uom_code FROM products WHERE id=?').get(productId);
  if (!product) throw new HttpError(409, '产品不存在', { code: 'PURCHASE_PRODUCT_INVALID' });
  // A missing document unit falls back to the product's base unit; the
  // conversion snapshot below is what proves the ratio is real.
  const documentUomCode = input.documentUomCode
    ? String(input.documentUomCode).trim()
    : (product.base_uom_code || null);
  const date = input.businessDate || new Date().toISOString().slice(0, 10);
  const giftLine = Boolean(input.giftLine);
  const giftDocument = giftLine ? quantitySnapshot(db, productId, {
    uomCode: documentUomCode,
    quantityNumerator: input.documentQuantity?.num ?? input.quantityNumerator,
    quantityDenominator: input.documentQuantity?.den ?? input.quantityDenominator ?? 1,
  }, date) : null;
  if (giftLine) {
    // A gift line is a legitimate zero-price commercial line. It never carries
    // a commercial price, so the ordinary price list is not consulted at all:
    // an available price entry must not turn a gift into a priced line
    // (Requirement §31.3.1 PRC-15).
    return {
      contractVersion: 'PURCHASE_PRICE_V1', supplierId, productId, sourceType,
      businessDate: date, documentUomCode, pricingUomCode: null,
      priceEntryId: null, priceVersion: null, unitPriceCents: 0,
      documentQuantity: giftDocument.doc, baseQuantity: giftDocument.base, pricingQuantity: null,
      conversion: giftDocument.conversion, netCents: 0, discountCents: 0, grossCents: 0,
      appliedDiscount: null, giftLine: true, roundingContract: 'HALF_UP_CENT_V1',
    };
  }
  const rows = input.explicitPriceEntryId
    ? db.prepare(`SELECT * FROM purchase_price_list_entries WHERE id=? AND supplier_id=? AND product_id=? AND source_type=? AND status='ACTIVE'
        AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)`).all(input.explicitPriceEntryId, supplierId, productId, sourceType, date, date)
    : db.prepare(`SELECT * FROM purchase_price_list_entries WHERE supplier_id=? AND product_id=? AND source_type=? AND status='ACTIVE'
        AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY version DESC, id`).all(supplierId, productId, sourceType, date, date);
  if (!rows.length) {
    throw new HttpError(409, '未找到有效价格条目', { code: 'PURCHASE_PRICE_NOT_CONFIGURED' });
  }
  // 多个计价单位同时有效时，优先取与单据单位一致的那一条：买方按什么单位下
  // 单，就用那个单位的价格条目换算。只有一条有效价格时按它的计价单位换算。
  // 仍无法唯一确定时 fail closed，绝不隐式选主（§31.17 裁定 11）。
  const documentMatches = rows.filter((row) => row.pricing_uom_code === documentUomCode);
  const pool = documentMatches.length ? documentMatches : rows;
  const latestVersion = Math.max(...pool.map((row) => Number(row.version)));
  const latest = pool.filter((row) => Number(row.version) === latestVersion);
  if (latest.length !== 1) {
    const units = [...new Set(latest.map((row) => row.pricing_uom_code))].join(' / ');
    throw new HttpError(409, `存在多个同版本有效采购价格（计价单位 ${units}），无法确定唯一计价单位`, { code: 'PURCHASE_PRICE_AMBIGUOUS' });
  }
  const priceRow = latest[0];
  const document = quantitySnapshot(db, productId, {
    uomCode: documentUomCode,
    quantityNumerator: input.documentQuantity?.num ?? input.quantityNumerator,
    quantityDenominator: input.documentQuantity?.den ?? input.quantityDenominator ?? 1,
  }, date);
  const pricingUnit = quantitySnapshot(db, productId, {
    uomCode: priceRow.pricing_uom_code, quantityNumerator: 1, quantityDenominator: 1,
  }, date);
  const pricingQuantity = safeRational(
    BigInt(document.base.num) * BigInt(pricingUnit.base.den),
    BigInt(document.base.den) * BigInt(pricingUnit.base.num),
    '计价数量',
  );
  const discount = db.prepare(`SELECT * FROM pricing_discount_schemes WHERE supplier_id=? AND product_id=? AND source_type=? AND status='ACTIVE' AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY version DESC LIMIT 1`).get(supplierId, productId, priceRow.source_type, date, date);
  const netCents = roundRational(BigInt(priceRow.unit_price_cents) * BigInt(pricingQuantity.num), BigInt(pricingQuantity.den));
  let discountCents = 0;
  let appliedDiscount = null;
  if (discount) {
    if (discount.basis === 'PERCENT') {
      discountCents = roundRational(BigInt(netCents) * BigInt(discount.value_numerator), BigInt(discount.denominator));
    } else if (discount.basis === 'FLAT') {
      discountCents = roundRational(
        BigInt(discount.value_numerator) * BigInt(pricingQuantity.num),
        BigInt(discount.denominator) * BigInt(pricingQuantity.den),
      );
    }
    discountCents = Math.min(netCents, discountCents);
    appliedDiscount = { id: discount.id, basis: discount.basis, version: discount.version };
  }
  return {
    contractVersion: 'PURCHASE_PRICE_V1', supplierId, productId, sourceType: priceRow.source_type,
    businessDate: date, documentUomCode, pricingUomCode: priceRow.pricing_uom_code,
    priceEntryId: priceRow.id, priceVersion: priceRow.version,
    unitPriceCents: priceRow.unit_price_cents,
    documentQuantity: document.doc, baseQuantity: document.base, pricingQuantity,
    conversion: document.conversion, netCents, discountCents, grossCents: netCents - discountCents,
    appliedDiscount, giftLine, roundingContract: 'HALF_UP_CENT_V1',
  };
}

/**
 * Read-only pricing preview. It resolves the same evidence the purchase order
 * writer freezes, so the UI never recomputes an authoritative amount.
 */
export async function previewPurchaseLinePricing(db, req, res, actor) {
  assertViewPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'productId', 'sourceType', 'documentUomCode', 'documentQuantity', 'businessDate', 'priceEntryId', 'giftLine']);
  const pricing = resolvePurchaseLinePricing(db, {
    supplierId: body.supplierId,
    productId: body.productId,
    sourceType: body.sourceType || 'PURCHASE',
    documentUomCode: body.documentUomCode,
    documentQuantity: {
      num: body.documentQuantity?.num ?? body.documentQuantity ?? 1,
      den: body.documentQuantity?.den ?? 1,
    },
    businessDate: body.businessDate,
    explicitPriceEntryId: body.priceEntryId || undefined,
    giftLine: Boolean(body.giftLine),
  });
  return send(res, 200, { pricing });
}
