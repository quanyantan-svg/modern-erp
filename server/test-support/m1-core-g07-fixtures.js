import { createHash } from 'node:crypto';
import { M1_CORE_G07_SCENARIOS } from './m1-core-g07-contract.js';

// Fixed, version-traceable G07 fixture definitions. Every positive business
// object is built through production HTTP along a fixed route/method chain;
// intermediate IDs that a create response does not return are read back
// through a production GET route (never invented, never seeded by SQL). The
// whole set is SHA-pinned to an INDEPENDENT frozen hex below, so a drift
// between independent review and run is detected before ACK-4 is consumed.
//
// Nothing here is a secret, a password, a Bearer token or a SQL statement.
// `subjects` reference seeded identity usernames; tokens are obtained by the
// runner through the real /api/auth/login flow, never invented here.

export const M1_CORE_G07_FIXTURE_VERSION = 1;

// Semantic subjects. `login` is the seeded username the runner authenticates
// via /api/auth/login to obtain a real token. `note` records the RBAC fact.
export const M1_CORE_G07_SUBJECTS = Object.freeze({
  admin: { login: 'admin', note: 'master data + SoD-gap steps (RECEIPT_NOTICE_MANAGE / PO_CHANGE_MANAGE / PROCUREMENT_CONFIG_MANAGE / ENGINEERING_BOM_MANAGE have no non-admin holder)' },
  creator: { login: 'sales', note: 'standard PO create/submit (PURCHASE_ORDERS_CREATE/SUBMIT) and processing-PO submit' },
  approver: { login: 'reviewer', note: 'independent PO approve (PURCHASE_ORDERS_APPROVE)' },
  warehouse: { login: 'warehouse', note: 'purchase receipt confirm + IQC + inventory (PURCHASE_RECEIPTS_MANAGE / IQC_MANAGE)' },
  outsourcing: { login: 'outsourcing', note: 'outsourcing order/material/processing-PO (OUTSOURCING_MANAGE + OUTSOURCING_MATERIAL_EXECUTE)' },
  receiving: { login: 'outsourcingreceiving', note: 'outsourcing receipt create/confirm (OUTSOURCING_RECEIVING_MANAGE)' },
});

// Execution-readiness governance finding. These are evidence labels, not new
// grants: admin-only setup remains a declared SoD gap and may not be reported
// as separation-of-duties proof.
export const M1_CORE_G07_GOVERNANCE_REVIEW = Object.freeze({
  approvedPositiveSubjects: Object.freeze({
    OUTSOURCING_MANAGE: 'outsourcing', OUTSOURCING_MATERIAL_EXECUTE: 'outsourcing',
    OUTSOURCING_RECEIVING_MANAGE: 'receiving', IQC_MANAGE: 'warehouse',
  }),
  adminOnlyAuthorizationGaps: Object.freeze([
    'RECEIPT_NOTICE_MANAGE', 'PO_CHANGE_MANAGE', 'PROCUREMENT_CONFIG_MANAGE', 'ENGINEERING_BOM_MANAGE',
  ]),
  sourceInventorySeed: Object.freeze({ physicalBusinessFact: 'PRODUCTION_HTTP', valuationPrerequisite: 'CANONICAL_VALUATION_L2', disposableOnly: true }),
});

// Technical L2 prerequisites: facts the production HTTP surface cannot (or
// must not) construct. They are enumerated so they can never be mistaken for
// L1 handler evidence; each is established by a separately-authorised,
// non-business path before the HTTP setup runs.
export const M1_CORE_G07_TECHNICAL_L2_PREREQUISITES = Object.freeze([
  Object.freeze({
    id: 'DISPOSABLE_TARGET', kind: 'TARGET_IDENTITY',
    note: 'precise disposable MySQL target identity/grants are established by scripts/gates/setup-mysql-local-gate.ps1, never by business HTTP',
  }),
  Object.freeze({
    id: 'TRANSACTION_GATE_TABLE', kind: 'SYNCHRONIZATION',
    note: 'mysql_transaction_gates is a technical synchronisation primitive created by BOOTSTRAP_CURRENT_SCHEMA, not a business object',
  }),
  Object.freeze({
    id: 'RBAC_TEST_IDENTITIES', kind: 'ROLE_SEED',
    note: 'approved M1-P-03 identities (creator/approver/warehouse/outsourcing/receiving) are seeded by the role grant path, not by business HTTP',
  }),
  Object.freeze({
    id: 'M15_IDENTITY_KEY_SCHEMA', kind: 'SCHEMA_MIGRATION',
    note: 'tracked_inventory_movements.identity_key is an M-15 technical column under a separate Migration authorisation, never a business HTTP fact',
  }),
  Object.freeze({
    id: 'SOURCE_INVENTORY_SEED', kind: 'CANONICAL_VALUATION_L2',
    note: 'physical quantity and LOT/SERIAL identity are created by production inventory HTTP; only the matching valuation pool is admitted through canonical receiveValue with separately verified evidence',
  }),
]);

const ALL_TECHNICAL_L2 = M1_CORE_G07_TECHNICAL_L2_PREREQUISITES.map((item) => item.id);

function step(id, subject, method, route, { headers = {}, body } = {}) {
  return Object.freeze({ id, subject, method, route, headers: Object.freeze(headers), ...(body === undefined ? {} : { body: Object.freeze(body) }) });
}

function race(subject, app, method, route, { headers = {}, body } = {}) {
  return Object.freeze({ subject, app, method, route, headers: Object.freeze(headers), ...(body === undefined ? {} : { body: Object.freeze(body) }) });
}

function technical(id, prerequisite, input) {
  return Object.freeze({ id, method: 'TECHNICAL_L2', prerequisite, input: Object.freeze(input) });
}

// Routes and bodies use `$ref`/`{ref}` dot-paths into the setup context, e.g.
// `setup.po.id`. A numeric path segment indexes an array, e.g.
// `setup.poGet.order.items.0.id`. Every setup step's response body is captured
// under `setup.<stepId>`.
function fixedScenario(id, { subjects, sharedResource, setup, raceRequests, technicalL2 }) {
  const definition = M1_CORE_G07_SCENARIOS.find((item) => item.id === id);
  if (!definition) throw new Error(`M1_G07_FIXTURE_DEFINITION_MISSING:${id}`);
  const l2 = Object.freeze([...technicalL2, 'DISPOSABLE_TARGET', 'TRANSACTION_GATE_TABLE']);
  return Object.freeze({
    id,
    handler: definition.handler,
    method: definition.method,
    route: definition.path,
    successStatus: definition.successStatus,
    failureStatus: definition.failureStatus,
    failureCode: definition.failureCode,
    quantities: definition.quantities,
    subjects: Object.freeze([...subjects]),
    sharedResource,
    setup: Object.freeze(setup),
    raceRequests: Object.freeze(raceRequests),
    technicalL2: Object.freeze([...new Set(l2)]),
  });
}

