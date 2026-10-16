import { createHash } from 'node:crypto';
import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, readJson, send } from '../lib/http.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { resolveSalesParameters } from './sales-parameters.js';
import { assertGroupScope, lockSuffix, requireSalesPermission } from './sales-scope.js';
import {
  buildAuthoritativeSalesLines,
  insertSalesOrderLines,
  PRICE_OVERRIDE_CONSUMPTION,
  validatePriceSnapshot,
} from './sales-orders.js';

const NOW = () => new Date().toISOString();
const makeNo = () => `SOC-${Date.now()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse = (value) => JSON.parse(value);
const scaleHalfUp = (value, targetMicros, sourceMicros) => Number((BigInt(value) * BigInt(targetMicros) + BigInt(sourceMicros) / 2n) / BigInt(sourceMicros));
const safe = (value, label, min = 0) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < min) throw new HttpError(422, `${label}不正确`); return n; };
const PRICE_OVERRIDE_AUTHORIZATION_ORPHAN = 'SALES_ORDER_CHANGE_AUTHORIZATION_ORPHAN';

function corruptChangeEvidence(message) {
  return new HttpError(409, message, { code: 'SALES_ORDER_CHANGE_EVIDENCE_CORRUPT' });
}

function parseStrictAddAfter(db, order, jsonString, lineLabel) {
  let after;
  try { after = JSON.parse(jsonString); }
  catch { throw corruptChangeEvidence(`${lineLabel}变更证据 JSON 损坏`); }
  if (!after || typeof after !== 'object' || Array.isArray(after)) {
    throw corruptChangeEvidence(`${lineLabel}变更证据结构损坏`);
  }
  const snapshot = after.priceSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || Object.keys(snapshot).length === 0) {
    throw corruptChangeEvidence(`${lineLabel}价格快照为空或结构损坏`);
  }
  const materialId = String(after.productId || '');
  const uomCode = String(after.documentUomCode || '');
  const quantityMicros = Number(after.quantityMicros);
  const unitPriceCents = Number(after.unitPriceCents);
  const grossCents = Number(snapshot.grossAmountCents);
  if (!materialId || !uomCode || !Number.isSafeInteger(quantityMicros) || quantityMicros <= 0
    || !Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0
    || !Number.isSafeInteger(grossCents) || grossCents < 0) {
    throw corruptChangeEvidence(`${lineLabel}价格快照核心字段损坏`);
  }
  try {
    validatePriceSnapshot(db, snapshot, {
      customerId: order.customer_id,
      businessDate: snapshot.businessDate,
      materialId,
      uomCode,
      quantityMicros,
      unitPriceCents,
      grossCents,
    });
  } catch (error) {
    if (error?.code === 'SALES_ORDER_CHANGE_EVIDENCE_CORRUPT') throw error;
    throw corruptChangeEvidence(`${lineLabel}价格快照未通过权威校验`);
  }
  return after;
}

function ownedAuthorizationRows(db, owner) {
  const ownerExpression = db.dialect === 'mysql'
    ? "JSON_UNQUOTE(JSON_EXTRACT(result_json, '$.source')) = ?"
    : "json_extract(result_json, '$.source') = ?";
  try {
    return db.prepare(`SELECT document_id, result_json FROM idempotency_records
      WHERE operation_type=? AND idempotency_key=? AND ${ownerExpression}`)
      .all(PRICE_OVERRIDE_CONSUMPTION.OPERATION, PRICE_OVERRIDE_CONSUMPTION.KEY, owner);
  } catch {
    throw new HttpError(409, '无法读取销售订单变更授权占用，需要人工数据修复', {
      code: PRICE_OVERRIDE_AUTHORIZATION_ORPHAN,
    });
  }
}

function reconcileChangeAuthorizations(db, order, changeId, { assertClaims = false } = {}) {
  const owner = `SALES_ORDER_CHANGE:${changeId}`;
  const claimed = new Set();
  for (const row of db.prepare('SELECT op, after_values_json FROM sales_order_change_lines WHERE change_id=?').all(changeId)) {
    if (row.op !== 'ADD') continue;
    const after = parseStrictAddAfter(db, order, row.after_values_json, '历史 ADD 行');
    const authId = after.priceSnapshot.authorizationEvidence?.authorizationId;
    if (authId === undefined || authId === null || authId === '') continue;
    if (typeof authId !== 'string' || claimed.has(authId)) {
      throw new HttpError(409, '历史 ADD 行授权引用损坏或重复，需要人工数据修复', {
        code: PRICE_OVERRIDE_AUTHORIZATION_ORPHAN,
      });
    }
    claimed.add(authId);
  }

  if (assertClaims) {
    for (const authorizationId of claimed) {
      PRICE_OVERRIDE_CONSUMPTION.assertReserved(db, authorizationId, { expectedOwner: owner });
    }
  }

  const persisted = new Set();
  for (const row of ownedAuthorizationRows(db, owner)) {
    let value;
    try { value = JSON.parse(row.result_json); }
    catch {
      throw new HttpError(409, '授权占用记录损坏，需要人工数据修复', {
        code: PRICE_OVERRIDE_AUTHORIZATION_ORPHAN,
      });
    }
    if (value?.source !== owner || value?.authorizationId !== row.document_id || persisted.has(row.document_id)) {
      throw new HttpError(409, '授权占用记录归属或身份损坏，需要人工数据修复', {
        code: PRICE_OVERRIDE_AUTHORIZATION_ORPHAN,
      });
    }
    persisted.add(row.document_id);
  }
  if (claimed.size !== persisted.size || ![...claimed].every((authorizationId) => persisted.has(authorizationId))) {
    throw new HttpError(409, '历史 ADD 行授权引用与持久化占用不一致，需要人工数据修复', {
      code: PRICE_OVERRIDE_AUTHORIZATION_ORPHAN,
    });
  }
  return { claimed, persisted };
}

function parameterSnapshot(db, path) {
  const parameter = resolveSalesParameters(db, 'SALES_ORDER');
  const allowed = parameter.orderChangeMode === 'BOTH' || parameter.orderChangeMode === path;
  if (!allowed) throw new HttpError(409, `当前订单变更模式不允许 ${path}`, { code: 'SALES_ORDER_CHANGE_MODE_BLOCKED' });
  return { parameter, scopeKey: parameter.scopeKey, snapshotHash: hash(parameter) };
}

function orderForChange(db, orderId, actor, lock = false) {
  const order = db.prepare(`SELECT * FROM sales_orders WHERE id=?${lock ? lockSuffix(db) : ''}`).get(orderId);
  if (!order) throw new HttpError(404, '销售订单不存在');
  if (order.status !== 'APPROVED' || order.commercial_close_state !== 'OPEN') throw new HttpError(409, '只有商业状态开放的已审批订单可以变更');
  assertGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: order.order_date, documentType: 'SALES_ORDER' });
  return order;
}

// R6-P1-01: shared change-loader used by every state-mutation action. Loads the
// change row and its underlying SO, asserts the change exists, and enforces the
// same sales-group scope used by the apply path. State-machine constraints
// (DRAFT/SUBMITTED/APPLIED/...) are still owned by the caller so REJECT /
// CANCEL can still target a SUBMITTED change after the SO is closed, while the
// scope check still prevents cross-group actors from operating on a change
// they have no business visibility for.
function loadChangeWithScope(db, changeId, actor, lock = false) {
  const change = db.prepare(`SELECT * FROM sales_order_changes WHERE id=?${lock ? lockSuffix(db) : ''}`).get(changeId);
  if (!change) throw new HttpError(404, '销售订单变更单不存在');
  const order = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(change.sales_order_id);
  if (!order) throw new HttpError(404, '销售订单对应商业单据不存在');
  assertGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: order.order_date, documentType: 'SALES_ORDER' });
  return { change, order };
}

function currentLine(db, orderId, itemId) {
  return db.prepare('SELECT * FROM sales_order_items WHERE id=? AND order_id=?').get(itemId, orderId);
}

function latestLineCommercialEvidence(db, orderId, itemId) {
  if (!itemId) return null;
  const row = db.prepare(`SELECT l.after_values_json FROM sales_order_change_lines l
    JOIN sales_order_changes c ON c.id=l.change_id
    WHERE c.sales_order_id=? AND l.sales_order_item_id=? AND c.state='APPLIED'
    ORDER BY c.target_effective_version DESC,l.line_no DESC LIMIT 1`).get(orderId, itemId);
  return row ? parse(row.after_values_json)?.effectiveCommercialEvidence ?? null : null;
}

function effectiveCommercialEvidence(db, order, before, after) {
  const priceSnapshot = before?.price_snapshot_json ? parse(before.price_snapshot_json) : after.priceSnapshot;
  const discountSnapshot = before?.discount_snapshot_json ? parse(before.discount_snapshot_json) : after.discountSnapshot;
  const candidate = latestLineCommercialEvidence(db, order.id, before?.id);
  const prior = validEffectiveEvidenceArithmetic(candidate) ? candidate : null;
  const sourceMicros = prior ? Number(prior.quantityMicros) : Number(priceSnapshot.quantityMicros ?? after.quantityMicros);
  const sourceGrossCents = prior ? Number(prior.effectiveGrossCents) : Number(discountSnapshot.grossAmountCents);
  const sourceLineDiscountCents = prior ? Number(prior.effectiveLineDiscountCents) : Number(discountSnapshot.lineDiscountCents);
  if (!Number.isSafeInteger(sourceMicros) || sourceMicros <= 0
    || !Number.isSafeInteger(sourceGrossCents) || sourceGrossCents < 0
    || !Number.isSafeInteger(sourceLineDiscountCents) || sourceLineDiscountCents < 0) {
    throw new HttpError(409, 'Invalid source values in sales-order-change evidence', { code: 'SALES_ORDER_CHANGE_EVIDENCE_CORRUPT' });
  }
  const effectiveGrossCents = scaleHalfUp(sourceGrossCents, Number(after.quantityMicros), sourceMicros);
  const effectiveLineDiscountCents = scaleHalfUp(sourceLineDiscountCents, Number(after.quantityMicros), sourceMicros);
  const effectiveHeaderAllocationCents = effectiveGrossCents - effectiveLineDiscountCents - Number(after.amountCents);
  if (![effectiveGrossCents, effectiveLineDiscountCents, effectiveHeaderAllocationCents].every(Number.isSafeInteger)
    || effectiveHeaderAllocationCents < 0) throw new HttpError(409, 'Invalid LINE/HEADER evidence for sales-order change', { code: 'SALES_ORDER_CHANGE_EVIDENCE_CORRUPT' });
  return { contractVersion: 'SO_CHANGE_COMMERCIAL_EVIDENCE_V1', baseEffectiveVersion: Number(order.effective_version),
    targetEffectiveVersion: Number(order.effective_version) + 1, quantityMicros: Number(after.quantityMicros),
    documentUomCode: before?.document_uom_code || after.documentUomCode, unitPriceCents: Number(after.unitPriceCents),
    calculationStages: [
      { stage: 'GROSS', amountCents: effectiveGrossCents },
      { stage: 'LINE', discountCents: effectiveLineDiscountCents, amountAfterCents: effectiveGrossCents - effectiveLineDiscountCents },
      { stage: 'HEADER', discountCents: effectiveHeaderAllocationCents, amountAfterCents: Number(after.amountCents) },
    ],
    effectiveGrossCents, effectiveLineDiscountCents, effectiveHeaderAllocationCents,
    finalAmountCents: Number(after.amountCents), originalPriceSnapshot: priceSnapshot, originalDiscountSnapshot: discountSnapshot,
    originalEvidenceHash: hash([priceSnapshot, discountSnapshot]) };
}

function validEffectiveEvidenceArithmetic(evidence) {
  const stages = evidence?.calculationStages;
  const amounts = [evidence?.effectiveGrossCents, evidence?.effectiveLineDiscountCents,
    evidence?.effectiveHeaderAllocationCents, evidence?.finalAmountCents].map(Number);
  return amounts.every((value) => Number.isSafeInteger(value) && value >= 0)
    && Array.isArray(stages) && stages.length === 3
    && stages[0]?.stage === 'GROSS' && stages[1]?.stage === 'LINE' && stages[2]?.stage === 'HEADER'
    && Number(evidence.effectiveGrossCents) === Number(stages[0].amountCents)
    && Number(evidence.effectiveLineDiscountCents) === Number(stages[1].discountCents)
    && Number(stages[1].amountAfterCents) === Number(evidence.effectiveGrossCents) - Number(evidence.effectiveLineDiscountCents)
    && Number(evidence.effectiveHeaderAllocationCents) === Number(stages[2].discountCents)
    && Number(stages[2].amountAfterCents) === Number(evidence.finalAmountCents)
    && Number(evidence.effectiveGrossCents) - Number(evidence.effectiveLineDiscountCents)
      - Number(evidence.effectiveHeaderAllocationCents) === Number(evidence.finalAmountCents);
}

function releaseChangeAuthorizationOccupancy(db, order, changeId, actor) {
  // R5 owner-aware release path for cancelled/rejected SUBMITTED or DRAFT Change
  // ADD rows. Only ADD operations carry authorisations; MODIFY/CANCEL lines reuse
  // the existing consumption record from the original SO line creation. The
  // expectedOwner filter rejects records owned by another change or a direct
  // SO consumption and refuses to release them. R7-P1-01 strict historic
  // validation + reconciliation ensures a corrupt ADD snapshot cannot silently
  // skip release and orphan the persisted consumption record.
  const owner = `SALES_ORDER_CHANGE:${changeId}`;
  const { claimed } = reconcileChangeAuthorizations(db, order, changeId);
  for (const authorizationId of claimed) {
    PRICE_OVERRIDE_CONSUMPTION.release(db, authorizationId, actor, { expectedOwner: owner });
  }
}

function executionFloorMicros(db, itemId) {
  const delivered = Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN d.status='CONFIRMED' THEN di.quantity ELSE 0 END),0) value
    FROM sales_delivery_items di JOIN sales_deliveries d ON d.id=di.delivery_id WHERE di.sales_order_item_id=?`).get(itemId).value || 0);
  const notified = Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN n.state IN ('CONFIRMED','CLOSED') THEN l.scheduled_qty_micros ELSE 0 END),0) value
    FROM delivery_notice_lines l JOIN delivery_notices n ON n.id=l.delivery_notice_id WHERE l.sales_order_item_id=?`).get(itemId).value || 0);
  return Math.max(Math.round(delivered * 1_000_000), notified);
}

function normalizedLines(db, order, operations, actor, changeId = null, { previouslyReservedAuthorizationIds = null } = {}) {
  if (!Array.isArray(operations) || !operations.length) throw new HttpError(422, '至少需要一条订单变更明细');
  const seen = new Set();
  const sharedConsumedAuthorizations = new Set();
  return operations.map((source, index) => {
    const op = String(source.op || 'MODIFY').toUpperCase();
    if (!['ADD', 'MODIFY', 'CANCEL'].includes(op)) throw new HttpError(422, '订单变更操作必须为 ADD、MODIFY 或 CANCEL');
    if (op === 'ADD') {
      const authoritative = buildAuthoritativeSalesLines(db, { orderDate: order.order_date, requestedDeliveryDate: order.requested_delivery_date, items: [source] }, actor, order.order_date, order.customer_id, order.salesperson_id, { consumedAuthorizationIds: sharedConsumedAuthorizations, changeId, previouslyReservedAuthorizationIds })[0];
      authoritative.lineNo = null;
      authoritative.effectiveCommercialEvidence = effectiveCommercialEvidence(db, order, null, authoritative);
      return { lineNo: index + 1, op, itemId: null, before: null, after: authoritative, beforeMicros: 0, floor: 0 };
    }
    const itemId = String(source.salesOrderItemId || '');
    if (!itemId || seen.has(itemId)) throw new HttpError(422, '订单变更行身份缺失或重复'); seen.add(itemId);
    const before = currentLine(db, order.id, itemId); if (!before) throw new HttpError(422, '订单明细不存在');
    const beforeMicros = Math.round(Number(before.quantity) * 1_000_000);
    const quantityMicros = op === 'CANCEL' ? 0 : safe(source.quantityMicros ?? beforeMicros, '变更后数量');
    const floor = executionFloorMicros(db, itemId);
    if (quantityMicros < floor) throw new HttpError(409, '变更后数量不得低于已通知或已交付事实', { code: 'SALES_ORDER_CHANGE_EXECUTED_FLOOR' });
    const after = { quantityMicros, plannedDeliveryDate: source.plannedDeliveryDate ?? before.planned_delivery_date,
      unitPriceCents: Number(before.unit_price_cents), amountCents: beforeMicros ? Math.round(Number(before.amount_cents) * quantityMicros / beforeMicros) : 0 };
    after.effectiveCommercialEvidence = effectiveCommercialEvidence(db, order, before, after);
    return { lineNo: index + 1, op, itemId, before, after, beforeMicros, floor };
  });
}

function snapshot(order, lines) {
  return { orderId: order.id, effectiveVersion: Number(order.effective_version), totalCents: Number(order.total_cents),
    lines: lines.map((line) => line.before ? ({ itemId: line.itemId, quantityMicros: line.beforeMicros, amountCents: Number(line.before.amount_cents), plannedDeliveryDate: line.before.planned_delivery_date }) : ({ itemId: null, op: 'ADD' })) };
}

function insertChange(db, { order, actor, path, body, initialState, requestKey }) {
  const parameters = parameterSnapshot(db, path); const changeId = id();
  const lines = normalizedLines(db, order, body.lines, actor, changeId);
  const before = snapshot(order, lines); const after = { ...before, effectiveVersion: before.effectiveVersion + 1,
    totalCents: before.totalCents + lines.reduce((sum, line) => sum + line.after.amountCents - Number(line.before?.amount_cents || 0), 0),
    lines: lines.map((line) => ({ itemId: line.itemId, ...line.after })) };
  const changeNo = makeNo(); const stamp = NOW();
  const reasonCode = String(body.reasonCode || 'OTHER').trim(); const reasonText = String(body.reason || body.reasonText || '').trim();
  if (!reasonText) throw new HttpError(422, '变更原因必填');
  db.prepare(`INSERT INTO sales_order_changes(id,change_no,sales_order_id,change_path,state,reason_code,reason_text,
    before_snapshot_hash,after_snapshot_hash,base_effective_version,target_effective_version,parameter_scope_key,parameter_snapshot_hash,
    order_change_mode_snapshot,request_idempotency_key,requested_by,requested_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(changeId, changeNo, order.id, path, initialState, reasonCode, reasonText,
      hash(before), hash(after), Number(order.effective_version), Number(order.effective_version) + 1, parameters.scopeKey, parameters.snapshotHash,
      parameters.parameter.orderChangeMode, requestKey || null, actor.id, stamp, stamp, stamp);
  const insert = db.prepare(`INSERT INTO sales_order_change_lines(id,change_id,line_no,op,sales_order_item_id,before_values_json,
    after_values_json,qty_delta_micros,amount_delta_cents,delivered_before_micros,delivered_after_micros,constraint_check_result)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const line of lines) insert.run(id(), changeId, line.lineNo, line.op, line.itemId, line.before ? JSON.stringify({ ...line.before, quantityMicros: line.beforeMicros }) : JSON.stringify({ exists: false, op: 'ADD' }),
    JSON.stringify(line.after), line.after.quantityMicros - line.beforeMicros, line.after.amountCents - Number(line.before?.amount_cents || 0),
    line.floor, line.floor, 'PASS');
  if (initialState === 'SUBMITTED') db.prepare(`INSERT INTO approval_requests(id,source_type,source_id,source_no,status,requester_id,submitted_at,created_at)
    VALUES(?,'SALES_ORDER_CHANGE',?,?,'PENDING',?,?,?)`).run(id(), changeId, changeNo, actor.id, stamp, stamp);
  audit(db, actor.id, path === 'CONTROLLED_DIRECT' ? 'CREATE_DIRECT_REQUEST' : 'CREATE_DOCUMENT', 'SALES_ORDER_CHANGE', changeId,
    JSON.stringify({ baseVersion: order.effective_version, parameterScope: parameters.scopeKey, parameterHash: parameters.snapshotHash }));
  return { id: changeId, changeNo, state: initialState };
}

export async function createDirectSalesOrderChange(db, req, res, actor, orderId) {
  requireSalesPermission(actor, 'SALES_ORDER_CHANGE_DIRECT_REQUEST'); const body = await readJson(req);
  const key = String(req.headers['idempotency-key'] || '').trim(); if (!key) throw new HttpError(422, 'Idempotency-Key 必填');
  const fingerprint = requestFingerprint(body); const replay = idempotencyReplay(db, 'SALES_ORDER_CHANGE_REQUEST', orderId, key, fingerprint);
  if (replay) return send(res, 200, { ...replay, replayed: true }); let result;
  transaction(db, () => { const order = orderForChange(db, orderId, actor, true); result = insertChange(db, { order, actor, path: 'CONTROLLED_DIRECT', body, initialState: 'SUBMITTED', requestKey: key });
    saveIdempotency(db, 'SALES_ORDER_CHANGE_REQUEST', orderId, key, fingerprint, result); });
  return send(res, 201, result);
}

export async function createSalesOrderChange(db, req, res, actor) {
  requireSalesPermission(actor, 'SALES_ORDER_CHANGE_DOCUMENT_MANAGE'); const body = await readJson(req); let result;
  transaction(db, () => { const order = orderForChange(db, body.salesOrderId, actor, true); result = insertChange(db, { order, actor, path: 'CONTROLLED_DOCUMENT', body, initialState: 'DRAFT' }); });
  return send(res, 201, result);
}

export function listSalesOrderChanges(db, res, actor, url) {
  requireSalesPermission(actor, 'ORDERS_VIEW');
  const state = String(url.searchParams.get('state') || '');
  const rows = db.prepare(`SELECT c.*,so.order_no,so.sales_group_id,so.order_date
    FROM sales_order_changes c JOIN sales_orders so ON so.id=c.sales_order_id
    WHERE (?='' OR c.state=?) ORDER BY c.created_at DESC`).all(state, state)
    .filter((row) => {
      try {
        assertGroupScope(db, actor, { salesGroupId: row.sales_group_id, businessDate: row.order_date, documentType: 'SALES_ORDER' });
        return true;
      } catch (error) {
        if (error.status === 403) return false;
        throw error;
      }
    });
  return send(res, 200, { changes: rows });
}

export function getSalesOrderChange(db, res, actor, changeId) {
  requireSalesPermission(actor, 'ORDERS_VIEW'); const change = db.prepare('SELECT * FROM sales_order_changes WHERE id=?').get(changeId);
  if (!change) throw new HttpError(404, '销售订单变更单不存在'); const order = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(change.sales_order_id);
  assertGroupScope(db, actor, { salesGroupId: order.sales_group_id, businessDate: order.order_date, documentType: 'SALES_ORDER' });
  return send(res, 200, { change: { ...change, lines: db.prepare('SELECT * FROM sales_order_change_lines WHERE change_id=? ORDER BY line_no').all(changeId) } });
}

export async function updateSalesOrderChange(db, req, res, actor, changeId) {
  requireSalesPermission(actor, 'SALES_ORDER_CHANGE_DOCUMENT_MANAGE'); const body = await readJson(req); let result;
  transaction(db, () => {
    const change = db.prepare(`SELECT * FROM sales_order_changes WHERE id=?${lockSuffix(db)}`).get(changeId);
    if (!change || change.change_path !== 'CONTROLLED_DOCUMENT') throw new HttpError(404, '正式销售订单变更单不存在');
    if (change.state !== 'DRAFT') throw new HttpError(409, '只有草稿变更单可以编辑'); if (change.requested_by !== actor.id && actor.roleCode !== 'ADMIN') throw new HttpError(403, '只能编辑自己创建的变更单');
    const order = orderForChange(db, change.sales_order_id, actor, true);

    // R5 / R6 owner-aware reservation reconciliation: snapshot the current ADD-authorisation
    // set owned by THIS change, project the new request's ADD-authorisation set, then
    // resolve the new lines so that already-valid same-owner reservations are verified
    // (not re-inserted) and removed reservations are released with owner verification.
    // The entire reconciliation runs inside one transaction so a failed edit restores
    // the exact previous change_lines and occupancy set. Corrupt historic
    // `after_values_json` is rejected with SALES_ORDER_CHANGE_EVIDENCE_CORRUPT — the
    // empty `catch {}` previously treated corrupt JSON as "no auth" and silently
    // dropped the reservation linkage, leaving orphan consumption records.
    const owner = `SALES_ORDER_CHANGE:${changeId}`;
    const { claimed: oldAuthIds } = reconcileChangeAuthorizations(db, order, changeId);
    const newAuthIds = new Set();
    if (Array.isArray(body.lines)) {
      for (const source of body.lines) {
        if (String(source.op || 'MODIFY').toUpperCase() !== 'ADD') continue;
        const authId = String(source.priceOverrideAuthorizationId || '').trim();
        if (authId) newAuthIds.add(authId);
      }
    }
    const previouslyReserved = new Set([...oldAuthIds].filter((id) => newAuthIds.has(id)));
    const lines = normalizedLines(db, order, body.lines, actor, changeId, { previouslyReservedAuthorizationIds: previouslyReserved });

    // Release ADD-authorisations removed from this change with the matching owner; this
    // must run AFTER authorizedOverrideEvidence has computed the new set so the
    // previouslyReserved pass has already verified retained ids. Owner verification
    // prevents touching records owned by another change or a direct SO consumption.
    for (const oldAuthId of oldAuthIds) {
      if (!newAuthIds.has(oldAuthId)) {
        PRICE_OVERRIDE_CONSUMPTION.release(db, oldAuthId, actor, { expectedOwner: owner });
      }
    }

    db.prepare('DELETE FROM sales_order_change_lines WHERE change_id=?').run(changeId);
    const before = snapshot(order, lines); const after = { ...before, effectiveVersion: Number(order.effective_version) + 1, lines: lines.map((line) => ({ itemId: line.itemId, ...line.after })) };
    db.prepare('UPDATE sales_order_changes SET reason_code=?,reason_text=?,before_snapshot_hash=?,after_snapshot_hash=?,base_effective_version=?,target_effective_version=?,updated_at=? WHERE id=?')
      .run(String(body.reasonCode || change.reason_code), String(body.reason || body.reasonText || change.reason_text), hash(before), hash(after), Number(order.effective_version), Number(order.effective_version) + 1, NOW(), changeId);
    const insert = db.prepare(`INSERT INTO sales_order_change_lines(id,change_id,line_no,op,sales_order_item_id,before_values_json,after_values_json,
      qty_delta_micros,amount_delta_cents,delivered_before_micros,delivered_after_micros,constraint_check_result) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const line of lines) insert.run(id(), changeId, line.lineNo, line.op, line.itemId, line.before ? JSON.stringify({ ...line.before, quantityMicros: line.beforeMicros }) : JSON.stringify({ exists: false, op: 'ADD' }), JSON.stringify(line.after),
      line.after.quantityMicros - line.beforeMicros, line.after.amountCents - Number(line.before?.amount_cents || 0), line.floor, line.floor, 'PASS');
    audit(db, actor.id, 'UPDATE', 'SALES_ORDER_CHANGE', changeId, 'draft lines'); result = { id: changeId, state: 'DRAFT' };
  }); return send(res, 200, result);
}

