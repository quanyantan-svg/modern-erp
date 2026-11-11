// Accounting & Analytics Domain Closure — AA-W6 存货核算深化.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.6
//   AA-W6.1..AA-W6.16
// Design:    docs/design/accounting-analytics.md §31.6 / §31.8 / §31.9 / §31.10
//
// Single responsibility: 核算范围与计价方法选择、暂估入库与暂估差异调整、
// 采购费用归集与分摊、完工成本结转与差异分配、受控成本调整、核算关账异常清单。
//
// Boundaries enforced by this module:
//   - It never writes `accounting_entries` directly. Every posting goes through
//     the canonical `createSystemVoucher` path.
//   - It never writes inventory value by hand. Capitalisation and cost
//     adjustments go through the canonical `allocateValue` primitive, so the
//     authoritative balance, the valuation ledger and the GL stay single-sourced.
//   - A provisional estimate is never rewritten. The difference between the
//     provisional and the final amount is booked as an adjustment.
//   - Every mutation runs in a transaction, re-reads the authoritative state and
//     writes an audit row. Ambiguous costing, unbalanced allocation and
//     non-conserving cost closings fail closed.
//
// Money is always a safe-integer cent amount.

import { HttpError, allow, allowAny, readJson, requiredText, send } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';
import { allocateValue, createSystemVoucher, inventoryAccountRole, systemHealth } from './financial-inventory.js';

export const COSTING_SCOPE_OWNERS = Object.freeze(['ORGANIZATION', 'OWNER', 'NONE']);
export const COSTING_BASIS_TYPES = Object.freeze(['VALUE', 'QUANTITY', 'WEIGHT', 'EQUAL']);
export const VARIANCE_TARGETS = Object.freeze(['SCRAP', 'ABSORBED', 'GOOD_UNIT']);
export const COST_ADJUSTMENT_TYPES = Object.freeze(['REVALUATION', 'VARIANCE', 'GAIN_LOSS_REVERSAL']);
export const PROVISIONAL_STATUSES = Object.freeze(['OPEN', 'CONVERTED', 'ADJUSTED']);

const VIEW_PERMISSIONS = ['INVENTORY_COST_VIEW', 'ACCOUNTING_VIEW'];
const MANAGE_PERMISSIONS = ['INVENTORY_COST_MANAGE'];

function nowIso() {
  return new Date().toISOString();
}

function requiredCents(value, label, { allowNegative = false } = {}) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || (allowNegative ? false : cents < 0)) {
    throw new HttpError(400, `${label}必须是${allowNegative ? '' : '非负'}整数分`, { code: 'COSTING_AMOUNT_INVALID' });
  }
  return cents;
}

function requiredDate(value, label) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new HttpError(400, `${label}格式必须为 YYYY-MM-DD`, { code: 'COSTING_DATE_INVALID' });
  }
  return text;
}

function requiredPeriod(value, label = '会计期间') {
  const period = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new HttpError(400, `${label}格式必须为 YYYY-MM`, { code: 'COSTING_PERIOD_INVALID' });
  }
  return period;
}

function subjectForRole(db, role) {
  const row = db.prepare(
    'SELECT s.id,s.code,s.name FROM account_role_mappings m JOIN accounting_subjects s ON s.id=m.subject_id AND s.active=1 WHERE m.role_code=?',
  ).get(role);
  if (!row) {
    throw new HttpError(409, '缺少会计科目角色映射：' + role, { code: 'ACCOUNTING_ROLE_MAPPING_MISSING' });
  }
  return row;
}

function loadScope(db, scopeId) {
  const scope = db.prepare('SELECT * FROM accounting_scopes WHERE id=?').get(scopeId);
  if (!scope) throw new HttpError(404, '核算范围不存在', { code: 'COSTING_SCOPE_NOT_FOUND' });
  return scope;
}

// ---------------------------------------------------------------------------
// AA-W6.1 / AA-W6.2 核算范围
// ---------------------------------------------------------------------------

export function listAccountingScopes(db, res, actor) {
  allowAny(actor, VIEW_PERMISSIONS);
  const scopes = db.prepare('SELECT * FROM accounting_scopes ORDER BY code').all();
  return send(res, 200, { accountingScopes: scopes });
}

