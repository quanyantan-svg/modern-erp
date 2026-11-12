// V17 Master & Engineering Domain real MySQL concurrency matrix.
//
// Each race scenario starts two worker subprocesses — each with its own MySQL
// connection — and releases them through a common gate, so the race happens
// on a real MySQL 8 server and not as an interleaving of synchronous calls
// inside one event loop. The final state is then verified against canonical
// production tables (boms, bom_items, engineering_change_orders,
// engineering_change_items, audit_logs).
//
// The MySQL dialect is asserted on bootstrap, so a silent SQLite fallback can
// never produce a false-green result.
//
// Run:
//   ERP_DB_BACKEND=mysql ERP_DB_HOST=… ERP_DB_PORT=… ERP_DB_NAME=… \
//   ERP_DB_USER=… ERP_DB_PASSWORD=… ERP_MYSQL_TEST_ALLOW_RESET=true \
//   node --test server/mysql-master-engineering-concurrency.integration.js

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTempDb } from './test-utils/temp-db.js';

// The lifecycle used when the suite runs inside the Master & Engineering
// ACK-4 campaign: the disposable target is already bootstrapped and the schema
// drop belongs to the Root's CLEANUP_SCHEMA_POST_RUN child.
const engineeringGateLifecycle = {
  beforeCreate(config) {
    if (!/(?:test|phase7|disposable|domain_test)/i.test(String(config?.database || ''))) {
      throw new Error(`ENGINEERING RACE SUITE REFUSED: ${config?.database} is not a disposable target`);
    }
  },
  verify(db) {
    if (db.dialect !== 'mysql') throw new Error(`ENGINEERING RACE SUITE REFUSED: dialect=${db.dialect}`);
  },
  reset() {
    // The Root's CLEANUP_SCHEMA_POST_RUN child owns the schema drop.
  },
};
import { MySqlSyncAdapter } from './database/mysql-adapter.js';
import { resolveDatabaseConfig } from './database/config.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'master-engineering-concurrency-worker.mjs');
const ACTOR_ID = 'master-engineering-race-actor';
const PARENT_PRODUCT = 'me-race-parent-product';
const COMPONENT_PRODUCT = 'me-race-component-product';
const ADDED_PRODUCT = 'me-race-added-product';

