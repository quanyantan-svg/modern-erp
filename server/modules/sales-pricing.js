import { createHash } from 'node:crypto';
import { id, readTransaction, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, assertAllowedFields, normalizeBusinessDate, readJson, send } from '../lib/http.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { assertSalesClassifiedProduct, assertSellableProduct } from './sales-commercial-foundation.js';

const VIEW = 'SALES_PRICING_VIEW';
const MANAGE = 'SALES_PRICING_MANAGE';
const OVERRIDE = 'SALES_PRICING_OVERRIDE';
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const now = () => new Date().toISOString();
const lock = (db) => db.dialect === 'mysql' ? ' FOR UPDATE' : '';

function fail(status, code, message) { throw new HttpError(status, message, { code }); }
function text(value, label, max = 128) {
  const result = String(value ?? '').trim();
  if (!result || Buffer.byteLength(result, 'utf8') > max) fail(422, `${label.toUpperCase().replaceAll(' ', '_')}_INVALID`, `${label}不能为空且不得超过 ${max} 个 UTF-8 字节`);
  return result;
}
function safeInt(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) fail(422, 'SAFE_INTEGER_REQUIRED', `${label}必须是安全整数`);
  return result;
}
function dateRange(fromValue, toValue) {
  const from = normalizeBusinessDate(fromValue, '生效日期');
  const to = toValue ? normalizeBusinessDate(toValue, '失效日期') : null;
  if (to && to < from) fail(422, 'INVALID_EFFECTIVE_RANGE', '失效日期不得早于生效日期');
  return [from, to];
}
function upperHex(value) { return Buffer.from(value, 'utf8').toString('hex').toUpperCase(); }
function entryKeys({ materialId, customerId, customerScopeType, pricingUomCode, qtyBreakMinMicros, effectiveFrom }) {
  if (Buffer.byteLength(materialId, 'utf8') < 1 || Buffer.byteLength(materialId, 'utf8') > 63
    || Buffer.byteLength(pricingUomCode, 'utf8') < 1 || Buffer.byteLength(pricingUomCode, 'utf8') > 32
    || (customerId && (Buffer.byteLength(customerId, 'utf8') < 1 || Buffer.byteLength(customerId, 'utf8') > 63))) {
    fail(422, 'PRICE_IDENTITY_COMPONENT_TOO_LONG', '价格身份组件超过 UTF-8 字节界限');
  }
  return {
    materialKey: `M:${upperHex(materialId)}`,
    customerKey: customerScopeType === 'ALL' ? 'A' : `C:${upperHex(customerId)}`,
    pricingKey: `U:${upperHex(pricingUomCode)}|Q:${String(qtyBreakMinMicros).padStart(16, '0')}|D:${effectiveFrom.replaceAll('-', '')}`,
  };
}
function parseMicros(value) {
  const source = String(value ?? '').trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(source)) fail(422, 'QUANTITY_DECIMAL_INVALID', '数量必须是最多六位小数的非负十进制字符串');
  const [whole, fraction = ''] = source.split('.');
  const result = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (result > MAX_SAFE) fail(422, 'SAFE_INTEGER_REQUIRED', '数量超出安全整数范围');
  return result;
}
function halfUp(numerator, denominator) { return (numerator + denominator / 2n) / denominator; }
function asSafeNumber(value, code = 'SAFE_INTEGER_REQUIRED') {
  if (value < 0n || value > MAX_SAFE) fail(409, code, '计算结果超出安全整数范围');
  return Number(value);
}
function checkedSum(values, code = 'SAFE_INTEGER_REQUIRED') {
  return asSafeNumber(values.reduce((sum, value) => sum + BigInt(value), 0n), code);
}
function assertBaseCurrency(db, currencyCode) {
  const rows = db.prepare('SELECT code FROM currencies WHERE is_base=1 AND active=1 ORDER BY code').all();
  const configured = rows.length === 0 ? 'CNY' : rows.length === 1 ? rows[0].code : null;
  if (!configured || configured !== currencyCode) {
    fail(409, 'BASE_CURRENCY_MISMATCH', '销售定价只允许唯一启用本位币');
  }
}
function allowManage(db, actor) {
  try {
    allow(actor, MANAGE);
  } catch (error) {
    transaction(db, () => audit(db, actor?.id || null, 'AUTH_DENIED', 'SALES_PRICING', '', MANAGE));
    throw error;
  }
}
function currentExtension(db, customerId, businessDate) {
  return db.prepare(`SELECT * FROM customer_commercial_extensions WHERE customer_id=? AND effective_from<=?
    AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC`).get(customerId, businessDate, businessDate);
}
function requireDraft(row, kind = '配置') {
  if (!row) fail(404, 'NOT_FOUND', `${kind}不存在`);
  if (row.status !== 'DRAFT') fail(409, 'ACTIVE_CONFIGURATION_IMMUTABLE', `${kind}仅草稿状态可修改`);
}
function listRow(row) { return { ...row, priority: Number(row.priority), version: row.version === undefined ? undefined : Number(row.version) }; }

function listDetail(db, listId) {
  const list = db.prepare('SELECT * FROM sales_price_lists WHERE id=?').get(listId);
  if (!list) fail(404, 'PRICE_LIST_NOT_FOUND', '价目表不存在');
  const entries = db.prepare('SELECT * FROM sales_price_list_entries WHERE price_list_id=? ORDER BY material_id,customer_scope_key,qty_break_min_micros,effective_from,id').all(listId);
  const versions = db.prepare(`SELECT v.* FROM sales_price_list_versions v JOIN sales_price_list_entries e ON e.id=v.entry_id
    WHERE e.price_list_id=? ORDER BY v.entry_id,v.version`).all(listId);
  return { ...listRow(list), entries, versions };
}

export function listSalesPriceLists(db, res, actor) {
  allow(actor, VIEW);
  return send(res, 200, { priceLists: db.prepare('SELECT * FROM sales_price_lists ORDER BY priority,price_list_code').all().map(listRow) });
}
export function getSalesPriceList(db, res, actor, listId) { allow(actor, VIEW); return send(res, 200, { priceList: listDetail(db, listId) }); }

