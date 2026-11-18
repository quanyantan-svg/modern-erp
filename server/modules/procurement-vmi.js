import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';
import { applyInventoryMutation } from '../lib/inventory-mutation.js';
import { createSystemVoucher, inventoryAccountRole, receivePositiveSourceValue, receiveValue } from './financial-inventory.js';
import { recognizeFinanceExposure } from './finance-recognition.js';
import { RECOGNITION_MODES } from './finance-recognition-policy.js';
import { applyCreditAdjustment } from './settlement-core.js';
import { listCanonicalInventoryPositions } from '../lib/inventory-compat-read.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { assertSupplierQualification } from './procurement-sourcing.js';
import {
  assertVmiAgreementPrice, billableQuantityByProduct, closeSettlementPeriod, findSettlementPeriod,
  listSettlementLines, openSettlementPeriod, rowToLine, rowToPeriod, settlementAmountCents,
  VMI_SETTLEMENT_ERROR_CODES, VMI_SETTLEMENT_LINE_SOURCE,
} from './vmi-settlement.js';
import { createSupplierBill, postSupplierBill } from './commercial-golive.js';

const VIEW_PERMISSIONS = ['VMI_VIEW', 'VMI_MANAGE'];
const VMI_RECEIPT_OPERATION = 'VMI_RECEIPT_CREATE';
const VMI_CONSUMPTION_OPERATION = 'VMI_CONSUMPTION_CREATE';
const OPEN_ENDED_DATE = '9999-12-31';

// 结算链的**独立**权限码（Requirement §31.24 `VMI-SET-16`）：
// 不复用 `VMI_MANAGE` —— 结算期的开 / 闭与账单过账是财务动作，
// 必须能与 VMI 日常业务维护分离。
const SETTLEMENT_PERIOD_VIEW_PERMISSIONS = ['VMI_SETTLEMENT_PERIOD_VIEW', 'VMI_SETTLEMENT_PERIOD_MANAGE', 'VMI_SETTLEMENT_BILL_MANAGE'];
const SETTLEMENT_PERIOD_MANAGE_PERMISSIONS = ['VMI_SETTLEMENT_PERIOD_MANAGE'];
const SETTLEMENT_BILL_PERMISSIONS = ['VMI_SETTLEMENT_BILL_MANAGE'];

