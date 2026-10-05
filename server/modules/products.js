// V2 Stage 3 / Wave 3F — Product master-data domain ownership.
//
// Sixth live production route family migrated using the Wave 1
// route-table dispatch infrastructure (after Wave 3A's warehouses,
// Wave 3B's customers, Wave 3C's suppliers, Wave 3D's roles, and
// Wave 3E's user-management). This module is the single canonical
// implementation owner for /api/products (GET, POST, PATCH, DELETE).
// Authorization, transaction, and audit remain at the handler
// boundary; the route-table only carries dispatch and ownership
// metadata.
//
// The handler bodies and productInput helper behavior are textually /
// semantically identical to the previous server/app.js implementation.
// TRACKING_POLICIES is imported once from
// server/modules/traceability-quality.js (the canonical definition)
// and used only to validate the initial tracking policy value at
// create time. The PATCH /api/products/:id/tracking-policy route is
// intentionally NOT migrated and continues to dispatch via its
// existing legacy handleApi branch to
// updateProductTrackingHandler in traceability-quality.
//
// DELETE /api/products/:id is a thin wrapper that delegates to
// deleteMasterRecord in server/modules/data-lifecycle.js — no added
// permission / validation / SQL / transaction / audit / response
// transformation. MASTER_RULES.product remains authoritative and
// unchanged: PRODUCTS_MANAGE permission, the canonical reference
// dependency list, and the nonzero-stock extraReferenced rule.
//
// Migration invariants preserved verbatim:
//   - GET /api/products derives stockQuantity from SUM(inventory.quantity);
//   - POST hard-codes products.stock_quantity = 0;
//   - PATCH rejects stockQuantity / stock_quantity writes with the
//     exact 409 "货品库存数量只读，请通过库存业务单据变更";
//   - PATCH rejects a base-UOM change once inventory_transactions
//     exist with the exact 409 "已有历史交易的产品不可变更基础单位";
//   - UOM row creation via INSERT OR IGNORE is unchanged;
//   - Invalid trackingPolicy surfaces the exact 400
//     "库存跟踪方式无效" with TRACKING_POLICY_MISMATCH code;
//   - audit detail format for CREATE / UPDATE is unchanged.

import { id } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError,
  allow,
  allowAny,
  readJson,
  requiredCode,
  requiredText,
  send,
} from '../lib/http.js';
import { TRACKING_POLICIES } from './traceability-quality.js';
import { deleteMasterRecord } from './data-lifecycle.js';

export function listProducts(db, res, actor, url) {
  allowAny(actor, ['PRODUCTS_VIEW', 'PRODUCTS_MANAGE']);
  const search = `%${url.searchParams.get('search')?.trim() ?? ''}%`;
  const products = db.prepare(`SELECT p.id,p.code,p.name,p.unit,p.base_uom_code baseUomCode,p.purchase_uom_code purchaseUomCode,p.sales_uom_code salesUomCode,p.price_cents priceCents,p.standard_manufacturing_cost_cents standardManufacturingCostCents,COALESCE((SELECT SUM(i.quantity) FROM inventory i WHERE i.product_id=p.id),0) stockQuantity,p.active,p.tracking_policy trackingPolicy,p.shelf_life_days shelfLifeDays,p.tracking_effective_at trackingEffectiveAt,p.valuation_method valuationMethod,p.inventory_classification inventoryClassification,
    p.created_at createdAt,p.updated_at updatedAt FROM products p WHERE p.code LIKE ? OR p.name LIKE ? ORDER BY p.code`).all(search, search)
    .map((row) => ({ ...row, active: Boolean(row.active) }));
  return send(res, 200, { products });
}

