// V18 Manufacturing & Quality Domain Closure — Production Scan Execution (Wave G).
//
// Provides scanner-wedge keyboard input lookup + shortcut operations for
// Material and Operation, based on document number / operation code / LOT/SERIAL
// identity tokens.
//
// Bounded contract — does NOT implement full B3105 barcode platform.

import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, optionalText, readJson, send } from '../lib/http.js';

const nonnegative = (value, label) => {
  const quantity = Number(value ?? 0);
  if (!Number.isFinite(quantity) || quantity < 0) throw new HttpError(400, `${label}必须是非负数`);
  return quantity;
};

function matchOrderByToken(db, token) {
  if (!token) return null;
  const trimmed = String(token).trim();
  return db.prepare('SELECT * FROM production_orders WHERE order_no=? OR id=? LIMIT 1').get(trimmed, trimmed);
}

function matchLotSerialToken(db, token) {
  if (!token) return null;
  const trimmed = String(token).trim();
  // The canonical tracking tables carry `lot_code` / `serial_number` and
  // `lifecycle_state`; the earlier lookup read `lot_no` / `serial_no` /
  // `status`, none of which exist, so every IDENTITY scan raised a SQL error.
  const lot = db.prepare('SELECT id, lot_code label, product_id productId, status FROM inventory_lots WHERE lot_code=?').get(trimmed);
  if (lot) return { type: 'LOT', ...lot };
  const serial = db.prepare('SELECT id, serial_number label, product_id productId, lot_id lotId, current_warehouse_id warehouseId, lifecycle_state status FROM inventory_serials WHERE serial_number=?').get(trimmed);
  if (serial) return { type: 'SERIAL', ...serial };
  return null;
}

export async function productionScanLookup(db, req, res, actor) {
  allow(actor, 'PRODUCTION_SCAN_EXECUTE');
  const body = await readJson(req);
  const token = String(body.token || '').trim();
  const kind = String(body.kind || 'ORDER').trim().toUpperCase();
  if (!token) throw new HttpError(400, '请提供扫描 token');
  if (kind === 'ORDER') {
    const order = matchOrderByToken(db, token);
    if (!order) throw new HttpError(404, '未找到匹配的生产工单');
    return send(res, 200, {
      kind: 'ORDER',
      order: {
        id: order.id, orderNo: order.order_no, status: order.status, productId: order.product_id,
        plannedQuantity: Number(order.quantity),
      },
    });
  }
  if (kind === 'MATERIAL') {
    const order = matchOrderByToken(db, body.orderToken);
    if (!order) throw new HttpError(404, '未找到关联生产工单');
    const item = db.prepare('SELECT * FROM production_order_items WHERE order_id=? AND product_id=?').get(order.id, body.productId);
    return send(res, 200, { kind: 'MATERIAL', orderId: order.id, productId: body.productId, requirementLineId: item?.id || null });
  }
  if (kind === 'OPERATION') {
    const order = matchOrderByToken(db, body.orderToken);
    if (!order) throw new HttpError(404, '未找到关联生产工单');
    const op = db.prepare('SELECT * FROM production_order_operations WHERE production_order_id=? AND (operation_code=? OR id=?)').get(order.id, body.operationToken, body.operationToken);
    return send(res, 200, { kind: 'OPERATION', orderId: order.id, operationId: op?.id || null, operationCode: op?.operation_code || body.operationToken });
  }
  if (kind === 'IDENTITY') {
    const identity = matchLotSerialToken(db, token);
    if (!identity) throw new HttpError(404, '未找到匹配的 LOT / SERIAL');
    return send(res, 200, { kind: 'IDENTITY', identity });
  }
  throw new HttpError(400, '扫描类型不正确');
}

