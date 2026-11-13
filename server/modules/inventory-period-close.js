import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, optionalText, readJson, send } from '../lib/http.js';
import { systemHealth } from './financial-inventory.js';
import { expandApproverRecipients, notifyEvent } from './platform-notifications.js';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INVENTORY_HEALTH_CODES = new Set([
  'INVENTORY_QUANTITY_CACHE_VS_LEDGER', 'TRACKED_DIMENSION_VS_CANONICAL',
  'VALUATION_CACHE_VS_LEDGER', 'INVENTORY_QUANTITY_VS_VALUATION',
  'NEGATIVE_OR_RESIDUAL_VALUATION', 'LEGACY_UNVALUED_MOVEMENTS',
  'GENEALOGY_ACTIVE_REVERSED_CONSISTENCY',
]);

const SOURCE_DATES = Object.freeze({
  PURCHASE_RECEIPT: ['purchase_receipts', 'receipt_date'],
  SALES_DELIVERY: ['sales_deliveries', 'delivery_date'],
  SALES_RETURN: ['return_orders', 'return_date'],
  PURCHASE_RETURN: ['return_orders', 'return_date'],
  INVENTORY_ADJUSTMENT: ['inventory_adjustments', 'adjustment_date'],
  INVENTORY_ADJUSTMENT_REVERSAL: ['inventory_control_reversals', 'business_date'],
  INVENTORY_CHECK: ['inventory_checks', 'business_date'],
  INVENTORY_CHECK_REVERSAL: ['inventory_control_reversals', 'business_date'],
  INVENTORY_TRANSFER: ['inventory_transfers', 'business_date'],
  INVENTORY_SCRAP: ['inventory_scraps', 'scrap_date'],
  PRODUCTION_MATERIAL_ISSUE: ['production_material_issues', 'issue_date'],
  PRODUCTION_MATERIAL_RETURN: ['production_material_returns', 'return_date'],
  PRODUCTION_RECEIPT: ['production_receipts', 'receipt_date'],
  PRODUCTION_RECEIPT_REVERSAL: ['production_receipt_reversals', 'reversal_date'],
  // OUT-23：委外来源接入既有期间关闭读模型（**复用**本表，不另建一套）。
  //
  // 委外的库存腿有五个来源类型，它们的权威业务日期来自委外域的单据：
  //   OUTSOURCING_ISSUE       → outsourcing_issues.issued_date
  //   OUTSOURCING_SUPPLEMENT  → outsourcing_supplements.supplement_date
  //   OUTSOURCING_RETURN      → outsourcing_returns.return_date
  //   OUTSOURCING_BACKFLUSH   → outsourcing_receipts.business_date（倒冲发生于收货生效）
  //   OUTSOURCING_RECEIPT     → outsourcing_receipts.business_date
  //
  // `OPENING_INVENTORY` 有两个权威来源：通用期初单据
  // （`opening_inventory_documents.business_date`）与**期初委外订单**
  // （`outsourcing_orders.opening_business_date`）。因此该条目的权威表是
  // 一个**候选列表**：命中任一候选即视为可追溯。解析顺序不影响结论，
  // 因为两个来源的 `source_id` 空间互不相交。
  OPENING_INVENTORY: [
    ['opening_inventory_documents', 'business_date'],
    ['outsourcing_orders', 'opening_business_date'],
  ],
  OUTSOURCING_ISSUE: ['outsourcing_issues', 'issued_date'],
  OUTSOURCING_SUPPLEMENT: ['outsourcing_supplements', 'supplement_date'],
  OUTSOURCING_RETURN: ['outsourcing_returns', 'return_date'],
  OUTSOURCING_BACKFLUSH: ['outsourcing_receipts', 'business_date'],
  OUTSOURCING_RECEIPT: ['outsourcing_receipts', 'business_date'],
});

// `SOURCE_DATES` 的条目既可能是 `[表, 日期列]`，也可能是 `[[表, 日期列], ...]`
// 的候选列表。归一化成候选列表后，解析逻辑只有一套。
function sourceDateCandidates(spec) {
  return (Array.isArray(spec[0]) ? spec : [spec]);
}

