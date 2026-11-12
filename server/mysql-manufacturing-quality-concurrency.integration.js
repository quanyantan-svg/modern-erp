// V23 Manufacturing & Quality Domain real MySQL concurrency matrix.
//
// Each race scenario starts two worker subprocesses — each with its own MySQL
// connection — and releases them through a common gate, so the race happens on
// a real MySQL 8 server and not as an interleaving of synchronous calls inside
// one event loop. The final state is then verified against canonical
// production tables (production_orders, production_order_items,
// production_order_operations, production_operation_transfers, audit_logs).
//
// The MySQL dialect is asserted on bootstrap, so a silent SQLite fallback can
// never produce a false-green result.
//
// Run:
//   ERP_DB_BACKEND=mysql ERP_DB_HOST=… ERP_DB_PORT=… ERP_DB_NAME=… \
//   ERP_DB_USER=… ERP_DB_PASSWORD=… ERP_MYSQL_TEST_ALLOW_RESET=true \
//   node --test server/mysql-manufacturing-quality-concurrency.integration.js

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createTempDb } from './test-utils/temp-db.js';

// The lifecycle used when the suite runs inside the Manufacturing & Quality
// ACK-4 campaign: the disposable target is already bootstrapped and the schema
// drop belongs to the Root's CLEANUP_SCHEMA_POST_RUN child.
const manufacturingQualityGateLifecycle = {
  beforeCreate(config) {
    if (!/(?:test|phase7|disposable|domain_test)/i.test(String(config?.database || ''))) {
      throw new Error(`MANUFACTURING_QUALITY RACE SUITE REFUSED: ${config?.database} is not a disposable target`);
    }
  },
  verify(db) {
    if (db.dialect !== 'mysql') throw new Error(`MANUFACTURING_QUALITY RACE SUITE REFUSED: dialect=${db.dialect}`);
  },
  reset() {
    // The Root's CLEANUP_SCHEMA_POST_RUN child owns the schema drop.
  },
};
import { MySqlSyncAdapter } from './database/mysql-adapter.js';
import { resolveDatabaseConfig } from './database/config.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'manufacturing-quality-concurrency-worker.mjs');
const ACTOR_ID = 'manufacturing-quality-race-actor';

