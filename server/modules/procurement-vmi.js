import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit, auditBusinessRejection } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import { listCanonicalInventoryPositions } from '../lib/inventory-compat-read.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { assertSupplierQualification } from './procurement-sourcing.js';

const VIEW_PERMISSIONS = ['VMI_VIEW', 'VMI_MANAGE'];
const VMI_RECEIPT_OPERATION = 'VMI_RECEIPT_CREATE';
const VMI_CONSUMPTION_OPERATION = 'VMI_CONSUMPTION_CREATE';
const OPEN_ENDED_DATE = '9999-12-31';

function assertViewPermission(actor) { allowAny(actor, VIEW_PERMISSIONS); }
function assertManagePermission(actor) { allow(actor, 'VMI_MANAGE'); }

function businessDate(value, label) {
  const text = String(value || new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new HttpError(400, `${label}格式必须为 YYYY-MM-DD`);
  return text;
}

/**
 * The VMI agreement IS the VMI business fact. At a business date there must be
 * exactly one effective agreement for a supplier + warehouse + product: zero,
 * several, expired or mismatching candidates all fail closed. The agreement is
 * never picked by list order.
 */
function resolveEffectiveVmiAgreement(db, { supplierId, warehouseId, productId, date, agreementId = null }) {
  const rows = db.prepare(`SELECT * FROM vmi_agreements
    WHERE supplier_id=? AND warehouse_id=? AND product_id=? AND active=1
      AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)`)
    .all(supplierId, warehouseId, productId, date, date);
  if (agreementId && !rows.some((row) => row.id === agreementId)) {
    throw new HttpError(409, '指定的 VMI 协议在业务日期不是有效协议', { code: 'VMI_AGREEMENT_NOT_EFFECTIVE' });
  }
  if (rows.length === 0) {
    throw new HttpError(409, '业务日期没有有效 VMI 协议', { code: 'VMI_AGREEMENT_NOT_FOUND' });
  }
  if (rows.length > 1) {
    throw new HttpError(409, '业务日期存在多个有效 VMI 协议，无法确定唯一协议', { code: 'VMI_AGREEMENT_AMBIGUOUS' });
  }
  return rows[0];
}

/**
 * VMI supplier qualification.
 *
 * VMI is not the outsourcing qualification: the enterprise procures from the
 * supplier and the supplier holds the goods at the enterprise site, so the
 * purchase-side qualification is the applicable basis. The VMI-specific
 * business fact is the agreement itself, not a second qualification flag.
 */
function assertVmiSupplierQualification(db, supplierId, date) {
  try {
    assertSupplierQualification(db, supplierId, 'PURCHASE', date);
  } catch (error) {
    throw new HttpError(409, '供应商不具备 VMI 所需的采购资质', { code: 'VMI_SUPPLIER_NOT_QUALIFIED' });
  }
}

// V21 — Inventory owner dimension is now available.
// All VMI physical mutations route through applyInventoryMutation dispatcher
// (see solution.md §27.21 / §27.43.1). The legacy fail-closed helper has
// been removed.
function assertInventoryOwnerDimension() {
  // No-op. Owner dimension is now available through Inventory domain.
}

function rowToAgreement(row) {
  if (!row) return null;
  return {
    id: row.id,
    supplierId: row.supplier_id,
    warehouseId: row.warehouse_id,
    productId: row.product_id,
    minStock: row.min_stock,
    maxStock: row.max_stock,
    reorderLevel: row.reorder_level,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    active: Boolean(row.active),
  };
}

function rowToVmiReceipt(row) {
  if (!row) return null;
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    supplierId: row.supplier_id,
    warehouseId: row.warehouse_id,
    productId: row.product_id,
    quantity: row.quantity,
    receivedDate: row.received_date,
    businessStatus: row.business_status,
    handlerId: row.handler_id,
    remark: row.remark,
  };
}

