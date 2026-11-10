// 委外核心执行工作面的只读投影。
//
// 这些函数只读取现有权威表（委外订单、完工通知、委外收货、加工费 PO 与主数据），
// 不新增业务表、不写任何业务事实（Design §26.35.6）。
//
// 受限岗位投影的边界（Requirement §31.15 `OUT-WB-REQ-04/05`）：
//   - 委外收货员只得到订单号、供应商、产品、数量、加工费 PO 编号/行、
//     通知与收货编号/状态，以及完成收货所必需的仓库与行来源字段；
//   - 材料成本、Supplier WIP 身份明细、用料行与订单的其他敏感投影一律不返回；
//   - 投影是白名单序列化，不得 `SELECT *` 后整体透传。

import { qualityConfig } from './quality-gates.js';

const EPSILON = 1e-9;

// 质检来源判别值取自 canonical 质量来源家族（`quality-gates.js`），
// 本模块不另立一份来源字面量：成品来源类型由成品 Writer 独占，
// 这里只复用同一族的质量判别名。
const IQC_SOURCE_TYPES = qualityConfig('IQC').sourceTypes;
const OUTSOURCING_QUALITY_SOURCE_TYPE = Object.keys(IQC_SOURCE_TYPES)
  .find((key) => IQC_SOURCE_TYPES[key].sourceHeaderTable === 'outsourcing_receipts');

