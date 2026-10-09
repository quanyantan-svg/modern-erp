import { HttpError } from '../lib/http.js';
import { qualityPolicyAllowsPosting, trackingSnapshot } from './traceability-quality.js';

const EPSILON = 1e-9;

function sameQuantity(left, right) {
  return Math.abs(Number(left) - Number(right)) < EPSILON;
}

// Each `kind` (IQC / OQC) supports multiple `sourceType` discriminator values.
// The kind decides which header + item table family (iqc_inspections vs
// oqc_inspections); the sourceType decides which logistics source the IQC
// points at (purchase_receipts vs outsourcing_receipts). For OQC the
// sourceType remains a single value (SALES_DELIVERY) for now.
//
// OUT-18 extends the IQC family with `OUTSOURCING_RECEIPT` so that the same
// canonical iqc_inspections / iqc_inspection_items tables back both Purchase
// Receipt inspections and Outsourcing Receipt inspections. The discriminator
// is the new `iqc_inspections.source_type` column plus either
// `purchase_receipt_id` (legacy / canonical) or `outsourcing_receipt_id`.
const config = {
  IQC: {
    shared: {
      headerTable: 'iqc_inspections', itemTable: 'iqc_inspection_items', qualityForeignKey: 'iqc_id',
      legacyHeaderColumn: 'receipt_id',
      label: 'IQC',
      partyColumn: 'supplier_id',
    },
    sourceTypes: {
      PURCHASE_RECEIPT: {
        sourceHeaderTable: 'purchase_receipts',
        sourceItemTable: 'purchase_receipt_items',
        sourceHeaderForeignKey: 'receipt_id',
        sourceHeaderColumn: 'purchase_receipt_id',
        sourceItemColumn: 'purchase_receipt_item_id',
        sourceNumber: 'receipt_no',
        orderColumn: 'purchase_order_id',
        orderTable: 'purchase_orders',
        orderItemColumn: 'purchase_order_item_id',
        sourceOrderStatusRequired: 'APPROVED',
        sourceLabel: '采购入库单',
        policySourceType: 'PURCHASE_RECEIPT',
      },
      OUTSOURCING_RECEIPT: {
        // OUT-18: Outsourcing Receipt uses the same iqc_inspections / items
        // family; only the source logistics document changes.
        sourceHeaderTable: 'outsourcing_receipts',
        sourceItemTable: 'outsourcing_receipt_items',
        sourceHeaderForeignKey: 'receipt_id',
        sourceHeaderColumn: 'outsourcing_receipt_id',
        sourceItemColumn: 'outsourcing_receipt_item_id',
        sourceNumber: 'receipt_no',
        orderColumn: 'order_id',
        orderTable: 'outsourcing_orders',
        orderItemColumn: null,
        sourceOrderStatusRequired: 'RELEASED',
        sourceLabel: '委外完工入库单',
        policySourceType: 'OUTSOURCING_RECEIPT',
      },
    },
  },
  OQC: {
    shared: {
      headerTable: 'oqc_inspections', itemTable: 'oqc_inspection_items', qualityForeignKey: 'oqc_id',
      legacyHeaderColumn: 'delivery_id',
      label: 'OQC',
      partyColumn: 'customer_id',
    },
    sourceTypes: {
      SALES_DELIVERY: {
        sourceHeaderTable: 'sales_deliveries',
        sourceItemTable: 'sales_delivery_items',
        sourceHeaderForeignKey: 'delivery_id',
        sourceHeaderColumn: 'sales_delivery_id',
        sourceItemColumn: 'sales_delivery_item_id',
        sourceNumber: 'delivery_no',
        orderColumn: 'sales_order_id',
        orderTable: 'sales_orders',
        orderItemColumn: 'sales_order_item_id',
        sourceOrderStatusRequired: 'APPROVED',
        sourceLabel: '销售出库单',
        policySourceType: 'SALES_DELIVERY',
      },
    },
  },
};