export async function productionScanIssue(db, req, res, actor) {
  allow(actor, 'PRODUCTION_SCAN_EXECUTE');
  const body = await readJson(req);
  const order = matchOrderByToken(db, body.orderToken);
  if (!order) throw new HttpError(404, '未找到生产工单');
  if (!['IN_PROGRESS', 'RELEASED'].includes(order.status)) throw new HttpError(409, '只有 RELEASED/IN_PROGRESS 工单允许扫描出库');
  const requirementLineId = String(body.requirementLineId || '').trim();
  const requirement = db.prepare('SELECT * FROM production_order_items WHERE id=? AND order_id=?').get(requirementLineId, order.id);
  if (!requirement) throw new HttpError(400, '需求行无效');
  const warehouseId = String(body.warehouseId || '').trim();
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(warehouseId)) throw new HttpError(400, '请选择有效仓库');
  const identity = body.identity ? matchLotSerialToken(db, body.identity) : null;
  if (body.identity && !identity) throw new HttpError(404, 'LOT / SERIAL token 未找到');
  // A lot carries no warehouse of its own; only a serial does. The product
  // identity is checked for both.
  if (identity && (identity.productId !== requirement.product_id
    || (identity.warehouseId !== undefined && identity.warehouseId !== warehouseId))) {
    throw new HttpError(409, 'LOT / SERIAL 与需求物料或出库仓库不匹配');
  }
  const issueQuantity = nonnegative(body.quantity, '出库数量');
  if (issueQuantity <= 0) throw new HttpError(400, '出库数量必须大于 0');
  const issueId = id();
  const issueNo = 'PMI-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + String(Date.now()).slice(-7) + Math.floor(Math.random() * 90 + 10);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO production_material_issues(id,issue_no,production_order_id,warehouse_id,status,issue_date,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,?, 'DRAFT', ?, ?, ?, ?, ?)`).run(
      issueId, issueNo, order.id, warehouseId, now.slice(0, 10), optionalText(`扫码出库 ${body.identity || ''}`, 500) || '', actor.id, now, now,
    );
    const itemId = id();
    db.prepare('INSERT INTO production_material_issue_items(id,issue_id,requirement_line_id,product_id,planned_quantity,issue_quantity,line_no) VALUES(?,?,?,?,?,?,1)')
      .run(itemId, issueId, requirement.id, requirement.product_id, Number(requirement.quantity), issueQuantity);
    audit(db, actor.id, 'SCAN_ISSUE', 'MATERIAL_ISSUE', issueId, `扫码创建领料 ${issueNo}`);
  });
  return send(res, 201, { id: issueId, issueNo, status: 'DRAFT', identity });
}

export async function productionScanReport(db, req, res, actor) {
  allow(actor, 'PRODUCTION_SCAN_EXECUTE');
  const body = await readJson(req);
  const order = matchOrderByToken(db, body.orderToken);
  if (!order) throw new HttpError(404, '未找到生产工单');
  if (order.status !== 'IN_PROGRESS') throw new HttpError(409, '只有 IN_PROGRESS 工单允许扫码报工');
  const op = db.prepare('SELECT * FROM production_order_operations WHERE production_order_id=? AND (operation_code=? OR id=?)').get(order.id, body.operationToken, body.operationToken);
  if (!op) throw new HttpError(400, '工序无效');
  const goodQuantity = nonnegative(body.goodQuantity, '良品数量');
  const scrapQuantity = nonnegative(body.scrapQuantity, '报废数量');
  const laborSeconds = nonnegative(body.laborSeconds, '人工工时');
  const machineSeconds = nonnegative(body.machineSeconds, '设备工时');
  if (goodQuantity + scrapQuantity <= 0) throw new HttpError(400, '良品数量与报废数量合计必须大于 0');
  const reportId = id();
  const reportNo = 'OR-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 900 + 100);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO production_operation_reports(id,report_no,production_order_id,production_operation_id,business_date,good_quantity,scrap_quantity,labor_seconds,machine_seconds,remark,status,operator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?)`).run(
      reportId, reportNo, order.id, op.id, body.businessDate || now.slice(0, 10),
      goodQuantity, scrapQuantity, laborSeconds, machineSeconds,
      optionalText(`扫码报工 ${body.identity || ''}`, 500) || '',
      actor.id, now, now,
    );
    audit(db, actor.id, 'SCAN_REPORT', 'PRODUCTION_OPERATION_REPORT', reportId, `扫码创建工序报工 ${reportNo}`);
  });
  return send(res, 201, { id: reportId, reportNo, status: 'DRAFT' });
}