function assertViewPermission(actor) { allowAny(actor, VIEW_PERMISSIONS); }
function assertManagePermission(actor) { allow(actor, 'VMI_MANAGE'); }
function assertSettlementPeriodViewPermission(actor) { allowAny(actor, SETTLEMENT_PERIOD_VIEW_PERMISSIONS); }
function assertSettlementPeriodManagePermission(actor) { allowAny(actor, SETTLEMENT_PERIOD_MANAGE_PERMISSIONS); }
function assertSettlementBillPermission(actor) { allowAny(actor, SETTLEMENT_BILL_PERMISSIONS); }

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
    // 协议单价（Requirement §31.24 `VMI-SET-03`）：NULL = 无价（历史协议）。
    unitPriceCents: row.unit_price_cents === null || row.unit_price_cents === undefined
      ? null : Number(row.unit_price_cents),
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
  assertAllowedFields(body, ['supplierId', 'warehouseId', 'productId', 'minStock', 'maxStock', 'reorderLevel', 'effectiveFrom', 'effectiveTo', 'unitPriceCents']);
  if (!body.supplierId || !body.warehouseId || !body.productId) throw new HttpError(400, '供应商、仓库、产品必填');
  if (Number(body.maxStock) < Number(body.minStock)) throw new HttpError(409, '最大库存不能小于最小库存');
  const effectiveFrom = businessDate(body.effectiveFrom, '协议生效日期');
  const effectiveTo = body.effectiveTo ? businessDate(body.effectiveTo, '协议失效日期') : null;
  if (effectiveTo && effectiveTo < effectiveFrom) throw new HttpError(409, '协议失效日期不能早于生效日期');
  // 协议单价（Requirement §31.24 `VMI-SET-03`）：可选，但一旦提供就必须是非负
  // 安全整数分。缺价时协议仍然可以建立 —— 缺价在收货 / 消耗 / 结算时 fail closed。
  const unitPriceCents = body.unitPriceCents === undefined || body.unitPriceCents === null
    ? null : Number(body.unitPriceCents);
  if (unitPriceCents !== null && (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0)) {
    throw new HttpError(400, '协议单价必须为非负安全整数分');
  }
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
    db.prepare(`INSERT INTO vmi_agreements(id,supplier_id,warehouse_id,product_id,min_stock,max_stock,reorder_level,effective_from,effective_to,active,created_by,created_at,updated_at,unit_price_cents)
      VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?)`).run(id, body.supplierId, body.warehouseId, body.productId, Number(body.minStock || 0), Number(body.maxStock || 0), Number(body.reorderLevel || 0), effectiveFrom, effectiveTo, actor.id, now, now, unitPriceCents);
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
    // 协议单价是 VMI 的权威成本（Requirement §31.24 `VMI-SET-03` / `VMI-SET-04`）。
    // **在写任何存货 / 应付 / 凭证之前** fail closed：协议无单价 → 409，零副作用。
    const unitPriceCents = assertVmiAgreementPrice(agreement);
    const receivedValueCents = settlementAmountCents(unitPriceCents, Number(locked.quantity));
    const applied = applyInventoryMutation({
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
    // 单腿入库腿的自持计值（Requirement §32.18 `IW-VAL-05`；金额口径按 §31.24
    // `VMI-SET-04` 修正为协议单价）。
    //
    // 权威**价值**必须与权威**金额**同源：估值流水写协议单价 × 数量，总账凭证
    // 写同一个数。否则 `INVENTORY_VALUE_TO_GL` 会差出整笔收货金额（价值子账
    // 记池单价 / 标准成本，总账记协议单价）。这是 `VMI-SET-04` 的直接推论。
    //
    // 跟踪口径的货品需要身份级分配，而 VMI 收货目前不登记身份（开放项，见
    // Requirement §32.18）；因此跟踪货品的 VMI 收货仍不写估值流水。
    const vmiProduct = db.prepare('SELECT tracking_policy, valuation_method FROM products WHERE id=?').get(locked.product_id);
    if (vmiProduct?.tracking_policy === 'NONE' && vmiProduct?.valuation_method === 'MOVING_AVERAGE') {
      receiveValue(db, {
        businessDate: locked.received_date || now.slice(0, 10),
        productId: locked.product_id,
        warehouseId: locked.warehouse_id,
        quantity: Number(locked.quantity),
        valueCents: receivedValueCents,
        valuationBasis: 'VMI_AGREEMENT_PRICE',
        movementType: 'VMI_RECEIPT',
        sourceType: 'VMI_RECEIPT',
        sourceId: locked.id,
        sourceItemId: locked.id,
        inventoryTransactionId: applied.movements.find((movement) => movement.direction === 'IN')?.transactionId || null,
      });
    }
    // 总账接线（Requirement §31.23 `PRC-VGL-01..04`；金额口径按 §31.24 `VMI-SET-04`
    // 修正为协议单价 × 数量）：收货即确认存货与应付（`Dr 存货 / Cr 应付账款`）。
    // 应付开项经 canonical 识别通道建立（DIRECT 模式 → FINAL 开项），使
    // `AP_TO_GL` 的子账侧与总账侧同域；否则 VMI 收货只入存货、不入应付，
    // 总账与价值子账必然失配（差额 = 每次收货的权威金额）。
    if (receivedValueCents > 0) {
      recognizeFinanceExposure(db, {
        side: 'AP',
        source: { sourceType: 'VMI_RECEIPT', sourceId: locked.id, sourceNo: locked.receipt_no },
        invoice: null,
        recognitionMode: RECOGNITION_MODES.DIRECT,
        amountCents: receivedValueCents,
        businessDate: locked.received_date || now.slice(0, 10),
        partyId: locked.supplier_id,
        paymentTermsDays: 0,
        actorId: actor.id,
        createdAt: now,
      });
      createSystemVoucher(db, {
        sourceType: 'VMI_RECEIPT',
        sourceId: locked.id,
        businessDate: locked.received_date || now.slice(0, 10),
        actorId: actor.id,
        entries: [
          { role: inventoryAccountRole(db, locked.product_id), direction: 'DEBIT', amountCents: receivedValueCents, summary: 'VMI 收货' },
          { role: 'ACCOUNTS_PAYABLE', direction: 'CREDIT', amountCents: receivedValueCents, summary: 'VMI 应付' },
        ],
        remark: `VMI 收货 ${locked.receipt_no}`,
      });
    }
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
    // 协议单价是 VMI 的权威成本（Requirement §31.24 `VMI-SET-03` / `VMI-SET-04`）：
    // 协议无单价 → 409，**在任何库存 / 应付 / 凭证写入之前** fail closed。
    const unitPriceCents = assertVmiAgreementPrice(
      db.prepare('SELECT * FROM vmi_agreements WHERE id=?').get(locked.agreement_id),
    );
    const consumedValueCents = settlementAmountCents(unitPriceCents, quantity);
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
    // 总账接线（Requirement §31.23 `PRC-VGL-05..06`；金额口径按 §31.24 `VMI-SET-04`
    // 修正为协议单价 × 释放数量）：消耗 → `Dr 应付账款 / Cr 存货`（对称冲销）。
    // 应付开项按本次消耗的**权威金额**（协议单价 × 释放数量）冲减，
    // 使 `AP_TO_GL` 与 `INVENTORY_VALUE_TO_GL` 同时保持 0。
    if (consumedValueCents > 0) {
      const openItem = db.prepare(
        "SELECT id, open_amount_cents FROM account_payables WHERE source_type='VMI_RECEIPT' AND source_id=? AND item_class='SOURCE' AND item_kind='FINAL' AND conversion_state='OPEN'",
      ).get(locked.id);
      if (!openItem) {
        throw new HttpError(409, '该 VMI 收货没有可冲减的应付开项', { code: 'VMI_PAYABLE_OPEN_ITEM_MISSING' });
      }
      if (Number(openItem.open_amount_cents) < consumedValueCents) {
        throw new HttpError(409, '应付开项余额不足以冲减本次消耗', { code: 'VMI_PAYABLE_BALANCE_INSUFFICIENT' });
      }
      applyCreditAdjustment(db, {
        side: 'AP', adjustmentType: 'OTHER', sourceType: 'VMI_CONSUMPTION', sourceId: id, sourceNo: consumptionNo,
        targetOpenItemId: openItem.id, partyId: locked.supplier_id,
        businessDate: consumedDate, amountCents: consumedValueCents, actorId: actor.id, createdAt: now,
      });
      createSystemVoucher(db, {
        sourceType: 'VMI_CONSUMPTION',
        sourceId: id,
        businessDate: consumedDate,
        actorId: actor.id,
        entries: [
          { role: 'ACCOUNTS_PAYABLE', direction: 'DEBIT', amountCents: consumedValueCents, summary: 'VMI 消耗核销' },
          { role: inventoryAccountRole(db, locked.product_id), direction: 'CREDIT', amountCents: consumedValueCents, summary: 'VMI 消耗发出' },
        ],
        remark: `VMI 消耗 ${consumptionNo}`,
      });
    }
    saveIdempotency(db, VMI_CONSUMPTION_OPERATION, locked.id, idempotencyKey, fingerprint, { id, consumptionNo });
    audit(db, actor.id, 'CREATE', 'VMI_CONSUMPTION', id, consumptionNo);
  });
  return send(res, 201, { id, consumptionNo });
}

