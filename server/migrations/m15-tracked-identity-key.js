// M1-Core M-15 — explicit historical migration implementation.
//
// This module is intentionally NOT called by createDatabase(). Fresh current
// schemas receive the column/index from the canonical DDL, while an existing
// database must invoke this function only under a separately authorized
// Migration run. Tests may invoke it only on isolated temporary SQLite DBs.

import { generatedPartialIndex } from '../database/mysql-schema.js';

const OUTSOURCING_SOURCE_TYPES = Object.freeze([
  'OUTSOURCING_ISSUE', 'OUTSOURCING_SUPPLEMENT', 'OUTSOURCING_RETURN',
  'OUTSOURCING_BACKFLUSH', 'OUTSOURCING_RECEIPT', 'OUTSOURCING_FINISHED_RETURN',
]);
const SOURCE_SQL = OUTSOURCING_SOURCE_TYPES.map(() => '?').join(',');
export const M15_INDEX_NAME = 'uq_tracked_outsourcing_identity';

function generatedIndexColumn() {
  return `__partial_${Buffer.from(M15_INDEX_NAME).toString('hex').slice(-16)}`;
}

function columns(db) {
  return db.prepare('PRAGMA table_info(tracked_inventory_movements)').all().map((row) => String(row.name).toLowerCase());
}

export function hasM15IdentityColumn(db) {
  return columns(db).includes('identity_key');
}

export function hasM15IdentityIndex(db) {
  if (db.dialect === 'mysql') {
    return Boolean(db.prepare(`SELECT 1 FROM information_schema.statistics
      WHERE table_schema=DATABASE() AND table_name='tracked_inventory_movements' AND index_name=? LIMIT 1`).get(M15_INDEX_NAME));
  }
  return db.prepare('PRAGMA index_list(tracked_inventory_movements)').all().some((row) => row.name === M15_INDEX_NAME && Number(row.unique) === 1);
}

export function inspectM15Preconditions(db) {
  const preA = Number(db.prepare(`SELECT COUNT(*) n FROM tracked_inventory_movements
    WHERE source_type IN (${SOURCE_SQL}) AND source_item_id IS NULL`).get(...OUTSOURCING_SOURCE_TYPES).n);
  let preB = null;
  let preC = null;
  if (hasM15IdentityColumn(db)) {
    const identityRows = db.prepare(`SELECT m.identity_key,m.lot_id,m.serial_id,p.tracking_policy
      FROM tracked_inventory_movements m LEFT JOIN products p ON p.id=m.product_id
      WHERE m.source_type IN (${SOURCE_SQL})`).all(...OUTSOURCING_SOURCE_TYPES);
    preB = identityRows.filter((row) => {
      if (row.tracking_policy === 'LOT') return !row.lot_id || row.serial_id != null || row.identity_key !== `LOT:${row.lot_id}`;
      if (row.tracking_policy === 'SERIAL') return !row.serial_id || row.lot_id != null || row.identity_key !== `SERIAL:${row.serial_id}`;
      if (row.tracking_policy === 'NONE') return row.lot_id != null || row.serial_id != null || row.identity_key !== 'NONE';
      return true;
    }).length;
    preC = Number(db.prepare(`SELECT COUNT(*) n FROM (
      SELECT source_type,source_id,source_item_id,identity_key,direction,COUNT(*) duplicate_count
      FROM tracked_inventory_movements
      WHERE source_type IN (${SOURCE_SQL}) AND reversed=0
      GROUP BY source_type,source_id,source_item_id,identity_key,direction HAVING COUNT(*)>1
    ) conflicts`).get(...OUTSOURCING_SOURCE_TYPES).n);
  }
  return Object.freeze({ preA, preB, preC, columnPresent: hasM15IdentityColumn(db), indexPresent: hasM15IdentityIndex(db) });
}

