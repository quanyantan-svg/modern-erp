import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createDatabase } from './db.js';

let db;
let directory;
let filename;

before(() => {
  directory = mkdtempSync(join(tmpdir(), 'modern-erp-v13-p5-'));
  filename = join(directory, 'erp.db');
  db = createDatabase(filename);
});

after(() => {
  try { db?.close(); } catch {}
  rmSync(directory, { recursive: true, force: true });
});

describe('V1.3 Phase 5 settlement schema and product contract', () => {
  test('minimal additive schema provides linked credits, reversals, terms, and derived caches', () => {
    for (const table of ['financial_credit_adjustments', 'settlement_reversals', 'schema_migration_markers']) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), table);
    }
    const arColumns = new Set(db.prepare('PRAGMA table_info(account_receivables)').all().map((row) => row.name));
    for (const column of ['payment_terms_days', 'return_credit_applied_cents', 'discount_credit_applied_cents', 'cash_allocation_cents', 'open_amount_cents', 'item_class']) assert.ok(arColumns.has(column), column);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_voucher_source_unique'").get());
  });

  test('startup migration marker prevents silent repair of a derived-cache mismatch', () => {
    db.prepare(`INSERT INTO account_receivables(id,voucher_no,customer_id,source_type,source_id,amount_cents,paid_cents,write_off_cents,status,due_date,creator_id,created_at,source_no,business_date,adjustment_cents,updated_at,item_class,open_amount_cents)
      VALUES('p5-check-ar','AR-P5-CHECK','customer-001','SALES_DELIVERY','p5-check-delivery',10000,777,0,'PARTIAL','2026-10-01','user-accounting',datetime('now'),'SD-P5-CHECK','2026-09-01',0,datetime('now'),'SOURCE',123)`).run();
    db.close();
    db = createDatabase(filename);
    const row = db.prepare("SELECT paid_cents,open_amount_cents FROM account_receivables WHERE id='p5-check-ar'").get();
    assert.equal(row.paid_cents, 777);
    assert.equal(row.open_amount_cents, 123);
  });

  test('UI and documentation expose explainable open-item details without new approval families', () => {
    const ui = readFileSync(new URL('../src/pages/settlement.jsx', import.meta.url), 'utf8');
    const docs = readFileSync(new URL('../docs/V1.3-PHASE5-SETTLEMENT-INTEGRITY.md', import.meta.url), 'utf8');
    const approvals = readFileSync(new URL('./modules/approvals.js', import.meta.url), 'utf8');
    for (const text of ['原始', '贷项调整', '到期日', '自动核销', '全额冲销']) assert.ok(ui.includes(text), text);
    assert.ok(docs.includes('unapplied_cents'));
    for (const forbidden of ['COLLECTION', 'PAYMENT', 'SALES_DISCOUNT', 'PURCHASE_DISCOUNT']) assert.equal(approvals.includes(`'${forbidden}'`), false);
  });
});