/**
 * 物权转移接口**已退役**（Requirement §31.24 `VMI-SET-02`）。
 *
 * D-2a 物理模型下不存在独立的物权转移业务事件：消耗本身就是 SUPPLIER 位的
 * 单腿物理 OUT，商业释放量 = 实际消耗量。因此本接口**必须**停止受理并返回
 * 明确的**业务性**拒绝。
 *
 * 拒绝文案**不得**出现「政策尚未批准」这类内部治理措辞 —— 那描述的是本仓库
 * 自己的审批状态，不是业务事实。业务事实是：物权转移这条业务路径不存在，
 * 结算请走结算期。
 *
 * 请求体若带 `settlementAmountCents` / `supplierBillId` → **400**（`VMI-SET-05`）：
 * 客户端不得决定金额。
 */
export async function transferVmiOwnership(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  // 白名单**不含** `settlementAmountCents` / `supplierBillId`：传入即 400。
  assertAllowedFields(body, ['vmiReceiptId', 'settlementQuantity', 'transferDate']);
  const retired = new HttpError(410, 'VMI 物权转移已按 D-2a 结算模型退役，请通过结算期结算', {
    code: VMI_SETTLEMENT_ERROR_CODES.OWNERSHIP_TRANSFER_RETIRED,
  });
  // 拒绝审计（`VMI-SET-16`）。共享的 `auditBusinessRejection` 只处理 409；
  // 410 的退役拒绝同样必须留下一条审计，因此这里直接写审计行 —— **恰好一条**。
  audit(db, actor.id, 'REJECT', 'VMI_RECEIPT', body.vmiReceiptId || null,
    `VMI 物权释放/结算 拒绝：${VMI_SETTLEMENT_ERROR_CODES.OWNERSHIP_TRANSFER_RETIRED} ${retired.message}`);
  throw retired;
}

