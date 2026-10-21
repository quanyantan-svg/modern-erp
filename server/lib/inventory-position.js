// Inventory canonical position identity (Wave A — Domain 5 Closure).
//
// The single authoritative physical-stock identity is a deterministic
// `position_key` derived from a normalised tuple of dimensions:
//
//   product_id / warehouse_id / bin_id / owner_type / owner_id /
//   stock_status / lot_id / serial_id
//
// Rules (frozen by `solution.md §27.2 / §27.3 / §27.4`):
//   - 64-char lowercase hex SHA-256.
//   - SQLite: stored as TEXT NOT NULL UNIQUE.
//   - MySQL:  stored as CHAR(64) NOT NULL UNIQUE. Never TEXT UNIQUE.
//   - nullable dimensions encoded with sentinel `'NULL'` (NOT 'NULL' may
//     collide with a literal id; here we lowercase ASCII and forbid '|'
//     inside any id component).
//   - pipe character '|' is forbidden inside any id component and is
//     rejected loudly at compute time.
//
// Owner validation (frozen by `solution.md §27.10`):
//   ENTERPRISE → owner_id MUST be NULL.
//   SUPPLIER   → owner_id MUST reference an active supplier.
//   CUSTOMER   → owner_id MUST reference an active customer.

import { createHash } from 'node:crypto';
import { HttpError } from './http.js';

export const OWNER_TYPES = Object.freeze({
  ENTERPRISE: 'ENTERPRISE',
  SUPPLIER: 'SUPPLIER',
  CUSTOMER: 'CUSTOMER',
});

const NULL_TOKEN = 'NULL';
const PIPE = '|';
export const POSITION_EVIDENCE_SCHEMA_VERSION = 1;
const POSITION_SNAPSHOT_KEYS = Object.freeze([
  'schemaVersion', 'productId', 'warehouseId', 'binId', 'ownerType',
  'ownerId', 'stockStatus', 'lotId', 'serialId', 'positionKey',
]);

function normalizeIdComponent(value, label) {
  if (value === null || value === undefined) return NULL_TOKEN;
  const text = String(value).trim();
  if (text.length === 0) return NULL_TOKEN;
  if (text.length > 128) {
    throw new HttpError(400, `${label} 长度不可超过 128 字符`);
  }
  if (text.includes(PIPE)) {
    throw new HttpError(400, `${label} 不得包含 '|'`);
  }
  return text.toLowerCase();
}

export function normalizeOwnerType(ownerType) {
  const text = String(ownerType ?? '').trim().toUpperCase();
  if (!OWNER_TYPES[text]) {
    throw new HttpError(400, `owner_type 必须为 ENTERPRISE / SUPPLIER / CUSTOMER`);
  }
  return text;
}

export function validateOwner(db, ownerType, ownerId) {
  const ot = normalizeOwnerType(ownerType);
  if (ot === OWNER_TYPES.ENTERPRISE) {
    if (ownerId !== null && ownerId !== undefined && String(ownerId).trim() !== '') {
      throw new HttpError(400, 'ENTERPRISE owner 的 owner_id 必须为 NULL');
    }
    return { ownerType: ot, ownerId: null };
  }
  if (ownerId === null || ownerId === undefined || String(ownerId).trim() === '') {
    throw new HttpError(400, `${ot} owner 必须提供 owner_id`);
  }
  const idText = String(ownerId).trim();
  if (ot === OWNER_TYPES.SUPPLIER) {
    const row = db.prepare('SELECT id FROM suppliers WHERE id=? AND active=1').get(idText);
    if (!row) throw new HttpError(400, `供应商不存在或未启用：${idText}`);
  } else if (ot === OWNER_TYPES.CUSTOMER) {
    const row = db.prepare('SELECT id FROM customers WHERE id=? AND active=1').get(idText);
    if (!row) throw new HttpError(400, `客户不存在或未启用：${idText}`);
  }
  return { ownerType: ot, ownerId: idText };
}

export function validateStockStatus(db, stockStatus, { allowInsert = false } = {}) {
  const code = String(stockStatus ?? '').trim().toUpperCase();
  if (!code) throw new HttpError(400, 'stock_status 必填');
  const row = db.prepare('SELECT code, reservable, issuable, shippable, transferable, active FROM inventory_stock_statuses WHERE code=?').get(code);
  if (row) {
    if (!row.active && !allowInsert) throw new HttpError(400, `stock_status ${code} 已停用`);
    return row;
  }
  if (!allowInsert) throw new HttpError(400, `stock_status ${code} 未注册`);
  // allowInsert — caller is responsible for inserting it; return provisional flags.
  return { code, reservable: 0, issuable: 0, shippable: 0, transferable: 0, active: 1 };
}

export function validateBin(db, warehouseId, binId) {
  if (binId === null || binId === undefined || String(binId).trim() === '') return null;
  const id = String(binId).trim();
  const row = db.prepare('SELECT id, warehouse_id, active FROM warehouse_bins WHERE id=?').get(id);
  if (!row) throw new HttpError(400, `仓位 ${id} 不存在`);
  if (row.warehouse_id !== warehouseId) throw new HttpError(400, `仓位 ${id} 不属于仓库 ${warehouseId}`);
  if (!row.active) throw new HttpError(400, `仓位 ${id} 已停用`);
  return id;
}

export function warehouseAllowsBin(db, warehouseId) {
  const row = db.prepare('SELECT bin_enabled FROM warehouses WHERE id=?').get(warehouseId);
  if (!row) throw new HttpError(400, `仓库 ${warehouseId} 不存在`);
  return Number(row.bin_enabled) === 1;
}