function resolveKindSourceType(db, kind, sourceId, sourceTypeHint) {
  const k = config[kind];
  if (!k) throw new HttpError(400, `未知的质量单据类型 ${kind}`);
  const sources = k.sourceTypes;
  // Hint provided — honor it when the row matches the source header table.
  if (sourceTypeHint && sources[sourceTypeHint]) {
    const c = sources[sourceTypeHint];
    const probe = db.prepare(`SELECT 1 FROM ${c.sourceHeaderTable} WHERE id=?`).get(sourceId);
    if (probe) return { kind, sourceType: sourceTypeHint, c: { ...k.shared, ...c } };
  }
  // Otherwise probe every source-type under this kind; the first match wins.
  for (const [st, c] of Object.entries(sources)) {
    const probe = db.prepare(`SELECT 1 FROM ${c.sourceHeaderTable} WHERE id=?`).get(sourceId);
    if (probe) return { kind, sourceType: st, c: { ...k.shared, ...c } };
  }
  // Fallback for IQC: keep the legacy `purchase_receipt_id` column pointed-at
  // when no row exists in either logistics source — surfaced as 400 below by
  // the caller.
  return null;
}

export function qualityConfig(kind) {
  const k = config[kind];
  if (!k) return null;
  // Backwards compatibility: callers expect `c.sourceTypes[sourceType]` to be
  // resolvable after a single `qualityConfig(kind)` lookup. Return the kind
  // config object (shared + sourceTypes siblings) instead of just `shared`.
  return { ...k.shared, sourceTypes: k.sourceTypes };
}

/** Resolve a specific source-type config under `kind`. Throws when neither a
 * kind-config nor a matching source row exists. */
export function qualitySourceConfig(kind, sourceId, sourceTypeHint) {
  const resolved = resolveKindSourceType({ prepare: () => ({ get: () => null }) }, kind, sourceId, sourceTypeHint);
  return resolved ? resolved : null;
}

export function loadQualitySource(db, kind, sourceId, sourceTypeHint) {
  const k = config[kind];
  if (!k) throw new HttpError(400, `未知的质量单据类型 ${kind}`);
  const sources = k.sourceTypes;
  let chosen = null;
  let c = null;
  if (sourceTypeHint && sources[sourceTypeHint]) {
    chosen = sourceTypeHint; c = { ...k.shared, ...sources[sourceTypeHint] };
  } else {
    for (const [st, cs] of Object.entries(sources)) {
      const probe = db.prepare(`SELECT 1 FROM ${cs.sourceHeaderTable} WHERE id=?`).get(sourceId);
      if (probe) { chosen = st; c = { ...k.shared, ...cs }; break; }
    }
  }
  if (!c || !chosen) throw new HttpError(400, `${k.shared.label} 必须选择来源物流单据`);
  if (!sourceId) throw new HttpError(400, `${c.label} 必须选择来源${c.sourceLabel}`);
  const source = db.prepare(`SELECT * FROM ${c.sourceHeaderTable} WHERE id=?`).get(sourceId);
  if (!source) throw new HttpError(400, `${c.sourceLabel}不存在`);
  // OUT-18: outsourcing_receipts uses `business_status` (not `status`), so we
  // must read the correct column for the source-type at hand. Inspections
  // can be created against a CONFIRMED receipt (the receipt already carries
  // finished material in DRAFT/CONFIRMED state; PASS/WAIVED releases it).
  const statusColumn = chosen === 'OUTSOURCING_RECEIPT' ? 'business_status' : 'status';
  const sourceReadyStatuses = chosen === 'OUTSOURCING_RECEIPT'
    ? ['DRAFT', 'CONFIRMED']
    : ['DRAFT'];
  if (!sourceReadyStatuses.includes(source[statusColumn])) {
    throw new HttpError(409, `只有草稿/可检状态的${c.sourceLabel}可以创建 ${c.label}`);
  }
  const order = db.prepare(`SELECT * FROM ${c.orderTable} WHERE id=?`).get(source[c.orderColumn]);
  if (!order) throw new HttpError(409, `${c.sourceLabel}没有有效的来源订单`);
  if (order.status !== c.sourceOrderStatusRequired) {
    throw new HttpError(409, `${c.sourceLabel}来源订单状态必须是 ${c.sourceOrderStatusRequired}`);
  }
  if (!source[c.partyColumn] || source[c.partyColumn] !== order[c.partyColumn]) {
    throw new HttpError(409, `${c.sourceLabel}往来单位与来源订单不一致`);
  }
  const items = db.prepare(`SELECT * FROM ${c.sourceItemTable} WHERE ${c.sourceHeaderForeignKey}=? ORDER BY line_no,id`).all(sourceId);
  if (!items.length) throw new HttpError(409, `${c.sourceLabel}没有可检验明细`);
  if (c.orderItemColumn) {
    for (const item of items) {
      if (!item[c.orderItemColumn]) throw new HttpError(409, `${c.sourceLabel}明细缺少权威订单来源`);
    }
  }
  return { source, order, items, sourceType: chosen, kind };
}

