import { assertG07AuthoritativeEvidence, assertG07RaceOutcome } from '../test-support/m1-core-g07-contract.js';

const rows = (snapshot, table) => Array.isArray(snapshot?.[table]) ? snapshot[table] : [];
const number = (value) => Number(value || 0);
const byId = (snapshot, table, id) => rows(snapshot, table).find((row) => row.id === id);
const ids = (snapshot, table) => new Set(rows(snapshot, table).map((row) => row.id));
const added = (before, after, table) => { const known = ids(before, table); return rows(after, table).filter((row) => !known.has(row.id)); };
const sum = (list, field, predicate = () => true) => list.filter(predicate).reduce((total, row) => total + number(row[field]), 0);
const pathId = (request, marker) => String(request.path).match(new RegExp(`${marker}/([^/]+)`))?.[1];
const keyOf = (request) => request.headers?.['idempotency-key'] || request.body?.idempotencyKey;
const identityOf = (setup) => setup.lot?.id ? `LOT:${setup.lot.id}` : 'NONE';

function inventoryQuantity(snapshot, productId, warehouseId) {
  return sum(rows(snapshot, 'inventory'), 'quantity', (row) => row.product_id === productId && row.warehouse_id === warehouseId);
}

function wipQuantity(snapshot, materialListId, identity) {
  return sum(rows(snapshot, 'outsourcing_wip_identity_balances'), 'available_quantity',
    (row) => row.material_list_id === materialListId && row.identity_key === identity);
}

function leg(kind, opening, closing, sourceId, identity) {
  return Object.freeze({ kind, opening, change: closing - opening, closing, sourceId, identity });
}

function auditEvidence(definition, before, after, loserRequest) {
  const newRows = added(before, after, 'audit_logs').filter((row) => row.action === 'REJECT');
  const entityIds = new Set([pathId(loserRequest, 'receipts'), pathId(loserRequest, 'orders'), loserRequest.body?.materialListId].filter(Boolean));
  const exact = newRows.filter((row) => String(row.detail || '').includes(definition.failureCode)
    && row.user_id && (definition.id === 'CR-01' || entityIds.has(row.entity_id)));
  return Object.freeze({ count: newRows.length, exactRequestReject: exact.length === 1 });
}

function idempotencyEvidence(before, after, winnerRequest, loserRequest) {
  const fresh = added(before, after, 'idempotency_records');
  const winnerKey = keyOf(winnerRequest); const loserKey = keyOf(loserRequest);
  return Object.freeze({
    winnerSucceeded: fresh.filter((row) => row.idempotency_key === winnerKey && row.status === 'SUCCEEDED').length,
    loserAbsent: fresh.every((row) => row.idempotency_key !== loserKey),
  });
}

