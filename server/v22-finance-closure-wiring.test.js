// V22 — Finance Operations closure wiring (2026-11-12).
//
// Evidence for the capabilities that were found to be inert on 2026-11-12:
//
//   FO03 / FO04  the payment-term master and the multi-due-date schedule are
//                consumed by the open-item creation path;
//   FO05 / FO19  the settlement / reconciliation scheme decides whether the
//                automatic reconciliation runs for its side;
//   FO36         the invoice operational report exists and reads the invoice
//                facts plus their source cardinality.
//
// Each case also carries a negative control, so a green result cannot come
// from a check that never runs.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDatabase } from './db.js';
import { id } from './db.js';
import { createManualAccountReceivable } from './modules/finance-ar-open-item.js';
import { recognizeFinanceExposure } from './modules/finance-recognition.js';
import { RECOGNITION_MODES } from './modules/finance-recognition-policy.js';
import { activeSettlementScheme, reconcileSettlementSubledgers } from './modules/settlement-core.js';
import { invoiceOperationalReport } from './modules/finance-reports.js';

const now = () => new Date().toISOString();

function actor(extra = []) {
  return {
    id: 'user-admin',
    permissions: ['FINANCE_INVOICE_MANAGE', 'FINANCE_MANAGE', 'FINANCE_AR_VIEW', 'FINANCE_INVOICE_VIEW', ...extra],
  };
}

function mkRes() {
  const res = {
    statusCode: null, body: null,
    setHeader: () => {}, getHeader: () => null,
    write: () => {}, on: () => {}, once: () => {},
  };
  res.end = (chunk) => { if (chunk) { try { res.body = JSON.parse(chunk); } catch { res.body = null; } } };
  return res;
}

async function mkReq(body) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return {
    headers: { 'content-type': 'application/json' },
    [Symbol.asyncIterator]: async function* () { for (const chunk of chunks) yield chunk; },
  };
}

function seedTerm(db, code, days, installments = []) {
  const termId = id();
  const stamp = now();
  db.prepare(`INSERT INTO finance_payment_terms(id, code, name, days, active, created_at, updated_at)
    VALUES(?,?,?,?,1,?,?)`).run(termId, code, `term ${code}`, days, stamp, stamp);
  installments.forEach((line, index) => {
    db.prepare(`INSERT INTO finance_payment_term_installments(id, term_id, sequence, due_offset_days, ratio_bps, created_at)
      VALUES(?,?,?,?,?,?)`).run(id(), termId, line.sequence || index + 1, line.dueOffsetDays, line.ratioBps, stamp);
  });
  return termId;
}

test('FO03 / FO04: an open item gets a multi-line schedule from the term master', async () => {
  const db = createDatabase(':memory:');
  seedTerm(db, 'DEFAULT', 60, [
    { sequence: 1, dueOffsetDays: 30, ratioBps: 3000 },
    { sequence: 2, dueOffsetDays: 60, ratioBps: 7000 },
  ]);
  const res = mkRes();
  await createManualAccountReceivable(db, await mkReq({
    customerId: 'customer-001', amountCents: 100000, businessDate: '2026-10-01', reason: 'wiring',
  }), res, actor());
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const arId = res.body.id;
  const lines = db.prepare('SELECT * FROM finance_due_schedule_lines WHERE side=? AND open_item_id=? ORDER BY sequence').all('AR', arId);
  assert.equal(lines.length, 2, 'the two-installment term must produce two schedule lines');
  assert.equal(lines[0].due_date, '2026-10-31');
  assert.equal(lines[1].due_date, '2026-11-30');
  assert.equal(lines[0].scheduled_amount_cents, 30000);
  assert.equal(lines[1].scheduled_amount_cents, 70000);
  const sum = lines.reduce((total, line) => total + Number(line.scheduled_amount_cents), 0);
  assert.equal(sum, 100000, 'SUM(scheduled_amount_cents) must equal the open item amount');
  const header = db.prepare('SELECT due_date FROM account_receivables WHERE id=?').get(arId);
  assert.equal(header.due_date, '2026-11-30', 'the single due_date column projects the last schedule line');
});

