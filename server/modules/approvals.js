import { HttpError, send } from '../lib/http.js';

const TABS = new Set(['pending', 'approved', 'rejected', 'created']);

const DOCUMENTS = [
  {
    type: 'SALES_ORDER',
    label: '销售订单',
    view: 'ORDERS_VIEW',
    approve: 'ORDERS_APPROVE',
    supportsReject: true,
    table: 'sales_orders',
    alias: 'so',
    reviewerColumn: 'reviewer_id',
    approvedStatus: 'APPROVED',
    handledColumn: 'reviewed_at',
    sql: `SELECT so.id,so.order_no documentNo,so.status,so.total_cents amountCents,
      so.remark,so.rejection_reason rejectionReason,so.creator_id initiatorId,
      creator.display_name initiatorName,reviewer.display_name handlerName,
      so.created_at createdAt,so.submitted_at submittedAt,so.reviewed_at handledAt,
      so.order_date orderDate,so.requested_delivery_date requestedDeliveryDate,so.payment_terms paymentTerms,
      so.ship_to_contact_name shipToContactName,so.ship_to_phone shipToPhone,so.ship_to_address shipToAddress,
      c.name partyName,(SELECT COUNT(*) FROM sales_order_items i WHERE i.order_id=so.id) itemCount
      FROM sales_orders so JOIN customers c ON c.id=so.customer_id
      JOIN users creator ON creator.id=so.creator_id LEFT JOIN users reviewer ON reviewer.id=so.reviewer_id`,
  },
  {
    type: 'PURCHASE_ORDER',
    label: '采购订单',
    view: 'PURCHASE_ORDERS_VIEW',
    approve: 'PURCHASE_ORDERS_APPROVE',
    supportsReject: true,
    table: 'purchase_orders',
    alias: 'po',
    reviewerColumn: 'reviewer_id',
    approvedStatus: 'APPROVED',
    handledColumn: 'reviewed_at',
    sql: `SELECT po.id,po.order_no documentNo,po.status,po.total_cents amountCents,
      po.remark,po.rejection_reason rejectionReason,po.creator_id initiatorId,
      creator.display_name initiatorName,reviewer.display_name handlerName,
      po.created_at createdAt,po.submitted_at submittedAt,po.reviewed_at handledAt,
      po.order_date orderDate,po.expected_delivery_date expectedDeliveryDate,po.payment_terms paymentTerms,
      po.supplier_contact_name supplierContactName,po.supplier_contact_phone supplierContactPhone,po.supplier_address supplierAddress,
      s.name partyName,(SELECT COUNT(*) FROM purchase_order_items i WHERE i.order_id=po.id) itemCount
      FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
      JOIN users creator ON creator.id=po.creator_id LEFT JOIN users reviewer ON reviewer.id=po.reviewer_id`,
  },
  {
    type: 'INVENTORY_CHECK',
    label: '库存盘点',
    view: 'INVENTORY_VIEW',
    approve: 'INVENTORY_CHECK_APPROVE',
    supportsReject: false,
    table: 'inventory_checks',
    alias: 'ic',
    reviewerColumn: 'reviewer_id',
    approvedStatus: 'APPROVED',
    handledColumn: 'reviewed_at',
    sql: `SELECT ic.id,ic.check_no documentNo,ic.status,NULL amountCents,
      COALESCE(ic.remark,ic.reason,'') remark,'' rejectionReason,ic.creator_id initiatorId,
      creator.display_name initiatorName,reviewer.display_name handlerName,
      ic.created_at createdAt,ic.checked_at submittedAt,ic.reviewed_at handledAt,
      w.name partyName,1 itemCount,p.name productName,p.unit,
      ic.system_quantity systemQuantity,ic.actual_quantity actualQuantity,ic.difference
      FROM inventory_checks ic JOIN warehouses w ON w.id=ic.warehouse_id
      JOIN products p ON p.id=ic.product_id JOIN users creator ON creator.id=ic.creator_id
      LEFT JOIN users reviewer ON reviewer.id=ic.reviewer_id`,
  },
  {
    type: 'ACCOUNTING_VOUCHER',
    label: '记账凭证',
    view: 'ACCOUNTING_VIEW',
    approve: 'VOUCHER_APPROVE',
    supportsReject: true,
    table: 'accounting_vouchers',
    alias: 'av',
    reviewerColumn: 'approver_id',
    approvedStatus: 'POSTED',
    handledColumn: 'approved_at',
    sql: `SELECT av.id,av.voucher_no documentNo,av.status,
      (SELECT COALESCE(SUM(e.amount_cents),0) FROM accounting_entries e
        WHERE e.voucher_id=av.id AND e.direction='DEBIT') amountCents,
      av.remark,COALESCE(av.rejection_reason,'') rejectionReason,av.creator_id initiatorId,
      creator.display_name initiatorName,approver.display_name handlerName,
      av.created_at createdAt,av.submitted_at submittedAt,av.approved_at handledAt,
      av.source_type partyName,
      (SELECT COUNT(*) FROM accounting_entries e WHERE e.voucher_id=av.id) itemCount
      FROM accounting_vouchers av JOIN users creator ON creator.id=av.creator_id
      LEFT JOIN users approver ON approver.id=av.approver_id`,
  },
  {
    type: 'PURCHASE_REQUISITION',
    label: '请购单',
    view: 'PURCHASE_REQUISITION_VIEW',
    approve: 'PURCHASE_REQUISITION_APPROVE',
    supportsReject: true,
    table: 'purchase_requisitions',
    alias: 'pr',
    reviewerColumn: 'reviewer_id',
    approvedStatus: 'APPROVED',
    handledColumn: 'reviewed_at',
    sql: `SELECT pr.id,pr.requisition_no documentNo,pr.status,
      COALESCE((SELECT SUM(amount_cents) FROM purchase_requisition_items WHERE requisition_id=pr.id),0) amountCents,
      pr.notes remark,COALESCE(pr.rejection_reason,'') rejectionReason,pr.creator_id initiatorId,
      creator.display_name initiatorName,reviewer.display_name handlerName,
      pr.created_at createdAt,pr.submitted_at submittedAt,pr.reviewed_at handledAt,
      (SELECT pi.instruction_no FROM purchase_instructions pi WHERE pi.id=pr.source_instruction_id) partyName,
      (SELECT COUNT(*) FROM purchase_requisition_items WHERE requisition_id=pr.id) itemCount,
      (SELECT COALESCE(SUM(quantity),0) FROM purchase_requisition_items WHERE requisition_id=pr.id) systemQuantity
      FROM purchase_requisitions pr
      JOIN users creator ON creator.id=pr.creator_id
      LEFT JOIN users reviewer ON reviewer.id=pr.reviewer_id`,
  },
  {
    type: 'PRODUCTION_ORDER',
    label: '生产工单',
    view: 'PRODUCTION_ORDERS_VIEW',
    approve: 'PRODUCTION_ORDERS_APPROVE',
    supportsReject: true,
    table: 'production_orders',
    alias: 'mo',
    reviewerColumn: 'approved_by',
    rejectedReviewerColumn: 'rejected_by',
    approvedStatus: 'APPROVED',
    handledColumn: 'approved_at',
    rejectedHandledColumn: 'rejected_at',
    sql: `SELECT mo.id,mo.order_no documentNo,mo.status,NULL amountCents,
      mo.remark,mo.rejection_reason rejectionReason,mo.creator_id initiatorId,
      creator.display_name initiatorName,COALESCE(approver.display_name,rejected.display_name) handlerName,
      mo.created_at createdAt,mo.submitted_at submittedAt,COALESCE(mo.approved_at,mo.rejected_at) handledAt,
      p.name partyName,1 itemCount,mo.quantity systemQuantity
      FROM production_orders mo JOIN products p ON p.id=mo.product_id
      JOIN users creator ON creator.id=mo.creator_id
      LEFT JOIN users approver ON approver.id=mo.approved_by
      LEFT JOIN users rejected ON rejected.id=mo.rejected_by`,
  },
];

