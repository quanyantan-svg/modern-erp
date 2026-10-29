// Shared W11-A U2 Credit Query fixture helpers.
//
// Both the corrected SQLite suite and the protected real-MySQL E3 suite use
// these helpers. Business facts are created by the existing production
// writers; the measured GET phase starts only after fixture preparation.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ADMIN, CREDIT_OBJECT_TYPE, HISTORICAL, PROFILE_FROM, TODAY,
  invoke, read, seedWorld,
} from './wave11-sec-scope-fixture.js';
import { createCreditRule } from '../modules/credit-policy.js';
import { createCreditProfile } from '../modules/credit-profile.js';
import { postAdvanceReceipt } from '../modules/finance-unapplied-balance.js';
import { getCreditExposure } from '../modules/credit-query.js';
import {
  seedWave10AcceptanceBase, wave10BusinessDate, wave10FutureBusinessDateFrom,
} from './wave10-mysql-acceptance-fixture.js';

export const SELF_CUSTOMER = 'cus-w11-self';
export const OTHER_CUSTOMER = 'cus-w11-other';
export const SELF_SALESPERSON = 'sp-self';
export const OTHER_SALESPERSON = 'sp-other';
export const SELF_TOTAL_CENTS = 300000;
export const OTHER_TOTAL_CENTS = 60000;
export const DEFAULT_EXPOSURE_STAGE = 'SO_SUBMIT';

export async function seedCreditQueryWorld(db) {
  const world = await seedWorld(db);
  approveOrder(db, `so-${SELF_CUSTOMER}`, SELF_TOTAL_CENTS);
  approveOrder(db, `so-${OTHER_CUSTOMER}`, OTHER_TOTAL_CENTS);
  return world;
}

export function approveOrder(db, orderId, totalCents) {
  db.prepare(`UPDATE sales_orders SET status='APPROVED', total_cents=?, reviewed_at=?, commercial_close_state='OPEN'
    WHERE id=?`).run(totalCents, `${HISTORICAL}T00:00:00.000Z`, orderId);
  db.prepare(`UPDATE sales_order_items SET unit_price_cents=?, amount_cents=? WHERE order_id=?`)
    .run(totalCents, totalCents, orderId);
}

export function canonicalUsedCents(components) {
  return Number(components.approvedSoCommitmentCents || 0)
    + Number(components.deliveredNotSettledCents || 0)
    + Number(components.arOpenCents || 0)
    - Number(components.eligiblePrepaymentCents || 0);
}

export function scopeOf(exposure, scopeType) {
  return exposure.scopes.find((scope) => scope.scopeType === scopeType) || null;
}

export function readExposure(db, actor, params = {}) {
  return read(getCreditExposure, db, actor, { stage: DEFAULT_EXPOSURE_STAGE, ...params });
}

export async function writeAdvanceReceipt(db, { amountCents, businessDate = TODAY, key }) {
  const financeActor = { ...ADMIN, permissions: [...ADMIN.permissions, 'COLLECTION_MANAGE'] };
  const result = await invoke(postAdvanceReceipt, db, {
    customerId: SELF_CUSTOMER,
    amountCents,
    businessDate,
  }, financeActor, key);
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  return result.body;
}

export async function writeStageRule(db, { ruleCode, businessStage, key }) {
  const result = await invoke(createCreditRule, db, {
    ruleCode,
    businessStage,
    scenario: 'BLOCK',
    checkTiming: 'BEFORE_WRITE',
    controlStrength: 'BLOCK',
    creditItem: 'ORDER_EXPOSURE',
    effectiveFrom: PROFILE_FROM,
    status: 'ACTIVE',
    resultPayload: { identity: businessStage },
  }, ADMIN, key);
  assert.equal(result.statusCode, 201, JSON.stringify(result.body));
  return result.body.rule;
}