// Operation transfer by scan: the source operation hands a quantity to the
// destination operation. The transferred quantity may never exceed the good
// quantity the source operation has released and that has not already been
// consumed downstream. The transfer is recorded as a movement so the audit
// trail can reconstruct where the quantity went.
export async function productionScanTransfer(db, req, res, actor) {
  allow(actor, 'PRODUCTION_SCAN_EXECUTE');
  const body = await readJson(req);
  const order = matchOrderByToken(db, body.orderToken);
  if (!order) throw new HttpError(404, '未找到生产工单');
  if (order.status !== 'IN_PROGRESS') throw new HttpError(409, '只有 IN_PROGRESS 工单允许扫码转移');
  const source = db.prepare('SELECT * FROM production_order_operations WHERE production_order_id=? AND (operation_code=? OR id=?)').get(order.id, body.sourceOperationToken, body.sourceOperationToken);
  if (!source) throw new HttpError(400, '源工序无效');
  const target = db.prepare('SELECT * FROM production_order_operations WHERE production_order_id=? AND (operation_code=? OR id=?)').get(order.id, body.targetOperationToken, body.targetOperationToken);
  if (!target) throw new HttpError(400, '目标工序无效');
  if (source.id === target.id) throw new HttpError(400, '源工序与目标工序不能相同');
  const quantity = nonnegative(body.quantity, '转移数量');
  if (quantity <= 0) throw new HttpError(400, '转移数量必须大于 0');
  const now = new Date().toISOString();
  const transferNo = 'OPT-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 900 + 100);
  transaction(db, () => {
    // The source operation row is locked for the duration of the transfer so
    // two concurrent transfers cannot both read the same untransferred
    // quantity.
    const lockSuffix = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const sourceOperation = db.prepare(`SELECT * FROM production_order_operations WHERE id=?${lockSuffix}`).get(source.id);
    if (sourceOperation.status !== 'COMPLETED') throw new HttpError(409, '源工序尚未完成，不能转移');
    if (Number(sourceOperation.is_outsource || 0) === 1) throw new HttpError(409, '委外工序不能内部转移');
    if (sourceOperation.topology && sourceOperation.topology !== 'LINEAR') {
      throw new HttpError(409, `拓扑 ${sourceOperation.topology} 暂未启用，不能转移`);
    }
    const released = Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN r.status='CONFIRMED' THEN r.released_quantity ELSE 0 END),0)
        - COALESCE((SELECT SUM(good_quantity) FROM production_operation_report_reversals WHERE production_operation_id=?),0) released
      FROM production_operation_reports r WHERE r.production_operation_id=?`).get(sourceOperation.id, sourceOperation.id)?.released || 0);
    const consumed = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM production_operation_transfers WHERE source_operation_id=? AND status='CONFIRMED'")
      .get(sourceOperation.id)?.q || 0);
    if (quantity > released - consumed + 1e-9) {
      throw new HttpError(409, `转移数量超过源工序可转移数量 ${Math.max(0, released - consumed)}`);
    }
    const transferId = id();
    db.prepare(`INSERT INTO production_operation_transfers(id,transfer_no,production_order_id,source_operation_id,target_operation_id,quantity,business_date,status,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'CONFIRMED',?,?,?,?)`).run(
      transferId, transferNo, order.id, sourceOperation.id, target.id, quantity,
      body.businessDate || now.slice(0, 10), optionalText(body.remark, 500) || '', actor.id, now, now,
    );
    audit(db, actor.id, 'SCAN_TRANSFER', 'PRODUCTION_OPERATION_TRANSFER', transferId, `扫码工序转移 ${transferNo}：${sourceOperation.operation_code} → ${target.operation_code} × ${quantity}`);
  });
  return send(res, 201, { ok: true, transferNo, sourceOperationId: source.id, targetOperationId: target.id, quantity });
}
