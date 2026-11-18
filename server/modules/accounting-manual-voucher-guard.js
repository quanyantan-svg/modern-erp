import { HttpError } from '../lib/http.js';

/**
 * 自由手工凭证的受控科目守卫。
 *
 * 受控科目由**权威事实**驱动：存货由估值流水驱动，成本与差异由业务单据驱动。
 * 自由手工凭证不得触碰它们，否则总账与子账被静默拆开，`INVENTORY_VALUE_TO_GL` /
 * `COGS_TO_GL` / `WIP_TO_GL` 等 BLOCKING 检查会永远失败且无法归因
 * （Requirement §35.12 `AA-VAL-01`、§35.13 `AA-VAL-05..08`）。
 *
 * 本模块是该守卫的**唯一**实现：创建、改分录、冲销三条手工凭证写路径都调用它，
 * 任何路径都不得内联第二份科目集合（`AA-VAL-08`）。
 */

/** 存货族 + 成本与差异族。集合由角色码表达，**不硬编码科目号**。 */
export const MANUAL_VOUCHER_CONTROLLED_ROLES = Object.freeze([
  // 存货族（§35.12 既有）
  'RAW_MATERIAL_INVENTORY', 'FINISHED_GOODS_INVENTORY', 'OTHER_INVENTORY', 'WIP', 'GRNI',
  // 成本与差异族（§35.13 `AA-VAL-05`）
  'COGS', 'INVENTORY_GAIN_LOSS', 'INVENTORY_SCRAP_EXPENSE', 'MATERIAL_PRICE_VARIANCE',
  'MANUFACTURING_VARIANCE', 'PURCHASE_RETURN_VARIANCE', 'PURCHASE_PRICE_VARIANCE',
  'LABOR_ABSORPTION', 'OVERHEAD_ABSORPTION', 'OUTSOURCING_PROCESSING_FEE',
]);

const GUARD_ERROR_CODE = 'MANUAL_VOUCHER_CANONICAL_SUBJECT';

export function manualVoucherControlledSubjectIds(db) {
  const marks = MANUAL_VOUCHER_CONTROLLED_ROLES.map(() => '?').join(',');
  return new Set(db.prepare(
    `SELECT subject_id FROM account_role_mappings WHERE role_code IN (${marks})`,
  ).all(...MANUAL_VOUCHER_CONTROLLED_ROLES).map((row) => row.subject_id));
}

function subjectIdOf(entry) {
  return entry?.subjectId ?? entry?.subject_id ?? null;
}

function guardError() {
  return new HttpError(409, '手工凭证不得直接调整受控科目（存货 / 成本 / 差异）', {
    code: GUARD_ERROR_CODE,
    resolution: '请通过库存调整单 / 成本调整等业务单据过账；受控科目的更正必须由系统凭证或业务单据产生',
  });
}

/**
 * 校验一组**将要写入**的手工凭证分录。命中受控科目即固定 409，且**零副作用**
 * （调用方必须在写事务之前调用）。
 */
export function assertManualVoucherSubjectsAllowed(db, entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  const controlled = manualVoucherControlledSubjectIds(db);
  if (!entries.some((entry) => controlled.has(subjectIdOf(entry)))) return;
  throw guardError();
}

/**
 * 校验一张**既有**凭证的分录。用于冲销路径：冲销凭证是原凭证分录的镜像，
 * 因此守卫对象是原凭证本身（`AA-VAL-07`）。
 */
export function assertManualVoucherExistingEntriesAllowed(db, voucherId) {
  const controlled = manualVoucherControlledSubjectIds(db);
  const rows = db.prepare('SELECT subject_id FROM accounting_entries WHERE voucher_id=?').all(voucherId);
  if (!rows.some((row) => controlled.has(row.subject_id))) return;
  throw guardError();
}
