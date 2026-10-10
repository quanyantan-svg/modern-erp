import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { allow, allowAny, HttpError, readJson, send } from '../lib/http.js';
import { openItemSnapshot, refreshOpenItem, unappliedBalanceSnapshot } from './settlement-core.js';
import { setInventoryQuantity } from '../lib/stock.js';

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const cents = (value, label = '金额') => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, `${label}必须是正整数分`);
  return n;
};
const date = (value) => {
  const s = String(value || today());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, '业务日期格式必须为 YYYY-MM-DD');
  return s;
};
const number = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;

export function requestFingerprint(value) {
  const stable = (input) => input && typeof input === 'object'
    ? Array.isArray(input) ? input.map(stable) : Object.fromEntries(Object.keys(input).sort().map((key) => [key, stable(input[key])]))
    : input;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function idempotencyReplay(db, operationType, documentId, key, fingerprint) {
  if (!key) throw new HttpError(400, '关键过账操作必须提供 Idempotency-Key');
  let lockName;
  if (db?.dialect === 'mysql') {
    lockName = `erp-idem-${createHash('sha256').update(`${operationType}\u001f${documentId}\u001f${key}`).digest('hex').slice(0, 48)}`;
    const acquired = Number(db.prepare('SELECT GET_LOCK(?,10) acquired').get(lockName)?.acquired);
    if (acquired !== 1) throw new HttpError(503, '幂等请求正在处理中，请重试');
    db._idempotencyLocks ||= new Set();
    db._idempotencyLocks.add(lockName);
  }
  let row;
  try {
    row = db.prepare('SELECT * FROM idempotency_records WHERE operation_type=? AND document_id=? AND idempotency_key=?').get(operationType, documentId, key);
  } catch (error) {
    if (db?.dialect === 'mysql') {
      try { db.prepare('SELECT RELEASE_LOCK(?) released').get(lockName); } finally { db._idempotencyLocks.delete(lockName); }
    }
    throw error;
  }
  if (!row) return null;
  if (db?.dialect === 'mysql') {
    try { db.prepare('SELECT RELEASE_LOCK(?) released').get(lockName); } finally { db._idempotencyLocks.delete(lockName); }
  }
  if (row.request_fingerprint !== fingerprint) throw new HttpError(409, '同一幂等键不能用于不同请求内容');
  return JSON.parse(row.result_json);
}

export function saveIdempotency(db, operationType, documentId, key, fingerprint, result) {
  db.prepare(`INSERT INTO idempotency_records(id,operation_type,document_id,idempotency_key,request_fingerprint,result_json,status,created_at)
    VALUES(?,?,?,?,?,?,'SUCCEEDED',?)`).run(randomUUID(), operationType, documentId, key, fingerprint, JSON.stringify(result), now());
}

export function requireSettlementAccount(db, paymentMethod, accountId) {
  if (paymentMethod === 'BANK') {
    const account = db.prepare('SELECT id,bank_name,account_no,account_name FROM bank_accounts WHERE id=? AND active=1').get(accountId);
    if (!account) throw new HttpError(409, '请选择有效的启用银行账户');
    return { id: account.id, name: `${account.bank_name} ${account.account_name} ${account.account_no}`.trim(), subjectCode: '1002' };
  }
  if (paymentMethod === 'CASH') {
    const subject = db.prepare("SELECT id,name FROM accounting_subjects WHERE id=? AND code='1001' AND active=1").get(accountId);
    if (!subject) throw new HttpError(409, '现金结算必须选择权威库存现金科目');
    return { id: subject.id, name: subject.name, subjectCode: '1001' };
  }
  throw new HttpError(400, '收付方式仅支持现金或银行');
}

export function recordSettlementMovement(db, { accountId, sourceType, sourceId, direction, amountCents, businessDate, voucherId }) {
  const bank = db.prepare('SELECT balance_cents FROM bank_accounts WHERE id=?').get(accountId);
  if (bank) {
    db.prepare("INSERT OR IGNORE INTO settlement_account_balance_baselines(settlement_account_id,baseline_cents,captured_at) VALUES(?,?,?)").run(accountId, bank.balance_cents, now());
    db.prepare('UPDATE bank_accounts SET balance_cents=balance_cents+?,updated_at=? WHERE id=?').run(direction === 'IN' ? amountCents : -amountCents, now(), accountId);
  }
  db.prepare(`INSERT INTO settlement_account_movements(id,settlement_account_id,source_type,source_id,direction,amount_cents,business_date,voucher_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(), accountId, sourceType, sourceId, direction, amountCents, businessDate, voucherId, now());
}

export function recordPrepayment(db, { side, partyId, sourceType, sourceId, sourceNo, amountCents, businessDate, accountId, actorId }) {
  const existing = db.prepare('SELECT * FROM settlement_unapplied_balances WHERE source_type=? AND source_id=?').get(sourceType, sourceId);
  if (existing) return existing;
  const id = randomUUID();
  db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,settlement_account_id,created_by,created_at)
    VALUES(?,?,'PREPAYMENT',?,?,?,?,?,?,?,?,?)`).run(id, side, partyId, sourceType, sourceId, sourceNo, amountCents, businessDate, accountId, actorId, now());
  return db.prepare('SELECT * FROM settlement_unapplied_balances WHERE id=?').get(id);
}

function materializeCreditBalance(db, creditId) {
  const credit = db.prepare("SELECT * FROM financial_credit_adjustments WHERE id=? AND status='CONFIRMED'").get(creditId);
  if (!credit || Number(credit.unapplied_cents) <= 0) throw new HttpError(409, '未找到可用的未核销贷项');
  const existing = db.prepare("SELECT * FROM settlement_unapplied_balances WHERE balance_type='CREDIT' AND source_id=?").get(creditId);
  if (existing) return existing;
  const id = randomUUID();
  db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,created_by,created_at)
    VALUES(?,?, 'CREDIT',?,?,?,?,?,?,?,?)`).run(id, credit.side === 'AR' ? 'CUSTOMER' : 'SUPPLIER', credit.party_id, credit.source_type, credit.id, credit.source_no, credit.unapplied_cents, credit.business_date, credit.created_by, credit.created_at);
  return db.prepare('SELECT * FROM settlement_unapplied_balances WHERE id=?').get(id);
}

function loadBalance(db, id, creditId) {
  const row = id ? db.prepare('SELECT * FROM settlement_unapplied_balances WHERE id=?').get(id) : materializeCreditBalance(db, creditId);
  if (!row) throw new HttpError(404, '未核销余额不存在');
  return row;
}

export function listUnappliedBalances(db, res, actor, url) {
  allowAny(actor, ['AR_VIEW', 'AP_VIEW']);
  const side = url.searchParams.get('side');
  const partyId = url.searchParams.get('partyId');
  const where = []; const args = [];
  if (side) { where.push('side=?'); args.push(side); }
  if (partyId) { where.push('party_id=?'); args.push(partyId); }
  const rows = db.prepare(`SELECT * FROM settlement_unapplied_balances ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY business_date,created_at`).all(...args)
    .map((row) => ({ ...row, ...unappliedBalanceSnapshot(db, row.id) }));
  return send(res, 200, { balances: rows });
}

export async function applyUnappliedBalance(db, req, res, actor) {
  const body = await readJson(req);
  const side = String(body.side || '').toUpperCase();
  allow(actor, side === 'AR' ? 'COLLECTION_MANAGE' : 'PAYMENT_MANAGE');
  if (!['AR', 'AP'].includes(side)) throw new HttpError(400, 'side 仅支持 AR/AP');
  const balance = loadBalance(db, body.balanceId, body.creditId);
  const expectedBalanceSide = side === 'AR' ? 'CUSTOMER' : 'SUPPLIER';
  if (balance.side !== expectedBalanceSide) throw new HttpError(409, '余额方向与目标项目不匹配');
  const snap = openItemSnapshot(db, side, body.openItemId);
  if (!snap || snap.row.item_class !== 'SOURCE') throw new HttpError(404, '权威应收/应付来源不存在');
  const partyId = side === 'AR' ? snap.row.customer_id : snap.row.supplier_id;
  if (partyId !== balance.party_id) throw new HttpError(409, '余额与目标项目必须属于同一往来单位');
  const amount = cents(body.amountCents); const available = unappliedBalanceSnapshot(db, balance.id).remainingCents;
  if (amount > available || amount > snap.openCents) throw new HttpError(409, '应用金额超过可用余额或目标未结金额');
  const id = randomUUID(); const at = now(); const applicationNo = number(side === 'AR' ? 'ARAPP' : 'APAPP');
  transaction(db, () => {
    db.prepare(`INSERT INTO balance_applications(id,application_no,side,balance_kind,balance_id,target_open_item_id,amount_cents,business_date,reason,creator_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, applicationNo, side, balance.balance_type, balance.id, body.openItemId, amount, date(body.businessDate), String(body.reason || ''), actor.id, at);
    refreshOpenItem(db, side, body.openItemId, at);
    audit(db, actor.id, 'APPLY', 'UNAPPLIED_BALANCE', balance.id, `${applicationNo} 应用 ${amount} 分至 ${body.openItemId}`);
  });
  return send(res, 201, { id, applicationNo, status: 'CONFIRMED' });
}