// Shared step fragments so each chain is one contiguous, reviewable DAG.
const NEW_STANDARD_PO = (productRef, supplierRef, itemQty) => [
  step('price', 'admin', 'POST', '/api/procurement/price-list', {
    body: {
      supplierId: { $ref: supplierRef }, productId: { $ref: productRef }, sourceType: 'PURCHASE',
      pricingUomCode: 'EA', unitPriceCents: 100, effectiveFrom: { $businessDate: 0 },
    },
  }),
  step('po', 'creator', 'POST', '/api/purchase-orders', {
    body: {
      supplierId: { $ref: supplierRef },
      items: [{ productId: { $ref: productRef }, quantity: itemQty, unitPriceCents: 100 }],
      orderDate: { $businessDate: 0 }, expectedDeliveryDate: { $businessDate: 30 },
      supplierContactName: 'C', supplierContactPhone: '13800000000', supplierAddress: 'A', paymentTerms: '30 days',
    },
  }),
  step('submit', 'creator', 'POST', '/api/purchase-orders/{setup.po.id}/submit'),
  step('approve', 'approver', 'POST', '/api/purchase-orders/{setup.po.id}/approve'),
  step('poGet', 'admin', 'GET', '/api/purchase-orders/{setup.po.id}'),
  step('schedule', 'admin', 'POST', '/api/purchase-orders/{setup.po.id}/delivery-schedules', {
    body: { orderItemId: { $ref: 'setup.poGet.order.items.0.id' }, plannedQuantity: itemQty, plannedDate: { $businessDate: 30 } },
  }),
];

