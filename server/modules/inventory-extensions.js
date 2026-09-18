// M13 — Inventory Scrap + Inventory Month-End.
//
// Two related but independent feature families:
//
//   1. Inventory Scrap (operational stock destruction)
//   2. Inventory Month-End (period control + read-only snapshot)
//
// Both integrate with the canonical `inventory` and
// `inventory_transactions` tables without introducing a parallel
// stock ledger.
//
// Inventory Scrap contract:
//
//   DRAFT -> CONFIRMED     (operational confirmation by warehouse)
//   DRAFT -> CANCELLED     (only DRAFT is cancellable)
//
//   - DRAFT create / edit / cancel allowed with INVENTORY_SCRAP_MANAGE.
//   - CONFIRM is allowed exactly once per scrap header. A repeated
//     confirm returns 409. CONFIRMED and CANCELLED documents are
//     immutable.
//   - Confirm runs in a single transaction: it re-reads the current
//     canonical inventory for every item, validates that each
//     warehouse+product has sufficient stock, and either succeeds for
//     all items or rolls back the entire document. A partial
//     shortage therefore leaves stock untouched.
//   - Each confirmed item writes exactly one OUT transaction
//     (`source_type = 'INVENTORY_SCRAP'`, `source_id = scrap id`)
//     following the existing warehouse / product / balance_after /
//     creator conventions.
//
//   Accounting effect: SCRAP ACCOUNTING VALUATION = DEFERRED. We do
//   not invent arbitrary loss accounts and do not generate any
//   accounting voucher for a scrap confirm.
//
// Inventory Month-End contract:
//
//   CLOSED   (default)        -> REOPENED (admin only, only on the
//                                latest CLOSED period; rejected if a
//                                later CLOSED period exists).
//   REOPENED                  -> CLOSED   (admin only, rebuilds the
//                                snapshot for that exact period in
//                                one transaction).
//
//   - First close on a legacy database is allowed for any completed
//     calendar month after validation. After a closure exists, new
//     closes must be strictly chronological: 2026-08 is rejected if
//     2026-09 already CLOSED, etc.
//   - Closing a CLOSED period is rejected (409). Reopening an
//     already REOPENED period is rejected (409).
//   - Close is atomic: validate period, validate order, compute
//     snapshot, write snapshot, mark CLOSED — all in one
//     transaction. Any failure rolls back the entire closure.
//   - Reclose rebuilds the snapshot for the same period inside one
//     transaction. No duplicate snapshot rows are produced because of
//     the unique index on (closure_id, warehouse_id, product_id).
//   - Closing and reopening write 0 rows into `inventory` and 0 rows
//     into `inventory_transactions`. The snapshot is read-only.
//
// Snapshot reconstruction (canonical-only):
//
//   For each (warehouse_id, product_id) with activity in the period:
//
//     closing_quantity =
//         inventory.quantity
//         − SUM(CASE WHEN direction='IN'  THEN quantity_change ELSE 0 END)
//         − SUM(CASE WHEN direction='OUT' THEN -quantity_change ELSE 0 END)
//         for transactions strictly AFTER period_end (last day of period)
//
//     period_in_quantity  = SUM(quantity_change) for direction='IN'
//                           AND created_at within period range
//     period_out_quantity = SUM(quantity_change) for direction='OUT'
//                           AND created_at within period range
//
//   Current canonical inventory is the only stock source of truth;
//   `products.stock_quantity` is NEVER used.

import { id as genId, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, readJson, requiredText, optionalText, send,
} from '../lib/http.js';

const SCRAP_STATUS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const PERIOD_STATUS = { CLOSED: '已结账', REOPENED: '已反结账' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_NOTE = 200;
const MAX_REASON = 200;

function nowIso() { return new Date().toISOString(); }

function makeScrapNo() {
  const now = new Date();
  return `SC-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${String(now.getTime()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
}

function readScrapDate(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const text = String(value).trim();
  if (!DATE_RE.test(text)) throw new HttpError(400, '报废日期格式应为 YYYY-MM-DD');
  if (Number.isNaN(Date.parse(text + 'T00:00:00Z'))) throw new HttpError(400, '报废日期不正确');
  return text;
}

function readPeriodKey(value) {
  if (typeof value !== 'string' || !PERIOD_RE.test(value)) {
    throw new HttpError(400, '期间格式应为 YYYY-MM');
  }
  return value;
}

function periodRange(periodKey) {
  const [yearStr, monthStr] = periodKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  // lastDay: month is 1-12, day 0 of next month is the last day of month
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDate = `${periodKey}-01`;
  const endDate = `${periodKey}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate, endTimestamp: `${endDate} 23:59:59` };
}

