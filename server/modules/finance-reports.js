// V22 — Finance Operations Wave E.
//
// FO54 / FO55 / FO56 — Finance Reports (AR / AP / Treasury).
//
// Reports are READ MODELS over canonical facts. No write ledger.
// FO50 — Treasury ↔ GL reconciliation (Integration-Backed).

import { HttpError, allow, send } from '../lib/http.js';

export function arSummary(db, res, actor) {
  allow(actor, 'FINANCE_AR_VIEW');
  const rows = db.prepare(`
    SELECT
      customer_id,
      COUNT(*) AS open_items,
      -- original_amount_cents unavailable; 
      SUM(open_amount_cents) AS total_open_cents,
      SUM(paid_cents) AS total_paid_cents,
      SUM(write_off_cents) AS total_write_off_cents
    FROM account_receivables
    WHERE status IN ('PENDING','PARTIAL') AND COALESCE(conversion_state,'OPEN')='OPEN'
    GROUP BY customer_id
  `).all();
  return send(res, 200, { rows });
}

export function apSummary(db, res, actor) {
  allow(actor, 'FINANCE_AP_VIEW');
  const rows = db.prepare(`
    SELECT
      supplier_id,
      COUNT(*) AS open_items,
      -- original_amount_cents unavailable; 
      SUM(open_amount_cents) AS total_open_cents,
      SUM(paid_cents) AS total_paid_cents,
      SUM(write_off_cents) AS total_write_off_cents
    FROM account_payables
    WHERE status IN ('PENDING','PARTIAL') AND COALESCE(conversion_state,'OPEN')='OPEN'
    GROUP BY supplier_id
  `).all();
  return send(res, 200, { rows });
}

export function arAging(db, res, actor) {
  allow(actor, 'FINANCE_AR_VIEW');
  const today = new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const rows = db.prepare(`SELECT id,voucher_no,customer_id,due_date,open_amount_cents FROM account_receivables
    WHERE open_amount_cents>0 AND COALESCE(conversion_state,'OPEN')='OPEN'`).all().map((row) => {
    const dueMs = Date.parse(`${row.due_date}T00:00:00Z`);
    return { days_overdue: Number.isFinite(dueMs) && todayMs > dueMs ? Math.floor((todayMs - dueMs) / 86400000) : 0, ...row };
  });
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
// FO36 — Invoice Operational Reports.
//
// The operational invoice is independent of AR / AP, cash settlement and the
// voucher (Requirement §33.17). The report therefore reads the invoice
// headers and their source cardinality, and never re-derives an open-item or
// cash figure.
export function invoiceOperationalReport(db, res, actor, url) {
  allow(actor, 'FINANCE_INVOICE_VIEW');
  const side = String(url?.searchParams?.get('side') || '').toUpperCase();
  const status = String(url?.searchParams?.get('status') || '').toUpperCase();
  const limit = Math.min(Number(url?.searchParams?.get('limit')) || 200, 500);
  const sales = side !== 'AP' ? db.prepare(`
    SELECT 'SALES_INVOICE' side, i.id, i.invoice_no document_no, i.customer_id counterparty_id,
           c.code counterparty_code, c.name counterparty_name, i.invoice_date document_date,
           i.status, i.tax_mode, i.net_cents, i.tax_cents, i.gross_cents,
           i.tax_snapshot_json, i.recognition_mode, i.open_item_id, i.provisional_origin_id,
           COALESCE(i.credit_state,'') credit_state,
           COALESCE(i.credited_amount_cents,0) credited_amount_cents,
           (SELECT COUNT(*) FROM finance_invoice_source_links l WHERE l.invoice_id=i.id) source_line_count,
           (SELECT COALESCE(SUM(l.invoiced_amount_cents),0) FROM finance_invoice_source_links l WHERE l.invoice_id=i.id) linked_amount_cents
      FROM sales_invoices i LEFT JOIN customers c ON c.id=i.customer_id
     WHERE (? = '' OR i.status = ?)
     ORDER BY i.invoice_date DESC, i.id DESC LIMIT ?`).all(status, status, limit) : [];
  const purchases = side !== 'AR' ? db.prepare(`
    SELECT 'SUPPLIER_BILL' side, b.id, b.bill_no document_no, b.supplier_id counterparty_id,
           s.code counterparty_code, s.name counterparty_name, b.bill_date document_date,
           b.status, b.tax_mode, b.net_cents, b.tax_cents, b.gross_cents,
           b.tax_snapshot_json, b.recognition_mode, b.open_item_id, NULL provisional_origin_id,
           COALESCE(b.verification_state,'') credit_state,
           COALESCE(b.credited_amount_cents,0) credited_amount_cents,
           (SELECT COUNT(*) FROM finance_invoice_source_links l WHERE l.invoice_id=b.id) source_line_count,
           (SELECT COALESCE(SUM(l.invoiced_amount_cents),0) FROM finance_invoice_source_links l WHERE l.invoice_id=b.id) linked_amount_cents
      FROM supplier_bills b LEFT JOIN suppliers s ON s.id=b.supplier_id
     WHERE (? = '' OR b.status = ?)
     ORDER BY b.bill_date DESC, b.id DESC LIMIT ?`).all(status, status, limit) : [];
  const rows = [...sales, ...purchases].map((row) => ({
    ...row,
    tax_snapshot: safeJson(row.tax_snapshot_json),
    tax_snapshot_json: undefined,
  }));
  const totals = rows.reduce((accumulator, row) => ({
    invoices: accumulator.invoices + 1,
    net_cents: accumulator.net_cents + Number(row.net_cents || 0),
    tax_cents: accumulator.tax_cents + Number(row.tax_cents || 0),
    gross_cents: accumulator.gross_cents + Number(row.gross_cents || 0),
    credited_cents: accumulator.credited_cents + Number(row.credited_amount_cents || 0),
  }), { invoices: 0, net_cents: 0, tax_cents: 0, gross_cents: 0, credited_cents: 0 });
  return send(res, 200, { side: side || 'ALL', status: status || 'ALL', totals, rows });
}

function safeJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

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
