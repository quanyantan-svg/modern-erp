// R-02 — period guard coverage verifier.
//
// Contract: docs/design/platform.md §32.15.6. The canonical period guard is
// only trustworthy when every dated mutation declares a registered action and
// no second, drifting period judgement survives in the codebase. This script
// turns those four properties into a machine check:
//
//   1. every production mutation action is registered in the action registry;
//   2. the required action families exist (inventory, voucher, Finance,
//      settlement, operating, pure GL);
//   3. the retired gates have no active call sites;
//   4. a mutation owner never reads the period tables itself, and the only
//      registered exemption from the inventory axis is the pure GL action.
//
// Read-only: it never writes a file and never touches a database.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const failures = [];

function fail(message) { failures.push(message); }

// --- 1 + 2: the registry and the action codes used in production -----------

const registrySource = read('server/modules/period-action-registry.js');
const registeredActions = new Set(
  [...registrySource.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):\s*Object\.freeze\(\[/gm)].map((match) => match[1]),
);
const registeredAxes = new Map(
  [...registrySource.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):\s*Object\.freeze\(\[([^\]]*)\]\)/gm)]
    .map((match) => [match[1], match[2].split(',')
      .map((part) => part.trim().replace(/^A\./, ''))
      .filter(Boolean)]),
);

const REQUIRED_FAMILIES = [
  'INVENTORY_MUTATION', 'INVENTORY_VALUATION',
  'LEGAL_VOUCHER', 'MANUAL_VOUCHER', 'GL_PERIOD_END',
  'FINANCE_AR_MUTATION', 'FINANCE_AP_MUTATION', 'FINANCE_TREASURY_MUTATION',
  'FINANCE_COLLECTION', 'FINANCE_PAYMENT',
  'OPERATING_COLLECT', 'OPERATING_ALLOCATE', 'OPERATING_INTERNAL_SETTLEMENT',
];
for (const action of REQUIRED_FAMILIES) {
  if (!registeredActions.has(action)) fail(`动作注册表缺少必备动作 ${action}`);
}

const PRODUCTION_ROOTS = ['server/modules', 'server/lib'];
function productionFiles() {
  const files = [];
  for (const dir of PRODUCTION_ROOTS) {
    for (const entry of readdirSync(resolve(root, dir))) {
      if (entry.endsWith('.js')) files.push(`${dir}/${entry}`);
    }
  }
  files.push('server/app.js');
  return files;
}

const CANONICAL_PERIOD_MODULE = 'server/modules/period-control.js';
const usedActions = new Map();
for (const file of productionFiles()) {
  const source = read(file);
  for (const match of source.matchAll(/actionCode:\s*'([A-Z][A-Z0-9_]*)'/g)) {
    if (!usedActions.has(match[1])) usedActions.set(match[1], []);
    usedActions.get(match[1]).push(file);
  }
}
for (const [action, files] of usedActions) {
  if (!registeredActions.has(action)) {
    fail(`生产代码使用了未登记的动作 ${action}（${[...new Set(files)].join(', ')}）`);
  }
}

// --- 3: the retired gates have no active call sites -------------------------

const RETIRED_GATES = [
  'assertFinancialPeriodsOpen',
  'assertInventoryPeriodOpen',
  'assertFinanceBusinessDateOpen',
  'checkPeriodNotClosedForVoucher',
  'allowClosedInventoryPeriod',
];
const SCANNED_ROOTS = ['server', 'scripts'];
function scannedFiles() {
  const files = [];
  for (const dir of SCANNED_ROOTS) {
    for (const entry of readdirSync(resolve(root, dir), { recursive: true })) {
      if (typeof entry !== 'string') continue;
      if (entry.replace(/\\/g, '/') === 'qa/verify-period-guard-coverage.mjs') continue;
      if (!entry.endsWith('.js') && !entry.endsWith('.mjs')) continue;
      if (entry.includes('node_modules')) continue;
      files.push(`${dir}/${entry.replace(/\\/g, '/')}`);
    }
  }
  return files;
}
for (const file of scannedFiles()) {
  const source = read(file);
  for (const gate of RETIRED_GATES) {
    if (!source.includes(gate)) continue;
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      if (!line.includes(gate)) return;
      const isComment = /^\s*(\/\/|\*|\/\*)/.test(line);
      if (isComment) return;
      fail(`${file}:${index + 1} 仍引用已退役的期间闸门 ${gate}`);
    });
  }
}

// --- 4: a mutation owner never reads the period tables itself ---------------

const PERIOD_TABLE_READS = [
  /FROM\s+period_closures/i,
  /FROM\s+inventory_period_closures/i,
  /FROM\s+operating_period_closures/i,
  /FROM\s+finance_business_close_state/i,
];
// Read-only consumers that legitimately inspect the authoritative state:
// the canonical period module, the close/reopen owners of each axis, and the
// two CHECK surfaces that report period state instead of gating a mutation.
const PERIOD_READ_ALLOWLIST = new Map([
  [CANONICAL_PERIOD_MODULE, 'canonical period module'],
  ['server/modules/accounting-period-control.js', 'legal close/reopen owner'],
  ['server/modules/inventory-period-close.js', 'inventory close/reopen owner'],
  ['server/modules/management-accounting.js', 'operating close/reopen owner'],
  ['server/modules/finance-business-close.js', 'finance close/reopen owner'],
  ['server/modules/financial-inventory.js', '结账健康检查（只读诊断，不做闸门判定）'],
]);
for (const file of productionFiles()) {
  if (PERIOD_READ_ALLOWLIST.has(file)) continue;
  const source = read(file);
  if (!/guardPeriodAction|guardVoucherAction|guardFinanceAction|guardOperatingAction/.test(source)) continue;
  for (const pattern of PERIOD_TABLE_READS) {
    if (pattern.test(source)) {
      fail(`${file} 既调用 canonical guard 又直接读取期间表（第二套判定语义）`);
      break;
    }
  }
}

// --- 5: the only inventory exemption is the registered pure GL action -------

const PURE_GL_EXCEPTION = 'GL_PERIOD_END';
for (const [action, axes] of registeredAxes) {
  if (action === PURE_GL_EXCEPTION) continue;
  if (axes.includes('INVENTORY') && !axes.includes('LEGAL_ACCOUNTING')) {
    fail(`动作 ${action} 声明了 INVENTORY 轴却没有法定会计轴`);
  }
}
if (JSON.stringify(registeredAxes.get(PURE_GL_EXCEPTION)) !== JSON.stringify(['LEGAL_ACCOUNTING'])) {
  fail(`唯一豁免存货轴的动作 ${PURE_GL_EXCEPTION} 必须只登记 LEGAL_ACCOUNTING`);
}

if (failures.length) {
  console.error('Period guard coverage verification FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Period guard coverage verification PASSED — 已登记 ${registeredActions.size} 个动作 / 生产代码使用 ${usedActions.size} 个 / 旧闸门 0 处活跃调用`,
  );
}