// ---------------------------------------------------------------------------
// 结算期（Requirement §31.24 `VMI-SET-06..10`）
// ---------------------------------------------------------------------------

/**
 * 开启一个结算期。
 *
 * 幂等键是**确定性业务键** `VMI_SETTLEMENT_PERIOD_OPEN:{agreementId}:{periodKey}`
 * （`VMI-SET-14`）：重复请求精确重放，不产生第二个结算期。
 */
export async function openVmiSettlementPeriod(db, req, res, actor) {
  assertSettlementPeriodManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['agreementId', 'periodKey', 'windowKind', 'windowStart', 'windowEnd']);
  if (!body.agreementId) throw new HttpError(400, 'VMI 协议 id 必填');
  if (!body.periodKey) throw new HttpError(400, '结算期键必填');
  const agreement = db.prepare('SELECT * FROM vmi_agreements WHERE id=?').get(body.agreementId);
  if (!agreement) {
    throw new HttpError(409, 'VMI 协议不存在', { code: VMI_SETTLEMENT_ERROR_CODES.AGREEMENT_NOT_FOUND });
  }
  const idempotencyKey = `VMI_SETTLEMENT_PERIOD_OPEN:${body.agreementId}:${body.periodKey}`;
  const fingerprint = requestFingerprint({
    agreementId: body.agreementId, periodKey: body.periodKey,
    windowKind: body.windowKind || null, windowStart: body.windowStart || null, windowEnd: body.windowEnd || null,
  });
  const replay = idempotencyReplay(db, 'VMI_SETTLEMENT_PERIOD_OPEN', body.agreementId, idempotencyKey, fingerprint);
  if (replay) return send(res, 201, { ...replay, replayed: true });
  const period = openSettlementPeriod(db, {
    agreementId: body.agreementId,
    periodKey: body.periodKey,
    windowKind: body.windowKind || 'CALENDAR_MONTH',
    windowStart: body.windowStart || null,
    windowEnd: body.windowEnd || null,
    actorId: actor.id,
    businessDate: body.businessDate || new Date().toISOString().slice(0, 10),
  });
  const result = { id: period.id, period };
  saveIdempotency(db, 'VMI_SETTLEMENT_PERIOD_OPEN', body.agreementId, idempotencyKey, fingerprint, result);
  return send(res, 201, result);
}

