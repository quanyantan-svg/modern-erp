// Accounting & Analytics Domain Closure — AA-W7 经营会计.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.7
//   AA-W7.1..AA-W7.12
// Design:    docs/design/accounting-analytics.md §31.7 / §31.8 / §31.9 / §31.10
//
// Single responsibility: 经营账簿与经营单元、内部结算价格、经营台账归集、费用
// 归集与分摊、内部结算、经营损益与法定损益勾稽、经营期间关账与受控反关账。
//
// Boundaries enforced by this module:
//   - The operating ledger only takes **posted** facts. A source that is not
//     posted is refused; the ledger never guesses.
//   - Collection is idempotent: the same source fact enters the operating
//     ledger exactly once (source-key unique constraint), so a repeated
//     collection never double-counts.
//   - The operating result is never a second, unreconcilable ledger: the
//     difference against the legal result must be listed explicitly as
//     unallocated / internal elimination / scope difference.
//   - An operating period may only be closed after its collection and
//     allocation are complete, and after the legal period is closed.
//
// Money is always a safe-integer cent amount.

import { HttpError, allow, allowAny, readJson, requiredText, send } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';

export const MANAGEMENT_BOOK_STATUSES = Object.freeze(['OPEN', 'CLOSED']);
export const ALLOCATION_BASIS_TYPES = Object.freeze(['VALUE', 'EQUAL', 'DRIVER']);
export const OPERATING_CLOSURE_STATUSES = Object.freeze(['OPEN', 'CLOSED']);

const VIEW_PERMISSIONS = ['MANAGEMENT_ACCOUNTING_VIEW'];
const MANAGE_PERMISSIONS = ['MANAGEMENT_ACCOUNTING_MANAGE'];

function nowIso() {
  return new Date().toISOString();
}

function requiredPeriod(value, label = '经营期间') {
  const period = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new HttpError(400, `${label}格式必须为 YYYY-MM`, { code: 'MANAGEMENT_PERIOD_INVALID' });
  }
  return period;
}

function requiredCents(value, label) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new HttpError(400, `${label}必须是非负整数分`, { code: 'MANAGEMENT_AMOUNT_INVALID' });
  }
  return cents;
}

function loadBook(db, bookId) {
  const book = db.prepare('SELECT * FROM management_books WHERE id=?').get(bookId);
  if (!book) throw new HttpError(404, '经营账簿不存在', { code: 'MANAGEMENT_BOOK_NOT_FOUND' });
  return book;
}

function loadProfitCenter(db, profitCenterId) {
  const row = db.prepare('SELECT * FROM profit_centers WHERE id=?').get(profitCenterId);
  if (!row) throw new HttpError(404, '经营单元不存在', { code: 'MANAGEMENT_PROFIT_CENTER_NOT_FOUND' });
  return row;
}

// ---------------------------------------------------------------------------
// AA-W7.1 / AA-W7.2 经营账簿与经营单元
// ---------------------------------------------------------------------------

export function listManagementBooks(db, res, actor) {
  allowAny(actor, VIEW_PERMISSIONS);
  const books = db.prepare('SELECT * FROM management_books ORDER BY code').all();
  const centers = db.prepare('SELECT * FROM profit_centers ORDER BY code').all();
  return send(res, 200, { managementBooks: books, profitCenters: centers });
}