export async function createAccountingScope(db, req, res, actor) {
  allow(actor, MANAGE_PERMISSIONS[0]);
  const body = await readJson(req);
  const code = requiredText(body.code, '核算范围编码', 64);
  const name = requiredText(body.name, '核算范围名称', 128);
  const orgScope = String(body.orgScope || 'ORGANIZATION').trim().toUpperCase();
  const ownerScope = String(body.ownerScope || 'NONE').trim().toUpperCase();
  if (!COSTING_SCOPE_OWNERS.includes(orgScope) || !COSTING_SCOPE_OWNERS.includes(ownerScope)) {
    throw new HttpError(400, '核算范围维度不正确', { code: 'COSTING_SCOPE_INVALID' });
  }
  if (db.prepare('SELECT 1 FROM accounting_scopes WHERE code=?').get(code)) {
    throw new HttpError(409, '核算范围编码已存在', { code: 'COSTING_SCOPE_DUPLICATED' });
  }
  const scopeId = id();
  transaction(db, () => {
    db.prepare('INSERT INTO accounting_scopes(id,code,name,org_scope,owner_scope,status,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(scopeId, code, name, orgScope, ownerScope, 'ACTIVE', nowIso());
    audit(db, actor.id, 'CREATE', 'ACCOUNTING_SCOPE', scopeId, `建立核算范围 ${code}`);
  });
  return send(res, 201, { accountingScope: db.prepare('SELECT * FROM accounting_scopes WHERE id=?').get(scopeId) });
}

// ---------------------------------------------------------------------------
// AA-W6.3 / AA-W6.4 计价方法配置与选择
// ---------------------------------------------------------------------------

export function listCostingProfiles(db, res, actor) {
  allowAny(actor, VIEW_PERMISSIONS);
  const profiles = db.prepare('SELECT * FROM product_costing_profiles ORDER BY priority, id').all();
  return send(res, 200, { costingProfiles: profiles });
}

/**
 * 计价方法选择（AA-W6.3）：属性级 > 类别级 > 默认；同级多条命中取 `priority`
 * 最小者，仍并列 → 409 `COSTING_PROFILE_AMBIGUOUS`。
 *
 * 该选择只**决定**用哪种计价方法，不改写既有追踪策略兼容性校验
 * （`financial-inventory.js::valuationMethod` 的语义保持不变）。
 */
export function resolveCostingProfile(db, { productId, productClass, scopeId, businessDate }) {
  const date = String(businessDate || '').trim();
  const rows = db.prepare(`SELECT * FROM product_costing_profiles
    WHERE status='ACTIVE' AND (product_id=? OR (product_id IS NULL AND product_class=?))
      AND (effective_from IS NULL OR effective_from<=?)
      AND (effective_to IS NULL OR effective_to>=?)`)
    .all(productId || null, productClass || null, date, date);
  const scoped = scopeId ? rows.filter((row) => row.accounting_scope_id === scopeId) : rows;
  const attribute = scoped.filter((row) => row.product_id);
  const klass = scoped.filter((row) => !row.product_id && row.product_class);
  const fallback = scoped.filter((row) => !row.product_id && !row.product_class);
  for (const [level, candidates] of [['ATTRIBUTE', attribute], ['CLASS', klass], ['DEFAULT', fallback]]) {
    if (!candidates.length) continue;
    const best = Math.min(...candidates.map((row) => Number(row.priority ?? 100)));
    const winners = candidates.filter((row) => Number(row.priority ?? 100) === best);
    if (winners.length > 1) {
      throw new HttpError(409, `计价配置在 ${level} 级别不唯一，无法确定计价方法`, { code: 'COSTING_PROFILE_AMBIGUOUS' });
    }
    return { ...winners[0], level };
  }
  return null;
}

export async function createCostingProfile(db, req, res, actor) {
  allow(actor, MANAGE_PERMISSIONS[0]);
  const body = await readJson(req);
  const productId = body.productId ? String(body.productId).trim() : null;
  const productClass = body.productClass ? String(body.productClass).trim() : null;
  // 既无物料也无类别 = 该核算范围内的**默认级**计价配置（优先级最低）。
  if (!productId && !productClass && !body.accountingScopeId) {
    throw new HttpError(400, '计价配置必须指定物料、类别或核算范围', { code: 'COSTING_PROFILE_INVALID' });
  }
  if (productId && !db.prepare('SELECT 1 FROM products WHERE id=?').get(productId)) {
    throw new HttpError(409, '物料不存在', { code: 'COSTING_PROFILE_INVALID' });
  }
  const scopeId = requiredText(body.accountingScopeId, '核算范围', 64);
  loadScope(db, scopeId);
  const valuationMethod = requiredText(body.valuationMethod, '计价方法', 64);
  const priority = Number(body.priority ?? 100);
  if (!Number.isSafeInteger(priority) || priority < 0) {
    throw new HttpError(400, '计价优先级必须是非负整数', { code: 'COSTING_PROFILE_INVALID' });
  }
  const effectiveFrom = body.effectiveFrom ? requiredDate(body.effectiveFrom, '生效起始日') : null;
  const effectiveTo = body.effectiveTo ? requiredDate(body.effectiveTo, '生效结束日') : null;
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    throw new HttpError(400, '生效结束日不得早于生效起始日', { code: 'COSTING_PROFILE_INVALID' });
  }
  // AA-W6.4：已有估值移动的物料不得静默切换计价方法。既有
  // `changeValuationMethod` 的守卫语义保持不变，本域只做前置判定。
  if (productId && valuationMethod !== db.prepare('SELECT valuation_method FROM products WHERE id=?').get(productId)?.valuation_method) {
    const moved = db.prepare("SELECT 1 FROM inventory_valuation_movements WHERE product_id=? AND status='POSTED' LIMIT 1").get(productId);
    if (moved) {
      throw new HttpError(409, '该物料已有估值移动，计价方法不可变更', { code: 'COSTING_METHOD_CHANGE_NOT_ALLOWED' });
    }
  }
  const profileId = id();
  transaction(db, () => {
    db.prepare(`INSERT INTO product_costing_profiles(
        id,product_id,product_class,accounting_scope_id,valuation_method,priority,effective_from,effective_to,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      profileId, productId, productClass, scopeId, valuationMethod, priority, effectiveFrom, effectiveTo, 'ACTIVE', nowIso(),
    );
    audit(db, actor.id, 'CREATE', 'PRODUCT_COSTING_PROFILE', profileId, `建立计价配置 ${valuationMethod}`);
  });
  return send(res, 201, { costingProfile: db.prepare('SELECT * FROM product_costing_profiles WHERE id=?').get(profileId) });
}

// ---------------------------------------------------------------------------
// AA-W6.5 / AA-W6.6 暂估入库与暂估差异调整
// ---------------------------------------------------------------------------

export function listProvisionalReceipts(db, res, actor) {
  allowAny(actor, VIEW_PERMISSIONS);
  const rows = db.prepare('SELECT * FROM provisional_receipts ORDER BY created_at DESC').all();
  return send(res, 200, { provisionalReceipts: rows });
}

export async function createProvisionalReceipt(db, req, res, actor) {
  allow(actor, MANAGE_PERMISSIONS[0]);
  const body = await readJson(req);
  const sourceReceiptId = requiredText(body.sourceReceiptId, '来源入库单', 64);
  if (!db.prepare('SELECT 1 FROM purchase_receipts WHERE id=?').get(sourceReceiptId)) {
    throw new HttpError(409, '来源入库单不存在', { code: 'PROVISIONAL_SOURCE_NOT_FOUND' });
  }
  if (db.prepare('SELECT 1 FROM provisional_receipts WHERE source_receipt_id=?').get(sourceReceiptId)) {
    throw new HttpError(409, '该入库单已登记暂估', { code: 'PROVISIONAL_ALREADY_REGISTERED' });
  }
  const estimateCents = requiredCents(body.estimateCents, '暂估金额');
  const basis = requiredText(body.basis, '暂估依据', 200);
  if (body.scopeId) loadScope(db, String(body.scopeId).trim());
  const receiptNo = String(body.receiptNo || '').trim() || `PV-${Date.now()}`;
  const provisionalId = id();
  transaction(db, () => {
    db.prepare(`INSERT INTO provisional_receipts(id,receipt_no,source_receipt_id,scope_id,estimate_cents,basis,status,converted_at,created_at)
      VALUES(?,?,?,?,?,?,'OPEN',NULL,?)`).run(
      provisionalId, receiptNo, sourceReceiptId, body.scopeId ? String(body.scopeId).trim() : null, estimateCents, basis, nowIso(),
    );
    audit(db, actor.id, 'CREATE', 'PROVISIONAL_RECEIPT', provisionalId, `登记暂估入库单 ${receiptNo}`);
  });
  return send(res, 201, { provisionalReceipt: db.prepare('SELECT * FROM provisional_receipts WHERE id=?').get(provisionalId) });
}

/**
 * 暂估差异调整（AA-W6.6）：差异 = 正式金额 − 暂估金额；差异必须生成调整凭证，
 * **不得**改写 `provisional_receipts.estimate_cents`。
 *
 * 差异方向：正差异（正式大于暂估）借记存货、贷记材料价格差异；负差异反向。
 */
export async function adjustProvisionalReceipt(db, req, res, actor, provisionalId) {
  allow(actor, MANAGE_PERMISSIONS[0]);
  const body = await readJson(req);
  const finalCents = requiredCents(body.finalCents, '正式金额');
  const reason = requiredText(body.reason, '差异原因', 200);
  const receipt = db.prepare('SELECT * FROM provisional_receipts WHERE id=?').get(provisionalId);
  if (!receipt) throw new HttpError(404, '暂估入库单不存在', { code: 'PROVISIONAL_NOT_FOUND' });
  if (receipt.status !== 'OPEN') {
    throw new HttpError(409, '暂估入库单已结转或已调整', { code: 'PROVISIONAL_STATUS_INVALID' });
  }
  const differenceCents = finalCents - Number(receipt.estimate_cents);
  if (differenceCents === 0) {
    throw new HttpError(400, '正式金额与暂估金额一致，无需差异调整', { code: 'PROVISIONAL_DIFFERENCE_ZERO' });
  }
  const source = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(receipt.source_receipt_id);
  const item = source
    ? db.prepare('SELECT * FROM purchase_receipt_items WHERE receipt_id=? ORDER BY id LIMIT 1').get(source.id)
    : null;
  if (!item) throw new HttpError(409, '来源入库单缺少明细', { code: 'PROVISIONAL_SOURCE_INVALID' });
  const adjustmentId = id();
  const businessDate = requiredDate(body.businessDate || nowIso().slice(0, 10), '业务日期');
  transaction(db, () => {
    const inventoryRole = inventoryAccountRole(db, item.product_id);
    const inventory = subjectForRole(db, inventoryRole);
    const variance = subjectForRole(db, 'MATERIAL_PRICE_VARIANCE');
    const amount = Math.abs(differenceCents);
    const entries = differenceCents > 0
      ? [
        { subjectId: inventory.id, direction: 'DEBIT', amountCents: amount, summary: '暂估差异调整' },
        { subjectId: variance.id, direction: 'CREDIT', amountCents: amount, summary: '暂估差异调整' },
      ]
      : [
        { subjectId: inventory.id, direction: 'CREDIT', amountCents: amount, summary: '暂估差异调整' },
        { subjectId: variance.id, direction: 'DEBIT', amountCents: amount, summary: '暂估差异调整' },
      ];
    const voucherId = createSystemVoucher(db, {
      sourceType: 'PROVISIONAL_RECEIPT_ADJUSTMENT',
      sourceId: adjustmentId,
      businessDate,
      actorId: actor.id,
      remark: `暂估差异调整 ${receipt.receipt_no}：${reason}`,
      entries,
    });
    db.prepare(`INSERT INTO provisional_receipt_adjustments(
        id,provisional_receipt_id,final_cents,difference_cents,voucher_id,status,reason,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      adjustmentId, provisionalId, finalCents, differenceCents, voucherId, 'POSTED', reason, actor.id, nowIso(),
    );
    db.prepare("UPDATE provisional_receipts SET status='ADJUSTED', converted_at=? WHERE id=?").run(nowIso(), provisionalId);
    audit(db, actor.id, 'ADJUST', 'PROVISIONAL_RECEIPT', provisionalId, `暂估差异 ${differenceCents} 分，凭证 ${voucherId}`);
  });
  return send(res, 200, {
    adjustment: db.prepare('SELECT * FROM provisional_receipt_adjustments WHERE id=?').get(adjustmentId),
    provisionalReceipt: db.prepare('SELECT * FROM provisional_receipts WHERE id=?').get(provisionalId),
  });
}

// ---------------------------------------------------------------------------
// AA-W6.8 / AA-W6.9 / AA-W6.10 采购费用归集与分摊
// ---------------------------------------------------------------------------

export function listPurchaseExpenses(db, res, actor) {
  allowAny(actor, VIEW_PERMISSIONS);
  const expenses = db.prepare('SELECT * FROM purchase_expenses ORDER BY incurred_date DESC, id').all();
  const allocations = db.prepare('SELECT * FROM purchase_expense_allocations ORDER BY created_at DESC').all();
  return send(res, 200, { purchaseExpenses: expenses, purchaseExpenseAllocations: allocations });
}

export async function createPurchaseExpense(db, req, res, actor) {
  allow(actor, MANAGE_PERMISSIONS[0]);
  const body = await readJson(req);
  const amountCents = requiredCents(body.amountCents, '费用金额');
  if (amountCents === 0) throw new HttpError(400, '费用金额必须大于零', { code: 'PURCHASE_EXPENSE_AMOUNT_INVALID' });
  const incurredDate = requiredDate(body.incurredDate, '发生日期');
  const expenseType = requiredText(body.expenseType, '费用类型', 64);
  const expenseNo = String(body.expenseNo || '').trim() || `PE-${Date.now()}`;
  const expenseId = id();
  transaction(db, () => {
    db.prepare(`INSERT INTO purchase_expenses(id,expense_no,expense_type,amount_cents,incurred_date,supplier_id,status,created_by,created_at)
      VALUES(?,?,?,?,?,?,'REGISTERED',?,?)`).run(
      expenseId, expenseNo, expenseType, amountCents, incurredDate,
      body.supplierId ? String(body.supplierId).trim() : null, actor.id, nowIso(),
    );
    audit(db, actor.id, 'CREATE', 'PURCHASE_EXPENSE', expenseId, `登记采购费用 ${expenseNo} ${amountCents} 分`);
  });
  return send(res, 201, { purchaseExpense: db.prepare('SELECT * FROM purchase_expenses WHERE id=?').get(expenseId) });
}

export function listPurchaseExpenseAllocationRules(db, res, actor) {
  allowAny(actor, VIEW_PERMISSIONS);
  const rules = db.prepare('SELECT * FROM purchase_expense_allocation_rules ORDER BY code').all();
  return send(res, 200, { purchaseExpenseAllocationRules: rules });
}

export async function createPurchaseExpenseAllocationRule(db, req, res, actor) {
  allow(actor, MANAGE_PERMISSIONS[0]);
  const body = await readJson(req);
  const code = requiredText(body.code, '分摊规则编码', 64);
  if (db.prepare('SELECT 1 FROM purchase_expense_allocation_rules WHERE code=?').get(code)) {
    throw new HttpError(409, '分摊规则编码已存在', { code: 'PURCHASE_EXPENSE_RULE_DUPLICATED' });
  }
  const name = requiredText(body.name, '分摊规则名称', 128);
  const basisType = String(body.basisType || '').trim().toUpperCase();
  if (!COSTING_BASIS_TYPES.includes(basisType)) {
    throw new HttpError(400, '分摊基准不正确', { code: 'PURCHASE_EXPENSE_RULE_INVALID' });
  }
  const scope = body.scope;
  if (!scope || typeof scope !== 'object' || !Array.isArray(scope.targets) || scope.targets.length === 0) {
    throw new HttpError(400, '分摊规则必须包含分摊目标', { code: 'PURCHASE_EXPENSE_RULE_INVALID' });
  }
  for (const target of scope.targets) {
    if (!target || typeof target !== 'object') throw new HttpError(400, '分摊目标格式不正确', { code: 'PURCHASE_EXPENSE_RULE_INVALID' });
    if (!target.productId && !target.scopeId) throw new HttpError(400, '分摊目标必须指定物料或核算范围', { code: 'PURCHASE_EXPENSE_RULE_INVALID' });
  }
  const ruleId = id();
  transaction(db, () => {
    db.prepare(`INSERT INTO purchase_expense_allocation_rules(id,code,name,basis_type,scope_json,status,created_at)
      VALUES(?,?,?,?,?,'ACTIVE',?)`).run(ruleId, code, name, basisType, JSON.stringify(scope), nowIso());
    audit(db, actor.id, 'CREATE', 'PURCHASE_EXPENSE_ALLOCATION_RULE', ruleId, `建立分摊规则 ${code}`);
  });
  return send(res, 201, {
    purchaseExpenseAllocationRule: db.prepare('SELECT * FROM purchase_expense_allocation_rules WHERE id=?').get(ruleId),
  });
}

/**
 * 执行采购费用分摊（AA-W6.8..AA-W6.10）。
 *
 * 分摊基数与权重必须**可重算一致**：每个目标的分摊金额由权威事实算出，调用方
 * 不能自带金额；分摊总额必须等于费用总额，否则 409
 * `PURCHASE_EXPENSE_ALLOCATION_NOT_BALANCED`。分摊结果写入权威估值流水
 * （`allocateValue`）并生成凭证，因此费用进入存货价值而不是停在报表口径。
 */
export async function allocatePurchaseExpense(db, req, res, actor, expenseId) {
  allow(actor, MANAGE_PERMISSIONS[0]);
  const body = await readJson(req);
  const expense = db.prepare('SELECT * FROM purchase_expenses WHERE id=?').get(expenseId);
  if (!expense) throw new HttpError(404, '采购费用不存在', { code: 'PURCHASE_EXPENSE_NOT_FOUND' });
  if (expense.status !== 'REGISTERED') {
    throw new HttpError(409, '采购费用已分摊或已关闭', { code: 'PURCHASE_EXPENSE_STATUS_INVALID' });
  }
  const rule = db.prepare('SELECT * FROM purchase_expense_allocation_rules WHERE id=?').get(String(body.ruleId || '').trim());
  if (!rule) throw new HttpError(409, '分摊规则不存在', { code: 'PURCHASE_EXPENSE_RULE_NOT_FOUND' });
  if (rule.status !== 'ACTIVE') throw new HttpError(409, '分摊规则已停用', { code: 'PURCHASE_EXPENSE_RULE_INVALID' });
  const scope = JSON.parse(rule.scope_json);
  const businessDate = requiredDate(body.businessDate || expense.incurred_date, '业务日期');
  const amountCents = Number(expense.amount_cents);

  // 1) 计算每个目标的分摊基数（权威事实）。
  const weights = scope.targets.map((target) => {
    const productId = target.productId || null;
    const scopeId = target.scopeId || null;
    let weight = 1;
    if (rule.basis_type === 'VALUE') {
      const row = productId
        ? db.prepare("SELECT COALESCE(SUM(value_cents),0) n FROM inventory_valuation_balances WHERE product_id=?").get(productId)
        : db.prepare("SELECT COALESCE(SUM(value_cents),0) n FROM inventory_valuation_balances WHERE product_id IN (SELECT id FROM products WHERE category=(SELECT name FROM accounting_scopes WHERE id=?))").get(scopeId);
      weight = Number(row?.n || 0);
    } else if (rule.basis_type === 'QUANTITY') {
      const row = productId
        ? db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM inventory_valuation_balances WHERE product_id=?").get(productId)
        : db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM inventory_valuation_balances WHERE product_id IN (SELECT id FROM products WHERE category=(SELECT name FROM accounting_scopes WHERE id=?))").get(scopeId);
      weight = Number(row?.n || 0);
    } else if (rule.basis_type === 'WEIGHT') {
      weight = Number(target.weight ?? 0);
    } else {
      weight = 1;
    }
    if (!Number.isFinite(weight) || weight < 0) {
      throw new HttpError(409, '分摊基数不可用，无法分摊', { code: 'PURCHASE_EXPENSE_ALLOCATION_BASIS_INVALID' });
    }
    return { productId, scopeId, weight };
  });
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) {
    throw new HttpError(409, '分摊基数合计为零，无法分摊', { code: 'PURCHASE_EXPENSE_ALLOCATION_BASIS_INVALID' });
  }
  // 2) 按基数分摊，最后一笔吸收舍入残差，保证合计精确等于费用总额。
  let allocated = 0;
  const plan = weights.map((item, index) => {
    const share = index === weights.length - 1
      ? amountCents - allocated
      : Math.floor((amountCents * item.weight) / totalWeight);
    allocated += share;
    return { ...item, allocatedCents: share };
  });
  if (plan.some((item) => item.allocatedCents < 0)) {
    throw new HttpError(409, '分摊结果出现负数金额', { code: 'PURCHASE_EXPENSE_ALLOCATION_NOT_BALANCED' });
  }
  if (plan.reduce((sum, item) => sum + item.allocatedCents, 0) !== amountCents) {
    throw new HttpError(409, '分摊总额与费用总额不一致', { code: 'PURCHASE_EXPENSE_ALLOCATION_NOT_BALANCED' });
  }
  // 3) 写入权威估值流水并生成凭证。
  const allocations = [];
  transaction(db, () => {
    const payable = subjectForRole(db, 'ACCOUNTS_PAYABLE');
    const entries = [];
    for (const item of plan) {
      if (item.allocatedCents === 0) continue;
      if (!item.productId) {
        throw new HttpError(409, '按核算范围分摊暂不支持直接入账，请指定物料目标', { code: 'PURCHASE_EXPENSE_ALLOCATION_TARGET_INVALID' });
      }
      const warehouse = db.prepare('SELECT id FROM warehouses WHERE active=1 ORDER BY id LIMIT 1').get();
      if (!warehouse) throw new HttpError(409, '没有可用仓库，无法分摊到存货价值', { code: 'PURCHASE_EXPENSE_ALLOCATION_TARGET_INVALID' });
      allocateValue(db, {
        businessDate,
        productId: item.productId,
        warehouseId: warehouse.id,
        valueDeltaCents: item.allocatedCents,
        movementType: 'PURCHASE_EXPENSE_ALLOCATION',
        sourceType: 'PURCHASE_EXPENSE',
        sourceId: expenseId,
        sourceItemId: item.productId,
      });
      const inventory = subjectForRole(db, inventoryAccountRole(db, item.productId));
      entries.push({ subjectId: inventory.id, direction: 'DEBIT', amountCents: item.allocatedCents, summary: `采购费用分摊 ${expense.expense_no}` });
      const allocationId = id();
      db.prepare(`INSERT INTO purchase_expense_allocations(
          id,expense_id,rule_id,target_product_id,target_scope_id,allocated_cents,voucher_id,status,created_by,created_at)
        VALUES(?,?,?,?,?,?,NULL,'DRAFT',?,?)`).run(
        allocationId, expenseId, rule.id, item.productId, item.scopeId, item.allocatedCents, actor.id, nowIso(),
      );
      allocations.push({ id: allocationId, ...item });
    }
    entries.push({ subjectId: payable.id, direction: 'CREDIT', amountCents: amountCents, summary: `采购费用分摊 ${expense.expense_no}` });
    const voucherId = createSystemVoucher(db, {
      sourceType: 'PURCHASE_EXPENSE_ALLOCATION',
      sourceId: expenseId,
      businessDate,
      actorId: actor.id,
      remark: `采购费用分摊 ${expense.expense_no}`,
      entries,
    });
    for (const allocation of allocations) {
      db.prepare('UPDATE purchase_expense_allocations SET voucher_id=?, status=? WHERE id=?')
        .run(voucherId, 'POSTED', allocation.id);
    }
    db.prepare("UPDATE purchase_expenses SET status='ALLOCATED' WHERE id=?").run(expenseId);
    audit(db, actor.id, 'ALLOCATE', 'PURCHASE_EXPENSE', expenseId, `分摊 ${allocations.length} 笔，凭证 ${voucherId}`);
  });
  return send(res, 201, {
    purchaseExpense: db.prepare('SELECT * FROM purchase_expenses WHERE id=?').get(expenseId),
    allocations: db.prepare('SELECT * FROM purchase_expense_allocations WHERE expense_id=? ORDER BY created_at, id').all(expenseId),
  });
}