function normalizeList(body, old = null) {
  assertAllowedFields(body, ['priceListCode', 'name', 'currencyCode', 'priority', 'fallbackPriceListId', 'effectiveFrom', 'effectiveTo']);
  const [effectiveFrom, effectiveTo] = dateRange(body.effectiveFrom ?? old?.effective_from, body.effectiveTo === undefined ? old?.effective_to : body.effectiveTo);
  return {
    code: text(body.priceListCode ?? old?.price_list_code, 'price list code', 50).toUpperCase(),
    name: text(body.name ?? old?.name, 'name', 120), currency: text(body.currencyCode ?? old?.currency_code, 'currency code', 8).toUpperCase(),
    priority: safeInt(body.priority ?? old?.priority ?? 0, 'priority', -1_000_000, 1_000_000),
    fallbackId: String(body.fallbackPriceListId ?? old?.fallback_price_list_id ?? '').trim() || null, effectiveFrom, effectiveTo,
  };
}
export async function createSalesPriceList(db, req, res, actor) {
  allowManage(db, actor); const body = await readJson(req); const value = normalizeList(body); const listId = id(); const stamp = now();
  transaction(db, () => {
    assertBaseCurrency(db, value.currency);
    db.prepare(`INSERT INTO sales_price_lists(id,price_list_code,name,currency_code,priority,fallback_price_list_id,effective_from,effective_to,status,created_at,created_by,updated_at,updated_by)
      VALUES(?,?,?,?,?,?,?,?,'DRAFT',?,?,?,?)`).run(listId, value.code, value.name, value.currency, value.priority, value.fallbackId, value.effectiveFrom, value.effectiveTo, stamp, actor.id, stamp, actor.id);
    audit(db, actor.id, 'CREATE', 'SALES_PRICE_LIST', listId, value.code);
  });
  return send(res, 201, { priceList: listDetail(db, listId) });
}
export async function updateSalesPriceList(db, req, res, actor, listId) {
  allowManage(db, actor); const body = await readJson(req); const stamp = now();
  transaction(db, () => { const old = db.prepare(`SELECT * FROM sales_price_lists WHERE id=?${lock(db)}`).get(listId); requireDraft(old, '价目表'); const value = normalizeList(body, old);
    assertBaseCurrency(db, value.currency);
    db.prepare(`UPDATE sales_price_lists SET price_list_code=?,name=?,currency_code=?,priority=?,fallback_price_list_id=?,effective_from=?,effective_to=?,updated_at=?,updated_by=? WHERE id=?`)
      .run(value.code, value.name, value.currency, value.priority, value.fallbackId, value.effectiveFrom, value.effectiveTo, stamp, actor.id, listId);
    audit(db, actor.id, 'UPDATE', 'SALES_PRICE_LIST', listId, value.code);
  }); return send(res, 200, { priceList: listDetail(db, listId) });
}
export function deleteSalesPriceList(db, res, actor, listId) {
  allowManage(db, actor); transaction(db, () => { const row = db.prepare(`SELECT * FROM sales_price_lists WHERE id=?${lock(db)}`).get(listId); requireDraft(row, '价目表');
    if (row.activated_at) fail(409, 'PRICE_LIST_WAS_ACTIVATED', '曾启用的价目表不得删除');
    if (db.prepare('SELECT 1 FROM sales_price_list_entries WHERE price_list_id=? LIMIT 1').get(listId)) {
      fail(409, 'PRICE_HISTORY_PRESERVATION_REQUIRED', '价目表已含价格条目和版本历史，不得硬删除');
    }
    db.prepare('DELETE FROM sales_price_lists WHERE id=?').run(listId);
    audit(db, actor.id, 'DELETE', 'SALES_PRICE_LIST', listId, row.price_list_code);
  }); return send(res, 200, { ok: true });
}

