// OUT-001 M3 — the identity and R3 judgement policy.
//
// Design      : docs/design/procurement-outsourcing.md §26.34.16.3.1、§26.34.14.3
// Requirement : document.md §31.14.2
//
// The judgement lives here, in one place, so that the protected real-MySQL
// evidence (server/mysql-out001.integration.js) and the deterministic offline
// regression (server/mysql-out001-m3-uncertain-commit.test.js) cannot drift
// apart. Every function returns a list of **stable problem codes** instead of
// throwing, so a failing judgement names exactly what did not hold.
//
// Two rules are encoded here and must not be worked around:
//
//   · `CURRENT_USER()` returns the account that was actually used to
//     authenticate (`user@host`), while `PROCESSLIST.USER` returns only the
//     user name part. The two are therefore **never** compared with each
//     other. The process-list user is compared with the **configured** user
//     name, and the two `CURRENT_USER()` values are compared with each other.
//
//   · the session epoch is a counter **inside one MySQL Worker**. Two
//     independent adapters therefore have two independent counters, and their
//     raw numbers are not comparable. R3 is proved by "an independently
//     created adapter + a trusted session + a different connection id"; the
//     victim's own epoch progression is evidence about the **victim's own**
//     session replacement and is never cross-compared with the observer.

export const OUT_001_M3_TRUSTED_SESSION_STATES = Object.freeze(['IDLE_TRUSTED', 'FRESH']);

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * The MySQL account identity of the victim and the observer.
 *
 * @param {object} input
 * @param {string} input.victimCurrentUser      CURRENT_USER() on the victim session
 * @param {string} input.observerCurrentUser    CURRENT_USER() on the observer session
 * @param {string} input.victimDatabase         DATABASE() on the victim session
 * @param {string} input.observerDatabase       DATABASE() on the observer session
 * @param {string} input.victimProcesslistUser  PROCESSLIST.USER row of the victim
 * @param {string} input.victimProcesslistDb    PROCESSLIST.DB row of the victim
 * @param {string} input.targetUser             the configured MySQL user name
 * @param {string} input.targetDatabase         the approved test database
 * @param {number} input.victimConnectionId
 * @param {number} input.observerConnectionId
 * @returns {string[]} stable problem codes; empty means every condition holds
 */
export function out001M3AccountIdentityProblems(input = {}) {
  const {
    victimCurrentUser,
    observerCurrentUser,
    victimDatabase,
    observerDatabase,
    victimProcesslistUser,
    victimProcesslistDb,
    targetUser,
    targetDatabase,
    victimConnectionId,
    observerConnectionId,
  } = input;
  const problems = [];

  const victimUser = String(victimCurrentUser ?? '').trim();
  const observerUser = String(observerCurrentUser ?? '').trim();
  if (!victimUser) problems.push('VICTIM_CURRENT_USER_MISSING');
  if (!observerUser) problems.push('OBSERVER_CURRENT_USER_MISSING');
  // 1. victim 与 observer 必须是**同一个 MySQL 账户**（同一 CURRENT_USER()）。
  if (victimUser && observerUser && victimUser !== observerUser) {
    problems.push('CURRENT_USER_MISMATCH');
  }
  // 2. PROCESSLIST.USER 只给出用户名字符串部分，只能与**配置的用户名**比较。
  if (String(victimProcesslistUser ?? '') !== String(targetUser ?? '')) {
    problems.push('PROCESSLIST_USER_MISMATCH');
  }
  // 3. PROCESSLIST.DB 必须等于当前批准的测试数据库。
  if (String(victimProcesslistDb ?? '') !== String(targetDatabase ?? '')) {
    problems.push('PROCESSLIST_DB_MISMATCH');
  }
  // 4. observer 连接的数据库必须等于当前批准的测试数据库。
  if (String(observerDatabase ?? '') !== String(targetDatabase ?? '')) {
    problems.push('OBSERVER_DATABASE_MISMATCH');
  }
  // victim 自身的 DATABASE() 必须同样落在批准的测试数据库上。
  if (String(victimDatabase ?? '') !== String(targetDatabase ?? '')) {
    problems.push('VICTIM_DATABASE_MISMATCH');
  }
  if (!isPositiveInteger(victimConnectionId)) problems.push('INVALID_VICTIM_CONNECTION_ID');
  if (!isPositiveInteger(observerConnectionId)) problems.push('INVALID_OBSERVER_CONNECTION_ID');
  // 5. observer 不得就是 victim 本人的连接。
  if (isPositiveInteger(victimConnectionId) && victimConnectionId === observerConnectionId) {
    problems.push('SAME_CONNECTION_ID');
  }
  return problems;
}

