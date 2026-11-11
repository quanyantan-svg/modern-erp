// Accounting & Analytics Domain Closure — AA-W3 period-end automation.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.3
//   AA-W3.11..AA-W3.17
// Design:    docs/design/accounting-analytics.md §31.3.5 / §31.3.6
//
// Single responsibility: 期末转账 / 摊销 / 计提定义与执行、损益结转与反结转。
//
// Contracts:
//   - AA-W3.12 — a definition binds a period scope, a source, a target account
//     role, a direction and an amount expression.
//   - AA-W3.13 — the result is a **normal voucher** produced through the
//     template / rule path. It never writes `accounting_entries` directly.
//   - AA-W3.14 / AA-W3.16 — the profit-and-loss transfer is a real transfer:
//     the P&L subject balances go to zero and the equity subject carries the
//     net result. A period may not be closed while the transfer is missing.
//   - AA-W3.17 — the reverse transfer is a controlled operation: it produces a
//     reversing voucher, leaves a trace, and is limited to ADMIN.

import { HttpError, allow, readJson, requiredText, send } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';
import { evaluateTemplateAmount, isAccountingExpressionError } from './accounting-expressions.js';
import { createSystemVoucher } from './financial-inventory.js';

const DEFINITION_TYPES = Object.freeze(['TRANSFER', 'AMORTIZATION', 'ACCRUAL']);
const DIRECTIONS = Object.freeze(['DEBIT', 'CREDIT']);

function nowIso() {
  return new Date().toISOString();
}

function periodEnd(period) {
  const [year, month] = String(period).split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return String(period) + '-' + String(lastDay).padStart(2, '0');
}

function subjectForRole(db, role) {
  const row = db.prepare(
    'SELECT s.id FROM account_role_mappings m JOIN accounting_subjects s ON s.id=m.subject_id AND s.active=1 WHERE m.role_code=?',
  ).get(role);
  if (!row) {
    throw new HttpError(409, '缺少会计科目角色映射：' + role, { code: 'ACCOUNTING_ROLE_MAPPING_MISSING' });
  }
  return row.id;
}

// ---------------------------------------------------------------------------
// Definitions (AA-W3.12)
// ---------------------------------------------------------------------------

function listDefinitions(db, res, actor, url) {
  allow(actor, 'ACCOUNTING_PERIOD_END_MANAGE');
  const status = url.searchParams.get('status');
  const definitions = db.prepare(
    `SELECT * FROM period_end_definitions ${status ? 'WHERE status=?' : ''} ORDER BY code`,
  ).all(...(status ? [status] : []));
  return send(res, 200, { definitions });
}

async function createDefinition(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_PERIOD_END_MANAGE');
  const body = await readJson(req);
  const defType = requiredText(body.defType, '期末处理类型', 20).toUpperCase();
  if (!DEFINITION_TYPES.includes(defType)) {
    throw new HttpError(400, '期末处理类型非法：' + defType, { code: 'PERIOD_END_DEF_TYPE_INVALID' });
  }
  const code = requiredText(body.code, '定义编码', 50).toUpperCase();
  const name = requiredText(body.name, '定义名称', 100);
  const targetRole = requiredText(body.targetRole, '目标科目角色', 60);
  const direction = requiredText(body.direction, '方向', 10).toUpperCase();
  if (!DIRECTIONS.includes(direction)) {
    throw new HttpError(400, '期末处理方向非法：' + direction, { code: 'PERIOD_END_DIRECTION_INVALID' });
  }
  const amountExpr = requiredText(body.amountExpr, '金额表达式', 512);
  if (db.prepare('SELECT 1 FROM period_end_definitions WHERE code=?').get(code)) {
    throw new HttpError(409, '期末处理定义编码已存在：' + code, { code: 'PERIOD_END_DEF_CODE_EXISTS' });
  }
  // The expression is validated up front so an invalid definition can never
  // reach the period-close path.
  try {
    evaluateTemplateAmount(amountExpr, { SOURCE_AMOUNT: 0, SOURCE_TAX: 0, SOURCE_COUNT: 0, PERIOD: '2000-01' });
  } catch (error) {
    if (isAccountingExpressionError(error)) {
      throw new HttpError(400, '金额表达式非法：' + error.code, { code: 'PERIOD_END_EXPRESSION_INVALID' });
    }
    throw error;
  }
  const definitionId = id();
  transaction(db, () => {
    db.prepare(`INSERT INTO period_end_definitions(
        id,def_type,code,name,source_json,target_role,direction,amount_expr,valid_from,valid_to,status,created_by,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`)
      .run(definitionId, defType, code, name, JSON.stringify(body.source || {}), targetRole, direction, amountExpr,
        body.validFrom || null, body.validTo || null, actor.id, nowIso());
    audit(db, actor.id, 'PERIOD_END_DEFINITION_CREATE', 'PERIOD_END_DEFINITION', definitionId, '创建期末处理定义 ' + code);
  });
  return send(res, 201, { id: definitionId, code });
}

