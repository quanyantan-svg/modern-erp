import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, readJson, send } from '../lib/http.js';
import { deriveQualityState, loadQualitySource, qualityConfig, sameSourceSnapshot } from './quality-gates.js';

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
    partyColumn: kind === 'IQC' ? 'supplier_id' : 'customer_id',
    partyTable: kind === 'IQC' ? 'suppliers' : 'customers',
    partyAlias: kind === 'IQC' ? 'supplier' : 'customer',
  };
}

function sourceIdFromBody(kind, body) {
  return String(body[kind === 'IQC' ? 'purchase_receipt_id' : 'sales_delivery_id'] || '').trim();
}

function loadInspection(db, kind, inspectionId) {
  const v = kindValues(kind);
  const sourceDateColumn = kind === 'IQC' ? 'receipt_date' : 'delivery_date';
  const orderNumberColumn = kind === 'IQC' ? 'order_no' : 'order_no';
  const inspection = db.prepare(`SELECT q.*, p.code ${v.partyAlias}_code, p.name ${v.partyAlias}_name,
    u.display_name inspector_name, s.${v.c.sourceNumber} source_document_no, s.${sourceDateColumn} source_business_date,
    w.code source_warehouse_code, w.name source_warehouse_name, o.${orderNumberColumn} source_order_no
    FROM ${v.c.headerTable} q JOIN ${v.partyTable} p ON p.id=q.${v.partyColumn}
    LEFT JOIN users u ON u.id=q.inspector_id
    LEFT JOIN ${v.c.sourceHeaderTable} s ON s.id=q.${v.c.sourceHeaderColumn}
    LEFT JOIN warehouses w ON w.id=s.warehouse_id
    LEFT JOIN ${v.c.orderTable} o ON o.id=s.${v.c.orderColumn}
    WHERE q.id=?`).get(inspectionId);
  if (!inspection) throw new HttpError(404, `${kind} 检验单不存在`);
  inspection.authoritative = Boolean(inspection[v.c.sourceHeaderColumn]);
  inspection.legacy_unlinked = !inspection.authoritative;
  inspection.items = db.prepare(`SELECT qi.*, p.code product_code, p.name product_name, p.unit
    FROM ${v.c.itemTable} qi JOIN products p ON p.id=qi.product_id WHERE qi.${v.c.qualityForeignKey}=? ORDER BY qi.id`).all(inspectionId);
  if (inspection.authoritative) inspection.quality_state = deriveQualityState(db, kind, inspection[v.c.sourceHeaderColumn]);
  return inspection;
}

function list(db, res, actor, url, kind) {
  const v = kindValues(kind);
  allowAny(actor, v.viewPermissions);
  const status = url.searchParams.get('status') || '';
  let sql = `SELECT q.*, p.code ${v.partyAlias}_code, p.name ${v.partyAlias}_name, u.display_name inspector_name,
    s.${v.c.sourceNumber} source_document_no
    FROM ${v.c.headerTable} q JOIN ${v.partyTable} p ON p.id=q.${v.partyColumn}
    LEFT JOIN users u ON u.id=q.inspector_id LEFT JOIN ${v.c.sourceHeaderTable} s ON s.id=q.${v.c.sourceHeaderColumn}`;
  const params = [];
  if (status) { sql += ' WHERE q.status=?'; params.push(status); }
  sql += ' ORDER BY q.created_at DESC';
  const inspections = db.prepare(sql).all(...params).map((row) => ({ ...row, authoritative: Boolean(row[v.c.sourceHeaderColumn]), legacy_unlinked: !row[v.c.sourceHeaderColumn] }));
  return send(res, 200, { inspections });
}

