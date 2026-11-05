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

export async function waitForNewTransaction(db, excluded, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = [...gateWaiterIds(db)].filter((id) => !excluded.has(id));
    if (found.length === 1) return found[0];
    if (found.length > 1) throw new Error(`M1_G07_${label}_WAITER_AMBIGUOUS`);
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`M1_G07_${label}_HTTP_TRANSACTION_NOT_BLOCKING_ON_GATE`);
}

function trackRequest(factory) {
  return Promise.resolve().then(factory).then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason }),
  );
}

function attachReleaseError(primaryError, releaseError) {
  if (!primaryError || (typeof primaryError !== 'object' && typeof primaryError !== 'function')) return;
  try {
    Object.defineProperty(primaryError, 'm1G07GateReleaseError', {
      configurable: true, enumerable: false, value: releaseError,
    });
  } catch {}
}

export async function runG07GateRace({
  db, label, requestA, requestB, observeWaiter = waitForNewTransaction,
}) {
  const pending = [];
  let transactionOpen = false;
  try {
    db.exec('START TRANSACTION');
    transactionOpen = true;
    db.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE').get();

    const baseline = gateWaiterIds(db);
    pending.push(trackRequest(requestA));
    const waiterA = await observeWaiter(db, baseline, `${label}_A`);
    pending.push(trackRequest(requestB));
    const waiterB = await observeWaiter(db, new Set([...baseline, waiterA]), `${label}_B`);
    if (waiterA === waiterB) throw new Error(`M1_G07_${label}_WAITERS_NOT_INDEPENDENT`);

    db.exec('COMMIT');
    transactionOpen = false;
    const settled = await Promise.all(pending);
    const rejected = settled.find((result) => result.status === 'rejected');
    if (rejected) throw rejected.reason;
    return Object.freeze({
      waiterA, waiterB,
      responses: Object.freeze(settled.map((result) => result.value)),
    });
  } catch (error) {
    let releaseError = null;
    if (transactionOpen) {
      try { db.exec('ROLLBACK'); } catch (caught) { releaseError = caught; }
      transactionOpen = false;
    }
    await Promise.all(pending);
    if (releaseError) attachReleaseError(error, releaseError);
    throw error;
  }
}

export const _testInternals = Object.freeze({ isTargetGateWaiter });
