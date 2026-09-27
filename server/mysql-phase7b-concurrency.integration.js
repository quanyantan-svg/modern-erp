import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTempDb } from './test-utils/temp-db.js';
import { createSystemVoucher, receiveValue, systemHealth } from './modules/financial-inventory.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const concurrencyWorkerPath = join(repoRoot, 'scripts', 'gates', 'mysql-concurrency-worker.mjs');

class AppInstance {
  constructor(name, env = {}) {
    this.name = name;
    this.pending = new Map();
    this.child = spawn(process.execPath, [concurrencyWorkerPath], {
      cwd: repoRoot, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.stderr = '';
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      const response = JSON.parse(line);
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      response.ok ? pending.resolve(response.result) : pending.reject(Object.assign(new Error(response.error.message), response.error));
    });
    this.child.on('exit', (code) => {
      for (const pending of this.pending.values()) pending.reject(new Error(`${name} exited ${code}: ${this.stderr}`));
      this.pending.clear();
    });
  }
  run(command) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }
  close() { this.child.stdin.end(); }
}

describe('V1.3 Phase 7B real MySQL concurrency and transaction hardening', () => {
  let mysql; let db; let apps; let noRetry;
  const row = (id) => db.prepare('SELECT * FROM phase7b_concurrency_resources WHERE id=?').get(id);
  const reset = (id, { kind = id, quantity = 0, value = 0, status = 'OPEN' } = {}) => {
    db.prepare(`INSERT INTO phase7b_concurrency_resources
      (id,kind,available_quantity,used_quantity,available_value_cents,used_value_cents,status,version)
      VALUES(?,?,?,?,?,?,?,0)
      ON DUPLICATE KEY UPDATE kind=VALUES(kind),available_quantity=VALUES(available_quantity),used_quantity=0,
        available_value_cents=VALUES(available_value_cents),used_value_cents=0,status=VALUES(status),version=0`)
      .run(id, kind, quantity, 0, value, 0, status);
    db.prepare('DELETE FROM phase7b_concurrency_effects WHERE resource_id=?').run(id);
  };
  const race = (commands) => Promise.all(commands.map((command, index) => apps[index % apps.length].run(command)));

  before(() => {
    mysql = createTempDb({ label: 'mysql-phase7b', production: true });
    db = mysql.db;
    db.exec(`CREATE TABLE phase7b_concurrency_resources (
      id VARCHAR(128) PRIMARY KEY, kind VARCHAR(64) NOT NULL,
      available_quantity DECIMAL(24,6) NOT NULL DEFAULT 0, used_quantity DECIMAL(24,6) NOT NULL DEFAULT 0,
      available_value_cents BIGINT NOT NULL DEFAULT 0, used_value_cents BIGINT NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL, version BIGINT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB`);
    db.exec(`CREATE TABLE phase7b_concurrency_effects (
      idempotency_key VARCHAR(128) PRIMARY KEY, payload LONGTEXT NOT NULL, resource_id VARCHAR(128) NOT NULL,
      effect_kind VARCHAR(32) NOT NULL, result_json JSON NOT NULL, created_at VARCHAR(64) NOT NULL,
      INDEX idx_phase7b_effect_resource(resource_id)
    ) ENGINE=InnoDB`);
    // Each process below owns a distinct adapter, worker thread and MySQL session.
    apps = Array.from({ length: 8 }, (_, index) => new AppInstance(`app-${index + 1}`));
    noRetry = new AppInstance('app-no-retry', { ERP_DB_TX_RETRY_MAX: '0' });
  });
  after(() => {
    for (const app of [...(apps || []), noRetry].filter(Boolean)) app.close();
    mysql?.cleanup();
  });

  test('real row-lock timeout is retried; exhaustion is controlled; business failures are not retried', async () => {
    const holder = apps[0].run({ action: 'hold', ms: 2300 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    reset('retry-target', { status: 'DRAFT' });
    const retried = apps[1].run({ action: 'transition', resourceId: 'retry-target', from: 'DRAFT', to: 'POSTED', key: 'retry-ok' });
    assert.equal((await retried).committed, true);
    await holder;

    const longHolder = apps[0].run({ action: 'hold', ms: 2500 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await assert.rejects(noRetry.run({ action: 'transition', resourceId: 'retry-target', from: 'POSTED', to: 'DONE', key: 'retry-exhaust' }),
      (error) => error.code === 'ER_LOCK_WAIT_TIMEOUT' && error.transactionRetryExhausted === true && error.transactionAttempts === 1);
    await longHolder;
    assert.deepEqual(await apps[2].run({ action: 'nonretry' }), { attempts: 1, error: 'BUSINESS_RULE' });
  });

  test('same-key replay is exact and changed payload conflicts across app instances', async () => {
    reset('idempotency', { quantity: 10 });
    const command = { action: 'consume', resourceId: 'idempotency', quantity: 7, key: 'idem-same' };
    const results = await race([command, command]);
    assert.equal(results.filter((result) => result.committed).length, 2);
    assert.equal(results.filter((result) => result.replay).length, 1);
    assert.equal(row('idempotency').available_quantity, 3);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM phase7b_concurrency_effects WHERE resource_id='idempotency'").get().n, 1);
    await assert.rejects(apps[2].run({ ...command, quantity: 6 }), /IDEMPOTENCY_KEY_CONFLICT/);

    reset('native-idempotency');
    const native = { action: 'native-idempotency', resourceId: 'native-idempotency', operationType: 'PHASE7B', documentId: 'native-idempotency', key: 'native-same', fingerprint: 'payload-a' };
    const nativeResults = await race([native, native]);
    assert.equal(nativeResults.filter((result) => result.replay).length, 1);
    assert.deepEqual(nativeResults.map(({ replay: _replay, ...result }) => result), [{ committed: true, ordinal: 1 }, { committed: true, ordinal: 1 }]);
    assert.equal(row('native-idempotency').used_quantity, 1);
    await assert.rejects(apps[2].run({ ...native, fingerprint: 'payload-b' }), /同一幂等键不能用于不同请求内容/);
  });

  test('purchase, delivery, invoice, bill, material issue, production receipt, count and reversal status races are single-effect', async () => {
    const kinds = ['PURCHASE_RECEIPT', 'SALES_DELIVERY', 'SALES_INVOICE', 'SUPPLIER_BILL', 'MATERIAL_ISSUE', 'PRODUCTION_RECEIPT', 'INVENTORY_COUNT', 'REVERSAL'];
    for (const kind of kinds) {
      const id = `status-${kind}`; const key = `status-key-${kind}`;
      reset(id, { kind, status: 'DRAFT' });
      const command = { action: 'transition', resourceId: id, from: 'DRAFT', to: kind === 'REVERSAL' ? 'REVERSED' : 'POSTED', key };
      const results = await race([command, command]);
      assert.equal(results.every((result) => result.committed), true, kind);
      assert.equal(row(id).version, 1, kind);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM phase7b_concurrency_effects WHERE resource_id=?').get(id).n, 1, kind);
    }
  });

  test('concurrent E2 transfer confirmation is single-effect across app processes', async () => {
    const at = '2026-09-27T08:00:00.000Z';
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('e2-race-user','e2-race-user','E2 Race User','x','x','role-warehouse',1,?)`).run(at);
    db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES
      ('e2-race-a','E2-RA','E2 Race A','','',1,?,?),
      ('e2-race-b','E2-RB','E2 Race B','','',1,?,?)`).run(at, at, at, at);
    db.prepare(`INSERT INTO products
      (id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,tracking_policy,valuation_method,inventory_classification)
      VALUES('e2-race-product','E2-RP','E2 Race Product','TEST','EA',0,0,1,?,?,'NONE','MOVING_AVERAGE','OTHER_INVENTORY')`).run(at, at);
    db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES
      ('e2-race-inv-a','e2-race-a','e2-race-product',10,?),
      ('e2-race-inv-b','e2-race-b','e2-race-product',0,?)`).run(at, at);
    db.prepare(`INSERT INTO inventory_transactions
      (id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at,business_date)
      VALUES('e2-race-seed-tx','e2-race-a','e2-race-product',10,'IN',10,'E2_RACE_SEED','e2-race-seed','E2-RACE-SEED','',?,?,?)`)
      .run('e2-race-user', at, '2026-09-27');
    receiveValue(db, {
      businessDate: '2026-09-27', productId: 'e2-race-product', warehouseId: 'e2-race-a',
      quantity: 10, valueCents: 10000, movementType: 'E2_RACE_SEED',
      sourceType: 'E2_RACE_SEED', sourceId: 'e2-race-seed', sourceItemId: 'e2-race-seed',
      inventoryTransactionId: 'e2-race-seed-tx',
    });
    createSystemVoucher(db, {
      sourceType: 'E2_RACE_SEED', sourceId: 'e2-race-seed', businessDate: '2026-09-27', actorId: 'e2-race-user',
      entries: [
        { role: 'OTHER_INVENTORY', direction: 'DEBIT', amountCents: 10000 },
        { role: 'INVENTORY_GAIN_LOSS', direction: 'CREDIT', amountCents: 10000 },
      ],
    });
    db.prepare(`INSERT INTO inventory_transfers
      (id,transfer_no,from_warehouse_id,to_warehouse_id,status,remark,creator_id,created_at,updated_at,business_date)
      VALUES('e2-race-transfer','E2-RACE-TRANSFER','e2-race-a','e2-race-b','DRAFT','',?,?,?,'2026-09-27')`).run('e2-race-user', at, at);
    db.prepare(`INSERT INTO inventory_transfer_items(id,transfer_id,product_id,quantity)
      VALUES('e2-race-item','e2-race-transfer','e2-race-product',7)`).run();

    const command = { action: 'inventory-transfer-confirm', transferId: 'e2-race-transfer', actorId: 'e2-race-user' };
    const results = await Promise.allSettled([apps[0].run(command), apps[1].run(command)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejection = results.find((result) => result.status === 'rejected');
    assert.equal(rejection.reason.code, 'DUPLICATE_CONFIRMATION');
    assert.equal(db.prepare("SELECT status FROM inventory_transfers WHERE id='e2-race-transfer'").get().status, 'TRANSFERRED');
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='e2-race-a' AND product_id='e2-race-product'").get().quantity, 3);
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='e2-race-b' AND product_id='e2-race-product'").get().quantity, 7);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='INVENTORY_TRANSFER' AND source_id='e2-race-transfer'").get().n, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='TRANSFER' AND entity_type='INVENTORY_TRANSFER' AND entity_id='e2-race-transfer'").get().n, 1);
    const totals = db.prepare("SELECT SUM(quantity) quantity,SUM(value_cents) value_cents FROM inventory_valuation_balances WHERE product_id='e2-race-product'").get();
    assert.equal(totals.quantity, 10);
    assert.equal(totals.value_cents, 10000);
  });

  test('NONE, LOT and SERIAL stock contention never over-consumes or reuses identity', async () => {
    for (const kind of ['NONE', 'LOT', 'SERIAL']) {
      const id = `stock-${kind}`;
      reset(id, { kind, quantity: kind === 'SERIAL' ? 1 : 10 });
      const quantity = kind === 'SERIAL' ? 1 : 7;
      const results = await race([0, 1].map((n) => ({ action: 'consume', resourceId: id, quantity, key: `${id}-${n}` })));
      assert.equal(results.filter((result) => result.committed).length, 1, kind);
      assert.ok(row(id).available_quantity >= 0, kind);
      assert.equal(row(id).used_quantity, quantity, kind);
    }
  });

  test('SO/PO fulfillment and invoice/bill source quantities never exceed availability', async () => {
    for (const kind of ['SO_DELIVERY', 'PO_RECEIPT', 'DELIVERED_UNBILLED', 'RECEIVED_UNBILLED']) {
      const id = `source-${kind}`;
      reset(id, { kind, quantity: 10 });
      const results = await race([0, 1].map((n) => ({ action: 'consume', resourceId: id, quantity: 7, key: `${id}-${n}` })));
      assert.equal(results.filter((result) => result.committed).length, 1, kind);
      assert.equal(row(id).used_quantity, 7, kind);
      assert.equal(row(id).available_quantity, 3, kind);
    }
  });

  test('AR/AP allocation, credit, refund and write-off cannot make open balance negative', async () => {
    for (const kind of ['AR_COLLECTION', 'AP_PAYMENT', 'CREDIT_APPLICATION', 'REFUND', 'WRITE_OFF']) {
      const id = `settlement-${kind}`;
      reset(id, { kind, quantity: 100 });
      const results = await race([0, 1].map((n) => ({ action: 'consume', resourceId: id, quantity: 70, key: `${id}-${n}` })));
      assert.equal(results.filter((result) => result.committed).length, 1, kind);
      assert.equal(row(id).available_quantity, 30, kind);
    }
  });

  test('moving-average, lot and serial valuation retain quantity/value with exact full depletion', async () => {
    for (const kind of ['MOVING_AVERAGE', 'LOT_VALUE', 'SERIAL_VALUE']) {
      const id = `valuation-${kind}`;
      reset(id, { kind, quantity: 10, value: 1000 });
      const results = await race([0, 1].map((n) => ({ action: 'consume', resourceId: id, quantity: 7, valueCents: 700, key: `${id}-${n}` })));
      assert.equal(results.filter((result) => result.committed).length, 1, kind);
      assert.deepEqual([row(id).available_quantity, row(id).available_value_cents], [3, 300], kind);
    }
    reset('valuation-deplete', { quantity: 10, value: 1001 });
    await race([
      { action: 'consume', resourceId: 'valuation-deplete', quantity: 4, valueCents: 400, key: 'deplete-1' },
      { action: 'consume', resourceId: 'valuation-deplete', quantity: 6, valueCents: 601, key: 'deplete-2' },
    ]);
    assert.deepEqual([row('valuation-deplete').available_quantity, row('valuation-deplete').available_value_cents], [0, 0]);
  });

  test('production material, operation, GOOD receipt and return allowances never over-process', async () => {
    for (const kind of ['MATERIAL_SUPPORTED', 'OPERATION_INPUT', 'FINAL_GOOD', 'MATERIAL_RETURN']) {
      const id = `production-${kind}`;
      reset(id, { kind, quantity: 10, value: 1000 });
      const results = await race([0, 1].map((n) => ({ action: 'consume', resourceId: id, quantity: 7, valueCents: 700, key: `${id}-${n}` })));
      assert.equal(results.filter((result) => result.committed).length, 1, kind);
      assert.ok(row(id).available_quantity >= 0 && row(id).available_value_cents >= 0, kind);
    }
  });

  test('40 parallel document allocations are unique and idempotent across eight sessions', async () => {
    const commands = Array.from({ length: 40 }, (_, index) => ({
      action: 'number', documentType: 'P7B', date: '2026-09-25', key: `number-${index}`,
    }));
    const results = await race(commands);
    assert.equal(new Set(results.map((result) => result.number)).size, 40);
    const replay = await race(commands.slice(0, 8));
    assert.deepEqual(replay.map((result) => result.number), results.slice(0, 8).map((result) => result.number));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM document_number_allocations WHERE document_type='P7B'").get().n, 40);
  });

  test('inventory/accounting close, go-live and original/reversal races serialize to valid outcomes', async () => {
    for (const id of ['inventory-period', 'accounting-period', 'settlement-period']) {
      reset(id, { status: 'OPEN' });
      const [posting, closing] = await race([
        { action: 'post', periodId: id, delayMs: 100 },
        { action: 'transition', resourceId: id, from: 'OPEN', to: 'CLOSED', key: `close-${id}` },
      ]);
      assert.equal(row(id).status, 'CLOSED');
      assert.equal(row(id).used_quantity, posting.committed ? 1 : 0);
      assert.equal(closing.committed, true);
    }

    reset('go-live', { status: 'DRAFT' });
    const [activation, business] = await race([
      { action: 'transition', resourceId: 'go-live', from: 'DRAFT', to: 'ACTIVE', key: 'activate' },
      { action: 'normal-business', resourceId: 'go-live' },
    ]);
    assert.equal(activation.committed, true);
    assert.equal(row('go-live').status, 'ACTIVE');
    assert.equal(row('go-live').used_quantity, business.committed ? 1 : 0);

    reset('original-reversal', { status: 'DRAFT' });
    const [original, earlyReversal] = await race([
      { action: 'transition', resourceId: 'original-reversal', from: 'DRAFT', to: 'POSTED', key: 'original' },
      { action: 'transition', resourceId: 'original-reversal', from: 'POSTED', to: 'REVERSED', key: 'reversal-early' },
    ]);
    assert.equal(original.committed, true);
    assert.ok(['POSTED', 'REVERSED'].includes(row('original-reversal').status));
    if (earlyReversal.committed) assert.equal(row('original-reversal').status, 'REVERSED');
    if (row('original-reversal').status === 'POSTED') {
      const command = { action: 'transition', resourceId: 'original-reversal', from: 'POSTED', to: 'REVERSED', key: 'reversal-final' };
      const reversed = await race([command, command]);
      assert.equal(reversed.every((result) => result.committed), true);
    }
    assert.equal(row('original-reversal').version, 2);
  });

  test('post-stress invariants and production System Health remain green without repair', () => {
    const broken = db.prepare(`SELECT COUNT(*) n FROM phase7b_concurrency_resources
      WHERE available_quantity<0 OR used_quantity<0 OR available_value_cents<0 OR used_value_cents<0`).get().n;
    assert.equal(broken, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM (
      SELECT idempotency_key,COUNT(*) c FROM phase7b_concurrency_effects GROUP BY idempotency_key HAVING c>1
    ) duplicates`).get().n, 0);
    const health = systemHealth(db);
    assert.equal(health.checkOnly, true);
    assert.equal(health.autoRepair, false);
    assert.deepEqual(health.checks.filter((check) => check.severity === 'BLOCKING' && check.status === 'FAIL'), []);
  });
});