async function create(db, req, res, actor, kind) {
  const v = kindValues(kind);
  allow(actor, v.permission);
  const body = await readJson(req);
  const forbiddenSourceFields = [v.partyColumn, v.c.legacyHeaderColumn, 'total_quantity', 'qualified_quantity', 'reject_quantity', 'product_id', 'unit_price_cents', 'items'];
  if (forbiddenSourceFields.some((field) => body[field] !== undefined)) throw new HttpError(400, '来源往来单位、产品、数量、价格和来源行由物流单继承，不可由客户端提交');
  const sourceId = sourceIdFromBody(kind, body);
  const { source, items } = loadQualitySource(db, kind, sourceId);
  const active = db.prepare(`SELECT id FROM ${v.c.headerTable} WHERE ${v.c.sourceHeaderColumn}=? AND status IN ('DRAFT','PENDING')`).get(sourceId);
  if (active) throw new HttpError(409, `该${v.c.sourceLabel}已有检验草稿，请先完成或取消`);
  const inspectionType = String(body.inspection_type || 'NORMAL').trim();
  if (!TYPES.includes(inspectionType)) throw new HttpError(400, `检验类型必须是 ${TYPES.join(' / ')}`);
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity), 0);
  const sampleQuantity = number(body.sample_quantity ?? totalQuantity, '抽样数量');
  if (sampleQuantity > totalQuantity) throw new HttpError(400, '抽样数量不能超过送检数量');
  const now = new Date().toISOString();
  const inspectionId = id();
  const seq = String(db.prepare(`SELECT COUNT(*) cnt FROM ${v.c.headerTable}`).get().cnt + 1).padStart(4, '0');
  const documentNo = `${v.prefix}-${now.slice(0, 10).replace(/-/g, '')}-${seq}`;
  const previous = db.prepare(`SELECT id FROM ${v.c.headerTable} WHERE ${v.c.sourceHeaderColumn}=? AND status='COMPLETED' LIMIT 1`).get(sourceId);
  transaction(db, () => {
    db.prepare(`INSERT INTO ${v.c.headerTable}(id,${v.numberColumn},${v.partyColumn},${v.c.sourceHeaderColumn},inspection_type,status,total_quantity,sample_quantity,qualified_quantity,reject_quantity,inspector_id,inspection_date,remark,created_at,updated_at)
      VALUES(?,?,?,?,?,'DRAFT',?,?,0,0,?,?,?,?,?)`).run(inspectionId, documentNo, source[v.c.partyColumn], sourceId, inspectionType, totalQuantity, sampleQuantity, actor.id, String(body.inspection_date || now.slice(0, 10)), String(body.remark || '').trim(), now, now);
    const insert = db.prepare(`INSERT INTO ${v.c.itemTable}(id,${v.c.qualityForeignKey},product_id,batch_no,quantity,sample_size,qualified,reject_reason,${v.c.sourceItemColumn},snapshot_warehouse_id,snapshot_batch_no,snapshot_quantity)
      VALUES(?,?,?,?,?,?,1,'',?,?,?,?)`);
    for (const item of items) insert.run(id(), inspectionId, item.product_id, String(item.batch_no || ''), Number(item.quantity), Number(item.quantity), item.id, source.warehouse_id, String(item.batch_no || ''), Number(item.quantity));
    audit(db, actor.id, previous ? 'REINSPECTION_CREATED' : 'CREATE', `${kind}_INSPECTION`, inspectionId, `${previous ? '创建复检单' : '新建检验单'} ${documentNo}; 来源 ${sourceId}; 来源行 ${items.map((item) => item.id).join(',')}`);
  });
  return send(res, 201, { id: inspectionId, [v.numberColumn]: documentNo });
}

