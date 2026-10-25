// Wave 7 real-MySQL independent-session finite-capacity race.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import { createApp } from './app.js';
import { hashPassword } from './db.js';
import { computePositionKey } from './lib/inventory-position.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'mysql-concurrency-sales-wave7-worker.mjs');
const DAY = '2026-10-18';

class Worker {
  constructor(name) {
    this.name = name; this.pending = new Map(); this.stderr = '';
    this.child = spawn(process.execPath, [workerPath], { cwd: repoRoot, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      let reply; try { reply = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(reply.id); if (!pending) return;
      this.pending.delete(reply.id); clearTimeout(pending.timer);
      if (reply.ok) pending.resolve(reply.result); else pending.reject(Object.assign(new Error(reply.error.message), reply.error));
    });
    this.child.on('exit', (code) => {
      for (const pending of this.pending.values()) pending.reject(new Error(`${name} exited ${code}: ${this.stderr}`));
      this.pending.clear();
    });
  }
  run(command) {
    const id = randomUUID();
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name} timeout: ${JSON.stringify(command)}`)), 20_000);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }
  async close() { try { await this.run({ action: 'close' }); } catch {} try { this.child.stdin.end(); } catch {} }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function waitAtTransactionGate(db, ids) {
  for (let i = 0; i < 400; i += 1) {
    const rows = ids.map((id) => db.prepare('SELECT INFO FROM information_schema.PROCESSLIST WHERE ID=?').get(id));
    if (rows.every((row) => String(row?.INFO || '').toUpperCase().includes('MYSQL_TRANSACTION_GATES'))) return true;
    sleep(25);
  }
  return false;
}

describe('Sales & Customer Wave 7 — real MySQL concurrency', () => {
  let handle; let db; let server; let baseUrl; let adminToken;
  const call = async (path, { method = 'GET', body, key } = {}) => {
    const headers = adminToken ? { authorization: `Bearer ${adminToken}` } : {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (key) headers['idempotency-key'] = key;
    const response = await fetch(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };
  before(async () => {
    handle = createTempDb({ label: 'sales-customer-wave7-concurrency', production: true });
    db = handle.db;
    assert.equal(db.dialect, 'mysql');
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('wave7-race-actor','wave7-race-actor','Wave7 Race','x','x','role-admin',1,?)`).run(now);
    // The real HTTP API auth path used by the PLANNING_RELEASE / RESERVATION
    // / DELIVERY production-mode entry helpers below requires a canonical
    // admin user. The production-mode branch of `createTempDb` deliberately
    // suppresses `seedDemoData`, so the canonical `admin/admin123` row is
    // not automatically present. Seed it here from the canonical hash so
    // `/api/auth/login` succeeds end-to-end. This is a bounded fixture for
    // this integration suite only; it does not touch `temp-db.js`,
    // `seedDemoData`, or any other concurrency suite's setup.
    const adminHash = hashPassword('admin123');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('user-admin','admin','系统管理员',?,?,'role-admin',1,?)`)
      .run(adminHash.hash, adminHash.salt, now);
    // Same production-mode suppression applies to sales_parameters:
    // /api/sales-orders requires the SYSTEM scope to be active with the
    // relevant feature flags set. The acceptance suite ships its own
    // minimal seed in `buildRealEntryHarness`; mirror exactly that shape
    // here so HTTP API entry points can serve PLANNING_RELEASE submit and
    // DELIVERY confirm requests end-to-end.
    db.prepare(`INSERT OR IGNORE INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
      sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,
      active,created_at,updated_at,created_by,updated_by) VALUES('SYSTEM','SYSTEM',NULL,0,0,0,1,1,'BOTH','DISABLED',1,?,?,?,?)`)
      .run(now, now, 'user-admin', 'user-admin');
    db.prepare("UPDATE sales_parameters SET sales_group_data_scope_enabled=1 WHERE scope_type='SYSTEM' AND scope_key='SYSTEM'").run();
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES('wave7-race-customer','W7-RACE-C','Wave7 Race Customer','','','',1,?,?)`).run(now, now);
    db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at)
      VALUES('wave7-race-warehouse','W7-RACE-W','Wave7 Race Warehouse','','',1,?,?)`).run(now, now);
    db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at)
      VALUES('wave7-race-product','W7-RACE-P','Wave7 Race Product','EA',0,0,1,?,?)`).run(now, now);
    // Inventory canonical 13-column insert mirroring production
    // `applyInventoryMutation` (server/lib/inventory-mutation.js:123-124).
    // Wave 7 production schema (post-V21) requires position_key +
    // bin_id / owner_type / owner_id / stock_status / lot_id / serial_id
    // / active in addition to the 5 base columns. The 5-column form
    // silently fails because `position_key TEXT NOT NULL` has no DEFAULT;
    // this fix mirrors the canonical INSERT verbatim so both
    // `createInventoryLockAdapter` (sales-reservation-intent.js:134) and
    // `confirmSalesDelivery` (server/app.js:5700) read the row correctly.
    const wave7Product = 'wave7-race-product';
    const wave7Warehouse = 'wave7-race-warehouse';
    const wave7PositionKey = computePositionKey({
      productId: wave7Product, warehouseId: wave7Warehouse,
      binId: null, ownerType: 'ENTERPRISE', ownerId: null,
      stockStatus: 'AVAILABLE', lotId: null, serialId: null,
    });
    db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at,
      position_key,bin_id,owner_type,owner_id,stock_status,lot_id,serial_id,active)
      VALUES('wave7-race-entry-inventory',?,?,100,?,?,NULL,'ENTERPRISE',NULL,'AVAILABLE',NULL,NULL,1)
      ON DUPLICATE KEY UPDATE quantity=100,updated_at=VALUES(updated_at)`)
      .run(wave7Warehouse, wave7Product, now, wave7PositionKey);
    for (const n of [1, 2]) {
      db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at)
        VALUES(?,?,?,'APPROVED',0,'wave7-race-actor',?,?)`)
        .run(`wave7-race-order-${n}`, `W7-RACE-SO-${n}`, 'wave7-race-customer', now, now);
      db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
        VALUES(?,?,?,8,0,0,1)`).run(`wave7-race-line-${n}`, `wave7-race-order-${n}`, 'wave7-race-product');
    }
    db.prepare(`INSERT INTO planned_orders(id,order_no,product_id,quantity,released_quantity,status,source_type,supply_type,need_date,created_at,updated_at,created_by,updated_by)
      VALUES('wave7-race-supply','W7-RACE-PO','wave7-race-product',10,0,'CONFIRMED','MRP','MAKE',?,?,?,?,?)`)
      .run(DAY, now, now, 'wave7-race-actor', 'wave7-race-actor');
    db.prepare("UPDATE planning_parameters SET reservation_enabled=1 WHERE id='DEFAULT'").run();
    for (const code of ['1002', '1122']) {
      db.prepare(`INSERT IGNORE INTO accounting_subjects(id,code,name,active)
        VALUES(?,?,?,1)`).run(`wave7-subject-${code}`, code, `Wave7 ${code}`);
    }
    const bankAccountingSubjectId = db.prepare("SELECT id FROM accounting_subjects WHERE code='1002' AND active=1").get().id;
    db.prepare(`INSERT INTO bank_accounts(id,bank_name,account_no,account_name,account_type,balance_cents,currency,active,created_at,updated_at,code,opening_balance_cents,accounting_role,accounting_subject_id)
      VALUES('wave7-race-bank','Wave7 Bank','W7-001','Wave7 Bank','BANK',1000000,'CNY',1,?,?,'W7-BANK',1000000,'CASH_BANK',?)`).run(now, now, bankAccountingSubjectId);
    for (const n of [3, 4, 5]) {
      db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
        VALUES(?,?,?,'','','',1,?,?)`).run(`wave7-fin-customer-${n}`, `W7-FC-${n}`, `Wave7 Finance Customer ${n}`, now, now);
      db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at)
        VALUES(?,?,?,'APPROVED',10000,'wave7-race-actor',?,?)`)
        .run(`wave7-fin-order-${n}`, `W7-FSO-${n}`, `wave7-fin-customer-${n}`, now, now);
      db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
        VALUES(?,?,?,1,10000,10000,1)`).run(`wave7-fin-line-${n}`, `wave7-fin-order-${n}`, 'wave7-race-product');
      db.prepare(`INSERT INTO sales_prepayment_requirements(id,sales_order_id,line_no,required_amount_cents,ratio_basis,created_at,created_by)
        VALUES(?,?,0,10000,'ORDER_VALUE',?,'wave7-race-actor')`).run(`wave7-fin-req-${n}`, `wave7-fin-order-${n}`, now);
      db.prepare(`INSERT INTO sales_prepayment_gate_results(id,sales_order_id,stage,gate_decision,required_remaining_cents,
        eligible_advance_cents,refunded_amount_cents,applied_amount_cents,source_balance_identities,snapshot_key,evaluated_at,evaluated_by)
        VALUES(?,?,'RESERVATION','PASS',10000,10000,0,0,'[]',?,?, 'wave7-race-actor')`)
        .run(`wave7-fin-prior-${n}`, `wave7-fin-order-${n}`, `wave7-fin-prior-${n}`, now);
    }
    server = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
    adminToken = (await login.json()).token;
  });
  after(async () => {
    if (server) await new Promise((done) => server.close(done));
    handle?.cleanup();
  });

  test('two independent overlapping requests cannot over-grant one finite PLANNED_ORDER', async () => {
    const alpha = new Worker('wave7-alpha'); const beta = new Worker('wave7-beta'); const control = new Worker('wave7-control');
    let held = false;
    try {
      const [a, b, c] = await Promise.all([alpha.run({ action: 'register' }), beta.run({ action: 'register' }), control.run({ action: 'register' })]);
      assert.equal(new Set([a.connectionId, b.connectionId, c.connectionId]).size, 3);
      await control.run({ action: 'hold-gate' }); held = true;
      const body = (n) => ({
        salesOrderId: `wave7-race-order-${n}`, salesOrderItemId: `wave7-race-line-${n}`,
        productId: 'wave7-race-product', warehouseId: 'wave7-race-warehouse', quantity: 8,
        reservationMode: 'EXPECTED_SUPPLY_RESERVATION', expectedSupplySourceType: 'PLANNED_ORDER',
        expectedSupplySourceId: 'wave7-race-supply', businessDate: DAY,
      });
      const pending = [
        alpha.run({ action: 'request-reservation', body: body(1) }),
        beta.run({ action: 'request-reservation', body: body(2) }),
      ];
      assert.equal(waitAtTransactionGate(db, [a.connectionId, b.connectionId]), true, 'both business transactions must overlap on independent sessions');
      await control.run({ action: 'release-gate' }); held = false;
      const results = await Promise.all(pending);
      assert.equal(results.filter((row) => row.status === 201).length, 1, JSON.stringify(results));
      assert.equal(results.filter((row) => row.status === 409 && row.code === 'SALES_RESERVATION_CAPACITY_EXCEEDED').length, 1, JSON.stringify(results));
      const active = db.prepare(`SELECT COUNT(*) n,COALESCE(SUM(quantity),0) quantity FROM planning_reservations
        WHERE supply_source_type='PLANNED_ORDER' AND supply_source_id='wave7-race-supply' AND status='ACTIVE'`).get();
      assert.deepEqual([Number(active.n), Number(active.quantity)], [1, 8]);
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM sales_reservation_intent WHERE intent_state='REQUESTED'`).get().n, 1);
    } finally {
      if (held) { try { await control.run({ action: 'release-gate' }); } catch {} }
      await Promise.all([alpha.close(), beta.close(), control.close()]);
    }
  });

  test('Gate competes with real apply, refund and UNAPPLIED reversal mutations on canonical PREPAYMENT parents', async () => {
    const now = new Date().toISOString();
    const seedBalance = (n, sourceType = 'WAVE7_RACE', sourceId = null) => {
      const balanceId = `wave7-fin-balance-${n}`;
      db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,
        original_amount_cents,business_date,settlement_account_id,status,created_by,created_at)
        VALUES(?,'CUSTOMER','PREPAYMENT',?,?,?,?,10000,?,'wave7-race-bank','OPEN','wave7-race-actor',?)`)
        .run(balanceId, `wave7-fin-customer-${n}`, sourceType, sourceId || balanceId, `W7-BAL-${n}`, DAY, now);
      return balanceId;
    };
    const seedAr = (n) => {
      db.prepare(`INSERT INTO account_receivables(id,voucher_no,customer_id,source_type,source_id,source_no,amount_cents,
        paid_cents,write_off_cents,status,due_date,business_date,recognition_mode,item_kind,conversion_state,item_class,
        settlement_account_id,creator_id,created_at,updated_at)
        VALUES(?,?,?,'WAVE7_RACE',?,?,10000,0,0,'PENDING',?,?,'INVOICE_DRIVEN_OPEN_ITEM','FINAL','OPEN','SOURCE',
          'wave7-race-bank','wave7-race-actor',?,?)`)
        .run(`wave7-fin-ar-${n}`, `W7-AR-${n}`, `wave7-fin-customer-${n}`, `wave7-fin-ar-${n}`, `W7-AR-${n}`, DAY, DAY, now, now);
    };
    seedAr(3);
    seedBalance(3);
    seedBalance(4);

    db.prepare(`INSERT INTO payment_collections(id,collection_no,customer_id,receivable_id,amount_cents,payment_method,
      collection_date,remark,creator_id,created_at,status,bank_account,confirmed_by,confirmed_at,updated_at,external_reference,
      reversed_amount_cents,reversal_status,settlement_account_id,unapplied_amount_cents,explicit_unapplied)
      VALUES('wave7-fin-collection-5','W7-COL-5','wave7-fin-customer-5',NULL,10000,'BANK',?,'','wave7-race-actor',?,
        'CONFIRMED','wave7-race-bank','wave7-race-actor',?,?,'',0,'NONE','wave7-race-bank',10000,1)`)
      .run(DAY, now, now, now);
    seedBalance(5, 'PAYMENT_COLLECTION', 'wave7-fin-collection-5');
    db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at)
      VALUES('wave7-fin-voucher-5','W7-V-5','PAYMENT_COLLECTION','wave7-fin-collection-5',?,'','wave7-race-actor',?)`).run(DAY, now);
    const bankSubjectId = db.prepare("SELECT id FROM accounting_subjects WHERE code='1002' AND active=1").get().id;
    const arSubjectId = db.prepare("SELECT id FROM accounting_subjects WHERE code='1122' AND active=1").get().id;
    db.prepare(`INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary)
      VALUES('wave7-fin-entry-5a','wave7-fin-voucher-5',?,'DEBIT',10000,'W7'),
            ('wave7-fin-entry-5b','wave7-fin-voucher-5',?,'CREDIT',10000,'W7')`).run(bankSubjectId, arSubjectId);
    db.prepare(`INSERT INTO settlement_account_movements(id,settlement_account_id,source_type,source_id,direction,amount_cents,business_date,voucher_id,created_at)
      VALUES('wave7-fin-movement-5','wave7-race-bank','PAYMENT_COLLECTION','wave7-fin-collection-5','IN',10000,?,'wave7-fin-voucher-5',?)`).run(DAY, now);

    const requestBody = (n) => ({
      salesOrderId: `wave7-fin-order-${n}`, salesOrderItemId: `wave7-fin-line-${n}`,
      productId: 'wave7-race-product', warehouseId: 'wave7-race-warehouse', quantity: 1,
      reservationMode: 'INVENTORY_LOCK', businessDate: DAY,
    });
    const scenarios = [
      { n: 3, action: 'apply-unapplied', body: { side: 'AR', balanceId: 'wave7-fin-balance-3', openItemId: 'wave7-fin-ar-3', amountCents: 10000, businessDate: DAY } },
      { n: 4, action: 'create-refund', key: 'wave7-refund-4', body: { side: 'CUSTOMER', balanceId: 'wave7-fin-balance-4', partyId: 'wave7-fin-customer-4', amountCents: 10000, businessDate: DAY, paymentMethod: 'BANK', settlementAccountId: 'wave7-race-bank', reason: 'Wave7 race' } },
      { n: 5, action: 'reverse-settlement', key: 'wave7-reverse-5', documentId: 'wave7-fin-collection-5', body: { businessDate: DAY, reason: 'Wave7 race', components: [{ type: 'UNAPPLIED', id: 'wave7-fin-balance-5', amountCents: 10000 }] } },
    ];

    for (const scenario of scenarios) {
      const gate = new Worker(`wave7-gate-${scenario.n}`); const finance = new Worker(`wave7-finance-${scenario.n}`); const control = new Worker(`wave7-control-${scenario.n}`);
      let held = false;
      try {
        const [g, f] = await Promise.all([gate.run({ action: 'register' }), finance.run({ action: 'register' })]);
        assert.notEqual(g.connectionId, f.connectionId);
        const authorizeAuditBefore = Number(db.prepare(`SELECT COUNT(*) n FROM audit_logs WHERE action='AUTHORIZE_MUTATION' AND entity_type='SALES_PREPAYMENT_GATE'`).get().n);
        await control.run({ action: 'hold-gate' }); held = true;
        const pendingGate = gate.run({ action: 'request-reservation', body: requestBody(scenario.n) });
        const pendingFinance = finance.run(scenario);
        assert.equal(waitAtTransactionGate(db, [g.connectionId, f.connectionId]), true, `race ${scenario.n} must overlap`);
        await control.run({ action: 'release-gate' }); held = false;
        const [gateResult, financeResult] = await Promise.all([pendingGate, pendingFinance]);
        assert.equal(financeResult.status, 201, JSON.stringify({ scenario, gateResult, financeResult }));
        assert.ok([201, 409].includes(gateResult.status), JSON.stringify(gateResult));
        if (gateResult.status === 409) {
          assert.equal(gateResult.code, 'SALES_PREPAYMENT_GATE_BLOCKED');
          assert.equal(db.prepare(`SELECT COUNT(*) n FROM sales_reservation_intent WHERE sales_order_id=?`).get(`wave7-fin-order-${scenario.n}`).n, 0);
          assert.equal(Number(db.prepare(`SELECT COUNT(*) n FROM audit_logs WHERE action='AUTHORIZE_MUTATION' AND entity_type='SALES_PREPAYMENT_GATE'`).get().n), authorizeAuditBefore);
        } else {
          assert.equal(db.prepare(`SELECT COUNT(*) n FROM sales_reservation_intent WHERE sales_order_id=?`).get(`wave7-fin-order-${scenario.n}`).n, 1);
        }
      } finally {
        if (held) { try { await control.run({ action: 'release-gate' }); } catch {} }
        await Promise.all([gate.close(), finance.close(), control.close()]);
      }
    }
  });

  test('PLANNING_RELEASE submit and DELIVERY confirm compete through real entries with all three Finance mutations', async () => {
    const now = new Date().toISOString();
    db.prepare("UPDATE products SET base_uom_code='EA',valuation_method='MOVING_AVERAGE',inventory_classification='FINISHED_GOOD',valuation_activated_at='2026-01-01' WHERE id='wave7-race-product'").run();
    db.prepare("INSERT IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES('EA','EA',1,?,?)").run(now, now);
    db.prepare("INSERT INTO sales_groups(id,group_code,name,active,created_at,updated_at) VALUES('wave7-race-group','W7-RACE','Wave7 Race',1,?,?)").run(now, now);
    db.prepare("INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES('wave7-race-salesperson','W7-RACE','Wave7 Race','wave7-race-actor',1,?,?)").run(now, now);
    db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,effective_from,is_default,active,created_at,updated_at,created_by,updated_by)
      VALUES('wave7-race-membership','wave7-race-salesperson','wave7-race-group','2026-01-01',1,1,?,?,?,?)`).run(now, now, 'wave7-race-actor', 'wave7-race-actor');
    db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,
      default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,active,created_at,updated_at)
      VALUES('wave7-race-class','wave7-race-product',1,'EA','EA',0,0,0,1,?,?)`).run(now, now);
    const priceListId = '77777777-7777-4777-8777-777777777778';
    db.prepare(`INSERT INTO sales_price_lists(id,price_list_code,name,currency_code,priority,effective_from,status,activated_at,activated_by,created_at,created_by,updated_at,updated_by)
      VALUES(?,'W7-RACE-PL','Wave7 Race Price','CNY',0,'2026-01-01','ACTIVE',?,'wave7-race-actor',?,'wave7-race-actor',?,'wave7-race-actor')`).run(priceListId, now, now, now);
    const materialKey = `M:${Buffer.from('wave7-race-product').toString('hex').toUpperCase()}`;
    const pricingKey = `U:${Buffer.from('EA').toString('hex').toUpperCase()}|Q:0000000000000000|D:20260101`;
    db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,material_identity_key,customer_scope_key,
      pricing_uom_code,pricing_identity_key,qty_break_min_micros,effective_from,created_at,created_by)
      VALUES('wave7-race-price',?,'wave7-race-product',NULL,'ALL',?,'A','EA',?,0,'2026-01-01',?,'wave7-race-actor')`).run(priceListId, materialKey, pricingKey, now);
    db.prepare("INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by) VALUES('wave7-race-price-v1','wave7-race-price',1,10000,'{}',?,'wave7-race-actor')").run(now);
    const wave7EntryPositionKey = computePositionKey({
      productId: 'wave7-race-product', warehouseId: 'wave7-race-warehouse',
      binId: null, ownerType: 'ENTERPRISE', ownerId: null,
      stockStatus: 'AVAILABLE', lotId: null, serialId: null,
    });
    db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at,
      position_key,bin_id,owner_type,owner_id,stock_status,lot_id,serial_id,active)
      VALUES('wave7-race-entry-inventory','wave7-race-warehouse','wave7-race-product',100,?,?,NULL,'ENTERPRISE',NULL,'AVAILABLE',NULL,NULL,1)
      ON DUPLICATE KEY UPDATE quantity=100,updated_at=VALUES(updated_at)`).run(now, wave7EntryPositionKey);
    db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES('NONE:wave7-race-warehouse:wave7-race-product','MOVING_AVERAGE','wave7-race-product','wave7-race-warehouse',NULL,NULL,100,50000,?)
      ON DUPLICATE KEY UPDATE quantity=100,value_cents=50000,updated_at=VALUES(updated_at)`).run(now);

    const seedCustomer = (suffix) => {
      const customerId = `wave7-entry-customer-${suffix}`;
      db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
        VALUES(?,?,?,'Receiver','13000000000','Wave7 address',1,?,?)`).run(customerId, `W7-E-${suffix}`, `Wave7 Entry ${suffix}`, now, now);
      db.prepare(`INSERT INTO customer_commercial_extensions(customer_id,effective_from,settlement_party_customer_id,payer_customer_id,
        default_salesperson_id,default_sales_group_id,default_payment_terms_days,default_settlement_method,sellable_scope_mode,created_at,updated_at,
        created_by,updated_by,default_pricing_list_id) VALUES(?,'2026-01-01',?,?,'wave7-race-salesperson','wave7-race-group',30,'MONTHLY','ALL_SALES_ENABLED',?,?,?,?,?)`)
        .run(customerId, customerId, customerId, now, now, 'wave7-race-actor', 'wave7-race-actor', priceListId);
      return customerId;
    };
    const createOrder = async (suffix) => {
      const customerId = seedCustomer(suffix);
      const created = await call('/api/sales-orders', { method: 'POST', key: `wave7-entry-create-${suffix}`, body: {
        customerId, orderDate: DAY, requestedDeliveryDate: DAY, shipToContactName: 'Receiver', shipToPhone: '13000000000',
        shipToAddress: 'Wave7 address', paymentTerms: 'MONTHLY', items: [{ productId: 'wave7-race-product', uomCode: 'EA', quantityDecimal: '1' }],
      } });
      assert.equal(created.status, 201, JSON.stringify(created.data));
      return { orderId: created.data.id, lineId: created.data.itemIds[0], customerId };
    };
    const prepareBusiness = async (stage, mutation, suffix) => {
      const order = await createOrder(suffix);
      let deliveryId = null;
      if (stage === 'DELIVERY') {
        db.prepare("UPDATE sales_orders SET status='APPROVED' WHERE id=?").run(order.orderId);
        const delivery = await call('/api/sales-deliveries', { method: 'POST', body: { sourceMode: 'DIRECT_ORDER', salesOrderId: order.orderId,
          warehouseId: 'wave7-race-warehouse', billingMode: 'LEGACY_DIRECT', deliveryDate: DAY,
          items: [{ salesOrderItemId: order.lineId, productId: 'wave7-race-product', quantity: 1 }] } });
        assert.equal(delivery.status, 201, JSON.stringify(delivery.data)); deliveryId = delivery.data.id;
        const oqc = await call('/api/oqc', { method: 'POST', body: { sales_delivery_id: deliveryId } });
        assert.equal(oqc.status, 201, JSON.stringify(oqc.data));
        const complete = await call(`/api/oqc/${oqc.data.id}/complete`, { method: 'POST', body: { result: 'PASS', inspection_quantity: 1, passed_quantity: 1, failed_quantity: 0 } });
        assert.equal(complete.status, 200, JSON.stringify(complete.data));
      }
      db.prepare(`INSERT INTO sales_prepayment_requirements(id,sales_order_id,line_no,required_amount_cents,ratio_basis,created_at,created_by)
        VALUES(?,?,0,10000,'ORDER_VALUE',?,'wave7-race-actor')`).run(`wave7-entry-req-${suffix}`, order.orderId, now);
      db.prepare(`INSERT INTO sales_prepayment_gate_results(id,sales_order_id,stage,gate_decision,required_remaining_cents,eligible_advance_cents,
        refunded_amount_cents,applied_amount_cents,source_balance_identities,snapshot_key,evaluated_at,evaluated_by)
        VALUES(?,?,?,'PASS',10000,10000,0,0,'[]',?,?,'wave7-race-actor')`).run(`wave7-entry-prior-${suffix}`, order.orderId, stage, `wave7-entry-prior-${suffix}`, now);
      const balanceId = `wave7-entry-balance-${suffix}`;
      let sourceType = 'WAVE7_RACE'; let sourceId = balanceId;
      if (mutation === 'reverse-settlement') {
        sourceType = 'PAYMENT_COLLECTION'; sourceId = `wave7-entry-collection-${suffix}`;
        db.prepare(`INSERT INTO payment_collections(id,collection_no,customer_id,receivable_id,amount_cents,payment_method,collection_date,remark,creator_id,created_at,status,
          bank_account,confirmed_by,confirmed_at,updated_at,external_reference,reversed_amount_cents,reversal_status,settlement_account_id,unapplied_amount_cents,explicit_unapplied)
          VALUES(?,?,?,NULL,10000,'BANK',?,'','wave7-race-actor',?,'CONFIRMED','wave7-race-bank','wave7-race-actor',?,?,'',0,'NONE','wave7-race-bank',10000,1)`)
          .run(sourceId, `W7-COL-${suffix}`, order.customerId, DAY, now, now, now);
      }
      db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,settlement_account_id,status,created_by,created_at)
        VALUES(?,'CUSTOMER','PREPAYMENT',?,?,?,?,10000,?,'wave7-race-bank','OPEN','wave7-race-actor',?)`)
        .run(balanceId, order.customerId, sourceType, sourceId, `W7-BAL-${suffix}`, DAY, now);
      let financeCommand;
      if (mutation === 'apply-unapplied') {
        const arId = `wave7-entry-ar-${suffix}`;
        db.prepare(`INSERT INTO account_receivables(id,voucher_no,customer_id,source_type,source_id,source_no,amount_cents,paid_cents,write_off_cents,status,due_date,business_date,
          recognition_mode,item_kind,conversion_state,item_class,settlement_account_id,creator_id,created_at,updated_at)
          VALUES(?,?,?,'WAVE7_RACE',?,?,10000,0,0,'PENDING',?,?,'INVOICE_DRIVEN_OPEN_ITEM','FINAL','OPEN','SOURCE','wave7-race-bank','wave7-race-actor',?,?)`)
          .run(arId, `W7-AR-${suffix}`, order.customerId, arId, `W7-AR-${suffix}`, DAY, DAY, now, now);
        financeCommand = { action: mutation, body: { side: 'AR', balanceId, openItemId: arId, amountCents: 10000, businessDate: DAY } };
      } else if (mutation === 'create-refund') {
        financeCommand = { action: mutation, key: `wave7-refund-${suffix}`, body: { side: 'CUSTOMER', balanceId, partyId: order.customerId,
          amountCents: 10000, businessDate: DAY, paymentMethod: 'BANK', settlementAccountId: 'wave7-race-bank', reason: 'Wave7 entry race' } };
      } else {
        const voucherId = `wave7-entry-voucher-${suffix}`;
        db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at)
          VALUES(?,?, 'PAYMENT_COLLECTION',?,?,'','wave7-race-actor',?)`).run(voucherId, `W7-V-${suffix}`, sourceId, DAY, now);
        const bankSubjectId = db.prepare("SELECT id FROM accounting_subjects WHERE code='1002' AND active=1").get().id;
        const arSubjectId = db.prepare("SELECT id FROM accounting_subjects WHERE code='1122' AND active=1").get().id;
        db.prepare(`INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES(?,?,?,?,10000,'W7'),(?,?,?,?,10000,'W7')`)
          .run(`wave7-entry-debit-${suffix}`, voucherId, bankSubjectId, 'DEBIT', `wave7-entry-credit-${suffix}`, voucherId, arSubjectId, 'CREDIT');
        db.prepare(`INSERT INTO settlement_account_movements(id,settlement_account_id,source_type,source_id,direction,amount_cents,business_date,voucher_id,created_at)
          VALUES(?,'wave7-race-bank','PAYMENT_COLLECTION',?,'IN',10000,?,?,?)`).run(`wave7-entry-move-${suffix}`, sourceId, DAY, voucherId, now);
        financeCommand = { action: mutation, key: `wave7-reverse-${suffix}`, documentId: sourceId, body: { businessDate: DAY, reason: 'Wave7 entry race', components: [{ type: 'UNAPPLIED', id: balanceId, amountCents: 10000 }] } };
      }
      return { ...order, deliveryId, stage, suffix, financeCommand };
    };

    const scenarios = [];
    for (const stage of ['PLANNING_RELEASE', 'DELIVERY']) {
      for (const mutation of ['apply-unapplied', 'create-refund', 'reverse-settlement']) {
        const suffix = `${stage === 'PLANNING_RELEASE' ? 'submit' : 'delivery'}-${mutation}`;
        scenarios.push(await prepareBusiness(stage, mutation, suffix));
      }
    }
    for (const scenario of scenarios) {
      const business = new Worker(`wave7-business-${scenario.suffix}`); const finance = new Worker(`wave7-finance-${scenario.suffix}`); const control = new Worker(`wave7-control-${scenario.suffix}`);
      let held = false;
      try {
        const [b, f] = await Promise.all([business.run({ action: 'register' }), finance.run({ action: 'register' })]);
        assert.notEqual(b.connectionId, f.connectionId);
        await control.run({ action: 'hold-gate' }); held = true;
        const businessCommand = scenario.stage === 'PLANNING_RELEASE'
          ? { action: 'submit-order', orderId: scenario.orderId, key: `wave7-submit-${scenario.suffix}`, body: {} }
          : { action: 'confirm-delivery', deliveryId: scenario.deliveryId, key: `wave7-delivery-${scenario.suffix}`, body: { action: 'confirm' } };
        const pendingBusiness = business.run(businessCommand); const pendingFinance = finance.run(scenario.financeCommand);
        assert.equal(waitAtTransactionGate(db, [b.connectionId, f.connectionId]), true, `${scenario.suffix} transactions must overlap`);
        await control.run({ action: 'release-gate' }); held = false;
        const [businessResult, financeResult] = await Promise.all([pendingBusiness, pendingFinance]);
        assert.equal(financeResult.status, 201, JSON.stringify({ scenario: scenario.suffix, businessResult, financeResult }));
        assert.ok([200, 409].includes(businessResult.status), JSON.stringify(businessResult));
        if (businessResult.status === 409) assert.equal(businessResult.code, 'SALES_PREPAYMENT_GATE_BLOCKED');
        if (scenario.stage === 'PLANNING_RELEASE') {
          const status = db.prepare('SELECT status FROM sales_orders WHERE id=?').get(scenario.orderId).status;
          assert.equal(status, businessResult.status === 200 ? 'SUBMITTED' : 'DRAFT');
          const submitFacts = [
            Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER' AND entity_id=? AND action='SUBMIT'").get(scenario.orderId).n),
            Number(db.prepare("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='SALES_ORDER_SUBMIT' AND document_id=?").get(scenario.orderId).n),
          ];
          assert.deepEqual(submitFacts, businessResult.status === 200 ? [1, 1] : [0, 0]);
        } else {
          const status = db.prepare('SELECT status FROM sales_deliveries WHERE id=?').get(scenario.deliveryId).status;
          const deliveryFacts = [
            Number(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='SALES_DELIVERY' AND source_id=?").get(scenario.deliveryId).n),
            Number(db.prepare("SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type='SALES_DELIVERY' AND source_id=?").get(scenario.deliveryId).n),
            Number(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_DELIVERY_COGS' AND source_id=?").get(scenario.deliveryId).n),
            Number(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_DELIVERY' AND source_id=?").get(scenario.deliveryId).n),
            Number(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='SALES_DELIVERY' AND source_id=?").get(scenario.deliveryId).n),
            Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_DELIVERY' AND entity_id=? AND action='CONFIRM'").get(scenario.deliveryId).n),
            Number(db.prepare("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='SALES_DELIVERY_CONFIRM' AND document_id=?").get(scenario.deliveryId).n),
          ];
          assert.equal(status, businessResult.status === 200 ? 'CONFIRMED' : 'DRAFT');
          assert.deepEqual(deliveryFacts, businessResult.status === 200 ? [1, 1, 1, 1, 1, 1, 1] : [0, 0, 0, 0, 0, 0, 0]);
        }
        const currentGate = Number(db.prepare("SELECT COUNT(*) n FROM sales_prepayment_gate_results WHERE sales_order_id=? AND stage=? AND snapshot_key LIKE 'ACTION|%'").get(scenario.orderId, scenario.stage).n);
        assert.equal(currentGate, businessResult.status === 200 ? 1 : 0);
      } finally {
        if (held) { try { await control.run({ action: 'release-gate' }); } catch {} }
        await Promise.all([business.close(), finance.close(), control.close()]);
      }
    }
  });

  test('Gate A A-PROD: Manual and Service compete with apply, refund and UNAPPLIED reversal through production entries', async () => {
    const now = new Date().toISOString();
    db.prepare(`INSERT IGNORE INTO finance_recognition_policy(id,side,source_type,source_id,recognition_mode,effective_date,active,created_by,created_at)
      VALUES('wave7-gate-a-service-policy','AR','SERVICE_FULFILLMENT',NULL,'DIRECT_BUSINESS_OPEN_ITEM','2020-01-01',1,'wave7-race-actor',?)`).run(now);

    const seed = (entry, mutation, suffix) => {
      const customerId = `gate-a-customer-${suffix}`;
      const productId = entry === 'service' ? `gate-a-service-product-${suffix}` : 'wave7-race-product';
      const orderId = `gate-a-order-${suffix}`;
      const lineId = `gate-a-line-${suffix}`;
      db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
        VALUES(?,?,?,'','','',1,?,?)`).run(customerId, `GA-${suffix}`, `Gate A ${suffix}`, now, now);
      if (entry === 'service') {
        db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy)
          VALUES(?,?,?,'EA',10000,0,1,?,?,'EA','NONE')`).run(productId, `GA-P-${suffix}`, `Gate A Service ${suffix}`, now, now);
        db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,service_classification,service_kind,active,created_at,updated_at,created_by,updated_by)
          VALUES(?,?,1,1,'STANDARD',1,?,?, 'wave7-race-actor','wave7-race-actor')`)
          .run(`gate-a-class-${suffix}`, productId, now, now);
      }
      db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,order_date,payment_terms_days)
        VALUES(?,?,?,'APPROVED',10000,'wave7-race-actor',?,?,?,0)`).run(orderId, `GA-SO-${suffix}`, customerId, now, now, DAY);
      db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,document_quantity_num,document_quantity_den)
        VALUES(?,?,?,1,10000,10000,1,1000000,1000000)`).run(lineId, orderId, productId);
      db.prepare(`INSERT INTO sales_prepayment_requirements(id,sales_order_id,line_no,required_amount_cents,ratio_basis,created_at,created_by)
        VALUES(?,?,0,10000,'ORDER_VALUE',?,'wave7-race-actor')`).run(`gate-a-req-${suffix}`, orderId, now);

      const balanceId = `gate-a-balance-${suffix}`;
      let sourceType = 'GATE_A'; let sourceId = balanceId;
      if (mutation === 'reverse-settlement') {
        sourceType = 'PAYMENT_COLLECTION'; sourceId = `gate-a-collection-${suffix}`;
        db.prepare(`INSERT INTO payment_collections(id,collection_no,customer_id,receivable_id,amount_cents,payment_method,collection_date,remark,creator_id,created_at,status,
          bank_account,confirmed_by,confirmed_at,updated_at,external_reference,reversed_amount_cents,reversal_status,settlement_account_id,unapplied_amount_cents,explicit_unapplied)
          VALUES(?,?,?,NULL,10000,'BANK',?,'','wave7-race-actor',?,'CONFIRMED','wave7-race-bank','wave7-race-actor',?,?,'',0,'NONE','wave7-race-bank',10000,1)`)
          .run(sourceId, `GA-COL-${suffix}`, customerId, DAY, now, now, now);
      }
      db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,settlement_account_id,status,created_by,created_at)
        VALUES(?,'CUSTOMER','PREPAYMENT',?,?,?,?,10000,?,'wave7-race-bank','OPEN','wave7-race-actor',?)`)
        .run(balanceId, customerId, sourceType, sourceId, `GA-BAL-${suffix}`, DAY, now);

      let finance;
      if (mutation === 'apply-unapplied') {
        const arId = `gate-a-ar-${suffix}`;
        db.prepare(`INSERT INTO account_receivables(id,voucher_no,customer_id,source_type,source_id,source_no,amount_cents,paid_cents,write_off_cents,status,due_date,business_date,
          recognition_mode,item_kind,conversion_state,item_class,settlement_account_id,creator_id,created_at,updated_at)
          VALUES(?,?,?,'GATE_A',?,?,10000,0,0,'PENDING',?,?,'INVOICE_DRIVEN_OPEN_ITEM','FINAL','OPEN','SOURCE','wave7-race-bank','wave7-race-actor',?,?)`)
          .run(arId, `GA-AR-${suffix}`, customerId, arId, `GA-AR-${suffix}`, DAY, DAY, now, now);
        finance = { action: mutation, body: { side: 'AR', balanceId, openItemId: arId, amountCents: 10000, businessDate: DAY } };
      } else if (mutation === 'create-refund') {
        finance = { action: mutation, key: `gate-a-refund-${suffix}`, body: { side: 'CUSTOMER', balanceId, partyId: customerId,
          amountCents: 10000, businessDate: DAY, paymentMethod: 'BANK', settlementAccountId: 'wave7-race-bank', reason: 'Gate A production race' } };
      } else {
        const voucherId = `gate-a-voucher-${suffix}`;
        db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at)
          VALUES(?,?,'PAYMENT_COLLECTION',?,?,'','wave7-race-actor',?)`).run(voucherId, `GA-V-${suffix}`, sourceId, DAY, now);
        const bankSubjectId = db.prepare("SELECT id FROM accounting_subjects WHERE code='1002' AND active=1").get().id;
        const arSubjectId = db.prepare("SELECT id FROM accounting_subjects WHERE code='1122' AND active=1").get().id;
        db.prepare(`INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES(?,?,?,?,10000,'GA'),(?,?,?,?,10000,'GA')`)
          .run(`gate-a-debit-${suffix}`, voucherId, bankSubjectId, 'DEBIT', `gate-a-credit-${suffix}`, voucherId, arSubjectId, 'CREDIT');
        db.prepare(`INSERT INTO settlement_account_movements(id,settlement_account_id,source_type,source_id,direction,amount_cents,business_date,voucher_id,created_at)
          VALUES(?,'wave7-race-bank','PAYMENT_COLLECTION',?,'IN',10000,?,?,?)`).run(`gate-a-move-${suffix}`, sourceId, DAY, voucherId, now);
        finance = { action: mutation, key: `gate-a-reverse-${suffix}`, documentId: sourceId,
          body: { businessDate: DAY, reason: 'Gate A production race', components: [{ type: 'UNAPPLIED', id: balanceId, amountCents: 10000 }] } };
      }

      let business;
      let fulfillmentId = null;
      if (entry === 'manual') {
        business = { action: 'evaluate-gate', orderId, stage: 'PLANNING_RELEASE',
          body: { businessDate: DAY, snapshotKey: `gate-a-manual-${suffix}` } };
      } else {
        fulfillmentId = `gate-a-fulfillment-${suffix}`;
        db.prepare(`INSERT INTO service_fulfillments(id,fulfillment_no,sales_order_id,sales_order_item_id,product_id,customer_id,
          confirmation_qty_micros,unit_price_cents,recognition_amount_cents,business_date,confirmation_state,version,created_at,updated_at,created_by,updated_by)
          VALUES(?,?,?,?,?,?,1000000,10000,0,?,'PENDING',1,?,?, 'wave7-race-actor','wave7-race-actor')`)
          .run(fulfillmentId, `GA-SF-${suffix}`, orderId, lineId, productId, customerId, DAY, now, now);
        business = { action: 'confirm-service', fulfillmentId, expectedVersion: 1, key: `gate-a-service-${suffix}` };
      }
      return { entry, mutation, suffix, orderId, balanceId, fulfillmentId, business, finance };
    };

    const scenarios = [];
    for (const entry of ['manual', 'service']) {
      for (const mutation of ['apply-unapplied', 'create-refund', 'reverse-settlement']) {
        scenarios.push(seed(entry, mutation, `${entry}-${mutation}`));
      }
    }
    for (const scenario of scenarios) {
      const business = new Worker(`gate-a-${scenario.suffix}-business`);
      const finance = new Worker(`gate-a-${scenario.suffix}-finance`);
      const control = new Worker(`gate-a-${scenario.suffix}-control`);
      let held = false;
      try {
        const [b, f] = await Promise.all([business.run({ action: 'register' }), finance.run({ action: 'register' })]);
        assert.notEqual(b.connectionId, f.connectionId);
        await control.run({ action: 'hold-gate' }); held = true;
        const pendingBusiness = business.run(scenario.business);
        const pendingFinance = finance.run(scenario.finance);
        assert.equal(waitAtTransactionGate(db, [b.connectionId, f.connectionId]), true, `${scenario.suffix}: production transactions overlap at L0`);
        await control.run({ action: 'release-gate' }); held = false;
        const [businessResult, financeResult] = await Promise.all([pendingBusiness, pendingFinance]);
        assert.equal(financeResult.status, 201, JSON.stringify({ scenario: scenario.suffix, financeResult }));
        if (scenario.entry === 'manual') {
          assert.equal(businessResult.status, 201, JSON.stringify(businessResult));
          assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM sales_prepayment_gate_results WHERE sales_order_id=? AND snapshot_key=?').get(
            scenario.orderId, `gate-a-manual-${scenario.suffix}`).n), 1);
        } else {
          assert.ok([200, 409].includes(businessResult.status), JSON.stringify(businessResult));
          const confirmed = businessResult.status === 200 ? 1 : 0;
          assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM service_fulfillments WHERE id=? AND confirmation_state='CONFIRMED'").get(scenario.fulfillmentId).n), confirmed);
          assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='SERVICE_FULFILLMENT' AND source_id=?").get(scenario.fulfillmentId).n), confirmed);
          assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SERVICE_FULFILLMENT' AND source_id=?").get(scenario.fulfillmentId).n), confirmed);
          assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SERVICE_FULFILLMENT' AND entity_id=? AND action='CONFIRM'").get(scenario.fulfillmentId).n), confirmed);
          assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='SERVICE_FULFILLMENT_CONFIRM' AND document_id=?").get(scenario.fulfillmentId).n), confirmed);
        }
      } finally {
        if (held) { try { await control.run({ action: 'release-gate' }); } catch {} }
        await Promise.all([business.close(), finance.close(), control.close()]);
      }
    }
  });

  test('Gate A A-REFUND M21-M24: Refund×Refund, Refund×Apply and Refund×Reversal conserve one parent and replay exactly', async () => {
    const now = new Date().toISOString();
    const seedParent = (suffix, mode) => {
      const customerId = `gate-a-ref-customer-${suffix}`;
      const balanceId = `gate-a-ref-balance-${suffix}`;
      db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES(?,?,?,'','','',1,?,?)`)
        .run(customerId, `GAR-${suffix}`, `Gate A Refund ${suffix}`, now, now);
      let sourceType = 'GATE_A'; let sourceId = balanceId;
      if (mode === 'reversal') {
        sourceType = 'PAYMENT_COLLECTION'; sourceId = `gate-a-ref-collection-${suffix}`;
        db.prepare(`INSERT INTO payment_collections(id,collection_no,customer_id,receivable_id,amount_cents,payment_method,collection_date,remark,creator_id,created_at,status,
          bank_account,confirmed_by,confirmed_at,updated_at,external_reference,reversed_amount_cents,reversal_status,settlement_account_id,unapplied_amount_cents,explicit_unapplied)
          VALUES(?,?,?,NULL,10000,'BANK',?,'','wave7-race-actor',?,'CONFIRMED','wave7-race-bank','wave7-race-actor',?,?,'',0,'NONE','wave7-race-bank',10000,1)`)
          .run(sourceId, `GAR-COL-${suffix}`, customerId, DAY, now, now, now);
      }
      db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,settlement_account_id,status,created_by,created_at)
        VALUES(?,'CUSTOMER','PREPAYMENT',?,?,?,?,10000,?,'wave7-race-bank','OPEN','wave7-race-actor',?)`)
        .run(balanceId, customerId, sourceType, sourceId, `GAR-BAL-${suffix}`, DAY, now);
      let other;
      if (mode === 'apply') {
        const arId = `gate-a-ref-ar-${suffix}`;
        db.prepare(`INSERT INTO account_receivables(id,voucher_no,customer_id,source_type,source_id,source_no,amount_cents,paid_cents,write_off_cents,status,due_date,business_date,
          recognition_mode,item_kind,conversion_state,item_class,settlement_account_id,creator_id,created_at,updated_at)
          VALUES(?,?,?,'GATE_A',?,?,10000,0,0,'PENDING',?,?,'INVOICE_DRIVEN_OPEN_ITEM','FINAL','OPEN','SOURCE','wave7-race-bank','wave7-race-actor',?,?)`)
          .run(arId, `GAR-AR-${suffix}`, customerId, arId, `GAR-AR-${suffix}`, DAY, DAY, now, now);
        other = { action: 'apply-unapplied', body: { side: 'AR', balanceId, openItemId: arId, amountCents: 10000, businessDate: DAY } };
      } else if (mode === 'reversal') {
        const voucherId = `gate-a-ref-voucher-${suffix}`;
        db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at) VALUES(?,?,'PAYMENT_COLLECTION',?,?,'','wave7-race-actor',?)`)
          .run(voucherId, `GAR-V-${suffix}`, sourceId, DAY, now);
        const bankSubjectId = db.prepare("SELECT id FROM accounting_subjects WHERE code='1002' AND active=1").get().id;
        const arSubjectId = db.prepare("SELECT id FROM accounting_subjects WHERE code='1122' AND active=1").get().id;
        db.prepare(`INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES(?,?,?,?,10000,'GAR'),(?,?,?,?,10000,'GAR')`)
          .run(`gate-a-ref-debit-${suffix}`, voucherId, bankSubjectId, 'DEBIT', `gate-a-ref-credit-${suffix}`, voucherId, arSubjectId, 'CREDIT');
        db.prepare(`INSERT INTO settlement_account_movements(id,settlement_account_id,source_type,source_id,direction,amount_cents,business_date,voucher_id,created_at)
          VALUES(?,'wave7-race-bank','PAYMENT_COLLECTION',?,'IN',10000,?,?,?)`).run(`gate-a-ref-move-${suffix}`, sourceId, DAY, voucherId, now);
        other = { action: 'reverse-settlement', key: `gate-a-ref-reverse-${suffix}`, documentId: sourceId,
          body: { businessDate: DAY, reason: 'Gate A refund race', components: [{ type: 'UNAPPLIED', id: balanceId, amountCents: 10000 }] } };
      }
      const refund = (key) => ({ action: 'create-refund', key, body: { side: 'CUSTOMER', balanceId, partyId: customerId,
        amountCents: 10000, businessDate: DAY, paymentMethod: 'BANK', settlementAccountId: 'wave7-race-bank', reason: 'Gate A refund race' } });
      return { customerId, balanceId, refund, other };
    };

    const race = async (label, leftCommand, rightCommand) => {
      const left = new Worker(`${label}-left`); const right = new Worker(`${label}-right`); const control = new Worker(`${label}-control`);
      let held = false;
      try {
        const [l, r] = await Promise.all([left.run({ action: 'register' }), right.run({ action: 'register' })]);
        await control.run({ action: 'hold-gate' }); held = true;
        const pending = [left.run(leftCommand), right.run(rightCommand)];
        assert.equal(waitAtTransactionGate(db, [l.connectionId, r.connectionId]), true, `${label}: both production transactions overlap at L0`);
        await control.run({ action: 'release-gate' }); held = false;
        return Promise.all(pending);
      } finally {
        if (held) { try { await control.run({ action: 'release-gate' }); } catch {} }
        await Promise.all([left.close(), right.close(), control.close()]);
      }
    };

    const rr = seedParent('m21', 'refund');
    const rrResults = await race('M21-refund-refund', rr.refund('gate-a-m21-left'), rr.refund('gate-a-m21-right'));
    assert.equal(rrResults.filter((row) => row.status === 201).length, 1, JSON.stringify(rrResults));
    assert.equal(rrResults.filter((row) => row.status === 409).length, 1, JSON.stringify(rrResults));

    const ra = seedParent('m22', 'apply');
    const raResults = await race('M22-refund-apply', ra.refund('gate-a-m22-refund'), ra.other);
    assert.equal(raResults.filter((row) => row.status === 201).length, 1, JSON.stringify(raResults));
    assert.equal(raResults.filter((row) => row.status === 409).length, 1, JSON.stringify(raResults));

    const rv = seedParent('m23', 'reversal');
    const rvResults = await race('M23-refund-reversal', rv.refund('gate-a-m23-refund'), rv.other);
    assert.equal(rvResults.filter((row) => row.status === 201).length, 1, JSON.stringify(rvResults));
    assert.equal(rvResults.filter((row) => row.status === 409).length, 1, JSON.stringify(rvResults));

    for (const fixture of [rr, ra, rv]) {
      const consumed = Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM financial_refunds WHERE balance_id=? AND status='CONFIRMED'").get(fixture.balanceId).n)
        + Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM balance_applications WHERE balance_id=? AND status='CONFIRMED'").get(fixture.balanceId).n)
        + Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM settlement_reversal_items WHERE component_type='UNAPPLIED' AND original_component_id=?").get(fixture.balanceId).n);
      assert.equal(consumed, 10000, `${fixture.balanceId}: exactly one full-capacity effect commits`);
    }

    const replayFixture = seedParent('m24', 'refund');
    const replayWorker = new Worker('M24-replay');
    try {
      const command = replayFixture.refund('gate-a-m24-exact');
      const first = await replayWorker.run(command); const replay = await replayWorker.run(command);
      assert.equal(first.status, 201); assert.equal(replay.status, 200);
      assert.equal(replay.body.id, first.body.id);
      assert.equal(replay.body.replayed, true);
      const durableCounts = () => ({
        refunds: Number(db.prepare('SELECT COUNT(*) n FROM financial_refunds WHERE balance_id=?').get(replayFixture.balanceId).n),
        vouchers: Number(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='FINANCIAL_REFUND' AND source_id=?").get(first.body.id).n),
        entries: Number(db.prepare("SELECT COUNT(*) n FROM accounting_entries ae JOIN accounting_vouchers av ON av.id=ae.voucher_id WHERE av.source_type='FINANCIAL_REFUND' AND av.source_id=?").get(first.body.id).n),
        movements: Number(db.prepare("SELECT COUNT(*) n FROM settlement_account_movements WHERE source_type='FINANCIAL_REFUND' AND source_id=?").get(first.body.id).n),
        audits: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='FINANCIAL_REFUND' AND entity_id=? AND action='CONFIRM'").get(first.body.id).n),
        idempotency: Number(db.prepare("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='REFUND_CONFIRM' AND document_id=?").get(`CUSTOMER:${replayFixture.balanceId}`).n),
      });
      const afterReplay = durableCounts();
      assert.deepEqual(afterReplay, { refunds: 1, vouchers: 1, entries: 2, movements: 1, audits: 1, idempotency: 1 });
      const conflict = await replayWorker.run({ ...command, body: { ...command.body, amountCents: 9999 } });
      assert.equal(conflict.status, 409);
      assert.deepEqual(durableCounts(), afterReplay, 'same-key conflict must create zero duplicate durable effects');
      const depleted = await replayWorker.run(replayFixture.refund('gate-a-m24-fresh'));
      assert.equal(depleted.status, 409);
      assert.deepEqual(durableCounts(), afterReplay, 'fresh key after depletion must create zero durable effects');
    } finally { await replayWorker.close(); }
  });

  test('Gate A M25: production Manual Gate exhausts bounded lock retries as 503 with zero durable side effects', async () => {
    const now = new Date().toISOString();
    const customerId = 'gate-a-m25-customer'; const orderId = 'gate-a-m25-order';
    const balanceId = 'gate-a-m25-balance'; const snapshotKey = 'gate-a-m25-snapshot';
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES(?,?,?,'','','',1,?,?)")
      .run(customerId, 'GA-M25', 'Gate A M25', now, now);
    db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,order_date) VALUES(?,?,?,'APPROVED',10000,'wave7-race-actor',?,?,?)")
      .run(orderId, 'GA-SO-M25', customerId, now, now, DAY);
    db.prepare("INSERT INTO sales_prepayment_requirements(id,sales_order_id,line_no,required_amount_cents,ratio_basis,created_at,created_by) VALUES('gate-a-m25-req',?,0,10000,'ORDER_VALUE',?,'wave7-race-actor')")
      .run(orderId, now);
    db.prepare("INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,status,created_by,created_at) VALUES(?,'CUSTOMER','PREPAYMENT',?,'GATE_A_M25',?,'GA-M25',10000,?,'OPEN','wave7-race-actor',?)")
      .run(balanceId, customerId, balanceId, DAY, now);
    const creditTableCount = Number(db.prepare(`SELECT COUNT(*) n FROM information_schema.tables
      WHERE table_schema=DATABASE() AND table_name='credit_check_results'`).get().n);
    assert.equal(creditTableCount, 0, 'pre-Wave10 Gate A must not require the Gate B credit_check_results table');
    const sideEffectTables = [
      'sales_prepayment_gate_results', 'financial_refunds', 'financial_refund_reversals',
      'accounting_vouchers', 'accounting_entries', 'settlement_account_movements', 'balance_applications',
      'settlement_reversal_items', 'service_fulfillments', 'sales_deliveries', 'inventory_transactions',
      'inventory_mutation_log', 'inventory_locks', 'planning_reservations', 'sales_reservation_intent',
      'account_receivables', 'sales_orders', 'sales_order_items', 'idempotency_records', 'audit_logs',
    ];
    const beforeCounts = Object.fromEntries(sideEffectTables.map((table) => [
      table, Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n),
    ]));

    const savedTxRetries = process.env.ERP_DB_TX_RETRY_MAX;
    const savedGateAttempts = process.env.ERP_GATE_ATTEMPTS_MAX;
    process.env.ERP_DB_TX_RETRY_MAX = '0';
    process.env.ERP_GATE_ATTEMPTS_MAX = '1';
    const holder = new Worker('M25-parent-holder');
    let held = false;
    try {
      const h = await holder.run({ action: 'register' });
      const productionConnectionId = Number(db.prepare('SELECT CONNECTION_ID() id').get().id);
      assert.notEqual(h.connectionId, productionConnectionId);
      await holder.run({ action: 'hold-parent', balanceId }); held = true;
      const result = await call(`/api/sales-orders/${orderId}/prepayment-gate/PLANNING_RELEASE`, {
        method: 'POST', body: { businessDate: DAY, snapshotKey },
      });
      assert.equal(result.status, 503, JSON.stringify(result));
      assert.equal(result.data.code, 'SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED');
      assert.equal(result.data.error, '预付款门评估重试次数已耗尽，请稍后重试');
      assert.equal(result.data.message, '预付款门评估重试次数已耗尽，请稍后重试');
      assert.deepEqual(result.data.details, {
        code: 'SALES_PREPAYMENT_GATE_RETRY_EXHAUSTED', retryable: true, attempts: 1, cause: 'ER_LOCK_WAIT_TIMEOUT',
      });
      for (const table of sideEffectTables) {
        assert.equal(Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n), beforeCounts[table], `${table}: retry exhaustion must commit no durable side effect`);
      }
    } finally {
      if (held) { try { await holder.run({ action: 'release-parent' }); } catch {} }
      await holder.close();
      if (savedTxRetries == null) delete process.env.ERP_DB_TX_RETRY_MAX; else process.env.ERP_DB_TX_RETRY_MAX = savedTxRetries;
      if (savedGateAttempts == null) delete process.env.ERP_GATE_ATTEMPTS_MAX; else process.env.ERP_GATE_ATTEMPTS_MAX = savedGateAttempts;
    }
  });
});