export function computePositionKey({
  productId,
  warehouseId,
  binId = null,
  ownerType = 'ENTERPRISE',
  ownerId = null,
  stockStatus = 'AVAILABLE',
  lotId = null,
  serialId = null,
}) {
  const tuple = [
    normalizeIdComponent(productId, 'product_id'),
    normalizeIdComponent(warehouseId, 'warehouse_id'),
    normalizeIdComponent(binId, 'bin_id'),
    normalizeOwnerType(ownerType),
    normalizeIdComponent(ownerId, 'owner_id'),
    normalizeIdComponent(stockStatus, 'stock_status').toUpperCase(),
    normalizeIdComponent(lotId, 'lot_id'),
    normalizeIdComponent(serialId, 'serial_id'),
  ].join(PIPE);
  return createHash('sha256').update(tuple).digest('hex');
}

export function positionKeyForRow(row) {
  return computePositionKey({
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    binId: row.bin_id ?? null,
    ownerType: row.owner_type ?? 'ENTERPRISE',
    ownerId: row.owner_id ?? null,
    stockStatus: row.stock_status ?? 'AVAILABLE',
    lotId: row.lot_id ?? null,
    serialId: row.serial_id ?? null,
  });
}

// Normalise raw inventory dimension inputs (validate dimensions, then compute key).
export function buildCanonicalPosition(db, input) {
  const owner = validateOwner(db, input.ownerType, input.ownerId);
  validateStockStatus(db, input.stockStatus);
  let binId = input.binId ?? null;
  if (binId) validateBin(db, input.warehouseId, binId);
  else if (warehouseAllowsBin(db, input.warehouseId)) {
    // bin-enabled warehouse may optionally have no bin
  }
  return {
    productId: input.productId,
    warehouseId: input.warehouseId,
    binId,
    ownerType: owner.ownerType,
    ownerId: owner.ownerId,
    stockStatus: String(input.stockStatus ?? 'AVAILABLE').trim().toUpperCase(),
    lotId: input.lotId ?? null,
    serialId: input.serialId ?? null,
    positionKey: computePositionKey({
      productId: input.productId,
      warehouseId: input.warehouseId,
      binId,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      stockStatus: String(input.stockStatus ?? 'AVAILABLE').trim().toUpperCase(),
      lotId: input.lotId ?? null,
      serialId: input.serialId ?? null,
    }),
  };
}

function evidenceString(value, label, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(409, `Invalid historical position evidence: ${label}`, { code: 'CONSIGNMENT_POSITION_EVIDENCE_INVALID' });
  }
  if (value.length > 128 || value !== value.trim()) {
    throw new HttpError(409, `Invalid historical position evidence: ${label}`, { code: 'CONSIGNMENT_POSITION_EVIDENCE_INVALID' });
  }
  return value;
}

export function canonicalPositionSnapshot(position) {
  const snapshot = {
    schemaVersion: POSITION_EVIDENCE_SCHEMA_VERSION,
    productId: evidenceString(position.productId, 'productId'),
    warehouseId: evidenceString(position.warehouseId, 'warehouseId'),
    binId: position.binId == null ? null : evidenceString(position.binId, 'binId'),
    ownerType: normalizeOwnerType(position.ownerType),
    ownerId: position.ownerId == null ? null : evidenceString(position.ownerId, 'ownerId'),
    stockStatus: evidenceString(position.stockStatus, 'stockStatus').toUpperCase(),
    lotId: position.lotId == null ? null : evidenceString(position.lotId, 'lotId'),
    serialId: position.serialId == null ? null : evidenceString(position.serialId, 'serialId'),
    positionKey: evidenceString(position.positionKey, 'positionKey'),
  };
  if (!/^[0-9a-f]{64}$/.test(snapshot.positionKey)
      || (snapshot.ownerType === OWNER_TYPES.ENTERPRISE && snapshot.ownerId !== null)
      || (snapshot.ownerType !== OWNER_TYPES.ENTERPRISE && snapshot.ownerId === null)) {
    throw new HttpError(409, 'Historical position evidence identity mismatch', { code: 'CONSIGNMENT_POSITION_EVIDENCE_INVALID' });
  }
  const expected = computePositionKey(snapshot);
  if (snapshot.positionKey !== expected) {
    throw new HttpError(409, 'Historical position evidence hash mismatch', { code: 'CONSIGNMENT_POSITION_EVIDENCE_INVALID' });
  }
  return JSON.stringify(snapshot);
}

export function parseCanonicalPositionSnapshot(value) {
  let snapshot;
  try { snapshot = JSON.parse(String(value)); }
  catch { throw new HttpError(409, 'Malformed historical position evidence JSON', { code: 'CONSIGNMENT_POSITION_EVIDENCE_INVALID' }); }
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== 'object') {
    throw new HttpError(409, 'Historical position evidence must be an object', { code: 'CONSIGNMENT_POSITION_EVIDENCE_INVALID' });
  }
  const keys = Object.keys(snapshot);
  if (keys.length !== POSITION_SNAPSHOT_KEYS.length
      || keys.some((key, index) => key !== POSITION_SNAPSHOT_KEYS[index])) {
    throw new HttpError(409, 'Historical position evidence shape mismatch', { code: 'CONSIGNMENT_POSITION_EVIDENCE_INVALID' });
  }
  if (snapshot.schemaVersion !== POSITION_EVIDENCE_SCHEMA_VERSION) {
    throw new HttpError(409, 'Unsupported historical position evidence version', { code: 'CONSIGNMENT_POSITION_EVIDENCE_INVALID' });
  }
  const canonical = canonicalPositionSnapshot(snapshot);
  if (canonical !== String(value)) {
    throw new HttpError(409, 'Historical position evidence is not canonical', { code: 'CONSIGNMENT_POSITION_EVIDENCE_INVALID' });
  }
  return JSON.parse(canonical);
}
