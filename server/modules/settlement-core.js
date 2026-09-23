import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();

function addColumn(db, sql) {
  try { db.exec(sql); } catch { /* idempotent ALTER */ }
}

export function migrateSettlementSchema(db) {
  addColumn(db, "ALTER TABLE account_receivables ADD COLUMN source_no TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE account_receivables ADD COLUMN business_date TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'ALTER TABLE account_receivables ADD COLUMN adjustment_cents INTEGER NOT NULL DEFAULT 0');
  addColumn(db, "ALTER TABLE account_receivables ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE account_payables ADD COLUMN source_no TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE account_payables ADD COLUMN business_date TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'ALTER TABLE account_payables ADD COLUMN adjustment_cents INTEGER NOT NULL DEFAULT 0');
  addColumn(db, "ALTER TABLE account_payables ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");

  addColumn(db, "ALTER TABLE payment_collections ADD COLUMN status TEXT NOT NULL DEFAULT 'CONFIRMED'");
  addColumn(db, "ALTER TABLE payment_collections ADD COLUMN bank_account TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'ALTER TABLE payment_collections ADD COLUMN confirmed_by TEXT');
  addColumn(db, 'ALTER TABLE payment_collections ADD COLUMN confirmed_at TEXT');
  addColumn(db, "ALTER TABLE payment_collections ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE payment_disbursements ADD COLUMN status TEXT NOT NULL DEFAULT 'CONFIRMED'");
  addColumn(db, "ALTER TABLE payment_disbursements ADD COLUMN bank_account TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'ALTER TABLE payment_disbursements ADD COLUMN confirmed_by TEXT');
  addColumn(db, 'ALTER TABLE payment_disbursements ADD COLUMN confirmed_at TEXT');
  addColumn(db, "ALTER TABLE payment_disbursements ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");

  const duplicateAr = db.prepare('SELECT source_type,source_id,COUNT(*) count FROM account_receivables GROUP BY source_type,source_id HAVING COUNT(*)>1 LIMIT 1').get();
  const duplicateAp = db.prepare('SELECT source_type,source_id,COUNT(*) count FROM account_payables GROUP BY source_type,source_id HAVING COUNT(*)>1 LIMIT 1').get();
  if (duplicateAr || duplicateAp) throw new Error(`M8 migration blocked: duplicate legacy source ${JSON.stringify(duplicateAr || duplicateAp)}`);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_source_unique ON account_receivables(source_type,source_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_source_unique ON account_payables(source_type,source_id);
    CREATE INDEX IF NOT EXISTS idx_ar_business_date ON account_receivables(business_date);
    CREATE INDEX IF NOT EXISTS idx_ap_business_date ON account_payables(business_date);

    CREATE TABLE IF NOT EXISTS payment_collection_items (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      receivable_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      UNIQUE(collection_id, receivable_id),
      FOREIGN KEY (collection_id) REFERENCES payment_collections(id) ON DELETE CASCADE,
      FOREIGN KEY (receivable_id) REFERENCES account_receivables(id)
    );
    CREATE TABLE IF NOT EXISTS payment_disbursement_items (
      id TEXT PRIMARY KEY,
      disbursement_id TEXT NOT NULL,
      payable_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      UNIQUE(disbursement_id, payable_id),
      FOREIGN KEY (disbursement_id) REFERENCES payment_disbursements(id) ON DELETE CASCADE,
      FOREIGN KEY (payable_id) REFERENCES account_payables(id)
    );
    CREATE INDEX IF NOT EXISTS idx_collection_items_receivable ON payment_collection_items(receivable_id);
    CREATE INDEX IF NOT EXISTS idx_disbursement_items_payable ON payment_disbursement_items(payable_id);
  `);

  const stamp = now();
  db.prepare("UPDATE account_receivables SET source_no=COALESCE(NULLIF(source_no,''),source_id), business_date=COALESCE(NULLIF(business_date,''),substr(created_at,1,10)), updated_at=COALESCE(NULLIF(updated_at,''),created_at)").run();
  db.prepare("UPDATE account_payables SET source_no=COALESCE(NULLIF(source_no,''),source_id), business_date=COALESCE(NULLIF(business_date,''),substr(created_at,1,10)), updated_at=COALESCE(NULLIF(updated_at,''),created_at)").run();
  db.prepare("UPDATE payment_collections SET updated_at=COALESCE(NULLIF(updated_at,''),created_at), confirmed_at=COALESCE(confirmed_at,created_at) WHERE status='CONFIRMED'").run();
  db.prepare("UPDATE payment_disbursements SET updated_at=COALESCE(NULLIF(updated_at,''),created_at), confirmed_at=COALESCE(confirmed_at,created_at) WHERE status='CONFIRMED'").run();
  db.prepare(`INSERT OR IGNORE INTO payment_collection_items(id,collection_id,receivable_id,amount_cents)
    SELECT 'legacy-pci-'||id,id,receivable_id,amount_cents FROM payment_collections WHERE receivable_id IS NOT NULL AND amount_cents>0`).run();
  db.prepare(`INSERT OR IGNORE INTO payment_disbursement_items(id,disbursement_id,payable_id,amount_cents)
    SELECT 'legacy-pdi-'||id,id,payable_id,amount_cents FROM payment_disbursements WHERE payable_id IS NOT NULL AND amount_cents>0`).run();
  void stamp;
}

function ensureSubledger(db, kind, source) {
  const isAr = kind === 'AR';
  const table = isAr ? 'account_receivables' : 'account_payables';
  const partyColumn = isAr ? 'customer_id' : 'supplier_id';
  const prefix = isAr ? 'AR' : 'AP';
  const existing = db.prepare(`SELECT id FROM ${table} WHERE source_type=? AND source_id=?`).get(source.sourceType, source.id);
  if (existing) return existing.id;
  const itemId = randomUUID();
  const createdAt = source.createdAt || now();
  const positive = source.effectCents > 0 ? source.effectCents : 0;
  const adjustment = source.effectCents < 0 ? source.effectCents : 0;
  const itemClass = source.effectCents > 0 && ['SALES_DELIVERY', 'PURCHASE_RECEIPT'].includes(source.sourceType) ? 'SOURCE' : 'LEGACY';
  const termsDays = Number.isSafeInteger(source.paymentTermsDays) && source.paymentTermsDays >= 0 ? source.paymentTermsDays : null;
  const dueDate = termsDays === null ? source.businessDate : addDays(source.businessDate, termsDays);
  db.prepare(`INSERT INTO ${table}(id,voucher_no,${partyColumn},source_type,source_id,amount_cents,paid_cents,write_off_cents,status,due_date,creator_id,created_at,source_no,business_date,adjustment_cents,updated_at,payment_terms_days,cash_allocation_cents,open_amount_cents,item_class)
    VALUES(?,?,?,?,?,?,0,0,'PENDING',?,?,?,?,?,?,?, ?,0,?,?)`)
    .run(itemId, `${prefix}-${source.sourceNo}`, source.partyId, source.sourceType, source.id, positive,
      dueDate, source.creatorId, createdAt, source.sourceNo, source.businessDate, adjustment, createdAt, termsDays, positive, itemClass);
  return itemId;
}

function addDays(dateText, days) {
  const value = new Date(`${dateText}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function ensureReceivableSource(db, source) { return ensureSubledger(db, 'AR', source); }
export function ensurePayableSource(db, source) { return ensureSubledger(db, 'AP', source); }

export function openItemSnapshot(db, side, itemId) {
  const ar = side === 'AR';
  const table = ar ? 'account_receivables' : 'account_payables';
  const allocationTable = ar ? 'payment_collection_items' : 'payment_disbursement_items';
  const documentTable = ar ? 'payment_collections' : 'payment_disbursements';
  const itemFk = ar ? 'receivable_id' : 'payable_id';
  const documentFk = ar ? 'collection_id' : 'disbursement_id';
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(itemId);
  if (!row) return null;
  const credits = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN f.adjustment_type='RETURN' AND f.status='CONFIRMED' THEN f.applied_cents-COALESCE(r.applied_reversed,0) ELSE 0 END),0) returnCents,
    COALESCE(SUM(CASE WHEN f.adjustment_type='DISCOUNT' AND f.status='CONFIRMED' THEN f.applied_cents-COALESCE(r.applied_reversed,0) ELSE 0 END),0) discountCents,
    COALESCE(SUM(CASE WHEN f.adjustment_type='OTHER' AND f.status='CONFIRMED' THEN f.applied_cents-COALESCE(r.applied_reversed,0) ELSE 0 END),0) otherCents
    FROM financial_credit_adjustments f
    LEFT JOIN (SELECT credit_id,SUM(applied_cents) applied_reversed FROM credit_reversal_components GROUP BY credit_id) r ON r.credit_id=f.id
    WHERE f.side=? AND f.target_open_item_id=?`).get(side, itemId);
  const cash = db.prepare(`SELECT COALESCE(SUM(ai.amount_cents-ai.reversed_cents),0) n
    FROM ${allocationTable} ai JOIN ${documentTable} d ON d.id=ai.${documentFk}
    WHERE ai.${itemFk}=? AND d.status='CONFIRMED'`).get(itemId).n;
  const original = Number(row.amount_cents);
  const returnCents = Number(credits.returnCents);
  const discountCents = Number(credits.discountCents);
  const otherCents = Number(credits.otherCents);
  const cashCents = Number(cash);
  const applications = Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM balance_applications WHERE side=? AND target_open_item_id=? AND status='CONFIRMED'`).get(side, itemId).n);
  const writeOffCents = Number(db.prepare(`SELECT COALESCE(SUM(w.amount_cents-COALESCE(r.reversed_cents,0)),0) n
    FROM financial_write_offs w LEFT JOIN (SELECT write_off_id,SUM(amount_cents) reversed_cents FROM financial_write_off_reversals GROUP BY write_off_id) r ON r.write_off_id=w.id
    WHERE w.side=? AND w.open_item_id=? AND w.status='CONFIRMED'`).get(side, itemId).n);
  const openCents = Math.max(0, original - returnCents - discountCents - otherCents - cashCents - applications - writeOffCents);
  return { row, originalCents: original, returnCents, discountCents, otherCents, cashCents, writeOffCents, openCents,
    applicationCents: applications,
    status: openCents === 0 ? 'COMPLETED' : openCents === original ? 'PENDING' : 'PARTIAL' };
}

export function refreshOpenItem(db, side, itemId, at = now()) {
  const snap = openItemSnapshot(db, side, itemId);
  if (!snap) throw new Error(`Missing ${side} open item ${itemId}`);
  const table = side === 'AR' ? 'account_receivables' : 'account_payables';
  db.prepare(`UPDATE ${table} SET return_credit_applied_cents=?,discount_credit_applied_cents=?,other_credit_applied_cents=?,cash_allocation_cents=?,paid_cents=?,write_off_cents=?,adjustment_cents=?,open_amount_cents=?,status=?,updated_at=? WHERE id=?`)
    .run(snap.returnCents, snap.discountCents, snap.otherCents, snap.cashCents, snap.cashCents,
      snap.writeOffCents, -(snap.returnCents + snap.discountCents + snap.otherCents), snap.openCents, snap.status, at, itemId);
  return snap;
}

export function applyCreditAdjustment(db, input) {
  const existing = db.prepare('SELECT * FROM financial_credit_adjustments WHERE side=? AND source_type=? AND source_id=?').get(input.side, input.sourceType, input.sourceId);
  if (existing) return existing;
  const snap = openItemSnapshot(db, input.side, input.targetOpenItemId);
  if (!snap || snap.row.item_class !== 'SOURCE' || Number(snap.row.amount_cents) <= 0) throw new Error('Authoritative source open item not found');
  if ((input.side === 'AR' ? snap.row.customer_id : snap.row.supplier_id) !== input.partyId) throw new Error('Credit party does not match source open item');
  const applied = Math.min(input.amountCents, snap.openCents);
  const unapplied = input.amountCents - applied;
  const creditId = randomUUID();
  db.prepare(`INSERT INTO financial_credit_adjustments(id,side,adjustment_type,source_type,source_id,source_no,target_open_item_id,party_id,business_date,amount_cents,applied_cents,unapplied_cents,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(creditId, input.side, input.adjustmentType, input.sourceType, input.sourceId, input.sourceNo || '', input.targetOpenItemId, input.partyId, input.businessDate, input.amountCents, applied, unapplied, input.actorId, input.createdAt || now());
  if (unapplied > 0) db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,original_amount_cents,business_date,created_by,created_at)
    VALUES(?,?,'CREDIT',?,?,?,?,?,?,?,?)`).run(randomUUID(), input.side === 'AR' ? 'CUSTOMER' : 'SUPPLIER', input.partyId, input.sourceType, creditId, input.sourceNo || '', unapplied, input.businessDate, input.actorId, input.createdAt || now());
  refreshOpenItem(db, input.side, input.targetOpenItemId, input.createdAt || now());
  return db.prepare('SELECT * FROM financial_credit_adjustments WHERE id=?').get(creditId);
}

export function reverseCreditAdjustment(db, side, sourceType, sourceId, actorId, reversalDate, reason) {
  const credit = db.prepare('SELECT * FROM financial_credit_adjustments WHERE side=? AND source_type=? AND source_id=?').get(side, sourceType, sourceId);
  if (!credit) throw new Error('Credit adjustment not found');
  if (credit.status !== 'CONFIRMED') throw new Error('Credit adjustment already reversed');
  const balance = db.prepare("SELECT id FROM settlement_unapplied_balances WHERE balance_type='CREDIT' AND source_id=?").get(credit.id);
  if (balance) {
    const consumed = Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM balance_applications WHERE balance_id=? AND status='CONFIRMED'").get(balance.id).n)
      + Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM financial_refunds WHERE balance_id=? AND status='CONFIRMED'").get(balance.id).n);
    if (consumed > 0) throw new Error('Credit has dependent applications or refunds; reverse those first');
  }
  const nowText = now();
  db.prepare(`UPDATE financial_credit_adjustments SET status='REVERSED',reversed_cents=amount_cents,reversed_by=?,reversed_at=?,reversal_date=?,reversal_reason=? WHERE id=?`)
    .run(actorId, nowText, reversalDate, reason, credit.id);
  if (balance) db.prepare("UPDATE settlement_unapplied_balances SET status='REVERSED' WHERE id=?").run(balance.id);
  refreshOpenItem(db, side, credit.target_open_item_id, nowText);
  return credit;
}

export function checkSettlementInvariants(db) {
  const issues = [];
  for (const [side, table] of [['AR', 'account_receivables'], ['AP', 'account_payables']]) {
    for (const row of db.prepare(`SELECT * FROM ${table} WHERE item_class='SOURCE'`).all()) {
      const snap = openItemSnapshot(db, side, row.id);
      if (Number(row.paid_cents) !== snap.cashCents) issues.push({ side, id: row.id, code: 'PAID_CACHE_MISMATCH', expected: snap.cashCents, actual: Number(row.paid_cents) });
      if (Number(row.open_amount_cents) !== snap.openCents) issues.push({ side, id: row.id, code: 'OPEN_CACHE_MISMATCH', expected: snap.openCents, actual: Number(row.open_amount_cents) });
      if (row.status !== snap.status) issues.push({ side, id: row.id, code: 'STATUS_MISMATCH', expected: snap.status, actual: row.status });
    }
  }
  for (const balance of db.prepare('SELECT * FROM settlement_unapplied_balances').all()) {
    const remaining = unappliedBalanceSnapshot(db, balance.id)?.remainingCents;
    if (remaining < 0) issues.push({ side: balance.side, id: balance.id, code: 'NEGATIVE_UNAPPLIED_BALANCE', actual: remaining });
  }
  return issues;
}

export function unappliedBalanceSnapshot(db, balanceId) {
  const row = db.prepare('SELECT * FROM settlement_unapplied_balances WHERE id=?').get(balanceId);
  if (!row) return null;
  const applied = Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM balance_applications WHERE balance_id=? AND status='CONFIRMED'").get(balanceId).n);
  const refunded = Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM financial_refunds WHERE balance_id=? AND status='CONFIRMED'").get(balanceId).n);
  const reversed = row.balance_type === 'PREPAYMENT'
    ? Number(db.prepare("SELECT COALESCE(SUM(sri.amount_cents),0) n FROM settlement_reversal_items sri WHERE sri.component_type='UNAPPLIED' AND sri.original_component_id=?").get(balanceId).n)
    : Number(db.prepare('SELECT COALESCE(SUM(unapplied_cents),0) n FROM credit_reversal_components WHERE credit_id=?').get(row.source_id).n);
  return { row, appliedCents: applied, refundedCents: refunded, reversedCents: reversed,
    remainingCents: Number(row.original_amount_cents) - applied - refunded - reversed };
}

export function reconcileSettlementSubledgers(db) {
  const specs = [
    ['sales_deliveries', 'delivery_no', 'customer_id', 'delivery_date', 'SALES_DELIVERY', ensureReceivableSource],
    ['purchase_receipts', 'receipt_no', 'supplier_id', 'receipt_date', 'PURCHASE_RECEIPT', ensurePayableSource],
  ];
  for (const [table, noColumn, partyColumn, dateColumn, sourceType, ensure] of specs) {
    const rows = db.prepare(`SELECT id,${noColumn} sourceNo,${partyColumn} partyId,${dateColumn} businessDate,total_cents totalCents,creator_id creatorId,created_at createdAt FROM ${table} WHERE status='CONFIRMED'`).all();
    for (const row of rows) ensure(db, { ...row, sourceType, effectCents: row.totalCents });
  }
}