function quantity(value) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function boundedLimit(raw, fallback = 50, max = 200) {
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function boundedOffset(raw) {
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return 0;
  return parsed;
}

function searchTerm(query) {
  const text = String(query ?? '').trim();
  if (!text) return null;
  // 只作为 LIKE 参数绑定，不参与 SQL 拼接。
  return `%${text.replace(/[%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * 委外收货员的任务投影。返回 `null` 表示订单不存在。
 * 数量口径：已生效 / 待检 / 累计已收 / 剩余可收，均来自权威收货明细。
 */
export function readOutsourcingReceivingContext(db, orderId) {
  const order = db.prepare(`SELECT id, order_no, supplier_id, product_id, order_quantity, unit, status,
      business_date, expected_completion_date
    FROM outsourcing_orders WHERE id=?`).get(orderId);
  if (!order) return null;

  const supplier = db.prepare('SELECT id, code, name FROM suppliers WHERE id=?').get(order.supplier_id);
  const product = db.prepare('SELECT id, code, name, tracking_policy, base_uom_code, unit FROM products WHERE id=?').get(order.product_id);

  // 加工费 PO：只暴露编号、审批状态与行来源，不暴露单价与金额。
  const processingPoRow = db.prepare(`SELECT id, order_no, status, supplier_id, source_outsourcing_order_id
    FROM purchase_orders
    WHERE business_type='OUTSOURCE_PROCESSING' AND source_outsourcing_order_id=?
    ORDER BY created_at, id`).get(order.id);
  let processingPo = null;
  if (processingPoRow) {
    const items = db.prepare(`SELECT id, product_id, quantity, document_uom_code, line_no
      FROM purchase_order_items WHERE order_id=? ORDER BY line_no, id`).all(processingPoRow.id);
    processingPo = {
      id: processingPoRow.id,
      poNo: processingPoRow.order_no,
      status: processingPoRow.status,
      items: items.map((item) => ({
        id: item.id,
        productId: item.product_id,
        quantity: quantity(item.quantity),
        unitCode: item.document_uom_code || null,
        lineNo: item.line_no,
      })),
    };
  }

  const notices = db.prepare(`SELECT id, notice_no, status, warehouse_id, notice_date, created_at
    FROM receipt_notices
    WHERE outsourcing_order_id=? AND business_type='OUTSOURCE'
    ORDER BY created_at, id`).all(order.id).map((notice) => {
    const items = db.prepare(`SELECT id, product_id, quantity, purchase_order_item_id
      FROM receipt_notice_items WHERE notice_id=? ORDER BY line_no, id`).all(notice.id);
    return {
      id: notice.id,
      noticeNo: notice.notice_no,
      status: notice.status,
      warehouseId: notice.warehouse_id,
      noticeDate: notice.notice_date,
      quantity: items.reduce((sum, item) => sum + quantity(item.quantity), 0),
      items: items.map((item) => ({
        id: item.id,
        productId: item.product_id,
        quantity: quantity(item.quantity),
        purchaseOrderItemId: item.purchase_order_item_id,
      })),
    };
  });

  const receipts = db.prepare(`SELECT id, receipt_no, business_status, quantity, warehouse_id,
      source_notice_id, processing_po_id, received_date, business_date
    FROM outsourcing_receipts WHERE order_id=? ORDER BY created_at, id`).all(order.id).map((receipt) => {
    const items = db.prepare(`SELECT id, product_id, quantity, unit_code, lot_id, serial_id,
        processing_po_item_id, source_notice_item_source_id
      FROM outsourcing_receipt_items WHERE receipt_id=? ORDER BY line_no, id`).all(receipt.id);
    return {
      id: receipt.id,
      receiptNo: receipt.receipt_no,
      businessStatus: receipt.business_status,
      quantity: quantity(receipt.quantity),
      warehouseId: receipt.warehouse_id,
      sourceNoticeId: receipt.source_notice_id,
      processingPoId: receipt.processing_po_id,
      receivedDate: receipt.received_date,
      businessDate: receipt.business_date,
      items: items.map((item) => ({
        id: item.id,
        productId: item.product_id,
        quantity: quantity(item.quantity),
        unitCode: item.unit_code,
        lotId: item.lot_id,
        serialId: item.serial_id,
        processingPoItemId: item.processing_po_item_id,
        sourceNoticeItemId: item.source_notice_item_source_id,
      })),
    };
  });

  const effectedQuantity = receipts
    .filter((receipt) => receipt.businessStatus === 'EFFECTED')
    .reduce((sum, receipt) => sum + receipt.quantity, 0);
  const pendingQuantity = receipts
    .filter((receipt) => receipt.businessStatus === 'PENDING_INSPECTION')
    .reduce((sum, receipt) => sum + receipt.quantity, 0);
  const orderedQuantity = quantity(order.order_quantity);

  return {
    order: {
      id: order.id,
      orderNo: order.order_no,
      supplierId: order.supplier_id,
      supplierCode: supplier?.code || null,
      supplierName: supplier?.name || null,
      productId: order.product_id,
      productCode: product?.code || null,
      productName: product?.name || null,
      orderQuantity: orderedQuantity,
      unit: order.unit,
      status: order.status,
      businessDate: order.business_date,
      expectedCompletionDate: order.expected_completion_date,
    },
    processingPo,
    notices,
    receipts,
    // 收货必要目标仓：受限岗位没有委外业务读权限，目标仓由收货上下文自带。
    warehouses: db.prepare('SELECT id, code, name FROM warehouses WHERE active=1 ORDER BY code').all()
      .map((warehouse) => ({ id: warehouse.id, code: warehouse.code, name: warehouse.name })),
    quantities: {
      ordered: orderedQuantity,
      effected: effectedQuantity,
      pendingInspection: pendingQuantity,
      remainingToReceive: Math.max(0, orderedQuantity - effectedQuantity - pendingQuantity),
    },
    nextActions: nextReceivingActions({ order, processingPo, notices, receipts, effectedQuantity, pendingQuantity, orderedQuantity }),
  };
}

function nextReceivingActions({ order, processingPo, notices, receipts, effectedQuantity, pendingQuantity, orderedQuantity }) {
  const actions = [];
  if (order.status !== 'RELEASED') return actions;
  const approvedPo = processingPo && processingPo.status === 'APPROVED' ? processingPo : null;
  if (!approvedPo) return actions;
  const openNotice = notices.find((notice) => notice.status === 'DRAFT');
  const confirmedNotice = notices.find((notice) => notice.status === 'CONFIRMED');
  if (openNotice) actions.push('CONFIRM_NOTICE');
  else if (!confirmedNotice) actions.push('CREATE_NOTICE');
  if (confirmedNotice) {
    const alreadyPending = receipts.some((receipt) => receipt.businessStatus === 'PENDING_INSPECTION'
      && receipt.sourceNoticeId === confirmedNotice.id);
    if (!alreadyPending && effectedQuantity + pendingQuantity < orderedQuantity + EPSILON) actions.push('CREATE_PENDING_RECEIPT');
  }
  if (receipts.some((receipt) => receipt.businessStatus === 'PENDING_INSPECTION')) actions.push('WAIT_IQC');
  return actions;
}

/**
 * 由完工通知或委外收货反解所属委外订单。
 * 深链接必须能从 URL 恢复业务身份（Design §26.35.2），因此通知与收货
 * 都要能定位到唯一订单。
 */
export function resolveOutsourcingOrderId(db, { orderId, noticeId, receiptId }) {
  if (orderId) return String(orderId);
  if (noticeId) {
    const notice = db.prepare("SELECT outsourcing_order_id FROM receipt_notices WHERE id=? AND business_type='OUTSOURCE'").get(noticeId);
    return notice?.outsourcing_order_id || null;
  }
  if (receiptId) {
    const receipt = db.prepare('SELECT order_id FROM outsourcing_receipts WHERE id=?').get(receiptId);
    return receipt?.order_id || null;
  }
  return null;
}

/**
 * 委外收货员任务队列：已下达且存在加工费 PO 的委外订单。
 *
 * 加工费 PO 处于任何状态都进入队列：审批中的订单对收货员是「等待」而不是
 * 「不可见」。可执行动作由 `nextReceivingActions` 按权威状态推导。
 * 分页有界，避免收货员遍历其它业务类型。
 */
export function listOutsourcingReceivingQueue(db, { limit, offset } = {}) {
  const take = boundedLimit(limit);
  const skip = boundedOffset(offset);
  const rows = db.prepare(`SELECT o.id FROM outsourcing_orders o
    WHERE o.status='RELEASED'
      AND EXISTS (SELECT 1 FROM purchase_orders po
        WHERE po.business_type='OUTSOURCE_PROCESSING' AND po.source_outsourcing_order_id=o.id)
    ORDER BY o.business_date DESC, o.id
    LIMIT ? OFFSET ?`).all(take, skip);
  const tasks = rows.map((row) => readOutsourcingReceivingContext(db, row.id)).filter(Boolean);
  return { tasks, limit: take, offset: skip };
}

/**
 * IQC 侧的委外待检来源投影：只给检验所需的来源号、供应商、产品、数量、
 * 目标仓与状态。不返回材料成本、WIP 身份或加工费金额。
 */
export function readOutsourcingReceiptQualityContext(db, receiptId) {
  const receipt = db.prepare(`SELECT id, receipt_no, order_id, processing_po_id, quantity, received_date,
      business_date, supplier_id, business_status, warehouse_id, source_notice_id
    FROM outsourcing_receipts WHERE id=?`).get(receiptId);
  if (!receipt) return null;
  const order = db.prepare('SELECT id, order_no, product_id, supplier_id, status FROM outsourcing_orders WHERE id=?').get(receipt.order_id);
  const supplier = db.prepare('SELECT id, code, name FROM suppliers WHERE id=?').get(receipt.supplier_id);
  const items = db.prepare(`SELECT id, product_id, quantity, unit_code, lot_id, serial_id, line_no
    FROM outsourcing_receipt_items WHERE receipt_id=? ORDER BY line_no, id`).all(receipt.id);
  const product = db.prepare('SELECT id, code, name FROM products WHERE id=?').get(order?.product_id);
  return {
    receipt: {
      id: receipt.id,
      receiptNo: receipt.receipt_no,
      orderId: receipt.order_id,
      orderNo: order?.order_no || null,
      supplierId: receipt.supplier_id,
      supplierCode: supplier?.code || null,
      supplierName: supplier?.name || null,
      productId: order?.product_id || null,
      productCode: product?.code || null,
      productName: product?.name || null,
      quantity: quantity(receipt.quantity),
      unit: null,
      warehouseId: receipt.warehouse_id,
      businessStatus: receipt.business_status,
      sourceNoticeId: receipt.source_notice_id,
      processingPoId: receipt.processing_po_id,
      receivedDate: receipt.received_date,
      businessDate: receipt.business_date,
    },
    items: items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      quantity: quantity(item.quantity),
      unitCode: item.unit_code,
      lotId: item.lot_id,
      serialId: item.serial_id,
      lineNo: item.line_no,
    })),
  };
}

/**
 * IQC 可选来源候选：委外待检收货。
 * 与 `loadQualitySource` 使用同一来源家族（`outsourcing_receipts`），
 * 因此候选集合与 canonical 检验单的来源解析保持一致。
 */
export function listOutsourcingInspectionCandidates(db, { limit, offset } = {}) {
  const take = boundedLimit(limit);
  const skip = boundedOffset(offset);
  const rows = db.prepare(`SELECT r.id FROM outsourcing_receipts r
    JOIN outsourcing_orders o ON o.id=r.order_id
    WHERE r.business_status='PENDING_INSPECTION' AND o.status='RELEASED'
    ORDER BY r.created_at DESC, r.id
    LIMIT ? OFFSET ?`).all(take, skip);
  const candidates = rows.map((row) => {
    const context = readOutsourcingReceiptQualityContext(db, row.id);
    if (!context) return null;
    return {
      sourceType: OUTSOURCING_QUALITY_SOURCE_TYPE,
      sourceId: context.receipt.id,
      sourceNo: context.receipt.receiptNo,
      orderNo: context.receipt.orderNo,
      supplierId: context.receipt.supplierId,
      supplierCode: context.receipt.supplierCode,
      supplierName: context.receipt.supplierName,
      productId: context.receipt.productId,
      productCode: context.receipt.productCode,
      quantity: context.receipt.quantity,
      warehouseId: context.receipt.warehouseId,
      businessStatus: context.receipt.businessStatus,
      businessDate: context.receipt.businessDate,
    };
  }).filter(Boolean);
  return { sourceType: OUTSOURCING_QUALITY_SOURCE_TYPE, candidates, limit: take, offset: skip };
}

/**
 * 委外业务侧的选项读模型：合格供应商、成品、已批准 OUTSOURCE BOM、
 * 计划交接来源与仓库。选项按业务日期过滤，保存时 Writer 仍会重新校验。
 */
export function listOutsourcingOptions(db, { kind, query, businessDate, productId, limit } = {}) {
  const take = boundedLimit(limit);
  const term = searchTerm(query);
  const date = String(businessDate || '').trim() || new Date().toISOString().slice(0, 10);

  if (kind === 'supplier') {
    const params = [date, date];
    let sql = `SELECT id, code, name, supplier_category, qualification_status,
        qualification_valid_from, qualification_valid_to, supplier_wip_warehouse_id
      FROM suppliers
      WHERE outsourcing_enabled=1 AND active=1 AND qualification_status='QUALIFIED'
        AND (qualification_valid_from IS NULL OR qualification_valid_from<=?)
        AND (qualification_valid_to IS NULL OR qualification_valid_to>=?)`;
    if (term) { sql += ' AND (code LIKE ? ESCAPE \'\\\' OR name LIKE ? ESCAPE \'\\\')'; params.push(term, term); }
    sql += ' ORDER BY code LIMIT ?';
    params.push(take);
    const options = db.prepare(sql).all(...params).map((row) => ({
      id: row.id, code: row.code, name: row.name,
      category: row.supplier_category,
      qualificationStatus: row.qualification_status,
      qualificationValidFrom: row.qualification_valid_from,
      qualificationValidTo: row.qualification_valid_to,
      supplierWipWarehouseId: row.supplier_wip_warehouse_id,
    }));
    return { kind: 'supplier', businessDate: date, options };
  }

  if (kind === 'product') {
    const params = [];
    let sql = `SELECT id, code, name, unit, base_uom_code, tracking_policy FROM products WHERE active=1`;
    if (term) { sql += ' AND (code LIKE ? ESCAPE \'\\\' OR name LIKE ? ESCAPE \'\\\')'; params.push(term, term); }
    sql += ' ORDER BY code LIMIT ?';
    params.push(take);
    const options = db.prepare(sql).all(...params).map((row) => ({
      id: row.id, code: row.code, name: row.name,
      unit: row.base_uom_code || row.unit, trackingPolicy: row.tracking_policy,
    }));
    return { kind: 'product', businessDate: date, options };
  }

  if (kind === 'bom') {
    const params = [date, date];
    let sql = `SELECT b.id, b.product_id, b.version, b.effective_from, b.effective_to, b.approval_status,
        p.code product_code, p.name product_name
      FROM boms b JOIN products p ON p.id=b.product_id
      WHERE b.purpose='OUTSOURCE' AND b.status='ACTIVE' AND b.approval_status='APPROVED'
        AND (b.effective_from IS NULL OR b.effective_from<=?)
        AND (b.effective_to IS NULL OR b.effective_to>=?)`;
    if (productId) { sql += ' AND b.product_id=?'; params.push(productId); }
    if (term) { sql += ' AND (p.code LIKE ? ESCAPE \'\\\' OR p.name LIKE ? ESCAPE \'\\\')'; params.push(term, term); }
    sql += ' ORDER BY p.code, b.version LIMIT ?';
    params.push(take);
    const options = db.prepare(sql).all(...params).map((row) => {
      // BOM 明细行是建立用料快照的来源上下文（逐行来源仓绑定），必须与 BOM 同源返回。
      const items = db.prepare('SELECT product_id, quantity, line_no FROM bom_items WHERE bom_id=? ORDER BY line_no, id').all(row.id);
      return {
        id: row.id, productId: row.product_id,
        productCode: row.product_code, productName: row.product_name,
        version: row.version, effectiveFrom: row.effective_from, effectiveTo: row.effective_to,
        items: items.map((item) => ({
          productId: item.product_id, quantity: Number(item.quantity), lineNo: item.line_no,
        })),
      };
    });
    return { kind: 'bom', businessDate: date, options };
  }

  if (kind === 'handoff') {
    const params = [];
    let sql = `SELECT h.id, h.product_id, h.quantity, h.need_date, h.planned_order_id,
        p.code product_code, p.name product_name
      FROM planning_outsource_handoffs h JOIN products p ON p.id=h.product_id
      WHERE h.status='PENDING'`;
    if (term) { sql += ' AND (p.code LIKE ? ESCAPE \'\\\' OR p.name LIKE ? ESCAPE \'\\\')'; params.push(term, term); }
    sql += ' ORDER BY h.need_date, h.id LIMIT ?';
    params.push(take);
    const options = db.prepare(sql).all(...params).map((row) => ({
      id: row.id, productId: row.product_id,
      productCode: row.product_code, productName: row.product_name,
      quantity: quantity(row.quantity), needDate: row.need_date, plannedOrderId: row.planned_order_id,
    }));
    return { kind: 'handoff', businessDate: date, options };
  }

  if (kind === 'warehouse') {
    const params = [];
    let sql = 'SELECT id, code, name FROM warehouses WHERE active=1';
    if (term) { sql += ' AND (code LIKE ? ESCAPE \'\\\' OR name LIKE ? ESCAPE \'\\\')'; params.push(term, term); }
    sql += ' ORDER BY code LIMIT ?';
    params.push(take);
    const options = db.prepare(sql).all(...params).map((row) => ({ id: row.id, code: row.code, name: row.name }));
    return { kind: 'warehouse', businessDate: date, options };
  }

  return { kind: String(kind || ''), businessDate: date, options: [] };
}
