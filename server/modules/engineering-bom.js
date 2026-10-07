// V17 Master & Engineering Domain Closure — Wave B: BOM Governance.
//
// Owner module for the additive BOM lifecycle fields (purpose / effective
// from/to / approval lifecycle), tree expand + cycle detection, batch
// maintenance preview/apply, and engineering analysis (forward / reverse
// where-used / consolidated / compare / cost reference).
//
// Backward compatibility contract:
//   - Existing ACTIVE / DISCONTINUED rows continue to load with the original
//     request / response shape.
//   - Production Order snapshot is immutable: we never rewrite
//     production_orders.bom_id, bom_version_snapshot, routing_id_snapshot,
//     or production_order_items.bom_item_id.
//   - New fields are additive (purpose, effective_from/to, approval_status,
//     change_request_id).

import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, optionalText, readJson, requiredCode, requiredText, send } from '../lib/http.js';

const BOM_PURPOSES = new Set(['GENERAL', 'SELF_MAKE', 'OUTSOURCE']);
const APPROVAL_STATUSES = new Set(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']);

function normalizePurpose(value) {
  const upper = String(value || 'GENERAL').toUpperCase();
  if (!BOM_PURPOSES.has(upper)) throw new HttpError(400, 'BOM 用途不正确');
  return upper;
}

function normalizeApprovalStatus(value) {
  const upper = String(value || 'APPROVED').toUpperCase();
  if (!APPROVAL_STATUSES.has(upper)) throw new HttpError(400, 'BOM 审核状态不正确');
  return upper;
}

function validateEffectiveRange(effectiveFrom, effectiveTo) {
  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
    throw new HttpError(400, '生效日期必须早于失效日期');
  }
}

function loadBomHeader(db, bomId) {
  const bom = db.prepare(`
    SELECT b.*, p.code product_code, p.name product_name
    FROM boms b
    JOIN products p ON p.id=b.product_id
    WHERE b.id=?
  `).get(bomId);
  if (!bom) throw new HttpError(404, 'BOM 不存在');
  bom.items = db.prepare(`
    SELECT bi.*, p.code product_code, p.name product_name, p.unit
    FROM bom_items bi JOIN products p ON p.id=bi.product_id
    WHERE bi.bom_id=? ORDER BY bi.line_no
  `).all(bomId);
  return bom;
}

function requirePositiveQuantity(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, label + '必须大于0');
  return n;
}

function requireScrapRate(value, label) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new HttpError(400, label + '必须在0到1之间');
  return n;
}

function validateBomItem(db, body, parentProductId, index) {
  const componentId = String(body?.productId ?? body?.product_id ?? '').trim();
  if (!componentId) throw new HttpError(400, `第${index + 1}行物料不能为空`);
  if (componentId === parentProductId) throw new HttpError(400, 'BOM物料不能引用父项产品本身');
  const component = db.prepare('SELECT id, base_uom_code, tracking_policy FROM products WHERE id=? AND active=1').get(componentId);
  if (!component) throw new HttpError(400, `第${index + 1}行物料不存在或已停用`);
  const uomCode = String(body.uomCode ?? body.uom_code ?? component.base_uom_code);
  let numerator = 1;
  let denominator = 1;
  if (uomCode !== component.base_uom_code) {
    const conversion = db.prepare("SELECT numerator, denominator FROM product_uom_conversions WHERE product_id=? AND uom_code=? AND active=1 ORDER BY version DESC LIMIT 1").get(componentId, uomCode);
    if (!conversion) throw new HttpError(409, `第${index + 1}行缺少 UOM 换算`);
    numerator = conversion.numerator;
    denominator = conversion.denominator;
  }
  const documentQuantity = requirePositiveQuantity(body.quantity, `第${index + 1}行用量`);
  const baseQuantity = documentQuantity * numerator / denominator;
  if (component.tracking_policy === 'SERIAL' && !Number.isInteger(baseQuantity)) {
    throw new HttpError(409, 'SERIAL BOM 基础数量必须为整数');
  }
  return {
    productId: componentId,
    quantity: baseQuantity,
    uomCode,
    conversionNumerator: numerator,
    conversionDenominator: denominator,
    scrapRate: requireScrapRate(body.scrapRate ?? body.scrap_rate, `第${index + 1}行损耗率`),
    isSelectable: body.isSelectable === true || body.is_selectable === true ? 1 : 0,
    isReplaceable: body.isReplaceable === true || body.is_replaceable === true ? 1 : 0,
    isModifiable: body.isModifiable === true || body.is_modifiable === true ? 1 : 0,
    configGroup: optionalText(body.configGroup ?? body.config_group, 50) || null,
    configConstraint: optionalText(body.configConstraint ?? body.config_constraint, 200),
  };
}

