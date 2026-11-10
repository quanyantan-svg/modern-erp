import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';
import {
  assertRemainingQuantity, configureTrackedDocumentLines, normalizeSourcedLogisticsItems, replaceLogisticsItems,
} from './logistics-core.js';

const REQUEST_PERMISSIONS = ['RETURN_REQUEST_VIEW', 'RETURN_REQUEST_MANAGE'];
const REQUEST_TYPES = new Set(['QUALITY', 'COMMERCIAL', 'STOCK', 'OTHER']);
const REPLENISHMENT_METHODS = new Set(['NONE', 'REORDER', 'REPLACE_SHIPMENT']);

function atomic(db, work) { return db.isTransaction ? work() : transaction(db, work); }

function assertViewPermission(actor) { allowAny(actor, REQUEST_PERMISSIONS); }
function assertManagePermission(actor) { allow(actor, 'RETURN_REQUEST_MANAGE'); }

function rowToRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestNo: row.request_no,
    receiptId: row.receipt_id,
    supplierId: row.supplier_id,
    warehouseId: row.warehouse_id,
    requestDate: row.request_date,
    status: row.status,
    businessMode: row.business_mode,
    sourceType: row.source_type,
    sourceId: row.source_id,
    requestType: row.request_type,
    reasonCode: row.reason_code,
    reasonText: row.reason_text,
    replenishmentMethod: row.replenishment_method,
    businessDate: row.business_date,
    postedReturnId: row.posted_return_id,
    remark: row.remark,
    creatorId: row.creator_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requestItems(db, requestId) {
  return db.prepare(`SELECT i.*, p.code productCode, p.name productName FROM purchase_return_request_items i
    JOIN products p ON p.id=i.product_id WHERE i.request_id=? ORDER BY i.line_no`).all(requestId)
    .map((row) => ({
      id: row.id,
      receiptItemId: row.receipt_item_id,
      productId: row.product_id,
      productCode: row.productCode,
      productName: row.productName,
      quantity: Number(row.quantity_num) / Number(row.quantity_den),
      quantityNumerator: Number(row.quantity_num),
      quantityDenominator: Number(row.quantity_den),
      unitPriceCents: Number(row.unit_price_cents),
      amountCents: Number(row.amount_cents),
      lineNo: Number(row.line_no),
    }));
}

/**
 * Canonical DRAFT purchase return writer.
 *
 * The purchase return execution layer (the four-branch financial outcome) is
 * unchanged; this only owns the document. A return request posts through the
 * same writer so the business-intent layer and the execution layer cannot
 * drift apart (Active Design §26.14).
 */
export function createPurchaseReturnDraftCanonical(db, actor, {
  receiptId, supplierId, warehouseId, remark, items, returnDate, returnRequestId = null,
}) {
  const source = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(receiptId);
  if (!source) throw new HttpError(400, '采购入库单不存在');
  if (source.status !== 'CONFIRMED') throw new HttpError(409, '只有已确认入库单可以退货');
  if (supplierId !== undefined && supplierId !== source.supplier_id) throw new HttpError(400, '供应商与采购入库单不一致');
  if (warehouseId !== undefined && warehouseId !== source.warehouse_id) throw new HttpError(400, '仓库与采购入库单不一致');
  const input = normalizeSourcedLogisticsItems(db, items, {
    sourceTable: 'purchase_receipt_items', sourceHeaderColumn: 'receipt_id', sourceHeaderId: receiptId,
    sourceIdCamel: 'receiptItemId', sourceIdSnake: 'receipt_item_id',
  });
  assertRemainingQuantity(db, input, {
    itemTable: 'purchase_return_items', sourceColumn: 'receipt_item_id',
    headerTable: 'purchase_returns', headerForeignKey: 'return_id',
  }, '退货');
  const returnId = randomUUID();
  const now = new Date().toISOString();
  const returnNo = 'PRET' + Date.now().toString().slice(-10);
  atomic(db, () => {
    db.prepare(`INSERT INTO purchase_returns(id,return_no,receipt_id,supplier_id,warehouse_id,status,total_cents,return_date,remark,creator_id,created_at,updated_at,return_request_id)
      VALUES(?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?)`).run(returnId, returnNo, receiptId, source.supplier_id, source.warehouse_id, input.totalCents, returnDate, remark || '', actor.id, now, now, returnRequestId);
    replaceLogisticsItems(db, 'purchase_return_items', 'return_id', returnId, input.items, 'receipt_item_id');
    configureTrackedDocumentLines(db, { sourceType: 'PURCHASE_RETURN', sourceId: returnId, itemTable: 'purchase_return_items', foreignKey: 'return_id', rawItems: items });
    audit(db, actor.id, 'CREATE', 'PURCHASE_RETURN', returnId, '创建采购退货单 ' + returnNo);
  });
  return { id: returnId, returnNo };
}

