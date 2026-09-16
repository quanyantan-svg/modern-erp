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
  db.prepare(`INSERT INTO ${table}(id,voucher_no,${partyColumn},source_type,source_id,amount_cents,paid_cents,write_off_cents,status,due_date,creator_id,created_at,source_no,business_date,adjustment_cents,updated_at)
    VALUES(?,?,?,?,?,?,0,0,'PENDING',?,?,?,?,?,?,?)`)
    .run(itemId, `${prefix}-${source.sourceNo}`, source.partyId, source.sourceType, source.id, positive,
      source.businessDate, source.creatorId, createdAt, source.sourceNo, source.businessDate, adjustment, createdAt);
  return itemId;
}

export function ensureReceivableSource(db, source) { return ensureSubledger(db, 'AR', source); }
export function ensurePayableSource(db, source) { return ensureSubledger(db, 'AP', source); }

export function reconcileSettlementSubledgers(db) {
  const specs = [
    ['sales_deliveries', 'delivery_no', 'customer_id', 'delivery_date', 'SALES_DELIVERY', 1, ensureReceivableSource],
    ['return_orders', 'return_no', 'customer_id', 'return_date', 'SALES_RETURN', -1, ensureReceivableSource, "AND source_type='SALES'"],
    ['purchase_receipts', 'receipt_no', 'supplier_id', 'receipt_date', 'PURCHASE_RECEIPT', 1, ensurePayableSource],
    ['purchase_returns', 'return_no', 'supplier_id', 'return_date', 'PURCHASE_RETURN', -1, ensurePayableSource],
  ];
  for (const [table, noColumn, partyColumn, dateColumn, sourceType, sign, ensure, extraWhere = ''] of specs) {
    const rows = db.prepare(`SELECT id,${noColumn} sourceNo,${partyColumn} partyId,${dateColumn} businessDate,total_cents totalCents,creator_id creatorId,created_at createdAt FROM ${table} WHERE status='CONFIRMED' ${extraWhere}`).all();
    for (const row of rows) ensure(db, { ...row, sourceType, effectCents: sign * row.totalCents });
  }
}
