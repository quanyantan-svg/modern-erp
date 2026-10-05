// V2 Stage 3 / Wave 5B — focused behavior coverage for the migrated
// manufacturing reference-data routes (work centres and the legacy
// BOM-bound `routing_operations` table).
//
// Pure ownership-migration tests. `teacher-acceptance-matrix.test.js`
// only references these four endpoints generically and does not assert
// payload shape, ordering, audit, or 403 semantics. The canonical
// product-routings family (`/api/product-routings/*`,
// `product_routings`, `product_routing_operations`) continues to live
// under `server/modules/product-routing.js` and is intentionally
// untouched by this wave — the `routing_operations` table behind
// these four routes is a separate, legacy BOM-bound table from
// `product_routing_operations`. The two contracts must not be merged
// or redesigned.
//
// This suite proves that after the route-table migration the four
// endpoints behave identically to the pre-Wave-5B baseline:
//
//   - GET /api/work-centers returns the canonical work-centre list
//     ordered by code, requires WORK_CENTERS_VIEW /
//     WORK_CENTERS_MANAGE (admin reachability) and rejects roles
//     that lack both (GET and POST);
//   - POST /api/work-centers returns 201 + { id }, persists
//     capacity / labor / overhead rate normalization with the
//     documented defaults (capacity_hours=8 → 480 minutes, 0 / 0
//     labor and overhead), and writes a CREATE WORK_CENTER audit
//     log entry with the canonical detail format;
//   - GET /api/routing-operations joins work-centre / BOM / product
//     projection and supports the optional `bom_id` filter, requires
//     ROUTING_VIEW / ROUTING_MANAGE (admin reachability) and rejects
//     roles that lack both (GET and POST);
//   - POST /api/routing-operations returns 201 + { id }, applies
//     the canonical defaults (operation_no=1, time fields=0,
//     description=""), and persists the exact INSERT contract.
//
// No business semantics changed. The handler bodies, SQL, response
// shapes, and HTTP semantics remain byte-equivalent to the baseline
// implementation in server/modules/extended.js.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createApp } from './app.js';
import { createDatabase } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let salesToken;

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function login(username, password) {
  const result = await request('/api/auth/login', { token: '', method: 'POST', body: { username, password } });
  assert.equal(result.status, 200, `login ${username} failed: ${result.data.error}`);
  return result.data.token;
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-wave5b-mfg-ref-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  salesToken = await login('sales', 'sales123');

  // The demo seed does not cover work_centers, boms, or
  // routing_operations; seed minimal fixtures here so the test is
  // self-contained. Use deterministic timestamps so the
  // `ORDER BY code` assertion below has no clock-skew ambiguity.
  const t1 = '2026-01-01T00:00:00.000Z';

  const insertWorkCenter = database.prepare(
    "INSERT INTO work_centers(id,code,name,type,capacity_hours,efficiency,unit_cost_cents,active,created_at,daily_capacity_minutes,labor_rate_cents_per_hour,overhead_rate_cents_per_hour) VALUES(?,?,?,?,?,?,?,1,?,?,?,?)",
  );
  insertWorkCenter.run('w5b-wc-alpha', 'WC-ALPHA', 'Alpha 工作中心', 'PRODUCTION', 8, 1, 0, t1, 480, 6000, 3000);
  insertWorkCenter.run('w5b-wc-bravo', 'WC-BRAVO', 'Bravo 工作中心', 'ASSEMBLY', 8, 1, 0, t1, 480, 0, 0);
  insertWorkCenter.run('w5b-wc-charlie', 'WC-CHARLIE', 'Charlie 工作中心', 'PRODUCTION', 8, 1, 0, t1, 480, 0, 0);

  const insertBom = database.prepare(
    "INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
  );
  insertBom.run('w5b-bom-001', 'product-001', '1.0', 'ACTIVE', '', 'user-admin', t1, t1);
  insertBom.run('w5b-bom-002', 'product-002', '1.0', 'ACTIVE', '', 'user-admin', t1, t1);

  const insertRoutingOp = database.prepare(
    "INSERT INTO routing_operations(id,bom_id,operation_no,work_center_id,work_time_minutes,setup_time_minutes,wait_time_minutes,move_time_minutes,description) VALUES(?,?,?,?,?,?,?,?,?)",
  );
  insertRoutingOp.run('w5b-op-001', 'w5b-bom-001', 10, 'w5b-wc-alpha', 12, 4, 0, 0, '首批工序');
  insertRoutingOp.run('w5b-op-002', 'w5b-bom-001', 20, 'w5b-wc-bravo', 8, 2, 0, 0, '次道工序');
  insertRoutingOp.run('w5b-op-003', 'w5b-bom-002', 10, 'w5b-wc-charlie', 6, 2, 0, 0, '对比 BOM 工序');
});

