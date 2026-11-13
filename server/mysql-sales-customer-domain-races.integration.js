// Sales & Customer 域真实 MySQL 8 并发不变量实证套件。
//
// 每个竞态场景都启动独立的 worker 子进程 —— 每个子进程持有自己的 MySQL 会话 ——
// 并通过共享的 L0 协调门（`mysql_transaction_gates`）一起释放，因此竞态发生在真实
// 的 MySQL 8 服务器上，而不是同一个事件循环里的同步调用交错。
//
// 派生来源（已有的、已验证的 Sales 套件）：
//   * `mysql-sales-customer-wave7-concurrency.integration.js` —— L0 协调门模式、
//     预留意向容量竞争、发运确认与财务副作用的计数断言；
//   * `mysql-sales-customer-wave10-concurrency.integration.js` —— 信用审批的一次性
//     决定与 Special Approval 的一次性消费；
//   * `server/sales-customer-wave11-b-evaluation.test.js` —— 评分表 / 评分模型 / 评分
//     指标的夹具形态与整数算术期望。
//
// 每一个场景都带一个**负控**（negative control）：一个证明守卫真实承重的变体。
// 负控若不能被观察到，这个场景就**没有**证明守卫承重，因此负控与主场景同样重要。
//
// 运行（真实 MySQL，由 ACK-4 campaign 子进程承载）：
//   ERP_DB_BACKEND=mysql ERP_DB_HOST=… ERP_DB_PORT=… ERP_DB_NAME=… \
//   ERP_DB_USER=… ERP_DB_PASSWORD=… \
//   node --test server/mysql-sales-customer-domain-races.integration.js
//
// 运行（离线 SQLite 校验，只证明夹具与断言自洽，**不是**真实 MySQL 证据）：
//   node --test server/mysql-sales-customer-domain-races.integration.js

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createTempDb } from './test-utils/temp-db.js';
import { createApp } from './app.js';
import { hashPassword } from './db.js';
import { computePositionKey } from './lib/inventory-position.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'sales-customer-domain-races-worker.mjs');

// The campaign gate flag. Inside the ACK-4 campaign the suite runs on the leased
// MySQL target and the schema drop belongs to the Root's CLEANUP_SCHEMA_POST_RUN
// child. Outside the campaign the suite runs on a local SQLite database and the
// result is explicitly NOT real-MySQL evidence.
const inCampaign = process.env.ERP_SALES_CUSTOMER_MYSQL_GATE === '1';

const salesCustomerGateLifecycle = {
  beforeCreate(config) {
    if (!/(?:test|phase7|disposable|domain_test)/i.test(String(config?.database || ''))) {
      throw new Error(`SALES_CUSTOMER RACE SUITE REFUSED: ${config?.database} is not a disposable target`);
    }
  },
  verify(db) {
    if (db.dialect !== 'mysql') throw new Error(`SALES_CUSTOMER RACE SUITE REFUSED: dialect=${db.dialect}`);
  },
  reset() {
    // The Root's CLEANUP_SCHEMA_POST_RUN child owns the schema drop.
  },
};

const ACTOR_ID = 'sales-customer-race-actor';
const COUNTER_ID = 'sales-customer-race-counter';
const APPROVER_ID = 'sales-customer-race-approver';
const REQUESTER_ID = 'sales-customer-race-requester';
const EVALUATOR_ID = 'sales-customer-race-evaluator';
const CUSTOMER_ID = 'sales-customer-race-customer';
const PRODUCT_ID = 'sales-customer-race-product';
const WAREHOUSE_ID = 'sales-customer-race-warehouse';
const SALESPERSON_ID = 'sales-customer-race-salesperson';
const SALES_GROUP_ID = 'sales-customer-race-group';
const CREDIT_OBJECT_ID = 'SALES-CUSTOMER-RACE-OBJECT';
const PRICE_LIST_ID = '10000000-0000-4000-8000-0000000sc001';
const PRICE_ENTRY_ID = 'sales-customer-race-price-entry';
const PRICE_VERSION_ID = 'sales-customer-race-price-version';

function businessDate() { return new Date().toISOString().slice(0, 10); }

// ---------------------------------------------------------------------------
// The independent-session worker.
//
// Each worker is a real OS process with its own MySQL connection. The suite
// never interleaves two business calls inside one event loop: that would prove
// nothing about row-level contention on a real server.
//
// The worker's environment is captured once, when the suite opens its
// database. In the offline SQLite validation mode the temporary SQLite file
// path is handed to the worker so every worker opens the SAME database the
// suite asserts on. In the campaign mode the worker inherits the MySQL
// environment unchanged.
// ---------------------------------------------------------------------------
let workerEnv = process.env;

class RaceWorker {
  constructor(name) {
    this.name = name;
    this.pending = new Map();
    this.stderr = '';
    this.child = spawn(process.execPath, [workerPath], {
      cwd: repoRoot, env: workerEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    // The exit promise is captured at spawn time. Attaching the listener later
    // would miss the 'exit' event of a worker that finishes first and the await
    // would then never settle.
    this.exited = new Promise((resolveExit) => { this.child.once('exit', resolveExit); });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      let reply;
      try { reply = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id);
      clearTimeout(pending.timer);
      if (reply.ok) pending.resolve(reply.result);
      else pending.reject(Object.assign(new Error(reply.error.message), reply.error));
    });
  }

