import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from './db.js';
import { recognizeFinanceExposure } from './modules/finance-recognition.js';
import { RECOGNITION_MODES } from './modules/finance-recognition-policy.js';
import { confirmSettlementDocument, createSettlementDocument } from './modules/settlement.js';
import { applyUnappliedBalance, createWriteOff } from './modules/financial-controls.js';

const actor = { id: 'user-admin', permissions: ['PAYMENT_MANAGE'] };
const req = (body) => ({
  headers: { 'content-type': 'application/json' },
  [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(body)); },
});
const res = () => {
  const response = { statusCode: 0, body: null, setHeader() {}, getHeader() { return null; }, write() {}, on() {}, once() {} };
  response.end = (chunk) => { if (chunk) response.body = JSON.parse(chunk); };
  return response;
};

function invoiceHeader(db, type, id, partyId, amount) {
  const now = new Date().toISOString();
  if (type === 'SALES_INVOICE') {
    db.prepare(`INSERT INTO sales_invoices(id,invoice_no,customer_id,invoice_date,status,tax_mode,net_cents,tax_cents,gross_cents,tax_snapshot_json,creator_id,created_at)
      VALUES(?,?,?,'2026-10-12','DRAFT','NO_TAX',?,0,?,'[]','user-admin',?)`).run(id, `SI-${id}`, partyId, amount, amount, now);
  } else {
    db.prepare(`INSERT INTO supplier_bills(id,bill_no,supplier_id,supplier_invoice_no,bill_date,status,tax_mode,net_cents,tax_cents,gross_cents,grni_cents,variance_cents,tax_snapshot_json,creator_id,created_at)
      VALUES(?,?,?,?,'2026-10-12','DRAFT','NO_TAX',?,0,?,0,0,'[]','user-admin',?)`).run(id, `PB-${id}`, partyId, `EXT-${id}`, amount, amount, now);
  }
}

test('production recognition adapter enforces all three canonical models without duplicate exposure', () => {
  const db = createDatabase(':memory:');
  const direct = recognizeFinanceExposure(db, {
    side: 'AR', recognitionMode: RECOGNITION_MODES.DIRECT,
    source: { sourceType: 'SALES_DELIVERY', sourceId: 'rec-direct', sourceNo: 'SD-DIRECT' },
    invoice: null, amountCents: 10000, businessDate: '2026-10-12', partyId: 'customer-001', actorId: 'user-admin',
  });
  invoiceHeader(db, 'SALES_INVOICE', 'inv-direct', 'customer-001', 10000);
  const linked = recognizeFinanceExposure(db, {
    side: 'AR', recognitionMode: RECOGNITION_MODES.DIRECT,
    source: { sourceType: 'SALES_DELIVERY', sourceId: 'rec-direct', sourceNo: 'SD-DIRECT' },
    sources: [{ sourceType: 'SALES_DELIVERY', sourceId: 'rec-direct', sourceNo: 'SD-DIRECT', sourceLineId: 'sdl-direct', invoicedQuantity: 1, invoicedAmountCents: 10000, fullyInvoiced: true }],
    invoice: { id: 'inv-direct', no: 'SI-DIRECT', type: 'SALES_INVOICE' },
    amountCents: 10000, businessDate: '2026-10-12', partyId: 'customer-001', actorId: 'user-admin',
  });
  assert.equal(linked.openItemId, direct.openItemId);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_id IN ('rec-direct','inv-direct')").get().n, 1);

  invoiceHeader(db, 'SALES_INVOICE', 'inv-driven', 'customer-001', 12000);
  const noSourceExposure = recognizeFinanceExposure(db, {
    side: 'AR', recognitionMode: RECOGNITION_MODES.INVOICE_DRIVEN,
    source: { sourceType: 'SALES_DELIVERY', sourceId: 'rec-driven', sourceNo: 'SD-DRIVEN' },
    invoice: null, amountCents: 12000, businessDate: '2026-10-12', partyId: 'customer-001', actorId: 'user-admin',
  });
  assert.equal(noSourceExposure.openItemId, null);
  const invoiced = recognizeFinanceExposure(db, {
    side: 'AR', recognitionMode: RECOGNITION_MODES.INVOICE_DRIVEN,
    source: { sourceType: 'SALES_DELIVERY', sourceId: 'rec-driven', sourceNo: 'SD-DRIVEN' },
    sources: [{ sourceType: 'SALES_DELIVERY', sourceId: 'rec-driven', sourceNo: 'SD-DRIVEN', sourceLineId: 'sdl-driven', invoicedQuantity: 1, invoicedAmountCents: 12000, fullyInvoiced: true }],
    invoice: { id: 'inv-driven', no: 'SI-DRIVEN', type: 'SALES_INVOICE' },
    amountCents: 12000, businessDate: '2026-10-12', partyId: 'customer-001', actorId: 'user-admin',
  });
  assert.equal(invoiced.itemKind, 'FINAL');
  assert.equal(db.prepare("SELECT source_type FROM account_receivables WHERE id=?").get(invoiced.openItemId).source_type, 'SALES_INVOICE');

  const provisional = recognizeFinanceExposure(db, {
    side: 'AP', recognitionMode: RECOGNITION_MODES.PROVISIONAL,
    source: { sourceType: 'PURCHASE_RECEIPT', sourceId: 'rec-provisional', sourceNo: 'PR-PROVISIONAL' },
    invoice: null, amountCents: 15000, businessDate: '2026-10-12', partyId: 'supplier-001', actorId: 'user-admin',
  });
  invoiceHeader(db, 'SUPPLIER_BILL', 'bill-final', 'supplier-001', 16000);
  const converted = recognizeFinanceExposure(db, {
    side: 'AP', recognitionMode: RECOGNITION_MODES.PROVISIONAL,
    source: { sourceType: 'PURCHASE_RECEIPT', sourceId: 'rec-provisional', sourceNo: 'PR-PROVISIONAL' },
    sources: [{ sourceType: 'PURCHASE_RECEIPT', sourceId: 'rec-provisional', sourceNo: 'PR-PROVISIONAL', sourceLineId: 'pri-provisional', invoicedQuantity: 1, invoicedAmountCents: 16000, fullyInvoiced: true }],
    invoice: { id: 'bill-final', no: 'PB-FINAL', type: 'SUPPLIER_BILL' },
    amountCents: 16000, businessDate: '2026-10-12', partyId: 'supplier-001', actorId: 'user-admin',
  });
  const provisionalAfter = db.prepare('SELECT conversion_state,converted_open_item_id FROM account_payables WHERE id=?').get(provisional.openItemId);
  assert.equal(provisionalAfter.conversion_state, 'CONVERTED');
  assert.equal(provisionalAfter.converted_open_item_id, converted.openItemId);
  assert.equal(db.prepare("SELECT SUM(open_amount_cents) n FROM account_payables WHERE conversion_state='OPEN' AND source_id IN ('rec-provisional','bill-final')").get().n, 16000);
});

