// Accounting & Analytics Domain Closure — AA-W1 business ↔ GL reconciliation.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.1
//   AA-W1.9..AA-W1.14
// Design:    docs/design/accounting-analytics.md §31.1.1 / §31.1.4 / §31.1.5
//
// Single responsibility: 对账检查执行、结果快照、差异查询。
// It never repairs a difference — a difference may only be fixed by the
// owning business domain and then re-checked (AA-W1.11).
//
// Every check is expressed as an explainable line:
//   { checkCode, severity, status, differenceCents, affected, explanation }
// A check may never be silently dropped or downgraded to make a close pass.

import { HttpError, allow, allowAny, send } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';

const SEVERITIES = Object.freeze(['BLOCKING', 'WARNING', 'INFO']);

function nowIso() {
  return new Date().toISOString();
}

function periodEnd(period) {
  const [year, month] = String(period).split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return String(period) + '-' + String(lastDay).padStart(2, '0');
}

function glRoleBalance(db, roles, asOfDate) {
  if (!roles.length) return 0;
  const marks = roles.map(() => '?').join(',');
  return Number(db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n
     FROM accounting_entries e
     JOIN accounting_vouchers v ON v.id=e.voucher_id
     JOIN account_role_mappings m ON m.subject_id=e.subject_id
     WHERE v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date)<=? AND m.role_code IN (${marks})`,
  ).get(asOfDate, ...roles).n);
}

function liabilityRoleBalance(db, roles, asOfDate) {
  return -glRoleBalance(db, roles, asOfDate);
}

function line(checkCode, severity, differenceCents, affected, explanation) {
  return {
    checkCode,
    severity: SEVERITIES.includes(severity) ? severity : 'INFO',
    status: Number(differenceCents) === 0 ? 'PASS' : 'FAIL',
    differenceCents: Number(differenceCents),
    affected: affected || [],
    explanation,
  };
}

/**
 * AA-W1.9 — the explainable reconciliation check set for one period.
 *
 * The checks read the authoritative sub-ledgers and the posted GL. They never
 * write to either side.
 */
export function runChecks(db, period) {
  const asOfDate = periodEnd(period);
  const lines = [];

  // --- Inventory value vs GL ---
  const inventoryValue = Number(db.prepare(
    "SELECT COALESCE(SUM(value_delta_cents),0) n FROM inventory_valuation_movements WHERE status='POSTED' AND business_date<=?",
  ).get(asOfDate).n);
  const inventoryGl = glRoleBalance(db, ['RAW_MATERIAL_INVENTORY', 'FINISHED_GOODS_INVENTORY', 'OTHER_INVENTORY'], asOfDate);
  lines.push(line('INVENTORY_VALUE_TO_GL', 'BLOCKING', inventoryGl - inventoryValue,
    [], '已过账存货科目余额应等于库存价值子账'));

  // --- Legacy unvalued movements block an authoritative close ---
  const legacy = db.prepare(
    "SELECT COUNT(*) n FROM inventory_transactions WHERE valuation_status='LEGACY_UNVALUED' AND business_date<=?",
  ).get(asOfDate).n;
  lines.push(line('LEGACY_UNVALUED_MOVEMENTS', 'BLOCKING', legacy, [],
    '未估值历史移动会阻断权威结账'));

  // --- WIP vs GL ---
  const wip = Number(db.prepare(
    'SELECT COALESCE(SUM(amount_cents),0) n FROM production_wip_movements WHERE business_date<=?',
  ).get(asOfDate).n);
  lines.push(line('WIP_TO_GL', 'BLOCKING', glRoleBalance(db, ['WIP'], asOfDate) - wip, [],
    '已过账 WIP 科目余额应等于在制子账'));

  // --- AR vs GL ---
  const ar = Number(db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN item_class='SOURCE' AND COALESCE(item_kind,'FINAL')='FINAL' AND COALESCE(conversion_state,'OPEN')='OPEN' THEN open_amount_cents ELSE 0 END),0) n FROM account_receivables WHERE business_date<=?",
  ).get(asOfDate).n);
  lines.push(line('AR_TO_GL', 'BLOCKING', glRoleBalance(db, ['ACCOUNTS_RECEIVABLE'], asOfDate) - ar, [],
    '已过账应收科目余额应等于应收子账'));

  // --- AP vs GL ---
  const ap = Number(db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN item_class='SOURCE' AND COALESCE(item_kind,'FINAL')='FINAL' AND COALESCE(conversion_state,'OPEN')='OPEN' THEN open_amount_cents ELSE 0 END),0) n FROM account_payables WHERE business_date<=?",
  ).get(asOfDate).n);
  lines.push(line('AP_TO_GL', 'BLOCKING', liabilityRoleBalance(db, ['ACCOUNTS_PAYABLE'], asOfDate) - ap, [],
    '已过账应付科目余额应等于应付子账'));

  // --- GRNI (goods received not invoiced) ---
  const grni = Number(db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN item_class='SOURCE' AND COALESCE(item_kind,'FINAL')='FINAL' AND COALESCE(conversion_state,'OPEN')='OPEN' THEN open_amount_cents ELSE 0 END),0) n FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND business_date<=?",
  ).get(asOfDate).n);
  lines.push(line('GRNI_TO_GL', 'WARNING', glRoleBalance(db, ['GRNI'], asOfDate) - grni, [],
    '已暂估入库未收发票金额应与 GRNI 科目一致'));

  // --- Cash flow vs treasury ---
  const cashFlowNet = Number(db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n
     FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id
     JOIN account_role_mappings m ON m.subject_id=e.subject_id
     WHERE v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date)<=? AND m.role_code IN ('CASH','BANK')`,
  ).get(asOfDate).n);
  const treasuryNet = Number(db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN direction='OUT' THEN -amount_cents ELSE amount_cents END),0) n FROM settlement_account_movements WHERE business_date<=?",
  ).get(asOfDate).n);
  lines.push(line('CASH_TO_TREASURY', 'WARNING', cashFlowNet - treasuryNet, [],
    '现金/银行科目余额应与资金子账一致'));

  // --- Unposted vouchers in the period ---
  const unposted = db.prepare(
    "SELECT COUNT(*) n FROM accounting_vouchers WHERE period=? AND status<>'POSTED'",
  ).get(period).n;
  lines.push(line('UNPOSTED_VOUCHERS', 'BLOCKING', unposted, [],
    '期间内存在未过账凭证，不能结账'));

  // --- Accounting events that never produced a voucher ---
  const ungenerated = db.prepare(
    "SELECT COUNT(*) n FROM accounting_events WHERE period=? AND status IN ('PENDING','FAILED')",
  ).get(period).n;
  lines.push(line('UNGENERATED_ACCOUNTING_EVENTS', 'BLOCKING', ungenerated, [],
    '已确认业务事实尚未生成凭证，不能结账'));

  // --- Profit / loss not transferred ---
  const profitTransfer = db.prepare(
    "SELECT status FROM profit_transfer_runs WHERE period=?",
  ).get(period);
  const profitTransferred = profitTransfer && profitTransfer.status === 'COMPLETED' ? 0 : 1;
  lines.push(line('PROFIT_NOT_TRANSFERRED', 'BLOCKING', profitTransferred, [],
    '本期损益尚未结转，不能关闭会计期间'));

  return lines;
}