function normalizeEntry(body) {
  assertAllowedFields(body, ['materialId','customerId','customerScopeType','pricingUomCode','qtyBreakMinMicros','qtyBreakMaxMicros','effectiveFrom','effectiveTo','unitPriceCents']);
  const materialId = text(body.materialId, 'material id', 63); const pricingUomCode = text(body.pricingUomCode, 'pricing uom code', 32);
  const scope = String(body.customerScopeType || (body.customerId ? 'CUSTOMER' : 'ALL')).toUpperCase(); const customerId = String(body.customerId || '').trim() || null;
  if (!['ALL','CUSTOMER'].includes(scope) || (scope === 'ALL') !== (customerId === null)) fail(422, 'CUSTOMER_SCOPE_INVALID', '客户范围与客户标识不一致');
  const min = safeInt(body.qtyBreakMinMicros ?? 0, 'quantity break minimum'); const max = body.qtyBreakMaxMicros === null || body.qtyBreakMaxMicros === undefined ? null : safeInt(body.qtyBreakMaxMicros, 'quantity break maximum');
  if (max !== null && max < min) fail(422, 'QUANTITY_BREAK_INVALID', '数量阶梯上限不得小于下限');
  const [effectiveFrom, effectiveTo] = dateRange(body.effectiveFrom, body.effectiveTo);
  return { materialId, customerId, scope, pricingUomCode, min, max, effectiveFrom, effectiveTo, unitPriceCents: safeInt(body.unitPriceCents, 'unit price cents'), ...entryKeys({ materialId, customerId, customerScopeType: scope, pricingUomCode, qtyBreakMinMicros: min, effectiveFrom }) };
}
function validateEntryRefs(db, value) {
  const product = db.prepare('SELECT id,base_uom_code FROM products WHERE id=?').get(value.materialId); if (!product) fail(422, 'MATERIAL_NOT_FOUND', '物料不存在');
  assertSalesClassifiedProduct(db, value.materialId);
  if (value.customerId && !db.prepare('SELECT 1 FROM customers WHERE id=?').get(value.customerId)) fail(422, 'CUSTOMER_NOT_FOUND', '客户不存在');
  canonicalConversion(db, value.materialId, value.pricingUomCode, value.effectiveFrom);
}
function assertEntryNoOverlap(db, listId, value, ignoredId = '') {
  const peers = db.prepare(`SELECT * FROM sales_price_list_entries WHERE price_list_id=? AND material_id=? AND customer_scope_key=? AND pricing_uom_code=? AND id<>?`).all(listId, value.materialId, value.customerKey, value.pricingUomCode, ignoredId);
  if (peers.some((row) => row.effective_from <= (value.effectiveTo || '9999-12-31') && value.effectiveFrom <= (row.effective_to || '9999-12-31')
    && Number(row.qty_break_min_micros) <= (value.max ?? Number.MAX_SAFE_INTEGER) && value.min <= (row.qty_break_max_micros === null ? Number.MAX_SAFE_INTEGER : Number(row.qty_break_max_micros)))) {
    fail(409, 'PRICE_ENTRY_RANGE_OVERLAP', '价目表数量阶梯与有效期发生重叠');
  }
}
export async function createPriceEntry(db, req, res, actor, listId) {
  allowManage(db, actor); const value = normalizeEntry(await readJson(req)); const entryId = id(); const versionId = id(); const stamp = now();
  transaction(db, () => { const list = db.prepare(`SELECT * FROM sales_price_lists WHERE id=?${lock(db)}`).get(listId); requireDraft(list, '价目表'); validateEntryRefs(db, value); assertEntryNoOverlap(db, listId, value);
    db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,material_identity_key,customer_scope_key,pricing_uom_code,pricing_identity_key,qty_break_min_micros,qty_break_max_micros,effective_from,effective_to,created_at,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(entryId,listId,value.materialId,value.customerId,value.scope,value.materialKey,value.customerKey,value.pricingUomCode,value.pricingKey,value.min,value.max,value.effectiveFrom,value.effectiveTo,stamp,actor.id);
    db.prepare('INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by) VALUES(?,?,1,?,?,?,?)')
      .run(versionId,entryId,value.unitPriceCents,JSON.stringify({ unitPriceCents:value.unitPriceCents }),stamp,actor.id);
    audit(db, actor.id, 'CREATE', 'SALES_PRICE_ENTRY', entryId, listId);
  }); return send(res, 201, { priceList: listDetail(db, listId) });
}
export async function updatePriceEntry(db, req, res, actor, listId, entryId) {
  allowManage(db, actor); const body = await readJson(req); assertAllowedFields(body, ['qtyBreakMaxMicros','effectiveTo']); const stamp=now();
  transaction(db, () => { const list=db.prepare(`SELECT * FROM sales_price_lists WHERE id=?${lock(db)}`).get(listId); requireDraft(list,'价目表'); const row=db.prepare(`SELECT * FROM sales_price_list_entries WHERE id=? AND price_list_id=?${lock(db)}`).get(entryId,listId); if(!row) fail(404,'PRICE_ENTRY_NOT_FOUND','价格条目不存在');
    const max=body.qtyBreakMaxMicros===undefined?row.qty_break_max_micros:(body.qtyBreakMaxMicros===null?null:safeInt(body.qtyBreakMaxMicros,'quantity break maximum')); const to=body.effectiveTo===undefined?row.effective_to:(body.effectiveTo?normalizeBusinessDate(body.effectiveTo):null); if(max!==null&&Number(max)<Number(row.qty_break_min_micros)) fail(422,'QUANTITY_BREAK_INVALID','数量阶梯上限无效'); if(to&&to<row.effective_from) fail(422,'INVALID_EFFECTIVE_RANGE','失效日期无效');
    assertEntryNoOverlap(db,listId,{materialId:row.material_id,customerKey:row.customer_scope_key,pricingUomCode:row.pricing_uom_code,min:Number(row.qty_break_min_micros),max:max===null?null:Number(max),effectiveFrom:row.effective_from,effectiveTo:to},entryId);
    db.prepare('UPDATE sales_price_list_entries SET qty_break_max_micros=?,effective_to=? WHERE id=?').run(max,to,entryId); audit(db,actor.id,'UPDATE','SALES_PRICE_ENTRY',entryId,stamp);
  }); return send(res,200,{priceList:listDetail(db,listId)});
}
export async function appendPriceVersion(db, req, res, actor, listId, entryId) {
  allowManage(db,actor); const body=await readJson(req); assertAllowedFields(body,['unitPriceCents']); const cents=safeInt(body.unitPriceCents,'unit price cents'); const versionId=id();
  transaction(db,()=>{const list=db.prepare(`SELECT * FROM sales_price_lists WHERE id=?${lock(db)}`).get(listId);requireDraft(list,'价目表');const entry=db.prepare('SELECT * FROM sales_price_list_entries WHERE id=? AND price_list_id=?').get(entryId,listId);if(!entry)fail(404,'PRICE_ENTRY_NOT_FOUND','价格条目不存在');const version=Number(db.prepare('SELECT COALESCE(MAX(version),0)+1 next_version FROM sales_price_list_versions WHERE entry_id=?').get(entryId).next_version);const stamp=now();db.prepare('INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by) VALUES(?,?,?,?,?,?,?)').run(versionId,entryId,version,cents,JSON.stringify({unitPriceCents:cents}),stamp,actor.id);audit(db,actor.id,'APPEND_VERSION','SALES_PRICE_ENTRY',entryId,String(version));});
  return send(res,201,{priceList:listDetail(db,listId)});
}
export function deletePriceEntry(db,res,actor,listId,entryId){allowManage(db,actor);transaction(db,()=>{const list=db.prepare(`SELECT * FROM sales_price_lists WHERE id=?${lock(db)}`).get(listId);requireDraft(list,'价目表');const row=db.prepare('SELECT id FROM sales_price_list_entries WHERE id=? AND price_list_id=?').get(entryId,listId);if(!row)fail(404,'PRICE_ENTRY_NOT_FOUND','价格条目不存在');if(db.prepare('SELECT 1 FROM sales_price_list_versions WHERE entry_id=? LIMIT 1').get(entryId))fail(409,'PRICE_HISTORY_PRESERVATION_REQUIRED','价格版本历史必须保留，该条目不得硬删除');db.prepare('DELETE FROM sales_price_list_entries WHERE id=?').run(entryId);audit(db,actor.id,'DELETE','SALES_PRICE_ENTRY',entryId,listId);});return send(res,200,{ok:true});}

