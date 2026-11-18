// VMI 结算机制（Requirement §31.24 / Design §26.45）。
//
// 业务所有者 2026-11-18 裁定（`D-P01` = D-2a、`D-P02` = 协议单价）：
//
//   1. **物理模型 = D-2a** —— VMI 消耗是 SUPPLIER 位**单腿**物理 OUT，
//      商业释放量 = 实际消耗量。不存在独立的物权转移物理腿（`M1-F-07` 双扣路径
//      结构性消失）。
//   2. **协议单价是 VMI 的唯一权威成本** —— 收货、消耗、结算账单的金额一律
//      = 协议单价 × 数量；不得回落到估值池单价 / 冻结标准制造成本 / 0。
//   3. **调整容差严格为 0** —— 任何 `|unallocated_adjusted_qty| > 0` 拒绝关期。
//   4. **首期不开放部分结算 / 多账单** —— 一个结算期间只产生一张账单，
//      `settled_qty` 一次性等于该期的 `commercial_released_qty`。
//
// 本模块是结算链的**唯一** canonical owner：七量聚合、五组恒等式断言、期初证据、
// 分配事实。`server/modules/procurement-vmi.js` 只做 HTTP 边界与委派。
//
// 应付与总账**不新建**第二套通道：一律走 Finance Operations 的 canonical 原语
// （`recognizeFinanceExposure` / `applyCreditAdjustment`）与 Accounting 的
// `createSystemVoucher`，以及 canonical `createSupplierBill` / `postSupplierBill`。

import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { listCanonicalInventoryPositions } from '../lib/inventory-compat-read.js';
import { requestFingerprint } from './financial-controls.js';
import { guardPeriodAction } from './period-control.js';

// ---------------------------------------------------------------------------
// 契约常量
// ---------------------------------------------------------------------------

/** 结算行 / 账单行的商业来源字面量（`VMI-SET-11`）。 */
export const VMI_SETTLEMENT_LINE_SOURCE = 'VMI_SETTLEMENT_LINE';

/** 结算期窗口类型（`VMI-SET-06`）。 */
export const VMI_SETTLEMENT_WINDOW_KINDS = Object.freeze(['CALENDAR_MONTH', 'CUSTOM']);

/** 期初证据来源（`VMI-SET-07`）。 */
export const VMI_SETTLEMENT_OPENING_SOURCES = Object.freeze(['PRIOR_CLOSED_PERIOD', 'CANONICAL_INVENTORY_POSITION']);

/**
 * 调整容差（`VMI-SET-09` / `M1-P-04`）：业务所有者 2026-11-18 裁定**严格 0**。
 * 非零容差是业务容忍度政策，必须另行裁定，不得在本实现里自行放宽。
 */
export const VMI_ADJUSTMENT_TOLERANCE_QTY = 0;

/** 数量比较容差（浮点表示误差），**不是**业务调整容差。 */
const QTY_EPSILON = 1e-9;

/** 幂等操作码（`VMI-SET-14`，确定性业务键，不含随机或时间成分）。 */
export const VMI_SETTLEMENT_OPERATIONS = Object.freeze({
  PERIOD_OPEN: 'VMI_SETTLEMENT_PERIOD_OPEN',
  PERIOD_CLOSE: 'VMI_SETTLEMENT_PERIOD_CLOSE',
  BILL_CREATE: 'VMI_SETTLEMENT_BILL_CREATE',
});

// ---------------------------------------------------------------------------
// 错误码（新增；使用前已确认仓库内无同名）
// ---------------------------------------------------------------------------

export const VMI_SETTLEMENT_ERROR_CODES = Object.freeze({
  PRICE_MISSING: 'VMI_AGREEMENT_PRICE_MISSING',
  PERIOD_OVERLAP: 'VMI_SETTLEMENT_PERIOD_OVERLAP',
  OPENING_UNPROVEN: 'VMI_OPENING_BALANCE_UNPROVEN',
  IDENTITY_MISMATCH: 'VMI_SETTLEMENT_IDENTITY_MISMATCH',
  UNALLOCATED_ADJUSTMENT: 'VMI_SETTLEMENT_UNALLOCATED_ADJUSTMENT',
  PARTIAL_NOT_ALLOWED: 'VMI_SETTLEMENT_PARTIAL_NOT_ALLOWED',
  PERIOD_STATE_INVALID: 'VMI_SETTLEMENT_PERIOD_STATE_INVALID',
  BILL_EXISTS: 'VMI_SETTLEMENT_BILL_EXISTS',
  OWNERSHIP_TRANSFER_RETIRED: 'VMI_OWNERSHIP_TRANSFER_RETIRED',
  AGREEMENT_NOT_FOUND: 'VMI_AGREEMENT_NOT_FOUND',
});

// ---------------------------------------------------------------------------
// 协议单价（`VMI-SET-03`）
// ---------------------------------------------------------------------------