describe('V17 Master & Engineering real MySQL concurrency matrix (4 races)', () => {
  let mysql;
  let db;
  let observer;
  let workDir;

  function now() { return new Date().toISOString(); }

  /**
   * Start two workers, wait until both hold a live MySQL session, then release
   * them together. Returns each worker's parsed response.
   */
  async function raceTwo(specs) {
    const dir = mkdtempSync(join(tmpdir(), 'me-race-'));
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
      return { child, readyFile, stdout: () => stdout, stderr: () => stderr };
    });

    const deadline = Date.now() + 60_000;
    while (!children.every((entry) => existsSync(entry.readyFile))) {
      if (Date.now() >= deadline) {
        for (const entry of children) entry.child.kill('SIGKILL');
        throw new Error(`ENGINEERING RACE READY_TIMEOUT: ${children.map((e) => e.stderr()).join(' | ')}`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    writeFileSync(gate, 'go\n');
    const results = [];
    for (const entry of children) {
      const code = await new Promise((resolveExit) => entry.child.on('exit', resolveExit));
      const raw = entry.stdout().trim().split(/\r?\n/).filter(Boolean).findLast((line) => line.startsWith('{'));
      let parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
      results.push({ code, result: parsed, stderr: entry.stderr() });
    }
    rmSync(dir, { recursive: true, force: true });
    return results;
  }

  function seedProduct(id, code) {
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
      VALUES(?,?,?,'','PCS',0,0,1,?,?)`).run(id, code, `ME Race ${code}`, now(), now());
  }

  function seedBom(id, productId, version, status = 'ACTIVE') {
    db.prepare(`INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,'',?,?,?)`).run(id, productId, version, status, ACTOR_ID, now(), now());
  }

  function seedBomItem(id, bomId, productId, quantity, lineNo) {
    db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no)
      VALUES(?,?,?,?,0,?)`).run(id, bomId, productId, quantity, lineNo);
  }

  function seedEco(id, status, targetBomId, opType, productId, quantity) {
    const ts = now();
    db.prepare(`INSERT INTO engineering_change_orders(id,doc_no,title,reason,change_type,version_upgrade,status,target_bom_id,creator_id,created_at,updated_at)
      VALUES(?,?,?,'','IMMEDIATE',1,?,?,?,?,?)`)
      .run(id, `ME-RACE-${id.slice(-8)}`, `ME Race ECO ${id.slice(-8)}`, status, targetBomId, ACTOR_ID, ts, ts);
    db.prepare(`INSERT INTO engineering_change_items(id,change_order_id,line_no,op_type,product_id,quantity,scrap_rate,old_value,new_value,notes,created_at)
      VALUES(?,?,1,?,?,?,0,'','','',?)`)
      .run(`${id}-item-1`, id, opType, productId, quantity, ts);
  }

  function auditCount(action, entityId) {
    return Number(db.prepare(`SELECT COUNT(*) n FROM audit_logs WHERE action=? AND entity_id=?`)
      .get(action, entityId)?.n || 0);
  }

  before(() => {
    // Inside a protected ACK-4 campaign the schema is already bootstrapped by
    // the Root's BOOTSTRAP_CURRENT_SCHEMA child, and the schema drop belongs
    // to the Root's CLEANUP_SCHEMA_POST_RUN child.
    mysql = createTempDb({
      label: 'mysql-master-engineering-races',
      production: true,
      mysqlLifecycle: process.env.ERP_MASTER_ENGINEERING_MYSQL_GATE === '1' ? engineeringGateLifecycle : null,
    });
    db = mysql.db;
    if (db.dialect !== 'mysql') {
      throw new Error(
        `Master & Engineering MySQL race suite expected db.dialect='mysql' but got '${db.dialect}'. `
        + `Set ERP_TEST_DB_BACKEND=mysql and ERP_DB_BACKEND=mysql before invoking this suite.`,
      );
    }
    console.log(`ENGINEERING RACE DIALECT = ${db.dialect}`);
    const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
    observer = new MySqlSyncAdapter(mysqlConfig);
    const server = observer.prepare('SELECT VERSION() version, DATABASE() database_name').get();
    if (!/^8\./.test(String(server?.version || ''))) {
      throw new Error(`Master & Engineering MySQL race suite requires MySQL 8; server reported '${server?.version || 'unknown'}'`);
    }
    console.log(`ENGINEERING RACE MYSQL SERVER = ${server.version} database=${server.database_name} dialect=mysql`);
    workDir = mkdtempSync(join(tmpdir(), 'me-race-suite-'));
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,'x','x','role-admin',1,?)`).run(ACTOR_ID, ACTOR_ID, 'ME Race User', now());
  });

  beforeEach(() => {
    db.prepare(`DELETE FROM audit_logs WHERE user_id=?`).run(ACTOR_ID);
    db.prepare(`DELETE FROM engineering_change_items`).run();
    db.prepare(`DELETE FROM engineering_change_orders`).run();
    db.prepare(`DELETE FROM bom_items`).run();
    db.prepare(`DELETE FROM boms`).run();
    db.prepare(`DELETE FROM work_centers WHERE code LIKE 'ME-RACE-%'`).run();
    db.prepare(`DELETE FROM engineering_work_calendars WHERE code LIKE 'ME-RACE-%'`).run();
    db.prepare(`DELETE FROM engineering_shifts WHERE code LIKE 'ME-RACE-%'`).run();
    db.prepare(`DELETE FROM products WHERE id IN (?,?,?)`).run(PARENT_PRODUCT, COMPONENT_PRODUCT, ADDED_PRODUCT);
    seedProduct(PARENT_PRODUCT, 'ME-RACE-PARENT');
    seedProduct(COMPONENT_PRODUCT, 'ME-RACE-COMP');
    seedProduct(ADDED_PRODUCT, 'ME-RACE-ADD');
  });

  after(() => {
    observer?.close();
    mysql?.cleanup();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  // ME-RACE-01 ---------------------------------------------------------
  // Two concurrent applies of the SAME ECO must not both pass the APPROVED
  // gate. Exactly one apply may succeed, exactly one new BOM version may
  // exist, and exactly one APPLY audit row may be written.
  test('ME-RACE-01 concurrent double apply of one ECO yields exactly one applied BOM version', async () => {
    const bomId = 'me-race-bom-01';
    const ecoId = 'me-race-eco-01';
    seedBom(bomId, PARENT_PRODUCT, '1.0');
    seedBomItem('me-race-bom-item-01', bomId, COMPONENT_PRODUCT, 2, 1);
    seedEco(ecoId, 'APPROVED', bomId, 'ADD_COMPONENT', ADDED_PRODUCT, 3);

    const results = await raceTwo([
      { action: 'apply-eco', payload: { changeId: ecoId } },
      { action: 'apply-eco', payload: { changeId: ecoId } },
    ]);

    const statuses = results.map((entry) => Number(entry.result?.status ?? 0)).sort();
    assert.deepEqual(statuses, [200, 409],
      `ME-RACE-01: exactly one apply may succeed, got ${JSON.stringify(results.map((e) => e.result))}`);

    const activeBoms = db.prepare(`SELECT id,version FROM boms WHERE product_id=? AND status='ACTIVE'`).all(PARENT_PRODUCT);
    assert.equal(activeBoms.length, 1, `ME-RACE-01: exactly one ACTIVE BOM must remain, got ${JSON.stringify(activeBoms)}`);
    assert.equal(activeBoms[0].version, '2.0', `ME-RACE-01: the applied BOM must carry the next version`);

    const allVersions = db.prepare(`SELECT version FROM boms WHERE product_id=?`).all(PARENT_PRODUCT).map((row) => row.version);
    assert.equal(new Set(allVersions).size, allVersions.length,
      `ME-RACE-01: a double apply must not create two BOM rows with the same version, got ${JSON.stringify(allVersions)}`);

    const status = db.prepare(`SELECT status FROM engineering_change_orders WHERE id=?`).get(ecoId)?.status;
    assert.equal(status, 'APPLIED', `ME-RACE-01: the ECO must end in APPLIED, got ${status}`);
    assert.equal(auditCount('APPLY', ecoId), 1,
      `ME-RACE-01: exactly one APPLY audit row may exist, got ${auditCount('APPLY', ecoId)}`);

    const items = db.prepare(`SELECT COUNT(*) n FROM bom_items WHERE bom_id=?`).get(activeBoms[0].id)?.n;
    assert.equal(Number(items), 2, `ME-RACE-01: the applied BOM must carry the projected component count`);
  });

  // ME-RACE-02 ---------------------------------------------------------
  // Two concurrent terminal transitions (approve vs reject) of the SAME ECO
  // must not both pass the PENDING gate. Exactly one terminal state may be
  // written, and exactly one terminal audit row may exist.
  test('ME-RACE-02 concurrent approve vs reject of one ECO yields exactly one terminal state', async () => {
    const bomId = 'me-race-bom-02';
    const ecoId = 'me-race-eco-02';
    seedBom(bomId, PARENT_PRODUCT, '1.0');
    seedEco(ecoId, 'PENDING', bomId, 'MODIFY_HEADER', COMPONENT_PRODUCT, 1);

    const results = await raceTwo([
      { action: 'approve-eco', payload: { changeId: ecoId } },
      { action: 'reject-eco', payload: { changeId: ecoId, body: { reason: 'race rejection' } } },
    ]);

    const statuses = results.map((entry) => Number(entry.result?.status ?? 0)).sort();
    assert.deepEqual(statuses, [200, 409],
      `ME-RACE-02: exactly one terminal transition may succeed, got ${JSON.stringify(results.map((e) => e.result))}`);

    const status = db.prepare(`SELECT status FROM engineering_change_orders WHERE id=?`).get(ecoId)?.status;
    assert.ok(['APPROVED', 'REJECTED'].includes(status),
      `ME-RACE-02: the ECO must end in exactly one terminal state, got ${status}`);
    const terminalAudits = auditCount('APPROVE', ecoId) + auditCount('REJECT', ecoId);
    assert.equal(terminalAudits, 1,
      `ME-RACE-02: exactly one terminal audit row may exist, got ${terminalAudits}`);
  });

  // ME-RACE-03 ---------------------------------------------------------
  // Two concurrent deactivations of the SAME reference master must produce
  // exactly ONE deactivation. The second call observes the committed
  // deactivation inside the transaction and must not write a second audit
  // row. This assertion fails when the authoritative read happens outside the
  // transaction.
  test('ME-RACE-03 concurrent double deactivate of one master writes exactly one deactivation', async () => {
    const masterId = 'me-race-shift-03';
    const ts = now();
    db.prepare(`INSERT INTO engineering_shifts(id,code,name,start_minute,end_minute,active,created_at,updated_at)
      VALUES(?,?,?,480,720,1,?,?)`).run(masterId, 'ME-RACE-SHIFT', 'ME Race Shift', ts, ts);

    const results = await raceTwo([
      { action: 'deactivate-master', payload: { kind: 'SHIFT', id: masterId } },
      { action: 'deactivate-master', payload: { kind: 'SHIFT', id: masterId } },
    ]);

    for (const entry of results) {
      assert.equal(Number(entry.result?.status ?? 0), 200,
        `ME-RACE-03: deactivation is idempotent and both calls must succeed, got ${JSON.stringify(entry.result)}`);
    }
    const master = db.prepare(`SELECT active FROM engineering_shifts WHERE id=?`).get(masterId);
    assert.equal(Number(master?.active), 0, `ME-RACE-03: the master must be inactive`);
    assert.equal(auditCount('DEACTIVATE', masterId), 1,
      `ME-RACE-03: exactly one DEACTIVATE audit row may exist, got ${auditCount('DEACTIVATE', masterId)}`);
  });

  // ME-RACE-04 ---------------------------------------------------------
  // A master that is still referenced by an active record must not be
  // deactivated, and that refusal must survive two concurrent attempts.
  test('ME-RACE-04 concurrent deactivate of a referenced master is refused and leaves the master active', async () => {
    const masterId = 'me-race-calendar-04';
    const ts = now();
    db.prepare(`INSERT INTO engineering_work_calendars(id,code,name,start_date,end_date,active,created_at,updated_at)
      VALUES(?,?,?,'2026-01-01','2026-12-31',1,?,?)`)
      .run(masterId, 'ME-RACE-CAL', 'ME Race Calendar', ts, ts);
    db.prepare(`INSERT INTO work_centers(id,code,name,type,capacity_hours,efficiency,unit_cost_cents,active,calendar_id,created_at)
      VALUES(?,?,?,'PRODUCTION',0,1,0,1,?,?)`)
      .run(`me-race-wc-${randomUUID().slice(-6)}`, 'ME-RACE-WC', 'ME Race Work Center', masterId, ts);

    const results = await raceTwo([
      { action: 'deactivate-master', payload: { kind: 'WORK_CALENDAR', id: masterId } },
      { action: 'deactivate-master', payload: { kind: 'WORK_CALENDAR', id: masterId } },
    ]);

    for (const entry of results) {
      assert.equal(Number(entry.result?.status ?? 0), 409,
        `ME-RACE-04: a referenced master must be refused, got ${JSON.stringify(entry.result)}`);
    }
    const master = db.prepare(`SELECT active FROM engineering_work_calendars WHERE id=?`).get(masterId);
    assert.equal(Number(master?.active), 1, `ME-RACE-04: the referenced master must stay active`);
    assert.equal(auditCount('DEACTIVATE', masterId), 0,
      `ME-RACE-04: a refused deactivation must not write an audit row`);
  });
});