export const M1_CORE_G07_FIXED_SCENARIOS = Object.freeze([
  fixedScenario('CR-01', {
    subjects: ['admin', 'creator', 'approver'],
    sharedResource: 'one STANDARD_PURCHASE PO item with delivery-schedule capacity 10 (used 0); two notice creates race 6 vs 6',
    setup: [
      step('product', 'admin', 'POST', '/api/products', { body: { code: 'cr01-material', name: 'CR01 material', unit: 'EA', baseUomCode: 'EA', priceCents: 100 } }),
      step('supplier', 'creator', 'POST', '/api/suppliers', { body: { code: 'cr01-supplier', name: 'CR01 supplier' } }),
      step('supplierProfile', 'admin', 'PATCH', '/api/suppliers/{setup.supplier.id}/profile', { body: { procurementEnabled: true, qualificationStatus: 'QUALIFIED', qualificationValidFrom: { $businessDate: -30 }, qualificationValidTo: { $businessDate: 365 } } }),
      ...NEW_STANDARD_PO('setup.product.id', 'setup.supplier.id', 10),
    ],
    raceRequests: [
      race('admin', 'A', 'POST', '/api/receipt-notices', {
        body: {
          businessType: 'STANDARD_PURCHASE', purchaseOrderId: { $ref: 'setup.po.id' }, warehouseId: 'warehouse-001',
          items: [{ productId: { $ref: 'setup.product.id' }, quantity: 6, sourceAllocations: [{ purchaseOrderItemId: { $ref: 'setup.poGet.order.items.0.id' }, deliveryScheduleId: { $ref: 'setup.schedule.id' }, allocatedQuantity: 6 }] }],
          idempotencyKey: 'cr01-a',
        },
      }),
      race('admin', 'B', 'POST', '/api/receipt-notices', {
        body: {
          businessType: 'STANDARD_PURCHASE', purchaseOrderId: { $ref: 'setup.po.id' }, warehouseId: 'warehouse-001',
          items: [{ productId: { $ref: 'setup.product.id' }, quantity: 6, sourceAllocations: [{ purchaseOrderItemId: { $ref: 'setup.poGet.order.items.0.id' }, deliveryScheduleId: { $ref: 'setup.schedule.id' }, allocatedQuantity: 6 }] }],
          idempotencyKey: 'cr01-b',
        },
      }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-02', {
    subjects: ['admin', 'creator', 'approver', 'warehouse'],
    sharedResource: 'one DRAFT purchase receipt qty=10 (built through notice conversion); two confirms race on it',
    setup: [
      step('product', 'admin', 'POST', '/api/products', { body: { code: 'cr02-material', name: 'CR02 material', unit: 'EA', baseUomCode: 'EA', priceCents: 100 } }),
      step('supplier', 'creator', 'POST', '/api/suppliers', { body: { code: 'cr02-supplier', name: 'CR02 supplier' } }),
      step('supplierProfile', 'admin', 'PATCH', '/api/suppliers/{setup.supplier.id}/profile', { body: { procurementEnabled: true, qualificationStatus: 'QUALIFIED', qualificationValidFrom: { $businessDate: -30 }, qualificationValidTo: { $businessDate: 365 } } }),
      ...NEW_STANDARD_PO('setup.product.id', 'setup.supplier.id', 10),
      step('notice', 'admin', 'POST', '/api/receipt-notices', {
        body: {
          businessType: 'STANDARD_PURCHASE', purchaseOrderId: { $ref: 'setup.po.id' }, warehouseId: 'warehouse-001',
          items: [{ productId: { $ref: 'setup.product.id' }, quantity: 10, sourceAllocations: [{ purchaseOrderItemId: { $ref: 'setup.poGet.order.items.0.id' }, deliveryScheduleId: { $ref: 'setup.schedule.id' }, allocatedQuantity: 10 }] }],
          idempotencyKey: 'cr02-notice',
        },
      }),
      step('noticeConfirm', 'admin', 'POST', '/api/receipt-notices/{setup.notice.id}/confirm'),
      step('noticeGet', 'admin', 'GET', '/api/receipt-notices/{setup.notice.id}'),
      step('convert', 'admin', 'POST', '/api/receipt-notices/{setup.notice.id}/convert', {
        headers: { 'idempotency-key': 'cr02-convert' },
        body: { items: [{ sourceId: { $ref: 'setup.noticeGet.receiptNotice.items.0.sources.0.id' }, quantity: 10 }] },
      }),
      step('iqc', 'warehouse', 'POST', '/api/iqc', {
        body: { purchase_receipt_id: { $ref: 'setup.convert.receipts.0.id' } },
      }),
      step('iqcComplete', 'warehouse', 'POST', '/api/iqc/{setup.iqc.id}/complete', {
        body: { result: 'PASS', inspection_quantity: 10, passed_quantity: 10, failed_quantity: 0 },
      }),
    ],
    raceRequests: [
      race('warehouse', 'A', 'POST', '/api/purchase-receipts/{setup.convert.receipts.0.id}', { headers: { 'idempotency-key': 'cr02-confirm-a' }, body: { action: 'confirm' } }),
      race('warehouse', 'B', 'POST', '/api/purchase-receipts/{setup.convert.receipts.0.id}', { headers: { 'idempotency-key': 'cr02-confirm-b' }, body: { action: 'confirm' } }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-03', {
    subjects: ['admin', 'creator', 'approver', 'outsourcing', 'receiving', 'warehouse'],
    sharedResource: 'one pending-inspection outsourcing receipt qty=4 with sufficient WIP; two confirms race on it',
    setup: [
      step('finished', 'admin', 'POST', '/api/products', { body: { code: 'cr03-finished', name: 'CR03 finished', unit: 'EA', baseUomCode: 'EA', priceCents: 100, inventoryClassification: 'FINISHED_GOOD', trackingPolicy: 'NONE' } }),
      step('material', 'admin', 'POST', '/api/products', { body: { code: 'cr03-material', name: 'CR03 material', unit: 'EA', baseUomCode: 'EA', priceCents: 100, standardManufacturingCostCents: 100, inventoryClassification: 'RAW_MATERIAL', trackingPolicy: 'NONE' } }),
      step('qualify', 'admin', 'PATCH', '/api/suppliers/supplier-001/profile', { body: { outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED', qualificationValidFrom: { $businessDate: -30 }, qualificationValidTo: { $businessDate: 365 }, supplierWipWarehouseId: 'warehouse-002' } }),
      step('bom', 'admin', 'POST', '/api/engineering/boms', { body: { productId: { $ref: 'setup.finished.id' }, version: 'CR03', purpose: 'OUTSOURCE', approvalStatus: 'APPROVED', effectiveFrom: { $businessDate: -1 }, items: [{ productId: { $ref: 'setup.material.id' }, quantity: 1 }] } }),
      step('stock', 'warehouse', 'POST', '/api/inventory-adjustments', { body: { warehouseId: 'warehouse-001', adjustmentDate: { $businessDate: 0 }, reason: 'G07 CR03 source inventory', items: [{ productId: { $ref: 'setup.material.id' }, quantityDelta: 10 }] } }),
      step('stockConfirm', 'warehouse', 'POST', '/api/inventory-adjustments/{setup.stock.id}/confirm'),
      step('order', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders', { body: { supplierId: 'supplier-001', productId: { $ref: 'setup.finished.id' }, orderQuantity: 10, unit: 'EA', businessDate: { $businessDate: 0 }, bomId: { $ref: 'setup.bom.id' } } }),
      step('snapshot', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/material-list', { body: { items: [{ productId: { $ref: 'setup.material.id' }, sourceWarehouseId: 'warehouse-001' }] } }),
      step('plan', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'CONFIRM_PLAN' } }),
      step('release', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'RELEASE' } }),
      step('orderGet', 'outsourcing', 'GET', '/api/procurement/outsourcing/orders/{setup.order.id}'),
      step('issue', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/issues', { body: { materialListId: { $ref: 'setup.orderGet.materials.0.id' }, quantity: 10, idempotencyKey: 'cr03-issue' } }),
      step('po', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/processing-fee-purchase-orders', { headers: { 'idempotency-key': 'cr03-po' }, body: { unitPriceCents: 500, orderDate: { $businessDate: 0 }, expectedDeliveryDate: { $businessDate: 30 }, paymentTerms: '30 days', supplierContactName: 'C', supplierContactPhone: '13800000000', supplierAddress: 'A' } }),
      step('poSubmit', 'creator', 'POST', '/api/purchase-orders/{setup.po.id}/submit'),
      step('poApprove', 'approver', 'POST', '/api/purchase-orders/{setup.po.id}/approve'),
      step('poGet', 'admin', 'GET', '/api/purchase-orders/{setup.po.id}'),
      step('notice', 'admin', 'POST', '/api/receipt-notices', { body: { businessType: 'OUTSOURCE', outsourcingOrderId: { $ref: 'setup.order.id' }, processingPoId: { $ref: 'setup.po.id' }, warehouseId: 'warehouse-001', noticeDate: { $businessDate: 0 }, items: [{ productId: { $ref: 'setup.finished.id' }, quantity: 4 }], idempotencyKey: 'cr03-notice' } }),
      step('noticeConfirm', 'admin', 'POST', '/api/receipt-notices/{setup.notice.id}/confirm'),
      step('noticeGet', 'admin', 'GET', '/api/receipt-notices/{setup.notice.id}'),
      step('receipt', 'receiving', 'POST', '/api/procurement/outsourcing/receipts', {
        headers: { 'idempotency-key': 'cr03-receipt' },
        body: {
          orderId: { $ref: 'setup.order.id' }, quantity: 4, receivedDate: { $businessDate: 0 }, businessDate: { $businessDate: 0 }, processingFeeCents: 0,
          processingPoId: { $ref: 'setup.po.id' }, sourceNoticeId: { $ref: 'setup.notice.id' }, warehouseId: 'warehouse-001',
          items: [{ productId: { $ref: 'setup.finished.id' }, quantity: 4, unitCode: 'EA', unitPriceCents: 0, processingPoItemId: { $ref: 'setup.poGet.order.items.0.id' }, sourceNoticeItemId: { $ref: 'setup.noticeGet.receiptNotice.items.0.id' } }],
        },
      }),
      step('iqc', 'warehouse', 'POST', '/api/iqc', { body: { outsourcing_receipt_id: { $ref: 'setup.receipt.id' } } }),
      step('iqcComplete', 'warehouse', 'POST', '/api/iqc/{setup.iqc.id}/complete', { body: { result: 'PASS', inspection_quantity: 4, passed_quantity: 4, failed_quantity: 0 } }),
    ],
    raceRequests: [
      race('receiving', 'A', 'POST', '/api/procurement/outsourcing/receipts/{setup.receipt.id}/confirm', { headers: { 'idempotency-key': 'cr03-confirm-a' }, body: { materialIdentities: [{ materialListId: { $ref: 'setup.orderGet.materials.0.id' } }] } }),
      race('receiving', 'B', 'POST', '/api/procurement/outsourcing/receipts/{setup.receipt.id}/confirm', { headers: { 'idempotency-key': 'cr03-confirm-b' }, body: { materialIdentities: [{ materialListId: { $ref: 'setup.orderGet.materials.0.id' } }] } }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-04', {
    subjects: ['admin', 'warehouse', 'outsourcing'],
    sharedResource: 'one material row/source identity starting at 10; two issues race 6 vs 6',
    setup: [
      step('finished', 'admin', 'POST', '/api/products', { body: { code: 'cr04-finished', name: 'CR04 finished', unit: 'EA', baseUomCode: 'EA', priceCents: 100, inventoryClassification: 'FINISHED_GOOD', trackingPolicy: 'NONE' } }),
      step('material', 'admin', 'POST', '/api/products', { body: { code: 'cr04-material', name: 'CR04 material', unit: 'EA', baseUomCode: 'EA', priceCents: 100, standardManufacturingCostCents: 100, inventoryClassification: 'RAW_MATERIAL', trackingPolicy: 'NONE' } }),
      step('qualify', 'admin', 'PATCH', '/api/suppliers/supplier-001/profile', { body: { outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED', qualificationValidFrom: { $businessDate: -30 }, qualificationValidTo: { $businessDate: 365 }, supplierWipWarehouseId: 'warehouse-002' } }),
      step('bom', 'admin', 'POST', '/api/engineering/boms', { body: { productId: { $ref: 'setup.finished.id' }, version: 'CR04', purpose: 'OUTSOURCE', approvalStatus: 'APPROVED', effectiveFrom: { $businessDate: -1 }, items: [{ productId: { $ref: 'setup.material.id' }, quantity: 1 }] } }),
      step('stock', 'warehouse', 'POST', '/api/inventory-adjustments', { body: { warehouseId: 'warehouse-001', adjustmentDate: { $businessDate: 0 }, reason: 'G07 CR04 source inventory', items: [{ productId: { $ref: 'setup.material.id' }, quantityDelta: 10 }] } }),
      step('stockConfirm', 'warehouse', 'POST', '/api/inventory-adjustments/{setup.stock.id}/confirm'),
      step('order', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders', { body: { supplierId: 'supplier-001', productId: { $ref: 'setup.finished.id' }, orderQuantity: 10, unit: 'EA', businessDate: { $businessDate: 0 }, bomId: { $ref: 'setup.bom.id' } } }),
      step('snapshot', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/material-list', { body: { items: [{ productId: { $ref: 'setup.material.id' }, sourceWarehouseId: 'warehouse-001' }] } }),
      step('plan', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'CONFIRM_PLAN' } }),
      step('release', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'RELEASE' } }),
      step('orderGet', 'outsourcing', 'GET', '/api/procurement/outsourcing/orders/{setup.order.id}'),
    ],
    raceRequests: [
      race('outsourcing', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/issues', { body: { materialListId: { $ref: 'setup.orderGet.materials.0.id' }, quantity: 6, idempotencyKey: 'cr04-issue-a' } }),
      race('outsourcing', 'B', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/issues', { body: { materialListId: { $ref: 'setup.orderGet.materials.0.id' }, quantity: 6, idempotencyKey: 'cr04-issue-b' } }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-05', {
    subjects: ['admin', 'warehouse', 'outsourcing'],
    sharedResource: 'one material row/source identity starting at 10; two supplements race 6 vs 6',
    setup: [
      step('finished', 'admin', 'POST', '/api/products', { body: { code: 'cr05-finished', name: 'CR05 finished', unit: 'EA', baseUomCode: 'EA', priceCents: 100, inventoryClassification: 'FINISHED_GOOD', trackingPolicy: 'NONE' } }),
      step('material', 'admin', 'POST', '/api/products', { body: { code: 'cr05-material', name: 'CR05 material', unit: 'EA', baseUomCode: 'EA', priceCents: 100, standardManufacturingCostCents: 100, inventoryClassification: 'RAW_MATERIAL', trackingPolicy: 'NONE' } }),
      step('qualify', 'admin', 'PATCH', '/api/suppliers/supplier-001/profile', { body: { outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED', qualificationValidFrom: { $businessDate: -30 }, qualificationValidTo: { $businessDate: 365 }, supplierWipWarehouseId: 'warehouse-002' } }),
      step('bom', 'admin', 'POST', '/api/engineering/boms', { body: { productId: { $ref: 'setup.finished.id' }, version: 'CR05', purpose: 'OUTSOURCE', approvalStatus: 'APPROVED', effectiveFrom: { $businessDate: -1 }, items: [{ productId: { $ref: 'setup.material.id' }, quantity: 1 }] } }),
      step('stock', 'warehouse', 'POST', '/api/inventory-adjustments', { body: { warehouseId: 'warehouse-001', adjustmentDate: { $businessDate: 0 }, reason: 'G07 CR05 source inventory', items: [{ productId: { $ref: 'setup.material.id' }, quantityDelta: 10 }] } }),
      step('stockConfirm', 'warehouse', 'POST', '/api/inventory-adjustments/{setup.stock.id}/confirm'),
      step('order', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders', { body: { supplierId: 'supplier-001', productId: { $ref: 'setup.finished.id' }, orderQuantity: 10, unit: 'EA', businessDate: { $businessDate: 0 }, bomId: { $ref: 'setup.bom.id' } } }),
      step('snapshot', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/material-list', { body: { items: [{ productId: { $ref: 'setup.material.id' }, sourceWarehouseId: 'warehouse-001' }] } }),
      step('plan', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'CONFIRM_PLAN' } }),
      step('release', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'RELEASE' } }),
      step('orderGet', 'outsourcing', 'GET', '/api/procurement/outsourcing/orders/{setup.order.id}'),
    ],
    raceRequests: [
      race('outsourcing', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/supplements', { body: { materialListId: { $ref: 'setup.orderGet.materials.0.id' }, quantity: 6, idempotencyKey: 'cr05-supp-a' } }),
      race('outsourcing', 'B', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/supplements', { body: { materialListId: { $ref: 'setup.orderGet.materials.0.id' }, quantity: 6, idempotencyKey: 'cr05-supp-b' } }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-06', {
    subjects: ['admin', 'warehouse', 'outsourcing'],
    sharedResource: 'one material row/WIP identity starting at 10; two returns race 6 vs 6',
    setup: [
      step('finished', 'admin', 'POST', '/api/products', { body: { code: 'cr06-finished', name: 'CR06 finished', unit: 'EA', baseUomCode: 'EA', priceCents: 100, inventoryClassification: 'FINISHED_GOOD', trackingPolicy: 'NONE' } }),
      step('material', 'admin', 'POST', '/api/products', { body: { code: 'cr06-material', name: 'CR06 material', unit: 'EA', baseUomCode: 'EA', priceCents: 100, standardManufacturingCostCents: 100, inventoryClassification: 'RAW_MATERIAL', trackingPolicy: 'NONE' } }),
      step('qualify', 'admin', 'PATCH', '/api/suppliers/supplier-001/profile', { body: { outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED', qualificationValidFrom: { $businessDate: -30 }, qualificationValidTo: { $businessDate: 365 }, supplierWipWarehouseId: 'warehouse-002' } }),
      step('bom', 'admin', 'POST', '/api/engineering/boms', { body: { productId: { $ref: 'setup.finished.id' }, version: 'CR06', purpose: 'OUTSOURCE', approvalStatus: 'APPROVED', effectiveFrom: { $businessDate: -1 }, items: [{ productId: { $ref: 'setup.material.id' }, quantity: 1 }] } }),
      step('stock', 'warehouse', 'POST', '/api/inventory-adjustments', { body: { warehouseId: 'warehouse-001', adjustmentDate: { $businessDate: 0 }, reason: 'G07 CR06 source inventory', items: [{ productId: { $ref: 'setup.material.id' }, quantityDelta: 10 }] } }),
      step('stockConfirm', 'warehouse', 'POST', '/api/inventory-adjustments/{setup.stock.id}/confirm'),
      step('order', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders', { body: { supplierId: 'supplier-001', productId: { $ref: 'setup.finished.id' }, orderQuantity: 10, unit: 'EA', businessDate: { $businessDate: 0 }, bomId: { $ref: 'setup.bom.id' } } }),
      step('snapshot', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/material-list', { body: { items: [{ productId: { $ref: 'setup.material.id' }, sourceWarehouseId: 'warehouse-001' }] } }),
      step('plan', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'CONFIRM_PLAN' } }),
      step('release', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'RELEASE' } }),
      step('orderGet', 'outsourcing', 'GET', '/api/procurement/outsourcing/orders/{setup.order.id}'),
      step('issue', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/issues', { body: { materialListId: { $ref: 'setup.orderGet.materials.0.id' }, quantity: 10, idempotencyKey: 'cr06-issue' } }),
    ],
    raceRequests: [
      race('outsourcing', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/returns', { body: { materialListId: { $ref: 'setup.orderGet.materials.0.id' }, quantity: 6, idempotencyKey: 'cr06-return-a' } }),
      race('outsourcing', 'B', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/returns', { body: { materialListId: { $ref: 'setup.orderGet.materials.0.id' }, quantity: 6, idempotencyKey: 'cr06-return-b' } }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-07', {
    subjects: ['admin', 'creator', 'approver', 'outsourcing', 'receiving', 'warehouse'],
    sharedResource: 'two distinct IQC-PASS receipts qty=4 each competing for WIP=6 (per-unit=1); two confirms race',
    setup: [
      step('finished', 'admin', 'POST', '/api/products', { body: { code: 'cr07-finished', name: 'CR07 finished', unit: 'EA', baseUomCode: 'EA', priceCents: 100, inventoryClassification: 'FINISHED_GOOD', trackingPolicy: 'NONE' } }),
      step('material', 'admin', 'POST', '/api/products', { body: { code: 'cr07-material', name: 'CR07 material', unit: 'EA', baseUomCode: 'EA', priceCents: 100, standardManufacturingCostCents: 100, inventoryClassification: 'RAW_MATERIAL', trackingPolicy: 'NONE' } }),
      step('qualify', 'admin', 'PATCH', '/api/suppliers/supplier-001/profile', { body: { outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED', qualificationValidFrom: { $businessDate: -30 }, qualificationValidTo: { $businessDate: 365 }, supplierWipWarehouseId: 'warehouse-002' } }),
      step('bom', 'admin', 'POST', '/api/engineering/boms', { body: { productId: { $ref: 'setup.finished.id' }, version: 'CR07', purpose: 'OUTSOURCE', approvalStatus: 'APPROVED', effectiveFrom: { $businessDate: -1 }, items: [{ productId: { $ref: 'setup.material.id' }, quantity: 1 }] } }),
      step('stock', 'warehouse', 'POST', '/api/inventory-adjustments', { body: { warehouseId: 'warehouse-001', adjustmentDate: { $businessDate: 0 }, reason: 'G07 CR07 source inventory', items: [{ productId: { $ref: 'setup.material.id' }, quantityDelta: 6 }] } }),
      step('stockConfirm', 'warehouse', 'POST', '/api/inventory-adjustments/{setup.stock.id}/confirm'),
      step('order', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders', { body: { supplierId: 'supplier-001', productId: { $ref: 'setup.finished.id' }, orderQuantity: 10, unit: 'EA', businessDate: { $businessDate: 0 }, bomId: { $ref: 'setup.bom.id' } } }),
      step('snapshot', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/material-list', { body: { items: [{ productId: { $ref: 'setup.material.id' }, sourceWarehouseId: 'warehouse-001' }] } }),
      step('plan', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'CONFIRM_PLAN' } }),
      step('release', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'RELEASE' } }),
      step('orderGet', 'outsourcing', 'GET', '/api/procurement/outsourcing/orders/{setup.order.id}'),
      step('issue', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/issues', { body: { materialListId: { $ref: 'setup.orderGet.materials.0.id' }, quantity: 6, idempotencyKey: 'cr07-issue' } }),
      step('po', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/processing-fee-purchase-orders', { headers: { 'idempotency-key': 'cr07-po' }, body: { unitPriceCents: 500, orderDate: { $businessDate: 0 }, expectedDeliveryDate: { $businessDate: 30 }, paymentTerms: '30 days', supplierContactName: 'C', supplierContactPhone: '13800000000', supplierAddress: 'A' } }),
      step('poSubmit', 'creator', 'POST', '/api/purchase-orders/{setup.po.id}/submit'),
      step('poApprove', 'approver', 'POST', '/api/purchase-orders/{setup.po.id}/approve'),
      step('poGet', 'admin', 'GET', '/api/purchase-orders/{setup.po.id}'),
      step('noticeA', 'admin', 'POST', '/api/receipt-notices', { body: { businessType: 'OUTSOURCE', outsourcingOrderId: { $ref: 'setup.order.id' }, processingPoId: { $ref: 'setup.po.id' }, warehouseId: 'warehouse-001', noticeDate: { $businessDate: 0 }, items: [{ productId: { $ref: 'setup.finished.id' }, quantity: 4 }], idempotencyKey: 'cr07-notice-a' } }),
      step('noticeAConfirm', 'admin', 'POST', '/api/receipt-notices/{setup.noticeA.id}/confirm'),
      step('noticeAGet', 'admin', 'GET', '/api/receipt-notices/{setup.noticeA.id}'),
      step('noticeB', 'admin', 'POST', '/api/receipt-notices', { body: { businessType: 'OUTSOURCE', outsourcingOrderId: { $ref: 'setup.order.id' }, processingPoId: { $ref: 'setup.po.id' }, warehouseId: 'warehouse-001', noticeDate: { $businessDate: 0 }, items: [{ productId: { $ref: 'setup.finished.id' }, quantity: 4 }], idempotencyKey: 'cr07-notice-b' } }),
      step('noticeBConfirm', 'admin', 'POST', '/api/receipt-notices/{setup.noticeB.id}/confirm'),
      step('noticeBGet', 'admin', 'GET', '/api/receipt-notices/{setup.noticeB.id}'),
      step('receiptA', 'receiving', 'POST', '/api/procurement/outsourcing/receipts', { headers: { 'idempotency-key': 'cr07-receipt-a' }, body: { orderId: { $ref: 'setup.order.id' }, quantity: 4, receivedDate: { $businessDate: 0 }, businessDate: { $businessDate: 0 }, processingFeeCents: 0, processingPoId: { $ref: 'setup.po.id' }, sourceNoticeId: { $ref: 'setup.noticeA.id' }, warehouseId: 'warehouse-001', items: [{ productId: { $ref: 'setup.finished.id' }, quantity: 4, unitCode: 'EA', unitPriceCents: 0, processingPoItemId: { $ref: 'setup.poGet.order.items.0.id' }, sourceNoticeItemId: { $ref: 'setup.noticeAGet.receiptNotice.items.0.id' } }] } }),
      step('receiptB', 'receiving', 'POST', '/api/procurement/outsourcing/receipts', { headers: { 'idempotency-key': 'cr07-receipt-b' }, body: { orderId: { $ref: 'setup.order.id' }, quantity: 4, receivedDate: { $businessDate: 0 }, businessDate: { $businessDate: 0 }, processingFeeCents: 0, processingPoId: { $ref: 'setup.po.id' }, sourceNoticeId: { $ref: 'setup.noticeB.id' }, warehouseId: 'warehouse-001', items: [{ productId: { $ref: 'setup.finished.id' }, quantity: 4, unitCode: 'EA', unitPriceCents: 0, processingPoItemId: { $ref: 'setup.poGet.order.items.0.id' }, sourceNoticeItemId: { $ref: 'setup.noticeBGet.receiptNotice.items.0.id' } }] } }),
      step('iqcA', 'warehouse', 'POST', '/api/iqc', { body: { outsourcing_receipt_id: { $ref: 'setup.receiptA.id' } } }),
      step('iqcAComplete', 'warehouse', 'POST', '/api/iqc/{setup.iqcA.id}/complete', { body: { result: 'PASS', inspection_quantity: 4, passed_quantity: 4, failed_quantity: 0 } }),
      step('iqcB', 'warehouse', 'POST', '/api/iqc', { body: { outsourcing_receipt_id: { $ref: 'setup.receiptB.id' } } }),
      step('iqcBComplete', 'warehouse', 'POST', '/api/iqc/{setup.iqcB.id}/complete', { body: { result: 'PASS', inspection_quantity: 4, passed_quantity: 4, failed_quantity: 0 } }),
    ],
    raceRequests: [
      race('receiving', 'A', 'POST', '/api/procurement/outsourcing/receipts/{setup.receiptA.id}/confirm', { headers: { 'idempotency-key': 'cr07-confirm-a' }, body: { materialIdentities: [{ materialListId: { $ref: 'setup.orderGet.materials.0.id' } }] } }),
      race('receiving', 'B', 'POST', '/api/procurement/outsourcing/receipts/{setup.receiptB.id}/confirm', { headers: { 'idempotency-key': 'cr07-confirm-b' }, body: { materialIdentities: [{ materialListId: { $ref: 'setup.orderGet.materials.0.id' } }] } }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-08', {
    subjects: ['admin', 'creator', 'approver', 'outsourcing', 'receiving', 'warehouse'],
    sharedResource: 'one LOT WIP identity=1 (receipt backflush vs return)',
    setup: [
      step('finished', 'admin', 'POST', '/api/products', { body: { code: 'cr08-finished', name: 'CR08 finished', unit: 'EA', baseUomCode: 'EA', priceCents: 100, inventoryClassification: 'FINISHED_GOOD', trackingPolicy: 'NONE' } }),
      step('material', 'admin', 'POST', '/api/products', { body: { code: 'cr08-material', name: 'CR08 material', unit: 'EA', baseUomCode: 'EA', priceCents: 100, standardManufacturingCostCents: 100, inventoryClassification: 'RAW_MATERIAL', trackingPolicy: 'LOT' } }),
      step('qualify', 'admin', 'PATCH', '/api/suppliers/supplier-001/profile', { body: { outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED', qualificationValidFrom: { $businessDate: -30 }, qualificationValidTo: { $businessDate: 365 }, supplierWipWarehouseId: 'warehouse-002' } }),
      step('lot', 'warehouse', 'POST', '/api/inventory-lots', { body: { productId: { $ref: 'setup.material.id' }, lotCode: 'CR08-LOT-001' } }),
      step('stockDocument', 'warehouse', 'POST', '/api/inventory/native-documents', { body: { docKind: 'OTHER_RECEIPT', businessDate: { $businessDate: 0 }, reason: 'G07 CR08 LOT source inventory', items: [{ productId: { $ref: 'setup.material.id' }, warehouseId: 'warehouse-001', quantity: 1, lotId: { $ref: 'setup.lot.id' } }] } }),
      step('stockDocumentConfirm', 'warehouse', 'POST', '/api/inventory/native-documents/{setup.stockDocument.id}/confirm'),
      technical('stockValuation', 'SOURCE_INVENTORY_SEED', { productId: { $ref: 'setup.material.id' }, warehouseId: 'warehouse-001', lotId: { $ref: 'setup.lot.id' }, quantity: 1, valueCents: 100, businessDate: { $businessDate: 0 }, sourceId: { $ref: 'setup.stockDocument.id' } }),
      step('bom', 'admin', 'POST', '/api/engineering/boms', { body: { productId: { $ref: 'setup.finished.id' }, version: 'CR08', purpose: 'OUTSOURCE', approvalStatus: 'APPROVED', effectiveFrom: { $businessDate: -1 }, items: [{ productId: { $ref: 'setup.material.id' }, quantity: 1 }] } }),
      step('order', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders', { body: { supplierId: 'supplier-001', productId: { $ref: 'setup.finished.id' }, orderQuantity: 1, unit: 'EA', businessDate: { $businessDate: 0 }, bomId: { $ref: 'setup.bom.id' } } }),
      step('snapshot', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/material-list', { body: { items: [{ productId: { $ref: 'setup.material.id' }, sourceWarehouseId: 'warehouse-001' }] } }),
      step('plan', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'CONFIRM_PLAN' } }),
      step('release', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'RELEASE' } }),
      step('orderGet', 'outsourcing', 'GET', '/api/procurement/outsourcing/orders/{setup.order.id}'),
      step('issue', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/issues', { body: { materialListId: { $ref: 'setup.orderGet.materials.0.id' }, quantity: 1, idempotencyKey: 'cr08-issue', lotId: { $ref: 'setup.lot.id' } } }),
      step('po', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/processing-fee-purchase-orders', { headers: { 'idempotency-key': 'cr08-po' }, body: { unitPriceCents: 500, orderDate: { $businessDate: 0 }, expectedDeliveryDate: { $businessDate: 30 }, paymentTerms: '30 days', supplierContactName: 'C', supplierContactPhone: '13800000000', supplierAddress: 'A' } }),
      step('poSubmit', 'creator', 'POST', '/api/purchase-orders/{setup.po.id}/submit'),
      step('poApprove', 'approver', 'POST', '/api/purchase-orders/{setup.po.id}/approve'),
      step('poGet', 'admin', 'GET', '/api/purchase-orders/{setup.po.id}'),
      step('notice', 'admin', 'POST', '/api/receipt-notices', { body: { businessType: 'OUTSOURCE', outsourcingOrderId: { $ref: 'setup.order.id' }, processingPoId: { $ref: 'setup.po.id' }, warehouseId: 'warehouse-001', noticeDate: { $businessDate: 0 }, items: [{ productId: { $ref: 'setup.finished.id' }, quantity: 1 }], idempotencyKey: 'cr08-notice' } }),
      step('noticeConfirm', 'admin', 'POST', '/api/receipt-notices/{setup.notice.id}/confirm'),
      step('noticeGet', 'admin', 'GET', '/api/receipt-notices/{setup.notice.id}'),
      step('receipt', 'receiving', 'POST', '/api/procurement/outsourcing/receipts', { headers: { 'idempotency-key': 'cr08-receipt' }, body: { orderId: { $ref: 'setup.order.id' }, quantity: 1, receivedDate: { $businessDate: 0 }, businessDate: { $businessDate: 0 }, processingFeeCents: 0, processingPoId: { $ref: 'setup.po.id' }, sourceNoticeId: { $ref: 'setup.notice.id' }, warehouseId: 'warehouse-001', items: [{ productId: { $ref: 'setup.finished.id' }, quantity: 1, unitCode: 'EA', unitPriceCents: 0, processingPoItemId: { $ref: 'setup.poGet.order.items.0.id' }, sourceNoticeItemId: { $ref: 'setup.noticeGet.receiptNotice.items.0.id' } }] } }),
      step('iqc', 'warehouse', 'POST', '/api/iqc', { body: { outsourcing_receipt_id: { $ref: 'setup.receipt.id' } } }),
      step('iqcComplete', 'warehouse', 'POST', '/api/iqc/{setup.iqc.id}/complete', { body: { result: 'PASS', inspection_quantity: 1, passed_quantity: 1, failed_quantity: 0 } }),
    ],
    raceRequests: [
      race('receiving', 'A', 'POST', '/api/procurement/outsourcing/receipts/{setup.receipt.id}/confirm', { headers: { 'idempotency-key': 'cr08-confirm' }, body: { materialIdentities: [{ materialListId: { $ref: 'setup.orderGet.materials.0.id' }, lotId: { $ref: 'setup.lot.id' } }] } }),
      race('outsourcing', 'B', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/returns', { body: { materialListId: { $ref: 'setup.orderGet.materials.0.id' }, quantity: 1, idempotencyKey: 'cr08-return', lotId: { $ref: 'setup.lot.id' } } }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES', 'SOURCE_INVENTORY_SEED'],
  }),
  fixedScenario('CR-09', {
    subjects: ['admin', 'outsourcing'],
    sharedResource: 'one RELEASED outsourcing order (lifetime-single processing-fee PO); two creates race',
    setup: [
      step('finished', 'admin', 'POST', '/api/products', { body: { code: 'cr09-finished', name: 'CR09 finished', unit: 'EA', baseUomCode: 'EA', priceCents: 100, inventoryClassification: 'FINISHED_GOOD', trackingPolicy: 'NONE' } }),
      step('material', 'admin', 'POST', '/api/products', { body: { code: 'cr09-material', name: 'CR09 material', unit: 'EA', baseUomCode: 'EA', priceCents: 100, standardManufacturingCostCents: 100, inventoryClassification: 'RAW_MATERIAL', trackingPolicy: 'NONE' } }),
      step('qualify', 'admin', 'PATCH', '/api/suppliers/supplier-001/profile', { body: { outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED', qualificationValidFrom: { $businessDate: -30 }, qualificationValidTo: { $businessDate: 365 }, supplierWipWarehouseId: 'warehouse-002' } }),
      step('bom', 'admin', 'POST', '/api/engineering/boms', { body: { productId: { $ref: 'setup.finished.id' }, version: 'CR09', purpose: 'OUTSOURCE', approvalStatus: 'APPROVED', effectiveFrom: { $businessDate: -1 }, items: [{ productId: { $ref: 'setup.material.id' }, quantity: 1 }] } }),
      step('order', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders', { body: { supplierId: 'supplier-001', productId: { $ref: 'setup.finished.id' }, orderQuantity: 10, unit: 'EA', businessDate: { $businessDate: 0 }, bomId: { $ref: 'setup.bom.id' } } }),
      step('snapshot', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/material-list', { body: { items: [{ productId: { $ref: 'setup.material.id' }, sourceWarehouseId: 'warehouse-001' }] } }),
      step('plan', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'CONFIRM_PLAN' } }),
      step('release', 'outsourcing', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { body: { action: 'RELEASE' } }),
    ],
    raceRequests: [
      race('outsourcing', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/processing-fee-purchase-orders', { headers: { 'idempotency-key': 'cr09-po-a' }, body: { unitPriceCents: 500, orderDate: { $businessDate: 0 }, expectedDeliveryDate: { $businessDate: 30 }, paymentTerms: '30 days', supplierContactName: 'C', supplierContactPhone: '13800000000', supplierAddress: 'A' } }),
      race('outsourcing', 'B', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/processing-fee-purchase-orders', { headers: { 'idempotency-key': 'cr09-po-b' }, body: { unitPriceCents: 500, orderDate: { $businessDate: 0 }, expectedDeliveryDate: { $businessDate: 30 }, paymentTerms: '30 days', supplierContactName: 'C', supplierContactPhone: '13800000000', supplierAddress: 'A' } }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
]);

function canonical(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

/** SHA-256 over the canonical fixed scenario definitions (version + all nine). */
export function computeM1CoreG07FixtureDigest(scenarios = M1_CORE_G07_FIXED_SCENARIOS) {
  return createHash('sha256').update(JSON.stringify(canonical({
    version: M1_CORE_G07_FIXTURE_VERSION,
    scenarios: scenarios.map((item) => ({
      id: item.id, handler: item.handler, method: item.method, route: item.route,
      quantities: item.quantities, subjects: item.subjects, sharedResource: item.sharedResource,
      setup: item.setup, raceRequests: item.raceRequests, technicalL2: item.technicalL2,
    })),
  }))).digest('hex');
}

// Independent frozen approved digest. This is NOT recomputed at runtime from
// the same objects it validates — it is a fixed hex frozen by independent
// review of these definitions, so any later drift is a tamper signal.
//
// 变更记录（2026-11-10，Requirement §31.15 委外核心执行工作面）：委外订单
// 流转动作由目标态名改为精确动作（`CONFIRM_PLAN` / `RELEASE`），且用料快照
// 必须在 DRAFT 阶段形成才能确认计划。固定场景必须改为沿新合同的生产 HTTP
// 链，否则门禁不再检验真实 API。固定场景因此变更，冻结摘要随之重新计算。
// **该重新冻结待业务所有者显式确认**：在此之前，真实 MySQL Gate 的既有
// 验收结论不因本次变更自动延续。
//
// 变更记录（2026-11-10，Requirement §31.16 完整 Active Contract 域级交付整改）：
// 普通采购订单的创建路径现在必须在写单据事务内解析有效供应商价格并冻结价格
// 证据（Active Design §26.36.3），因此固定场景必须先沿生产 HTTP 链建立一条
// 有效的采购价格条目，再创建采购订单。固定场景因此变更，冻结摘要随之重新
// 计算。**该重新冻结同样待业务所有者显式确认**：在此之前，真实 MySQL Gate
// 的既有验收结论不因本次变更自动延续。
export const M1_CORE_G07_FIXED_FIXTURE_DIGEST = 'aa024bd56ae4eccd53242171f46bbd741bd1586f986d7d3ce92a8f5a53b8019f';

function lookup(context, reference) {
  const parts = String(reference).split('.');
  let value = context;
  for (const part of parts) {
    if (value == null) throw new Error(`M1_G07_FIXTURE_REFERENCE_MISSING:${reference}`);
    if (Array.isArray(value)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0) throw new Error(`M1_G07_FIXTURE_REFERENCE_MISSING:${reference}`);
      value = value[index];
    } else {
      value = value[part];
    }
  }
  if (value === undefined) throw new Error(`M1_G07_FIXTURE_REFERENCE_MISSING:${reference}`);
  return value;
}

function resolveRefs(value, context) {
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, context));
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$ref === 'string') return lookup(context, value.$ref);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveRefs(child, context)]));
  }
  return value;
}

export function resolveRoute(route, context) {
  return String(route).replace(/\{([^}]+)\}/g, (_, reference) => String(lookup(context, reference)));
}

function assertRoutePattern(route, label) {
  if (!route || typeof route !== 'string' || !route.startsWith('/api/')) throw new Error(`M1_G07_FIXTURE_ROUTE_INVALID:${label}`);
}

const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH'];
const VALID_SUBJECTS = new Set(Object.keys(M1_CORE_G07_SUBJECTS));

/**
 * Static validation of the fixed fixture manifest, executed BEFORE ACK-4
 * consumption. Fails closed on: missing CR, frozen digest drift, unknown
 * subject, illegal method or non-`/api/` route.
 */
export function assertFixedFixtureManifest(scenarios = M1_CORE_G07_FIXED_SCENARIOS) {
  const expected = M1_CORE_G07_SCENARIOS.map((item) => item.id).sort();
  const actual = scenarios.map((item) => item.id).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('M1_G07_FIXTURE_CR_SET_INCOMPLETE');
  if (computeM1CoreG07FixtureDigest(scenarios) !== M1_CORE_G07_FIXED_FIXTURE_DIGEST) throw new Error('M1_G07_FIXTURE_DIGEST_DRIFT');
  for (const scenario of scenarios) {
    if (!scenario.handler || !VALID_METHODS.includes(scenario.method)) throw new Error(`M1_G07_FIXTURE_METHOD_INVALID:${scenario.id}`);
    assertRoutePattern(scenario.route, `${scenario.id}.route`);
    if (!Array.isArray(scenario.subjects) || scenario.subjects.length < 1) throw new Error(`M1_G07_FIXTURE_SUBJECTS_INVALID:${scenario.id}`);
    for (const subject of scenario.subjects) {
      if (!VALID_SUBJECTS.has(subject)) throw new Error(`M1_G07_FIXTURE_SUBJECT_INVALID:${scenario.id}:${subject}`);
    }
    if (!Array.isArray(scenario.setup) || !Array.isArray(scenario.raceRequests) || scenario.raceRequests.length !== 2) throw new Error(`M1_G07_FIXTURE_RACE_INVALID:${scenario.id}`);
    for (const step of scenario.setup) {
      if (step.method === 'TECHNICAL_L2') {
        if (!step.id || !ALL_TECHNICAL_L2.includes(step.prerequisite) || !step.input) throw new Error(`M1_G07_FIXTURE_TECHNICAL_STEP_INVALID:${scenario.id}`);
        continue;
      }
      if (!step.id || !VALID_SUBJECTS.has(step.subject) || !VALID_METHODS.includes(step.method)) throw new Error(`M1_G07_FIXTURE_SETUP_STEP_INVALID:${scenario.id}`);
      if (step.method === 'GET' && step.body !== undefined) throw new Error(`M1_G07_FIXTURE_GET_BODY_FORBIDDEN:${scenario.id}.${step.id}`);
      assertRoutePattern(step.route, `${scenario.id}.${step.id}`);
    }
    for (const raceRequest of scenario.raceRequests) {
      if (!['A', 'B'].includes(raceRequest.app) || !VALID_SUBJECTS.has(raceRequest.subject) || !VALID_METHODS.includes(raceRequest.method)) throw new Error(`M1_G07_FIXTURE_RACE_INVALID:${scenario.id}`);
      assertRoutePattern(raceRequest.route, `${scenario.id}.race`);
    }
    if (new Set(scenario.raceRequests.map((item) => item.app)).size !== 2) throw new Error(`M1_G07_FIXTURE_RACE_APPS_INVALID:${scenario.id}`);
    for (const technicalL2 of scenario.technicalL2) {
      if (!ALL_TECHNICAL_L2.includes(technicalL2)) throw new Error(`M1_G07_FIXTURE_TECHNICAL_L2_UNKNOWN:${scenario.id}:${technicalL2}`);
    }
  }
  return Object.freeze({
    version: M1_CORE_G07_FIXTURE_VERSION,
    scenarioCount: scenarios.length,
    digest: M1_CORE_G07_FIXED_FIXTURE_DIGEST,
    technicalL2Prerequisites: ALL_TECHNICAL_L2,
  });
}
