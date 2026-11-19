import { allowAny } from '../lib/http.js';
import { readWorkReferenceInput, referenceItem, sendWorkReferencePage } from '../lib/work-reference.js';

const KINDS = new Set([
  'DEMAND_SALES_ORDER', 'DEMAND_FORECAST', 'DEMAND_PRODUCTION_ORDER',
  'SUPPLY_PLANNED_ORDER', 'SUPPLY_PURCHASE_ORDER', 'SUPPLY_PRODUCTION_ORDER',
]);

const STATUS_LABEL = Object.freeze({
  DRAFT: '草稿', SUBMITTED: '待审批', APPROVED: '已审批', REJECTED: '已驳回',
  ACTIVE: '生效中', CONFIRMED: '已确认', RELEASED: '已下达', IN_PROGRESS: '生产中',
});

const item = (row) => referenceItem({
  ...row,
  secondaryText: STATUS_LABEL[row.state] || row.state || '',
});

function relation(kind) {
  if (kind === 'DEMAND_SALES_ORDER') return {
    identity: 'so.id', columns: 'so.id,so.order_no code,c.name,so.status state,1 active',
    from: 'FROM sales_orders so JOIN customers c ON c.id=so.customer_id',
    where: ["so.status IN ('SUBMITTED','APPROVED')"], args: [], search: ['so.order_no', 'c.code', 'c.name'],
    order: 'so.created_at DESC,so.id', toItem: item,
  };
  if (kind === 'DEMAND_FORECAST') return {
    identity: 'f.id', columns: 'f.id,f.forecast_code code,f.forecast_name name,f.status state,1 active',
    from: 'FROM planning_forecasts f', where: ["f.status='ACTIVE'"], args: [], search: ['f.forecast_code', 'f.forecast_name'],
    order: 'f.updated_at DESC,f.id', toItem: item,
  };
  if (kind === 'SUPPLY_PLANNED_ORDER') return {
    identity: 'po.id', columns: "po.id,po.order_no code,p.name,po.status state,CASE WHEN po.status='CONFIRMED' THEN 1 ELSE 0 END active",
    from: 'FROM planned_orders po JOIN products p ON p.id=po.product_id', where: ["po.status='CONFIRMED'"], args: [], search: ['po.order_no', 'p.code', 'p.name'],
    order: 'po.updated_at DESC,po.id', toItem: item,
  };
  if (kind === 'SUPPLY_PURCHASE_ORDER') return {
    identity: 'po.id', columns: "po.id,po.order_no code,s.name,po.status state,CASE WHEN po.status='APPROVED' THEN 1 ELSE 0 END active",
    from: 'FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id',
    where: ["po.status='APPROVED'", "(po.business_type IS NULL OR po.business_type='STANDARD_PURCHASE')"], args: [], search: ['po.order_no', 's.code', 's.name'],
    order: 'po.updated_at DESC,po.id', toItem: item,
  };
  const supply = kind === 'SUPPLY_PRODUCTION_ORDER';
  return {
    identity: 'mo.id', columns: `mo.id,mo.order_no code,p.name,mo.status state,CASE WHEN mo.status IN ('RELEASED','IN_PROGRESS') THEN 1 ELSE 0 END active`,
    from: 'FROM production_orders mo JOIN products p ON p.id=mo.product_id',
    where: supply ? ["mo.status IN ('RELEASED','IN_PROGRESS')"] : ["mo.status NOT IN ('CANCELLED','COMPLETED')"],
    args: [], search: ['mo.order_no', 'p.code', 'p.name'], order: 'mo.updated_at DESC,mo.id', toItem: item,
  };
}

export function listPlanningWorkReferences(db, res, actor, url) {
  allowAny(actor, ['MRP_VIEW', 'MRP_MANAGE']);
  const input = readWorkReferenceInput(url, KINDS);
  return sendWorkReferencePage(db, res, input, relation(input.kind));
}
