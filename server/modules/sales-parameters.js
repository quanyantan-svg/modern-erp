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

// ---------------------------------------------------------------------------
// SC01 control switch enforcement (audit defect SC-DEF-01, 2026-11-13).
//
// Requirement §34.3.1 requires SC01 to carry, at minimum, 可售控制 /
// 客户物料对应启用 / 交货计划·数量控制 / 预留行为 control semantics, and
// Design §29.4.5 binds them to the A-65 SYSTEM / DOCUMENT_TYPE resolution:
//   "Wave 5 执行 delivery schedule/quantity controls；Wave 7 执行
//    reservation_behavior".
//
// The three switches were persisted and resolved but had NO production
// consumer, so an operator could turn them off and nothing changed. The
// guards below make the switches effective.
//
// RESOLUTION + DEFAULT (the contract-critical part):
//
//   * When an ACTIVE parameter row is configured for the requested scope,
//     the resolution rule is unchanged: the exact active
//     `DOCUMENT_TYPE:<code>` row wins over the SYSTEM row, and the row's
//     switch values decide the behaviour.
//   * When NO active parameter row exists for the requested scope, the
//     guards PRESERVE the pre-existing production behaviour. The delivery
//     path must not acquire a new fail-closed dependency on a parameter row
//     it never required: an unconfigured scope keeps enforcing the delivery
//     tolerance and keeps accepting a planned delivery date, exactly as it
//     did before this work package.
//
//     This is deliberately NOT `resolveSalesParameters`'s fail-closed rule.
//     That fail-closed rule belongs to the writers that REQUIRE a parameter
//     row (the sales-order writer resolves `sellable_control_enabled` and
//     `order_change_mode` through it). The three switches below are
//     OPT-OUT controls: they can only RELAX an enforcement, and an absent
//     configuration must not silently tighten or loosen a business path.
//
// Failure mode: every refusal is an explicit HttpError with its own stable
// error code, and every refusal happens BEFORE any business write, so the
// side effect is zero.
// ---------------------------------------------------------------------------

// Resolve the EFFECTIVE parameter row for a scope WITHOUT the fail-closed
// rule of `resolveSalesParameters`. Returns null when no active row exists
// for the scope, so the caller can keep its historical behaviour.
//
// The resolution order is identical to `resolveSalesParameters`: the exact
// active DOCUMENT_TYPE row wins over the SYSTEM row.
export function resolveSalesParametersIfConfigured(db, documentType) {
  const document = documentType ? String(documentType).trim().toUpperCase() : null;
  if (document && !SALES_DOCUMENT_TYPES.includes(document)) {
    throw new HttpError(409, 'Sales 单据类型未注册', { code: 'SALES_PARAMETER_INVALID_DOCUMENT_TYPE' });
  }
  const exact = document
    ? db.prepare("SELECT * FROM sales_parameters WHERE scope_key=? AND active=1").get(`DOCUMENT_TYPE:${document}`)
    : null;
  const system = db.prepare("SELECT * FROM sales_parameters WHERE scope_key='SYSTEM' AND active=1").get();
  const resolved = exact || system;
  return resolved ? present(resolved) : null;
}

// SC01 `delivery_schedule_enabled` — controls whether a sales order line may
// carry a delivery schedule (planned delivery date).
//
// When the control is explicitly OFF, a sales order that carries a planned
// delivery date must be refused, and the Delivery Notice path must refuse to
// create a notice against a line.
//
// The guard is additive over the historical behaviour: it only fires when an
// active parameter row explicitly DISABLES the control. When the control is
// enabled, or when no active parameter row is configured for the scope, the
// caller keeps its current behaviour.
export function assertDeliveryScheduleEnabled(db, documentType, context = {}) {
  const parameters = resolveSalesParametersIfConfigured(db, documentType);
  if (!parameters || parameters.deliveryScheduleEnabled) return parameters;
  throw new HttpError(409, '销售参数已关闭交货计划控制，当前单据不得携带计划交货日期', {
    code: 'SALES_DELIVERY_SCHEDULE_CONTROL_DISABLED',
    documentType: documentType || null,
    ...context,
  });
}