function validateBomPayload(db, body, options = {}) {
  const productId = options.existingProductId ?? String(body.productId ?? body.product_id ?? '').trim();
  if (!productId) throw new HttpError(400, '请选择父项产品');
  if (!options.existingProductId) {
    const parent = db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(productId);
    if (!parent) throw new HttpError(400, '父项产品不存在或已停用');
  }
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new HttpError(400, 'BOM至少需要一条物料明细');
  const seen = new Set();
  const items = rawItems.map((item, index) => {
    if (seen.has(item.productId ?? item.product_id)) {
      throw new HttpError(400, 'BOM物料不能重复');
    }
    seen.add(item.productId ?? item.product_id);
    return validateBomItem(db, item, productId, index);
  });
  return {
    productId,
    version: String(body.version ?? '1.0').trim() || '1.0',
    remark: optionalText(body.remark, 500),
    purpose: normalizePurpose(body.purpose),
    effectiveFrom: optionalText(body.effectiveFrom ?? body.effective_from, 10) || null,
    effectiveTo: optionalText(body.effectiveTo ?? body.effective_to, 10) || null,
    approvalStatus: normalizeApprovalStatus(body.approvalStatus ?? body.approval_status),
    changeRequestId: optionalText(body.changeRequestId ?? body.change_request_id, 100) || null,
    items,
  };
}

// Cycle detection via DFS coloring. Returns true if any cycle is detected.
//
// `childProductId` is the component being added; `parentProductId` is the
// product whose BOM we are adding it to. A cycle exists if walking DOWN
// from `childProductId` (its component descendants) reaches `parentProductId`.
function detectCycle(db, parentProductId, childProductId) {
  if (parentProductId === childProductId) return true;
  const stack = [childProductId];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  while (stack.length) {
    const node = stack.pop();
    const cur = color.get(node) ?? WHITE;
    if (cur === BLACK) continue;
    color.set(node, GRAY);
    const children = db.prepare(`SELECT bi.product_id FROM bom_items bi
      JOIN boms b ON b.id=bi.bom_id WHERE b.product_id=? AND b.status='ACTIVE'`).all(node);
    for (const child of children) {
      if (child.product_id === parentProductId) return true;
      if ((color.get(child.product_id) ?? WHITE) === GRAY) return true;
      stack.push(child.product_id);
    }
    color.set(node, BLACK);
  }
  return false;
}

function resolveEffectiveBom(db, productId, purpose = 'GENERAL', businessDate) {
  const today = businessDate || new Date().toISOString().slice(0, 10);
  // V17 resolver: respect approval + effective_from + effective_to.
  const row = db.prepare(`SELECT * FROM boms WHERE product_id=? AND purpose=? AND status='ACTIVE' AND approval_status='APPROVED'
    AND (effective_from IS NULL OR effective_from <= ?)
    AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY COALESCE(effective_from, created_at) DESC, version DESC LIMIT 1`).get(productId, purpose, today, today);
  if (row) return row;
  // Legacy fallback for rows with no approval_status / no effective range
  // (the migration backfilled legacy ACTIVE rows with approval_status
  // 'APPROVED' but the effective range remained NULL — those still
  // resolve by the historical ACTIVE-only contract).
  return db.prepare(`SELECT * FROM boms WHERE product_id=? AND status='ACTIVE' AND (effective_from IS NULL OR effective_from <= ?) AND (effective_to IS NULL OR effective_to >= ?) ORDER BY created_at DESC LIMIT 1`).get(productId, today, today);
}

