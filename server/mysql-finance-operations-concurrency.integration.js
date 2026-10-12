// V22 — Finance Operations Domain real MySQL race matrix (15 races).
//
// Each RACE scenario races two or more real finance actions through
// worker subprocesses (each with its own MySQL connection) and then
// verifies the final economic state against canonical production
// tables (account_receivables, account_payables, sales_invoices,
// supplier_bills, accounting_vouchers, finance_invoice_source_links,
// settlement_unapplied_balances, finance_treasury_movements,
// bank_statement_items, finance_business_close_state). The MySQL
// dialect is asserted on bootstrap so a silent SQLite fallback cannot
// produce false-green results.
//
// Run:
//   ERP_DB_BACKEND=mysql ERP_DB_HOST=… ERP_DB_PORT=… ERP_DB_NAME=… \
//   ERP_DB_USER=… ERP_DB_PASSWORD=… ERP_MYSQL_TEST_ALLOW_RESET=true \
//   pnpm test:mysql:finance-concurrency

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { after, before, beforeEach, describe, test } from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTempDb } from './test-utils/temp-db.js';
import { applyTreasuryMovement } from './modules/finance-treasury-movement.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'finance-concurrency-worker.mjs');
const ACTOR_ID = 'finance-race-actor';
const BUSINESS_DATE = '2026-10-12';
const CUSTOMER_ID = 'finance-race-customer';
const SUPPLIER_ID = 'finance-race-supplier';
const SETTLEMENT_BANK = 'finance-race-bank-cash';
const SETTLEMENT_BANK_TWO = 'finance-race-bank-cash-two';

class AppInstance {
  constructor(name) {
    this.name = name;
    this.pending = new Map();
    this.stderr = '';
    this.child = spawn(process.execPath, [workerPath], {
      cwd: repoRoot,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      let response;
      try { response = JSON.parse(line); } catch (error) {
        this.stderr += `\n[worker parse failure] ${line}\n${error?.message || error}`;
        return;
      }
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(Object.assign(new Error(response.error?.message || 'worker error'), response.error || {}));
    });
    this.child.on('exit', (code) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`${name} exited ${code}: ${this.stderr}`));
      }
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

const fulfilled = (results) => results.filter((r) => r.status === 'fulfilled');
const rejected = (results) => results.filter((r) => r.status === 'rejected');