function inspectionMatchesSource(db, merged, inspection, source, qualityItems, sourceItems) {
  if (inspection[merged.sourceHeaderColumn] !== source.id || qualityItems.length !== sourceItems.length) return false;
  const byId = new Map(sourceItems.map((item) => [item.id, item]));
  // OUT-18: outsourcing_receipts has no warehouse_id column (the finished
  // item is recognized into a canonical finished warehouse at confirm time).
  // Treat missing source.warehouse_id as a sentinel that matches the
  // inspection-side default 'warehouse-001' / null.
  const sourceWarehouseId = source.warehouse_id || 'warehouse-001';
  return qualityItems.every((item) => {
    const current = byId.get(item[merged.sourceItemColumn]);
    const policy = db.prepare("SELECT COALESCE(tracking_policy,'NONE') policy FROM products WHERE id=?").get(item.product_id)?.policy || 'NONE';
    return current && item.product_id === current.product_id
      && sameQuantity(item.snapshot_quantity, current.quantity)
      && String(item.snapshot_warehouse_id || '') === String(sourceWarehouseId || '')
      && String(item.snapshot_batch_no || '') === String(current.batch_no || '')
      && (policy === 'NONE' || String(item.tracking_snapshot || '') === trackingSnapshot(db, merged.policySourceType, source.id, current.id));
  });
}

export function deriveQualityState(db, kind, sourceId, sourceTypeHint) {
  const k = config[kind];
  if (!k) return { code: 'NOT_INSPECTED', label: '未检验', inspectionId: null };
  const sources = k.sourceTypes;
  let chosen = null; let c = null;
  if (sourceTypeHint && sources[sourceTypeHint]) {
    const probe = db.prepare(`SELECT 1 FROM ${sources[sourceTypeHint].sourceHeaderTable} WHERE id=?`).get(sourceId);
    if (probe) { chosen = sourceTypeHint; c = { ...k.shared, ...sources[sourceTypeHint] }; }
  }
  if (!c) {
    for (const [st, cs] of Object.entries(sources)) {
      const probe = db.prepare(`SELECT 1 FROM ${cs.sourceHeaderTable} WHERE id=?`).get(sourceId);
      if (probe) { chosen = st; c = { ...k.shared, ...cs }; break; }
    }
  }
  if (!c) return { code: 'NOT_INSPECTED', label: '未检验', inspectionId: null };
  // OUT-18: default OUTSOURCING_RECEIPT policy is WAIVED unless a snapshot
  // exists marking it required. This avoids the fail-safe default of
  // "required" when no QCP snapshot has been frozen against this source.
  if (chosen === 'OUTSOURCING_RECEIPT') {
    const snapshots = db.prepare('SELECT inspection_required FROM logistics_quality_policy_snapshots WHERE source_type=? AND source_id=?').all(c.policySourceType, sourceId);
    if (!snapshots.length) return { code: 'WAIVED', label: '按质量策略免检（OUTSOURCE 默认供应商侧管控）', inspectionId: null, sourceType: chosen };
  }
  const source = db.prepare(`SELECT * FROM ${c.sourceHeaderTable} WHERE id=?`).get(sourceId);
  if (!source) return { code: 'NOT_INSPECTED', label: '未检验', inspectionId: null };
  const sourceItems = db.prepare(`SELECT * FROM ${c.sourceItemTable} WHERE ${c.sourceHeaderForeignKey}=? ORDER BY line_no,id`).all(sourceId);
  const numberColumn = kind === 'IQC' ? 'iqc_no' : 'oqc_no';
  const inspections = db.prepare(`SELECT * FROM ${c.headerTable} WHERE ${c.sourceHeaderColumn}=? ORDER BY created_at DESC,${numberColumn} DESC`).all(sourceId);
  const policy = qualityPolicyAllowsPosting(db, c.policySourceType, sourceId);
  if (!policy.required) return { code: 'WAIVED', label: '按质量策略免检', inspectionId: null, policySnapshots: policy.snapshots, sourceType: chosen };
  if (!inspections.length) return { code: 'NOT_INSPECTED', label: '未检验', inspectionId: null, sourceType: chosen };
  const latest = inspections[0];
  if (latest.status === 'DRAFT' || latest.status === 'PENDING') return { code: 'INSPECTION_DRAFT', label: '检验草稿', inspectionId: latest.id, sourceType: chosen };
  if (latest.status === 'CANCELLED') return { code: 'NOT_INSPECTED', label: '未检验（最近检验已取消）', inspectionId: latest.id, sourceType: chosen };
  const qualityItems = db.prepare(`SELECT * FROM ${c.itemTable} WHERE ${c.qualityForeignKey}=? ORDER BY id`).all(latest.id);
  if (!inspectionMatchesSource(db, c, latest, source, qualityItems, sourceItems)) return { code: 'STALE', label: '检验已失效，需复检', inspectionId: latest.id, sourceType: chosen };
  if (latest.result === 'PASS') return { code: 'PASS', label: '检验合格', inspectionId: latest.id, sourceType: chosen };
  return { code: 'FAIL', label: '检验不合格', inspectionId: latest.id, sourceType: chosen };
}

