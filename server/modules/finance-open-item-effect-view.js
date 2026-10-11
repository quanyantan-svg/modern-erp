// V22 — Finance Operations Wave A.
//
// finance_open_item_effects (DERIVED SQL VIEW).
//
// Non-authoritative / non-persisted / rebuild-free.
// Projection of exactly 4 frozen effect categories:
//   SETTLEMENT_ALLOCATION / UNAPPLIED_APPLICATION / CREDIT_ADJUSTMENT / WRITE_OFF
//
// Excluded from the view (intentional):
//   financial_refunds / financial_refund_reversals
//   commercial_credit_notes
//   sales_discounts / purchase_discounts
//   sales_returns / purchase_returns
//   settlement_reversal_items.UNAPPLIED
//
// SQLite-compatible portable SQL.

const VIEW_DDL = `
CREATE VIEW IF NOT EXISTS finance_open_item_effects AS
  -- ============================================================
  -- A. SETTLEMENT_ALLOCATION
  -- ============================================================
  SELECT
    'AR' AS side,
    pci.receivable_id AS open_item_id,
    'SETTLEMENT_ALLOCATION' AS effect_type,
    'payment_collection_items' AS source_table,
    pci.collection_id AS source_id,
    pci.id AS source_effect_id,
    pci.amount_cents AS gross_amount_cents,
    COALESCE((
      SELECT SUM(sri.amount_cents)
      FROM settlement_reversal_items sri
      WHERE sri.component_type = 'ALLOCATION'
        AND sri.original_component_id = pci.id
    ), 0) AS reversed_amount_cents,
    pci.amount_cents - COALESCE((
      SELECT SUM(sri.amount_cents)
      FROM settlement_reversal_items sri
      WHERE sri.component_type = 'ALLOCATION'
        AND sri.original_component_id = pci.id
    ), 0) AS effective_amount_cents,
    (SELECT pc.collection_date FROM payment_collections pc WHERE pc.id = pci.collection_id) AS business_date
  FROM payment_collection_items pci
  WHERE pci.reversed_cents = 0
  UNION ALL
  SELECT
    'AP' AS side,
    pdi.payable_id AS open_item_id,
    'SETTLEMENT_ALLOCATION' AS effect_type,
    'payment_disbursement_items' AS source_table,
    pdi.disbursement_id AS source_id,
    pdi.id AS source_effect_id,
    pdi.amount_cents AS gross_amount_cents,
    COALESCE((
      SELECT SUM(sri.amount_cents)
      FROM settlement_reversal_items sri
      WHERE sri.component_type = 'ALLOCATION'
        AND sri.original_component_id = pdi.id
    ), 0) AS reversed_amount_cents,
    pdi.amount_cents - COALESCE((
      SELECT SUM(sri.amount_cents)
      FROM settlement_reversal_items sri
      WHERE sri.component_type = 'ALLOCATION'
        AND sri.original_component_id = pdi.id
    ), 0) AS effective_amount_cents,
    (SELECT pd.disbursement_date FROM payment_disbursements pd WHERE pd.id = pdi.disbursement_id) AS business_date
  FROM payment_disbursement_items pdi
  WHERE pdi.reversed_cents = 0

  UNION ALL

  -- ============================================================
  -- B. UNAPPLIED_APPLICATION
  -- ============================================================
  SELECT
    ba.side AS side,
    ba.target_open_item_id AS open_item_id,
    'UNAPPLIED_APPLICATION' AS effect_type,
    'balance_applications' AS source_table,
    ba.balance_id AS source_id,
    ba.id AS source_effect_id,
    ba.amount_cents AS gross_amount_cents,
    0 AS reversed_amount_cents,
    ba.amount_cents AS effective_amount_cents,
    ba.business_date AS business_date
  FROM balance_applications ba
  WHERE ba.status = 'CONFIRMED'

  UNION ALL

  -- ============================================================
  -- C. CREDIT_ADJUSTMENT
  --    financial_credit_adjustments uses target_open_item_id + adjustment_type
  --    (RETURN / DISCOUNT / OTHER); commercial credit (COMMERCIAL_CREDIT) flows
  --    through financial_credit_adjustments (Wave C wiring); COMMERCIAL_CREDIT
  --    is also represented by commercial_credit_notes which is excluded by
  --    design (see Exclusion list above) to avoid double-counting.
  -- ============================================================
  SELECT
    fca.side AS side,
    fca.target_open_item_id AS open_item_id,
    'CREDIT_ADJUSTMENT' AS effect_type,
    'financial_credit_adjustments' AS source_table,
    fca.source_id AS source_id,
    fca.id AS source_effect_id,
    fca.amount_cents AS gross_amount_cents,
    COALESCE((
      SELECT SUM(fca2.amount_cents)
      FROM financial_credit_adjustments fca2
      WHERE fca2.status = 'REVERSED'
        AND fca2.source_id = fca.id
    ), 0) AS reversed_amount_cents,
    fca.amount_cents - COALESCE((
      SELECT SUM(fca2.amount_cents)
      FROM financial_credit_adjustments fca2
      WHERE fca2.status = 'REVERSED'
        AND fca2.source_id = fca.id
    ), 0) AS effective_amount_cents,
    fca.business_date AS business_date
  FROM financial_credit_adjustments fca
  WHERE fca.status = 'CONFIRMED' AND fca.applied_cents > 0

  UNION ALL

  -- ============================================================
  -- D. WRITE_OFF
  -- ============================================================
  SELECT
    fwo.side AS side,
    fwo.open_item_id AS open_item_id,
    'WRITE_OFF' AS effect_type,
    'financial_write_offs' AS source_table,
    fwo.id AS source_id,
    fwo.id AS source_effect_id,
    fwo.amount_cents AS gross_amount_cents,
    COALESCE((
      SELECT SUM(fwor.amount_cents)
      FROM financial_write_off_reversals fwor
      WHERE fwor.write_off_id = fwo.id
    ), 0) AS reversed_amount_cents,
    fwo.amount_cents - COALESCE((
      SELECT SUM(fwor.amount_cents)
      FROM financial_write_off_reversals fwor
      WHERE fwor.write_off_id = fwo.id
    ), 0) AS effective_amount_cents,
    fwo.business_date AS business_date
  FROM financial_write_offs fwo
  WHERE fwo.status = 'CONFIRMED'
`;

export function ensureFinanceOpenItemEffectsView(db) {
  try {
    // Drop legacy materialized cache if any (defensive; prior closures must
    // never have created a physical table — guard only).
    try { db.exec('DROP TABLE IF EXISTS finance_open_item_effects'); } catch (_ignored) { /* ignore */ }
    db.exec(VIEW_DDL);
  } catch (error) {
    // Surface so caller can fail closed at boot.
    throw new Error('ensureFinanceOpenItemEffectsView failed: ' + error.message);
  }
}

// Read-only projection accessor used by reports / refreshOpenAmount consumers.
// refreshOpenAmount reads this directly; do NOT introduce a separate
// physical projection table.
export function projectFinanceEffects(db, side, openItemId) {
  return db.prepare(
    `SELECT * FROM finance_open_item_effects WHERE side=? AND open_item_id=?`
  ).all(side, openItemId);
}