function normalizeScrapItems(db, rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new HttpError(400, '请至少添加一行报废明细');
  }
  const seen = new Set();
  return rawItems.map((entry, index) => {
    const warehouseId = requiredText(entry.warehouseId ?? entry.warehouse_id, `第${index + 1}行仓库`, 100);
    const productId = requiredText(entry.productId ?? entry.product_id, `第${index + 1}行货品`, 100);
    if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(warehouseId)) {
      throw new HttpError(400, `第${index + 1}行仓库无效`);
    }
    if (!db.prepare('SELECT 1 FROM products WHERE id=? AND active=1').get(productId)) {
      throw new HttpError(400, `第${index + 1}行货品无效`);
    }
    if (seen.has(`${warehouseId}|${productId}`)) {
      throw new HttpError(400, `第${index + 1}行仓库+货品重复`);
    }
    seen.add(`${warehouseId}|${productId}`);
    const quantity = Number(entry.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new HttpError(400, `第${index + 1}行报废数量必须大于 0`);
    }
    return {
      id: genId(),
      warehouseId,
      productId,
      quantity,
      reason: optionalText(entry.reason ?? '', MAX_REASON),
      lineNo: index + 1,
    };
  });
}

function saveScrapItems(db, scrapId, items) {
  db.prepare('DELETE FROM inventory_scrap_items WHERE scrap_id=?').run(scrapId);
  const insert = db.prepare('INSERT INTO inventory_scrap_items(id,scrap_id,warehouse_id,product_id,quantity,reason,line_no) VALUES(?,?,?,?,?,?,?)');
  for (const item of items) insert.run(item.id, scrapId, item.warehouseId, item.productId, item.quantity, item.reason, item.lineNo);
}

// =====================================================================
// Inventory Scrap — list / detail / create / update / confirm / cancel
// =====================================================================

function fetchScrapHeader(db, scrapId) {
  return db.prepare(`
    SELECT s.*, creator.display_name creatorName, confirmed.display_name confirmedByName,
           cancelled.display_name cancelledByName
      FROM inventory_scraps s
      JOIN users creator ON creator.id = s.creator_id
      LEFT JOIN users confirmed ON confirmed.id = s.confirmed_by
      LEFT JOIN users cancelled ON cancelled.id = s.cancelled_by
     WHERE s.id = ?
  `).get(scrapId);
}

function fetchScrapItems(db, scrapId) {
  return db.prepare(`
    SELECT i.*, i.warehouse_id warehouseId, i.product_id productId,
           w.code warehouseCode, w.name warehouseName,
           p.code productCode, p.name productName, p.unit productUnit
      FROM inventory_scrap_items i
      JOIN warehouses w ON w.id = i.warehouse_id
      JOIN products p ON p.id = i.product_id
     WHERE i.scrap_id = ?
     ORDER BY i.line_no, i.id
  `).all(scrapId);
}

export function listInventoryScraps(db, res, actor, url) {
  allowAny(actor, ['INVENTORY_SCRAP_VIEW', 'INVENTORY_SCRAP_MANAGE']);
  const status = url.searchParams.get('status');
  const params = [];
  let whereClause = '';
  if (status && SCRAP_STATUS[status]) { whereClause = 'WHERE s.status = ?'; params.push(status); }
  const rows = db.prepare(`
    SELECT s.id, s.scrap_no scrapNo, s.status, s.scrap_date scrapDate,
           s.reason, s.notes, s.created_at createdAt, s.confirmed_at confirmedAt,
           creator.display_name creatorName, confirmed.display_name confirmedByName,
           (SELECT COUNT(*) FROM inventory_scrap_items WHERE scrap_id=s.id) itemCount,
           (SELECT COALESCE(SUM(quantity), 0) FROM inventory_scrap_items WHERE scrap_id=s.id) totalQuantity
      FROM inventory_scraps s
      JOIN users creator ON creator.id = s.creator_id
      LEFT JOIN users confirmed ON confirmed.id = s.confirmed_by
      ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT 100
  `).all(...params).map((row) => ({
    ...row,
    statusLabel: SCRAP_STATUS[row.status] || row.status,
    totalQuantity: Number(row.totalQuantity),
    itemCount: Number(row.itemCount),
  }));
  return send(res, 200, { inventoryScraps: rows });
}

