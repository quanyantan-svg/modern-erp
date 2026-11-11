// V22 — Finance Operations Wave A.
//
// FO51 / FO52 / FO53 — Operational Business Close.
//
// finance_business_close_state (NEW table #19; stable 3-seeded anchor,
// lock target for RACE-15).
// finance_business_closures (NEW table #20; history rows).
//
// assertFinanceBusinessDateOpen(closeType, businessDate)
//   1. SELECT * FROM finance_business_close_state WHERE close_type=? FOR UPDATE
//   2. assert closed_through_date == '' OR businessDate > closed_through_date
//
// Every dated Finance write MUST declare which close guard applies.

import { HttpError, allow, send, readJson, requiredText, optionalText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';

export const VALID_CLOSE_TYPES = Object.freeze(['AR', 'AP', 'TREASURY']);

export function assertFinanceBusinessDateOpen(db, closeType, businessDate) {
  if (!VALID_CLOSE_TYPES.includes(closeType)) {
    throw new HttpError(400, 'closeType 必须是 AR / AP / TREASURY');
  }
  const lock = db.dialect === 'mysql' && db.isTransaction ? ' FOR UPDATE' : '';
  const row = db.prepare(
    `SELECT closed_through_date FROM finance_business_close_state WHERE close_type=?${lock}`
  ).get(closeType);
  if (!row) throw new HttpError(500, `business-close anchor missing for ${closeType}`);
  const closedThrough = row.closed_through_date || '';
  if (closedThrough && businessDate && businessDate <= closedThrough) {
    throw new HttpError(409, `${closeType} 业务日期 ${businessDate} 已结账至 ${closedThrough}`);
  }
}

export function listBusinessCloseState(db, res, actor) {
  allow(actor, 'FINANCE_CLOSE_VIEW', 'AR_VIEW', 'AP_VIEW');
  const rows = db.prepare(`SELECT * FROM finance_business_close_state ORDER BY close_type`).all();
  return send(res, 200, { state: rows, outsourcingExposure: readOutsourcingCloseExposure(db) });
}

// ---------------------------------------------------------------------------
// OUT-23：委外供给接入财务业务关闭读模型
// ---------------------------------------------------------------------------
//
// 财务业务关闭（AR / AP / TREASURY）回答的问题是「这个业务日期还能不能再写
// 会影响该侧敞口的单据」。委外是**双侧**来源：
//
//   - **AP 侧**：委外加工费通过 canonical 供应商账单产生应付；
//     其过账路径已经调用 `assertFinanceBusinessDateOpen('AP', ...)`。
//   - **存货价值侧**：委外发料 / 补料 / 退料 / 倒冲改变材料价值，
//     加工费金额以「收货生效时确认的消耗材料价值 + 加工费」为基准，
//     因此这些动作在**存货期间关闭**后必须被拒绝 —— 由
//     `assertInventoryPeriodOpen` 负责（canonical 存货期间门禁）。
//
// 本函数**只读**，不建立第二套关闭轴：它把委外侧仍然未结的敞口汇总出来，
// 复用既有 `finance_business_close_state` 锚点，让业务关闭人看到
// 「委外供给是否已经定稿」。它**不**新增 close_type、不改锚点语义。
//
// 口径：
//   - `openProcessingFeeCents` —— 已生效委外收货但尚未过账加工费账单的金额
//     （权威来源：`outsourcing_cost_evidences.processing_fee_basis_cents`
//      减去已过账账单实际金额；口径与 OUT-21 的 `basis_status` 一致）。
//   - `openWipQuantity` —— 供应商 WIP 位置仍持有的材料数量（按物料行）。
//   - `pendingReceiptQuantity` —— 待检委外收货数量（尚未形成已生效库存事实）。
//   - `openingWipQuantity` —— 期初委外 WIP 结余数量（`is_opening=1` 的物料行）。
export function readOutsourcingCloseExposure(db) {
  const apAnchor = db.prepare("SELECT closed_through_date FROM finance_business_close_state WHERE close_type='AP'").get();
  const closedThrough = apAnchor?.closed_through_date || '';
  // 加工费基准金额列：OUT-21 的 canonical 基准列是
  // `processing_fee_basis_cents`（收货生效时确认的金额）。它由
  // `procurement-outsourcing-finance-schema.js` 引入；在该列存在之前，
  // `processing_fee_provisional_cents` 承载同一金额（收货生效时写入的
  // 暂估/基准金额）。本读模型**跟随 canonical 列**，不另立口径。
  const columns = db.prepare('PRAGMA table_info(outsourcing_cost_evidences)').all()
    .map((row) => String(row.name));
  const basisColumn = columns.includes('processing_fee_basis_cents')
    ? 'processing_fee_basis_cents'
    : 'processing_fee_provisional_cents';
  const rows = db.prepare(`SELECT o.id order_id, o.order_no, o.supplier_id, o.status, o.is_opening,
      o.business_date,
      COALESCE((SELECT SUM(oce.${basisColumn}) FROM outsourcing_cost_evidences oce
        JOIN outsourcing_receipts ore ON ore.id=oce.outsourcing_receipt_id
        WHERE ore.order_id=o.id AND ore.business_status='EFFECTED'),0) basis_cents,
      COALESCE((SELECT SUM(oce.processing_fee_actual_cents) FROM outsourcing_cost_evidences oce
        JOIN outsourcing_receipts ore ON ore.id=oce.outsourcing_receipt_id
        WHERE ore.order_id=o.id AND ore.business_status='EFFECTED'),0) posted_cents,
      COALESCE((SELECT SUM(ore.quantity) FROM outsourcing_receipts ore
        WHERE ore.order_id=o.id AND ore.business_status='PENDING_INSPECTION'),0) pending_receipt_quantity
    FROM outsourcing_orders o
    WHERE o.status<>'CANCELLED'`).all();
  const materials = db.prepare(`SELECT oml.order_id, oml.product_id,
      COALESCE((SELECT SUM(b.available_quantity) FROM outsourcing_wip_identity_balances b
        WHERE b.material_list_id=oml.id),0) wip_quantity
    FROM outsourcing_material_list oml`).all();
  const byOrder = new Map();
  for (const row of materials) {
    const current = byOrder.get(row.order_id) || { wipQuantity: 0, openingWipQuantity: 0 };
    current.wipQuantity += Number(row.wip_quantity || 0);
    byOrder.set(row.order_id, current);
  }
  const openingOrders = db.prepare('SELECT id FROM outsourcing_orders WHERE is_opening=1').all().map((row) => row.id);
  const openingByOrder = new Map(openingOrders.map((id) => [id, { wipQuantity: 0, openingWipQuantity: 0 }]));
  for (const [orderId, current] of byOrder) {
    if (openingByOrder.has(orderId)) openingByOrder.get(orderId).wipQuantity = current.wipQuantity;
  }
  const orders = rows.map((row) => {
    const wip = byOrder.get(row.order_id) || { wipQuantity: 0 };
    const openProcessingFeeCents = Number(row.basis_cents || 0) - Number(row.posted_cents || 0);
    return {
      orderId: row.order_id,
      orderNo: row.order_no,
      supplierId: row.supplier_id,
      status: row.status,
      isOpening: Number(row.is_opening || 0) === 1,
      businessDate: row.business_date,
      openProcessingFeeCents,
      pendingReceiptQuantity: Number(row.pending_receipt_quantity || 0),
      supplierWipQuantity: Number(wip.wipQuantity || 0),
      // 已关闭的 AP 业务日期之后仍有未过账加工费 ⇒ 敞口未清零。
      afterApClose: Boolean(closedThrough && row.business_date && row.business_date <= closedThrough && openProcessingFeeCents !== 0),
    };
  });
  return {
    apClosedThrough: closedThrough,
    orders,
    totals: {
      openProcessingFeeCents: orders.reduce((sum, row) => sum + row.openProcessingFeeCents, 0),
      pendingReceiptQuantity: orders.reduce((sum, row) => sum + row.pendingReceiptQuantity, 0),
      supplierWipQuantity: orders.reduce((sum, row) => sum + row.supplierWipQuantity, 0),
      openingWipQuantity: orders.filter((row) => row.isOpening)
        .reduce((sum, row) => sum + row.supplierWipQuantity, 0),
      ordersAfterApCloseWithOpenFee: orders.filter((row) => row.afterApClose).length,
    },
  };
}

export function listBusinessCloseHistory(db, res, actor, closeType) {
  allow(actor, 'FINANCE_CLOSE_VIEW');
  const params = [];
  let sql = `SELECT * FROM finance_business_closures`;
  if (closeType) { sql += ` WHERE close_type=?`; params.push(closeType); }
  sql += ` ORDER BY closed_through_date DESC, status ASC`;
  const rows = db.prepare(sql).all(...params);
  return send(res, 200, { history: rows });
}

export async function closeBusiness(db, req, res, actor, closeType) {
  allow(actor, 'FINANCE_CLOSE_MANAGE');
  if (!VALID_CLOSE_TYPES.includes(closeType)) throw new HttpError(400, 'closeType 非法');
  const body = await readJson(req);
  const closedThroughDate = requiredText(body.closedThroughDate, 'closedThroughDate', 16);
  const now = new Date().toISOString();
  runInTransaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const row = db.prepare(`SELECT closed_through_date FROM finance_business_close_state WHERE close_type=?${lock}`).get(closeType);
    if (!row) throw new HttpError(500, `business-close anchor missing for ${closeType}`);
    if (row.closed_through_date && row.closed_through_date >= closedThroughDate) {
      throw new HttpError(409, `${closeType} 已结账至 ${row.closed_through_date}，不可回退`);
    }
    db.prepare(`UPDATE finance_business_close_state SET closed_through_date=?, updated_at=?, updated_by=? WHERE close_type=?`)
      .run(closedThroughDate, now, actor.id, closeType);
    db.prepare(
      `INSERT INTO finance_business_closures(id, close_type, closed_through_date, status, closed_by, closed_at, created_at)
       VALUES(?,?,?, 'CLOSED', ?, ?, ?)`
    ).run(id(), closeType, closedThroughDate, actor.id, now, now);
    audit(db, actor.id, 'CLOSE_BUSINESS_DATE', `FINANCE_BUSINESS_CLOSE_${closeType}`, closeType, closedThroughDate);
  });
  return send(res, 200, { closeType, closedThroughDate, status: 'CLOSED' });
}

