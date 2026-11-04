const common = Object.freeze({
  concurrency: 2,
  distinctIdempotencyKeys: true,
  exactSuccessCount: 1,
  exactFailureCount: 1,
  exactRejectAuditCount: 1,
  winnerIdempotencyCount: 1,
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
    quantities: Object.freeze({ capacity: 10, requestQty: 6, outstanding: 6, ledger: 0 }),
    snapshotTables: ['receipt_notices', 'receipt_notice_items', 'receipt_notice_item_sources', 'schedule_consumption_effects', 'purchase_receipts', 'inventory_transactions', 'inventory_valuation_movements', 'supplier_bills', 'accounting_vouchers', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-02', {
    handler: 'confirmPurchaseReceiptCore', method: 'POST', path: '/api/purchase-receipts/:id',
    successStatus: 200, failureStatus: 409, failureCode: 'PURCHASE_RECEIPT_ALREADY_CONFIRMED',
    invariant: 'one DRAFT receipt is confirmed once; PO cumulative quantity and every downstream effect are unique',
    quantities: Object.freeze({ receiptQty: 10 }),
    snapshotTables: ['purchase_receipts', 'purchase_receipt_items', 'purchase_order_items', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'supplier_bills', 'accounting_vouchers', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-03', {
    handler: 'confirmOutsourcingReceipt', method: 'POST', path: '/api/procurement/outsourcing/receipts/:id/confirm',
    successStatus: 200, failureStatus: 409, failureCode: 'OUTSOURCING_RECEIPT_ALREADY_EFFECTED',
    invariant: 'one pending-inspection receipt qty=4 is effected once; finished inventory, backflush and cost are unique',
    quantities: Object.freeze({ finishedQty: 4 }),
    snapshotTables: ['outsourcing_receipts', 'outsourcing_receipt_items', 'outsourcing_material_list', 'outsourcing_wip_identity_balances', 'outsourcing_wip_identity_effects', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'outsourcing_cost_evidences', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-04', {
    handler: 'executeOutsourcingMaterialAction:ISSUE', method: 'POST', path: '/api/procurement/outsourcing/orders/:id/issues',
    successStatus: 201, failureStatus: 409, failureCode: 'OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT',
    invariant: 'same source identity starts at 10; requests=6+6; source=4; WIP=6; one paired MOVE',
    quantities: Object.freeze({ source: 10, requestQty: 6, sourceAfter: 4, wipAfter: 6 }),
    snapshotTables: ['outsourcing_issues', 'outsourcing_material_list', 'outsourcing_wip_identity_balances', 'outsourcing_wip_identity_effects', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-05', {
    handler: 'executeOutsourcingMaterialAction:SUPPLEMENT', method: 'POST', path: '/api/procurement/outsourcing/orders/:id/supplements',
    successStatus: 201, failureStatus: 409, failureCode: 'OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT',
    invariant: 'same source identity starts at 10; requests=6+6; source=4; WIP=6; one supplement',
    quantities: Object.freeze({ source: 10, requestQty: 6, sourceAfter: 4, wipAfter: 6 }),
    snapshotTables: ['outsourcing_supplements', 'outsourcing_material_list', 'outsourcing_wip_identity_balances', 'outsourcing_wip_identity_effects', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-06', {
    handler: 'executeOutsourcingMaterialAction:RETURN', method: 'POST', path: '/api/procurement/outsourcing/orders/:id/returns',
    successStatus: 201, failureStatus: 409, failureCode: 'OUTSOURCING_WIP_INSUFFICIENT',
    invariant: 'same WIP identity starts at 10; requests=6+6; WIP=4; source returned=6; one return',
    quantities: Object.freeze({ wip: 10, requestQty: 6, wipAfter: 4, sourceReturned: 6 }),
    snapshotTables: ['outsourcing_returns', 'outsourcing_material_list', 'outsourcing_wip_identity_balances', 'outsourcing_wip_identity_effects', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-07', {
    handler: 'confirmOutsourcingReceipt:distinct-receipts', method: 'POST', path: '/api/procurement/outsourcing/receipts/:id/confirm',
    successStatus: 200, failureStatus: 409, failureCode: 'OUTSOURCING_WIP_INSUFFICIENT',
    invariant: 'two legal IQC-PASS receipts qty=4 compete for WIP=6; one EFFECTED, one PENDING_INSPECTION; WIP=2; finished=4',
    quantities: Object.freeze({ orderQty: 10, perUnit: 1, wip: 6, receiptQty: 4, backflush: 4, wipAfter: 2, finished: 4 }),
    snapshotTables: ['outsourcing_receipts', 'outsourcing_receipt_items', 'outsourcing_material_list', 'outsourcing_wip_identity_balances', 'outsourcing_wip_identity_effects', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'outsourcing_cost_evidences', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-08', {
    handler: 'confirmOutsourcingReceipt-vs-return', method: 'POST', path: '/api/procurement/outsourcing/{receipts/:id/confirm|orders/:id/returns}',
    successStatus: Object.freeze([200, 201]), failureStatus: 409, failureCode: 'OUTSOURCING_WIP_INSUFFICIENT',
    invariant: 'receipt backflush and return compete for the same LOT/SERIAL WIP identity=1; balance never negative; winner-only effects',
    quantities: Object.freeze({ identityWip: 1, backflush: 1, return: 1 }),
    snapshotTables: ['outsourcing_receipts', 'outsourcing_returns', 'outsourcing_material_list', 'outsourcing_wip_identity_balances', 'outsourcing_wip_identity_effects', 'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_valuation_movements', 'outsourcing_cost_evidences', 'idempotency_records', 'audit_logs'],
  }),
  scenario('CR-09', {
    handler: 'createOutsourcingProcessingPurchaseOrder', method: 'POST', path: '/api/procurement/outsourcing/orders/:id/processing-fee-purchase-orders',
    successStatus: 201, failureStatus: 409, failureCode: 'OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS',
    invariant: 'one RELEASED outsourcing order has exactly one lifetime processing-fee PO and one stable item',
    quantities: Object.freeze({ lifetimeProcessingPo: 1, stableItem: 1 }),
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

function canonical(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

/**
 * 全字段负向控制会故意注入的腐败形态，逐一返回独立的可读断言，证明 oracle
 * 不是「只看数量」或「忽略重要字段」的假通过。
 */
export function assertG07Result(definition, outcome) {
  if (!definition || !outcome || !Array.isArray(outcome.responses)) throw new Error('G07_RESULT_INPUT_INVALID');
  const result = assertG07RaceOutcome(definition, outcome.responses);
  if (outcome.rejectAuditCount !== definition.exactRejectAuditCount) {
    throw new Error(`${definition.id}_REJECT_AUDIT_MISMATCH: expected ${definition.exactRejectAuditCount}, got ${outcome.rejectAuditCount}`);
  }
  if (outcome.winnerIdempotencyCount !== definition.winnerIdempotencyCount) {
    throw new Error(`${definition.id}_IDEMPOTENCY_MISMATCH: expected ${definition.winnerIdempotencyCount}, got ${outcome.winnerIdempotencyCount}`);
  }
  if (outcome.loserSideEffectCount !== definition.loserBusinessSideEffects) {
    throw new Error(`${definition.id}_LOSER_SIDE_EFFECT: expected ${definition.loserBusinessSideEffects}, got ${outcome.loserSideEffectCount}`);
  }
  if (outcome.snapshot !== undefined && outcome.expectedSnapshot !== undefined) {
    const actual = canonical(outcome.snapshot);
    const expected = canonical(outcome.expectedSnapshot);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${definition.id}_FULL_SNAPSHOT_MISMATCH`);
    }
  }
  return result;
}

/** 金额必须为安全整数分（bigint 或 number 安全整数），拒绝浮点或越界金额。 */
export function assertSafeIntegerCents(value, label = 'money') {
  if (value === null || value === undefined) return;
  if (typeof value === 'bigint') return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`UNSAFE_MONEY:${label}:${value}`);
    return;
  }
  if (Array.isArray(value)) { for (const item of value) assertSafeIntegerCents(item, label); return; }
  if (typeof value === 'object') { for (const [key, item] of Object.entries(value)) assertSafeIntegerCents(item, `${label}.${key}`); return; }
  throw new Error(`UNSAFE_MONEY_TYPE:${label}:${typeof value}`);
}

/** 加工费 PO 的商业更新必须保持 purchase_order_items.id 原位稳定。 */
export function assertProcessingPoItemStable({ beforeItemIds, afterItemIds, label = 'processing-fee PO item' }) {
  if (!Array.isArray(beforeItemIds) || !Array.isArray(afterItemIds)) throw new Error(`${label}_ITEM_ID_INPUT_INVALID`);
  const stable = beforeItemIds.every((id) => afterItemIds.includes(id));
  if (!stable) throw new Error(`${label}_ITEM_ID_DRIFT`);
  return Object.freeze({ beforeItemIds: [...beforeItemIds], afterItemIds: [...afterItemIds] });
}

/** 通用 PO 类型/来源注入与 PO Change（ADD/MODIFY/CANCEL）必须对加工费 PO 拒绝。 */
export function assertProcessingPoRejected({ responses, label = 'processing-fee PO' }) {
  if (!Array.isArray(responses) || responses.length === 0) throw new Error(`${label}_REJECTION_INPUT_INVALID`);
  for (const response of responses) {
    if (response.status !== 409) throw new Error(`${label}_REJECTION_MISSING:${JSON.stringify(response)}`);
  }
  return Object.freeze([...responses]);
}

/** UAT-14 正向 VMI 收货 oracle：创建 201、确认 200。 */
export function assertUat14VmiReceiptOracle({ createStatus, confirmStatus }) {
  if (createStatus !== 201 || confirmStatus !== 200) {
    throw new Error(`UAT14_VMI_ORACLE_MISMATCH:create=${createStatus},confirm=${confirmStatus}`);
  }
  return Object.freeze({ createStatus, confirmStatus });
}

/** G03 证据分层：正向业务事实必须走 HTTP L1，技术性前置单独枚举为 L2，不得冒充 L1。 */
export function assertG03EvidenceLayering({ l1FactCount, l2FactCount, l2Enumerated }) {
  if (!Number.isSafeInteger(l1FactCount) || l1FactCount < 1) throw new Error('G03_L1_FACTS_REQUIRED');
  if (!Array.isArray(l2Enumerated)) throw new Error('G03_L2_ENUMERATION_REQUIRED');
  if (l2FactCount !== l2Enumerated.length) throw new Error('G03_L2_FACTS_NOT_ENUMERATED');
  return Object.freeze({ l1FactCount, l2FactCount, l2Enumerated: Object.freeze([...l2Enumerated]) });
}

export function assertCompleteG07Contract(scenarios = M1_CORE_G07_SCENARIOS) {
  const expected = Array.from({ length: 9 }, (_, index) => `CR-${String(index + 1).padStart(2, '0')}`);
  const actual = scenarios.map((item) => item.id);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('G07_CR_SET_INCOMPLETE');
  for (const item of scenarios) {
    if (item.fixtureChannel !== 'PRODUCTION_HTTP' || item.snapshotMode !== 'FULL_ORDERED_ROWS') throw new Error(`${item.id}_EVIDENCE_LEVEL_INVALID`);
    if (!item.path.startsWith('/api/') || !item.handler || !item.failureCode || item.snapshotTables.length === 0) throw new Error(`${item.id}_ORACLE_INCOMPLETE`);
    if (!item.quantities || typeof item.quantities !== 'object' || Object.keys(item.quantities).length === 0) throw new Error(`${item.id}_QUANTITIES_MISSING`);
    if (item.winnerIdempotencyCount !== 1 || item.exactRejectAuditCount !== 1 || item.loserBusinessSideEffects !== 0) throw new Error(`${item.id}_CARDINALITY_INVALID`);
  }
  return true;
}