function normalizeDeterministicIdentities(db) {
  const rows = db.prepare(`SELECT m.id,m.identity_key,m.lot_id,m.serial_id,p.tracking_policy
    FROM tracked_inventory_movements m LEFT JOIN products p ON p.id=m.product_id
    WHERE m.source_type IN (${SOURCE_SQL}) ORDER BY m.id`).all(...OUTSOURCING_SOURCE_TYPES);
  const update = db.prepare("UPDATE tracked_inventory_movements SET identity_key=? WHERE id=? AND identity_key=''");
  for (const row of rows) {
    let expected = null;
    if (row.tracking_policy === 'LOT' && row.lot_id && !row.serial_id) expected = `LOT:${row.lot_id}`;
    else if (row.tracking_policy === 'SERIAL' && row.serial_id && !row.lot_id) expected = `SERIAL:${row.serial_id}`;
    else if (row.tracking_policy === 'NONE' && !row.lot_id && !row.serial_id) expected = 'NONE';
    if (!expected) throw new Error(`M15_PRE_B_IDENTITY_UNPROVEN:${row.id}`);
    if (row.identity_key && row.identity_key !== expected) throw new Error(`M15_PRE_B_IDENTITY_CONFLICT:${row.id}`);
    if (!row.identity_key) update.run(expected, row.id);
  }
}

function createIdentityIndex(db) {
  if (db.dialect === 'mysql') {
    const index = {
      name: M15_INDEX_NAME,
      columns: ['source_type', 'source_id', 'source_item_id', 'identity_key', 'direction'],
      where: "source_type IN ('OUTSOURCING_ISSUE','OUTSOURCING_SUPPLEMENT','OUTSOURCING_RETURN','OUTSOURCING_BACKFLUSH','OUTSOURCING_RECEIPT','OUTSOURCING_FINISHED_RETURN') AND reversed=0",
    };
    const [addGeneratedColumn, addUniqueIndex] = generatedPartialIndex('tracked_inventory_movements', index);
    if (!columns(db).includes(generatedIndexColumn())) db.exec(addGeneratedColumn);
    if (!hasM15IdentityIndex(db)) db.exec(addUniqueIndex);
    return;
  }
  db.exec(`CREATE UNIQUE INDEX ${M15_INDEX_NAME}
    ON tracked_inventory_movements(source_type,source_id,source_item_id,identity_key,direction)
    WHERE source_type IN ('OUTSOURCING_ISSUE','OUTSOURCING_SUPPLEMENT','OUTSOURCING_RETURN','OUTSOURCING_BACKFLUSH','OUTSOURCING_RECEIPT','OUTSOURCING_FINISHED_RETURN') AND reversed=0`);
}

export function migrateTrackedIdentityKeyM15(db, { authorized = false } = {}) {
  if (authorized !== true) throw new Error('M15_IMPLEMENTATION_REQUIRES_EXPLICIT_MIGRATION_AUTHORIZATION');
  // SQLite DDL is transactional, so isolated/offline validation is all-or-nothing.
  // MySQL DDL auto-commits: each step is instead idempotent and the column,
  // normalization, generated digest column, and UNIQUE index are detected on retry.
  const ownsTransaction = db.dialect !== 'mysql' && !db.isTransaction;
  if (ownsTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    const before = inspectM15Preconditions(db);
    if (before.preA !== 0) throw new Error(`M15_PRE_A_SOURCE_ITEM_MISSING:${before.preA}`);
    if (!before.columnPresent) {
      db.exec(db.dialect === 'mysql'
        ? "ALTER TABLE tracked_inventory_movements ADD COLUMN identity_key VARCHAR(512) NOT NULL DEFAULT ''"
        : "ALTER TABLE tracked_inventory_movements ADD COLUMN identity_key TEXT NOT NULL DEFAULT ''");
    }
    normalizeDeterministicIdentities(db);
    const afterNormalization = inspectM15Preconditions(db);
    if (afterNormalization.preB !== 0) throw new Error(`M15_PRE_B_IDENTITY_MISMATCH:${afterNormalization.preB}`);
    if (afterNormalization.preC !== 0) throw new Error(`M15_PRE_C_DUPLICATE_IDENTITY:${afterNormalization.preC}`);
    if (!afterNormalization.indexPresent) createIdentityIndex(db);
    const final = inspectM15Preconditions(db);
    if (!final.indexPresent) throw new Error('M15_INDEX_NOT_ESTABLISHED');
    if (ownsTransaction) db.exec('COMMIT');
    return Object.freeze({ ...final, normalized: true });
  } catch (error) {
    if (ownsTransaction) { try { if (db.isTransaction) db.exec('ROLLBACK'); } catch {} }
    throw error;
  }
}

export function assertM15ReadyForOutsourcingTracking(db) {
  if (!hasM15IdentityColumn(db) || !hasM15IdentityIndex(db)) {
    const error = new Error('M-15 identity uniqueness is not established for outsourcing tracking');
    error.code = 'OUTSOURCING_TRACKING_M15_NOT_READY';
    throw error;
  }
}

export { OUTSOURCING_SOURCE_TYPES };