function validateFallbackChain(db, table, rootId, fallbackColumn, effectiveFrom, effectiveTo, currency) {
  const visited=new Set(), rows=[]; let cursor=rootId; let root=true;
  while(cursor){if(visited.has(cursor))fail(409,'FALLBACK_CYCLE','回退链存在循环');visited.add(cursor);const row=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(cursor);if(!row)fail(409,'FALLBACK_TARGET_INVALID','回退目标不存在');rows.push(row);if(!root&&row.status!=='ACTIVE')fail(409,'FALLBACK_TARGET_INVALID','回退目标必须已启用');if(row.currency_code!==currency)fail(409,'FALLBACK_CURRENCY_MISMATCH','回退目标币种不一致');if(!root&&(row.effective_from>effectiveFrom||(row.effective_to&&(effectiveTo===null||row.effective_to<effectiveTo))))fail(409,'FALLBACK_TARGET_INVALID','回退目标未覆盖根配置的完整生效区间');cursor=row[fallbackColumn];root=false;}
  if(db.dialect==='mysql'&&rows.length){const ordered=rows.map((row)=>row.id).sort();const placeholders=ordered.map(()=>'?').join(',');db.prepare(`SELECT id FROM ${table} WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`).all(...ordered);}
}
async function lifecycle(db,req,res,actor,{table,entity,id:entityId,action}){
  allowManage(db,actor);const body=await readJson(req);const key=String(req.headers['idempotency-key']||'').trim();const fingerprint=requestFingerprint({action,body});const operation=`${entity}_${action.toUpperCase()}`;const replay=idempotencyReplay(db,operation,entityId,key,fingerprint);if(replay)return send(res,200,{...replay,replayed:true});assertAllowedFields(body,[]);let result;
  transaction(db,()=>{const row=db.prepare(`SELECT * FROM ${table} WHERE id=?${lock(db)}`).get(entityId);if(!row)fail(404,'NOT_FOUND','配置不存在');
    if(action==='activate'){if(row.status!=='DRAFT')fail(409,'INVALID_LIFECYCLE','仅草稿可启用');assertBaseCurrency(db,row.currency_code);validateFallbackChain(db,table,entityId,table==='sales_price_lists'?'fallback_price_list_id':'fallback_scheme_id',row.effective_from,row.effective_to,row.currency_code);
      if(table==='sales_price_lists'){const entries=db.prepare('SELECT * FROM sales_price_list_entries WHERE price_list_id=?').all(entityId);if(!entries.length||entries.some((entry)=>!db.prepare('SELECT 1 FROM sales_price_list_versions WHERE entry_id=?').get(entry.id)))fail(409,'PRICE_LIST_INCOMPLETE','价目表必须包含有版本的条目');for(const entry of entries){assertSalesClassifiedProduct(db,entry.material_id);canonicalConversion(db,entry.material_id,entry.pricing_uom_code,entry.effective_from);assertEntryNoOverlap(db,entityId,{materialId:entry.material_id,customerKey:entry.customer_scope_key,pricingUomCode:entry.pricing_uom_code,min:Number(entry.qty_break_min_micros),max:entry.qty_break_max_micros===null?null:Number(entry.qty_break_max_micros),effectiveFrom:entry.effective_from,effectiveTo:entry.effective_to},entry.id);}}
      else {validateRuleHistory(db,entityId);for(const rule of db.prepare('SELECT * FROM sales_discount_scheme_rules WHERE scheme_id=?').all(entityId)){validateRuleRefs(db,{materialId:rule.material_id,customerId:rule.customer_id,lineScope:rule.line_scope,pricingUomCode:rule.pricing_uom_code,effectiveFrom:rule.effective_from});}}
      const stamp=now();db.prepare(`UPDATE ${table} SET status='ACTIVE',activated_at=?,activated_by=?,updated_at=?,updated_by=? WHERE id=?`).run(stamp,actor.id,stamp,actor.id,entityId);audit(db,actor.id,'ACTIVATE',entity,entityId,row[table==='sales_price_lists'?'price_list_code':'scheme_code']);result={id:entityId,status:'ACTIVE'};
    }else{if(row.status!=='ACTIVE')fail(409,'INVALID_LIFECYCLE','仅启用配置可退役');const stamp=now();db.prepare(`UPDATE ${table} SET status='RETIRED',retired_at=?,retired_by=?,updated_at=?,updated_by=? WHERE id=?`).run(stamp,actor.id,stamp,actor.id,entityId);audit(db,actor.id,'RETIRE',entity,entityId,'');result={id:entityId,status:'RETIRED'};}
    saveIdempotency(db,operation,entityId,key,fingerprint,result);
  });return send(res,200,result);
}
export const activatePriceList=(db,req,res,actor,listId)=>lifecycle(db,req,res,actor,{table:'sales_price_lists',entity:'SALES_PRICE_LIST',id:listId,action:'activate'});
export const retirePriceList=(db,req,res,actor,listId)=>lifecycle(db,req,res,actor,{table:'sales_price_lists',entity:'SALES_PRICE_LIST',id:listId,action:'retire'});

function canonicalConversion(db,materialId,uomCode,businessDate){const product=db.prepare('SELECT id,base_uom_code FROM products WHERE id=?').get(materialId);if(!product?.base_uom_code)fail(409,'SALES_UOM_UNAVAILABLE','物料缺少基本计量单位');if(!db.prepare('SELECT 1 FROM uoms WHERE code=? AND active=1').get(uomCode))fail(409,'SALES_UOM_UNAVAILABLE','计价单位不存在或未启用');if(uomCode===product.base_uom_code)return{id:`BASE:${materialId}:${uomCode}`,uomCode,numerator:1,denominator:1,version:0,effectiveFrom:null,effectiveTo:null};const rows=db.prepare(`SELECT * FROM product_uom_conversions WHERE product_id=? AND uom_code=? AND base_uom_code=? AND active=1 AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY version DESC,id`).all(materialId,uomCode,product.base_uom_code,businessDate,businessDate);if(rows.length!==1)fail(409,'SALES_UOM_CONVERSION_UNAVAILABLE','计量单位换算必须唯一有效');const row=rows[0],numerator=Number(row.numerator),denominator=Number(row.denominator),version=Number(row.version);if(!Number.isSafeInteger(numerator)||numerator<=0||!Number.isSafeInteger(denominator)||denominator<=0||!Number.isSafeInteger(version)||version<1)fail(409,'SALES_UOM_CONVERSION_UNSAFE','计量单位换算证据不安全');return{id:row.id,uomCode,numerator,denominator,version,effectiveFrom:row.effective_from,effectiveTo:row.effective_to};}
function normalizeToPricingMicros(requested,requestedConversion,candidateConversion){return halfUp(requested*BigInt(requestedConversion.numerator)*BigInt(candidateConversion.denominator),BigInt(requestedConversion.denominator)*BigInt(candidateConversion.numerator));}
function uniqueRoots(values,defaultId){const seen=new Set(),result=[];for(const value of Array.isArray(values)?values:[]){const rootId=String(value||'').trim();if(!rootId)continue;if(seen.has(rootId))fail(422,'DUPLICATE_ROOT','显式配置根不得重复');seen.add(rootId);result.push(rootId);}const customerDefault=String(defaultId||'').trim();if(customerDefault&&!seen.has(customerDefault))result.push(customerDefault);return result;}
export function resolveSalesPrice(db,input,actor){
  const customerId=text(input.customerId,'customer id',63),materialId=text(input.materialId,'material id',63),requestedUom=text(input.pricingUomCode,'pricing uom code',32);const businessDate=normalizeBusinessDate(input.businessDate);assertSellableProduct(db,{customerId,salespersonId:input.salespersonId??null,productId:materialId,businessDate,documentType:'SALES_ORDER'});const requested=parseMicros(input.quantityDecimal);const requestedConversion=canonicalConversion(db,materialId,requestedUom,businessDate);const extension=currentExtension(db,customerId,businessDate);const roots=uniqueRoots(input.explicitPriceListIds,extension?.default_pricing_list_id);if(!roots.length)fail(409,'PRICE_NOT_CONFIGURED','未配置适用价目表');
  let selected=null;for(const root of roots){const path=new Set();let cursor=root;while(cursor){if(path.has(cursor))fail(409,'FALLBACK_CYCLE','价目表回退链存在循环');path.add(cursor);const list=db.prepare('SELECT * FROM sales_price_lists WHERE id=?').get(cursor);if(!list||list.status!=='ACTIVE'||list.effective_from>businessDate||(list.effective_to&&list.effective_to<businessDate))fail(409,'PRICE_LIST_NOT_APPLICABLE','价目表不可用');const candidates=db.prepare(`SELECT * FROM sales_price_list_entries WHERE price_list_id=? AND material_id=? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) AND (customer_id=? OR (customer_scope_type='ALL' AND customer_id IS NULL))`).all(cursor,materialId,businessDate,businessDate,customerId);
      const matches=[];for(const entry of candidates){const conv=canonicalConversion(db,materialId,entry.pricing_uom_code,businessDate);const normalized=normalizeToPricingMicros(requested,requestedConversion,conv);if(normalized>=BigInt(entry.qty_break_min_micros)&&(entry.qty_break_max_micros===null||normalized<=BigInt(entry.qty_break_max_micros)))matches.push({entry,conv,normalized});}
      matches.sort((a,b)=>(a.entry.customer_id?0:1)-(b.entry.customer_id?0:1)||Number(b.entry.qty_break_min_micros)-Number(a.entry.qty_break_min_micros)||b.entry.effective_from.localeCompare(a.entry.effective_from)||a.entry.id.localeCompare(b.entry.id));
      if(matches.length){const match=matches[0];const versions=db.prepare('SELECT * FROM sales_price_list_versions WHERE entry_id=? ORDER BY version DESC,id').all(match.entry.id);if(!versions.length)fail(409,'PRICE_VERSION_MISSING','价格版本缺失');selected={list,entry:match.entry,version:versions[0],conversion:match.conv,normalized:match.normalized};break;}cursor=list.fallback_price_list_id;
    }if(selected)break;
  }if(!selected)fail(409,'PRICE_NOT_CONFIGURED','没有适用价格');
  let cents=Number(selected.version.unit_price_cents),overrideState='NONE',overrideEvidence=null;if(input.manualPriceCents!==undefined&&input.manualPriceCents!==null){allow(actor,OVERRIDE);const reason=String(input.overrideReason||'').trim();if(!reason)fail(422,'OVERRIDE_REASON_REQUIRED','手工价格必须填写原因');cents=safeInt(input.manualPriceCents,'manual price cents');overrideState='OVERRIDDEN';overrideEvidence={actorId:actor.id,reason};}
  const evidence={contractVersion:'SALES_PRICE_V1',resolvedPriceCents:cents,priceListId:selected.list.id,entryId:selected.entry.id,versionId:selected.version.id,version:Number(selected.version.version),effectiveRange:{from:selected.entry.effective_from,to:selected.entry.effective_to},requestedQuantityMicros:Number(requested),normalizedPricingQuantityMicros:asSafeNumber(selected.normalized),requestedUomEvidence:requestedConversion,pricingUomEvidence:selected.conversion,qtyBreakApplied:{min:Number(selected.entry.qty_break_min_micros),max:selected.entry.qty_break_max_micros===null?null:Number(selected.entry.qty_break_max_micros)},overrideState,overrideEvidence};
  evidence.fingerprint=requestFingerprint(evidence);return evidence;
}
export async function resolveSalesPriceHttp(db,req,res,actor){allow(actor,VIEW);const body=await readJson(req);return send(res,200,{pricing:readTransaction(db,()=>resolveSalesPrice(db,body,actor))});}