async function updateDefinition(db, req, res, actor, definitionId) {
  allow(actor, 'ACCOUNTING_PERIOD_END_MANAGE');
  const definition = db.prepare('SELECT * FROM period_end_definitions WHERE id=?').get(definitionId);
  if (!definition) throw new HttpError(404, '期末处理定义不存在', { code: 'PERIOD_END_DEF_NOT_FOUND' });
  const body = await readJson(req);
  const amountExpr = body.amountExpr === undefined ? definition.amount_expr : requiredText(body.amountExpr, '金额表达式', 512);
  try {
    evaluateTemplateAmount(amountExpr, { SOURCE_AMOUNT: 0, SOURCE_TAX: 0, SOURCE_COUNT: 0, PERIOD: '2000-01' });
  } catch (error) {
    if (isAccountingExpressionError(error)) {
      throw new HttpError(400, '金额表达式非法：' + error.code, { code: 'PERIOD_END_EXPRESSION_INVALID' });
    }
    throw error;
  }
  transaction(db, () => {
    db.prepare('UPDATE period_end_definitions SET name=?, target_role=?, direction=?, amount_expr=?, valid_from=?, valid_to=?, status=? WHERE id=?')
      .run(body.name || definition.name, body.targetRole || definition.target_role, body.direction || definition.direction,
        amountExpr, body.validFrom === undefined ? definition.valid_from : body.validFrom,
        body.validTo === undefined ? definition.valid_to : body.validTo, body.status || definition.status, definitionId);
    audit(db, actor.id, 'PERIOD_END_DEFINITION_UPDATE', 'PERIOD_END_DEFINITION', definitionId, '修改期末处理定义 ' + definition.code);
  });
  return send(res, 200, { id: definitionId });
}

function deactivateDefinition(db, req, res, actor, definitionId) {
  allow(actor, 'ACCOUNTING_PERIOD_END_MANAGE');
  const definition = db.prepare('SELECT * FROM period_end_definitions WHERE id=?').get(definitionId);
  if (!definition) throw new HttpError(404, '期末处理定义不存在', { code: 'PERIOD_END_DEF_NOT_FOUND' });
  transaction(db, () => {
    db.prepare("UPDATE period_end_definitions SET status='INACTIVE' WHERE id=?").run(definitionId);
    audit(db, actor.id, 'PERIOD_END_DEFINITION_DEACTIVATE', 'PERIOD_END_DEFINITION', definitionId, '停用期末处理定义 ' + definition.code);
  });
  return send(res, 200, { id: definitionId, status: 'INACTIVE' });
}

// ---------------------------------------------------------------------------
// Execution (AA-W3.13)
// ---------------------------------------------------------------------------

/**
 * AA-W3.12 / AA-W3.13 — run one definition for one period.
 *
 * The run is idempotent on `(definition_id, period)`: a repeated execution
 * returns the existing run instead of producing a second voucher. The
 * generated voucher goes through the normal voucher path — this module never
 * writes `accounting_entries` directly.
 */
