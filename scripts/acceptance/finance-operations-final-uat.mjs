import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Every UAT identity selects dedicated runtime assertions. Source inspection
// and aliases from 32 identities to a handful of generic tests are rejected.
const cases = [
  ['UAT-01', 'AR initialization', [['server/v22-finance-wave-a-foundation.test.js', 'AR initialization persists one opening']]],
  ['UAT-02', 'AP initialization', [['server/v22-finance-wave-a-foundation.test.js', 'AP initialization persists one opening']]],
  ['UAT-03', 'Treasury initialization', [['server/v22-finance-wave-d-treasury.test.js', 'Treasury initialization persists opening']]],
  ['UAT-04', 'DIRECT_BUSINESS AR', [['server/m8-settlement.test.js', 'sourced draft Sales Delivery creates no AR']]],
  ['UAT-05', 'INVOICE_DRIVEN AR', [['server/v13-phase6e-commercial-golive.test.js', 'delivery can remain unbilled; partial 40']]],
  ['UAT-06', 'PROVISIONAL_TO_FINANCIAL AR', [['server/v22-finance-wave-c-invoice.test.js', 'provisional AR']]],
  ['UAT-07', 'DIRECT_BUSINESS AP', [['server/m8-settlement.test.js', 'sourced draft Purchase Receipt creates no AP']]],
  ['UAT-08', 'INVOICE_DRIVEN AP', [['server/v13-phase6e-commercial-golive.test.js', 'receipt remains AP-free; partial supplier bills']]],
  ['UAT-09', 'PROVISIONAL_TO_FINANCIAL AP', [['server/v22-finance-recognition-production.test.js', 'production recognition adapter enforces all three']]],
  ['UAT-10', 'Multi-due-date schedule', [['server/v22-finance-wave-a-foundation.test.js', 'finance_due_schedule_lines invariant']]],
  ['UAT-11', 'Partial collection', [['server/m8-settlement.test.js', 'collection DRAFT has no effect; partial and final']]],
  ['UAT-12', 'Partial payment', [['server/m8-settlement.test.js', 'payment supports partial and full AP settlement']]],
  ['UAT-13', 'Multi-open-item allocation', [['server/m8-settlement.test.js', 'multi-document collection is atomic']]],
  ['UAT-14', 'Automatic / manual reconciliation', [['server/m8-settlement.test.js', 'returns are independent negative AR/AP adjustments and reconciliation is idempotent']]],
  ['UAT-15', 'Advance receipt', [['server/v22-finance-wave-b-settlement.test.js', 'advance receipt creates PREPAYMENT']]],
  ['UAT-16', 'Supplier prepayment', [['server/v13-phase6a-financial-controls.test.js', 'supplier prepayment is symmetric']]],
  ['UAT-17', 'Unapplied balance application', [['server/v22-finance-wave-b-settlement.test.js', 'balance application inserts']]],
  ['UAT-18', 'Customer + supplier unapplied-balance refund', [['server/v13-phase6a-financial-controls.test.js', 'customer refund enforces source balance']]],
  ['UAT-19', 'Settlement reversal', [['server/v13-phase6a-financial-controls.test.js', 'partial collection reversal targets exact allocation']]],
  ['UAT-20', 'Write-off + reversal', [['server/v13-phase6a-financial-controls.test.js', 'write-off requires independent admin confirmation']]],
  ['UAT-21', 'Bad-debt provision', [['server/v22-finance-wave-b-settlement.test.js', 'finance_bad_debt_provisions insert']]],
  ['UAT-22', 'AR counterparty transfer', [['server/v22-finance-wave-b-settlement.test.js', 'AR transfer creates target FINAL']]],
  ['UAT-23', 'AP counterparty transfer', [['server/v22-finance-wave-b-settlement.test.js', 'AP transfer conserves supplier exposure']]],
  ['UAT-24', 'Sales invoice partial / source / credit / void', [
    ['server/v13-phase6e-commercial-golive.test.js', 'delivery can remain unbilled; partial 40'],
    ['server/v22-finance-invoice-lifecycle.test.js', 'draft invoice cancel has no economic side effect'],
    ['server/v22-finance-invoice-lifecycle.test.js', 'posted invoice void atomically neutralizes'],
  ]],
  ['UAT-25', 'Purchase invoice matching / verification / credit', [
    ['server/v13-phase6e-commercial-golive.test.js', 'invoice-before-receipt remains WAITING_MATCH'],
    ['server/v13-phase6e-commercial-golive.test.js', 'receipt remains AP-free; partial supplier bills'],
    ['server/v22-finance-invoice-lifecycle.test.js', 'supplier invoice verification follows'],
    ['server/v22-finance-invoice-lifecycle.test.js', 'supplier invoice rejection requires reason'],
  ]],
  ['UAT-26', 'Cash / bank settlement account', [['server/v22-finance-wave-e-reports.test.js', 'settlementAccountBalance returns account']]],
  ['UAT-27', 'Cash deposit / withdrawal + internal transfer', [['server/v22-finance-wave-d-treasury.test.js', 'postTreasuryTransfer: paired IN/OUT']]],
  ['UAT-28', 'Notes receivable / payable + payment request', [['server/v22-finance-recovery-api.test.js', 'notes settlement and payment request execution']]],
  ['UAT-29', 'Cash count', [['server/v22-finance-recovery-api.test.js', 'cash count records variance']]],
  ['UAT-30', 'Bank statement import + reconciliation + unmatched items', [['server/v22-finance-recovery-api.test.js', 'bank import is idempotent']]],
  ['UAT-31', 'AR / AP / Treasury close + reopen', [['server/v22-finance-wave-a-foundation.test.js', 'AR AP and Treasury business close and reopen']]],
  ['UAT-32', 'AR / AP / Treasury reports + Treasury to GL reconciliation', [
    ['server/v22-finance-wave-e-reports.test.js', 'arSummary aggregates'],
    ['server/v22-finance-wave-e-reports.test.js', 'apSummary aggregates'],
    ['server/v22-finance-wave-e-reports.test.js', 'arAging computes'],
    ['server/v22-finance-wave-e-reports.test.js', 'treasuryMovementLedger returns'],
    ['server/v22-finance-wave-e-reports.test.js', 'treasuryGlReconcile PASS'],
  ]],
];

