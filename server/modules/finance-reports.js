// V22 — Finance Operations Wave E.
//
// FO54 / FO55 / FO56 — Finance Reports (AR / AP / Treasury).
//
// Reports are READ MODELS over canonical facts. No write ledger.
// FO50 — Treasury ↔ GL reconciliation (Integration-Backed).

import { HttpError, allow, send } from '../lib/http.js';

export function arSummary(db, res, actor) {
  allow(actor, 'AR_VIEW', 'FINANCE_VIEW');
  const rows = db.prepare(`
    SELECT
      customer_id,
      COUNT(*) AS open_items,
      -- original_amount_cents unavailable; 
      SUM(open_amount_cents) AS total_open_cents,
      SUM(paid_cents) AS total_paid_cents,
      SUM(write_off_cents) AS total_write_off_cents
    FROM account_receivables
    WHERE status IN ('PENDING','PARTIAL')
    GROUP BY customer_id
  `).all();
  return send(res, 200, { rows });
}

export function apSummary(db, res, actor) {
  allow(actor, 'AP_VIEW', 'FINANCE_VIEW');
  const rows = db.prepare(`
    SELECT
      supplier_id,
      COUNT(*) AS open_items,
      -- original_amount_cents unavailable; 
      SUM(open_amount_cents) AS total_open_cents,
      SUM(paid_cents) AS total_paid_cents,
      SUM(write_off_cents) AS total_write_off_cents
    FROM account_payables
    WHERE status IN ('PENDING','PARTIAL')
    GROUP BY supplier_id
  `).all();
  return send(res, 200, { rows });
}

export function arAging(db, res, actor) {
  allow(actor, 'AR_VIEW', 'FINANCE_VIEW');
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT
      CASE
        WHEN ? > due_date THEN CAST((julianday(?) - julianday(due_date)) AS INTEGER)
        ELSE 0
      END AS days_overdue,
      id, voucher_no, customer_id, due_date, open_amount_cents
    FROM account_receivables
    WHERE open_amount_cents > 0
  `).all(today, today);
  return send(res, 200, { rows });
}

export function treasuryMovementLedger(db, res, actor) {
  allow(actor, 'FINANCE_TREASURY_VIEW', 'ACCOUNTING_VIEW');
  const rows = db.prepare(`
    SELECT id, settlement_account_id, direction, amount_cents, business_date,
           source_type, source_id, movement_group_id, status
    FROM finance_treasury_movements
    ORDER BY business_date DESC, created_at DESC
    LIMIT 200
  `).all();
  return send(res, 200, { rows });
}

export function settlementAccountBalance(db, res, actor, accountId) {
  allow(actor, 'FINANCE_TREASURY_VIEW', 'ACCOUNTING_VIEW');
  if (!accountId) throw new HttpError(400, 'accountId 必填');
  const account = db.prepare(`SELECT * FROM bank_accounts WHERE id=?`).get(accountId);
  if (!account) throw new HttpError(404, 'account 不存在');
  return send(res, 200, { account });
}

// FO50 — Treasury ↔ GL Reconciliation (Integration-Backed).
// Compare operational balance (from finance_treasury_movements) against
// mapped Accounting & Analytics GL cash/bank subject balance.
// Returns PASS / MISMATCH. No auto repair.
export function treasuryGlReconcile(db, res, actor, accountId) {
  allow(actor, 'FINANCE_TREASURY_VIEW', 'ACCOUNTING_VIEW');
  if (!accountId) throw new HttpError(400, 'accountId 必填');
  const op = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN direction='IN' THEN amount_cents ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN direction='OUT' THEN amount_cents ELSE 0 END), 0) AS op_balance_cents
    FROM finance_treasury_movements
    WHERE settlement_account_id=? AND status='CONFIRMED'
  `).get(accountId);
  const account = db.prepare(`SELECT COALESCE(opening_balance_cents, 0) AS op FROM bank_accounts WHERE id=?`).get(accountId);
  const opBalance = (account?.op || 0) + (op?.op_balance_cents || 0);
  // GL side: best-effort lookup via accounting_subject_id mapping
  const subj = db.prepare(`SELECT accounting_subject_id FROM bank_accounts WHERE id=?`).get(accountId);
  let glBalance = null;
  if (subj && subj.accounting_subject_id) {
    const entryRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount_cents ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_cents ELSE 0 END), 0) AS bal
      FROM accounting_entries
      WHERE subject_id=?
    `).get(subj.accounting_subject_id);
    glBalance = entryRow?.bal ?? null;
  }
  const status = (glBalance !== null && glBalance !== opBalance) ? 'MISMATCH' : 'PASS';
  return send(res, 200, { accountId, operational: opBalance, gl: glBalance, status, delta: (glBalance ?? opBalance) - opBalance });
}