// ---------------------------------------------------------------------------
// AA-W6.13 / AA-W6.14 受控成本调整
// ---------------------------------------------------------------------------

export async function createCostAdjustment(db, req, res, actor) {
  allow(actor, MANAGE_PERMISSIONS[0]);
  const body = await readJson(req);
  const adjustmentType = String(body.adjustmentType || '').trim().toUpperCase();
  if (!COST_ADJUSTMENT_TYPES.includes(adjustmentType)) {
    throw new HttpError(400, '成本调整类型不正确', { code: 'COST_ADJUSTMENT_TYPE_INVALID' });
  }
  const amountCents = requiredCents(body.amountCents, '调整金额', { allowNegative: true });
  if (amountCents === 0) throw new HttpError(400, '调整金额不能为零', { code: 'COST_ADJUSTMENT_AMOUNT_INVALID' });
  const reason = requiredText(body.reason, '调整原因', 200);
  const productId = requiredText(body.productId, '物料', 64);
  if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(productId)) {
    throw new HttpError(409, '物料不存在', { code: 'COST_ADJUSTMENT_PRODUCT_NOT_FOUND' });
  }
  if (body.scopeId) loadScope(db, String(body.scopeId).trim());
  const businessDate = requiredDate(body.businessDate || nowIso().slice(0, 10), '业务日期');
  const warehouse = db.prepare('SELECT id FROM warehouses WHERE active=1 ORDER BY id LIMIT 1').get();
  if (!warehouse) throw new HttpError(409, '没有可用仓库，无法调整存货价值', { code: 'COST_ADJUSTMENT_TARGET_INVALID' });
  const adjustmentNo = String(body.adjustmentNo || '').trim() || `CA-${Date.now()}`;
  const adjustmentId = id();
  transaction(db, () => {
    allocateValue(db, {
      businessDate,
      productId,
      warehouseId: warehouse.id,
      valueDeltaCents: amountCents,
      movementType: 'INVENTORY_COST_ADJUSTMENT',
      sourceType: 'COST_ADJUSTMENT',
      sourceId: adjustmentId,
      sourceItemId: productId,
    });
    const inventory = subjectForRole(db, inventoryAccountRole(db, productId));
    const gainLoss = subjectForRole(db, 'INVENTORY_GAIN_LOSS');
    const amount = Math.abs(amountCents);
    const entries = amountCents > 0
      ? [
        { subjectId: inventory.id, direction: 'DEBIT', amountCents: amount, summary: '成本调整' },
        { subjectId: gainLoss.id, direction: 'CREDIT', amountCents: amount, summary: '成本调整' },
      ]
      : [
        { subjectId: inventory.id, direction: 'CREDIT', amountCents: amount, summary: '成本调整' },
        { subjectId: gainLoss.id, direction: 'DEBIT', amountCents: amount, summary: '成本调整' },
      ];
    const voucherId = createSystemVoucher(db, {
      sourceType: 'INVENTORY_COST_ADJUSTMENT',
      sourceId: adjustmentId,
      businessDate,
      actorId: actor.id,
      remark: `成本调整 ${adjustmentNo}：${reason}`,
      entries,
    });
    db.prepare(`INSERT INTO cost_adjustments(
        id,adjustment_no,adjustment_type,product_id,scope_id,amount_cents,reason,voucher_id,status,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,'POSTED',?,?)`).run(
      adjustmentId, adjustmentNo, adjustmentType, productId,
      body.scopeId ? String(body.scopeId).trim() : null, amountCents, reason, voucherId, actor.id, nowIso(),
    );
    audit(db, actor.id, 'ADJUST', 'COST_ADJUSTMENT', adjustmentId, `成本调整 ${amountCents} 分，凭证 ${voucherId}，原因：${reason}`);
  });
  return send(res, 201, { costAdjustment: db.prepare('SELECT * FROM cost_adjustments WHERE id=?').get(adjustmentId) });
}

