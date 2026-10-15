import { id } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, normalizeBusinessDate,
  optionalText, readJson, send,
} from '../lib/http.js';
import {
  assertDateRange, boolInt, conflict, intervalsOverlap, lockById, mapBoolFields,
  nullableId, optionalDate, previousDate, runSalesWrite, translateConstraintError,
} from './sales-foundation-common.js';
import { resolveSalesParameters } from './sales-parameters.js';

// Read authorization. Commercial extensions / customer-material xref /
// sellable rules / product commercial classification expose Sales-side
// commercial defaults that are NOT part of the customer-master view
// granted by CUSTOMERS_VIEW / CUSTOMERS_MANAGE. Customer-clerk actors
// must NOT see them; the canonical Wave 1 read authority is one of the
// SALES_FOUNDATION_* / SALES_COMMERCIAL_MANAGE permissions, or the
// global USERS_MANAGE / ROLES_MANAGE (admin). Back-end POSITIVE
// permission; no hidden fallback, no implicit widening by Customer /
const VIEW = ['SALES_FOUNDATION_VIEW', 'SALES_FOUNDATION_MANAGE', 'SALES_COMMERCIAL_MANAGE', 'USERS_MANAGE'];
const SERVICE_KINDS = Object.freeze(['STANDARD_SERVICE', 'INSTALLATION', 'MAINTENANCE', 'CONSULTING', 'OTHER']);

