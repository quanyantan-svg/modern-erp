import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allowAny, readJson, send,
} from '../lib/http.js';

const VIEW_PERMISSIONS = ['REPORT_VIEW', 'PURCHASE_ORDERS_VIEW', 'OUTSOURCING_VIEW', 'VMI_VIEW'];

function assertViewPermission(actor) { allowAny(actor, VIEW_PERMISSIONS); }

export function getPurchaseExecutionReport(db, res, actor, url) {
  assertViewPermission(actor);
  const supplierId = url.searchParams.get('supplierId');
  const where = ["po.business_type='STANDARD_PURCHASE'"];
  const params = [];
  if (supplierId) { where.push('po.supplier_id=?'); params.push(supplierId); }
  const rows = db.prepare(`SELECT po.id, po.order_no, po.supplier_id, s.name supplier_name,
    po.status, po.business_type,
    COALESCE((SELECT SUM(poi.quantity) FROM purchase_order_items poi WHERE poi.order_id=po.id),0) ordered,
    COALESCE((SELECT SUM(pri.quantity) FROM purchase_receipt_items pri JOIN purchase_receipts pr ON pr.id=pri.receipt_id WHERE pr.purchase_order_id=po.id AND pr.status='CONFIRMED'),0) received,
    COALESCE((SELECT SUM(prti.quantity) FROM purchase_return_items prti JOIN purchase_returns pr ON pr.id=prti.return_id JOIN purchase_receipt_items prei ON prei.id=prti.receipt_item_id JOIN purchase_receipts prh ON prh.id=prei.receipt_id WHERE prh.purchase_order_id=po.id AND pr.status='CONFIRMED'),0) returned,
    COALESCE((SELECT SUM(sbi.net_cents) FROM supplier_bill_items sbi JOIN supplier_bills sb ON sb.id=sbi.bill_id WHERE sbi.purchase_order_item_id IN (SELECT id FROM purchase_order_items WHERE order_id=po.id) AND sb.status IN ('POSTED','WAITING_MATCH')),0) billed_cents
    FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
    WHERE ${where.join(' AND ')}
    ORDER BY po.created_at DESC LIMIT 100`).all(...params)
    .map((row) => ({
      orderId: row.id,
      orderNo: row.order_no,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      status: row.status,
      businessType: row.business_type,
      ordered: Number(row.ordered),
      received: Number(row.received),
      returned: Number(row.returned),
      remaining: Math.max(0, Number(row.ordered) - Number(row.received) + Number(row.returned)),
      billedCents: Number(row.billed_cents),
      onTimeRate: Number(row.ordered) > 0 ? Number(row.received) / Number(row.ordered) : 0,
    }));
  return send(res, 200, { report: rows });
}

export function getOutsourcingExecutionReport(db, res, actor, url) {
  assertViewPermission(actor);
  const supplierId = url.searchParams.get('supplierId');
  const where = ['1=1'];
  const params = [];
  if (supplierId) { where.push('oo.supplier_id=?'); params.push(supplierId); }
  const rows = db.prepare(`SELECT oo.id, oo.order_no, oo.product_id, p.name product_name,
    oo.supplier_id, s.name supplier_name, oo.status, oo.source_type,
    COALESCE((SELECT SUM(required_quantity) FROM outsourcing_material_list WHERE order_id=oo.id),0) materials_count,
    COALESCE((SELECT SUM(quantity) FROM outsourcing_receipts WHERE order_id=oo.id AND business_status<>'CANCELLED'),0) cumulative_finished,
    oo.order_quantity order_quantity,
    COALESCE((SELECT SUM(processing_fee_cents) FROM outsourcing_receipts WHERE order_id=oo.id AND business_status<>'CANCELLED'),0) processing_fee_cents,
    COALESCE((SELECT SUM(backflushed_quantity) FROM outsourcing_material_list WHERE order_id=oo.id),0) backflushed_total
    FROM outsourcing_orders oo JOIN suppliers s ON s.id=oo.supplier_id JOIN products p ON p.id=oo.product_id
    WHERE ${where.join(' AND ')}
    ORDER BY oo.created_at DESC LIMIT 100`).all(...params)
    .map((row) => ({
      orderId: row.id,
      orderNo: row.order_no,
      productId: row.product_id,
      productName: row.product_name,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      status: row.status,
      sourceType: row.source_type,
      materialsCount: Number(row.materials_count),
      cumulativeFinished: Number(row.cumulative_finished),
      orderQuantity: Number(row.order_quantity),
      processingFeeCents: Number(row.processing_fee_cents),
      backflushedTotal: Number(row.backflushed_total),
      progress: Number(row.order_quantity) > 0 ? Math.min(1, Number(row.cumulative_finished) / Number(row.order_quantity)) : 0,
    }));
  return send(res, 200, { report: rows });
}

export function getOutsourcingMaterialPositionReport(db, res, actor, url) {
  assertViewPermission(actor);
  const orderId = url.searchParams.get('orderId');
  const where = ['1=1'];
  const params = [];
  if (orderId) { where.push('oml.order_id=?'); params.push(orderId); }
  const rows = db.prepare(`SELECT oml.order_id, oo.order_no, oml.product_id, p.name product_name,
    oml.required_quantity, oml.unit,
    oml.issued_quantity, oml.supplemented_quantity, oml.returned_quantity, oml.backflushed_quantity,
    (oml.issued_quantity + oml.supplemented_quantity - oml.returned_quantity - oml.backflushed_quantity) supplier_wip_remaining
    FROM outsourcing_material_list oml JOIN outsourcing_orders oo ON oo.id=oml.order_id JOIN products p ON p.id=oml.product_id
    WHERE ${where.join(' AND ')}
    ORDER BY oml.order_id, oml.product_id`).all(...params)
    .map((row) => ({
      orderId: row.order_id,
      orderNo: row.order_no,
      productId: row.product_id,
      productName: row.product_name,
      required: Number(row.required_quantity),
      unit: row.unit,
      issued: Number(row.issued_quantity),
      supplemented: Number(row.supplemented_quantity),
      returned: Number(row.returned_quantity),
      backflushed: Number(row.backflushed_quantity),
      supplierWipRemaining: Number(row.supplier_wip_remaining),
    }));
  return send(res, 200, { report: rows });
}

/**
 * Opening support: opening outsourcing order and supplier-WIP position are stored as
 * documented business records. No fabricated historical voucher.
 */
export async function createOpeningOutsourcingOrder(db, req, res, actor) {
  allowAny(actor, ['OUTSOURCING_MANAGE', 'OUTSOURCING_RELEASE']);
  const body = await readJson(req);
  const id = randomUUID();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO outsourcing_orders(id,order_no,supplier_id,product_id,order_quantity,required_quantity,unit,source_type,status,business_date,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'MANUAL','COMPLETED',?,?,?,?,?)`).run(
      id, body.orderNo || ('OS-OPEN-' + Date.now().toString().slice(-10)),
      body.supplierId, body.productId, Number(body.orderQuantity), Number(body.orderQuantity),
      body.unit || 'EA', body.businessDate || now.slice(0, 10),
      'OPENING: 历史期初委外订单，不生成历史凭证', actor.id, now, now,
    );
    audit(db, actor.id, 'OPENING', 'OUTSOURCING_ORDER', id, '期初历史');
  });
  return send(res, 201, { id });
}
