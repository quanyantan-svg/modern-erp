import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { allow, HttpError, optionalText, readJson, requiredText, send } from '../lib/http.js';

export const LIFECYCLE_CLASSIFICATIONS = Object.freeze([
  'SAFE_DELETE',
  'SAFE_CHAIN_DELETE',
  'SAFE_REVERSAL_CLEANUP',
  'ARCHIVE_ONLY',
  'BLOCKED',
]);

// The registry is the single source of truth for lifecycle discovery. It is
// deliberately data-oriented so new domains can be added without embedding
// independent delete policies in route handlers or React pages.
export const LIFECYCLE_ENTITIES = Object.freeze({
  SALES_ORDER: { table: 'sales_orders', number: 'order_no', status: 'status', date: 'created_at', label: '销售订单' },
  PURCHASE_ORDER: { table: 'purchase_orders', number: 'order_no', status: 'status', date: 'created_at', label: '采购订单' },
  PURCHASE_REQUISITION: { table: 'purchase_requisitions', number: 'requisition_no', status: 'status', date: 'required_date', label: '请购单' },
  PURCHASE_INSTRUCTION: { table: 'purchase_instructions', number: 'instruction_no', status: 'status', date: 'planned_date', label: '采购指令' },
  PRODUCTION_INSTRUCTION: { table: 'production_instructions', number: 'instruction_no', status: 'status', date: 'planned_date', label: '生产指令' },
  PLANNING_FORECAST: { table: 'planning_forecasts', number: 'forecast_code', status: 'status', date: 'period_start', label: '需求预测' },
  MRP_RUN: { table: 'mrp_runs', number: 'run_code', status: 'status', date: 'horizon_start', label: 'MRP运算' },
  PURCHASE_RECEIPT: { table: 'purchase_receipts', number: 'receipt_no', status: 'status', date: 'receipt_date', label: '采购入库' },
  SALES_DELIVERY: { table: 'sales_deliveries', number: 'delivery_no', status: 'status', date: 'delivery_date', label: '销售出货' },
  SALES_RETURN: { table: 'return_orders', number: 'return_no', status: 'status', date: 'return_date', label: '销售退货' },
  PURCHASE_RETURN: { table: 'purchase_returns', number: 'return_no', status: 'status', date: 'return_date', label: '采购退货' },
  PRODUCTION_ORDER: { table: 'production_orders', number: 'order_no', status: 'status', date: 'planned_start', label: '制令单' },
  PRODUCTION_MATERIAL_ISSUE: { table: 'production_material_issues', number: 'issue_no', status: 'status', date: 'issue_date', label: '用料出库' },
  PRODUCTION_RECEIPT: { table: 'production_receipts', number: 'receipt_no', status: 'status', date: 'receipt_date', label: '生产入库' },
  INVENTORY_ADJUSTMENT: { table: 'inventory_adjustments', number: 'adjustment_no', status: 'status', date: 'adjustment_date', label: '库存调整' },
  INVENTORY_TRANSFER: { table: 'inventory_transfers', number: 'transfer_no', status: 'status', date: 'created_at', label: '库存调拨' },
  INVENTORY_SCRAP: { table: 'inventory_scraps', number: 'scrap_no', status: 'status', date: 'scrap_date', label: '库存报废' },
  INVENTORY_CHECK: { table: 'inventory_checks', number: 'check_no', status: 'status', date: 'checked_at', label: '库存盘点' },
  ACCOUNT_RECEIVABLE: { table: 'account_receivables', number: 'voucher_no', status: 'status', date: 'business_date', label: '应收账款' },
  ACCOUNT_PAYABLE: { table: 'account_payables', number: 'voucher_no', status: 'status', date: 'business_date', label: '应付账款' },
  SALES_DISCOUNT: { table: 'sales_discounts', number: 'discount_no', status: 'status', date: 'business_date', label: '销售折让' },
  PURCHASE_DISCOUNT: { table: 'purchase_discounts', number: 'discount_no', status: 'status', date: 'business_date', label: '采购折让' },
  PAYMENT_COLLECTION: { table: 'payment_collections', number: 'collection_no', status: 'status', date: 'collection_date', label: '收款单' },
  PAYMENT_DISBURSEMENT: { table: 'payment_disbursements', number: 'disbursement_no', status: 'status', date: 'disbursement_date', label: '付款单' },
  ACCOUNTING_VOUCHER: { table: 'accounting_vouchers', number: 'voucher_no', status: 'status', date: 'voucher_date', label: '会计凭证' },
});