export function getInventoryScrap(db, res, actor, scrapId) {
  allowAny(actor, ['INVENTORY_SCRAP_VIEW', 'INVENTORY_SCRAP_MANAGE']);
  const header = fetchScrapHeader(db, scrapId);
  if (!header) throw new HttpError(404, '库存报废单不存在');
  header.statusLabel = SCRAP_STATUS[header.status] || header.status;
  header.items = fetchScrapItems(db, scrapId).map((row) => ({ ...row, quantity: Number(row.quantity) }));
  return send(res, 200, { inventoryScrap: header });
}

export async function createInventoryScrap(db, req, res, actor) {
  allow(actor, 'INVENTORY_SCRAP_MANAGE');
  const body = await readJson(req);
  const reason = optionalText(body.reason ?? '', MAX_REASON);
  const notes = optionalText(body.notes ?? '', MAX_NOTE);
  const scrapDate = readScrapDate(body.scrapDate, new Date().toISOString().slice(0, 10));
  const items = normalizeScrapItems(db, body.items);
  const scrapId = genId();
  const scrapNo = makeScrapNo();
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO inventory_scraps(id, scrap_no, status, scrap_date, reason, notes,
        creator_id, created_at, updated_at)
      VALUES(?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)
    `).run(scrapId, scrapNo, scrapDate, reason, notes, actor.id, now, now);
    saveScrapItems(db, scrapId, items);
    audit(db, actor.id, 'CREATE', 'INVENTORY_SCRAP', scrapId, `创建库存报废 ${scrapNo}`);
  });
  return send(res, 201, { id: scrapId, scrapNo, status: 'DRAFT' });
}

export async function updateInventoryScrap(db, req, res, actor, scrapId) {
  allow(actor, 'INVENTORY_SCRAP_MANAGE');
  const current = fetchScrapHeader(db, scrapId);
  if (!current) throw new HttpError(404, '库存报废单不存在');
  if (current.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的报废单可以修改');
  const body = await readJson(req);
  const reason = optionalText(body.reason ?? current.reason, MAX_REASON);
  const notes = optionalText(body.notes ?? current.notes, MAX_NOTE);
  const scrapDate = readScrapDate(body.scrapDate, current.scrap_date);
  const items = normalizeScrapItems(db, body.items);
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      UPDATE inventory_scraps
         SET reason=?, notes=?, scrap_date=?, updated_at=?
       WHERE id=?
    `).run(reason, notes, scrapDate, now, scrapId);
    saveScrapItems(db, scrapId, items);
    audit(db, actor.id, 'UPDATE', 'INVENTORY_SCRAP', scrapId, `修改库存报废 ${current.scrap_no}`);
  });
  return send(res, 200, { ok: true });
}

