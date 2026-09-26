// R4 — Purchase source chain cardinality correction.
//
// R4-R2B superseded the R4-R2 §20.3 / §20.9 "no schema change" conclusion.
// The pre-existing partial unique index `idx_purchase_instruction_items_requisition`
// on `purchase_instruction_items(purchase_requisition_id) WHERE NOT NULL` enforces
// the wrong inverse cardinality (one PR may be back-linked by at most one PUI
// item), blocking the approved multi-line source-chain model where a single
// Purchase Requisition may legitimately carry multiple source-line identities
// back to distinct Purchase Instruction items.
//
// This migration is idempotent and fail-closed on data-integrity violations.
//
// Steps (order-sensitive):
//   1. Duplicate precheck on `purchase_requisition_items.purchase_instruction_item_id`.
//      If any non-null value appears in more than one PR item row, the migration
//      stops with an explicit error listing the offending ids. No rows are
//      deleted, NULLed, merged, or rewritten.
//   2. DROP the existing partial unique index
//      `idx_purchase_instruction_items_requisition` (the wrong-direction one).
//   3. Recreate a non-unique lookup index
//      `idx_purchase_instruction_items_requisition_lookup` on the same column
//      to preserve PUI -> PR back-link query performance.
//   4. Add the correct forward partial unique constraint
//      `idx_purchase_requisition_items_pui` on
//      `purchase_requisition_items(purchase_instruction_item_id) WHERE NOT NULL`,
//      enforcing "one PUI item -> at most one PR item" without restricting
//      the inverse cardinality.
//
// Backend compatibility:
//   - SQLite accepts `CREATE [UNIQUE] INDEX ... WHERE col IS NOT NULL` natively.
//   - MySQL initial schema bootstrap uses the established generated-column +
//     digest strategy in `server/database/mysql-schema.js#generatedPartialIndex`
//     for the equivalent partial unique indexes; this migration follows the
//     same SQL idiom already used by existing migrations
//     (e.g. `server/migrations/v13-phase6b-traceability-quality.js:112`,
//     `server/migrations/planning-documents-schema.js:84-87,179-183,215-218`).

export function migrateR4PurchaseSourceCardinality(db) {
  // Step 1 — fail-closed duplicate precheck.
  // Use `db.prepare(...).all(...)` to surface any pre-existing duplicates.
  // The application-level friendly check in `createPurchaseRequisition` also
  // rejects re-use, but the DB-level UNIQUE installed in step 4 is the actual
  // concurrency safety net.
  const duplicates = db.prepare(`
    SELECT purchase_instruction_item_id, COUNT(*) AS cnt
      FROM purchase_requisition_items
     WHERE purchase_instruction_item_id IS NOT NULL
     GROUP BY purchase_instruction_item_id
    HAVING COUNT(*) > 1
  `).all();
  if (duplicates.length > 0) {
    const summary = duplicates
      .map((row) => `${row.purchase_instruction_item_id}(${row.cnt})`)
      .join(', ');
    throw new Error(
      `R4 source-cardinality migration aborted: purchase_requisition_items has duplicate non-null purchase_instruction_item_id values: ${summary}. ` +
      'Manual review and remediation required before this migration can proceed. ' +
      'No rows were modified.',
    );
  }

  // Step 2 — drop the wrong-direction partial unique index.
  db.exec('DROP INDEX IF EXISTS idx_purchase_instruction_items_requisition');

  // Step 3 — recreate a non-unique lookup index for PUI -> PR back-link.
  // Idempotent: re-running after a previous partial failure will leave the
  // schema in a consistent state.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_purchase_instruction_items_requisition_lookup
      ON purchase_instruction_items(purchase_requisition_id);
  `);

  // Step 4 — add the correct forward partial unique constraint.
  // Same SQLite partial-index idiom used elsewhere in the migration set.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_requisition_items_pui
      ON purchase_requisition_items(purchase_instruction_item_id)
      WHERE purchase_instruction_item_id IS NOT NULL;
  `);
}