function runDefinition(db, { actor, definition, period }) {
  const existing = db.prepare('SELECT * FROM period_end_runs WHERE definition_id=? AND period=?').get(definition.id, period);
  if (existing) {
    return { run: existing, alreadyRun: true, voucherId: existing.voucher_id };
  }
  if (definition.status !== 'ACTIVE') {
    throw new HttpError(409, '期末处理定义已停用：' + definition.code, { code: 'PERIOD_END_DEF_INACTIVE' });
  }
  const runId = id();
  const now = nowIso();
  transaction(db, () => {
    db.prepare('INSERT INTO period_end_runs(id,definition_id,period,status,amount_cents,created_at) VALUES(?,?,?,?,?,?)')
      .run(runId, definition.id, period, 'RUNNING', 0, now);
  });

  try {
    const source = JSON.parse(definition.source_json || '{}');
    const amount = evaluateTemplateAmount(definition.amount_expr, {
      SOURCE_AMOUNT: Number(source.amountCents || 0),
      SOURCE_TAX: Number(source.taxCents || 0),
      SOURCE_COUNT: Number(source.count || 0),
      PERIOD: period,
    });
    const amountCents = Math.round(amount);
    if (!Number.isSafeInteger(amountCents) || amountCents === 0) {
      throw new HttpError(409, '期末处理金额必须为非零安全整数分', { code: 'PERIOD_END_AMOUNT_INVALID' });
    }
    const targetSubjectId = subjectForRole(db, definition.target_role);
    const sourceSubjectId = source.sourceRole ? subjectForRole(db, source.sourceRole) : null;
    if (!sourceSubjectId) {
      throw new HttpError(409, '期末处理定义缺少来源科目角色', { code: 'PERIOD_END_SOURCE_ROLE_REQUIRED' });
    }
    const voucherId = transaction(db, () => createSystemVoucher(db, {
      sourceType: 'PERIOD_END',
      sourceId: runId,
      businessDate: periodEnd(period),
      actorId: actor.id,
      remark: definition.name,
      // AA-W3.16 — 期末处理只写总账，不触碰存货数量与估值，因此不受存货
      // 月结截止限制；会计期间截止仍然生效。
      allowClosedInventoryPeriod: true,
      entries: [
        { subjectId: targetSubjectId, direction: definition.direction, amountCents, summary: definition.name },
        { subjectId: sourceSubjectId, direction: definition.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT', amountCents, summary: definition.name },
      ],
    }));
    transaction(db, () => {
      db.prepare("UPDATE period_end_runs SET status='COMPLETED', amount_cents=?, voucher_id=? WHERE id=?")
        .run(amountCents, voucherId, runId);
      audit(db, actor.id, 'PERIOD_END_RUN', 'PERIOD_END_RUN', runId, '执行期末处理 ' + definition.code + ' 期间 ' + period);
    });
    return { run: db.prepare('SELECT * FROM period_end_runs WHERE id=?').get(runId), alreadyRun: false, voucherId };
  } catch (error) {
    transaction(db, () => {
      db.prepare("UPDATE period_end_runs SET status='FAILED', error_code=?, error_message=? WHERE id=?")
        .run(error.code || 'PERIOD_END_RUN_FAILED', error.message || '', runId);
    });
    throw error;
  }
}

async function runPeriodEnd(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_PERIOD_END_MANAGE');
  const body = await readJson(req);
  const period = requiredText(body.period, '期间', 7);
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new HttpError(400, '期间格式应为 YYYY-MM', { code: 'PERIOD_END_PERIOD_INVALID' });
  }
  const definitions = body.definitionId
    ? db.prepare('SELECT * FROM period_end_definitions WHERE id=?').all(body.definitionId)
    : db.prepare("SELECT * FROM period_end_definitions WHERE status='ACTIVE' ORDER BY code").all();
  if (!definitions.length) {
    throw new HttpError(409, '没有可执行的期末处理定义', { code: 'PERIOD_END_NO_DEFINITION' });
  }
  const runs = [];
  for (const definition of definitions) {
    try {
      const result = runDefinition(db, { actor, definition, period });
      runs.push({ definitionId: definition.id, code: definition.code, status: result.run.status, voucherId: result.voucherId, alreadyRun: result.alreadyRun });
    } catch (error) {
      runs.push({ definitionId: definition.id, code: definition.code, status: 'FAILED', errorCode: error.code || 'PERIOD_END_RUN_FAILED' });
    }
  }
  return send(res, 200, { period, runs });
}

