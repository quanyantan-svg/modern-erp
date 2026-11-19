import { allowAny } from '../lib/http.js';
import { readWorkReferenceInput, referenceItem, sendWorkReferencePage } from '../lib/work-reference.js';

const KINDS = new Set(['SALES_ORDER', 'SALES_ORDER_ITEM', 'PRODUCT', 'WAREHOUSE', 'PLANNED_ORDER', 'PURCHASE_ORDER', 'PRODUCTION_ORDER']);

function salesScope(db, actor, alias = 'so') {
  if (actor.roleCode === 'ADMIN') return { sql: '1=1', args: [] };
  const salesperson = db.prepare('SELECT id FROM salesperson_profiles WHERE user_id=?').get(actor.id);
  if (!salesperson) return { sql: `${alias}.sales_group_id IS NULL`, args: [] };
  return {
    sql: `(${alias}.sales_group_id IS NULL OR EXISTS (SELECT 1 FROM salesperson_group_memberships sgm WHERE sgm.salesperson_id=? AND sgm.sales_group_id=${alias}.sales_group_id AND sgm.active=1))`,
    args: [salesperson.id],
  };
}

function relation(db, actor, input, url) {
  const scope = salesScope(db, actor);
  if (input.kind === 'SALES_ORDER') return {
    identity: 'so.id', columns: 'so.id,so.order_no code,c.name,so.status secondaryText,1 active',
    from: 'FROM sales_orders so JOIN customers c ON c.id=so.customer_id', where: [scope.sql], args: scope.args,
    search: ['so.order_no', 'c.code', 'c.name'], order: 'so.updated_at DESC,so.id', toItem: referenceItem,
  };
  if (input.kind === 'SALES_ORDER_ITEM') {
    const orderId = String(url.searchParams.get('salesOrderId') || '').trim();
    return {
      identity: 'i.id', columns: 'i.id,i.line_no,p.code product_code,p.name,i.quantity,1 active',
      from: 'FROM sales_order_items i JOIN sales_orders so ON so.id=i.order_id JOIN products p ON p.id=i.product_id',
      where: [scope.sql, 'i.order_id=?'], args: [...scope.args, orderId], search: ['p.code', 'p.name'], order: 'i.line_no,i.id',
      toItem: (row) => referenceItem({ ...row, code: `第 ${row.line_no} 行 · ${row.product_code}`, secondaryText: `数量 ${row.quantity}` }),
    };
  }
  if (input.kind === 'PRODUCT') return {
    identity: 'p.id', columns: "p.id,p.code,p.name,p.unit secondaryText,p.active", from: 'FROM products p', where: ['p.active=1'], args: [],
    search: ['p.code', 'p.name'], order: 'p.code,p.id', toItem: referenceItem,
  };
  if (input.kind === 'WAREHOUSE') return {
    identity: 'w.id', columns: "w.id,w.code,w.name,'仓库' secondaryText,w.active", from: 'FROM warehouses w', where: ['w.active=1'], args: [],
    search: ['w.code', 'w.name'], order: 'w.code,w.id', toItem: referenceItem,
  };
  if (input.kind === 'PLANNED_ORDER') return {
    identity: 'po.id', columns: "po.id,po.order_no code,p.name,po.status secondaryText,CASE WHEN po.status='CONFIRMED' THEN 1 ELSE 0 END active",
    from: 'FROM planned_orders po JOIN products p ON p.id=po.product_id', where: ["po.status='CONFIRMED'"], args: [],
    search: ['po.order_no', 'p.code', 'p.name'], order: 'po.updated_at DESC,po.id', toItem: referenceItem,
  };
  if (input.kind === 'PURCHASE_ORDER') return {
    identity: 'po.id', columns: "po.id,po.order_no code,s.name,po.status secondaryText,CASE WHEN po.status='APPROVED' THEN 1 ELSE 0 END active",
    from: 'FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id', where: ["po.status='APPROVED'"], args: [],
    search: ['po.order_no', 's.code', 's.name'], order: 'po.updated_at DESC,po.id', toItem: referenceItem,
  };
  return {
    identity: 'mo.id', columns: "mo.id,mo.order_no code,p.name,mo.status secondaryText,CASE WHEN mo.status IN ('RELEASED','IN_PROGRESS') THEN 1 ELSE 0 END active",
    from: 'FROM production_orders mo JOIN products p ON p.id=mo.product_id', where: ["mo.status IN ('RELEASED','IN_PROGRESS')"], args: [],
    search: ['mo.order_no', 'p.code', 'p.name'], order: 'mo.updated_at DESC,mo.id', toItem: referenceItem,
  };
}

export function listSalesWorkReferences(db, res, actor, url) {
  allowAny(actor, ['SALES_VIEW', 'SALES_MANAGE']);
  const input = readWorkReferenceInput(url, KINDS);
  return sendWorkReferencePage(db, res, input, relation(db, actor, input, url));
}