async function update(db, req, res, actor, inspectionId, kind) {
  const v = kindValues(kind);
  allow(actor, v.permission);
  const body = await readJson(req);
  const inspection = db.prepare(`SELECT * FROM ${v.c.headerTable} WHERE id=?`).get(inspectionId);
  if (!inspection) throw new HttpError(404, `${kind} 检验单不存在`);
  if (!['DRAFT', 'PENDING'].includes(inspection.status)) throw new HttpError(409, '只有检验草稿可以修改');
  if (!inspection[v.c.sourceHeaderColumn]) throw new HttpError(409, '旧版未关联检验单只读');
  const immutable = [v.c.sourceHeaderColumn, v.c.legacyHeaderColumn, v.partyColumn, 'total_quantity'];
  for (const field of immutable) if (body[field] !== undefined && String(body[field]) !== String(inspection[field] ?? '')) throw new HttpError(409, '来源单据、往来单位和送检数量不可修改');
  const type = String(body.inspection_type ?? inspection.inspection_type);
  if (!TYPES.includes(type)) throw new HttpError(400, `检验类型必须是 ${TYPES.join(' / ')}`);
  const sample = number(body.sample_quantity ?? inspection.sample_quantity, '抽样数量');
  if (sample > Number(inspection.total_quantity)) throw new HttpError(400, '抽样数量不能超过送检数量');
  if (Array.isArray(body.items)) {
    const existing = db.prepare(`SELECT * FROM ${v.c.itemTable} WHERE ${v.c.qualityForeignKey}=?`).all(inspectionId);
    const existingBySource = new Map(existing.map((item) => [item[v.c.sourceItemColumn], item]));
    if (body.items.length !== existing.length) throw new HttpError(409, '检验来源明细不可增删');
    for (const item of body.items) {
      const sourceItemId = item[v.c.sourceItemColumn];
      const current = existingBySource.get(sourceItemId);
      if (!current || (item.product_id !== undefined && item.product_id !== current.product_id) || (item.quantity !== undefined && Number(item.quantity) !== Number(current.quantity))) throw new HttpError(409, '检验来源产品、数量或来源行不可修改');
    }
  }
  const now = new Date().toISOString();
  db.prepare(`UPDATE ${v.c.headerTable} SET inspection_type=?,sample_quantity=?,inspection_date=?,remark=?,updated_at=? WHERE id=?`)
    .run(type, sample, String(body.inspection_date || inspection.inspection_date || now.slice(0, 10)), String(body.remark ?? inspection.remark).trim(), now, inspectionId);
  audit(db, actor.id, 'UPDATE', `${kind}_INSPECTION`, inspectionId, `更新检验草稿; 来源 ${inspection[v.c.sourceHeaderColumn]}`);
  return send(res, 200, { ok: true });
}

async function complete(db, req, res, actor, inspectionId, kind) {
  const v = kindValues(kind);
  allow(actor, v.permission);
  const body = await readJson(req);
  const inspection = db.prepare(`SELECT * FROM ${v.c.headerTable} WHERE id=?`).get(inspectionId);
  if (!inspection) throw new HttpError(404, `${kind} 检验单不存在`);
  if (!['DRAFT', 'PENDING'].includes(inspection.status)) throw new HttpError(409, '检验单不是可完成的草稿状态');
  if (!inspection[v.c.sourceHeaderColumn]) throw new HttpError(409, '旧版未关联检验单不能满足权威质量门禁');
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
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`UPDATE ${v.c.headerTable} SET status='COMPLETED',result=?,qualified_quantity=?,reject_quantity=?,defect_reason=?,disposition=?,inspected_at=?,updated_at=? WHERE id=?`)
      .run(result, passed, failed, defectReason, disposition, now, now, inspectionId);
    const sourceLineIds = db.prepare(`SELECT ${v.c.sourceItemColumn} id FROM ${v.c.itemTable} WHERE ${v.c.qualityForeignKey}=?`).all(inspectionId).map((item) => item.id).join(',');
    audit(db, actor.id, `COMPLETE_${result}`, `${kind}_INSPECTION`, inspectionId, `完成 ${kind} ${result}; 来源 ${inspection[v.c.sourceHeaderColumn]}; 来源行 ${sourceLineIds}`);
  });
  return send(res, 200, { ok: true, result });
}

async function cancel(db, req, res, actor, inspectionId, kind) {
  const v = kindValues(kind);
  allow(actor, v.permission);
  const inspection = db.prepare(`SELECT * FROM ${v.c.headerTable} WHERE id=?`).get(inspectionId);
  if (!inspection) throw new HttpError(404, `${kind} 检验单不存在`);
  if (!['DRAFT', 'PENDING'].includes(inspection.status)) throw new HttpError(409, '只有检验草稿可以取消');
  const now = new Date().toISOString();
  db.prepare(`UPDATE ${v.c.headerTable} SET status='CANCELLED',cancelled_at=?,updated_at=? WHERE id=?`).run(now, now, inspectionId);
  audit(db, actor.id, 'CANCEL', `${kind}_INSPECTION`, inspectionId, `取消 ${kind}; 来源 ${inspection[v.c.sourceHeaderColumn] || 'LEGACY'}`);
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