export function applySalesOrderChange(db, changeId, expectedBaseVersion, key, actor) {
  const fingerprint = requestFingerprint({ changeId, expectedBaseVersion });
  const replay = idempotencyReplay(db, 'SALES_ORDER_CHANGE_APPLY', changeId, key, fingerprint); if (replay) return { ...replay, replayed: true };
  const change = db.prepare(`SELECT * FROM sales_order_changes WHERE id=?${lockSuffix(db)}`).get(changeId);
  if (!change || change.state !== 'SUBMITTED') throw new HttpError(409, '变更单当前不可应用');
  if (change.requested_by === actor.id) throw new HttpError(409, '变更申请人与审批人必须分离');
  const order = orderForChange(db, change.sales_order_id, actor, true);
  if (Number(change.base_effective_version) !== Number(expectedBaseVersion) || Number(order.effective_version) !== Number(expectedBaseVersion)) throw new HttpError(409, '订单版本已变化，变更申请已过期', { code: 'SALES_ORDER_CHANGE_STALE_VERSION' });
  parameterSnapshot(db, change.change_path);
  // R7-P1-01: the historic ADD evidence must reconcile against the persisted
  // consumption records before any line is applied. If reconciliation throws,
  // the whole apply rolls back inside the same transaction.
  reconcileChangeAuthorizations(db, order, changeId, { assertClaims: true });
  const lines = db.prepare('SELECT * FROM sales_order_change_lines WHERE change_id=? ORDER BY sales_order_item_id').all(changeId);
  let totalDelta = 0;
  for (const line of lines) {
    const before = parse(line.before_values_json); const after = parse(line.after_values_json);
    if (line.op === 'ADD') {
      if (line.sales_order_item_id !== null || before?.exists !== false || before?.op !== 'ADD') throw new HttpError(409, '新增行变更证据损坏', { code: 'SALES_ORDER_CHANGE_EVIDENCE_CORRUPT' });
      // R7-P1-01: same strict validation as PATCH / REJECT / CANCEL paths so a corrupt
      // historic ADD snapshot can never pass apply.
      parseStrictAddAfter(db, order, line.after_values_json, '新增 ADD 行');
      const evidence = after.effectiveCommercialEvidence;
      if (!evidence || evidence.contractVersion !== 'SO_CHANGE_COMMERCIAL_EVIDENCE_V1'
        || Number(evidence.baseEffectiveVersion) !== expectedBaseVersion || Number(evidence.targetEffectiveVersion) !== expectedBaseVersion + 1
        || evidence.documentUomCode !== after.documentUomCode || Number(evidence.quantityMicros) !== Number(after.quantityMicros)
        || Number(evidence.finalAmountCents) !== Number(after.amountCents) || !validEffectiveEvidenceArithmetic(evidence)
        || evidence.originalEvidenceHash !== hash([after.priceSnapshot, after.discountSnapshot])) {
        throw new HttpError(409, '新增行变更商业证据损坏', { code: 'SALES_ORDER_CHANGE_EVIDENCE_CORRUPT' });
      }
      // R5 server-authoritative owner-aware consumption re-check at apply time: trust
      // neither the request-time snapshot nor the change-line JSON. The persistence
      // record created at SUBMIT time must still exist and still be owned by THIS
      // change. If the record is missing or owned by another change, the apply rolls
      // back with PRICE_OVERRIDE_AUTHORIZATION_NOT_RESERVED or
      // PRICE_OVERRIDE_AUTHORIZATION_OWNER_MISMATCH and zero side-effects.
      const addAuthorizationId = after.priceSnapshot?.authorizationEvidence?.authorizationId;
      if (addAuthorizationId) PRICE_OVERRIDE_CONSUMPTION.assertReserved(db, addAuthorizationId, { expectedOwner: `SALES_ORDER_CHANGE:${changeId}` });
      const lineNo = Number(db.prepare('SELECT COALESCE(MAX(line_no),0)+1 value FROM sales_order_items WHERE order_id=?').get(order.id).value);
      insertSalesOrderLines(db, order.id, [{ ...after, lineNo }]);
      totalDelta += Number(after.amountCents);
      continue;
    }
    const current = currentLine(db, order.id, line.sales_order_item_id);
    if (!current || Math.round(Number(current.quantity) * 1_000_000) !== Number(before.quantityMicros)
      || Number(current.amount_cents) !== Number(before.amount_cents)) throw new HttpError(409, '订单明细已变化，变更申请已过期', { code: 'SALES_ORDER_CHANGE_STALE_LINE' });
    const floor = executionFloorMicros(db, current.id); if (Number(after.quantityMicros) < floor) throw new HttpError(409, '变更后数量低于当前已执行事实');
    const evidence = after.effectiveCommercialEvidence;
    if (!evidence || evidence.contractVersion !== 'SO_CHANGE_COMMERCIAL_EVIDENCE_V1'
      || Number(evidence.baseEffectiveVersion) !== expectedBaseVersion || Number(evidence.targetEffectiveVersion) !== expectedBaseVersion + 1
      || evidence.documentUomCode !== current.document_uom_code || Number(evidence.quantityMicros) !== Number(after.quantityMicros)
      || Number(evidence.finalAmountCents) !== Number(after.amountCents)
      || !validEffectiveEvidenceArithmetic(evidence)
      || evidence.originalEvidenceHash !== hash([parse(current.price_snapshot_json), parse(current.discount_snapshot_json)])) {
      throw new HttpError(409, '订单变更商业证据损坏', { code: 'SALES_ORDER_CHANGE_EVIDENCE_CORRUPT' });
    }
    db.prepare(`UPDATE sales_order_items SET quantity=?,amount_cents=?,document_quantity_num=?,planned_delivery_date=? WHERE id=?`)
      .run(Number(after.quantityMicros) / 1_000_000, Number(after.amountCents), Number(after.quantityMicros), after.plannedDeliveryDate, current.id);
    totalDelta += Number(after.amountCents) - Number(current.amount_cents);
  }
  const changed = db.prepare('UPDATE sales_orders SET total_cents=total_cents+?,effective_version=effective_version+1,updated_at=? WHERE id=? AND effective_version=?')
    .run(totalDelta, NOW(), order.id, expectedBaseVersion);
  if (Number(changed.changes ?? changed.affectedRows) !== 1) throw new HttpError(409, '订单版本 CAS 冲突', { code: 'SALES_ORDER_CHANGE_CAS_CONFLICT' });
  const stamp = NOW(); db.prepare("UPDATE sales_order_changes SET state='APPLIED',approver_id=?,approved_at=?,applied_by=?,applied_at=?,application_idempotency_key=?,updated_at=? WHERE id=?")
    .run(actor.id, stamp, actor.id, stamp, key, stamp, changeId);
  // The effective-version validator reads append-only APPLIED evidence. Mark
  // this change inside the same transaction before validation so the current
  // target version participates; any failure rolls the entire transaction back.
  validateEffectiveOrderCommercialEvidence(db, order.id, expectedBaseVersion + 1);
  db.prepare("UPDATE approval_requests SET status='APPROVED',reviewer_id=?,reviewed_at=? WHERE source_type='SALES_ORDER_CHANGE' AND source_id=? AND status='PENDING'").run(actor.id, stamp, changeId);
  const result = { id: changeId, salesOrderId: order.id, effectiveVersion: expectedBaseVersion + 1, state: 'APPLIED' };
  saveIdempotency(db, 'SALES_ORDER_CHANGE_APPLY', changeId, key, fingerprint, result); audit(db, actor.id, 'APPROVE_AND_APPLY', 'SALES_ORDER_CHANGE', changeId, JSON.stringify(result));
  return result;
}