/**
 * AA-W1.10 — run the reconciliation and persist an explainable snapshot.
 * The snapshot is immutable history: it is referenced by `run_key` so a
 * repeated run for the same period/date is idempotent.
 */
export function runReconciliation(db, { actor, period, asOfDate }) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) {
    throw new HttpError(400, '期间格式应为 YYYY-MM', { code: 'ACCOUNTING_RECONCILIATION_PERIOD_INVALID' });
  }
  const runKey = 'recon:' + period + ':' + (asOfDate || periodEnd(period));
  const existing = db.prepare('SELECT * FROM accounting_reconciliation_runs WHERE run_key=?').get(runKey);
  if (existing) {
    return {
      run: existing,
      items: db.prepare('SELECT * FROM accounting_reconciliation_items WHERE run_id=? ORDER BY check_code').all(existing.id),
      idempotent: true,
    };
  }

  const runId = id();
  const startedAt = nowIso();
  const lines = runChecks(db, period);
  transaction(db, () => {
    db.prepare('INSERT INTO accounting_reconciliation_runs(id,run_key,period,as_of_date,status,started_at,finished_at,created_by) VALUES(?,?,?,?,?,?,?,?)')
      .run(runId, runKey, period, asOfDate || periodEnd(period), 'COMPLETED', startedAt, nowIso(), actor.id);
    const insert = db.prepare(
      'INSERT INTO accounting_reconciliation_items(id,run_id,check_code,severity,status,difference_cents,affected_json,explanation) VALUES(?,?,?,?,?,?,?,?)',
    );
    for (const item of lines) {
      insert.run(id(), runId, item.checkCode, item.severity, item.status, item.differenceCents,
        JSON.stringify(item.affected || []), item.explanation);
    }
    audit(db, actor.id, 'ACCOUNTING_RECONCILIATION_RUN', 'ACCOUNTING_RECONCILIATION_RUN', runId,
      '业务财务对账 ' + period + '：' + lines.filter((item) => item.status === 'FAIL').length + ' 项差异');
  });

  return {
    run: db.prepare('SELECT * FROM accounting_reconciliation_runs WHERE id=?').get(runId),
    items: lines,
    idempotent: false,
  };
}

function listReconciliation(db, res, actor, url) {
  allowAny(actor, ['ACCOUNTING_RECONCILIATION_VIEW', 'ACCOUNTING_VIEW']);
  const period = url.searchParams.get('period');
  const run = period
    ? db.prepare('SELECT * FROM accounting_reconciliation_runs WHERE period=? ORDER BY started_at DESC LIMIT 1').get(period)
    : db.prepare('SELECT * FROM accounting_reconciliation_runs ORDER BY started_at DESC LIMIT 1').get();
  if (!run) return send(res, 200, { run: null, items: [] });
  const items = db.prepare('SELECT * FROM accounting_reconciliation_items WHERE run_id=? ORDER BY check_code').all(run.id);
  return send(res, 200, { run, items });
}