const ENTITY_ALIASES = Object.freeze({
  SALESORDER: 'SALES_ORDER', PURCHASEORDER: 'PURCHASE_ORDER', PURCHASEREQUISITION: 'PURCHASE_REQUISITION',
  PURCHASEINSTRUCTION: 'PURCHASE_INSTRUCTION', PURCHASERECEIPT: 'PURCHASE_RECEIPT',
  PRODUCTIONORDER: 'PRODUCTION_ORDER', PRODUCTIONMATERIALISSUE: 'PRODUCTION_MATERIAL_ISSUE',
  PRODUCTIONRECEIPT: 'PRODUCTION_RECEIPT', ACCOUNTRECEIVABLE: 'ACCOUNT_RECEIVABLE',
  ACCOUNTPAYABLE: 'ACCOUNT_PAYABLE', ACCOUNTINGVOUCHER: 'ACCOUNTING_VOUCHER',
});

const EFFECTIVE_STATUSES = new Set(['CONFIRMED', 'APPROVED', 'POSTED', 'TRANSFERRED', 'COMPLETED']);
const ARCHIVE_STATUSES = new Set(['CANCELLED', 'REJECTED', 'VOIDED', 'NEUTRALIZED']);
const ARCHIVE_ONLY_TYPES = new Set(['MRP_RUN']);
const REVERSIBLE_EFFECT_TYPES = new Set([
  'PURCHASE_RECEIPT', 'SALES_DELIVERY', 'SALES_RETURN', 'PURCHASE_RETURN',
  'PRODUCTION_MATERIAL_ISSUE', 'PRODUCTION_RECEIPT', 'INVENTORY_ADJUSTMENT',
  'INVENTORY_TRANSFER', 'INVENTORY_SCRAP', 'INVENTORY_CHECK',
  'SALES_DISCOUNT', 'PURCHASE_DISCOUNT', 'PAYMENT_COLLECTION', 'PAYMENT_DISBURSEMENT',
  'ACCOUNT_RECEIVABLE', 'ACCOUNT_PAYABLE', 'ACCOUNTING_VOUCHER',
]);

const SOURCE_ENTITY_TYPES = Object.freeze({
  SALES_ORDER: 'SALES_ORDER', PURCHASE_ORDER: 'PURCHASE_ORDER', PURCHASE_REQUISITION: 'PURCHASE_REQUISITION',
  PURCHASE_RECEIPT: 'PURCHASE_RECEIPT', SALES_DELIVERY: 'SALES_DELIVERY', SALES_RETURN: 'SALES_RETURN',
  PURCHASE_RETURN: 'PURCHASE_RETURN', PRODUCTION_MATERIAL_ISSUE: 'PRODUCTION_MATERIAL_ISSUE',
  PRODUCTION_RECEIPT: 'PRODUCTION_RECEIPT', INVENTORY_ADJUSTMENT: 'INVENTORY_ADJUSTMENT',
  INVENTORY_TRANSFER: 'INVENTORY_TRANSFER', INVENTORY_SCRAP: 'INVENTORY_SCRAP', INVENTORY_CHECK: 'INVENTORY_CHECK',
  SALES_DISCOUNT: 'SALES_DISCOUNT', PURCHASE_DISCOUNT: 'PURCHASE_DISCOUNT',
  PAYMENT_COLLECTION: 'PAYMENT_COLLECTION', PAYMENT_DISBURSEMENT: 'PAYMENT_DISBURSEMENT',
});