export function validateEffectiveOrderCommercialEvidence(db, orderId, expectedVersion) {
  const order = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(orderId);
  if (!order || Number(order.effective_version) !== Number(expectedVersion)) throw new HttpError(409, '订单有效版本不一致', { code: 'SALES_ORDER_EFFECTIVE_EVIDENCE_MISMATCH' });
  const currentLines = db.prepare('SELECT * FROM sales_order_items WHERE order_id=? ORDER BY line_no').all(orderId);
  const latest = new Map();
  const applied = db.prepare(`SELECT l.*,c.target_effective_version FROM sales_order_change_lines l
    JOIN sales_order_changes c ON c.id=l.change_id WHERE c.sales_order_id=? AND c.state='APPLIED'
    ORDER BY c.target_effective_version,l.line_no`).all(orderId);
  for (const row of applied) {
    const after = parse(row.after_values_json); const itemId = row.sales_order_item_id || after.id;
    if (itemId) latest.set(itemId, { after, targetVersion: Number(row.target_effective_version) });
  }
  let total = 0;
  for (const line of currentLines) {
    total += Number(line.amount_cents); const versioned = latest.get(line.id); if (!versioned) continue;
    const evidence = versioned.after.effectiveCommercialEvidence;
    if (!evidence || Number(evidence.targetEffectiveVersion) !== versioned.targetVersion
      || Number(versioned.after.quantityMicros) !== Number(line.document_quantity_num)
      || Number(versioned.after.amountCents) !== Number(line.amount_cents)
      || !validEffectiveEvidenceArithmetic(evidence)
      || (versioned.after.documentUomCode && versioned.after.documentUomCode !== line.document_uom_code)) {
      throw new HttpError(409, '当前订单行与有效版本商业证据不一致', { code: 'SALES_ORDER_EFFECTIVE_EVIDENCE_MISMATCH' });
    }
  }
  if (!Number.isSafeInteger(total) || total !== Number(order.total_cents)) throw new HttpError(409, '当前订单总额与有效版本商业证据不一致', { code: 'SALES_ORDER_EFFECTIVE_EVIDENCE_MISMATCH' });
  return true;
}