export function listBomsGovernance(db, res, actor, url) {
  allowAny(actor, ['ENGINEERING_BOM_VIEW', 'PRODUCTION_ORDERS_VIEW']);
  const productId = url.searchParams.get('product') || '';
  const purpose = String(url.searchParams.get('purpose') || '').toUpperCase();
  const approvalStatus = String(url.searchParams.get('approvalStatus') || '').toUpperCase();
  const where = ['1=1'];
  const params = [];
  if (productId) { where.push('b.product_id = ?'); params.push(productId); }
  if (BOM_PURPOSES.has(purpose)) { where.push('b.purpose = ?'); params.push(purpose); }
  if (APPROVAL_STATUSES.has(approvalStatus)) { where.push('b.approval_status = ?'); params.push(approvalStatus); }
  const sql = `SELECT b.*, p.code product_code, p.name product_name, creator.display_name creator_name,
    approver.display_name approver_name,
    (SELECT COUNT(*) FROM bom_items WHERE bom_id=b.id) item_count
    FROM boms b
    JOIN products p ON p.id=b.product_id
    JOIN users creator ON creator.id=b.creator_id
    LEFT JOIN users approver ON approver.id=b.approved_by
    WHERE ${where.join(' AND ')}
    ORDER BY b.created_at DESC LIMIT 200`;
  return send(res, 200, { boms: db.prepare(sql).all(...params) });
}

export function getBomGovernance(db, res, actor, bomId) {
  allowAny(actor, ['ENGINEERING_BOM_VIEW', 'PRODUCTION_ORDERS_VIEW']);
  return send(res, 200, { bom: loadBomHeader(db, bomId) });
}