/**
 * 协议单价是 VMI 的权威成本。
 *
 * 缺失或非法时**必须** fail closed：不得回落到池单价、标准制造成本或 0。
 * 调用方必须在本函数抛出前**没有**写任何存货 / 应付 / 凭证。
 */
export function assertVmiAgreementPrice(agreement) {
  const price = agreement?.unit_price_cents;
  if (price === null || price === undefined) {
    throw new HttpError(409, 'VMI 协议没有协议单价，无法确定权威金额', {
      code: VMI_SETTLEMENT_ERROR_CODES.PRICE_MISSING,
    });
  }
  const value = Number(price);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(409, 'VMI 协议单价非法，无法确定权威金额', {
      code: VMI_SETTLEMENT_ERROR_CODES.PRICE_MISSING,
    });
  }
  return value;
}

/**
 * 数量 × 协议单价 = 分。数量是数量口径的实数，单价是安全整数分；
 * 结果按四舍五入到整数分，并校验仍是安全整数。
 */
export function settlementAmountCents(unitPriceCents, quantity) {
  const price = Number(unitPriceCents);
  const qty = Number(quantity);
  if (!Number.isSafeInteger(price) || price < 0) {
    throw new HttpError(409, 'VMI 协议单价非法，无法确定权威金额', {
      code: VMI_SETTLEMENT_ERROR_CODES.PRICE_MISSING,
    });
  }
  if (!Number.isFinite(qty)) {
    throw new HttpError(409, 'VMI 结算数量非法');
  }
  const amount = Math.round(price * qty);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new HttpError(409, 'VMI 结算金额超出安全整数范围');
  }
  return amount;
}

// ---------------------------------------------------------------------------
// 读模型：协议与结算期
// ---------------------------------------------------------------------------

export function findVmiAgreement(db, agreementId) {
  return db.prepare('SELECT * FROM vmi_agreements WHERE id=?').get(agreementId) || null;
}

export function findSettlementPeriod(db, periodId) {
  return db.prepare('SELECT * FROM vmi_settlement_periods WHERE id=?').get(periodId) || null;
}

export function listSettlementLines(db, periodId) {
  return db.prepare('SELECT * FROM vmi_settlement_lines WHERE period_id=? ORDER BY product_id, id').all(periodId);
}

