// R-02 — canonical period guard contract.
//
// Contract: docs/requirements/platform.md §36.15.3–§36.15.4 and
// docs/design/platform.md §32.15.1–§32.15.6. The guard is the only active
// period judgement in the codebase, so these cases pin the parts that a
// caller cannot be allowed to weaken: the action→axis map, the fail-closed
// behaviour, the lock order, the zero-side-effect rejection and the
// SQLite / MySQL schema parity of the coordination anchors.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDatabase, transaction } from './db.js';
import { captureSqliteSnapshot, planMySqlAdditiveReconciliation } from './database/mysql-schema.js';
import { migratePeriodControlSchema } from './migrations/period-control-schema.js';
import { PERIOD_ACTIONS, PERIOD_AXES, financeActionCode } from './modules/period-action-registry.js';
import { guardPeriodAction, lockPeriodAxes, periodEndDate } from './modules/period-control.js';

function bootstrap() {
  const db = createDatabase(':memory:');
  db.exec('DELETE FROM inventory_period_closures; DELETE FROM period_closures; DELETE FROM operating_period_closures;');
  db.prepare("UPDATE finance_business_close_state SET closed_through_date='' ").run();
  return db;
}

function closeInventoryPeriod(db, period) {
  db.prepare("INSERT INTO inventory_period_closures(id,period_key,status,closed_by,closed_at) VALUES(?,?,'CLOSED','user-admin',?)")
    .run(`r02-inv-${period}`, period, new Date().toISOString());
}

function closeLegalPeriod(db, period) {
  const [year, month] = period.split('-').map(Number);
  db.prepare("INSERT INTO period_closures(id,period,period_year,period_month,status,created_at) VALUES(?,?,?,?,'CLOSED',?)")
    .run(`r02-legal-${period}`, period, year, month, new Date().toISOString());
}

