const common = Object.freeze({
  concurrency: 2,
  distinctIdempotencyKeys: true,
  exactSuccessCount: 1,
  exactFailureCount: 1,
  exactRejectAuditCount: 1,
  loserBusinessSideEffects: 0,
  fixtureChannel: 'PRODUCTION_HTTP',
  synchronization: 'MYSQL_TRANSACTION_GATE_AND_LOCK_WAIT',
  snapshotMode: 'FULL_ORDERED_ROWS',
});

function scenario(id, definition) {
  return Object.freeze({ id, ...common, ...definition, snapshotTables: Object.freeze(definition.snapshotTables) });
}

// Active Design §13.1.3. These records are executable oracle metadata, not a
// substitute for the real HTTP requests. The MySQL suite consumes them to
// assert exact status/code pairs and to select every table included in the
// before/after/loser-side-effect snapshots.
export const M1_CORE_G07_SCENARIOS = Object.freeze([
  scenario('CR-01', {
    handler: 'createReceiptNotice', method: 'POST', path: '/api/receipt-notices',
    successStatus: 201, failureStatus: 409, failureCode: 'RECEIPT_NOTICE_CAPACITY_EXCEEDED',
    invariant: 'capacity=10; requests=6+6; outstanding=6; ledger=0; exactly one notice',
    snapshotTables: ['receipt_notices', 'receipt_notice_items', 'receipt_notice_item_sources', 'schedule_consumption_effects', 'purchase_receipts', 'inventory_transactions', 'inventory_valuation_movements', 'supplier_bills', 'accounting_vouchers', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-02', {
    handler: 'confirmPurchaseReceiptCore', method: 'POST', path: '/api/purchase-receipts/:id',
    successStatus: 200, failureStatus: 409, failureCode: 'PURCHASE_RECEIPT_ALREADY_CONFIRMED',
    invariant: 'one DRAFT receipt is confirmed once; PO cumulative quantity and every downstream effect are unique',
    snapshotTables: ['purchase_receipts', 'purchase_receipt_items', 'purchase_order_items', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'supplier_bills', 'accounting_vouchers', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-03', {
    handler: 'confirmOutsourcingReceipt', method: 'POST', path: '/api/procurement/outsourcing/receipts/:id/confirm',
    successStatus: 200, failureStatus: 409, failureCode: 'OUTSOURCING_RECEIPT_ALREADY_EFFECTED',
    invariant: 'one pending-inspection receipt qty=4 is effected once; finished inventory, backflush and cost are unique',
    snapshotTables: ['outsourcing_receipts', 'outsourcing_receipt_items', 'outsourcing_material_list', 'outsourcing_wip_identity_balances', 'outsourcing_wip_identity_effects', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'outsourcing_cost_evidences', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-04', {
    handler: 'executeOutsourcingMaterialAction:ISSUE', method: 'POST', path: '/api/procurement/outsourcing/orders/:id/issues',
    successStatus: 201, failureStatus: 409, failureCode: 'OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT',
    invariant: 'same source identity starts at 10; requests=6+6; source=4; WIP=6; one paired MOVE',
    snapshotTables: ['outsourcing_issues', 'outsourcing_material_list', 'outsourcing_wip_identity_balances', 'outsourcing_wip_identity_effects', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-05', {
    handler: 'executeOutsourcingMaterialAction:SUPPLEMENT', method: 'POST', path: '/api/procurement/outsourcing/orders/:id/supplements',
    successStatus: 201, failureStatus: 409, failureCode: 'OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT',
    invariant: 'same source identity starts at 10; requests=6+6; source=4; WIP=6; one supplement',
    snapshotTables: ['outsourcing_supplements', 'outsourcing_material_list', 'outsourcing_wip_identity_balances', 'outsourcing_wip_identity_effects', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-06', {
    handler: 'executeOutsourcingMaterialAction:RETURN', method: 'POST', path: '/api/procurement/outsourcing/orders/:id/returns',
    successStatus: 201, failureStatus: 409, failureCode: 'OUTSOURCING_WIP_INSUFFICIENT',
    invariant: 'same WIP identity starts at 10; requests=6+6; WIP=4; source returned=6; one return',
    snapshotTables: ['outsourcing_returns', 'outsourcing_material_list', 'outsourcing_wip_identity_balances', 'outsourcing_wip_identity_effects', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-07', {
    handler: 'confirmOutsourcingReceipt:distinct-receipts', method: 'POST', path: '/api/procurement/outsourcing/receipts/:id/confirm',
    successStatus: 200, failureStatus: 409, failureCode: 'OUTSOURCING_WIP_INSUFFICIENT',
    invariant: 'two legal IQC-PASS receipts qty=4 compete for WIP=6; one EFFECTED, one PENDING_INSPECTION; WIP=2; finished=4',
    snapshotTables: ['outsourcing_receipts', 'outsourcing_receipt_items', 'outsourcing_material_list', 'outsourcing_wip_identity_balances', 'outsourcing_wip_identity_effects', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'outsourcing_cost_evidences', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-08', {
    handler: 'confirmOutsourcingReceipt-vs-return', method: 'POST', path: '/api/procurement/outsourcing/{receipts/:id/confirm|orders/:id/returns}',
    successStatus: Object.freeze([200, 201]), failureStatus: 409, failureCode: 'OUTSOURCING_WIP_INSUFFICIENT',
    invariant: 'receipt backflush and return compete for the same LOT/SERIAL WIP identity=1; balance never negative; winner-only effects',
    snapshotTables: ['outsourcing_receipts', 'outsourcing_returns', 'outsourcing_material_list', 'outsourcing_wip_identity_balances', 'outsourcing_wip_identity_effects', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'outsourcing_cost_evidences', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-09', {
    handler: 'createOutsourcingProcessingPurchaseOrder', method: 'POST', path: '/api/procurement/outsourcing/orders/:id/processing-fee-purchase-orders',
    successStatus: 201, failureStatus: 409, failureCode: 'OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS',
    invariant: 'one RELEASED outsourcing order has exactly one lifetime processing-fee PO and one stable item',
    snapshotTables: ['purchase_orders', 'purchase_order_items', 'idempotency_records', 'audit_logs'],
  }),
]);

export const G07_SUPPLEMENTAL_ORACLES = Object.freeze([
  Object.freeze({ id: 'PO-ITEM-STABLE', behavior: 'commercial PUT keeps processing-fee purchase_order_items.id unchanged' }),
  Object.freeze({ id: 'PO-INJECTION', behavior: 'generic POST rejects type/source injection and generic PUT rejects provenance mutation' }),
  Object.freeze({ id: 'PO-CHANGE', behavior: 'ADD/MODIFY/CANCEL create, approve and apply reject processing-fee PO' }),
  Object.freeze({ id: 'UAT-14', behavior: 'VMI receipt create=201 and confirm=200 under the approved receipt oracle' }),
  Object.freeze({ id: 'G03-L1-L2', behavior: 'positive business facts use HTTP L1; unavoidable setup facts are enumerated L2 and never treated as handler evidence' }),
  Object.freeze({ id: 'SAFE-INTEGER', behavior: 'all money request/DB snapshot values are safe integer cents' }),
  Object.freeze({ id: 'SCHEMA-PARITY', behavior: 'real information_schema columns, indexes, FK and CHECK members equal the canonical SQLite snapshot' }),
]);

export function assertG07RaceOutcome(definition, responses) {
  if (!definition || !Array.isArray(responses) || responses.length !== definition.concurrency) {
    throw new Error('G07_ORACLE_INPUT_INVALID');
  }
  const successes = responses.filter((response) => {
    const statuses = Array.isArray(definition.successStatus) ? definition.successStatus : [definition.successStatus];
    return statuses.includes(response.status);
  });
  const failures = responses.filter((response) => response.status === definition.failureStatus
    && response.data?.code === definition.failureCode);
  if (successes.length !== definition.exactSuccessCount || failures.length !== definition.exactFailureCount) {
    throw new Error(`${definition.id}_OUTCOME_MISMATCH:${JSON.stringify(responses)}`);
  }
  return Object.freeze({ winner: successes[0], loser: failures[0] });
}

export function assertCompleteG07Contract(scenarios = M1_CORE_G07_SCENARIOS) {
  const expected = Array.from({ length: 9 }, (_, index) => `CR-${String(index + 1).padStart(2, '0')}`);
  const actual = scenarios.map((item) => item.id);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('G07_CR_SET_INCOMPLETE');
  for (const item of scenarios) {
    if (item.fixtureChannel !== 'PRODUCTION_HTTP' || item.snapshotMode !== 'FULL_ORDERED_ROWS') throw new Error(`${item.id}_EVIDENCE_LEVEL_INVALID`);
    if (!item.path.startsWith('/api/') || !item.handler || !item.failureCode || item.snapshotTables.length === 0) throw new Error(`${item.id}_ORACLE_INCOMPLETE`);
  }
  return true;
}
