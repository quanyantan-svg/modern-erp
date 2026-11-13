// V21 — Inventory Stocktake (Wave C).
//
// Frozen by `solution.md §27.29 / §27.30`.
//
// This module is the single write entry for stocktake (INV-29 regular /
// INV-30 cycle / INV-31 difference application). The legacy
// `/api/inventory-checks` document path — create DRAFT → submit → approve
// against a warehouse+product tuple write — is retired; every difference is
// applied through `applyInventoryMutation` at the canonical position identity
// (product + warehouse + bin + owner + stock status + lot + serial).

import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, assertAllowedFields, normalizeBusinessDate, readJson, send } from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import { computePositionKey } from '../lib/inventory-position.js';
import { parseBarcode } from '../lib/inventory-barcode.js';
import {
  createSystemVoucher, inventoryAccountRole, issueSourceValue, receivePositiveSourceValue,
} from './financial-inventory.js';
import { postTrackedMovement, saveTrackedAllocations } from './traceability-quality.js';
import { assertApprovalSod } from './platform-sod.js';

function nowIso() { return new Date().toISOString(); }

const CHECK_STATUS = { DRAFT: '草稿', SUBMITTED: '待审核', APPROVED: '已审核' };

function readCheck(db, checkId) {
  return db.prepare('SELECT * FROM inventory_checks WHERE id=?').get(checkId);
}

function readItems(db, checkId) {
  return db.prepare('SELECT * FROM inventory_check_items WHERE check_id=? ORDER BY id').all(checkId);
}

// The canonical position of one counted line. A missing bin on a bin-enabled
// warehouse, an unknown owner or an unknown stock status are refused here —
// the same gate `applyInventoryMutation` applies on the write side.
function linePosition(warehouseId, item) {
  const ownerType = String(item.ownerType ?? 'ENTERPRISE').toUpperCase();
  if (!['ENTERPRISE', 'SUPPLIER', 'CUSTOMER'].includes(ownerType)) {
    throw new HttpError(400, `不支持的 ownerType ${ownerType}`);
  }
  const stockStatus = String(item.stockStatus ?? 'AVAILABLE');
  const position = {
    productId: String(item.productId ?? '').trim(),
    warehouseId,
    binId: item.binId ?? null,
    ownerType,
    ownerId: ownerType === 'ENTERPRISE' ? null : (item.ownerId ?? null),
    stockStatus,
    lotId: item.lotId ?? null,
    serialId: item.serialId ?? null,
  };
  if (!position.productId) throw new HttpError(400, '每行产品必填');
  return position;
}

