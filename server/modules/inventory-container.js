// V21 — Inventory Container / Packing (Wave D).
//
// Frozen by `solution.md §27.39`. Container holds membership only.
// NOT a second stock balance.

import { transaction, id as genId } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';

function nowIso() { return new Date().toISOString(); }

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_containers (
      id TEXT PRIMARY KEY,
      container_no TEXT NOT NULL UNIQUE,
      container_type TEXT NOT NULL,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','SEALED','DISPATCHED','DESTROYED')),
      parent_container_id TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      FOREIGN KEY (parent_container_id) REFERENCES inventory_containers(id)
    );
    CREATE TABLE IF NOT EXISTS inventory_container_items (
      id TEXT PRIMARY KEY,
      container_id TEXT NOT NULL REFERENCES inventory_containers(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      lot_id TEXT,
      serial_id TEXT,
      quantity REAL NOT NULL CHECK(quantity > 0),
      bin_id TEXT,
      position_key TEXT,
      FOREIGN KEY (lot_id) REFERENCES inventory_lots(id),
      FOREIGN KEY (serial_id) REFERENCES inventory_serials(id),
      UNIQUE(container_id, product_id, lot_id, serial_id, bin_id)
    );
  `);
}

export async function createContainer(db, req, res, actor) {
  allow(actor, 'INVENTORY_CONTAINER_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['containerNo','containerType','warehouseId','parentContainerId']);
  const id = genId();
  const now = nowIso();
  transaction(db, () => {
    ensureTable(db);
    db.prepare(`INSERT INTO inventory_containers(id, container_no, container_type, warehouse_id, status, parent_container_id, created_by, created_at) VALUES(?, ?, ?, ?, 'OPEN', ?, ?, ?)`).run(id, body.containerNo, body.containerType, body.warehouseId, body.parentContainerId || null, actor.id, now);
    audit(db, actor.id, 'CREATE', 'INVENTORY_CONTAINER', id, `Create container ${body.containerNo}`);
  });
  return send(res, 201, { id, status: 'OPEN' });
}

export function pack(db, res, actor, containerId, items) {
  allow(actor, 'INVENTORY_CONTAINER_MANAGE');
  const container = db.prepare(`SELECT * FROM inventory_containers WHERE id=?`).get(containerId);
  if (!container) throw new HttpError(404, '容器不存在');
  if (container.status !== 'OPEN') throw new HttpError(409, `容器状态 ${container.status} 不可 pack`);
  const now = nowIso();
  transaction(db, () => {
    ensureTable(db);
    for (const item of items) {
      db.prepare(`INSERT INTO inventory_container_items(id, container_id, product_id, lot_id, serial_id, quantity, bin_id, position_key) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`).run(
        genId(), containerId, item.productId, item.lotId || null, item.serialId || null,
        Number(item.quantity), item.binId || null, item.positionKey || null
      );
    }
    audit(db, actor.id, 'PACK', 'INVENTORY_CONTAINER', containerId, `Pack ${items.length} items`);
  });
  return send(res, 201, { ok: true });
}

export function inventoryOfContainer(db, res, actor, containerId) {
  allowAny(actor, ['INVENTORY_CONTAINER_VIEW', 'INVENTORY_CONTAINER_MANAGE']);
  ensureTable(db);
  const items = db.prepare(`SELECT * FROM inventory_container_items WHERE container_id=?`).all(containerId);
  return send(res, 200, { items });
}

export function transferContainer(db, res, actor, containerId, toWarehouseId) {
  allow(actor, 'INVENTORY_CONTAINER_MANAGE');
  const container = db.prepare(`SELECT * FROM inventory_containers WHERE id=?`).get(containerId);
  if (!container) throw new HttpError(404, '容器不存在');
  if (container.status !== 'OPEN') throw new HttpError(409, `容器状态 ${container.status} 不可 transfer`);
  const items = db.prepare(`SELECT * FROM inventory_container_items WHERE container_id=?`).all(containerId);
  transaction(db, () => {
    for (const item of items) {
      applyInventoryMutation({
        db,
        sourceType: 'INVENTORY_TRANSFER',
        sourceId: containerId,
        sourceItemId: item.id,
        businessDate: new Date().toISOString().slice(0, 10),
        actor,
        movementKind: 'MOVE',
        quantity: Number(item.quantity),
        fromPosition: {
          productId: item.product_id, warehouseId: container.warehouse_id,
          binId: item.bin_id, stockStatus: 'AVAILABLE',
        },
        toPosition: {
          productId: item.product_id, warehouseId: toWarehouseId,
          binId: null, stockStatus: 'AVAILABLE',
        },
        idempotencyKey: `CONTAINER_XFER:${containerId}:${item.id}`,
        remark: `Container transfer ${container.container_no}`,
      });
    }
    db.prepare(`UPDATE inventory_containers SET status='SEALED', warehouse_id=? WHERE id=?`).run(toWarehouseId, containerId);
    audit(db, actor.id, 'TRANSFER', 'INVENTORY_CONTAINER', containerId, `Transfer container to ${toWarehouseId}`);
  });
  return send(res, 200, { ok: true });
}