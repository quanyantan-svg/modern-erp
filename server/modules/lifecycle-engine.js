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
  PURCHASE_RECEIPT: {
    table: 'purchase_receipts', number: 'receipt_no', status: 'status', date: 'receipt_date', label: '采购入库',
    archivePhase: 'ARCHIVE_PHASE_1', archivePermissionAny: ['PURCHASE_RECEIPTS_MANAGE'],
    viewPermissionAny: ['PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE'],
  },
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

const ARCHIVE_STATUSES = new Set(['CANCELLED', 'REJECTED', 'VOIDED', 'NEUTRALIZED']);
const ARCHIVE_ONLY_TYPES = new Set(['MRP_RUN']);
const REVERSIBLE_EFFECT_TYPES = new Set([
  'PURCHASE_RECEIPT', 'SALES_DELIVERY', 'SALES_RETURN', 'PURCHASE_RETURN',
  'PRODUCTION_MATERIAL_ISSUE', 'PRODUCTION_RECEIPT', 'INVENTORY_ADJUSTMENT',
  'INVENTORY_TRANSFER', 'INVENTORY_SCRAP', 'INVENTORY_CHECK',
  'SALES_DISCOUNT', 'PURCHASE_DISCOUNT', 'PAYMENT_COLLECTION', 'PAYMENT_DISBURSEMENT',
  'ACCOUNT_RECEIVABLE', 'ACCOUNT_PAYABLE', 'ACCOUNTING_VOUCHER',
]);

