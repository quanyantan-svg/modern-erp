// V22 — Finance Operations Wave A.
//
// FO02 — Recognition Mode Policy.
//
// Single canonical recognition policy resolver.
// Per solution.md §28.2.2:
//   resolveRecognitionPolicy(side, sourceType, sourceId, businessDate)
//
// Existing LEGACY_DIRECT billing-mode is mapped onto canonical
// recognition models by seed rows installed by
// server/migrations/v22-finance-wave-a-foundation.js.

const VALID_MODES = new Set([
  'DIRECT_BUSINESS_OPEN_ITEM',
  'INVOICE_DRIVEN_OPEN_ITEM',
  'PROVISIONAL_TO_FINANCIAL',
]);

export function resolveRecognitionPolicy(db, side, sourceType, sourceId, businessDate) {
  if (!side || !sourceType) {
    throw new Error('invalid recognition policy query');
  }
  // 1. source-level active override
  const sourceOverride = db.prepare(
    `SELECT recognition_mode, effective_date
       FROM finance_recognition_policy
      WHERE side=? AND source_type=? AND source_id=? AND active=1
      ORDER BY effective_date DESC, id ASC
      LIMIT 1`
  ).get(side, sourceType, sourceId);
  if (sourceOverride) {
    if (sourceOverride.effective_date && businessDate && businessDate < sourceOverride.effective_date) {
      // effective in future → fall through to site-wide
    } else {
      return { mode: sourceOverride.recognition_mode, scope: 'SOURCE' };
    }
  }
  // 2. site-wide active default
  const siteWide = db.prepare(
    `SELECT recognition_mode
       FROM finance_recognition_policy
      WHERE side=? AND source_type=? AND source_id IS NULL AND active=1
      ORDER BY effective_date DESC, id ASC
      LIMIT 1`
  ).get(side, sourceType);
  if (siteWide) return { mode: siteWide.recognition_mode, scope: 'SITE' };

  // 3. last-resort safe default = DIRECT_BUSINESS_OPEN_ITEM
  return { mode: 'DIRECT_BUSINESS_OPEN_ITEM', scope: 'FALLBACK' };
}

export const RECOGNITION_MODES = Object.freeze({
  DIRECT: 'DIRECT_BUSINESS_OPEN_ITEM',
  INVOICE_DRIVEN: 'INVOICE_DRIVEN_OPEN_ITEM',
  PROVISIONAL: 'PROVISIONAL_TO_FINANCIAL',
});
