// Real-MySQL G07 executor: leased child only, against an already bootstrapped schema.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createDatabase as createSqliteDatabase } from './db.js';
import { captureSqliteSnapshot } from './database/mysql-schema.js';
import {
  assertCompleteG07Contract, assertG03EvidenceLayering, assertProcessingPoItemStable,
  assertSafeIntegerCents, assertUat14VmiReceiptOracle, M1_CORE_G07_SCENARIOS,
} from './test-support/m1-core-g07-contract.js';
import { assertFixedFixtureManifest } from './test-support/m1-core-g07-fixtures.js';
import { assertM1CoreInformationSchemaParity } from './test-utils/m1-core-schema-parity.js';
import { openM1CoreG07ExistingAdapter } from './test-utils/m1-core-g07-existing-adapter.js';
import { runG07GateRace } from './test-utils/m1-core-g07-lock-wait.js';
import { assertRealG07Oracle } from './test-utils/m1-core-g07-oracle.js';
import { consumePortableChildLease } from '../scripts/gates/ack4/ack4-runtime.mjs';

function requiredEnvironment(name) { const value = String(process.env[name] || '').trim(); if (!value) throw new Error(`M1_G07_BLOCKED:${name}_REQUIRED`); return value; }
function canonical(value) { if (typeof value === 'bigint') return value.toString(); if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); return value; }

function validateFixtureManifest(manifest) {
  if (manifest?.version !== 1 || manifest?.provenance !== 'PRODUCTION_HTTP') throw new Error('M1_G07_FIXTURE_PROVENANCE_INVALID');
  if (!manifest.fixtureDigest || !/^[0-9a-f]{64}$/.test(manifest.fixtureDigest)) throw new Error('M1_G07_FIXTURE_DIGEST_INVALID');
  if (!Array.isArray(manifest.setupTrace) || manifest.setupTrace.some((entry) => entry.method === 'TECHNICAL_L2'
    ? entry.status !== 'ADMITTED' || !entry.prerequisite
    : !entry.path?.startsWith('/api/') || entry.status < 200 || entry.status >= 300 || entry.dtoVerified !== true || entry.sourceIdsVerified !== true)) throw new Error('M1_G07_FIXTURE_SETUP_TRACE_INVALID');
  for (const definition of M1_CORE_G07_SCENARIOS) {
    const fixture = manifest.scenarios?.[definition.id];
    if (!fixture || !Array.isArray(fixture.requests) || fixture.requests.length !== 2) throw new Error(`${definition.id}_FIXTURE_MISSING`);
    if (!fixture.requests.every((request) => request.path?.startsWith('/api/') && !/[:{}]/.test(request.path) && ['A', 'B'].includes(request.application) && request.subject)) throw new Error(`${definition.id}_REQUEST_INVALID`);
    if (!Array.isArray(fixture.businessObjectProvenance) || fixture.businessObjectProvenance.length === 0 || fixture.businessObjectProvenance.some((entry) => entry.channel !== 'PRODUCTION_HTTP')) throw new Error(`${definition.id}_BUSINESS_OBJECT_PROVENANCE_INVALID`);
  }
  return manifest;
}

