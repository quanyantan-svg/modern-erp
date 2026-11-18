import { HttpError } from '../lib/http.js';
import { createSystemVoucher, inventoryAccountRole } from './financial-inventory.js';

/**
 * 委外库存异动 → 总账分录的唯一映射处（Requirement §31.22 `PRC-GL-01..13`，
 * Design §26.43）。
 *
 * 这里**只**做「业务事件 → 借贷分录」的映射与投递，不复制任何委外业务规则，
 * 也不复制总账生产逻辑：凭证一律经 Accounting & Analytics 域的 canonical
 * `createSystemVoucher` 生产。
 */

/** 委外发出商品（发出后仍在企业资产内，但已离开自有仓）的对方科目。 */
export const OUTSOURCING_GOODS_IN_TRANSIT_ROLE = 'OTHER_INVENTORY';
/** 委外加工费：倒冲时借记（在制成本），收货时贷记（成品入库），账单过账后归零。 */
export const OUTSOURCING_PROCESSING_FEE_ROLE = 'OUTSOURCING_PROCESSING_FEE';

/**
 * 委外**系统凭证**的来源类型。
 *
 * 这与「库存位移的 source_type」是**两个不同的概念**：后者由成品 Writer 模块独占
 * （M1C-Gate `G04-R1-1` 的静态扫描要求 `'OUTSOURCING_RECEIPT'` 字面量只出现在成品
 * Writer 的函数体内）。凭证的来源类型没有该约束，但它必须能回溯到业务事件，
 * 因此取同名取值并**在此处集中定义**。
 */
export const OUTSOURCING_GL_SOURCE_TYPES = Object.freeze({
  ISSUE: 'OUTSOURCING_ISSUE',
  SUPPLEMENT: 'OUTSOURCING_SUPPLEMENT',
  RETURN: 'OUTSOURCING_RETURN',
  BACKFLUSH: 'OUTSOURCING_BACKFLUSH',
  RECEIPT: 'OUTSOURCING_RECEIPT',
});

const EVENT_KINDS = Object.freeze(['ISSUE', 'SUPPLEMENT', 'RETURN', 'BACKFLUSH', 'RECEIPT']);

/** 委外物料移动的来源类型 → 总账事件种类。 */
const MOVE_KIND_BY_SOURCE_TYPE = Object.freeze({
  OUTSOURCING_ISSUE: 'ISSUE',
  OUTSOURCING_SUPPLEMENT: 'SUPPLEMENT',
  OUTSOURCING_RETURN: 'RETURN',
});

export function outsourcingMoveKind(sourceType) {
  const kind = MOVE_KIND_BY_SOURCE_TYPE[sourceType];
  if (!kind) throw new HttpError(500, `未登记的委外物料移动来源: ${sourceType}`);
  return kind;
}

function assertEventKind(kind) {
  if (!EVENT_KINDS.includes(kind)) throw new HttpError(500, `未登记的委外总账事件: ${kind}`);
  return kind;
}

function assertAmountCents(valueCents) {
  const value = Number(valueCents);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new HttpError(409, '委外总账分录金额必须是正整数分');
  }
  return value;
}

/**
 * 构造一个委外事件的总账分录。
 *
 * `valueCents` 必须是该事件的**权威账面价值**（`issueValue` / `receiveValue` 已算出的
 * 实际价值），不得用标准成本、客户端传入值或估算值替代 —— 这是
 * `PRC-GL-03` 与 `PRC-GL-07` 的核心要求：总账存货角色的净变化必须与估值流水的
 * 净变化逐步相等。
 */
export function buildOutsourcingGlEntries(db, { kind, productId, valueCents, summary = '' }) {
  assertEventKind(kind);
  const value = assertAmountCents(valueCents);
  const goodsInTransit = { role: OUTSOURCING_GOODS_IN_TRANSIT_ROLE };
  const processingFee = { role: OUTSOURCING_PROCESSING_FEE_ROLE };
  const material = { role: inventoryAccountRole(db, productId) };
  const line = (base, direction) => ({ ...base, direction, amountCents: value, summary });
  switch (kind) {
    // 发料 / 补料：物料从自有仓进入委外 WIP 仓。发出商品增加，物料自身存货减少。
    case 'ISSUE':
    case 'SUPPLEMENT':
      return [line(goodsInTransit, 'DEBIT'), line(material, 'CREDIT')];
    // 退料：物料从委外 WIP 仓退回自有仓，方向与发料相反。
    case 'RETURN':
      return [line(material, 'DEBIT'), line(goodsInTransit, 'CREDIT')];
    // 倒冲：材料已消耗，估值池出账且无对位入账 —— 借记过桥科目以镜像该净变化。
    case 'BACKFLUSH':
      return [line(processingFee, 'DEBIT'), line(goodsInTransit, 'CREDIT')];
    // 收货：成品入库（含加工费），贷记过桥科目以镜像该净变化。
    case 'RECEIPT':
      return [line(material, 'DEBIT'), line(processingFee, 'CREDIT')];
    default:
      throw new HttpError(500, `未登记的委外总账事件: ${kind}`);
  }
}

/**
 * 投递一张委外系统凭证。
 *
 * 幂等依据是 `createSystemVoucher` 的 `(voucher_origin='SYSTEM', source_type, source_id)`
 * 唯一性：同一业务事件重复执行命中既有凭证并直接返回，不产生第二张凭证。
 *
 * 必须在既有事务内调用：凭证与库存位移、估值流水必须同生共死。
 */
export function postOutsourcingGlVoucher(db, { sourceType, sourceId, businessDate, actorId, entries, remark = '' }) {
  if (!db?.isTransaction) throw new HttpError(500, '委外总账凭证必须在事务内产生');
  if (!Array.isArray(entries) || !entries.length) return null;
  const total = entries.reduce((sum, entry) => sum + Math.abs(Number(entry.amountCents)), 0);
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  return createSystemVoucher(db, { sourceType, sourceId, businessDate, actorId, entries, remark });
}