function schemeDetail(db,schemeId){const scheme=db.prepare('SELECT * FROM sales_discount_schemes WHERE id=?').get(schemeId);if(!scheme)fail(404,'DISCOUNT_SCHEME_NOT_FOUND','折扣方案不存在');return{...listRow(scheme),rules:db.prepare('SELECT * FROM sales_discount_scheme_rules WHERE scheme_id=? ORDER BY rule_key,rule_version').all(schemeId)};}
export function listDiscountSchemes(db,res,actor){allow(actor,VIEW);return send(res,200,{schemes:db.prepare('SELECT * FROM sales_discount_schemes ORDER BY priority,scheme_code').all().map(listRow)});}
export function getDiscountScheme(db,res,actor,schemeId){allow(actor,VIEW);return send(res,200,{scheme:schemeDetail(db,schemeId)});}
function normalizeScheme(body,old=null){assertAllowedFields(body,['schemeCode','name','currencyCode','priority','fallbackSchemeId','effectiveFrom','effectiveTo','version']);const[effectiveFrom,effectiveTo]=dateRange(body.effectiveFrom??old?.effective_from,body.effectiveTo===undefined?old?.effective_to:body.effectiveTo);return{code:text(body.schemeCode??old?.scheme_code,'scheme code',50).toUpperCase(),name:text(body.name??old?.name,'name',120),currency:text(body.currencyCode??old?.currency_code,'currency code',8).toUpperCase(),priority:safeInt(body.priority??old?.priority??0,'priority',-1_000_000,1_000_000),fallbackId:String(body.fallbackSchemeId??old?.fallback_scheme_id??'').trim()||null,effectiveFrom,effectiveTo,version:safeInt(body.version??old?.version??1,'version',1)};}
export async function createDiscountScheme(db,req,res,actor){allowManage(db,actor);const value=normalizeScheme(await readJson(req));const schemeId=id(),stamp=now();transaction(db,()=>{assertBaseCurrency(db,value.currency);db.prepare(`INSERT INTO sales_discount_schemes(id,scheme_code,name,currency_code,priority,fallback_scheme_id,effective_from,effective_to,version,status,created_at,created_by,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?,?)`).run(schemeId,value.code,value.name,value.currency,value.priority,value.fallbackId,value.effectiveFrom,value.effectiveTo,value.version,stamp,actor.id,stamp,actor.id);audit(db,actor.id,'CREATE','SALES_DISCOUNT_SCHEME',schemeId,value.code);});return send(res,201,{scheme:schemeDetail(db,schemeId)});}
export async function updateDiscountScheme(db,req,res,actor,schemeId){allowManage(db,actor);const body=await readJson(req);transaction(db,()=>{const old=db.prepare(`SELECT * FROM sales_discount_schemes WHERE id=?${lock(db)}`).get(schemeId);requireDraft(old,'折扣方案');const value=normalizeScheme(body,old),stamp=now();assertBaseCurrency(db,value.currency);db.prepare('UPDATE sales_discount_schemes SET scheme_code=?,name=?,currency_code=?,priority=?,fallback_scheme_id=?,effective_from=?,effective_to=?,version=?,updated_at=?,updated_by=? WHERE id=?').run(value.code,value.name,value.currency,value.priority,value.fallbackId,value.effectiveFrom,value.effectiveTo,value.version,stamp,actor.id,schemeId);audit(db,actor.id,'UPDATE','SALES_DISCOUNT_SCHEME',schemeId,value.code);});return send(res,200,{scheme:schemeDetail(db,schemeId)});}
export function deleteDiscountScheme(db,res,actor,schemeId){allowManage(db,actor);transaction(db,()=>{const row=db.prepare(`SELECT * FROM sales_discount_schemes WHERE id=?${lock(db)}`).get(schemeId);requireDraft(row,'折扣方案');if(row.activated_at)fail(409,'DISCOUNT_SCHEME_WAS_ACTIVATED','曾启用的方案不得删除');db.prepare('DELETE FROM sales_discount_scheme_rules WHERE scheme_id=?').run(schemeId);db.prepare('DELETE FROM sales_discount_schemes WHERE id=?').run(schemeId);audit(db,actor.id,'DELETE','SALES_DISCOUNT_SCHEME',schemeId,row.scheme_code);});return send(res,200,{ok:true});}
function normalizeRule(body,old=null){assertAllowedFields(body,['ruleKey','enabled','materialId','customerId','customerScopeType','pricingUomCode','lineScope','applicationMode','discountKind','discountBps','discountAmountCents','priority','qtyBreakMinMicros','qtyBreakMaxMicros','effectiveFrom','effectiveTo']);const scope=String(body.customerScopeType??old?.customer_scope_type??(body.customerId?'CUSTOMER':'ALL')).toUpperCase(),customerId=String(body.customerId??old?.customer_id??'').trim()||null;if(!['ALL','CUSTOMER'].includes(scope)||(scope==='ALL')!==(customerId===null))fail(422,'CUSTOMER_SCOPE_INVALID','客户范围无效');const lineScope=String(body.lineScope??old?.line_scope??'LINE').toUpperCase(),applicationMode=String(body.applicationMode??old?.application_mode??'AUTOMATIC').toUpperCase(),kind=String(body.discountKind??old?.discount_kind??'PERCENT').toUpperCase();if(!['LINE','HEADER'].includes(lineScope)||!['AUTOMATIC','MANUAL'].includes(applicationMode)||!['PERCENT','AMOUNT'].includes(kind))fail(422,'DISCOUNT_RULE_INVALID','折扣规则类型无效');const materialId=String(body.materialId??old?.material_id??'').trim()||null,pricingUomCode=String(body.pricingUomCode??old?.pricing_uom_code??'').trim()||null,min=safeInt(body.qtyBreakMinMicros??old?.qty_break_min_micros??0,'quantity break minimum'),rawMax=body.qtyBreakMaxMicros===undefined?old?.qty_break_max_micros:body.qtyBreakMaxMicros,max=rawMax===null||rawMax===undefined?null:safeInt(rawMax,'quantity break maximum');if(lineScope==='HEADER'&&(materialId||pricingUomCode||min!==0||max!==null))fail(422,'HEADER_DISCOUNT_APPLICABILITY_INVALID','整单折扣不得包含物料、计价单位或数量阶梯');if(lineScope==='LINE'&&pricingUomCode&&materialId)canonicalConversionPlaceholder(materialId,pricingUomCode);const[effectiveFrom,effectiveTo]=dateRange(body.effectiveFrom??old?.effective_from,body.effectiveTo===undefined?old?.effective_to:body.effectiveTo);return{ruleKey:text(body.ruleKey??old?.rule_key,'rule key',80),enabled:(body.enabled??(old?Boolean(old.enabled):true))?1:0,materialId,customerId,scope,customerKey:scope==='ALL'?'A':`C:${upperHex(customerId)}`,pricingUomCode,lineScope,applicationMode,kind,bps:kind==='PERCENT'?safeInt(body.discountBps??old?.discount_bps,'discount bps',0,10000):null,amount:kind==='AMOUNT'?safeInt(body.discountAmountCents??old?.discount_amount_cents,'discount amount cents'):null,priority:safeInt(body.priority??old?.priority??0,'priority',-1_000_000,1_000_000),min,max,effectiveFrom,effectiveTo};}
function canonicalConversionPlaceholder(){/* authoritative lookup is performed with db below */}
function validateRuleRefs(db,value){if(value.materialId&&!db.prepare('SELECT 1 FROM products WHERE id=?').get(value.materialId))fail(422,'MATERIAL_NOT_FOUND','物料不存在');if(value.customerId&&!db.prepare('SELECT 1 FROM customers WHERE id=?').get(value.customerId))fail(422,'CUSTOMER_NOT_FOUND','客户不存在');if(value.lineScope==='LINE'&&value.materialId&&value.pricingUomCode)canonicalConversion(db,value.materialId,value.pricingUomCode,value.effectiveFrom);}
export async function createDiscountRule(db,req,res,actor,schemeId){allowManage(db,actor);const value=normalizeRule(await readJson(req));const ruleId=id();transaction(db,()=>{const scheme=db.prepare(`SELECT * FROM sales_discount_schemes WHERE id=?${lock(db)}`).get(schemeId);requireDraft(scheme,'折扣方案');validateRuleRefs(db,value);if(db.prepare('SELECT 1 FROM sales_discount_scheme_rules WHERE scheme_id=? AND rule_key=?').get(schemeId,value.ruleKey))fail(409,'DISCOUNT_RULE_KEY_EXISTS','规则键已存在，请追加版本');const stamp=now();db.prepare(`INSERT INTO sales_discount_scheme_rules(id,scheme_id,rule_key,rule_version,enabled,material_id,customer_id,customer_scope_type,customer_scope_key,pricing_uom_code,line_scope,application_mode,discount_kind,discount_bps,discount_amount_cents,priority,qty_break_min_micros,qty_break_max_micros,effective_from,effective_to,created_at,created_by) VALUES(?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ruleId,schemeId,value.ruleKey,value.enabled,value.materialId,value.customerId,value.scope,value.customerKey,value.pricingUomCode,value.lineScope,value.applicationMode,value.kind,value.bps,value.amount,value.priority,value.min,value.max,value.effectiveFrom,value.effectiveTo,stamp,actor.id);audit(db,actor.id,'CREATE','SALES_DISCOUNT_RULE',ruleId,value.ruleKey);});return send(res,201,{scheme:schemeDetail(db,schemeId)});}
export async function appendDiscountRuleVersion(db,req,res,actor,schemeId,ruleKey){allowManage(db,actor);const body=await readJson(req);let ruleId;transaction(db,()=>{const scheme=db.prepare(`SELECT * FROM sales_discount_schemes WHERE id=?${lock(db)}`).get(schemeId);requireDraft(scheme,'折扣方案');const old=db.prepare('SELECT * FROM sales_discount_scheme_rules WHERE scheme_id=? AND rule_key=? ORDER BY rule_version DESC,id LIMIT 1').get(schemeId,ruleKey);if(!old)fail(404,'DISCOUNT_RULE_NOT_FOUND','折扣规则不存在');const value=normalizeRule({...body,ruleKey},old);validateRuleRefs(db,value);const version=Number(old.rule_version)+1;ruleId=id();const stamp=now();db.prepare(`INSERT INTO sales_discount_scheme_rules(id,scheme_id,rule_key,rule_version,enabled,material_id,customer_id,customer_scope_type,customer_scope_key,pricing_uom_code,line_scope,application_mode,discount_kind,discount_bps,discount_amount_cents,priority,qty_break_min_micros,qty_break_max_micros,effective_from,effective_to,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ruleId,schemeId,ruleKey,version,value.enabled,value.materialId,value.customerId,value.scope,value.customerKey,value.pricingUomCode,value.lineScope,value.applicationMode,value.kind,value.bps,value.amount,value.priority,value.min,value.max,value.effectiveFrom,value.effectiveTo,stamp,actor.id);audit(db,actor.id,'APPEND_VERSION','SALES_DISCOUNT_RULE',ruleId,`${ruleKey}:${version}`);});return send(res,201,{scheme:schemeDetail(db,schemeId)});}
function validateRuleHistory(db,schemeId){const rows=db.prepare('SELECT * FROM sales_discount_scheme_rules WHERE scheme_id=? ORDER BY rule_key,rule_version').all(schemeId);if(!rows.length)fail(409,'DISCOUNT_SCHEME_INCOMPLETE','折扣方案必须包含规则');const groups=Map.groupBy(rows,(row)=>row.rule_key);for(const versions of groups.values()){let expected=1,prior='';for(const row of versions){if(Number(row.rule_version)!==expected++||row.effective_from<prior)fail(409,'DISCOUNT_RULE_HISTORY_INVALID','规则版本必须连续且生效日期非递减');prior=row.effective_from;}}}
export const activateDiscountScheme=(db,req,res,actor,schemeId)=>lifecycle(db,req,res,actor,{table:'sales_discount_schemes',entity:'SALES_DISCOUNT_SCHEME',id:schemeId,action:'activate'});
export const retireDiscountScheme=(db,req,res,actor,schemeId)=>lifecycle(db,req,res,actor,{table:'sales_discount_schemes',entity:'SALES_DISCOUNT_SCHEME',id:schemeId,action:'retire'});

function currentRules(db,schemeId,businessDate){const rows=db.prepare('SELECT * FROM sales_discount_scheme_rules WHERE scheme_id=? AND effective_from<=? ORDER BY rule_key,rule_version DESC,id').all(schemeId,businessDate);const seen=new Set();return rows.filter((row)=>{if(seen.has(row.rule_key))return false;seen.add(row.rule_key);return Boolean(row.enabled)&&(!row.effective_to||row.effective_to>=businessDate);});}
function discountAmount(base,rule){const result=rule.discount_kind==='PERCENT'?halfUp(BigInt(base)*BigInt(rule.discount_bps),10000n):BigInt(rule.discount_amount_cents);if(result>BigInt(base))fail(409,'DISCOUNT_EXCEEDS_BASE','折扣超过当前计算基数');return Number(result);}
function verifyExpected(expected,actual){if(!expected)return;if(requestFingerprint(expected)!==requestFingerprint(actual))fail(409,'PRICING_EVIDENCE_MISMATCH','客户端价格证据与服务器权威价格不一致');}
function chooseRule(rules,{scope,mode,customerId,materialId,uom,quantity}){const matches=rules.filter((r)=>r.line_scope===scope&&r.application_mode===mode&&(r.customer_id===customerId||r.customer_scope_type==='ALL')&&(scope==='HEADER'||((!r.material_id||r.material_id===materialId)&&(!r.pricing_uom_code||r.pricing_uom_code===uom)&&quantity>=Number(r.qty_break_min_micros)&&(r.qty_break_max_micros===null||quantity<=Number(r.qty_break_max_micros)))));matches.sort((a,b)=>Number(a.__schemeOrder||0)-Number(b.__schemeOrder||0)||(a.customer_id?0:1)-(b.customer_id?0:1)||Number(a.priority)-Number(b.priority)||(scope==='LINE'?Number(b.qty_break_min_micros)-Number(a.qty_break_min_micros):0)||b.effective_from.localeCompare(a.effective_from)||a.id.localeCompare(b.id));return matches[0]||null;}
function schemeRules(db,input,customerId,businessDate){const extension=currentExtension(db,customerId,businessDate);const roots=uniqueRoots(input.explicitSchemeIds,extension?.default_discount_scheme_id);if(!roots.length)fail(409,'DISCOUNT_NOT_CONFIGURED','未配置适用折扣方案');const result=[];for(const root of roots){const path=new Set();let cursor=root;while(cursor){if(path.has(cursor))fail(409,'FALLBACK_CYCLE','折扣方案回退链存在循环');path.add(cursor);const scheme=db.prepare('SELECT * FROM sales_discount_schemes WHERE id=?').get(cursor);if(!scheme||scheme.status!=='ACTIVE'||scheme.effective_from>businessDate||(scheme.effective_to&&scheme.effective_to<businessDate))fail(409,'DISCOUNT_SCHEME_NOT_APPLICABLE','折扣方案不可用');result.push({scheme,rules:currentRules(db,cursor,businessDate)});cursor=scheme.fallback_scheme_id;}}return result;}
export function resolveOrderTimeDiscount(db,input,actor){
  const customerId=text(input.customerId,'customer id',63),businessDate=normalizeBusinessDate(input.businessDate);
  if(!Array.isArray(input.lines)||!input.lines.length)fail(422,'DISCOUNT_LINES_REQUIRED','至少需要一条订单行');
  const lineIds=input.lines.map((line)=>text(line.lineId,'line id',128));
  if(new Set(lineIds).size!==lineIds.length)fail(422,'DUPLICATE_LINE_ID','订单行标识必须唯一');
  const manual=Array.isArray(input.manualRuleSelections)?input.manualRuleSelections:[];
  const lineIdSet=new Set(lineIds);
  if(manual.some((selection)=>selection.lineId!==null&&selection.lineId!==undefined&&!lineIdSet.has(String(selection.lineId))))fail(422,'MANUAL_RULE_LINE_NOT_FOUND','手工折扣引用了不存在的订单行');
  const overrideReason=String(input.overrideReason||'').trim();
  if(manual.length){allow(actor,OVERRIDE);if(!overrideReason)fail(422,'OVERRIDE_REASON_REQUIRED','手工折扣必须填写原因');if(Buffer.byteLength(overrideReason,'utf8')>500)fail(422,'OVERRIDE_REASON_TOO_LONG','手工折扣原因不得超过 500 个 UTF-8 字节');}
  const chains=schemeRules(db,input,customerId,businessDate);
  const allRules=chains.flatMap(({scheme,rules},schemeOrder)=>rules.map((rule)=>({scheme,rule:{...rule,__schemeOrder:schemeOrder}})));
  const lineResults=[],evidence=[];
  for(const [lineIndex,source] of input.lines.entries()){
    const lineId=lineIds[lineIndex];
    const pricing=resolveSalesPrice(db,{customerId,salespersonId:input.salespersonId,materialId:source.materialId,pricingUomCode:source.requestedUomCode,quantityDecimal:source.quantityDecimal,businessDate,explicitPriceListIds:source.explicitPriceListIds,manualPriceCents:source.manualPriceCents,overrideReason},actor);
    verifyExpected(source.expectedPricingEvidence,pricing);
    const gross=asSafeNumber(halfUp(BigInt(pricing.resolvedPriceCents)*BigInt(pricing.normalizedPricingQuantityMicros),1_000_000n));
    let remaining=gross,discount=0;
    for(const mode of ['AUTOMATIC','MANUAL']){
      let selected;
      if(mode==='AUTOMATIC')selected=chooseRule(allRules.map((item)=>item.rule),{scope:'LINE',mode,customerId,materialId:source.materialId,uom:pricing.pricingUomEvidence.uomCode,quantity:pricing.normalizedPricingQuantityMicros});
      else{
        const picks=manual.filter((selection)=>String(selection.lineId)===lineId);
        if(picks.length>1)fail(422,'MULTIPLE_MANUAL_RULES','每行最多一个手工折扣规则');
        selected=picks.length?allRules.find((item)=>item.rule.id===picks[0].ruleId)?.rule:null;
        if(picks.length&&!selected)fail(409,'MANUAL_RULE_NOT_APPLICABLE','手工折扣规则不在当前方案链中');
        if(selected&&(!currentRules(db,selected.scheme_id,businessDate).some((row)=>row.id===selected.id)||!chooseRule([selected],{scope:'LINE',mode,customerId,materialId:source.materialId,uom:pricing.pricingUomEvidence.uomCode,quantity:pricing.normalizedPricingQuantityMicros})))fail(409,'MANUAL_RULE_NOT_APPLICABLE','手工折扣规则不是当前适用版本');
      }
      if(selected){const amount=discountAmount(remaining,selected);const base=remaining;remaining-=amount;discount=checkedSum([discount,amount]);evidence.push({schemeId:selected.scheme_id,ruleId:selected.id,ruleKey:selected.rule_key,ruleVersion:Number(selected.rule_version),scope:'LINE',mode,baseCents:base,discountCents:amount,lineId});}
    }
    lineResults.push({lineId,lineNo:safeInt(source.lineNo,'line number',0),grossCents:gross,lineDiscountCents:discount,afterLineCents:remaining,pricingEvidence:pricing});
  }
  let current=lineResults.map((item)=>item.afterLineCents),headerTotal=0;
  const headerAllocations=Object.fromEntries(lineResults.map((item)=>[item.lineId,0]));
  for(const mode of ['AUTOMATIC','MANUAL']){
    let selected;
    if(mode==='AUTOMATIC')selected=chooseRule(allRules.map((item)=>item.rule),{scope:'HEADER',mode,customerId});
    else{
      const picks=manual.filter((selection)=>selection.lineId===null||selection.lineId===undefined);
      if(picks.length>1)fail(422,'MULTIPLE_MANUAL_RULES','整单最多一个手工折扣规则');
      selected=picks.length?allRules.find((item)=>item.rule.id===picks[0].ruleId)?.rule:null;
      if(picks.length&&!selected)fail(409,'MANUAL_RULE_NOT_APPLICABLE','手工整单规则不在当前方案链中');
      if(selected&&(!currentRules(db,selected.scheme_id,businessDate).some((row)=>row.id===selected.id)||!chooseRule([selected],{scope:'HEADER',mode,customerId})))fail(409,'MANUAL_RULE_NOT_APPLICABLE','手工整单规则不是当前适用版本');
    }
    if(!selected)continue;
    const base=checkedSum(current),amount=discountAmount(base,selected),baseBig=BigInt(base),amountBig=BigInt(amount);
    const floors=current.map((value)=>base?Number(BigInt(value)*amountBig/baseBig):0);
    const used=checkedSum(floors);
    const ranked=current.map((value,index)=>({index,remainder:base?BigInt(value)*amountBig%baseBig:0n,lineNo:lineResults[index].lineNo,lineId:lineResults[index].lineId})).sort((left,right)=>left.remainder===right.remainder?left.lineNo-right.lineNo||left.lineId.localeCompare(right.lineId):(left.remainder>right.remainder?-1:1));
    for(let index=0;index<amount-used;index+=1)floors[ranked[index].index]+=1;
    current=current.map((value,index)=>value-floors[index]);
    floors.forEach((value,index)=>{headerAllocations[lineResults[index].lineId]=checkedSum([headerAllocations[lineResults[index].lineId],value]);});
    headerTotal=checkedSum([headerTotal,amount]);
    evidence.push({schemeId:selected.scheme_id,ruleId:selected.id,ruleKey:selected.rule_key,ruleVersion:Number(selected.rule_version),scope:'HEADER',mode,baseCents:base,discountCents:amount,allocation:Object.fromEntries(lineResults.map((item,index)=>[item.lineId,floors[index]]))});
  }
  const totalLine=checkedSum(lineResults.map((item)=>item.lineDiscountCents));
  const result={contractVersion:'ORDER_DISCOUNT_V1',lineDiscountCentsByLine:Object.fromEntries(lineResults.map((item)=>[item.lineId,item.lineDiscountCents])),headerDiscountCentsTotal:headerTotal,headerAllocationCentsByLine:headerAllocations,totalDiscountCents:checkedSum([totalLine,headerTotal]),finalLineCentsByLine:Object.fromEntries(lineResults.map((item,index)=>[item.lineId,current[index]])),appliedRuleEvidence:evidence,pricingEvidenceByLine:Object.fromEntries(lineResults.map((item)=>[item.lineId,item.pricingEvidence])),roundingEvidence:{contract:'HALF_UP_CENT_V1',allocation:'LARGEST_REMAINDER_LINE_NO_LINE_ID'},manualOverride:manual.length?{actorId:actor.id,reason:overrideReason}:null};
  result.fingerprint=createHash('sha256').update(JSON.stringify(result)).digest('hex');
  return result;
}
export async function resolveOrderTimeDiscountHttp(db,req,res,actor){allow(actor,VIEW);const body=await readJson(req);return send(res,200,{discount:readTransaction(db,()=>resolveOrderTimeDiscount(db,body,actor))});}
