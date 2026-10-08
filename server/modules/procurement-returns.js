import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';

const REQUEST_PERMISSIONS = ['RETURN_REQUEST_VIEW', 'RETURN_REQUEST_MANAGE'];

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
    remark: row.remark,
    creatorId: row.creator_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listReturnRequests(db, res, actor, url) {
  assertViewPermission(actor);
  const status = url.searchParams.get('status');
  const where = [];
  const params = [];
  if (status) { where.push('status=?'); params.push(status); }
  const rows = db.prepare(`SELECT * FROM purchase_return_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 100`).all(...params).map(rowToRequest);
  return send(res, 200, { returnRequests: rows });
}

export async function createReturnRequest(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['receiptId', 'requestDate', 'remark']);
  const receipt = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(body.receiptId);
  if (!receipt) throw new HttpError(404, '采购入库单不存在');
  if (receipt.status !== 'CONFIRMED') throw new HttpError(409, '只有已确认入库单可以发起退货申请');
  const requestId = randomUUID(); const now = new Date().toISOString();
  const requestNo = 'RT' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare(`INSERT INTO purchase_return_requests(id,request_no,receipt_id,supplier_id,warehouse_id,request_date,status,business_mode,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(requestId, requestNo, receipt.id, receipt.supplier_id, receipt.warehouse_id, body.requestDate || now.slice(0, 10), 'DRAFT', receipt.billing_mode || 'SEPARATE', body.remark || '', actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'RETURN_REQUEST', requestId, `创建退货申请 ${requestNo}`);
  });
  return send(res, 201, { id: requestId, requestNo });
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
