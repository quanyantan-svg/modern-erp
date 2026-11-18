// V21 — Inventory Initialization / Opening (Wave C).
//
// Frozen by `solution.md §27.24 / §27.25`.

import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import { computePositionKey } from '../lib/inventory-position.js';
import { createSystemVoucher, inventoryAccountRole, receiveValue } from './financial-inventory.js';

function nowIso() { return new Date().toISOString(); }

// 期初行成本单价：安全整数分、必须为正。
// 没有可证明的成本不得凭空估价（Requirement §33.3），因此 0 / 缺省一律拒绝。
function unitCostCents(value, label) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new HttpError(400, `${label}必须是大于0的整数分`);
  return cents;
}

export function getOrCreateInitialization(db) {
  let row = db.prepare(`SELECT * FROM inventory_initialization LIMIT 1`).get();
  if (row) return row;
  const id = genId();
  db.prepare(`INSERT INTO inventory_initialization(id, status, notes) VALUES(?, 'NOT_STARTED', '')`).run(id);
  return db.prepare(`SELECT * FROM inventory_initialization WHERE id=?`).get(id);
}

export function openInitialization(db, actor) {
  const init = getOrCreateInitialization(db);
  if (init.status !== 'NOT_STARTED') throw new HttpError(409, `初始化状态为 ${init.status}`);
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`UPDATE inventory_initialization SET status='OPEN', opened_by=?, opened_at=?, enabled_at=? WHERE id=?`).run(actor.id, now, now, init.id);
    db.prepare(`UPDATE inventory_parameters SET enabled_at=?, updated_by=?, updated_at=? WHERE id='DEFAULT'`).run(now, actor.id, now);
    audit(db, actor.id, 'OPEN', 'INVENTORY_INITIALIZATION', init.id, 'Open inventory initialization');
  });
  return db.prepare(`SELECT * FROM inventory_initialization WHERE id=?`).get(init.id);
}

export function closeInitialization(db, actor) {
  const init = getOrCreateInitialization(db);
  if (init.status !== 'OPEN') throw new HttpError(409, `初始化状态为 ${init.status}`);
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`UPDATE inventory_initialization SET status='CLOSED', closed_by=?, closed_at=? WHERE id=?`).run(actor.id, now, init.id);
    audit(db, actor.id, 'CLOSE', 'INVENTORY_INITIALIZATION', init.id, 'Close inventory initialization');
  });
  return db.prepare(`SELECT * FROM inventory_initialization WHERE id=?`).get(init.id);
}

export function reopenInitialization(db, actor, reason) {
  const init = getOrCreateInitialization(db);
  if (init.status !== 'CLOSED') throw new HttpError(409, `初始化状态为 ${init.status}`);
  if (!reason || String(reason).trim() === '') throw new HttpError(400, '重开原因必填');
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`UPDATE inventory_initialization SET status='OPEN', closed_by=NULL, closed_at=NULL, reopen_count=reopen_count+1 WHERE id=?`).run(init.id);
    audit(db, actor.id, 'REOPEN', 'INVENTORY_INITIALIZATION', init.id, `Reopen: ${reason}`);
  });
  return db.prepare(`SELECT * FROM inventory_initialization WHERE id=?`).get(init.id);
}