export async function reopenBusiness(db, req, res, actor, closeType) {
  allow(actor, 'FINANCE_CLOSE_MANAGE');
  if (!VALID_CLOSE_TYPES.includes(closeType)) throw new HttpError(400, 'closeType 非法');
  const body = await readJson(req);
  const reopenReason = optionalText(body.reopenReason ?? '', 256);
  const now = new Date().toISOString();
  runInTransaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const row = db.prepare(`SELECT closed_through_date FROM finance_business_close_state WHERE close_type=?${lock}`).get(closeType);
    if (!row || !row.closed_through_date) {
      throw new HttpError(409, `${closeType} 未结账，无需重开`);
    }
    db.prepare(`UPDATE finance_business_close_state SET closed_through_date='', updated_at=?, updated_by=? WHERE close_type=?`)
      .run(now, actor.id, closeType);
    db.prepare(
      `INSERT INTO finance_business_closures(id, close_type, closed_through_date, status, reopened_by, reopened_at, reopen_reason, created_at)
       VALUES(?,?,?, 'REOPENED', ?, ?, ?, ?)`
    ).run(id(), closeType, row.closed_through_date, actor.id, now, reopenReason, now);
    audit(db, actor.id, 'REOPEN_BUSINESS_DATE', `FINANCE_BUSINESS_CLOSE_${closeType}`, closeType, reopenReason);
  });
  return send(res, 200, { closeType, status: 'REOPENED' });
}

function runInTransaction(db, fn) {
  if (db.isTransaction) { fn(); return; }
  return transaction(db, fn);
}
