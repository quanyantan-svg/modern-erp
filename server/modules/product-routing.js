import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, optionalText, readJson, requiredCode, requiredText, send } from '../lib/http.js';

const ROUTING_STATUSES = new Set(['ACTIVE', 'INACTIVE']);

function requireProduct(db, productId) {
  const product = db.prepare('SELECT id, code, name, active FROM products WHERE id=?').get(productId);
  if (!product) throw new HttpError(400, '产品不存在');
  return product;
}

function parseNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new HttpError(400, `${label}必须为非负数`);
  return number;
}

function normalizeOperation(value, index) {
  const sequenceNo = Number(value?.sequenceNo ?? value?.sequence_no);
  if (!Number.isInteger(sequenceNo) || sequenceNo <= 0) {
    throw new HttpError(400, `第 ${index + 1} 道工序的顺序号必须为正整数`);
  }
  return {
    id: value?.id || id(),
    sequenceNo,
    operationCode: requiredCode(value?.operationCode ?? value?.operation_code, `第 ${index + 1} 道工序编码`),
    operationName: requiredText(value?.operationName ?? value?.operation_name, `第 ${index + 1} 道工序名称`, 100),
    workCenter: optionalText(value?.workCenter ?? value?.work_center, 100),
    setupMinutes: parseNonNegative(value?.setupMinutes ?? value?.setup_minutes, `第 ${index + 1} 道工序准备时间`),
    runMinutesPerUnit: parseNonNegative(value?.runMinutesPerUnit ?? value?.run_minutes_per_unit, `第 ${index + 1} 道工序单位工时`),
    notes: optionalText(value?.notes, 500),
  };
}

function normalizeOperations(values) {
  if (!Array.isArray(values)) throw new HttpError(400, '工序明细格式不正确');
  const operations = values.map(normalizeOperation);
  const sequences = new Set();
  for (const operation of operations) {
    if (sequences.has(operation.sequenceNo)) throw new HttpError(409, `工序顺序号 ${operation.sequenceNo} 重复`);
    sequences.add(operation.sequenceNo);
  }
  return operations.sort((a, b) => a.sequenceNo - b.sequenceNo);
}

function normalizeHeader(db, body, current = null) {
  const productId = body.productId ?? body.product_id ?? current?.product_id;
  requireProduct(db, productId);
  const status = String(body.status ?? current?.status ?? 'INACTIVE').toUpperCase();
  if (!ROUTING_STATUSES.has(status)) throw new HttpError(400, '路线状态不正确');
  return {
    productId,
    routingCode: requiredCode(body.routingCode ?? body.routing_code ?? current?.routing_code, '路线编码'),
    routingName: requiredText(body.routingName ?? body.routing_name ?? current?.routing_name, '路线名称', 100),
    version: requiredText(body.version ?? current?.version, '版本', 50),
    status,
    notes: optionalText(body.notes ?? current?.notes, 1000),
  };
}

function ensureOnlyActive(db, productId, excludeId = null) {
  const current = excludeId
    ? db.prepare("SELECT id, routing_code FROM product_routings WHERE product_id=? AND status='ACTIVE' AND id<>?").get(productId, excludeId)
    : db.prepare("SELECT id, routing_code FROM product_routings WHERE product_id=? AND status='ACTIVE'").get(productId);
  if (current) throw new HttpError(409, `该产品已有启用路线 ${current.routing_code}`);
}