export function confirmInventoryScrap(db, res, actor, scrapId) {
  allow(actor, 'INVENTORY_SCRAP_MANAGE');
  const now = nowIso();
  transaction(db, () => {
    const header = db.prepare('SELECT * FROM inventory_scraps WHERE id=?').get(scrapId);
    if (!header) throw new HttpError(404, '库存报废单不存在');
    if (header.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的报废单可以确认');
    const items = db.prepare('SELECT * FROM inventory_scrap_items WHERE scrap_id=? ORDER BY line_no, id').all(scrapId);
    if (!items.length) throw new HttpError(409, '报废单没有明细，无法确认');
    // Pre-validate stock for every item; abort all on any shortage.
    for (const item of items) {
      const inv = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?')
        .get(item.warehouse_id, item.product_id);
      const current = inv ? Number(inv.quantity) : 0;
      if (!Number.isFinite(current) || current < Number(item.quantity)) {
        throw new HttpError(409, `库存不足：仓库 ${item.warehouse_id} 货品 ${item.product_id} 当前 ${current}，需报废 ${item.quantity}`);
      }
    }
    // Mutate canonical inventory and ledger in a single transaction.
    for (const item of items) {
      const balance = adjustInventory(db, item.warehouse_id, item.product_id, -Number(item.quantity), now);
      db.prepare(`
        INSERT INTO inventory_transactions
          (id, warehouse_id, product_id, quantity_change, direction, balance_after,
           source_type, source_id, source_no, remark, creator_id, created_at)
        VALUES(?,?,?,?, 'OUT', ?, 'INVENTORY_SCRAP', ?, ?, ?, ?, ?)
      `).run(genId(), item.warehouse_id, item.product_id, Number(item.quantity), balance,
             header.id, header.scrap_no, header.reason || '库存报废', actor.id, now);
    }
    db.prepare(`
      UPDATE inventory_scraps
         SET status='CONFIRMED', confirmed_by=?, confirmed_at=?, updated_at=?
       WHERE id=?
    `).run(actor.id, now, now, scrapId);
    audit(db, actor.id, 'CONFIRM', 'INVENTORY_SCRAP', scrapId, `确认库存报废 ${header.scrap_no}`);
  });
  return send(res, 200, { ok: true, status: 'CONFIRMED' });
}

export function cancelInventoryScrap(db, res, actor, scrapId) {
  allow(actor, 'INVENTORY_SCRAP_MANAGE');
  const now = nowIso();
  transaction(db, () => {
    const header = db.prepare('SELECT * FROM inventory_scraps WHERE id=?').get(scrapId);
    if (!header) throw new HttpError(404, '库存报废单不存在');
    if (header.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的报废单可以取消');
    db.prepare(`
      UPDATE inventory_scraps
         SET status='CANCELLED', cancelled_by=?, cancelled_at=?, updated_at=?
       WHERE id=?
    `).run(actor.id, now, now, scrapId);
    audit(db, actor.id, 'CANCEL', 'INVENTORY_SCRAP', scrapId, `取消库存报废 ${header.scrap_no}`);
  });
  return send(res, 200, { ok: true, status: 'CANCELLED' });
}

// =====================================================================
// Inventory Month-End — list / close / reopen / detail / snapshot
// =====================================================================

function fetchClosureHeader(db, closureId) {
  return db.prepare(`
    SELECT c.*, closer.display_name closedByName, reopener.display_name reopenedByName
      FROM inventory_period_closures c
      JOIN users closer ON closer.id = c.closed_by
      LEFT JOIN users reopener ON reopener.id = c.reopened_by
     WHERE c.id = ?
  `).get(closureId);
}

function fetchSnapshots(db, closureId) {
  return db.prepare(`
    SELECT s.*, s.warehouse_id warehouseId, s.product_id productId,
           w.code warehouseCode, w.name warehouseName,
           p.code productCode, p.name productName, p.unit productUnit
      FROM inventory_period_snapshots s
      JOIN warehouses w ON w.id = s.warehouse_id
      JOIN products p ON p.id = s.product_id
     WHERE s.closure_id = ?
     ORDER BY w.code, p.code
  `).all(closureId).map((row) => ({
    ...row,
    closingQuantity: Number(row.closing_quantity),
    periodInQuantity: Number(row.period_in_quantity),
    periodOutQuantity: Number(row.period_out_quantity),
  }));
}

function buildSnapshotsForPeriod(db, periodKey) {
  const { startDate, endDate, endTimestamp } = periodRange(periodKey);
  // Active (warehouse_id, product_id) combinations from canonical
  // inventory OR from transactions inside / before the period end.
  // We treat inventory as the authoritative current state; net
  // movements strictly AFTER period_end are subtracted.
  const inventoryRows = db.prepare(`
    SELECT warehouse_id, product_id, quantity FROM inventory
  `).all();
  const movementKeys = db.prepare(`
    SELECT DISTINCT warehouse_id, product_id
      FROM inventory_transactions
     WHERE DATE(created_at) <= ?
  `).all(endDate);
  const keySet = new Map();
  for (const row of inventoryRows) keySet.set(`${row.warehouse_id}|${row.product_id}`, { warehouseId: row.warehouse_id, productId: row.product_id });
  for (const row of movementKeys) if (!keySet.has(`${row.warehouse_id}|${row.product_id}`)) keySet.set(`${row.warehouse_id}|${row.product_id}`, { warehouseId: row.warehouse_id, productId: row.product_id });

  const snapshots = [];
  for (const { warehouseId, productId } of keySet.values()) {
    const current = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?')
      .get(warehouseId, productId);
    const currentQuantity = current ? Number(current.quantity) : 0;
    // Net movements strictly AFTER period_end (i.e. created_at > endTimestamp).
    const afterMovements = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN direction='IN'  THEN quantity_change ELSE 0  END), 0) AS in_sum,
        COALESCE(SUM(CASE WHEN direction='OUT' THEN quantity_change ELSE 0  END), 0) AS out_sum
        FROM inventory_transactions
       WHERE warehouse_id=? AND product_id=?
         AND created_at > ?
    `).get(warehouseId, productId, endTimestamp);
    const closingQuantity = currentQuantity - Number(afterMovements.in_sum) + Number(afterMovements.out_sum);
    // Period in/out: within period range inclusive.
    const periodMovements = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN direction='IN'  THEN quantity_change ELSE 0  END), 0) AS in_sum,
        COALESCE(SUM(CASE WHEN direction='OUT' THEN quantity_change ELSE 0  END), 0) AS out_sum
        FROM inventory_transactions
       WHERE warehouse_id=? AND product_id=?
         AND DATE(created_at) >= ?
         AND DATE(created_at) <= ?
    `).get(warehouseId, productId, startDate, endDate);
    const periodInQuantity = Number(periodMovements.in_sum);
    const periodOutQuantity = Number(periodMovements.out_sum);
    snapshots.push({
      id: genId(),
      warehouseId,
      productId,
      closingQuantity,
      periodInQuantity,
      periodOutQuantity,
    });
  }
  return snapshots;
}

