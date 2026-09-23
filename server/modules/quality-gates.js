import { HttpError } from '../lib/http.js';

const EPSILON = 1e-9;

function sameQuantity(left, right) {
  return Math.abs(Number(left) - Number(right)) < EPSILON;
}

const config = {
  IQC: {
    headerTable: 'iqc_inspections', itemTable: 'iqc_inspection_items', qualityForeignKey: 'iqc_id',
    sourceHeaderTable: 'purchase_receipts', sourceItemTable: 'purchase_receipt_items', sourceHeaderForeignKey: 'receipt_id',
    sourceHeaderColumn: 'purchase_receipt_id', legacyHeaderColumn: 'receipt_id', sourceItemColumn: 'purchase_receipt_item_id',
    sourceNumber: 'receipt_no', partyColumn: 'supplier_id', orderColumn: 'purchase_order_id',
    orderTable: 'purchase_orders', orderItemColumn: 'purchase_order_item_id', label: 'IQC', sourceLabel: '采购入库单',
  },
  OQC: {
    headerTable: 'oqc_inspections', itemTable: 'oqc_inspection_items', qualityForeignKey: 'oqc_id',
    sourceHeaderTable: 'sales_deliveries', sourceItemTable: 'sales_delivery_items', sourceHeaderForeignKey: 'delivery_id',
    sourceHeaderColumn: 'sales_delivery_id', legacyHeaderColumn: 'delivery_id', sourceItemColumn: 'sales_delivery_item_id',
    sourceNumber: 'delivery_no', partyColumn: 'customer_id', orderColumn: 'sales_order_id',
    orderTable: 'sales_orders', orderItemColumn: 'sales_order_item_id', label: 'OQC', sourceLabel: '销售出库单',
  },
};

export function qualityConfig(kind) {
  return config[kind];
}

export function loadQualitySource(db, kind, sourceId) {
  const c = config[kind];
  if (!sourceId) throw new HttpError(400, `${c.label} 必须选择来源${c.sourceLabel}`);
  const source = db.prepare(`SELECT * FROM ${c.sourceHeaderTable} WHERE id=?`).get(sourceId);
  if (!source) throw new HttpError(400, `${c.sourceLabel}不存在`);
  if (source.status !== 'DRAFT') throw new HttpError(409, `只有草稿状态的${c.sourceLabel}可以创建 ${c.label}`);
  const order = db.prepare(`SELECT * FROM ${c.orderTable} WHERE id=?`).get(source[c.orderColumn]);
  if (!order || order.status !== 'APPROVED') throw new HttpError(409, `${c.sourceLabel}没有有效的已审批来源订单`);
  if (!source[c.partyColumn] || source[c.partyColumn] !== order[c.partyColumn]) throw new HttpError(409, `${c.sourceLabel}往来单位与来源订单不一致`);
  const items = db.prepare(`SELECT * FROM ${c.sourceItemTable} WHERE ${c.sourceHeaderForeignKey}=? ORDER BY line_no,id`).all(sourceId);
  if (!items.length) throw new HttpError(409, `${c.sourceLabel}没有可检验明细`);
  for (const item of items) {
    if (!item[c.orderItemColumn]) throw new HttpError(409, `${c.sourceLabel}明细缺少权威订单来源`);
  }
  return { source, order, items };
}

function inspectionMatchesSource(c, inspection, source, qualityItems, sourceItems) {
  if (inspection[c.sourceHeaderColumn] !== source.id || qualityItems.length !== sourceItems.length) return false;
  const byId = new Map(sourceItems.map((item) => [item.id, item]));
  return qualityItems.every((item) => {
    const current = byId.get(item[c.sourceItemColumn]);
    return current && item.product_id === current.product_id
      && sameQuantity(item.snapshot_quantity, current.quantity)
      && item.snapshot_warehouse_id === source.warehouse_id
      && String(item.snapshot_batch_no || '') === String(current.batch_no || '');
  });
}

export function deriveQualityState(db, kind, sourceId) {
  const c = config[kind];
  const source = db.prepare(`SELECT * FROM ${c.sourceHeaderTable} WHERE id=?`).get(sourceId);
  if (!source) return { code: 'NOT_INSPECTED', label: '未检验', inspectionId: null };
  const sourceItems = db.prepare(`SELECT * FROM ${c.sourceItemTable} WHERE ${c.sourceHeaderForeignKey}=? ORDER BY line_no,id`).all(sourceId);
  const numberColumn = kind === 'IQC' ? 'iqc_no' : 'oqc_no';
  const inspections = db.prepare(`SELECT * FROM ${c.headerTable} WHERE ${c.sourceHeaderColumn}=? ORDER BY created_at DESC,${numberColumn} DESC`).all(sourceId);
  if (!inspections.length) return { code: 'NOT_INSPECTED', label: '未检验', inspectionId: null };
  const latest = inspections[0];
  if (latest.status === 'DRAFT' || latest.status === 'PENDING') return { code: 'INSPECTION_DRAFT', label: '检验草稿', inspectionId: latest.id };
  if (latest.status === 'CANCELLED') return { code: 'NOT_INSPECTED', label: '未检验（最近检验已取消）', inspectionId: latest.id };
  const qualityItems = db.prepare(`SELECT * FROM ${c.itemTable} WHERE ${c.qualityForeignKey}=? ORDER BY id`).all(latest.id);
  if (!inspectionMatchesSource(c, latest, source, qualityItems, sourceItems)) return { code: 'STALE', label: '检验已失效，需复检', inspectionId: latest.id };
  if (latest.result === 'PASS') return { code: 'PASS', label: '检验合格', inspectionId: latest.id };
  return { code: 'FAIL', label: '检验不合格', inspectionId: latest.id };
}

export function assertQualityGate(db, kind, sourceId) {
  const state = deriveQualityState(db, kind, sourceId);
  if (state.code !== 'PASS') throw new HttpError(409, `${config[kind].sourceLabel}质量门禁未通过：${state.label}`);
  return state;
}

export function sameSourceSnapshot(db, kind, inspectionId) {
  const c = config[kind];
  const inspection = db.prepare(`SELECT * FROM ${c.headerTable} WHERE id=?`).get(inspectionId);
  if (!inspection?.[c.sourceHeaderColumn]) return false;
  const source = db.prepare(`SELECT * FROM ${c.sourceHeaderTable} WHERE id=?`).get(inspection[c.sourceHeaderColumn]);
  if (!source) return false;
  const qualityItems = db.prepare(`SELECT * FROM ${c.itemTable} WHERE ${c.qualityForeignKey}=?`).all(inspectionId);
  const sourceItems = db.prepare(`SELECT * FROM ${c.sourceItemTable} WHERE ${c.sourceHeaderForeignKey}=?`).all(source.id);
  return inspectionMatchesSource(c, inspection, source, qualityItems, sourceItems);
}