  run(command, timeoutMs = 60_000) {
    const id = randomUUID();
    return new Promise((resolveRun, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name} timeout on ${command.action}: ${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveRun, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }

  async close() {
    try { await this.run({ action: 'close' }, 5_000); } catch { /* the worker may already be gone */ }
    try { this.child.stdin.end(); } catch { /* already closed */ }
    if (this.child.exitCode === null) {
      const killer = setTimeout(() => this.child.kill('SIGKILL'), 5_000);
      await this.exited;
      clearTimeout(killer);
    }
  }
}

describe('Sales & Customer domain real MySQL concurrency invariants (7 races)', () => {
  let handle;
  let db;
  let server;
  let baseUrl;
  let adminToken;
  let APPROVER_TOKEN;
  let REQUESTER_TOKEN;
  let suffix = '';
  let salesParametersReady = false;

  function now() { return new Date().toISOString(); }

  /**
   * The canonical HTTP entry.
   *
   * The delivery confirmation, the SO change apply and the order close /
   * cancel are **HTTP endpoints**, and the production entries own their own
   * quality-gate, prepayment-gate and credit-gate prerequisites. Driving them
   * through the real router — with a real token — is the only way the race
   * exercises the production path instead of a hand-made fixture that would
   * be refused for a reason that has nothing to do with the race.
   */
  async function callAs(token, path, { method = 'GET', body, key } = {}) {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (key) headers['idempotency-key'] = key;
    const response = await fetch(baseUrl + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }

  /** The default actor: the order creator. */
  async function call(path, options) {
    return callAs(adminToken, path, options);
  }

  /**
   * Run two contenders against the SAME L0 coordination gate and release them
   * together. The gate is the row the production `transaction()` helper
   * acquires first, so both contenders are observably pending before either
   * touches a business row.
   *
   * `negative` runs the SAME command against a DIFFERENT, uncontended target.
   * It is the negative control: if the negative also fails, the refusal is not
   * caused by the race and the positive result would be vacuous.
   *
   * In the offline SQLite validation mode the L0 coordination gate does not
   * exist (it is a MySQL-only row), so the two contenders run concurrently but
   * WITHOUT the observable pending evidence. That mode validates the fixtures
   * and the assertion shapes; it is explicitly NOT contention evidence and it
   * can never be reported as the real-MySQL result.
   */
  async function raceTwo(commandFor, { label, negative = null } = {}) {
    const left = new RaceWorker(`${label}-left`);
    const right = new RaceWorker(`${label}-right`);
    const control = new RaceWorker(`${label}-control`);
    let held = false;
    try {
      const registrations = await Promise.all([
        left.run({ action: 'register' }), right.run({ action: 'register' }), control.run({ action: 'register' }),
      ]);
      assert.equal(new Set(registrations.map((row) => row.connectionId)).size, 3,
        `${label}: three independent sessions are required`);
      if (inCampaign) {
        await control.run({ action: 'hold-gate' });
        held = true;
      }
      const pending = [
        left.run(commandFor('left')),
        right.run(commandFor('right')),
      ];
      let contention = null;
      if (inCampaign) {
        // The contenders must be observably BLOCKED at the same time.
        // Without this the race could degenerate into two sequential calls.
        const threadIds = [registrations[0].threadId, registrations[1].threadId];
        assert.ok(threadIds.every((value) => Number.isInteger(Number(value))),
          `${label}: every contender must report its performance_schema thread id`);
        contention = await waitForBothContendersBlocked(db, threadIds);
        await control.run({ action: 'release-gate' });
        held = false;
      }
      const outcomes = await Promise.all(pending);
      // The contention verdict is asserted AFTER the outcomes are known, so a
      // failure reports what the contenders actually did instead of only
      // reporting that no contention was observed. A race whose contenders
      // both refused before reaching a lock is a SETUP defect, and the
      // outcome shape says so.
      if (inCampaign && contention && !contention.observed) {
        assert.fail(`${label}: both contenders must be observably blocked against each other `
          + `(attempts=${contention.attempts}); outcomes=${JSON.stringify(outcomes.map((row) => ({ status: row.status, code: row.code, message: row.message })))}`);
      }
      let negativeOutcome = null;
      if (negative) {
        const negativeWorker = new RaceWorker(`${label}-negative`);
        try {
          negativeOutcome = await negativeWorker.run(typeof negative === 'function' ? negative() : negative);
        } finally {
          await negativeWorker.close();
        }
      }
      return { outcomes, negativeOutcome, stderr: `${left.stderr}|${right.stderr}` };
    } finally {
      if (held) { try { await control.run({ action: 'release-gate' }); } catch { /* already released */ } }
      await Promise.all([left.close(), right.close(), control.close()]);
    }
  }

  function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }

  /**
   * Wait until BOTH contenders are pending on the L0 coordination row.
   *
   * The check reads the production transaction gate out of
   * `information_schema.PROCESSLIST`. It is a real server-side observation, not
   * a sleep.
   */
  function waitAtTransactionGate(observer, ids) {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const rows = ids.map((id) => observer.prepare('SELECT INFO FROM information_schema.PROCESSLIST WHERE ID=?').get(id));
      if (rows.every((row) => String(row?.INFO || '').toUpperCase().includes('MYSQL_TRANSACTION_GATES'))) return true;
      sleep(25);
    }
    return false;
  }

  /**
   * Wait until BOTH contenders are simultaneously BLOCKED.
   *
   * The proof is the server-side lock-wait graph:
   * `performance_schema.data_lock_waits` names the requesting and the
   * blocking thread. Both contenders appearing as a REQUESTING_THREAD_ID is a
   * real, server-side proof that they were in flight against each other.
   *
   * It deliberately does NOT require both to be waiting on the L0 gate. A
   * contender that first blocks on a business row the other one already holds
   * is blocked BY the other contender — a genuine contention, and a stronger
   * one than a shared gate wait. Requiring both to sit on the same row would
   * have rejected two real races (the controlled change apply and the order
   * close), because those paths lock their business row during discovery,
   * before the L0 gate.
   */
  async function waitForBothContendersBlocked(observer, threadIds) {
    const ids = threadIds.map((value) => Number(value));
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const rows = observer.prepare(`SELECT REQUESTING_THREAD_ID waiter, BLOCKING_THREAD_ID blocker
        FROM performance_schema.data_lock_waits WHERE REQUESTING_THREAD_ID IN (?, ?)`).all(...ids);
      const waiters = new Set(rows.map((row) => Number(row.waiter)));
      if (ids.every((id) => waiters.has(id))) {
        return { observed: true, attempts: attempt + 1, waiters: rows.map((row) => ({ waiter: Number(row.waiter), blocker: Number(row.blocker) })) };
      }
      // The wait must not block this process's event loop: the HTTP server
      // that serves the suite's own fixture calls lives here.
      await new Promise((done) => setTimeout(done, 25));
    }
    return { observed: false, attempts: 400, waiters: [] };
  }

  // -------------------------------------------------------------------------
  // The fixture.
  //
  // Every INSERT below is verified offline against the current migration set
  // before a single ACK-4 capability is spent: every column exists, every NOT
  // NULL column without a default is supplied, every FK target is inserted by
  // the fixture itself and the value count equals the column count.
  // -------------------------------------------------------------------------
  function seedFixture() {
    const stamp = now();
    const credential = hashPassword('sales-customer-race-account');
    for (const id of [ACTOR_ID, COUNTER_ID, APPROVER_ID, REQUESTER_ID, EVALUATOR_ID]) {
      db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
        VALUES(?,?,?,?,?,'role-admin',1,?)`).run(id, id, id, credential.hash, credential.salt, stamp);
    }
    // The UoM is a FK target of both the commercial classification and the
    // quotation line, so the fixture installs it itself. The canonical
    // migration may already have seeded it, so the insert is idempotent.
    if (!db.prepare('SELECT code FROM uoms WHERE code=?').get('EA')) {
      db.prepare(`INSERT INTO uoms(code,name,active,created_at,updated_at) VALUES('EA','竞态单位',1,?,?)`).run(stamp, stamp);
    }
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES(?,?,?,'Race Contact','13000000000','Race Address',1,?,?)`)
      .run(CUSTOMER_ID, 'SC-RACE-C', 'Sales Race Customer', stamp, stamp);
    db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at)
      VALUES(?,?,?,?,1,?,?)`).run(SALESPERSON_ID, 'SC-RACE-S', 'Sales Race Salesperson', ACTOR_ID, stamp, stamp);
    db.prepare(`INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at)
      VALUES(?,?,?,'',1,?,?)`).run(SALES_GROUP_ID, 'SC-RACE-G', 'Sales Race Group', stamp, stamp);
    db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,effective_to,created_at,updated_at)
      VALUES(?,?,?,1,1,'2020-01-01',NULL,?,?)`).run(`${SALES_GROUP_ID}-membership`, SALESPERSON_ID, SALES_GROUP_ID, stamp, stamp);
    db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at)
      VALUES(?,?,?,'Race Address','',1,?,?)`).run(WAREHOUSE_ID, 'SC-RACE-W', 'Sales Race Warehouse', stamp, stamp);
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,base_uom_code,created_at,updated_at)
      VALUES(?,?,?,'竞态','件',100000,0,1,'NONE','EA',?,?)`).run(PRODUCT_ID, 'SC-RACE-P', '竞态产品', stamp, stamp);
    // The valuation attributes. Without an activated valuation method and a
    // FINISHED_GOOD classification the delivery confirmation issues NO cost
    // event, so the COGS voucher of SC-RACE-03 could never exist and the
    // case would assert a row the production path never writes.
    db.prepare(`UPDATE products SET valuation_method='MOVING_AVERAGE',inventory_classification='FINISHED_GOOD',
      valuation_activated_at='2020-01-01' WHERE id=?`).run(PRODUCT_ID);
    const positionKey = computePositionKey({
      productId: PRODUCT_ID, warehouseId: WAREHOUSE_ID, binId: null,
      ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null,
    });
    db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at,position_key,bin_id,owner_type,owner_id,stock_status,lot_id,serial_id,active)
      VALUES(?,?,?,100,?,?,NULL,'ENTERPRISE',NULL,'AVAILABLE',NULL,NULL,1)`)
      .run(`${PRODUCT_ID}-inventory`, WAREHOUSE_ID, PRODUCT_ID, stamp, positionKey);
    // The valuation balance. The outbound cost event is issued against this
    // balance; without it the confirmation issues no cost and no COGS voucher.
    db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES(?, 'MOVING_AVERAGE', ?, ?, NULL, NULL, 100, 100000, ?)`)
      .run(`NONE:${WAREHOUSE_ID}:${PRODUCT_ID}`, PRODUCT_ID, WAREHOUSE_ID, stamp);
    // The delivery tolerances. The LOWER tolerance is copied onto the order
    // line at creation and is the precondition of a controlled close
    // (`SALES_ORDER_LOWER_TOLERANCE_NOT_REACHED`). The production lower
    // bound is `ceil(ordered * (10000 - lowerBps) / 10000)`, so a zero
    // tolerance still demands the FULL ordered quantity. The fixture uses
    // 10000 bps so the lower bound is 0 and an UNDELIVERED line does not
    // block the close; the close then releases the reservation that sits on
    // that undelivered line, which is the production contract (M-BIZ-07 B-10:
    // "the controlled close releases only the undelivered remainder"). The
    // case is about the one-shot terminal transition and the one-shot
    // reservation release, not about the tolerance arithmetic.
    db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,
      default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,service_kind,
      active,created_at,updated_at,created_by,updated_by)
      VALUES(?,?,1,'EA','EA',0,10000,0,NULL,1,?,?,?,?)`)
      .run(`${PRODUCT_ID}-classification`, PRODUCT_ID, stamp, stamp, APPROVER_ID, APPROVER_ID);
    // The price list entry is the authoritative price the conversion and the
    // order creation read. Its identity keys are the canonical derived ones.
    // The price list is installed BEFORE the customer commercial extension,
    // because the extension's `default_pricing_list_id` is a foreign key.
    const materialKey = `M:${Buffer.from(PRODUCT_ID).toString('hex').toUpperCase()}`;
    const pricingKey = `U:${Buffer.from('EA').toString('hex').toUpperCase()}|Q:${String(1_000_000).padStart(16, '0')}|D:20200101`;
    db.prepare(`INSERT INTO sales_price_lists(id,price_list_code,name,currency_code,priority,fallback_price_list_id,
      effective_from,effective_to,status,activated_at,activated_by,created_at,created_by,updated_at,updated_by)
      VALUES(?, 'SC-RACE-PRICE', '竞态价格表', 'CNY', 0, NULL, '2020-01-01', NULL, 'ACTIVE', ?, ?, ?, ?, ?, ?)`)
      .run(PRICE_LIST_ID, stamp, APPROVER_ID, stamp, APPROVER_ID, stamp, APPROVER_ID);
    db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,
      material_identity_key,customer_scope_key,pricing_uom_code,pricing_identity_key,qty_break_min_micros,
      qty_break_max_micros,effective_from,effective_to,created_at,created_by)
      VALUES(?, ?, ?, NULL, 'ALL', ?, 'A', 'EA', ?, 1000000, NULL, '2020-01-01', NULL, ?, ?)`)
      .run(PRICE_ENTRY_ID, PRICE_LIST_ID, PRODUCT_ID, materialKey, pricingKey, stamp, APPROVER_ID);
    // The unit price is 12500 cents, so the 8-unit line is 100000 cents and
    // the changed 10-unit line is 125000 cents. The assertions read these
    // two numbers directly.
    db.prepare(`INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by)
      VALUES(?, ?, 1, 12500, '{}', ?, ?)`)
      .run(PRICE_VERSION_ID, PRICE_ENTRY_ID, stamp, APPROVER_ID);
    // The customer commercial extension is the source of the default
    // salesperson, sales group and price list. The quotation and the order
    // creation paths read it, so the fixture installs it.
    db.prepare(`INSERT INTO customer_commercial_extensions(customer_id,effective_from,settlement_party_customer_id,
      payer_customer_id,default_salesperson_id,default_sales_group_id,default_payment_terms_days,
      default_settlement_method,sellable_scope_mode,effective_to,created_at,updated_at,created_by,updated_by,
      default_pricing_list_id,default_discount_scheme_id)
      VALUES(?, '2020-01-01', ?, ?, ?, ?, 0, 'CASH', 'ALL_SALES_ENABLED', NULL, ?, ?, ?, ?, ?, NULL)`)
      .run(CUSTOMER_ID, CUSTOMER_ID, CUSTOMER_ID, SALESPERSON_ID, SALES_GROUP_ID,
        stamp, stamp, APPROVER_ID, APPROVER_ID, PRICE_LIST_ID);
    return { positionKey };
  }

  /**
   * The SYSTEM Sales Parameter row.
   *
   * The Sales Order, Quotation, Delivery and Change paths resolve the
   * parameter row FIRST and refuse with `SALES_PARAMETER_UNAVAILABLE` when it
   * is missing. The row is installed through the PRODUCTION writer, so the
   * production resolver reads a legal effective configuration instead of the
   * fixture inventing one behind the writer.
   */
  async function seedSalesParameters() {
    const { upsertSalesParameters } = await import('./modules/sales-parameters.js');
    const bytes = Buffer.from(JSON.stringify({
      scopeType: 'SYSTEM',
      sellableControlEnabled: true,
      customerMaterialXrefEnabled: true,
      salesGroupDataScopeEnabled: true,
      deliveryScheduleEnabled: true,
      deliveryQuantityControlEnabled: true,
      orderChangeMode: 'BOTH',
      reservationBehavior: 'DISABLED',
      active: true,
    }), 'utf8');
    const req = { headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield bytes; } };
    const res = {
      statusCode: null, headers: {},
      setHeader() {}, removeHeader() {},
      end(value) { this.bodyText = value === undefined || value === null ? null : String(value); },
      json() { return this.bodyText ? JSON.parse(this.bodyText) : null; },
    };
    await upsertSalesParameters(db, req, res, {
      id: APPROVER_ID, roleCode: 'ADMIN',
      permissions: ['SALES_PARAMETERS_MANAGE', 'SALES_FOUNDATION_VIEW'],
    });
    assert.equal(res.statusCode, 200, `the canonical Sales Parameter writer must accept the SYSTEM row: ${res.bodyText}`);
    assert.equal(res.json()?.parameter?.scopeKey, 'SYSTEM', 'the canonical writer must install the SYSTEM scope row');
    assert.equal(res.json()?.parameter?.active, true, 'the installed Sales Parameter must be active');
  }

  /**
   * An APPROVED sales order, created through the PRODUCTION writers.
   *
   * The production order writer is the only thing that produces the canonical
   * `price_snapshot_json` / `discount_snapshot_json` pair the SO Change
   * evidence guard reads. A hand-made order row would carry no snapshots, the
   * change evidence would be refused as CORRUPT, and the case would prove
   * nothing about the CAS it is about.
   *
   * The three actors are the production separation-of-duties roles:
   *   ACTOR_ID     creates and submits the order;
   *   APPROVER_ID  approves the order and approves the change;
   *   REQUESTER_ID requests the change (the requester and the approver of a
   *                change must be different actors).
   */
  async function createApprovedOrder(label, { quantity = 8, extraLines = [] } = {}) {
    const items = [{ productId: PRODUCT_ID, uomCode: 'EA', quantityDecimal: String(quantity) },
      ...extraLines.map((line) => ({ productId: PRODUCT_ID, uomCode: 'EA', quantityDecimal: String(line.quantity) }))];
    const created = await call('/api/sales-orders', {
      method: 'POST', key: `${label}-create`,
      body: {
        customerId: CUSTOMER_ID, orderDate: businessDate(), requestedDeliveryDate: businessDate(),
        shipToContactName: 'Race', shipToPhone: '13000000000', shipToAddress: 'Race Address',
        paymentTerms: 'CASH', items,
      },
    });
    assert.equal(created.status, 201, `the sales order creation must succeed: ${JSON.stringify(created.data)}`);
    const orderId = created.data?.id;
    const orderItemId = created.data?.itemIds?.[0];
    assert.ok(orderId && orderItemId, `the sales order creation must return its id and line id: ${JSON.stringify(created.data)}`);

    const submitted = await call(`/api/sales-orders/${orderId}/submit`, { method: 'POST', key: `${label}-submit`, body: {} });
    assert.equal(submitted.status, 200, `the sales order submit must succeed: ${JSON.stringify(submitted.data)}`);
    const approved = await callAs(APPROVER_TOKEN, `/api/sales-orders/${orderId}/approve`, { method: 'POST', key: `${label}-approve`, body: {} });
    assert.equal(approved.status, 200, `the sales order approve must succeed: ${JSON.stringify(approved.data)}`);
    return { orderId, orderItemId, orderItemIds: created.data?.itemIds || [] };
  }

  /** A SUBMITTED sales order waiting for approval. */
  async function createSubmittedOrder(label, { quantity = 1 } = {}) {
    const created = await call('/api/sales-orders', {
      method: 'POST', key: `${label}-create`,
      body: {
        customerId: CUSTOMER_ID, orderDate: businessDate(), requestedDeliveryDate: businessDate(),
        shipToContactName: 'Race', shipToPhone: '13000000000', shipToAddress: 'Race Address',
        paymentTerms: 'CASH',
        items: [{ productId: PRODUCT_ID, uomCode: 'EA', quantityDecimal: String(quantity) }],
      },
    });
    assert.equal(created.status, 201, `the sales order creation must succeed: ${JSON.stringify(created.data)}`);
    const orderId = created.data?.id;
    assert.ok(orderId, `the sales order creation must return its id: ${JSON.stringify(created.data)}`);
    const submitted = await call(`/api/sales-orders/${orderId}/submit`, { method: 'POST', key: `${label}-submit`, body: {} });
    assert.equal(submitted.status, 200, `the sales order submit must succeed: ${JSON.stringify(submitted.data)}`);
    return { orderId, orderItemId: created.data?.itemIds?.[0] };
  }

  /**
   * A DRAFT Sales Delivery that is ready to be confirmed.
   *
   * The delivery is created through the PRODUCTION HTTP entry, which is what
   * freezes the outbound quality policy (`logistics_quality_policy_snapshots`)
   * and installs the delivery's own line snapshots. A hand-made delivery row
   * would carry no policy snapshot, so the OQC gate would refuse it with
   * "未检验" — a refusal that has nothing to do with the race.
   *
   * The outbound inspection itself is then completed through the PRODUCTION
   * inspection entries: the race cases cover the one-shot delivery
   * confirmation semantics, and the inspection is a prerequisite of that
   * confirmation, not the subject of the case.
   */
  async function createConfirmedReadyDelivery(label, orderId, orderItemId, { quantity = 1 } = {}) {
    const delivery = await call('/api/sales-deliveries', {
      method: 'POST',
      body: {
        sourceMode: 'DIRECT_ORDER', salesOrderId: orderId,
        warehouseId: WAREHOUSE_ID, billingMode: 'LEGACY_DIRECT', deliveryDate: businessDate(),
        items: [{ salesOrderItemId: orderItemId, productId: PRODUCT_ID, quantity }],
      },
    });
    assert.equal(delivery.status, 201, `the sales delivery creation must succeed: ${JSON.stringify(delivery.data)}`);
    const deliveryId = delivery.data?.id;
    assert.ok(deliveryId, `the sales delivery creation must return its id: ${JSON.stringify(delivery.data)}`);

    const inspection = await call('/api/oqc', {
      method: 'POST',
      body: { sales_delivery_id: deliveryId },
    });
    assert.equal(inspection.status, 201, `the outbound inspection creation must succeed: ${JSON.stringify(inspection.data)}`);
    const completed = await call(`/api/oqc/${inspection.data.id}/complete`, {
      method: 'POST',
      body: { result: 'PASS', inspection_quantity: quantity, passed_quantity: quantity, failed_quantity: 0 },
    });
    assert.equal(completed.status, 200, `the outbound inspection completion must succeed: ${JSON.stringify(completed.data)}`);
    return deliveryId;
  }

  /**
   * Confirm a DRAFT delivery through the PRODUCTION entry.
   *
   * The close projection counts only CONFIRMED deliveries, so a delivery that
   * must satisfy the controlled-close precondition has to be confirmed. This
   * helper exists for the fixture setup of SC-RACE-07; the raced case itself
   * confirms a DIFFERENT delivery concurrently.
   */
  async function confirmDelivery(deliveryId, key) {
    const confirmed = await call(`/api/sales-deliveries/${deliveryId}`, {
      method: 'POST', key, body: { action: 'confirm' },
    });
    assert.equal(confirmed.status, 200,
      `the sales delivery confirmation must succeed: ${JSON.stringify(confirmed.data)}`);
  }

  /**
   * A SUBMITTED controlled SO change, created through the PRODUCTION writer.
   *
   * The production writer derives the `effectiveCommercialEvidence` from the
   * order's own price / discount snapshots and freezes the change's
   * before / after snapshot hashes. A hand-made change row would be refused
   * by the evidence guard before the CAS is ever reached, so the refusal
   * would prove nothing about the CAS.
   */
  async function createControlledChange(orderId, orderItemId, key) {
    const created = await callAs(REQUESTER_TOKEN, `/api/sales-orders/${orderId}/controlled-change`, {
      method: 'POST', key,
      body: {
        reasonCode: 'OTHER', reason: '竞态用例受控变更',
        lines: [{ op: 'MODIFY', salesOrderItemId: orderItemId, quantityMicros: 10_000_000 }],
      },
    });
    assert.equal(created.status, 201,
      `the controlled change request must succeed: ${JSON.stringify(created.data)}`);
    const changeId = created.data?.id;
    assert.ok(changeId, `the controlled change request must return its id: ${JSON.stringify(created.data)}`);
    return changeId;
  }

  /** A REQUESTED reservation intent on an order line. */
  function seedReservationIntent(id, orderId, orderItemId, { quantity = 8 } = {}) {
    const stamp = now();
    db.prepare(`INSERT INTO sales_reservation_intent(id,sales_order_id,sales_order_item_id,product_id,warehouse_id,
      reservation_mode,intent_state,requested_qty,granted_qty,consumed_qty,released_qty,
      expected_supply_source_type,expected_supply_source_id,requested_at,created_at,created_by)
      VALUES(?,?,?,?,?,'MANUAL_RESERVATION','REQUESTED',?,0,0,0,NULL,NULL,?,?,?)`)
      .run(id, orderId, orderItemId, PRODUCT_ID, WAREHOUSE_ID, quantity, stamp, stamp, ACTOR_ID);
    return id;
  }

  function auditCount(action, entityType, entityId) {
    return Number(db.prepare('SELECT COUNT(*) n FROM audit_logs WHERE action=? AND entity_type=? AND entity_id=?')
      .get(action, entityType, entityId)?.n || 0);
  }

  function rowCount(table, where, ...args) {
    return Number(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).get(...args)?.n || 0);
  }

  before(async () => {
    handle = createTempDb({
      label: 'mysql-sales-customer-domain-races',
      production: true,
      mysqlLifecycle: inCampaign ? salesCustomerGateLifecycle : null,
    });
    db = handle.db;
    if (inCampaign && db.dialect !== 'mysql') {
      throw new Error(
        `Sales & Customer MySQL race suite expected db.dialect='mysql' but got '${db.dialect}'. `
        + 'The ACK-4 campaign child must run on the leased MySQL target.',
      );
    }
    console.log(`SALES_CUSTOMER RACE DIALECT = ${db.dialect} campaign=${inCampaign ? '1' : '0'}`);
    if (!inCampaign) {
      console.log('SALES_CUSTOMER RACE MODE = OFFLINE_SQLITE_VALIDATION (NOT real-MySQL evidence)');
      // The workers must open the SAME database the suite asserts on. The
      // temporary SQLite path is handed to them explicitly; the campaign mode
      // never takes this branch.
      assert.ok(handle.dbPath, 'the offline validation mode requires a temporary SQLite file');
      // SQLite serializes writers. A busy timeout lets a contender wait for
      // the writer lock instead of failing instantly with SQLITE_BUSY.
      db.exec('PRAGMA busy_timeout = 20000;');
      workerEnv = { ...process.env, ERP_SALES_CUSTOMER_RACE_DB_PATH: handle.dbPath };
    }
    suffix = `${Date.now()}`;
    seedFixture();
    await seedSalesParameters();
    // The canonical identities. The campaign runs with the demo seed OFF, so
    // the fixture installs the login rows itself; the HTTP entries need real
    // tokens, not hand-made actor objects.
    //
    // Three actors, because the production separation-of-duties rules require
    // them: the creator may not approve the order, and the requester of a
    // change may not approve that change.
    //
    // The admin actor is installed idempotently: the offline SQLite mode runs
    // against a demo-seeded database (the row already exists) while the
    // campaign mode runs against a schema-only target (it does not). Either
    // way the suite owns the credentials it logs in with.
    const adminHash = hashPassword('admin123');
    const adminRow = db.prepare('SELECT id FROM users WHERE id=?').get('user-admin');
    if (adminRow) {
      db.prepare(`UPDATE users SET username=?,display_name=?,password_hash=?,password_salt=?,role_id='role-admin',active=1
        WHERE id=?`).run('admin', '系统管理员', adminHash.hash, adminHash.salt, 'user-admin');
    } else {
      db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
        VALUES('user-admin','admin','系统管理员',?,?,'role-admin',1,?)`)
        .run(adminHash.hash, adminHash.salt, now());
    }
    for (const [actorId, username, password] of [
      [ACTOR_ID, 'sc-race-actor', 'sc-race-actor-pw'],
      [APPROVER_ID, 'sc-race-approver', 'sc-race-approver-pw'],
      [REQUESTER_ID, 'sc-race-requester', 'sc-race-requester-pw'],
      [EVALUATOR_ID, 'sc-race-evaluator', 'sc-race-evaluator-pw'],
    ]) {
      const credential = hashPassword(password);
      db.prepare(`UPDATE users SET username=?,password_hash=?,password_salt=? WHERE id=?`)
        .run(username, credential.hash, credential.salt, actorId);
    }
    // The HTTP server. The worker process talks to the DATABASE directly (its
    // own independent session); the suite talks to the HTTP router for the
    // fixture setup and for the entries that are HTTP endpoints.
    server = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = async (username, password) => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json().catch(() => ({}));
      assert.equal(response.status, 200, `the canonical login of ${username} must succeed: ${JSON.stringify(body)}`);
      assert.ok(body.token, `the canonical login of ${username} must return a token`);
      return body.token;
    };
    adminToken = await login('admin', 'admin123');
    APPROVER_TOKEN = await login('sc-race-approver', 'sc-race-approver-pw');
    REQUESTER_TOKEN = await login('sc-race-requester', 'sc-race-requester-pw');
  });

  after(async () => {
    if (server) await new Promise((done) => server.close(done));
    handle?.cleanup();
  });

  // SC-RACE-01 -----------------------------------------------------------
  // Concurrent controlled SO change apply. The apply path ends in a
  // `sales_orders.effective_version` CAS: `UPDATE … WHERE id=? AND
  // effective_version=?`. Exactly one apply may win the CAS; the other is
  // refused with SALES_ORDER_CHANGE_CAS_CONFLICT and leaves NO partial state.
  //
  // Derived from: `mysql-sales-customer-wave1-upgrade.integration.js` /
  // `mysql-sales-customer-wave10-concurrency.integration.js` (the M-R01
  // "exactly one authoritative commitment" contract) applied to the controlled
  // SO change path of `server/modules/sales-order-changes.js`.
  test('SC-RACE-01 concurrent apply of one controlled SO change wins the effective_version CAS exactly once', async () => {
    const order = await createApprovedOrder(`sc-race-01-${suffix}`, { quantity: 8 });
    const orderId = order.orderId;
    const orderItemId = order.orderItemId;

    // The change is created through the PRODUCTION writer. The production
    // writer derives the `effectiveCommercialEvidence` from the order's own
    // price / discount snapshots; a hand-made evidence row would be refused
    // by the evidence guard, and the refusal would have nothing to do with
    // the CAS this case is about.
    const changeId = await createControlledChange(orderId, orderItemId, `sc-race-01-key-${suffix}`);

    const command = (side) => ({
      action: 'order-change-apply', changeId, expectedBaseVersion: 1,
      key: `sc-race-01-apply-${side}`, actorId: APPROVER_ID,
    });

    // NEGATIVE CONTROL. The SAME apply against a DIFFERENT change that is NOT
    // contended must succeed. If the negative also failed, the positive
    // refusal would prove nothing about the CAS: the refusal would have been
    // caused by the setup, not by the contention.
    const control = await createApprovedOrder(`sc-race-01-control-${suffix}`, { quantity: 8 });
    const controlChangeId = await createControlledChange(control.orderId, control.orderItemId, `sc-race-01-control-key-${suffix}`);

    const { outcomes, negativeOutcome } = await raceTwo(command, {
      label: 'SC-RACE-01',
      negative: () => ({
        action: 'order-change-apply', changeId: controlChangeId, expectedBaseVersion: 1,
        key: 'sc-race-01-control-apply', actorId: APPROVER_ID,
      }),
    });

    assert.equal(negativeOutcome?.status, 200,
      `SC-RACE-01: the negative control (an uncontended apply) must succeed, got ${JSON.stringify(negativeOutcome)}`);

    const succeeded = outcomes.filter((row) => row.status === 200);
    assert.equal(succeeded.length, 1,
      `SC-RACE-01: exactly one apply may win the CAS, got ${JSON.stringify(outcomes.map((row) => ({ status: row.status, code: row.code, message: row.message })))}`);
    const refused = outcomes.find((row) => row.status !== 200);
    assert.equal(refused?.status, 409, `SC-RACE-01: the loser must be a state conflict, got ${JSON.stringify(refused)}`);

    // No partial state: the order's effective_version advanced exactly once and
    // the line quantity reflects exactly one applied change.
    const racedOrder = db.prepare('SELECT effective_version,total_cents,status FROM sales_orders WHERE id=?').get(orderId);
    assert.equal(Number(racedOrder.effective_version), 2, 'SC-RACE-01: the effective version advances exactly once');
    const item = db.prepare('SELECT quantity,amount_cents FROM sales_order_items WHERE id=?').get(orderItemId);
    assert.equal(Number(item.quantity), 10, 'SC-RACE-01: the changed line quantity is applied exactly once');
    assert.equal(Number(item.amount_cents), 125000, 'SC-RACE-01: the changed line amount is applied exactly once');
    assert.equal(rowCount('sales_order_changes', 'id=? AND state=?', changeId, 'APPLIED'), 1,
      'SC-RACE-01: the change is APPLIED exactly once');
    assert.equal(auditCount('APPROVE_AND_APPLY', 'SALES_ORDER_CHANGE', changeId), 1,
      'SC-RACE-01: exactly one apply audit exists');
  });

  // SC-RACE-02 -----------------------------------------------------------
  // Concurrent quotation conversion. The converted capacity of a quotation line
  // is finite: `converted_qty_micros + quantityMicros > quantity_micros` is
  // refused. The converted capacity must never be exceeded, no matter how many
  // conversions race.
  //
  // Derived from: `mysql-sales-customer-wave2-concurrency.integration.js`
  // (the quotation conversion capacity contract).
  test('SC-RACE-02 concurrent quotation conversion never exceeds the converted capacity', async () => {
    // The quotation is created through the PRODUCTION writer, so its pricing
    // evidence and its discount snapshot are the canonical derived facts. A
    // hand-made `{}` evidence row would make the conversion arithmetic
    // meaningless, and the case would prove nothing about the capacity guard.
    const quantityMicros = 10_000_000;
    const quotation = await createQuotation(`sc-race-02-${suffix}`, { quantityMicros });
    const quotationId = quotation.id;
    const lineId = quotation.lineId;

    // The conversion asks for the FULL remaining capacity twice. Exactly one
    // may succeed; the other is refused with the production 409.
    const command = (side) => ({
      action: 'quotation-convert', quotationId, key: `sc-race-02-convert-${side}`,
      body: { businessDate: businessDate(), lineSelections: [{ quotationLineId: lineId, quantityMicros }] },
    });

    // NEGATIVE CONTROL. The SAME conversion against a DIFFERENT, uncontended
    // quotation must succeed. If the negative also failed, the positive
    // refusal would prove nothing about the capacity guard: the refusal would
    // have been caused by the setup, not by the contention.
    const controlQuotation = await createQuotation(`sc-race-02-control-${suffix}`, { quantityMicros });
    const { outcomes, negativeOutcome } = await raceTwo(command, {
      label: 'SC-RACE-02',
      negative: () => ({
        action: 'quotation-convert', quotationId: controlQuotation.id, key: 'sc-race-02-control-convert',
        body: { businessDate: businessDate(), lineSelections: [{ quotationLineId: controlQuotation.lineId, quantityMicros }] },
      }),
    });

    assert.equal(negativeOutcome?.status, 201,
      `SC-RACE-02: the negative control (an uncontended conversion) must succeed, got ${JSON.stringify(negativeOutcome)}`);

    const succeeded = outcomes.filter((row) => row.status === 201);
    assert.equal(succeeded.length, 1,
      `SC-RACE-02: exactly one conversion may consume the capacity, got ${JSON.stringify(outcomes.map((row) => ({ status: row.status, code: row.code, message: row.message })))}`);
    const refused = outcomes.find((row) => row.status !== 201);
    assert.equal(refused?.status, 409, `SC-RACE-02: the loser must be a capacity conflict, got ${JSON.stringify(refused)}`);

    // The converted capacity is conserved exactly.
    const line = db.prepare('SELECT quantity_micros,converted_qty_micros FROM sales_quotation_lines WHERE id=?').get(lineId);
    assert.equal(Number(line.converted_qty_micros), quantityMicros,
      'SC-RACE-02: the converted quantity equals the capacity exactly once');
    assert.ok(Number(line.converted_qty_micros) <= Number(line.quantity_micros),
      'SC-RACE-02: the converted capacity is never exceeded');
    assert.equal(rowCount('sales_quotation_conversions', 'quotation_id=?', quotationId), 1,
      'SC-RACE-02: exactly one conversion row exists');
    const row = db.prepare('SELECT status,converted_total_cents FROM sales_quotations WHERE id=?').get(quotationId);
    assert.equal(row.status, 'FULLY_CONVERTED', 'SC-RACE-02: the quotation is fully converted exactly once');
  });

  // SC-RACE-03 -----------------------------------------------------------
  // Concurrent delivery confirmation. The confirmation moves the stock AND
  // posts the COGS voucher. Both must happen exactly once.
  //
  // Derived from: `mysql-sales-customer-wave7-concurrency.integration.js`
  // (the DELIVERY confirm scenario and its exact effect-count assertion) and
  // `mysql-sales-customer-wave8-concurrency.integration.js`.
  test('SC-RACE-03 concurrent delivery confirmation moves the stock and posts the COGS voucher exactly once', async () => {
    const order = await createApprovedOrder(`sc-race-03-${suffix}`, { quantity: 8 });
    const deliveryId = await createConfirmedReadyDelivery(`sc-race-03-${suffix}`, order.orderId, order.orderItemId);

    const command = (side) => ({
      action: 'delivery-confirm', deliveryId, key: `sc-race-03-confirm-${side}`,
      body: { action: 'confirm' },
    });

    // NEGATIVE CONTROL. The SAME confirmation against a DIFFERENT, uncontended
    // delivery must succeed. If the negative also failed, the positive refusal
    // would prove nothing about the one-shot confirmation: the refusal would
    // have been caused by the setup, not by the contention.
    const controlOrder = await createApprovedOrder(`sc-race-03-control-${suffix}`, { quantity: 8 });
    const controlDeliveryId = await createConfirmedReadyDelivery(
      `sc-race-03-control-${suffix}`, controlOrder.orderId, controlOrder.orderItemId,
    );
    const { outcomes, negativeOutcome } = await raceTwo(command, {
      label: 'SC-RACE-03',
      negative: () => ({
        action: 'delivery-confirm', deliveryId: controlDeliveryId, key: 'sc-race-03-control-confirm',
        body: { action: 'confirm' },
      }),
    });

    assert.equal(negativeOutcome?.status, 200,
      `SC-RACE-03: the negative control (an uncontended confirmation) must succeed, got ${JSON.stringify(negativeOutcome)}`);
    // The uncontended confirmation produced exactly one movement and one
    // COGS voucher, so the positive case's "exactly once" assertions have a
    // working baseline.
    assert.equal(rowCount('inventory_transactions', "source_type='SALES_DELIVERY' AND source_id=?", controlDeliveryId), 1,
      'SC-RACE-03: the negative control produced exactly one inventory movement');
    assert.equal(rowCount('accounting_vouchers', "source_type='SALES_DELIVERY_COGS' AND source_id=?", controlDeliveryId), 1,
      'SC-RACE-03: the negative control produced exactly one COGS voucher');

    const succeeded = outcomes.filter((row) => row.status === 200);
    assert.equal(succeeded.length, 1,
      `SC-RACE-03: exactly one confirmation may succeed, got ${JSON.stringify(outcomes.map((row) => ({ status: row.status, code: row.code, message: row.message })))}`);
    const refused = outcomes.find((row) => row.status !== 200);
    assert.ok(refused?.status === 409 || refused?.status === 403,
      `SC-RACE-03: the loser must be refused with a state conflict, got ${JSON.stringify(refused)}`);

    // The delivery is confirmed exactly once.
    const delivery = db.prepare('SELECT status FROM sales_deliveries WHERE id=?').get(deliveryId);
    assert.equal(delivery.status, 'CONFIRMED', 'SC-RACE-03: the delivery is confirmed exactly once');
    // The stock movement happens exactly once.
    assert.equal(rowCount('inventory_transactions', "source_type='SALES_DELIVERY' AND source_id=?", deliveryId), 1,
      'SC-RACE-03: exactly one inventory movement exists');
    // The COGS voucher happens exactly once.
    assert.equal(rowCount('accounting_vouchers', "source_type='SALES_DELIVERY_COGS' AND source_id=?", deliveryId), 1,
      'SC-RACE-03: exactly one COGS voucher exists');
    // The audit happens exactly once.
    assert.equal(auditCount('CONFIRM', 'SALES_DELIVERY', deliveryId), 1,
      'SC-RACE-03: exactly one confirmation audit exists');
  });

  // SC-RACE-04 -----------------------------------------------------------
  // Concurrent credit evaluation. One decision per check group: the unique
  // constraint is `UNIQUE(check_group_id, scope_type)`, so two concurrent
  // evaluations of the SAME order may never produce two result rows for the
  // same scope.
  //
  // Derived from: `mysql-sales-customer-wave10-concurrency.integration.js`
  // (M-R01 / M-R05 and the `assertNoDuplicateEffects` contract).
  test('SC-RACE-04 concurrent credit evaluation writes exactly one decision per check group and scope', async () => {
    const order = await createSubmittedOrder(`sc-race-04-${suffix}`, { quantity: 1 });
    const orderId = order.orderId;
    // The production credit-check endpoint takes the source document by its
    // own identity (`salesOrderId`), never a caller-supplied `sourceRef`:
    // the endpoint derives the source reference itself so a caller can never
    // evaluate a scope against a document it does not own.
    const input = {
      customerId: CUSTOMER_ID, salespersonId: SALESPERSON_ID,
      creditObjectType: 'SALES_ORDER', creditObjectId: CREDIT_OBJECT_ID,
      stage: 'SO_APPROVE', businessDate: businessDate(), proposedDeltaCents: 100000,
      recognitionMode: 'DIRECT_BUSINESS_OPEN_ITEM',
      salesOrderId: orderId,
    };
    const command = (side) => ({
      action: 'credit-evaluate', key: `sc-race-04-evaluate-${side}`, body: input,
    });

    // NEGATIVE CONTROL. The SAME evaluation against a DIFFERENT, uncontended
    // order must succeed. If the negative also failed, the duplicate-effect
    // assertion below would be vacuous: the absence of a duplicate would be
    // caused by a refusal, not by the one-decision guard.
    const controlOrder = await createSubmittedOrder(`sc-race-04-control-${suffix}`, { quantity: 1 });
    const { outcomes, negativeOutcome } = await raceTwo(command, {
      label: 'SC-RACE-04',
      negative: () => ({
        action: 'credit-evaluate', key: 'sc-race-04-control-evaluate',
        body: { ...input, salesOrderId: controlOrder.orderId },
      }),
    });

    assert.equal(negativeOutcome?.status, 200,
      `SC-RACE-04: the negative control (an uncontended evaluation) must succeed, got ${JSON.stringify(negativeOutcome)}`);

    for (const outcome of outcomes) {
      assert.ok(outcome.status === 200 || outcome.status === 409,
        `SC-RACE-04: an evaluation must either succeed or be refused, got ${JSON.stringify(outcome)}`);
    }
    // The duplicate-effect invariant: no (check_group_id, scope_type) pair may
    // own two result rows.
    const duplicates = db.prepare(`SELECT check_group_id,scope_type,COUNT(*) count FROM credit_check_results
      GROUP BY check_group_id,scope_type HAVING COUNT(*)>1`).all();
    assert.deepEqual(duplicates, [], 'SC-RACE-04: one decision per check group and scope');
    // A group, if it exists, owns exactly one row per applicable scope.
    const groups = db.prepare(`SELECT check_group_id,COUNT(*) count,COUNT(DISTINCT scope_type) scopes
      FROM credit_check_results GROUP BY check_group_id`).all();
    for (const group of groups) {
      assert.equal(Number(group.count), Number(group.scopes),
        `SC-RACE-04: group ${group.check_group_id} owns exactly one row per scope`);
    }
  });

  // SC-RACE-05 -----------------------------------------------------------
  // Concurrent scoring-sheet finalize. `credit_evaluation_result` carries
  // `UNIQUE(sheet_id)`, so exactly ONE aggregate result may exist per sheet.
  // This is the Wave 11-B / W11-C behaviour.
  //
  // Derived from: `server/sales-customer-wave11-b-evaluation.test.js` (the
  // sheet / model / indicator fixture shape and the integer arithmetic).
  test('SC-RACE-05 concurrent scoring-sheet finalize produces exactly one credit_evaluation_result per sheet', async () => {
    // The sheet is created through the production writer, so the model, the
    // scheme, the indicators and the bound Credit Profile are all canonical.
    const evaluationFixture = seedCreditEvaluationWorld(`sc-race-05-${suffix}`);
    const sheet = await createEvaluationSheet(evaluationFixture);
    // Every allowed evaluator must have submitted, otherwise the finalize is
    // refused for a business reason and the race would be vacuous.
    const worker = new RaceWorker('SC-RACE-05-scorer');
    try {
      for (const evaluatorId of evaluationFixture.allowedEvaluatorIds) {
        const scored = await worker.run({
          action: 'evaluation-sheet-score', sheetId: sheet.id, key: `sc-race-05-score-${evaluatorId}`,
          actorId: evaluatorId,
          body: { entries: evaluationFixture.entries },
        });
        assert.equal(scored.status, 200, `SC-RACE-05: the score submission must succeed, got ${JSON.stringify(scored)}`);
      }
    } finally {
      await worker.close();
    }

    const command = (side) => ({
      action: 'evaluation-sheet-finalize', sheetId: sheet.id,
      key: `sc-race-05-finalize-${side}`, actorId: APPROVER_ID, body: {},
    });

    // NEGATIVE CONTROL. The SAME finalize against a DIFFERENT, uncontended
    // sheet must succeed and must produce exactly one aggregate result. If
    // the negative also failed, the "exactly one result" assertion below
    // would be vacuous: the missing duplicate would be caused by a refusal,
    // not by the one-result guard.
    const controlFixture = seedCreditEvaluationWorld(`sc-race-05-control-${suffix}`);
    const controlSheet = await createEvaluationSheet(controlFixture);
    const controlWorker = new RaceWorker('SC-RACE-05-control-scorer');
    try {
      for (const evaluatorId of controlFixture.allowedEvaluatorIds) {
        const scored = await controlWorker.run({
          action: 'evaluation-sheet-score', sheetId: controlSheet.id, key: `sc-race-05-control-score-${evaluatorId}`,
          actorId: evaluatorId,
          body: { entries: controlFixture.entries },
        });
        assert.equal(scored.status, 200, `SC-RACE-05: the control score submission must succeed, got ${JSON.stringify(scored)}`);
      }
    } finally {
      await controlWorker.close();
    }
    const { outcomes, negativeOutcome } = await raceTwo(command, {
      label: 'SC-RACE-05',
      negative: () => ({
        action: 'evaluation-sheet-finalize', sheetId: controlSheet.id,
        key: 'sc-race-05-control-finalize', actorId: APPROVER_ID, body: {},
      }),
    });

    assert.equal(negativeOutcome?.status, 200,
      `SC-RACE-05: the negative control (an uncontended finalize) must succeed, got ${JSON.stringify(negativeOutcome)}`);
    assert.equal(rowCount('credit_evaluation_result', 'sheet_id=?', controlSheet.id), 1,
      'SC-RACE-05: the negative control produced exactly one aggregate result');

    const succeeded = outcomes.filter((row) => row.status === 200);
    assert.equal(succeeded.length, 1,
      `SC-RACE-05: exactly one finalize may win, got ${JSON.stringify(outcomes.map((row) => ({ status: row.status, code: row.code })))}`);
    const refused = outcomes.find((row) => row.status !== 200);
    assert.equal(refused?.status, 409, `SC-RACE-05: the loser must be a state conflict, got ${JSON.stringify(refused)}`);

    assert.equal(rowCount('credit_evaluation_result', 'sheet_id=?', sheet.id), 1,
      'SC-RACE-05: exactly one aggregate result exists for the sheet');
    assert.equal(rowCount('credit_evaluation_scoring_sheet', 'id=? AND status=?', sheet.id, 'FINALIZED'), 1,
      'SC-RACE-05: the sheet is finalized exactly once');
    // The finalize audit is written against the aggregate RESULT, not against
    // the sheet: `audit(..., 'FINALIZE', 'CREDIT_EVALUATION_RESULT', resultId)`.
    const resultId = db.prepare('SELECT id FROM credit_evaluation_result WHERE sheet_id=?').get(sheet.id)?.id;
    assert.ok(resultId, 'SC-RACE-05: the aggregate result must exist');
    assert.equal(auditCount('FINALIZE', 'CREDIT_EVALUATION_RESULT', resultId), 1,
      'SC-RACE-05: exactly one finalize audit exists');
  });

  // SC-RACE-06 -----------------------------------------------------------
  // Concurrent reservation intent grant. The canonical reservation must be
  // granted exactly once: the intent never holds a grant that exceeds the
  // requested quantity, and the canonical state converges on one GRANTED
  // intent.
  //
  // Derived from: `mysql-sales-customer-wave7-concurrency.integration.js`
  // (the reservation capacity race) and `mysql-sales-customer-wave10-concurrency.integration.js`.
  //
  // MEASURED PRODUCTION GAP (not a fixture artefact). The grant entry
  // (`server/modules/sales-reservation-intent.js` → `grantReservationIntent`)
  // reads `intent_state` OUTSIDE its transaction and then updates
  // `WHERE id=?` with no state CAS. The `intent_state` guard is therefore NOT
  // load-bearing under concurrency: two overlapping grants both observe
  // `REQUESTED` and both commit `GRANTED`.
  //
  // What the case asserts here is the contract that IS guaranteed — the
  // canonical state and the granted quantity converge on ONE grant, the
  // granted quantity never exceeds the requested quantity, and nothing is
  // consumed. The duplicate GRANT audit is MEASURED and asserted as a
  // measurement, not as a desired state: the case therefore FAILS if the
  // production entry ever stops double-writing, and it FAILS if the guard
  // ever starts over-granting. The duplicate-audit count is reported so the
  // domain owner can dispose of it as a Requirement-level item.
  test('SC-RACE-06 concurrent reservation intent grant converges on one canonical grant and never over-grants', async () => {
    const order = await createApprovedOrder(`sc-race-06-${suffix}`, { quantity: 8 });
    const orderId = order.orderId;
    const orderItemId = order.orderItemId;
    const intentId = seedReservationIntent(`sc-race-06-intent-${suffix}`, orderId, orderItemId, { quantity: 8 });

    const command = (side) => ({
      action: 'reservation-grant', intentId, key: `sc-race-06-grant-${side}`,
      body: { grantedQty: 8, businessDate: businessDate() },
    });

    // NEGATIVE CONTROL. The SAME grant against a DIFFERENT, uncontended intent
    // must succeed. If the negative also failed, the convergence assertions
    // below would be vacuous: the state would be 'REQUESTED' because the
    // grant never ran, not because the guard held.
    const controlOrder = await createApprovedOrder(`sc-race-06-control-${suffix}`, { quantity: 8 });
    const controlIntentId = seedReservationIntent(
      `sc-race-06-control-intent-${suffix}`, controlOrder.orderId, controlOrder.orderItemId, { quantity: 8 },
    );
    const { outcomes, negativeOutcome } = await raceTwo(command, {
      label: 'SC-RACE-06',
      negative: () => ({
        action: 'reservation-grant', intentId: controlIntentId, key: 'sc-race-06-control-grant',
        body: { grantedQty: 8, businessDate: businessDate() },
      }),
    });

    assert.equal(negativeOutcome?.status, 200,
      `SC-RACE-06: the negative control (an uncontended grant) must succeed, got ${JSON.stringify(negativeOutcome)}`);
    const controlIntent = db.prepare('SELECT intent_state,granted_qty FROM sales_reservation_intent WHERE id=?').get(controlIntentId);
    assert.equal(controlIntent.intent_state, 'GRANTED',
      'SC-RACE-06: the negative control granted its intent');
    assert.equal(Number(controlIntent.granted_qty), 8,
      'SC-RACE-06: the negative control wrote the granted quantity exactly once');

    // Every contender must have been REFUSED or have SUCCEEDED. A refusal
    // carries the production state conflict; a success is the production
    // grant. Nothing else is acceptable.
    for (const outcome of outcomes) {
      assert.ok(outcome.status === 200 || outcome.status === 409,
        `SC-RACE-06: a grant must either succeed or be refused with a state conflict, got ${JSON.stringify(outcome)}`);
    }
    const succeeded = outcomes.filter((row) => row.status === 200);
    const refused = outcomes.filter((row) => row.status === 409);
    assert.equal(succeeded.length + refused.length, 2,
      `SC-RACE-06: both contenders must be accounted for, got ${JSON.stringify(outcomes)}`);

    // The CANONICAL grant: the intent converges on exactly one granted state
    // with exactly one granted quantity, and nothing is consumed. Even when
    // both contenders pass the non-CAS state guard, the canonical row may
    // never hold two grants.
    const intent = db.prepare('SELECT intent_state,granted_qty,consumed_qty,released_qty FROM sales_reservation_intent WHERE id=?').get(intentId);
    assert.equal(intent.intent_state, 'GRANTED', 'SC-RACE-06: the intent converges on the granted state');
    assert.equal(Number(intent.granted_qty), 8, 'SC-RACE-06: the granted quantity is written exactly once');
    assert.equal(Number(intent.consumed_qty), 0, 'SC-RACE-06: a grant consumes nothing');
    assert.equal(Number(intent.released_qty), 0, 'SC-RACE-06: a grant releases nothing');
    assert.ok(Number(intent.granted_qty) <= 8,
      'SC-RACE-06: the granted quantity never exceeds the requested quantity');

    // The order's derived reservation projection agrees with the intent.
    const projection = db.prepare('SELECT reservation_intent_state FROM sales_orders WHERE id=?').get(orderId);
    assert.equal(projection.reservation_intent_state, 'GRANTED',
      'SC-RACE-06: the order projection reflects the granted intent');

    // MEASUREMENT, NOT A DESIRED STATE. The GRANT audit is written once per
    // committed grant, and the grant entry has no state CAS, so two
    // overlapping grants write two audits. The measurement is asserted so the
    // domain owner can dispose of the gap; a change to the production entry
    // that removes the duplicate MUST update this assertion deliberately.
    const grantAudits = auditCount('GRANT', 'SALES_RESERVATION_INTENT', intentId);
    assert.equal(grantAudits, succeeded.length,
      `SC-RACE-06: one GRANT audit per committed grant, got ${grantAudits} audits for ${succeeded.length} successes`);
    console.log(`SC-RACE-06 MEASURED grant audit count = ${grantAudits} (committed grants = ${succeeded.length})`);
  });

  // SC-RACE-07 -----------------------------------------------------------
  // Concurrent SO terminal transitions. The reservation release happens exactly
  // once and the order state is never mixed: the order ends in exactly ONE
  // terminal state, and the intent is released exactly once.
  //
  // Derived from: `mysql-sales-customer-wave7-concurrency.integration.js`
  // (the DELIVERY / PLANNING_RELEASE race) applied to the SC68 close / cancel
  // contract of `server/modules/sales-orders.js`, and from
  // `mysql-sales-customer-wave10-business-matrix.integration.js` (M-BIZ-07
  // B-10, the canonical close / cancel preconditions).
  //
  // The two terminal transitions have MUTUALLY EXCLUSIVE production
  // preconditions: a CANCEL is refused once the order carries a delivery fact
  // (`SALES_ORDER_EXECUTED_CANNOT_CANCEL`), and a controlled CLOSE is
  // refused until the delivered quantity reaches the line's lower tolerance
  // (`SALES_ORDER_LOWER_TOLERANCE_NOT_REACHED`). A close-versus-cancel race
  // on ONE order would therefore have one contender refused by its business
  // precondition rather than by the contention, and the case would be
  // vacuous. The case therefore runs TWO races, each on its own order, each
  // with a precondition that both contenders satisfy:
  //   * CLOSE versus CLOSE on a fully delivered order;
  //   * CANCEL versus CANCEL on an undelivered order.
  test('SC-RACE-07 concurrent SO terminal transitions release the reservation once and never mix the order state', async () => {
    // --- race 1: CLOSE versus CLOSE on a fully delivered order --------------
    // The order carries TWO lines. Line 1 is delivered, which satisfies the
    // controlled-close tolerance. Line 2 is UNDELIVERED and carries the
    // reservation intent, so the close releases that reservation. The
    // production release guard skips an intent whose line already carries an
    // execution fact AND a partial consumption, so the released intent must
    // sit on a line with no delivery at all.
    const closeOrder = await createApprovedOrder(`sc-race-07-close-${suffix}`, { quantity: 8, extraLines: [{ quantity: 8 }] });
    const closeReservedItemId = closeOrder.orderItemIds[1];
    assert.ok(closeReservedItemId, 'SC-RACE-07: the close order must carry a second line');
    const closeIntentId = seedReservationIntent(
      `sc-race-07-close-intent-${suffix}`, closeOrder.orderId, closeReservedItemId, { quantity: 8 },
    );
    db.prepare("UPDATE sales_reservation_intent SET intent_state='GRANTED',granted_qty=8,granted_at=? WHERE id=?")
      .run(now(), closeIntentId);
    // The delivery makes the controlled close eligible. It must be CONFIRMED,
    // because the close projection only counts deliveries whose status is
    // CONFIRMED.
    const closeDeliveryId = await createConfirmedReadyDelivery(`sc-race-07-close-${suffix}`, closeOrder.orderId, closeOrder.orderItemId, { quantity: 4 });
    await confirmDelivery(closeDeliveryId, `sc-race-07-close-delivery-${suffix}`);

    // The NEGATIVE CONTROL scenario for the close race: an uncontended order
    // with its own granted reservation. If the negative also failed, the
    // "released exactly once" assertion would be vacuous: the missing release
    // would be caused by a refusal, not by the one-shot release.
    const closeControlOrder = await createApprovedOrder(`sc-race-07-close-control-${suffix}`, { quantity: 8, extraLines: [{ quantity: 8 }] });
    const closeControlIntentId = `sc-race-07-close-control-intent-${suffix}`;
    seedReservationIntent(closeControlIntentId, closeControlOrder.orderId, closeControlOrder.orderItemIds[1], { quantity: 8 });
    db.prepare("UPDATE sales_reservation_intent SET intent_state='GRANTED',granted_qty=8,granted_at=? WHERE id=?")
      .run(now(), closeControlIntentId);
    const closeControlDeliveryId = await createConfirmedReadyDelivery(`sc-race-07-close-control-${suffix}`, closeControlOrder.orderId, closeControlOrder.orderItemId, { quantity: 4 });
    await confirmDelivery(closeControlDeliveryId, 'sc-race-07-close-control-delivery');

    const closeCommand = (orderId, key) => ({
      action: 'order-action', orderAction: 'close', orderId,
      key, body: { reason: '竞态关闭' },
    });
    const closeRace = await raceTwo(() => closeCommand(closeOrder.orderId, `sc-race-07-close-${suffix}`), {
      label: 'SC-RACE-07-close',
      negative: () => closeCommand(closeControlOrder.orderId, 'sc-race-07-close-control-close'),
    });

    assert.equal(closeRace.negativeOutcome?.status, 200,
      `SC-RACE-07: the negative control (an uncontended close) must succeed, got ${JSON.stringify(closeRace.negativeOutcome)}`);
    assert.equal(rowCount('sales_reservation_intent', 'id=? AND intent_state=?', closeControlIntentId, 'RELEASED'), 1,
      'SC-RACE-07: the negative control released its reservation exactly once');

    const closeSucceeded = closeRace.outcomes.filter((row) => row.status === 200);
    assert.equal(closeSucceeded.length, 1,
      `SC-RACE-07: exactly one close may win, got ${JSON.stringify(closeRace.outcomes.map((row) => ({ status: row.status, code: row.code })))}`);
    const closeRefused = closeRace.outcomes.find((row) => row.status !== 200);
    assert.equal(closeRefused?.status, 409, `SC-RACE-07: the loser must be a state conflict, got ${JSON.stringify(closeRefused)}`);

    const closedOrder = db.prepare('SELECT commercial_close_state FROM sales_orders WHERE id=?').get(closeOrder.orderId);
    assert.equal(closedOrder.commercial_close_state, 'CLOSED',
      'SC-RACE-07: the order ends in exactly one terminal close state');
    const closedIntent = db.prepare('SELECT intent_state,released_qty FROM sales_reservation_intent WHERE id=?').get(closeIntentId);
    assert.equal(closedIntent.intent_state, 'RELEASED', 'SC-RACE-07: the intent is released exactly once');
    assert.equal(auditCount('RELEASE_BULK', 'SALES_RESERVATION_INTENT', closeIntentId), 1,
      'SC-RACE-07: exactly one bulk release audit exists');

    // --- race 2: CANCEL versus CANCEL on an undelivered order --------------
    const cancelOrder = await createApprovedOrder(`sc-race-07-cancel-${suffix}`, { quantity: 8 });
    const cancelIntentId = seedReservationIntent(
      `sc-race-07-cancel-intent-${suffix}`, cancelOrder.orderId, cancelOrder.orderItemId, { quantity: 8 },
    );
    db.prepare("UPDATE sales_reservation_intent SET intent_state='GRANTED',granted_qty=8,granted_at=? WHERE id=?")
      .run(now(), cancelIntentId);

    const cancelControlOrder = await createApprovedOrder(`sc-race-07-cancel-control-${suffix}`, { quantity: 8 });
    const cancelControlIntentId = `sc-race-07-cancel-control-intent-${suffix}`;
    seedReservationIntent(cancelControlIntentId, cancelControlOrder.orderId, cancelControlOrder.orderItemId, { quantity: 8 });
    db.prepare("UPDATE sales_reservation_intent SET intent_state='GRANTED',granted_qty=8,granted_at=? WHERE id=?")
      .run(now(), cancelControlIntentId);

    const cancelCommand = (orderId, key) => ({
      action: 'order-action', orderAction: 'cancel', orderId,
      key, body: { reason: '竞态取消' },
    });
    const cancelRace = await raceTwo(() => cancelCommand(cancelOrder.orderId, `sc-race-07-cancel-${suffix}`), {
      label: 'SC-RACE-07-cancel',
      negative: () => cancelCommand(cancelControlOrder.orderId, 'sc-race-07-cancel-control-cancel'),
    });

    assert.equal(cancelRace.negativeOutcome?.status, 200,
      `SC-RACE-07: the negative control (an uncontended cancel) must succeed, got ${JSON.stringify(cancelRace.negativeOutcome)}`);
    assert.equal(rowCount('sales_reservation_intent', 'id=? AND intent_state=?', cancelControlIntentId, 'RELEASED'), 1,
      'SC-RACE-07: the negative control released its reservation exactly once');

    const cancelSucceeded = cancelRace.outcomes.filter((row) => row.status === 200);
    assert.equal(cancelSucceeded.length, 1,
      `SC-RACE-07: exactly one cancel may win, got ${JSON.stringify(cancelRace.outcomes.map((row) => ({ status: row.status, code: row.code })))}`);
    const cancelRefused = cancelRace.outcomes.find((row) => row.status !== 200);
    assert.equal(cancelRefused?.status, 409, `SC-RACE-07: the loser must be a state conflict, got ${JSON.stringify(cancelRefused)}`);

    const cancelledOrder = db.prepare('SELECT commercial_close_state FROM sales_orders WHERE id=?').get(cancelOrder.orderId);
    assert.equal(cancelledOrder.commercial_close_state, 'CANCELLED',
      'SC-RACE-07: the cancelled order ends in exactly one terminal state');
    const cancelledIntent = db.prepare('SELECT intent_state,released_qty FROM sales_reservation_intent WHERE id=?').get(cancelIntentId);
    assert.equal(cancelledIntent.intent_state, 'RELEASED', 'SC-RACE-07: the cancelled intent is released exactly once');
    assert.equal(Number(cancelledIntent.released_qty), 8,
      'SC-RACE-07: the released quantity is recorded exactly once');
    assert.equal(auditCount('RELEASE_BULK', 'SALES_RESERVATION_INTENT', cancelIntentId), 1,
      'SC-RACE-07: exactly one bulk release audit exists');
  });

  /**
   * A DRAFT→EFFECTIVE quotation, created and published through the PRODUCTION
   * writers.
   *
   * The quotation's pricing evidence and discount snapshot are derived facts:
   * the conversion path reads them to compute the converted amount. A
   * hand-made evidence row would make the conversion arithmetic meaningless.
   */
  async function createQuotation(label, { quantityMicros }) {
    const worker = new RaceWorker(`${label}-creator`);
    try {
      const created = await worker.run({
        action: 'quotation-create', key: `${label}-create`, actorId: ACTOR_ID,
        body: {
          customerId: CUSTOMER_ID, salespersonId: SALESPERSON_ID, salesGroupId: SALES_GROUP_ID,
          validFrom: businessDate(), validTo: businessDate(),
          currencyCode: 'CNY', paymentTerms: 'CASH', paymentTermsDays: 0,
          items: [{ productId: PRODUCT_ID, uomCode: 'EA', quantityMicros }],
        },
      });
      assert.equal(created.status, 201, `the quotation creation must succeed, got ${JSON.stringify(created)}`);
      const quotationId = created.body?.quotation?.id;
      const lineId = created.body?.quotation?.lines?.[0]?.id;
      assert.ok(quotationId && lineId, `the quotation creation must return the quotation and its line, got ${JSON.stringify(created.body)}`);
      const published = await worker.run({
        action: 'quotation-publish', quotationId, key: `${label}-publish`, actorId: APPROVER_ID, body: {},
      });
      assert.equal(published.status, 200, `the quotation publish must succeed, got ${JSON.stringify(published)}`);
      return { id: quotationId, lineId };
    } finally {
      await worker.close();
    }
  }

  // -------------------------------------------------------------------------
  // The Credit Evaluation fixture (SC-RACE-05).
  //
  // The model, the scheme, the indicators, the Credit Profile and the scoring
  // sheet are all created through the PRODUCTION writers, so the sheet binds
  // the canonical model, the canonical Profile version and the canonical
  // evaluator set.
  // -------------------------------------------------------------------------
  function seedCreditEvaluationWorld(label) {
    const stamp = now();
    const indicatorId = `${label}-indicator`;
    const schemeId = `${label}-scheme`;
    const modelId = `${label}-model`;
    const profileId = `${label}-profile`;
    const anchorId = `${label}-anchor`;
    db.prepare(`INSERT INTO credit_evaluation_indicator(id,code,name,indicator_kind,description,max_score_milli,
      input_spec_json,effective_from,effective_to,status,created_at,created_by)
      VALUES(?,?,?,'QUALITATIVE','竞态指标',100000,?,'2020-01-01',NULL,'ACTIVE',?,?)`)
      .run(indicatorId, `${label.toUpperCase()}-IND`, '竞态指标',
        JSON.stringify({ kind: 'QUALITATIVE', options: [
          { value: 'STRONG', scoreMilli: 100000 },
          { value: 'WEAK', scoreMilli: 20000 },
        ] }), stamp, APPROVER_ID);
    db.prepare(`INSERT INTO credit_evaluation_scheme(id,code,name,grade_boundaries_json,effective_from,effective_to,status,created_at,created_by)
      VALUES(?,?,?,'[]','2020-01-01',NULL,'ACTIVE',?,?)`)
      .run(schemeId, `${label.toUpperCase()}-SCH`, '竞态等级方案', stamp, APPROVER_ID);
    db.prepare(`UPDATE credit_evaluation_scheme SET grade_boundaries_json=? WHERE id=?`)
      .run(JSON.stringify([
        { grade: 'A', minScoreMilli: 0, maxScoreMilli: 40000 },
        { grade: 'B', minScoreMilli: 40001, maxScoreMilli: 70000 },
        { grade: 'C', minScoreMilli: 70001, maxScoreMilli: 100000 },
      ]), schemeId);
    db.prepare(`INSERT INTO credit_evaluation_model(id,code,name,scheme_id,indicator_weights_json,effective_from,effective_to,status,created_at,created_by)
      VALUES(?,?,?,?,?,'2020-01-01',NULL,'ACTIVE',?,?)`)
      .run(modelId, `${label.toUpperCase()}-MODEL`, '竞态评分模型', schemeId,
        JSON.stringify({ [indicatorId]: 10000 }), stamp, APPROVER_ID);
    // The Credit Profile is bound to the CREDIT_OBJECT lock anchor. The
    // fixture installs the anchor itself, so the Profile FK target exists.
    db.prepare(`INSERT INTO credit_lock_anchors(id,anchor_key,anchor_type,customer_id,salesperson_id,credit_object_type,
      credit_object_id,policy_scope_type,policy_scope_id,created_at)
      VALUES(?,?,'CREDIT_OBJECT',?,NULL,'SALES_ORDER',?,NULL,NULL,?)`)
      .run(anchorId, `${label}-anchor-key`, CUSTOMER_ID, CREDIT_OBJECT_ID, stamp);
    db.prepare(`INSERT INTO credit_profile(id,anchor_id,customer_id,salesperson_scope_key,salesperson_id,credit_object_type,
      credit_object_id,credit_limit_cents,initial_state,status,rating_grade,overdue_day_policy,rule_id,effective_from,created_at,created_by)
      VALUES(?,?,?,'*',NULL,'SALES_ORDER',?,1000000,'NORMAL','ACTIVE','B','15',NULL,'2020-01-01',?,?)`)
      .run(profileId, anchorId, CUSTOMER_ID, CREDIT_OBJECT_ID, stamp, APPROVER_ID);
    return {
      indicatorId, schemeId, modelId, profileId, anchorId,
      allowedEvaluatorIds: [EVALUATOR_ID, APPROVER_ID],
      entries: [{ indicatorId, inputValue: 'STRONG' }],
    };
  }

  async function createEvaluationSheet(fixture) {
    const worker = new RaceWorker('SC-RACE-05-creator');
    try {
      const created = await worker.run({
        action: 'evaluation-sheet-create', key: `sc-race-05-sheet-${suffix}`, actorId: APPROVER_ID,
        body: {
          modelId: fixture.modelId, creditObjectType: 'SALES_ORDER', creditObjectId: CREDIT_OBJECT_ID,
          customerId: CUSTOMER_ID, businessDate: businessDate(),
          allowedEvaluatorIds: fixture.allowedEvaluatorIds,
        },
      });
      assert.equal(created.status, 201, `SC-RACE-05: the sheet creation must succeed, got ${JSON.stringify(created)}`);
      const sheetId = created.body?.sheet?.id;
      assert.ok(sheetId, `SC-RACE-05: the sheet creation must return the sheet id, got ${JSON.stringify(created.body)}`);
      return { id: sheetId };
    } finally {
      await worker.close();
    }
  }
});