export function listReturnRequests(db, res, actor, url) {
  assertViewPermission(actor);
  const status = url.searchParams.get('status');
  const where = [];
  const params = [];
  if (status) { where.push('status=?'); params.push(status); }
  const rows = db.prepare(`SELECT * FROM purchase_return_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 100`).all(...params).map(rowToRequest);
  for (const request of rows) request.items = requestItems(db, request.id);
  return send(res, 200, { returnRequests: rows });
}

/**
 * The return request is the business-intent layer: it states what is returned,
 * why, how much and how the supply is replenished. It never executes an
 * inventory return itself, and goods that were never received have no source
 * line at all (Active Design §26.14 / Requirement §31.3.1 PRC-24).
 */
export async function createReturnRequest(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['receiptId', 'requestType', 'reasonCode', 'reasonText', 'replenishmentMethod', 'requestDate', 'businessDate', 'remark', 'items']);
  const receipt = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(body.receiptId);
  if (!receipt) throw new HttpError(404, '采购入库单不存在');
  if (receipt.status !== 'CONFIRMED') throw new HttpError(409, '只有已确认入库单可以发起退货申请');
  const requestType = String(body.requestType || 'COMMERCIAL').toUpperCase();
  if (!REQUEST_TYPES.has(requestType)) throw new HttpError(400, '退货类型不正确');
  const replenishmentMethod = String(body.replenishmentMethod || 'NONE').toUpperCase();
  if (!REPLENISHMENT_METHODS.has(replenishmentMethod)) throw new HttpError(400, '补料方式不正确');
  const requested = Array.isArray(body.items) ? body.items : [];
  if (!requested.length) throw new HttpError(400, '退货申请必须至少有一条明细');
  const lines = [];
  for (const [index, item] of requested.entries()) {
    const receiptItemId = String(item.receiptItemId ?? item.receipt_item_id ?? '').trim();
    if (!receiptItemId) throw new HttpError(400, `第 ${index + 1} 行必须指定来源入库明细`);
    const sourceLine = db.prepare('SELECT * FROM purchase_receipt_items WHERE id=? AND receipt_id=?').get(receiptItemId, receipt.id);
    if (!sourceLine) throw new HttpError(409, `第 ${index + 1} 行来源入库明细不属于该入库单`);
    const numerator = Number(item.quantityNumerator ?? item.quantity_num ?? item.quantity);
    const denominator = Number(item.quantityDenominator ?? item.quantity_den ?? 1);
    if (!Number.isSafeInteger(numerator) || numerator <= 0 || !Number.isSafeInteger(denominator) || denominator <= 0) {
      throw new HttpError(400, `第 ${index + 1} 行退货数量必须为正有理数`);
    }
    lines.push({ sourceLine, numerator, denominator, index });
  }
  const requestId = randomUUID(); const now = new Date().toISOString();
  const requestNo = 'RT' + Date.now().toString().slice(-10);
  atomic(db, () => {
    db.prepare(`INSERT INTO purchase_return_requests(id,request_no,receipt_id,supplier_id,warehouse_id,request_date,status,business_mode,remark,creator_id,created_at,updated_at,
        source_type,source_id,request_type,reason_code,reason_text,replenishment_method,business_date)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'PURCHASE_RECEIPT',?,?,?,?,?,?)`).run(
      requestId, requestNo, receipt.id, receipt.supplier_id, receipt.warehouse_id,
      body.requestDate || now.slice(0, 10), 'DRAFT', receipt.billing_mode || 'SEPARATE', body.remark || '',
      actor.id, now, now, receipt.id, requestType, body.reasonCode || null, body.reasonText || null,
      replenishmentMethod, body.businessDate || body.requestDate || now.slice(0, 10),
    );
    const insertItem = db.prepare(`INSERT INTO purchase_return_request_items(id,request_id,receipt_item_id,product_id,quantity_num,quantity_den,unit_price_cents,amount_cents,line_no)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    for (const line of lines) {
      const amountCents = Math.round(Number(line.sourceLine.unit_price_cents || 0) * line.numerator / line.denominator);
      insertItem.run(randomUUID(), requestId, line.sourceLine.id, line.sourceLine.product_id,
        line.numerator, line.denominator, Number(line.sourceLine.unit_price_cents || 0), amountCents, line.index + 1);
    }
    audit(db, actor.id, 'CREATE', 'RETURN_REQUEST', requestId, `创建退货申请 ${requestNo}`);
  });
  return send(res, 201, { id: requestId, requestNo });
}

/**
 * Post a return request: the request becomes the business intent of a real
 * DRAFT purchase return. The execution layer still owns the four-branch
 * financial outcome at confirm time.
 */
export async function postReturnRequest(db, req, res, actor, requestId) {
  assertManagePermission(actor);
  const request = db.prepare('SELECT * FROM purchase_return_requests WHERE id=?').get(requestId);
  if (!request) throw new HttpError(404, '退货申请不存在');
  if (request.status === 'CONVERTED') {
    return send(res, 200, { id: requestId, postedReturnId: request.posted_return_id, replayed: true });
  }
  if (request.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的退货申请可以转换');
  const receipt = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(request.receipt_id);
  if (!receipt || receipt.status !== 'CONFIRMED') throw new HttpError(409, '来源入库单不存在或未确认');
  const items = requestItems(db, requestId);
  if (!items.length) throw new HttpError(409, '退货申请没有明细，无法转换');
  const now = new Date().toISOString();
  let created;
  atomic(db, () => {
    const locked = db.prepare('SELECT * FROM purchase_return_requests WHERE id=?').get(requestId);
    if (locked.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的退货申请可以转换');
    created = createPurchaseReturnDraftCanonical(db, actor, {
      receiptId: locked.receipt_id,
      supplierId: locked.supplier_id,
      warehouseId: locked.warehouse_id,
      remark: locked.remark,
      returnDate: locked.business_date || locked.request_date || now.slice(0, 10),
      returnRequestId: locked.id,
      items: items.map((item) => ({
        receiptItemId: item.receiptItemId,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        lineNo: item.lineNo,
      })),
    });
    db.prepare('UPDATE purchase_return_requests SET status=?,posted_return_id=?,updated_at=? WHERE id=?')
      .run('CONVERTED', created.id, now, requestId);
    audit(db, actor.id, 'POST', 'RETURN_REQUEST', requestId, `转换退货申请为采购退货单 ${created.returnNo}`);
  });
  return send(res, 201, { id: requestId, postedReturnId: created.id, returnNo: created.returnNo });
}

export async function cancelReturnRequest(db, req, res, actor, requestId) {
  assertManagePermission(actor);
  const request = db.prepare('SELECT * FROM purchase_return_requests WHERE id=?').get(requestId);
  if (!request) throw new HttpError(404, '退货申请不存在');
  if (request.status === 'REJECTED') return send(res, 200, { ok: true, status: 'REJECTED' });
  if (request.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的退货申请可以取消');
  const now = new Date().toISOString();
  atomic(db, () => {
    db.prepare('UPDATE purchase_return_requests SET status=?,updated_at=? WHERE id=? AND status=?')
      .run('REJECTED', now, requestId, 'DRAFT');
    audit(db, actor.id, 'CANCEL', 'RETURN_REQUEST', requestId, `取消退货申请 ${request.request_no}`);
  });
  return send(res, 200, { ok: true, status: 'REJECTED' });
}

/**
 * Compute the 4-branch Purchase Return financial outcome based on receipt billing mode.
 * - LEGACY_DIRECT: full AP credit (Dr Inventory reversal; Cr AP)
 * - SEPARATE unbilled: GRNI reversal only (no AP credit)
 * - SEPARATE billed: AP credit (billed portion)
 * - SEPARATE partial billed: billed-first deterministic split
 */
export function planPurchaseReturnBranches(db, receiptId) {
  const receipt = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(receiptId);
  if (!receipt) throw new HttpError(404, '采购入库单不存在');
  const billedRows = db.prepare(`SELECT COALESCE(SUM(sbi.base_quantity_num*1.0/sbi.base_quantity_den),0) billed_qty,
    COALESCE(SUM(sbi.net_cents),0) billed_cents
    FROM supplier_bill_items sbi JOIN supplier_bills sb ON sb.id=sbi.bill_id
    WHERE sbi.receipt_id=? AND sb.status IN ('POSTED','WAITING_MATCH')`).get(receiptId);
  const received = Number(db.prepare('SELECT COALESCE(SUM(quantity),0) qty FROM purchase_receipt_items WHERE receipt_id=?').get(receiptId).qty);
  const billedQty = Number(billedRows.billed_qty || 0);
  const billedCents = Number(billedRows.billed_cents || 0);
  const branch = receipt.billing_mode === 'LEGACY_DIRECT'
    ? 'LEGACY_AP_CREDIT'
    : billedQty === 0
      ? 'SEPARATE_GRNI_REVERSAL'
      : billedQty >= received
        ? 'SEPARATE_AP_CREDIT'
        : 'SEPARATE_PARTIAL_BILLED_FIRST';
  return {
    receiptId,
    billingMode: receipt.billing_mode,
    receivedQuantity: received,
    billedQuantity: billedQty,
    billedCents,
    branch,
    expected: {
      grniReversalCents: branch === 'SEPARATE_GRNI_REVERSAL' ? receipt.total_cents : (branch === 'SEPARATE_PARTIAL_BILLED_FIRST' ? Math.max(0, receipt.total_cents - billedCents) : 0),
      apCreditCents: branch === 'LEGACY_AP_CREDIT' ? receipt.total_cents : (branch === 'SEPARATE_AP_CREDIT' ? billedCents : (branch === 'SEPARATE_PARTIAL_BILLED_FIRST' ? billedCents : 0)),
    },
  };
}
