import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../../server/db.js';

const dir = mkdtempSync(join(tmpdir(), 'modern-erp-v1-1-recovery-'));
const dbPath = join(dir, 'erp.db');

const first = createDatabase(dbPath);
const firstIndexes = first
  .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='accounting_vouchers'")
  .all()
  .map((row) => row.name);
const integrityFirst = first.prepare('PRAGMA integrity_check').get();
const fkFirst = first.prepare('PRAGMA foreign_key_check').all();
first.close();

const second = createDatabase(dbPath);
const secondIndexes = second
  .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='accounting_vouchers'")
  .all()
  .map((row) => row.name);
const integritySecond = second.prepare('PRAGMA integrity_check').get();
const fkSecond = second.prepare('PRAGMA foreign_key_check').all();
const dupSource = second
  .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_vouchers_source'")
  .all();
second.close();

rmSync(dir, { recursive: true, force: true });

const report = {
  first_start_indexes: firstIndexes,
  first_start_has_status: firstIndexes.includes('idx_vouchers_status'),
  first_start_has_source: firstIndexes.includes('idx_vouchers_source'),
  first_start_integrity: integrityFirst,
  first_start_fk_count: fkFirst.length,
  second_start_indexes: secondIndexes,
  second_start_integrity: integritySecond,
  second_start_fk_count: fkSecond.length,
  second_start_duplicate_source: dupSource.length,
  schema_drift: JSON.stringify(firstIndexes.sort()) !== JSON.stringify(secondIndexes.sort()),
};

console.log(JSON.stringify(report, null, 2));

const ok =
  report.first_start_has_status &&
  report.first_start_has_source &&
  report.first_start_integrity.integrity_check === 'ok' &&
  report.first_start_fk_count === 0 &&
  !report.schema_drift &&
  report.second_start_integrity.integrity_check === 'ok' &&
  report.second_start_fk_count === 0 &&
  report.second_start_duplicate_source === 1;

if (!ok) {
  console.error('RECOVERY CHECK FAILED');
  process.exit(1);
}
console.log('RECOVERY CHECK OK');
