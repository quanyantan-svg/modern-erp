import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, optionalText, readJson,
  requiredCode, requiredText, send,
} from '../lib/http.js';
import { paymentTermsDays } from '../lib/payment-terms.js';

const VIEW_PERMISSIONS = ['PROCUREMENT_CONFIG_VIEW', 'PROCUREMENT_CONFIG_MANAGE'];
const CATEGORIES = new Set(['GENERAL', 'STRATEGIC', 'TRANSACTIONAL', 'OUTSOURCE']);
const QUALIFICATIONS = new Set(['QUALIFIED', 'UNQUALIFIED', 'SUSPENDED', 'BLACKLIST']);
const MEMBERSHIP_ROLES = new Set(['MEMBER', 'LEAD']);

function enumValue(value, values, label) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!values.has(normalized)) throw new HttpError(400, `${label}不正确`);
  return normalized;
}

function optionalDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new HttpError(400, `${label}格式应为 YYYY-MM-DD`);
  }
  return text;
}

function profileDto(row) {
  return {
    supplierId: row.id,
    supplierCode: row.code,
    supplierName: row.name,
    procurementEnabled: Boolean(row.procurement_enabled),
    outsourcingEnabled: Boolean(row.outsourcing_enabled),
    category: row.supplier_category,
    qualificationStatus: row.qualification_status,
    qualificationValidFrom: row.qualification_valid_from || null,
    qualificationValidTo: row.qualification_valid_to || null,
    defaultPaymentTermsDays: row.default_payment_terms_days,
    defaultCurrency: row.default_currency,
    supplierWipWarehouseId: row.supplier_wip_warehouse_id || null,
    outsourcingQualificationNote: row.outsourcing_qualification_note || '',
  };
}

function getSupplierProfileRow(db, supplierId) {
  const row = db.prepare(`SELECT id,code,name,procurement_enabled,outsourcing_enabled,supplier_category,
    qualification_status,qualification_valid_from,qualification_valid_to,default_payment_terms_days,
    default_currency,supplier_wip_warehouse_id,outsourcing_qualification_note
    FROM suppliers WHERE id=?`).get(supplierId);
  if (!row) throw new HttpError(404, '供应商不存在');
  return row;
}

export function getSupplierProcurementProfile(db, res, actor, supplierId) {
  allowAny(actor, VIEW_PERMISSIONS);
  return send(res, 200, { profile: profileDto(getSupplierProfileRow(db, supplierId)) });
}

