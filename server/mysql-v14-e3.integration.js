import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import { assertFinancialPeriodsOpen } from './modules/financial-inventory.js';
import {
  closeInventoryPeriodCommand, getInventoryPeriodStatusData, reopenInventoryPeriodCommand,
  runInventoryCloseChecks,
} from './modules/inventory-period-close.js';

describe('V1.4-E3 real MySQL inventory period close', () => {
  let mysql; let db;
  const actor = { id: 'e3-mysql-admin' };
  before(() => {
    mysql = createTempDb({ label: 'mysql-v14-e3', production: true });
    db = mysql.db;
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,'role-admin',1,?)`).run(actor.id, actor.id, 'E3 MySQL Admin', 'x', 'x', '2026-09-27T08:00:00.000Z');
  });
  after(() => mysql.cleanup());

  test('precheck, close, idempotent replay, reopen and reclose preserve one record', () => {
    const check = runInventoryCloseChecks(db, '2026-06', actor, { today: '2026-09-27' });
    assert.equal(check.overallStatus, 'PASS');
    const first = closeInventoryPeriodCommand(db, actor, { period: '2026-06' }, { today: '2026-09-27' });
    const replay = closeInventoryPeriodCommand(db, actor, { period: '2026-06' }, { today: '2026-09-27' });
    assert.equal(replay.id, first.id);
    assert.equal(replay.repeated, true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_period_closures WHERE period_key='2026-06'").get().n, 1);
    assert.throws(() => assertFinancialPeriodsOpen(db, '2026-05-31'), (error) => error.code === 'INVENTORY_PERIOD_CLOSED');
    assert.doesNotThrow(() => assertFinancialPeriodsOpen(db, '2026-07-01'));
    const reopened = reopenInventoryPeriodCommand(db, actor, first.id, 'MySQL E3 UAT');
    assert.equal(reopened.status, 'REOPENED');
    assert.equal(getInventoryPeriodStatusData(db, '2026-09-27').nextClosablePeriod, '2026-06');
    const reclosed = closeInventoryPeriodCommand(db, actor, { period: '2026-06' }, { today: '2026-09-27' });
    assert.equal(reclosed.id, first.id);
    assert.equal(reclosed.reclosed, true);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_period_snapshots WHERE closure_id=?').get(first.id).n, 0);
  });
});