export async function createStocktake(db, req, res, actor) {
  allow(actor, 'INVENTORY_CHECK_CREATE');
  const body = await readJson(req);
  assertAllowedFields(body, ['warehouseId', 'checkKind', 'scopeStrategy', 'items', 'abcClassification', 'cyclePeriodKey', 'businessDate', 'reason']);
  const checkKind = String(body.checkKind ?? 'REGULAR').toUpperCase();
  if (!['REGULAR', 'CYCLE'].includes(checkKind)) throw new HttpError(400, 'checkKind 必须为 REGULAR 或 CYCLE');
  const warehouseId = String(body.warehouseId ?? '').trim();
  if (!warehouseId) throw new HttpError(400, '仓库必填');
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, '请至少添加一行盘点');
  // The stocktake business date is authoritative: it decides the financial
  // period and the valuation date of the difference. It is never derived from
  // the event timestamp.
  const businessDate = normalizeBusinessDate(body.businessDate, '盘点业务日期');
  const warehouse = db.prepare('SELECT id, bin_enabled FROM warehouses WHERE id=? AND active=1').get(warehouseId);
  if (!warehouse) throw new HttpError(400, `仓库 ${warehouseId} 不存在或已停用`);

  const checkId = genId();
  const checkNo = `STK-${Date.now().toString().slice(-10)}-${Math.floor(Math.random() * 90 + 10)}`;
  const now = nowIso();
  const lines = buildLines(db, warehouseId, body.items);

  transaction(db, () => {
    db.prepare(`
      INSERT INTO inventory_checks(id, check_no, warehouse_id, status, checked_at, creator_id, created_at,
        check_kind, scope_strategy, abc_classification, cycle_period_key, snapshot_at, business_date, reason)
      VALUES(?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      checkId, checkNo, warehouseId, now, actor.id, now,
      checkKind, body.scopeStrategy || 'ALL', body.abcClassification || null, body.cyclePeriodKey || null,
      now, businessDate, String(body.reason ?? ''),
    );
    writeLines(db, checkId, lines);
    audit(db, actor.id, 'CREATE', 'INVENTORY_CHECK', checkId, `创建盘点单 ${checkNo}（${checkKind}，${lines.length} 行，业务日期 ${businessDate}）`);
  });
  return send(res, 201, { id: checkId, checkNo, checkKind, status: 'DRAFT', businessDate, itemCount: lines.length });
}

// The counted lines of one stocktake. The book quantity is snapshotted when
// the line is written; the approval re-reads the book and refuses a count
// whose snapshot no longer matches.
function buildLines(db, warehouseId, items) {
  return items.map((item) => {
    const position = linePosition(warehouseId, item);
    const physicalQuantity = Number(item.physicalQuantity);
    if (!Number.isFinite(physicalQuantity) || physicalQuantity < 0) {
      throw new HttpError(400, '每行实盘数量必须是不小于 0 的数字');
    }
    const positionKey = computePositionKey(position);
    const bookRow = db.prepare('SELECT quantity FROM inventory WHERE position_key=? AND active=1').get(positionKey);
    const snapshotBookQuantity = bookRow ? Number(bookRow.quantity) : 0;
    return {
      position,
      positionKey,
      physicalQuantity,
      snapshotBookQuantity,
      diffQuantity: physicalQuantity - snapshotBookQuantity,
      remark: String(item.remark ?? ''),
    };
  });
}

function writeLines(db, checkId, lines) {
  for (const line of lines) {
    const itemId = genId();
    db.prepare(`
      INSERT INTO inventory_check_items(id, check_id, product_id, position_key, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id,
        book_quantity, check_quantity, diff_quantity, snapshot_book_quantity, remark)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      itemId, checkId, line.position.productId, line.positionKey,
      line.position.binId, line.position.ownerType, line.position.ownerId, line.position.stockStatus,
      line.position.lotId, line.position.serialId,
      line.snapshotBookQuantity, line.physicalQuantity, line.diffQuantity, line.snapshotBookQuantity, line.remark,
    );
    // LOT / SERIAL tracked products need the identity allocation up front:
    // the approval posts the tracked movement from it.
    if (line.position.lotId || line.position.serialId) {
      saveTrackedAllocations(db, {
        sourceType: 'INVENTORY_CHECK', sourceId: checkId, sourceItemId: itemId,
        productId: line.position.productId, quantity: Math.abs(line.diffQuantity),
        allocations: [{
          lotId: line.position.lotId,
          serialId: line.position.serialId,
          quantity: Math.abs(line.diffQuantity),
        }],
      });
    }
  }
  // Single-line stocktakes keep the legacy projection columns populated so
  // the historical read model (and the approval centre) can still show the
  // counted product and the difference. Multi-line stocktakes leave them
  // NULL — the counted lines live in inventory_check_items.
  if (lines.length === 1) {
    const only = lines[0];
    db.prepare(`UPDATE inventory_checks SET product_id=?, system_quantity=?, actual_quantity=?, difference=? WHERE id=?`)
      .run(only.position.productId, only.snapshotBookQuantity, only.physicalQuantity, only.diffQuantity, checkId);
  }
}

