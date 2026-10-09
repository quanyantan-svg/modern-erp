import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, readJson, send } from '../lib/http.js';
import { deriveQualityState, loadQualitySource, qualityConfig, sameSourceSnapshot } from './quality-gates.js';
import { calculateSampleQuantity, freezeQualityPolicy, trackingSnapshot } from './traceability-quality.js';

const RESULTS = ['PASS', 'FAIL'];
const TYPES = ['NORMAL', 'SAMPLING', 'FULL'];
const DISPOSITIONS = {
  IQC: ['HOLD', 'REWORK', 'REJECT_TO_SUPPLIER'],
  OQC: ['HOLD', 'REWORK', 'SCRAP_REVIEW'],
};

function number(value, label, { positive = false } = {}) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (positive && result <= 0)) throw new HttpError(400, `${label}必须${positive ? '大于 0' : '为非负数'}`);
  return result;
}

function kindValues(kind) {
  const c = qualityConfig(kind);
  return {
    c,
    permission: `${kind}_MANAGE`,
    viewPermissions: [`${kind}_VIEW`, `${kind}_MANAGE`],
    numberColumn: kind === 'IQC' ? 'iqc_no' : 'oqc_no',
    prefix: kind,
    partyColumn: c.partyColumn,
    partyTable: c.partyColumn === 'supplier_id' ? 'suppliers' : 'customers',
    partyAlias: c.partyColumn === 'supplier_id' ? 'supplier' : 'customer',
  };
}

function sourceIdFromBody(kind, body) {
  return String(
    body[kind === 'IQC' ? 'purchase_receipt_id' : 'sales_delivery_id']
    || (kind === 'IQC' ? body.outsourcing_receipt_id : '')
    || ''
  ).trim();
}

function loadInspection(db, kind, inspectionId) {
  const v = kindValues(kind);
  const sourceDateColumn = kind === 'IQC' ? 'receipt_date' : 'delivery_date';
  const orderNumberColumn = kind === 'IQC' ? 'order_no' : 'order_no';
  const inspection = db.prepare(`SELECT q.*, p.code ${v.partyAlias}_code, p.name ${v.partyAlias}_name,
    u.display_name inspector_name
    FROM ${v.c.headerTable} q JOIN ${v.partyTable} p ON p.id=q.${v.partyColumn}
    LEFT JOIN users u ON u.id=q.inspector_id
    WHERE q.id=?`).get(inspectionId);
  if (!inspection) throw new HttpError(404, `${kind} 检验单不存在`);
  const sourceType = inspection.source_type
    || (inspection.outsourcing_receipt_id ? 'OUTSOURCING_RECEIPT' : 'PURCHASE_RECEIPT');
  const sub = v.c.sourceTypes[sourceType] || v.c.sourceTypes[(kind === 'IQC' ? 'PURCHASE_RECEIPT' : 'SALES_DELIVERY')];
  const fkColumn = sub.sourceHeaderColumn;
  const sourceId = inspection[fkColumn];
  inspection.sourceType = sourceType;
  let source = null; let order = null;
  if (sourceId) {
    source = db.prepare(`SELECT * FROM ${sub.sourceHeaderTable} WHERE id=?`).get(sourceId);
    if (source && source[sub.orderColumn]) {
      order = db.prepare(`SELECT * FROM ${sub.orderTable} WHERE id=?`).get(source[sub.orderColumn]);
    }
  }
  inspection.authoritative = Boolean(sourceId);
  inspection.legacy_unlinked = !inspection.authoritative;
  if (source) {
    inspection.source_document_no = source[sub.sourceNumber];
    inspection.source_business_date = source[sourceDateColumn];
    if (source.warehouse_id) {
      const w = db.prepare('SELECT code, name FROM warehouses WHERE id=?').get(source.warehouse_id);
      if (w) {
        inspection.source_warehouse_code = w.code;
        inspection.source_warehouse_name = w.name;
      }
    }
    inspection.source_order_no = order ? order[orderNumberColumn] : null;
  }
  const subItemColumn = sub.sourceItemColumn || (kind === 'IQC' && sourceType === 'OUTSOURCING_RECEIPT' ? 'outsourcing_receipt_item_id' : 'purchase_receipt_item_id');
  inspection.items = db.prepare(`SELECT qi.*, p.code product_code, p.name product_name, p.unit
    FROM ${v.c.itemTable} qi JOIN products p ON p.id=qi.product_id WHERE qi.${v.c.qualityForeignKey}=? ORDER BY qi.id`).all(inspectionId);
  inspection.sourceItemColumn = subItemColumn;
  if (inspection.authoritative) {
    inspection.quality_state = deriveQualityState(db, kind, sourceId, sourceType);
  }
  return inspection;
}