// SC01 `delivery_quantity_control_enabled` — controls whether the
// over-/under-delivery tolerance bound is enforced on delivery.
//
// When the control is explicitly OFF the tolerance bound is NOT enforced: a
// Delivery Notice may exceed the order line upper bound, and a Sales Delivery
// may exceed the cumulative confirmed quantity. The DN-line remaining-capacity
// check is a DIFFERENT bound (the notice's own remaining capacity) and is
// NOT part of the tolerance control — it stays enforced in both modes.
//
// The default is fail-safe: with no active parameter row configured for the
// scope, the tolerance bound STAYS ENFORCED, which is the pre-existing
// production behaviour.
export function resolveDeliveryQuantityControl(db, documentType) {
  const parameters = resolveSalesParametersIfConfigured(db, documentType);
  return {
    enabled: parameters ? Boolean(parameters.deliveryQuantityControlEnabled) : true,
    parameters,
  };
}

// SC01 `reservation_behavior` — decides whether an order line requests a
// reservation at all.
//
// `DISABLED` means the Sales parameter forbids the reservation stage: a
// reservation intent request must be refused with an explicit code. Every
// other value in the RESERVATION_BEHAVIORS enum keeps today's behaviour (the
// requested mode is honoured as before).
//
// When NO active parameter row is configured for the scope, the pre-existing
// behaviour is preserved: the reservation stage runs as it did before this
// work package. Only an EXPLICITLY configured `DISABLED` refuses.
//
// The reservation behaviour does NOT select the reservation mode for the
// caller — the caller's own mode argument remains the operative mode. This
// guard only decides whether the reservation stage may run at all.
export function assertReservationBehaviorEnabled(db, documentType, context = {}) {
  const parameters = resolveSalesParametersIfConfigured(db, documentType);
  if (!parameters || parameters.reservationBehavior !== 'DISABLED') return parameters;
  throw new HttpError(409, '销售参数已关闭预留行为，当前单据不得发起预留', {
    code: 'SALES_RESERVATION_BEHAVIOR_DISABLED',
    documentType: documentType || null,
    ...context,
  });
}

// SC01 `delivery_schedule_enabled` — the SALES_ORDER side of the control.
//
// `assertDeliveryScheduleEnabled` above is the DOCUMENT_TYPE side: it refuses
// a DELIVERY_NOTICE that carries a planned delivery date. This function is
// the SALES_ORDER side: it refuses a sales order that carries its own
// delivery SCHEDULE.
//
// SCOPE NOTE (a real contract tension, reported to the owner rather than
// papered over):
//
//   SC34 (`Requirement §34.3.5`) makes the header commitment date
//   `sales_orders.requested_delivery_date` a MANDATORY submit-time field:
//   `validateSalesOrderSubmit` refuses a submit without it. A literal
//   "no sales order may carry any planned delivery date" reading of
//   `delivery_schedule_enabled` would therefore make EVERY sales order
//   unsubmittable while the control is off — a self-contradictory state.
//
//   The control is therefore enforced on the delivery SCHEDULE, not on the
//   mandatory header commitment date:
//
//     * the header commitment date (`requested_delivery_date`) stays
//       mandatory and stays untouched — SC34 owns it;
//     * a LINE that carries its OWN planned delivery date — i.e. a per-line
//       schedule that DEVIATES from the header commitment — is a delivery
//       schedule in the SC30 sense, and is refused.
//
//   The distinction is non-vacuous: `buildAuthoritativeSalesLines` copies the
//   header date onto every line by default, so a line deviating from the
//   header is exactly the case where an operator set an explicit per-line
//   schedule. An order whose lines all match the header date is unaffected.
//
//   The refusal happens BEFORE any business write, so the side effect is zero.
export function assertSalesOrderDeliveryScheduleEnabled(db, salesOrderId, context = {}) {
  const parameters = resolveSalesParametersIfConfigured(db, 'SALES_ORDER');
  if (!parameters || parameters.deliveryScheduleEnabled) return parameters;
  const order = db.prepare('SELECT id, requested_delivery_date FROM sales_orders WHERE id=?').get(salesOrderId);
  if (!order) throw new HttpError(404, '销售订单不存在');
  const headerDate = order.requested_delivery_date || null;
  const scheduled = db.prepare('SELECT line_no, planned_delivery_date FROM sales_order_items WHERE order_id=? AND planned_delivery_date IS NOT NULL ORDER BY line_no')
    .all(salesOrderId)
    .filter((line) => !headerDate || line.planned_delivery_date !== headerDate);
  if (!scheduled.length) return parameters;
  throw new HttpError(409, '销售参数已关闭交货计划控制，订单行不得携带独立于订单交期的计划交货日期', {
    code: 'SALES_DELIVERY_SCHEDULE_CONTROL_DISABLED',
    documentType: 'SALES_ORDER',
    salesOrderId,
    scheduledLines: scheduled.map((line) => ({ lineNo: line.line_no, plannedDeliveryDate: line.planned_delivery_date })),
    ...context,
  });
}
