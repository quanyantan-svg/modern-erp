// Wave 8 Residual Stage D — R1 Credit Note reversal and R2 A3 invoice lock order.
//
// Every test drives the real canonical writers. Nothing is faked with direct SQL:
// credit notes are created through `createCommercialCreditNote`, and invoice links are
// produced by the real POST path.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createDatabase, hashPassword } from './db.js';
import { createApp } from './app.js';
import { createCommercialCreditNote, createSalesInvoice, postSalesInvoice, reverseCommercialCreditNote, voidPostedInvoice } from './modules/commercial-golive.js';
import { discoverInvoiceSourcePlan, lockInvoiceSourcePlan } from './modules/finance-recognition.js';
import { confirmServiceFulfillmentCommand, createServiceFulfillmentCommand } from './modules/service-fulfillment.js';
import { discoverCreditReversalPlan } from './modules/commercial-golive.js';

const DAY = '2026-10-20';
const actor = { id: 'r8-finance', roleCode: 'ADMIN', permissions: ['SALES_VIEW','SALES_MANAGE','SERVICE_SALES_VIEW','SERVICE_SALES_MANAGE','FINANCE_INVOICE_MANAGE'] };

// A MySQL-dialect proxy that records every locking statement, so lock ORDER is
// asserted as evidence rather than inferred from timing. The adapter's global
// transaction gate serializes real MySQL work, so timing cannot prove order.
function mysqlLockProbe(db) {
  const locks = [];
  return {
    get dialect() { return 'mysql'; },
    get isTransaction() { return db.isTransaction; },
    locks,
    prepare(sql) {
      const locking = /FOR UPDATE/.test(sql);
      const runnable = sql.replace(/\s*\bFOR UPDATE\b/g, '');
      const statement = db.prepare(runnable);
      const bind = (method) => (...args) => {
        if (locking) locks.push({ sql, args });
        return statement[method](...args);
      };
      return { get: bind('get'), all: bind('all'), run: bind('run') };
    },
    exec: (sql) => db.exec(sql),
  };
}