function list(db, res, actor, url, kind) {
  const c = qualityConfig(kind);
  const v = kindValues(kind);
  allowAny(actor, v.viewPermissions);
  const status = url.searchParams.get('status') || '';
  const sourceType = url.searchParams.get('sourceType') || '';
  let sql = `SELECT q.*, p.code ${v.partyAlias}_code, p.name ${v.partyAlias}_name, u.display_name inspector_name
    FROM ${c.headerTable} q JOIN ${v.partyTable} p ON p.id=q.${v.partyColumn}
    LEFT JOIN users u ON u.id=q.inspector_id`;
  const params = [];
  const where = [];
  if (status) { where.push('q.status=?'); params.push(status); }
  if (sourceType) { where.push('q.source_type=?'); params.push(sourceType); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY q.created_at DESC';
  const inspections = db.prepare(sql).all(...params);
  return send(res, 200, { inspections });
}

async function create(db, req, res, actor, kind) {
  const c = qualityConfig(kind);
  const v = kindValues(kind);
  allow(actor, v.permission);
  const body = await readJson(req);
  const forbiddenSourceFields = [v.partyColumn, c.legacyHeaderColumn, 'total_quantity', 'qualified_quantity', 'reject_quantity', 'product_id', 'unit_price_cents', 'items'];
  if (forbiddenSourceFields.some((field) => body[field] !== undefined)) throw new HttpError(400, '来源往来单位、产品、数量、价格和来源行由物流单继承，不可由客户端提交');
  const sourceId = sourceIdFromBody(kind, body);
  const sourceTypeHint = kind === 'IQC'
    ? (body.outsourcing_receipt_id ? 'OUTSOURCING_RECEIPT' : 'PURCHASE_RECEIPT')
    : 'SALES_DELIVERY';
  if (!sourceId) throw new HttpError(400, `${kind === 'IQC' ? 'IQC' : 'OQC'} 必须选择来源物流单据`);
  const { source, items, sourceType } = loadQualitySource(db, kind, sourceId, sourceTypeHint);
  const sub = c.sourceTypes[sourceType];
  const active = db.prepare(`SELECT id FROM ${c.headerTable} WHERE ${sub.sourceHeaderColumn}=? AND status IN ('DRAFT','PENDING')`).get(sourceId);
  if (active) throw new HttpError(409, `该${sub.sourceLabel}已有检验草稿，请先完成或取消`);
  const inspectionType = String(body.inspection_type || 'NORMAL').trim();
  if (!TYPES.includes(inspectionType)) throw new HttpError(400, `检验类型必须是 ${TYPES.join(' / ')}`);
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity), 0);
  const policySourceType = sub.policySourceType;
  const sourceDate = source['received_date'] || source['receipt_date'] || source['delivery_date'] || null;
  const policies = items.map((item) => freezeQualityPolicy(db, { sourceType: policySourceType, sourceId, sourceItemId: item.id, productId: item.product_id, businessDate: sourceDate }));
  const resolvedSample = items.reduce((sum, item, index) => sum + calculateSampleQuantity(item.quantity, policies[index].sampling_mode, policies[index].sampling_value), 0);
  const sampleQuantity = number(body.sample_quantity ?? resolvedSample, '抽样数量');
  if (sampleQuantity > totalQuantity) throw new HttpError(400, '抽样数量不能超过送检数量');
  const now = new Date().toISOString();
  const inspectionId = id();
  const seq = String(db.prepare(`SELECT COUNT(*) cnt FROM ${c.headerTable}`).get().cnt + 1).padStart(4, '0');
  const documentNo = `${v.prefix}-${now.slice(0, 10).replace(/-/g, '')}-${seq}`;
  const previous = db.prepare(`SELECT id FROM ${c.headerTable} WHERE ${sub.sourceHeaderColumn}=? AND status='COMPLETED' LIMIT 1`).get(sourceId);
  transaction(db, () => {
    db.prepare(`INSERT INTO ${c.headerTable}(id,${v.numberColumn},${v.partyColumn},${sub.sourceHeaderColumn},inspection_type,status,total_quantity,sample_quantity,qualified_quantity,reject_quantity,inspector_id,inspection_date,remark,created_at,updated_at,source_type)
      VALUES(?,?,?,?,?,'DRAFT',?,?,0,0,?,?,?,?,?,?)`).run(
      inspectionId, documentNo, source[v.partyColumn], sourceId,
      inspectionType, totalQuantity, sampleQuantity, actor.id,
      String(body.inspection_date || now.slice(0, 10)),
      String(body.remark || '').trim(), now, now, sourceType,
    );
    if (kind === 'IQC' && sourceType === 'OUTSOURCING_RECEIPT') {
      const ord = db.prepare('SELECT order_id FROM outsourcing_receipts WHERE id=?').get(sourceId);
      if (ord) db.prepare('UPDATE iqc_inspections SET outsourcing_order_id=? WHERE id=?').run(ord.order_id, inspectionId);
    }
    const insertItem = db.prepare(`INSERT INTO ${c.itemTable}(id,${c.qualityForeignKey},product_id,batch_no,quantity,sample_size,qualified,reject_reason,${sub.sourceItemColumn || 'purchase_receipt_item_id'},snapshot_warehouse_id,snapshot_batch_no,snapshot_quantity,tracking_snapshot)
      VALUES(?,?,?,?,?,?,1,'',?,?,?,?,?)`);
    const insertCriterion = db.prepare(`INSERT INTO inspection_criteria_snapshots(id,inspection_type,inspection_id,source_item_id,sequence,criterion_name,specification,result_type,min_value,max_value,unit,required)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const [index, item] of items.entries()) {
      const policy = policies[index];
      const itemSample = calculateSampleQuantity(item.quantity, policy.sampling_mode, policy.sampling_value);
      insertItem.run(id(), inspectionId, item.product_id, String(item.batch_no || ''), Number(item.quantity), itemSample, item.id, source.warehouse_id || 'warehouse-001', String(item.batch_no || ''), Number(item.quantity), trackingSnapshot(db, policySourceType, sourceId, item.id));
      if (policy.qcp_id) for (const criterion of db.prepare('SELECT * FROM quality_control_criteria WHERE qcp_id=? ORDER BY sequence').all(policy.qcp_id)) {
        insertCriterion.run(id(), kind, inspectionId, item.id, criterion.sequence, criterion.criterion_name, criterion.specification, criterion.result_type, criterion.min_value, criterion.max_value, criterion.unit, criterion.required);
      }
    }
    audit(db, actor.id, previous ? 'REINSPECTION_CREATED' : 'CREATE', `${kind}_INSPECTION`, inspectionId, `${previous ? '创建复检单' : '新建检验单'} ${documentNo}; 来源 ${sourceId}; 来源行 ${items.map((item) => item.id).join(',')}`);
  });
  return send(res, 201, { id: inspectionId, [v.numberColumn]: documentNo });
}

async function update(db, req, res, actor, inspectionId, kind) {
  const c = qualityConfig(kind);
  const v = kindValues(kind);
  allow(actor, v.permission);
  const body = await readJson(req);
  const inspection = db.prepare(`SELECT * FROM ${c.headerTable} WHERE id=?`).get(inspectionId);
  if (!inspection) throw new HttpError(404, `${kind} 检验单不存在`);
  if (!['DRAFT', 'PENDING'].includes(inspection.status)) throw new HttpError(409, '只有检验草稿可以修改');
  if (!inspection.source_type) throw new HttpError(409, '旧版未关联检验单只读');
  const sub = c.sourceTypes[inspection.source_type];
  const immutable = [sub.sourceHeaderColumn, c.legacyHeaderColumn, v.partyColumn, 'total_quantity'];
  for (const field of immutable) if (body[field] !== undefined && String(body[field]) !== String(inspection[field] ?? '')) throw new HttpError(409, '来源单据、往来单位和送检数量不可修改');
  const type = String(body.inspection_type ?? inspection.inspection_type);
  if (!TYPES.includes(type)) throw new HttpError(400, `检验类型必须是 ${TYPES.join(' / ')}`);
  const sample = number(body.sample_quantity ?? inspection.sample_quantity, '抽样数量');
  if (sample > Number(inspection.total_quantity)) throw new HttpError(400, '抽样数量不能超过送检数量');
  const now = new Date().toISOString();
  db.prepare(`UPDATE ${c.headerTable} SET inspection_type=?,sample_quantity=?,inspection_date=?,remark=?,updated_at=? WHERE id=?`)
    .run(type, sample, String(body.inspection_date || inspection.inspection_date || now.slice(0, 10)), String(body.remark ?? inspection.remark).trim(), now, inspectionId);
  audit(db, actor.id, 'UPDATE', `${kind}_INSPECTION`, inspectionId, `更新检验草稿; 来源 ${inspection[sub.sourceHeaderColumn]}`);
  return send(res, 200, { ok: true });
}

async function complete(db, req, res, actor, inspectionId, kind) {
  const c = qualityConfig(kind);
  const v = kindValues(kind);
  allow(actor, v.permission);
  const body = await readJson(req);
  const inspection = db.prepare(`SELECT * FROM ${c.headerTable} WHERE id=?`).get(inspectionId);
  if (!inspection) throw new HttpError(404, `${kind} 检验单不存在`);
  if (!['DRAFT', 'PENDING'].includes(inspection.status)) throw new HttpError(409, '检验单不是可完成的草稿状态');
  if (!inspection.source_type) throw new HttpError(409, '旧版未关联检验单不能满足权威质量门禁');
  if (!sameSourceSnapshot(db, kind, inspectionId)) throw new HttpError(409, '来源物流明细已变化，请取消该草稿并重新创建检验单');
  const result = String(body.result || '').trim();
  if (!RESULTS.includes(result)) throw new HttpError(400, `检验结果必须是 ${RESULTS.join(' / ')}`);
  const inspected = number(body.inspection_quantity ?? inspection.total_quantity, '检验数量', { positive: true });
  const passed = number(body.passed_quantity ?? body.qualified_quantity, '合格数量');
  const failed = number(body.failed_quantity ?? body.reject_quantity, '不合格数量');
  if (inspected !== Number(inspection.total_quantity)) throw new HttpError(400, '检验数量必须等于当前来源物流明细数量');
  if (Math.abs(passed + failed - inspected) > 1e-9) throw new HttpError(400, '合格数量与不合格数量之和必须等于检验数量');
  const defectReason = String(body.defect_reason || '').trim();
  const disposition = String(body.disposition || '').trim();
  if (result === 'PASS' && (failed !== 0 || passed !== inspected)) throw new HttpError(400, '合格结果必须全部合格且不合格数量为 0');
  if (result === 'FAIL') {
    if (failed <= 0) throw new HttpError(400, '不合格结果的不合格数量必须大于 0');
    if (!defectReason || !disposition) throw new HttpError(400, '不合格结果必须填写缺陷原因和处置方式');
    if (!DISPOSITIONS[kind].includes(disposition)) throw new HttpError(400, `处置方式必须是 ${DISPOSITIONS[kind].join(' / ')}`);
  }
  const criteria = db.prepare('SELECT * FROM inspection_criteria_snapshots WHERE inspection_type=? AND inspection_id=? ORDER BY source_item_id,sequence').all(kind, inspectionId);
  const submitted = new Map((body.criteria_results || body.criteriaResults || []).map((x) => [`${x.sourceItemId || x.source_item_id}:${Number(x.sequence)}`, x]));
  const evaluated = criteria.map((criterion) => {
    const value = submitted.get(`${criterion.source_item_id}:${criterion.sequence}`) || {};
    let passed = true; let passFail = null; let numeric = null; let text = null;
    if (criterion.result_type === 'PASS_FAIL') { passFail = String(value.result ?? value.passFailResult ?? '').toUpperCase(); if (!['PASS','FAIL'].includes(passFail)) passed = !criterion.required; else passed = passFail === 'PASS'; }
    if (criterion.result_type === 'NUMERIC') { numeric = Number(value.result ?? value.numericResult); if (!Number.isFinite(numeric)) passed = !criterion.required; else passed = (criterion.min_value === null || numeric >= criterion.min_value) && (criterion.max_value === null || numeric <= criterion.max_value); }
    if (criterion.result_type === 'TEXT') { text = String(value.result ?? value.textResult ?? '').trim(); passed = !criterion.required || Boolean(text); }
    if (result === 'PASS' && criterion.required && !passed) throw new HttpError(409, `必检项“${criterion.criterion_name}”未满足，不能判定合格`);
    return { criterion, passFail, numeric: Number.isFinite(numeric) ? numeric : null, text, passed };
  });
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`UPDATE ${c.headerTable} SET status='COMPLETED',result=?,qualified_quantity=?,reject_quantity=?,defect_reason=?,disposition=?,inspected_at=?,updated_at=? WHERE id=?`)
      .run(result, passed, failed, defectReason, disposition, now, now, inspectionId);
    const updateCriterion = db.prepare('UPDATE inspection_criteria_snapshots SET pass_fail_result=?,numeric_result=?,text_result=?,passed=?,completed_at=? WHERE id=?');
    const sub2 = c.sourceTypes[inspection.source_type];
    for (const x of evaluated) updateCriterion && updateCriterion.run(x.passFail, x.numeric, x.text, x.passed ? 1 : 0, now, x.criterion.id);
    const sourceItemColumn = sub2.sourceItemColumn || (inspection.source_type === 'OUTSOURCING_RECEIPT' ? 'outsourcing_receipt_item_id' : 'purchase_receipt_item_id');
    const sourceLineIds = db.prepare(`SELECT ${sourceItemColumn} id FROM ${c.itemTable} WHERE ${c.qualityForeignKey}=?`).all(inspectionId).map((item) => item.id).join(',');
    audit(db, actor.id, `COMPLETE_${result}`, `${kind}_INSPECTION`, inspectionId, `完成 ${kind} ${result}; 来源 ${inspection[sub2.sourceHeaderColumn]}; 来源行 ${sourceLineIds}`);
  });
  return send(res, 200, { ok: true, result });
}

async function cancel(db, req, res, actor, inspectionId, kind) {
  const c = qualityConfig(kind);
  allow(actor, `${kind}_MANAGE`);
  const inspection = db.prepare(`SELECT * FROM ${c.headerTable} WHERE id=?`).get(inspectionId);
  if (!inspection) throw new HttpError(404, `${kind} 检验单不存在`);
  if (!['DRAFT', 'PENDING'].includes(inspection.status)) throw new HttpError(409, '只有检验草稿可以取消');
  const now = new Date().toISOString();
  db.prepare(`UPDATE ${c.headerTable} SET status='CANCELLED',cancelled_at=?,updated_at=? WHERE id=?`).run(now, now, inspectionId);
  audit(db, actor.id, 'CANCEL', `${kind}_INSPECTION`, inspectionId, `取消 ${kind}; 来源 ${inspection.source_type || 'LEGACY'}`);
  return send(res, 200, { ok: true });
}

export const listIqcInspections = (db, res, actor, url) => list(db, res, actor, url, 'IQC');
export const listOqcInspections = (db, res, actor, url) => list(db, res, actor, url, 'OQC');
export const getIqcInspection = (db, res, actor, id) => { allowAny(actor, ['IQC_VIEW', 'IQC_MANAGE']); return send(res, 200, { inspection: loadInspection(db, 'IQC', id) }); };
export const getOqcInspection = (db, res, actor, id) => { allowAny(actor, ['OQC_VIEW', 'OQC_MANAGE']); return send(res, 200, { inspection: loadInspection(db, 'OQC', id) }); };
export const createIqcInspection = (db, req, res, actor) => create(db, req, res, actor, 'IQC');
export const createOqcInspection = (db, req, res, actor) => create(db, req, res, actor, 'OQC');
export const updateIqcInspection = (db, req, res, actor, id) => update(db, req, res, actor, id, 'IQC');
export const updateOqcInspection = (db, req, res, actor, id) => update(db, req, res, actor, id, 'OQC');
export const completeIqcInspection = (db, req, res, actor, id) => complete(db, req, res, actor, id, 'IQC');
export const completeOqcInspection = (db, req, res, actor, id) => complete(db, req, res, actor, id, 'OQC');
export const cancelIqcInspection = (db, req, res, actor, id) => cancel(db, req, res, actor, id, 'IQC');
export const cancelOqcInspection = (db, req, res, actor, id) => cancel(db, req, res, actor, id, 'OQC');
