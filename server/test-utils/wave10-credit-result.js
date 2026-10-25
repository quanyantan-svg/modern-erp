// Wave 10 — the persisted credit check result contract.
//
// `credit_check_results` has no `exposure_cents` column. The production
// writer (`server/modules/credit-check.js`) stores the observed exposure
// inside `component_breakdown_json`, under the approved breakdown contract.
//
// This module owns the read path for that persisted fact. It is engine
// neutral and dependency free: the helpers are pure over the persisted rows,
// so the assertion path can be proven without a database and the same read
// path is used by the real-MySQL acceptance.

import assert from 'node:assert/strict';

export const W10_EXPOSURE_BREAKDOWN_CONTRACT = 'CREDIT_EXPOSURE_BREAKDOWN_WAVE10_V1';

// The one result row that carries the observed exposure for one check group
// and one scope. The correlation is by check group and scope, never by the
// newest row: the newest row belongs to another decision and would read
// another decision's exposure.
export function selectCreditExposureRow(rows, checkGroupId, scopeType = 'CUSTOMER_AGGREGATE') {
  const matching = (rows || []).filter((row) => row.check_group_id === checkGroupId && row.scope_type === scopeType);
  if (!matching.length) throw new Error(`WAVE10_CREDIT_EXPOSURE_ROW_MISSING: ${checkGroupId}/${scopeType}`);
  if (matching.length > 1) throw new Error(`WAVE10_CREDIT_EXPOSURE_ROW_AMBIGUOUS: ${checkGroupId}/${scopeType}`);
  return matching[0];
}

// The observed exposure of one persisted credit check result. The breakdown
// must carry the approved contract version and a legal cents amount; a
// missing field, a non-integer amount or an unreadable document is a defect
// and is never a silent zero.
export function parseCreditExposureCents(componentBreakdownJson) {
  let breakdown;
  try { breakdown = JSON.parse(String(componentBreakdownJson ?? '')); }
  catch (error) { throw new Error(`WAVE10_CREDIT_EXPOSURE_BREAKDOWN_UNREADABLE: ${error.message}`); }
  if (!breakdown || typeof breakdown !== 'object') throw new Error('WAVE10_CREDIT_EXPOSURE_BREAKDOWN_UNREADABLE: not an object');
  if (breakdown.contractVersion !== W10_EXPOSURE_BREAKDOWN_CONTRACT) {
    throw new Error(`WAVE10_CREDIT_EXPOSURE_BREAKDOWN_CONTRACT: ${breakdown.contractVersion ?? 'absent'}`);
  }
  const exposureCents = breakdown.exposureCents;
  if (!Number.isSafeInteger(exposureCents)) {
    throw new Error(`WAVE10_CREDIT_EXPOSURE_CENTS_INVALID: ${String(exposureCents)}`);
  }
  return exposureCents;
}

// The observed exposure of one check group, read from the persisted rows.
export function readCreditExposureCents(db, checkGroupId, scopeType = 'CUSTOMER_AGGREGATE') {
  const rows = db.prepare(`SELECT check_group_id,scope_type,component_breakdown_json
    FROM credit_check_results WHERE check_group_id=?`).all(checkGroupId);
  const row = selectCreditExposureRow(rows, checkGroupId, scopeType);
  return Object.freeze({
    checkGroupId, scopeType, exposureCents: parseCreditExposureCents(row.component_breakdown_json),
  });
}

// The observed exposure must be exactly the OLD or exactly the NEW canonical
// exposure of the raced transition. Any other amount — including zero, and
// including the amount of another check — is a defect.
export function assertObservedExposure(observedCents, authoritativeExposures, label = 'the credit check') {
  const allowed = (authoritativeExposures || []).map((value) => Number(value));
  assert.ok(Number.isSafeInteger(observedCents), `${label}: the observed exposure must be a legal cents amount`);
  assert.ok(allowed.includes(observedCents),
    `${label}: the check must observe exactly the OLD or the NEW canonical exposure (${observedCents} vs ${allowed.join('/')})`);
  return observedCents;
}
