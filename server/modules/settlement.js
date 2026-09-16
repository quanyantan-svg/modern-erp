import { randomUUID } from 'node:crypto';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, optionalText, readJson, send } from '../lib/http.js';
import { transaction } from '../db.js';

const STATUS_OUT = { PENDING: 'OPEN', PARTIAL: 'PARTIALLY_SETTLED', COMPLETED: 'SETTLED', WRITTEN_OFF: 'SETTLED' };
const STATUS_LABEL = { OPEN: '未结清', PARTIALLY_SETTLED: '部分收款', SETTLED: '已结清' };
const PAYMENT_STATUS_LABEL = { OPEN: '未结清', PARTIALLY_SETTLED: '部分付款', SETTLED: '已结清' };
const DOCUMENT_STATUS_LABEL = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };

function cents(value, label = '金额') {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new HttpError(400, `${label}必须是大于0的整数分`);
  return number;
}

function date(value, label = '业务日期') {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new HttpError(400, `${label}格式不正确`);
  return text;
}

function party(db, table, partyId, label) {
  const id = String(partyId || '').trim();
  if (!id || !db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND active=1`).get(id)) throw new HttpError(400, `请选择有效${label}`);
  return id;
}

function sourceStatus(row, paymentLabel = false) {
  const status = STATUS_OUT[row.status] || row.status;
  const netCents = row.amount_cents + row.adjustment_cents - row.paid_cents - row.write_off_cents;
  const isCredit = netCents < 0;
  return {
    ...row,
    originalCents: row.amount_cents,
    adjustmentCents: row.adjustment_cents,
    settledCents: row.paid_cents + row.write_off_cents,
    outstandingCents: Math.max(0, netCents),
    creditCents: Math.max(0, -netCents),
    netCents,
    status,
    statusLabel: isCredit ? (paymentLabel ? '供应商借项' : '客户贷项') : ((paymentLabel ? PAYMENT_STATUS_LABEL : STATUS_LABEL)[status] || status),
  };
}

function statusFilter(value) {
  return ({ OPEN: 'PENDING', PARTIALLY_SETTLED: 'PARTIAL', SETTLED: 'COMPLETED' })[value] || value;
}

export function listReceivables(db, res, actor, url) {
  allowAny(actor, ['AR_VIEW', 'COLLECTION_MANAGE']);
  const search = `%${url.searchParams.get('search') || ''}%`; const customerId = url.searchParams.get('customer'); const status = url.searchParams.get('status');
  const where = ['(ar.voucher_no LIKE ? OR ar.source_no LIKE ? OR c.code LIKE ? OR c.name LIKE ?)']; const params = [search, search, search, search];
  if (customerId) { where.push('ar.customer_id=?'); params.push(customerId); }
  if (status) { where.push('ar.status=?'); params.push(statusFilter(status)); }
  const rows = db.prepare(`SELECT ar.*,c.code customerCode,c.name customerName FROM account_receivables ar JOIN customers c ON c.id=ar.customer_id WHERE ${where.join(' AND ')} ORDER BY ar.business_date DESC,ar.created_at DESC LIMIT 200`).all(...params);
  return send(res, 200, { receivables: rows.map((row) => sourceStatus(row)), summary: { balanceCents: rows.reduce((sum, row) => sum + row.amount_cents + row.adjustment_cents - row.paid_cents - row.write_off_cents, 0) } });
}

export function getReceivable(db, res, actor, receivableId) {
  allowAny(actor, ['AR_VIEW', 'COLLECTION_MANAGE']);
  const row = db.prepare('SELECT ar.*,c.code customerCode,c.name customerName FROM account_receivables ar JOIN customers c ON c.id=ar.customer_id WHERE ar.id=?').get(receivableId);
  if (!row) throw new HttpError(404, '应收记录不存在');
  const collections = db.prepare(`SELECT pci.amount_cents allocatedCents,pc.id,pc.collection_no collectionNo,pc.collection_date businessDate,pc.status
    FROM payment_collection_items pci JOIN payment_collections pc ON pc.id=pci.collection_id WHERE pci.receivable_id=? ORDER BY pc.collection_date,pc.created_at`).all(receivableId);
  return send(res, 200, { receivable: { ...sourceStatus(row), collections } });
}

export function listPayables(db, res, actor, url) {
  allowAny(actor, ['AP_VIEW', 'PAYMENT_MANAGE']);
  const search = `%${url.searchParams.get('search') || ''}%`; const supplierId = url.searchParams.get('supplier'); const status = url.searchParams.get('status');
  const where = ['(ap.voucher_no LIKE ? OR ap.source_no LIKE ? OR s.code LIKE ? OR s.name LIKE ?)']; const params = [search, search, search, search];
  if (supplierId) { where.push('ap.supplier_id=?'); params.push(supplierId); }
  if (status) { where.push('ap.status=?'); params.push(statusFilter(status)); }
  const rows = db.prepare(`SELECT ap.*,s.code supplierCode,s.name supplierName FROM account_payables ap JOIN suppliers s ON s.id=ap.supplier_id WHERE ${where.join(' AND ')} ORDER BY ap.business_date DESC,ap.created_at DESC LIMIT 200`).all(...params);
  return send(res, 200, { payables: rows.map((row) => sourceStatus(row, true)), summary: { balanceCents: rows.reduce((sum, row) => sum + row.amount_cents + row.adjustment_cents - row.paid_cents - row.write_off_cents, 0) } });
}

export function getPayable(db, res, actor, payableId) {
  allowAny(actor, ['AP_VIEW', 'PAYMENT_MANAGE']);
  const row = db.prepare('SELECT ap.*,s.code supplierCode,s.name supplierName FROM account_payables ap JOIN suppliers s ON s.id=ap.supplier_id WHERE ap.id=?').get(payableId);
  if (!row) throw new HttpError(404, '应付记录不存在');
  const payments = db.prepare(`SELECT pdi.amount_cents allocatedCents,pd.id,pd.disbursement_no paymentNo,pd.disbursement_date businessDate,pd.status
    FROM payment_disbursement_items pdi JOIN payment_disbursements pd ON pd.id=pdi.disbursement_id WHERE pdi.payable_id=? ORDER BY pd.disbursement_date,pd.created_at`).all(payableId);
  return send(res, 200, { payable: { ...sourceStatus(row, true), payments } });
}

function statement(db, kind, url) {
  const ar = kind === 'AR'; const sourceTable = ar ? 'account_receivables' : 'account_payables'; const partyColumn = ar ? 'customer_id' : 'supplier_id';
  const settlementTable = ar ? 'payment_collections' : 'payment_disbursements'; const allocationTable = ar ? 'payment_collection_items' : 'payment_disbursement_items';
  const sourceFk = ar ? 'receivable_id' : 'payable_id'; const documentFk = ar ? 'collection_id' : 'disbursement_id'; const settlementDate = ar ? 'collection_date' : 'disbursement_date';
  const partyId = url.searchParams.get(ar ? 'customer' : 'supplier'); if (!partyId) throw new HttpError(400, ar ? '请选择客户' : '请选择供应商');
  const from = url.searchParams.get('dateFrom') || '0000-01-01'; const to = url.searchParams.get('dateTo') || '9999-12-31';
  const beforeSources = db.prepare(`SELECT COALESCE(SUM(amount_cents+adjustment_cents),0) n FROM ${sourceTable} WHERE ${partyColumn}=? AND business_date<?`).get(partyId, from).n;
  const beforeSettled = db.prepare(`SELECT COALESCE(SUM(ai.amount_cents),0) n FROM ${allocationTable} ai JOIN ${settlementTable} d ON d.id=ai.${documentFk} WHERE d.${partyColumn}=? AND d.status='CONFIRMED' AND d.${settlementDate}<?`).get(partyId, from).n;
  const period = db.prepare(`SELECT COALESCE(SUM(CASE WHEN amount_cents>0 THEN amount_cents ELSE 0 END),0) increases,COALESCE(SUM(CASE WHEN adjustment_cents<0 THEN -adjustment_cents ELSE 0 END),0) adjustments FROM ${sourceTable} WHERE ${partyColumn}=? AND business_date BETWEEN ? AND ?`).get(partyId, from, to);
  const settled = db.prepare(`SELECT COALESCE(SUM(ai.amount_cents),0) n FROM ${allocationTable} ai JOIN ${settlementTable} d ON d.id=ai.${documentFk} WHERE d.${partyColumn}=? AND d.status='CONFIRMED' AND d.${settlementDate} BETWEEN ? AND ?`).get(partyId, from, to).n;
  const requestedStatus = url.searchParams.get('status');
  const rows = db.prepare(`SELECT * FROM ${sourceTable} WHERE ${partyColumn}=? AND business_date BETWEEN ? AND ?${requestedStatus ? ' AND status=?' : ''} ORDER BY business_date,created_at`).all(...(requestedStatus ? [partyId, from, to, statusFilter(requestedStatus)] : [partyId, from, to])).map((row) => sourceStatus(row, !ar));
  const preRangeOutstandingCents = beforeSources - beforeSettled;
  return { rows, summary: { preRangeOutstandingCents, increaseCents: period.increases, adjustmentCents: period.adjustments, settledCents: settled, endingOutstandingCents: preRangeOutstandingCents + period.increases - period.adjustments - settled } };
}

export function customerStatement(db, res, actor, url) { allowAny(actor, ['AR_VIEW', 'COLLECTION_MANAGE']); return send(res, 200, statement(db, 'AR', url)); }
export function supplierStatement(db, res, actor, url) { allowAny(actor, ['AP_VIEW', 'PAYMENT_MANAGE']); return send(res, 200, statement(db, 'AP', url)); }

export function listSettlementParties(db, res, actor, url, kind) {
  const customer = kind === 'CUSTOMER';
  allowAny(actor, customer ? ['AR_VIEW', 'COLLECTION_MANAGE'] : ['AP_VIEW', 'PAYMENT_MANAGE']);
  const search = `%${url.searchParams.get('search') || ''}%`;
  const table = customer ? 'customers' : 'suppliers';
  const rows = db.prepare(`SELECT id,code,name FROM ${table} WHERE active=1 AND (code LIKE ? OR name LIKE ?) ORDER BY code LIMIT 200`).all(search, search);
  return send(res, 200, { [customer ? 'customers' : 'suppliers']: rows });
}

function documentConfig(kind) {
  const collection = kind === 'COLLECTION';
  return collection ? {
    table: 'payment_collections', itemTable: 'payment_collection_items', numberColumn: 'collection_no', numberKey: 'collectionNo', prefix: 'COL', partyTable: 'customers', partyColumn: 'customer_id', partyKey: 'customerId', partyLabel: '客户', sourceTable: 'account_receivables', sourceFk: 'receivable_id', sourceKey: 'receivableId', dateColumn: 'collection_date', dateKey: 'businessDate', permission: 'COLLECTION_MANAGE', viewPermissions: ['AR_VIEW', 'COLLECTION_MANAGE'], entity: 'PAYMENT_COLLECTION', voucherSource: 'PAYMENT_COLLECTION', debitCode: null, creditCode: '1122', auditNoun: '收款单', responseKey: 'collection', listKey: 'collections', listParty: 'customer', partyName: 'customerName', partyCode: 'customerCode', allocationKey: 'allocations', settledLabel: false,
  } : {
    table: 'payment_disbursements', itemTable: 'payment_disbursement_items', numberColumn: 'disbursement_no', numberKey: 'paymentNo', prefix: 'PAY', partyTable: 'suppliers', partyColumn: 'supplier_id', partyKey: 'supplierId', partyLabel: '供应商', sourceTable: 'account_payables', sourceFk: 'payable_id', sourceKey: 'payableId', dateColumn: 'disbursement_date', dateKey: 'businessDate', permission: 'PAYMENT_MANAGE', viewPermissions: ['AP_VIEW', 'PAYMENT_MANAGE'], entity: 'PAYMENT_DISBURSEMENT', voucherSource: 'PAYMENT_DISBURSEMENT', debitCode: '2202', creditCode: null, auditNoun: '付款单', responseKey: 'payment', listKey: 'payments', listParty: 'supplier', partyName: 'supplierName', partyCode: 'supplierCode', allocationKey: 'allocations', settledLabel: true,
  };
}

function mapDocument(row, cfg) {
  return { ...row, [cfg.numberKey]: row[cfg.numberColumn], amountCents: row.amount_cents, businessDate: row[cfg.dateColumn], paymentMethod: row.payment_method, statusLabel: DOCUMENT_STATUS_LABEL[row.status] || row.status };
}

function validateAllocations(db, cfg, partyId, raw = []) {
  if (!Array.isArray(raw)) throw new HttpError(400, '核销明细格式不正确');
  const seen = new Set();
  return raw.map((item, index) => {
    const sourceId = String(item?.[cfg.sourceKey] || '').trim(); if (!sourceId) throw new HttpError(400, `第${index + 1}行未选择待核销记录`);
    if (seen.has(sourceId)) throw new HttpError(400, '同一待核销记录不能重复选择'); seen.add(sourceId);
    const source = db.prepare(`SELECT id,${cfg.partyColumn} partyId FROM ${cfg.sourceTable} WHERE id=?`).get(sourceId);
    if (!source) throw new HttpError(400, `第${index + 1}行待核销记录不存在`);
    if (source.partyId !== partyId) throw new HttpError(400, `核销记录必须属于同一${cfg.partyLabel}`);
    return { sourceId, amountCents: cents(item.amountCents, `第${index + 1}行核销金额`) };
  });
}

function saveAllocations(db, cfg, documentId, allocations) {
  db.prepare(`DELETE FROM ${cfg.itemTable} WHERE ${cfg.table === 'payment_collections' ? 'collection_id' : 'disbursement_id'}=?`).run(documentId);
  const documentFk = cfg.table === 'payment_collections' ? 'collection_id' : 'disbursement_id';
  const insert = db.prepare(`INSERT INTO ${cfg.itemTable}(id,${documentFk},${cfg.sourceFk},amount_cents) VALUES(?,?,?,?)`);
  for (const item of allocations) insert.run(randomUUID(), documentId, item.sourceId, item.amountCents);
}

export function listSettlementDocuments(db, res, actor, url, kind) {
  const cfg = documentConfig(kind); allowAny(actor, cfg.viewPermissions);
  const search = `%${url.searchParams.get('search') || ''}%`; const status = url.searchParams.get('status'); const partyId = url.searchParams.get(cfg.listParty);
  const partyAlias = cfg.partyTable === 'customers' ? 'c' : 's'; const where = [`(d.${cfg.numberColumn} LIKE ? OR ${partyAlias}.code LIKE ? OR ${partyAlias}.name LIKE ?)`]; const params = [search, search, search];
  if (status) { where.push('d.status=?'); params.push(status); } if (partyId) { where.push(`d.${cfg.partyColumn}=?`); params.push(partyId); }
  const rows = db.prepare(`SELECT d.*,${partyAlias}.code ${cfg.partyCode},${partyAlias}.name ${cfg.partyName} FROM ${cfg.table} d JOIN ${cfg.partyTable} ${partyAlias} ON ${partyAlias}.id=d.${cfg.partyColumn} WHERE ${where.join(' AND ')} ORDER BY d.${cfg.dateColumn} DESC,d.created_at DESC LIMIT 200`).all(...params);
  return send(res, 200, { [cfg.listKey]: rows.map((row) => mapDocument(row, cfg)) });
}

export async function createSettlementDocument(db, req, res, actor, kind) {
  const cfg = documentConfig(kind); allow(actor, cfg.permission); const body = await readJson(req);
  const partyId = party(db, cfg.partyTable, body[cfg.partyKey], cfg.partyLabel); const amountCents = cents(body.amountCents); const businessDate = date(body.businessDate || new Date().toISOString().slice(0, 10));
  const paymentMethod = String(body.paymentMethod || 'BANK').toUpperCase(); if (!['CASH', 'BANK'].includes(paymentMethod)) throw new HttpError(400, '收付方式仅支持现金或银行');
  const allocations = validateAllocations(db, cfg, partyId, body.allocations || []); const documentId = randomUUID(); const createdAt = new Date().toISOString(); const documentNo = `${cfg.prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
  transaction(db, () => {
    db.prepare(`INSERT INTO ${cfg.table}(id,${cfg.numberColumn},${cfg.partyColumn},amount_cents,payment_method,bank_account,${cfg.dateColumn},remark,creator_id,created_at,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'DRAFT',?)`)
      .run(documentId, documentNo, partyId, amountCents, paymentMethod, optionalText(body.bankAccount, 100), businessDate, optionalText(body.remark, 500), actor.id, createdAt, createdAt);
    saveAllocations(db, cfg, documentId, allocations); audit(db, actor.id, 'CREATE', cfg.entity, documentId, `创建${cfg.auditNoun} ${documentNo}`);
  });
  return send(res, 201, { id: documentId, [cfg.numberKey]: documentNo });
}

export async function updateSettlementDocument(db, req, res, actor, kind, documentId) {
  const cfg = documentConfig(kind); allow(actor, cfg.permission); const current = db.prepare(`SELECT * FROM ${cfg.table} WHERE id=?`).get(documentId);
  if (!current) throw new HttpError(404, `${cfg.auditNoun}不存在`); if (current.status !== 'DRAFT') throw new HttpError(409, `只有草稿${cfg.auditNoun}可以修改`);
  const body = await readJson(req); const partyId = party(db, cfg.partyTable, body[cfg.partyKey], cfg.partyLabel); const amountCents = cents(body.amountCents); const businessDate = date(body.businessDate); const paymentMethod = String(body.paymentMethod || 'BANK').toUpperCase();
  if (!['CASH', 'BANK'].includes(paymentMethod)) throw new HttpError(400, '收付方式仅支持现金或银行'); const allocations = validateAllocations(db, cfg, partyId, body.allocations || []); const updatedAt = new Date().toISOString();
  transaction(db, () => { db.prepare(`UPDATE ${cfg.table} SET ${cfg.partyColumn}=?,amount_cents=?,payment_method=?,bank_account=?,${cfg.dateColumn}=?,remark=?,updated_at=? WHERE id=?`).run(partyId, amountCents, paymentMethod, optionalText(body.bankAccount, 100), businessDate, optionalText(body.remark, 500), updatedAt, documentId); saveAllocations(db, cfg, documentId, allocations); audit(db, actor.id, 'UPDATE', cfg.entity, documentId, `修改${cfg.auditNoun} ${current[cfg.numberColumn]}`); });
  return send(res, 200, { ok: true });
}

export function getSettlementDocument(db, res, actor, kind, documentId) {
  const cfg = documentConfig(kind); allowAny(actor, cfg.viewPermissions); const partyAlias = cfg.partyTable === 'customers' ? 'c' : 's';
  const row = db.prepare(`SELECT d.*,${partyAlias}.code ${cfg.partyCode},${partyAlias}.name ${cfg.partyName},u.display_name creatorName,cu.display_name confirmedByName FROM ${cfg.table} d JOIN ${cfg.partyTable} ${partyAlias} ON ${partyAlias}.id=d.${cfg.partyColumn} JOIN users u ON u.id=d.creator_id LEFT JOIN users cu ON cu.id=d.confirmed_by WHERE d.id=?`).get(documentId);
  if (!row) throw new HttpError(404, `${cfg.auditNoun}不存在`); const documentFk = cfg.table === 'payment_collections' ? 'collection_id' : 'disbursement_id';
  const allocations = db.prepare(`SELECT ai.${cfg.sourceFk} ${cfg.sourceKey},ai.amount_cents amountCents,s.source_no sourceNo,s.business_date businessDate,s.amount_cents+s.adjustment_cents-s.paid_cents-s.write_off_cents currentOutstandingCents FROM ${cfg.itemTable} ai JOIN ${cfg.sourceTable} s ON s.id=ai.${cfg.sourceFk} WHERE ai.${documentFk}=? ORDER BY s.business_date,s.created_at`).all(documentId);
  return send(res, 200, { [cfg.responseKey]: { ...mapDocument(row, cfg), allocations } });
}

function resolveSubjects(db, paymentMethod, cfg) {
  const cashCode = paymentMethod === 'CASH' ? '1001' : '1002'; const codes = [cashCode, cfg.debitCode || cfg.creditCode];
  const subjects = db.prepare(`SELECT id,code FROM accounting_subjects WHERE active=1 AND code IN (?,?)`).all(...codes); const byCode = Object.fromEntries(subjects.map((row) => [row.code, row.id]));
  if (!byCode[cashCode] || !byCode[cfg.debitCode || cfg.creditCode]) throw new HttpError(409, '结算科目未配置，无法确认');
  return { cash: byCode[cashCode], control: byCode[cfg.debitCode || cfg.creditCode] };
}

export async function confirmSettlementDocument(db, req, res, actor, kind, documentId, generateVoucher) {
  const cfg = documentConfig(kind); allow(actor, cfg.permission); await readJson(req); const confirmedAt = new Date().toISOString();
  transaction(db, () => {
    const document = db.prepare(`SELECT * FROM ${cfg.table} WHERE id=?`).get(documentId); if (!document) throw new HttpError(404, `${cfg.auditNoun}不存在`); if (document.status !== 'DRAFT') throw new HttpError(409, `${cfg.auditNoun}不是可确认的草稿状态`);
    const documentFk = cfg.table === 'payment_collections' ? 'collection_id' : 'disbursement_id'; const allocations = db.prepare(`SELECT ai.*,s.${cfg.partyColumn} partyId,s.amount_cents+s.adjustment_cents-s.paid_cents-s.write_off_cents outstandingCents FROM ${cfg.itemTable} ai JOIN ${cfg.sourceTable} s ON s.id=ai.${cfg.sourceFk} WHERE ai.${documentFk}=?`).all(documentId);
    if (!allocations.length) throw new HttpError(400, '至少需要一条核销明细'); const total = allocations.reduce((sum, item) => sum + item.amount_cents, 0); if (total !== document.amount_cents) throw new HttpError(409, '核销合计必须等于单据金额');
    for (const item of allocations) { if (item.partyId !== document[cfg.partyColumn]) throw new HttpError(409, `核销记录必须属于同一${cfg.partyLabel}`); if (item.amount_cents > item.outstandingCents) throw new HttpError(409, cfg.settledLabel ? '付款金额超过当前未付余额' : '收款金额超过当前未收余额'); }
    const subjects = resolveSubjects(db, document.payment_method, cfg);
    for (const item of allocations) { const source = db.prepare(`SELECT amount_cents,adjustment_cents,paid_cents,write_off_cents FROM ${cfg.sourceTable} WHERE id=?`).get(item[cfg.sourceFk]); const nextPaid = source.paid_cents + item.amount_cents; const outstanding = source.amount_cents + source.adjustment_cents - nextPaid - source.write_off_cents; const nextStatus = outstanding === 0 ? 'COMPLETED' : 'PARTIAL'; db.prepare(`UPDATE ${cfg.sourceTable} SET paid_cents=?,status=?,updated_at=? WHERE id=?`).run(nextPaid, nextStatus, confirmedAt, item[cfg.sourceFk]); }
    const isCollection = kind === 'COLLECTION'; generateVoucher(db, cfg.voucherSource, documentId, [
      { subjectId: isCollection ? subjects.cash : subjects.control, direction: 'DEBIT', amountCents: document.amount_cents, summary: `${cfg.auditNoun} ${document[cfg.numberColumn]}` },
      { subjectId: isCollection ? subjects.control : subjects.cash, direction: 'CREDIT', amountCents: document.amount_cents, summary: `${cfg.auditNoun} ${document[cfg.numberColumn]}` },
    ], actor, document[cfg.dateColumn]);
    db.prepare(`UPDATE ${cfg.table} SET status='CONFIRMED',confirmed_by=?,confirmed_at=?,updated_at=? WHERE id=?`).run(actor.id, confirmedAt, confirmedAt, documentId); audit(db, actor.id, 'CONFIRM', cfg.entity, documentId, `确认${cfg.auditNoun} ${document[cfg.numberColumn]}`);
  });
  return send(res, 200, { ok: true });
}

export async function cancelSettlementDocument(db, req, res, actor, kind, documentId) {
  const cfg = documentConfig(kind); allow(actor, cfg.permission); await readJson(req); const current = db.prepare(`SELECT * FROM ${cfg.table} WHERE id=?`).get(documentId);
  if (!current) throw new HttpError(404, `${cfg.auditNoun}不存在`); if (current.status !== 'DRAFT') throw new HttpError(409, `只有草稿${cfg.auditNoun}可以取消`); const updatedAt = new Date().toISOString();
  db.prepare(`UPDATE ${cfg.table} SET status='CANCELLED',updated_at=? WHERE id=?`).run(updatedAt, documentId); audit(db, actor.id, 'CANCEL', cfg.entity, documentId, `取消${cfg.auditNoun} ${current[cfg.numberColumn]}`); return send(res, 200, { ok: true });
}