/**
 * R3 —— the verification must run on **another** trusted connection.
 *
 * There is deliberately **no epoch parameter**: the session epoch is a
 * per-Worker counter, so comparing the observer's raw counter with the
 * victim's raw counter would compare two unrelated numbers. R3 is proved by
 * the adapter boundary and the connection identity instead.
 *
 * @param {object} input
 * @param {string} input.observerSessionState          mysqlSessionState(observer)
 * @param {boolean} input.observerIsIndependentAdapter  the observer is its own adapter
 * @param {number} input.observerConnectionId
 * @param {number} input.victimConnectionId
 * @returns {string[]} stable problem codes; empty means R3 holds
 */
export function out001M3R3Problems(input = {}) {
  const {
    observerSessionState,
    observerIsIndependentAdapter,
    observerConnectionId,
    victimConnectionId,
  } = input;
  const problems = [];
  if (!OUT_001_M3_TRUSTED_SESSION_STATES.includes(observerSessionState)) {
    problems.push('OBSERVER_SESSION_NOT_TRUSTED');
  }
  if (observerIsIndependentAdapter !== true) {
    problems.push('OBSERVER_NOT_INDEPENDENT_ADAPTER');
  }
  if (!isPositiveInteger(observerConnectionId)) problems.push('INVALID_OBSERVER_CONNECTION_ID');
  if (!isPositiveInteger(victimConnectionId)) problems.push('INVALID_VICTIM_CONNECTION_ID');
  if (isPositiveInteger(victimConnectionId) && victimConnectionId === observerConnectionId) {
    problems.push('SAME_CONNECTION_ID');
  }
  return problems;
}

/**
 * The victim's **own** session replacement.
 *
 * The epoch progression 1 → 2 is evidence about the victim adapter alone: the
 * Worker replaced its session, so it opened a new MySQL session, which the
 * server assigned a new connection id to. It is never compared with another
 * adapter's counter.
 *
 * @param {object} input
 * @param {number} input.firstConnectionId   connection id before the replacement
 * @param {number} input.firstEpoch          epoch before the replacement
 * @param {number} input.victimConnectionId  connection id after the replacement
 * @param {number} input.victimEpoch         epoch after the replacement
 * @returns {string[]} stable problem codes; empty means the replacement happened
 */
export function out001M3VictimSessionReplacementProblems(input = {}) {
  const { firstConnectionId, firstEpoch, victimConnectionId, victimEpoch } = input;
  const problems = [];
  if (!isPositiveInteger(firstConnectionId)) problems.push('INVALID_FIRST_CONNECTION_ID');
  if (!isPositiveInteger(victimConnectionId)) problems.push('INVALID_VICTIM_CONNECTION_ID');
  if (!Number.isSafeInteger(firstEpoch) || firstEpoch < 1) problems.push('INVALID_FIRST_EPOCH');
  if (!Number.isSafeInteger(victimEpoch) || victimEpoch < 1) problems.push('INVALID_VICTIM_EPOCH');
  if (Number.isSafeInteger(firstEpoch) && Number.isSafeInteger(victimEpoch)
    && victimEpoch !== firstEpoch + 1) {
    problems.push('VICTIM_EPOCH_NOT_INCREMENTED');
  }
  if (isPositiveInteger(firstConnectionId) && isPositiveInteger(victimConnectionId)
    && victimConnectionId === firstConnectionId) {
    problems.push('VICTIM_CONNECTION_ID_NOT_REPLACED');
  }
  return problems;
}