function extensionRow(row) {
  return row && {
    id: `${row.customer_id}~${row.effective_from}`,
    customerId: row.customer_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    settlementPartyCustomerId: row.settlement_party_customer_id,
    settlementPartyName: row.settlement_party_name,
    payerCustomerId: row.payer_customer_id,
    payerName: row.payer_name,
    defaultSalespersonId: row.default_salesperson_id,
    defaultSalespersonName: row.default_salesperson_name,
    defaultSalesGroupId: row.default_sales_group_id,
    defaultSalesGroupName: row.default_sales_group_name,
    defaultPricingListId: row.default_pricing_list_id,
    defaultPricingListName: row.default_pricing_list_name,
    defaultDiscountSchemeId: row.default_discount_scheme_id,
    defaultDiscountSchemeName: row.default_discount_scheme_name,
    defaultPaymentTermsDays: row.default_payment_terms_days,
    defaultSettlementMethod: row.default_settlement_method,
    sellableScopeMode: row.sellable_scope_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const EXTENSION_SELECT = `SELECT e.*,
  sp.name settlement_party_name,py.name payer_name,
  s.name default_salesperson_name,g.name default_sales_group_name,
  pl.name default_pricing_list_name,ds.name default_discount_scheme_name
  FROM customer_commercial_extensions e
  LEFT JOIN customers sp ON sp.id=e.settlement_party_customer_id
  LEFT JOIN customers py ON py.id=e.payer_customer_id
  LEFT JOIN salesperson_profiles s ON s.id=e.default_salesperson_id
  LEFT JOIN sales_groups g ON g.id=e.default_sales_group_id
  LEFT JOIN sales_price_lists pl ON pl.id=e.default_pricing_list_id
  LEFT JOIN sales_discount_schemes ds ON ds.id=e.default_discount_scheme_id`;

export function listCustomerCommercialExtensions(db, res, actor, url) {
  allowAny(actor, VIEW);
  const customerId = String(url.searchParams.get('customerId') || '').trim();
  if (!customerId) throw new HttpError(400, '请指定客户');
  const businessDate = url.searchParams.get('businessDate');
  const rows = businessDate
    ? db.prepare(`${EXTENSION_SELECT} WHERE e.customer_id=? AND e.effective_from<=? AND (e.effective_to IS NULL OR e.effective_to>=?) ORDER BY e.effective_from DESC`).all(customerId, normalizeBusinessDate(businessDate), businessDate)
    : db.prepare(`${EXTENSION_SELECT} WHERE e.customer_id=? ORDER BY e.effective_from DESC`).all(customerId);
  return send(res, 200, { extensions: rows.map(extensionRow) });
}

function extensionInput(body) {
  assertAllowedFields(body, [
    'customerId', 'effectiveFrom', 'effectiveTo', 'settlementPartyCustomerId', 'payerCustomerId',
    'defaultSalespersonId', 'defaultSalesGroupId', 'defaultPricingListId', 'defaultDiscountSchemeId', 'defaultPaymentTermsDays',
    'defaultSettlementMethod', 'sellableScopeMode', 'supersedeCurrent',
  ]);
  const customerId = nullableId(body.customerId);
  if (!customerId) throw new HttpError(400, '客户不能为空');
  const effectiveFrom = normalizeBusinessDate(body.effectiveFrom, '生效日期');
  const effectiveTo = optionalDate(body.effectiveTo);
  assertDateRange(effectiveFrom, effectiveTo);
  const days = body.defaultPaymentTermsDays === '' || body.defaultPaymentTermsDays === null || body.defaultPaymentTermsDays === undefined
    ? null : Number(body.defaultPaymentTermsDays);
  if (days !== null && (!Number.isSafeInteger(days) || days < 0 || days > 3650)) throw new HttpError(400, '默认付款条款天数必须是 0–3650 的整数');
  const mode = String(body.sellableScopeMode || '').trim().toUpperCase();
  if (!['ALL_SALES_ENABLED', 'RULE_CONTROLLED'].includes(mode)) throw new HttpError(400, '可销范围模式无效');
  return {
    customerId, effectiveFrom, effectiveTo,
    settlementPartyCustomerId: nullableId(body.settlementPartyCustomerId),
    payerCustomerId: nullableId(body.payerCustomerId),
    defaultSalespersonId: nullableId(body.defaultSalespersonId),
    defaultSalesGroupId: nullableId(body.defaultSalesGroupId),
    defaultPricingListId: nullableId(body.defaultPricingListId),
    defaultDiscountSchemeId: nullableId(body.defaultDiscountSchemeId),
    defaultPaymentTermsDays: days,
    defaultSettlementMethod: optionalText(body.defaultSettlementMethod, 50) || null,
    sellableScopeMode: mode,
    supersedeCurrent: body.supersedeCurrent === true,
  };
}

function validateExtensionRefs(db, value) {
  for (const customerId of [value.customerId, value.settlementPartyCustomerId, value.payerCustomerId].filter(Boolean)) {
    if (!db.prepare('SELECT 1 FROM customers WHERE id=?').get(customerId)) throw new HttpError(400, '客户引用不存在');
  }
  if (value.defaultSalespersonId && !db.prepare('SELECT 1 FROM salesperson_profiles WHERE id=? AND active=1').get(value.defaultSalespersonId)) throw new HttpError(400, '默认销售员不存在或已停用');
  if (value.defaultSalesGroupId && !db.prepare('SELECT 1 FROM sales_groups WHERE id=? AND active=1').get(value.defaultSalesGroupId)) throw new HttpError(400, '默认销售组不存在或已停用');
  if (value.defaultPricingListId && !db.prepare(`SELECT 1 FROM sales_price_lists WHERE id=? AND status='ACTIVE'
    AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)`).get(value.defaultPricingListId, value.effectiveFrom, value.effectiveFrom)) {
    throw new HttpError(400, '默认价目表不存在、未启用或在扩展生效日不可用');
  }
  if (value.defaultDiscountSchemeId && !db.prepare(`SELECT 1 FROM sales_discount_schemes WHERE id=? AND status='ACTIVE'
    AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)`).get(value.defaultDiscountSchemeId, value.effectiveFrom, value.effectiveFrom)) {
    throw new HttpError(400, '默认折扣方案不存在、未启用或在扩展生效日不可用');
  }
  if (value.defaultSalespersonId && value.defaultSalesGroupId) {
    const valid = db.prepare(`SELECT 1 FROM salesperson_group_memberships WHERE salesperson_id=? AND sales_group_id=? AND active=1
      AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)`).get(value.defaultSalespersonId, value.defaultSalesGroupId, value.effectiveFrom, value.effectiveFrom);
    if (!valid) throw new HttpError(409, '默认销售员在生效日不属于默认销售组', { code: 'CUSTOMER_COMMERCIAL_DEFAULT_MEMBERSHIP_INVALID' });
  }
}

export async function createCustomerCommercialExtension(db, req, res, actor) {
  allow(actor, 'SALES_COMMERCIAL_MANAGE');
  const value = extensionInput(await readJson(req));
  const now = new Date().toISOString();
  runSalesWrite(db, () => {
    if (!lockById(db, 'customers', value.customerId)) throw new HttpError(404, '客户不存在');
    validateExtensionRefs(db, value);
    let rows = db.prepare('SELECT * FROM customer_commercial_extensions WHERE customer_id=? ORDER BY effective_from').all(value.customerId);
    const overlaps = rows.filter((row) => intervalsOverlap(row.effective_from, row.effective_to, value.effectiveFrom, value.effectiveTo));
    if (overlaps.length && value.supersedeCurrent) {
      if (overlaps.length !== 1 || overlaps[0].effective_from >= value.effectiveFrom) throw conflict('受控接替只能关闭一条更早的有效版本', 'CUSTOMER_COMMERCIAL_SUPERSESSION_INVALID');
      db.prepare('UPDATE customer_commercial_extensions SET effective_to=?,updated_at=?,updated_by=? WHERE customer_id=? AND effective_from=?')
        .run(previousDate(value.effectiveFrom), now, actor.id, value.customerId, overlaps[0].effective_from);
      audit(db, actor.id, 'SUPERSEDE', 'CUSTOMER_COMMERCIAL_EXTENSION', `${value.customerId}:${overlaps[0].effective_from}`, value.effectiveFrom);
      rows = db.prepare('SELECT * FROM customer_commercial_extensions WHERE customer_id=? ORDER BY effective_from').all(value.customerId);
    }
    if (rows.some((row) => intervalsOverlap(row.effective_from, row.effective_to, value.effectiveFrom, value.effectiveTo))) {
      throw conflict('客户商业扩展有效期与现有版本重叠', 'CUSTOMER_COMMERCIAL_INTERVAL_OVERLAP');
    }
    db.prepare(`INSERT INTO customer_commercial_extensions(customer_id,effective_from,settlement_party_customer_id,payer_customer_id,
      default_salesperson_id,default_sales_group_id,default_pricing_list_id,default_discount_scheme_id,default_payment_terms_days,default_settlement_method,sellable_scope_mode,effective_to,
      created_at,updated_at,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(value.customerId, value.effectiveFrom, value.settlementPartyCustomerId, value.payerCustomerId,
        value.defaultSalespersonId, value.defaultSalesGroupId, value.defaultPricingListId, value.defaultDiscountSchemeId, value.defaultPaymentTermsDays, value.defaultSettlementMethod,
        value.sellableScopeMode, value.effectiveTo, now, now, actor.id, actor.id);
    audit(db, actor.id, 'CREATE', 'CUSTOMER_COMMERCIAL_EXTENSION', `${value.customerId}:${value.effectiveFrom}`, value.sellableScopeMode);
  });
  const row = db.prepare(`${EXTENSION_SELECT} WHERE e.customer_id=? AND e.effective_from=?`).get(value.customerId, value.effectiveFrom);
  return send(res, 201, { extension: extensionRow(row) });
}

export async function updateCustomerCommercialExtension(db, req, res, actor, versionId) {
  allow(actor, 'SALES_COMMERCIAL_MANAGE');
  const split = String(versionId || '').lastIndexOf('~');
  if (split < 1) throw new HttpError(400, '客户商业扩展版本标识无效');
  const customerId = versionId.slice(0, split);
  const effectiveFrom = normalizeBusinessDate(versionId.slice(split + 1), '生效日期');
  const body = await readJson(req);
  assertAllowedFields(body, ['effectiveTo', 'settlementPartyCustomerId', 'payerCustomerId', 'defaultSalespersonId', 'defaultSalesGroupId', 'defaultPricingListId', 'defaultDiscountSchemeId', 'defaultPaymentTermsDays', 'defaultSettlementMethod', 'sellableScopeMode']);
  const now = new Date().toISOString();
  runSalesWrite(db, () => {
    if (!lockById(db, 'customers', customerId)) throw new HttpError(404, '客户不存在');
    const suffix = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const old = db.prepare(`SELECT * FROM customer_commercial_extensions WHERE customer_id=? AND effective_from=?${suffix}`).get(customerId, effectiveFrom);
    if (!old) throw new HttpError(404, '客户商业扩展版本不存在');
    const value = extensionInput({
      customerId, effectiveFrom,
      effectiveTo: body.effectiveTo === undefined ? old.effective_to : body.effectiveTo,
      settlementPartyCustomerId: body.settlementPartyCustomerId === undefined ? old.settlement_party_customer_id : body.settlementPartyCustomerId,
      payerCustomerId: body.payerCustomerId === undefined ? old.payer_customer_id : body.payerCustomerId,
      defaultSalespersonId: body.defaultSalespersonId === undefined ? old.default_salesperson_id : body.defaultSalespersonId,
      defaultSalesGroupId: body.defaultSalesGroupId === undefined ? old.default_sales_group_id : body.defaultSalesGroupId,
      defaultPricingListId: body.defaultPricingListId === undefined ? old.default_pricing_list_id : body.defaultPricingListId,
      defaultDiscountSchemeId: body.defaultDiscountSchemeId === undefined ? old.default_discount_scheme_id : body.defaultDiscountSchemeId,
      defaultPaymentTermsDays: body.defaultPaymentTermsDays === undefined ? old.default_payment_terms_days : body.defaultPaymentTermsDays,
      defaultSettlementMethod: body.defaultSettlementMethod === undefined ? old.default_settlement_method : body.defaultSettlementMethod,
      sellableScopeMode: body.sellableScopeMode === undefined ? old.sellable_scope_mode : body.sellableScopeMode,
    });
    validateExtensionRefs(db, value);
    const peers = db.prepare('SELECT * FROM customer_commercial_extensions WHERE customer_id=? AND effective_from<>?').all(customerId, effectiveFrom);
    if (peers.some((row) => intervalsOverlap(row.effective_from, row.effective_to, effectiveFrom, value.effectiveTo))) throw conflict('修改后的有效期与其他版本重叠', 'CUSTOMER_COMMERCIAL_INTERVAL_OVERLAP');
    db.prepare(`UPDATE customer_commercial_extensions SET settlement_party_customer_id=?,payer_customer_id=?,default_salesperson_id=?,default_sales_group_id=?,default_pricing_list_id=?,default_discount_scheme_id=?,default_payment_terms_days=?,default_settlement_method=?,sellable_scope_mode=?,effective_to=?,updated_at=?,updated_by=? WHERE customer_id=? AND effective_from=?`)
      .run(value.settlementPartyCustomerId, value.payerCustomerId, value.defaultSalespersonId, value.defaultSalesGroupId,
        value.defaultPricingListId, value.defaultDiscountSchemeId, value.defaultPaymentTermsDays, value.defaultSettlementMethod, value.sellableScopeMode, value.effectiveTo,
        now, actor.id, customerId, effectiveFrom);
    audit(db, actor.id, 'UPDATE', 'CUSTOMER_COMMERCIAL_EXTENSION', `${customerId}:${effectiveFrom}`, value.sellableScopeMode);
  });
  return send(res, 200, { extension: extensionRow(db.prepare(`${EXTENSION_SELECT} WHERE e.customer_id=? AND e.effective_from=?`).get(customerId, effectiveFrom)) });
}

function xrefRow(row) {
  return mapBoolFields({
    id: row.id, customerId: row.customer_id, productId: row.product_id,
    productCode: row.product_code, productName: row.product_name,
    customerMaterialCode: row.customer_material_code, customerMaterialName: row.customer_material_name,
    commercialUomCode: row.commercial_uom_code, effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to, active: row.active, createdAt: row.created_at, updatedAt: row.updated_at,
  }, ['active']);
}

const XREF_SELECT = `SELECT x.*,p.code product_code,p.name product_name FROM customer_material_xref x JOIN products p ON p.id=x.product_id`;

export function listCustomerMaterialXref(db, res, actor, url) {
  allowAny(actor, VIEW);
  const customerId = String(url.searchParams.get('customerId') || '').trim();
  if (!customerId) throw new HttpError(400, '请指定客户');
  return send(res, 200, { xrefs: db.prepare(`${XREF_SELECT} WHERE x.customer_id=? ORDER BY x.customer_material_code,x.effective_from DESC`).all(customerId).map(xrefRow) });
}

export async function saveCustomerMaterialXref(db, req, res, actor, xrefId = null) {
  allow(actor, 'SALES_COMMERCIAL_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['customerId', 'productId', 'customerMaterialCode', 'customerMaterialName', 'commercialUomCode', 'effectiveFrom', 'effectiveTo', 'active']);
  const now = new Date().toISOString();
  let targetId = xrefId;
  try {
    runSalesWrite(db, () => {
      const old = xrefId ? db.prepare(`SELECT * FROM customer_material_xref WHERE id=?${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(xrefId) : null;
      if (xrefId && !old) throw new HttpError(404, '客户物料对应不存在');
      const customerId = nullableId(body.customerId) || old?.customer_id;
      const productId = nullableId(body.productId) || old?.product_id;
      if (!lockById(db, 'customers', customerId)) throw new HttpError(400, '客户不存在');
      if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(productId)) throw new HttpError(400, '产品不存在');
      const effectiveFrom = body.effectiveFrom === undefined && old ? old.effective_from : normalizeBusinessDate(body.effectiveFrom, '生效日期');
      const effectiveTo = body.effectiveTo === undefined && old ? old.effective_to : optionalDate(body.effectiveTo);
      assertDateRange(effectiveFrom, effectiveTo);
      const code = body.customerMaterialCode === undefined && old ? old.customer_material_code : (optionalText(body.customerMaterialCode, 80) || null);
      const name = body.customerMaterialName === undefined && old ? old.customer_material_name : (optionalText(body.customerMaterialName, 120) || null);
      if (!code && !name) throw new HttpError(400, '客户物料编码或名称至少填写一项');
      const uom = body.commercialUomCode === undefined && old ? old.commercial_uom_code : (nullableId(body.commercialUomCode)?.toUpperCase() || null);
      if (uom) {
        const productRow = db.prepare('SELECT id, base_uom_code FROM products WHERE id=?').get(productId);
        if (!productRow) throw new HttpError(400, '产品不存在');
        assertUomCompatibility(db, productRow, uom, { authoritativeDate: effectiveFrom });
      }
      if (old) {
        if (old.customer_id !== customerId) throw new HttpError(400, '客户物料对应所属客户不可变更');
        db.prepare(`UPDATE customer_material_xref SET product_id=?,customer_material_code=?,customer_material_name=?,commercial_uom_code=?,effective_from=?,effective_to=?,active=?,updated_at=? WHERE id=?`)
          .run(productId, code, name, uom, effectiveFrom, effectiveTo, boolInt(body.active, Boolean(old.active)), now, old.id);
        audit(db, actor.id, 'UPDATE', 'CUSTOMER_MATERIAL_XREF', old.id, `${customerId}:${code || name}`);
      } else {
        targetId = id();
        db.prepare(`INSERT INTO customer_material_xref(id,customer_id,product_id,customer_material_code,customer_material_name,commercial_uom_code,effective_from,effective_to,active,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(targetId, customerId, productId, code, name, uom, effectiveFrom, effectiveTo, boolInt(body.active, true), now, now);
        audit(db, actor.id, 'CREATE', 'CUSTOMER_MATERIAL_XREF', targetId, `${customerId}:${code || name}`);
      }
    });
  } catch (error) { translateConstraintError(error, '客户与内部产品的同日起始版本已存在'); }
  return send(res, xrefId ? 200 : 201, { xref: xrefRow(db.prepare(`${XREF_SELECT} WHERE x.id=?`).get(targetId)) });
}

export function resolveCustomerMaterialXref(db, { customerId, customerMaterialCode, productId, businessDate }) {
  const date = normalizeBusinessDate(businessDate, '业务日期');
  const parameters = resolveSalesParameters(db, 'SALES_ORDER');
  if (!parameters.customerMaterialXrefEnabled) throw conflict('客户物料对应功能未启用', 'CUSTOMER_MATERIAL_XREF_DISABLED');
  if (!productId) throw conflict('存在客户物料候选时必须显式选择内部产品', 'CUSTOMER_MATERIAL_PRODUCT_REQUIRED');
  const rows = db.prepare(`SELECT * FROM customer_material_xref WHERE customer_id=? AND customer_material_code=? AND product_id=? AND active=1
    AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)`).all(customerId, customerMaterialCode, productId, date, date);
  if (rows.length !== 1) throw conflict('所选内部产品没有唯一有效客户物料对应', 'CUSTOMER_MATERIAL_XREF_UNRESOLVED');
  return xrefRow(db.prepare(`${XREF_SELECT} WHERE x.id=?`).get(rows[0].id));
}

function ruleRow(row) {
  return mapBoolFields({ id: row.id, scopeDimension: row.scope_dimension, customerId: row.customer_id, salespersonId: row.salesperson_id, productId: row.product_id, effect: row.effect, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, active: row.active, createdAt: row.created_at, updatedAt: row.updated_at }, ['active']);
}

export function listSellableScopeRules(db, res, actor, url) {
  allowAny(actor, VIEW);
  const clauses = []; const params = [];
  for (const [query, column] of [['customerId', 'customer_id'], ['salespersonId', 'salesperson_id'], ['productId', 'product_id']]) {
    const value = url.searchParams.get(query); if (value) { clauses.push(`${column}=?`); params.push(value); }
  }
  const sql = `SELECT * FROM sales_sellable_scope_rules${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY effective_from DESC,id`;
  return send(res, 200, { rules: db.prepare(sql).all(...params).map(ruleRow) });
}

function ruleInput(body, old = null) {
  const dimension = String(body.scopeDimension ?? old?.scope_dimension ?? '').toUpperCase();
  const effect = String(body.effect ?? old?.effect ?? '').toUpperCase();
  if (!['CUSTOMER_PRODUCT', 'SALESPERSON_PRODUCT', 'SALESPERSON_CUSTOMER'].includes(dimension)) throw new HttpError(400, '可销范围维度无效');
  if (!['ALLOW', 'DENY'].includes(effect)) throw new HttpError(400, '可销范围效果无效');
  const value = {
    dimension, effect,
    customerId: body.customerId === undefined ? old?.customer_id || null : nullableId(body.customerId),
    salespersonId: body.salespersonId === undefined ? old?.salesperson_id || null : nullableId(body.salespersonId),
    productId: body.productId === undefined ? old?.product_id || null : nullableId(body.productId),
    effectiveFrom: body.effectiveFrom === undefined && old ? old.effective_from : normalizeBusinessDate(body.effectiveFrom, '生效日期'),
    effectiveTo: body.effectiveTo === undefined && old ? old.effective_to : optionalDate(body.effectiveTo),
    active: boolInt(body.active, old ? Boolean(old.active) : true),
  };
  assertDateRange(value.effectiveFrom, value.effectiveTo);
  const valid = (dimension === 'CUSTOMER_PRODUCT' && value.customerId && !value.salespersonId && value.productId)
    || (dimension === 'SALESPERSON_PRODUCT' && !value.customerId && value.salespersonId && value.productId)
    || (dimension === 'SALESPERSON_CUSTOMER' && value.customerId && value.salespersonId && !value.productId);
  if (!valid) throw new HttpError(400, '可销范围维度与引用字段不一致');
  return value;
}

export async function saveSellableScopeRule(db, req, res, actor, ruleId = null) {
  allow(actor, 'SALES_COMMERCIAL_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['scopeDimension', 'customerId', 'salespersonId', 'productId', 'effect', 'effectiveFrom', 'effectiveTo', 'active']);
  const now = new Date().toISOString(); let targetId = ruleId;
  runSalesWrite(db, () => {
    const old = ruleId ? db.prepare(`SELECT * FROM sales_sellable_scope_rules WHERE id=?${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(ruleId) : null;
    if (ruleId && !old) throw new HttpError(404, '可销范围规则不存在');
    const value = ruleInput(body, old);
    const anchorTable = value.customerId ? 'customers' : 'salesperson_profiles';
    const anchorId = value.customerId || value.salespersonId;
    if (!lockById(db, anchorTable, anchorId)) throw new HttpError(400, '可销范围锚点不存在');
    if (value.salespersonId && !db.prepare('SELECT 1 FROM salesperson_profiles WHERE id=?').get(value.salespersonId)) throw new HttpError(400, '销售员不存在');
    if (value.productId && !db.prepare('SELECT 1 FROM products WHERE id=?').get(value.productId)) throw new HttpError(400, '产品不存在');
    const peers = db.prepare(`SELECT * FROM sales_sellable_scope_rules WHERE scope_dimension=? AND effect=?
      AND COALESCE(customer_id,'')=COALESCE(?,'') AND COALESCE(salesperson_id,'')=COALESCE(?,'') AND COALESCE(product_id,'')=COALESCE(?,'')
      AND active=1 AND id<>?`).all(value.dimension, value.effect, value.customerId, value.salespersonId, value.productId, ruleId || '');
    if (value.active && peers.some((row) => intervalsOverlap(row.effective_from, row.effective_to, value.effectiveFrom, value.effectiveTo))) {
      throw conflict('相同可销规则的有效期发生重叠', 'SELLABLE_SCOPE_INTERVAL_OVERLAP');
    }
    if (old) {
      db.prepare(`UPDATE sales_sellable_scope_rules SET scope_dimension=?,customer_id=?,salesperson_id=?,product_id=?,effect=?,effective_from=?,effective_to=?,active=?,updated_at=?,updated_by=? WHERE id=?`)
        .run(value.dimension, value.customerId, value.salespersonId, value.productId, value.effect, value.effectiveFrom, value.effectiveTo, value.active, now, actor.id, old.id);
      audit(db, actor.id, 'UPDATE', 'SALES_SELLABLE_SCOPE_RULE', old.id, `${value.dimension}:${value.effect}`);
    } else {
      targetId = id();
      db.prepare(`INSERT INTO sales_sellable_scope_rules(id,scope_dimension,customer_id,salesperson_id,product_id,effect,effective_from,effective_to,active,created_at,updated_at,created_by,updated_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(targetId, value.dimension, value.customerId, value.salespersonId, value.productId, value.effect, value.effectiveFrom, value.effectiveTo, value.active, now, now, actor.id, actor.id);
      audit(db, actor.id, 'CREATE', 'SALES_SELLABLE_SCOPE_RULE', targetId, `${value.dimension}:${value.effect}`);
    }
  });
  return send(res, ruleId ? 200 : 201, { rule: ruleRow(db.prepare('SELECT * FROM sales_sellable_scope_rules WHERE id=?').get(targetId)) });
}

function classificationRow(row) {
  return row && mapBoolFields({ id: row.id, productId: row.product_id, productCode: row.product_code, productName: row.product_name, salesEnabled: row.sales_enabled, salesUomCode: row.sales_uom_code, pricingUomCode: row.pricing_uom_code, defaultUpperDeliveryToleranceBps: row.default_upper_delivery_tolerance_bps, defaultLowerDeliveryToleranceBps: row.default_lower_delivery_tolerance_bps, serviceClassification: row.service_classification, serviceKind: row.service_kind, active: row.active, createdAt: row.created_at, updatedAt: row.updated_at }, ['salesEnabled', 'serviceClassification', 'active']);
}

const CLASSIFICATION_SELECT = `SELECT c.*,p.code product_code,p.name product_name FROM product_commercial_classification c JOIN products p ON p.id=c.product_id`;

export function listProductCommercialClassifications(db, res, actor, url) {
  allowAny(actor, VIEW);
  const productId = url.searchParams.get('productId');
  const rows = productId ? db.prepare(`${CLASSIFICATION_SELECT} WHERE c.product_id=?`).all(productId) : db.prepare(`${CLASSIFICATION_SELECT} ORDER BY p.code`).all();
  return send(res, 200, { classifications: rows.map(classificationRow) });
}

// Master UoM resolver — canonical authoritative contract.
// `effective_from <= authoritative_date <= effective_to` where NULL effective_to
// means "open-ended / still in force". A future-only conversion (effective_from
// later than the authoritative date) and an expired conversion (effective_to
// earlier) are both rejected. The check never reads `product_uom_conversions`
// directly without joining the product anchor and the active flag, so it
// cannot leak a conversion belonging to a different product or an inactive row.
function resolveAuthoritativeDate(value, fallback) {
  if (value) {
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  }
  if (fallback) return String(fallback).trim();
  return new Date().toISOString().slice(0, 10);
}

function findCanonicalConversion(db, productId, uomCode, baseUomCode, authoritativeDate) {
  // Single authoritative query. The top MUST come first; if no top, return null.
  // `active=1` and `effective_from<=? AND (effective_to IS NULL OR effective_to>=?)`
  // is enforced on every product conversion read so we cannot select a
  // future-only, expired, inactive or wrong-product row.
  return db.prepare(`SELECT 1 FROM product_uom_conversions
    WHERE product_id=? AND uom_code=? AND base_uom_code=? AND active=1
      AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)
    ORDER BY effective_from DESC LIMIT 1`).get(productId, uomCode, baseUomCode, authoritativeDate, authoritativeDate);
}

function assertUomCompatibility(db, product, uom, { authoritativeDate } = {}) {
  if (!product || !product.base_uom_code) throw conflict('产品缺少有效 canonical 基本计量单位', 'SALES_UOM_UNAVAILABLE');
  const date = resolveAuthoritativeDate(authoritativeDate, new Date().toISOString().slice(0, 10));
  const code = uom || product.base_uom_code;
  if (!code) throw conflict('产品缺少有效 canonical 基本计量单位', 'SALES_UOM_UNAVAILABLE');
  if (!db.prepare('SELECT 1 FROM uoms WHERE code=? AND active=1').get(code)) throw conflict('产品缺少有效 canonical 基本计量单位', 'SALES_UOM_UNAVAILABLE');
  if (code !== product.base_uom_code) {
    const conversion = findCanonicalConversion(db, product.id, code, product.base_uom_code, date);
    if (!conversion) throw conflict('Sales/Pricing UoM 缺少有效 canonical conversion', 'SALES_UOM_CONVERSION_UNAVAILABLE');
  }
  return code;
}

export async function saveProductCommercialClassification(db, req, res, actor) {
  allow(actor, 'SALES_COMMERCIAL_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['productId', 'salesEnabled', 'salesUomCode', 'pricingUomCode', 'defaultUpperDeliveryToleranceBps', 'defaultLowerDeliveryToleranceBps', 'serviceClassification', 'serviceKind', 'active']);
  const productId = nullableId(body.productId);
  if (!productId) throw new HttpError(400, '产品不能为空');
  const upper = Number(body.defaultUpperDeliveryToleranceBps ?? 0);
  const lower = Number(body.defaultLowerDeliveryToleranceBps ?? 0);
  if (!Number.isSafeInteger(upper) || upper < 0) throw new HttpError(400, '上限交货容差必须为非负整数基点');
  if (!Number.isSafeInteger(lower) || lower < 0 || lower > 10000) throw new HttpError(400, '下限交货容差必须为 0–10000 整数基点');
  const service = boolInt(body.serviceClassification, false);
  const serviceKind = service ? String(body.serviceKind || '').trim().toUpperCase() : null;
  if (service && !SERVICE_KINDS.includes(serviceKind)) throw new HttpError(400, '服务分类类型无效');
  const now = new Date().toISOString(); let targetId;
  runSalesWrite(db, () => {
    const product = lockById(db, 'products', productId) && db.prepare('SELECT id,base_uom_code FROM products WHERE id=?').get(productId);
    if (!product) throw new HttpError(404, '产品不存在');
    const salesUom = body.salesUomCode ? String(body.salesUomCode).trim().toUpperCase() : null;
    const pricingUom = body.pricingUomCode ? String(body.pricingUomCode).trim().toUpperCase() : null;
    // The classification row is a current snapshot. There is no effective
    // interval on `product_commercial_classification` itself, so the
    // authoritative date used to read `product_uom_conversions` is the
    // current business date. Conversion truth is never copied onto this
    // table; future / expired / inactive rows are never accepted.
    assertUomCompatibility(db, product, salesUom);
    assertUomCompatibility(db, product, pricingUom);
    const existing = db.prepare(`SELECT * FROM product_commercial_classification WHERE product_id=?${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(productId);
    if (existing) {
      targetId = existing.id;
      db.prepare(`UPDATE product_commercial_classification SET sales_enabled=?,sales_uom_code=?,pricing_uom_code=?,default_upper_delivery_tolerance_bps=?,default_lower_delivery_tolerance_bps=?,service_classification=?,service_kind=?,active=?,updated_at=?,updated_by=? WHERE id=?`)
        .run(boolInt(body.salesEnabled, Boolean(existing.sales_enabled)), salesUom, pricingUom, upper, lower, service, serviceKind, boolInt(body.active, Boolean(existing.active)), now, actor.id, existing.id);
      audit(db, actor.id, 'UPDATE', 'PRODUCT_COMMERCIAL_CLASSIFICATION', existing.id, productId);
    } else {
      targetId = id();
      db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,service_kind,active,created_at,updated_at,created_by,updated_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(targetId, productId, boolInt(body.salesEnabled, false), salesUom, pricingUom, upper, lower, service, serviceKind, boolInt(body.active, true), now, now, actor.id, actor.id);
      audit(db, actor.id, 'CREATE', 'PRODUCT_COMMERCIAL_CLASSIFICATION', targetId, productId);
    }
  });
  return send(res, 200, { classification: classificationRow(db.prepare(`${CLASSIFICATION_SELECT} WHERE c.id=?`).get(targetId)) });
}

export function assertSalesClassifiedProduct(db, productId) {
  const classification = db.prepare('SELECT * FROM product_commercial_classification WHERE product_id=? AND active=1 AND sales_enabled=1').get(productId);
  if (!classification) throw conflict('产品未完成有效可售分类或已禁售', 'PRODUCT_NOT_SALES_ENABLED');
  return classificationRow(db.prepare(`${CLASSIFICATION_SELECT} WHERE c.id=?`).get(classification.id));
}

export function assertSellableProduct(db, { customerId, salespersonId, productId, businessDate, documentType = 'SALES_ORDER' }) {
  const date = normalizeBusinessDate(businessDate, '业务日期');
  const classification = assertSalesClassifiedProduct(db, productId);
  const parameters = resolveSalesParameters(db, documentType);
  if (!parameters.sellableControlEnabled) return classification;
  const extension = db.prepare(`SELECT * FROM customer_commercial_extensions WHERE customer_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC`).get(customerId, date, date);
  if (!extension) throw conflict('客户缺少业务日期上的商业扩展', 'CUSTOMER_COMMERCIAL_EXTENSION_UNAVAILABLE');
  if (extension.sellable_scope_mode !== 'RULE_CONTROLLED') return classification;
  const rules = db.prepare(`SELECT * FROM sales_sellable_scope_rules WHERE active=1 AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)
    AND ((scope_dimension='CUSTOMER_PRODUCT' AND customer_id=? AND product_id=?)
      OR (scope_dimension='SALESPERSON_PRODUCT' AND salesperson_id=? AND product_id=?)
      OR (scope_dimension='SALESPERSON_CUSTOMER' AND salesperson_id=? AND customer_id=?))`).all(date, date, customerId, productId, salespersonId, productId, salespersonId, customerId);
  if (rules.some((rule) => rule.effect === 'DENY')) throw conflict('可销范围存在显式 DENY', 'SELLABLE_SCOPE_DENIED');
  for (const dimension of ['CUSTOMER_PRODUCT', 'SALESPERSON_PRODUCT', 'SALESPERSON_CUSTOMER']) {
    if (!rules.some((rule) => rule.scope_dimension === dimension && rule.effect === 'ALLOW')) throw conflict(`可销范围缺少 ${dimension} ALLOW`, 'SELLABLE_SCOPE_ALLOW_REQUIRED');
  }
  return classification;
}
