import { DatabaseSync } from 'node:sqlite';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createDatabase } from '../server/db.js';
import { resolveDatabaseConfig } from '../server/database/config.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const protectedDb = resolve(repoRoot, 'data', 'erp.db');
const quote = (name) => `\`${String(name).replaceAll('`', '``')}\``;

const CONTROLS = [
  ['inventory', 'quantity'],
  ['inventory_transactions', 'quantity_change'],
  ['inventory_valuation_movements', 'quantity_delta'],
  ['inventory_valuation_movements', 'value_delta_cents'],
  ['inventory_valuation_balances', 'quantity'],
  ['inventory_valuation_balances', 'value_cents'],
  ['account_receivables', 'amount_cents'],
  ['account_receivables', 'open_amount_cents'],
  ['account_payables', 'amount_cents'],
  ['account_payables', 'open_amount_cents'],
  ['accounting_entries', 'amount_cents'],
  ['production_wip_movements', 'amount_cents'],
  ['sales_invoices', 'gross_cents'],
  ['supplier_bills', 'gross_cents'],
  ['tax_codes', 'rate_numerator'],
  ['opening_batch_lines', 'amount_cents'],
];

function assertSafe(sourcePath, config) {
  if (!isAbsolute(sourcePath)) throw new Error('SQLite conversion source must be an absolute path');
  if (resolve(sourcePath) === protectedDb) throw new Error('Refusing to convert the repository data/erp.db; use a disposable copy');
  if (!/(?:test|phase7[ab]|disposable)/i.test(config.database)) {
    throw new Error(`Refusing conversion into non-disposable MySQL database: ${config.database}`);
  }
  if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
    throw new Error('Conversion requires ERP_MYSQL_TEST_ALLOW_RESET=true');
  }
}

function scalar(db, table, column) {
  return Number(db.prepare(`SELECT COALESCE(SUM(${quote(column)}),0) n FROM ${quote(table)}`).get().n);
}

export function convertSqliteToMySql({ sourcePath, mysqlConfig } = {}) {
  const absoluteSource = resolve(String(sourcePath || ''));
  const config = resolveDatabaseConfig({ ...(mysqlConfig || {}), backend: 'mysql' });
  assertSafe(absoluteSource, config);
  const source = new DatabaseSync(absoluteSource, { readOnly: true });
  let target;
  try {
    const integrity = source.prepare('PRAGMA integrity_check').get()?.integrity_check;
    if (integrity !== 'ok') throw new Error(`SQLite integrity_check failed: ${integrity}`);
    const fkErrors = source.prepare('PRAGMA foreign_key_check').all();
    if (fkErrors.length) throw new Error(`SQLite foreign_key_check failed with ${fkErrors.length} row(s)`);

    target = createDatabase(config);
    const tables = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
    const targetTables = new Set(target.prepare('SHOW TABLES').all().map((row) => Object.values(row)[0]));
    const missing = tables.filter((table) => !targetTables.has(table));
    if (missing.length) throw new Error(`MySQL target is missing source tables: ${missing.join(', ')}`);

    target.exec('SET FOREIGN_KEY_CHECKS=0');
    try {
      for (const table of [...tables].reverse()) target.exec(`DELETE FROM ${quote(table)}`);
      for (const table of tables) {
        const columns = source.prepare(`PRAGMA table_info(${quote(table)})`).all();
        const primary = columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk);
        const rows = source.prepare(`SELECT * FROM ${quote(table)}`).all();
        for (const row of rows) {
          for (const column of primary) {
            if (row[column.name] === null || row[column.name] === undefined) {
              throw new Error(`Invalid NULL primary key in ${table}.${column.name}; conversion aborted`);
            }
          }
          const names = Object.keys(row);
          target.prepare(`INSERT INTO ${quote(table)} (${names.map(quote).join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map((name) => row[name]));
        }
      }
    } finally { target.exec('SET FOREIGN_KEY_CHECKS=1'); }

    const rowCounts = {};
    for (const table of tables) {
      const sqliteCount = Number(source.prepare(`SELECT COUNT(*) n FROM ${quote(table)}`).get().n);
      const mysqlCount = Number(target.prepare(`SELECT COUNT(*) n FROM ${quote(table)}`).get().n);
      if (sqliteCount !== mysqlCount) throw new Error(`Row count mismatch for ${table}: SQLite=${sqliteCount}, MySQL=${mysqlCount}`);
      const primary = source.prepare(`PRAGMA table_info(${quote(table)})`).all().filter((column) => column.pk).sort((a, b) => a.pk - b.pk);
      if (primary.length) {
        const select = primary.map((column) => quote(column.name)).join(',');
        const order = primary.map((column) => quote(column.name)).join(',');
        const canonical = (rows) => rows.map((row) => JSON.stringify(primary.map((column) => row[column.name]))).sort();
        const left = canonical(source.prepare(`SELECT ${select} FROM ${quote(table)} ORDER BY ${order}`).all());
        const right = canonical(target.prepare(`SELECT ${select} FROM ${quote(table)} ORDER BY ${order}`).all());
        if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(`Primary/source ID mismatch for ${table}`);
      }
      rowCounts[table] = sqliteCount;
    }

    const controlTotals = {};
    for (const [table, column] of CONTROLS) {
      if (!tables.includes(table)) continue;
      const sqliteValue = scalar(source, table, column);
      const mysqlValue = scalar(target, table, column);
      if (Math.abs(sqliteValue - mysqlValue) > 1e-9) throw new Error(`Control total mismatch for ${table}.${column}: SQLite=${sqliteValue}, MySQL=${mysqlValue}`);
      controlTotals[`${table}.${column}`] = sqliteValue;
    }
    return { source: absoluteSource, targetDatabase: config.database, tableCount: tables.length, rowCounts, controlTotals };
  } finally {
    try { target?.close(); } catch {}
    source.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const position = process.argv.indexOf('--sqlite');
  if (position < 0 || !process.argv[position + 1]) {
    console.error('Usage: node scripts/convert-sqlite-to-mysql.mjs --sqlite <absolute-disposable-v1.3.db>');
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(convertSqliteToMySql({ sourcePath: process.argv[position + 1] }), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
