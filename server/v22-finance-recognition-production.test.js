import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from './db.js';
import { recognizeFinanceExposure } from './modules/finance-recognition.js';
import { RECOGNITION_MODES } from './modules/finance-recognition-policy.js';
import { confirmSettlementDocument, createSettlementDocument, listPayables, listReceivables } from './modules/settlement.js';
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
  const beforeMovements = db.prepare('SELECT COUNT(*) n FROM finance_treasury_movements').get().n;
  const beforeDocuments = db.prepare('SELECT COUNT(*) n FROM payment_disbursements').get().n;
  // 建单即拒绝：暂估不是结算敞口（Requirement §33.2.3）。建单放行会留下一张
  // 永远无法确认的挂起草稿，确认时才 409，客户侧看不到原因（F-01）。
  await assert.rejects(() => createSettlementDocument(db, req({ supplierId: 'supplier-001', businessDate: '2026-10-12', amountCents: 5000, paymentMethod: 'BANK', settlementAccountId: accountId, allocations: [{ payableId: provisional.openItemId, amountCents: 5000 }] }), res(), actor, 'PAYMENT'), /不是可结算的最终应付项目/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payment_disbursements').get().n, beforeDocuments);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_treasury_movements').get().n, beforeMovements);

  // 写守卫不因建单守卫而放松：绕过建单的草稿在确认时仍必须被拒绝。
  const draftId = 'draft-provisional-payment';
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO payment_disbursements(id,disbursement_no,supplier_id,amount_cents,payment_method,bank_account,disbursement_date,remark,creator_id,created_at,status,updated_at,settlement_account_id,unapplied_amount_cents,explicit_unapplied)
    VALUES(?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?,0,0)`).run(
    draftId, 'PAY-DRAFT-PROV', 'supplier-001', 5000, 'BANK', '', '2026-10-12', '', 'user-admin', now, now, accountId,
  );
  db.prepare(`INSERT INTO payment_disbursement_items(id,disbursement_id,payable_id,amount_cents) VALUES(?,?,?,?)`)
    .run('pdi-provisional', draftId, provisional.openItemId, 5000);
  await assert.rejects(() => confirmSettlementDocument(db, req({}), res(), actor, 'PAYMENT', draftId, () => { throw new Error('voucher must not run'); }), /非最终项目/);
  assert.equal(db.prepare('SELECT status FROM payment_disbursements WHERE id=?').get(draftId).status, 'DRAFT');
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

// ---------------------------------------------------------------------------
// F-01 —— 结算清单读模型与权威口径（AR_TO_GL / AP_TO_GL）一致。
//
// 根因：暂估应付结转成供应商账单后 `conversion_state='CONVERTED'`，但清单读模型
// 不区分 item_kind / conversion_state，仍把该行按 `open_amount_cents` 暴露成
// 「未付」，汇总因此高估；付款单还能建出来，只在确认时被 409 拒绝。
//
// 合同锚点：Requirement §33.2.3（普通 settlement eligibility 仅限 final /
// financial open item）、§33.38 F3（Provisional != Financial）。
// ---------------------------------------------------------------------------

const AP_AUTHORITATIVE_SQL = `SELECT COALESCE(SUM(CASE WHEN item_class='SOURCE' AND COALESCE(item_kind,'FINAL')='FINAL' AND COALESCE(conversion_state,'OPEN')='OPEN' THEN open_amount_cents ELSE 0 END),0) n FROM account_payables`;
const AR_AUTHORITATIVE_SQL = `SELECT COALESCE(SUM(CASE WHEN item_class='SOURCE' AND COALESCE(item_kind,'FINAL')='FINAL' AND COALESCE(conversion_state,'OPEN')='OPEN' THEN open_amount_cents ELSE 0 END),0) n FROM account_receivables`;

test('F-01 已转销的暂估应付不再显示为未付，清单汇总等于 AP_TO_GL 权威口径', () => {
  const db = createDatabase(':memory:');
  const provisional = recognizeFinanceExposure(db, {
    side: 'AP', recognitionMode: RECOGNITION_MODES.PROVISIONAL,
    source: { sourceType: 'PURCHASE_RECEIPT', sourceId: 'f01-receipt', sourceNo: 'PR-F01' },
    invoice: null, amountCents: 450000, businessDate: '2026-11-18', partyId: 'supplier-001', actorId: 'user-admin',
  });
  invoiceHeader(db, 'SUPPLIER_BILL', 'f01-bill', 'supplier-001', 550000);
  recognizeFinanceExposure(db, {
    side: 'AP', recognitionMode: RECOGNITION_MODES.PROVISIONAL,
    source: { sourceType: 'PURCHASE_RECEIPT', sourceId: 'f01-receipt', sourceNo: 'PR-F01' },
    sources: [{ sourceType: 'PURCHASE_RECEIPT', sourceId: 'f01-receipt', sourceNo: 'PR-F01', sourceLineId: 'pri-f01', invoicedQuantity: 1, invoicedAmountCents: 550000, fullyInvoiced: true }],
    invoice: { id: 'f01-bill', no: 'PB-F01', type: 'SUPPLIER_BILL' },
    amountCents: 550000, businessDate: '2026-11-18', partyId: 'supplier-001', actorId: 'user-admin',
  });
  // 前置：暂估行确实还带着 450000 的未结金额（数据没被改写，问题在读模型）。
  const ghostRow = db.prepare('SELECT conversion_state,item_kind,open_amount_cents FROM account_payables WHERE id=?').get(provisional.openItemId);
  assert.equal(ghostRow.conversion_state, 'CONVERTED');
  assert.equal(Number(ghostRow.open_amount_cents), 450000);

  const listed = res();
  listPayables(db, listed, actor, new URL('http://localhost/?supplier=supplier-001'));
  const ghost = listed.body.payables.find((row) => row.id === provisional.openItemId);
  assert.equal(ghost.outstandingCents, 0, '已转销的暂估行不得再显示为未付');
  assert.equal(ghost.settlementEligible, false);
  assert.equal(ghost.statusLabel, '已转销');

  const authoritative = Number(db.prepare(AP_AUTHORITATIVE_SQL).get().n);
  assert.equal(authoritative, 550000);
  assert.equal(listed.body.summary.openCents, authoritative, '清单汇总必须等于权威口径');
  assert.equal(listed.body.summary.balanceCents, authoritative);
  // 负向对照：修复前读模型会把暂估行一并计入（450000 + 550000）。
  assert.notEqual(authoritative, 450000 + 550000);
});

test('F-01 尚未转销的暂估行同样不进入结算敞口，但仍在清单里可见', () => {
  const db = createDatabase(':memory:');
  const provisional = recognizeFinanceExposure(db, {
    side: 'AP', recognitionMode: RECOGNITION_MODES.PROVISIONAL,
    source: { sourceType: 'PURCHASE_RECEIPT', sourceId: 'f01-open-receipt', sourceNo: 'PR-F01-OPEN' },
    invoice: null, amountCents: 120000, businessDate: '2026-11-18', partyId: 'supplier-001', actorId: 'user-admin',
  });
  const listed = res();
  listPayables(db, listed, actor, new URL('http://localhost/?supplier=supplier-001'));
  const row = listed.body.payables.find((item) => item.id === provisional.openItemId);
  assert.ok(row, '暂估行仍在清单里可见');
  assert.equal(row.outstandingCents, 0);
  assert.equal(row.statusLabel, '暂估待转销');
  assert.equal(listed.body.summary.openCents, Number(db.prepare(AP_AUTHORITATIVE_SQL).get().n));
});

test('F-01 应收侧与应付侧同一口径：已转销的暂估应收不进入未收与账龄', () => {
  const db = createDatabase(':memory:');
  const provisional = recognizeFinanceExposure(db, {
    side: 'AR', recognitionMode: RECOGNITION_MODES.PROVISIONAL,
    source: { sourceType: 'SALES_DELIVERY', sourceId: 'f01-delivery', sourceNo: 'SD-F01' },
    invoice: null, amountCents: 80000, businessDate: '2026-11-18', partyId: 'customer-001', actorId: 'user-admin',
  });
  invoiceHeader(db, 'SALES_INVOICE', 'f01-invoice', 'customer-001', 90000);
  recognizeFinanceExposure(db, {
    side: 'AR', recognitionMode: RECOGNITION_MODES.PROVISIONAL,
    source: { sourceType: 'SALES_DELIVERY', sourceId: 'f01-delivery', sourceNo: 'SD-F01' },
    sources: [{ sourceType: 'SALES_DELIVERY', sourceId: 'f01-delivery', sourceNo: 'SD-F01', sourceLineId: 'sdl-f01', invoicedQuantity: 1, invoicedAmountCents: 90000, fullyInvoiced: true }],
    invoice: { id: 'f01-invoice', no: 'SI-F01', type: 'SALES_INVOICE' },
    amountCents: 90000, businessDate: '2026-11-18', partyId: 'customer-001', actorId: 'user-admin',
  });
  const listed = res();
  listReceivables(db, listed, { id: 'user-admin', permissions: ['AR_VIEW'] }, new URL('http://localhost/?customer=customer-001'));
  const ghost = listed.body.receivables.find((row) => row.id === provisional.openItemId);
  assert.equal(ghost.outstandingCents, 0);
  assert.equal(ghost.statusLabel, '已转销');
  assert.equal(listed.body.summary.openCents, Number(db.prepare(AR_AUTHORITATIVE_SQL).get().n));
});

test('F-01 负向对照：真实结算敞口仍然照常显示并可建付款单', async () => {
  const db = createDatabase(':memory:');
  const exposure = recognizeFinanceExposure(db, {
    side: 'AP', recognitionMode: RECOGNITION_MODES.DIRECT,
    source: { sourceType: 'PURCHASE_RECEIPT', sourceId: 'f01-direct-receipt', sourceNo: 'PR-F01-DIRECT' },
    invoice: null, amountCents: 70000, businessDate: '2026-11-18', partyId: 'supplier-001', actorId: 'user-admin',
  });
  const listed = res();
  listPayables(db, listed, actor, new URL('http://localhost/?supplier=supplier-001'));
  const row = listed.body.payables.find((item) => item.id === exposure.openItemId);
  assert.equal(row.settlementEligible, true);
  assert.equal(row.outstandingCents, 70000);
  assert.equal(listed.body.summary.openCents, 70000);

  const accountId = db.prepare("SELECT id FROM bank_accounts WHERE active=1 ORDER BY id LIMIT 1").get().id;
  const created = res();
  await createSettlementDocument(db, req({ supplierId: 'supplier-001', businessDate: '2026-11-18', amountCents: 70000, paymentMethod: 'BANK', settlementAccountId: accountId, allocations: [{ payableId: exposure.openItemId, amountCents: 70000 }] }), created, actor, 'PAYMENT');
  assert.equal(created.statusCode, 201);
  assert.ok(created.body.id);
});