async function httpRequest(baseUrl, request, signal = undefined) {
  const response = await fetch(baseUrl + request.path, { method: request.method, headers: { authorization: `Bearer ${request.token}`, ...(request.body === undefined ? {} : { 'content-type': 'application/json' }), ...request.headers }, body: request.body === undefined ? undefined : JSON.stringify(request.body), signal });
  let data;
  try { data = await response.json(); } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error;
    data = {};
  }
  return { status: response.status, data };
}
function primaryKeyColumns(db, table) { return db.prepare("SELECT COLUMN_NAME column_name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION").all(table).map((row) => row.column_name); }
function quoteIdentifier(value) { if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error(`M1_G07_UNSAFE_IDENTIFIER:${value}`); return `\`${value}\``; }
function fullSnapshot(db, tables) { return Object.fromEntries(tables.map((table) => { const order = primaryKeyColumns(db, table); if (!order.length) throw new Error(`M1_G07_SNAPSHOT_PRIMARY_KEY_REQUIRED:${table}`); return [table, canonical(db.prepare(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY ${order.map(quoteIdentifier).join(',')}`).all())]; })); }

async function executeRace(db, manifest, definition) {
  const fixture = manifest.scenarios[definition.id]; const before = fullSnapshot(db, definition.snapshotTables);
  const { responses } = await runG07GateRace({
    db, label: definition.id,
    requestA: (signal) => httpRequest(manifest.applications.A, fixture.requests[0], signal),
    requestB: (signal) => httpRequest(manifest.applications.B, fixture.requests[1], signal),
  });
  const after = fullSnapshot(db, definition.snapshotTables);
  assertRealG07Oracle(definition, { before, after, fixture, responses });
}

describe('M1C-G07 production HTTP / real MySQL handler concurrency', () => {
  let db; let manifest;
  before(() => {
    const target = JSON.parse(readFileSync(requiredEnvironment('ERP_M1_G07_TARGET_PROOF'), 'utf8')); const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
    consumePortableChildLease({ leasePath: requiredEnvironment('ERP_M1_G07_ACK4_CHILD_LEASE'), consumedDir: resolve(requiredEnvironment('ERP_M1_G07_ACK4_CHILD_CONSUMED_DIR')), rootPublicKey: requiredEnvironment('ERP_M1_G07_ACK4_ROOT_PUBLIC_KEY'), expected: { rootPid: process.ppid, childPid: process.pid, childStartedAt: requiredEnvironment('ERP_M1_G07_CHILD_STARTED_AT'), commitSha, target, manifest: 'M1_CORE_G07_V1', operation: 'RUN_M1_HTTP_FIXTURES' } });
    delete process.env.ERP_M1_G07_ACK4_ROOT_PUBLIC_KEY;
    if (process.env.ERP_DB_BACKEND !== 'mysql' || process.env.ERP_TEST_DB_BACKEND !== 'mysql') throw new Error('M1_G07_BLOCKED:MYSQL_BACKEND_REQUIRED');
    assertCompleteG07Contract(); assertFixedFixtureManifest(); manifest = validateFixtureManifest(JSON.parse(readFileSync(requiredEnvironment('ERP_M1_G07_FIXTURE_MANIFEST'), 'utf8')));
    db = openM1CoreG07ExistingAdapter({ targetProofPath: requiredEnvironment('ERP_M1_G07_TARGET_PROOF') }).db; assert.equal(db.dialect, 'mysql');
  });
  after(() => db?.close());
  test('real information_schema matches canonical SQLite schema', () => { const snapshot = captureSqliteSnapshot((path) => createSqliteDatabase(path), false); assert.equal(assertM1CoreInformationSchemaParity(db, snapshot).source, 'information_schema'); });
  for (const definition of M1_CORE_G07_SCENARIOS) test(`${definition.id} ${definition.handler}: authoritative full-snapshot oracle`, async () => executeRace(db, manifest, definition));
  test('real supplemental Oracles: stable PO item, injection, PO Change, UAT-14, G03 L1/L2 and safe integer', async () => {
    const adminToken = manifest.scenarios['CR-01'].requests[0].token;
    const setup = manifest.scenarios['CR-09'].setup;
    const order = db.prepare("SELECT * FROM purchase_orders WHERE source_outsourcing_order_id=? AND business_type='OUTSOURCE_PROCESSING'").get(setup.order.id);
    assert.ok(order?.id, 'CR-09 processing PO must exist');
    const beforeIds = db.prepare('SELECT id FROM purchase_order_items WHERE order_id=? ORDER BY id').all(order.id).map((row) => row.id);
    const update = await httpRequest(manifest.applications.A, { token: adminToken, method: 'PUT', path: `/api/purchase-orders/${order.id}`, body: {
      supplierId: order.supplier_id, orderDate: order.order_date, expectedDeliveryDate: order.expected_delivery_date,
      paymentTerms: '45 days', supplierContactName: 'G07', supplierContactPhone: '13800000000', supplierAddress: 'G07',
      items: [{ productId: setup.finished.id, quantity: 10, uomCode: 'EA', unitPriceCents: 600 }],
    } });
    assert.equal(update.status, 200, JSON.stringify(update.data));
    const afterIds = db.prepare('SELECT id FROM purchase_order_items WHERE order_id=? ORDER BY id').all(order.id).map((row) => row.id);
    assertProcessingPoItemStable({ beforeItemIds: beforeIds, afterItemIds: afterIds });

    const injected = await httpRequest(manifest.applications.A, { token: adminToken, method: 'POST', path: '/api/purchase-orders', body: {
      businessType: 'OUTSOURCE_PROCESSING', sourceOutsourcingOrderId: setup.order.id, supplierId: order.supplier_id,
      items: [{ productId: setup.finished.id, quantity: 10, unitPriceCents: 600 }],
    } });
    assert.deepEqual({ status: injected.status, code: injected.data.code }, { status: 400, code: 'PURCHASE_ORDER_BUSINESS_TYPE_NOT_CLIENT_SETTABLE' });
    const provenanceMutation = await httpRequest(manifest.applications.A, { token: adminToken, method: 'PUT', path: `/api/purchase-orders/${order.id}`, body: {
      businessType: 'STANDARD_PURCHASE', supplierId: order.supplier_id, items: [{ productId: setup.finished.id, quantity: 10, unitPriceCents: 600 }],
    } });
    assert.deepEqual({ status: provenanceMutation.status, code: provenanceMutation.data.code }, { status: 400, code: 'PURCHASE_ORDER_SOURCE_IMMUTABLE' });
    for (const action of ['ADD', 'MODIFY', 'CANCEL']) {
      const rejected = await httpRequest(manifest.applications.A, { token: adminToken, method: 'POST', path: '/api/procurement/purchase-order-changes', body: { orderId: order.id, action, payload: { quantity: 10 } } });
      assert.deepEqual({ status: rejected.status, code: rejected.data.code }, { status: 409, code: 'PROCESSING_PO_CHANGE_NOT_ALLOWED' });
    }

    const today = new Date().toISOString().slice(0, 10);
    // UAT-14 的当前合同：VMI 收货必须绑定业务日期上唯一有效的协议，并使用外部幂等键。
    const vmiAgreement = await httpRequest(manifest.applications.A, { token: adminToken, method: 'POST', path: '/api/procurement/vmi/agreements', body: {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: setup.finished.id,
      minStock: 10, maxStock: 100, reorderLevel: 20, effectiveFrom: today,
    } });
    assert.equal(vmiAgreement.status, 201, JSON.stringify(vmiAgreement.data));
    const vmi = await httpRequest(manifest.applications.A, { token: adminToken, method: 'POST', path: '/api/procurement/vmi/receipts', body: {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: setup.finished.id, quantity: 2, receivedDate: today, idempotencyKey: 'm1-g07-uat14',
    } });
    const vmiConfirm = vmi.status === 201 ? await httpRequest(manifest.applications.A, { token: adminToken, method: 'POST', path: `/api/procurement/vmi/receipts/${vmi.data.id}/confirm`, body: {} }) : { status: 0 };
    assertUat14VmiReceiptOracle({ createStatus: vmi.status, confirmStatus: vmiConfirm.status });

    const l1 = manifest.setupTrace.filter((entry) => entry.method !== 'TECHNICAL_L2'); const l2 = manifest.setupTrace.filter((entry) => entry.method === 'TECHNICAL_L2');
    assertG03EvidenceLayering({ l1FactCount: l1.length, l2FactCount: l2.length, l2Enumerated: l2.map((entry) => `${entry.scenario}:${entry.prerequisite}`) });
    const allTables = [...new Set(M1_CORE_G07_SCENARIOS.flatMap((item) => item.snapshotTables))]; const snapshot = fullSnapshot(db, allTables);
    const money = [];
    for (const [table, tableRows] of Object.entries(snapshot)) for (const row of tableRows) for (const [column, value] of Object.entries(row)) if (/(?:_cents|Cents)$/.test(column) && value !== null) money.push({ table, column, value: Number(value) });
    assertSafeIntegerCents(money.map((item) => item.value), 'real-mysql-snapshot-cents');
  });
});