function rowToPeriod(row) {
  if (!row) return null;
  return {
    id: row.id,
    agreementId: row.agreement_id,
    supplierId: row.supplier_id,
    periodKey: row.period_key,
    windowKind: row.window_kind,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    openingSource: row.opening_source,
    openingSnapshotAt: row.opening_snapshot_at,
    openingEvidenceHash: row.opening_evidence_hash,
    openingAuditRef: row.opening_audit_ref,
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToLine(row) {
  if (!row) return null;
  return {
    id: row.id,
    periodId: row.period_id,
    productId: row.product_id,
    openingSupplierQty: Number(row.opening_supplier_qty || 0),
    openingEnterpriseQty: Number(row.opening_enterprise_qty || 0),
    receivedQty: Number(row.received_qty || 0),
    supplierConsumedQty: Number(row.supplier_consumed_qty || 0),
    enterpriseConsumedQty: Number(row.enterprise_consumed_qty || 0),
    ownerChangedQty: Number(row.owner_changed_qty || 0),
    returnedQty: Number(row.returned_qty || 0),
    adjustedSupplierQty: Number(row.adjusted_supplier_qty || 0),
    adjustedEnterpriseQty: Number(row.adjusted_enterprise_qty || 0),
    unallocatedAdjustedQty: Number(row.unallocated_adjusted_qty || 0),
    closingSupplierQty: Number(row.closing_supplier_qty || 0),
    closingEnterpriseQty: Number(row.closing_enterprise_qty || 0),
    closingQty: Number(row.closing_qty || 0),
    commercialReleasedQty: Number(row.commercial_released_qty || 0),
    settledQty: Number(row.settled_qty || 0),
    unitPriceCents: row.unit_price_cents === null || row.unit_price_cents === undefined
      ? null : Number(row.unit_price_cents),
    billId: row.bill_id || null,
  };
}

// ---------------------------------------------------------------------------
// 期间窗口（`VMI-SET-06`）
// ---------------------------------------------------------------------------

const OPEN_ENDED_DATE = '9999-12-31';

function normalizeWindowEnd(value) {
  const text = String(value || '').trim();
  return text || OPEN_ENDED_DATE;
}

/**
 * 同一 `agreement_id` 的**全部**期间（`OPEN` 与 `CLOSED` 都参与；不存在
 * `CANCELLED` 期间）的闭区间**不得重叠**：重叠即 409。
 *
 * `UNIQUE(agreement_id, period_key)` 只防同键重放，**不替代**重叠检查。
 * 相邻窗口要求 `next.start > previous.end`。
 */
export function assertNoSettlementPeriodOverlap(db, agreementId, windowStart, windowEnd, excludePeriodId = null) {
  const start = String(windowStart);
  const end = normalizeWindowEnd(windowEnd);
  const rows = db.prepare(`SELECT id, period_key, window_start, window_end FROM vmi_settlement_periods
    WHERE agreement_id=?`).all(agreementId);
  for (const row of rows) {
    if (excludePeriodId && row.id === excludePeriodId) continue;
    const existingStart = String(row.window_start);
    const existingEnd = normalizeWindowEnd(row.window_end);
    if (start <= existingEnd && existingStart <= end) {
      throw new HttpError(409, `结算窗口 ${start}~${end} 与已有期间 ${row.period_key} 重叠`, {
        code: VMI_SETTLEMENT_ERROR_CODES.PERIOD_OVERLAP,
      });
    }
  }
  return true;
}

/** 自然月窗口：`YYYY-MM` → `[YYYY-MM-01, YYYY-MM-末日]`。 */
export function calendarMonthWindow(periodKey) {
  const key = String(periodKey || '').trim();
  if (!/^\d{4}-\d{2}$/.test(key)) {
    throw new HttpError(400, '自然月结算期的期间键必须为 YYYY-MM');
  }
  const [year, month] = key.split('-').map(Number);
  if (month < 1 || month > 12) throw new HttpError(400, '自然月结算期的月份非法');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { windowStart: `${key}-01`, windowEnd: `${key}-${String(lastDay).padStart(2, '0')}` };
}

// ---------------------------------------------------------------------------
// 七量聚合（权威事实来自 vmi_receipts / vmi_consumptions / canonical inventory）
// ---------------------------------------------------------------------------

/**
 * 聚合一个协议 + 货品在一个窗口内的七量。
 *
 * **结算范围**：VMI 结算的对象是 **SUPPLIER 所有权池**。D-2a 下没有独立的
 * 物权转移物理腿，企业池不参与 VMI 结算：`owner_changed_qty` 与
 * `enterprise_consumed_qty` 恒为 0，企业池的期初 / 期末量在结算行上恒为 0。
 * 这与 `VMI-SET-08` 的有效上限一致 —— 释放上限
 * `commercialReleased ≤ ownerChanged + supplierConsumedDirect` 完全是 SUPPLIER 侧的量。
 *
 * 权威来源：
 *  - `received_qty` —— 窗口内经 `VMI_RECEIPT` 确认收货的数量；
 *  - `supplier_consumed_qty` —— 窗口内 SUPPLIER 位直接消耗的数量（D-2a 的单腿 OUT）；
 *  - `commercial_released_qty` —— 商业释放量 = D-2a 的实际消耗量。
 */
export function aggregateSettlementQuantities(db, { agreement, productId, windowStart, windowEnd }) {
  const supplierId = agreement.supplier_id;
  const warehouseId = agreement.warehouse_id;
  const receipts = db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM vmi_receipts
    WHERE supplier_id=? AND warehouse_id=? AND product_id=? AND business_status IN ('CONFIRMED','CONSUMED','TRANSFERRED')
      AND received_date>=? AND received_date<=?`).get(supplierId, warehouseId, productId, windowStart, windowEnd);
  const consumed = db.prepare(`SELECT COALESCE(SUM(c.quantity),0) q FROM vmi_consumptions c
    JOIN vmi_receipts r ON r.id=c.vmi_receipt_id
    WHERE r.supplier_id=? AND r.warehouse_id=? AND r.product_id=? AND c.business_status<>'CANCELLED'
      AND c.consumed_date>=? AND c.consumed_date<=?`).get(supplierId, warehouseId, productId, windowStart, windowEnd);
  const supplierPositions = listCanonicalInventoryPositions(db, {
    productId, warehouseId, ownerType: 'SUPPLIER', ownerId: supplierId, stockStatus: 'AVAILABLE',
  });
  const supplierOnHand = supplierPositions.reduce((total, position) => total + Number(position.quantity || 0), 0);
  return {
    receivedQty: Number(receipts?.q || 0),
    supplierConsumedQty: Number(consumed?.q || 0),
    enterpriseConsumedQty: 0,
    ownerChangedQty: 0,
    returnedQty: 0,
    supplierOnHand,
    enterpriseOnHand: 0,
    commercialReleasedQty: Number(consumed?.q || 0),
  };
}

// ---------------------------------------------------------------------------
// 期初证据（`VMI-SET-07`）
// ---------------------------------------------------------------------------

/**
 * 首期的期初**必须**来自 canonical inventory position 的可审计快照。
 *
 * 快照按 `agreement + supplier + product + warehouse + ownerType` 两个所有权池
 * 在事务内读取；**无法证明即 409 `VMI_OPENING_BALANCE_UNPROVEN`，不得默认为 0**。
 *
 * 「可证明」的判定：canonical 仓位必须能读出该协议下的 SUPPLIER 位。不存在
 * 任何「历史未归属库存」信号（VMI 收货必须绑定协议，历史收货无协议绑定时
 * 该批次不可证明）。
 *
 * **期初的时点口径**：期初是「窗口开始那一刻」的余额，因此快照必须**扣除**
 * 本窗口内已确认收货与已消耗的数量 —— 否则期初会把本期收货算两遍
 * （期初 + received ≠ on-hand），VMI-P 恒等式必然不成立。
 * 扣减量同样来自权威事实（`vmi_receipts` / `vmi_consumptions`），不是估算。
 */
export function resolveOpeningBalances(db, { agreement, productId, snapshotAt, windowStart, windowEnd }) {
  const supplierId = agreement.supplier_id;
  const warehouseId = agreement.warehouse_id;
  const positions = listCanonicalInventoryPositions(db, {
    productId, warehouseId, ownerType: 'SUPPLIER', ownerId: supplierId, stockStatus: 'AVAILABLE',
  });
  if (!positions.length) {
    throw new HttpError(409, '无法从 canonical inventory position 证明 VMI 期初余额', {
      code: VMI_SETTLEMENT_ERROR_CODES.OPENING_UNPROVEN,
    });
  }
  const windowMovement = aggregateSettlementQuantities(db, { agreement, productId, windowStart, windowEnd });
  // 期末在库 − 本期净流入 = 期初在库。
  const supplierQty = windowMovement.supplierOnHand - windowMovement.receivedQty + windowMovement.supplierConsumedQty;
  if (supplierQty < -1e-9) {
    // 当前在库小于本期净流入：期初余额无法证明（例如窗口外的历史收货已被
    // 其它路径消耗）。**不得**默认为 0。
    throw new HttpError(409, '无法从 canonical inventory position 证明 VMI 期初余额', {
      code: VMI_SETTLEMENT_ERROR_CODES.OPENING_UNPROVEN,
    });
  }
  const enterprisePositions = listCanonicalInventoryPositions(db, {
    productId, warehouseId, ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE',
  });
  // 企业池不参与 VMI 结算（见 `aggregateSettlementQuantities` 的范围说明）：
  // D-2a 下企业池的期初恒为 0，因此 VMI-E 的两端都是 0，恒等式严格成立。
  const evidence = {
    snapshotAt,
    supplierPositions: positions.map((position) => ({
      positionKey: position.positionKey, quantity: Number(position.quantity || 0),
    })),
    enterprisePositions: enterprisePositions.map((position) => ({
      positionKey: position.positionKey, quantity: Number(position.quantity || 0),
    })),
    windowNetIn: windowMovement.receivedQty - windowMovement.supplierConsumedQty,
  };
  return {
    openingSupplierQty: Number(supplierQty.toFixed(6)),
    openingEnterpriseQty: 0,
    openingSource: 'CANONICAL_INVENTORY_POSITION',
    evidenceHash: requestFingerprint(evidence),
    evidence,
  };
}

/**
 * 非首期的期初**必须**严格等于紧邻上一已关闭期间的 closing。
 * 存在时间缺口、多个前期或前期未关闭均 fail closed。
 */
export function resolvePriorPeriodOpening(db, { agreementId, windowStart }) {
  const prior = db.prepare(`SELECT * FROM vmi_settlement_periods
    WHERE agreement_id=? AND status='CLOSED' AND window_end<? ORDER BY window_end DESC, id LIMIT 1`).get(agreementId, windowStart);
  if (!prior) {
    throw new HttpError(409, '没有可证明的上一已关闭结算期间，无法确定期初', {
      code: VMI_SETTLEMENT_ERROR_CODES.OPENING_UNPROVEN,
    });
  }
  const lines = listSettlementLines(db, prior.id);
  const closing = lines.map((line) => ({
    productId: line.product_id,
    supplierQty: Number(line.closing_supplier_qty || 0),
    enterpriseQty: Number(line.closing_enterprise_qty || 0),
  }));
  return {
    priorPeriodId: prior.id,
    openingSource: 'PRIOR_CLOSED_PERIOD',
    evidenceHash: requestFingerprint({ priorPeriodId: prior.id, closing }),
    closing,
  };
}

// ---------------------------------------------------------------------------
// 五组恒等式（`VMI-SET-09`）
// ---------------------------------------------------------------------------

function near(a, b) { return Math.abs(Number(a) - Number(b)) <= QTY_EPSILON; }

/**
 * VMI-P / VMI-S / VMI-E / VMI-C / VMI-R 五组恒等式。
 *
 * 符号约定（素材库 `:1544-1551`）：`adjusted_*` 与 `unallocated_adjusted_qty`
 * 是**有符号量**，来源侧在等式**左端**。
 *
 * 断言失败 → 409 `VMI_SETTLEMENT_IDENTITY_MISMATCH`；
 * `|unallocated_adjusted_qty| > 0` → 409 `VMI_SETTLEMENT_UNALLOCATED_ADJUSTMENT`
 * （容差严格 0，正负同等阻断）。
 */
export function assertSettlementIdentities(line) {
  const l = line;
  const supplierOnHand = l.closingSupplierQty;
  const enterpriseOnHand = l.closingEnterpriseQty;
  const failures = [];

  const vmiP = l.openingSupplierQty + l.openingEnterpriseQty + l.receivedQty
    + l.adjustedSupplierQty + l.adjustedEnterpriseQty + l.unallocatedAdjustedQty;
  const vmiPExpected = supplierOnHand + enterpriseOnHand
    + l.supplierConsumedQty + l.enterpriseConsumedQty + l.returnedQty;
  if (!near(vmiP, vmiPExpected)) {
    failures.push({ identity: 'VMI-P', left: vmiP, right: vmiPExpected, difference: vmiP - vmiPExpected });
  }

  const vmiS = l.openingSupplierQty + l.receivedQty + l.adjustedSupplierQty;
  const vmiSExpected = supplierOnHand + l.supplierConsumedQty + l.ownerChangedQty + l.returnedQty;
  if (!near(vmiS, vmiSExpected)) {
    failures.push({ identity: 'VMI-S', left: vmiS, right: vmiSExpected, difference: vmiS - vmiSExpected });
  }

  const vmiE = l.openingEnterpriseQty + l.ownerChangedQty + l.adjustedEnterpriseQty;
  const vmiEExpected = enterpriseOnHand + l.enterpriseConsumedQty;
  if (!near(vmiE, vmiEExpected)) {
    failures.push({ identity: 'VMI-E', left: vmiE, right: vmiEExpected, difference: vmiE - vmiEExpected });
  }

  // VMI-C —— 商业口径与物理解耦。
  if (l.billableQty !== undefined && !near(l.billableQty, l.commercialReleasedQty)) {
    failures.push({ identity: 'VMI-C', left: l.billableQty, right: l.commercialReleasedQty, difference: l.billableQty - l.commercialReleasedQty });
  }
  if (l.settledQty > l.commercialReleasedQty + QTY_EPSILON) {
    failures.push({ identity: 'VMI-C', left: l.settledQty, right: l.commercialReleasedQty, difference: l.settledQty - l.commercialReleasedQty });
  }
  const releaseCeiling = l.ownerChangedQty + l.supplierConsumedQty;
  if (l.commercialReleasedQty > releaseCeiling + QTY_EPSILON) {
    failures.push({ identity: 'VMI-C', left: l.commercialReleasedQty, right: releaseCeiling, difference: l.commercialReleasedQty - releaseCeiling });
  }

  // VMI-R —— 结算行 closing 是纯物理量。
  const closingSupplier = l.openingSupplierQty + l.receivedQty
    - l.supplierConsumedQty - l.ownerChangedQty - l.returnedQty + l.adjustedSupplierQty;
  const closingEnterprise = l.openingEnterpriseQty + l.ownerChangedQty
    - l.enterpriseConsumedQty + l.adjustedEnterpriseQty;
  if (!near(l.closingSupplierQty, closingSupplier)) {
    failures.push({ identity: 'VMI-R', left: l.closingSupplierQty, right: closingSupplier, difference: l.closingSupplierQty - closingSupplier });
  }
  if (!near(l.closingEnterpriseQty, closingEnterprise)) {
    failures.push({ identity: 'VMI-R', left: l.closingEnterpriseQty, right: closingEnterprise, difference: l.closingEnterpriseQty - closingEnterprise });
  }
  if (!near(l.closingQty, l.closingSupplierQty + l.closingEnterpriseQty)) {
    failures.push({ identity: 'VMI-R', left: l.closingQty, right: l.closingSupplierQty + l.closingEnterpriseQty, difference: l.closingQty - (l.closingSupplierQty + l.closingEnterpriseQty) });
  }

  return failures;
}

/**
 * 关期门禁：先查容差，再查恒等式。
 *
 * 顺序有语义：容差失败说明「归属不明的调整量存在」，它**先于**恒等式断言
 * 被独立报告，因为它是业务所有者明确裁定的阻断项（R4-05）。
 */
export function assertSettlementClosable(line) {
  if (Math.abs(Number(line.unallocatedAdjustedQty || 0)) > VMI_ADJUSTMENT_TOLERANCE_QTY) {
    throw new HttpError(409, '存在未归属的调整量，不能关闭结算期', {
      code: VMI_SETTLEMENT_ERROR_CODES.UNALLOCATED_ADJUSTMENT,
      unallocatedAdjustedQty: Number(line.unallocatedAdjustedQty || 0),
    });
  }
  const failures = assertSettlementIdentities(line);
  if (failures.length) {
    throw new HttpError(409, 'VMI 结算恒等式不成立，不能关闭结算期', {
      code: VMI_SETTLEMENT_ERROR_CODES.IDENTITY_MISMATCH,
      failures,
    });
  }
  return true;
}

// ---------------------------------------------------------------------------
// 结算期开启 / 关闭
// ---------------------------------------------------------------------------

function atomic(db, work) { return db.isTransaction ? work() : transaction(db, work); }

/**
 * 开启一个结算期。
 *
 * 步骤（Design §26.45.3）：锁协议 → 检查全部期间窗口重叠 → 期初证据 →
 * 写期间 + 写结算行（七量快照）→ 写审计。
 */
export function openSettlementPeriod(db, input) {
  const { agreementId, periodKey, windowKind, windowStart, windowEnd, actorId, businessDate } = input;
  return atomic(db, () => {
    const agreement = findVmiAgreement(db, agreementId);
    if (!agreement) {
      throw new HttpError(409, 'VMI 协议不存在', { code: VMI_SETTLEMENT_ERROR_CODES.AGREEMENT_NOT_FOUND });
    }
    // 期间守卫：`FINANCE_AP_BILL` = 应付 + 存货 + 法定三轴。
    guardPeriodAction(db, { actionCode: 'FINANCE_AP_BILL', businessDate });
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    db.prepare(`SELECT id FROM vmi_agreements WHERE id=?${lock}`).get(agreementId);

    const kind = String(windowKind || '').trim().toUpperCase();
    if (!VMI_SETTLEMENT_WINDOW_KINDS.includes(kind)) {
      throw new HttpError(400, '结算窗口类型不正确');
    }
    const key = String(periodKey || '').trim();
    if (!key) throw new HttpError(400, '结算期键不能为空');
    let start = String(windowStart || '').trim();
    let end = String(windowEnd || '').trim();
    if (kind === 'CALENDAR_MONTH') {
      const window = calendarMonthWindow(key);
      start = window.windowStart;
      end = window.windowEnd;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      throw new HttpError(400, '结算窗口起止日期格式必须为 YYYY-MM-DD');
    }
    if (start > end) throw new HttpError(400, '结算窗口起始日不得晚于结束日');

    // 重叠检查（全部期间，OPEN + CLOSED 都参与）。
    assertNoSettlementPeriodOverlap(db, agreementId, start, end);

    const existing = db.prepare('SELECT * FROM vmi_settlement_periods WHERE agreement_id=? AND period_key=?').get(agreementId, key);
    if (existing) {
      throw new HttpError(409, `该协议已存在结算期 ${key}`, {
        code: VMI_SETTLEMENT_ERROR_CODES.PERIOD_STATE_INVALID,
      });
    }

    const snapshotAt = new Date().toISOString();
    const id = randomUUID();
    const now = new Date().toISOString();

    // 期初证据：首期取 canonical inventory position 快照；非首期取紧邻上一已关闭期间。
    const priorPeriods = db.prepare(`SELECT COUNT(*) n FROM vmi_settlement_periods WHERE agreement_id=?`).get(agreementId);
    const isFirstPeriod = Number(priorPeriods?.n || 0) === 0;
    let openingSource;
    let openingEvidenceHash;
    let openingAuditRef;
    const prior = isFirstPeriod ? null : resolvePriorPeriodOpening(db, { agreementId, windowStart: start });

    // 结算行只覆盖**本协议**的货品：协议绑定一个货品（supplier+warehouse+product），
    // 因此结算行集合是本协议在窗口内的收货货品 —— 同一供应商的其它货品不属于
    // 本结算期（它们各自有自己的协议与结算期）。
    const productIds = db.prepare(`SELECT DISTINCT product_id FROM vmi_receipts
      WHERE supplier_id=? AND warehouse_id=? AND product_id=? AND business_status IN ('CONFIRMED','CONSUMED','TRANSFERRED')
        AND received_date>=? AND received_date<=? ORDER BY product_id`)
      .all(agreement.supplier_id, agreement.warehouse_id, agreement.product_id, start, end)
      .map((row) => row.product_id);

    const lines = [];
    for (const productId of productIds) {
      let openingSupplierQty = 0;
      let openingEnterpriseQty = 0;
      if (isFirstPeriod) {
        const opening = resolveOpeningBalances(db, { agreement, productId, snapshotAt, windowStart: start, windowEnd: end });
        openingSupplierQty = opening.openingSupplierQty;
        openingEnterpriseQty = opening.openingEnterpriseQty;
        openingSource = opening.openingSource;
        openingEvidenceHash = opening.evidenceHash;
        openingAuditRef = `VMI_SNAPSHOT:${agreementId}:${productId}:${snapshotAt}`;
      } else {
        const matched = prior.closing.find((entry) => entry.productId === productId);
        openingSupplierQty = matched ? matched.supplierQty : 0;
        openingEnterpriseQty = matched ? matched.enterpriseQty : 0;
        openingSource = prior.openingSource;
        openingEvidenceHash = prior.evidenceHash;
        openingAuditRef = `VMI_PRIOR_PERIOD:${prior.priorPeriodId}`;
      }
      const aggregated = aggregateSettlementQuantities(db, { agreement, productId, windowStart: start, windowEnd: end });
      lines.push({
        id: randomUUID(),
        productId,
        openingSupplierQty,
        openingEnterpriseQty,
        ...aggregated,
        unitPriceCents: agreement.unit_price_cents === null || agreement.unit_price_cents === undefined
          ? null : Number(agreement.unit_price_cents),
      });
    }
    if (!lines.length) {
      throw new HttpError(409, '结算窗口内没有 VMI 收货，无法开启结算期', {
        code: VMI_SETTLEMENT_ERROR_CODES.OPENING_UNPROVEN,
      });
    }

    db.prepare(`INSERT INTO vmi_settlement_periods(
        id,agreement_id,supplier_id,period_key,window_kind,window_start,window_end,
        opening_source,opening_snapshot_at,opening_evidence_hash,opening_audit_ref,
        status,opened_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'OPEN',?,?,?)`).run(
      id, agreementId, agreement.supplier_id, key, kind, start, end,
      openingSource || 'CANONICAL_INVENTORY_POSITION', snapshotAt, openingEvidenceHash || '', openingAuditRef || '',
      now, now, now,
    );
    const insertLine = db.prepare(`INSERT INTO vmi_settlement_lines(
        id,period_id,product_id,opening_supplier_qty,opening_enterprise_qty,received_qty,
        supplier_consumed_qty,enterprise_consumed_qty,owner_changed_qty,returned_qty,
        adjusted_supplier_qty,adjusted_enterprise_qty,unallocated_adjusted_qty,
        closing_supplier_qty,closing_enterprise_qty,closing_qty,
        commercial_released_qty,settled_qty,unit_price_cents,bill_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)`);
    for (const line of lines) {
      // 调整量在**开期**恒为 0：期初调整不是普通开期能力，必须单独授权并写
      // 不可变调整证据（素材库 R4-6）。因此这里显式写 0，而不是沿用
      // `undefined` —— `undefined` 会让 closing 计算变成 NaN 并触发 NOT NULL 违约。
      const adjustedSupplierQty = 0;
      const adjustedEnterpriseQty = 0;
      const unallocatedAdjustedQty = 0;
      // 开期时的 closing 是**按公式**的预测值（关期时以权威仓位重算）。
      const closingSupplier = line.openingSupplierQty + line.receivedQty
        - line.supplierConsumedQty - line.ownerChangedQty - line.returnedQty + adjustedSupplierQty;
      const closingEnterprise = line.openingEnterpriseQty + line.ownerChangedQty
        - line.enterpriseConsumedQty + adjustedEnterpriseQty;
      insertLine.run(
        line.id, id, line.productId, line.openingSupplierQty, line.openingEnterpriseQty, line.receivedQty,
        line.supplierConsumedQty, line.enterpriseConsumedQty, line.ownerChangedQty, line.returnedQty,
        adjustedSupplierQty, adjustedEnterpriseQty, unallocatedAdjustedQty,
        closingSupplier, closingEnterprise, closingSupplier + closingEnterprise,
        line.commercialReleasedQty, 0, line.unitPriceCents, now, now,
      );
    }
    audit(db, actorId, 'OPEN', 'VMI_SETTLEMENT_PERIOD', id, JSON.stringify({
      agreementId, periodKey: key, windowKind: kind, windowStart: start, windowEnd: end,
      openingSource: openingSource || 'CANONICAL_INVENTORY_POSITION',
      openingEvidenceHash: openingEvidenceHash || '',
      openingAuditRef: openingAuditRef || '',
      lineCount: lines.length,
    }), { businessDate });
    return rowToPeriod(db.prepare('SELECT * FROM vmi_settlement_periods WHERE id=?').get(id));
  });
}

/**
 * 关闭一个结算期。
 *
 * 步骤：重读权威状态 → 重算七量 → 写回结算行 → 五组恒等式断言 → 写 closing。
 */
export function closeSettlementPeriod(db, input) {
  const { periodId, actorId, businessDate } = input;
  return atomic(db, () => {
    const period = findSettlementPeriod(db, periodId);
    if (!period) throw new HttpError(404, 'VMI 结算期不存在');
    guardPeriodAction(db, { actionCode: 'FINANCE_AP_BILL', businessDate });
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const locked = db.prepare(`SELECT * FROM vmi_settlement_periods WHERE id=?${lock}`).get(periodId);
    if (!locked) throw new HttpError(404, 'VMI 结算期不存在');
    if (locked.status !== 'OPEN') {
      throw new HttpError(409, '只有开启中的结算期可以关闭', {
        code: VMI_SETTLEMENT_ERROR_CODES.PERIOD_STATE_INVALID,
      });
    }
    const agreement = findVmiAgreement(db, locked.agreement_id);
    if (!agreement) {
      throw new HttpError(409, 'VMI 协议不存在', { code: VMI_SETTLEMENT_ERROR_CODES.AGREEMENT_NOT_FOUND });
    }
    const lines = listSettlementLines(db, periodId);
    if (!lines.length) {
      throw new HttpError(409, '结算期没有结算行，不能关闭', {
        code: VMI_SETTLEMENT_ERROR_CODES.PERIOD_STATE_INVALID,
      });
    }
    const now = new Date().toISOString();
    const updateLine = db.prepare(`UPDATE vmi_settlement_lines SET
        received_qty=?,supplier_consumed_qty=?,enterprise_consumed_qty=?,owner_changed_qty=?,returned_qty=?,
        closing_supplier_qty=?,closing_enterprise_qty=?,closing_qty=?,commercial_released_qty=?,
        unit_price_cents=?,updated_at=? WHERE id=?`);
    const summaries = [];
    for (const row of lines) {
      const aggregated = aggregateSettlementQuantities(db, {
        agreement, productId: row.product_id, windowStart: locked.window_start, windowEnd: locked.window_end,
      });
      // 期末在库是**权威事实**：canonical SUPPLIER 仓位在关期时的实际数量。
      // VMI-R 的公式是对账口径，VMI-S / VMI-P 用实际期末量对账 —— 二者必须
      // 同时成立；不一致即 409（不擅自分配、不修正历史）。
      const closingSupplier = aggregated.supplierOnHand;
      const closingEnterprise = aggregated.enterpriseOnHand;
      const candidate = {
        openingSupplierQty: Number(row.opening_supplier_qty),
        openingEnterpriseQty: Number(row.opening_enterprise_qty),
        receivedQty: aggregated.receivedQty,
        supplierConsumedQty: aggregated.supplierConsumedQty,
        enterpriseConsumedQty: aggregated.enterpriseConsumedQty,
        ownerChangedQty: aggregated.ownerChangedQty,
        returnedQty: aggregated.returnedQty,
        adjustedSupplierQty: Number(row.adjusted_supplier_qty),
        adjustedEnterpriseQty: Number(row.adjusted_enterprise_qty),
        unallocatedAdjustedQty: Number(row.unallocated_adjusted_qty),
        closingSupplierQty: closingSupplier,
        closingEnterpriseQty: closingEnterprise,
        closingQty: closingSupplier + closingEnterprise,
        commercialReleasedQty: aggregated.commercialReleasedQty,
        settledQty: Number(row.settled_qty),
        billableQty: aggregated.commercialReleasedQty,
      };
      // 门禁在写入之前：失败则整个事务回滚，结算行与期间状态零变化。
      assertSettlementClosable(candidate);
      updateLine.run(
        aggregated.receivedQty, aggregated.supplierConsumedQty, aggregated.enterpriseConsumedQty,
        aggregated.ownerChangedQty, aggregated.returnedQty,
        closingSupplier, closingEnterprise, closingSupplier + closingEnterprise,
        aggregated.commercialReleasedQty,
        row.unit_price_cents === null || row.unit_price_cents === undefined ? null : Number(row.unit_price_cents),
        now, row.id,
      );
      summaries.push({ productId: row.product_id, commercialReleasedQty: aggregated.commercialReleasedQty });
    }
    db.prepare("UPDATE vmi_settlement_periods SET status='CLOSED',closed_at=?,updated_at=? WHERE id=?")
      .run(now, now, periodId);
    audit(db, actorId, 'CLOSE', 'VMI_SETTLEMENT_PERIOD', periodId, JSON.stringify({
      agreementId: locked.agreement_id, periodKey: locked.period_key,
      windowStart: locked.window_start, windowEnd: locked.window_end, lines: summaries,
    }), { businessDate });
    return rowToPeriod(db.prepare('SELECT * FROM vmi_settlement_periods WHERE id=?').get(periodId));
  });
}

// ---------------------------------------------------------------------------
// 读模型：可结算量（`VMI-SET-15`）
// ---------------------------------------------------------------------------

/**
 * 某供应商 + 货品的**可结算量**。
 *
 * `billableQuantity` = 商业释放量（VMI-SET-08）− 已结算量。
 * 读模型**不暴露**任何结算金额字段（§31.12.6 的既有约束继续有效）。
 */
export function billableQuantityByProduct(db, supplierId) {
  const released = db.prepare(`SELECT r.product_id product_id, COALESCE(SUM(c.quantity),0) q
    FROM vmi_consumptions c JOIN vmi_receipts r ON r.id=c.vmi_receipt_id
    WHERE r.supplier_id=? AND c.business_status<>'CANCELLED' GROUP BY r.product_id`).all(supplierId);
  const settled = db.prepare(`SELECT l.product_id product_id, COALESCE(SUM(l.settled_qty),0) q
    FROM vmi_settlement_lines l JOIN vmi_settlement_periods p ON p.id=l.period_id
    WHERE p.supplier_id=? GROUP BY l.product_id`).all(supplierId);
  const settledMap = new Map(settled.map((row) => [row.product_id, Number(row.q || 0)]));
  return new Map(released.map((row) => {
    const releasedQty = Number(row.q || 0);
    const settledQty = settledMap.get(row.product_id) || 0;
    const billable = Math.max(0, releasedQty - settledQty);
    return [row.product_id, { commercialReleasedQty: releasedQty, settledQty, billableQuantity: billable, billable: billable > 0 }];
  }));
}

export { rowToPeriod, rowToLine };