function listRuns(db, res, actor, url) {
  allow(actor, 'ACCOUNTING_PERIOD_END_MANAGE');
  const period = url.searchParams.get('period');
  const runs = db.prepare(`SELECT * FROM period_end_runs ${period ? 'WHERE period=?' : ''} ORDER BY created_at DESC LIMIT 200`)
    .all(...(period ? [period] : []));
  return send(res, 200, { runs });
}

// ---------------------------------------------------------------------------
// Profit and-loss transfer (AA-W3.14..AA-W3.17)
// ---------------------------------------------------------------------------

/**
 * AA-W3.14 — the P&L subject balances that participate in the transfer.
 *
 * The transfer scope is the authoritative `accounting_subjects.type` set:
 * REVENUE, COST and EXPENSE. A subject with a different type is never
 * touched.
 */
function profitLossBalances(db, period) {
  const rows = db.prepare(`
    SELECT s.id subjectId, s.code subjectCode, s.name subjectName, s.type subjectType,
           COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) balanceCents
    FROM accounting_subjects s
    JOIN accounting_entries e ON e.subject_id=s.id
    JOIN accounting_vouchers v ON v.id=e.voucher_id
    WHERE v.status='POSTED' AND v.period=? AND s.type IN ('REVENUE','COST','EXPENSE')
    GROUP BY s.id, s.code, s.name, s.type
    ORDER BY s.code
  `).all(period);
  return rows.filter((row) => Number(row.balanceCents) !== 0);
}

function profitTransferRole(db) {
  const row = db.prepare(
    'SELECT s.id FROM account_role_mappings m JOIN accounting_subjects s ON s.id=m.subject_id AND s.active=1 WHERE m.role_code=?',
  ).get('PROFIT_TRANSFER');
  if (!row) {
    throw new HttpError(409, '缺少损益结转科目角色映射：PROFIT_TRANSFER', { code: 'ACCOUNTING_ROLE_MAPPING_MISSING' });
  }
  return row.id;
}

/**
 * AA-W3.14 / AA-W3.15 — perform the real profit-and-loss transfer.
 *
 * The transfer produces a normal voucher that clears every P&L subject
 * balance and credits (or debits) the equity subject with the net result.
 * It is idempotent per period.
 */
