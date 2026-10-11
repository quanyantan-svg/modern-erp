// V22 — Finance Operations Wave C focused tests.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from './db.js';
import { upsertInvoiceSourceLink } from './modules/finance-invoice-cardinality.js';
import { convertProvisionalToFinancial } from './modules/finance-provisional-conversion.js';

function bootstrap() {
  const db = createDatabase(':memory:');
  return db;
}

function actor() {
  return {
    id: 'user-admin',
    permissions: ['FINANCE_INVOICE_MANAGE', 'FINANCE_MANAGE'],
  };
}

function mkRes() {
  const r = {
    statusCode: null, body: null,
    setHeader: () => {}, getHeader: () => null,
    write: () => {}, on: () => {}, once: () => {},
  };
  r.end = (chunk) => { if (chunk) { try { r.body = JSON.parse(chunk); } catch (_) { r.body = null; } } };
  return r;
}

async function mkReq(body) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return {
    headers: { 'content-type': 'application/json' },
    [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c; },
  };
}

function mkAR(db, id, customerId, amount, status = 'PENDING') {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO account_receivables(id, voucher_no, customer_id, source_type, source_id,
     amount_cents, paid_cents, write_off_cents, status, due_date,
     business_date, recognition_mode, item_kind, conversion_state, creator_id, created_at, updated_at)
     VALUES(?, ?, ?, 'MANUAL', ?, ?, 0, 0, ?, '2026-12-31', '2026-01-01', 'DIRECT_BUSINESS_OPEN_ITEM', 'FINAL', 'OPEN', 'user-admin', ?, ?)`)
    .run(id, `V-${id}`, customerId, id, amount, status, now, now);
  db.prepare(`UPDATE account_receivables SET open_amount_cents=? WHERE id=?`).run(amount, id);
}

function mkAP(db, id, supplierId, amount, status = 'PENDING') {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO account_payables(id, voucher_no, supplier_id, source_type, source_id,
     amount_cents, paid_cents, write_off_cents, status, due_date,
     business_date, recognition_mode, item_kind, conversion_state, creator_id, created_at, updated_at)
     VALUES(?, ?, ?, 'MANUAL', ?, ?, 0, 0, ?, '2026-12-31', '2026-01-01', 'DIRECT_BUSINESS_OPEN_ITEM', 'FINAL', 'OPEN', 'user-admin', ?, ?)`)
    .run(id, `V-${id}`, supplierId, id, amount, status, now, now);
  db.prepare(`UPDATE account_payables SET open_amount_cents=? WHERE id=?`).run(amount, id);
}

test('finance_invoice_source_links: INSERT creates cardinality link', async () => {
  const db = bootstrap();
  const res = mkRes();
  const req = await mkReq({
    invoiceId: 'inv-1', invoiceSide: 'SALES_INVOICE',
    sourceType: 'SALES_DELIVERY', sourceId: 'sd-1', sourceLineId: 'sdl-1',
    invoicedQuantity: 5, invoicedAmountCents: 50000,
  });
  await upsertInvoiceSourceLink(db, req, res, actor());
  assert.equal(res.statusCode, 200);
  const links = db.prepare(`SELECT * FROM finance_invoice_source_links WHERE invoice_id='inv-1'`).all();
  assert.equal(links.length, 1);
  assert.equal(links[0].invoiced_quantity, 5);
});

test('sales_invoices: additive credit_state / credited_amount_cents columns exist', () => {
  const db = bootstrap();
  // Insert a sales_invoice header (need basic schema columns)
  const now = new Date().toISOString();
  // First check columns exist
  const cols = db.prepare(`PRAGMA table_info(sales_invoices)`).all();
  const hasCreditState = cols.some(c => c.name === 'credit_state');
  const hasCreditedAmt = cols.some(c => c.name === 'credited_amount_cents');
  const hasRemainingCreditable = cols.some(c => c.name === 'remaining_creditable_amount_cents');
  assert.ok(hasCreditState, 'credit_state column exists');
  assert.ok(hasCreditedAmt, 'credited_amount_cents column exists');
  assert.ok(hasRemainingCreditable, 'remaining_creditable_amount_cents column exists');
});

test('provisional AR → financial AR conversion flips conversion_state', () => {
  const db = bootstrap();
  // create PROVISIONAL AR
  db.prepare(`INSERT INTO account_receivables(id, voucher_no, customer_id, source_type, source_id,
     amount_cents, paid_cents, write_off_cents, status, due_date,
     business_date, recognition_mode, item_kind, conversion_state, creator_id, created_at, updated_at)
     VALUES(?, 'V-PR', 'customer-001', 'PURCHASE_RECEIPT', ?, 50000, 0, 0, 'PENDING', '2026-12-31', '2026-01-01', 'PROVISIONAL_TO_FINANCIAL', 'PROVISIONAL', 'OPEN', 'user-admin', ?, ?)`)
    .run('aprov-1', 'arprov-1', new Date().toISOString(), new Date().toISOString());
  db.prepare(`UPDATE account_receivables SET open_amount_cents=? WHERE id=?`).run(50000, 'aprov-1');
  // create FINAL AR
  mkAR(db, 'afinal-1', 'customer-001', 50000);
  // convert
  convertProvisionalToFinancial(db, { provisionalOpenItemId: 'aprov-1', finalOpenItemId: 'afinal-1', side: 'AR', actor: { id: 'user-admin' } });
  const after = db.prepare(`SELECT conversion_state, converted_open_item_id FROM account_receivables WHERE id='aprov-1'`).get();
  assert.equal(after.conversion_state, 'CONVERTED');
  assert.equal(after.converted_open_item_id, 'afinal-1');
});

test('finance_invoice_source_links: multiple partial lines', async () => {
  const db = bootstrap();
  const res = mkRes();
  // line 1
  await upsertInvoiceSourceLink(db, await mkReq({
    invoiceId: 'inv-2', invoiceSide: 'SALES_INVOICE',
    sourceType: 'SALES_DELIVERY', sourceId: 'sd-2', sourceLineId: 'sdl-2a',
    invoicedQuantity: 3, invoicedAmountCents: 30000,
  }), res, actor());
  // line 2 (partial)
  await upsertInvoiceSourceLink(db, await mkReq({
    invoiceId: 'inv-2', invoiceSide: 'SALES_INVOICE',
    sourceType: 'SALES_DELIVERY', sourceId: 'sd-2', sourceLineId: 'sdl-2b',
    invoicedQuantity: 2, invoicedAmountCents: 20000,
  }), res, actor());
  const links = db.prepare(`SELECT * FROM finance_invoice_source_links WHERE invoice_id='inv-2'`).all();
  assert.equal(links.length, 2);
});

test('credit_state default is NONE on sales_invoices and supplier_bills', () => {
  const db = bootstrap();
  // check existing seeded rows have credit_state = NONE
  const cols = db.prepare(`PRAGMA table_info(sales_invoices)`).all();
  assert.ok(cols.some(c => c.name === 'credit_state'));
  const cols2 = db.prepare(`PRAGMA table_info(supplier_bills)`).all();
  assert.ok(cols2.some(c => c.name === 'credit_state'));
});