after(async () => {
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done)));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('V2 Wave 5B — manufacturing reference-data route family behavior preservation', () => {
  test('GET /api/work-centers returns the canonical work-centre list ordered by code with full row shape', async () => {
    const result = await request('/api/work-centers');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.workCenters));
    const codes = result.data.workCenters.map((row) => row.code);
    assert.deepEqual(codes, ['WC-ALPHA', 'WC-BRAVO', 'WC-CHARLIE'], 'work-centre list must be ordered by code ascending');
    const alpha = result.data.workCenters.find((row) => row.code === 'WC-ALPHA');
    assert.equal(typeof alpha.id, 'string');
    assert.equal(alpha.name, 'Alpha 工作中心');
    assert.equal(alpha.type, 'PRODUCTION');
    assert.equal(alpha.capacity_hours, 8);
    assert.equal(alpha.daily_capacity_minutes, 480);
    assert.equal(alpha.labor_rate_cents_per_hour, 6000);
    assert.equal(alpha.overhead_rate_cents_per_hour, 3000);
    assert.equal(alpha.active, 1);
  });

  test('POST /api/work-centers creates a work-centre, returns 201 + { id }, persists capacity / labor / overhead rate normalization with canonical defaults, and writes a CREATE WORK_CENTER audit', async () => {
    // First call: all rate fields provided; verify exact INSERT contract.
    const code = `WC-W5B-${Date.now()}`;
    const created = await request('/api/work-centers', {
      method: 'POST',
      body: {
        code,
        name: 'Wave5B 测试工作中心',
        type: 'ASSEMBLY',
        capacity_hours: 7.5,
        efficiency: 95,
        unit_cost_cents: 12345,
        dailyCapacityMinutes: 450,
        laborRateCentsPerHour: 5500,
        overheadRateCentsPerHour: 2800,
      },
    });
    assert.equal(created.status, 201, `expected 201, got ${created.status}: ${JSON.stringify(created.data)}`);
    assert.equal(typeof created.data.id, 'string');
    assert.ok(created.data.id.length > 0);

    const row = database.prepare(
      'SELECT code,name,type,capacity_hours,efficiency,unit_cost_cents,daily_capacity_minutes,labor_rate_cents_per_hour,overhead_rate_cents_per_hour,active FROM work_centers WHERE id=?',
    ).get(created.data.id);
    assert.equal(row.code, code);
    assert.equal(row.name, 'Wave5B 测试工作中心');
    assert.equal(row.type, 'ASSEMBLY');
    assert.equal(row.capacity_hours, 7.5, 'capacity_hours = Math.round(dailyCapacityMinutes / 60) = 450/60 = 7.5');
    assert.equal(row.efficiency, 95);
    assert.equal(row.unit_cost_cents, 12345);
    assert.equal(row.daily_capacity_minutes, 450);
    assert.equal(row.labor_rate_cents_per_hour, 5500);
    assert.equal(row.overhead_rate_cents_per_hour, 2800);
    assert.equal(row.active, 1);

    const audit = database.prepare(
      "SELECT * FROM audit_logs WHERE action='CREATE' AND entity_type='WORK_CENTER' AND entity_id=?",
    ).get(created.data.id);
    assert.ok(audit, 'CREATE WORK_CENTER audit log must be written');
    assert.equal(audit.user_id, 'user-admin');
    assert.equal(audit.detail, `${code} 能力 450 分钟`, 'audit detail must carry the normalized capacity in minutes');

    // Second call: defaults — no capacity_hours / rate fields. The
    // baseline contracts are capacity_hours default 8 (480 minutes /
    // 60) and labor / overhead rate defaults of 0 / 0.
    const defaultCode = `WC-W5B-DEF-${Date.now()}`;
    const defaults = await request('/api/work-centers', {
      method: 'POST',
      body: { code: defaultCode, name: '默认值测试工作中心' },
    });
    assert.equal(defaults.status, 201);
    const defRow = database.prepare(
      'SELECT capacity_hours,daily_capacity_minutes,labor_rate_cents_per_hour,overhead_rate_cents_per_hour FROM work_centers WHERE id=?',
    ).get(defaults.data.id);
    assert.equal(defRow.capacity_hours, 8);
    assert.equal(defRow.daily_capacity_minutes, 480);
    assert.equal(defRow.labor_rate_cents_per_hour, 0);
    assert.equal(defRow.overhead_rate_cents_per_hour, 0);
  });

  test('Work-centre endpoints reject sales role with 403 (sales lacks WORK_CENTERS_VIEW and WORK_CENTERS_MANAGE)', async () => {
    const listForSales = await request('/api/work-centers', { token: salesToken });
    assert.equal(listForSales.status, 403, 'sales GET /api/work-centers must be rejected (no WORK_CENTERS_VIEW)');

    const code = `WC-SALES-${Date.now()}`;
    const postForSales = await request('/api/work-centers', {
      token: salesToken,
      method: 'POST',
      body: { code, name: 'sales 不可创建' },
    });
    assert.equal(postForSales.status, 403, 'sales POST /api/work-centers must be rejected (no WORK_CENTERS_MANAGE)');
  });

  test('GET /api/routing-operations returns joined work-centre / BOM / product projection, supports bom_id filter, and orders by bom_id, operation_no', async () => {
    const unfiltered = await request('/api/routing-operations');
    assert.equal(unfiltered.status, 200);
    assert.ok(Array.isArray(unfiltered.data.operations));
    assert.equal(unfiltered.data.operations.length, 3);
    const codes = unfiltered.data.operations.map((row) => row.bom_id);
    assert.deepEqual(codes, ['w5b-bom-001', 'w5b-bom-001', 'w5b-bom-002']);
    const opNos = unfiltered.data.operations.map((row) => row.operation_no);
    assert.deepEqual(opNos, [10, 20, 10]);
    // Join projections must be exposed.
    const first = unfiltered.data.operations[0];
    assert.equal(first.wc_code, 'WC-ALPHA');
    assert.equal(first.wc_name, 'Alpha 工作中心');
    assert.equal(first.bom_version, '1.0');
    assert.equal(first.product_code, 'P001');
    assert.equal(first.product_name, '高端笔记本电脑');

    const filtered = await request('/api/routing-operations?bom_id=w5b-bom-001');
    assert.equal(filtered.status, 200);
    assert.equal(filtered.data.operations.length, 2);
    assert.ok(filtered.data.operations.every((row) => row.bom_id === 'w5b-bom-001'));

    const noMatch = await request('/api/routing-operations?bom_id=__no_such_bom__');
    assert.equal(noMatch.status, 200);
    assert.equal(noMatch.data.operations.length, 0);
  });

  test('POST /api/routing-operations creates a routing operation, returns 201 + { id }, persists exact INSERT contract, and applies canonical defaults', async () => {
    const opId = await request('/api/routing-operations', {
      method: 'POST',
      body: {
        bom_id: 'w5b-bom-002',
        operation_no: 30,
        work_center_id: 'w5b-wc-charlie',
        work_time_minutes: 7,
        setup_time_minutes: 3,
        move_time_minutes: 1,
        description: 'W5B 创建工序',
      },
    });
    assert.equal(opId.status, 201, `expected 201, got ${opId.status}: ${JSON.stringify(opId.data)}`);
    assert.equal(typeof opId.data.id, 'string');
    assert.ok(opId.data.id.length > 0);

    const row = database.prepare(
      'SELECT bom_id,operation_no,work_center_id,work_time_minutes,setup_time_minutes,wait_time_minutes,move_time_minutes,description FROM routing_operations WHERE id=?',
    ).get(opId.data.id);
    assert.equal(row.bom_id, 'w5b-bom-002');
    assert.equal(row.operation_no, 30);
    assert.equal(row.work_center_id, 'w5b-wc-charlie');
    assert.equal(row.work_time_minutes, 7);
    assert.equal(row.setup_time_minutes, 3);
    assert.equal(row.wait_time_minutes, 0);
    assert.equal(row.move_time_minutes, 1);
    assert.equal(row.description, 'W5B 创建工序');

    // Defaults: operation_no=1 and zeroed time fields when omitted.
    const defaults = await request('/api/routing-operations', {
      method: 'POST',
      body: { bom_id: 'w5b-bom-002', work_center_id: 'w5b-wc-charlie' },
    });
    assert.equal(defaults.status, 201);
    const defRow = database.prepare(
      'SELECT operation_no,work_time_minutes,setup_time_minutes,wait_time_minutes,move_time_minutes,description FROM routing_operations WHERE id=?',
    ).get(defaults.data.id);
    assert.equal(defRow.operation_no, 1, 'default operation_no must be 1');
    assert.equal(defRow.work_time_minutes, 0);
    assert.equal(defRow.setup_time_minutes, 0);
    assert.equal(defRow.wait_time_minutes, 0);
    assert.equal(defRow.move_time_minutes, 0);
    assert.equal(defRow.description, '');
  });

  test('Routing-operation endpoints reject sales role with 403 (sales lacks ROUTING_VIEW and ROUTING_MANAGE)', async () => {
    const listForSales = await request('/api/routing-operations', { token: salesToken });
    assert.equal(listForSales.status, 403, 'sales GET /api/routing-operations must be rejected (no ROUTING_VIEW)');

    const postForSales = await request('/api/routing-operations', {
      token: salesToken,
      method: 'POST',
      body: { bom_id: 'w5b-bom-002', work_center_id: 'w5b-wc-charlie' },
    });
    assert.equal(postForSales.status, 403, 'sales POST /api/routing-operations must be rejected (no ROUTING_MANAGE)');
  });
});