export function listVmiAgreements(db, res, actor, url) {
  assertViewPermission(actor);
  const supplierId = url.searchParams.get('supplierId');
  const productId = url.searchParams.get('productId');
  const warehouseId = url.searchParams.get('warehouseId');
  const date = url.searchParams.get('date');
  const where = ['active=1'];
  const params = [];
  if (supplierId) { where.push('supplier_id=?'); params.push(supplierId); }
  if (productId) { where.push('product_id=?'); params.push(productId); }
  if (warehouseId) { where.push('warehouse_id=?'); params.push(warehouseId); }
  if (date) { where.push('effective_from<=? AND (effective_to IS NULL OR effective_to>=?)'); params.push(date, date); }
  const rows = db.prepare(`SELECT * FROM vmi_agreements WHERE ${where.join(' AND ')} ORDER BY effective_from DESC`).all(...params).map(rowToAgreement);
  return send(res, 200, { agreements: rows });
}

export async function createVmiAgreement(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'warehouseId', 'productId', 'minStock', 'maxStock', 'reorderLevel', 'effectiveFrom', 'effectiveTo']);
  if (!body.supplierId || !body.warehouseId || !body.productId) throw new HttpError(400, '供应商、仓库、产品必填');
  if (Number(body.maxStock) < Number(body.minStock)) throw new HttpError(409, '最大库存不能小于最小库存');
  const effectiveFrom = businessDate(body.effectiveFrom, '协议生效日期');
  const effectiveTo = body.effectiveTo ? businessDate(body.effectiveTo, '协议失效日期') : null;
  if (effectiveTo && effectiveTo < effectiveFrom) throw new HttpError(409, '协议失效日期不能早于生效日期');
  assertVmiSupplierQualification(db, body.supplierId, effectiveFrom);
  const id = randomUUID(); const now = new Date().toISOString();
  transaction(db, () => {
    // Overlapping effective windows are not decidable by a plain composite
    // UNIQUE, so the overlap is detected inside the write transaction.
    const overlap = db.prepare(`SELECT id FROM vmi_agreements
      WHERE supplier_id=? AND warehouse_id=? AND product_id=? AND active=1
        AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) LIMIT 1`)
      .all(body.supplierId, body.warehouseId, body.productId, effectiveTo || OPEN_ENDED_DATE, effectiveFrom);
    if (overlap.length) {
      throw new HttpError(409, '同一供应商/仓库/产品的 VMI 协议有效期重叠', { code: 'VMI_AGREEMENT_OVERLAP' });
    }
    db.prepare(`INSERT INTO vmi_agreements(id,supplier_id,warehouse_id,product_id,min_stock,max_stock,reorder_level,effective_from,effective_to,active,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(id, body.supplierId, body.warehouseId, body.productId, Number(body.minStock || 0), Number(body.maxStock || 0), Number(body.reorderLevel || 0), effectiveFrom, effectiveTo, actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'VMI_AGREEMENT', id, `${body.supplierId}:${body.productId}`);
  });
  return send(res, 201, { id });
}

export async function createVmiReceipt(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'warehouseId', 'productId', 'quantity', 'receivedDate', 'remark', 'idempotencyKey', 'agreementId']);
  if (!body.supplierId || !body.warehouseId || !body.productId) throw new HttpError(400, '供应商、仓库、产品必填');
  const idempotencyKey = String(body.idempotencyKey || '').trim();
  if (!idempotencyKey) throw new HttpError(400, 'VMI 收货必须提供幂等键', { code: 'IDEMPOTENCY_KEY_REQUIRED' });
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '数量必须大于 0');
  const receivedDate = businessDate(body.receivedDate, '收货日期');
  const scope = `${body.supplierId}:${body.warehouseId}:${body.productId}`;
  const fingerprint = requestFingerprint({
    supplierId: body.supplierId, warehouseId: body.warehouseId, productId: body.productId,
    quantity, receivedDate, agreementId: body.agreementId || null, remark: body.remark || '',
  });
  const replay = idempotencyReplay(db, VMI_RECEIPT_OPERATION, scope, idempotencyKey, fingerprint);
  if (replay) return send(res, 201, { ...replay, replayed: true });
  // Cross-domain dependency: physical mutation requires Inventory owner dimension.
  assertInventoryOwnerDimension();
  const agreement = resolveEffectiveVmiAgreement(db, {
    supplierId: body.supplierId, warehouseId: body.warehouseId, productId: body.productId,
    date: receivedDate, agreementId: body.agreementId || null,
  });
  const id = randomUUID(); const now = new Date().toISOString();
  const receiptNo = 'VMI-RCPT-' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare(`INSERT INTO vmi_receipts(id,receipt_no,supplier_id,warehouse_id,product_id,quantity,received_date,business_status,handler_id,remark,idempotency_key,creator_id,created_at,updated_at,agreement_id)
      VALUES(?,?,?,?,?,?,?,'PENDING',?,?,?,?,?,?,?)`).run(id, receiptNo, body.supplierId, body.warehouseId, body.productId, quantity, receivedDate, actor.id, body.remark || '', idempotencyKey, actor.id, now, now, agreement.id);
    saveIdempotency(db, VMI_RECEIPT_OPERATION, scope, idempotencyKey, fingerprint, { id, receiptNo });
    audit(db, actor.id, 'CREATE', 'VMI_RECEIPT', id, receiptNo);
  });
  return send(res, 201, { id, receiptNo });
}

export async function confirmVmiReceipt(db, req, res, actor, receiptId) {
  assertManagePermission(actor);
  const receipt = db.prepare('SELECT * FROM vmi_receipts WHERE id=?').get(receiptId);
  if (!receipt) throw new HttpError(404, 'VMI 收货不存在');
  if (receipt.business_status !== 'PENDING') throw new HttpError(409, '只有待确认状态可以确认');
  // A historical receipt without a provable agreement binding is never
  // confirmed: the binding is not inferred and never backfilled.
  if (!receipt.agreement_id) {
    throw new HttpError(409, '该 VMI 收货没有可证明的协议绑定，不能确认', { code: 'VMI_AGREEMENT_UNVERIFIED' });
  }
  // V21 — physical mutation through applyInventoryMutation.
  // VMI receipt: SUPPLIER-owned @ enterprise warehouse.
  const now = new Date().toISOString();
  transaction(db, () => {
    const locked = db.prepare('SELECT * FROM vmi_receipts WHERE id=?').get(receiptId);
    if (!locked || locked.business_status !== 'PENDING') throw new HttpError(409, '只有待确认状态可以确认');
    const agreement = resolveEffectiveVmiAgreement(db, {
      supplierId: locked.supplier_id, warehouseId: locked.warehouse_id, productId: locked.product_id,
      date: locked.received_date, agreementId: locked.agreement_id,
    });
    applyInventoryMutation({
      db,
      sourceType: 'VMI_RECEIPT',
      sourceId: locked.id,
      sourceItemId: locked.id,
      sourceNo: locked.receipt_no,
      businessDate: locked.received_date || now.slice(0, 10),
      actor: { id: actor.id },
      movementKind: 'IN',
      quantity: Number(locked.quantity),
      toPosition: {
        productId: locked.product_id,
        warehouseId: locked.warehouse_id,
        ownerType: 'SUPPLIER',
        ownerId: locked.supplier_id,
        stockStatus: 'AVAILABLE',
      },
      idempotencyKey: `VMI_RECEIPT:${locked.id}`,
      remark: `VMI receipt ${locked.receipt_no} agreement ${agreement.id}`,
    });
    db.prepare('UPDATE vmi_receipts SET business_status=?,updated_at=? WHERE id=?').run('CONFIRMED', now, receiptId);
    audit(db, actor.id, 'CONFIRM', 'VMI_RECEIPT', receiptId, locked.receipt_no);
  });
  return send(res, 200, { ok: true });
}

export async function createVmiConsumption(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['vmiReceiptId', 'quantity', 'consumedDate', 'destination', 'remark', 'idempotencyKey']);
  const receipt = db.prepare('SELECT * FROM vmi_receipts WHERE id=?').get(body.vmiReceiptId);
  if (!receipt) throw new HttpError(404, 'VMI 收货不存在');
  if (receipt.business_status !== 'CONFIRMED') throw new HttpError(409, '只有已确认收货可以消耗');
  const idempotencyKey = String(body.idempotencyKey || '').trim();
  if (!idempotencyKey) throw new HttpError(400, 'VMI 消耗必须提供幂等键', { code: 'IDEMPOTENCY_KEY_REQUIRED' });
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '数量必须大于 0');
  const consumedDate = businessDate(body.consumedDate, '消耗日期');
  const fingerprint = requestFingerprint({
    vmiReceiptId: receipt.id, quantity, consumedDate,
    destination: body.destination || 'PRODUCTION', remark: body.remark || '',
  });
  const replay = idempotencyReplay(db, VMI_CONSUMPTION_OPERATION, receipt.id, idempotencyKey, fingerprint);
  if (replay) return send(res, 201, { ...replay, replayed: true });
  // The agreement binding must still be provable at consumption time.
  if (!receipt.agreement_id) {
    throw new HttpError(409, '该 VMI 收货没有可证明的协议绑定，不能消耗', { code: 'VMI_AGREEMENT_UNVERIFIED' });
  }
  // V21 — physical consumption through applyInventoryMutation (SUPPLIER-owned stock).
  const id = randomUUID(); const now = new Date().toISOString();
  const consumptionNo = 'VMI-CONS-' + Date.now().toString().slice(-10);
  transaction(db, () => {
    const locked = db.prepare('SELECT * FROM vmi_receipts WHERE id=?').get(receipt.id);
    if (!locked || locked.business_status !== 'CONFIRMED') throw new HttpError(409, '只有已确认收货可以消耗');
    resolveEffectiveVmiAgreement(db, {
      supplierId: locked.supplier_id, warehouseId: locked.warehouse_id, productId: locked.product_id,
      date: locked.received_date, agreementId: locked.agreement_id,
    });
    // Two invariants must hold at the same time: this receipt's own remaining
    // capacity, and the canonical SUPPLIER-owned position balance. Another
    // receipt's stock of the same product never substitutes for it.
    const consumed = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM vmi_consumptions
      WHERE vmi_receipt_id=? AND business_status<>'CANCELLED'`).get(locked.id).q || 0);
    const remaining = Number(locked.quantity) - consumed;
    if (quantity > remaining + 1e-9) {
      throw new HttpError(409, `本次收货剩余可消耗 ${remaining}，本次 ${quantity} 超出`, { code: 'VMI_CONSUMPTION_CAPACITY_EXCEEDED' });
    }
    const positions = listCanonicalInventoryPositions(db, {
      productId: locked.product_id, ownerType: 'SUPPLIER', ownerId: locked.supplier_id, stockStatus: 'AVAILABLE',
    });
    const available = positions
      .filter((position) => position.warehouseId === locked.warehouse_id)
      .reduce((total, position) => total + position.quantity, 0);
    if (quantity > available + 1e-9) {
      throw new HttpError(409, `供应商物权库存仅剩 ${available}，本次 ${quantity} 超出`, { code: 'VMI_CONSUMPTION_POSITION_INSUFFICIENT' });
    }
    applyInventoryMutation({
      db,
      sourceType: 'VMI_CONSUMPTION',
      sourceId: id,
      sourceItemId: id,
      businessDate: consumedDate,
      actor: { id: actor.id },
      movementKind: 'OUT',
      quantity,
      fromPosition: {
        productId: locked.product_id,
        warehouseId: locked.warehouse_id,
        ownerType: 'SUPPLIER',
        ownerId: locked.supplier_id,
        stockStatus: 'AVAILABLE',
      },
      idempotencyKey: `VMI_CONSUMPTION:${id}`,
      remark: `VMI consumption ${consumptionNo}`,
    });
    db.prepare(`INSERT INTO vmi_consumptions(id,consumption_no,vmi_receipt_id,quantity,consumed_date,destination,remark,business_status,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'CONFIRMED',?,?,?)`).run(id, consumptionNo, locked.id, quantity, consumedDate, body.destination || 'PRODUCTION', body.remark || '', actor.id, now, now);
    saveIdempotency(db, VMI_CONSUMPTION_OPERATION, locked.id, idempotencyKey, fingerprint, { id, consumptionNo });
    audit(db, actor.id, 'CREATE', 'VMI_CONSUMPTION', id, consumptionNo);
  });
  return send(res, 201, { id, consumptionNo });
}

