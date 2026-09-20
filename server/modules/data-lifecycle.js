import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { allow, HttpError, send } from '../lib/http.js';

const MASTER_RULES = {
  customer: {
    table: 'customers', permission: 'CUSTOMERS_MANAGE', entity: 'CUSTOMER', label: '客户',
    dependencies: [
      ['account_receivables', 'customer_id'], ['accounting_entries', 'customer_id'], ['contacts', 'customer_id'],
      ['customer_followups', 'customer_id'], ['oqc_inspections', 'customer_id'], ['payment_collections', 'customer_id'],
      ['projects', 'customer_id'], ['return_orders', 'customer_id'], ['sales_deliveries', 'customer_id'],
      ['sales_discounts', 'customer_id'], ['sales_orders', 'customer_id'],
    ],
  },
  supplier: {
    table: 'suppliers', permission: 'SUPPLIERS_MANAGE', entity: 'SUPPLIER', label: '供应商',
    dependencies: [
      ['account_payables', 'supplier_id'], ['accounting_entries', 'supplier_id'], ['contacts', 'supplier_id'],
      ['iqc_inspections', 'supplier_id'], ['payment_disbursements', 'supplier_id'], ['purchase_discounts', 'supplier_id'],
      ['purchase_orders', 'supplier_id'], ['purchase_receipts', 'supplier_id'], ['purchase_requisition_items', 'preferred_supplier_id'],
      ['purchase_returns', 'supplier_id'], ['return_orders', 'supplier_id'], ['supplier_evaluations', 'supplier_id'],
    ],
  },
  product: {
    table: 'products', permission: 'PRODUCTS_MANAGE', entity: 'PRODUCT', label: '货品',
    dependencies: [
      ['bom_items', 'product_id'], ['boms', 'product_id'], ['inventory', 'product_id'],
      ['inventory_adjustment_items', 'product_id'], ['inventory_check_items', 'product_id'], ['inventory_checks', 'product_id'],
      ['inventory_period_snapshots', 'product_id'], ['inventory_scrap_items', 'product_id'], ['inventory_transactions', 'product_id'],
      ['inventory_transfer_items', 'product_id'], ['iqc_inspection_items', 'product_id'], ['mrp_plan_items', 'product_id'],
      ['mrp_run_components', 'product_id'], ['mrp_run_demands', 'product_id'], ['mrp_run_pegging', 'product_id'],
      ['mrp_run_results', 'product_id'], ['oqc_inspection_items', 'product_id'], ['planning_forecast_items', 'product_id'],
      ['product_costs', 'product_id'], ['product_routings', 'product_id'], ['production_instruction_items', 'product_id'],
      ['production_material_issue_items', 'product_id'], ['production_order_items', 'product_id'], ['production_orders', 'product_id'],
      ['purchase_instruction_items', 'product_id'], ['purchase_order_items', 'product_id'], ['purchase_receipt_items', 'product_id'],
      ['purchase_requisition_items', 'product_id'], ['purchase_return_items', 'product_id'], ['return_order_items', 'product_id'],
      ['sales_delivery_items', 'product_id'], ['sales_order_items', 'product_id'],
    ],
    extraReferenced: (row) => Number(row.stock_quantity || 0) !== 0,
  },
  warehouse: {
    table: 'warehouses', permission: 'WAREHOUSES_MANAGE', entity: 'WAREHOUSE', label: '仓库',
    dependencies: [
      ['inventory', 'warehouse_id'], ['inventory_adjustments', 'warehouse_id'], ['inventory_checks', 'warehouse_id'],
      ['inventory_period_snapshots', 'warehouse_id'], ['inventory_scrap_items', 'warehouse_id'], ['inventory_transactions', 'warehouse_id'],
      ['inventory_transfers', 'from_warehouse_id'], ['inventory_transfers', 'to_warehouse_id'],
      ['production_material_issues', 'warehouse_id'], ['production_receipts', 'warehouse_id'], ['purchase_receipts', 'warehouse_id'],
      ['purchase_returns', 'warehouse_id'], ['return_orders', 'warehouse_id'], ['sales_deliveries', 'warehouse_id'],
    ],
  },
  bom: {
    table: 'boms', permission: 'PRODUCTION_ORDERS_CREATE', entity: 'BOM', label: 'BOM', requiredStatus: 'DISCONTINUED',
    dependencies: [['production_instruction_items', 'bom_id'], ['production_orders', 'bom_id'], ['routing_operations', 'bom_id']],
    children: [['bom_items', 'bom_id']],
  },
  routing: {
    table: 'product_routings', permission: 'ROUTING_MANAGE', entity: 'PRODUCT_ROUTING', label: '工艺路线', requiredStatus: 'INACTIVE',
    dependencies: [['production_instruction_items', 'routing_id']],
    children: [['product_routing_operations', 'routing_id']],
  },
};