export async function reverseBalanceApplication(db, req, res, actor, applicationId) {
  const body = await readJson(req); const application = db.prepare('SELECT * FROM balance_applications WHERE id=?').get(applicationId);
  if (!application) throw new HttpError(404, '余额应用记录不存在');
  allow(actor, application.side === 'AR' ? 'COLLECTION_MANAGE' : 'PAYMENT_MANAGE');
  if (application.status !== 'CONFIRMED') throw new HttpError(409, '余额应用已经冲销');
  if (!String(body.reason || '').trim()) throw new HttpError(400, '请填写冲销原因');
  transaction(db, () => {
    db.prepare("UPDATE balance_applications SET status='REVERSED',reversed_by=?,reversed_at=?,reversal_reason=? WHERE id=?").run(actor.id, now(), String(body.reason).trim(), applicationId);
    refreshOpenItem(db, application.side, application.target_open_item_id);
    audit(db, actor.id, 'REVERSE', 'BALANCE_APPLICATION', applicationId, String(body.reason).trim());
  });
  return send(res, 200, { ok: true });
}

export async function createRefund(db, req, res, actor, generateVoucher) {
  const body = await readJson(req); const side = String(body.side || '').toUpperCase();
  allow(actor, side === 'CUSTOMER' ? 'COLLECTION_MANAGE' : 'PAYMENT_MANAGE');
  if (!['CUSTOMER', 'SUPPLIER'].includes(side)) throw new HttpError(400, '退款方向不正确');
  const balance = loadBalance(db, body.balanceId, body.creditId);
  if (balance.side !== side || balance.party_id !== body.partyId) throw new HttpError(409, '退款来源与往来单位不匹配');
  const amount = cents(body.amountCents); const available = unappliedBalanceSnapshot(db, balance.id).remainingCents;
  if (amount > available) throw new HttpError(409, '退款金额超过可退款余额');
  const method = String(body.paymentMethod || 'BANK').toUpperCase(); const account = requireSettlementAccount(db, method, body.settlementAccountId);
  const reason = String(body.reason || '').trim(); if (!reason) throw new HttpError(400, '请填写退款原因');
  const businessDate = date(body.businessDate); const id = randomUUID(); const refundNo = number(side === 'CUSTOMER' ? 'CREF' : 'SREF');
  const key = req.headers['idempotency-key']; const fingerprint = requestFingerprint(body); const idempotencyScope = `${side}:${balance.id}`;
  const replay = idempotencyReplay(db, 'REFUND_CONFIRM', idempotencyScope, key, fingerprint); if (replay) return send(res, 200, { ...replay, replayed: true });
  transaction(db, () => {
    const controlCode = side === 'CUSTOMER' ? '1122' : '2202';
    const subjects = db.prepare('SELECT id,code FROM accounting_subjects WHERE active=1 AND code IN (?,?)').all(account.subjectCode, controlCode);
    const map = Object.fromEntries(subjects.map((s) => [s.code, s.id]));
    const entries = side === 'CUSTOMER'
      ? [{ subjectId: map[controlCode], direction: 'DEBIT', amountCents: amount }, { subjectId: map[account.subjectCode], direction: 'CREDIT', amountCents: amount }]
      : [{ subjectId: map[account.subjectCode], direction: 'DEBIT', amountCents: amount }, { subjectId: map[controlCode], direction: 'CREDIT', amountCents: amount }];
    const voucherId = generateVoucher(db, 'FINANCIAL_REFUND', id, entries, actor, businessDate);
    db.prepare(`INSERT INTO financial_refunds(id,refund_no,side,balance_id,party_id,amount_cents,business_date,settlement_account_id,payment_method,reference,reason,creator_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, refundNo, side, balance.id, body.partyId, amount, businessDate, account.id, method, String(body.reference || ''), reason, actor.id, now());
    recordSettlementMovement(db, { accountId: account.id, sourceType: 'FINANCIAL_REFUND', sourceId: id, direction: side === 'CUSTOMER' ? 'OUT' : 'IN', amountCents: amount, businessDate, voucherId });
    saveIdempotency(db, 'REFUND_CONFIRM', idempotencyScope, key, fingerprint, { id, refundNo, status: 'CONFIRMED' });
    audit(db, actor.id, 'CONFIRM', 'FINANCIAL_REFUND', id, `${refundNo} ${reason}`);
  });
  return send(res, 201, { id, refundNo, status: 'CONFIRMED' });
}

export async function reverseRefund(db, req, res, actor, refundId, generateVoucher) {
  const body = await readJson(req); const refund = db.prepare('SELECT * FROM financial_refunds WHERE id=?').get(refundId);
  if (!refund) throw new HttpError(404, '退款不存在'); allow(actor, refund.side === 'CUSTOMER' ? 'COLLECTION_MANAGE' : 'PAYMENT_MANAGE');
  if (refund.status !== 'CONFIRMED') throw new HttpError(409, '退款已经冲销');
  const reason = String(body.reason || '').trim(); if (!reason) throw new HttpError(400, '请填写冲销原因');
  const businessDate = date(body.businessDate); const id = randomUUID(); const reversalNo = number('REFR');
  const key = req.headers['idempotency-key']; const fingerprint = requestFingerprint(body);
  const replay = idempotencyReplay(db, 'REFUND_REVERSAL', refundId, key, fingerprint); if (replay) return send(res, 200, { ...replay, replayed: true });
  transaction(db, () => {
    const voucher = db.prepare("SELECT id FROM accounting_vouchers WHERE source_type='FINANCIAL_REFUND' AND source_id=?").get(refundId);
    const entries = db.prepare('SELECT subject_id subjectId,direction,amount_cents amountCents FROM accounting_entries WHERE voucher_id=?').all(voucher.id)
      .map((e) => ({ ...e, direction: e.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT' }));
    const voucherId = generateVoucher(db, 'FINANCIAL_REFUND_REVERSAL', id, entries, actor, businessDate);
    db.prepare('INSERT INTO financial_refund_reversals(id,reversal_no,refund_id,amount_cents,business_date,reason,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, reversalNo, refundId, refund.amount_cents, businessDate, reason, actor.id, now());
    db.prepare("UPDATE financial_refunds SET status='REVERSED' WHERE id=?").run(refundId);
    recordSettlementMovement(db, { accountId: refund.settlement_account_id, sourceType: 'FINANCIAL_REFUND_REVERSAL', sourceId: id, direction: refund.side === 'CUSTOMER' ? 'IN' : 'OUT', amountCents: refund.amount_cents, businessDate, voucherId });
    saveIdempotency(db, 'REFUND_REVERSAL', refundId, key, fingerprint, { id, reversalNo, status: 'CONFIRMED' });
    audit(db, actor.id, 'REVERSE', 'FINANCIAL_REFUND', refundId, `${reversalNo} ${reason}`);
  });
  return send(res, 201, { id, reversalNo, status: 'CONFIRMED' });
}

export async function createWriteOff(db, req, res, actor) {
  allow(actor, 'VOUCHER_SUBMIT'); const body = await readJson(req); const side = String(body.side || '').toUpperCase();
  if (!['AR', 'AP'].includes(side)) throw new HttpError(400, 'side 仅支持 AR/AP');
  const snap = openItemSnapshot(db, side, body.openItemId); if (!snap || snap.row.item_class !== 'SOURCE') throw new HttpError(404, '权威应收/应付不存在');
  const amount = cents(body.amountCents); if (amount > snap.openCents) throw new HttpError(409, '核销金额超过当前未结余额');
  const reason = String(body.reason || '').trim(); if (!reason) throw new HttpError(400, '请填写核销原因');
  const id = randomUUID(); const writeOffNo = number(side === 'AR' ? 'ARWO' : 'APWO');
  db.prepare(`INSERT INTO financial_write_offs(id,write_off_no,side,open_item_id,amount_cents,business_date,reason,status,creator_id,created_at)
    VALUES(?,?,?,?,?,?,?,'DRAFT',?,?)`).run(id, writeOffNo, side, body.openItemId, amount, date(body.businessDate), reason, actor.id, now());
  audit(db, actor.id, 'CREATE', 'FINANCIAL_WRITE_OFF', id, `创建核销草稿 ${writeOffNo}`);
  return send(res, 201, { id, writeOffNo, status: 'DRAFT' });
}

export async function actOnWriteOff(db, req, res, actor, writeOffId, action, generateVoucher) {
  const body = await readJson(req); const row = db.prepare('SELECT * FROM financial_write_offs WHERE id=?').get(writeOffId);
  if (!row) throw new HttpError(404, '核销单不存在');
  if (action === 'submit') {
    allow(actor, 'VOUCHER_SUBMIT'); if (row.status !== 'DRAFT') throw new HttpError(409, '只有草稿可以提交');
    db.prepare("UPDATE financial_write_offs SET status='SUBMITTED',submitted_at=? WHERE id=?").run(now(), writeOffId);
    return send(res, 200, { ok: true, status: 'SUBMITTED' });
  }
  if (actor.roleCode !== 'ADMIN') throw new HttpError(403, '仅系统管理员可独立确认或驳回核销');
  if (row.creator_id === actor.id) throw new HttpError(409, '核销创建人与确认人必须独立');
  if (row.status !== 'SUBMITTED') throw new HttpError(409, '只有已提交核销可以处理');
  if (action === 'reject') {
    const reason = String(body.reason || '').trim(); if (!reason) throw new HttpError(400, '请填写驳回原因');
    db.prepare("UPDATE financial_write_offs SET status='REJECTED',confirmer_id=?,confirmed_at=?,rejection_reason=? WHERE id=?").run(actor.id, now(), reason, writeOffId);
    return send(res, 200, { ok: true, status: 'REJECTED' });
  }
  const key = req.headers['idempotency-key']; const fingerprint = requestFingerprint(body);
  const replay = idempotencyReplay(db, 'WRITE_OFF_CONFIRM', writeOffId, key, fingerprint); if (replay) return send(res, 200, { ...replay, replayed: true });
  transaction(db, () => {
    const snap = openItemSnapshot(db, row.side, row.open_item_id); if (row.amount_cents > snap.openCents) throw new HttpError(409, '核销金额超过当前未结余额');
    const expense = db.prepare("SELECT id FROM accounting_subjects WHERE code='6401' AND active=1").get(); const control = db.prepare('SELECT id FROM accounting_subjects WHERE code=? AND active=1').get(row.side === 'AR' ? '1122' : '2202');
    const entries = row.side === 'AR'
      ? [{ subjectId: expense.id, direction: 'DEBIT', amountCents: row.amount_cents }, { subjectId: control.id, direction: 'CREDIT', amountCents: row.amount_cents }]
      : [{ subjectId: control.id, direction: 'DEBIT', amountCents: row.amount_cents }, { subjectId: expense.id, direction: 'CREDIT', amountCents: row.amount_cents }];
    generateVoucher(db, 'FINANCIAL_WRITE_OFF', row.id, entries, actor, row.business_date);
    db.prepare("UPDATE financial_write_offs SET status='CONFIRMED',confirmer_id=?,confirmed_at=? WHERE id=?").run(actor.id, now(), row.id);
    refreshOpenItem(db, row.side, row.open_item_id);
    saveIdempotency(db, 'WRITE_OFF_CONFIRM', writeOffId, key, fingerprint, { id: writeOffId, status: 'CONFIRMED' });
    audit(db, actor.id, 'CONFIRM', 'FINANCIAL_WRITE_OFF', row.id, `确认核销 ${row.write_off_no}`);
  });
  return send(res, 200, { id: writeOffId, status: 'CONFIRMED' });
}

export async function reverseWriteOff(db, req, res, actor, writeOffId, generateVoucher) {
  allow(actor, 'VOUCHER_SUBMIT'); const body = await readJson(req); const row = db.prepare("SELECT * FROM financial_write_offs WHERE id=? AND status='CONFIRMED'").get(writeOffId);
  if (!row) throw new HttpError(404, '已确认核销不存在'); const amount = cents(body.amountCents || row.amount_cents);
  const reversed = Number(db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM financial_write_off_reversals WHERE write_off_id=?').get(writeOffId).n);
  if (amount > row.amount_cents - reversed) throw new HttpError(409, '累计冲销金额超过原核销金额');
  const reason = String(body.reason || '').trim(); if (!reason) throw new HttpError(400, '请填写冲销原因');
  const businessDate = date(body.businessDate); const id = randomUUID(); const reversalNo = number('WOR');
  transaction(db, () => {
    const original = db.prepare("SELECT id FROM accounting_vouchers WHERE source_type='FINANCIAL_WRITE_OFF' AND source_id=?").get(writeOffId);
    const entries = db.prepare('SELECT subject_id subjectId,direction FROM accounting_entries WHERE voucher_id=?').all(original.id).map((e) => ({ ...e, amountCents: amount, direction: e.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT' }));
    generateVoucher(db, 'FINANCIAL_WRITE_OFF_REVERSAL', id, entries, actor, businessDate);
    db.prepare('INSERT INTO financial_write_off_reversals(id,reversal_no,write_off_id,amount_cents,business_date,reason,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, reversalNo, writeOffId, amount, businessDate, reason, actor.id, now());
    refreshOpenItem(db, row.side, row.open_item_id); audit(db, actor.id, 'REVERSE', 'FINANCIAL_WRITE_OFF', writeOffId, `${reversalNo} ${reason}`);
  });
  return send(res, 201, { id, reversalNo, status: 'CONFIRMED' });
}

export function settlementAccountReconciliation(db, res, actor) {
  allowAny(actor, ['ACCOUNTING_VIEW', 'BANK_RECONCILE_VIEW']); const issues = [];
  for (const movement of db.prepare('SELECT * FROM settlement_account_movements').all()) {
    const voucher = db.prepare('SELECT id FROM accounting_vouchers WHERE id=?').get(movement.voucher_id);
    if (!voucher) { issues.push({ code: 'MISSING_VOUCHER', movementId: movement.id }); continue; }
    const subjectCode = movement.settlement_account_id.startsWith('subject-') ? '1001' : '1002';
    const posted = Number(db.prepare(`SELECT COALESCE(SUM(e.amount_cents),0) n FROM accounting_entries e JOIN accounting_subjects s ON s.id=e.subject_id WHERE e.voucher_id=? AND s.code=? AND e.direction=?`).get(voucher.id, subjectCode, movement.direction === 'IN' ? 'DEBIT' : 'CREDIT').n);
    if (posted !== Number(movement.amount_cents)) issues.push({ code: 'MOVEMENT_VOUCHER_MISMATCH', movementId: movement.id, expected: movement.amount_cents, actual: posted });
  }
  for (const bank of db.prepare(`SELECT b.id,b.balance_cents,bl.baseline_cents FROM bank_accounts b JOIN settlement_account_balance_baselines bl ON bl.settlement_account_id=b.id`).all()) {
    const net = Number(db.prepare("SELECT COALESCE(SUM(CASE direction WHEN 'IN' THEN amount_cents ELSE -amount_cents END),0) n FROM settlement_account_movements WHERE settlement_account_id=?").get(bank.id).n);
    const expected = Number(bank.baseline_cents) + net;
    if (Number(bank.balance_cents) !== expected) issues.push({ code: 'BANK_BALANCE_CACHE_MISMATCH', settlementAccountId: bank.id, expected, actual: Number(bank.balance_cents) });
  }
  return send(res, 200, { ok: issues.length === 0, mode: 'CHECK', issues });
}

export async function reverseOperationalReturn(db, req, res, actor, side, returnId, generateVoucher) {
  allow(actor, 'RETURNS_MANAGE'); const body = await readJson(req);
  const sales = side === 'SALES'; const headerTable = sales ? 'return_orders' : 'purchase_returns';
  const itemTable = sales ? 'return_order_items' : 'purchase_return_items';
  const header = db.prepare(`SELECT * FROM ${headerTable} WHERE id=?`).get(returnId);
  if (!header || header.status !== 'CONFIRMED') throw new HttpError(404, '已确认退货单不存在');
  const businessDate = date(body.businessDate); const reason = String(body.reason || '').trim();
  if (!reason) throw new HttpError(400, '请填写退货冲销原因');
  if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, '请选择退货冲销明细');
  const credit = db.prepare("SELECT * FROM financial_credit_adjustments WHERE source_type=? AND source_id=? AND status='CONFIRMED'").get(sales ? 'SALES_RETURN' : 'PURCHASE_RETURN', returnId);
  if (!credit) throw new HttpError(409, '退货贷项不存在');
  const balance = db.prepare("SELECT id FROM settlement_unapplied_balances WHERE balance_type='CREDIT' AND source_id=?").get(credit.id);
  if (balance) {
    const used = Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM balance_applications WHERE balance_id=? AND status='CONFIRMED'").get(balance.id).n)
      + Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM financial_refunds WHERE balance_id=? AND status='CONFIRMED'").get(balance.id).n);
    if (used > 0) throw new HttpError(409, '该退货产生的贷项已用于后续核销或退款，请先冲销相关应用/退款记录');
  }
  const items = body.items.map((input) => {
    const original = db.prepare(`SELECT * FROM ${itemTable} WHERE id=? AND return_id=?`).get(input.returnItemId, returnId);
    if (!original) throw new HttpError(404, '原退货明细不存在');
    const quantity = Number(input.quantity); if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '冲销数量必须大于 0');
    const reversed = Number(db.prepare(`SELECT COALESCE(SUM(rri.quantity),0) n FROM return_reversal_items rri JOIN return_reversals rr ON rr.id=rri.reversal_id WHERE rr.side=? AND rr.return_id=? AND rri.original_return_item_id=?`).get(side, returnId, original.id).n);
    if (quantity > Number(original.quantity) - reversed + 1e-9) throw new HttpError(409, '累计冲销数量超过原退货数量');
    const amountCents = Math.round(quantity * Number(original.unit_price_cents));
    if (sales) { const inv = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(header.warehouse_id, original.product_id); if (!inv || Number(inv.quantity) + 1e-9 < quantity) throw new HttpError(409, '库存不足，无法冲销销售退货'); }
    return { original, quantity, amountCents };
  });
  const amount = items.reduce((sum, x) => sum + x.amountCents, 0);
  const prior = db.prepare('SELECT COALESCE(SUM(applied_cents),0) a,COALESCE(SUM(unapplied_cents),0) u FROM credit_reversal_components WHERE credit_id=?').get(credit.id);
  const availableApplied = Number(credit.applied_cents) - Number(prior.a); const availableUnapplied = Number(credit.unapplied_cents) - Number(prior.u);
  if (amount > availableApplied + availableUnapplied) throw new HttpError(409, '退货贷项剩余可冲销金额不足');
  const appliedComponent = Math.min(amount, availableApplied); const unappliedComponent = amount - appliedComponent;
  const id = randomUUID(); const reversalNo = number(sales ? 'SRR' : 'PRR'); const at = now();
  const key = String(req.headers['idempotency-key'] || body.idempotencyKey || `return-reversal-${requestFingerprint(body)}`); const fingerprint = requestFingerprint(body);
  const replay = idempotencyReplay(db, `${side}_RETURN_REVERSAL`, returnId, key, fingerprint); if (replay) return send(res, 200, { ...replay, replayed: true });
  transaction(db, () => {
    for (const item of items) {
      const current = db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE warehouse_id=? AND product_id=? AND active=1').get(header.warehouse_id, item.original.product_id);
      const delta = sales ? -item.quantity : item.quantity; const after = Number(current?.q || 0) + delta;
      // V21 — write at the canonical default position (ENTERPRISE / AVAILABLE
      // / NULL-bin / NULL-lot / NULL-serial). setInventoryQuantity refuses
      // bin-enabled warehouses and LOT/SERIAL-tracked products so legacy
      // shims cannot reintroduce the dropped UNIQUE(warehouse_id, product_id)
      // collision.
      setInventoryQuantity(db, header.warehouse_id, item.original.product_id, after, at);
      db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), header.warehouse_id, item.original.product_id, item.quantity, sales ? 'OUT' : 'IN', after, sales ? 'SALES_RETURN_REVERSAL' : 'PURCHASE_RETURN_REVERSAL', id, reversalNo, reason, actor.id, at);
    }
    const originalVoucher = db.prepare('SELECT id FROM accounting_vouchers WHERE source_type=? AND source_id=?').get(sales ? 'SALES_RETURN' : 'PURCHASE_RETURN', returnId);
    const entries = db.prepare('SELECT subject_id subjectId,direction FROM accounting_entries WHERE voucher_id=?').all(originalVoucher.id).map((e) => ({ ...e, amountCents: amount, direction: e.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT' }));
    generateVoucher(db, sales ? 'SALES_RETURN_REVERSAL' : 'PURCHASE_RETURN_REVERSAL', id, entries, actor, businessDate);
    db.prepare('INSERT INTO return_reversals(id,reversal_no,side,return_id,amount_cents,business_date,reason,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, reversalNo, side, returnId, amount, businessDate, reason, actor.id, at);
    for (const item of items) db.prepare('INSERT INTO return_reversal_items(id,reversal_id,original_return_item_id,quantity,amount_cents) VALUES(?,?,?,?,?)').run(randomUUID(), id, item.original.id, item.quantity, item.amountCents);
    db.prepare('INSERT INTO credit_reversal_components(id,credit_id,return_reversal_id,applied_cents,unapplied_cents) VALUES(?,?,?,?,?)').run(randomUUID(), credit.id, id, appliedComponent, unappliedComponent);
    refreshOpenItem(db, sales ? 'AR' : 'AP', credit.target_open_item_id, at);
    saveIdempotency(db, `${side}_RETURN_REVERSAL`, returnId, key, fingerprint, { id, reversalNo, status: 'CONFIRMED', amountCents: amount });
    audit(db, actor.id, 'REVERSE', sales ? 'SALES_RETURN' : 'PURCHASE_RETURN', returnId, `${reversalNo} ${reason}`);
  });
  return send(res, 201, { id, reversalNo, status: 'CONFIRMED', amountCents: amount });
}
