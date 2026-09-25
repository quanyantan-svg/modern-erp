import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, readJson, send } from '../lib/http.js';

const EPS = 1e-9;
const POLICIES = ['NONE', 'LOT', 'SERIAL'];
const ON_HAND_SERIAL_STATES = ['AVAILABLE', 'HOLD'];

const nowIso = () => new Date().toISOString();
const num = (value, label, positive = false) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (positive && n <= 0)) throw new HttpError(400, `${label}不正确`);
  return n;
};
const today = (value = nowIso()) => String(value).slice(0, 10);
const isExpired = (row, onDate = today()) => Boolean(row?.expiry_date && onDate > row.expiry_date);

export function productTracking(db, productId) {
  const product = db.prepare('SELECT id,code,name,tracking_policy,shelf_life_days,tracking_effective_at FROM products WHERE id=?').get(productId);
  if (!product) throw new HttpError(404, '货品不存在');
  return { ...product, tracking_policy: product.tracking_policy || 'NONE' };
}

function openStockDocuments(db, productId) {
  const specs = [
    ['purchase_receipts', 'purchase_receipt_items', 'receipt_id'], ['sales_deliveries', 'sales_delivery_items', 'delivery_id'],
    ['return_orders', 'return_order_items', 'return_id'], ['purchase_returns', 'purchase_return_items', 'return_id'],
    ['production_material_issues', 'production_material_issue_items', 'issue_id'],
    ['inventory_adjustments', 'inventory_adjustment_items', 'adjustment_id'],
  ];
  return specs.some(([header, items, fk]) => db.prepare(`SELECT 1 FROM ${items} i JOIN ${header} h ON h.id=i.${fk} WHERE i.product_id=? AND h.status='DRAFT' LIMIT 1`).get(productId));
}