const STATUS_LABELS = {
  DRAFT: '草稿', ENTERED: '草稿', SUBMITTED: '待审批',
  APPROVED: '已审批', POSTED: '已审批', REJECTED: '已驳回',
};

function can(actor, permission) {
  return actor.permissions.includes(permission);
}

function whereFor(document, tab, actorId) {
  const prefix = document.alias;
  if (tab === 'pending') return { sql: `${prefix}.status='SUBMITTED' AND ${prefix}.creator_id<>?`, params: [actorId] };
  if (tab === 'approved') return { sql: `${prefix}.status=? AND ${prefix}.${document.reviewerColumn}=?`, params: [document.approvedStatus, actorId] };
  if (tab === 'rejected') return { sql: `${prefix}.status='REJECTED' AND ${prefix}.${document.rejectedReviewerColumn || document.reviewerColumn}=?`, params: [actorId] };
  return { sql: `${prefix}.creator_id=?`, params: [actorId] };
}

function relevantTimestamp(row, tab) {
  if (tab === 'pending') return row.submittedAt || row.createdAt;
  if (tab === 'approved' || tab === 'rejected') return row.handledAt || row.createdAt;
  return row.createdAt;
}

function normalizeRow(document, row, tab) {
  const pending = tab === 'pending' && row.status === 'SUBMITTED';
  let summary = row.partyName || '';
  if (document.type === 'INVENTORY_CHECK') {
    const difference = Number(row.difference || 0);
    summary = `${row.partyName} · ${row.productName} · 差异 ${difference > 0 ? '+' : ''}${difference} ${row.unit}`;
  }
  return {
    key: `${document.type}:${row.id}`,
    documentType: document.type,
    documentTypeLabel: document.label,
    documentId: row.id,
    documentNo: row.documentNo,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    initiatorId: row.initiatorId,
    initiatorName: row.initiatorName,
    handlerName: row.handlerName || '',
    createdAt: row.createdAt,
    submittedAt: row.submittedAt,
    handledAt: row.handledAt,
    amountCents: row.amountCents == null ? null : Number(row.amountCents),
    orderDate: row.orderDate || '',
    requestedDeliveryDate: row.requestedDeliveryDate || '',
    expectedDeliveryDate: row.expectedDeliveryDate || '',
    paymentTerms: row.paymentTerms || '',
    shipToContactName: row.shipToContactName || '',
    shipToPhone: row.shipToPhone || '',
    shipToAddress: row.shipToAddress || '',
    supplierContactName: row.supplierContactName || '',
    supplierContactPhone: row.supplierContactPhone || '',
    supplierAddress: row.supplierAddress || '',
    summary,
    partyName: row.partyName || '',
    remark: row.remark || '',
    rejectionReason: row.rejectionReason || '',
    itemCount: Number(row.itemCount || 0),
    systemQuantity: row.systemQuantity == null ? null : Number(row.systemQuantity),
    actualQuantity: row.actualQuantity == null ? null : Number(row.actualQuantity),
    difference: row.difference == null ? null : Number(row.difference),
    canApprove: pending,
    canReject: pending && document.supportsReject,
    sortAt: relevantTimestamp(row, tab),
  };
}