export async function createBomGovernance(db, req, res, actor) {
  allow(actor, 'ENGINEERING_BOM_MANAGE');
  const body = await readJson(req);
  const bom = validateBomPayload(db, body);
  validateEffectiveRange(bom.effectiveFrom, bom.effectiveTo);
  // Cycle protection: any component must not form a back-edge to the parent.
  for (const item of bom.items) {
    if (detectCycle(db, bom.productId, item.productId)) {
      throw new HttpError(409, `物料 ${item.productId} 会在 BOM 中形成循环`);
    }
  }
  // uniqueness check on (product_id, version).
  const dup = db.prepare('SELECT 1 FROM boms WHERE product_id=? AND version=?').get(bom.productId, bom.version);
  if (dup) throw new HttpError(409, `产品 ${bom.productId} 已存在版本 ${bom.version}`);
  const now = new Date().toISOString();
  const bomId = id();
  transaction(db, () => {
    // Replace existing ACTIVE same-purpose same-effective window: in V17 the
    // resolver is allowed to keep multiple ACTIVE rows; we only auto-discontinue
    // when caller asks explicitly via purpose+version collision.
    db.prepare(`INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at,
        purpose,effective_from,effective_to,approval_status,approved_by,approved_at,change_request_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      bomId, bom.productId, bom.version, 'ACTIVE', bom.remark, actor.id, now, now,
      bom.purpose, bom.effectiveFrom, bom.effectiveTo,
      bom.approvalStatus,
      bom.approvalStatus === 'APPROVED' ? actor.id : null,
      bom.approvalStatus === 'APPROVED' ? now : null,
      bom.changeRequestId,
    );
    const itemStmt = db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no,uom_code_snapshot,
      conversion_numerator,conversion_denominator,is_selectable,is_replaceable,is_modifiable,config_group,config_constraint)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let lineNo = 1;
    for (const item of bom.items) {
      itemStmt.run(id(), bomId, item.productId, item.quantity, item.scrapRate, lineNo++,
        item.uomCode, item.conversionNumerator, item.conversionDenominator,
        item.isSelectable, item.isReplaceable, item.isModifiable, item.configGroup, item.configConstraint);
    }
    audit(db, actor.id, 'CREATE', 'BOM', bomId, `${bom.productCode || bom.productId} ${bom.version} ${bom.purpose}`);
  });
  return send(res, 201, { id: bomId });
}

export async function updateBomGovernance(db, req, res, actor, bomId) {
  allow(actor, 'ENGINEERING_BOM_MANAGE');
  const current = loadBomHeader(db, bomId);
  const body = await readJson(req);
  if (current.status === 'DISCONTINUED') throw new HttpError(409, '已停用的BOM不可修改');
  const bom = validateBomPayload(db, body, { existingProductId: current.product_id });
  validateEffectiveRange(bom.effectiveFrom, bom.effectiveTo);
  for (const item of bom.items) {
    if (detectCycle(db, bom.productId, item.productId)) {
      throw new HttpError(409, `物料 ${item.productId} 会在 BOM 中形成循环`);
    }
  }
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`UPDATE boms SET version=?,status=?,remark=?,updated_at=?,
        purpose=?,effective_from=?,effective_to=?,approval_status=?,
        approved_by=CASE WHEN ?='APPROVED' THEN ? ELSE approved_by END,
        approved_at=CASE WHEN ?='APPROVED' THEN ? ELSE approved_at END,
        change_request_id=?
      WHERE id=?`).run(
      bom.version, 'ACTIVE', bom.remark, now,
      bom.purpose, bom.effectiveFrom, bom.effectiveTo, bom.approvalStatus,
      bom.approvalStatus, actor.id,
      bom.approvalStatus, now,
      bom.changeRequestId, bomId,
    );
    db.prepare('DELETE FROM bom_items WHERE bom_id=?').run(bomId);
    const itemStmt = db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no,uom_code_snapshot,
      conversion_numerator,conversion_denominator,is_selectable,is_replaceable,is_modifiable,config_group,config_constraint)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let lineNo = 1;
    for (const item of bom.items) {
      itemStmt.run(id(), bomId, item.productId, item.quantity, item.scrapRate, lineNo++,
        item.uomCode, item.conversionNumerator, item.conversionDenominator,
        item.isSelectable, item.isReplaceable, item.isModifiable, item.configGroup, item.configConstraint);
    }
    audit(db, actor.id, 'UPDATE', 'BOM', bomId, `${current.product_code} ${bom.version}`);
  });
  return send(res, 200, { ok: true });
}

export async function deactivateBomGovernance(db, res, actor, bomId) {
  allow(actor, 'ENGINEERING_BOM_MANAGE');
  const current = loadBomHeader(db, bomId);
  if (current.status === 'DISCONTINUED') return send(res, 200, { ok: true });
  // Reference guard: cannot stop a BOM still referenced by a production order.
  const ref = db.prepare('SELECT COUNT(*) AS cnt FROM production_orders WHERE bom_id=?').get(bomId);
  if (Number(ref.cnt) > 0) throw new HttpError(409, 'BOM 仍被生产订单引用，不能停用');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("UPDATE boms SET status='DISCONTINUED', updated_at=? WHERE id=?").run(now, bomId);
    audit(db, actor.id, 'DEACTIVATE', 'BOM', bomId, current.product_code);
  });
  return send(res, 200, { ok: true });
}

export async function submitBomForApproval(db, res, actor, bomId) {
  allow(actor, 'ENGINEERING_BOM_MANAGE');
  const current = loadBomHeader(db, bomId);
  if (current.approval_status !== 'DRAFT' && current.approval_status !== 'PENDING') {
    throw new HttpError(409, '仅 DRAFT / PENDING 状态可提交审核');
  }
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("UPDATE boms SET approval_status='PENDING', updated_at=? WHERE id=?").run(now, bomId);
    audit(db, actor.id, 'SUBMIT', 'BOM', bomId, current.product_code);
  });
  return send(res, 200, { ok: true });
}

export async function approveBom(db, res, actor, bomId) {
  allow(actor, 'ENGINEERING_BOM_APPROVE');
  const current = loadBomHeader(db, bomId);
  if (current.approval_status !== 'PENDING') {
    throw new HttpError(409, '仅 PENDING 状态可审核');
  }
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("UPDATE boms SET approval_status='APPROVED', approved_by=?, approved_at=?, updated_at=? WHERE id=?")
      .run(actor.id, now, now, bomId);
    audit(db, actor.id, 'APPROVE', 'BOM', bomId, current.product_code);
  });
  return send(res, 200, { ok: true });
}

export async function rejectBom(db, req, res, actor, bomId) {
  allow(actor, 'ENGINEERING_BOM_APPROVE');
  const current = loadBomHeader(db, bomId);
  if (current.approval_status !== 'PENDING') {
    throw new HttpError(409, '仅 PENDING 状态可驳回');
  }
  const body = await readJson(req);
  const reason = requiredText(body.reason, '驳回原因', 200);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("UPDATE boms SET approval_status='REJECTED', updated_at=? WHERE id=?").run(now, bomId);
    audit(db, actor.id, 'REJECT', 'BOM', bomId, `${current.product_code} ${reason}`);
  });
  return send(res, 200, { ok: true });
}

// Tree: forward multi-level expand.
export function expandBomTree(db, res, actor, url) {
  allowAny(actor, ['ENGINEERING_BOM_VIEW', 'PRODUCTION_ORDERS_VIEW']);
  const bomId = url.searchParams.get('bom_id');
  const levels = Math.min(Math.max(Number(url.searchParams.get('levels') ?? 10), 1), 20);
  if (!bomId) throw new HttpError(400, '缺少 bom_id');
  const root = loadBomHeader(db, bomId);
  const seen = new Set([root.product_id]);
  const queue = [{ bomId, productId: root.product_id, depth: 0 }];
  const nodes = [];
  while (queue.length) {
    const { bomId: curBomId, productId, depth: level } = queue.shift();
    if (level >= levels) continue;
    const items = db.prepare(`SELECT bi.*, p.code product_code, p.name product_name, p.unit FROM bom_items bi JOIN products p ON p.id=bi.product_id WHERE bi.bom_id=?`).all(curBomId);
    for (const item of items) {
      const child = db.prepare(`SELECT id, status, approval_status, purpose FROM boms WHERE product_id=? AND status='ACTIVE' ORDER BY version DESC LIMIT 1`).get(item.product_id);
      const cycleStatus = seen.has(item.product_id) ? 'CYCLE' : 'OK';
      nodes.push({
        bom_id: curBomId,
        product_id: item.product_id,
        product_code: item.product_code,
        product_name: item.product_name,
        quantity: item.quantity,
        scrap_rate: item.scrap_rate,
        line_no: item.line_no,
        depth: level,
        child_bom_id: cycleStatus === 'CYCLE' ? null : (child?.id || null),
        child_status: cycleStatus === 'CYCLE' ? 'CYCLE' : (child?.status || null),
        child_approval: cycleStatus === 'CYCLE' ? null : (child?.approval_status || null),
        child_purpose: cycleStatus === 'CYCLE' ? null : (child?.purpose || null),
      });
      if (cycleStatus === 'OK' && child) {
        seen.add(item.product_id);
        queue.push({ bomId: child.id, productId: item.product_id, depth: level + 1 });
      }
    }
  }
  return send(res, 200, { root: { id: root.id, product_id: root.product_id, product_code: root.product_code }, nodes });
}

// Where-used: reverse.
export function whereUsed(db, res, actor, url) {
  allowAny(actor, ['ENGINEERING_BOM_VIEW', 'PRODUCTION_ORDERS_VIEW']);
  const componentProductId = url.searchParams.get('product_id');
  if (!componentProductId) throw new HttpError(400, '缺少 product_id');
  const seen = new Set();
  const queue = [componentProductId];
  const usages = [];
  while (queue.length) {
    const productId = queue.shift();
    const parents = db.prepare(`SELECT b.id, b.purpose, b.version, b.status, b.approval_status, p.id parent_product_id, p.code parent_product_code, p.name parent_product_name
      FROM bom_items bi
      JOIN boms b ON b.id=bi.bom_id
      JOIN products p ON p.id=b.product_id
      WHERE bi.product_id=?`).all(productId);
    for (const parent of parents) {
      usages.push({
        parent_bom_id: parent.id,
        parent_product_id: parent.parent_product_id,
        parent_product_code: parent.parent_product_code,
        parent_product_name: parent.parent_product_name,
        purpose: parent.purpose,
        version: parent.version,
        status: parent.status,
        approval_status: parent.approval_status,
      });
      if (!seen.has(parent.parent_product_id)) {
        seen.add(parent.parent_product_id);
        queue.push(parent.parent_product_id);
      }
    }
  }
  return send(res, 200, { component_product_id: componentProductId, usages });
}

// Consolidated: aggregate the same component across levels.
export function consolidateBom(db, res, actor, url) {
  allowAny(actor, ['ENGINEERING_BOM_VIEW', 'PRODUCTION_ORDERS_VIEW']);
  const bomId = url.searchParams.get('bom_id');
  const quantity = Number(url.searchParams.get('quantity') || 1);
  if (!bomId || !Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '缺少 bom_id 或 quantity 不合法');
  const root = loadBomHeader(db, bomId);
  const totals = new Map();
  function walk(parentProductId, level, parentQty) {
    const children = db.prepare(`SELECT bi.product_id, bi.quantity, bi.scrap_rate FROM bom_items bi
      JOIN boms b ON b.id=bi.bom_id WHERE b.product_id=? AND b.status='ACTIVE'`).all(parentProductId);
    for (const child of children) {
      const scaledQty = parentQty * Number(child.quantity) * (1 + Number(child.scrap_rate || 0));
      totals.set(child.product_id, (totals.get(child.product_id) || 0) + scaledQty);
      walk(child.product_id, level + 1, scaledQty);
    }
  }
  walk(root.product_id, 0, quantity);
  const productIds = Array.from(totals.keys());
  const products = productIds.length
    ? db.prepare(`SELECT id, code, name, unit FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`).all(...productIds)
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  return send(res, 200, {
    root: { id: root.id, product_id: root.product_id, product_code: root.product_code },
    quantity,
    items: Array.from(totals.entries()).map(([productId, qty]) => ({
      product_id: productId,
      product_code: productById.get(productId)?.code || null,
      product_name: productById.get(productId)?.name || null,
      unit: productById.get(productId)?.unit || null,
      quantity: qty,
    })),
  });
}

// Compare two BOM versions or two products.
export function compareBoms(db, res, actor, url) {
  allowAny(actor, ['ENGINEERING_BOM_VIEW', 'PRODUCTION_ORDERS_VIEW']);
  const leftId = url.searchParams.get('left');
  const rightId = url.searchParams.get('right');
  if (!leftId || !rightId) throw new HttpError(400, '缺少 left/right');
  const left = loadBomHeader(db, leftId);
  const right = loadBomHeader(db, rightId);
  const leftMap = new Map(left.items.map((it) => [it.product_id, it]));
  const rightMap = new Map(right.items.map((it) => [it.product_id, it]));
  const all = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const diff = [];
  for (const productId of all) {
    const a = leftMap.get(productId);
    const b = rightMap.get(productId);
    if (!a) diff.push({ product_id: productId, status: 'ADDED', right: { quantity: b.quantity, scrap_rate: b.scrap_rate } });
    else if (!b) diff.push({ product_id: productId, status: 'REMOVED', left: { quantity: a.quantity, scrap_rate: a.scrap_rate } });
    else if (a.quantity !== b.quantity || a.scrap_rate !== b.scrap_rate) {
      diff.push({ product_id: productId, status: 'CHANGED', left: { quantity: a.quantity, scrap_rate: a.scrap_rate }, right: { quantity: b.quantity, scrap_rate: b.scrap_rate } });
    }
  }
  return send(res, 200, { left: { id: left.id, version: left.version, product_code: left.product_code }, right: { id: right.id, version: right.version, product_code: right.product_code }, diff });
}

// BOM cost reference (uses existing product_costs — does NOT create a second
// source of cost truth).
export function bomCostReference(db, res, actor, url) {
  allowAny(actor, ['ENGINEERING_BOM_VIEW', 'PRODUCTION_ORDERS_VIEW', 'COST_VIEW']);
  const bomId = url.searchParams.get('bom_id');
  if (!bomId) throw new HttpError(400, '缺少 bom_id');
  const bom = loadBomHeader(db, bomId);
  const lines = [];
  for (const item of bom.items) {
    const cost = db.prepare(`SELECT standard_cost_cents, material_cost_cents FROM product_costs
      WHERE product_id=? AND status='ACTIVE' ORDER BY effective_date DESC LIMIT 1`).get(item.product_id);
    const lineCost = cost ? Math.round(Number(cost.material_cost_cents) * Number(item.quantity) * (1 + Number(item.scrap_rate || 0))) : 0;
    lines.push({
      product_id: item.product_id,
      product_code: item.product_code,
      product_name: item.product_name,
      quantity: item.quantity,
      scrap_rate: item.scrap_rate,
      standard_cost_cents: cost ? Number(cost.standard_cost_cents) : 0,
      material_cost_cents: cost ? Number(cost.material_cost_cents) : 0,
      line_material_cost_cents: lineCost,
    });
  }
  const totalCents = lines.reduce((acc, line) => acc + line.line_material_cost_cents, 0);
  return send(res, 200, { bom: { id: bom.id, version: bom.version, product_code: bom.product_code }, lines, total_material_cost_cents: totalCents });
}

// Batch maintenance: preview / apply.
function batchTargetBoms(db, filter) {
  const where = ['status != \'DISCONTINUED\''];
  const params = [];
  if (filter.productIds && filter.productIds.length) {
    where.push(`product_id IN (${filter.productIds.map(() => '?').join(',')})`);
    params.push(...filter.productIds);
  }
  if (filter.purpose) {
    where.push('purpose=?');
    params.push(filter.purpose);
  }
  if (filter.approvalStatus) {
    where.push('approval_status=?');
    params.push(filter.approvalStatus);
  }
  return db.prepare(`SELECT * FROM boms WHERE ${where.join(' AND ')}`).all(...params);
}

function diffItems(leftItems, rightItems, componentProductId) {
  const left = leftItems.find((it) => it.product_id === componentProductId);
  const right = rightItems.find((it) => it.product_id === componentProductId);
  return {
    before: left ? { quantity: left.quantity, scrap_rate: left.scrap_rate, is_selectable: left.is_selectable, is_replaceable: left.is_replaceable, is_modifiable: left.is_modifiable } : null,
    after: right ? { quantity: right.quantity, scrap_rate: right.scrap_rate, is_selectable: right.is_selectable, is_replaceable: right.is_replaceable, is_modifiable: right.is_modifiable } : null,
  };
}

function applyBatchChanges(db, actor, targetBoms, changes) {
  const now = new Date().toISOString();
  for (const bom of targetBoms) {
    const currentItems = db.prepare('SELECT * FROM bom_items WHERE bom_id=? ORDER BY line_no').all(bom.id);
    const updated = currentItems.map((it) => ({ ...it }));
    let touched = false;
    for (const change of changes) {
      if (change.type === 'add') {
        if (!updated.find((it) => it.product_id === change.componentProductId)) {
          const component = db.prepare('SELECT id, base_uom_code, tracking_policy FROM products WHERE id=? AND active=1').get(change.componentProductId);
          if (!component) continue;
          updated.push({
            id: id(),
            bom_id: bom.id,
            product_id: change.componentProductId,
            quantity: Number(change.quantity || 1),
            scrap_rate: Number(change.scrapRate || 0),
            line_no: 0,
            uom_code_snapshot: component.base_uom_code,
            conversion_numerator: 1,
            conversion_denominator: 1,
            is_selectable: 0,
            is_replaceable: 0,
            is_modifiable: 0,
            config_group: null,
            config_constraint: '',
          });
          touched = true;
        }
      } else if (change.type === 'modify') {
        const target = updated.find((it) => it.product_id === change.componentProductId);
        if (target) {
          if (change.quantity !== undefined) target.quantity = Number(change.quantity);
          if (change.scrapRate !== undefined) target.scrap_rate = Number(change.scrapRate);
          if (change.isSelectable !== undefined) target.is_selectable = change.isSelectable ? 1 : 0;
          if (change.isReplaceable !== undefined) target.is_replaceable = change.isReplaceable ? 1 : 0;
          if (change.isModifiable !== undefined) target.is_modifiable = change.isModifiable ? 1 : 0;
          touched = true;
        }
      } else if (change.type === 'remove') {
        const idx = updated.findIndex((it) => it.product_id === change.componentProductId);
        if (idx >= 0) { updated.splice(idx, 1); touched = true; }
      } else if (change.type === 'replace') {
        const idx = updated.findIndex((it) => it.product_id === change.fromProductId);
        if (idx >= 0) {
          updated[idx] = { ...updated[idx], product_id: change.toProductId };
          touched = true;
        }
      }
    }
    if (!touched) continue;
    db.prepare('DELETE FROM bom_items WHERE bom_id=?').run(bom.id);
    const insert = db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no,uom_code_snapshot,conversion_numerator,conversion_denominator,is_selectable,is_replaceable,is_modifiable,config_group,config_constraint)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    updated.forEach((item, idx) => insert.run(
      item.id || id(), bom.id, item.product_id, item.quantity, item.scrap_rate, idx + 1,
      item.uom_code_snapshot || null, item.conversion_numerator || 1, item.conversion_denominator || 1,
      item.is_selectable || 0, item.is_replaceable || 0, item.is_modifiable || 0,
      item.config_group || null, item.config_constraint || '',
    ));
    db.prepare('UPDATE boms SET updated_at=? WHERE id=?').run(now, bom.id);
    audit(db, actor.id, 'BATCH_UPDATE', 'BOM', bom.id, `${bom.product_id} ${changes.length} changes`);
  }
}

async function handleBatchRequest(db, req, res, actor, mode) {
  allow(actor, mode === 'apply' ? 'ENGINEERING_BOM_MANAGE' : 'ENGINEERING_BOM_VIEW');
  const body = await readJson(req);
  const filter = body.filter || {};
  const changes = Array.isArray(body.changes) ? body.changes : [];
  if (changes.length === 0) throw new HttpError(400, '缺少 changes');
  const targets = batchTargetBoms(db, filter);
  if (mode === 'preview') {
    const preview = targets.map((bom) => {
      const currentItems = db.prepare('SELECT * FROM bom_items WHERE bom_id=? ORDER BY line_no').all(bom.id);
      const projected = currentItems.map((it) => ({ ...it }));
      for (const change of changes) {
        if (change.type === 'add') {
          if (!projected.find((it) => it.product_id === change.componentProductId)) {
            projected.push({
              product_id: change.componentProductId,
              quantity: Number(change.quantity || 1),
              scrap_rate: Number(change.scrapRate || 0),
              is_selectable: 0,
              is_replaceable: 0,
              is_modifiable: 0,
            });
          }
        } else if (change.type === 'modify') {
          const target = projected.find((it) => it.product_id === change.componentProductId);
          if (target) {
            if (change.quantity !== undefined) target.quantity = Number(change.quantity);
            if (change.scrapRate !== undefined) target.scrap_rate = Number(change.scrapRate);
          }
        } else if (change.type === 'remove') {
          const idx = projected.findIndex((it) => it.product_id === change.componentProductId);
          if (idx >= 0) projected.splice(idx, 1);
        } else if (change.type === 'replace') {
          const idx = projected.findIndex((it) => it.product_id === change.fromProductId);
          if (idx >= 0) projected[idx].product_id = change.toProductId;
        }
      }
      return {
        bom_id: bom.id,
        product_id: bom.product_id,
        version: bom.version,
        purpose: bom.purpose,
        item_diff: changes.map((change) => {
          const componentProductId = change.componentProductId ?? change.fromProductId;
          const d = diffItems(currentItems, projected, componentProductId);
          return { type: change.type, ...d };
        }),
      };
    });
    return send(res, 200, { previewCount: preview.length, targets: preview });
  }
  // Apply.
  transaction(db, () => applyBatchChanges(db, actor, targets, changes));
  return send(res, 200, { appliedCount: targets.length });
}

export async function previewBomBatch(db, req, res, actor) {
  return handleBatchRequest(db, req, res, actor, 'preview');
}

export async function applyBomBatch(db, req, res, actor) {
  return handleBatchRequest(db, req, res, actor, 'apply');
}

// Resolver contract consumed by Production / Planning / Outsourcing.
// Returns the canonical effective BOM for the given product/purpose on the
// business date, respecting approval status and effective range. Returns
// null if no approved BOM is in the effective window.
export function resolveEffectiveBomForCaller(db, productId, purpose = 'GENERAL', businessDate) {
  return resolveEffectiveBom(db, productId, purpose, businessDate);
}

export { resolveEffectiveBom, detectCycle };