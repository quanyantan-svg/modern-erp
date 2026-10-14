import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';
import {
  ORDER_CHANGE_MODES, RESERVATION_BEHAVIORS, SALES_DOCUMENT_TYPES,
  boolInt, mapBoolFields, runSalesWrite,
} from './sales-foundation-common.js';

const BOOL_FIELDS = Object.freeze([
  'sellableControlEnabled', 'customerMaterialXrefEnabled', 'salesGroupDataScopeEnabled',
  'deliveryScheduleEnabled', 'deliveryQuantityControlEnabled', 'active',
]);

function normalizeScope(scopeType, documentType) {
  const type = String(scopeType || '').trim().toUpperCase();
  if (type === 'SYSTEM') return { scopeType: type, documentType: null, scopeKey: 'SYSTEM' };
  const document = String(documentType || '').trim().toUpperCase();
  if (type !== 'DOCUMENT_TYPE' || !SALES_DOCUMENT_TYPES.includes(document)) {
    throw new HttpError(400, 'Sales 参数范围必须为 SYSTEM 或受支持的 DOCUMENT_TYPE');
  }
  return { scopeType: type, documentType: document, scopeKey: `DOCUMENT_TYPE:${document}` };
}

function input(body) {
  assertAllowedFields(body, [
    'scopeType', 'documentType', ...BOOL_FIELDS, 'orderChangeMode', 'reservationBehavior',
  ]);
  const scope = normalizeScope(body.scopeType, body.documentType);
  const orderChangeMode = String(body.orderChangeMode || '').trim().toUpperCase();
  const reservationBehavior = String(body.reservationBehavior || '').trim().toUpperCase();
  if (!ORDER_CHANGE_MODES.includes(orderChangeMode)) throw new HttpError(400, '订单变更模式无效');
  if (!RESERVATION_BEHAVIORS.includes(reservationBehavior)) throw new HttpError(400, '预留行为无效');
  return {
    ...scope,
    sellableControlEnabled: boolInt(body.sellableControlEnabled, false),
    customerMaterialXrefEnabled: boolInt(body.customerMaterialXrefEnabled, false),
    salesGroupDataScopeEnabled: boolInt(body.salesGroupDataScopeEnabled, false),
    deliveryScheduleEnabled: boolInt(body.deliveryScheduleEnabled, false),
    deliveryQuantityControlEnabled: boolInt(body.deliveryQuantityControlEnabled, false),
    orderChangeMode,
    reservationBehavior,
    active: boolInt(body.active, true),
  };
}

function present(row) {
  return mapBoolFields({
    scopeKey: row.scope_key,
    scopeType: row.scope_type,
    documentType: row.document_type,
    sellableControlEnabled: row.sellable_control_enabled,
    customerMaterialXrefEnabled: row.customer_material_xref_enabled,
    salesGroupDataScopeEnabled: row.sales_group_data_scope_enabled,
    deliveryScheduleEnabled: row.delivery_schedule_enabled,
    deliveryQuantityControlEnabled: row.delivery_quantity_control_enabled,
    orderChangeMode: row.order_change_mode,
    reservationBehavior: row.reservation_behavior,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }, BOOL_FIELDS);
}

export function listSalesParameters(db, res, actor) {
  allowAny(actor, ['SALES_FOUNDATION_VIEW', 'SALES_PARAMETERS_MANAGE']);
  return send(res, 200, { parameters: db.prepare('SELECT * FROM sales_parameters ORDER BY scope_type, document_type').all().map(present) });
}

export async function upsertSalesParameters(db, req, res, actor) {
  allow(actor, 'SALES_PARAMETERS_MANAGE');
  const value = input(await readJson(req));
  const now = new Date().toISOString();
  runSalesWrite(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const existing = db.prepare(`SELECT * FROM sales_parameters WHERE scope_key=?${lock}`).get(value.scopeKey);
    if (existing) {
      db.prepare(`UPDATE sales_parameters SET sellable_control_enabled=?,customer_material_xref_enabled=?,
        sales_group_data_scope_enabled=?,delivery_schedule_enabled=?,delivery_quantity_control_enabled=?,
        order_change_mode=?,reservation_behavior=?,active=?,updated_at=?,updated_by=? WHERE scope_key=?`)
        .run(value.sellableControlEnabled, value.customerMaterialXrefEnabled, value.salesGroupDataScopeEnabled,
          value.deliveryScheduleEnabled, value.deliveryQuantityControlEnabled, value.orderChangeMode,
          value.reservationBehavior, value.active, now, actor.id, value.scopeKey);
      audit(db, actor.id, 'UPDATE', 'SALES_PARAMETER', value.scopeKey, value.scopeKey);
    } else {
      db.prepare(`INSERT INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,
        customer_material_xref_enabled,sales_group_data_scope_enabled,delivery_schedule_enabled,
        delivery_quantity_control_enabled,order_change_mode,reservation_behavior,active,created_at,updated_at,created_by,updated_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(value.scopeKey, value.scopeType, value.documentType,
          value.sellableControlEnabled, value.customerMaterialXrefEnabled, value.salesGroupDataScopeEnabled,
          value.deliveryScheduleEnabled, value.deliveryQuantityControlEnabled, value.orderChangeMode,
          value.reservationBehavior, value.active, now, now, actor.id, actor.id);
      audit(db, actor.id, 'CREATE', 'SALES_PARAMETER', value.scopeKey, value.scopeKey);
    }
  });
  return send(res, 200, { parameter: present(db.prepare('SELECT * FROM sales_parameters WHERE scope_key=?').get(value.scopeKey)) });
}

export function resolveSalesParameters(db, documentType) {
  const document = documentType ? String(documentType).trim().toUpperCase() : null;
  if (document && !SALES_DOCUMENT_TYPES.includes(document)) throw new HttpError(409, 'Sales 单据类型未注册', { code: 'SALES_PARAMETER_INVALID_DOCUMENT_TYPE' });
  const exact = document && db.prepare("SELECT * FROM sales_parameters WHERE scope_key=? AND active=1").get(`DOCUMENT_TYPE:${document}`);
  const system = db.prepare("SELECT * FROM sales_parameters WHERE scope_key='SYSTEM' AND active=1").get();
  const resolved = exact || system;
  if (!resolved) throw new HttpError(409, 'Sales 系统参数缺失或未启用', { code: 'SALES_PARAMETER_UNAVAILABLE' });
  return present(resolved);
}
