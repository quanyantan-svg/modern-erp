// R-02 — one immutable declaration of which period axes protect each dated
// production mutation. Callers select a named action; they never assemble or
// weaken the axes themselves.
//
// Contract: docs/requirements/platform.md §36.15.4 (minimum action→axis map)
// and docs/design/platform.md §32.15.1. The table below is the *minimum*
// mapping plus the historical coverage of the gates it replaces, so that the
// migration never silently loosens a period boundary: every action that used
// to be blocked by the inventory month-end gate still declares INVENTORY.
// A narrower mapping is a Requirement-level decision, not an implementation
// detail.

export const PERIOD_AXES = Object.freeze({
  INVENTORY: 'INVENTORY',
  FINANCE_AR: 'FINANCE_AR',
  FINANCE_AP: 'FINANCE_AP',
  FINANCE_TREASURY: 'FINANCE_TREASURY',
  LEGAL_ACCOUNTING: 'LEGAL_ACCOUNTING',
  OPERATING: 'OPERATING',
});

const A = PERIOD_AXES;

export const PERIOD_ACTIONS = Object.freeze({
  // ---- Inventory & Warehouse (docs/requirements/inventory-warehouse.md §32.12)
  INVENTORY_MUTATION: Object.freeze([A.INVENTORY, A.LEGAL_ACCOUNTING]),
  INVENTORY_VALUATION: Object.freeze([A.INVENTORY, A.LEGAL_ACCOUNTING]),
  // Dated postings that were gated by the legacy inventory + legal gate but do
  // not move stock themselves (service fulfilment, prepayment admission). The
  // inventory axis is kept so the migration does not loosen an existing
  // boundary.
  INVENTORY_GATED_POSTING: Object.freeze([A.INVENTORY, A.LEGAL_ACCOUNTING]),

  // ---- Accounting & Analytics (docs/requirements/accounting-analytics.md §35.11)
  LEGAL_VOUCHER: Object.freeze([A.LEGAL_ACCOUNTING]),
  MANUAL_VOUCHER: Object.freeze([A.LEGAL_ACCOUNTING]),
  // The only registered exception to the inventory axis (§36.15.4, last row).
  GL_PERIOD_END: Object.freeze([A.LEGAL_ACCOUNTING]),

  // ---- Finance Operations (docs/requirements/finance-operations.md §33.51)
  FINANCE_AR_MUTATION: Object.freeze([A.FINANCE_AR, A.LEGAL_ACCOUNTING]),
  FINANCE_AP_MUTATION: Object.freeze([A.FINANCE_AP, A.LEGAL_ACCOUNTING]),
  FINANCE_TREASURY_MUTATION: Object.freeze([A.FINANCE_TREASURY, A.LEGAL_ACCOUNTING]),
  FINANCE_COLLECTION: Object.freeze([A.FINANCE_AR, A.FINANCE_TREASURY, A.LEGAL_ACCOUNTING]),
  FINANCE_PAYMENT: Object.freeze([A.FINANCE_AP, A.FINANCE_TREASURY, A.LEGAL_ACCOUNTING]),
  // Invoice / bill paths also carried the inventory month-end gate before the
  // migration; the union keeps that boundary intact.
  FINANCE_AR_INVOICE: Object.freeze([A.FINANCE_AR, A.INVENTORY, A.LEGAL_ACCOUNTING]),
  FINANCE_AP_BILL: Object.freeze([A.FINANCE_AP, A.INVENTORY, A.LEGAL_ACCOUNTING]),

  // ---- Management Accounting (operating books)
  OPERATING_COLLECT: Object.freeze([A.OPERATING]),
  OPERATING_ALLOCATE: Object.freeze([A.OPERATING]),
  OPERATING_INTERNAL_SETTLEMENT: Object.freeze([A.OPERATING]),
});

export function axesForPeriodAction(actionCode) {
  const axes = PERIOD_ACTIONS[actionCode];
  return axes ? [...axes] : null;
}

// The Finance close axis of a mutation, expressed as the registered action
// code for that axis. Used by callers whose affected axis is only known at
// runtime (customer vs supplier side); the axis is never chosen ad hoc.
//
// Families:
//   MUTATION  — a Finance fact changes without moving money
//   INVOICE   — invoice / bill paths that also carry the inventory month-end gate
//   SETTLEMENT — settlement documents: the Finance side plus the treasury side
const FINANCE_ACTION_FAMILIES = Object.freeze({
  MUTATION: Object.freeze({
    AR: 'FINANCE_AR_MUTATION',
    AP: 'FINANCE_AP_MUTATION',
    TREASURY: 'FINANCE_TREASURY_MUTATION',
  }),
  INVOICE: Object.freeze({
    AR: 'FINANCE_AR_INVOICE',
    AP: 'FINANCE_AP_BILL',
  }),
  SETTLEMENT: Object.freeze({
    AR: 'FINANCE_COLLECTION',
    AP: 'FINANCE_PAYMENT',
  }),
});

export function financeActionCode(closeType, family = 'MUTATION') {
  const map = FINANCE_ACTION_FAMILIES[family];
  return (map && map[closeType]) || '';
}