// ---------------------------------------------------------------------------
// AA-W6.11 / AA-W6.12 完工成本结转与差异分配
// ---------------------------------------------------------------------------

/**
 * 完工成本结转（AA-W6.11 / AA-W6.12）。
 *
 * 不变量：`product_cost_cents + variance_cents == wip_cents`；差异去向必须显式
 * （`SCRAP` / `ABSORBED` / `GOOD_UNIT`）。结转生成凭证，成品成本与 GL 存货科目
 * 因此同源。
 */
export async function createProductionCostClosing(db, req, res, actor) {
  allow(actor, MANAGE_PERMISSIONS[0]);
  const body = await readJson(req);
  const productionOrderId = requiredText(body.productionOrderId, '生产订单', 64);
  const period = requiredPeriod(body.period);
  const wipCents = requiredCents(body.wipCents, '在制品金额');
  const varianceCents = requiredCents(body.varianceCents, '差异金额', { allowNegative: true });
  const varianceTarget = String(body.varianceTarget || '').trim().toUpperCase();
  if (!VARIANCE_TARGETS.includes(varianceTarget)) {
    throw new HttpError(400, '差异去向不正确', { code: 'PRODUCTION_COST_VARIANCE_TARGET_INVALID' });
  }
  const productCostCents = wipCents - varianceCents;
  if (productCostCents < 0) {
    throw new HttpError(409, '结转金额不守恒：成品成本不得为负', { code: 'PRODUCTION_COST_NOT_BALANCED' });
  }
  if (productCostCents + varianceCents !== wipCents) {
    throw new HttpError(409, '结转金额不守恒', { code: 'PRODUCTION_COST_NOT_BALANCED' });
  }
  const existing = db.prepare('SELECT * FROM production_cost_closings WHERE production_order_id=? AND period=?')
    .get(productionOrderId, period);
  if (existing) {
    throw new HttpError(409, '该生产订单在此期间已结转', { code: 'PRODUCTION_COST_ALREADY_CLOSED' });
  }
  const businessDate = requiredDate(body.businessDate || `${period}-01`, '业务日期');
  const closingId = id();
  transaction(db, () => {
    const finished = subjectForRole(db, 'FINISHED_GOODS_INVENTORY');
    const wip = subjectForRole(db, 'WIP');
    const entries = [];
    if (varianceTarget === 'SCRAP' && varianceCents !== 0) {
      const scrap = subjectForRole(db, 'INVENTORY_SCRAP_EXPENSE');
      entries.push({ subjectId: finished.id, direction: 'DEBIT', amountCents: productCostCents, summary: '完工成本结转' });
      entries.push({ subjectId: scrap.id, direction: 'DEBIT', amountCents: Math.abs(varianceCents), summary: '完工成本结转差异' });
    } else if (varianceTarget === 'ABSORBED' && varianceCents !== 0) {
      const absorbed = subjectForRole(db, 'MANUFACTURING_VARIANCE');
      entries.push({ subjectId: finished.id, direction: 'DEBIT', amountCents: productCostCents, summary: '完工成本结转' });
      entries.push({ subjectId: absorbed.id, direction: 'DEBIT', amountCents: Math.abs(varianceCents), summary: '完工成本结转差异' });
    } else {
      entries.push({ subjectId: finished.id, direction: 'DEBIT', amountCents: wipCents, summary: '完工成本结转' });
    }
    entries.push({ subjectId: wip.id, direction: 'CREDIT', amountCents: wipCents, summary: '完工成本结转' });
    const voucherId = createSystemVoucher(db, {
      sourceType: 'PRODUCTION_COST_CLOSING',
      sourceId: closingId,
      businessDate,
      actorId: actor.id,
      remark: `完工成本结转 ${productionOrderId} ${period}`,
      entries,
    });
    db.prepare(`INSERT INTO production_cost_closings(
        id,production_order_id,period,wip_cents,product_cost_cents,variance_cents,variance_target,voucher_id,status,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,'POSTED',?,?)`).run(
      closingId, productionOrderId, period, wipCents, productCostCents, varianceCents, varianceTarget, voucherId, actor.id, nowIso(),
    );
    audit(db, actor.id, 'CLOSE', 'PRODUCTION_COST_CLOSING', closingId, `完工成本结转 ${wipCents} 分，凭证 ${voucherId}`);
  });
  return send(res, 201, { productionCostClosing: db.prepare('SELECT * FROM production_cost_closings WHERE id=?').get(closingId) });
}