export async function salesOrderChangeAction(db, req, res, actor, changeId, action) {
  const body = await readJson(req); let result;
  transaction(db, () => {
    // R6-P1-01: every state-mutation action loads the change + underlying SO
    // through the same helper and re-asserts sales-group scope. State-machine
    // constraints (DRAFT/SUBMITTED/APPLIED) remain in the per-action branches
    // so REJECT / CANCEL can still target a SUBMITTED change after the SO is
    // closed, while the scope check still prevents cross-group actors from
    // operating on a change they have no business visibility for.
    const { change, order } = loadChangeWithScope(db, changeId, actor, true);
    if (action === 'submit') {
      requireSalesPermission(actor, 'SALES_ORDER_CHANGE_DOCUMENT_MANAGE');
      if (change.state !== 'DRAFT') throw new HttpError(409, '只有草稿变更单可以提交');
      // SUBMIT must respect the requester / admin contract used by PATCH so a
      // user with the permission cannot submit another user's DRAFT and
      // silently push it past the SUBMIT gate.
      if (change.requested_by !== actor.id && actor.roleCode !== 'ADMIN') {
        throw new HttpError(403, '只能提交自己创建的变更单', { code: 'SALES_ORDER_CHANGE_NOT_REQUESTER' });
      }
      parameterSnapshot(db, change.change_path);
      const stamp = NOW(); db.prepare("UPDATE sales_order_changes SET state='SUBMITTED',updated_at=? WHERE id=?").run(stamp, changeId);
      db.prepare(`INSERT INTO approval_requests(id,source_type,source_id,source_no,status,requester_id,submitted_at,created_at) VALUES(?,'SALES_ORDER_CHANGE',?,?,'PENDING',?,?,?)`).run(id(), changeId, change.change_no, actor.id, stamp, stamp);
      audit(db, actor.id, 'SUBMIT', 'SALES_ORDER_CHANGE', changeId, ''); result = { id: changeId, state: 'SUBMITTED' };
    } else if (action === 'approve') { requireSalesPermission(actor, 'SALES_ORDER_CHANGE_APPROVE'); const key = String(req.headers['idempotency-key'] || '').trim(); if (!key) throw new HttpError(422, 'Idempotency-Key 必填'); result = applySalesOrderChange(db, changeId, Number(change.base_effective_version), key, actor);
    } else if (action === 'reject') { requireSalesPermission(actor, 'SALES_ORDER_CHANGE_APPROVE'); if (change.state !== 'SUBMITTED' || change.requested_by === actor.id) throw new HttpError(409, '变更单不可驳回'); const reason = String(body.reason || '').trim(); if (!reason) throw new HttpError(422, '驳回原因必填');
      releaseChangeAuthorizationOccupancy(db, order, changeId, actor);
      db.prepare("UPDATE sales_order_changes SET state='REJECTED',approver_id=?,approved_at=?,updated_at=? WHERE id=?").run(actor.id, NOW(), NOW(), changeId); db.prepare("UPDATE approval_requests SET status='REJECTED',reviewer_id=?,reviewed_at=?,rejection_reason=? WHERE source_type='SALES_ORDER_CHANGE' AND source_id=? AND status='PENDING'").run(actor.id, NOW(), reason, changeId); audit(db, actor.id, 'REJECT', 'SALES_ORDER_CHANGE', changeId, reason); result = { id: changeId, state: 'REJECTED' };
    } else if (action === 'cancel') { requireSalesPermission(actor, 'SALES_ORDER_CHANGE_DOCUMENT_MANAGE'); if (!['DRAFT','SUBMITTED'].includes(change.state) || change.requested_by !== actor.id) throw new HttpError(409, '变更单不可取消');
      releaseChangeAuthorizationOccupancy(db, order, changeId, actor);
      db.prepare("UPDATE sales_order_changes SET state='CANCELLED',updated_at=? WHERE id=?").run(NOW(), changeId); audit(db, actor.id, 'CANCEL', 'SALES_ORDER_CHANGE', changeId, String(body.reason || '')); result = { id: changeId, state: 'CANCELLED' };
    } else throw new HttpError(400, '无效变更单动作');
  }); return send(res, 200, result);
}