export async function updateSupplierProcurementProfile(db, req, res, actor, supplierId) {
  allow(actor, 'PROCUREMENT_CONFIG_MANAGE');
  const current = getSupplierProfileRow(db, supplierId);
  const body = await readJson(req);
  assertAllowedFields(body, [
    'procurementEnabled', 'outsourcingEnabled', 'category', 'qualificationStatus',
    'qualificationValidFrom', 'qualificationValidTo', 'defaultPaymentTermsDays',
    'defaultCurrency', 'supplierWipWarehouseId', 'outsourcingQualificationNote',
  ]);
  const profile = {
    procurementEnabled: body.procurementEnabled === undefined ? Number(current.procurement_enabled) : (body.procurementEnabled ? 1 : 0),
    outsourcingEnabled: body.outsourcingEnabled === undefined ? Number(current.outsourcing_enabled) : (body.outsourcingEnabled ? 1 : 0),
    category: body.category === undefined ? current.supplier_category : enumValue(body.category, CATEGORIES, '供应商类别'),
    qualificationStatus: body.qualificationStatus === undefined ? current.qualification_status : enumValue(body.qualificationStatus, QUALIFICATIONS, '资质状态'),
    qualificationValidFrom: body.qualificationValidFrom === undefined ? current.qualification_valid_from : optionalDate(body.qualificationValidFrom, '资质生效日期'),
    qualificationValidTo: body.qualificationValidTo === undefined ? current.qualification_valid_to : optionalDate(body.qualificationValidTo, '资质失效日期'),
    defaultPaymentTermsDays: body.defaultPaymentTermsDays === undefined ? current.default_payment_terms_days : paymentTermsDays(body.defaultPaymentTermsDays),
    defaultCurrency: body.defaultCurrency === undefined ? current.default_currency : requiredCode(body.defaultCurrency, '默认币种'),
    supplierWipWarehouseId: body.supplierWipWarehouseId === undefined ? current.supplier_wip_warehouse_id : (body.supplierWipWarehouseId || null),
    outsourcingQualificationNote: body.outsourcingQualificationNote === undefined ? current.outsourcing_qualification_note : optionalText(body.outsourcingQualificationNote, 500),
  };
  if (profile.qualificationStatus === 'QUALIFIED' && (!profile.qualificationValidFrom || !profile.qualificationValidTo)) {
    throw new HttpError(409, '合格供应商必须设置完整的资质有效期');
  }
  if (profile.qualificationValidFrom && profile.qualificationValidTo && profile.qualificationValidFrom > profile.qualificationValidTo) {
    throw new HttpError(409, '资质失效日期不能早于生效日期');
  }
  if (profile.supplierWipWarehouseId) {
    const warehouse = db.prepare('SELECT id FROM warehouses WHERE id=? AND active=1').get(profile.supplierWipWarehouseId);
    if (!warehouse) throw new HttpError(409, '供应商 WIP 仓库不存在或未启用');
  }
  const now = new Date().toISOString();
  transaction(db, () => {
    const authoritative = getSupplierProfileRow(db, supplierId);
    const version = Number(db.prepare('SELECT COALESCE(MAX(version),0)+1 version FROM supplier_procurement_overrides WHERE supplier_id=?').get(supplierId).version);
    db.prepare('UPDATE supplier_procurement_overrides SET effective_to=? WHERE supplier_id=? AND effective_to IS NULL').run(now, supplierId);
    db.prepare(`UPDATE suppliers SET procurement_enabled=?,outsourcing_enabled=?,supplier_category=?,qualification_status=?,
      qualification_valid_from=?,qualification_valid_to=?,default_payment_terms_days=?,default_currency=?,
      supplier_wip_warehouse_id=?,outsourcing_qualification_note=?,updated_at=? WHERE id=?`).run(
      profile.procurementEnabled, profile.outsourcingEnabled, profile.category, profile.qualificationStatus,
      profile.qualificationValidFrom, profile.qualificationValidTo, profile.defaultPaymentTermsDays, profile.defaultCurrency,
      profile.supplierWipWarehouseId, profile.outsourcingQualificationNote, now, supplierId,
    );
    db.prepare(`INSERT INTO supplier_procurement_overrides(id,supplier_id,version,snapshot_json,effective_from,effective_to,changed_by,created_at)
      VALUES(?,?,?,?,?,NULL,?,?)`).run(id(), supplierId, version, JSON.stringify(profile), now, actor.id, now);
    audit(db, actor.id, 'UPDATE', 'SUPPLIER_PROCUREMENT_PROFILE', supplierId,
      JSON.stringify({ before: profileDto(authoritative), after: profile }));
  });
  return send(res, 200, { profile: profileDto(getSupplierProfileRow(db, supplierId)) });
}

function listMemberships(db, buyerId = null, groupId = null) {
  const where = buyerId ? 'WHERE bm.buyer_id=?' : groupId ? 'WHERE bm.purchasing_group_id=?' : '';
  const params = buyerId ? [buyerId] : groupId ? [groupId] : [];
  return db.prepare(`SELECT bm.id,bm.buyer_id buyerId,b.code buyerCode,b.name buyerName,
    bm.purchasing_group_id purchasingGroupId,g.code purchasingGroupCode,g.name purchasingGroupName,
    bm.role,bm.created_at createdAt
    FROM buyer_memberships bm JOIN buyers b ON b.id=bm.buyer_id
    JOIN purchasing_groups g ON g.id=bm.purchasing_group_id ${where}
    ORDER BY g.code,b.code`).all(...params);
}

export function listBuyers(db, res, actor) {
  allowAny(actor, VIEW_PERMISSIONS);
  const buyers = db.prepare(`SELECT b.id,b.code,b.name,b.user_id userId,b.active,b.created_at createdAt,b.updated_at updatedAt,
    u.display_name userName FROM buyers b LEFT JOIN users u ON u.id=b.user_id ORDER BY b.code`).all()
    .map((buyer) => ({ ...buyer, active: Boolean(buyer.active), memberships: listMemberships(db, buyer.id, null) }));
  return send(res, 200, { buyers });
}

function normalizeBuyer(db, body, current = null) {
  const userId = body.userId === undefined ? current?.user_id || null : (body.userId || null);
  if (userId && !db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(userId)) throw new HttpError(409, '关联用户不存在或未启用');
  return {
    code: requiredCode(body.code ?? current?.code, '采购员编码'),
    name: requiredText(body.name ?? current?.name, '采购员名称', 100),
    userId,
    active: body.active === undefined ? Number(current?.active ?? 1) : (body.active ? 1 : 0),
  };
}

export async function createBuyer(db, req, res, actor) {
  allow(actor, 'PROCUREMENT_CONFIG_MANAGE');
  const buyer = normalizeBuyer(db, await readJson(req));
  const buyerId = id(); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('INSERT INTO buyers(id,code,name,user_id,active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(buyerId, buyer.code, buyer.name, buyer.userId, buyer.active, actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'BUYER', buyerId, buyer.code);
  });
  return send(res, 201, { id: buyerId });
}

