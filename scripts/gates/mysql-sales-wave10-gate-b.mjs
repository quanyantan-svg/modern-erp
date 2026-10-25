import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_B_CASES, GATE_B_SUITES } from './mysql-sales-wave10-manifest.mjs';
import { runProtectedMySqlCampaign } from './mysql-wave10-runner-support.mjs';

export const GATE_B_EVIDENCE_PREFIX = 'W10_GATE_B_EVIDENCE ';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digestPayload(payload) {
  return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

export function createGateBEvidenceRecord({ caseId, level, suiteId = 'GATE-B', runId, details = {} }) {
  if (!caseId || !level || !suiteId || !runId) throw new Error('Gate B evidence requires caseId, level, suiteId and runId');
  const payload = Object.freeze({ caseId, level, suiteId, runId, result: 'PASS', details: canonical(details) });
  return Object.freeze({ ...payload, digest: digestPayload(payload) });
}

export function emitGateBEvidence(input, write = (line) => process.stdout.write(line)) {
  const record = createGateBEvidenceRecord(input);
  write(`${GATE_B_EVIDENCE_PREFIX}${JSON.stringify(record)}\n`);
  return record;
}

function parseEvidenceLine(line) {
  const candidate = line.startsWith('# ') ? line.slice(2) : line;
  if (!candidate.startsWith(GATE_B_EVIDENCE_PREFIX)) return null;
  let record;
  try { record = JSON.parse(candidate.slice(GATE_B_EVIDENCE_PREFIX.length)); }
  catch { throw new Error('Malformed Gate B evidence JSON'); }
  const { digest, ...payload } = record;
  if (!/^[0-9a-f]{64}$/i.test(String(digest || '')) || digest !== digestPayload(payload)) {
    throw new Error(`Gate B evidence digest mismatch: ${record.caseId || 'unknown'}`);
  }
  return record;
}

export function reduceGateBEvidence(results, { campaignId, cases = GATE_B_CASES } = {}) {
  const byId = new Map();
  for (const result of results) {
    for (const line of String(result.output || '').split(/\r?\n/)) {
      const record = parseEvidenceLine(line);
      if (!record) continue;
      if (byId.has(record.caseId)) throw new Error(`Duplicate Gate B evidence: ${record.caseId}`);
      if (record.suiteId !== result.label) throw new Error(`Gate B evidence owner/output mismatch: ${record.caseId}`);
      byId.set(record.caseId, record);
    }
  }
  for (const item of cases) {
    const record = byId.get(item.id);
    if (!record) throw new Error(`Missing Gate B evidence: ${item.id}`);
    if (record.level !== item.evidence) throw new Error(`Gate B evidence level mismatch: ${item.id}`);
    if (record.suiteId !== item.owner) throw new Error(`Gate B evidence owner mismatch: ${item.id}`);
    if (record.runId !== campaignId) throw new Error(`Gate B evidence run mismatch: ${item.id}`);
    if (record.result !== 'PASS') throw new Error(`Gate B evidence result mismatch: ${item.id}`);
  }
  if (byId.size !== cases.length) throw new Error(`Unexpected Gate B evidence count: ${byId.size}`);
  return Object.freeze(cases.map((item) => byId.get(item.id)));
}

export function renderGateBBoard(results, context, write = (line) => process.stdout.write(line)) {
  const records = reduceGateBEvidence(results, context);
  write('GATE B EXECUTED M-BOARD:\n');
  for (const record of records) write(`  ${record.caseId} = PASS [${record.level}] digest=${record.digest}\n`);
  return records;
}

async function main() {
  await runProtectedMySqlCampaign({
    campaign: 'GATE B MYSQL CAMPAIGN',
    suites: GATE_B_SUITES,
    renderBoard: renderGateBBoard,
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();