function insertOperations(db, routingId, operations, now) {
  const insert = db.prepare(`
    INSERT INTO product_routing_operations(
      id,routing_id,sequence_no,operation_code,operation_name,work_center,
      setup_minutes,run_minutes_per_unit,notes,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (const operation of operations) {
    insert.run(
      operation.id, routingId, operation.sequenceNo, operation.operationCode,
      operation.operationName, operation.workCenter, operation.setupMinutes,
      operation.runMinutesPerUnit, operation.notes, now, now,
    );
  }
}

function loadRouting(db, routingId) {
  const routing = db.prepare(`
    SELECT r.*, p.code AS product_code, p.name AS product_name, p.unit AS product_unit
    FROM product_routings r
    JOIN products p ON p.id=r.product_id
    WHERE r.id=?
  `).get(routingId);
  if (!routing) throw new HttpError(404, '制品工序标准不存在');
  routing.operations = db.prepare(`
    SELECT * FROM product_routing_operations WHERE routing_id=? ORDER BY sequence_no, id
  `).all(routingId);
  return routing;
}

export function listProductRoutings(db, res, actor, url) {
  allowAny(actor, ['ROUTING_VIEW', 'ROUTING_MANAGE']);
  const search = `%${String(url.searchParams.get('search') || '').trim()}%`;
  const productId = url.searchParams.get('product_id') || '';
  const status = String(url.searchParams.get('status') || '').toUpperCase();
  if (status && !ROUTING_STATUSES.has(status)) throw new HttpError(400, '路线状态筛选不正确');
  const routings = db.prepare(`
    SELECT r.*, p.code AS product_code, p.name AS product_name,
      COUNT(o.id) AS operation_count
    FROM product_routings r
    JOIN products p ON p.id=r.product_id
    LEFT JOIN product_routing_operations o ON o.routing_id=r.id
    WHERE (r.routing_code LIKE ? OR r.routing_name LIKE ? OR p.code LIKE ? OR p.name LIKE ?)
      AND (?='' OR r.product_id=?)
      AND (?='' OR r.status=?)
    GROUP BY r.id
    ORDER BY p.code, CASE r.status WHEN 'ACTIVE' THEN 0 ELSE 1 END, r.version, r.routing_code
  `).all(search, search, search, search, productId, productId, status, status);
  return send(res, 200, { routings });
}

export function getProductRouting(db, res, actor, routingId) {
  allowAny(actor, ['ROUTING_VIEW', 'ROUTING_MANAGE']);
  return send(res, 200, { routing: loadRouting(db, routingId) });
}

export async function createProductRouting(db, req, res, actor) {
  allow(actor, 'ROUTING_MANAGE');
  const body = await readJson(req);
  const header = normalizeHeader(db, body);
  const operations = normalizeOperations(body.operations || []);
  if (header.status === 'ACTIVE') ensureOnlyActive(db, header.productId);
  const routingId = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`
      INSERT INTO product_routings(id,product_id,routing_code,routing_name,version,status,notes,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(routingId, header.productId, header.routingCode, header.routingName, header.version, header.status, header.notes, now, now);
    insertOperations(db, routingId, operations, now);
    audit(db, actor.id, 'CREATE', 'PRODUCT_ROUTING', routingId, `${header.routingCode} · ${operations.length} 道工序`);
  });
  return send(res, 201, { id: routingId });
}

export async function updateProductRouting(db, req, res, actor, routingId) {
  allow(actor, 'ROUTING_MANAGE');
  const current = loadRouting(db, routingId);
  const body = await readJson(req);
  const header = normalizeHeader(db, body, current);
  const operations = body.operations === undefined ? null : normalizeOperations(body.operations);
  if (header.status === 'ACTIVE') ensureOnlyActive(db, header.productId, routingId);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`UPDATE product_routings SET product_id=?,routing_code=?,routing_name=?,version=?,status=?,notes=?,updated_at=? WHERE id=?`)
      .run(header.productId, header.routingCode, header.routingName, header.version, header.status, header.notes, now, routingId);
    if (operations) {
      db.prepare('DELETE FROM product_routing_operations WHERE routing_id=?').run(routingId);
      insertOperations(db, routingId, operations, now);
    }
    audit(db, actor.id, 'UPDATE', 'PRODUCT_ROUTING', routingId, header.routingCode);
  });
  return send(res, 200, { ok: true });
}

