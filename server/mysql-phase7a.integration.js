import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createDatabase, transaction } from './db.js';
import { createTempDb, createTempDir } from './test-utils/temp-db.js';
import { allocateDocumentNumber } from './modules/commercial-golive.js';
import { convertSqliteToMySql } from '../scripts/convert-sqlite-to-mysql.mjs';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');

describe('V1.3 Phase 7A MySQL 8 compatibility gate', () => {
  let mysql;
  before(() => { mysql = createTempDb({ label: 'mysql-phase7a', production: true }); });
  after(() => mysql?.cleanup());

  test('fresh bootstrap is complete, repeatable, transactional and sequence-safe', () => {
    const db = mysql.db;
    assert.equal(db.dialect, 'mysql');
    assert.equal(db.prepare('SELECT @@transaction_isolation level').get().level, 'READ-COMMITTED');
    assert.equal(db.prepare('SHOW TABLES').all().length, 174);
    assert.equal(db.prepare("SELECT version FROM mysql_backend_metadata WHERE version='v1.3-phase7a'").get().version, 'v1.3-phase7a');
    assert.equal(db.prepare('SELECT purpose FROM mysql_transaction_gates WHERE gate_id=1').get().purpose, 'application-write');

    const first = transaction(db, () => allocateDocumentNumber(db, 'TST', '2026-09-25', 'mysql-seq-1'));
    const replay = transaction(db, () => allocateDocumentNumber(db, 'TST', '2026-09-25', 'mysql-seq-1'));
    const second = transaction(db, () => allocateDocumentNumber(db, 'TST', '2026-09-25', 'mysql-seq-2'));
    assert.equal(first, 'TST-202609-00001');
    assert.equal(replay, first);
    assert.equal(second, 'TST-202609-00002');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM document_number_allocations WHERE document_type='TST'").get().n, 2);

    assert.throws(() => transaction(db, () => {
      db.prepare("INSERT INTO document_number_allocations(idempotency_key,document_type,document_no,created_at) VALUES('rollback-key','TST','TST-ROLLBACK',?)").run(new Date().toISOString());
      throw new Error('rollback');
    }), /rollback/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM document_number_allocations WHERE idempotency_key='rollback-key'").get().n, 0);
  });
});

describe('V1.3 Phase 7A SQLite to MySQL conversion rehearsal', () => {
  let dir; let sourcePath;
  before(() => {
    // The conversion source is deliberately outside the repository and uses
    // production seed rules so every synthetic business row has an explicit ID.
    dir = createTempDir('phase7a-convert');
    sourcePath = join(dir, 'source.db');
    const oldNode = process.env.NODE_ENV; const oldSeed = process.env.ERP_SEED_DEMO;
    process.env.NODE_ENV = 'production'; process.env.ERP_SEED_DEMO = 'false';
    const db = createDatabase(sourcePath);
    if (oldNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNode;
    if (oldSeed === undefined) delete process.env.ERP_SEED_DEMO; else process.env.ERP_SEED_DEMO = oldSeed;
    const at = '2026-09-25T08:00:00.000Z';
    db.prepare("INSERT INTO customers(id,code,name,active,created_at,updated_at) VALUES('conv-c','CONV-C','Conversion Customer',1,?,?)").run(at, at);
    db.prepare("INSERT INTO suppliers(id,code,name,active,created_at,updated_at) VALUES('conv-s','CONV-S','Conversion Supplier',1,?,?)").run(at, at);
    db.prepare("INSERT INTO warehouses(id,code,name,active,created_at,updated_at) VALUES('conv-w','CONV-W','Conversion Warehouse',1,?,?)").run(at, at);
    db.prepare("INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,inventory_classification) VALUES('conv-p','CONV-P','Conversion Product','EA',12345,0,1,?,?,'EA','NONE','MOVING_AVERAGE','OTHER_INVENTORY')").run(at, at);
    db.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES('conv-i','conv-w','conv-p',12.5,?)").run(at);
    db.close();
  });
  after(() => {
    try {
      const target = createTempDb({ label: 'mysql-conversion-cleanup', production: true });
      target.cleanup();
    } catch {}
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  test('all rows, primary IDs, relationships and control totals match', () => {
    const report = convertSqliteToMySql({ sourcePath });
    assert.equal(report.tableCount, 172);
    assert.equal(report.rowCounts.customers, 1);
    assert.equal(report.rowCounts.suppliers, 1);
    assert.equal(report.rowCounts.inventory, 1);
    assert.equal(report.controlTotals['inventory.quantity'], 12.5);
    const target = createDatabase({ backend: 'mysql' });
    try {
      assert.deepEqual(target.prepare("SELECT id,warehouse_id,product_id,quantity FROM inventory WHERE id='conv-i'").get(), {
        id: 'conv-i', warehouse_id: 'conv-w', product_id: 'conv-p', quantity: 12.5,
      });
    } finally { target.close(); }
  });
});