export async function writeSubLimitProfile(db, { salespersonId, ruleId, key }) {
  const result = await invoke(createCreditProfile, db, {
    customerId: SELF_CUSTOMER,
    salespersonId,
    creditObjectType: CREDIT_OBJECT_TYPE,
    creditObjectId: `CREDIT-${SELF_CUSTOMER.toUpperCase()}`,
    creditLimitCents: 70000,
    initialState: 'NORMAL',
    status: 'ACTIVE',
    ratingGrade: 'A',
    overdueDayPolicy: '15',
    ruleId,
    effectiveFrom: PROFILE_FROM,
  }, ADMIN, key);
  assert.equal(result.statusCode, 201, JSON.stringify(result.body));
  return result.body.profile;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function contentDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function databaseSnapshot(db) {
  const tables = db.dialect === 'mysql'
    ? db.prepare(`SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY table_name`).all()
    : db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
  const snapshot = {};
  for (const { name } of tables) {
    const escaped = String(name).replace(/`/g, '``');
    const rows = db.prepare(`SELECT * FROM \`${escaped}\``).all();
    const normalized = rows.map((row) => canonical(row)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    snapshot[name] = { count: normalized.length, digest: contentDigest(normalized) };
  }
  return snapshot;
}

export function databaseDigest(db) {
  return contentDigest(databaseSnapshot(db));
}

// ---------------------------------------------------------------------------
// The ONE_TIME consumption world of the protected real-MySQL cases (T-17, T-18)
//
// The E3 campaign runs the shared Credit Query world (M1..M10) and the ONE_TIME
// consumption cases (T-17, T-18) on ONE MySQL database. Each world is correct
// in isolation, but two production resolvers treat their facts as GLOBAL:
//
//   * `readEffectiveParameter` refuses to choose between two ACTIVE versions of
//     the same parameter code that are effective on the business date
//     (`CREDIT_EFFECTIVE_VERSION_AMBIGUOUS`);
//   * `effectiveRuleRows` collects EVERY effective rule of the stage and the
//     strongest outcome wins, so a mandatory BLOCK rule of the shared world
//     turns the ONE_TIME over-limit conclusion into a BLOCK.
//
// The composition therefore has to leave exactly ONE effective parameter
// version per code, and a RELEASABLE rule set at the ONE_TIME stage. Both are
// fixture facts: no production module, schema or migration is involved.
// ---------------------------------------------------------------------------

// The stage of the ONE_TIME cases. It is the stage the normative SQLite
// sibling (T-01..T-14) uses, and the only stage of the composed E3 database
// whose effective rule set is releasable: the shared world's SO_APPROVE rule
// is a mandatory BLOCK, which would make the over-limit conclusion a BLOCK.
const ONE_TIME_STAGE = 'SO_SUBMIT';
const ONE_TIME_AGGREGATE_LIMIT_CENTS = 50000;
export const ONE_TIME_PROPOSED_DELTA_CENTS = 100000;
export const ONE_TIME_OVERRIDE_CENTS = 50000;
export const ONE_TIME_CEILING_CENTS = 100000;

function previousBusinessDate(businessDate) {
  const probe = new Date(`${businessDate}T00:00:00.000Z`);
  probe.setUTCDate(probe.getUTCDate() - 1);
  return probe.toISOString().slice(0, 10);
}

/**
 * Reconcile the ACTIVE versions of one parameter code into a single effective
 * version per business date.
 *
 * The transition is the one the production writer performs when it installs a
 * new version (`closePredecessorAndAssertRange`): the predecessor's window is
 * closed on the day before its successor starts. The reconciled versions always
 * carry the SAME value, so closing a window never changes the fact the
 * parameter states on any date; the reconciliation only removes the overlap
 * that makes the production resolver refuse to choose.
 */
export function reconcileParameterVersions(db, { code, businessDate }) {
  const rows = db.prepare(`SELECT id,value_bool,effective_from,effective_to,superseded_by_id FROM credit_parameters
    WHERE code=? AND status='ACTIVE' ORDER BY effective_from,id`).all(code);
  if (new Set(rows.map((row) => String(row.value_bool))).size > 1) {
    throw new Error(`W11A_PARAMETER_VERSION_VALUES_CONFLICT:${code}`);
  }
  const boundaries = rows.map((row) => row.effective_to);
  const closed = [];
  for (let index = 0; index + 1 < rows.length; index += 1) {
    const earlier = rows[index];
    const later = rows[index + 1];
    if (boundaries[index] != null && boundaries[index] < later.effective_from) continue;
    const boundary = previousBusinessDate(later.effective_from);
    if (boundary < earlier.effective_from) {
      throw new Error(`W11A_PARAMETER_VERSION_RANGE_INVALID:${code}:${earlier.id}`);
    }
    // The production transition closes the predecessor on the day before its
    // successor starts and links the two versions. The link is only written
    // when the predecessor does not carry one already.
    if (earlier.superseded_by_id == null) {
      db.prepare('UPDATE credit_parameters SET effective_to=?, superseded_by_id=? WHERE id=?')
        .run(boundary, later.id, earlier.id);
    } else {
      db.prepare('UPDATE credit_parameters SET effective_to=? WHERE id=?').run(boundary, earlier.id);
    }
    boundaries[index] = boundary;
    closed.push({ id: earlier.id, effectiveTo: boundary, supersededById: earlier.superseded_by_id ?? later.id });
  }
  const effective = db.prepare(`SELECT id,value_bool,effective_from,effective_to FROM credit_parameters
    WHERE code=? AND status='ACTIVE' AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)`)
    .all(code, businessDate, businessDate);
  if (effective.length !== 1) {
    throw new Error(`W11A_PARAMETER_VERSION_NOT_UNIQUE:${code}:${effective.length}`);
  }
  return { code, businessDate, effectiveVersion: effective[0], closed };
}

const oneTimeWorlds = new WeakMap();

/**
 * The ONE_TIME world of the real-MySQL cases (T-17, T-18).
 *
 * The world is prepared ONCE per database and the preparation is idempotent,
 * so the second case reuses the very same world instead of seeding a second
 * one: neither case depends on the other having passed.
 */
export async function ensureWave10OneTimeWorld(db) {
  const prepared = db.prepare('SELECT COUNT(*) count FROM credit_profile WHERE id=?').get('w10-profile-agg');
  if (Number(prepared.count) !== 1) {
    await seedWave10AcceptanceBase(db, {
      aggregateLimit: ONE_TIME_AGGREGATE_LIMIT_CENTS,
      stage: ONE_TIME_STAGE,
      scenario: 'OVERRIDE_REQUEST',
      controlStrength: 'WARNING',
    });
  }
  const memo = oneTimeWorlds.get(db);
  const businessDate = memo?.businessDate ?? wave10BusinessDate();
  const reconciliation = reconcileParameterVersions(db, { code: 'CREDIT_MANAGEMENT_ENABLED', businessDate });
  if (Number(reconciliation.effectiveVersion.value_bool) !== 1) {
    throw new Error(`W11A_CREDIT_MANAGEMENT_NOT_ENABLED:${businessDate}`);
  }
  // The over-limit conclusion of the ONE_TIME cases must be RELEASABLE. Only an
  // OVERRIDE_REQUEST rule produces that conclusion, so the stage's effective
  // rule set may contain nothing else; and the stage must carry a rule at all,
  // or the stage is simply uncontrolled. Both are refused here instead of
  // surfacing as a confusing conclusion mismatch.
  const stageRules = db.prepare(`SELECT id,rule_code,scenario,control_strength FROM credit_check_rules
    WHERE business_stage=? AND status='ACTIVE' AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)`)
    .all(ONE_TIME_STAGE, businessDate, businessDate);
  if (!stageRules.length) throw new Error(`W11A_ONE_TIME_STAGE_HAS_NO_EFFECTIVE_RULE:${ONE_TIME_STAGE}`);
  const notReleasable = stageRules.filter((rule) => rule.scenario !== 'OVERRIDE_REQUEST' || rule.control_strength === 'BLOCK');
  if (notReleasable.length) {
    throw new Error(`W11A_ONE_TIME_STAGE_IS_NOT_RELEASABLE:${notReleasable.map((rule) => rule.rule_code).join(',')}`);
  }
  const world = {
    businessDate,
    expiryBusinessDate: wave10FutureBusinessDateFrom(businessDate),
    stage: ONE_TIME_STAGE,
    reconciliation,
  };
  oneTimeWorlds.set(db, world);
  return world;
}