export async function changeProductRoutingStatus(db, req, res, actor, routingId, action) {
  allow(actor, 'ROUTING_MANAGE');
  const routing = loadRouting(db, routingId);
  const status = action === 'activate' ? 'ACTIVE' : action === 'deactivate' ? 'INACTIVE' : null;
  if (!status) throw new HttpError(400, '不支持的路线状态操作');
  if (status === routing.status) return send(res, 200, { ok: true, status });
  if (status === 'ACTIVE') ensureOnlyActive(db, routing.product_id, routingId);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE product_routings SET status=?,updated_at=? WHERE id=?').run(status, now, routingId);
    audit(db, actor.id, status === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE', 'PRODUCT_ROUTING', routingId, routing.routing_code);
  });
  return send(res, 200, { ok: true, status });
}

export async function createProductRoutingOperation(db, req, res, actor, routingId) {
  allow(actor, 'ROUTING_MANAGE');
  const routing = loadRouting(db, routingId);
  const operation = normalizeOperation(await readJson(req), 0);
  if (routing.operations.some((item) => item.sequence_no === operation.sequenceNo)) {
    throw new HttpError(409, `工序顺序号 ${operation.sequenceNo} 重复`);
  }
  const now = new Date().toISOString();
  transaction(db, () => {
    insertOperations(db, routingId, [operation], now);
    db.prepare('UPDATE product_routings SET updated_at=? WHERE id=?').run(now, routingId);
    audit(db, actor.id, 'CREATE_OPERATION', 'PRODUCT_ROUTING', routingId, `${operation.sequenceNo} ${operation.operationName}`);
  });
  return send(res, 201, { id: operation.id });
}

export async function updateProductRoutingOperation(db, req, res, actor, routingId, operationId) {
  allow(actor, 'ROUTING_MANAGE');
  loadRouting(db, routingId);
  const current = db.prepare('SELECT * FROM product_routing_operations WHERE id=? AND routing_id=?').get(operationId, routingId);
  if (!current) throw new HttpError(404, '工序不存在');
  const body = await readJson(req);
  const operation = normalizeOperation({ ...current, ...body, id: operationId }, 0);
  const duplicate = db.prepare('SELECT id FROM product_routing_operations WHERE routing_id=? AND sequence_no=? AND id<>?').get(routingId, operation.sequenceNo, operationId);
  if (duplicate) throw new HttpError(409, `工序顺序号 ${operation.sequenceNo} 重复`);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`UPDATE product_routing_operations SET sequence_no=?,operation_code=?,operation_name=?,work_center=?,setup_minutes=?,run_minutes_per_unit=?,notes=?,updated_at=? WHERE id=? AND routing_id=?`)
      .run(operation.sequenceNo, operation.operationCode, operation.operationName, operation.workCenter, operation.setupMinutes, operation.runMinutesPerUnit, operation.notes, now, operationId, routingId);
    db.prepare('UPDATE product_routings SET updated_at=? WHERE id=?').run(now, routingId);
    audit(db, actor.id, 'UPDATE_OPERATION', 'PRODUCT_ROUTING', routingId, `${operation.sequenceNo} ${operation.operationName}`);
  });
  return send(res, 200, { ok: true });
}

export function deleteProductRoutingOperation(db, res, actor, routingId, operationId) {
  allow(actor, 'ROUTING_MANAGE');
  loadRouting(db, routingId);
  const operation = db.prepare('SELECT * FROM product_routing_operations WHERE id=? AND routing_id=?').get(operationId, routingId);
  if (!operation) throw new HttpError(404, '工序不存在');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('DELETE FROM product_routing_operations WHERE id=? AND routing_id=?').run(operationId, routingId);
    db.prepare('UPDATE product_routings SET updated_at=? WHERE id=?').run(now, routingId);
    audit(db, actor.id, 'DELETE_OPERATION', 'PRODUCT_ROUTING', routingId, `${operation.sequence_no} ${operation.operation_name}`);
  });
  return send(res, 200, { ok: true });
}