export async function createOpeningDocument(db, req, res, actor) {
  allow(actor, 'INVENTORY_OPENING_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['businessDate','items','notes']);
  const init = getOrCreateInitialization(db);
  if (init.status !== 'OPEN') throw new HttpError(409, `初始化状态 ${init.status}，不可录入期初`);
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, '请至少添加一行期初');
  const docId = genId();
  const docNo = `OPEN-${Date.now().toString().slice(-10)}-${Math.floor(Math.random()*90+10)}`;
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO opening_inventory_documents(id, doc_no, initialization_id, business_date, status, creator_id, created_at, notes)
      VALUES(?, ?, ?, ?, 'DRAFT', ?, ?, ?)
    `).run(docId, docNo, init.id, body.businessDate || now.slice(0, 10), actor.id, now, body.notes || '');
    let lineNo = 1;
    for (const item of body.items) {
      const productId = String(item.productId ?? '').trim();
      const warehouseId = String(item.warehouseId ?? '').trim();
      const quantity = Number(item.quantity);
      if (!productId || !warehouseId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new HttpError(400, `第${lineNo}行产品 / 仓库 / 数量无效`);
      }
      // 期初必须计价（F-02）：期初行带成本单价，否则确认后永远停在未估值状态。
      const cost = unitCostCents(item.unitCostCents, `第${lineNo}行成本单价`);
      assertOpeningIdentity(db, item, productId, lineNo);
      const pk = computePositionKey({
        productId,
        warehouseId,
        binId: item.binId ?? null,
        ownerType: item.ownerType ?? 'ENTERPRISE',
        ownerId: item.ownerType === 'ENTERPRISE' ? null : (item.ownerId ?? null),
        stockStatus: item.stockStatus ?? 'AVAILABLE',
        lotId: item.lotId ?? null,
        serialId: item.serialId ?? null,
      });
      db.prepare(`
        INSERT INTO opening_inventory_items(id, document_id, product_id, warehouse_id, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, quantity, position_key, unit_cost_cents)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(genId(), docId, productId, warehouseId, item.binId ?? null, item.ownerType ?? 'ENTERPRISE', item.ownerType === 'ENTERPRISE' ? null : (item.ownerId ?? null), item.stockStatus ?? 'AVAILABLE', item.lotId ?? null, item.serialId ?? null, quantity, pk, cost);
    }
    audit(db, actor.id, 'CREATE', 'OPENING_INVENTORY', docId, `Create opening ${docNo}`);
  });
  return send(res, 201, { id: docId, docNo, status: 'DRAFT' });
}

// 期初身份：跟踪物料必须带**已存在**的批次 / 序列号且属于该货品；
// 非跟踪物料不得携带身份（Requirement §32.14 `IW-TRACE-04/06`）。
function assertOpeningIdentity(db, item, productId, lineNo) {
  const policy = String(db.prepare('SELECT tracking_policy FROM products WHERE id=?').get(productId)?.tracking_policy || 'NONE').toUpperCase();
  const lotId = item.lotId ?? null;
  const serialId = item.serialId ?? null;
  if (policy === 'LOT') {
    if (!lotId || serialId) throw new HttpError(400, `第${lineNo}行批次物料必须提供批次身份`);
    const lot = db.prepare('SELECT product_id FROM inventory_lots WHERE id=?').get(lotId);
    if (!lot || lot.product_id !== productId) throw new HttpError(400, `第${lineNo}行批次不存在或不属于该货品`);
  } else if (policy === 'SERIAL') {
    if (!serialId || lotId) throw new HttpError(400, `第${lineNo}行序列号物料必须提供序列号身份`);
    const serial = db.prepare('SELECT product_id FROM inventory_serials WHERE id=?').get(serialId);
    if (!serial || serial.product_id !== productId) throw new HttpError(400, `第${lineNo}行序列号不存在或不属于该货品`);
    if (Number(item.quantity) !== 1) throw new HttpError(400, `第${lineNo}行序列号物料每次只能期初 1 件`);
  } else if (lotId || serialId) {
    throw new HttpError(400, `第${lineNo}行非跟踪货品不得携带批次 / 序列号身份`);
  }
}

