// V22 — Finance Operations Wave A.
//
// FO02 — Recognition Mode Policy.
//
// Single canonical recognition policy resolver.
// Per solution.md §28.2.2:
//   resolveRecognitionPolicy(side, sourceType, sourceId, businessDate)
//
// Existing LEGACY_DIRECT billing-mode is mapped onto canonical
// recognition models by seed rows installed by
// server/migrations/v22-finance-wave-a-foundation.js.

import { randomUUID } from 'node:crypto';
import { audit } from '../lib/audit.js';
import { allow, HttpError, optionalText, readJson, requiredText, send } from '../lib/http.js';

const VALID_MODES = new Set([
  'DIRECT_BUSINESS_OPEN_ITEM',
  'INVOICE_DRIVEN_OPEN_ITEM',
  'PROVISIONAL_TO_FINANCIAL',
]);

export function resolveRecognitionPolicy(db, side, sourceType, sourceId, businessDate) {
  if (!side || !sourceType) {
    throw new Error('invalid recognition policy query');
  }
  // 1. source-level active override
  const sourceOverride = db.prepare(
    `SELECT recognition_mode, effective_date
       FROM finance_recognition_policy
      WHERE side=? AND source_type=? AND source_id=? AND active=1
      ORDER BY effective_date DESC, id ASC
      LIMIT 1`
  ).get(side, sourceType, sourceId);
  if (sourceOverride) {
    if (sourceOverride.effective_date && businessDate && businessDate < sourceOverride.effective_date) {
      // effective in future → fall through to site-wide
    } else {
      return { mode: sourceOverride.recognition_mode, scope: 'SOURCE' };
    }
  }
  // 2. site-wide active default
  const siteWide = db.prepare(
    `SELECT recognition_mode
       FROM finance_recognition_policy
      WHERE side=? AND source_type=? AND source_id IS NULL AND active=1
      ORDER BY effective_date DESC, id ASC
      LIMIT 1`
  ).get(side, sourceType);
  if (siteWide) return { mode: siteWide.recognition_mode, scope: 'SITE' };

  // 3. last-resort safe default = DIRECT_BUSINESS_OPEN_ITEM
  return { mode: 'DIRECT_BUSINESS_OPEN_ITEM', scope: 'FALLBACK' };
}

export const RECOGNITION_MODES = Object.freeze({
  DIRECT: 'DIRECT_BUSINESS_OPEN_ITEM',
  INVOICE_DRIVEN: 'INVOICE_DRIVEN_OPEN_ITEM',
  PROVISIONAL: 'PROVISIONAL_TO_FINANCIAL',
});

export function listRecognitionPolicies(db, res, actor) {
  allow(actor, 'FINANCE_RECOGNITION_POLICY_VIEW');
  return send(res, 200, { policies: db.prepare('SELECT * FROM finance_recognition_policy ORDER BY side,source_type,effective_date DESC,id').all() });
}

export async function upsertRecognitionPolicy(db, req, res, actor) {
  allow(actor, 'FINANCE_RECOGNITION_POLICY_MANAGE');
  const body = await readJson(req);
  const side = requiredText(body.side, 'side', 4).toUpperCase();
  if (!['AR', 'AP'].includes(side)) throw new HttpError(400, 'side 必须为 AR/AP');
  const sourceType = requiredText(body.sourceType, 'sourceType', 32).toUpperCase();
  const sourceId = optionalText(body.sourceId ?? '', 64) || null;
  const mode = requiredText(body.recognitionMode, 'recognitionMode', 40).toUpperCase();
  if (!VALID_MODES.has(mode)) throw new HttpError(400, 'recognitionMode 非法');
  const effectiveDate = optionalText(body.effectiveDate ?? '', 16);
  const active = body.active === false ? 0 : 1;
  const existing = sourceId
    ? db.prepare('SELECT id FROM finance_recognition_policy WHERE side=? AND source_type=? AND source_id=? AND effective_date=?').get(side, sourceType, sourceId, effectiveDate)
    : db.prepare('SELECT id FROM finance_recognition_policy WHERE side=? AND source_type=? AND source_id IS NULL AND effective_date=?').get(side, sourceType, effectiveDate);
  const id = existing?.id || randomUUID(); const now = new Date().toISOString();
  if (existing) db.prepare('UPDATE finance_recognition_policy SET recognition_mode=?,active=?,created_by=?,created_at=? WHERE id=?').run(mode, active, actor.id, now, id);
  else db.prepare('INSERT INTO finance_recognition_policy(id,side,source_type,source_id,recognition_mode,effective_date,active,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, side, sourceType, sourceId, mode, effectiveDate, active, actor.id, now);
  audit(db, actor.id, existing ? 'UPDATE' : 'CREATE', 'FINANCE_RECOGNITION_POLICY', id, `${side}:${sourceType}:${mode}`);
  return send(res, 200, { id, side, sourceType, recognitionMode: mode });
}