/**
 * 关闭一个结算期：五组恒等式断言 + 容差严格 0。
 */
export async function closeVmiSettlementPeriod(db, req, res, actor, periodId) {
  assertSettlementPeriodManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, []);
  const period = closeSettlementPeriod(db, {
    periodId,
    actorId: actor.id,
    businessDate: body.businessDate || new Date().toISOString().slice(0, 10),
  });
  return send(res, 200, { ok: true, period });
}

/**
 * 读取结算期（含结算行）。只暴露数量与状态，**不**暴露结算金额字段
 * （§31.12.6 既有约束）。
 */
export function getVmiSettlementPeriod(db, res, actor, periodId) {
  assertSettlementPeriodViewPermission(actor);
  const period = findSettlementPeriod(db, periodId);
  if (!period) throw new HttpError(404, 'VMI 结算期不存在');
  const lines = listSettlementLines(db, periodId).map(rowToLine);
  return send(res, 200, { period: rowToPeriod(period), lines });
}

/**
 * 生成结算账单（Requirement §31.24 `VMI-SET-10..12`）。
 *
 * 首期**不开放**部分结算 / 多账单：一个结算期间只产生**一张**账单，
 * `settled_qty` 一次性等于该期的 `commercial_released_qty`。
 *
 * 账单走 **canonical 通道**：`createSupplierBill` / `postSupplierBill`，
 * 来源三元组 `VMI_SETTLEMENT_LINE` / 结算期间 id / 结算行 id。
 *
 * 幂等键是确定性业务键 `VMI_SETTLEMENT_BILL_CREATE:{periodId}`：重复请求
 * **精确重放**，不产生第二张账单、不重复写分配。
 */