function writeSnapshots(db, closureId, snapshots) {
  db.prepare('DELETE FROM inventory_period_snapshots WHERE closure_id=?').run(closureId);
  const insert = db.prepare(`
    INSERT INTO inventory_period_snapshots(id, closure_id, warehouse_id, product_id,
      closing_quantity, period_in_quantity, period_out_quantity)
    VALUES(?, ?, ?, ?, ?, ?, ?)
  `);
  for (const s of snapshots) {
    insert.run(s.id, closureId, s.warehouseId, s.productId, s.closingQuantity, s.periodInQuantity, s.periodOutQuantity);
  }
}

export function listInventoryPeriodClosures(db, res, actor) {
  allowAny(actor, ['INVENTORY_PERIOD_CLOSE_VIEW', 'INVENTORY_PERIOD_CLOSE_MANAGE']);
  const rows = db.prepare(`
    SELECT c.*, closer.display_name closedByName, reopener.display_name reopenedByName,
           (SELECT COUNT(*) FROM inventory_period_snapshots WHERE closure_id=c.id) snapshotCount
      FROM inventory_period_closures c
      JOIN users closer ON closer.id = c.closed_by
      LEFT JOIN users reopener ON reopener.id = c.reopened_by
      ORDER BY c.period_key DESC
      LIMIT 100
  `).all().map((row) => ({
    ...row,
    statusLabel: PERIOD_STATUS[row.status] || row.status,
    snapshotCount: Number(row.snapshotCount),
  }));
  return send(res, 200, { inventoryPeriodClosures: rows });
}

export function getInventoryPeriodClosure(db, res, actor, closureId) {
  allowAny(actor, ['INVENTORY_PERIOD_CLOSE_VIEW', 'INVENTORY_PERIOD_CLOSE_MANAGE']);
  const header = fetchClosureHeader(db, closureId);
  if (!header) throw new HttpError(404, '存货月结记录不存在');
  header.statusLabel = PERIOD_STATUS[header.status] || header.status;
  const snapshots = fetchSnapshots(db, closureId);
  header.snapshots = snapshots;
  const periodRangeInfo = periodRange(header.period_key);
  header.periodRange = periodRangeInfo;
  // Summary aggregation.
  const productSet = new Set();
  const warehouseSet = new Set();
  let totalIn = 0;
  let totalOut = 0;
  for (const snap of snapshots) {
    productSet.add(snap.productId);
    warehouseSet.add(snap.warehouseId);
    totalIn += snap.periodInQuantity;
    totalOut += snap.periodOutQuantity;
  }
  header.summary = {
    productCount: productSet.size,
    warehouseCount: warehouseSet.size,
    totalInQuantity: totalIn,
    totalOutQuantity: totalOut,
  };
  return send(res, 200, { inventoryPeriodClosure: header });
}