function transferProfit(db, { actor, period, reason }) {
  const existing = db.prepare('SELECT * FROM profit_transfer_runs WHERE period=?').get(period);
  if (existing && existing.status === 'COMPLETED') {
    throw new HttpError(409, '本期已执行损益结转', { code: 'PROFIT_TRANSFER_ALREADY_DONE' });
  }
  if (existing && existing.status === 'REVERSED') {
    throw new HttpError(409, '本期损益结转已反结转，不可重复结转', { code: 'PROFIT_TRANSFER_ALREADY_DONE' });
  }
  const balances = profitLossBalances(db, period);
  if (!balances.length) {
    throw new HttpError(409, '本期没有需要结转的损益科目余额', { code: 'PROFIT_TRANSFER_NO_BALANCE' });
  }
  const equitySubjectId = profitTransferRole(db);
  const runId = existing ? existing.id : id();
  const now = nowIso();
  if (!existing) {
    transaction(db, () => {
      db.prepare('INSERT INTO profit_transfer_runs(id,period,status,transferred_cents,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(runId, period, 'RUNNING', 0, reason || '', actor.id, now);
    });
  }

  try {
    const entries = [];
    let netCents = 0;
    for (const balance of balances) {
      const amountCents = Math.abs(Number(balance.balanceCents));
      if (!Number.isSafeInteger(amountCents) || amountCents === 0) continue;
      // A debit balance (cost / expense) is cleared with a credit entry; a
      // credit balance (revenue) is cleared with a debit entry.
      entries.push({
        subjectId: balance.subjectId,
        direction: Number(balance.balanceCents) > 0 ? 'CREDIT' : 'DEBIT',
        amountCents,
        summary: '损益结转 ' + balance.subjectCode,
      });
      netCents += Number(balance.balanceCents);
    }
    if (!entries.length) {
      throw new HttpError(409, '本期没有需要结转的损益科目余额', { code: 'PROFIT_TRANSFER_NO_BALANCE' });
    }
    // 净损益 = -(借正余额合计)。净利为正时贷记权益科目，净亏时借记权益科目。
    const profitCents = -netCents;
    const equityCents = Math.abs(profitCents);
    entries.push({
      subjectId: equitySubjectId,
      direction: profitCents > 0 ? 'CREDIT' : 'DEBIT',
      amountCents: equityCents,
      summary: '损益结转',
    });

    const voucherId = transaction(db, () => createSystemVoucher(db, {
      sourceType: 'PROFIT_TRANSFER',
      sourceId: runId,
      businessDate: periodEnd(period),
      actorId: actor.id,
      remark: reason || '损益结转 ' + period,
      // AA-W3.16 — 损益结转是纯总账操作，存货月结已关闭时仍可执行；
      // 会计期间一旦关闭则永远拒绝新增过账。
      allowClosedInventoryPeriod: true,
      entries,
    }));
    transaction(db, () => {
      db.prepare("UPDATE profit_transfer_runs SET status='COMPLETED', voucher_id=?, transferred_cents=?, reason=? WHERE id=?")
        .run(voucherId, profitCents, reason || '', runId);
      audit(db, actor.id, 'PROFIT_TRANSFER', 'PROFIT_TRANSFER_RUN', runId, '损益结转 ' + period + ' 净额 ' + profitCents + ' 分');
    });
    return { run: db.prepare('SELECT * FROM profit_transfer_runs WHERE id=?').get(runId), voucherId };
  } catch (error) {
    transaction(db, () => {
      db.prepare("UPDATE profit_transfer_runs SET status='FAILED' WHERE id=?").run(runId);
    });
    throw error;
  }
}

async function postProfitTransfer(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_PERIOD_END_MANAGE');
  const body = await readJson(req);
  const period = requiredText(body.period, '期间', 7);
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new HttpError(400, '期间格式应为 YYYY-MM', { code: 'PROFIT_TRANSFER_PERIOD_INVALID' });
  }
  const result = transferProfit(db, { actor, period, reason: body.reason || '' });
  return send(res, 200, result);
}

function getProfitTransfer(db, res, actor, url) {
  allow(actor, 'ACCOUNTING_PERIOD_END_MANAGE');
  const period = url.searchParams.get('period');
  if (!period) throw new HttpError(400, '请指定期间，格式: YYYY-MM', { code: 'PROFIT_TRANSFER_PERIOD_REQUIRED' });
  const run = db.prepare('SELECT * FROM profit_transfer_runs WHERE period=?').get(period);
  return send(res, 200, { run: run || null, balances: profitLossBalances(db, period) });
}

/**
 * AA-W3.17 — the controlled reverse transfer. It is limited to ADMIN and it
 * leaves a trace: the original run becomes REVERSED with `reversed_at` /
 * `reversed_by`, and a reversing voucher is produced.
 */