export async function updateBuyer(db, req, res, actor, buyerId) {
  allow(actor, 'PROCUREMENT_CONFIG_MANAGE');
  const current = db.prepare('SELECT * FROM buyers WHERE id=?').get(buyerId);
  if (!current) throw new HttpError(404, '采购员不存在');
  const buyer = normalizeBuyer(db, await readJson(req), current); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE buyers SET code=?,name=?,user_id=?,active=?,updated_at=? WHERE id=?')
      .run(buyer.code, buyer.name, buyer.userId, buyer.active, now, buyerId);
    audit(db, actor.id, 'UPDATE', 'BUYER', buyerId, buyer.code);
  });
  return send(res, 200, { ok: true });
}

export function listPurchasingGroups(db, res, actor) {
  allowAny(actor, VIEW_PERMISSIONS);
  const purchasingGroups = db.prepare('SELECT id,code,name,active,created_at createdAt,updated_at updatedAt FROM purchasing_groups ORDER BY code').all()
    .map((group) => ({ ...group, active: Boolean(group.active), memberships: listMemberships(db, null, group.id) }));
  return send(res, 200, { purchasingGroups });
}

function normalizeGroup(body, current = null) {
  return {
    code: requiredCode(body.code ?? current?.code, '采购组编码'),
    name: requiredText(body.name ?? current?.name, '采购组名称', 100),
    active: body.active === undefined ? Number(current?.active ?? 1) : (body.active ? 1 : 0),
  };
}

export async function createPurchasingGroup(db, req, res, actor) {
  allow(actor, 'PROCUREMENT_CONFIG_MANAGE');
  const group = normalizeGroup(await readJson(req)); const groupId = id(); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('INSERT INTO purchasing_groups(id,code,name,active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(groupId, group.code, group.name, group.active, actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'PURCHASING_GROUP', groupId, group.code);
  });
  return send(res, 201, { id: groupId });
}

export async function updatePurchasingGroup(db, req, res, actor, groupId) {
  allow(actor, 'PROCUREMENT_CONFIG_MANAGE');
  const current = db.prepare('SELECT * FROM purchasing_groups WHERE id=?').get(groupId);
  if (!current) throw new HttpError(404, '采购组不存在');
  const group = normalizeGroup(await readJson(req), current); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE purchasing_groups SET code=?,name=?,active=?,updated_at=? WHERE id=?')
      .run(group.code, group.name, group.active, now, groupId);
    audit(db, actor.id, 'UPDATE', 'PURCHASING_GROUP', groupId, group.code);
  });
  return send(res, 200, { ok: true });
}

export async function addBuyerMembership(db, req, res, actor, groupId) {
  allow(actor, 'PROCUREMENT_CONFIG_MANAGE');
  const group = db.prepare('SELECT id FROM purchasing_groups WHERE id=? AND active=1').get(groupId);
  if (!group) throw new HttpError(404, '采购组不存在或未启用');
  const body = await readJson(req);
  const buyerId = requiredText(body.buyerId, '采购员', 100);
  if (!db.prepare('SELECT 1 FROM buyers WHERE id=? AND active=1').get(buyerId)) throw new HttpError(409, '采购员不存在或未启用');
  const role = body.role === undefined ? 'MEMBER' : enumValue(body.role, MEMBERSHIP_ROLES, '组内角色');
  const membershipId = id(); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('INSERT INTO buyer_memberships(id,buyer_id,purchasing_group_id,role,created_by,created_at) VALUES(?,?,?,?,?,?)')
      .run(membershipId, buyerId, groupId, role, actor.id, now);
    audit(db, actor.id, 'CREATE', 'BUYER_MEMBERSHIP', membershipId, `${buyerId}:${groupId}:${role}`);
  });
  return send(res, 201, { id: membershipId });
}

export function removeBuyerMembership(db, res, actor, groupId, buyerId) {
  allow(actor, 'PROCUREMENT_CONFIG_MANAGE');
  transaction(db, () => {
    const membership = db.prepare('SELECT id FROM buyer_memberships WHERE purchasing_group_id=? AND buyer_id=?').get(groupId, buyerId);
    if (!membership) throw new HttpError(404, '采购员组成员关系不存在');
    db.prepare('DELETE FROM buyer_memberships WHERE id=?').run(membership.id);
    audit(db, actor.id, 'DELETE', 'BUYER_MEMBERSHIP', membership.id, `${buyerId}:${groupId}`);
  });
  return send(res, 200, { ok: true });
}