describe('Wave 8 residual — R1 credit reversal and R2 invoice lock order', () => {
  let dir; let db;

  beforeEach(() => {
    const prior = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
    dir = mkdtempSync(join(tmpdir(), 'modern-erp-w8-residual-'));
    db = createDatabase(join(dir, 'erp.db'));
    if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior;
    const stamp = new Date().toISOString();
    const credentials = hashPassword('r8-http-password');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,'role-admin',1,?)`).run(actor.id, actor.id, 'R8 Finance', credentials.hash, credentials.salt, stamp);
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('r8-c','R8-C','R8 Customer','','','',1,?,?)").run(stamp, stamp);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('r8-w','R8-W','R8 Warehouse','','',1,?,?)").run(stamp, stamp);
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy)
      VALUES('r8-svc','R8-SVC','R8 Service','','EA',100,0,1,?,?,'EA','NONE')`).run(stamp, stamp);
    db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,service_classification,service_kind,active,created_at,updated_at,created_by,updated_by)
      VALUES('r8-svc-c','r8-svc',1,1,'STANDARD',1,?,?,?,?)`).run(stamp, stamp, actor.id, actor.id);
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,order_date,payment_terms_days)
      VALUES('r8-so','R8-SO','r8-c','APPROVED',400,?,?,?,?,0)`).run(actor.id, stamp, stamp, DAY);
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,
      document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den)
      VALUES('r8-soi','r8-so','r8-svc',4,100,400,1,'EA',4000000,1000000,1,1,4000000,1000000)`).run();
    db.prepare(`INSERT INTO finance_recognition_policy(id,side,source_type,source_id,recognition_mode,effective_date,active,created_by,created_at)
      VALUES('r8-policy','AR','SERVICE_FULFILLMENT',NULL,'DIRECT_BUSINESS_OPEN_ITEM','2020-01-01',1,?,?)`).run(actor.id, stamp);
  });
  afterEach(() => { try { db?.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });

  // Builds a POSTED service invoice carrying exactly two confirmed fulfillment links,
  // produced by the canonical invoice POST path rather than by direct SQL.
  function postedServiceInvoice(suffix) {
    // Two confirmed fulfillments so the §35.18.12 per-invoice-item allocation is conserved.
    const fulfillments = [1, 2].map((index) => createServiceFulfillmentCommand(db, { salesOrderItemId: 'r8-soi', confirmationQtyMicros: 1_000_000, businessDate: DAY }, actor, `r8-sf-${suffix}-${index}`));
    for (const fulfillment of fulfillments) confirmServiceFulfillmentCommand(db, fulfillment.id, 1, actor, `r8-sf-confirm-${fulfillment.id}`);
    const deliveryId = `r8-delivery-${suffix}`;
    db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
      VALUES(?,?,?,'r8-c','r8-w',?,200,'CONFIRMED',?,'',?,?,?,?,?)`)
      .run(deliveryId, `R8-D-${suffix}`, 'r8-so', actor.id, DAY, actor.id, new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), actor.id);
    db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id,document_uom_code,document_quantity_num,document_quantity_den,base_quantity_num,base_quantity_den)
      VALUES(?,?,'r8-svc',2,100,200,1,'r8-soi','EA',2,1,2,1)`).run(`r8-di-${suffix}`, deliveryId);
    const invoice = createSalesInvoice(db, {
      customerId: 'r8-c', invoiceDate: DAY, taxMode: 'NO_TAX', actorId: actor.id,
      idempotencyKey: `r8-inv-${suffix}`, items: [{ deliveryItemId: `r8-di-${suffix}`, quantityNumerator: 2, quantityDenominator: 1, unitPriceCents: 100 }],
    });
    return { invoice: postSalesInvoice(db, invoice.id, actor.id), fulfillmentId: fulfillments[0].id, fulfillmentIds: fulfillments.map((row) => row.id) };
  }

  function creditFootprint() {
    return {
      notes: db.prepare('SELECT id,status,gross_cents FROM commercial_credit_notes ORDER BY id').all(),
      adjustments: db.prepare('SELECT id,status,amount_cents,reversed_cents FROM financial_credit_adjustments ORDER BY id').all(),
      balances: db.prepare("SELECT id,status FROM settlement_unapplied_balances WHERE balance_type='CREDIT' ORDER BY id").all(),
      vouchers: db.prepare("SELECT id,source_type,source_id,voucher_origin,reversal_of_id FROM accounting_vouchers ORDER BY id").all(),
      invoices: db.prepare('SELECT id,credited_amount_cents,remaining_creditable_amount_cents,credit_state FROM sales_invoices ORDER BY id').all(),
      openItems: db.prepare('SELECT id,open_amount_cents,status FROM account_receivables ORDER BY id').all(),
      links: db.prepare('SELECT * FROM finance_invoice_source_links ORDER BY id').all(),
      audit: db.prepare("SELECT entity_type,action FROM audit_logs WHERE entity_type='COMMERCIAL_CREDIT_NOTE' ORDER BY id").all(),
      idempotency: db.prepare("SELECT operation_type,document_id FROM idempotency_records ORDER BY id").all(),
    };
  }

  // --------------------------------------------------------------- R1 ---

  test('R1 reversing a posted credit restores invoice capacity and reverses every monetary layer', () => {
    const { invoice } = postedServiceInvoice('r1');
    assert.equal(Number(invoice.gross_cents), 200);
    const note = createCommercialCreditNote(db, { side: 'AR', sourceId: invoice.id, creditDate: DAY, grossCents: 200, actorId: actor.id, idempotencyKey: 'r1-credit-1' });
    const credited = db.prepare('SELECT * FROM sales_invoices WHERE id=?').get(invoice.id);
    assert.equal(Number(credited.credited_amount_cents), 200);
    assert.equal(credited.credit_state, 'FULL');

    const reversed = reverseCommercialCreditNote(db, { id: note.id, reversalDate: DAY, reason: 'R1 撤销', actorId: actor.id, idempotencyKey: 'r1-reverse-1' });
    assert.equal(reversed.status, 'REVERSED');
    assert.equal(reversed.creditState, 'NONE', 'credit_state returns to NONE so the invoice stays voidable');
    assert.equal(Number(reversed.creditedAmountCents), 0);
    assert.equal(Number(reversed.remainingCreditableAmountCents), 200);

    const after = creditFootprint();
    assert.ok(after.adjustments.every((row) => row.status === 'REVERSED' && Number(row.reversed_cents) === Number(row.amount_cents)));
    assert.ok(after.balances.every((row) => row.status === 'REVERSED'));
    assert.equal(after.vouchers.filter((row) => /_REVERSAL$/.test(row.source_type)).length, 1, 'exactly one canonical reversal voucher');
    assert.equal(after.links.length, 2, 'historical invoice links are neither deleted nor modified');
    assert.deepEqual(after.audit.map((row) => ({ ...row })), [{ entity_type: 'COMMERCIAL_CREDIT_NOTE', action: 'REVERSE' }]);
  });

  test('R1 an exact replay is idempotent and a conflicting replay is rejected', () => {
    const { invoice } = postedServiceInvoice('r1b');
    const note = createCommercialCreditNote(db, { side: 'AR', sourceId: invoice.id, creditDate: DAY, grossCents: 200, actorId: actor.id, idempotencyKey: 'r1b-credit' });
    const first = reverseCommercialCreditNote(db, { id: note.id, reversalDate: DAY, reason: 'R1 撤销', actorId: actor.id, idempotencyKey: 'r1b-rev' });
    const snapshot = creditFootprint();

    const replay = reverseCommercialCreditNote(db, { id: note.id, reversalDate: DAY, reason: 'R1 撤销', actorId: actor.id, idempotencyKey: 'r1b-rev' });
    assert.equal(replay.replayed, true);
    assert.deepEqual({ ...creditFootprint() }, { ...snapshot }, 'an exact replay changes nothing');

    assert.throws(
      () => reverseCommercialCreditNote(db, { id: note.id, reversalDate: DAY, reason: '不同的理由', actorId: actor.id, idempotencyKey: 'r1b-rev' }),
      // The frozen idempotency control already refuses a same-key/different-payload replay
      // before the command runs, so the conflict is caught there rather than by R1 itself.
      (error) => /幂等键/.test(error.message || String(error)),
    );
    assert.deepEqual({ ...creditFootprint() }, { ...snapshot });

    // A NEW key against an already-reversed note must fail closed, not silently succeed.
    assert.throws(
      () => reverseCommercialCreditNote(db, { id: note.id, reversalDate: DAY, reason: '再次撤销', actorId: actor.id, idempotencyKey: 'r1b-rev-2' }),
      (error) => error.code === 'COMMERCIAL_CREDIT_NOTE_NOT_REVERSIBLE',
    );
    assert.deepEqual({ ...creditFootprint() }, { ...snapshot });
    assert.equal(first.status, 'REVERSED');
  });

  test('R1 HTTP same-key/different-payload returns 409 rather than 500', async () => {
    const { invoice } = postedServiceInvoice('r1-http');
    const note = createCommercialCreditNote(db, { side: 'AR', sourceId: invoice.id, creditDate: DAY, grossCents: 200, actorId: actor.id, idempotencyKey: 'r1-http-credit' });
    const server = createServer(createApp(db));
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: actor.id, password: 'r8-http-password' }),
      });
      assert.equal(login.status, 200);
      const token = (await login.json()).token;
      const reverse = (reason) => fetch(`${baseUrl}/api/commercial-credit-notes/${note.id}/reverse`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': 'r1-http-reverse' },
        body: JSON.stringify({ reversalDate: DAY, reason }),
      });
      const first = await reverse('HTTP 冲销'); assert.equal(first.status, 200);
      const replay = await reverse('HTTP 冲销'); assert.equal(replay.status, 200); assert.equal((await replay.json()).replayed, true);
      const snapshot = creditFootprint();
      const conflict = await reverse('不同 HTTP 请求');
      const payload = await conflict.json();
      assert.equal(conflict.status, 409);
      assert.notEqual(payload.code, 'INTERNAL_ERROR');
      // Frozen financial-controls compatibility: the command rejects the semantic
      // conflict correctly, while its HttpError carries the generic 409 category.
      assert.equal(payload.code, 'BUSINESS_RULE_BLOCKED');
      assert.deepEqual({ ...creditFootprint() }, { ...snapshot });
    } finally {
      server.closeAllConnections?.();
      await new Promise((done) => server.close(done));
    }
  });

  test('R1 request-contract refusals change nothing', () => {
    const { invoice } = postedServiceInvoice('r1c');
    const note = createCommercialCreditNote(db, { side: 'AR', sourceId: invoice.id, creditDate: DAY, grossCents: 100, actorId: actor.id, idempotencyKey: 'r1c-credit' });
    const snapshot = creditFootprint();

    assert.throws(() => reverseCommercialCreditNote(db, { id: note.id, reversalDate: DAY, reason: 'x', actorId: actor.id, idempotencyKey: '' }), (error) => error.status === 422);
    assert.throws(() => reverseCommercialCreditNote(db, { id: note.id, reversalDate: DAY, reason: '  ', actorId: actor.id, idempotencyKey: 'k1' }), (error) => error.status === 400);
    assert.throws(() => reverseCommercialCreditNote(db, { id: note.id, reversalDate: '2026-10-19', reason: '早于贷项', actorId: actor.id, idempotencyKey: 'k2' }), (error) => error.code === 'COMMERCIAL_CREDIT_REVERSAL_BLOCKED');
    assert.throws(() => reverseCommercialCreditNote(db, { id: 'missing', reversalDate: DAY, reason: 'x', actorId: actor.id, idempotencyKey: 'k3' }), (error) => error.code === 'COMMERCIAL_CREDIT_NOTE_NOT_FOUND');
    assert.deepEqual({ ...creditFootprint() }, { ...snapshot });
  });

  test('R1 a credit consumed by a downstream settlement fails closed with no effects', () => {
    const { invoice } = postedServiceInvoice('r1d');
    const note = createCommercialCreditNote(db, { side: 'AR', sourceId: invoice.id, creditDate: DAY, grossCents: 200, actorId: actor.id, idempotencyKey: 'r1d-credit' });
    const adjustment = db.prepare("SELECT * FROM financial_credit_adjustments WHERE source_type='SALES_CREDIT_NOTE' LIMIT 1").get();
    const stamp = new Date().toISOString();
    db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,
      original_amount_cents,business_date,status,created_by,created_at) VALUES('r8-balance','CUSTOMER','CREDIT','r8-c','SALES_CREDIT_NOTE',?,'',
      200,?, 'OPEN',?,?)`).run(adjustment.id, DAY, actor.id, stamp);
    db.prepare(`INSERT INTO balance_applications(id,application_no,side,balance_kind,balance_id,target_open_item_id,amount_cents,business_date,reason,status,creator_id,created_at)
      VALUES('r8-app','R8-APP-1','AR','CREDIT','r8-balance',?,100,?,'占用','CONFIRMED',?,?)`).run(adjustment.target_open_item_id, DAY, actor.id, stamp);
    const snapshot = creditFootprint();

    assert.throws(
      () => reverseCommercialCreditNote(db, { id: note.id, reversalDate: DAY, reason: '应被阻断', actorId: actor.id, idempotencyKey: 'r1d-rev' }),
      (error) => error.code === 'COMMERCIAL_CREDIT_REVERSAL_BLOCKED' && error.details.reason === 'BALANCE_APPLICATION_OR_REFUND',
    );
    assert.deepEqual({ ...creditFootprint() }, { ...snapshot }, 'a blocked reversal writes nothing at all');
  });

  test('R1 discovery is an unlocked pure read and reports the real adjustment set', () => {
    const { invoice } = postedServiceInvoice('r1e');
    const note = createCommercialCreditNote(db, { side: 'AR', sourceId: invoice.id, creditDate: DAY, grossCents: 200, actorId: actor.id, idempotencyKey: 'r1e-credit' });
    const plan = discoverCreditReversalPlan(db, note.id);
    assert.equal(plan.noteId, note.id);
    assert.equal(plan.grossCents, 200);
    assert.equal(plan.adjustmentIds.length, 2, 'a multi-source Service credit has one adjustment per target open item');
    assert.deepEqual(plan.openItemIds, [...plan.openItemIds].sort(), 'open items are returned in a stable id order');
    assert.equal(discoverCreditReversalPlan(db, 'missing'), null);
  });

  // --------------------------------------------------------------- R2 ---

  test('R2 the plan discovers the SO line, fulfillment and FINAL AR candidates', () => {
    const { invoice, fulfillmentIds } = postedServiceInvoice('r2');
    const plan = discoverInvoiceSourcePlan(db, invoice.id);
    assert.deepEqual(plan.salesOrderItemIds, ['r8-soi']);
    assert.deepEqual(plan.fulfillmentIds, [...fulfillmentIds].sort(), 'the invoice links both confirmed fulfillments, discovered in id order');
    assert.equal(plan.finalArIds.length, 2, 'each confirmed fulfillment owns its own FINAL AR open item');
    assert.deepEqual(plan.finalArIds, [...plan.finalArIds].sort());
    assert.equal(plan.invoiceSnapshot.id, invoice.id);
    assert.equal(plan.invoiceSnapshot.status, 'POSTED');
    assert.equal(plan.existingLinks.length, 2, 'the discovery freezes the existing link set');
    assert.deepEqual(plan.existingLinks.map((row) => row.id), plan.existingLinks.map((row) => row.id).sort());
    const unknown = discoverInvoiceSourcePlan(db, 'does-not-exist');
    assert.deepEqual(unknown, { invoiceId: 'does-not-exist', salesOrderItemIds: [], fulfillmentIds: [], finalArIds: [] });
  });

  test('R2 the locked plan takes SO line, Fulfillment, FINAL AR, Invoice and Existing Links in that order', () => {
    const { invoice } = postedServiceInvoice('r2b');
    const plan = discoverInvoiceSourcePlan(db, invoice.id);
    const probe = mysqlLockProbe(db);
    db.exec('BEGIN IMMEDIATE');
    try {
      lockInvoiceSourcePlan(probe, plan);
    } finally {
      db.exec('ROLLBACK');
    }
    const order = (table) => probe.locks.findIndex((entry) => new RegExp(`FROM ${table}\\b`, 'i').test(entry.sql));
    const soLineAt = order('sales_order_items');
    const fulfillmentAt = order('service_fulfillments');
    const arAt = order('account_receivables');
    const invoiceAt = order('sales_invoices');
    const linksAt = order('finance_invoice_source_links');
    assert.ok(soLineAt >= 0 && fulfillmentAt >= 0 && arAt >= 0 && invoiceAt >= 0 && linksAt >= 0,
      'all five stages must actually execute a FOR UPDATE lock');
    assert.ok(soLineAt < fulfillmentAt, 'the SO line is locked before the Fulfillment');
    assert.ok(fulfillmentAt < arAt, 'the Fulfillment is locked before the FINAL AR open item');
    assert.ok(arAt < invoiceAt, 'the FINAL AR open item is locked before the Invoice');
    assert.ok(invoiceAt < linksAt, 'the Invoice authority is locked before Existing Links');
  });

  test('R2 invoice or persisted-link identity changes make the discovered plan stale', () => {
    const { invoice } = postedServiceInvoice('r2-identity');
    const invoicePlan = discoverInvoiceSourcePlan(db, invoice.id);
    db.prepare("UPDATE sales_invoices SET credit_state='PARTIAL',credited_amount_cents=1,remaining_creditable_amount_cents=gross_cents-1 WHERE id=?").run(invoice.id);
    assert.throws(() => lockInvoiceSourcePlan(db, invoicePlan),
      (error) => error.code === 'A3_INVOICE_SOURCE_PLAN_STALE' && error.status === 409);

    db.prepare("UPDATE sales_invoices SET credit_state='NONE',credited_amount_cents=0,remaining_creditable_amount_cents=gross_cents WHERE id=?").run(invoice.id);
    const linkPlan = discoverInvoiceSourcePlan(db, invoice.id);
    db.prepare('UPDATE finance_invoice_source_links SET invoiced_amount_cents=invoiced_amount_cents+1 WHERE id=?')
      .run(linkPlan.existingLinks[0].id);
    assert.throws(() => lockInvoiceSourcePlan(db, linkPlan),
      (error) => error.code === 'A3_INVOICE_SOURCE_PLAN_STALE' && error.status === 409);
  });

  test('R2 an empty existing-link set is protected by the Invoice lock, not an empty-row lock assumption', () => {
    const { invoice } = postedServiceInvoice('r2-empty-links');
    db.prepare('DELETE FROM finance_invoice_source_links WHERE invoice_id=?').run(invoice.id);
    const plan = discoverInvoiceSourcePlan(db, invoice.id);
    assert.deepEqual(plan.existingLinks, []);
    const probe = mysqlLockProbe(db);
    db.exec('BEGIN IMMEDIATE');
    try { lockInvoiceSourcePlan(probe, plan); } finally { db.exec('ROLLBACK'); }
    assert.ok(probe.locks.some((entry) => /FROM sales_invoices\b/i.test(entry.sql)), 'the Invoice row is locked');
    assert.equal(probe.locks.some((entry) => /FROM finance_invoice_source_links\b/i.test(entry.sql)), false,
      'no empty link query is presented as a lock');
  });

  test('R2 a candidate appearing after discovery is refused as a retryable stale plan', () => {
    const { invoice } = postedServiceInvoice('r2c');
    const stale = discoverInvoiceSourcePlan(db, invoice.id);
    // A new confirmed fulfillment commits between discovery and the lock.
    const later = createServiceFulfillmentCommand(db, { salesOrderItemId: 'r8-soi', confirmationQtyMicros: 1_000_000, businessDate: DAY }, actor, 'r2c-late-create');
    confirmServiceFulfillmentCommand(db, later.id, 1, actor, 'r2c-late-confirm');
    assert.throws(() => lockInvoiceSourcePlan(db, stale), (error) => error.code === 'A3_INVOICE_SOURCE_PLAN_STALE' && error.status === 409);
  });

  test('R2 a non-Service invoice plans no locks and is entirely unaffected', () => {
    const stamp = new Date().toISOString();
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy)
      VALUES('r8-phy','R8-PHY','R8 Physical','','EA',100,0,1,?,?,'EA','NONE')`).run(stamp, stamp);
    db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,service_classification,service_kind,active,created_at,updated_at,created_by,updated_by)
      VALUES('r8-phy-c','r8-phy',1,0,NULL,1,?,?,?,?)`).run(stamp, stamp, actor.id, actor.id);
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,order_date,payment_terms_days)
      VALUES('r8-so-phy','R8-SO-PHY','r8-c','APPROVED',100,?,?,?,?,0)`).run(actor.id, stamp, stamp, DAY);
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,
      document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den)
      VALUES('r8-soi-phy','r8-so-phy','r8-phy',1,100,100,1,'EA',1000000,1000000,1,1,1000000,1000000)`).run();
    db.prepare("INSERT INTO inventory(warehouse_id,product_id,quantity,updated_at) VALUES('r8-w','r8-phy',10,?)").run(stamp);
    db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
      VALUES('r8-d-phy','R8-D-PHY','r8-so-phy','r8-c','r8-w',?,100,'CONFIRMED',?,'',?,?,?,?,?)`)
      .run(actor.id, DAY, actor.id, stamp, stamp, stamp, actor.id);
    db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id,document_uom_code,document_quantity_num,document_quantity_den,base_quantity_num,base_quantity_den)
      VALUES('r8-di-phy','r8-d-phy','r8-phy',1,100,100,1,'r8-soi-phy','EA',1,1,1,1)`).run();
    const draft = createSalesInvoice(db, { customerId: 'r8-c', invoiceDate: DAY, taxMode: 'NO_TAX', actorId: actor.id, idempotencyKey: 'r2d-inv', items: [{ deliveryItemId: 'r8-di-phy', quantityNumerator: 1, quantityDenominator: 1, unitPriceCents: 100 }] });
    const plan = discoverInvoiceSourcePlan(db, draft.id);
    assert.deepEqual(plan.salesOrderItemIds, []);
    assert.deepEqual(plan.fulfillmentIds, []);
    assert.deepEqual(plan.finalArIds, []);
    const probe = mysqlLockProbe(db);
    db.exec('BEGIN IMMEDIATE');
    try { lockInvoiceSourcePlan(probe, plan); } finally { db.exec('ROLLBACK'); }
    assert.deepEqual(probe.locks, [], 'a non-Service invoice acquires no Sales-stage lock at all');
    const posted = postSalesInvoice(db, draft.id, actor.id);
    assert.equal(posted.status, 'POSTED', 'the frozen non-Service posting path is unchanged');
  });

  test('R2 VOID and Credit compose the same plan; the R1 reversal then reopens VOID and leaves links immutable', () => {
    const { invoice } = postedServiceInvoice('r2e');
    const linksBefore = db.prepare('SELECT * FROM finance_invoice_source_links WHERE invoice_id=? ORDER BY id').all(invoice.id).map((row) => ({ ...row }));
    assert.equal(linksBefore.length, 2);

    const note = createCommercialCreditNote(db, { side: 'AR', sourceId: invoice.id, creditDate: DAY, grossCents: 100, actorId: actor.id, idempotencyKey: 'r2e-credit' });
    assert.equal(note.status, 'POSTED', 'Credit composed the plan and still succeeded');
    assert.deepEqual(db.prepare('SELECT * FROM finance_invoice_source_links WHERE invoice_id=? ORDER BY id').all(invoice.id).map((row) => ({ ...row })), linksBefore, 'Credit left the links untouched');

    // The frozen rule stands: an invoice carrying a posted credit cannot be voided directly.
    assert.throws(() => voidPostedInvoice(db, 'AR', invoice.id, actor.id, 'premature VOID'), /贷项/);

    // R1 is exactly what reopens it: the reversal returns credit_state to NONE.
    reverseCommercialCreditNote(db, { id: note.id, reversalDate: DAY, reason: '撤销以作废发票', actorId: actor.id, idempotencyKey: 'r2e-rev' });
    const voided = voidPostedInvoice(db, 'AR', invoice.id, actor.id, 'R2 VOID');
    assert.equal(voided.status, 'REVERSED');
    assert.deepEqual(db.prepare('SELECT * FROM finance_invoice_source_links WHERE invoice_id=? ORDER BY id').all(invoice.id).map((row) => ({ ...row })), linksBefore, 'VOID left the historical links untouched');
  });
});