export async function createVmiSettlementBill(db, req, res, actor, periodId) {
  assertSettlementBillPermission(actor);
  const body = await readJson(req);
  // 客户端**不得**决定金额或账单 ID（`VMI-SET-05`）：传入即 400。
  assertAllowedFields(body, ['businessDate', 'taxMode']);
  const period = findSettlementPeriod(db, periodId);
  if (!period) throw new HttpError(404, 'VMI 结算期不存在');
  const idempotencyKey = `VMI_SETTLEMENT_BILL_CREATE:${periodId}`;
  const fingerprint = requestFingerprint({ periodId, taxMode: body.taxMode || 'NO_TAX' });
  const replay = idempotencyReplay(db, 'VMI_SETTLEMENT_BILL_CREATE', periodId, idempotencyKey, fingerprint);
  if (replay) return send(res, 201, { ...replay, replayed: true });
  const bill = transaction(db, () => {
    const locked = findSettlementPeriod(db, periodId);
    if (!locked) throw new HttpError(404, 'VMI 结算期不存在');
    if (locked.status !== 'CLOSED') {
      throw new HttpError(409, '只有已关闭的结算期可以生成结算账单', {
        code: VMI_SETTLEMENT_ERROR_CODES.PERIOD_STATE_INVALID,
      });
    }
    const existing = db.prepare('SELECT supplier_bill_id FROM vmi_settlement_bill_allocations WHERE settlement_line_id IN (SELECT id FROM vmi_settlement_lines WHERE period_id=?) LIMIT 1').get(periodId);
    if (existing) {
      throw new HttpError(409, '该结算期已生成结算账单', { code: VMI_SETTLEMENT_ERROR_CODES.BILL_EXISTS });
    }
    const lines = listSettlementLines(db, periodId);
    const billableLines = lines.filter((line) => Number(line.commercial_released_qty || 0) > 0);
    if (!billableLines.length) {
      throw new HttpError(409, '该结算期没有可结算量，无法生成结算账单', {
        code: VMI_SETTLEMENT_ERROR_CODES.PARTIAL_NOT_ALLOWED,
      });
    }
    const agreement = db.prepare('SELECT * FROM vmi_agreements WHERE id=?').get(locked.agreement_id);
    if (!agreement) {
      throw new HttpError(409, 'VMI 协议不存在', { code: VMI_SETTLEMENT_ERROR_CODES.AGREEMENT_NOT_FOUND });
    }
    const unitPriceCents = assertVmiAgreementPrice(agreement);
    const billDate = body.businessDate || locked.window_end;
    const items = billableLines.map((line) => {
      const quantity = Number(line.commercial_released_qty || 0);
      const linePrice = line.unit_price_cents === null || line.unit_price_cents === undefined
        ? unitPriceCents : Number(line.unit_price_cents);
      return {
        vmiSettlementLineId: line.id,
        productId: line.product_id,
        quantity,
        unitPriceCents: linePrice,
      };
    });
    const bill = createSupplierBill(db, {
      supplierId: locked.supplier_id,
      supplierInvoiceNo: `VMI-SETTLEMENT-${locked.period_key}`,
      billDate,
      taxMode: body.taxMode || 'NO_TAX',
      items,
      actorId: actor.id,
      idempotencyKey,
    });
    // 分配事实：权威的「结算行 ↔ 账单行」关系（`VMI-SET-10`）。
    const now = new Date().toISOString();
    const billItems = db.prepare('SELECT * FROM supplier_bill_items WHERE bill_id=? ORDER BY line_no').all(bill.id);
    const allocationEventId = `VMI_SETTLEMENT_ALLOCATION:${periodId}`;
    for (const billItem of billItems) {
      const line = lines.find((candidate) => candidate.id === billItem.commercial_source_item_id);
      if (!line) continue;
      const allocatedQty = Number(line.commercial_released_qty || 0);
      const allocatedAmountCents = Number(billItem.gross_cents || 0);
      // 应付开项：结算行本身就是对供应商的**新**商业义务，因此先经 canonical
      // 识别通道为该结算行建立 FINAL 应付开项（DIRECT 模式）。随后的
      // `postSupplierBill` 在 DIRECT 模式下正是把账单链接到这条 FINAL 开项，
      // 从而 `AP_TO_GL` 的子账侧与总账侧同域。
      recognizeFinanceExposure(db, {
        side: 'AP',
        source: { sourceType: VMI_SETTLEMENT_LINE_SOURCE, sourceId: line.id, sourceNo: locked.period_key },
        invoice: null,
        recognitionMode: RECOGNITION_MODES.DIRECT,
        amountCents: allocatedAmountCents,
        businessDate: billDate,
        partyId: locked.supplier_id,
        paymentTermsDays: 0,
        actorId: actor.id,
        createdAt: now,
      });
      // 结算凭证（Requirement §31.24 `VMI-SET-12` / `VMI-SET-AC-05`）：
      // 消耗已经把货物价值从存货侧带走（`Dr 应付 / Cr 存货`，§31.23），结算
      // 账单确认的是**已消耗部分**的应付与成本，因此分录是
      // `借 主营业务成本(COGS) / 贷 应付账款(2202)`。
      //
      // 它**不得**照搬委外加工费账单的 `Dr GRNI / Cr AP`（§31.24.3 第 4 项）：
      // VMI 没有在途物资 —— 货物在收货时已经入账、在消耗时已经出账。
      //
      // 该分录不触及存货科目与存货价值子账，因此 `INVENTORY_VALUE_TO_GL`
      // 保持 0；应付侧子账与总账同步增加，`AP_TO_GL` 也保持 0。
      createSystemVoucher(db, {
        sourceType: VMI_SETTLEMENT_LINE_SOURCE,
        sourceId: line.id,
        businessDate: billDate,
        actorId: actor.id,
        entries: [
          { role: 'COGS', direction: 'DEBIT', amountCents: allocatedAmountCents, summary: `VMI 结算成本 ${locked.period_key}` },
          { role: 'ACCOUNTS_PAYABLE', direction: 'CREDIT', amountCents: allocatedAmountCents, summary: `VMI 结算应付 ${locked.period_key}` },
        ],
        remark: `VMI 结算账单 ${bill.bill_no}`,
      });
      db.prepare(`INSERT INTO vmi_settlement_bill_allocations(
          id,settlement_line_id,supplier_bill_id,supplier_bill_item_id,allocation_event_id,
          allocated_qty,allocated_amount_cents,idempotency_key,request_fingerprint,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        randomUUID(), line.id, bill.id, billItem.id, allocationEventId,
        allocatedQty, allocatedAmountCents,
        `VMI_SETTLEMENT_ALLOCATION:${line.id}`, fingerprint, now,
      );
      db.prepare('UPDATE vmi_settlement_lines SET settled_qty=?,bill_id=?,updated_at=? WHERE id=?')
        .run(allocatedQty, bill.id, now, line.id);
    }
    audit(db, actor.id, 'CREATE', 'VMI_SETTLEMENT_BILL', bill.id, JSON.stringify({
      periodId, periodKey: locked.period_key, agreementId: locked.agreement_id,
      supplierId: locked.supplier_id, billDate,
      lineCount: items.length,
      amountCents: Number(bill.gross_cents || 0),
    }), { businessDate: billDate });
    return bill;
  });
  const posted = postSupplierBill(db, bill.id, actor.id);
  const result = {
    id: posted.id,
    billNo: posted.bill_no,
    grossCents: Number(posted.gross_cents || 0),
    status: posted.status,
    periodId,
  };
  saveIdempotency(db, 'VMI_SETTLEMENT_BILL_CREATE', periodId, idempotencyKey, fingerprint, result);
  return send(res, 201, result);
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
 *
 * Requirement §31.24 `VMI-SET-15` 新增**可结算量** `billableQuantity` 与
 * 「是否可开票」标注；仍然**不**暴露任何结算金额字段。
 */
export function getVmiSummary(db, res, actor, supplierId) {
  assertViewPermission(actor);
  const receipts = db.prepare(`SELECT product_id, SUM(quantity) received_qty FROM vmi_receipts WHERE supplier_id=? AND business_status IN ('CONFIRMED','CONSUMED','TRANSFERRED') GROUP BY product_id`).all(supplierId);
  const consumed = db.prepare(`SELECT r.product_id, SUM(c.quantity) consumed_qty FROM vmi_consumptions c JOIN vmi_receipts r ON r.id=c.vmi_receipt_id WHERE r.supplier_id=? AND c.business_status<>'CANCELLED' GROUP BY r.product_id`).all(supplierId);
  const billable = billableQuantityByProduct(db, supplierId);
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
    const billableEntry = billable.get(entry.productId) || {
      commercialReleasedQty: 0, settledQty: 0, billableQuantity: 0, billable: false,
    };
    return {
      productId: entry.productId,
      received: entry.received,
      consumed: entry.consumed,
      grossRemaining,
      canonicalSupplierOwnedQuantity: canonicalBalance,
      reconciliationDifference: difference,
      reconciliationStatus: difference === 0 ? 'RECONCILED' : 'UNRECONCILED',
      // 可结算量（Requirement §31.24 `VMI-SET-15`）：商业释放量中尚未开票的部分。
      billableQuantity: billableEntry.billableQuantity,
      billable: billableEntry.billable,
    };
  });
  return send(res, 200, { summary });
}

export {
  assertInventoryOwnerDimension,
  rowToAgreement,
  rowToVmiReceipt,
};