async function reverseProfitTransfer(db, req, res, actor) {
  if (actor.roleCode !== 'ADMIN') {
    throw new HttpError(403, '仅系统管理员可反结转损益', { code: 'PROFIT_TRANSFER_NOT_ALLOWED' });
  }
  const body = await readJson(req);
  const period = requiredText(body.period, '期间', 7);
  const reason = requiredText(body.reason, '反结转原因', 500);
  const run = db.prepare('SELECT * FROM profit_transfer_runs WHERE period=?').get(period);
  if (!run) throw new HttpError(404, '本期没有损益结转记录', { code: 'PROFIT_TRANSFER_NOT_FOUND' });
  if (run.status !== 'COMPLETED') {
    throw new HttpError(409, '只有已完成的结转可以反结转', { code: 'PROFIT_TRANSFER_NOT_ALLOWED' });
  }
  const voucher = db.prepare('SELECT * FROM accounting_vouchers WHERE id=?').get(run.voucher_id);
  if (!voucher) throw new HttpError(409, '结转凭证不存在', { code: 'PROFIT_TRANSFER_VOUCHER_MISSING' });

  const reversalId = transaction(db, () => createSystemVoucher(db, {
    sourceType: 'PROFIT_TRANSFER_REVERSAL',
    sourceId: run.id,
    businessDate: periodEnd(period),
    actorId: actor.id,
    reversalOfId: voucher.id,
    remark: '反结转 ' + period + '：' + reason,
    entries: db.prepare('SELECT subject_id subjectId,direction,amount_cents amountCents,summary FROM accounting_entries WHERE voucher_id=? ORDER BY line_no').all(voucher.id)
      .map((entry) => ({ ...entry, direction: entry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT', summary: '反结转 ' + (entry.summary || '') })),
  }));
  transaction(db, () => {
    db.prepare("UPDATE profit_transfer_runs SET status='REVERSED', reversed_at=?, reversed_by=?, reason=? WHERE id=?")
      .run(nowIso(), actor.id, reason, run.id);
    audit(db, actor.id, 'PROFIT_TRANSFER_REVERSE', 'PROFIT_TRANSFER_RUN', run.id, '反结转 ' + period + '：' + reason);
  });
  return send(res, 200, { run: db.prepare('SELECT * FROM profit_transfer_runs WHERE id=?').get(run.id), voucherId: reversalId });
}

export const accountingPeriodEndHandlers = {
  listDefinitions,
  createDefinition,
  updateDefinition,
  deactivateDefinition,
  runPeriodEnd,
  listRuns,
  postProfitTransfer,
  getProfitTransfer,
  reverseProfitTransfer,
};

/**
 * AA-W3.16 — the transfer state of one period.
 *
 * The period close gate reads this state. A period whose profit-and-loss
 * accounts still carry a balance and which has no completed transfer is
 * blocked. A period without any profit-and-loss activity does not need a
 * transfer at all and must stay closable.
 */
export function profitTransferState(db, period) {
  const balances = profitLossBalances(db, period);
  const netCents = balances.reduce((sum, row) => sum + Number(row.balanceCents), 0);
  const run = db.prepare('SELECT * FROM profit_transfer_runs WHERE period=?').get(period);
  if (run && run.status === 'COMPLETED') {
    return { state: 'COMPLETED', netCents, run, required: true };
  }
  if (run && run.status === 'REVERSED') {
    return { state: 'REVERSED', netCents, run, required: true };
  }
  if (!balances.length) {
    return { state: 'NOT_REQUIRED', netCents: 0, run: run || null, required: false };
  }
  return { state: 'NOT_TRANSFERRED', netCents, run: run || null, required: true };
}

/**
 * AA-W3.16 — the close gate. It throws when the period still carries
 * un-transferred profit and loss.
 */
export function assertProfitTransferred(db, period) {
  const state = profitTransferState(db, period);
  if (state.required && state.state !== 'COMPLETED') {
    throw new HttpError(409, '会计结账健康检查失败: PROFIT_NOT_TRANSFERRED', { code: 'PROFIT_NOT_TRANSFERRED' });
  }
  return state;
}