test('ordinary payment rejects a PROVISIONAL AP open item before any voucher or treasury effect', async () => {
  const db = createDatabase(':memory:');
  const provisional = recognizeFinanceExposure(db, {
    side: 'AP', recognitionMode: RECOGNITION_MODES.PROVISIONAL,
    source: { sourceType: 'PURCHASE_RECEIPT', sourceId: 'pay-provisional', sourceNo: 'PR-PAY-PROV' },
    invoice: null, amountCents: 5000, businessDate: '2026-10-12', partyId: 'supplier-001', actorId: 'user-admin',
  });
  const accountId = db.prepare("SELECT id FROM bank_accounts WHERE active=1 ORDER BY id LIMIT 1").get().id;
  const created = res();
  await createSettlementDocument(db, req({ supplierId: 'supplier-001', businessDate: '2026-10-12', amountCents: 5000, paymentMethod: 'BANK', settlementAccountId: accountId, allocations: [{ payableId: provisional.openItemId, amountCents: 5000 }] }), created, actor, 'PAYMENT');
  const beforeMovements = db.prepare('SELECT COUNT(*) n FROM finance_treasury_movements').get().n;
  await assert.rejects(() => confirmSettlementDocument(db, req({}), res(), actor, 'PAYMENT', created.body.id, () => { throw new Error('voucher must not run'); }), /非最终项目/);
  assert.equal(db.prepare('SELECT status FROM payment_disbursements WHERE id=?').get(created.body.id).status, 'DRAFT');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_treasury_movements').get().n, beforeMovements);
});

test('balance application and write-off reject PROVISIONAL items without side effects', async () => {
  const db = createDatabase(':memory:');
  const provisional = recognizeFinanceExposure(db, {
    side: 'AR', recognitionMode: RECOGNITION_MODES.PROVISIONAL,
    source: { sourceType: 'SALES_DELIVERY', sourceId: 'control-provisional', sourceNo: 'SD-CONTROL-PROV' },
    invoice: null, amountCents: 7000, businessDate: '2026-10-12', partyId: 'customer-001', actorId: 'user-admin',
  });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,status,created_by,created_at)
    VALUES('balance-provisional','CUSTOMER','PREPAYMENT','customer-001','PAYMENT_COLLECTION','collection-provisional','COL-PROV',7000,'2026-10-12','OPEN','user-admin',?)`).run(now);
  const controlActor = { id: 'user-admin', permissions: ['COLLECTION_MANAGE', 'VOUCHER_SUBMIT'] };

  await assert.rejects(() => applyUnappliedBalance(db, req({ side: 'AR', balanceId: 'balance-provisional', openItemId: provisional.openItemId, amountCents: 1000, businessDate: '2026-10-12' }), res(), controlActor), /不能用于余额应用/);
  await assert.rejects(() => createWriteOff(db, req({ side: 'AR', openItemId: provisional.openItemId, amountCents: 1000, businessDate: '2026-10-12', reason: 'test' }), res(), controlActor), /不能创建核销单/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM balance_applications').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM financial_write_offs').get().n, 0);
});
