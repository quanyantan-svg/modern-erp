export const M1_G07_GATE_WAITER_SQL = `SELECT DISTINCT
    w.REQUESTING_THREAD_ID thread_id,
    rl.THREAD_ID lock_thread_id,
    rl.ENGINE engine,
    rl.LOCK_STATUS lock_status,
    rl.OBJECT_SCHEMA object_schema,
    rl.OBJECT_NAME object_name,
    rl.INDEX_NAME index_name,
    DATABASE() selected_database
  FROM performance_schema.data_lock_waits w
  JOIN performance_schema.data_locks rl
    ON rl.ENGINE=w.ENGINE
    AND rl.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
    AND rl.ENGINE_TRANSACTION_ID=w.REQUESTING_ENGINE_TRANSACTION_ID
    AND rl.THREAD_ID=w.REQUESTING_THREAD_ID
  WHERE w.ENGINE='INNODB'
    AND rl.ENGINE='INNODB'
    AND rl.LOCK_STATUS='WAITING'
    AND rl.OBJECT_SCHEMA=DATABASE()
    AND rl.OBJECT_NAME='mysql_transaction_gates'
    AND rl.INDEX_NAME='PRIMARY'`;

function isTargetGateWaiter(row) {
  return String(row.engine || '').toUpperCase() === 'INNODB'
    && String(row.lock_status || '').toUpperCase() === 'WAITING'
    && row.object_schema === row.selected_database
    && row.object_name === 'mysql_transaction_gates'
    && row.index_name === 'PRIMARY'
    && row.thread_id !== null && row.thread_id !== undefined
    && String(row.thread_id) === String(row.lock_thread_id);
}

export function gateWaiterIds(db) {
  return new Set(db.prepare(M1_G07_GATE_WAITER_SQL).all()
    .filter(isTargetGateWaiter)
    .map((row) => String(row.thread_id)));
}

function requestCompletedBeforeWaitError(label) {
  const error = new Error(`M1_G07_${label}_HTTP_COMPLETED_BEFORE_GATE_WAIT`);
  error.code = 'M1_G07_HTTP_COMPLETED_BEFORE_GATE_WAIT';
  return error;
}

function assertRequestStillPending(requestState, label) {
  if (!requestState?.settled) return;
  if (requestState.outcome.status === 'rejected') throw requestState.outcome.reason;
  throw requestCompletedBeforeWaitError(label);
}

function delayWithSignal(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function waitForNewTransaction(db, excluded, label, {
  timeoutMs = 30_000, requestState = null, signal = null,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertRequestStillPending(requestState, label);
    const found = [...gateWaiterIds(db)].filter((id) => !excluded.has(id));
    if (found.length === 1) return found[0];
    if (found.length > 1) throw new Error(`M1_G07_${label}_WAITER_AMBIGUOUS`);
    await delayWithSignal(25, signal);
  }
  assertRequestStillPending(requestState, label);
  throw new Error(`M1_G07_${label}_HTTP_TRANSACTION_NOT_BLOCKING_ON_GATE`);
}

function requestTimeoutError(label, timeoutMs) {
  const error = new Error(`M1_G07_${label}_HTTP_REQUEST_TIMEOUT:${timeoutMs}`);
  error.code = 'M1_G07_HTTP_REQUEST_TIMEOUT';
  return error;
}

function trackRequest(factory, label, timeoutMs) {
  const controller = new AbortController();
  const state = {
    label, controller, settled: false, outcome: null, abortRequested: false, abortReason: null, timeout: null, done: null,
  };
  state.abort = (reason) => {
    if (state.settled || controller.signal.aborted) return;
    state.abortRequested = true;
    state.abortReason = reason;
    if (state.timeout) clearTimeout(state.timeout);
    controller.abort(reason);
  };
  state.timeout = setTimeout(() => state.abort(requestTimeoutError(label, timeoutMs)), timeoutMs);
  state.timeout.unref?.();
  state.done = Promise.resolve().then(() => factory(controller.signal)).then(
    (value) => state.abortRequested
      ? ({ status: 'rejected', reason: state.abortReason })
      : ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason: state.abortRequested ? state.abortReason : reason }),
  ).then((outcome) => {
    state.settled = true;
    state.outcome = outcome;
    clearTimeout(state.timeout);
    return outcome;
  });
  return state;
}

