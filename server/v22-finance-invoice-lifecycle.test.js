import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from './db.js';
import {
  cancelDraftInvoice,
  transitionSupplierBillVerification,
  voidPostedInvoice,
} from './modules/commercial-golive.js';
import { recognizeFinanceExposure } from './modules/finance-recognition.js';
import { RECOGNITION_MODES } from './modules/finance-recognition-policy.js';
import { applyCreditAdjustment } from './modules/settlement-core.js';

const now = () => new Date().toISOString();

function insertInvoice(db, side, id, status = 'DRAFT', amount = 10000) {
  if (side === 'AR') {
    db.prepare(`INSERT INTO sales_invoices(id,invoice_no,customer_id,invoice_date,status,tax_mode,net_cents,tax_cents,gross_cents,tax_snapshot_json,creator_id,created_at)
      VALUES(?,?,?,'2026-10-12',?,'NO_TAX',?,0,?,'[]','user-admin',?)`)
      .run(id, `SI-${id}`, 'customer-001', status, amount, amount, now());
  } else {
    db.prepare(`INSERT INTO supplier_bills(id,bill_no,supplier_id,supplier_invoice_no,bill_date,status,tax_mode,net_cents,tax_cents,gross_cents,grni_cents,variance_cents,tax_snapshot_json,creator_id,created_at)
      VALUES(?,?,?,?,'2026-10-12',?,'NO_TAX',?,0,?,0,?,'[]','user-admin',?)`)
      .run(id, `PB-${id}`, 'supplier-001', `EXT-${id}`, status, amount, amount, amount, now());
  }
}

test('draft invoice cancel has no economic side effect and is idempotent', () => {
  const db = createDatabase(':memory:');
  insertInvoice(db, 'AR', 'cancel-ar');
  assert.equal(cancelDraftInvoice(db, 'AR', 'cancel-ar', 'user-admin').status, 'CANCELLED');
  assert.equal(cancelDraftInvoice(db, 'AR', 'cancel-ar', 'user-admin').status, 'CANCELLED');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_id='cancel-ar'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_id='cancel-ar'").get().n, 0);
});

test('supplier invoice verification follows UNVERIFIED to VERIFIED to CERTIFIED', () => {
  const db = createDatabase(':memory:');
  insertInvoice(db, 'AP', 'verify-ap');
  assert.equal(transitionSupplierBillVerification(db, 'verify-ap', 'verify', 'user-admin').verification_state, 'VERIFIED');
  assert.equal(transitionSupplierBillVerification(db, 'verify-ap', 'certify', 'user-admin').verification_state, 'CERTIFIED');
  assert.throws(() => transitionSupplierBillVerification(db, 'verify-ap', 'reject', 'user-admin', 'late'), /只有已验证/);
});

test('supplier invoice rejection requires reason and follows VERIFIED to REJECTED', () => {
  const db = createDatabase(':memory:');
  insertInvoice(db, 'AP', 'reject-ap');
  transitionSupplierBillVerification(db, 'reject-ap', 'verify', 'user-admin');
  assert.throws(() => transitionSupplierBillVerification(db, 'reject-ap', 'reject', 'user-admin'), /原因/);
  assert.equal(transitionSupplierBillVerification(db, 'reject-ap', 'reject', 'user-admin', '三单不一致').verification_state, 'REJECTED');
});

test('posted invoice void atomically neutralizes eligible open exposure', () => {
  const db = createDatabase(':memory:');
  insertInvoice(db, 'AR', 'void-ar', 'POSTED');
  const exposure = recognizeFinanceExposure(db, {
    side: 'AR', recognitionMode: RECOGNITION_MODES.INVOICE_DRIVEN,
    source: { sourceType: 'SALES_DELIVERY', sourceId: 'void-source', sourceNo: 'SD-VOID' },
    sources: [{ sourceType: 'SALES_DELIVERY', sourceId: 'void-source', sourceNo: 'SD-VOID', sourceLineId: 'void-line', invoicedQuantity: 1, invoicedAmountCents: 10000, fullyInvoiced: true }],
    invoice: { id: 'void-ar', no: 'SI-void-ar', type: 'SALES_INVOICE' },
    amountCents: 10000, businessDate: '2026-10-12', partyId: 'customer-001', actorId: 'user-admin',
  });
  const result = voidPostedInvoice(db, 'AR', 'void-ar', 'user-admin', '录入错误');
  assert.equal(result.status, 'REVERSED'); assert.equal(result.voided, true);
  assert.equal(db.prepare('SELECT open_amount_cents FROM account_receivables WHERE id=?').get(exposure.openItemId).open_amount_cents, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM financial_credit_adjustments WHERE source_type='INVOICE_VOID' AND source_id='void-ar'").get().n, 1);
});

test('posted invoice with dependent financial effect cannot be voided', () => {
  const db = createDatabase(':memory:');
  insertInvoice(db, 'AR', 'blocked-ar', 'POSTED');
  const exposure = recognizeFinanceExposure(db, {
    side: 'AR', recognitionMode: RECOGNITION_MODES.INVOICE_DRIVEN,
    source: { sourceType: 'SALES_DELIVERY', sourceId: 'blocked-source', sourceNo: 'SD-BLOCKED' },
    sources: [{ sourceType: 'SALES_DELIVERY', sourceId: 'blocked-source', sourceNo: 'SD-BLOCKED', sourceLineId: 'blocked-line', invoicedQuantity: 1, invoicedAmountCents: 10000, fullyInvoiced: true }],
    invoice: { id: 'blocked-ar', no: 'SI-blocked-ar', type: 'SALES_INVOICE' },
    amountCents: 10000, businessDate: '2026-10-12', partyId: 'customer-001', actorId: 'user-admin',
  });
  applyCreditAdjustment(db, { side: 'AR', adjustmentType: 'OTHER', sourceType: 'TEST', sourceId: 'dependent', sourceNo: 'D1', targetOpenItemId: exposure.openItemId, partyId: 'customer-001', businessDate: '2026-10-12', amountCents: 1000, actorId: 'user-admin' });
  assert.throws(() => voidPostedInvoice(db, 'AR', 'blocked-ar', 'user-admin'), /已有结算、核销或调整/);
  assert.equal(db.prepare("SELECT status FROM sales_invoices WHERE id='blocked-ar'").get().status, 'POSTED');
});

test('invoice lifecycle mutations obey independent Finance business close', () => {
  const db = createDatabase(':memory:');
  insertInvoice(db, 'AP', 'closed-ap');
  db.prepare("UPDATE finance_business_close_state SET closed_through_date='2026-10-12' WHERE close_type='AP'").run();
  assert.throws(() => transitionSupplierBillVerification(db, 'closed-ap', 'verify', 'user-admin'), /已结账/);
  assert.equal(db.prepare("SELECT verification_state FROM supplier_bills WHERE id='closed-ap'").get().verification_state, 'UNVERIFIED');
});