// ---------------------------------------------------------------------------
// AA-W6.15 / AA-W6.16 核算关账异常清单
// ---------------------------------------------------------------------------

/**
 * 核算关账异常清单（AA-W6.15 / AA-W6.16）。
 *
 * 五类异常：估值 ↔ GL 差异、未估值历史移动（`LEGACY_UNVALUED`）、负库存 /
 * 残值、暂估未结转、成本调整未过账。既有 `systemHealth` 检查**合并展示**，
 * 不重复实现。
 */
export function getCostingCloseChecklist(db, res, actor, url) {
  allowAny(actor, VIEW_PERMISSIONS);
  const asOfDate = String(url.searchParams.get('asOfDate') || nowIso().slice(0, 10));
  const checks = [];
  const check = (code, severity, message, records) => checks.push({ code, severity, message, records });

  const valuationTotal = Number(db.prepare(
    "SELECT COALESCE(SUM(value_delta_cents),0) n FROM inventory_valuation_movements WHERE status='POSTED' AND business_date<=?",
  ).get(asOfDate).n);
  const glInventory = Number(db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n
       FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id
       JOIN accounting_subjects s ON s.id=e.subject_id
      WHERE v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date)<=?
        AND s.code IN ('1403','1405','1406')`,
  ).get(asOfDate).n);
  check(
    'VALUATION_TO_GL_DIFFERENCE',
    glInventory === valuationTotal ? 'OK' : 'BLOCKING',
    `权威估值 ${valuationTotal} 分与总账存货科目 ${glInventory} 分的差异`,
    glInventory === valuationTotal ? [] : [{ differenceCents: glInventory - valuationTotal }],
  );

  const unvalued = db.prepare(
    "SELECT id, source_type, source_id, business_date FROM inventory_valuation_movements WHERE valuation_basis='LEGACY_UNVALUED' AND status='POSTED' AND business_date<=? LIMIT 50",
  ).all(asOfDate);
  check(
    'LEGACY_UNVALUED',
    unvalued.length ? 'BLOCKING' : 'OK',
    '未估值的历史库存移动',
    unvalued,
  );

  const negative = db.prepare(
    'SELECT balance_key, quantity, value_cents FROM inventory_valuation_balances WHERE quantity < 0 OR (ABS(quantity) < 0.000001 AND value_cents <> 0) LIMIT 50',
  ).all();
  check('NEGATIVE_OR_RESIDUAL_BALANCE', negative.length ? 'BLOCKING' : 'OK', '负库存或零数量残值', negative);

  const provisional = db.prepare("SELECT id, receipt_no, estimate_cents FROM provisional_receipts WHERE status='OPEN' LIMIT 50").all();
  check('PROVISIONAL_NOT_CONVERTED', provisional.length ? 'WARNING' : 'OK', '尚未结转的暂估入库单', provisional);

  const unpostedAdjustments = db.prepare(
    "SELECT id, adjustment_no, amount_cents FROM cost_adjustments WHERE status<>'POSTED' OR voucher_id IS NULL LIMIT 50",
  ).all();
  check('COST_ADJUSTMENT_NOT_POSTED', unpostedAdjustments.length ? 'BLOCKING' : 'OK', '未过账的成本调整', unpostedAdjustments);

  const health = systemHealth(db, { asOfDate });
  return send(res, 200, {
    asOfDate,
    checklist: checks,
    blockingCount: checks.filter((row) => row.severity === 'BLOCKING').length,
    warningCount: checks.filter((row) => row.severity === 'WARNING').length,
    systemHealthChecks: health.checks || [],
  });
}