export function confirmOpeningDocument(db, res, actor, docId) {
  allow(actor, 'INVENTORY_OPENING_MANAGE');
  const init = getOrCreateInitialization(db);
  if (init.status !== 'OPEN') throw new HttpError(409, `初始化状态 ${init.status}，不可确认期初`);
  const doc = db.prepare(`SELECT * FROM opening_inventory_documents WHERE id=?`).get(docId);
  if (!doc) throw new HttpError(404, '期初单据不存在');
  if (doc.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
  const items = db.prepare(`SELECT * FROM opening_inventory_items WHERE document_id=?`).all(docId);
  const now = nowIso();
  transaction(db, () => {
    const voucherEntries = [];
    let totalValueCents = 0;
    for (const item of items) {
      const cost = Number(item.unit_cost_cents || 0);
      if (!Number.isSafeInteger(cost) || cost <= 0) throw new HttpError(409, `期初行缺少成本单价，不能确认期初`);
      const mutation = applyInventoryMutation({
        db,
        sourceType: 'OPENING_INVENTORY',
        sourceId: docId,
        sourceItemId: item.id,
        sourceNo: doc.doc_no,
        businessDate: doc.business_date,
        actor: { id: actor.id },
        movementKind: 'IN',
        quantity: Number(item.quantity),
        toPosition: {
          productId: item.product_id,
          warehouseId: item.warehouse_id,
          binId: item.bin_id,
          ownerType: item.owner_type,
          ownerId: item.owner_id,
          stockStatus: item.stock_status,
          lotId: item.lot_id,
          serialId: item.serial_id,
        },
        idempotencyKey: `OPENING:${item.id}`,
        remark: `Opening ${doc.doc_no}`,
        // 估值由本模块显式写（F-02）：不进入 canonical 写入器的 best-effort 估值分支。
        valuationMode: 'EXTERNAL',
      });
      const valueCents = Math.round(cost * Number(item.quantity));
      if (!Number.isSafeInteger(valueCents) || valueCents <= 0) throw new HttpError(409, '期初金额溢出安全整数分');
      const inbound = mutation.movements.find((movement) => movement.direction === 'IN');
      // 权威估值流水：带身份的期初同时建立身份级估值池，委外发料等下游因此可证明成本。
      receiveValue(db, {
        businessDate: doc.business_date,
        productId: item.product_id,
        warehouseId: item.warehouse_id,
        lotId: item.lot_id,
        serialId: item.serial_id,
        quantity: Number(item.quantity),
        valueCents,
        movementType: 'OPENING_INVENTORY',
        sourceType: 'OPENING_INVENTORY',
        sourceId: docId,
        sourceItemId: item.id,
        inventoryTransactionId: inbound?.transactionId || null,
        valuationBasis: 'OPENING_COST',
      });
      voucherEntries.push({ role: inventoryAccountRole(db, item.product_id), direction: 'DEBIT', amountCents: valueCents, summary: `期初存货 ${doc.doc_no}` });
      totalValueCents += valueCents;
    }
    if (!Number.isSafeInteger(totalValueCents)) throw new HttpError(409, '期初金额溢出安全整数分');
    // 期初存货价值的总账对方：期初权益。存货子账与总账因此同步（INVENTORY_VALUE_TO_GL）。
    voucherEntries.push({ role: 'OPENING_EQUITY', direction: 'CREDIT', amountCents: totalValueCents, summary: `期初权益 ${doc.doc_no}` });
    createSystemVoucher(db, {
      sourceType: 'OPENING_INVENTORY', sourceId: docId, businessDate: doc.business_date,
      actorId: actor.id, entries: voucherEntries, remark: `期初库存 ${doc.doc_no}`,
    });
    db.prepare(`UPDATE opening_inventory_documents SET status='CONFIRMED', confirmed_by=?, confirmed_at=? WHERE id=?`).run(actor.id, now, docId);
    audit(db, actor.id, 'CONFIRM', 'OPENING_INVENTORY', docId, `Confirm opening ${doc.doc_no}`);
  });
  return send(res, 200, { ok: true, status: 'CONFIRMED' });
}

// The canonical read model of the opening inventory documents.
export function listOpeningDocuments(db, res, actor, url) {
  allowAny(actor, ['INVENTORY_OPENING_VIEW', 'INVENTORY_OPENING_MANAGE']);
  const clauses = [];
  const params = [];
  const status = url?.searchParams?.get('status');
  if (status) { clauses.push('od.status=?'); params.push(String(status).toUpperCase()); }
  const rows = db.prepare(`
    SELECT od.*, creator.display_name creatorName, confirmer.display_name confirmedByName
    FROM opening_inventory_documents od
    LEFT JOIN users creator ON creator.id=od.creator_id
    LEFT JOIN users confirmer ON confirmer.id=od.confirmed_by
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY od.created_at DESC LIMIT 200`).all(...params);
  const documents = rows.map((row) => ({
    id: row.id,
    docNo: row.doc_no,
    status: row.status,
    businessDate: row.business_date,
    notes: row.notes,
    creatorName: row.creatorName,
    confirmedByName: row.confirmedByName,
    createdAt: row.created_at,
    items: db.prepare(`SELECT oi.*, p.code productCode, p.name productName, p.unit
      FROM opening_inventory_items oi LEFT JOIN products p ON p.id=oi.product_id
      WHERE oi.document_id=? ORDER BY oi.id`).all(row.id)
      .map((item) => ({
        id: item.id, productId: item.product_id, productCode: item.productCode,
        productName: item.productName, unit: item.unit, warehouseId: item.warehouse_id,
        binId: item.bin_id, ownerType: item.owner_type, ownerId: item.owner_id,
        stockStatus: item.stock_status, lotId: item.lot_id, serialId: item.serial_id,
        quantity: Number(item.quantity),
        unitCostCents: Number(item.unit_cost_cents || 0),
        valueCents: Math.round(Number(item.unit_cost_cents || 0) * Number(item.quantity || 0)),
      })),
  }));
  return send(res, 200, { openingDocuments: documents });
}