export function assertQualityGate(db, kind, sourceId, sourceTypeHint) {
  const state = deriveQualityState(db, kind, sourceId, sourceTypeHint);
  if (!['PASS', 'WAIVED'].includes(state.code)) {
    const label = config[kind]?.sourceLabel || (config[kind]?.shared?.sourceTypes?.[sourceTypeHint || Object.keys(config[kind]?.sourceTypes || {})[0]]?.sourceLabel) || '物流单据';
    throw new HttpError(409, `${label}质量门禁未通过：${state.label}`);
  }
  return state;
}

export function sameSourceSnapshot(db, kind, inspectionId) {
  const k = config[kind];
  if (!k) return false;
  const inspection = db.prepare(`SELECT * FROM ${k.shared.headerTable} WHERE id=?`).get(inspectionId);
  if (!inspection) return false;
  // Read the source-type discriminator from the inspection row if present
  // (OUT-18 column). Otherwise probe every source-type under this kind.
  const hint = inspection.source_type || inspection[k.shared.legacyHeaderColumn + '_kind']
    || (inspection.outsourcing_receipt_id ? 'OUTSOURCING_RECEIPT' : 'PURCHASE_RECEIPT');
  let c = null;
  if (k.sourceTypes[hint]) {
    const probe = db.prepare(`SELECT 1 FROM ${k.sourceTypes[hint].sourceHeaderTable} WHERE id=?`).get(inspection[k.sourceTypes[hint].sourceHeaderColumn] || inspection[k.shared.legacyHeaderColumn]);
    if (probe) c = { ...k.shared, ...k.sourceTypes[hint] };
  }
  if (!c) {
    for (const [, cs] of Object.entries(k.sourceTypes)) {
      const probe = db.prepare(`SELECT 1 FROM ${cs.sourceHeaderTable} WHERE id=?`).get(inspection[cs.sourceHeaderColumn] || inspection[k.shared.legacyHeaderColumn]);
      if (probe) { c = { ...k.shared, ...cs }; break; }
    }
  }
  if (!c) return false;
  const sourceId = inspection[c.sourceHeaderColumn] || inspection[k.shared.legacyHeaderColumn];
  if (!sourceId) return false;
  const source = db.prepare(`SELECT * FROM ${c.sourceHeaderTable} WHERE id=?`).get(sourceId);
  if (!source) return false;
  const qualityItems = db.prepare(`SELECT * FROM ${c.itemTable} WHERE ${c.qualityForeignKey}=?`).all(inspectionId);
  const sourceItems = db.prepare(`SELECT * FROM ${c.sourceItemTable} WHERE ${c.sourceHeaderForeignKey}=?`).all(source.id);
  return inspectionMatchesSource(db, c, inspection, source, qualityItems, sourceItems);
}
