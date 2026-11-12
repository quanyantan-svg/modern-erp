#!/usr/bin/env node

// Manufacturing & Quality Domain real MySQL concurrency worker.
//
// One process, one MySQL connection, one manufacturing action. The suite spawns
// two workers concurrently so that the race is a REAL race on a real server
// and not an interleaving of synchronous calls inside one event loop.
//
// The worker opens its MySQL connection BEFORE it waits for the release gate,
// so both workers hold a live server session when the race starts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import {
  approveProductionOrderMaterialList, editProductionOrderMaterialList,
} from '../../server/modules/manufacturing-orders.js';
import { markOperationOutsourcedHandoff } from '../../server/modules/manufacturing-execution.js';
import { productionScanTransfer } from '../../server/modules/manufacturing-scan.js';

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

async function mockRequest(body) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return {
    headers: { 'content-type': 'application/json' },
    [Symbol.asyncIterator]: async function* () { for (const chunk of chunks) yield chunk; },
  };
}

const ACTOR = {
  id: 'manufacturing-quality-race-actor',
  permissions: [
    'PRODUCTION_ORDERS_CREATE', 'PRODUCTION_ORDERS_COMPLETE', 'PRODUCTION_ORDERS_START',
    'PRODUCTION_PLAN_MANAGE', 'PRODUCTION_SCAN_EXECUTE', 'PRODUCTION_INSPECTION_MANAGE',
    'PRODUCTION_INSPECTION_VIEW', 'PRODUCTION_BYPART_MANAGE', 'PRODUCTION_RECEIPT_MANAGE',
  ],
};

async function waitForGate(path, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error('MANUFACTURING_QUALITY_RACE_GATE_TIMEOUT');
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
  if (action === 'approve-material-list') {
    const res = mockResponse();
    approveProductionOrderMaterialList(db, res, ACTOR, payload.orderId);
    status = res.statusCode ?? 200;
    body = res.body;
  } else if (action === 'edit-material-list') {
    const res = mockResponse();
    await editProductionOrderMaterialList(db, await mockRequest({ lines: payload.lines }), res, ACTOR, payload.orderId);
    status = res.statusCode ?? 200;
    body = res.body;
  } else if (action === 'outsource-handoff') {
    const res = mockResponse();
    await markOperationOutsourcedHandoff(db, await mockRequest({ supplierId: payload.supplierId }), res, ACTOR, payload.operationId);
    status = res.statusCode ?? 200;
    body = res.body;
  } else if (action === 'scan-transfer') {
    const res = mockResponse();
    await productionScanTransfer(db, await mockRequest({
      orderToken: payload.orderToken,
      sourceOperationToken: payload.sourceOperationToken,
      targetOperationToken: payload.targetOperationToken,
      quantity: payload.quantity,
    }), res, ACTOR);
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
