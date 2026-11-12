#!/usr/bin/env node

// Inventory & Warehouse Domain real MySQL concurrency worker.
//
// One process, one MySQL connection, one inventory action. The suite spawns two
// workers concurrently so that the race is a REAL race on a real server and
// not an interleaving of synchronous calls inside one event loop.
//
// The worker opens its MySQL connection BEFORE it waits for the release gate,
// so both workers hold a live server session when the race starts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { confirmInventoryTransferCommand } from '../../server/modules/inventory-transfer.js';
import { approveStocktake, submitStocktake } from '../../server/modules/inventory-stocktake.js';
import { confirmAssemblyOrder } from '../../server/modules/inventory-assembly-disassembly.js';
import { createInventoryLock } from '../../server/modules/inventory-lock.js';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function mockResponse() {
  const res = {
    statusCode: null, body: null,
    setHeader: () => {}, getHeader: () => null,
    write: () => {}, on: () => {}, once: () => {},
  };
  res.end = (chunk) => {
    if (chunk) { try { res.body = JSON.parse(chunk); } catch { res.body = null; } }
  };
  return res;
}

const ACTOR = {
  id: 'inventory-warehouse-race-actor',
  permissions: [
    'INVENTORY_VIEW', 'INVENTORY_CHECK_CREATE', 'INVENTORY_CHECK_APPROVE',
    'INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_CONFIRM', 'INVENTORY_TRANSFER_APPROVE',
    'INVENTORY_ASSEMBLY_VIEW', 'INVENTORY_ASSEMBLY_MANAGE',
    'INVENTORY_LOCK_VIEW', 'INVENTORY_LOCK_MANAGE',
  ],
};
const COUNTER_ACTOR = { ...ACTOR, id: 'inventory-warehouse-race-counter' };

async function mockRequest(body) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return {
    headers: { 'content-type': 'application/json' },
    [Symbol.asyncIterator]: async function* () { for (const chunk of chunks) yield chunk; },
  };
}

async function waitForGate(path, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error('INVENTORY_WAREHOUSE_RACE_GATE_TIMEOUT');
    await delay(10);
  }
}

const action = argument('--action');
const payload = JSON.parse(readFileSync(resolve(argument('--payload')), 'utf8'));
const config = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(config);

try {
  // The ready marker is written only after the MySQL session exists, so the
  // suite can release the gate while both workers hold a live server session.
  const ready = argument('--ready');
  if (ready) writeFileSync(resolve(ready), `${process.pid}\n`);
  const gate = argument('--gate');
  if (gate) await waitForGate(resolve(gate));
  let status = 200;
  let body = null;
  if (action === 'transfer-confirm') {
    const res = mockResponse();
    const result = confirmInventoryTransferCommand(db, payload.approverActorId ? { ...ACTOR, id: payload.approverActorId } : ACTOR, payload.transferId);
    status = res.statusCode ?? 200;
    body = { ...(res.body || {}), result: result || null };
  } else if (action === 'stocktake-approve') {
    const res = mockResponse();
    approveStocktake(db, res, payload.approverActorId ? { ...ACTOR, id: payload.approverActorId } : ACTOR, payload.checkId);
    status = res.statusCode ?? 200;
    body = res.body;
  } else if (action === 'stocktake-submit') {
    const res = mockResponse();
    submitStocktake(db, res, COUNTER_ACTOR, payload.checkId);
    status = res.statusCode ?? 200;
    body = res.body;
  } else if (action === 'inventory-lock') {
    const res = mockResponse();
    await createInventoryLock(db, mockRequest({
      productId: payload.productId, warehouseId: payload.warehouseId,
      positionKey: payload.positionKey, quantity: payload.quantity, reason: payload.reason || 'race',
    }), res, ACTOR);
    status = res.statusCode ?? 200;
    body = res.body;
  } else if (action === 'assembly-confirm') {
    const res = mockResponse();
    confirmAssemblyOrder(db, null, res, ACTOR, payload.orderId);
    status = res.statusCode ?? 200;
    body = res.body;
  } else {
    throw new Error(`unknown action ${action}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, status, body })}\n`);
  db.close();
} catch (error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = error?.code || error?.error?.code || null;
  process.stdout.write(`${JSON.stringify({ ok: false, status, code, message: String(error?.message || error) })}\n`);
  db.close();
}