export async function transferVmiOwnership(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['vmiReceiptId', 'settlementQuantity', 'settlementAmountCents', 'transferDate', 'supplierBillId']);
  const policyError = new HttpError(409, 'VMI 结算与物权释放政策尚未批准', { code: 'VMI_SETTLEMENT_POLICY_PENDING' });
  auditBusinessRejection(db, actor, { entityType: 'VMI_RECEIPT', entityId: body.vmiReceiptId || null, action: 'VMI 物权释放/结算' }, policyError);
  throw policyError;
}

/**
 * VMI read-only summary.
 *
 * `Received − Consumed` is an UNADJUSTED gross balance. The summary never
 * exposes a settlement amount, a pending-settlement figure or a transferred
 * quantity: those口径 are not approved, and the number shown must not be read
 * as an invoiced or owned amount (Requirement §31.13 D-REQ-01, Design
 * §26.34.6.3). When a provable adjustment exists the difference against the
 * canonical SUPPLIER-owned position is shown explicitly instead of being
 * silently absorbed.
 */
export function getVmiSummary(db, res, actor, supplierId) {
  assertViewPermission(actor);
  const receipts = db.prepare(`SELECT product_id, SUM(quantity) received_qty FROM vmi_receipts WHERE supplier_id=? AND business_status IN ('CONFIRMED','CONSUMED','TRANSFERRED') GROUP BY product_id`).all(supplierId);
  const consumed = db.prepare(`SELECT r.product_id, SUM(c.quantity) consumed_qty FROM vmi_consumptions c JOIN vmi_receipts r ON r.id=c.vmi_receipt_id WHERE r.supplier_id=? AND c.business_status<>'CANCELLED' GROUP BY r.product_id`).all(supplierId);
  const productMap = new Map();
  for (const row of receipts) {
    productMap.set(row.product_id, { productId: row.product_id, received: Number(row.received_qty || 0), consumed: 0 });
  }
  for (const row of consumed) {
    const entry = productMap.get(row.product_id) || { productId: row.product_id, received: 0, consumed: 0 };
    entry.consumed = Number(row.consumed_qty || 0);
    productMap.set(row.product_id, entry);
  }
  const summary = Array.from(productMap.values()).map((entry) => {
    const grossRemaining = entry.received - entry.consumed;
    const positions = listCanonicalInventoryPositions(db, {
      productId: entry.productId, ownerType: 'SUPPLIER', ownerId: supplierId, stockStatus: 'AVAILABLE',
    });
    const canonicalBalance = positions.reduce((total, position) => total + position.quantity, 0);
    const difference = Number((canonicalBalance - grossRemaining).toFixed(6));
    return {
      productId: entry.productId,
      received: entry.received,
      consumed: entry.consumed,
      grossRemaining,
      canonicalSupplierOwnedQuantity: canonicalBalance,
      reconciliationDifference: difference,
      reconciliationStatus: difference === 0 ? 'RECONCILED' : 'UNRECONCILED',
    };
  });
  return send(res, 200, { summary });
}

export {
  assertInventoryOwnerDimension,
  rowToAgreement,
  rowToVmiReceipt,
};