function exists(db, table, column, value, extra = '') {
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=? ${extra} LIMIT 1`).get(value));
}

function referenced(db, dependencies, value) {
  return dependencies.some(([table, column, extra = '']) => exists(db, table, column, value, extra));
}

export function deleteMasterRecord(db, res, actor, kind, recordId) {
  const rule = MASTER_RULES[kind];
  if (!rule) throw new HttpError(404, '数据类型不存在');
  allow(actor, rule.permission);
  const current = db.prepare(`SELECT * FROM ${rule.table} WHERE id=?`).get(recordId);
  if (!current) throw new HttpError(404, `${rule.label}不存在`);
  if (rule.requiredStatus && current.status !== rule.requiredStatus) {
    throw new HttpError(409, `${rule.label}必须先停用后才能删除`, { code: 'RECORD_MUST_BE_INACTIVE' });
  }
  if (rule.extraReferenced?.(current) || referenced(db, rule.dependencies, recordId)) {
    throw new HttpError(409, `${rule.label}已有业务引用，不能删除；可将其停用以保留历史记录`, { code: 'RECORD_REFERENCED' });
  }
  transaction(db, () => {
    for (const [table, column] of rule.children || []) db.prepare(`DELETE FROM ${table} WHERE ${column}=?`).run(recordId);
    db.prepare(`DELETE FROM ${rule.table} WHERE id=?`).run(recordId);
    audit(db, actor.id, 'DELETE', rule.entity, recordId, current.code || current.name || current.version || '删除未引用记录');
  });
  return send(res, 200, { ok: true });
}

const DOCUMENT_RULES = {
  salesOrder: {
    table: 'sales_orders', permission: 'ORDERS_CREATE', entity: 'SALES_ORDER', label: '销售订单', number: 'order_no',
    children: [['sales_order_items', 'order_id']],
    downstream: [
      ['sales_deliveries', 'sales_order_id'], ['mrp_run_demands', 'source_id', "AND source_type='SALES_ORDER'"],
      ['mrp_plan_items', 'demand_source_id', "AND demand_type='SALES_ORDER'"],
    ],
  },
  purchaseOrder: {
    table: 'purchase_orders', permission: 'PURCHASE_ORDERS_CREATE', entity: 'PURCHASE_ORDER', label: '采购订单', number: 'order_no',
    children: [['purchase_order_items', 'order_id']],
    downstream: [['purchase_receipts', 'purchase_order_id'], ['purchase_requisitions', 'purchase_order_id']],
  },
  purchaseRequisition: {
    table: 'purchase_requisitions', permission: 'PURCHASE_REQUISITION_MANAGE', entity: 'PURCHASE_REQUISITION', label: '请购单', number: 'requisition_no',
    children: [['purchase_requisition_items', 'requisition_id']],
    downstream: [['purchase_instruction_items', 'purchase_requisition_id']],
    extraDownstream: (db, row) => Boolean(row.source_instruction_id || row.purchase_order_id) || exists(db, 'purchase_requisition_items', 'requisition_id', row.id, 'AND purchase_instruction_item_id IS NOT NULL'),
  },
  forecast: {
    table: 'planning_forecasts', permission: 'MRP_MANAGE', entity: 'PLANNING_FORECAST', label: '预测单', number: 'forecast_code',
    children: [['planning_forecast_items', 'forecast_id']],
    downstream: [['mrp_runs', 'forecast_id']],
  },
  inventoryAdjustment: {
    table: 'inventory_adjustments', permission: 'INVENTORY_ADJUSTMENT_MANAGE', entity: 'INVENTORY_ADJUSTMENT', label: '库存调整单', number: 'adjustment_no',
    children: [['inventory_adjustment_items', 'adjustment_id']],
    downstream: [],
  },
};

function hasSideEffects(db, entity, recordId) {
  const sourceTypes = {
    SALES_ORDER: ['SALES_ORDER'], PURCHASE_ORDER: ['PURCHASE_ORDER'], PURCHASE_REQUISITION: ['PURCHASE_REQUISITION'],
    PLANNING_FORECAST: ['PLANNING_FORECAST', 'FORECAST'], INVENTORY_ADJUSTMENT: ['INVENTORY_ADJUSTMENT'],
  }[entity] || [];
  return sourceTypes.some((sourceType) =>
    exists(db, 'inventory_transactions', 'source_id', recordId, 'AND source_type=?'.replace('?', `'${sourceType}'`)) ||
    exists(db, 'accounting_vouchers', 'source_id', recordId, 'AND source_type=?'.replace('?', `'${sourceType}'`)) ||
    exists(db, 'account_receivables', 'source_id', recordId, 'AND source_type=?'.replace('?', `'${sourceType}'`)) ||
    exists(db, 'account_payables', 'source_id', recordId, 'AND source_type=?'.replace('?', `'${sourceType}'`))
  );
}

export function deleteDraftDocument(db, res, actor, kind, recordId) {
  const rule = DOCUMENT_RULES[kind];
  if (!rule) throw new HttpError(404, '单据类型不存在');
  allow(actor, rule.permission);
  const current = db.prepare(`SELECT * FROM ${rule.table} WHERE id=?`).get(recordId);
  if (!current) throw new HttpError(404, `${rule.label}不存在`);
  if (current.status !== 'DRAFT') {
    throw new HttpError(409, `只有草稿状态的${rule.label}可以删除`, { code: 'DOCUMENT_NOT_DRAFT' });
  }
  if (rule.extraDownstream?.(db, current) || referenced(db, rule.downstream, recordId) || hasSideEffects(db, rule.entity, recordId)) {
    throw new HttpError(409, `${rule.label}已有下游业务或过账痕迹，不能删除`, { code: 'DOCUMENT_HAS_DOWNSTREAM' });
  }
  transaction(db, () => {
    for (const [table, column] of rule.children) db.prepare(`DELETE FROM ${table} WHERE ${column}=?`).run(recordId);
    db.prepare(`DELETE FROM ${rule.table} WHERE id=?`).run(recordId);
    audit(db, actor.id, 'DELETE', rule.entity, recordId, current[rule.number] || '删除草稿');
  });
  return send(res, 200, { ok: true });
}