function normalizeEntityType(value) {
  const normalized = String(value || '').trim().replace(/[\s-]+/g, '_').toUpperCase();
  const compact = normalized.replaceAll('_', '');
  const entityType = LIFECYCLE_ENTITIES[normalized] ? normalized : ENTITY_ALIASES[compact];
  if (!entityType) throw new HttpError(400, '不支持此业务类型', { code: 'LIFECYCLE_ENTITY_UNSUPPORTED' });
  return entityType;
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function rowFor(db, entityType, entityId) {
  const rule = LIFECYCLE_ENTITIES[entityType];
  const row = db.prepare(`SELECT * FROM ${rule.table} WHERE id=?`).get(entityId);
  if (!row) throw new HttpError(404, `${rule.label}不存在`, { code: 'LIFECYCLE_ENTITY_NOT_FOUND' });
  return row;
}

function periodOf(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : '';
}

function isPeriodClosed(db, period) {
  if (!period) return false;
  const finance = db.prepare("SELECT 1 FROM period_closures WHERE period=? AND status='CLOSED' LIMIT 1").get(period);
  const inventory = db.prepare("SELECT 1 FROM inventory_period_closures WHERE period_key=? AND status='CLOSED' LIMIT 1").get(period);
  return Boolean(finance || inventory);
}

function sourceRows(db, table, entityType, entityId) {
  return db.prepare(`SELECT * FROM ${table} WHERE source_type=? AND source_id=? ORDER BY created_at,id`).all(entityType, entityId);
}

function inventoryEffects(db, entityType, entityId) {
  return sourceRows(db, 'inventory_transactions', entityType, entityId).map((row) => ({
    id: row.id,
    warehouseId: row.warehouse_id,
    productId: row.product_id,
    quantityChange: Number(row.quantity_change),
    direction: row.direction,
    balanceAfter: Number(row.balance_after),
    createdAt: row.created_at,
  }));
}

function financeEffects(db, entityType, entityId) {
  const receivables = sourceRows(db, 'account_receivables', entityType, entityId).map((row) => ({
    id: row.id, type: 'AR', amountCents: Number(row.amount_cents), adjustmentCents: Number(row.adjustment_cents || 0),
  }));
  const payables = sourceRows(db, 'account_payables', entityType, entityId).map((row) => ({
    id: row.id, type: 'AP', amountCents: Number(row.amount_cents), adjustmentCents: Number(row.adjustment_cents || 0),
  }));
  const vouchers = sourceRows(db, 'accounting_vouchers', entityType, entityId).map((row) => ({
    id: row.id, voucherNo: row.voucher_no, status: row.status, period: row.period || periodOf(row.voucher_date),
  }));
  return { receivables, payables, vouchers };
}

function archiveState(db, entityType, entityId) {
  return db.prepare('SELECT active,archived_at,reason FROM lifecycle_archives WHERE entity_type=? AND entity_id=?').get(entityType, entityId) || null;
}

function buildNode(db, entityType, entityId, selectedForCleanup, relationship = 'ROOT') {
  const rule = LIFECYCLE_ENTITIES[entityType];
  const row = rowFor(db, entityType, entityId);
  const inventoryEffect = inventoryEffects(db, entityType, entityId);
  const financeEffect = financeEffects(db, entityType, entityId);
  const status = String(row[rule.status] || '');
  const period = periodOf(row[rule.date] || row.created_at);
  const hasEffects = inventoryEffect.length > 0 || financeEffect.receivables.length > 0 || financeEffect.payables.length > 0 || financeEffect.vouchers.length > 0;
  return {
    key: `${entityType}:${entityId}`,
    entityType,
    entityId,
    label: rule.label,
    documentNo: String(row[rule.number] || entityId),
    status,
    effective: EFFECTIVE_STATUSES.has(status) || hasEffects,
    inventoryEffect,
    financialEffect: financeEffect,
    period,
    periodClosed: isPeriodClosed(db, period),
    selectedForCleanup: Boolean(selectedForCleanup),
    relationship,
    archived: archiveState(db, entityType, entityId)?.active === 1,
  };
}

function graphBuilder(db, rootType, rootId, includeExternal) {
  const nodes = new Map();
  const edges = [];
  const queue = [];

  function add(type, entityId, selected, relationship, from = null, external = false) {
    if (!entityId || !LIFECYCLE_ENTITIES[type]) return null;
    const key = `${type}:${entityId}`;
    let node = nodes.get(key);
    if (!node) {
      try { node = buildNode(db, type, entityId, selected, relationship); } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
      node.externalDependency = Boolean(external);
      nodes.set(key, node);
      queue.push(node);
    } else if (selected && !node.selectedForCleanup) {
      node.selectedForCleanup = true;
      queue.push(node);
    }
    if (from) {
      const edgeKey = `${from}|${key}|${relationship}`;
      if (!edges.some((edge) => edge.key === edgeKey)) edges.push({ key: edgeKey, from, to: key, relationship, external: Boolean(external) });
    }
    return node;
  }

  add(rootType, rootId, true, 'ROOT');
  const expanded = new Set();
  while (queue.length) {
    const node = queue.shift();
    if (expanded.has(node.key)) continue;
    expanded.add(node.key);
    const selectedDownstream = node.selectedForCleanup;
    const row = rowFor(db, node.entityType, node.entityId);

    if (node.entityType === 'PURCHASE_INSTRUCTION') {
      for (const req of db.prepare('SELECT id FROM purchase_requisitions WHERE source_instruction_id=?').all(node.entityId)) add('PURCHASE_REQUISITION', req.id, selectedDownstream, 'GENERATED', node.key);
      for (const item of db.prepare('SELECT purchase_requisition_id id FROM purchase_instruction_items WHERE instruction_id=? AND purchase_requisition_id IS NOT NULL').all(node.entityId)) add('PURCHASE_REQUISITION', item.id, selectedDownstream, 'GENERATED', node.key);
    }
    if (node.entityType === 'PURCHASE_REQUISITION') {
      if (row.source_instruction_id) add('PURCHASE_INSTRUCTION', row.source_instruction_id, false, 'SOURCE', node.key);
      if (row.purchase_order_id) add('PURCHASE_ORDER', row.purchase_order_id, selectedDownstream, 'GENERATED', node.key);
    }
    if (node.entityType === 'PURCHASE_ORDER') {
      for (const req of db.prepare('SELECT id FROM purchase_requisitions WHERE purchase_order_id=?').all(node.entityId)) add('PURCHASE_REQUISITION', req.id, false, 'SOURCE', node.key);
      for (const receipt of db.prepare('SELECT id FROM purchase_receipts WHERE purchase_order_id=?').all(node.entityId)) add('PURCHASE_RECEIPT', receipt.id, selectedDownstream, 'GENERATED', node.key);
    }
    if (node.entityType === 'PURCHASE_RECEIPT') {
      if (row.purchase_order_id) add('PURCHASE_ORDER', row.purchase_order_id, false, 'SOURCE', node.key);
      for (const ret of db.prepare('SELECT id FROM purchase_returns WHERE receipt_id=?').all(node.entityId)) add('PURCHASE_RETURN', ret.id, selectedDownstream, 'GENERATED', node.key);
    }
    if (node.entityType === 'PRODUCTION_INSTRUCTION') {
      for (const item of db.prepare('SELECT production_order_id id FROM production_instruction_items WHERE instruction_id=? AND production_order_id IS NOT NULL').all(node.entityId)) add('PRODUCTION_ORDER', item.id, selectedDownstream, 'GENERATED', node.key);
    }
    if (node.entityType === 'PRODUCTION_ORDER') {
      for (const item of db.prepare('SELECT instruction_id FROM production_instruction_items WHERE production_order_id=?').all(node.entityId)) add('PRODUCTION_INSTRUCTION', item.instruction_id, false, 'SOURCE', node.key);
      for (const issue of db.prepare('SELECT id FROM production_material_issues WHERE production_order_id=?').all(node.entityId)) add('PRODUCTION_MATERIAL_ISSUE', issue.id, selectedDownstream, 'GENERATED', node.key);
      for (const receipt of db.prepare('SELECT id FROM production_receipts WHERE production_order_id=?').all(node.entityId)) add('PRODUCTION_RECEIPT', receipt.id, selectedDownstream, 'GENERATED', node.key);
    }
    if (node.entityType === 'PRODUCTION_MATERIAL_ISSUE' || node.entityType === 'PRODUCTION_RECEIPT') {
      if (row.production_order_id) add('PRODUCTION_ORDER', row.production_order_id, false, 'SOURCE', node.key);
    }

    // Generated accounting subledger and voucher records are part of the
    // selected cleanup graph. Settlement/discount dependants are external
    // until the administrator explicitly expands the scope.
    for (const receivable of node.financialEffect.receivables) add('ACCOUNT_RECEIVABLE', receivable.id, node.selectedForCleanup, 'GENERATED_AR', node.key);
    for (const payable of node.financialEffect.payables) add('ACCOUNT_PAYABLE', payable.id, node.selectedForCleanup, 'GENERATED_AP', node.key);
    for (const voucher of node.financialEffect.vouchers) add('ACCOUNTING_VOUCHER', voucher.id, node.selectedForCleanup, 'GENERATED_VOUCHER', node.key);

    if (node.entityType === 'ACCOUNT_RECEIVABLE') {
      for (const item of db.prepare('SELECT DISTINCT collection_id id FROM payment_collection_items WHERE receivable_id=?').all(node.entityId)) add('PAYMENT_COLLECTION', item.id, includeExternal, 'SETTLEMENT', node.key, true);
      for (const discount of db.prepare('SELECT id FROM sales_discounts WHERE source_receivable_id=?').all(node.entityId)) add('SALES_DISCOUNT', discount.id, includeExternal, 'DISCOUNT', node.key, true);
    }
    if (node.entityType === 'ACCOUNT_PAYABLE') {
      for (const item of db.prepare('SELECT DISTINCT disbursement_id id FROM payment_disbursement_items WHERE payable_id=?').all(node.entityId)) add('PAYMENT_DISBURSEMENT', item.id, includeExternal, 'SETTLEMENT', node.key, true);
      for (const discount of db.prepare('SELECT id FROM purchase_discounts WHERE source_payable_id=?').all(node.entityId)) add('PURCHASE_DISCOUNT', discount.id, includeExternal, 'DISCOUNT', node.key, true);
    }

    // Conservative stock provenance: without lots, any later outbound movement
    // for the same warehouse/product may consume this inbound quantity. It is
    // safer to block a partial cleanup than to guess provenance.
    for (const effect of node.inventoryEffect.filter((item) => item.quantityChange > 0)) {
      const consumers = db.prepare(`
        SELECT source_type,source_id,source_no,created_at
        FROM inventory_transactions
        WHERE warehouse_id=? AND product_id=? AND quantity_change < 0
          AND (created_at > ? OR (created_at = ? AND id > ?))
        ORDER BY created_at,id
      `).all(effect.warehouseId, effect.productId, effect.createdAt, effect.createdAt, effect.id);
      for (const consumer of consumers) {
        const type = SOURCE_ENTITY_TYPES[consumer.source_type];
        if (type) add(type, consumer.source_id, includeExternal, 'INVENTORY_CONSUMPTION', node.key, true);
      }
    }
  }
  return { nodes: [...nodes.values()], edges: edges.map(({ key, ...edge }) => edge) };
}

function classifyGraph(graph) {
  const selected = graph.nodes.filter((node) => node.selectedForCleanup);
  const unselectedExternal = graph.nodes.filter((node) => node.externalDependency && !node.selectedForCleanup);
  const closed = selected.filter((node) => node.periodClosed);
  const effective = selected.filter((node) => node.effective);
  const unsupported = effective.filter((node) => !REVERSIBLE_EFFECT_TYPES.has(node.entityType));
  const root = graph.nodes[0];
  const blockers = [];

  if (unselectedExternal.length) blockers.push({
    code: 'EXTERNAL_DEPENDENCY',
    message: '有效业务依赖当前记录，请查看关联业务或扩大清理范围。',
    nodes: unselectedExternal.map((node) => node.key),
  });
  if (closed.length) blockers.push({
    code: 'CLOSED_PERIOD',
    message: '相关业务位于已关闭期间。请先重新开放相关期间，再执行错误业务清理。',
    nodes: closed.map((node) => node.key),
  });
  if (unsupported.length) blockers.push({
    code: 'REVERSAL_UNSUPPORTED',
    message: '当前业务包含尚未支持安全冲销的有效记录。',
    nodes: unsupported.map((node) => node.key),
  });
  if (blockers.length) return { classification: 'BLOCKED', blockers };
  if (ARCHIVE_ONLY_TYPES.has(root.entityType) || (selected.length === 1 && ARCHIVE_STATUSES.has(root.status))) {
    return { classification: 'ARCHIVE_ONLY', blockers: [] };
  }
  if (effective.length) return { classification: 'SAFE_REVERSAL_CLEANUP', blockers: [] };
  if (selected.length > 1) return { classification: 'SAFE_CHAIN_DELETE', blockers: [] };
  return { classification: 'SAFE_DELETE', blockers: [] };
}

export function analyzeLifecycleGraph(db, { entityType, entityId, includeExternal = false }) {
  const normalizedType = normalizeEntityType(entityType);
  const normalizedId = requiredText(entityId, '业务记录', 100);
  const graph = graphBuilder(db, normalizedType, normalizedId, Boolean(includeExternal));
  const result = classifyGraph(graph);
  const selected = graph.nodes.filter((node) => node.selectedForCleanup);
  return {
    root: graph.nodes[0],
    nodes: graph.nodes,
    edges: graph.edges,
    classification: result.classification,
    blockers: result.blockers,
    summary: {
      selectedRecords: selected.length,
      inventoryMovements: selected.reduce((count, node) => count + node.inventoryEffect.length, 0),
      receivableEffects: selected.reduce((count, node) => count + node.financialEffect.receivables.length, 0),
      payableEffects: selected.reduce((count, node) => count + node.financialEffect.payables.length, 0),
      voucherEffects: selected.reduce((count, node) => count + node.financialEffect.vouchers.length, 0),
      periods: [...new Set(selected.map((node) => node.period).filter(Boolean))],
    },
  };
}

export function lifecycleAnalysis(db, res, actor, url) {
  allow(actor, 'USERS_MANAGE');
  const graph = analyzeLifecycleGraph(db, {
    entityType: url.searchParams.get('entityType'),
    entityId: url.searchParams.get('entityId'),
    includeExternal: url.searchParams.get('includeExternal') === 'true',
  });
  return send(res, 200, { graph });
}

export async function archiveLifecycleRecord(db, req, res, actor) {
  allow(actor, 'USERS_MANAGE');
  const body = await readJson(req);
  const entityType = normalizeEntityType(body.entityType);
  const entityId = requiredText(body.entityId, '业务记录', 100);
  const reason = optionalText(body.reason, 500);
  const node = buildNode(db, entityType, entityId, false);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO lifecycle_archives(entity_type,entity_id,document_no,archived_by,archived_at,reason,restored_by,restored_at,active)
      VALUES(?,?,?,?,?,?,NULL,NULL,1)
      ON CONFLICT(entity_type,entity_id) DO UPDATE SET
        document_no=excluded.document_no,archived_by=excluded.archived_by,archived_at=excluded.archived_at,
        reason=excluded.reason,restored_by=NULL,restored_at=NULL,active=1
    `).run(entityType, entityId, node.documentNo, actor.id, now, reason);
    audit(db, actor.id, 'ARCHIVE', entityType, entityId, `归档 ${node.documentNo}${reason ? `：${reason}` : ''}`);
  });
  return send(res, 200, { ok: true, archived: true });
}

export async function restoreLifecycleRecord(db, req, res, actor) {
  allow(actor, 'USERS_MANAGE');
  const body = await readJson(req);
  const entityType = normalizeEntityType(body.entityType);
  const entityId = requiredText(body.entityId, '业务记录', 100);
  rowFor(db, entityType, entityId);
  const current = db.prepare('SELECT active FROM lifecycle_archives WHERE entity_type=? AND entity_id=?').get(entityType, entityId);
  if (!current?.active) throw new HttpError(409, '当前记录未归档', { code: 'RECORD_NOT_ARCHIVED' });
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE lifecycle_archives SET active=0,restored_by=?,restored_at=? WHERE entity_type=? AND entity_id=?').run(actor.id, now, entityType, entityId);
    audit(db, actor.id, 'RESTORE', entityType, entityId, '恢复归档记录');
  });
  return send(res, 200, { ok: true, archived: false });
}

export function isLifecycleArchived(db, entityType, entityId) {
  const type = normalizeEntityType(entityType);
  return Boolean(db.prepare('SELECT 1 FROM lifecycle_archives WHERE entity_type=? AND entity_id=? AND active=1').get(type, entityId));
}

export function lifecycleArchiveClause(entityType, idExpression = 'id') {
  const type = normalizeEntityType(entityType);
  return `NOT EXISTS (SELECT 1 FROM lifecycle_archives la WHERE la.entity_type='${type}' AND la.entity_id=${idExpression} AND la.active=1)`;
}

export function createCleanupAudit(db, actor, graph, reason) {
  const cleanupId = id();
  const selected = graph.nodes.filter((node) => node.selectedForCleanup);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO cleanup_events(
      id,root_entity_type,root_entity_id,root_document_no,actor_id,reason,classification,
      affected_entity_types,affected_entity_ids,affected_document_numbers,inventory_effects,
      finance_effects,voucher_effects,periods,success_state,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    cleanupId, graph.root.entityType, graph.root.entityId, graph.root.documentNo, actor.id, reason, graph.classification,
    JSON.stringify([...new Set(selected.map((node) => node.entityType))]),
    JSON.stringify(selected.map((node) => node.entityId)),
    JSON.stringify(selected.map((node) => node.documentNo)),
    JSON.stringify(selected.flatMap((node) => node.inventoryEffect)),
    JSON.stringify(selected.flatMap((node) => [...node.financialEffect.receivables, ...node.financialEffect.payables])),
    JSON.stringify(selected.flatMap((node) => node.financialEffect.vouchers)),
    JSON.stringify(graph.summary.periods), 'SUCCEEDED', now,
  );
  const insertItem = db.prepare(`
    INSERT INTO cleanup_event_items(id,cleanup_event_id,entity_type,entity_id,document_no,status,effective,inventory_effect,finance_effect,period)
    VALUES(?,?,?,?,?,?,?,?,?,?)
  `);
  for (const node of selected) insertItem.run(
    id(), cleanupId, node.entityType, node.entityId, node.documentNo, node.status, node.effective ? 1 : 0,
    JSON.stringify(node.inventoryEffect), JSON.stringify(node.financialEffect), node.period,
  );
  return cleanupId;
}