function periodRange(period) {
  if (!PERIOD_RE.test(String(period || ''))) throw new HttpError(400, '期间格式应为 YYYY-MM');
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { startDate: `${period}-01`, endDate: `${period}-${String(lastDay).padStart(2, '0')}` };
}

function nextPeriod(period) {
  const [year, month] = period.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

function result(code, title, severity, failed, count = 0, records = [], resolution = '') {
  return { code, title, severity, status: failed ? 'FAIL' : 'PASS', count: Number(count), records, resolution };
}

function latestClosure(db) {
  return db.prepare('SELECT * FROM inventory_period_closures ORDER BY period_key DESC LIMIT 1').get();
}

function sequenceFailure(db, period) {
  const current = db.prepare('SELECT * FROM inventory_period_closures WHERE period_key=?').get(period);
  const latest = latestClosure(db);
  if (current) {
    if (current.status === 'REOPENED') return null;
    if (current.status === 'CLOSED') return null;
  }
  if (!latest) return null;
  if (latest.status === 'REOPENED') return `期间 ${latest.period_key} 已反结账，必须先重新结账该期间`;
  const expected = nextPeriod(latest.period_key);
  return period === expected ? null : `最近已结期间为 ${latest.period_key}，下一期间必须为 ${expected}`;
}

function pendingDocumentRecords(db, endDate) {
  const specs = [
    ['INVENTORY_TRANSFER', 'inventory_transfers', 'business_date', "status IN ('DRAFT','SUBMITTED','APPROVED')", 'transfer_no'],
    ['INVENTORY_SCRAP', 'inventory_scraps', 'scrap_date', "status='DRAFT'", 'scrap_no'],
    ['INVENTORY_ADJUSTMENT', 'inventory_adjustments', 'adjustment_date', "status='DRAFT'", 'adjustment_no'],
    ['PURCHASE_RECEIPT', 'purchase_receipts', 'receipt_date', "status='DRAFT'", 'receipt_no'],
    ['SALES_DELIVERY', 'sales_deliveries', 'delivery_date', "status='DRAFT'", 'delivery_no'],
    ['RETURN_ORDER', 'return_orders', 'return_date', "status='DRAFT'", 'return_no'],
    ['MATERIAL_ISSUE', 'production_material_issues', 'issue_date', "status='DRAFT'", 'issue_no'],
    ['MATERIAL_RETURN', 'production_material_returns', 'return_date', "status='DRAFT'", 'return_no'],
    ['PRODUCTION_RECEIPT', 'production_receipts', 'receipt_date', "status='DRAFT'", 'receipt_no'],
    ['RECEIPT_REVERSAL', 'production_receipt_reversals', 'reversal_date', "status='DRAFT'", 'reversal_no'],
    // OUT-23：委外来源的未完成单据进入**同一个**未完成单据检查。
    //   - 待检委外收货（`PENDING_INSPECTION`）尚未形成已生效库存事实；
    //   - 未完成委外完工通知尚未产生收货；
    //   - 未审批的加工费 PO 尚未形成权威委外供给。
    // 委外单据未完成之前，委外供给与委外成品库存就无法被证明为定稿。
    ['OUTSOURCING_RECEIPT', 'outsourcing_receipts', 'business_date', "business_status='PENDING_INSPECTION'", 'receipt_no'],
    ['OUTSOURCING_NOTICE', 'receipt_notices', 'notice_date', "business_type='OUTSOURCE' AND status IN ('DRAFT','CONFIRMED')", 'notice_no'],
    ['OUTSOURCING_PROCESSING_PO', 'purchase_orders', 'order_date', "business_type='OUTSOURCE_PROCESSING' AND status IN ('DRAFT','SUBMITTED','APPROVED')", 'order_no'],
  ];
  return specs.flatMap(([type, table, date, predicate, number]) => db.prepare(
    `SELECT id,${number} documentNo,${date} businessDate FROM ${table} WHERE ${predicate} AND (${date} IS NULL OR ${date}='' OR ${date}<=?) ORDER BY ${date},id LIMIT 20`,
  ).all(endDate).map((row) => ({ type, ...row })));
}

// ---------------------------------------------------------------------------
// OUT-23：委外供给接入既有期间关闭读模型
// ---------------------------------------------------------------------------
//
// 期间关闭必须能证明**委外供给**是定稿的。委外供给由两部分构成：
//
//   1. **供应商 WIP 位置**：企业已发料到供应商、尚未耗用或退回的材料。
//      权威口径 = `outsourcing_wip_identity_balances.available_quantity`
//      （**同一本**身份账，§26.34.15.2）。
//   2. **委外成品库存**：已生效委外收货进入企业成品仓。
//      权威口径 = `outsourcing_receipts.business_status='EFFECTED'` 与
//      `inventory` 中对应仓位的数量。
//
// 检查内容（**复用**既有读模型，不另建一套账）：
//   - 委外 WIP 身份余额与供应商 WIP 仓的**物理库存**逐物料行一致；
//     不一致说明身份账与库存账互相矛盾，期间不得关闭。
//   - 存在**未完成委外单据**时（草稿通知 / 待检收货 / 未审批加工费 PO），
//     委外供给无法被证明为定稿 → 阻断。
//
// 严重级别：BLOCKING。委外供给与普通采购/生产的库存口径互不影响 ——
// 本检查只读取委外表与委外位置上的库存，**不**改变普通采购/生产的口径。
const OUTSOURCING_SUPPLY_CHECK_CODE = 'OUTSOURCING_SUPPLY_CONSISTENCY';

function outsourcingSupplyRecords(db, endDate) {
  // 委外物料行 → 供应商 WIP 位置 → 身份余额可用量。
  // 逐物料行比较；不跨物料汇总（不同物料/单位不得合并）。
  const rows = db.prepare(`SELECT oml.id material_list_id, oml.product_id, oml.order_id,
      o.supplier_id, s.supplier_wip_warehouse_id wip_warehouse_id, oml.unit,
      COALESCE((SELECT SUM(available_quantity) FROM outsourcing_wip_identity_balances b
        WHERE b.material_list_id=oml.id),0) identity_available
    FROM outsourcing_material_list oml
    JOIN outsourcing_orders o ON o.id=oml.order_id
    LEFT JOIN suppliers s ON s.id=o.supplier_id
    WHERE o.status<>'CANCELLED'`).all();
  const mismatches = [];
  for (const row of rows) {
    if (!row.wip_warehouse_id) {
      mismatches.push({
        materialListId: row.material_list_id, productId: row.product_id,
        reason: 'SUPPLIER_WIP_WAREHOUSE_UNPROVEN',
      });
      continue;
    }
    const identityAvailable = Number(row.identity_available || 0);
    // 物理库存：供应商 WIP 仓上该物料的**委外来源**数量。
    // 身份账只覆盖委外来源的材料；同一仓上其他来源的库存不参与比较。
    const physicalOutsourcing = Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='OUT' THEN -quantity_change ELSE quantity_change END),0) q
      FROM inventory_transactions
      WHERE warehouse_id=? AND product_id=?
        AND source_type IN ('OUTSOURCING_ISSUE','OUTSOURCING_SUPPLEMENT','OUTSOURCING_RETURN','OUTSOURCING_BACKFLUSH','OPENING_INVENTORY')
        AND business_date<=?`).get(row.wip_warehouse_id, row.product_id, endDate)?.q || 0);
    if (Math.abs(identityAvailable - physicalOutsourcing) > 1e-6) {
      mismatches.push({
        materialListId: row.material_list_id, productId: row.product_id,
        orderId: row.order_id, supplierId: row.supplier_id,
        wipWarehouseId: row.wip_warehouse_id,
        identityAvailable, physicalOutsourcing,
        reason: 'WIP_IDENTITY_VS_PHYSICAL_MISMATCH',
      });
    }
  }
  return mismatches.slice(0, 50);
}

function outsourcingSupplyCheck(db, endDate) {
  const mismatches = outsourcingSupplyRecords(db, endDate);
  return result(
    OUTSOURCING_SUPPLY_CHECK_CODE,
    '委外供给（供应商 WIP 位置与委外成品库存）一致',
    'BLOCKING',
    mismatches.length > 0,
    mismatches.length,
    mismatches,
    '核对委外物料行的 WIP 身份余额与供应商 WIP 仓物理库存，并完成所有未完成的委外单据。',
  );
}

function legacyBusinessDateRecords(db, endDate) {
  const rows = db.prepare(`SELECT id,source_type,source_id,business_date FROM inventory_transactions
    WHERE business_date IS NULL OR business_date='' OR business_date<=? ORDER BY id`).all(endDate);
  const unknown = [];
  for (const row of rows) {
    if (!DATE_RE.test(String(row.business_date || ''))) {
      unknown.push({ id: row.id, sourceType: row.source_type, reason: 'MISSING_OR_INVALID_BUSINESS_DATE' });
      continue;
    }
    const source = SOURCE_DATES[row.source_type];
    if (!source) {
      unknown.push({ id: row.id, sourceType: row.source_type, reason: 'UNREGISTERED_SOURCE_DATE' });
      continue;
    }
    // 权威日期表可能是**候选列表**（例如 `OPENING_INVENTORY` 同时可由通用
    // 期初单据与期初委外订单提供）。命中任一候选且日期一致即视为可追溯；
    // 全部候选都未命中才判为不可追溯。候选之间不会同时命中（source_id
    // 空间互不相交），因此不存在「哪一份更权威」的裁量问题。
    const candidates = sourceDateCandidates(source);
    let matched = false;
    let found = false;
    for (const [table, dateColumn] of candidates) {
      const authoritative = db.prepare(`SELECT ${dateColumn} businessDate FROM ${table} WHERE id=?`).get(row.source_id);
      if (!authoritative) continue;
      found = true;
      if (authoritative.businessDate === row.business_date) { matched = true; break; }
    }
    if (!matched) {
      unknown.push({
        id: row.id, sourceType: row.source_type,
        reason: found ? 'SOURCE_DATE_MISMATCH' : 'SOURCE_NOT_FOUND',
      });
    }
  }
  return unknown.slice(0, 50);
}

export function getInventoryPeriodStatusData(db, today = new Date().toISOString().slice(0, 10)) {
  const latest = latestClosure(db);
  const currentPeriod = today.slice(0, 7);
  const prior = new Date(`${currentPeriod}-01T00:00:00Z`);
  prior.setUTCMonth(prior.getUTCMonth() - 1);
  const lastEndedPeriod = prior.toISOString().slice(0, 7);
  let nextClosablePeriod = latest?.status === 'REOPENED' ? latest.period_key : latest ? nextPeriod(latest.period_key) : lastEndedPeriod;
  if (nextClosablePeriod >= currentPeriod) nextClosablePeriod = null;
  return {
    latestPeriod: latest?.period_key || null,
    latestStatus: latest?.status || null,
    closedThrough: db.prepare("SELECT MAX(period_key) period FROM inventory_period_closures WHERE status='CLOSED'").get().period || null,
    lastEndedPeriod,
    nextClosablePeriod,
    canClose: Boolean(nextClosablePeriod),
    canReopenLatest: latest?.status === 'CLOSED',
  };
}

export function runInventoryCloseChecks(db, period, _actor, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const { startDate, endDate } = periodRange(period);
  const checks = [];
  const ended = endDate < today;
  checks.push(result('PERIOD_ENDED', '自然月已结束', 'BLOCKING', !ended, ended ? 0 : 1, [], '请选择已经结束的自然月。'));
  const sequence = sequenceFailure(db, period);
  checks.push(result('PERIOD_SEQUENCE', '结账期间连续', 'BLOCKING', Boolean(sequence), sequence ? 1 : 0, sequence ? [sequence] : [], '按顺序完成结账；如最近期间已反结账，请先重结。'));

  const negative = db.prepare('SELECT warehouse_id warehouseId,product_id productId,quantity FROM inventory WHERE quantity<0 ORDER BY warehouse_id,product_id LIMIT 50').all();
  checks.push(result('NEGATIVE_INVENTORY', '无负库存', 'BLOCKING', negative.length > 0, negative.length, negative, '先修复负库存并完成复核。'));
  const pending = pendingDocumentRecords(db, endDate);
  checks.push(result('PENDING_INVENTORY_DOCUMENTS', '无截止日前未完成库存单据', 'BLOCKING', pending.length > 0, pending.length, pending, '完成或取消截止日前的库存业务单据。'));
  const stocktakes = db.prepare("SELECT id,check_no documentNo,business_date businessDate,status FROM inventory_checks WHERE status IN ('DRAFT','SUBMITTED') AND (business_date IS NULL OR business_date='' OR business_date<=?) ORDER BY business_date,id LIMIT 50").all(endDate);
  checks.push(result('UNFINISHED_STOCKTAKE', '无未完成盘点', 'BLOCKING', stocktakes.length > 0, stocktakes.length, stocktakes, '先审核或处理截止日前的盘点单。'));

  const legacy = legacyBusinessDateRecords(db, endDate);
  checks.push(result('LEGACY_BUSINESS_DATE_UNKNOWN', '业务日期来源可追溯', 'BLOCKING', legacy.length > 0, legacy.length, legacy, '为遗留流水补充可验证的权威来源日期；系统不会使用创建时间替代。'));

  // OUT-23：委外供给一致性进入**同一个**期间关闭预检查集合。
  // 它只读取委外表与委外位置上的库存，不改变普通采购/生产的口径。
  checks.push(outsourcingSupplyCheck(db, endDate));

  const health = systemHealth(db, { asOfDate: endDate });
  const failedHealth = health.checks.filter((check) => check.severity === 'BLOCKING' && check.status === 'FAIL');
  const inventoryFailures = failedHealth.filter((check) => INVENTORY_HEALTH_CODES.has(check.code));
  const financialFailures = failedHealth.filter((check) => !INVENTORY_HEALTH_CODES.has(check.code));
  checks.push(result('INVENTORY_CONSISTENCY', '数量、价值与追踪身份一致', 'BLOCKING', inventoryFailures.length > 0, inventoryFailures.length, inventoryFailures.map((check) => check.code), '运行存货健康检查并修复数量、价值或 LOT/SERIAL 差异。'));
  checks.push(result('FINANCIAL_SYSTEM_HEALTH', '财务系统健康', 'BLOCKING', financialFailures.length > 0, financialFailures.length, financialFailures.map((check) => check.code), '修复系统健康检查中的财务阻断项。'));

  const inactive = db.prepare(`SELECT DISTINCT t.warehouse_id warehouseId,t.product_id productId
    FROM inventory_transactions t JOIN warehouses w ON w.id=t.warehouse_id JOIN products p ON p.id=t.product_id
    WHERE t.business_date<=? AND (w.active=0 OR p.active=0) ORDER BY t.warehouse_id,t.product_id LIMIT 50`).all(endDate);
  checks.push(result('INACTIVE_OR_LEGACY_REFERENCE', '无停用或遗留主数据引用', 'WARNING', inactive.length > 0, inactive.length, inactive, '确认停用仓库或货品仍应纳入历史快照。'));

  const blocking = checks.filter((check) => check.severity === 'BLOCKING' && check.status === 'FAIL');
  const warnings = checks.filter((check) => check.severity === 'WARNING' && check.status === 'FAIL');
  return {
    period, startDate, endDate,
    overallStatus: blocking.length ? 'BLOCKED' : warnings.length ? 'WARNING' : 'PASS',
    checks,
    summary: { blockingCount: blocking.length, warningCount: warnings.length, passCount: checks.filter((check) => check.status === 'PASS').length },
  };
}

function buildSnapshots(db, period) {
  const { startDate, endDate } = periodRange(period);
  const keys = db.prepare(`SELECT warehouse_id,product_id FROM inventory
    UNION SELECT warehouse_id,product_id FROM inventory_transactions WHERE business_date<=?`).all(endDate);
  return keys.map((key) => {
    const current = Number(db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(key.warehouse_id, key.product_id)?.quantity || 0);
    const after = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN direction='IN' THEN quantity_change ELSE 0 END),0) quantityIn,
      COALESCE(SUM(CASE WHEN direction='OUT' THEN quantity_change ELSE 0 END),0) quantityOut
      FROM inventory_transactions WHERE warehouse_id=? AND product_id=? AND business_date>?`).get(key.warehouse_id, key.product_id, endDate);
    const during = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN direction='IN' THEN quantity_change ELSE 0 END),0) quantityIn,
      COALESCE(SUM(CASE WHEN direction='OUT' THEN quantity_change ELSE 0 END),0) quantityOut
      FROM inventory_transactions WHERE warehouse_id=? AND product_id=? AND business_date BETWEEN ? AND ?`).get(key.warehouse_id, key.product_id, startDate, endDate);
    return {
      id: id(), warehouseId: key.warehouse_id, productId: key.product_id,
      closingQuantity: current - Number(after.quantityIn) + Number(after.quantityOut),
      periodInQuantity: Number(during.quantityIn), periodOutQuantity: Number(during.quantityOut),
    };
  });
}

function writeSnapshots(db, closureId, snapshots) {
  db.prepare('DELETE FROM inventory_period_snapshots WHERE closure_id=?').run(closureId);
  const insert = db.prepare(`INSERT INTO inventory_period_snapshots
    (id,closure_id,warehouse_id,product_id,closing_quantity,period_in_quantity,period_out_quantity)
    VALUES(?,?,?,?,?,?,?)`);
  for (const row of snapshots) insert.run(row.id, closureId, row.warehouseId, row.productId, row.closingQuantity, row.periodInQuantity, row.periodOutQuantity);
}

function blockedError(checks) {
  const periodEnded = checks.checks.find((check) => check.code === 'PERIOD_ENDED' && check.status === 'FAIL');
  const sequence = checks.checks.find((check) => check.code === 'PERIOD_SEQUENCE' && check.status === 'FAIL');
  const consistency = checks.checks.find((check) => check.code === 'INVENTORY_CONSISTENCY' && check.status === 'FAIL');
  const code = periodEnded ? 'PERIOD_NOT_ENDED' : sequence ? 'PERIOD_SEQUENCE_INVALID' : consistency ? 'INVENTORY_CONSISTENCY_ERROR' : 'PRECHECK_BLOCKED';
  return new HttpError(409, '存货结账预检查未通过', { code, checks, resolution: periodEnded?.resolution || sequence?.resolution || '处理全部阻断项后重新运行预检查。' });
}

export function closeInventoryPeriodCommand(db, actor, input, options = {}) {
  const period = String(input.period || input.periodKey || '');
  periodRange(period);
  const notes = optionalText(input.notes || '', 200);
  const now = options.now || new Date().toISOString();
  return transaction(db, () => {
    const checks = runInventoryCloseChecks(db, period, actor, options);
    if (checks.overallStatus === 'BLOCKED') throw blockedError(checks);
    if (checks.overallStatus === 'WARNING' && input.confirmWarnings !== true) {
      throw new HttpError(409, '存在需要确认的预检查警告', { code: 'PRECHECK_WARNING_CONFIRMATION_REQUIRED', checks, resolution: '确认警告后再次提交结账。' });
    }
    let closure = db.prepare('SELECT * FROM inventory_period_closures WHERE period_key=?').get(period);
    const repeated = closure?.status === 'CLOSED';
    const reclosed = closure?.status === 'REOPENED';
    const snapshots = buildSnapshots(db, period);
    if (!closure) {
      closure = { id: id() };
      db.prepare(`INSERT INTO inventory_period_closures(id,period_key,status,closed_by,closed_at,notes,close_checks_json)
        VALUES(?,?,'CLOSED',?,?,?,?)`).run(closure.id, period, actor.id, now, notes, JSON.stringify(checks));
    } else {
      db.prepare(`UPDATE inventory_period_closures SET status='CLOSED',closed_by=?,closed_at=?,notes=?,close_checks_json=? WHERE id=?`)
        .run(actor.id, now, notes, JSON.stringify(checks), closure.id);
    }
    writeSnapshots(db, closure.id, snapshots);
    audit(db, actor.id, repeated ? 'RECLOSE_IDEMPOTENT' : reclosed ? 'RECLOSE_PERIOD' : 'CLOSE_PERIOD', 'INVENTORY_PERIOD_CLOSURE', closure.id, `${period} 存货结账`);
    return { ok: true, id: closure.id, period, status: 'CLOSED', repeated, reclosed, snapshotCount: snapshots.length, checks };
  });
}

export function reopenInventoryPeriodCommand(db, actor, closureId, reason, options = {}) {
  const text = String(reason || '').trim();
  if (!text) throw new HttpError(400, '反结账原因不能为空', { code: 'REOPEN_REASON_REQUIRED', resolution: '填写反结账原因后重试。' });
  if (text.length > 200) throw new HttpError(400, '反结账原因不能超过 200 个字符');
  const now = options.now || new Date().toISOString();
  return transaction(db, () => {
    const closure = db.prepare('SELECT * FROM inventory_period_closures WHERE id=?').get(closureId);
    if (!closure) throw new HttpError(404, '存货月结记录不存在');
    if (closure.status !== 'CLOSED') throw new HttpError(409, '该期间已经反结账', { code: 'PERIOD_NOT_LATEST' });
    const latest = db.prepare("SELECT id,period_key FROM inventory_period_closures WHERE status='CLOSED' ORDER BY period_key DESC LIMIT 1").get();
    if (!latest || latest.id !== closure.id) throw new HttpError(409, '只能反结账最近已结期间', { code: 'PERIOD_NOT_LATEST', resolution: '先逐期反结账较新的期间。' });
    if (db.prepare("SELECT 1 FROM period_closures WHERE period=? AND status='CLOSED'").get(closure.period_key)) {
      throw new HttpError(409, '必须先打开同月会计期间', { code: 'FINANCIAL_PERIOD_CLOSED', resolution: '先执行会计反结账，再执行存货反结账。' });
    }
    db.prepare("UPDATE inventory_period_closures SET status='REOPENED',reopened_by=?,reopened_at=?,reopen_reason=? WHERE id=?")
      .run(actor.id, now, text, closure.id);
    audit(db, actor.id, 'REOPEN_PERIOD', 'INVENTORY_PERIOD_CLOSURE', closure.id, `${closure.period_key} 存货反结账：${text}`);
    return { ok: true, id: closure.id, period: closure.period_key, status: 'REOPENED' };
  });
}

function parseChecks(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}

export function listInventoryPeriodClosures(db, res, actor) {
  allowAny(actor, ['INVENTORY_PERIOD_CLOSE_VIEW', 'INVENTORY_PERIOD_CLOSE_MANAGE']);
  const rows = db.prepare(`SELECT c.*,u.display_name closedByName,r.display_name reopenedByName,
    (SELECT COUNT(*) FROM inventory_period_snapshots s WHERE s.closure_id=c.id) snapshotCount
    FROM inventory_period_closures c JOIN users u ON u.id=c.closed_by LEFT JOIN users r ON r.id=c.reopened_by
    ORDER BY c.period_key DESC LIMIT 100`).all().map((row) => ({ ...row, snapshotCount: Number(row.snapshotCount), closeChecks: parseChecks(row.close_checks_json) }));
  return send(res, 200, { inventoryPeriodClosures: rows, status: getInventoryPeriodStatusData(db) });
}

export function getInventoryPeriodStatus(db, res, actor) {
  allowAny(actor, ['INVENTORY_PERIOD_CLOSE_VIEW', 'INVENTORY_PERIOD_CLOSE_MANAGE']);
  return send(res, 200, { status: getInventoryPeriodStatusData(db) });
}

export async function checkInventoryPeriodClose(db, req, res, actor) {
  allowAny(actor, ['INVENTORY_PERIOD_CLOSE_VIEW', 'INVENTORY_PERIOD_CLOSE_MANAGE']);
  const body = await readJson(req);
  const precheck = runInventoryCloseChecks(db, String(body.period || ''), actor);
  // 通知是副作用：月结阻塞项必须让相关角色知道，但不得影响预检结果。
  const blocking = (precheck?.checks || []).filter((check) => check.severity === 'BLOCKING' && check.status === 'FAIL');
  if (blocking.length) {
    notifyEvent(db, {
      eventType: 'INVENTORY_PERIOD_CLOSE_BLOCKED',
      category: 'INVENTORY_PERIOD_CLOSE',
      recipients: expandApproverRecipients(db, ['INVENTORY_PERIOD_CLOSE_VIEW']).map((value) => ({ type: 'USER', value })),
      title: `库存期间 ${String(body.period || '')} 结账存在阻塞项`,
      content: blocking.map((check) => check.title || check.code).join('；'),
      type: 'WARNING',
      sourceType: 'INVENTORY_PERIOD_CLOSE',
      sourceId: String(body.period || ''),
      dedupeKey: `INVENTORY_PERIOD_CLOSE:${String(body.period || '')}:${blocking.map((check) => check.code).join(',')}`,
    });
  }
  return send(res, 200, { precheck });
}

export async function closeInventoryPeriod(db, req, res, actor) {
  allow(actor, 'INVENTORY_PERIOD_CLOSE_MANAGE');
  const body = await readJson(req);
  return send(res, 200, closeInventoryPeriodCommand(db, actor, body));
}

export async function reopenInventoryPeriod(db, req, res, actor, closureId) {
  allow(actor, 'INVENTORY_PERIOD_CLOSE_MANAGE');
  const body = await readJson(req);
  return send(res, 200, reopenInventoryPeriodCommand(db, actor, closureId, body.reason));
}

export function getInventoryPeriodClosure(db, res, actor, closureId) {
  allowAny(actor, ['INVENTORY_PERIOD_CLOSE_VIEW', 'INVENTORY_PERIOD_CLOSE_MANAGE']);
  const header = db.prepare(`SELECT c.*,u.display_name closedByName,r.display_name reopenedByName
    FROM inventory_period_closures c JOIN users u ON u.id=c.closed_by LEFT JOIN users r ON r.id=c.reopened_by WHERE c.id=?`).get(closureId);
  if (!header) throw new HttpError(404, '存货月结记录不存在');
  const snapshots = db.prepare(`SELECT s.*,w.code warehouseCode,w.name warehouseName,p.code productCode,p.name productName,p.unit productUnit
    FROM inventory_period_snapshots s JOIN warehouses w ON w.id=s.warehouse_id JOIN products p ON p.id=s.product_id
    WHERE s.closure_id=? ORDER BY w.code,p.code`).all(closureId).map((row) => ({ ...row,
      warehouseId: row.warehouse_id, productId: row.product_id, closingQuantity: Number(row.closing_quantity),
      periodInQuantity: Number(row.period_in_quantity), periodOutQuantity: Number(row.period_out_quantity),
    }));
  const audits = db.prepare(`SELECT l.*,u.display_name actorName FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id
    WHERE l.entity_type='INVENTORY_PERIOD_CLOSURE' AND l.entity_id=? ORDER BY l.created_at,l.id`).all(closureId);
  const warehouses = new Set(snapshots.map((row) => row.warehouseId));
  const products = new Set(snapshots.map((row) => row.productId));
  return send(res, 200, { inventoryPeriodClosure: { ...header, periodRange: periodRange(header.period_key), closeChecks: parseChecks(header.close_checks_json), snapshots, audits,
    summary: { warehouseCount: warehouses.size, productCount: products.size,
      totalInQuantity: snapshots.reduce((sum, row) => sum + row.periodInQuantity, 0),
      totalOutQuantity: snapshots.reduce((sum, row) => sum + row.periodOutQuantity, 0) } } });
}