export async function closeInventoryPeriod(db, req, res, actor) {
  allow(actor, 'INVENTORY_PERIOD_CLOSE_MANAGE');
  const body = await readJson(req);
  const periodKey = readPeriodKey(body.period ?? body.periodKey);
  const notes = optionalText(body.notes ?? '', MAX_NOTE);
  const now = nowIso();
  transaction(db, () => {
    // If a closure already exists for this period_key, decide based on
    // its current status.
    const existing = db.prepare('SELECT * FROM inventory_period_closures WHERE period_key=?').get(periodKey);
    if (existing) {
      if (existing.status === 'CLOSED') {
        throw new HttpError(409, `期间 ${periodKey} 已结账`);
      }
      // REOPENED -> rebuild snapshot, mark CLOSED again.
      const snapshots = buildSnapshotsForPeriod(db, periodKey);
      writeSnapshots(db, existing.id, snapshots);
      db.prepare(`
        UPDATE inventory_period_closures
           SET status='CLOSED', closed_by=?, closed_at=?, reopened_by=NULL, reopened_at=NULL, notes=?
         WHERE id=?
      `).run(actor.id, now, notes, existing.id);
      audit(db, actor.id, 'CLOSE_PERIOD', 'INVENTORY_PERIOD_CLOSURE', existing.id, `重新结账 ${periodKey}`);
      return;
    }
    // No prior closure for this period_key — chronological check:
    // After the first closure exists, new closes must be strictly
    // later than the latest CLOSED period's period_key. We compare as
    // YYYY-MM lexicographically because the format is fixed width.
    const latest = db.prepare(`
      SELECT period_key, status FROM inventory_period_closures
       ORDER BY period_key DESC LIMIT 1
    `).get();
    if (latest && latest.status === 'CLOSED' && latest.period_key >= periodKey) {
      throw new HttpError(409, `期间 ${periodKey} 早于最近已结期间 ${latest.period_key}，请按顺序结账`);
    }
    const snapshots = buildSnapshotsForPeriod(db, periodKey);
    const closureId = genId();
    db.prepare(`
      INSERT INTO inventory_period_closures(id, period_key, status, closed_by, closed_at, notes)
      VALUES(?, ?, 'CLOSED', ?, ?, ?)
    `).run(closureId, periodKey, actor.id, now, notes);
    writeSnapshots(db, closureId, snapshots);
    audit(db, actor.id, 'CLOSE_PERIOD', 'INVENTORY_PERIOD_CLOSURE', closureId, `结账 ${periodKey}`);
  });
  return send(res, 200, { ok: true, period: periodKey });
}

export function reopenInventoryPeriod(db, res, actor, closureId) {
  allow(actor, 'INVENTORY_PERIOD_CLOSE_MANAGE');
  const now = nowIso();
  transaction(db, () => {
    const closure = db.prepare('SELECT * FROM inventory_period_closures WHERE id=?').get(closureId);
    if (!closure) throw new HttpError(404, '存货月结记录不存在');
    if (closure.status !== 'CLOSED') throw new HttpError(409, '当前期间已为反结账状态');
    // Only the latest CLOSED period may be reopened; opening an older
    // period underneath a newer one would violate forward chronology.
    const latest = db.prepare(`
      SELECT period_key, status FROM inventory_period_closures
       ORDER BY period_key DESC LIMIT 1
    `).get();
    if (!latest || latest.period_key !== closure.period_key || latest.status !== 'CLOSED') {
      throw new HttpError(409, `期间 ${closure.period_key} 不是最近已结期间，不能反结账`);
    }
    db.prepare(`
      UPDATE inventory_period_closures
         SET status='REOPENED', reopened_by=?, reopened_at=?
       WHERE id=?
    `).run(actor.id, now, closureId);
    audit(db, actor.id, 'REOPEN_PERIOD', 'INVENTORY_PERIOD_CLOSURE', closureId, `反结账 ${closure.period_key}`);
  });
  return send(res, 200, { ok: true, status: 'REOPENED' });
}

// =====================================================================
// Canonical stock helper (mirrors server/app.js adjustInventory; kept
// inline to avoid a circular import).
// =====================================================================

function adjustInventory(db, warehouseId, productId, quantityChange, now) {
  db.prepare(`
    INSERT INTO inventory(id, warehouse_id, product_id, quantity, updated_at)
    VALUES(?, ?, ?, ?, ?)
    ON CONFLICT(warehouse_id, product_id) DO UPDATE SET
      quantity = inventory.quantity + excluded.quantity,
      updated_at = excluded.updated_at
  `).run(genId(), warehouseId, productId, quantityChange, now);
  return Number(db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, productId).quantity);
}