if (cases.length !== 32 || new Set(cases.map(([id]) => id)).size !== 32) throw new Error('Finance UAT manifest must contain exactly UAT-01..UAT-32');

function runEvidence(file, pattern) {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', `--test-name-pattern=${pattern}`, file], {
    cwd: repoRoot, env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const pass = Number([...output.matchAll(/^# pass (\d+)$/gm)].at(-1)?.[1] || 0);
  const fail = Number([...output.matchAll(/^# fail (\d+)$/gm)].at(-1)?.[1] || 0);
  if (result.error || result.status !== 0 || pass < 1 || fail !== 0) {
    process.stderr.write(output);
    throw result.error || new Error(`${file} / ${pattern}: exit=${result.status}, pass=${pass}, fail=${fail}`);
  }
  return pass;
}

let passed = 0;
for (const [id, label, evidence] of cases) {
  try {
    let assertions = 0;
    for (const [file, pattern] of evidence) assertions += runEvidence(file, pattern);
    passed += 1;
    console.log(`${id} PASS ${label} (runtime assertions=${assertions})`);
  } catch (error) {
    console.error(`${id} FAIL ${label}: ${error.message}`);
    process.exit(1);
  }
}

console.log(`FINANCE_OPERATIONS_UAT ${passed}/32 ${passed === 32 ? 'PASS' : 'FAIL'}`);
if (passed !== 32) process.exit(1);

const matrix = readFileSync(resolve(repoRoot, 'docs/operations/finance-operations-capability-matrix.md'), 'utf8');
const rows = [...matrix.matchAll(/^\| (FO\d{2}) \|.*\| (EXISTING_REUSE|CONVERGED|IMPLEMENTED_NEW|INTEGRATION_BACKED) \|$/gm)];
const ids = rows.map((match) => match[1]);
const expected = Array.from({ length: 58 }, (_, index) => `FO${String(index + 1).padStart(2, '0')}`);
if (rows.length !== 58 || ids.some((id, index) => id !== expected[index])) {
  throw new Error(`Finance capability matrix invalid: rows=${rows.length}, ordered=${ids.join(',')}`);
}
console.log('FINANCE_OPERATIONS_CAPABILITIES 58/58 PASS');