function addLinePreviews(db, items) {
  for (const item of items) {
    if (item.documentType === 'SALES_ORDER' || item.documentType === 'PURCHASE_ORDER') {
      const table = item.documentType === 'SALES_ORDER' ? 'sales_order_items' : 'purchase_order_items';
      item.lines = db.prepare(`SELECT p.name productName,p.unit,i.quantity,
        i.unit_price_cents unitPriceCents,i.amount_cents amountCents
        FROM ${table} i JOIN products p ON p.id=i.product_id WHERE i.order_id=? ORDER BY i.line_no LIMIT 3`).all(item.documentId);
    } else if (item.documentType === 'ACCOUNTING_VOUCHER') {
      item.lines = db.prepare(`SELECT s.name subjectName,e.direction,e.amount_cents amountCents,e.summary
        FROM accounting_entries e JOIN accounting_subjects s ON s.id=e.subject_id
        WHERE e.voucher_id=? ORDER BY e.direction DESC,e.id LIMIT 4`).all(item.documentId);
    } else {
      item.lines = [];
    }
  }
}

export function listApprovals(db, res, actor, url) {
  const tab = url.searchParams.get('tab') || 'pending';
  if (!TABS.has(tab)) throw new HttpError(400, '无效的审批分类');
  const requestedLimit = Number(url.searchParams.get('limit') || 50);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 100)) : 50;
  const counts = { pending: 0, approved: 0, rejected: 0, created: 0 };
  let selected = [];

  for (const document of DOCUMENTS) {
    const reviewerVoucher=document.type==='ACCOUNTING_VOUCHER'&&actor.roleCode==='REVIEWER';
    const mayView = reviewerVoucher||can(actor, document.view);
    const mayApprove = reviewerVoucher||can(actor, document.approve);
    for (const candidateTab of TABS) {
      const eligible = mayView && (candidateTab === 'created' || mayApprove) && !(candidateTab === 'rejected' && !document.supportsReject);
      if (!eligible) continue;
      const filter = whereFor(document, candidateTab, actor.id);
      counts[candidateTab] += db.prepare(`SELECT COUNT(*) count FROM ${document.table} ${document.alias} WHERE ${filter.sql}`).get(...filter.params).count;
    }
    const eligibleForSelected = mayView && (tab === 'created' || mayApprove) && !(tab === 'rejected' && !document.supportsReject);
    if (!eligibleForSelected) continue;
    const filter = whereFor(document, tab, actor.id);
    const rows = db.prepare(`${document.sql} WHERE ${filter.sql}
      ORDER BY ${tab === 'pending' ? `${document.alias}.${document.type === 'INVENTORY_CHECK' ? 'checked_at' : 'submitted_at'}` : tab === 'created' ? `${document.alias}.created_at` : `${document.alias}.${tab === 'rejected' && document.rejectedHandledColumn ? document.rejectedHandledColumn : document.handledColumn}`} DESC,
      ${document.alias}.id DESC LIMIT 100`).all(...filter.params);
    selected.push(...rows.map((row) => normalizeRow(document, row, tab)));
  }

  selected.sort((a, b) => String(b.sortAt || '').localeCompare(String(a.sortAt || '')) || String(b.documentId).localeCompare(String(a.documentId)));
  const items = selected.slice(0, limit);
  addLinePreviews(db, items);
  for (const item of items) delete item.sortAt;
  return send(res, 200, { tab, limit, counts, items });
}

export const APPROVAL_DOCUMENT_TYPES = DOCUMENTS.map(({ type }) => type);
