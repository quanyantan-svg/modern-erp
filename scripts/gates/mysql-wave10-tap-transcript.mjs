const SUMMARY_FIELDS = Object.freeze(['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']);
const RECORD_PATTERN = /^(ok|not ok)\s+(\d+)(?:\s+-\s+\S.*)?$/;
const RECORD_PREFIX_PATTERN = /^(not ok|ok)\b/;
const SUMMARY_PREFIX_PATTERN = /^#\s*(tests|suites|pass|fail|cancelled|skipped|todo)\b/;
const BAIL_OUT_PATTERN = /^Bail out!/;

function fail(label, message) {
  throw new Error(`WAVE 10 STRICT TAP: ${label}: ${message}`);
}

export function parseWave10TapTranscript(captured) {
  const text = String(captured ?? '');
  const lines = text.split(/\r?\n/);
  const versions = lines.filter((line) => /^TAP version \d+$/.test(line));
  const plans = lines.map((line) => line.match(/^1\.\.(\d+)$/)).filter(Boolean);
  const records = [];
  const malformed = [];
  const bailOuts = [];
  for (const line of lines) {
    if (BAIL_OUT_PATTERN.test(line)) { bailOuts.push(line); continue; }
    if (RECORD_PREFIX_PATTERN.test(line)) {
      const match = line.match(RECORD_PATTERN);
      if (!match) { malformed.push(line); continue; }
      records.push({
        ok: match[1] === 'ok', id: Number(match[2]), raw: match[0],
        skip: /#\s*SKIP\b/i.test(match[0]), todo: /#\s*TODO\b/i.test(match[0]),
      });
      continue;
    }
    if (SUMMARY_PREFIX_PATTERN.test(line) && !new RegExp(`^#\\s+(tests|suites|pass|fail|cancelled|skipped|todo)\\s+\\d+\\s*$`).test(line)) {
      malformed.push(line);
    }
  }
  const summary = {};
  const summaryOccurrences = {};
  for (const field of SUMMARY_FIELDS) {
    const matches = lines.map((line) => line.match(new RegExp(`^#\\s+${field}\\s+(\\d+)\\s*$`))).filter(Boolean);
    summaryOccurrences[field] = matches.length;
    summary[field] = matches.length === 1 ? Number(matches[0][1]) : null;
  }
  const durationMatches = lines.map((line) => line.match(/^#\s+duration_ms\s+(\d+(?:\.\d+)?)\s*$/)).filter(Boolean);
  summaryOccurrences.durationMs = durationMatches.length;
  summary.durationMs = durationMatches.length === 1 ? Number(durationMatches[0][1]) : null;
  return Object.freeze({
    text, lines, versions, plans, records, malformed: Object.freeze(malformed), bailOuts: Object.freeze(bailOuts),
    summary: Object.freeze(summary), summaryOccurrences: Object.freeze(summaryOccurrences),
  });
}

export function assertWave10TapTranscriptStrict(label, transcriptOrText) {
  const transcript = typeof transcriptOrText === 'string' ? parseWave10TapTranscript(transcriptOrText) : transcriptOrText;
  if (!transcript.text.endsWith('\n')) fail(label, 'truncated transcript (missing final newline)');
  if (transcript.bailOuts.length) fail(label, 'transcript bailed out before completing');
  if (transcript.malformed.length) fail(label, `malformed TAP record(s): ${transcript.malformed.join(' | ')}`);
  if (transcript.versions.length !== 1 || transcript.versions[0] !== 'TAP version 13') fail(label, 'exactly one TAP version 13 header required');
  if (transcript.plans.length !== 1) fail(label, `exactly one top-level plan required (found ${transcript.plans.length})`);
  const planned = Number(transcript.plans[0][1]);
  if (!Number.isSafeInteger(planned) || planned < 1) fail(label, `invalid plan size ${planned}`);
  if (transcript.records.length !== planned) fail(label, `plan ${planned} but parsed ${transcript.records.length} top-level records`);
  const ids = transcript.records.map((record) => record.id);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => id !== index + 1)) fail(label, 'top-level test ids must be unique and contiguous');
  if (transcript.records.some((record) => !record.ok || record.skip || record.todo)) fail(label, 'every top-level record must be plain ok');
  for (const [field, occurrences] of Object.entries(transcript.summaryOccurrences)) {
    if (occurrences !== 1) fail(label, `summary ${field} must occur exactly once (found ${occurrences})`);
  }
  for (const field of SUMMARY_FIELDS) {
    if (!Number.isSafeInteger(transcript.summary[field]) || transcript.summary[field] < 0) fail(label, `invalid summary ${field}`);
  }
  if (!Number.isFinite(transcript.summary.durationMs) || transcript.summary.durationMs < 0) fail(label, 'invalid duration_ms');
  if (transcript.summary.tests !== planned || transcript.summary.pass !== planned) fail(label, 'plan/tests/pass mismatch');
  if (transcript.summary.fail !== 0 || transcript.summary.cancelled !== 0 || transcript.summary.skipped !== 0 || transcript.summary.todo !== 0) {
    fail(label, 'fail/skip/cancelled/todo must all be zero');
  }
  return transcript.summary;
}
