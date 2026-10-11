import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { allow, allowAny, HttpError, optionalText, readJson, requiredText, send } from '../lib/http.js';
import { assertFinanceBusinessDateOpen } from './finance-business-close.js';
import { applyTreasuryMovement, assertBalanceReconciled } from './finance-treasury-movement.js';

const stamp = () => new Date().toISOString();
const number = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
const positiveCents = (value, label = 'amountCents') => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, `${label} 必须为正整数分`);
  return amount;
};
const integerCents = (value, label) => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new HttpError(400, `${label} 必须为整数分`);
  return amount;
};
const stable = (value) => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  : value;
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

export function listSettlementAccounts(db, res, actor) {
  allowAny(actor, ['FINANCE_SETTLEMENT_ACCOUNT_VIEW', 'FINANCE_SETTLEMENT_ACCOUNT_MANAGE']);
  return send(res, 200, { settlementAccounts: db.prepare('SELECT * FROM bank_accounts ORDER BY active DESC,code,id').all() });
}

export async function createSettlementAccount(db, req, res, actor) {
  allow(actor, 'FINANCE_SETTLEMENT_ACCOUNT_MANAGE');
  const body = await readJson(req);
  const accountType = requiredText(body.accountType, 'accountType', 16).toUpperCase();
  if (!['CASH', 'BANK', 'CHECKING', 'SAVINGS', 'OTHER'].includes(accountType)) throw new HttpError(400, 'accountType 非法');
  const opening = integerCents(body.openingBalanceCents ?? 0, 'openingBalanceCents');
  const id = randomUUID(); const now = stamp();
  db.prepare(`INSERT INTO bank_accounts(id,bank_name,account_no,account_name,account_type,balance_cents,currency,active,created_at,updated_at,code,opening_balance_cents,accounting_role,accounting_subject_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, optionalText(body.bankName ?? (accountType === 'CASH' ? '现金' : ''), 128), requiredText(body.accountNo || body.code, 'accountNo', 64),
    requiredText(body.accountName, 'accountName', 128), accountType, opening, requiredText(body.currency || 'CNY', 'currency', 8), 1, now, now,
    requiredText(body.code, 'code', 64), opening, optionalText(body.accountingRole ?? '', 64), body.accountingSubjectId || null,
  );
  audit(db, actor.id, 'CREATE', 'FINANCE_SETTLEMENT_ACCOUNT', id, body.code);
  return send(res, 201, { id });
}

export function listTreasuryMovements(db, res, actor, url) {
  allowAny(actor, ['FINANCE_TREASURY_VIEW', 'FINANCE_TREASURY_MANAGE']);
  const accountId = url.searchParams.get('settlementAccountId');
  const rows = accountId
    ? db.prepare('SELECT * FROM finance_treasury_movements WHERE settlement_account_id=? ORDER BY business_date DESC,created_at DESC').all(accountId)
    : db.prepare('SELECT * FROM finance_treasury_movements ORDER BY business_date DESC,created_at DESC LIMIT 500').all();
  return send(res, 200, { movements: rows });
}

export async function postCashOperation(db, req, res, actor, operation) {
  allow(actor, 'FINANCE_TREASURY_MANAGE');
  const body = await readJson(req);
  const idempotencyKey = requiredText(body.idempotencyKey, 'idempotencyKey', 256);
  const movementId = transaction(db, () => applyTreasuryMovement(db, {
    settlementAccountId: requiredText(body.settlementAccountId, 'settlementAccountId', 64),
    direction: operation === 'deposit' ? 'IN' : 'OUT',
    amountCents: positiveCents(body.amountCents), businessDate: requiredText(body.businessDate, 'businessDate', 16),
    sourceType: operation === 'deposit' ? 'CASH_DEPOSIT' : 'CASH_WITHDRAWAL',
    sourceId: requiredText(body.sourceId || idempotencyKey, 'sourceId', 256),
    externalReference: optionalText(body.externalReference ?? '', 100),
    idempotencyKey, createdBy: actor.id,
  }));
  return send(res, 201, { movementId, status: 'CONFIRMED' });
}

export function listNotes(db, res, actor, url) {
  allowAny(actor, ['FINANCE_TREASURY_VIEW', 'FINANCE_NOTES_MANAGE']);
  const direction = url.searchParams.get('direction'); const status = url.searchParams.get('status');
  const where = []; const args = [];
  if (direction) { where.push('direction=?'); args.push(direction); }
  if (status) { where.push('status=?'); args.push(status); }
  return send(res, 200, { notes: db.prepare(`SELECT * FROM finance_notes ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY due_date,created_at`).all(...args) });
}

export async function createNote(db, req, res, actor) {
  allow(actor, 'FINANCE_NOTES_MANAGE'); const body = await readJson(req);
  const direction = requiredText(body.direction, 'direction', 16).toUpperCase();
  if (!['RECEIVABLE', 'PAYABLE'].includes(direction)) throw new HttpError(400, 'direction 必须为 RECEIVABLE/PAYABLE');
  const id = randomUUID(); const now = stamp(); const noteNo = body.noteNo || number(direction === 'RECEIVABLE' ? 'NR' : 'NP');
  db.prepare(`INSERT INTO finance_notes(id,note_no,direction,face_amount_cents,issue_date,due_date,drawer_name,payee_name,bank_name,holder_id,status,creator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'REGISTERED',?,?,?)`).run(id, noteNo, direction, positiveCents(body.faceAmountCents, 'faceAmountCents'), requiredText(body.issueDate, 'issueDate', 16), requiredText(body.dueDate, 'dueDate', 16), optionalText(body.drawerName ?? '', 128), optionalText(body.payeeName ?? '', 128), optionalText(body.bankName ?? '', 128), body.holderId || null, actor.id, now, now);
  audit(db, actor.id, 'CREATE', 'FINANCE_NOTE', id, noteNo);
  return send(res, 201, { id, noteNo, status: 'REGISTERED' });
}

export async function actOnNote(db, req, res, actor, noteId, action) {
  allow(actor, 'FINANCE_NOTES_MANAGE'); const body = await readJson(req);
  const transitions = { hold: ['REGISTERED', 'HELD'], endorse: ['HELD', 'ENDORSED'], discount: ['HELD', 'DISCOUNTED'], cancel: ['REGISTERED', 'CANCELLED'] };
  if (action !== 'settle') {
    const transition = transitions[action]; if (!transition) throw new HttpError(400, 'note action 非法');
    const row = db.prepare('SELECT * FROM finance_notes WHERE id=?').get(noteId);
    if (!row) throw new HttpError(404, '票据不存在');
    if (row.status !== transition[0]) throw new HttpError(409, '票据状态不允许该操作');
    db.prepare('UPDATE finance_notes SET status=?,updated_at=? WHERE id=?').run(transition[1], stamp(), noteId);
    audit(db, actor.id, action.toUpperCase(), 'FINANCE_NOTE', noteId, optionalText(body.reason ?? '', 256));
    return send(res, 200, { id: noteId, status: transition[1] });
  }
  let movementId;
  transaction(db, () => {
    const row = db.prepare('SELECT * FROM finance_notes WHERE id=?').get(noteId);
    if (!row) throw new HttpError(404, '票据不存在');
    if (!['HELD', 'ENDORSED', 'DISCOUNTED'].includes(row.status)) throw new HttpError(409, '票据状态不允许结算');
    const businessDate = requiredText(body.businessDate, 'businessDate', 16);
    assertFinanceBusinessDateOpen(db, row.direction === 'RECEIVABLE' ? 'AR' : 'AP', businessDate);
    movementId = applyTreasuryMovement(db, { settlementAccountId: requiredText(body.settlementAccountId, 'settlementAccountId', 64), direction: row.direction === 'RECEIVABLE' ? 'IN' : 'OUT', amountCents: row.face_amount_cents, businessDate, sourceType: 'NOTE_SETTLEMENT', sourceId: noteId, idempotencyKey: `NOTE_SETTLEMENT:${noteId}`, createdBy: actor.id });
    const now = stamp();
    db.prepare("UPDATE finance_notes SET status='SETTLED',settlement_account_id=?,settlement_movement_id=?,settled_by=?,settled_at=?,updated_at=? WHERE id=?").run(body.settlementAccountId, movementId, actor.id, now, now, noteId);
    audit(db, actor.id, 'SETTLE', 'FINANCE_NOTE', noteId, movementId);
  });
  return send(res, 200, { id: noteId, status: 'SETTLED', movementId });
}

export function listPaymentRequests(db, res, actor) {
  allowAny(actor, ['FINANCE_AP_VIEW', 'FINANCE_AR_VIEW', 'FINANCE_PAYMENT_REQUEST_MANAGE']);
  return send(res, 200, { paymentRequests: db.prepare('SELECT * FROM finance_payment_requests ORDER BY business_date DESC,created_at DESC').all() });
}

export async function createPaymentRequest(db, req, res, actor) {
  allow(actor, 'FINANCE_PAYMENT_REQUEST_MANAGE'); const body = await readJson(req);
  const side = requiredText(body.side || 'AP', 'side', 4).toUpperCase(); if (!['AR', 'AP'].includes(side)) throw new HttpError(400, 'side 必须为 AR/AP');
  const id = randomUUID(); const requestNo = body.requestNo || number('PAYREQ'); const now = stamp();
  db.prepare(`INSERT INTO finance_payment_requests(id,request_no,side,party_id,amount_cents,business_date,reason,status,creator_id,created_at)
    VALUES(?,?,?,?,?,?,?,'DRAFT',?,?)`).run(id, requestNo, side, requiredText(body.partyId, 'partyId', 64), positiveCents(body.amountCents), requiredText(body.businessDate, 'businessDate', 16), requiredText(body.reason, 'reason', 256), actor.id, now);
  audit(db, actor.id, 'CREATE', 'FINANCE_PAYMENT_REQUEST', id, requestNo);
  return send(res, 201, { id, requestNo, status: 'DRAFT' });
}

export async function actOnPaymentRequest(db, req, res, actor, requestId, action) {
  allow(actor, 'FINANCE_PAYMENT_REQUEST_MANAGE'); const body = await readJson(req);
  const row = db.prepare('SELECT * FROM finance_payment_requests WHERE id=?').get(requestId);
  if (!row) throw new HttpError(404, '付款申请不存在'); const now = stamp();
  if (action === 'submit') {
    if (row.status !== 'DRAFT') throw new HttpError(409, '仅草稿可提交');
    db.prepare("UPDATE finance_payment_requests SET status='SUBMITTED' WHERE id=?").run(requestId);
  } else if (action === 'approve' || action === 'reject') {
    if (row.status !== 'SUBMITTED') throw new HttpError(409, '仅已提交申请可审批');
    if (row.creator_id === actor.id) throw new HttpError(409, '申请人与审批人必须分离');
    db.prepare(`UPDATE finance_payment_requests SET status=?,approver_id=?,approved_at=?,rejection_reason=? WHERE id=?`).run(action === 'approve' ? 'APPROVED' : 'REJECTED', actor.id, now, action === 'reject' ? requiredText(body.reason, 'reason', 256) : '', requestId);
  } else if (action === 'cancel') {
    if (!['DRAFT', 'REJECTED'].includes(row.status)) throw new HttpError(409, '当前状态不可取消');
    db.prepare("UPDATE finance_payment_requests SET status='CANCELLED' WHERE id=?").run(requestId);
  } else if (action === 'execute') {
    if (row.status !== 'APPROVED') throw new HttpError(409, '仅已审批申请可执行');
    transaction(db, () => {
      assertFinanceBusinessDateOpen(db, row.side, row.business_date);
      const movementId = applyTreasuryMovement(db, { settlementAccountId: requiredText(body.settlementAccountId, 'settlementAccountId', 64), direction: 'OUT', amountCents: row.amount_cents, businessDate: row.business_date, sourceType: 'PAYMENT_REQUEST', sourceId: requestId, idempotencyKey: `PAYMENT_REQUEST:${requestId}`, createdBy: actor.id });
      db.prepare("UPDATE finance_payment_requests SET status='EXECUTED',executor_id=?,executed_at=?,settlement_account_id=?,payment_method=?,treasury_movement_id=? WHERE id=?").run(actor.id, now, body.settlementAccountId, body.paymentMethod || 'BANK', movementId, requestId);
      audit(db, actor.id, 'EXECUTE', 'FINANCE_PAYMENT_REQUEST', requestId, movementId);
    });
  } else throw new HttpError(400, 'payment request action 非法');
  audit(db, actor.id, action.toUpperCase(), 'FINANCE_PAYMENT_REQUEST', requestId, '');
  return send(res, 200, { id: requestId, status: action === 'submit' ? 'SUBMITTED' : action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : action === 'cancel' ? 'CANCELLED' : 'EXECUTED' });
}

export function listCashCounts(db, res, actor) {
  allowAny(actor, ['FINANCE_TREASURY_VIEW', 'FINANCE_CASH_COUNT_MANAGE']);
  return send(res, 200, { cashCounts: db.prepare('SELECT * FROM finance_cash_counts ORDER BY count_date DESC,created_at DESC').all() });
}

export async function createCashCount(db, req, res, actor) {
  allow(actor, 'FINANCE_CASH_COUNT_MANAGE'); const body = await readJson(req); const accountId = requiredText(body.settlementAccountId, 'settlementAccountId', 64);
  const account = db.prepare("SELECT * FROM bank_accounts WHERE id=? AND account_type='CASH' AND active=1").get(accountId); if (!account) throw new HttpError(409, '请选择有效现金账户');
  assertBalanceReconciled(db, accountId); const lines = Array.isArray(body.lines) ? body.lines : [];
  const normalized = lines.map((line) => ({ denomination: requiredText(line.denomination, 'denomination', 32), countQuantity: integerCents(line.countQuantity, 'countQuantity'), totalCents: integerCents(line.totalCents, 'totalCents') }));
  const physical = normalized.reduce((sum, line) => sum + line.totalCents, 0); const id = randomUUID(); const now = stamp();
  transaction(db, () => {
    db.prepare("INSERT INTO finance_cash_counts(id,count_no,settlement_account_id,count_date,book_amount_cents,physical_amount_cents,difference_cents,status,creator_id,created_at) VALUES(?,?,?,?,?,?,?,'DRAFT',?,?)").run(id, number('CASHCOUNT'), accountId, requiredText(body.countDate, 'countDate', 16), account.balance_cents, physical, physical - account.balance_cents, actor.id, now);
    const insert = db.prepare('INSERT INTO finance_cash_count_lines(id,count_id,denomination,count_quantity,total_cents) VALUES(?,?,?,?,?)');
    for (const line of normalized) insert.run(randomUUID(), id, line.denomination, line.countQuantity, line.totalCents);
    audit(db, actor.id, 'CREATE', 'FINANCE_CASH_COUNT', id, String(physical));
  });
  return send(res, 201, { id, bookAmountCents: account.balance_cents, physicalAmountCents: physical, differenceCents: physical - account.balance_cents, status: 'DRAFT' });
}

export async function confirmCashCount(db, req, res, actor, countId) {
  allow(actor, 'FINANCE_CASH_COUNT_MANAGE'); await readJson(req);
  transaction(db, () => {
    const row = db.prepare('SELECT * FROM finance_cash_counts WHERE id=?').get(countId); if (!row) throw new HttpError(404, '现金盘点不存在'); if (row.status !== 'DRAFT') throw new HttpError(409, '仅草稿可确认');
    assertFinanceBusinessDateOpen(db, 'TREASURY', row.count_date); assertBalanceReconciled(db, row.settlement_account_id);
    db.prepare("UPDATE finance_cash_counts SET status='CONFIRMED',confirmer_id=?,confirmed_at=? WHERE id=?").run(actor.id, stamp(), countId);
    audit(db, actor.id, 'CONFIRM', 'FINANCE_CASH_COUNT', countId, String(row.difference_cents));
  });
  return send(res, 200, { id: countId, status: 'CONFIRMED' });
}

export function listBankStatements(db, res, actor) {
  allowAny(actor, ['FINANCE_TREASURY_VIEW', 'FINANCE_RECONCILE_MANAGE']);
  return send(res, 200, { bankStatements: db.prepare('SELECT * FROM bank_statements ORDER BY statement_date DESC,created_at DESC').all() });
}

export async function importBankStatement(db, req, res, actor) {
  allow(actor, 'FINANCE_BANK_STATEMENT_IMPORT'); const body = await readJson(req); const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) throw new HttpError(400, '银行流水不能为空'); const fileName = requiredText(body.fileName, 'fileName', 256);
  const payloadFingerprint = fingerprint({ bankAccountId: body.bankAccountId, statementNo: body.statementNo, statementDate: body.statementDate, lines });
  const supplied = body.fingerprint ? requiredText(body.fingerprint, 'fingerprint', 128) : payloadFingerprint;
  if (supplied !== payloadFingerprint) throw new HttpError(409, 'fingerprint 与导入内容不一致');
  const existing = db.prepare('SELECT * FROM finance_bank_statement_imports WHERE file_name=? AND fingerprint=?').get(fileName, supplied);
  if (existing) return send(res, 200, { importId: existing.id, statementId: existing.statement_id, status: existing.status, replayed: true });
  const account = db.prepare('SELECT id FROM bank_accounts WHERE id=? AND active=1').get(body.bankAccountId); if (!account) throw new HttpError(409, '银行账户不存在或未启用');
  const importId = randomUUID(); const statementId = randomUUID(); const now = stamp();
  transaction(db, () => {
    assertFinanceBusinessDateOpen(db, 'TREASURY', requiredText(body.statementDate, 'statementDate', 16));
    db.prepare("INSERT INTO finance_bank_statement_imports(id,file_name,fingerprint,status,statement_id,created_at) VALUES(?,?,?,'PENDING',?,?)").run(importId, fileName, supplied, statementId, now);
    let debit = 0; let credit = 0;
    const normalized = lines.map((line, index) => {
      const direction = requiredText(line.direction, `lines[${index}].direction`, 4).toUpperCase(); if (!['IN', 'OUT'].includes(direction)) throw new HttpError(400, '银行流水 direction 必须为 IN/OUT');
      const amount = positiveCents(line.amountCents, `lines[${index}].amountCents`); if (direction === 'IN') credit += amount; else debit += amount;
      return { ...line, direction, amount, lineNo: index + 1, lineFingerprint: fingerprint({ importFingerprint: supplied, index, line }) };
    });
    db.prepare(`INSERT INTO bank_statements(id,bank_account_id,statement_no,statement_date,period,opening_balance_cents,closing_balance_cents,total_debit_cents,total_credit_cents,total_count,creator_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(statementId, body.bankAccountId, requiredText(body.statementNo, 'statementNo', 64), body.statementDate, body.period || body.statementDate.slice(0, 7), integerCents(body.openingBalanceCents ?? 0, 'openingBalanceCents'), integerCents(body.closingBalanceCents ?? 0, 'closingBalanceCents'), debit, credit, normalized.length, actor.id, now);
    const insert = db.prepare(`INSERT INTO bank_statement_items(id,statement_id,line_no,transaction_date,summary,debit_cents,credit_cents,balance_cents,counterparty,reference_no,external_transaction_date,value_date,amount_cents,direction,bank_reference,description,import_fingerprint)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const line of normalized) insert.run(randomUUID(), statementId, line.lineNo, line.transactionDate, line.description || '', line.direction === 'OUT' ? line.amount : 0, line.direction === 'IN' ? line.amount : 0, integerCents(line.balanceCents ?? 0, 'balanceCents'), line.counterparty || '', line.bankReference || '', line.transactionDate, line.valueDate || line.transactionDate, line.amount, line.direction, line.bankReference || '', line.description || '', line.lineFingerprint);
    db.prepare("UPDATE finance_bank_statement_imports SET status='IMPORTED',imported_at=? WHERE id=?").run(now, importId);
    audit(db, actor.id, 'IMPORT', 'FINANCE_BANK_STATEMENT', statementId, supplied);
  });
  return send(res, 201, { importId, statementId, status: 'IMPORTED', lineCount: lines.length });
}

export function listBankReconciliations(db, res, actor) {
  allowAny(actor, ['FINANCE_TREASURY_VIEW', 'FINANCE_RECONCILE_MANAGE']);
  return send(res, 200, { reconciliations: db.prepare('SELECT * FROM finance_bank_reconciliations ORDER BY created_at DESC').all() });
}

export async function createBankReconciliation(db, req, res, actor) {
  allow(actor, 'FINANCE_RECONCILE_MANAGE'); const body = await readJson(req);
  const statement = db.prepare('SELECT * FROM bank_statements WHERE id=?').get(body.statementId); if (!statement) throw new HttpError(404, '银行对账单不存在');
  if (statement.bank_account_id !== body.settlementAccountId) throw new HttpError(409, '对账单与结算账户不匹配');
  const existing = db.prepare('SELECT * FROM finance_bank_reconciliations WHERE settlement_account_id=? AND statement_id=?').get(body.settlementAccountId, body.statementId);
  if (existing) return send(res, 200, { id: existing.id, status: existing.status, replayed: true });
  const id = randomUUID(); db.prepare("INSERT INTO finance_bank_reconciliations(id,settlement_account_id,statement_id,status,created_by,created_at) VALUES(?,?,?,'OPEN',?,?)").run(id, body.settlementAccountId, body.statementId, actor.id, stamp());
  audit(db, actor.id, 'CREATE', 'FINANCE_BANK_RECONCILIATION', id, body.statementId); return send(res, 201, { id, status: 'OPEN' });
}

export async function matchBankReconciliation(db, req, res, actor, reconciliationId) {
  allow(actor, 'FINANCE_RECONCILE_MANAGE'); const body = await readJson(req); const amount = positiveCents(body.matchedAmountCents, 'matchedAmountCents');
  transaction(db, () => {
    const reconciliation = db.prepare('SELECT r.*,s.statement_date FROM finance_bank_reconciliations r JOIN bank_statements s ON s.id=r.statement_id WHERE r.id=?').get(reconciliationId); if (!reconciliation) throw new HttpError(404, '银行对账不存在'); if (reconciliation.status === 'CLOSED') throw new HttpError(409, '银行对账已关闭');
    assertFinanceBusinessDateOpen(db, 'TREASURY', reconciliation.statement_date);
    const line = db.prepare('SELECT * FROM bank_statement_items WHERE id=? AND statement_id=?').get(body.statementLineId, reconciliation.statement_id); if (!line) throw new HttpError(404, '银行流水行不存在');
    const movement = db.prepare("SELECT * FROM finance_treasury_movements WHERE id=? AND settlement_account_id=? AND status='CONFIRMED'").get(body.treasuryMovementId, reconciliation.settlement_account_id); if (!movement) throw new HttpError(404, '资金流水不存在');
    const lineAmount = Number(line.amount_cents || line.debit_cents || line.credit_cents); const lineMatched = Number(db.prepare('SELECT COALESCE(SUM(matched_amount_cents),0) n FROM finance_bank_reconciliation_matches WHERE statement_line_id=?').get(line.id).n);
    const movementMatched = Number(db.prepare('SELECT COALESCE(SUM(matched_amount_cents),0) n FROM finance_bank_reconciliation_matches WHERE treasury_movement_id=?').get(movement.id).n);
    if (amount > lineAmount - lineMatched || amount > movement.amount_cents - movementMatched) throw new HttpError(409, '匹配金额超过银行或账面未匹配余额');
    if (line.direction && line.direction !== movement.direction) throw new HttpError(409, '银行与账面流水方向不一致');
    db.prepare('INSERT INTO finance_bank_reconciliation_matches(id,reconciliation_id,statement_line_id,treasury_movement_id,matched_amount_cents,match_method,matched_by,matched_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), reconciliationId, line.id, movement.id, amount, body.matchMethod || 'MANUAL', actor.id, stamp());
    audit(db, actor.id, 'MATCH', 'FINANCE_BANK_RECONCILIATION', reconciliationId, `${line.id}:${movement.id}:${amount}`);
  });
  return send(res, 201, { reconciliationId, status: 'MATCHED' });
}

export function bankReconciliationUnmatched(db, res, actor, reconciliationId) {
  allowAny(actor, ['FINANCE_TREASURY_VIEW', 'FINANCE_RECONCILE_MANAGE']);
  const reconciliation = db.prepare('SELECT * FROM finance_bank_reconciliations WHERE id=?').get(reconciliationId); if (!reconciliation) throw new HttpError(404, '银行对账不存在');
  const bankUnmatched = db.prepare(`SELECT i.*,i.amount_cents-COALESCE((SELECT SUM(m.matched_amount_cents) FROM finance_bank_reconciliation_matches m WHERE m.statement_line_id=i.id),0) remaining_amount_cents FROM bank_statement_items i WHERE i.statement_id=? AND i.amount_cents-COALESCE((SELECT SUM(m.matched_amount_cents) FROM finance_bank_reconciliation_matches m WHERE m.statement_line_id=i.id),0)>0`).all(reconciliation.statement_id);
  const bookUnmatched = db.prepare(`SELECT t.*,t.amount_cents-COALESCE((SELECT SUM(m.matched_amount_cents) FROM finance_bank_reconciliation_matches m WHERE m.treasury_movement_id=t.id),0) unmatched_amount_cents FROM finance_treasury_movements t WHERE t.settlement_account_id=? AND t.status='CONFIRMED' AND t.amount_cents-COALESCE((SELECT SUM(m.matched_amount_cents) FROM finance_bank_reconciliation_matches m WHERE m.treasury_movement_id=t.id),0)>0`).all(reconciliation.settlement_account_id);
  return send(res, 200, { bankUnmatched, bookUnmatched });
}