function listReconciliationRuns(db, res, actor, url) {
  allowAny(actor, ['ACCOUNTING_RECONCILIATION_VIEW', 'ACCOUNTING_VIEW']);
  const period = url.searchParams.get('period');
  const runs = db.prepare(`SELECT * FROM accounting_reconciliation_runs ${period ? 'WHERE period=?' : ''} ORDER BY started_at DESC LIMIT 100`)
    .all(...(period ? [period] : []));
  return send(res, 200, { runs });
}

async function triggerReconciliation(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_RECONCILIATION_VIEW');
  const body = await readJsonSafe(req);
  const period = body.period;
  if (!period) throw new HttpError(400, '请指定期间，格式: YYYY-MM', { code: 'ACCOUNTING_RECONCILIATION_PERIOD_REQUIRED' });
  const result = runReconciliation(db, { actor, period, asOfDate: body.asOfDate || null });
  return send(res, 200, result);
}

async function readJsonSafe(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new HttpError(400, '请求不是有效的 JSON', { code: 'INVALID_JSON' });
  }
}

// ---------------------------------------------------------------------------
// AA-W1.12 / AA-W1.13 — the unified period-close checklist
// ---------------------------------------------------------------------------

/**
 * The close checklist is the union of the existing voucher-state checks and
 * the accounting-domain checks. It never removes a check to let a close
 * pass (AA-W1.12 / §31.12).
 */
export function buildCloseChecklist(db, period) {
  const checklist = [];

  const enteredCount = db.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE period=? AND status='ENTERED'").get(period).cnt;
  checklist.push({
    item: '录入中凭证',
    code: 'VOUCHERS_ENTERED',
    passed: enteredCount === 0,
    detail: enteredCount === 0 ? '无录入中凭证' : '有 ' + enteredCount + ' 张录入中凭证，请先提交或删除',
  });

  const submittedCount = db.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE period=? AND status='SUBMITTED'").get(period).cnt;
  checklist.push({
    item: '待审核凭证',
    code: 'VOUCHERS_SUBMITTED',
    passed: submittedCount === 0,
    detail: submittedCount === 0 ? '无待审核凭证' : '有 ' + submittedCount + ' 张待审核凭证，请先审核或驳回',
  });

  const rejectedCount = db.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE period=? AND status='REJECTED'").get(period).cnt;
  checklist.push({
    item: '已驳回凭证',
    code: 'VOUCHERS_REJECTED',
    passed: rejectedCount === 0,
    detail: rejectedCount === 0 ? '无已驳回凭证' : '有 ' + rejectedCount + ' 张已驳回凭证，请修改后重新提交或删除',
  });

  for (const check of runChecks(db, period)) {
    checklist.push({
      item: check.checkCode,
      code: check.checkCode,
      passed: check.status === 'PASS',
      severity: check.severity,
      detail: check.status === 'PASS'
        ? check.explanation
        : check.explanation + '（差异 ' + check.differenceCents + ' 分）',
      differenceCents: check.differenceCents,
    });
  }

  return { passed: checklist.every((entry) => entry.passed), items: checklist };
}

/**
 * AA-W1.12 — the close checklist snapshot. The snapshot is evidence that the
 * check ran, so a later close can point at what was actually verified.
 */
export function snapshotCloseCheck(db, { actor, period, closureId }) {
  const result = buildCloseChecklist(db, period);
  const snapshotId = id();
  transaction(db, () => {
    db.prepare('INSERT INTO accounting_close_check_snapshots(id,period,closure_id,checklist_json,passed,created_at) VALUES(?,?,?,?,?,?)')
      .run(snapshotId, period, closureId || null, JSON.stringify(result.items), result.passed ? 1 : 0, nowIso());
  });
  return { id: snapshotId, ...result };
}

function getCloseChecklist(db, res, actor, url) {
  allowAny(actor, ['PERIOD_CLOSE_MANAGE', 'ACCOUNTING_RECONCILIATION_VIEW', 'ACCOUNTING_VIEW']);
  const period = url.searchParams.get('period');
  if (!period) throw new HttpError(400, '请指定期间，格式: YYYY-MM', { code: 'ACCOUNTING_CLOSE_CHECK_PERIOD_REQUIRED' });
  const closure = db.prepare('SELECT * FROM period_closures WHERE period=?').get(period);
  if (!closure) {
    return send(res, 200, { checklist: [], passed: false, detail: '期间未初始化，请先创建期间记录' });
  }
  if (closure.status === 'CLOSED') {
    return send(res, 200, { checklist: [], passed: false, detail: '期间已结账' });
  }
  const result = buildCloseChecklist(db, period);
  return send(res, 200, { checklist: result.items, passed: result.passed });
}

export const accountingReconciliationHandlers = {
  listReconciliation,
  listReconciliationRuns,
  triggerReconciliation,
  getCloseChecklist,
};