function scenarioEvidence(definition, before, after, fixture, winnerIndex) {
  const setup = fixture.setup; const winnerRequest = fixture.requests[winnerIndex]; const loserRequest = fixture.requests[1 - winnerIndex];
  const materialListId = setup.orderGet?.materials?.[0]?.id; const identity = identityOf(setup);
  const sourceId = setup.order?.id || setup.po?.id || setup.convert?.receipts?.[0]?.id;
  const effects = { documentDelta: 0, quantityDelta: 0, identityDelta: 1, amountDeltaCents: 0, winnerBusinessRowDelta: 1, loserBusinessRowDelta: 0 };
  const legs = [];
  let sourcesMatched = true;

  if (definition.id === 'CR-01') {
    const notices = added(before, after, 'receipt_notices'); const items = added(before, after, 'receipt_notice_items'); const allocations = added(before, after, 'receipt_notice_item_sources');
    Object.assign(effects, { documentDelta: notices.length, quantityDelta: sum(items, 'quantity'), identityDelta: allocations.length });
    sourcesMatched = notices.length === 1 && items.length === 1 && allocations.length === 1
      && allocations[0].purchase_order_item_id === setup.poGet.order.items[0].id && allocations[0].delivery_schedule_id === setup.schedule.id;
    legs.push(leg('quantity', 0, sum(allocations, 'allocated_quantity'), setup.poGet.order.items[0].id, setup.schedule.id));
  } else if (definition.id === 'CR-02') {
    const receiptId = setup.convert.receipts[0].id; const item = setup.poGet.order.items[0]; const beforeInventory = inventoryQuantity(before, setup.product.id, 'warehouse-001'); const afterInventory = inventoryQuantity(after, setup.product.id, 'warehouse-001');
    Object.assign(effects, { quantityDelta: afterInventory - beforeInventory, amountDeltaCents: sum(added(before, after, 'inventory_valuation_movements'), 'value_delta_cents', (row) => row.product_id === setup.product.id && number(row.value_delta_cents) > 0) });
    sourcesMatched = byId(after, 'purchase_receipts', receiptId)?.status === 'CONFIRMED' && byId(after, 'purchase_order_items', item.id)?.id === item.id;
    legs.push(leg('inventory', beforeInventory, afterInventory, receiptId, 'NONE'));
  } else if (['CR-03', 'CR-07'].includes(definition.id)) {
    const receiptIds = definition.id === 'CR-03' ? [setup.receipt.id] : [setup.receiptA.id, setup.receiptB.id];
    const affected = receiptIds.filter((id) => byId(after, 'outsourcing_receipts', id)?.business_status === 'EFFECTED');
    const pending = receiptIds.filter((id) => byId(after, 'outsourcing_receipts', id)?.business_status === 'PENDING_INSPECTION');
    const costs = added(before, after, 'outsourcing_cost_evidences').filter((row) => affected.includes(row.outsourcing_receipt_id));
    const opening = wipQuantity(before, materialListId, identity); const closing = wipQuantity(after, materialListId, identity);
    Object.assign(effects, { quantityDelta: opening - closing, amountDeltaCents: sum(costs, 'material_consumed_value_cents') });
    sourcesMatched = affected.length === 1 && pending.length === (definition.id === 'CR-07' ? 1 : 0) && costs.length === 1;
    legs.push(leg('wip', opening, closing, affected[0], identity));
  } else if (['CR-04', 'CR-05', 'CR-06'].includes(definition.id)) {
    const table = definition.id === 'CR-04' ? 'outsourcing_issues' : definition.id === 'CR-05' ? 'outsourcing_supplements' : 'outsourcing_returns';
    const documents = added(before, after, table); const openingWip = wipQuantity(before, materialListId, identity); const closingWip = wipQuantity(after, materialListId, identity);
    const openingInventory = inventoryQuantity(before, setup.material.id, 'warehouse-001'); const closingInventory = inventoryQuantity(after, setup.material.id, 'warehouse-001');
    const valuation = added(before, after, 'inventory_valuation_movements').filter((row) => row.product_id === setup.material.id);
    Object.assign(effects, { documentDelta: documents.length, quantityDelta: sum(documents, 'quantity'), amountDeltaCents: Math.abs(sum(valuation, 'value_delta_cents', (row) => definition.id === 'CR-06' ? number(row.value_delta_cents) > 0 : number(row.value_delta_cents) < 0)) });
    sourcesMatched = documents.length === 1 && documents[0].order_id === setup.order.id && documents[0].material_list_id === materialListId;
    legs.push(leg('inventory', openingInventory, closingInventory, documents[0]?.id, identity));
    legs.push(leg('wip', openingWip, closingWip, documents[0]?.id, identity));
  } else if (definition.id === 'CR-08') {
    const newReturns = added(before, after, 'outsourcing_returns'); const receipt = byId(after, 'outsourcing_receipts', setup.receipt.id); const receiptWon = receipt?.business_status === 'EFFECTED';
    const opening = wipQuantity(before, materialListId, identity); const closing = wipQuantity(after, materialListId, identity);
    const costs = added(before, after, 'outsourcing_cost_evidences'); const valuation = added(before, after, 'inventory_valuation_movements').filter((row) => row.product_id === setup.material.id && number(row.value_delta_cents) > 0);
    Object.assign(effects, { documentDelta: receiptWon ? costs.length : newReturns.length, quantityDelta: opening - closing, amountDeltaCents: receiptWon ? sum(costs, 'material_consumed_value_cents') : sum(valuation, 'value_delta_cents') });
    sourcesMatched = (receiptWon && costs.length === 1 && newReturns.length === 0) || (!receiptWon && costs.length === 0 && newReturns.length === 1 && newReturns[0].order_id === setup.order.id);
    legs.push(leg('wip', opening, closing, receiptWon ? setup.receipt.id : newReturns[0]?.id, identity));
  } else if (definition.id === 'CR-09') {
    const orders = added(before, after, 'purchase_orders').filter((row) => row.source_outsourcing_order_id === setup.order.id); const orderIds = new Set(orders.map((row) => row.id)); const items = added(before, after, 'purchase_order_items').filter((row) => orderIds.has(row.order_id));
    Object.assign(effects, { documentDelta: orders.length, quantityDelta: sum(items, 'quantity'), identityDelta: items.length, amountDeltaCents: sum(orders, 'total_cents') });
    sourcesMatched = orders.length === 1 && items.length === 1 && orders[0].business_type === 'OUTSOURCE_PROCESSING';
    legs.push(leg('quantity', 0, sum(items, 'quantity'), setup.order.id, items[0]?.id));
  }
  return { before, after, effects, legs, sources: { allMatched: sourcesMatched }, winnerRequest, loserRequest };
}

export function assertRealG07Oracle(definition, { before, after, fixture, responses }) {
  const race = assertG07RaceOutcome(definition, responses);
  const winnerIndex = responses.indexOf(race.winner);
  const evidence = scenarioEvidence(definition, before, after, fixture, winnerIndex);
  evidence.audit = auditEvidence(definition, before, after, evidence.loserRequest);
  evidence.idempotency = idempotencyEvidence(before, after, evidence.winnerRequest, evidence.loserRequest);
  return assertG07AuthoritativeEvidence(definition, evidence);
}
