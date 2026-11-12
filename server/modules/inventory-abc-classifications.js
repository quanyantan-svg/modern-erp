// INV-26 — Inventory ABC Classification.
//
// Frozen by `solution.md §27.31` (Domain 5 Closure Design) and
// `docs/requirements/inventory-warehouse.md §32.3.1` (INV-26):
//   - ABC only produces classification / cycle-stocktake strategy input.
//   - `basis='VALUE'` MUST reference a Finance valuation snapshot. Inventory
//     does NOT copy the valuation engine; when no Finance canonical valuation
//     snapshot is available the classification is refused.
//   - `basis='USAGE'` ranks by real movement quantity read from the canonical
//     inventory movement ledger (`inventory_transactions`), never from the
//     stale `products.stock_quantity`.
//   - Classification history is preserved: a previous open row for the same
//     product is CLOSED (`effective_to` = new effective date), never deleted.
//   - The canonical table is `inventory_abc_classifications` with
//     UNIQUE(product_id, effective_from) — re-running with the same effective
//     date therefore updates the existing row instead of duplicating it.

import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';

const USAGE_WINDOW_DAYS = 90;
const ABC_CLASSES = Object.freeze(['A', 'B', 'C']);

function nowIso() { return new Date().toISOString(); }

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_abc_classifications (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      abc_class TEXT NOT NULL CHECK(abc_class IN ('A','B','C')),
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      basis TEXT NOT NULL DEFAULT 'VALUE',
      finance_valuation_snapshot_id TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(product_id, effective_from)
    );
  `);
}

function normalizeDate(value, label) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new HttpError(400, `${label}格式应为 YYYY-MM-DD`);
  return text;
}

function shiftDate(dateText, days) {
  const base = Date.parse(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(base)) throw new HttpError(400, '日期无效');
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

// --- canonical movement read (usage basis) ---------------------------------
//
// The usage ranking reads the canonical inventory movement ledger. Only
// `direction='OUT'` counts as consumption; `direction='IN'` is a receipt and
// must not inflate the usage share. `inventory_transactions` is the canonical
// ledger written by `applyInventoryMutation`.
function readUsageByProduct(db, { fromDate, toDate, warehouseId }) {
  const params = [];
  const where = [`direction='OUT'`, 'business_date>=?', 'business_date<=?'];
  params.push(fromDate, toDate);
  if (warehouseId) { where.push('warehouse_id=?'); params.push(warehouseId); }
  const rows = db.prepare(`
    SELECT product_id productId, SUM(ABS(quantity_change)) usageQuantity
      FROM inventory_transactions
     WHERE ${where.join(' AND ')}
     GROUP BY product_id
  `).all(...params);
  const usage = new Map();
  for (const row of rows) {
    usage.set(row.productId, Number(row.usageQuantity) || 0);
  }
  return usage;
}

// --- value basis ------------------------------------------------------------
//
// Design §27.31: basis='VALUE' must reference a Finance valuation snapshot and
// Inventory must not copy the valuation engine. Inventory therefore reads the
// Finance canonical valuation evidence (`inventory_valuation_movements`,
// POSTED rows) ONLY when a snapshot reference is supplied, and never
// re-implements costing.
function readValueByProduct(db, { fromDate, toDate, warehouseId, snapshotId }) {
  const params = [];
  const where = ["status='POSTED'", 'business_date<=?'];
  params.push(toDate);
  if (snapshotId) { where.push('source_id=?'); params.push(snapshotId); }
  if (warehouseId) { where.push('warehouse_id=?'); params.push(warehouseId); }
  const rows = db.prepare(`
    SELECT product_id productId, SUM(value_delta_cents) valueCents
      FROM inventory_valuation_movements
     WHERE ${where.join(' AND ')}
       AND business_date >= ?
     GROUP BY product_id
  `).all(...params, fromDate);
  const value = new Map();
  for (const row of rows) {
    value.set(row.productId, Math.abs(Number(row.valueCents)) || 0);
  }
  return value;
}

// Split the ranked population into A / B / C by cumulative share:
//   A = the head of the list that accounts for the first 80% of the usage
//       (an item that crosses the 80% threshold belongs to A),
//   B = the next slice up to 95% of the cumulative total,
//   C = the remainder.
function assignAbcClasses(ranked) {
  const total = ranked.reduce((sum, entry) => sum + entry.weight, 0);
  const result = new Map();
  if (!ranked.length) return result;
  if (total <= 0) {
    for (const entry of ranked) result.set(entry.productId, 'C');
    return result;
  }
  let cumulative = 0;
  for (const entry of ranked) {
    const shareBefore = cumulative / total;
    cumulative += entry.weight;
    let abcClass = 'C';
    if (shareBefore < 0.8) abcClass = 'A';
    else if (shareBefore < 0.95) abcClass = 'B';
    result.set(entry.productId, abcClass);
  }
  return result;
}

export async function classifyInventoryAbc(db, req, res, actor) {
  allow(actor, 'INVENTORY_ABC_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['basis', 'effectiveFrom', 'warehouseId', 'financeValuationSnapshotId']);

  const basis = String(body.basis ?? 'USAGE').trim().toUpperCase();
  if (!['VALUE', 'USAGE'].includes(basis)) {
    throw new HttpError(400, 'basis 必须为 VALUE 或 USAGE');
  }
  const effectiveFrom = normalizeDate(body.effectiveFrom || nowIso().slice(0, 10), '生效日期');
  const warehouseId = body.warehouseId ? String(body.warehouseId).trim() : null;
  if (warehouseId) {
    const wh = db.prepare('SELECT id FROM warehouses WHERE id=?').get(warehouseId);
    if (!wh) throw new HttpError(400, `仓库 ${warehouseId} 不存在`);
  }
  const snapshotId = body.financeValuationSnapshotId ? String(body.financeValuationSnapshotId).trim() : null;

  if (basis === 'VALUE' && !snapshotId) {
    throw new HttpError(409, 'basis=VALUE 必须引用 Finance 估值快照（financeValuationSnapshotId），Inventory 不复制估值引擎', {
      code: 'ABC_FINANCE_VALUATION_SNAPSHOT_REQUIRED',
      resolution: '请提供 Finance 域签发的估值快照 ID，或改用 basis=USAGE。',
    });
  }

  const toDate = effectiveFrom;
  const fromDate = shiftDate(effectiveFrom, -USAGE_WINDOW_DAYS);

  let weightByProduct;
  if (basis === 'USAGE') {
    weightByProduct = readUsageByProduct(db, { fromDate, toDate, warehouseId });
  } else {
    weightByProduct = readValueByProduct(db, { fromDate, toDate, warehouseId, snapshotId });
    if (!weightByProduct.size) {
      throw new HttpError(409, `Finance 估值快照 ${snapshotId} 没有可用的估值证据，无法执行 VALUE 基础分类`, {
        code: 'ABC_FINANCE_VALUATION_SNAPSHOT_EMPTY',
        resolution: '请确认该 Finance 估值快照已签发并包含已过账的估值事件。',
      });
    }
  }

  // The population is every active product — a product with no movement in the
  // window is class C by contract.
  const products = db.prepare('SELECT id, code, name FROM products WHERE active=1 ORDER BY code, id').all();
  const ranked = products
    .map((product) => ({ productId: product.id, weight: Number(weightByProduct.get(product.id) || 0) }))
    .sort((a, b) => (b.weight - a.weight) || a.productId.localeCompare(b.productId));
  const abcByProduct = assignAbcClasses(ranked);

  const now = nowIso();
  let classified = 0;
  transaction(db, () => {
    ensureTable(db);
    for (const product of products) {
      const abcClass = abcByProduct.get(product.id) || 'C';
      if (!ABC_CLASSES.includes(abcClass)) continue;
      // Close the previous OPEN row for this product (history is preserved).
      db.prepare(`
        UPDATE inventory_abc_classifications
           SET effective_to=?
         WHERE product_id=? AND effective_to IS NULL AND effective_from < ?
      `).run(effectiveFrom, product.id, effectiveFrom);
      // Idempotency: UNIQUE(product_id, effective_from) — re-running with the
      // same effective date UPDATES the existing row instead of duplicating.
      const existing = db.prepare(`
        SELECT id FROM inventory_abc_classifications
         WHERE product_id=? AND effective_from=?
      `).get(product.id, effectiveFrom);
      if (existing) {
        db.prepare(`
          UPDATE inventory_abc_classifications
             SET abc_class=?, basis=?, effective_to=NULL, finance_valuation_snapshot_id=?, created_by=?, created_at=?
           WHERE id=?
        `).run(abcClass, basis, snapshotId, actor.id, now, existing.id);
      } else {
        db.prepare(`
          INSERT INTO inventory_abc_classifications(
            id, product_id, abc_class, effective_from, effective_to, basis,
            finance_valuation_snapshot_id, created_by, created_at)
          VALUES(?, ?, ?, ?, NULL, ?, ?, ?, ?)
        `).run(genId(), product.id, abcClass, effectiveFrom, basis, snapshotId, actor.id, now);
      }
      classified += 1;
    }
    audit(db, actor.id, 'CLASSIFY', 'INVENTORY_ABC_CLASSIFICATION', effectiveFrom,
      `ABC classify basis=${basis} effectiveFrom=${effectiveFrom} warehouse=${warehouseId || 'ALL'} products=${classified}`);
  });

  return send(res, 200, { ok: true, classified, effectiveFrom, basis });
}

export function listAbcClassifications(db, res, actor, url) {
  allowAny(actor, ['INVENTORY_ABC_MANAGE', 'INVENTORY_REPORT_VIEW', 'INVENTORY_VIEW']);
  ensureTable(db);
  const params = [];
  const where = ['1=1'];
  const productId = url.searchParams.get('productId');
  if (productId) { where.push('c.product_id=?'); params.push(productId); }
  const abcClass = url.searchParams.get('abcClass');
  if (abcClass) {
    const upper = String(abcClass).trim().toUpperCase();
    if (!ABC_CLASSES.includes(upper)) throw new HttpError(400, 'abcClass 必须为 A / B / C');
    where.push('c.abc_class=?'); params.push(upper);
  }
  const rows = db.prepare(`
    SELECT c.id, c.product_id productId, p.code productCode, p.name productName,
           c.abc_class abcClass, c.effective_from effectiveFrom, c.effective_to effectiveTo,
           c.basis, c.finance_valuation_snapshot_id financeValuationSnapshotId,
           c.created_by createdBy, c.created_at createdAt
      FROM inventory_abc_classifications c
      LEFT JOIN products p ON p.id=c.product_id
     WHERE ${where.join(' AND ')}
     ORDER BY c.effective_from DESC, c.product_id
     LIMIT 1000
  `).all(...params);
  return send(res, 200, { abcClassifications: rows });
}

// INV-38 — ABC analysis surface: the classification plus the CURRENT on-hand
// quantity read from the canonical `inventory` positions. Never from the
// stale `products.stock_quantity`.
export function getInventoryAbcAnalysis(db, res, actor, url) {
  allowAny(actor, ['INVENTORY_ABC_MANAGE', 'INVENTORY_REPORT_VIEW', 'INVENTORY_VIEW']);
  ensureTable(db);
  const params = [];
  const where = ['c.effective_to IS NULL'];
  const productId = url.searchParams.get('productId');
  if (productId) { where.push('c.product_id=?'); params.push(productId); }
  const abcClass = url.searchParams.get('abcClass');
  if (abcClass) {
    const upper = String(abcClass).trim().toUpperCase();
    if (!ABC_CLASSES.includes(upper)) throw new HttpError(400, 'abcClass 必须为 A / B / C');
    where.push('c.abc_class=?'); params.push(upper);
  }
  const rows = db.prepare(`
    SELECT c.id, c.product_id productId, p.code productCode, p.name productName,
           c.abc_class abcClass, c.effective_from effectiveFrom, c.basis,
           c.finance_valuation_snapshot_id financeValuationSnapshotId
      FROM inventory_abc_classifications c
      LEFT JOIN products p ON p.id=c.product_id
     WHERE ${where.join(' AND ')}
     ORDER BY c.abc_class, c.product_id
     LIMIT 1000
  `).all(...params);

  const analysis = rows.map((row) => {
    const onHand = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) q
        FROM inventory
       WHERE product_id=? AND active=1
    `).get(row.productId);
    return {
      ...row,
      onHandQuantity: Number(onHand?.q || 0),
    };
  });
  return send(res, 200, { analysis });
}