export async function createProduct(db, req, res, actor) {
  allow(actor, 'PRODUCTS_MANAGE');
  const body = await readJson(req); const product = productInput(body);
  const productId = id(); const now = new Date().toISOString();
  const standardCost = Number(body.standardManufacturingCostCents ?? 0); if (!Number.isSafeInteger(standardCost) || standardCost < 0) throw new HttpError(400, '标准制造成本必须是非负整数分');
  const classification = ['RAW_MATERIAL','FINISHED_GOOD','OTHER_INVENTORY'].includes(body.inventoryClassification) ? body.inventoryClassification : 'OTHER_INVENTORY';
  const trackingPolicy = String(body.trackingPolicy || body.tracking_policy || 'NONE').toUpperCase();
  if (!TRACKING_POLICIES.includes(trackingPolicy)) throw new HttpError(400, '库存跟踪方式无效', { code: 'TRACKING_POLICY_MISMATCH', resolution: '请选择不跟踪、批次管理或序列号管理' });
  const shelfLifeDays = body.shelfLifeDays === '' || body.shelfLifeDays == null ? null : Number(body.shelfLifeDays);
  if (shelfLifeDays !== null && (!Number.isSafeInteger(shelfLifeDays) || shelfLifeDays <= 0)) throw new HttpError(400, '保质期必须为正整数天');
  const baseUom=String(body.baseUomCode||product.unit).trim().toUpperCase(); db.prepare('INSERT OR IGNORE INTO uoms(code,name,created_at,updated_at) VALUES(?,?,?,?)').run(baseUom,baseUom,now,now);
  db.prepare(`INSERT INTO products(id,code,name,unit,base_uom_code,purchase_uom_code,sales_uom_code,price_cents,standard_manufacturing_cost_cents,stock_quantity,inventory_classification,tracking_policy,shelf_life_days,tracking_effective_at,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?,?,1,?,?)`)
    .run(productId, product.code, product.name, baseUom, baseUom, body.purchaseUomCode||null, body.salesUomCode||null, product.priceCents, standardCost, classification, trackingPolicy, shelfLifeDays, now, now, now);
  audit(db, actor.id, 'CREATE', 'PRODUCT', productId, `${product.code}; tracking=${trackingPolicy}`);
  return send(res, 201, { id: productId });
}

export async function updateProduct(db, req, res, actor, productId) {
  allow(actor, 'PRODUCTS_MANAGE');
  const current = db.prepare('SELECT * FROM products WHERE id=?').get(productId);
  if (!current) throw new HttpError(404, '货品不存在');
  const body = await readJson(req);
  if (body.stockQuantity !== undefined || body.stock_quantity !== undefined) throw new HttpError(409, '货品库存数量只读，请通过库存业务单据变更');
  const product = productInput({ code: body.code ?? current.code, name: body.name ?? current.name, unit: body.unit ?? current.unit,
    priceCents: body.priceCents ?? current.price_cents, stockQuantity: current.stock_quantity });
  const active = body.active === undefined ? current.active : Boolean(body.active) ? 1 : 0;
  const standardCost = Number(body.standardManufacturingCostCents ?? current.standard_manufacturing_cost_cents); if (!Number.isSafeInteger(standardCost) || standardCost < 0) throw new HttpError(400, '标准制造成本必须是非负整数分');
  const classification = body.inventoryClassification ?? current.inventory_classification;
  if (!['RAW_MATERIAL','FINISHED_GOOD','OTHER_INVENTORY'].includes(classification)) throw new HttpError(400, '库存分类不正确');
  const baseUom=String(body.baseUomCode??current.base_uom_code??product.unit).trim().toUpperCase(); if(baseUom!==current.base_uom_code&&db.prepare('SELECT 1 FROM inventory_transactions WHERE product_id=? LIMIT 1').get(productId))throw new HttpError(409,'已有历史交易的产品不可变更基础单位'); const updatedAt=new Date().toISOString();db.prepare('INSERT OR IGNORE INTO uoms(code,name,created_at,updated_at) VALUES(?,?,?,?)').run(baseUom,baseUom,updatedAt,updatedAt);
  db.prepare('UPDATE products SET code=?,name=?,unit=?,base_uom_code=?,purchase_uom_code=?,sales_uom_code=?,price_cents=?,standard_manufacturing_cost_cents=?,inventory_classification=?,active=?,updated_at=? WHERE id=?')
    .run(product.code, product.name, baseUom,baseUom,body.purchaseUomCode??current.purchase_uom_code,body.salesUomCode??current.sales_uom_code, product.priceCents, standardCost, classification, active, updatedAt, productId);
  audit(db, actor.id, 'UPDATE', 'PRODUCT', productId, product.code);
  return send(res, 200, { ok: true });
}

// Thin delegation wrapper. The lifecycle implementation in
// server/modules/data-lifecycle.js owns all canonical delete
// semantics for products (permission, reference dependencies,
// nonzero-stock extraReferenced, transaction, audit, response);
// this function only re-routes the product route family to that
// single source of truth. No permission check, no validation, no
// transaction, no audit, and no response transformation is added
// here.
export function deleteProduct(db, res, actor, productId) {
  return deleteMasterRecord(db, res, actor, 'product', productId);
}

function productInput(body) {
  const priceCents = Number(body.priceCents); const stockQuantity = Number(body.stockQuantity ?? 0);
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw new HttpError(400, '销售单价必须是非负金额');
  if (!Number.isFinite(stockQuantity) || stockQuantity < 0) throw new HttpError(400, '库存数量不能小于 0');
  return { code: requiredCode(body.code, '货品编码'), name: requiredText(body.name, '货品名称', 100),
    unit: requiredText(body.unit, '单位', 10), priceCents, stockQuantity };
}