describe('V23 Manufacturing & Quality real MySQL concurrency matrix (4 races)', () => {
  let mysql;
  let db;
  let observer;
  let counter = 0;

  function now() { return new Date().toISOString(); }

  /**
   * Start two workers, wait until both hold a live MySQL session, then release
   * them together. Returns each worker's parsed response.
   */
  async function raceTwo(specs) {
    const dir = mkdtempSync(join(tmpdir(), 'mq-race-'));
    const gate = join(dir, 'gate');
    const children = specs.map((spec, index) => {
      const payloadFile = join(dir, `payload-${index}.json`);
      const readyFile = join(dir, `ready-${index}`);
      writeFileSync(payloadFile, JSON.stringify(spec.payload));
      const child = spawn(process.execPath, [
        workerPath, '--action', spec.action, '--payload', payloadFile,
        '--ready', readyFile, '--gate', gate,
      ], { cwd: repoRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      // The exit promise is captured at spawn time. Attaching the listener
      // after the gate is released would miss the 'exit' event of a worker
      // that finishes first, and the await would then never settle.
      const exited = new Promise((resolveExit) => {
        child.on('exit', (code) => resolveExit(code));
      });
      return { child, readyFile, exited, stdout: () => stdout, stderr: () => stderr };
    });

    const deadline = Date.now() + 60_000;
    while (!children.every((entry) => existsSync(entry.readyFile))) {
      if (Date.now() >= deadline) {
        for (const entry of children) entry.child.kill('SIGKILL');
        throw new Error(`MANUFACTURING_QUALITY RACE READY_TIMEOUT: ${children.map((e) => e.stderr()).join(' | ')}`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    writeFileSync(gate, 'go\n');
    const results = [];
    for (const entry of children) {
      const code = await Promise.race([
        entry.exited,
        new Promise((resolveTimeout) => setTimeout(() => resolveTimeout('TIMEOUT'), 60_000)),
      ]);
      if (code === 'TIMEOUT') {
        entry.child.kill('SIGKILL');
        throw new Error(`MANUFACTURING_QUALITY RACE WORKER_TIMEOUT: ${entry.stderr()}`);
      }
      const raw = entry.stdout().trim().split(/\r?\n/).filter(Boolean).findLast((line) => line.startsWith('{'));
      let parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
      results.push({ code, result: parsed, stderr: entry.stderr() });
    }
    rmSync(dir, { recursive: true, force: true });
    return results;
  }

  function auditCount(action, entityId) {
    return Number(db.prepare('SELECT COUNT(*) n FROM audit_logs WHERE action=? AND entity_id=?')
      .get(action, entityId)?.n || 0);
  }

  /** A product with an approved BOM, an active routing and two operations. */
  function seedScenario({ outsource = false } = {}) {
    counter += 1;
    const suffix = `${Date.now()}-${counter}`;
    const productId = `mq-race-product-${suffix}`;
    const componentId = `mq-race-component-${suffix}`;
    const warehouseId = `mq-race-warehouse-${suffix}`;
    const routingId = `mq-race-routing-${suffix}`;
    const supplierId = `mq-race-supplier-${suffix}`;
    const stamp = now();
    const insertProduct = db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,standard_manufacturing_cost_cents,created_at,updated_at)
      VALUES(?,?,?,'制造','件',0,0,1,0,?,?)`);
    insertProduct.run(productId, `MQR-P-${suffix}`, '竞态产品', stamp, stamp);
    insertProduct.run(componentId, `MQR-C-${suffix}`, '竞态组件', stamp, stamp);
    db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,'','',1,?,?)`)
      .run(warehouseId, `MQR-WH-${suffix}`, '竞态主仓', stamp, stamp);
    db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,email,active,payment_terms_days,created_at,updated_at)
      VALUES(?,?,?,'','','','',1,0,?,?)`).run(supplierId, `MQR-S-${suffix}`, '竞态供应商', stamp, stamp);
    db.prepare(`INSERT INTO boms(id,product_id,version,status,purpose,approval_status,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,'ACTIVE','SELF_MAKE','APPROVED','${ACTOR_ID}',?,?)`).run(`mq-race-bom-${suffix}`, productId, '1.0', stamp, stamp);
    db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no,uom_code_snapshot,conversion_numerator,conversion_denominator)
      VALUES(?,?,?,?,0,1,'件',1,1)`).run(`mq-race-bomi-${suffix}`, `mq-race-bom-${suffix}`, componentId, 2);
    db.prepare(`INSERT INTO product_routings(id,product_id,routing_code,routing_name,version,status,notes,created_at,updated_at)
      VALUES(?,?,?,?,'1.0','ACTIVE','',?,?)`).run(routingId, productId, `MQR-R-${suffix}`, '竞态工艺路线', stamp, stamp);
    const insertOperation = db.prepare(`INSERT INTO product_routing_operations(id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,notes,created_at,updated_at,active,is_outsource,quality_policy,topology)
      VALUES(?,?,?,'OP10','装配工序','WC1',0,1,'',?,?,1,?,'NONE','LINEAR')`);
    insertOperation.run(`mq-race-op-${suffix}`, routingId, 1, stamp, stamp, outsource ? 1 : 0);
    db.prepare(`INSERT INTO product_routing_operations(id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,notes,created_at,updated_at,active,is_outsource,quality_policy,topology)
      VALUES(?,?,2,'OP20','检验工序','WC1',0,1,'',?,?,1,0,'NONE','LINEAR')`).run(`mq-race-op2-${suffix}`, routingId, stamp, stamp);
    db.prepare(`INSERT INTO inventory(warehouse_id,product_id,quantity,updated_at) VALUES(?,?,100,?)`).run(warehouseId, componentId, stamp);
    return { suffix, productId, componentId, warehouseId, supplierId, routingId };
  }

  /** A production order in the state the scenario needs, with its items. */
  function seedOrder(scenario, { status = 'APPROVED' } = {}) {
    const stamp = now();
    const orderId = `mq-race-order-${scenario.suffix}`;
    db.prepare(`INSERT INTO production_orders(id,order_no,product_id,quantity,status,remark,creator_id,created_at,updated_at,source_type,material_list_status)
      VALUES(?,?,?,10,?,'','${ACTOR_ID}',?,?,'MANUAL',?)`)
      .run(orderId, `MO-MQR-${scenario.suffix}`, scenario.productId, status, stamp, stamp, 'CONTROLLED_EDIT');
    const itemId = `mq-race-item-${scenario.suffix}`;
    db.prepare(`INSERT INTO production_order_items(id,order_id,product_id,quantity,consumed_quantity,line_no,bom_item_id,quantity_per_unit,scrap_rate_snapshot,material_list_status)
      VALUES(?,?,?,20,0,1,?,2,0,'CONTROLLED_EDIT')`)
      .run(itemId, orderId, scenario.componentId, `mq-race-bomi-${scenario.suffix}`);
    // The routing snapshot references the production order, so it is created
    // here rather than in the shared scenario.
    const snapshotId = `mq-race-snapshot-${scenario.suffix}`;
    db.prepare(`INSERT INTO production_order_routing_snapshots(id,production_order_id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,notes,created_at)
      VALUES(?,?,?,1,'OP10','装配工序','WC1',0,1,'',?)`).run(snapshotId, orderId, scenario.routingId, stamp);
    return { orderId, itemId, snapshotId };
  }

  before(() => {
    mysql = createTempDb({
      label: 'mysql-manufacturing-quality-races',
      production: true,
      mysqlLifecycle: process.env.ERP_MANUFACTURING_QUALITY_MYSQL_GATE === '1' ? manufacturingQualityGateLifecycle : null,
    });
    db = mysql.db;
    if (db.dialect !== 'mysql') {
      throw new Error(
        `Manufacturing & Quality MySQL race suite expected db.dialect='mysql' but got '${db.dialect}'. `
        + `Set ERP_TEST_DB_BACKEND=mysql and ERP_DB_BACKEND=mysql before invoking this suite.`,
      );
    }
    console.log(`MANUFACTURING_QUALITY RACE DIALECT = ${db.dialect}`);
    const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
    observer = new MySqlSyncAdapter(mysqlConfig);
    const server = observer.prepare('SELECT VERSION() version, DATABASE() database_name').get();
    if (!/^8\./.test(String(server?.version || ''))) {
      throw new Error(`Manufacturing & Quality MySQL race suite requires MySQL 8; server reported '${server?.version || 'unknown'}'`);
    }
    console.log(`MANUFACTURING_QUALITY RACE MYSQL SERVER = ${server.version} database=${server.database_name} dialect=mysql`);
    // The shared race actor is inserted once: the scenarios reuse it, and a
    // second insert would violate the primary key.
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,'x','x','role-admin',1,?)`).run(ACTOR_ID, ACTOR_ID, '竞态用户', new Date().toISOString());
  });

  beforeEach(() => {
    db.prepare('DELETE FROM audit_logs WHERE user_id=?').run(ACTOR_ID);
  });

  after(() => {
    observer?.close();
    mysql?.cleanup();
  });

  // MQ-RACE-01 --------------------------------------------------------
  // Two concurrent approvals of the same material list must not both pass the
  // state gate: exactly one may succeed and exactly one approval audit may
  // exist.
  test('MQ-RACE-01 concurrent double approval of one material list yields one approval', async () => {
    const scenario = seedScenario();
    const { orderId } = seedOrder(scenario);
    const results = await raceTwo([
      { action: 'approve-material-list', payload: { orderId } },
      { action: 'approve-material-list', payload: { orderId } },
    ]);
    const statuses = results.map((entry) => Number(entry.result?.status ?? 0)).sort();
    assert.deepEqual(statuses, [200, 409],
      `MQ-RACE-01: exactly one approval may succeed, got ${JSON.stringify(results.map((e) => e.result))}`);
    const order = db.prepare('SELECT material_list_status FROM production_orders WHERE id=?').get(orderId);
    assert.equal(order.material_list_status, 'APPROVED', 'the material list must end in APPROVED');
    assert.equal(auditCount('APPROVE', orderId), 1,
      `MQ-RACE-01: exactly one APPROVE audit row may exist, got ${auditCount('APPROVE', orderId)}`);
  });

  // MQ-RACE-02 --------------------------------------------------------
  // A concurrent controlled edit may not slip past an approval: an approved
  // material list refuses further edits, so at most one of the two actions can
  // change the list, and the list must never end in a state that was approved
  // and then silently rewritten.
  test('MQ-RACE-02 concurrent edit and approval of one material list never rewrites an approved list', async () => {
    const scenario = seedScenario();
    const { orderId, itemId } = seedOrder(scenario);
    const results = await raceTwo([
      { action: 'edit-material-list', payload: { orderId, lines: [{ lineId: itemId, scrapRate: 0.08 }] } },
      { action: 'approve-material-list', payload: { orderId } },
    ]);
    const statuses = results.map((entry) => Number(entry.result?.status ?? 0)).sort();
    assert.ok(statuses.every((status) => [200, 409].includes(status)),
      `MQ-RACE-02: both actions must either succeed or be refused, got ${JSON.stringify(results.map((e) => e.result))}`);
    const order = db.prepare('SELECT material_list_status FROM production_orders WHERE id=?').get(orderId);
    assert.equal(order.material_list_status, 'APPROVED',
      'MQ-RACE-02: the material list must end in APPROVED, never CONTROLLED_EDIT');
    const item = db.prepare('SELECT scrap_rate_snapshot FROM production_order_items WHERE id=?').get(itemId);
    assert.equal(Number(item.scrap_rate_snapshot), 0,
      'MQ-RACE-02: an approved material list must not be rewritten by a late controlled edit');
    assert.equal(auditCount('APPROVE', orderId), 1,
      `MQ-RACE-02: exactly one APPROVE audit row may exist, got ${auditCount('APPROVE', orderId)}`);
  });

  // MQ-RACE-03 --------------------------------------------------------
  // Two concurrent outsource hand-offs of the same operation must produce
  // exactly one hand-off and one audit row.
  test('MQ-RACE-03 concurrent double outsource hand-off yields one hand-off', async () => {
    const scenario = seedScenario({ outsource: true });
    const { orderId, snapshotId } = seedOrder(scenario, { status: 'IN_PROGRESS' });
    const stamp = now();
    const operationId = `mq-race-operation-${scenario.suffix}`;
    db.prepare(`INSERT INTO production_order_operations(id,production_order_id,routing_snapshot_id,sequence_no,operation_code,operation_name,work_center_code,work_center_name,setup_seconds,run_seconds_per_unit,expected_yield_bps,labor_rate_cents_per_hour,overhead_rate_cents_per_hour,daily_capacity_minutes,planned_input_quantity,status,created_at,updated_at,plan_status,control_code,control_participates_scheduling,control_reporting_method,control_inspection_method,is_outsource,quality_policy,topology,topology_meta)
      VALUES(?,?,?,1,'OP10','装配工序','WC1','竞态工作中心',0,1,10000,0,0,480,10,'NOT_STARTED',?,?,'NOT_STARTED','',1,'MANUAL','NONE',1,'NONE','LINEAR','{}')`)
      .run(operationId, orderId, snapshotId, stamp, stamp);
    const results = await raceTwo([
      { action: 'outsource-handoff', payload: { operationId, supplierId: scenario.supplierId } },
      { action: 'outsource-handoff', payload: { operationId, supplierId: scenario.supplierId } },
    ]);
    const statuses = results.map((entry) => Number(entry.result?.status ?? 0)).sort();
    assert.deepEqual(statuses, [200, 409],
      `MQ-RACE-03: exactly one hand-off may succeed, got ${JSON.stringify(results.map((e) => e.result))}`);
    const operation = db.prepare('SELECT status FROM production_order_operations WHERE id=?').get(operationId);
    assert.equal(operation.status, 'OUTSOURCED', 'the operation must end in OUTSOURCED');
    assert.equal(auditCount('OUTSOURCE_HANDOFF', operationId), 1,
      `MQ-RACE-03: exactly one OUTSOURCE_HANDOFF audit row may exist, got ${auditCount('OUTSOURCE_HANDOFF', operationId)}`);
  });

  // MQ-RACE-04 --------------------------------------------------------
  // Two concurrent transfers out of the same operation may not exceed the
  // quantity the source operation has released.
  test('MQ-RACE-04 concurrent transfers never exceed the released quantity', async () => {
    const scenario = seedScenario();
    const { orderId, snapshotId } = seedOrder(scenario, { status: 'IN_PROGRESS' });
    const stamp = now();
    const sourceId = `mq-race-source-${scenario.suffix}`;
    const targetId = `mq-race-target-${scenario.suffix}`;
    const insertOperation = db.prepare(`INSERT INTO production_order_operations(id,production_order_id,routing_snapshot_id,sequence_no,operation_code,operation_name,work_center_code,work_center_name,setup_seconds,run_seconds_per_unit,expected_yield_bps,labor_rate_cents_per_hour,overhead_rate_cents_per_hour,daily_capacity_minutes,planned_input_quantity,status,created_at,updated_at,plan_status,control_code,control_participates_scheduling,control_reporting_method,control_inspection_method,is_outsource,quality_policy,topology,topology_meta)
      VALUES(?,?,?,?,'OP10','装配工序','WC1','竞态工作中心',0,1,10000,0,0,480,10,?,?,?,'NOT_STARTED','',1,'MANUAL','NONE',0,'NONE','LINEAR','{}')`);
    insertOperation.run(sourceId, orderId, snapshotId, 1, 'COMPLETED', stamp, stamp);
    insertOperation.run(targetId, orderId, snapshotId, 2, 'NOT_STARTED', stamp, stamp);
    // The source operation has released exactly one unit.
    const reportId = `mq-race-report-${scenario.suffix}`;
    db.prepare(`INSERT INTO production_operation_reports(id,report_no,production_order_id,production_operation_id,business_date,good_quantity,scrap_quantity,labor_seconds,machine_seconds,status,released_quantity,operator_id,created_at,updated_at)
      VALUES(?,?,?,?,'2026-11-01',1,0,0,0,'CONFIRMED',1,'${ACTOR_ID}',?,?)`)
      .run(reportId, `MQR-OR-${scenario.suffix}`, orderId, sourceId, stamp, stamp);

    const results = await raceTwo([
      { action: 'scan-transfer', payload: { orderToken: `MO-MQR-${scenario.suffix}`, sourceOperationToken: sourceId, targetOperationToken: targetId, quantity: 1 } },
      { action: 'scan-transfer', payload: { orderToken: `MO-MQR-${scenario.suffix}`, sourceOperationToken: sourceId, targetOperationToken: targetId, quantity: 1 } },
    ]);
    const statuses = results.map((entry) => Number(entry.result?.status ?? 0)).sort();
    assert.deepEqual(statuses, [201, 409],
      `MQ-RACE-04: only one transfer of the single released unit may succeed, got ${JSON.stringify(results.map((e) => e.result))}`);
    const transferred = Number(db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM production_operation_transfers WHERE source_operation_id=?').get(sourceId)?.q || 0);
    assert.equal(transferred, 1, `MQ-RACE-04: the transferred quantity may never exceed the released quantity, got ${transferred}`);
  });
});