test('R-02 migration creates exactly the two coordination-only anchors idempotently', () => {
  const db = bootstrap();
  migratePeriodControlSchema(db);
  const rows = db.prepare('SELECT axis,scope_key FROM period_guard_anchors ORDER BY axis').all()
    .map((row) => ({ axis: row.axis, scope_key: row.scope_key }));
  assert.deepEqual(rows, [
    { axis: 'INVENTORY', scope_key: 'GLOBAL' },
    { axis: 'LEGAL_ACCOUNTING', scope_key: 'GLOBAL' },
  ]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM period_guard_anchors').get().n, 2);
  db.close();
});

test('R-02 period guard anchor schema is derived equivalently for MySQL', () => {
  const snapshot = captureSqliteSnapshot((filename) => createDatabase(filename), false);
  const table = snapshot.tables.find((entry) => entry.name === 'period_guard_anchors');
  assert.ok(table, 'SQLite snapshot must contain period_guard_anchors');
  assert.deepEqual(table.columns.map((column) => column.name), ['axis', 'scope_key', 'version', 'updated_at']);
  const ddl = planMySqlAdditiveReconciliation(snapshot, { tables: new Set(), columns: new Map() })
    .find((statement) => statement.startsWith('CREATE TABLE IF NOT EXISTS `period_guard_anchors`'));
  assert.ok(ddl, 'MySQL derived DDL must contain period_guard_anchors');
  assert.match(ddl, /PRIMARY KEY \(`axis`,`scope_key`\)/);
  // The anchors are lock targets only: their rows must reach MySQL as well,
  // otherwise every guarded mutation fails closed with PERIOD_STATE_INVALID.
  const anchorRows = snapshot.tables.find((entry) => entry.name === 'period_guard_anchors').rows;
  assert.deepEqual(anchorRows.map((row) => row.axis).sort(), ['INVENTORY', 'LEGAL_ACCOUNTING']);
});

test('R-02 registry freezes mixed axes and the explicit GL-only exception', () => {
  assert.deepEqual(PERIOD_ACTIONS.INVENTORY_MUTATION, ['INVENTORY', 'LEGAL_ACCOUNTING']);
  assert.deepEqual(PERIOD_ACTIONS.FINANCE_COLLECTION, ['FINANCE_AR', 'FINANCE_TREASURY', 'LEGAL_ACCOUNTING']);
  assert.deepEqual(PERIOD_ACTIONS.FINANCE_PAYMENT, ['FINANCE_AP', 'FINANCE_TREASURY', 'LEGAL_ACCOUNTING']);
  assert.deepEqual(PERIOD_ACTIONS.GL_PERIOD_END, ['LEGAL_ACCOUNTING']);
  assert.equal(Object.isFrozen(PERIOD_ACTIONS), true);
  // Every registered action must be decidable by the guard: an action whose
  // axes are unknown to the guard would be silently unchecked.
  for (const [action, axes] of Object.entries(PERIOD_ACTIONS)) {
    for (const axis of axes) {
      assert.ok(Object.values(PERIOD_AXES).includes(axis), `${action} declares unknown axis ${axis}`);
    }
  }
  assert.equal(financeActionCode('AR'), 'FINANCE_AR_MUTATION');
  assert.equal(financeActionCode('AP'), 'FINANCE_AP_MUTATION');
  assert.equal(financeActionCode('TREASURY'), 'FINANCE_TREASURY_MUTATION');
  assert.equal(financeActionCode('AR', 'INVOICE'), 'FINANCE_AR_INVOICE');
  assert.equal(financeActionCode('AP', 'SETTLEMENT'), 'FINANCE_PAYMENT');
  assert.equal(financeActionCode('UNKNOWN'), '');
});

test('R-02 guard requires a transaction and rejects unregistered actions', () => {
  const db = bootstrap();
  assert.throws(
    () => guardPeriodAction(db, { actionCode: 'LEGAL_VOUCHER', businessDate: '2026-01-01' }),
    (error) => error.code === 'PERIOD_GUARD_TRANSACTION_REQUIRED',
  );
  assert.throws(
    () => transaction(db, () => guardPeriodAction(db, { actionCode: 'UNKNOWN', businessDate: '2026-01-01' })),
    (error) => error.code === 'PERIOD_ACTION_UNREGISTERED',
  );
  assert.throws(
    () => transaction(db, () => guardPeriodAction(db, { businessDate: '2026-01-01' })),
    (error) => error.code === 'PERIOD_ACTION_UNREGISTERED',
  );
  db.close();
});

test('R-02 lock order is stable across all axes', () => {
  const locks = [];
  const db = {
    dialect: 'mysql',
    isTransaction: true,
    prepare(sql) {
      return { get(value) { locks.push({ sql, value }); return { id: value, axis: value, close_type: value, scope_key: 'GLOBAL' }; } };
    },
  };
  const ordered = lockPeriodAxes(db, [
    'OPERATING', 'LEGAL_ACCOUNTING', 'FINANCE_TREASURY', 'FINANCE_AP', 'FINANCE_AR', 'INVENTORY',
  ], { managementBookId: 'book-z' });
  assert.deepEqual(ordered, [
    'INVENTORY', 'FINANCE_AR', 'FINANCE_AP', 'FINANCE_TREASURY', 'LEGAL_ACCOUNTING', 'OPERATING',
  ]);
  assert.deepEqual(locks.map((entry) => entry.value), [
    'INVENTORY', 'AR', 'AP', 'TREASURY', 'LEGAL_ACCOUNTING', 'book-z',
  ]);
  assert.ok(locks.every((entry) => entry.sql.endsWith(' FOR UPDATE')));
});

test('R-02 inventory action is blocked by either Inventory or Legal axis', () => {
  const db = bootstrap();
  closeInventoryPeriod(db, '2026-01');
  assert.throws(
    () => transaction(db, () => guardPeriodAction(db, { actionCode: 'INVENTORY_MUTATION', businessDate: '2026-01-31' })),
    (error) => error.code === 'INVENTORY_PERIOD_CLOSED' && error.details.axis === 'INVENTORY',
  );
  db.prepare('DELETE FROM inventory_period_closures').run();
  closeLegalPeriod(db, '2026-01');
  assert.throws(
    () => transaction(db, () => guardPeriodAction(db, { actionCode: 'INVENTORY_MUTATION', businessDate: '2026-01-31' })),
    (error) => error.code === 'FINANCIAL_PERIOD_CLOSED' && error.details.axis === 'LEGAL_ACCOUNTING',
  );
  db.close();
});

test('R-02 period boundaries are inclusive of the closed period end', () => {
  const db = bootstrap();
  closeInventoryPeriod(db, '2026-01');
  // The last day of the closed month is still blocked.
  assert.throws(
    () => transaction(db, () => guardPeriodAction(db, { actionCode: 'INVENTORY_MUTATION', businessDate: '2026-01-31' })),
    (error) => error.code === 'INVENTORY_PERIOD_CLOSED',
  );
  // The first day of the next open period is allowed.
  transaction(db, () => guardPeriodAction(db, { actionCode: 'INVENTORY_MUTATION', businessDate: '2026-02-01' }));
  assert.equal(periodEndDate('2026-01'), '2026-01-31');
  assert.equal(periodEndDate('2026-02'), '2026-02-28');
  assert.equal(periodEndDate('2024-02'), '2024-02-29');
  db.close();
});

test('R-02 finance and operating actions see their independent canonical state', () => {
  const db = bootstrap();
  db.prepare("UPDATE finance_business_close_state SET closed_through_date='2026-02-28' WHERE close_type='AR'").run();
  assert.throws(
    () => transaction(db, () => guardPeriodAction(db, { actionCode: 'FINANCE_AR_MUTATION', businessDate: '2026-02-15' })),
    (error) => error.code === 'FINANCE_PERIOD_CLOSED' && error.details.closeType === 'AR',
  );
  // The other two Finance axes stay open: they are independent axes.
  transaction(db, () => guardPeriodAction(db, { actionCode: 'FINANCE_AP_MUTATION', businessDate: '2026-02-15' }));
  transaction(db, () => guardPeriodAction(db, { actionCode: 'FINANCE_TREASURY_MUTATION', businessDate: '2026-02-15' }));
  const bookId = 'r02-book';
  db.prepare("INSERT INTO management_books(id,code,name,legal_entity,base_currency,status,created_at) VALUES(?,?,?,?,?,'OPEN',?)")
    .run(bookId, 'R02', 'R-02', 'R-02', 'CNY', new Date().toISOString());
  db.prepare("INSERT INTO operating_period_closures(id,management_book_id,period,status,closed_by,closed_at) VALUES('r02-op',?,'2026-03','CLOSED','user-admin',?)")
    .run(bookId, new Date().toISOString());
  assert.throws(
    () => transaction(db, () => guardPeriodAction(db, {
      actionCode: 'OPERATING_COLLECT', businessDate: '2026-03-01', managementBookId: bookId,
    })),
    (error) => error.code === 'OPERATING_PERIOD_CLOSED',
  );
  db.close();
});

test('R-02 invalid dates, missing anchors, and broken closure history fail closed', () => {
  const db = bootstrap();
  assert.throws(
    () => transaction(db, () => guardPeriodAction(db, { actionCode: 'LEGAL_VOUCHER', businessDate: '2026-02-30' })),
    (error) => error.status === 400 && error.code === 'BUSINESS_DATE_INVALID',
  );
  assert.throws(
    () => transaction(db, () => guardPeriodAction(db, { actionCode: 'LEGAL_VOUCHER', businessDate: '2026/02/01' })),
    (error) => error.status === 400 && error.code === 'BUSINESS_DATE_INVALID',
  );
  assert.throws(
    () => transaction(db, () => guardPeriodAction(db, { actionCode: 'LEGAL_VOUCHER' })),
    (error) => error.status === 400 && error.code === 'BUSINESS_DATE_INVALID',
  );
  db.prepare("DELETE FROM period_guard_anchors WHERE axis='LEGAL_ACCOUNTING'").run();
  assert.throws(
    () => transaction(db, () => guardPeriodAction(db, { actionCode: 'LEGAL_VOUCHER', businessDate: '2026-02-01' })),
    (error) => error.code === 'PERIOD_STATE_INVALID',
  );
  migratePeriodControlSchema(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO period_closures(id,period,period_year,period_month,status,created_at) VALUES('r02-gap-a','2026-01',2026,1,'CLOSED',?),('r02-gap-b','2026-03',2026,3,'CLOSED',?)").run(now, now);
  assert.throws(
    () => transaction(db, () => guardPeriodAction(db, { actionCode: 'LEGAL_VOUCHER', businessDate: '2026-04-01' })),
    (error) => error.code === 'PERIOD_STATE_INVALID',
  );
  db.close();
});

test('R-02 a rejected guard leaves zero side effects in the caller transaction', () => {
  const db = bootstrap();
  closeLegalPeriod(db, '2026-05');
  const before = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  assert.throws(
    () => transaction(db, () => {
      db.prepare("INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('r02-x','r02-x','R-02','x','x','role-admin',1,?)")
        .run(new Date().toISOString());
      guardPeriodAction(db, { actionCode: 'LEGAL_VOUCHER', businessDate: '2026-05-10' });
    }),
    (error) => error.code === 'FINANCIAL_PERIOD_CLOSED',
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, before, '拒绝后不得留下任何写入');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE id='r02-x'").get().n, 0);
  db.close();
});

test('R-02 the guard never creates or repairs period state on the read path', () => {
  const db = bootstrap();
  const anchorsBefore = db.prepare('SELECT COUNT(*) n FROM period_guard_anchors').get().n;
  const closuresBefore = db.prepare('SELECT COUNT(*) n FROM period_closures').get().n;
  const inventoryBefore = db.prepare('SELECT COUNT(*) n FROM inventory_period_closures').get().n;
  transaction(db, () => guardPeriodAction(db, { actionCode: 'LEGAL_VOUCHER', businessDate: '2026-08-01' }));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM period_guard_anchors').get().n, anchorsBefore);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM period_closures').get().n, closuresBefore);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_period_closures').get().n, inventoryBefore);
  db.close();
});