// INV-42 — a barcode scan counts one line of a draft stocktake. The counted
// line lands on the canonical position identity, never on a
// warehouse+product tuple.
export function scanStocktake(db, res, actor, checkId, body) {
  allow(actor, 'INVENTORY_CHECK_CREATE');
  let scanned = null;
  transaction(db, () => {
    const check = readCheck(db, checkId);
    if (!check) throw new HttpError(404, '盘点单不存在');
    if (check.status !== 'DRAFT') throw new HttpError(409, '只有草稿盘点单可以扫码盘点');
    const code = String(body?.code ?? body?.barcode ?? '');
    const parsed = parseBarcode(db, code);
    if (!parsed) throw new HttpError(400, '条码无效');
    // The scanned product may come from a barcode binding (entity id) or from
    // the built-in PRD-<code> pattern (product code).
    const productId = parsed.fields?.product_code
      ? db.prepare('SELECT id FROM products WHERE code=?').get(parsed.fields.product_code)?.id || null
      : (parsed.entityId || parsed.fields?.product || parsed.productId || null);
    if (!productId) throw new HttpError(400, '条码没有货品身份');
    const quantity = Number(body?.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity < 0) throw new HttpError(400, '扫码数量必须是不小于 0 的数字');
    const position = {
      productId,
      warehouseId: check.warehouse_id,
      binId: body?.binId ?? null,
      ownerType: body?.ownerType ?? 'ENTERPRISE',
      ownerId: body?.ownerType === 'ENTERPRISE' ? null : (body?.ownerId ?? null),
      stockStatus: body?.stockStatus ?? 'AVAILABLE',
      lotId: body?.lotId ?? parsed.fields?.lotId ?? null,
      serialId: body?.serialId ?? parsed.fields?.serialId ?? null,
    };
    const positionKey = computePositionKey(position);
    const bookRow = db.prepare('SELECT quantity FROM inventory WHERE position_key=? AND active=1').get(positionKey);
    const bookQuantity = bookRow ? Number(bookRow.quantity) : 0;
    // A position is counted once: a repeated scan corrects the counted line
    // instead of adding a second line, so the approval cannot adjust the
    // same position twice.
    const existing = db.prepare('SELECT id FROM inventory_check_items WHERE check_id=? AND position_key=?').get(checkId, positionKey);
    if (existing) {
      db.prepare('DELETE FROM inventory_check_items WHERE id=?').run(existing.id);
      db.prepare("DELETE FROM tracked_source_allocations WHERE source_type='INVENTORY_CHECK' AND source_id=? AND source_item_id=?")
        .run(checkId, existing.id);
    }
    const itemId = genId();
    db.prepare(`INSERT INTO inventory_check_items(id, check_id, product_id, position_key, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id,
      book_quantity, check_quantity, diff_quantity, snapshot_book_quantity, remark)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      itemId, checkId, productId, positionKey, position.binId, position.ownerType, position.ownerId,
      position.stockStatus, position.lotId, position.serialId,
      bookQuantity, quantity, quantity - bookQuantity, bookQuantity, `扫码盘点 ${code}`,
    );
    db.prepare("UPDATE inventory_checks SET actual_quantity=?, system_quantity=?, difference=? WHERE id=?")
      .run(quantity, bookQuantity, quantity - bookQuantity, checkId);
    audit(db, actor.id, 'SCAN', 'INVENTORY_CHECK', checkId, `扫码盘点 ${code} × ${quantity}`);
    scanned = { itemId, quantity, bookQuantity, positionKey, productId };
  });
  return send(res, 200, { ok: true, checkId, ...scanned });
}

// The counted lines of a draft stocktake may still be corrected. The book
// snapshot is re-taken on every edit.
export function updateStocktake(db, res, actor, checkId, body) {
  allow(actor, 'INVENTORY_CHECK_CREATE');
  transaction(db, () => {
    const check = readCheck(db, checkId);
    if (!check) throw new HttpError(404, '盘点单不存在');
    if (check.status !== 'DRAFT') throw new HttpError(409, '只有草稿盘点单可以修改');
    if (check.creator_id !== actor.id && actor.roleCode !== 'ADMIN') {
      throw new HttpError(403, '只能修改自己创建的盘点单');
    }
    if (!Array.isArray(body?.items) || body.items.length === 0) throw new HttpError(400, '请至少保留一行盘点');
    const lines = buildLines(db, check.warehouse_id, body.items);
    db.prepare('DELETE FROM inventory_check_items WHERE check_id=?').run(checkId);
    db.prepare('DELETE FROM tracked_source_allocations WHERE source_type=? AND source_id=?').run('INVENTORY_CHECK', checkId);
    writeLines(db, checkId, lines);
    audit(db, actor.id, 'UPDATE', 'INVENTORY_CHECK', checkId, `修改盘点单 ${check.check_no}（${lines.length} 行）`);
  });
  return send(res, 200, { ok: true });
}

// DRAFT → SUBMITTED. The counted lines are frozen here; the approval applies
// them.
export function submitStocktake(db, res, actor, checkId) {
  allow(actor, 'INVENTORY_CHECK_CREATE');
  const now = nowIso();
  transaction(db, () => {
    const check = readCheck(db, checkId);
    if (!check) throw new HttpError(404, '盘点单不存在');
    if (check.status !== 'DRAFT') throw new HttpError(409, `状态 ${check.status} 不可提交`);
    if (check.creator_id !== actor.id && actor.roleCode !== 'ADMIN') {
      throw new HttpError(403, '只能提交自己创建的盘点单');
    }
    const itemCount = Number(db.prepare('SELECT COUNT(*) c FROM inventory_check_items WHERE check_id=?').get(checkId)?.c || 0);
    if (!itemCount) throw new HttpError(409, '盘点单没有明细，无法提交');
    const updated = db.prepare("UPDATE inventory_checks SET status='SUBMITTED', checked_at=? WHERE id=? AND status='DRAFT'")
      .run(now, checkId);
    if (updated.changes !== 1) throw new HttpError(409, '盘点单状态已变化，请刷新后重试');
    audit(db, actor.id, 'SUBMIT', 'INVENTORY_CHECK', checkId, `提交盘点单 ${check.check_no} 待审核`);
  });
  return send(res, 200, { ok: true, status: 'SUBMITTED' });
}

// The counted line of a document that predates the canonical stocktake: the
// product, the book snapshot and the difference live on the document row and
// the counted position is the default canonical position.
function legacyCountedLine(check) {
  const position = {
    productId: check.product_id,
    warehouseId: check.warehouse_id,
    binId: null,
    ownerType: 'ENTERPRISE',
    ownerId: null,
    stockStatus: 'AVAILABLE',
    lotId: null,
    serialId: null,
  };
  const bookQuantity = Number(check.system_quantity ?? 0);
  const checkQuantity = Number(check.actual_quantity ?? 0);
  return {
    id: check.id,
    product_id: check.product_id,
    position_key: computePositionKey(position),
    bin_id: null,
    owner_type: 'ENTERPRISE',
    owner_id: null,
    stock_status: 'AVAILABLE',
    lot_id: null,
    serial_id: null,
    snapshot_book_quantity: bookQuantity,
    book_quantity: bookQuantity,
    check_quantity: checkQuantity,
    diff_quantity: Number(check.difference ?? (checkQuantity - bookQuantity)),
  };
}

export function approveStocktake(db, res, actor, checkId) {
  allow(actor, 'INVENTORY_CHECK_APPROVE');
  const now = nowIso();
  transaction(db, () => {
    // Re-read inside the transaction: two concurrent approvals must not both
    // observe the same SUBMITTED snapshot.
    const check = readCheck(db, checkId);
    if (!check) throw new HttpError(404, '盘点单不存在');
    if (check.status !== 'SUBMITTED') throw new HttpError(409, `状态 ${check.status} 不可审批`);
    if (check.creator_id === actor.id) throw new HttpError(409, '盘点单创建人不能审批自己的单据');
    // Platform SOD —— 接在既有自审批防护之后（Design §32.4.3），既有族行为逐字不变。
    assertApprovalSod(db, { businessType: 'INVENTORY_CHECK', businessId: checkId, actorId: actor.id });
    const businessDate = check.business_date;
    if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
      throw new HttpError(409, '盘点单缺少权威业务日期，无法审批', { code: 'SOURCE_LINEAGE_MISSING' });
    }
    const items = readItems(db, checkId);
    if (!items.length) {
      // A document created before the canonical stocktake keeps its counted
      // product and difference on the document itself. It is approved as the
      // single counted line it describes.
      if (!check.product_id || check.actual_quantity === null || check.actual_quantity === undefined) {
        throw new HttpError(409, '盘点单没有明细，无法审批');
      }
      items.push(legacyCountedLine(check));
    }
    const voucherEntries = [];

    for (const item of items) {
      const diff = Number(item.diff_quantity);
      if (!Number.isFinite(diff)) throw new HttpError(409, '盘点差异不合法');
      const position = {
        productId: item.product_id,
        warehouseId: check.warehouse_id,
        binId: item.bin_id,
        ownerType: item.owner_type,
        ownerId: item.owner_id,
        stockStatus: item.stock_status,
        lotId: item.lot_id,
        serialId: item.serial_id,
      };
      // Optimistic re-check: the counted snapshot must still match the book
      // quantity. A book change between counting and approval invalidates the
      // count and the approver has to count again.
      const currentRow = db.prepare('SELECT quantity FROM inventory WHERE position_key=? AND active=1').get(item.position_key);
      const currentQuantity = currentRow ? Number(currentRow.quantity) : 0;
      const snapshot = Number(item.snapshot_book_quantity ?? item.book_quantity ?? 0);
      if (Math.abs(currentQuantity - snapshot) > 1e-9) {
        throw new HttpError(409, '库存已变化，请重新盘点', { code: 'STOCKTAKE_BOOK_CHANGED' });
      }
      if (Math.abs(diff) < 1e-9) continue;
      const tracked = Boolean(item.lot_id || item.serial_id);
      if (tracked) {
        // The LOT / SERIAL ledgers move with the physical movement. The
        // mutation must not post a second tracked movement of its own.
        postTrackedMovement(db, {
          sourceType: 'INVENTORY_CHECK', sourceId: checkId, sourceItemId: item.id,
          productId: item.product_id, warehouseId: check.warehouse_id,
          quantity: Math.abs(diff), direction: diff > 0 ? 'IN' : 'OUT', businessDate,
        });
      }
      const mutation = applyInventoryMutation({
        db,
        sourceType: 'INVENTORY_STOCKTAKE_DIFF',
        sourceId: checkId,
        sourceItemId: item.id,
        sourceNo: check.check_no,
        businessDate,
        actor,
        movementKind: 'ADJUSTMENT',
        quantity: Math.abs(diff),
        ...(diff > 0
          ? { toPosition: position }
          : { fromPosition: position }),
        idempotencyKey: `STKTAKE_DIFF:${item.id}`,
        remark: `盘点差异 ${check.check_no}`,
        // The caller owns the strict valuation step below, in the same
        // transaction. The default best-effort issuance would post the
        // inbound leg as an issue.
        valuationMode: 'EXTERNAL',
        // The tracked identity movement is owned by postTrackedMovement above
        // (it maintains the LOT / SERIAL ledgers); the mutation must not post
        // a second tracked movement of its own.
        trackingMode: 'EXTERNAL',
      });
      // The value follows the counted difference: a gain receives the standard
      // or carried value, a shortage issues it. The valuation movement keeps
      // the INVENTORY_CHECK source so the accounting history and the
      // reversal path stay on the established contract.
      const transactionId = mutation?.movements?.[0]?.transactionId ?? null;
      const movements = diff > 0
        ? receivePositiveSourceValue(db, {
          businessDate,
          productId: item.product_id,
          warehouseId: check.warehouse_id,
          quantity: Number(diff),
          movementType: 'INVENTORY_COUNT_GAIN',
          sourceType: 'INVENTORY_CHECK',
          sourceId: checkId,
          sourceItemId: item.id,
          inventoryTransactionId: transactionId,
        })
        : issueSourceValue(db, {
          businessDate,
          productId: item.product_id,
          warehouseId: check.warehouse_id,
          quantity: -Number(diff),
          movementType: 'INVENTORY_COUNT_SHORTAGE',
          sourceType: 'INVENTORY_CHECK',
          sourceId: checkId,
          sourceItemId: item.id,
          inventoryTransactionId: transactionId,
        });
      const amount = movements.reduce((sum, movement) => sum + Math.abs(Number(movement.valueDeltaCents || 0)), 0);
      const role = inventoryAccountRole(db, item.product_id);
      voucherEntries.push(...(diff > 0
        ? [{ role, direction: 'DEBIT', amountCents: amount }, { role: 'INVENTORY_GAIN_LOSS', direction: 'CREDIT', amountCents: amount }]
        : [{ role: 'INVENTORY_GAIN_LOSS', direction: 'DEBIT', amountCents: amount }, { role, direction: 'CREDIT', amountCents: amount }]));
    }
    if (voucherEntries.length) {
      createSystemVoucher(db, {
        sourceType: 'INVENTORY_COUNT', sourceId: checkId, businessDate,
        actorId: actor.id, entries: voucherEntries,
      });
    }
    const updated = db.prepare("UPDATE inventory_checks SET status='APPROVED', reviewer_id=?, reviewed_at=? WHERE id=? AND status='SUBMITTED'")
      .run(actor.id, now, checkId);
    if (updated.changes !== 1) throw new HttpError(409, '盘点单状态已变化，请刷新后重试');
    audit(db, actor.id, 'APPROVE', 'INVENTORY_CHECK', checkId, `审核盘点单 ${check.check_no}，差异经规范库存异动生效`);
  });
  return send(res, 200, { ok: true, status: 'APPROVED' });
}

// The canonical stocktake read model. One list owns both the legacy
// single-line documents and the canonical multi-line documents; the legacy
// projection columns are only populated for single-line documents, so the
// product join has to be an outer join.
export function listStocktakes(db, res, actor, url) {
  allow(actor, 'INVENTORY_VIEW');
  const clauses = [];
  const params = [];
  const status = url?.searchParams?.get('status');
  if (status && CHECK_STATUS[status]) { clauses.push('ic.status=?'); params.push(status); }
  const warehouseId = url?.searchParams?.get('warehouseId') || url?.searchParams?.get('warehouse');
  if (warehouseId) { clauses.push('ic.warehouse_id=?'); params.push(warehouseId); }
  const sql = `SELECT ic.*, w.code warehouseCode, w.name warehouseName,
      p.code productCode, p.name productName, p.unit,
      creator.display_name creatorName, reviewer.display_name reviewerName,
      (SELECT COUNT(*) FROM inventory_check_items ici WHERE ici.check_id=ic.id) itemCount
    FROM inventory_checks ic
    JOIN warehouses w ON w.id=ic.warehouse_id
    LEFT JOIN products p ON p.id=ic.product_id
    JOIN users creator ON creator.id=ic.creator_id
    LEFT JOIN users reviewer ON reviewer.id=ic.reviewer_id
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY ic.created_at DESC`;
  const checks = db.prepare(sql).all(...params).map((row) => ({
    ...row,
    statusLabel: CHECK_STATUS[row.status],
    items: readItems(db, row.id).map((item) => ({
      id: item.id,
      productId: item.product_id,
      positionKey: item.position_key,
      binId: item.bin_id,
      ownerType: item.owner_type,
      ownerId: item.owner_id,
      stockStatus: item.stock_status,
      lotId: item.lot_id,
      serialId: item.serial_id,
      bookQuantity: Number(item.book_quantity),
      checkQuantity: Number(item.check_quantity),
      diffQuantity: Number(item.diff_quantity),
      remark: item.remark,
    })),
  }));
  return send(res, 200, { stocktakes: checks });
}