const EFFECTIVE_STATUS_BY_TYPE = Object.freeze({
  PURCHASE_RECEIPT: new Set(['CONFIRMED']), SALES_DELIVERY: new Set(['CONFIRMED']),
  SALES_RETURN: new Set(['CONFIRMED']), PURCHASE_RETURN: new Set(['CONFIRMED']),
  PRODUCTION_MATERIAL_ISSUE: new Set(['CONFIRMED']), PRODUCTION_RECEIPT: new Set(['CONFIRMED']),
  INVENTORY_ADJUSTMENT: new Set(['CONFIRMED']), INVENTORY_TRANSFER: new Set(['TRANSFERRED']),
  INVENTORY_SCRAP: new Set(['CONFIRMED']), INVENTORY_CHECK: new Set(['APPROVED']),
  SALES_DISCOUNT: new Set(['CONFIRMED']), PURCHASE_DISCOUNT: new Set(['CONFIRMED']),
  PAYMENT_COLLECTION: new Set(['CONFIRMED']), PAYMENT_DISBURSEMENT: new Set(['CONFIRMED']),
  ACCOUNTING_VOUCHER: new Set(['POSTED']),
});

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
  return db.prepare(`
    SELECT rowid lifecycle_rowid,* FROM inventory_transactions
    WHERE source_type=? AND source_id=? ORDER BY created_at,rowid
  `).all(entityType, entityId).map((row) => ({
    id: row.id,
    ledgerSequence: Number(row.lifecycle_rowid),
    warehouseId: row.warehouse_id,
    productId: row.product_id,
    quantity: Number(row.quantity_change),
    quantityChange: row.direction === 'OUT' ? -Number(row.quantity_change) : Number(row.quantity_change),
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

function hasAnyPermission(actor, permissions) {
  return Boolean(actor && Array.isArray(actor.permissions) && permissions.some((permission) => actor.permissions.includes(permission)));
}

function assertPurchaseReceiptArchivePermission(actor) {
  if (!hasAnyPermission(actor, LIFECYCLE_ENTITIES.PURCHASE_RECEIPT.archivePermissionAny)) {
    throw new HttpError(403, '没有归档采购入库单的权限', { code: 'FORBIDDEN' });
  }
}

function safeBlocker(code, message, relation, documentNo) {
  return { code, message, relation, ...(documentNo ? { documentNo } : {}) };
}

function purchaseReceiptArchiveBlockers(db, receipt) {
  const blockers = [];
  const receiptId = receipt.id;
  const iqc = db.prepare('SELECT id,iqc_no,status FROM iqc_inspections WHERE purchase_receipt_id=? OR receipt_id=? LIMIT 1').get(receiptId, receiptId);
  if (iqc) blockers.push(safeBlocker('DOWNSTREAM_DEPENDENCY', '采购入库单存在来料检验记录，不能归档。', 'IQC', iqc.iqc_no || iqc.id));
  const purchaseReturn = db.prepare('SELECT id,return_no,status FROM purchase_returns WHERE receipt_id=? LIMIT 1').get(receiptId);
  if (purchaseReturn) blockers.push(safeBlocker('DOWNSTREAM_DEPENDENCY', '采购入库单存在采购退货关系，不能归档。', 'PURCHASE_RETURN', purchaseReturn.return_no || purchaseReturn.id));
  const supplierBill = db.prepare(`
    SELECT b.id,b.bill_no,b.status FROM supplier_bills b
    JOIN supplier_bill_items i ON i.bill_id=b.id WHERE i.receipt_id=? LIMIT 1
  `).get(receiptId);
  if (supplierBill) blockers.push(safeBlocker('FINANCIAL_DEPENDENCY', '采购入库单存在供应商账单关系，不能归档。', 'SUPPLIER_BILL', supplierBill.bill_no || supplierBill.id));
  const payable = db.prepare("SELECT id,voucher_no,status FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=? LIMIT 1").get(receiptId);
  if (payable) blockers.push(safeBlocker('FINANCIAL_DEPENDENCY', '采购入库单存在应付账款关系，不能归档。', 'ACCOUNT_PAYABLE', payable.voucher_no || payable.id));
  const voucher = db.prepare("SELECT id,voucher_no,status FROM accounting_vouchers WHERE source_type='PURCHASE_RECEIPT' AND source_id=? LIMIT 1").get(receiptId);
  if (voucher) blockers.push(safeBlocker('FINANCIAL_DEPENDENCY', '采购入库单存在会计凭证关系，不能归档。', 'ACCOUNTING_VOUCHER', voucher.voucher_no || voucher.id));
  if (db.prepare("SELECT 1 FROM inventory_transactions WHERE source_type='PURCHASE_RECEIPT' AND source_id=? LIMIT 1").get(receiptId)) {
    blockers.push(safeBlocker('STOCK_EFFECT_EXISTS', '采购入库单存在库存流水，不能归档。', 'INVENTORY_TRANSACTION'));
  }
  if (db.prepare("SELECT 1 FROM tracked_inventory_movements WHERE source_type='PURCHASE_RECEIPT' AND source_id=? LIMIT 1").get(receiptId)) {
    blockers.push(safeBlocker('TRACKING_EFFECT_EXISTS', '采购入库单存在批次或序列号移动，不能归档。', 'TRACKING_MOVEMENT'));
  }
  if (db.prepare("SELECT 1 FROM inventory_valuation_movements WHERE source_type='PURCHASE_RECEIPT' AND source_id=? LIMIT 1").get(receiptId)) {
    blockers.push(safeBlocker('FINANCIAL_DEPENDENCY', '采购入库单存在存货估值流水，不能归档。', 'INVENTORY_VALUATION'));
  }
  const period = periodOf(receipt.receipt_date);
  if (isPeriodClosed(db, period)) blockers.push(safeBlocker('CLOSED_PERIOD', '采购入库单所属期间已经关闭，不能归档。', 'CLOSED_PERIOD', period));
  if (!receipt.purchase_order_id || !db.prepare('SELECT 1 FROM purchase_orders WHERE id=?').get(receipt.purchase_order_id)) {
    blockers.push(safeBlocker('DOWNSTREAM_DEPENDENCY', '采购订单来源链不完整，不能归档。', 'SOURCE_CHAIN'));
  } else if (db.prepare(`
    SELECT 1 FROM purchase_receipt_items pri
    LEFT JOIN purchase_order_items poi ON poi.id=pri.purchase_order_item_id AND poi.order_id=?
    WHERE pri.receipt_id=? AND (pri.purchase_order_item_id IS NULL OR poi.id IS NULL) LIMIT 1
  `).get(receipt.purchase_order_id, receiptId)) {
    blockers.push(safeBlocker('DOWNSTREAM_DEPENDENCY', '采购入库明细的采购订单来源链不完整，不能归档。', 'SOURCE_CHAIN'));
  }
  return blockers;
}

export function analyzeArchiveEligibility(db, actor, entityType, entityId) {
  const normalizedType = normalizeEntityType(entityType);
  const normalizedId = requiredText(entityId, '业务记录', 100);
  if (normalizedType !== 'PURCHASE_RECEIPT' || LIFECYCLE_ENTITIES[normalizedType].archivePhase !== 'ARCHIVE_PHASE_1') {
    throw new HttpError(409, '当前业务类型尚未开放归档', { code: 'INVALID_STATE' });
  }
  assertPurchaseReceiptArchivePermission(actor);
  const receipt = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(normalizedId);
  if (!receipt) throw new HttpError(404, '采购入库单不存在', { code: 'NOT_FOUND' });
  if (receipt.status !== 'CANCELLED') return {
    allowed: false, entityType: normalizedType, entityId: normalizedId, documentNo: receipt.receipt_no,
    status: receipt.status, archived: false,
    blockers: [safeBlocker('INVALID_STATE', '只有已取消的采购入库单可以归档。', 'STATUS')],
  };
  const archived = archiveState(db, normalizedType, normalizedId)?.active === 1;
  const blockers = archived
    ? [safeBlocker('ALREADY_ARCHIVED', '采购入库单已经归档。', 'ARCHIVE')]
    : purchaseReceiptArchiveBlockers(db, receipt);
  return {
    allowed: blockers.length === 0,
    entityType: normalizedType,
    entityId: normalizedId,
    documentNo: receipt.receipt_no,
    status: receipt.status,
    archived,
    blockers,
  };
}

export function archiveCancelledDocument(db, actor, input) {
  const entityType = normalizeEntityType(input.entityType);
  const entityId = requiredText(input.entityId, '业务记录', 100);
  const reason = requiredText(input.reason, '归档原因', 500);
  let result;
  transaction(db, () => {
    const eligibility = analyzeArchiveEligibility(db, actor, entityType, entityId);
    if (!eligibility.allowed) {
      const blocker = eligibility.blockers[0];
      throw new HttpError(409, blocker.message, { code: blocker.code, blockers: eligibility.blockers });
    }
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO lifecycle_archives(entity_type,entity_id,document_no,archived_by,archived_at,reason,restored_by,restored_at,active)
      VALUES(?,?,?,?,?,?,NULL,NULL,1)
      ON CONFLICT(entity_type,entity_id) DO UPDATE SET
        document_no=excluded.document_no,archived_by=excluded.archived_by,archived_at=excluded.archived_at,
        reason=excluded.reason,restored_by=NULL,restored_at=NULL,active=1
    `).run(entityType, entityId, eligibility.documentNo, actor.id, now, reason);
    audit(db, actor.id, 'ARCHIVE', entityType, entityId, `归档 ${eligibility.documentNo}：${reason}；status=CANCELLED；visibility=ACTIVE->ARCHIVED`);
    result = { ok: true, entityType, entityId, documentNo: eligibility.documentNo, archived: true, archivedAt: now, archiveEligibility: eligibility };
  });
  return result;
}

export function restoreArchivedDocument(db, actor, input) {
  if (!hasAnyPermission(actor, ['USERS_MANAGE'])) {
    throw new HttpError(403, '只有管理员可以恢复归档记录', { code: 'FORBIDDEN' });
  }
  const entityType = normalizeEntityType(input.entityType);
  const entityId = requiredText(input.entityId, '业务记录', 100);
  const reason = optionalText(input.reason, 500);
  if (entityType !== 'PURCHASE_RECEIPT' || LIFECYCLE_ENTITIES[entityType].archivePhase !== 'ARCHIVE_PHASE_1') {
    throw new HttpError(409, '当前业务类型尚未开放恢复', { code: 'RESTORE_BLOCKED' });
  }
  let result;
  transaction(db, () => {
    const receipt = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(entityId);
    if (!receipt) throw new HttpError(409, '采购入库原始记录不存在，不能恢复', { code: 'RESTORE_BLOCKED' });
    const current = archiveState(db, entityType, entityId);
    if (!current?.active || receipt.status !== 'CANCELLED') {
      throw new HttpError(409, '采购入库单当前不能恢复', { code: 'RESTORE_BLOCKED' });
    }
    const now = new Date().toISOString();
    const changed = db.prepare('UPDATE lifecycle_archives SET active=0,restored_by=?,restored_at=? WHERE entity_type=? AND entity_id=? AND active=1').run(actor.id, now, entityType, entityId);
    if (Number(changed.changes) !== 1) throw new HttpError(409, '采购入库单当前不能恢复', { code: 'RESTORE_BLOCKED' });
    audit(db, actor.id, 'RESTORE', entityType, entityId, `恢复 ${receipt.receipt_no} 到业务列表${reason ? `：${reason}` : ''}；status=CANCELLED；visibility=ARCHIVED->ACTIVE`);
    result = { ok: true, entityType, entityId, documentNo: receipt.receipt_no, archived: false, restoredAt: now };
  });
  return result;
}

function buildNode(db, entityType, entityId, selectedForCleanup, relationship = 'ROOT') {
  const rule = LIFECYCLE_ENTITIES[entityType];
  const row = rowFor(db, entityType, entityId);
  const inventoryEffect = inventoryEffects(db, entityType, entityId);
  const financeEffect = financeEffects(db, entityType, entityId);
  const status = String(row[rule.status] || '');
  const period = periodOf(row[rule.date] || row.created_at);
  const hasEffects = inventoryEffect.length > 0 || financeEffect.receivables.length > 0 || financeEffect.payables.length > 0 || financeEffect.vouchers.length > 0;
  const intrinsicFinancialEffect = (entityType === 'ACCOUNT_RECEIVABLE' || entityType === 'ACCOUNT_PAYABLE')
    && (Number(row.amount_cents || 0) !== 0 || Number(row.adjustment_cents || 0) !== 0 || Number(row.paid_cents || 0) !== 0);
  return {
    key: `${entityType}:${entityId}`,
    entityType,
    entityId,
    label: rule.label,
    documentNo: String(row[rule.number] || entityId),
    status,
    effective: Boolean(EFFECTIVE_STATUS_BY_TYPE[entityType]?.has(status) || hasEffects || intrinsicFinancialEffect),
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
    if (external) node.externalDependency = true;
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

    if (node.entityType === 'SALES_ORDER') {
      for (const delivery of db.prepare('SELECT id FROM sales_deliveries WHERE sales_order_id=?').all(node.entityId)) add('SALES_DELIVERY', delivery.id, selectedDownstream, 'GENERATED', node.key);
    }
    if (node.entityType === 'SALES_DELIVERY') {
      if (row.sales_order_id) add('SALES_ORDER', row.sales_order_id, false, 'SOURCE', node.key);
      for (const ret of db.prepare("SELECT id FROM return_orders WHERE delivery_id=? OR (source_type='SALES' AND source_id=?)").all(node.entityId, node.entityId)) add('SALES_RETURN', ret.id, selectedDownstream, 'GENERATED', node.key);
    }
    if (node.entityType === 'SALES_RETURN') {
      const deliveryId = row.delivery_id || (row.source_type === 'SALES' ? row.source_id : null);
      if (deliveryId) add('SALES_DELIVERY', deliveryId, false, 'SOURCE', node.key);
    }

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
    if (node.entityType === 'PURCHASE_RETURN' && row.receipt_id) add('PURCHASE_RECEIPT', row.receipt_id, false, 'SOURCE', node.key);
    if (node.entityType === 'PLANNING_FORECAST') {
      for (const run of db.prepare('SELECT id FROM mrp_runs WHERE forecast_id=?').all(node.entityId)) add('MRP_RUN', run.id, selectedDownstream, 'GENERATED', node.key);
    }
    if (node.entityType === 'MRP_RUN' && row.forecast_id) add('PLANNING_FORECAST', row.forecast_id, false, 'SOURCE', node.key);
    if (node.entityType === 'PRODUCTION_INSTRUCTION') {
      for (const item of db.prepare('SELECT production_order_id id FROM production_instruction_items WHERE instruction_id=? AND production_order_id IS NOT NULL').all(node.entityId)) add('PRODUCTION_ORDER', item.id, selectedDownstream, 'GENERATED', node.key);
    }
    if (node.entityType === 'PRODUCTION_ORDER') {
      for (const item of db.prepare('SELECT instruction_id FROM production_instruction_items WHERE production_order_id=?').all(node.entityId)) add('PRODUCTION_INSTRUCTION', item.instruction_id, false, 'SOURCE', node.key);
      for (const issue of db.prepare('SELECT id FROM production_material_issues WHERE production_order_id=?').all(node.entityId)) add('PRODUCTION_MATERIAL_ISSUE', issue.id, selectedDownstream, 'GENERATED', node.key);
      for (const receipt of db.prepare('SELECT id FROM production_receipts WHERE production_order_id=?').all(node.entityId)) add('PRODUCTION_RECEIPT', receipt.id, selectedDownstream, 'GENERATED', node.key);
    }
    if (node.entityType === 'PRODUCTION_MATERIAL_ISSUE' || node.entityType === 'PRODUCTION_RECEIPT') {
      if (row.production_order_id) add(
        'PRODUCTION_ORDER', row.production_order_id,
        includeExternal && node.externalDependency, 'SOURCE', node.key, node.externalDependency,
      );
    }

    // Generated accounting subledger and voucher records are part of the
    // selected cleanup graph. Settlement/discount dependants are external
    // until the administrator explicitly expands the scope.
    for (const receivable of node.financialEffect.receivables) add('ACCOUNT_RECEIVABLE', receivable.id, node.selectedForCleanup, 'GENERATED_AR', node.key);
    for (const payable of node.financialEffect.payables) add('ACCOUNT_PAYABLE', payable.id, node.selectedForCleanup, 'GENERATED_AP', node.key);
    for (const voucher of node.financialEffect.vouchers) add('ACCOUNTING_VOUCHER', voucher.id, node.selectedForCleanup, 'GENERATED_VOUCHER', node.key);

    if (node.entityType === 'ACCOUNT_RECEIVABLE') {
      for (const item of db.prepare('SELECT DISTINCT collection_id id FROM payment_collection_items WHERE receivable_id=?').all(node.entityId)) add('PAYMENT_COLLECTION', item.id, includeExternal, 'SETTLEMENT', node.key, true);
      for (const item of db.prepare('SELECT id FROM payment_collections WHERE receivable_id=?').all(node.entityId)) add('PAYMENT_COLLECTION', item.id, includeExternal, 'SETTLEMENT', node.key, true);
      for (const discount of db.prepare('SELECT id FROM sales_discounts WHERE source_receivable_id=?').all(node.entityId)) add('SALES_DISCOUNT', discount.id, includeExternal, 'DISCOUNT', node.key, true);
      const sourceType = SOURCE_ENTITY_TYPES[row.source_type] || (LIFECYCLE_ENTITIES[row.source_type] ? row.source_type : null);
      if (sourceType) add(sourceType, row.source_id, includeExternal, 'SOURCE', node.key, true);
    }
    if (node.entityType === 'ACCOUNT_PAYABLE') {
      for (const item of db.prepare('SELECT DISTINCT disbursement_id id FROM payment_disbursement_items WHERE payable_id=?').all(node.entityId)) add('PAYMENT_DISBURSEMENT', item.id, includeExternal, 'SETTLEMENT', node.key, true);
      for (const item of db.prepare('SELECT id FROM payment_disbursements WHERE payable_id=?').all(node.entityId)) add('PAYMENT_DISBURSEMENT', item.id, includeExternal, 'SETTLEMENT', node.key, true);
      for (const discount of db.prepare('SELECT id FROM purchase_discounts WHERE source_payable_id=?').all(node.entityId)) add('PURCHASE_DISCOUNT', discount.id, includeExternal, 'DISCOUNT', node.key, true);
      const sourceType = SOURCE_ENTITY_TYPES[row.source_type] || (LIFECYCLE_ENTITIES[row.source_type] ? row.source_type : null);
      if (sourceType) add(sourceType, row.source_id, includeExternal, 'SOURCE', node.key, true);
    }
    if (node.entityType === 'SALES_DISCOUNT' && row.source_receivable_id) add('ACCOUNT_RECEIVABLE', row.source_receivable_id, includeExternal, 'DISCOUNT_SOURCE', node.key, true);
    if (node.entityType === 'PURCHASE_DISCOUNT' && row.source_payable_id) add('ACCOUNT_PAYABLE', row.source_payable_id, includeExternal, 'DISCOUNT_SOURCE', node.key, true);
    if (node.entityType === 'PAYMENT_COLLECTION') {
      for (const item of db.prepare('SELECT receivable_id id FROM payment_collection_items WHERE collection_id=?').all(node.entityId)) add('ACCOUNT_RECEIVABLE', item.id, includeExternal, 'SETTLES', node.key, true);
    }
    if (node.entityType === 'PAYMENT_DISBURSEMENT') {
      for (const item of db.prepare('SELECT payable_id id FROM payment_disbursement_items WHERE disbursement_id=?').all(node.entityId)) add('ACCOUNT_PAYABLE', item.id, includeExternal, 'SETTLES', node.key, true);
    }
    if (node.entityType === 'ACCOUNTING_VOUCHER') {
      const sourceType = SOURCE_ENTITY_TYPES[row.source_type] || (LIFECYCLE_ENTITIES[row.source_type] ? row.source_type : null);
      if (sourceType && !(sourceType === 'ACCOUNTING_VOUCHER' && row.source_id === node.entityId)) add(sourceType, row.source_id, includeExternal, 'SOURCE', node.key, true);
    }

    // Conservative stock provenance: without lots, any later outbound movement
    // for the same warehouse/product may consume this inbound quantity. It is
    // safer to block a partial cleanup than to guess provenance.
    for (const effect of node.inventoryEffect.filter((item) => item.quantityChange > 0)) {
      const consumers = db.prepare(`
        SELECT source_type,source_id,source_no,created_at
        FROM inventory_transactions
        WHERE warehouse_id=? AND product_id=? AND direction='OUT' AND rowid>?
        ORDER BY rowid
      `).all(effect.warehouseId, effect.productId, effect.ledgerSequence);
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
  const requestedType = normalizeEntityType(url.searchParams.get('entityType'));
  if (requestedType === 'PURCHASE_RECEIPT') {
    const archiveEligibility = analyzeArchiveEligibility(db, actor, requestedType, url.searchParams.get('entityId'));
    return send(res, 200, { archiveEligibility });
  }
  allow(actor, 'USERS_MANAGE');
  const graph = analyzeLifecycleGraph(db, {
    entityType: requestedType,
    entityId: url.searchParams.get('entityId'),
    includeExternal: url.searchParams.get('includeExternal') === 'true',
  });
  return send(res, 200, { graph });
}

export async function archiveLifecycleRecord(db, req, res, actor) {
  const body = await readJson(req);
  const entityType = normalizeEntityType(body.entityType);
  if (entityType === 'PURCHASE_RECEIPT') {
    return send(res, 200, archiveCancelledDocument(db, actor, { ...body, entityType }));
  }
  allow(actor, 'USERS_MANAGE');
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
  const body = await readJson(req);
  const entityType = normalizeEntityType(body.entityType);
  if (entityType === 'PURCHASE_RECEIPT') {
    return send(res, 200, restoreArchivedDocument(db, actor, { ...body, entityType }));
  }
  allow(actor, 'USERS_MANAGE');
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

function isLifecycleArchived(db, entityType, entityId) {
  const type = normalizeEntityType(entityType);
  return Boolean(db.prepare('SELECT 1 FROM lifecycle_archives WHERE entity_type=? AND entity_id=? AND active=1').get(type, entityId));
}

export function lifecycleArchiveClause(entityType, idExpression = 'id') {
  const type = normalizeEntityType(entityType);
  return `NOT EXISTS (SELECT 1 FROM lifecycle_archives la WHERE la.entity_type='${type}' AND la.entity_id=${idExpression} AND la.active=1)`;
}

// Canonical business-list filter. Entity types are resolved from the fixed
// registry; no client-provided table or column name reaches SQL.
export function lifecycleArchiveFilter(entityType, { includeArchived = false, idExpression = 'id' } = {}) {
  const type = normalizeEntityType(entityType);
  return includeArchived
    ? { clause: '', entityType: type }
    : { clause: lifecycleArchiveClause(type, idExpression), entityType: type };
}

function lifecycleRecordSummary(row, entityType) {
  const rule = LIFECYCLE_ENTITIES[entityType];
  return {
    entityType,
    entityId: row.id,
    label: rule.label,
    documentNo: String(row[rule.number] || row.id),
    status: String(row[rule.status] || ''),
    businessDate: row[rule.date] || row.created_at || null,
    period: periodOf(row[rule.date] || row.created_at),
    archived: row.archive_active === 1,
    archiveReason: row.archive_active === 1 ? row.archive_reason || '' : '',
    archivedAt: row.archive_active === 1 ? row.archive_archived_at : null,
    archivedBy: row.archive_active === 1 ? row.archive_archived_by : null,
  };
}

function listLifecycleRecords(db, actor, query = {}) {
  allow(actor, 'USERS_MANAGE');
  const requestedType = query.entityType ? normalizeEntityType(query.entityType) : null;
  const search = String(query.search || '').trim();
  const includeArchived = query.includeArchived === true;
  const limit = Math.max(1, Math.min(200, Number(query.limit) || 60));
  const types = requestedType ? [requestedType] : Object.keys(LIFECYCLE_ENTITIES);
  const records = [];

  for (const entityType of types) {
    const rule = LIFECYCLE_ENTITIES[entityType];
    const where = [];
    const params = [entityType];
    if (search) {
      where.push(`(t.${rule.number} LIKE ? OR t.id LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`);
    }
    if (!includeArchived) {
      where.push('la.entity_id IS NULL');
    }
    const rows = db.prepare(`
      SELECT t.*,la.active archive_active,la.reason archive_reason,
             la.archived_at archive_archived_at,la.archived_by archive_archived_by
        FROM ${rule.table} t
        LEFT JOIN lifecycle_archives la
          ON la.entity_type=? AND la.entity_id=t.id AND la.active=1
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY t.${rule.date} DESC,t.id DESC
       LIMIT ${limit}
    `).all(...params);
    records.push(...rows.map((row) => lifecycleRecordSummary(row, entityType)));
  }

  records.sort((left, right) => String(right.businessDate || '').localeCompare(String(left.businessDate || ''))
    || right.documentNo.localeCompare(left.documentNo));
  return {
    records: records.slice(0, limit),
    total: records.length,
    entityTypes: Object.entries(LIFECYCLE_ENTITIES).map(([key, rule]) => ({ key, label: rule.label })),
  };
}

export function listLifecycleRecordsHandler(db, res, actor, url) {
  return send(res, 200, listLifecycleRecords(db, actor, {
    entityType: url.searchParams.get('entityType'),
    search: url.searchParams.get('search'),
    includeArchived: url.searchParams.get('includeArchived') === 'true',
    limit: url.searchParams.get('limit'),
  }));
}

function parseAuditJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function listCleanupEvents(db, actor, query = {}) {
  allow(actor, 'USERS_MANAGE');
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 30));
  const search = String(query.search || '').trim();
  const entityType = query.entityType ? normalizeEntityType(query.entityType) : '';
  const where = [];
  const params = [];
  if (search) {
    where.push('(ce.root_document_no LIKE ? OR ce.reason LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (entityType) { where.push('ce.root_entity_type=?'); params.push(entityType); }
  const rows = db.prepare(`
    SELECT ce.*,u.display_name actor_name,u.username actor_username
      FROM cleanup_events ce LEFT JOIN users u ON u.id=ce.actor_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ce.created_at DESC LIMIT ${limit}
  `).all(...params);
  const itemQuery = db.prepare('SELECT * FROM cleanup_event_items WHERE cleanup_event_id=? ORDER BY entity_type,document_no');
  return {
    events: rows.map((row) => ({
      id: row.id,
      rootEntityType: row.root_entity_type,
      rootEntityId: row.root_entity_id,
      rootDocumentNo: row.root_document_no,
      actor: { id: row.actor_id, displayName: row.actor_name || row.actor_username || row.actor_id },
      reason: row.reason,
      classification: row.classification,
      affectedEntityTypes: parseAuditJson(row.affected_entity_types, []),
      affectedEntityIds: parseAuditJson(row.affected_entity_ids, []),
      affectedDocumentNumbers: parseAuditJson(row.affected_document_numbers, []),
      inventoryEffects: parseAuditJson(row.inventory_effects, []),
      financeEffects: parseAuditJson(row.finance_effects, []),
      voucherEffects: parseAuditJson(row.voucher_effects, []),
      periods: parseAuditJson(row.periods, []),
      successState: row.success_state,
      createdAt: row.created_at,
      items: itemQuery.all(row.id).map((item) => ({
        id: item.id, entityType: item.entity_type, entityId: item.entity_id,
        documentNo: item.document_no, status: item.status, effective: item.effective === 1,
        inventoryEffect: parseAuditJson(item.inventory_effect, []),
        financeEffect: parseAuditJson(item.finance_effect, {}), period: item.period,
      })),
    })),
    total: rows.length,
  };
}

export function listCleanupEventsHandler(db, res, actor, url) {
  return send(res, 200, listCleanupEvents(db, actor, {
    search: url.searchParams.get('search'),
    entityType: url.searchParams.get('entityType'),
    limit: url.searchParams.get('limit'),
  }));
}

function createCleanupAudit(db, actor, graph, reason) {
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

function selectedIds(graph, entityType) {
  return graph.nodes.filter((node) => node.selectedForCleanup && node.entityType === entityType).map((node) => node.entityId);
}

function eachSelected(graph, entityType, callback) {
  for (const entityId of selectedIds(graph, entityType)) callback(entityId);
}

function assertInventorySafety(db, graph) {
  const groups = new Map();
  for (const node of graph.nodes.filter((item) => item.selectedForCleanup)) {
    for (const effect of node.inventoryEffect) {
      const key = `${effect.warehouseId}:${effect.productId}`;
      const group = groups.get(key) || { warehouseId: effect.warehouseId, productId: effect.productId, removedChange: 0, transactionIds: [] };
      group.removedChange += Number(effect.quantityChange);
      group.transactionIds.push(effect.id);
      groups.set(key, group);
    }
  }
  for (const group of groups.values()) {
    const inventory = db.prepare('SELECT id,quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(group.warehouseId, group.productId);
    const current = Number(inventory?.quantity || 0);
    group.currentQuantity = current;
    group.resultingQuantity = current - group.removedChange;
    if (group.resultingQuantity < -1e-9) {
      throw new HttpError(409, '清理后库存将变为负数，当前业务链不能安全清理', {
        code: 'NEGATIVE_INVENTORY', warehouseId: group.warehouseId, productId: group.productId,
        currentQuantity: current, resultingQuantity: group.resultingQuantity,
      });
    }
    if (!inventory && Math.abs(group.resultingQuantity) > 1e-9) {
      throw new HttpError(409, '库存台账缺少对应余额，当前业务链不能安全清理', { code: 'INVENTORY_BALANCE_MISSING' });
    }
  }
  return [...groups.values()];
}

function assertVoucherSafety(db, graph) {
  for (const voucherId of selectedIds(graph, 'ACCOUNTING_VOUCHER')) {
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount_cents ELSE 0 END),0) debit,
        COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount_cents ELSE 0 END),0) credit
      FROM accounting_entries WHERE voucher_id=?
    `).get(voucherId);
    if (Number(totals.debit) !== Number(totals.credit)) {
      throw new HttpError(409, '关联凭证借贷不平，必须先修复凭证后才能清理', { code: 'VOUCHER_UNBALANCED', voucherId });
    }
  }
}

function applyInventoryCleanup(db, groups, actorId) {
  const remove = db.prepare('DELETE FROM inventory_transactions WHERE id=?');
  const updateBalance = db.prepare('UPDATE inventory_transactions SET balance_after=? WHERE id=?');
  for (const group of groups) {
    for (const transactionId of group.transactionIds) remove.run(transactionId);
    db.prepare('UPDATE inventory SET quantity=?,updated_at=? WHERE warehouse_id=? AND product_id=?')
      .run(Math.max(0, group.resultingQuantity), new Date().toISOString(), group.warehouseId, group.productId);

    const remaining = db.prepare(`
      SELECT id,quantity_change,direction FROM inventory_transactions
      WHERE warehouse_id=? AND product_id=? ORDER BY rowid
    `).all(group.warehouseId, group.productId);
    const signedChange = (row) => row.direction === 'OUT' ? -Number(row.quantity_change) : Number(row.quantity_change);
    const remainingChange = remaining.reduce((sum, row) => sum + signedChange(row), 0);
    let running = group.resultingQuantity - remainingChange;
    for (const row of remaining) {
      running += signedChange(row);
      updateBalance.run(running, row.id);
    }
    audit(db, actorId, 'REVERSE', 'INVENTORY', `${group.warehouseId}:${group.productId}`, `错误业务链清理后库存 ${group.resultingQuantity}`);
  }
}

function unlinkSelectedGraph(db, graph) {
  eachSelected(graph, 'SALES_ORDER', (entityId) => {
    db.prepare('UPDATE sales_deliveries SET sales_order_id=NULL WHERE sales_order_id=?').run(entityId);
  });
  eachSelected(graph, 'PURCHASE_ORDER', (entityId) => {
    db.prepare('UPDATE purchase_requisitions SET purchase_order_id=NULL WHERE purchase_order_id=?').run(entityId);
    db.prepare('UPDATE purchase_receipts SET purchase_order_id=NULL WHERE purchase_order_id=?').run(entityId);
  });
  eachSelected(graph, 'PURCHASE_REQUISITION', (entityId) => {
    db.prepare('UPDATE purchase_instruction_items SET purchase_requisition_id=NULL WHERE purchase_requisition_id=?').run(entityId);
  });
  eachSelected(graph, 'PURCHASE_INSTRUCTION', (entityId) => {
    db.prepare('UPDATE purchase_requisitions SET source_instruction_id=NULL WHERE source_instruction_id=?').run(entityId);
    db.prepare(`
      UPDATE purchase_requisition_items SET purchase_instruction_item_id=NULL
      WHERE purchase_instruction_item_id IN (SELECT id FROM purchase_instruction_items WHERE instruction_id=?)
    `).run(entityId);
  });
  eachSelected(graph, 'PURCHASE_RECEIPT', (entityId) => {
    db.prepare('UPDATE purchase_returns SET receipt_id=NULL WHERE receipt_id=?').run(entityId);
  });
  eachSelected(graph, 'PRODUCTION_ORDER', (entityId) => {
    db.prepare('UPDATE production_instruction_items SET production_order_id=NULL WHERE production_order_id=?').run(entityId);
  });
}

function deleteSelectedGraph(db, graph) {
  // Settlement and finance dependencies are removed before the subledger rows
  // they reference. Generated vouchers are always removed as balanced units.
  eachSelected(graph, 'PAYMENT_COLLECTION', (entityId) => {
    db.prepare('DELETE FROM payment_collection_items WHERE collection_id=?').run(entityId);
    db.prepare('DELETE FROM payment_collections WHERE id=?').run(entityId);
  });
  eachSelected(graph, 'PAYMENT_DISBURSEMENT', (entityId) => {
    db.prepare('DELETE FROM payment_disbursement_items WHERE disbursement_id=?').run(entityId);
    db.prepare('DELETE FROM payment_disbursements WHERE id=?').run(entityId);
  });
  eachSelected(graph, 'SALES_DISCOUNT', (entityId) => db.prepare('DELETE FROM sales_discounts WHERE id=?').run(entityId));
  eachSelected(graph, 'PURCHASE_DISCOUNT', (entityId) => db.prepare('DELETE FROM purchase_discounts WHERE id=?').run(entityId));
  eachSelected(graph, 'ACCOUNTING_VOUCHER', (entityId) => {
    db.prepare('DELETE FROM accounting_entries WHERE voucher_id=?').run(entityId);
    db.prepare('DELETE FROM accounting_vouchers WHERE id=?').run(entityId);
  });
  eachSelected(graph, 'ACCOUNT_RECEIVABLE', (entityId) => db.prepare('DELETE FROM account_receivables WHERE id=?').run(entityId));
  eachSelected(graph, 'ACCOUNT_PAYABLE', (entityId) => db.prepare('DELETE FROM account_payables WHERE id=?').run(entityId));

  const deleteChildren = (type, childTable, foreignKey, table) => eachSelected(graph, type, (entityId) => {
    db.prepare(`DELETE FROM ${childTable} WHERE ${foreignKey}=?`).run(entityId);
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(entityId);
  });
  // Phase 3 quality evidence is a dependent of the logistics document. The
  // emergency lifecycle cleanup is the only path allowed to remove completed
  // evidence, so remove it explicitly before its FK-backed source rows.
  eachSelected(graph, 'PURCHASE_RECEIPT', (entityId) => {
    const ids = db.prepare('SELECT id FROM iqc_inspections WHERE purchase_receipt_id=?').all(entityId);
    for (const row of ids) db.prepare('DELETE FROM iqc_inspection_items WHERE iqc_id=?').run(row.id);
    db.prepare('DELETE FROM iqc_inspections WHERE purchase_receipt_id=?').run(entityId);
  });
  eachSelected(graph, 'SALES_DELIVERY', (entityId) => {
    const ids = db.prepare('SELECT id FROM oqc_inspections WHERE sales_delivery_id=?').all(entityId);
    for (const row of ids) db.prepare('DELETE FROM oqc_inspection_items WHERE oqc_id=?').run(row.id);
    db.prepare('DELETE FROM oqc_inspections WHERE sales_delivery_id=?').run(entityId);
  });
  deleteChildren('SALES_RETURN', 'return_order_items', 'return_id', 'return_orders');
  deleteChildren('PURCHASE_RETURN', 'purchase_return_items', 'return_id', 'purchase_returns');
  deleteChildren('PRODUCTION_MATERIAL_ISSUE', 'production_material_issue_items', 'issue_id', 'production_material_issues');
  eachSelected(graph, 'PRODUCTION_RECEIPT', (entityId) => db.prepare('DELETE FROM production_receipts WHERE id=?').run(entityId));
  deleteChildren('PURCHASE_RECEIPT', 'purchase_receipt_items', 'receipt_id', 'purchase_receipts');
  deleteChildren('SALES_DELIVERY', 'sales_delivery_items', 'delivery_id', 'sales_deliveries');
  deleteChildren('INVENTORY_ADJUSTMENT', 'inventory_adjustment_items', 'adjustment_id', 'inventory_adjustments');
  deleteChildren('INVENTORY_TRANSFER', 'inventory_transfer_items', 'transfer_id', 'inventory_transfers');
  deleteChildren('INVENTORY_SCRAP', 'inventory_scrap_items', 'scrap_id', 'inventory_scraps');
  deleteChildren('INVENTORY_CHECK', 'inventory_check_items', 'check_id', 'inventory_checks');
  deleteChildren('PURCHASE_REQUISITION', 'purchase_requisition_items', 'requisition_id', 'purchase_requisitions');
  deleteChildren('PURCHASE_ORDER', 'purchase_order_items', 'order_id', 'purchase_orders');
  deleteChildren('PURCHASE_INSTRUCTION', 'purchase_instruction_items', 'instruction_id', 'purchase_instructions');
  deleteChildren('PRODUCTION_ORDER', 'production_order_items', 'order_id', 'production_orders');
  deleteChildren('PRODUCTION_INSTRUCTION', 'production_instruction_items', 'instruction_id', 'production_instructions');
  deleteChildren('SALES_ORDER', 'sales_order_items', 'order_id', 'sales_orders');
  deleteChildren('PLANNING_FORECAST', 'planning_forecast_items', 'forecast_id', 'planning_forecasts');
  eachSelected(graph, 'MRP_RUN', (entityId) => {
    for (const table of ['mrp_run_pegging', 'mrp_run_components', 'mrp_run_results', 'mrp_run_demands']) db.prepare(`DELETE FROM ${table} WHERE run_id=?`).run(entityId);
    db.prepare('DELETE FROM mrp_runs WHERE id=?').run(entityId);
  });

  for (const node of graph.nodes.filter((item) => item.selectedForCleanup)) {
    db.prepare('DELETE FROM approval_requests WHERE source_type=? AND source_id=?').run(node.entityType, node.entityId);
    db.prepare('DELETE FROM lifecycle_archives WHERE entity_type=? AND entity_id=?').run(node.entityType, node.entityId);
  }
}

export function cleanupLifecycleGraph(db, actor, input, options = {}) {
  allow(actor, 'USERS_MANAGE');
  const entityType = normalizeEntityType(input.entityType);
  const entityId = requiredText(input.entityId, '业务记录', 100);
  const reason = requiredText(input.reason, '清理原因', 500);
  if (input.confirm !== true) throw new HttpError(400, '请明确确认清理错误业务链', { code: 'CLEANUP_CONFIRMATION_REQUIRED' });

  return transaction(db, () => {
    const graph = analyzeLifecycleGraph(db, { entityType, entityId, includeExternal: input.includeExternal === true });
    const unsafe=graph.nodes.filter((node)=>node.selectedForCleanup).filter((node)=>!['DRAFT','CANCELLED'].includes(node.status)||node.effective||node.inventoryEffect.length||node.financialEffect.receivables.length||node.financialEffect.payables.length||node.financialEffect.vouchers.length);
    if(unsafe.length)throw new HttpError(409,'Phase 6D 禁止清理已确认、已过账或已有业务效果的记录；请使用领域冲销/退货',{code:'EFFECTIVE_CLEANUP_DISABLED',records:unsafe.map(x=>x.key)});
    if (graph.classification === 'BLOCKED') {
      throw new HttpError(409, graph.blockers[0]?.message || '当前业务链不能安全清理', { code: 'LIFECYCLE_CLEANUP_BLOCKED', blockers: graph.blockers });
    }
    if (graph.classification === 'ARCHIVE_ONLY') {
      throw new HttpError(409, '当前记录只能归档，不能物理清理', { code: 'LIFECYCLE_ARCHIVE_ONLY' });
    }

    const inventoryGroups = assertInventorySafety(db, graph);
    assertVoucherSafety(db, graph);
    const cleanupId = createCleanupAudit(db, actor, graph, reason);
    applyInventoryCleanup(db, inventoryGroups, actor.id);
    if (options.failAfterEffects) throw new Error('SIMULATED_LIFECYCLE_FAILURE');
    unlinkSelectedGraph(db, graph);
    deleteSelectedGraph(db, graph);
    audit(db, actor.id, 'CLEANUP', graph.root.entityType, graph.root.entityId, `清理错误业务链 ${cleanupId}：${reason}`);
    return { cleanupId, graph };
  });
}

export async function executeLifecycleCleanup(db, req, res, actor) {
  const body = await readJson(req);
  const result = cleanupLifecycleGraph(db, actor, body);
  return send(res, 200, {
    ok: true,
    cleanupEventId: result.cleanupId,
    classification: result.graph.classification,
    affectedRecords: result.graph.summary.selectedRecords,
  });
}