export function changeTrackingPolicy(db, actor, productId, { policy, shelfLifeDays = null, reason }) {
  if (actor.roleCode !== 'ADMIN') throw new HttpError(403, '只有管理员可以配置库存跟踪方式');
  const next = String(policy || '').toUpperCase();
  if (!POLICIES.includes(next)) throw new HttpError(400, '库存跟踪方式无效');
  const product = productTracking(db, productId);
  const shelf = shelfLifeDays === null || shelfLifeDays === '' ? null : Number(shelfLifeDays);
  if (shelf !== null && (!Number.isSafeInteger(shelf) || shelf <= 0)) throw new HttpError(400, '保质期必须为正整数天');
  const why = String(reason || '').trim();
  if (!why) throw new HttpError(400, '请填写跟踪策略变更原因');
  if (next !== product.tracking_policy) {
    const movement = db.prepare('SELECT 1 FROM tracked_inventory_movements WHERE product_id=? LIMIT 1').get(productId);
    if (movement && product.tracking_policy !== next) throw new HttpError(409, '已有批次/序列号库存流水，禁止变更跟踪方式');
    const stock = Number(db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM inventory WHERE product_id=?').get(productId).n);
    if (stock > EPS) throw new HttpError(409, '启用批次/序列号管理前库存必须为 0');
    if (openStockDocuments(db, productId)) throw new HttpError(409, '存在使用该货品的库存草稿单据，不能变更跟踪方式');
    const activeProduction = db.prepare("SELECT 1 FROM production_orders WHERE product_id=? AND status IN ('PENDING','IN_PROGRESS') LIMIT 1").get(productId);
    if (activeProduction) throw new HttpError(409, '存在进行中的生产执行，不能变更跟踪方式');
  }
  const at = nowIso();
  transaction(db, () => {
    db.prepare('UPDATE products SET tracking_policy=?,shelf_life_days=?,tracking_effective_at=?,updated_at=? WHERE id=?').run(next, shelf, at, at, productId);
    db.prepare('INSERT INTO product_tracking_policy_history(id,product_id,old_policy,new_policy,shelf_life_days,reason,changed_by,changed_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id(), productId, product.tracking_policy, next, shelf, why, actor.id, at);
    audit(db, actor.id, 'TRACKING_POLICY_CHANGE', 'PRODUCT', productId, `${product.tracking_policy} -> ${next}; ${why}`);
  });
  return { productId, trackingPolicy: next, shelfLifeDays: shelf, effectiveAt: at };
}

export function deriveExpiry(manufactureDate, shelfLifeDays) {
  if (!manufactureDate || !shelfLifeDays) return null;
  const date = new Date(`${manufactureDate}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) throw new HttpError(400, '生产日期不正确');
  date.setUTCDate(date.getUTCDate() + Number(shelfLifeDays));
  return date.toISOString().slice(0, 10);
}

function normalizedAllocations(product, quantity, allocations) {
  if (product.tracking_policy === 'NONE') return [];
  if (Math.abs(Number(quantity)) < EPS && (!allocations || allocations.length === 0)) return [];
  if (!Array.isArray(allocations) || !allocations.length) throw new HttpError(409, '跟踪货品必须填写批次或序列号身份');
  if (product.tracking_policy === 'LOT') {
    const rows = allocations.map((x) => ({
      lotId: x.lotId || null, lotCode: String(x.lotCode || '').trim(), quantity: num(x.quantity, '批次数量', true),
      manufactureDate: x.manufactureDate || null, expiryDate: x.expiryDate || deriveExpiry(x.manufactureDate, product.shelf_life_days),
      supplierLotReference: String(x.supplierLotReference || '').trim() || null,
    }));
    if (rows.some((x) => !x.lotId && !x.lotCode)) throw new HttpError(400, '批次分配必须引用批次或填写批次号');
    if (Math.abs(rows.reduce((s, x) => s + x.quantity, 0) - Number(quantity)) > EPS) throw new HttpError(409, '批次数量合计必须等于单据行数量');
    return rows;
  }
  if (!Number.isSafeInteger(Number(quantity))) throw new HttpError(409, '序列号管理货品数量必须为整数');
  const rows = allocations.map((x) => ({ serialId: x.serialId || null, serialNumber: String(x.serialNumber || '').trim(), quantity: 1,
    lotId: x.lotId || null, manufactureDate: x.manufactureDate || null,
    expiryDate: x.expiryDate || deriveExpiry(x.manufactureDate, product.shelf_life_days) }));
  if (rows.length !== Number(quantity) || rows.some((x) => !x.serialId && !x.serialNumber)) throw new HttpError(409, '序列号数量必须与单据行数量完全一致');
  const keys = rows.map((x) => x.serialId || x.serialNumber);
  if (new Set(keys).size !== keys.length) throw new HttpError(409, '序列号不能重复');
  return rows;
}

export function saveTrackedAllocations(db, { sourceType, sourceId, sourceItemId, productId, quantity, allocations }) {
  const product = productTracking(db, productId);
  const rows = normalizedAllocations(product, quantity, allocations);
  const existingPosted = db.prepare('SELECT 1 FROM tracked_source_allocations WHERE source_type=? AND source_id=? AND source_item_id=? AND posted=1').get(sourceType, sourceId, sourceItemId);
  if (existingPosted) throw new HttpError(409, '已过账身份分配不可修改');
  const work = () => {
    db.prepare('DELETE FROM tracked_source_allocations WHERE source_type=? AND source_id=? AND source_item_id=?').run(sourceType, sourceId, sourceItemId);
    const insert = db.prepare(`INSERT INTO tracked_source_allocations(id,source_type,source_id,source_item_id,product_id,lot_id,planned_lot_code,serial_id,planned_serial_number,quantity,manufacture_date,expiry_date,supplier_lot_reference,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const at = nowIso();
    for (const row of rows) insert.run(id(), sourceType, sourceId, sourceItemId, productId, row.lotId || null, row.lotCode || null, row.serialId || null, row.serialNumber || null, row.quantity, row.manufactureDate || null, row.expiryDate || null, row.supplierLotReference || null, at);
  };
  if (db.isTransaction) work(); else transaction(db, work);
  return rows;
}

export function trackingSnapshot(db, sourceType, sourceId, sourceItemId) {
  return JSON.stringify(db.prepare(`SELECT COALESCE(lot_id,''),COALESCE(planned_lot_code,''),COALESCE(serial_id,''),COALESCE(planned_serial_number,''),quantity,COALESCE(manufacture_date,''),COALESCE(expiry_date,'')
    FROM tracked_source_allocations WHERE source_type=? AND source_id=? AND source_item_id=? ORDER BY COALESCE(lot_id,planned_lot_code),COALESCE(serial_id,planned_serial_number)`).all(sourceType, sourceId, sourceItemId));
}

function getOrCreateLot(db, product, allocation, source, at) {
  let lot = allocation.lot_id ? db.prepare('SELECT * FROM inventory_lots WHERE id=?').get(allocation.lot_id) : null;
  if (!lot && allocation.planned_lot_code) lot = db.prepare('SELECT * FROM inventory_lots WHERE product_id=? AND lot_code=?').get(product.id, allocation.planned_lot_code);
  if (lot && lot.product_id !== product.id) throw new HttpError(409, '批次与货品不匹配');
  if (!lot) {
    const lotId = id();
    db.prepare(`INSERT INTO inventory_lots(id,product_id,lot_code,manufacture_date,expiry_date,supplier_lot_reference,created_source_type,created_source_id,created_source_item_id,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,'AVAILABLE',?)`).run(lotId, product.id, allocation.planned_lot_code, allocation.manufacture_date, allocation.expiry_date, allocation.supplier_lot_reference, source.type, source.id, source.itemId, at);
    lot = db.prepare('SELECT * FROM inventory_lots WHERE id=?').get(lotId);
  }
  return lot;
}

function changeLotBalance(db, warehouseId, productId, lotId, delta, at) {
  const current = Number(db.prepare('SELECT quantity FROM inventory_lot_balances WHERE warehouse_id=? AND lot_id=?').get(warehouseId, lotId)?.quantity || 0);
  const next = current + delta;
  if (next < -EPS) throw new HttpError(409, '批次可用数量不足');
  db.prepare(`INSERT INTO inventory_lot_balances(warehouse_id,product_id,lot_id,quantity,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(warehouse_id,lot_id) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`).run(warehouseId, productId, lotId, Math.max(0, next), at);
  return next;
}

function assertAvailableLot(lot, onDate) {
  if (!lot) throw new HttpError(409, '批次不存在');
  if (lot.status === 'HOLD') throw new HttpError(409, 'HOLD 批次不可用于正常出库');
  if (lot.status !== 'AVAILABLE') throw new HttpError(409, '批次当前不可用');
  if (isExpired(lot, onDate)) throw new HttpError(409, '过期批次不可用于正常出库');
}

function assertReturnProvenance(db, sourceType, sourceId, allocations) {
  if (!['SALES_RETURN','PURCHASE_RETURN'].includes(sourceType)) return;
  const upstream = sourceType === 'SALES_RETURN'
    ? db.prepare('SELECT COALESCE(delivery_id,source_id) id FROM return_orders WHERE id=?').get(sourceId)?.id
    : db.prepare('SELECT receipt_id id FROM purchase_returns WHERE id=?').get(sourceId)?.id;
  const upstreamType = sourceType === 'SALES_RETURN' ? 'SALES_DELIVERY' : 'PURCHASE_RECEIPT';
  if (!upstream) throw new HttpError(409, '退货缺少权威来源单据');
  for (const row of allocations) {
    const received = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM tracked_inventory_movements WHERE source_type=? AND source_id=? AND COALESCE(lot_id,'')=COALESCE(?,'') AND COALESCE(serial_id,'')=COALESCE(?,'') AND reversed=0`).get(upstreamType, upstream, row.lot_id || null, row.serial_id || null).n);
    const returned = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM tracked_inventory_movements WHERE source_type=? AND COALESCE(lot_id,'')=COALESCE(?,'') AND COALESCE(serial_id,'')=COALESCE(?,'') AND reversed=0`).get(sourceType, row.lot_id || null, row.serial_id || null).n);
    if (received + EPS < returned + Number(row.quantity)) throw new HttpError(409, '退货批次/序列号不属于来源单据或已全部退回');
  }
}

export function postTrackedMovement(db, { sourceType, sourceId, sourceItemId, productId, warehouseId, quantity, direction, businessDate, returnToHold = false }) {
  const product = productTracking(db, productId);
  if (product.tracking_policy === 'NONE') return [];
  const allocations = db.prepare('SELECT * FROM tracked_source_allocations WHERE source_type=? AND source_id=? AND source_item_id=? ORDER BY created_at,id').all(sourceType, sourceId, sourceItemId);
  normalizedAllocations(product, quantity, allocations.map((x) => ({ lotId: x.lot_id, lotCode: x.planned_lot_code, serialId: x.serial_id, serialNumber: x.planned_serial_number, quantity: x.quantity })));
  assertReturnProvenance(db, sourceType, sourceId, allocations);
  if (allocations.some((x) => x.posted && !x.reversed)) return allocations;
  const at = nowIso();
  for (const a of allocations) {
    if (product.tracking_policy === 'LOT') {
      const lot = direction === 'IN' ? getOrCreateLot(db, product, a, { type: sourceType, id: sourceId, itemId: sourceItemId }, at) : db.prepare('SELECT * FROM inventory_lots WHERE id=?').get(a.lot_id);
      if (direction === 'OUT') assertAvailableLot(lot, businessDate);
      changeLotBalance(db, warehouseId, productId, lot.id, direction === 'IN' ? Number(a.quantity) : -Number(a.quantity), at);
      if (returnToHold) db.prepare("UPDATE inventory_lots SET status='HOLD' WHERE id=?").run(lot.id);
      db.prepare('UPDATE tracked_source_allocations SET lot_id=?,posted=1 WHERE id=?').run(lot.id, a.id);
      db.prepare(`INSERT INTO tracked_inventory_movements(id,source_type,source_id,source_item_id,product_id,warehouse_id,direction,quantity,lot_id,business_date,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id(), sourceType, sourceId, sourceItemId, productId, warehouseId, direction, a.quantity, lot.id, businessDate, at);
    } else {
      let serial = a.serial_id ? db.prepare('SELECT * FROM inventory_serials WHERE id=?').get(a.serial_id) : null;
      if (direction === 'IN' && !serial) {
        if (db.prepare('SELECT 1 FROM inventory_serials WHERE product_id=? AND serial_number=?').get(productId, a.planned_serial_number)) throw new HttpError(409, '序列号已存在，禁止重复入库');
        const serialId = id();
        db.prepare(`INSERT INTO inventory_serials(id,product_id,serial_number,lot_id,manufacture_date,expiry_date,created_source_type,created_source_id,created_source_item_id,lifecycle_state,current_warehouse_id,updated_at,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(serialId, productId, a.planned_serial_number, a.lot_id, a.manufacture_date, a.expiry_date, sourceType, sourceId, sourceItemId, returnToHold ? 'HOLD' : 'AVAILABLE', warehouseId, at, at);
        serial = db.prepare('SELECT * FROM inventory_serials WHERE id=?').get(serialId);
      } else if (direction === 'IN' && serial) {
        if (!['DELIVERED','CONSUMED'].includes(serial.lifecycle_state)) throw new HttpError(409, '序列号已在库或不可重复入库');
        db.prepare("UPDATE inventory_serials SET lifecycle_state=?,current_warehouse_id=?,updated_at=? WHERE id=?").run(returnToHold ? 'HOLD' : 'AVAILABLE', warehouseId, at, serial.id);
      } else {
        if (!serial || serial.product_id !== productId || serial.current_warehouse_id !== warehouseId || serial.lifecycle_state !== 'AVAILABLE') throw new HttpError(409, '序列号不在指定仓库或当前不可用');
        if (isExpired(serial, businessDate)) throw new HttpError(409, '过期序列号不可用于正常出库');
        const state = sourceType === 'SALES_DELIVERY' ? 'DELIVERED' : sourceType.includes('SCRAP') ? 'SCRAPPED' : 'CONSUMED';
        db.prepare('UPDATE inventory_serials SET lifecycle_state=?,current_warehouse_id=NULL,updated_at=? WHERE id=?').run(state, at, serial.id);
      }
      db.prepare('UPDATE tracked_source_allocations SET serial_id=?,posted=1 WHERE id=?').run(serial.id, a.id);
      db.prepare(`INSERT INTO tracked_inventory_movements(id,source_type,source_id,source_item_id,product_id,warehouse_id,direction,quantity,serial_id,business_date,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id(), sourceType, sourceId, sourceItemId, productId, warehouseId, direction, 1, serial.id, businessDate, at);
    }
  }
  return allocations;
}

export function transferTrackedInventory(db, { sourceId, sourceItemId, productId, fromWarehouseId, toWarehouseId, quantity, businessDate }) {
  const product = productTracking(db, productId); if (product.tracking_policy === 'NONE') return [];
  const rows = db.prepare("SELECT * FROM tracked_source_allocations WHERE source_type='INVENTORY_TRANSFER' AND source_id=? AND source_item_id=? ORDER BY id").all(sourceId, sourceItemId);
  normalizedAllocations(product, quantity, rows.map((x) => ({ lotId: x.lot_id, serialId: x.serial_id, quantity: x.quantity })));
  if (rows.every((x) => x.posted)) return rows;
  const at = nowIso();
  for (const row of rows) {
    if (product.tracking_policy === 'LOT') {
      const lot = db.prepare('SELECT * FROM inventory_lots WHERE id=?').get(row.lot_id); assertAvailableLot(lot, businessDate);
      changeLotBalance(db, fromWarehouseId, productId, lot.id, -Number(row.quantity), at); changeLotBalance(db, toWarehouseId, productId, lot.id, Number(row.quantity), at);
      for (const [warehouse, direction] of [[fromWarehouseId, 'OUT'], [toWarehouseId, 'IN']]) db.prepare(`INSERT INTO tracked_inventory_movements(id,source_type,source_id,source_item_id,product_id,warehouse_id,direction,quantity,lot_id,business_date,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id(), 'INVENTORY_TRANSFER', sourceId, sourceItemId, productId, warehouse, direction, row.quantity, lot.id, businessDate, at);
    } else {
      const serial = db.prepare('SELECT * FROM inventory_serials WHERE id=?').get(row.serial_id);
      if (!serial || serial.product_id !== productId || serial.current_warehouse_id !== fromWarehouseId || serial.lifecycle_state !== 'AVAILABLE' || isExpired(serial, businessDate)) throw new HttpError(409, '序列号不在源仓、处于 HOLD 或已经过期');
      db.prepare('UPDATE inventory_serials SET current_warehouse_id=?,updated_at=? WHERE id=?').run(toWarehouseId, at, serial.id);
      for (const [warehouse, direction] of [[fromWarehouseId, 'OUT'], [toWarehouseId, 'IN']]) db.prepare(`INSERT INTO tracked_inventory_movements(id,source_type,source_id,source_item_id,product_id,warehouse_id,direction,quantity,serial_id,business_date,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id(), 'INVENTORY_TRANSFER', sourceId, sourceItemId, productId, warehouse, direction, 1, serial.id, businessDate, at);
    }
    db.prepare('UPDATE tracked_source_allocations SET posted=1 WHERE id=?').run(row.id);
  }
  return rows;
}

export function reverseTrackedSource(db, { originalSourceType, originalSourceId, reversalSourceType, reversalSourceId, businessDate }) {
  const rows = db.prepare(`SELECT * FROM tracked_inventory_movements
    WHERE source_type=? AND source_id=? AND reversed=0
    ORDER BY source_item_id,direction,id`).all(originalSourceType, originalSourceId);
  if (!rows.length) return [];
  const at = nowIso();
  if (originalSourceType === 'INVENTORY_TRANSFER') {
    const itemIds = [...new Set(rows.map((row) => row.source_item_id))];
    for (const itemId of itemIds) {
      const outgoing = rows.filter((row) => row.source_item_id === itemId && row.direction === 'OUT');
      const incoming = rows.filter((row) => row.source_item_id === itemId && row.direction === 'IN');
      for (const destination of incoming) {
        const source = outgoing.find((row) => row.product_id === destination.product_id && (destination.serial_id ? row.serial_id === destination.serial_id : row.lot_id === destination.lot_id));
        if (!source) throw new HttpError(409, '调拨身份移动不完整，不能冲销');
        if (destination.lot_id) {
          changeLotBalance(db, destination.warehouse_id, destination.product_id, destination.lot_id, -Number(destination.quantity), at);
          changeLotBalance(db, source.warehouse_id, source.product_id, source.lot_id, Number(source.quantity), at);
        } else {
          const serial = db.prepare('SELECT * FROM inventory_serials WHERE id=?').get(destination.serial_id);
          if (!serial || serial.current_warehouse_id !== destination.warehouse_id || serial.lifecycle_state !== 'AVAILABLE') throw new HttpError(409, '调拨序列号已不在目标仓可用状态');
          db.prepare('UPDATE inventory_serials SET current_warehouse_id=?,updated_at=? WHERE id=?').run(source.warehouse_id, at, serial.id);
        }
        for (const [row, direction] of [[destination, 'OUT'], [source, 'IN']]) db.prepare(`INSERT INTO tracked_inventory_movements(id,source_type,source_id,source_item_id,product_id,warehouse_id,direction,quantity,lot_id,serial_id,business_date,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id(), reversalSourceType, reversalSourceId, itemId, row.product_id, row.warehouse_id, direction, row.quantity, row.lot_id, row.serial_id, businessDate, at);
      }
    }
  } else {
    for (const row of rows) {
      const direction = row.direction === 'IN' ? 'OUT' : 'IN';
      if (row.lot_id) {
        changeLotBalance(db, row.warehouse_id, row.product_id, row.lot_id, direction === 'IN' ? Number(row.quantity) : -Number(row.quantity), at);
      } else if (row.serial_id) {
        const serial = db.prepare('SELECT * FROM inventory_serials WHERE id=?').get(row.serial_id);
        if (direction === 'OUT') {
          if (!serial || serial.current_warehouse_id !== row.warehouse_id || !['AVAILABLE','HOLD'].includes(serial.lifecycle_state)) throw new HttpError(409, '序列号已不可用，不能冲销原入库');
          db.prepare("UPDATE inventory_serials SET lifecycle_state='CONSUMED',current_warehouse_id=NULL,updated_at=? WHERE id=?").run(at, serial.id);
        } else {
          if (!serial || serial.current_warehouse_id !== null || !['CONSUMED','SCRAPPED'].includes(serial.lifecycle_state)) throw new HttpError(409, '序列号已发生不兼容后续事件，不能恢复');
          db.prepare("UPDATE inventory_serials SET lifecycle_state='AVAILABLE',current_warehouse_id=?,updated_at=? WHERE id=?").run(row.warehouse_id, at, serial.id);
        }
      }
      db.prepare(`INSERT INTO tracked_inventory_movements(id,source_type,source_id,source_item_id,product_id,warehouse_id,direction,quantity,lot_id,serial_id,business_date,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id(), reversalSourceType, reversalSourceId, row.source_item_id, row.product_id, row.warehouse_id, direction, row.quantity, row.lot_id, row.serial_id, businessDate, at);
    }
  }
  db.prepare('UPDATE tracked_inventory_movements SET reversed=1 WHERE source_type=? AND source_id=?').run(originalSourceType, originalSourceId);
  db.prepare('UPDATE tracked_source_allocations SET reversed=1 WHERE source_type=? AND source_id=?').run(originalSourceType, originalSourceId);
  return rows;
}

export function holdIdentity(db, actor, identityType, identityId, action, reason) {
  allowAny(actor, ['WAREHOUSES_MANAGE', 'INVENTORY_ADJUSTMENT_MANAGE']);
  const type = String(identityType).toUpperCase(); const act = String(action).toUpperCase(); const why = String(reason || '').trim();
  if (!['LOT','SERIAL'].includes(type) || !['HOLD','RELEASE'].includes(act) || !why) throw new HttpError(400, '身份、操作或原因不正确');
  const table = type === 'LOT' ? 'inventory_lots' : 'inventory_serials'; const stateColumn = type === 'LOT' ? 'status' : 'lifecycle_state';
  const current = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(identityId); if (!current) throw new HttpError(404, '跟踪身份不存在');
  if (act === 'HOLD' && current[stateColumn] !== 'AVAILABLE') throw new HttpError(409, '只有可用身份可以冻结');
  if (act === 'RELEASE' && current[stateColumn] !== 'HOLD') throw new HttpError(409, '只有 HOLD 身份可以释放');
  const at = nowIso(); transaction(db, () => {
    db.prepare(`UPDATE ${table} SET ${stateColumn}=?${type === 'SERIAL' ? ',updated_at=?' : ''} WHERE id=?`).run(...(type === 'SERIAL' ? [act === 'HOLD' ? 'HOLD' : 'AVAILABLE', at, identityId] : [act === 'HOLD' ? 'HOLD' : 'AVAILABLE', identityId]));
    db.prepare('INSERT INTO tracked_identity_hold_history(id,identity_type,identity_id,action,reason,operator_id,created_at) VALUES(?,?,?,?,?,?,?)').run(id(), type, identityId, act, why, actor.id, at);
    audit(db, actor.id, act, `${type}_IDENTITY`, identityId, why);
  }); return { ok: true, state: act === 'HOLD' ? 'HOLD' : 'AVAILABLE' };
}

export function calculateSampleQuantity(sourceQuantity, mode, value) {
  const source = num(sourceQuantity, '来源数量', true);
  if (mode === 'FULL') return source;
  const configured = num(value, '抽样参数', true);
  if (mode === 'FIXED_QUANTITY') return Math.min(source, configured);
  if (mode === 'PERCENTAGE') {
    if (configured > 100) throw new HttpError(400, '抽样百分比不能超过 100');
    return Math.min(source, Math.max(1, Math.ceil(source * configured / 100)));
  }
  throw new HttpError(400, '抽样方式无效');
}

export function resolveQualityPolicy(db, operationType, productId, businessDate) {
  const date = businessDate || today();
  const rows = db.prepare(`SELECT * FROM quality_control_points WHERE operation_type=? AND active=1 AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) AND (scope='GLOBAL' OR (scope='PRODUCT' AND product_id=?)) ORDER BY CASE scope WHEN 'PRODUCT' THEN 0 ELSE 1 END,version DESC`).all(operationType, date, date, productId);
  const qcp = rows[0];
  if (!qcp) return { qcpId: null, version: null, inspectionRequired: true, samplingMode: 'FULL', samplingValue: null, failSafe: true };
  return { qcpId: qcp.id, version: qcp.version, inspectionRequired: Boolean(qcp.inspection_required), samplingMode: qcp.sampling_mode, samplingValue: qcp.sampling_value, waiverReason: qcp.remarks };
}

export function freezeQualityPolicy(db, { sourceType, sourceId, sourceItemId, productId, businessDate }) {
  const existing = db.prepare('SELECT * FROM logistics_quality_policy_snapshots WHERE source_type=? AND source_item_id=?').get(sourceType, sourceItemId);
  if (existing) return existing;
  const policy = resolveQualityPolicy(db, sourceType, productId, businessDate); const snapshotId = id();
  db.prepare(`INSERT INTO logistics_quality_policy_snapshots(id,source_type,source_id,source_item_id,product_id,qcp_id,qcp_version,inspection_required,sampling_mode,sampling_value,waiver_reason,resolved_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(snapshotId, sourceType, sourceId, sourceItemId, productId, policy.qcpId, policy.version, policy.inspectionRequired ? 1 : 0, policy.samplingMode, policy.samplingValue, policy.inspectionRequired ? null : policy.waiverReason, nowIso());
  return db.prepare('SELECT * FROM logistics_quality_policy_snapshots WHERE id=?').get(snapshotId);
}

export function qualityPolicyAllowsPosting(db, sourceType, sourceId) {
  const snapshots = db.prepare('SELECT * FROM logistics_quality_policy_snapshots WHERE source_type=? AND source_id=?').all(sourceType, sourceId);
  if (!snapshots.length) return { waived: false, required: true, failSafe: true };
  const required = snapshots.some((x) => x.inspection_required);
  return { waived: !required, required, snapshots };
}

export function createQcp(db, actor, input) {
  if (actor.roleCode !== 'ADMIN') throw new HttpError(403, '只有管理员可以维护质量控制点');
  const operation = String(input.operationType || ''); const scope = String(input.scope || ''); const mode = String(input.samplingMode || 'FULL');
  if (!['PURCHASE_RECEIPT','SALES_DELIVERY'].includes(operation) || !['GLOBAL','PRODUCT'].includes(scope)) throw new HttpError(400, '质量控制点范围不正确');
  if (scope === 'PRODUCT' && !input.productId) throw new HttpError(400, '产品级规则必须选择货品');
  if (scope === 'PRODUCT' && !db.prepare('SELECT 1 FROM products WHERE id=?').get(input.productId)) throw new HttpError(400, '产品级规则货品无效');
  calculateSampleQuantity(1, mode, mode === 'FULL' ? null : input.samplingValue);
  if (input.inspectionRequired === false && !String(input.remarks || '').trim()) throw new HttpError(400, '质量豁免必须填写原因');
  const qcpId = id(); const at = nowIso(); const code = String(input.code || '').trim();
  if (!code) throw new HttpError(400, '质量控制点编码不能为空');
  const version = Number(db.prepare('SELECT COALESCE(MAX(version),0)+1 n FROM quality_control_points WHERE code=?').get(code).n);
  transaction(db, () => {
    db.prepare(`INSERT INTO quality_control_points(id,code,name,operation_type,scope,product_id,inspection_required,sampling_mode,sampling_value,active,effective_from,effective_to,version,remarks,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(qcpId, code, String(input.name || code), operation, scope, scope === 'PRODUCT' ? input.productId : null, input.inspectionRequired === false ? 0 : 1, mode, mode === 'FULL' ? null : input.samplingValue, input.active === false ? 0 : 1, input.effectiveFrom || today(), input.effectiveTo || null, version, String(input.remarks || ''), actor.id, at);
    const insert = db.prepare('INSERT INTO quality_control_criteria(id,qcp_id,sequence,criterion_name,specification,result_type,min_value,max_value,unit,required) VALUES(?,?,?,?,?,?,?,?,?,?)');
    for (const [index, c] of (input.criteria || []).entries()) { if (!String(c.name || '').trim() || !['PASS_FAIL','NUMERIC','TEXT'].includes(c.resultType)) throw new HttpError(400, '检验标准名称或结果类型无效'); if (c.resultType === 'NUMERIC' && c.min != null && c.max != null && Number(c.min) > Number(c.max)) throw new HttpError(400, '数值标准最小值不能大于最大值'); insert.run(id(), qcpId, index + 1, String(c.name || '').trim(), String(c.specification || ''), c.resultType, c.min ?? null, c.max ?? null, c.unit || null, c.required === false ? 0 : 1); }
    audit(db, actor.id, 'CREATE_VERSION', 'QUALITY_CONTROL_POINT', qcpId, `${code} v${version}`);
  }); return { id: qcpId, version };
}

export function reconcileTrackedInventory(db) {
  const mismatches = [];
  const tracked = db.prepare("SELECT i.warehouse_id,i.product_id,i.quantity,p.tracking_policy FROM inventory i JOIN products p ON p.id=i.product_id WHERE p.tracking_policy IN ('LOT','SERIAL')").all();
  for (const row of tracked) {
    const dimensional = row.tracking_policy === 'LOT'
      ? Number(db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM inventory_lot_balances WHERE warehouse_id=? AND product_id=?').get(row.warehouse_id, row.product_id).n)
      : Number(db.prepare(`SELECT COUNT(*) n FROM inventory_serials WHERE current_warehouse_id=? AND product_id=? AND lifecycle_state IN ('AVAILABLE','HOLD')`).get(row.warehouse_id, row.product_id).n);
    if (Math.abs(Number(row.quantity) - dimensional) > EPS) mismatches.push({ warehouseId: row.warehouse_id, productId: row.product_id, policy: row.tracking_policy, canonicalQuantity: row.quantity, dimensionalQuantity: dimensional });
  }
  return { ok: mismatches.length === 0, mode: 'CHECK', mismatches };
}

export function allocateGenealogy(db, actor, input) {
  allow(actor, 'PRODUCTION_RECEIPT_MANAGE');
  const output = input.outputSerialId ? db.prepare('SELECT * FROM inventory_serials WHERE id=?').get(input.outputSerialId) : db.prepare('SELECT * FROM inventory_lots WHERE id=?').get(input.outputLotId);
  if (!output) throw new HttpError(409, '成品身份不存在');
  const issueItem = db.prepare(`SELECT i.*,h.production_order_id,h.id issue_id FROM production_material_issue_items i JOIN production_material_issues h ON h.id=i.issue_id WHERE i.id=? AND h.status='CONFIRMED'`).get(input.materialIssueItemId);
  if (!issueItem || issueItem.production_order_id !== input.productionOrderId) throw new HttpError(409, '领料来源不属于该生产工单');
  const qty = num(input.quantity, '谱系分配数量', true);
  const allocated = Number(db.prepare(`SELECT COALESCE(SUM(allocated_quantity),0) n FROM production_genealogy_allocations WHERE material_issue_item_id=? AND COALESCE(input_lot_id,'')=COALESCE(?,'') AND COALESCE(input_serial_id,'')=COALESCE(?,'') AND status='ACTIVE'`).get(issueItem.id, input.inputLotId || null, input.inputSerialId || null).n);
  const issued = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM tracked_inventory_movements WHERE source_type='PRODUCTION_MATERIAL_ISSUE' AND source_item_id=? AND COALESCE(lot_id,'')=COALESCE(?,'') AND COALESCE(serial_id,'')=COALESCE(?,'') AND reversed=0`).get(issueItem.id, input.inputLotId || null, input.inputSerialId || null).n);
  if (allocated + qty > issued + EPS) throw new HttpError(409, '谱系分配超过该身份净领用数量');
  if (input.inputSerialId && allocated > EPS) throw new HttpError(409, '同一组件序列号不能重复分配');
  const allocationId = id(); db.prepare(`INSERT INTO production_genealogy_allocations(id,production_order_id,output_receipt_id,output_lot_id,output_serial_id,material_issue_id,material_issue_item_id,input_lot_id,input_serial_id,allocated_quantity,status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`).run(allocationId, input.productionOrderId, input.outputReceiptId, input.outputLotId || null, input.outputSerialId || null, issueItem.issue_id, issueItem.id, input.inputLotId || null, input.inputSerialId || null, qty, nowIso());
  return { id: allocationId };
}

export function reverseReceiptGenealogy(db, outputReceiptId, outputIdentityIds = null) {
  const at = nowIso(); let sql = "UPDATE production_genealogy_allocations SET status='REVERSED',reversed_at=? WHERE output_receipt_id=? AND status='ACTIVE'"; const params = [at, outputReceiptId];
  if (Array.isArray(outputIdentityIds) && outputIdentityIds.length) { sql += ` AND COALESCE(output_serial_id,output_lot_id) IN (${outputIdentityIds.map(() => '?').join(',')})`; params.push(...outputIdentityIds); }
  return db.prepare(sql).run(...params).changes;
}

export function traceIdentity(db, identityType, identityId, direction = 'BACKWARD', includeReversed = false) {
  const type = String(identityType).toUpperCase(); if (!['LOT','SERIAL'].includes(type)) throw new HttpError(400, '跟踪身份类型无效');
  const table = type === 'LOT' ? 'inventory_lots' : 'inventory_serials'; const identity = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(identityId); if (!identity) throw new HttpError(404, '跟踪身份不存在');
  const key = type === 'LOT' ? 'lot_id' : 'serial_id';
  const movementStatus = includeReversed ? '' : ' AND reversed=0';
  const genealogyStatus = includeReversed ? '' : " AND status='ACTIVE'";
  const movements = db.prepare(`SELECT * FROM tracked_inventory_movements WHERE ${key}=?${movementStatus} ORDER BY created_at`).all(identityId);
  const genealogy = direction === 'FORWARD'
    ? db.prepare(`SELECT * FROM production_genealogy_allocations WHERE input_${key}=?${genealogyStatus} ORDER BY created_at`).all(identityId)
    : db.prepare(`SELECT * FROM production_genealogy_allocations WHERE output_${key}=?${genealogyStatus} ORDER BY created_at`).all(identityId);
  const outputIds = genealogy.map((x) => x.output_serial_id || x.output_lot_id).filter(Boolean);
  const downstream = outputIds.flatMap((oid) => db.prepare(`SELECT m.*,d.delivery_no,c.id customer_id,c.name customer_name FROM tracked_inventory_movements m LEFT JOIN sales_deliveries d ON d.id=m.source_id AND m.source_type='SALES_DELIVERY' LEFT JOIN customers c ON c.id=d.customer_id WHERE (m.lot_id=? OR m.serial_id=?)${movementStatus} ORDER BY m.created_at`).all(oid, oid));
  return { identity, direction, includeReversed, movements, genealogy, downstream, legacyNotice: movements.length ? null : '历史记录：未启用批次/序列号管理' };
}

export function trackedAvailability(db, productId, warehouseId, businessDate = today()) {
  const product = productTracking(db, productId);
  if (product.tracking_policy === 'LOT') {
    const lots = db.prepare(`SELECT l.*,b.quantity on_hand_quantity,CASE WHEN l.status='AVAILABLE' AND (l.expiry_date IS NULL OR l.expiry_date>=?) THEN b.quantity ELSE 0 END available_quantity
      FROM inventory_lot_balances b JOIN inventory_lots l ON l.id=b.lot_id WHERE b.product_id=? AND b.warehouse_id=? AND b.quantity>0
      ORDER BY CASE WHEN l.expiry_date IS NULL THEN 1 ELSE 0 END,l.expiry_date,l.created_at,l.lot_code`).all(businessDate, productId, warehouseId);
    return { policy: 'LOT', onHandQuantity: lots.reduce((s, x) => s + Number(x.on_hand_quantity), 0), availableQuantity: lots.reduce((s, x) => s + Number(x.available_quantity), 0), lots };
  }
  if (product.tracking_policy === 'SERIAL') {
    const serials = db.prepare(`SELECT *,CASE WHEN lifecycle_state='AVAILABLE' AND (expiry_date IS NULL OR expiry_date>=?) THEN 1 ELSE 0 END available FROM inventory_serials WHERE product_id=? AND current_warehouse_id=? ORDER BY serial_number`).all(businessDate, productId, warehouseId);
    return { policy: 'SERIAL', onHandQuantity: serials.filter((x) => ON_HAND_SERIAL_STATES.includes(x.lifecycle_state)).length, availableQuantity: serials.reduce((s, x) => s + Number(x.available), 0), serials };
  }
  return { policy: 'NONE', legacyNotice: '历史记录：未启用批次/序列号管理' };
}

// HTTP adapters keep role checks and transport details out of the domain API.
export async function updateProductTrackingHandler(db, req, res, actor, productId) { const result = changeTrackingPolicy(db, actor, productId, await readJson(req)); return send(res, 200, result); }
export async function saveAllocationsHandler(db, req, res, actor) { allowAny(actor, ['PURCHASE_RECEIPTS_MANAGE','SALES_DELIVERIES_MANAGE','PRODUCTION_MATERIAL_ISSUE_MANAGE','PRODUCTION_RECEIPT_MANAGE','RETURNS_MANAGE','INVENTORY_ADJUSTMENT_MANAGE']); const body = await readJson(req); return send(res, 200, { allocations: saveTrackedAllocations(db, body) }); }
export async function holdIdentityHandler(db, req, res, actor, type, identityId) { const body = await readJson(req); return send(res, 200, holdIdentity(db, actor, type, identityId, body.action, body.reason)); }
export async function createQcpHandler(db, req, res, actor) { return send(res, 201, createQcp(db, actor, await readJson(req))); }
export function listQcpHandler(db, res, actor) { if (actor.roleCode !== 'ADMIN') throw new HttpError(403, '只有管理员可以查看质量控制点配置'); return send(res, 200, { qualityControlPoints: db.prepare('SELECT * FROM quality_control_points ORDER BY operation_type,code,version DESC').all() }); }
export function reconcileTrackingHandler(db, res, actor) { allow(actor, 'INVENTORY_VIEW'); return send(res, 200, reconcileTrackedInventory(db)); }
export function traceHandler(db, res, actor, url) { allowAny(actor, ['INVENTORY_VIEW','PURCHASE_RECEIPTS_VIEW','SALES_DELIVERIES_VIEW','ORDERS_VIEW']); const type = String(url.searchParams.get('type') || '').toUpperCase(); let identityId = url.searchParams.get('id'); const code = url.searchParams.get('code'); if (!identityId && code) { const table = type === 'LOT' ? 'inventory_lots' : 'inventory_serials'; const column = type === 'LOT' ? 'lot_code' : 'serial_number'; identityId = db.prepare(`SELECT id FROM ${table} WHERE ${column}=? AND (? IS NULL OR product_id=?)`).get(code, url.searchParams.get('productId'), url.searchParams.get('productId'))?.id; } return send(res, 200, traceIdentity(db, type, identityId, url.searchParams.get('direction') || 'BACKWARD', url.searchParams.get('includeReversed') === 'true')); }
export function availabilityHandler(db, res, actor, url) { allow(actor, 'INVENTORY_VIEW'); return send(res, 200, trackedAvailability(db, url.searchParams.get('productId'), url.searchParams.get('warehouseId'), url.searchParams.get('businessDate') || today())); }
export async function genealogyHandler(db, req, res, actor) { return send(res, 201, allocateGenealogy(db, actor, await readJson(req))); }

export const TRACKING_POLICIES = POLICIES;
export const TRACKED_ON_HAND_SERIAL_STATES = ON_HAND_SERIAL_STATES;