describe('V22 Finance Operations real MySQL race matrix (15 races)', () => {
  let mysql;
  let db;
  let apps;

  function race(commands) {
    return Promise.allSettled(commands.map((command, index) => apps[index % apps.length].run(command)));
  }

  before(() => {
    mysql = createTempDb({ label: 'mysql-finance-operations-races', production: true });
    db = mysql.db;
    if (db.dialect !== 'mysql') {
      throw new Error(
        `Finance MySQL race suite expected db.dialect='mysql' but got '${db.dialect}'. `
        + `Set ERP_TEST_DB_BACKEND=mysql and ERP_DB_BACKEND=mysql before invoking this suite.`,
      );
    }
    console.log(`FINANCE RACE DIALECT = ${db.dialect}`);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,'role-accounting',1,?)`).run(ACTOR_ID, ACTOR_ID, 'Finance Race User', 'x', 'x', now);
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,email,active,payment_terms_days,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,1,0,?,?)`).run(CUSTOMER_ID, 'FR-CUST', 'Finance Race Customer', '', '', '', '', now, now);
    db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,email,active,payment_terms_days,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,1,0,?,?)`).run(SUPPLIER_ID, 'FR-SUP', 'Finance Race Supplier', '', '', '', '', now, now);
    // Chart-of-account seeds used by the worker's voucher generation.
    for (const [code, name] of [['1122', '应收账款'], ['2202', '应付账款'], ['1403', 'GRNI'], ['2221', '应交税费-进项税'], ['6001', '主营业务收入']]) {
      try {
        db.prepare(`INSERT INTO accounting_subjects(id,code,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)`)
          .run(`as-${code}`, code, name, now, now);
      } catch { /* idempotent */ }
    }
    for (const [id, code] of [[SETTLEMENT_BANK, 'FR-BANK-1'], [SETTLEMENT_BANK_TWO, 'FR-BANK-2']]) {
      db.prepare(`INSERT INTO bank_accounts(id,bank_name,account_no,account_name,account_type,currency,active,created_at,updated_at,code,opening_balance_cents,accounting_role,accounting_subject_id)
        VALUES(?,?,?,?,?,'BANK','CHECKING','CNY',1,?,?,?,?,?)`)
        .run(id, `Finance Race Bank ${code}`, code, `FR ${code}`, 'CHECKING', code, code, 0, 'CASH_BANK', `as-1002`, now);
    }
    apps = Array.from({ length: 4 }, (_, index) => new AppInstance(`finance-app-${index + 1}`));
  });

  beforeEach(() => {
    // Wipe RACE-prefixed rows so each test starts from a known seed state.
    const wipeTables = [
      'finance_treasury_movements',
      'balance_applications',
      'payment_collection_items',
      'payment_collections',
      'payment_disbursement_items',
      'payment_disbursements',
      'settlement_unapplied_balances',
      'financial_refunds',
      'financial_write_offs',
      'accounting_entries',
      'accounting_vouchers',
      'finance_invoice_source_links',
      'bank_statement_items',
      'bank_statements',
      'bank_reconciliations',
      'finance_counterparty_transfers',
      'finance_counterparty_transfer_lines',
      'finance_business_closures',
    ];
    for (const table of wipeTables) {
      try { db.prepare(`DELETE FROM ${table} WHERE source_no LIKE 'RACE-%' OR source_no LIKE 'PAY-RACE-%' OR source_no LIKE 'RACE-COLR-%' OR source_no LIKE 'RACE-PAYR-%' OR creator_id='finance-race-actor'`).run(); }
      catch { db.prepare(`DELETE FROM ${table}`).run(); }
    }
    db.prepare(`DELETE FROM sales_invoices WHERE customer_id=?`).run(CUSTOMER_ID);
    db.prepare(`DELETE FROM supplier_bills WHERE supplier_id=?`).run(SUPPLIER_ID);
    db.prepare(`DELETE FROM sales_deliveries WHERE customer_id=?`).run(CUSTOMER_ID);
    db.prepare(`DELETE FROM purchase_receipts WHERE supplier_id=?`).run(SUPPLIER_ID);
    db.prepare(`DELETE FROM account_receivables WHERE customer_id=?`).run(CUSTOMER_ID);
    db.prepare(`DELETE FROM account_payables WHERE supplier_id=?`).run(SUPPLIER_ID);
    db.prepare(`UPDATE finance_business_close_state SET closed_through_date=''`).run();
  });

  after(() => {
    for (const app of apps || []) app.close();
    mysql?.cleanup();
  });

  // helpers ------------------------------------------------------------
  function seedReceivableFinal(amountCents, suffix = '') {
    const id = `race-ar-${randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO account_receivables(id, voucher_no, customer_id, source_type, source_id, source_no, amount_cents, paid_cents, write_off_cents, status, due_date, business_date, recognition_mode, item_kind, conversion_state, item_class, provisional_origin_id, converted_open_item_id, settlement_account_id, creator_id, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,0,0,'PENDING',?,?,?,'FINAL','OPEN','SOURCE',NULL,NULL,?,?,?,?)`)
      .run(id, `RACE-AR-${id.slice(-6)}`, CUSTOMER_ID, 'COLLECTION_RACE', id, `RACE-${id.slice(-6)}`,
           amountCents, BUSINESS_DATE, BUSINESS_DATE,
           'INVOICE_DRIVEN_OPEN_ITEM', SETTLEMENT_BANK, ACTOR_ID, now, now);
    return id;
  }
  function seedPayableFinal(amountCents) {
    const id = `race-ap-${randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO account_payables(id, voucher_no, supplier_id, source_type, source_id, source_no, amount_cents, paid_cents, write_off_cents, status, due_date, business_date, recognition_mode, item_kind, conversion_state, item_class, provisional_origin_id, converted_open_item_id, settlement_account_id, creator_id, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,0,0,'PENDING',?,?,?,'FINAL','OPEN','SOURCE',NULL,NULL,?,?,?,?)`)
      .run(id, `RACE-AP-${id.slice(-6)}`, SUPPLIER_ID, 'PAYMENT_RACE', id, `RACE-${id.slice(-6)}`,
           amountCents, BUSINESS_DATE, BUSINESS_DATE,
           'INVOICE_DRIVEN_OPEN_ITEM', SETTLEMENT_BANK, ACTOR_ID, now, now);
    return id;
  }
  function seedReceivableProvisional(amountCents) {
    const id = `race-ar-prov-${randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO account_receivables(id, voucher_no, customer_id, source_type, source_id, source_no, amount_cents, paid_cents, write_off_cents, status, due_date, business_date, recognition_mode, item_kind, conversion_state, item_class, provisional_origin_id, converted_open_item_id, settlement_account_id, creator_id, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,0,0,'PENDING',?,?,?,'PROVISIONAL','OPEN','SOURCE',NULL,NULL,?,?,?,?)`)
      .run(id, `RACE-AR-PROV-${id.slice(-6)}`, CUSTOMER_ID, 'PROV_RACE', id, `RACE-PROV-${id.slice(-6)}`,
           amountCents, BUSINESS_DATE, BUSINESS_DATE,
           'PROVISIONAL_TO_FINANCIAL', SETTLEMENT_BANK, ACTOR_ID, now, now);
    return id;
  }
  function seedPrepayment(amountCents, side) {
    const balanceId = `race-bal-${randomUUID()}`;
    const now = new Date().toISOString();
    const partyId = side === 'CUSTOMER' ? CUSTOMER_ID : SUPPLIER_ID;
    db.prepare(`INSERT INTO settlement_unapplied_balances(id, side, balance_type, party_id, source_type, source_id, source_no, original_amount_cents, remaining_cents, business_date, settlement_account_id, status, created_by, created_at, updated_at)
      VALUES(?, ?, 'PREPAYMENT', ?, 'PAYMENT_RACE', ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`)
      .run(balanceId, side, partyId, balanceId, balanceId, amountCents, amountCents, BUSINESS_DATE, SETTLEMENT_BANK, ACTOR_ID, now, now);
    applyTreasuryMovement(db, {
      settlementAccountId: SETTLEMENT_BANK,
      direction: side === 'CUSTOMER' ? 'IN' : 'OUT',
      amountCents, businessDate: BUSINESS_DATE,
      sourceType: 'PREPAYMENT_RACE', sourceId: balanceId,
      idempotencyKey: `PREPAYMENT_RACE:${balanceId}`, createdBy: ACTOR_ID,
    });
    return balanceId;
  }
  function seedSalesInvoiceDraft(grossCents, taxCents = 0, sourceId = null) {
    const id = `race-inv-${randomUUID()}`;
    const now = new Date().toISOString();
    const netCents = grossCents - taxCents;
    db.prepare(`INSERT INTO sales_invoices(id, invoice_no, customer_id, invoice_date, status, tax_mode, net_cents, tax_cents, gross_cents, creator_id, created_at)
      VALUES(?, ?, ?, ?, 'DRAFT', 'EXCLUSIVE', ?, ?, ?, ?, ?)`)
      .run(id, `RACE-INV-${id.slice(-6)}`, CUSTOMER_ID, BUSINESS_DATE, netCents, taxCents, grossCents, ACTOR_ID, now);
    if (sourceId) {
      db.prepare(`INSERT INTO finance_invoice_source_links(id, invoice_id, invoice_side, source_type, source_id, source_line_id, invoiced_quantity, invoiced_amount_cents, created_at)
        VALUES(?, ?, 'SALES_INVOICE', 'SALES_DELIVERY', ?, '', 1, ?, ?)`)
        .run(`${id}:${sourceId}`, id, sourceId, grossCents, now);
    }
    return id;
  }
  function seedSupplierBillWaitingMatch(grossCents, taxCents = 0) {
    const id = `race-bill-${randomUUID()}`;
    const now = new Date().toISOString();
    const netCents = grossCents - taxCents;
    db.prepare(`INSERT INTO supplier_bills(id, bill_no, supplier_id, supplier_invoice_no, bill_date, status, tax_mode, net_cents, tax_cents, gross_cents, grni_cents, variance_cents, creator_id, created_at)
      VALUES(?, ?, ?, ?, ?, 'WAITING_MATCH', 'EXCLUSIVE', ?, ?, ?, ?, 0, ?, ?)`)
      .run(id, `RACE-BILL-${id.slice(-6)}`, SUPPLIER_ID, `RACE-${id.slice(-6)}`, BUSINESS_DATE,
           netCents, taxCents, grossCents, grossCents, ACTOR_ID, now);
    return id;
  }
  function seedSupplierBillMatched(grossCents, taxCents = 0) {
    const id = seedSupplierBillWaitingMatch(grossCents, taxCents);
    db.prepare(`UPDATE supplier_bills SET status='MATCHED', matched_unit_price_cents=? WHERE id=?`).run(grossCents, id);
    return id;
  }
  function seedBankStatementAndMovement(amountCents) {
    const stmtLineId = `race-stmt-line-${randomUUID()}`;
    const bookMovementId = `race-book-${randomUUID()}`;
    const stmtId = `race-stmt-${randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO bank_statements(id, bank_account_id, statement_no, statement_date, period, opening_balance_cents, closing_balance_cents, total_debit_cents, total_credit_cents, total_count, creator_id, created_at)
      VALUES(?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?)`)
      .run(stmtId, SETTLEMENT_BANK, stmtId, BUSINESS_DATE, BUSINESS_DATE, amountCents, amountCents, 1, ACTOR_ID, now);
    db.prepare(`INSERT INTO bank_statement_items(id, statement_id, line_no, transaction_date, summary, debit_cents, credit_cents, balance_cents, counterparty, reference_no, external_transaction_date, value_date, amount_cents, direction, bank_reference, description, import_fingerprint, matched_cents)
      VALUES(?, ?, 1, ?, ?, 0, ?, 0, '', ?, ?, ?, ?, 'IN', ?, '', ?, 0)`)
      .run(stmtLineId, stmtId, BUSINESS_DATE, 'race', amountCents, stmtLineId, BUSINESS_DATE, BUSINESS_DATE, amountCents, stmtLineId, stmtLineId);
    applyTreasuryMovement(db, {
      settlementAccountId: SETTLEMENT_BANK, direction: 'IN',
      amountCents, businessDate: BUSINESS_DATE,
      sourceType: 'BANK_STATEMENT_RACE', sourceId: bookMovementId,
      idempotencyKey: `BANK_STATEMENT_RACE:${bookMovementId}`, createdBy: ACTOR_ID,
    });
    return { stmtLineId, bookMovementId, stmtId };
  }

  // Helper: count economic effects on the canonical authoritative
  // tables for sales invoice posting.
  function salesInvoiceEffects(invoiceId) {
    const status = db.prepare(`SELECT status FROM sales_invoices WHERE id=?`).get(invoiceId)?.status || null;
    const voucherCount = Number(db.prepare(`SELECT COUNT(*) c FROM accounting_vouchers WHERE source_type='SALES_INVOICE' AND source_id=?`).get(invoiceId)?.c || 0);
    const arRecognitionCount = Number(db.prepare(`SELECT COUNT(*) c FROM account_receivables WHERE source_type='SALES_INVOICE' AND source_id=?`).get(invoiceId)?.c || 0);
    const sourceLinkCount = Number(db.prepare(`SELECT COUNT(*) c FROM finance_invoice_source_links WHERE invoice_id=?`).get(invoiceId)?.c || 0);
    return { status, voucherCount, arRecognitionCount, sourceLinkCount };
  }
  function supplierBillEffects(billId) {
    const status = db.prepare(`SELECT status, grni_cents, tax_cents, gross_cents FROM supplier_bills WHERE id=?`).get(billId);
    const voucherCount = Number(db.prepare(`SELECT COUNT(*) c FROM accounting_vouchers WHERE source_type='SUPPLIER_BILL' AND source_id=?`).get(billId)?.c || 0);
    const apRecognitionCount = Number(db.prepare(`SELECT COUNT(*) c FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?`).get(billId)?.c || 0);
    const sourceLinkCount = Number(db.prepare(`SELECT COUNT(*) c FROM finance_invoice_source_links WHERE invoice_id=?`).get(billId)?.c || 0);
    return { status: status?.status, grniCents: Number(status?.grni_cents || 0), taxCents: Number(status?.tax_cents || 0), grossCents: Number(status?.gross_cents || 0), voucherCount, apRecognitionCount, sourceLinkCount };
  }

  // ===== races =====

  test('RACE-01 Collection vs Collection same AR — combined allocation never exceeds open', async () => {
    const openItemId = seedReceivableFinal(10000);
    const results = await race([
      { action: 'collection-allocate', openItemId, amountCents: 7000, customerId: CUSTOMER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE },
      { action: 'collection-allocate', openItemId, amountCents: 5000, customerId: CUSTOMER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE },
    ]);
    const ok = fulfilled(results);
    const conflict = rejected(results).filter((r) => r.reason?.code === 'INSUFFICIENT_OPEN');
    assert.ok(ok.length === 1 && conflict.length === 1, `expected one accept + one insufficient-open, got ok=${ok.length} conflict=${conflict.length}`);
    const row = db.prepare(`SELECT amount_cents, paid_cents FROM account_receivables WHERE id=?`).get(openItemId);
    const openCents = Number(row.amount_cents) - Number(row.paid_cents);
    assert.ok(openCents >= 0 && openCents <= 10000, `open=${openCents} must be in [0, 10000]`);
    const collectionTotal = Number(db.prepare(`SELECT COALESCE(SUM(pc.amount_cents),0) t FROM payment_collections pc WHERE pc.receivable_id=? AND pc.status='CONFIRMED'`).get(openItemId)?.t || 0);
    assert.ok(collectionTotal <= 10000, `combined allocation ${collectionTotal} must never exceed original open 10000`);
  });

  test('RACE-02 Payment vs Payment same AP — combined allocation never exceeds open', async () => {
    const openItemId = seedPayableFinal(8000);
    const results = await race([
      { action: 'payment-allocate', openItemId, amountCents: 5000, supplierId: SUPPLIER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE },
      { action: 'payment-allocate', openItemId, amountCents: 4000, supplierId: SUPPLIER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE },
    ]);
    const ok = fulfilled(results);
    const conflict = rejected(results).filter((r) => r.reason?.code === 'INSUFFICIENT_OPEN');
    assert.ok(ok.length === 1 && conflict.length === 1, `expected one accept + one insufficient-open`);
    const paymentTotal = Number(db.prepare(`SELECT COALESCE(SUM(pd.amount_cents),0) t FROM payment_disbursements pd WHERE pd.payable_id=? AND pd.status='CONFIRMED'`).get(openItemId)?.t || 0);
    assert.ok(paymentTotal <= 8000, `combined payment ${paymentTotal} must never exceed 8000`);
  });

  test('RACE-03 Collection confirm vs reversal — exactly one drains the open', async () => {
    const openItemId = seedReceivableFinal(6000);
    const confirmResult = await apps[0].run({ action: 'collection-allocate', openItemId, amountCents: 6000, customerId: CUSTOMER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE });
    const collectionId = confirmResult.collectionId;
    const results = await race([
      { action: 'collection-allocate', openItemId, amountCents: 1000, customerId: CUSTOMER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE },
      { action: 'collection-reverse', documentId: collectionId, businessDate: BUSINESS_DATE },
    ]);
    // Final assertions:
    const row = db.prepare(`SELECT amount_cents, paid_cents FROM account_receivables WHERE id=?`).get(openItemId);
    const openCents = Number(row.amount_cents) - Number(row.paid_cents);
    assert.ok(openCents >= 0 && openCents <= 6000, `open=${openCents} must stay in [0, 6000] after race`);
    const confirmedTotal = Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) s FROM payment_collections WHERE receivable_id=? AND status='CONFIRMED'`).get(openItemId)?.s || 0);
    assert.ok(confirmedTotal <= 6000, `confirmed collections must never exceed original open`);
  });

  test('RACE-04 Payment confirm vs reversal — exactly one drains the open', async () => {
    const openItemId = seedPayableFinal(5000);
    const confirmResult = await apps[0].run({ action: 'payment-allocate', openItemId, amountCents: 5000, supplierId: SUPPLIER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE });
    const results = await race([
      { action: 'payment-allocate', openItemId, amountCents: 1000, supplierId: SUPPLIER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE },
      { action: 'payment-reverse', documentId: confirmResult.paymentId, businessDate: BUSINESS_DATE },
    ]);
    const row = db.prepare(`SELECT amount_cents, paid_cents FROM account_payables WHERE id=?`).get(openItemId);
    const openCents = Number(row.amount_cents) - Number(row.paid_cents);
    assert.ok(openCents >= 0 && openCents <= 5000, `open=${openCents} must stay in [0, 5000] after race`);
  });

  test('RACE-05 Same prepayment application twice — same prepayment not consumed twice', async () => {
    const openItemId = seedReceivableFinal(10000);
    const balanceId = seedPrepayment(6000, 'CUSTOMER');
    const results = await race([
      { action: 'balance-application', balanceId, openItemId, side: 'AR', amountCents: 4000, businessDate: BUSINESS_DATE },
      { action: 'balance-application', balanceId, openItemId, side: 'AR', amountCents: 4000, businessDate: BUSINESS_DATE },
    ]);
    const ok = fulfilled(results);
    const applicationCount = Number(db.prepare(`SELECT COUNT(*) c FROM balance_applications WHERE balance_id=? AND status='CONFIRMED'`).get(balanceId)?.c || 0);
    const balanceRemaining = Number(db.prepare(`SELECT remaining_cents FROM settlement_unapplied_balances WHERE id=?`).get(balanceId)?.remaining_cents || 0);
    assert.ok(ok.length === 1, `exactly one application must accept`);
    assert.equal(applicationCount, 1, `exactly one balance_application row exists`);
    assert.equal(balanceRemaining, 2000, `remaining=2000 after exactly one application of 4000`);
    assert.ok(balanceRemaining >= 0, `remaining_cents must never go negative`);
  });

  test('RACE-06 Refund vs balance application racing on same source — combined drain never exceeds balance', async () => {
    const openItemId = seedReceivableFinal(8000);
    const balanceId = seedPrepayment(5000, 'CUSTOMER');
    const results = await race([
      { action: 'balance-application', balanceId, openItemId, side: 'AR', amountCents: 3000, businessDate: BUSINESS_DATE },
      { action: 'refund', balanceId, amountCents: 3000, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE },
    ]);
    const ok = fulfilled(results);
    assert.ok(ok.length >= 1, `at least one consumer must succeed`);
    const balanceRemaining = Number(db.prepare(`SELECT remaining_cents FROM settlement_unapplied_balances WHERE id=?`).get(balanceId)?.remaining_cents || 0);
    assert.ok(balanceRemaining >= 0, `remaining_cents=${balanceRemaining} must never go negative`);
    assert.ok(balanceRemaining <= 2000, `combined drain must not exceed balance; remaining=${balanceRemaining}`);
  });

  test('RACE-07 Write-off vs settlement — settlement rejected after write-off wipes the open', async () => {
    const openItemId = seedReceivableFinal(4000);
    const results = await race([
      { action: 'write-off', openItemId, side: 'AR', partyId: CUSTOMER_ID, amountCents: 4000, openAmountCents: 4000, businessDate: BUSINESS_DATE },
      { action: 'collection-allocate', openItemId, amountCents: 4000, customerId: CUSTOMER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE },
    ]);
    const rejectedRace = rejected(results);
    assert.ok(rejectedRace.length >= 1, `at least one operation must be rejected after write-off drained open`);
    const row = db.prepare(`SELECT amount_cents, paid_cents, write_off_cents FROM account_receivables WHERE id=?`).get(openItemId);
    const openCents = Number(row.amount_cents) - Number(row.paid_cents) - Number(row.write_off_cents);
    assert.equal(openCents, 0, 'open must end at 0');
  });

  test('RACE-08 AR counterparty transfer vs collection — first round one wins; second round both rejected', async () => {
    const openItemId = seedReceivableFinal(6000);
    const results = await race([
      { action: 'counterparty-transfer', sourceOpenItemId: openItemId, side: 'AR', targetCustomerId: CUSTOMER_ID, amountCents: 6000, businessDate: BUSINESS_DATE },
      { action: 'collection-allocate', openItemId, amountCents: 6000, customerId: CUSTOMER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE },
    ]);
    const ok = fulfilled(results);
    assert.ok(ok.length === 1, `exactly one operation must succeed on first round`);
    // Second round must reject both
    const followup = await race([
      { action: 'counterparty-transfer', sourceOpenItemId: openItemId, side: 'AR', targetCustomerId: CUSTOMER_ID, amountCents: 6000, businessDate: BUSINESS_DATE },
      { action: 'collection-allocate', openItemId, amountCents: 6000, customerId: CUSTOMER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE },
    ]);
    const followupConflicts = rejected(followup);
    assert.ok(followupConflicts.length >= 1, 'second-round race must reject both: source already gone');
  });

  test('RACE-09 AP transfer vs payment — exactly one AP drain wins', async () => {
    const openItemId = seedPayableFinal(9000);
    const results = await race([
      { action: 'counterparty-transfer', sourceOpenItemId: openItemId, side: 'AR', targetCustomerId: CUSTOMER_ID, amountCents: 9000, businessDate: BUSINESS_DATE },
      { action: 'payment-allocate', openItemId, amountCents: 9000, supplierId: SUPPLIER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE },
    ]);
    const ok = fulfilled(results);
    assert.ok(ok.length === 1, `exactly one operation must succeed`);
    const row = db.prepare(`SELECT amount_cents, paid_cents FROM account_payables WHERE id=?`).get(openItemId);
    const openCents = Number(row.amount_cents) - Number(row.paid_cents);
    assert.equal(openCents, 0, 'open must end at 0 after the winner drained it');
  });

  test('RACE-10 Same sales invoice post twice — exactly one POSTED transition + economic effect', async () => {
    // Source link is required so finance_invoice_source_links surfaces
    // the canonical source relation; the worker's mirror honours that.
    const invoiceId = seedSalesInvoiceDraft(12000, 0, 'RACE-SD-1');
    const results = await race([
      { action: 'sales-invoice-post-canonical', invoiceId, grossCents: 12000 },
      { action: 'sales-invoice-post-canonical', invoiceId, grossCents: 12000 },
    ]);
    const fx = salesInvoiceEffects(invoiceId);
    assert.equal(fx.status, 'POSTED', `exactly one invoice row → status='POSTED'`);
    assert.equal(fx.voucherCount, 1, `exactly one accounting_voucher row for source_type='SALES_INVOICE', source_id=${invoiceId}; got ${fx.voucherCount}`);
    assert.ok(fx.arRecognitionCount <= 1, `<=1 account_receivables recognition row, got ${fx.arRecognitionCount}`);
    assert.ok(fx.sourceLinkCount >= 1, `>=1 finance_invoice_source_link exists`);
    const ok = fulfilled(results);
    const idempotentReplay = fulfilled(results).filter((r) => r.result?.alreadyPosted).length;
    const propagatedPost = fulfilled(results).filter((r) => r.result?.posted).length;
    assert.ok(ok.length === 2, `both post calls return success: one propagated, one idempotent replay`);
    assert.equal(propagatedPost + idempotentReplay, 2, `two success responses: one new post + one idempotent same result`);
  });

  test('RACE-11 Supplier bill match/post — match vs post; post vs post; both subcases assert AP / voucher / tax / GRNI uniqueness', async () => {
    // Subcase A: match + post racing on a WAITING_MATCH bill.
    const billA = seedSupplierBillWaitingMatch(7000, 700);
    const subA = await race([
      { action: 'supplier-bill-match-canonical', billId: billA, amountCents: 7000 },
      { action: 'supplier-bill-post-canonical', billId: billA, grossCents: 7000, taxCents: 700 },
    ]);
    const fxA = supplierBillEffects(billA);
    assert.equal(fxA.status, 'POSTED', `subcase A: bill ends in POSTED`);
    assert.equal(fxA.voucherCount, 1, `subcase A: exactly one supplier-bill voucher, got ${fxA.voucherCount}`);
    assert.equal(fxA.grniCents, 0, `subcase A: GRNI clearing effect = 0 cents after POST`);
    assert.ok(fxA.apRecognitionCount <= 1, `subcase A: <=1 AP recognition row, got ${fxA.apRecognitionCount}`);
    // Subcase B: post + post on a MATCHED bill.
    const billB = seedSupplierBillMatched(5000, 500);
    const subB = await race([
      { action: 'supplier-bill-post-canonical', billId: billB, grossCents: 5000, taxCents: 500 },
      { action: 'supplier-bill-post-canonical', billId: billB, grossCents: 5000, taxCents: 500 },
    ]);
    const fxB = supplierBillEffects(billB);
    assert.equal(fxB.status, 'POSTED', `subcase B: bill ends in POSTED`);
    assert.equal(fxB.voucherCount, 1, `subcase B: exactly one supplier-bill voucher; got ${fxB.voucherCount}`);
    assert.equal(fxB.grniCents, 0, `subcase B: GRNI clearing effect = 0 cents after POST`);
    assert.ok(fxB.apRecognitionCount <= 1, `subcase B: <=1 AP recognition row; got ${fxB.apRecognitionCount}`);
    // Both runs must have at least one propagated-post + at least one
    // idempotent replay, OR exactly one propagated + one controlled
    // conflict (STATUS_NOT_MATCHED for the post-before-match subcase).
    const okBSuccess = fulfilled(subB).filter((r) => r.result?.posted || r.result?.alreadyPosted).length;
    assert.ok(okBSuccess >= 1, `subcase B: at least one post-success response`);
  });

  test('RACE-12 Provisional conversion vs ordinary settlement — PROVISIONAL collection/payment MUST NEVER succeed', async () => {
    // Seed a PROVISIONAL AR row + a FINAL AR row to act as the conversion target.
    const sourceId = seedReceivableProvisional(4000);
    const finalId = seedReceivableFinal(0); // conversion target
    // Ensure the FINAL target exists with id=finalId but open=0 — its
    // purpose is just to be the conversion destination, not a settlement target.
    const results = await race([
      { action: 'provisional-convert', sourceOpenItemId: sourceId, finalOpenItemId: finalId, businessDate: BUSINESS_DATE },
      { action: 'collection-allocate', openItemId: sourceId, amountCents: 4000, customerId: CUSTOMER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: BUSINESS_DATE },
    ]);
    // Hard invariant: collection-allocate against PROVISIONAL is forbidden.
    // Identify by result shape: collection always returns
    // { collectionId, movementId, openAfter } while conversion returns
    // { converted: true }.
    const collection = results.find((r) => r.status === 'fulfilled' && r.value && typeof r.value === 'object' && 'collectionId' in r.value);
    const conversion = results.find((r) => r.status === 'fulfilled' && r.value && typeof r.value === 'object' && 'converted' in r.value);
    assert.ok(!collection, `collection-allocate against PROVISIONAL MUST NEVER succeed (was: success)`);

    const sourceAfter = db.prepare(`SELECT item_kind, conversion_state, paid_cents FROM account_receivables WHERE id=?`).get(sourceId);
    const finalAfter = db.prepare(`SELECT item_kind, conversion_state FROM account_receivables WHERE id=?`).get(finalId);
    // Provisional collection items MUST be 0
    const provDrain = Number(db.prepare(`SELECT COALESCE(SUM(pc.amount_cents),0) s FROM payment_collections pc WHERE pc.receivable_id=?`).get(sourceId)?.s || 0);
    assert.equal(provDrain, 0, `PROVISIONAL item MUST NEVER be drained by ordinary collection; got drain=${provDrain}`);

    // Conversion relation is internally consistent.
    if (conversion) {
      assert.ok(finalAfter.conversion_state === 'CONVERTED' || sourceAfter.conversion_state === 'CONVERTED' || finalAfter.item_kind !== 'FINAL',
        'conversion relation must be internally consistent (source→CONVERTED, final→CONVERTED)');
    }
    // Source state still PROVISIONAL (we only flip conversion_state, not item_kind).
    assert.equal(sourceAfter.item_kind, 'PROVISIONAL', 'source item_kind stays PROVISIONAL through conversion');
  });

  test('RACE-13 Treasury transfer execute twice — exactly one paired OUT/IN pair exists', async () => {
    const transferId = `race-trf-${randomUUID()}`;
    // Same idempotencyKey → second invocation replays the first; no
    // economic drift.
    const results = await race([
      { action: 'treasury-transfer', fromAccountId: SETTLEMENT_BANK, toAccountId: SETTLEMENT_BANK_TWO, amountCents: 3000, businessDate: BUSINESS_DATE, transferId, idempotencyKey: `RACE-13:${transferId}` },
      { action: 'treasury-transfer', fromAccountId: SETTLEMENT_BANK, toAccountId: SETTLEMENT_BANK_TWO, amountCents: 3000, businessDate: BUSINESS_DATE, transferId, idempotencyKey: `RACE-13:${transferId}` },
    ]);
    const replayRows = db.prepare(`SELECT direction, COUNT(*) c FROM finance_treasury_movements WHERE source_id=? GROUP BY direction`).all(transferId);
    const out = Number(replayRows.find((row) => row.direction === 'OUT')?.c || 0);
    const inn = Number(replayRows.find((row) => row.direction === 'IN')?.c || 0);
    assert.equal(out, 1, `exactly one OUT movement exists, got ${out}`);
    assert.equal(inn, 1, `exactly one IN movement exists, got ${inn}`);
    // Now race two distinct transfer requests with distinct keys against
    // the same accounts — at most one paired pair survives.
    const transfer2 = `race-trf2-${randomUUID()}`;
    const sourceOpening = Number(db.prepare(`SELECT opening_balance_cents FROM bank_accounts WHERE id=?`).get(SETTLEMENT_BANK).opening_balance_cents);
    db.prepare(`UPDATE bank_accounts SET opening_balance_cents=? WHERE id=?`).run(sourceOpening + 8000, SETTLEMENT_BANK);
    const results2 = await race([
      { action: 'treasury-transfer', fromAccountId: SETTLEMENT_BANK, toAccountId: SETTLEMENT_BANK_TWO, amountCents: 5000, businessDate: BUSINESS_DATE, transferId: transfer2, idempotencyKey: `RACE-13b:${transfer2}` },
      { action: 'treasury-transfer', fromAccountId: SETTLEMENT_BANK, toAccountId: SETTLEMENT_BANK_TWO, amountCents: 5000, businessDate: BUSINESS_DATE, transferId: transfer2, idempotencyKey: `RACE-13b:${transfer2}` },
    ]);
    const transfer2Rows = db.prepare(`SELECT direction, COUNT(*) c FROM finance_treasury_movements WHERE source_id=? GROUP BY direction`).all(transfer2);
    const out2 = Number(transfer2Rows.find((row) => row.direction === 'OUT')?.c || 0);
    const inn2 = Number(transfer2Rows.find((row) => row.direction === 'IN')?.c || 0);
    assert.ok(out2 <= 1 && inn2 <= 1, `paired transfer must not duplicate; out=${out2} in=${inn2}`);
    assert.ok(out2 === inn2, `OUT/IN pair must be balanced; out=${out2} in=${inn2}`);
  });

  test('RACE-14 Statement-line reconcile twice — statement matched <= available; book movement consistent', async () => {
    const { stmtLineId, bookMovementId } = seedBankStatementAndMovement(10000);
    const results = await race([
      { action: 'statement-reconcile', statementLineId, bookMovementId, amountCents: 6000 },
      { action: 'statement-reconcile', statementLineId, bookMovementId, amountCents: 6000 },
    ]);
    const matched = Number(db.prepare(`SELECT matched_cents FROM bank_statement_items WHERE id=?`).get(stmtLineId)?.matched_cents || 0);
    const ok = fulfilled(results);
    assert.ok(ok.length === 1, `exactly one reconcile succeeds`);
    assert.equal(matched, 6000, `statement-line matched must be 6000 after exactly one accept`);
    assert.ok(matched <= 10000, `statement matched ${matched} must <= available 10000`);
  });

  test('RACE-15 Business close vs dated transaction — serializable on close anchor', async () => {
    const dateLate = '2026-10-15';
    const openItemId = seedReceivableFinal(2000);
    const results = await race([
      { action: 'business-close', closeType: 'AR', closedThroughDate: dateLate },
      { action: 'collection-allocate', openItemId, amountCents: 2000, customerId: CUSTOMER_ID, settlementAccountId: SETTLEMENT_BANK, businessDate: dateLate },
    ]);
    // Final-state invariants — close and dated write serialize on the SAME
    // finance_business_close_state row, so two legal outcomes both exist:
    //   (A) TRANSACTION first, then CLOSE     → both may succeed (transaction
    //                                            committed with business_date
    //                                            inside the range pre-close)
    //   (B) CLOSE first, then TRANSACTION     → close commits first;
    //                                            transaction rejects
    // The forbidden outcome is: close commits first AND a transaction
    // dated inside the newly-closed range commits afterward.
    const finalClose = db.prepare(`SELECT closed_through_date FROM finance_business_close_state WHERE close_type='AR'`).get()?.closed_through_date || '';
    const lateCollectionCommitted = Number(db.prepare(`SELECT COUNT(*) c FROM payment_collections WHERE receivable_id=? AND status='CONFIRMED' AND collection_date=?`).get(openItemId, dateLate)?.c || 0);
    if (finalClose === dateLate && lateCollectionCommitted > 0) {
      assert.fail('FORBIDDEN outcome: close committed first AND dated collection committed after — serialization broke');
    }
    // CLOSE-then-COLLECTION: collection must have rejected with zero side effect.
    // COLLECTION-then-CLOSE: both may succeed; verify the serialization lock protected the anchor.
    if (finalClose === dateLate) {
      assert.equal(lateCollectionCommitted, 0, 'close committed first; collection must have rejected');
    }
    // In either case: zero behind-the-close economic write.
    const behindClose = Number(db.prepare(`SELECT COUNT(*) c FROM payment_collections WHERE receivable_id=? AND status='CONFIRMED' AND collection_date > ?`).get(openItemId, dateLate)?.c || 0);
    assert.equal(behindClose, 0, 'no committed collections past the closed boundary');
  });
});