test('FO03 / FO04: without a term the open item keeps exactly one schedule line', async () => {
  const db = createDatabase(':memory:');
  const res = mkRes();
  await createManualAccountReceivable(db, await mkReq({
    customerId: 'customer-001', amountCents: 5000, businessDate: '2026-10-01', reason: 'no term',
  }), res, actor());
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const lines = db.prepare('SELECT * FROM finance_due_schedule_lines WHERE side=? AND open_item_id=?').all('AR', res.body.id);
  assert.equal(lines.length, 1);
  assert.equal(Number(lines[0].scheduled_amount_cents), 5000);
});

test('FO03: an unknown term code fails closed instead of losing the terms', async () => {
  const db = createDatabase(':memory:');
  const res = mkRes();
  const req = await mkReq({
    customerId: 'customer-001', amountCents: 5000, businessDate: '2026-10-01', reason: 'bad term', termCode: 'NOPE',
  });
  await assert.rejects(
    () => createManualAccountReceivable(db, req, res, actor()),
    (error) => error.code === 'FINANCE_PAYMENT_TERM_NOT_FOUND' && error.status === 409,
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM account_receivables').get().n, 0, 'a failed term must not leave an open item behind');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_due_schedule_lines').get().n, 0);
});

test('FO05 / FO19: a MANUAL scheme turns the automatic reconciliation off for its side', () => {
  const db = createDatabase(':memory:');
  const stamp = now();
  db.prepare(`INSERT INTO finance_settlement_schemes(id, side, scheme_code, name, match_method, active, created_at)
    VALUES(?, 'AR', 'AR-MANUAL', '人工匹配', 'MANUAL', 1, ?)`).run(id(), stamp);
  db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at,billing_mode)
    VALUES('scheme-sd','SD-SCHEME','customer-001','warehouse-001','user-sales',4321,'CONFIRMED','2026-08-12','','user-sales',?,?,'LEGACY_DIRECT')`).run(stamp, stamp);

  reconcileSettlementSubledgers(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_id='scheme-sd'").get().n, 0,
    'a MANUAL scheme must not let the automatic reconciliation create the open item');

  db.prepare("UPDATE finance_settlement_schemes SET match_method='AUTO' WHERE side='AR'").run();
  reconcileSettlementSubledgers(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_id='scheme-sd'").get().n, 1,
    'an AUTO scheme lets the automatic reconciliation run');
  assert.ok(activeSettlementScheme(db, 'AR'), 'the active scheme must be resolvable');
});

test('FO19: without any scheme the automatic reconciliation still runs', () => {
  const db = createDatabase(':memory:');
  const stamp = now();
  db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at,billing_mode)
    VALUES('noscheme-sd','SD-NOSCHEME','customer-001','warehouse-001','user-sales',1234,'CONFIRMED','2026-08-12','','user-sales',?,?,'LEGACY_DIRECT')`).run(stamp, stamp);
  reconcileSettlementSubledgers(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_id='noscheme-sd'").get().n, 1);
  assert.equal(activeSettlementScheme(db, 'AR'), null);
});

test('FO36: the invoice operational report reads the invoice facts and their source cardinality', () => {
  const db = createDatabase(':memory:');
  db.prepare(`INSERT INTO sales_invoices(id,invoice_no,customer_id,invoice_date,status,tax_mode,net_cents,tax_cents,gross_cents,tax_snapshot_json,creator_id,created_at)
    VALUES('rep-inv','SI-REP','customer-001','2026-10-12','POSTED','NO_TAX',9000,1000,10000,'[]','user-admin',?)`).run(now());
  db.prepare(`INSERT INTO finance_invoice_source_links(id,invoice_id,invoice_side,source_type,source_id,source_line_id,invoiced_quantity,invoiced_amount_cents,created_at)
    VALUES(?, 'rep-inv', 'SALES_INVOICE', 'SALES_DELIVERY', 'rep-sd', 'rep-line', 2, 10000, ?)`).run(id(), now());

  const res = mkRes();
  invoiceOperationalReport(db, res, actor(), { searchParams: new Map([['side', 'AR']]) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.rows.length, 1);
  const row = res.body.rows[0];
  assert.equal(row.document_no, 'SI-REP');
  assert.equal(Number(row.net_cents), 9000);
  assert.equal(Number(row.tax_cents), 1000);
  assert.equal(Number(row.gross_cents), 10000);
  assert.equal(row.source_line_count, 1);
  assert.equal(Number(row.linked_amount_cents), 10000);
  assert.equal(res.body.totals.invoices, 1);
  assert.deepEqual(row.tax_snapshot, []);
});