async function settleRequests(states, timeoutMs) {
  if (!states.length) return Object.freeze({ settled: true, outcomes: Object.freeze([]), pendingLabels: Object.freeze([]) });
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
  const outcomes = await Promise.race([Promise.all(states.map((state) => state.done)), timeout]);
  clearTimeout(timer);
  if (outcomes) return Object.freeze({ settled: true, outcomes: Object.freeze(outcomes), pendingLabels: Object.freeze([]) });
  return Object.freeze({
    settled: false, outcomes: Object.freeze(states.filter((state) => state.settled).map((state) => state.outcome)),
    pendingLabels: Object.freeze(states.filter((state) => !state.settled).map((state) => state.label)),
  });
}

function appendDiagnosticMarker(error, marker) {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return;
  const message = String(error.message || error);
  if (!message.includes(marker)) error.message = `${message}\n${marker}`;
}

function attachSettlement(error, settlement, timeoutMs, abortRequested) {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return;
  const evidence = Object.freeze({
    status: settlement.settled ? 'REQUEST_PROMISES_SETTLED' : 'UNVERIFIED',
    pendingLabels: settlement.pendingLabels,
    timeoutMs,
    abortRequested,
    businessEffectsProven: false,
    cleanupProven: false,
  });
  try {
    Object.defineProperty(error, 'm1G07RequestSettlement', {
      configurable: true, enumerable: false, value: evidence,
    });
  } catch {}
  if (!settlement.settled) {
    appendDiagnosticMarker(error, `M1_G07_HTTP_SETTLEMENT_UNVERIFIED pending=${settlement.pendingLabels.join(',') || 'UNKNOWN'} timeoutMs=${timeoutMs} abortRequested=${abortRequested} cleanupProven=false`);
  }
}

function attachReleaseError(primaryError, releaseError) {
  if (!primaryError || (typeof primaryError !== 'object' && typeof primaryError !== 'function')) return;
  try {
    Object.defineProperty(primaryError, 'm1G07GateReleaseError', {
      configurable: true, enumerable: false, value: releaseError,
    });
  } catch {}
  appendDiagnosticMarker(primaryError, `M1_G07_GATE_RELEASE_FAILED code=${String(releaseError?.code || releaseError?.name || 'UNKNOWN').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80)}`);
}

export async function runG07GateRace({
  db, label, requestA, requestB, observeWaiter = waitForNewTransaction,
  requestTimeoutMs = 30_000, settlementTimeoutMs = 5_000,
}) {
  const pending = [];
  let transactionOpen = false;
  try {
    db.exec('START TRANSACTION');
    transactionOpen = true;
    db.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE').get();

    const baseline = gateWaiterIds(db);
    const pendingA = trackRequest(requestA, `${label}_A`, requestTimeoutMs);
    pending.push(pendingA);
    const waiterA = await observeWaiter(db, baseline, `${label}_A`, { requestState: pendingA, signal: pendingA.controller.signal });
    const pendingB = trackRequest(requestB, `${label}_B`, requestTimeoutMs);
    pending.push(pendingB);
    const waiterB = await observeWaiter(db, new Set([...baseline, waiterA]), `${label}_B`, { requestState: pendingB, signal: pendingB.controller.signal });
    if (waiterA === waiterB) throw new Error(`M1_G07_${label}_WAITERS_NOT_INDEPENDENT`);

    db.exec('COMMIT');
    transactionOpen = false;
    const settled = await settleRequests(pending, requestTimeoutMs + settlementTimeoutMs);
    if (!settled.settled) throw new Error(`M1_G07_${label}_HTTP_SETTLEMENT_UNVERIFIED_AFTER_COMMIT`);
    const interrupted = pending.find((request) => request.abortRequested || request.controller.signal.aborted);
    if (interrupted) throw interrupted.abortReason || interrupted.controller.signal.reason
      || new Error(`M1_G07_${interrupted.label}_HTTP_INTERRUPTED_WITHOUT_REASON`);
    const rejected = settled.outcomes.find((result) => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    return Object.freeze({
      waiterA, waiterB,
      responses: Object.freeze(settled.outcomes.map((result) => result.value)),
    });
  } catch (error) {
    const abortReason = new Error(`M1_G07_${label}_HTTP_ABORTED_AFTER_FAILURE`);
    abortReason.code = 'M1_G07_HTTP_ABORTED_AFTER_FAILURE';
    for (const request of pending) request.abort(abortReason);
    let releaseError = null;
    if (transactionOpen) {
      try { db.exec('ROLLBACK'); } catch (caught) { releaseError = caught; }
      transactionOpen = false;
    }
    const settlement = await settleRequests(pending, settlementTimeoutMs);
    attachSettlement(error, settlement, settlementTimeoutMs, pending.some((request) => request.abortRequested));
    if (releaseError) attachReleaseError(error, releaseError);
    throw error;
  }
}

export const _testInternals = Object.freeze({ isTargetGateWaiter, requestCompletedBeforeWaitError });
