// M13 — Inventory Scrap.
//
// Operational stock destruction feature; inventory month-end period control
// lives in `./inventory-period-close.js` and shares the canonical `inventory`
// and `inventory_transactions` tables without introducing a parallel stock
// ledger.
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

import { id as genId, transaction } from '../db.js';
import { resolveCanonicalPosition } from '../lib/stock.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import { computePositionKey } from '../lib/inventory-position.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, readJson, requiredText, optionalText, send,
} from '../lib/http.js';
import { lifecycleArchiveFilter } from './lifecycle-engine.js';
import { postTrackedMovement, saveTrackedAllocations, sourceTrackingAllocations } from './traceability-quality.js';
import { assertFinancialPeriodsOpen, createSystemVoucher, inventoryAccountRole, issueSourceValue } from './financial-inventory.js';

const SCRAP_STATUS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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
      trackingAllocations: entry.trackingAllocations || entry.tracking_allocations || [],
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
  const clauses = [];
  const archiveFilter = lifecycleArchiveFilter('INVENTORY_SCRAP', { includeArchived: url.searchParams.get('includeArchived') === 'true', idExpression: 's.id' });
  if (archiveFilter.clause) clauses.push(archiveFilter.clause);
  if (status && SCRAP_STATUS[status]) { clauses.push('s.status = ?'); params.push(status); }
  const rows = db.prepare(`
    SELECT s.id, s.scrap_no scrapNo, s.status, s.scrap_date scrapDate,
           s.reason, s.notes, s.created_at createdAt, s.confirmed_at confirmedAt,
           creator.display_name creatorName, confirmed.display_name confirmedByName,
           (SELECT COUNT(*) FROM inventory_scrap_items WHERE scrap_id=s.id) itemCount,
           (SELECT COALESCE(SUM(quantity), 0) FROM inventory_scrap_items WHERE scrap_id=s.id) totalQuantity
      FROM inventory_scraps s
      JOIN users creator ON creator.id = s.creator_id
      LEFT JOIN users confirmed ON confirmed.id = s.confirmed_by
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
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
  header.items = fetchScrapItems(db, scrapId).map((row) => ({ ...row, quantity: Number(row.quantity), trackingAllocations: sourceTrackingAllocations(db, 'INVENTORY_SCRAP', scrapId, row.id) }));
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
    for (const item of items) saveTrackedAllocations(db, { sourceType: 'INVENTORY_SCRAP', sourceId: scrapId, sourceItemId: item.id, productId: item.productId, quantity: item.quantity, allocations: item.trackingAllocations });
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

// INV-21 — the canonical position of a scrap line. A bin-enabled warehouse
// or a LOT / SERIAL tracked product cannot be expressed by the
// warehouse+product pair and is refused.
function scrapPosition(db, warehouseId, productId) {
  const { positionKey } = resolveCanonicalPosition(db, warehouseId, productId);
  return {
    productId,
    warehouseId,
    binId: null,
    ownerType: 'ENTERPRISE',
    ownerId: null,
    stockStatus: 'AVAILABLE',
    lotId: null,
    serialId: null,
    positionKey,
  };
}

export function confirmInventoryScrap(db, res, actor, scrapId) {
  allow(actor, 'INVENTORY_SCRAP_MANAGE');
  const now = nowIso();
  transaction(db, () => {
    const header = db.prepare('SELECT * FROM inventory_scraps WHERE id=?').get(scrapId);
    if (!header) throw new HttpError(404, '库存报废单不存在');
    if (header.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的报废单可以确认');
    assertFinancialPeriodsOpen(db,header.scrap_date);
    const items = db.prepare('SELECT * FROM inventory_scrap_items WHERE scrap_id=? ORDER BY line_no, id').all(scrapId);
    if (!items.length) throw new HttpError(409, '报废单没有明细，无法确认');
    // INV-07: the scrap writes the canonical position identity and goes
    // through the canonical mutation contract. The negative-stock policy, the
    // inventory lock and the period gates apply to it as well.
    const voucherEntries=[];
    for (const item of items) {
      const position = scrapPosition(db, item.warehouse_id, item.product_id);
      postTrackedMovement(db, { sourceType: 'INVENTORY_SCRAP', sourceId: scrapId, sourceItemId: item.id, productId: item.product_id, warehouseId: item.warehouse_id, quantity: item.quantity, direction: 'OUT', businessDate: header.scrap_date });
      const mutation = applyInventoryMutation({
        db, actor,
        sourceType: 'INVENTORY_SCRAP',
        sourceId: scrapId,
        sourceItemId: item.id,
        sourceNo: header.scrap_no,
        businessDate: header.scrap_date,
        movementKind: 'OUT',
        quantity: Number(item.quantity),
        fromPosition: position,
        idempotencyKey: `INVENTORY_SCRAP:${item.id}`,
        remark: header.reason || '库存报废',
        // The caller owns the strict valuation step below, in the same
        // transaction.
        valuationMode: 'EXTERNAL',
      });
      const balance = Number(mutation?.balanceAfterFrom || 0);
      const transactionId=mutation?.movements?.[0]?.transactionId || null;
      const amount=issueSourceValue(db,{businessDate:header.scrap_date,productId:item.product_id,warehouseId:item.warehouse_id,quantity:Number(item.quantity),movementType:'INVENTORY_SCRAP',sourceType:'INVENTORY_SCRAP',sourceId:scrapId,sourceItemId:item.id,inventoryTransactionId:transactionId}).reduce((s,x)=>s-x.valueDeltaCents,0);
      voucherEntries.push({role:'INVENTORY_SCRAP_EXPENSE',direction:'DEBIT',amountCents:amount},{role:inventoryAccountRole(db,item.product_id),direction:'CREDIT',amountCents:amount});
    }
    createSystemVoucher(db,{sourceType:'INVENTORY_SCRAP',sourceId:scrapId,businessDate:header.scrap_date,actorId:actor.id,entries:voucherEntries});
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
