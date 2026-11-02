// M1C-WP-1 — canonical delivery-schedule consumption ledger.
//
// Contract source: M1-Core Active Design §5.2.1 / §5.2.3 / §11 and the
// approved Requirement MC-REQ-02 (docs/requirements/procurement-outsourcing.md
// §31.13).
//
// The ledger is the ONLY authoritative source of delivery-schedule capacity.
// The legacy `purchase_order_delivery_schedules.received_quantity` column is
// never written here and is never read for capacity, so the same consumption
// can never be deducted twice ("避免旧累计字段和新 effect 台账双重扣减").
//
// Effects are append-only and signed:
//   - a positive effect reserves schedule capacity for a receipt line;
//   - a reversal is a NEW negative effect that points at the original
//     (reverses_effect_id / reverses_effect_key), never a mutation of it.
// The net consumption is the sum of the signed quantities of the EFFECTIVE
// effects.

import { randomUUID } from 'node:crypto';
import { HttpError } from '../lib/http.js';
import { requestFingerprint } from './financial-controls.js';

export const SCHEDULE_EFFECT_BUSINESS_EVENT_TYPE = 'PURCHASE_RECEIPT_CREATE';
export const SCHEDULE_EFFECT_REVERSAL_BUSINESS_EVENT_TYPE = 'PURCHASE_RECEIPT_CANCEL';

/** Deterministic physical-effect key. It is derived from the business event,
 * never from the external Idempotency-Key, so the two key spaces stay
 * strictly separated (Active Design §6). */
export function scheduleEffectIdempotencyKey(businessEventType, businessEventId, businessEventItemId, reversesEffectKey = '') {
  return `SCHEDULE_CONSUMPTION:${businessEventType}:${businessEventId}:${businessEventItemId}:${reversesEffectKey}`;
}

/** Net consumption of one delivery schedule. VOIDED effects never counted. */
export function scheduleConsumedQuantity(db, deliveryScheduleId) {
  const row = db.prepare(`SELECT COALESCE(SUM(signed_quantity),0) q FROM schedule_consumption_effects
    WHERE delivery_schedule_id=? AND effect_state='EFFECTIVE'`).get(deliveryScheduleId);
  return Number(row?.q || 0);
}

export function findScheduleEffect(db, idempotencyKey) {
  return db.prepare('SELECT * FROM schedule_consumption_effects WHERE idempotency_key=?').get(idempotencyKey) || null;
}

function insertEffect(db, effect) {
  db.prepare(`INSERT INTO schedule_consumption_effects(
      id,purchase_order_item_id,delivery_schedule_id,source_type,source_item_id,
      business_event_type,business_event_id,business_event_item_id,signed_quantity,
      reverses_effect_id,reverses_effect_key,effect_state,idempotency_key,request_fingerprint,
      business_date,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'EFFECTIVE',?,?,?,?)`).run(
    effect.id, effect.purchaseOrderItemId, effect.deliveryScheduleId, effect.sourceType, effect.sourceItemId,
    effect.businessEventType, effect.businessEventId, effect.businessEventItemId, effect.signedQuantity,
    effect.reversesEffectId ?? null, effect.reversesEffectKey ?? '',
    effect.idempotencyKey, effect.requestFingerprint, effect.businessDate, effect.createdAt,
  );
}

/**
 * Register a positive consumption effect. Re-registering the same business
 * event with the same payload is a no-op (idempotent replay); re-registering
 * it with a different payload is a hard rejection.
 */
export function recordScheduleConsumption(db, {
  purchaseOrderItemId, deliveryScheduleId, sourceType, sourceItemId,
  businessEventType, businessEventId, businessEventItemId, signedQuantity,
  businessDate, reversesEffectId = null, reversesEffectKey = '',
}) {
  if (!(Number(signedQuantity) > 0)) throw new HttpError(400, '交期消费数量必须为正数');
  if (!purchaseOrderItemId || !deliveryScheduleId) throw new HttpError(400, '交期消费必须绑定供料订单行与交期');
  const idempotencyKey = scheduleEffectIdempotencyKey(businessEventType, businessEventId, businessEventItemId, reversesEffectKey);
  const fingerprint = requestFingerprint({
    purchaseOrderItemId, deliveryScheduleId, sourceType, sourceItemId,
    businessEventType, businessEventId, businessEventItemId, signedQuantity, reversesEffectId, reversesEffectKey,
  });
  const existing = findScheduleEffect(db, idempotencyKey);
  if (existing) {
    if (existing.request_fingerprint !== fingerprint) {
      throw new HttpError(409, '同一交期消费事件不能登记不同的消费内容');
    }
    return { id: existing.id, idempotencyKey, replayed: true };
  }
  const id = randomUUID();
  insertEffect(db, {
    id, purchaseOrderItemId, deliveryScheduleId, sourceType, sourceItemId,
    businessEventType, businessEventId, businessEventItemId, signedQuantity,
    reversesEffectId, reversesEffectKey, idempotencyKey, requestFingerprint: fingerprint,
    businessDate: businessDate || new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
  });
  return { id, idempotencyKey, replayed: false };
}

/**
 * Release a previously registered consumption. The original effect is never
 * mutated: the release is a new negative effect that points at it.
 */
export function recordScheduleConsumptionReversal(db, {
  purchaseOrderItemId, deliveryScheduleId, sourceType, sourceItemId,
  businessEventType, businessEventId, businessEventItemId, signedQuantity, reversesEffectId, businessDate,
}) {
  if (!(Number(signedQuantity) > 0)) throw new HttpError(400, '交期消费冲销数量必须为正数');
  const original = db.prepare('SELECT * FROM schedule_consumption_effects WHERE id=?').get(reversesEffectId);
  if (!original) throw new HttpError(409, '交期消费冲销缺少原始消费事实');
  if (original.effect_state !== 'EFFECTIVE') throw new HttpError(409, '交期消费冲销的原始消费事实已失效');
  const reversesEffectKey = `REVERSAL:${original.id}`;
  const idempotencyKey = scheduleEffectIdempotencyKey(businessEventType, businessEventId, businessEventItemId, reversesEffectKey);
  const fingerprint = requestFingerprint({
    purchaseOrderItemId, deliveryScheduleId, sourceType, sourceItemId,
    businessEventType, businessEventId, businessEventItemId, signedQuantity, reversesEffectId, reversesEffectKey,
  });
  const existing = findScheduleEffect(db, idempotencyKey);
  if (existing) {
    if (existing.request_fingerprint !== fingerprint) {
      throw new HttpError(409, '同一交期冲销事件不能登记不同的冲销内容');
    }
    return { id: existing.id, idempotencyKey, replayed: true };
  }
  const id = randomUUID();
  insertEffect(db, {
    id, purchaseOrderItemId, deliveryScheduleId, sourceType, sourceItemId,
    businessEventType, businessEventId, businessEventItemId, signedQuantity: -Math.abs(signedQuantity),
    reversesEffectId: original.id, reversesEffectKey, idempotencyKey, requestFingerprint: fingerprint,
    businessDate: businessDate || new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
  });
  return { id, idempotencyKey, replayed: false };
}