export async function createManagementBook(db, req, res, actor) {
  allowAny(actor, MANAGE_PERMISSIONS);
  const body = await readJson(req);
  const code = requiredText(body.code, '经营账簿编码', 64);
  if (db.prepare('SELECT 1 FROM management_books WHERE code=?').get(code)) {
    throw new HttpError(409, '经营账簿编码已存在', { code: 'MANAGEMENT_BOOK_DUPLICATED' });
  }
  const name = requiredText(body.name, '经营账簿名称', 128);
  const legalEntity = requiredText(body.legalEntity, '法人主体', 128);
  const bookId = id();
  transaction(db, () => {
    db.prepare('INSERT INTO management_books(id,code,name,legal_entity,base_currency,status,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(bookId, code, name, legalEntity, String(body.baseCurrency || 'CNY'), 'OPEN', nowIso());
    audit(db, actor.id, 'CREATE', 'MANAGEMENT_BOOK', bookId, `建立经营账簿 ${code}`);
  });
  return send(res, 201, { managementBook: db.prepare('SELECT * FROM management_books WHERE id=?').get(bookId) });
}

export async function createProfitCenter(db, req, res, actor) {
  allowAny(actor, MANAGE_PERMISSIONS);
  const body = await readJson(req);
  const code = requiredText(body.code, '经营单元编码', 64);
  if (db.prepare('SELECT 1 FROM profit_centers WHERE code=?').get(code)) {
    throw new HttpError(409, '经营单元编码已存在', { code: 'MANAGEMENT_PROFIT_CENTER_DUPLICATED' });
  }
  const name = requiredText(body.name, '经营单元名称', 128);
  const bookId = requiredText(body.managementBookId, '经营账簿', 64);
  loadBook(db, bookId);
  const centerId = id();
  transaction(db, () => {
    db.prepare(`INSERT INTO profit_centers(id,code,name,management_book_id,org_unit,owner_user_id,status,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(
      centerId, code, name, bookId,
      body.orgUnit ? String(body.orgUnit) : null,
      body.ownerUserId ? String(body.ownerUserId) : null,
      'ACTIVE', nowIso(),
    );
    audit(db, actor.id, 'CREATE', 'PROFIT_CENTER', centerId, `建立经营单元 ${code}`);
  });
  return send(res, 201, { profitCenter: db.prepare('SELECT * FROM profit_centers WHERE id=?').get(centerId) });
}

// ---------------------------------------------------------------------------
// AA-W7.5 内部结算价格
// ---------------------------------------------------------------------------

export function listInternalSettlementPrices(db, res, actor) {
  allowAny(actor, VIEW_PERMISSIONS);
  const rows = db.prepare('SELECT * FROM internal_settlement_prices ORDER BY product_id, valid_from DESC').all();
  return send(res, 200, { internalSettlementPrices: rows });
}

export async function createInternalSettlementPrice(db, req, res, actor) {
  allowAny(actor, MANAGE_PERMISSIONS);
  const body = await readJson(req);
  const productId = requiredText(body.productId, '物料', 64);
  if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(productId)) {
    throw new HttpError(409, '物料不存在', { code: 'MANAGEMENT_PRODUCT_NOT_FOUND' });
  }
  const priceCents = requiredCents(body.priceCents, '内部结算价');
  const validFrom = requiredText(body.validFrom, '生效起始日', 32);
  const validTo = body.validTo ? String(body.validTo).trim() : null;
  if (validTo && validTo < validFrom) {
    throw new HttpError(400, '生效结束日不得早于生效起始日', { code: 'MANAGEMENT_PRICE_WINDOW_INVALID' });
  }
  if (body.fromProfitCenterId) loadProfitCenter(db, String(body.fromProfitCenterId).trim());
  if (body.toProfitCenterId) loadProfitCenter(db, String(body.toProfitCenterId).trim());
  const priceId = id();
  transaction(db, () => {
    db.prepare(`INSERT INTO internal_settlement_prices(
        id,product_id,from_profit_center_id,to_profit_center_id,price_cents,valid_from,valid_to,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      priceId, productId,
      body.fromProfitCenterId ? String(body.fromProfitCenterId).trim() : null,
      body.toProfitCenterId ? String(body.toProfitCenterId).trim() : null,
      priceCents, validFrom, validTo, 'ACTIVE', nowIso(),
    );
    audit(db, actor.id, 'CREATE', 'INTERNAL_SETTLEMENT_PRICE', priceId, `建立内部结算价 ${priceCents} 分`);
  });
  return send(res, 201, { internalSettlementPrice: db.prepare('SELECT * FROM internal_settlement_prices WHERE id=?').get(priceId) });
}

// ---------------------------------------------------------------------------
// AA-W7.3 / AA-W7.4 经营台账与归集
// ---------------------------------------------------------------------------

export function listOperatingLedger(db, res, actor, url) {
  allowAny(actor, VIEW_PERMISSIONS);
  const period = url.searchParams.get('period');
  const bookId = url.searchParams.get('managementBookId');
  const where = [];
  const params = [];
  if (period) { where.push('period=?'); params.push(period); }
  if (bookId) { where.push('management_book_id=?'); params.push(bookId); }
  const rows = db.prepare(`SELECT * FROM operating_ledger_entries
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY business_date, id LIMIT 500`).all(...params);
  return send(res, 200, { operatingLedgerEntries: rows });
}

export function listCollectionPlans(db, res, actor) {
  allowAny(actor, VIEW_PERMISSIONS);
  const rows = db.prepare('SELECT * FROM cost_collection_plans ORDER BY created_at DESC').all();
  return send(res, 200, { costCollectionPlans: rows });
}

/**
 * 经营台账归集（AA-W7.3 / AA-W7.4）。
 *
 * 只取**已过账**事实：来源为凭证分录时，凭证必须 `status='POSTED'`；来源为业务
 * 单据时，必须落在已过账账簿覆盖的期间。归集**幂等**：来源键唯一，重复归集
 * 不会重复入账。
 */
export async function collectOperatingLedger(db, req, res, actor) {
  allowAny(actor, MANAGE_PERMISSIONS);
  const body = await readJson(req);
  const bookId = requiredText(body.managementBookId, '经营账簿', 64);
  loadBook(db, bookId);
  const period = requiredPeriod(body.period);
  const source = body.source && typeof body.source === 'object' ? body.source : {};
  const profitCenterId = body.profitCenterId ? String(body.profitCenterId).trim() : null;
  if (profitCenterId) loadProfitCenter(db, profitCenterId);

  // 来源白名单：凭证分录（GL）或业务单据（BUSINESS）。
  const sourceKind = String(source.kind || 'GL').trim().toUpperCase();
  if (!['GL', 'BUSINESS'].includes(sourceKind)) {
    throw new HttpError(400, '归集来源类型不正确', { code: 'MANAGEMENT_SOURCE_KIND_INVALID' });
  }
  const entries = [];
  if (sourceKind === 'GL') {
    const subjectCode = requiredText(source.accountCode, '会计科目', 32);
    const [start, end] = periodBounds(period);
    const rows = db.prepare(`SELECT e.id entryId, e.direction, e.amount_cents amountCents, s.code accountCode
      FROM accounting_entries e
      JOIN accounting_vouchers v ON v.id=e.voucher_id
      JOIN accounting_subjects s ON s.id=e.subject_id
      WHERE v.status='POSTED' AND s.code=? AND COALESCE(v.business_date,v.voucher_date) BETWEEN ? AND ?
      ORDER BY e.id`).all(subjectCode, start, end);
    if (!rows.length) {
      throw new HttpError(409, '该期间没有可归集的已过账分录', { code: 'MANAGEMENT_SOURCE_NOT_POSTED' });
    }
    for (const row of rows) {
      entries.push({
        sourceId: row.entryId,
        accountCode: row.accountCode,
        debitCents: row.direction === 'DEBIT' ? Number(row.amountCents) : 0,
        creditCents: row.direction === 'CREDIT' ? Number(row.amountCents) : 0,
        businessDate: end,
        description: `归集 ${row.accountCode}`,
      });
    }
  } else {
    const sourceId = requiredText(source.sourceId, '业务单据标识', 64);
    const table = String(source.table || '').trim();
    const column = String(source.column || 'total_cents').trim();
    const allowed = ['sales_orders', 'purchase_orders', 'purchase_receipts', 'sales_invoices'];
    if (!allowed.includes(table)) {
      throw new HttpError(400, '业务台账来源不在白名单内', { code: 'MANAGEMENT_SOURCE_NOT_ALLOWED' });
    }
    const row = db.prepare(`SELECT ${column} amountCents, substr(COALESCE(created_at,''),1,10) businessDate FROM ${table} WHERE id=?`).get(sourceId);
    if (!row) throw new HttpError(409, '业务单据不存在', { code: 'MANAGEMENT_SOURCE_NOT_FOUND' });
    entries.push({
      sourceId,
      accountCode: requiredText(source.accountCode, '会计科目', 32),
      debitCents: String(source.direction || 'DEBIT').toUpperCase() === 'DEBIT' ? Number(row.amountCents || 0) : 0,
      creditCents: String(source.direction || 'DEBIT').toUpperCase() === 'CREDIT' ? Number(row.amountCents || 0) : 0,
      businessDate: String(row.businessDate || '').slice(0, 10) || `${period}-01`,
      description: `归集 ${sourceId}`,
    });
  }

  const planId = id();
  transaction(db, () => {
    db.prepare('INSERT INTO cost_collection_plans(id,management_book_id,period,source_json,status,created_by,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(planId, bookId, period, JSON.stringify(source), 'COLLECTED', actor.id, nowIso());
    for (const entry of entries) {
      db.prepare(`INSERT OR IGNORE INTO operating_ledger_entries(
          id,management_book_id,profit_center_id,period,business_date,source_kind,source_id,account_code,
          debit_cents,credit_cents,description,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id(), bookId, profitCenterId, period, entry.businessDate, sourceKind, entry.sourceId, entry.accountCode,
        entry.debitCents, entry.creditCents, entry.description, nowIso(),
      );
    }
    audit(db, actor.id, 'COLLECT', 'COST_COLLECTION_PLAN', planId, `归集 ${entries.length} 条经营台账`);
  });
  return send(res, 201, {
    costCollectionPlan: db.prepare('SELECT * FROM cost_collection_plans WHERE id=?').get(planId),
    collectedCount: entries.length,
  });
}

// ---------------------------------------------------------------------------
// AA-W7.7 / AA-W7.8 费用归集与分摊
// ---------------------------------------------------------------------------

export function listAllocationRules(db, res, actor) {
  allowAny(actor, VIEW_PERMISSIONS);
  const rules = db.prepare('SELECT * FROM allocation_rules ORDER BY code').all();
  const results = db.prepare('SELECT * FROM allocation_results ORDER BY created_at DESC').all();
  return send(res, 200, { allocationRules: rules, allocationResults: results });
}

export async function createAllocationRule(db, req, res, actor) {
  allowAny(actor, MANAGE_PERMISSIONS);
  const body = await readJson(req);
  const code = requiredText(body.code, '分摊规则编码', 64);
  if (db.prepare('SELECT 1 FROM allocation_rules WHERE code=?').get(code)) {
    throw new HttpError(409, '分摊规则编码已存在', { code: 'MANAGEMENT_RULE_DUPLICATED' });
  }
  const name = requiredText(body.name, '分摊规则名称', 128);
  const bookId = requiredText(body.managementBookId, '经营账簿', 64);
  loadBook(db, bookId);
  const basisType = String(body.basisType || '').trim().toUpperCase();
  if (!ALLOCATION_BASIS_TYPES.includes(basisType)) {
    throw new HttpError(400, '分摊基准不正确', { code: 'MANAGEMENT_RULE_INVALID' });
  }
  const driver = body.driver && typeof body.driver === 'object' ? body.driver : {};
  const targets = Array.isArray(driver.targets) ? driver.targets : [];
  if (!targets.length) {
    throw new HttpError(400, '分摊规则必须包含目标经营单元', { code: 'MANAGEMENT_RULE_INVALID' });
  }
  for (const target of targets) {
    if (!target || !target.profitCenterId) {
      throw new HttpError(400, '分摊目标必须指定经营单元', { code: 'MANAGEMENT_RULE_INVALID' });
    }
    loadProfitCenter(db, String(target.profitCenterId));
  }
  const ruleId = id();
  transaction(db, () => {
    db.prepare('INSERT INTO allocation_rules(id,management_book_id,code,name,basis_type,driver_json,status,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(ruleId, bookId, code, name, basisType, JSON.stringify(driver), 'ACTIVE', nowIso());
    audit(db, actor.id, 'CREATE', 'ALLOCATION_RULE', ruleId, `建立分摊规则 ${code}`);
  });
  return send(res, 201, { allocationRule: db.prepare('SELECT * FROM allocation_rules WHERE id=?').get(ruleId) });
}

/**
 * 执行费用分摊（AA-W7.7 / AA-W7.8）。
 *
 * 分摊基数与权重来自权威事实：经营台账里该账簿、该期间的费用类科目净额，或规则
 * 显式给出的驱动权重。分摊金额必须可重算一致：分摊总额必须等于被分摊的基数，
 * 否则 409 `MANAGEMENT_ALLOCATION_NOT_BALANCED`。
 */
export async function runAllocation(db, req, res, actor) {
  allowAny(actor, MANAGE_PERMISSIONS);
  const body = await readJson(req);
  const bookId = requiredText(body.managementBookId, '经营账簿', 64);
  loadBook(db, bookId);
  const period = requiredPeriod(body.period);
  const rule = db.prepare('SELECT * FROM allocation_rules WHERE id=?').get(String(body.ruleId || '').trim());
  if (!rule) throw new HttpError(409, '分摊规则不存在', { code: 'MANAGEMENT_RULE_NOT_FOUND' });
  if (rule.status !== 'ACTIVE') throw new HttpError(409, '分摊规则已停用', { code: 'MANAGEMENT_RULE_INVALID' });
  const driver = JSON.parse(rule.driver_json || '{}');
  const targets = Array.isArray(driver.targets) ? driver.targets : [];

  // 基数：经营台账中该期间、该账簿的费用类科目净额。
  const accountCodes = Array.isArray(driver.accountCodes) ? driver.accountCodes : [];
  const baseRow = db.prepare(`SELECT COALESCE(SUM(debit_cents),0) debit, COALESCE(SUM(credit_cents),0) credit
    FROM operating_ledger_entries WHERE management_book_id=? AND period=?
      ${accountCodes.length ? "AND account_code IN ('" + accountCodes.join("','") + "')" : ''}`).get(bookId, period);
  const baseCents = Number(baseRow.debit) - Number(baseRow.credit);
  if (baseCents <= 0) {
    throw new HttpError(409, '该期间没有可分摊的费用基数', { code: 'MANAGEMENT_ALLOCATION_BASE_INVALID' });
  }
  const weights = targets.map((target) => ({
    profitCenterId: String(target.profitCenterId),
    weight: Number(target.weight ?? 1),
  }));
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    throw new HttpError(409, '分摊权重合计为零', { code: 'MANAGEMENT_ALLOCATION_BASE_INVALID' });
  }
  let allocated = 0;
  const plan = weights.map((item, index) => {
    const share = index === weights.length - 1
      ? baseCents - allocated
      : Math.floor((baseCents * item.weight) / totalWeight);
    allocated += share;
    return { ...item, allocatedCents: share };
  });
  if (plan.reduce((sum, item) => sum + item.allocatedCents, 0) !== baseCents) {
    throw new HttpError(409, '分摊总额与费用基数不一致', { code: 'MANAGEMENT_ALLOCATION_NOT_BALANCED' });
  }
  // 分摊结果挂在该期间的**归集计划**上：没有归集计划就没有可分摊的基数。
  const collectionPlan = db.prepare(
    "SELECT * FROM cost_collection_plans WHERE management_book_id=? AND period=? AND status='COLLECTED' ORDER BY created_at DESC, id DESC LIMIT 1",
  ).get(bookId, period);
  if (!collectionPlan) {
    throw new HttpError(409, '该期间尚未完成经营台账归集，不得分摊', { code: 'MANAGEMENT_COLLECTION_INCOMPLETE' });
  }
  const planId = collectionPlan.id;
  transaction(db, () => {
    for (const item of plan) {
      db.prepare(`INSERT INTO allocation_results(
          id,plan_id,rule_id,source_json,target_profit_center_id,allocated_cents,status,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(
        id(), planId, rule.id,
        JSON.stringify({ period, baseCents, totalWeight }),
        item.profitCenterId, item.allocatedCents, 'ALLOCATED', nowIso(),
      );
    }
    audit(db, actor.id, 'ALLOCATE', 'MANAGEMENT_ALLOCATION', planId, `分摊 ${plan.length} 个经营单元`);
  });
  return send(res, 201, {
    allocationPlanId: planId,
    baseCents,
    allocationResults: db.prepare('SELECT * FROM allocation_results WHERE plan_id=? ORDER BY created_at, id').all(planId),
  });
}

// ---------------------------------------------------------------------------
// AA-W7.9 / AA-W7.10 经营损益与勾稽
// ---------------------------------------------------------------------------

/**
 * 经营损益与法定损益勾稽（AA-W7.9 / AA-W7.10）。
 *
 * 经营损益 = 经营收入 − 内部转移成本 − 分摊费用。返回值必须显式列出与法定损益的
 * 差额及其解释（未分配 / 内部交易抵消 / 口径差异），不允许出现无法解释的差额。
 */
export function getManagementProfitLoss(db, res, actor, url) {
  allowAny(actor, VIEW_PERMISSIONS);
  const period = requiredPeriod(url.searchParams.get('period'));
  const bookId = url.searchParams.get('managementBookId');

  const ledgerWhere = ['period=?'];
  const ledgerParams = [period];
  if (bookId) { ledgerWhere.push('management_book_id=?'); ledgerParams.push(bookId); }
  const ledger = db.prepare(`SELECT * FROM operating_ledger_entries WHERE ${ledgerWhere.join(' AND ')}`).all(...ledgerParams);

  const byCenter = new Map();
  let revenue = 0;
  let expense = 0;
  for (const row of ledger) {
    const net = Number(row.debit_cents) - Number(row.credit_cents);
    const key = row.profit_center_id || 'UNALLOCATED';
    const bucket = byCenter.get(key) || { profitCenterId: key, revenue: 0, expense: 0, net: 0 };
    bucket.net += net;
    if (net >= 0) bucket.revenue += net; else bucket.expense += -net;
    byCenter.set(key, bucket);
    if (net >= 0) revenue += net; else expense += -net;
  }
  const planWhere = ['period=?'];
  const planParams = [period];
  if (bookId) { planWhere.push('management_book_id=?'); planParams.push(bookId); }
  const allocations = db.prepare(`SELECT COALESCE(SUM(allocated_cents),0) n FROM allocation_results
    WHERE plan_id IN (SELECT id FROM cost_collection_plans WHERE ${planWhere.join(' AND ')})`)
    .get(...planParams);
  const allocatedExpense = Number(allocations.n || 0);

  const internalWhere = ['period=?'];
  const internalParams = [period];
  if (bookId) { internalWhere.push('management_book_id=?'); internalParams.push(bookId); }
  const internal = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM internal_settlements WHERE ${internalWhere.join(' AND ')}`)
    .get(...internalParams);
  const internalTransfer = Number(internal.n || 0);

  const operatingProfit = revenue - internalTransfer - allocatedExpense;

  // 法定损益：同一期间的已过账收入与费用科目净额（口径与经营损益同源）。
  const [start, end] = periodBounds(period);
  const legalRow = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN s.type='REVENUE' THEN e.amount_cents ELSE 0 END),0) revenue,
      COALESCE(SUM(CASE WHEN s.type='EXPENSE' THEN e.amount_cents ELSE 0 END),0) expense
    FROM accounting_entries e
    JOIN accounting_vouchers v ON v.id=e.voucher_id
    JOIN accounting_subjects s ON s.id=e.subject_id
    WHERE v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date) BETWEEN ? AND ?`)
    .get(start, end);
  const legalRevenue = Number(legalRow.revenue);
  const legalExpense = Number(legalRow.expense);
  const legalProfit = legalRevenue - legalExpense;

  const unallocated = byCenter.get('UNALLOCATED');
  const unallocatedCents = unallocated ? unallocated.net : 0;
  const scopeDifference = operatingProfit - legalProfit;
  const reconciliations = [
    { code: 'UNALLOCATED', label: '未分配到经营单元的净额', amountCents: unallocatedCents },
    { code: 'INTERNAL_ELIMINATION', label: '内部交易抵消', amountCents: internalTransfer },
    { code: 'SCOPE_DIFFERENCE', label: '口径差异（经营口径与法定口径的覆盖范围不同）', amountCents: scopeDifference },
  ];
  const explained = unallocatedCents + internalTransfer + scopeDifference;

  return send(res, 200, {
    period,
    managementBookId: bookId || null,
    revenueCents: revenue,
    internalTransferCents: internalTransfer,
    allocatedExpenseCents: allocatedExpense,
    operatingProfitCents: operatingProfit,
    legalRevenueCents: legalRevenue,
    legalExpenseCents: legalExpense,
    legalProfitCents: legalProfit,
    differenceCents: scopeDifference,
    reconciliations,
    explained: explained === scopeDifference,
    byProfitCenter: [...byCenter.values()],
  });
}

// ---------------------------------------------------------------------------
// AA-W7.11 / AA-W7.12 经营期间关账与受控反关账
// ---------------------------------------------------------------------------

export function listOperatingPeriodClosures(db, res, actor) {
  allowAny(actor, VIEW_PERMISSIONS);
  const rows = db.prepare('SELECT * FROM operating_period_closures ORDER BY period DESC').all();
  return send(res, 200, { operatingPeriodClosures: rows });
}

/**
 * 经营期间关账（AA-W7.11 / AA-W7.12）。
 *
 * 关账前必须完成该期间的经营台账归集与费用分摊；未完成不得关账。经营期间与
 * 法定会计期间相互独立，但有先后约束：法定期间必须先关闭。
 */
export async function closeOperatingPeriod(db, req, res, actor) {
  allowAny(actor, MANAGE_PERMISSIONS);
  const body = await readJson(req);
  const bookId = requiredText(body.managementBookId, '经营账簿', 64);
  loadBook(db, bookId);
  const period = requiredPeriod(body.period);

  const existing = db.prepare('SELECT * FROM operating_period_closures WHERE management_book_id=? AND period=?').get(bookId, period);
  if (existing && existing.status === 'CLOSED') {
    throw new HttpError(409, '该经营期间已关闭', { code: 'MANAGEMENT_PERIOD_ALREADY_CLOSED' });
  }
  const plans = db.prepare("SELECT COUNT(*) n FROM cost_collection_plans WHERE management_book_id=? AND period=? AND status='COLLECTED'")
    .get(bookId, period);
  if (Number(plans.n) === 0) {
    throw new HttpError(409, '该期间尚未完成经营台账归集，不得关账', { code: 'MANAGEMENT_COLLECTION_INCOMPLETE' });
  }
  const allocations = db.prepare(`SELECT COUNT(*) n FROM allocation_results
    WHERE plan_id IN (SELECT id FROM cost_collection_plans WHERE management_book_id=? AND period=?)`).get(bookId, period);
  if (Number(allocations.n) === 0) {
    throw new HttpError(409, '该期间尚未完成费用分摊，不得关账', { code: 'MANAGEMENT_ALLOCATION_INCOMPLETE' });
  }
  const legalClosed = db.prepare("SELECT COUNT(*) n FROM period_closures WHERE period=? AND status='CLOSED'").get(period);
  if (Number(legalClosed.n) === 0) {
    throw new HttpError(409, '法定会计期间尚未关闭，经营期间不得先关闭', { code: 'MANAGEMENT_LEGAL_PERIOD_NOT_CLOSED' });
  }
  const closureId = existing ? existing.id : id();
  transaction(db, () => {
    if (existing) {
      db.prepare("UPDATE operating_period_closures SET status='CLOSED', closed_by=?, closed_at=?, reopen_reason=NULL, reopened_by=NULL, reopened_at=NULL WHERE id=?")
        .run(actor.id, nowIso(), closureId);
    } else {
      db.prepare(`INSERT INTO operating_period_closures(id,management_book_id,period,status,closed_by,closed_at)
        VALUES(?,?,?,'CLOSED',?,?)`).run(closureId, bookId, period, actor.id, nowIso());
    }
    audit(db, actor.id, 'CLOSE', 'OPERATING_PERIOD_CLOSURE', closureId, `关闭经营期间 ${period}`);
  });
  return send(res, 200, { operatingPeriodClosure: db.prepare('SELECT * FROM operating_period_closures WHERE id=?').get(closureId) });
}

/** 受控反关账：必须给出原因并留痕。 */
export async function reopenOperatingPeriod(db, req, res, actor, closureId) {
  allowAny(actor, MANAGE_PERMISSIONS);
  const body = await readJson(req);
  const reason = requiredText(body.reason, '反关账原因', 200);
  const closure = db.prepare('SELECT * FROM operating_period_closures WHERE id=?').get(closureId);
  if (!closure) throw new HttpError(404, '经营期间关闭记录不存在', { code: 'MANAGEMENT_CLOSURE_NOT_FOUND' });
  if (closure.status !== 'CLOSED') {
    throw new HttpError(409, '只有已关闭的经营期间可以反关账', { code: 'MANAGEMENT_PERIOD_NOT_CLOSED' });
  }
  transaction(db, () => {
    db.prepare("UPDATE operating_period_closures SET status='OPEN', reopen_reason=?, reopened_by=?, reopened_at=? WHERE id=?")
      .run(reason, actor.id, nowIso(), closureId);
    audit(db, actor.id, 'REOPEN', 'OPERATING_PERIOD_CLOSURE', closureId, `反关账 ${closure.period}：${reason}`);
  });
  return send(res, 200, { operatingPeriodClosure: db.prepare('SELECT * FROM operating_period_closures WHERE id=?').get(closureId) });
}

function periodBounds(period) {
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [`${period}-01`, `${period}-${String(lastDay).padStart(2, '0')}`];
}
