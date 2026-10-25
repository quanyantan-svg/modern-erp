import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allowAny, assertAllowedFields, normalizeBusinessDate, readJson, send } from '../lib/http.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { resolveRecognitionPolicy, RECOGNITION_MODES } from './finance-recognition-policy.js';
import { recognizeFinanceExposure } from './finance-recognition.js';
import { assertFinancialPeriodsOpen, createSystemVoucher } from './financial-inventory.js';
import { assertGroupScope, requireSalesPermission } from './sales-scope.js';
import { discoverSalesPrepaymentGatePlan, authorizeSalesPrepaymentGateWithPlan } from './sales-prepayment-gate.js';
import { isGateRetryAdmissionExpired, startGateRetryAdmission } from './sales-gate-retry-admission.js';

const lock = (db) => db.dialect === 'mysql' ? ' FOR UPDATE' : '';
const now = () => new Date().toISOString();
const micros = (value, label = '数量') => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new HttpError(422, `${label}必须为正整数 micros`);
  return number;
};
const version = (value) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new HttpError(422, 'expectedVersion 必须为正整数');
  return number;
};
const safeNumber = (value, code) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new HttpError(409, '服务履约金额超出安全整数范围', { code });
  return number;
};
const fulfillmentNo = () => `SF-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;

function requireRead(actor) {
  allowAny(actor, ['SALES_VIEW', 'SALES_MANAGE']);
  requireSalesPermission(actor, 'SERVICE_SALES_VIEW');
}
function requireWrite(actor) {
  requireSalesPermission(actor, 'SALES_MANAGE');
  requireSalesPermission(actor, 'SERVICE_SALES_MANAGE');
}

function sourceRow(db, salesOrderItemId, forUpdate = false) {
  const row = db.prepare(`SELECT i.*,o.customer_id,o.sales_group_id,o.status order_status,o.order_no,o.order_date,
      o.payment_terms_days,p.base_uom_code,c.service_classification,c.service_kind,c.active classification_active
    FROM sales_order_items i JOIN sales_orders o ON o.id=i.order_id JOIN products p ON p.id=i.product_id
    LEFT JOIN product_commercial_classification c ON c.product_id=i.product_id
    WHERE i.id=?${forUpdate ? lock(db) : ''}`).get(salesOrderItemId);
  if (!row) throw new HttpError(404, '销售订单明细不存在');
  if (row.order_status !== 'APPROVED') throw new HttpError(409, '仅已批准销售订单可创建或确认服务履约', { code: 'SERVICE_FULFILLMENT_ORDER_NOT_APPROVED' });
  if (Number(row.service_classification) !== 1 || Number(row.classification_active) !== 1) {
    throw new HttpError(409, '销售订单明细不是有效 A-61 服务分类', { code: 'SERVICE_CLASSIFICATION_REQUIRED' });
  }
  return row;
}

function rowView(row) {
  return row && {
    id: row.id, fulfillmentNo: row.fulfillment_no, salesOrderId: row.sales_order_id,
    salesOrderItemId: row.sales_order_item_id, productId: row.product_id, customerId: row.customer_id,
    salesGroupId: row.sales_group_id, confirmationQtyMicros: Number(row.confirmation_qty_micros),
    unitPriceCents: Number(row.unit_price_cents), recognitionAmountCents: Number(row.recognition_amount_cents),
    businessDate: row.business_date, state: row.confirmation_state, financeRecognitionMode: row.finance_recognition_mode,
    financeOpenItemId: row.finance_open_item_id, version: Number(row.version), confirmedAt: row.confirmed_at,
    confirmedBy: row.confirmed_by, cancelledAt: row.cancelled_at, cancelledBy: row.cancelled_by,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function assertScope(db, actor, row, write = false) {
  if (row.sales_group_id) assertGroupScope(db, actor, {
    salesGroupId: row.sales_group_id, businessDate: row.business_date || row.order_date,
    documentType: 'SALES_ORDER', write,
  });
}

export function listServiceFulfillmentRows(db, actor, { salesOrderId = '', salesOrderItemId = '', state = '' } = {}) {
  requireRead(actor);
  const clauses = []; const values = [];
  if (salesOrderId) { clauses.push('f.sales_order_id=?'); values.push(salesOrderId); }
  if (salesOrderItemId) { clauses.push('f.sales_order_item_id=?'); values.push(salesOrderItemId); }
  if (state) { clauses.push('f.confirmation_state=?'); values.push(state); }
  return db.prepare(`SELECT f.*,o.order_date FROM service_fulfillments f JOIN sales_orders o ON o.id=f.sales_order_id
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY f.business_date DESC,f.created_at DESC,f.id`).all(...values)
    .filter((row) => { try { assertScope(db, actor, row); return true; } catch (error) { if (error.status === 403) return false; throw error; } })
    .map(rowView);
}

export function getServiceFulfillmentRow(db, actor, fulfillmentId, { write = false, forUpdate = false } = {}) {
  const row = db.prepare(`SELECT f.*,o.order_date FROM service_fulfillments f JOIN sales_orders o ON o.id=f.sales_order_id WHERE f.id=?${forUpdate ? lock(db) : ''}`).get(fulfillmentId);
  if (!row) throw new HttpError(404, '服务履约不存在');
  assertScope(db, actor, row, write);
  return row;
}

export function createServiceFulfillmentCommand(db, input, actor, key) {
  requireWrite(actor);
  if (!key) throw new HttpError(422, 'Idempotency-Key 必填');
  const qty = micros(input.confirmationQtyMicros);
  const businessDate = normalizeBusinessDate(input.businessDate, '业务日期');
  const fingerprint = requestFingerprint({ salesOrderItemId: input.salesOrderItemId, confirmationQtyMicros: qty, businessDate });
  const replay = idempotencyReplay(db, 'SERVICE_FULFILLMENT_CREATE', String(input.salesOrderItemId || ''), key, fingerprint);
  if (replay) return { ...replay, replayed: true };
  let result;
  transaction(db, () => {
    assertFinancialPeriodsOpen(db, businessDate);
    const source = sourceRow(db, input.salesOrderItemId, true);
    assertScope(db, actor, { ...source, business_date: businessDate }, true);
    const ordered = micros(source.document_quantity_num ?? Math.round(Number(source.quantity) * 1_000_000), '订单数量');
    const committed = Number(db.prepare(`SELECT COALESCE(SUM(confirmation_qty_micros),0) n FROM service_fulfillments
      WHERE sales_order_item_id=? AND confirmation_state IN ('PENDING','CONFIRMED')`).get(source.id).n);
    if (committed + qty > ordered) throw new HttpError(409, '服务履约累计数量超过销售订单明细', { code: 'SERVICE_FULFILLMENT_CAPACITY_EXCEEDED' });
    const id = randomUUID(); const stamp = now();
    db.prepare(`INSERT INTO service_fulfillments(id,fulfillment_no,sales_order_id,sales_order_item_id,product_id,customer_id,sales_group_id,
      confirmation_qty_micros,unit_price_cents,recognition_amount_cents,business_date,confirmation_state,version,created_at,updated_at,created_by,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?,0,?,'PENDING',1,?,?,?,?)`).run(id, fulfillmentNo(), source.order_id, source.id, source.product_id,
      source.customer_id, source.sales_group_id, qty, Number(source.unit_price_cents), businessDate, stamp, stamp, actor.id, actor.id);
    audit(db, actor.id, 'CREATE', 'SERVICE_FULFILLMENT', id, `${source.order_no}:${qty}`);
    result = rowView(db.prepare('SELECT * FROM service_fulfillments WHERE id=?').get(id));
    saveIdempotency(db, 'SERVICE_FULFILLMENT_CREATE', source.id, key, fingerprint, result);
  });
  return result;
}

export function cancelServiceFulfillmentCommand(db, fulfillmentId, expectedVersion, actor, key) {
  requireWrite(actor); const expected = version(expectedVersion);
  if (!key) throw new HttpError(422, 'Idempotency-Key 必填');
  const fingerprint = requestFingerprint({ action: 'CANCEL', expectedVersion: expected });
  const replay = idempotencyReplay(db, 'SERVICE_FULFILLMENT_CANCEL', fulfillmentId, key, fingerprint);
  if (replay) return { ...replay, replayed: true };
  let result;
  transaction(db, () => {
    const row = getServiceFulfillmentRow(db, actor, fulfillmentId, { write: true, forUpdate: true });
    if (row.confirmation_state === 'CONFIRMED') throw new HttpError(409, 'Confirmed service fulfillment is immutable', { code: 'SERVICE_FULFILLMENT_CONFIRMED_IMMUTABLE' });
    if (row.confirmation_state !== 'PENDING') throw new HttpError(409, '只有待确认服务履约可以取消', { code: 'SERVICE_FULFILLMENT_STATE_CONFLICT' });
    if (Number(row.version) !== expected) throw new HttpError(409, '服务履约版本已变化', { code: 'SERVICE_FULFILLMENT_VERSION_CONFLICT' });
    const stamp = now();
    db.prepare(`UPDATE service_fulfillments SET confirmation_state='CANCELLED',cancelled_at=?,cancelled_by=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?`)
      .run(stamp, actor.id, stamp, actor.id, fulfillmentId, expected);
    audit(db, actor.id, 'CANCEL', 'SERVICE_FULFILLMENT', fulfillmentId, 'PENDING→CANCELLED');
    result = rowView(db.prepare('SELECT * FROM service_fulfillments WHERE id=?').get(fulfillmentId));
    saveIdempotency(db, 'SERVICE_FULFILLMENT_CANCEL', fulfillmentId, key, fingerprint, result);
  });
  return result;
}

export function confirmServiceFulfillmentCommand(db, fulfillmentId, expectedVersion, actor, key) {
  requireWrite(actor); const expected = version(expectedVersion);
  if (!key) throw new HttpError(422, 'Idempotency-Key 必填');
  const discovery = db.prepare('SELECT sales_order_id,business_date FROM service_fulfillments WHERE id=?').get(fulfillmentId);
  if (!discovery) throw new HttpError(404, '服务履约不存在');
  const initialGatePlan = discoverSalesPrepaymentGatePlan(db, discovery.sales_order_id, discovery.business_date);
  // Bind the external request fingerprint once. Internal plan rediscovery must not
  // turn the same in-flight HTTP request into a different idempotency request.
  const fingerprint = requestFingerprint({ action: 'CONFIRM', expectedVersion: expected, gatePlan: initialGatePlan.requirementFingerprint });
  const replay = idempotencyReplay(db, 'SERVICE_FULFILLMENT_CONFIRM', fulfillmentId, key, fingerprint);
  if (replay) return { ...replay, replayed: true };
  const maxAttempts = (() => {
    const configured = Number(process.env.ERP_GATE_ATTEMPTS_MAX ?? 3);
    return Number.isSafeInteger(configured) && configured >= 1 && configured <= 3 ? configured : 3;
  })();
  const rediscoveryCodes = new Set([
    'SALES_PREPAYMENT_LOCK_PLAN_STALE',
    'SALES_PREPAYMENT_PARENT_MISSING',
    'SALES_PREPAYMENT_PARENT_CLOSED',
    'SERVICE_FULFILLMENT_CONFIRM_PLAN_STALE',
  ]);
  const waitForRediscovery = (attempt) => Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)), 0, 0,
    Math.min(100, 20 * (2 ** (attempt - 1))),
  );
  const authorityFingerprint = (source, row) => requestFingerprint({
    order: source && {
      id: source.order_id, customerId: source.customer_id, status: source.order_status,
      totalCents: Number(source.order_total_cents), salesGroupId: source.sales_group_id || null,
    },
    sourceItem: source && {
      id: source.id, orderId: source.order_id, productId: source.product_id,
      quantity: Number(source.quantity), amountCents: Number(source.amount_cents),
      unitPriceCents: Number(source.unit_price_cents), paymentTermsDays: Number(source.payment_terms_days || 0),
      documentQuantityNum: source.document_quantity_num, documentQuantityDen: source.document_quantity_den,
    },
    fulfillment: row && {
      id: row.id, salesOrderId: row.sales_order_id, salesOrderItemId: row.sales_order_item_id,
      productId: row.product_id, customerId: row.customer_id, salesGroupId: row.sales_group_id || null,
      businessDate: row.business_date, confirmationState: row.confirmation_state,
      confirmationQtyMicros: Number(row.confirmation_qty_micros), unitPriceCents: Number(row.unit_price_cents),
      version: Number(row.version),
    },
  });
  const readSourceAuthority = (salesOrderItemId, locked = false) => db.prepare(`SELECT i.*,o.customer_id,o.sales_group_id,o.status order_status,
      o.total_cents order_total_cents,o.order_no,o.order_date,o.payment_terms_days,
      p.base_uom_code,c.service_classification,c.service_kind,c.active classification_active
    FROM sales_order_items i JOIN sales_orders o ON o.id=i.order_id JOIN products p ON p.id=i.product_id
    LEFT JOIN product_commercial_classification c ON c.product_id=i.product_id
    WHERE i.id=?${locked ? lock(db) : ''}`).get(salesOrderItemId);
  const discoverPlan = () => {
    const row = getServiceFulfillmentRow(db, actor, fulfillmentId, { write: true });
    if (row.confirmation_state !== 'PENDING') throw new HttpError(409, '服务履约当前不可确认', { code: 'SERVICE_FULFILLMENT_STATE_CONFLICT' });
    if (Number(row.version) !== expected) throw new HttpError(409, '服务履约版本已变化', { code: 'SERVICE_FULFILLMENT_VERSION_CONFLICT' });
    const source = readSourceAuthority(row.sales_order_item_id);
    if (!source) throw new HttpError(404, '销售订单明细不存在');
    const gatePlan = discoverSalesPrepaymentGatePlan(db, row.sales_order_id, row.business_date);
    return Object.freeze({
      sourceItemId: row.sales_order_item_id,
      businessDate: row.business_date,
      fingerprint: authorityFingerprint(source, row),
      gatePlan: Object.freeze({ ...gatePlan, parentBalanceIds: Object.freeze([...gatePlan.parentBalanceIds]) }),
    });
  };
  const stamp = now();
  const admission = startGateRetryAdmission(process.env.ERP_GATE_ATTEMPTS_BUDGET_MS);
  let attemptsStarted = 0;
  const deadlineExhausted = () => new HttpError(503, '服务履约确认重试已耗尽', {
    code: 'SERVICE_FULFILLMENT_CONFIRM_RETRY_EXHAUSTED',
    retryable: true,
    attempts: attemptsStarted,
    causeCode: 'SALES_PREPAYMENT_GATE_ADMISSION_DEADLINE_EXCEEDED',
  });
  while (attemptsStarted < maxAttempts) {
    if (isGateRetryAdmissionExpired(admission)) throw deadlineExhausted();
    attemptsStarted += 1;
    const attempt = attemptsStarted;
    const plan = discoverPlan();
    let result;
    try {
      transaction(db, () => {
        assertFinancialPeriodsOpen(db, plan.businessDate);
        authorizeSalesPrepaymentGateWithPlan(db, plan.gatePlan, { stage: 'DELIVERY', actorId: actor.id, mutationKey: `SERVICE:${fulfillmentId}:${key}` });
        // §35.18.11.5 order: the SO line is the first capacity lock, ahead of the fulfillment
        // row. A3 invoice posting locks the same pair in this order, so taking them in the
        // opposite order here would be a genuine deadlock risk.
        const source = readSourceAuthority(plan.sourceItemId, true);
        if (!source) throw new HttpError(409, '服务履约来源订单行已变化', { code: 'SERVICE_FULFILLMENT_CONFIRM_PLAN_STALE' });
        const row = getServiceFulfillmentRow(db, actor, fulfillmentId, { write: true, forUpdate: true });
        if (authorityFingerprint(source, row) !== plan.fingerprint) {
          throw new HttpError(409, '服务履约确认计划已过期，请重试', {
            code: 'SERVICE_FULFILLMENT_CONFIRM_PLAN_STALE',
          });
        }
        if (row.confirmation_state !== 'PENDING') throw new HttpError(409, '服务履约当前不可确认', { code: 'SERVICE_FULFILLMENT_STATE_CONFLICT' });
        if (Number(row.version) !== expected) throw new HttpError(409, '服务履约版本已变化', { code: 'SERVICE_FULFILLMENT_VERSION_CONFLICT' });
        if (source.order_status !== 'APPROVED') throw new HttpError(409, '仅已批准销售订单可创建或确认服务履约', { code: 'SERVICE_FULFILLMENT_ORDER_NOT_APPROVED' });
        if (Number(source.service_classification) !== 1 || Number(source.classification_active) !== 1) {
          throw new HttpError(409, '销售订单明细不是有效 A-61 服务分类', { code: 'SERVICE_CLASSIFICATION_REQUIRED' });
        }
        if (row.sales_order_id !== source.order_id || row.sales_order_item_id !== source.id
            || row.product_id !== source.product_id || row.customer_id !== source.customer_id
            || (row.sales_group_id || null) !== (source.sales_group_id || null)) {
          throw new HttpError(409, '服务履约与来源销售订单关系不一致', { code: 'SERVICE_FULFILLMENT_CONFIRM_PLAN_STALE' });
        }
        assertScope(db, actor, row, true);
    const ordered = micros(source.document_quantity_num ?? Math.round(Number(source.quantity) * 1_000_000), '订单数量');
    const confirmedBefore = Number(db.prepare(`SELECT COALESCE(SUM(confirmation_qty_micros),0) n FROM service_fulfillments WHERE sales_order_item_id=? AND confirmation_state='CONFIRMED' AND id<>?`).get(source.id, row.id).n);
    const confirmedAfter = confirmedBefore + Number(row.confirmation_qty_micros);
    if (confirmedAfter > ordered) throw new HttpError(409, '服务履约累计确认数量超过销售订单明细', { code: 'SERVICE_FULFILLMENT_CAPACITY_EXCEEDED' });
    const totalAmount = BigInt(source.amount_cents);
    const allocatedBefore = totalAmount * BigInt(confirmedBefore) / BigInt(ordered);
    const allocatedAfter = totalAmount * BigInt(confirmedAfter) / BigInt(ordered);
    const recognitionAmount = safeNumber(allocatedAfter - allocatedBefore, 'SERVICE_FULFILLMENT_AMOUNT_UNSAFE');
    let finance = null;
    if (recognitionAmount > 0) {
      const policy = resolveRecognitionPolicy(db, 'AR', 'SERVICE_FULFILLMENT', row.id, row.business_date);
      if (policy.scope === 'FALLBACK' || policy.mode !== RECOGNITION_MODES.DIRECT) {
        throw new HttpError(409, '服务履约缺少显式 DIRECT 财务确认策略', { code: 'SERVICE_FINANCE_POLICY_REQUIRED' });
      }
      finance = recognizeFinanceExposure(db, {
        side: 'AR', amountCents: recognitionAmount,
        source: { sourceType: 'SERVICE_FULFILLMENT', sourceId: row.id, sourceNo: row.fulfillment_no },
        partyId: row.customer_id, businessDate: row.business_date, paymentTermsDays: source.payment_terms_days,
        actorId: actor.id, recognitionMode: RECOGNITION_MODES.DIRECT,
      });
      createSystemVoucher(db, { sourceType: 'SERVICE_FULFILLMENT', sourceId: row.id,
        businessDate: row.business_date, actorId: actor.id,
        entries: [
          { role: 'ACCOUNTS_RECEIVABLE', direction: 'DEBIT', amountCents: recognitionAmount },
          { role: 'SALES_REVENUE', direction: 'CREDIT', amountCents: recognitionAmount },
        ] });
      const open = db.prepare(`SELECT * FROM account_receivables WHERE id=?`).get(finance.openItemId);
      if (!open || open.source_type !== 'SERVICE_FULFILLMENT' || open.source_id !== row.id || Number(open.amount_cents) !== recognitionAmount || open.customer_id !== row.customer_id || open.item_kind !== 'FINAL') {
        throw new HttpError(409, '服务履约财务确认结果不一致', { code: 'SERVICE_FINANCE_EVIDENCE_MISMATCH' });
      }
    }
    db.prepare(`UPDATE service_fulfillments SET confirmation_state='CONFIRMED',recognition_amount_cents=?,finance_recognition_mode=?,finance_open_item_id=?,finance_source_type=?,finance_source_id=?,confirmed_at=?,confirmed_by=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?`)
      .run(recognitionAmount, finance ? RECOGNITION_MODES.DIRECT : null, finance?.openItemId || null, finance ? 'SERVICE_FULFILLMENT' : null,
        finance ? row.id : null, stamp, actor.id, stamp, actor.id, row.id, expected);
    audit(db, actor.id, 'CONFIRM', 'SERVICE_FULFILLMENT', row.id, `qty=${row.confirmation_qty_micros};amount=${recognitionAmount}`);
    result = rowView(db.prepare('SELECT * FROM service_fulfillments WHERE id=?').get(row.id));
    saveIdempotency(db, 'SERVICE_FULFILLMENT_CONFIRM', row.id, key, fingerprint, result);
      });
      return result;
    } catch (error) {
      const code = error?.details?.code || error?.code;
      const retryable = error?.transactionRetryExhausted || rediscoveryCodes.has(code);
      if (!retryable) throw error;
      if (attempt >= maxAttempts) {
        throw new HttpError(503, '服务履约确认重试已耗尽', {
          code: 'SERVICE_FULFILLMENT_CONFIRM_RETRY_EXHAUSTED', retryable: true,
          attempts: attempt, causeCode: code || null,
        });
      }
      if (isGateRetryAdmissionExpired(admission)) throw deadlineExhausted();
      waitForRediscovery(attempt);
    }
  }
  throw new HttpError(503, '服务履约确认重试已耗尽', {
    code: 'SERVICE_FULFILLMENT_CONFIRM_RETRY_EXHAUSTED', retryable: true,
  });
}

export function confirmedServiceCapacity(db, salesOrderItemId) {
  return db.prepare(`SELECT f.* FROM service_fulfillments f WHERE f.sales_order_item_id=? AND f.confirmation_state='CONFIRMED' ORDER BY f.business_date,f.created_at,f.id`).all(salesOrderItemId);
}

export function listServiceFulfillments(db, res, actor, url) {
  return send(res, 200, { fulfillments: listServiceFulfillmentRows(db, actor, {
    salesOrderId: url.searchParams.get('salesOrderId') || '', salesOrderItemId: url.searchParams.get('salesOrderItemId') || '', state: url.searchParams.get('state') || '',
  }) });
}
export function getServiceFulfillment(db, res, actor, fulfillmentId) {
  requireRead(actor); return send(res, 200, { fulfillment: rowView(getServiceFulfillmentRow(db, actor, fulfillmentId)) });
}
export async function createServiceFulfillment(db, req, res, actor) {
  const body = await readJson(req); assertAllowedFields(body, ['salesOrderItemId', 'confirmationQtyMicros', 'businessDate']);
  return send(res, 201, { fulfillment: createServiceFulfillmentCommand(db, body, actor, String(req.headers['idempotency-key'] || '').trim()) });
}
export async function serviceFulfillmentAction(db, req, res, actor, fulfillmentId, action) {
  const body = await readJson(req); assertAllowedFields(body, ['expectedVersion']);
  const key = String(req.headers['idempotency-key'] || '').trim();
  const value = action === 'confirm'
    ? confirmServiceFulfillmentCommand(db, fulfillmentId, body.expectedVersion, actor, key)
    : cancelServiceFulfillmentCommand(db, fulfillmentId, body.expectedVersion, actor, key);
  return send(res, 200, { fulfillment: value });
}
