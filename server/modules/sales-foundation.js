import { id } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, normalizeBusinessDate,
  optionalText, readJson, requiredCode, requiredText, send,
} from '../lib/http.js';
import {
  assertDateRange, boolInt, conflict, lockById, mapBoolFields, nullableId,
  optionalDate, runSalesWrite, translateConstraintError,
} from './sales-foundation-common.js';

const VIEW = ['SALES_FOUNDATION_VIEW', 'SALES_FOUNDATION_MANAGE', 'SALES_COMMERCIAL_MANAGE'];

function groupRow(row) {
  return mapBoolFields({ id: row.id, groupCode: row.group_code, name: row.name, description: row.description || '', active: row.active, createdAt: row.created_at, updatedAt: row.updated_at }, ['active']);
}

function salespersonRow(row) {
  return mapBoolFields({ id: row.id, salespersonCode: row.salesperson_code, name: row.name, userId: row.user_id, active: row.active, createdAt: row.created_at, updatedAt: row.updated_at }, ['active']);
}

function membershipRow(row) {
  return mapBoolFields({
    id: row.id, salespersonId: row.salesperson_id, salesGroupId: row.sales_group_id,
    salespersonName: row.salesperson_name, salesGroupName: row.sales_group_name,
    isDefault: row.is_default, active: row.active, effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to, createdAt: row.created_at, updatedAt: row.updated_at,
  }, ['isDefault', 'active']);
}

export function listSalesGroups(db, res, actor) {
  allowAny(actor, VIEW);
  return send(res, 200, { salesGroups: db.prepare('SELECT * FROM sales_groups ORDER BY group_code').all().map(groupRow) });
}

export async function saveSalesGroup(db, req, res, actor, groupId = null) {
  allow(actor, 'SALES_FOUNDATION_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['groupCode', 'name', 'description', 'active']);
  const now = new Date().toISOString();
  let targetId = groupId;
  try {
    runSalesWrite(db, () => {
      const existing = groupId ? lockById(db, 'sales_groups', groupId) : null;
      if (groupId && !existing) throw new HttpError(404, '销售组不存在');
      const groupCode = body.groupCode === undefined && groupId
        ? db.prepare('SELECT group_code FROM sales_groups WHERE id=?').get(groupId).group_code
        : requiredCode(body.groupCode, '销售组编码');
      const name = body.name === undefined && groupId
        ? db.prepare('SELECT name FROM sales_groups WHERE id=?').get(groupId).name
        : requiredText(body.name, '销售组名称', 100);
      const description = body.description === undefined && groupId
        ? db.prepare('SELECT description FROM sales_groups WHERE id=?').get(groupId).description
        : optionalText(body.description, 300);
      if (groupId) {
        const current = db.prepare('SELECT active FROM sales_groups WHERE id=?').get(groupId);
        db.prepare('UPDATE sales_groups SET group_code=?,name=?,description=?,active=?,updated_at=? WHERE id=?')
          .run(groupCode, name, description, boolInt(body.active, Boolean(current.active)), now, groupId);
        audit(db, actor.id, 'UPDATE', 'SALES_GROUP', groupId, groupCode);
      } else {
        targetId = id();
        db.prepare('INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
          .run(targetId, groupCode, name, description, boolInt(body.active, true), now, now);
        audit(db, actor.id, 'CREATE', 'SALES_GROUP', targetId, groupCode);
      }
    });
  } catch (error) { translateConstraintError(error, '销售组编码已存在'); }
  return send(res, groupId ? 200 : 201, { salesGroup: groupRow(db.prepare('SELECT * FROM sales_groups WHERE id=?').get(targetId)) });
}

export function listSalespersons(db, res, actor) {
  allowAny(actor, VIEW);
  return send(res, 200, { salespersons: db.prepare('SELECT * FROM salesperson_profiles ORDER BY salesperson_code').all().map(salespersonRow) });
}

export async function saveSalesperson(db, req, res, actor, salespersonId = null) {
  allow(actor, 'SALES_FOUNDATION_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['salespersonCode', 'name', 'userId', 'active']);
  const now = new Date().toISOString();
  let targetId = salespersonId;
  try {
    runSalesWrite(db, () => {
      const old = salespersonId ? db.prepare(`SELECT * FROM salesperson_profiles WHERE id=?${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(salespersonId) : null;
      if (salespersonId && !old) throw new HttpError(404, '销售员不存在');
      const code = body.salespersonCode === undefined && old ? old.salesperson_code : requiredCode(body.salespersonCode, '销售员编码');
      const name = body.name === undefined && old ? old.name : requiredText(body.name, '销售员名称', 100);
      const userId = body.userId === undefined && old ? old.user_id : nullableId(body.userId);
      if (userId && !db.prepare('SELECT 1 FROM users WHERE id=?').get(userId)) throw new HttpError(400, '关联登录用户不存在');
      // SoD — self-assignment. A SALES actor (the canonical Sales role carries
      // SALES_FOUNDATION_MANAGE) cannot bind a salesperson profile to their own
      // login user, and cannot rebind an existing salesperson to their own
      // login. Only an admin-grade actor (USERS_MANAGE) can do that binding.
      if (userId && userId === actor.id && !actor.permissions.includes('USERS_MANAGE')) {
        throw new HttpError(403, '不得将销售员绑定到当前登录用户', { code: 'SALESPERSON_SELF_ASSIGNMENT_DENIED' });
      }
      if (old) {
        db.prepare('UPDATE salesperson_profiles SET salesperson_code=?,name=?,user_id=?,active=?,updated_at=? WHERE id=?')
          .run(code, name, userId, boolInt(body.active, Boolean(old.active)), now, old.id);
        audit(db, actor.id, 'UPDATE', 'SALESPERSON', old.id, code);
      } else {
        targetId = id();
        db.prepare('INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
          .run(targetId, code, name, userId, boolInt(body.active, true), now, now);
        audit(db, actor.id, 'CREATE', 'SALESPERSON', targetId, code);
      }
    });
  } catch (error) { translateConstraintError(error, '销售员编码或登录用户关联已存在'); }
  return send(res, salespersonId ? 200 : 201, { salesperson: salespersonRow(db.prepare('SELECT * FROM salesperson_profiles WHERE id=?').get(targetId)) });
}

function membershipRows(db, salespersonId) {
  return db.prepare(`SELECT m.*,p.name salesperson_name,g.name sales_group_name
    FROM salesperson_group_memberships m
    JOIN salesperson_profiles p ON p.id=m.salesperson_id
    JOIN sales_groups g ON g.id=m.sales_group_id
    WHERE m.salesperson_id=? ORDER BY m.effective_from,m.id`).all(salespersonId);
}

function nextDate(date) {
  const probe = new Date(`${date}T00:00:00Z`); probe.setUTCDate(probe.getUTCDate() + 1); return probe.toISOString().slice(0, 10);
}

function validateMembershipDefaults(rows) {
  const dates = new Set();
  for (const row of rows.filter((item) => item.active)) {
    dates.add(row.effective_from);
    if (row.effective_to) dates.add(nextDate(row.effective_to));
  }
  for (const date of dates) {
    const current = rows.filter((row) => row.active && row.effective_from <= date && (!row.effective_to || row.effective_to >= date));
    if (current.length && current.filter((row) => row.is_default).length !== 1) {
      throw conflict(`销售员在 ${date} 的有效销售组必须恰有一个默认组`, 'SALESPERSON_DEFAULT_GROUP_INVALID');
    }
  }
}

export function listSalespersonMemberships(db, res, actor, url) {
  allowAny(actor, VIEW);
  const salespersonId = String(url.searchParams.get('salespersonId') || '').trim();
  if (!salespersonId) throw new HttpError(400, '请指定销售员');
  return send(res, 200, { memberships: membershipRows(db, salespersonId).map(membershipRow) });
}

export async function saveSalespersonMembership(db, req, res, actor, membershipId = null) {
  allow(actor, 'SALES_FOUNDATION_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['salespersonId', 'salesGroupId', 'isDefault', 'active', 'effectiveFrom', 'effectiveTo', 'replaceDefault']);
  const now = new Date().toISOString();
  let targetId = membershipId;
  try {
    runSalesWrite(db, () => {
      const old = membershipId ? db.prepare(`SELECT * FROM salesperson_group_memberships WHERE id=?${db.dialect === 'mysql' ? ' FOR UPDATE' : ''}`).get(membershipId) : null;
      if (membershipId && !old) throw new HttpError(404, '销售组成员关系不存在');
      const salespersonId = nullableId(body.salespersonId) || old?.salesperson_id;
      const salesGroupId = nullableId(body.salesGroupId) || old?.sales_group_id;
      const salesperson = lockById(db, 'salesperson_profiles', salespersonId);
      if (!salesperson) throw new HttpError(400, '销售员不存在');
      const group = db.prepare('SELECT active FROM sales_groups WHERE id=?').get(salesGroupId);
      if (!group) throw new HttpError(400, '销售组不存在');
      // SoD — self-default escalation. A SALES actor (which carries
      // SALES_FOUNDATION_MANAGE) cannot create, change, or replace the
      // default membership of a salesperson profile that is bound to the
      // actor's own login user. Only an admin-grade actor (USERS_MANAGE)
      // may alter that binding. The check is performed BEFORE the draft
      // mutation writes anything, so a rejected actor leaves zero
      // business / audit side effect.
      const actorLinkedPerson = db.prepare('SELECT id FROM salesperson_profiles WHERE user_id=?').get(actor.id);
      if (actorLinkedPerson && actorLinkedPerson.id === salespersonId && !actor.permissions.includes('USERS_MANAGE')) {
        throw new HttpError(403, '不得变更或维护当前登录销售员的成员关系', { code: 'SALESPERSON_SELF_DEFAULT_DENIED' });
      }
      const effectiveFrom = body.effectiveFrom === undefined && old ? old.effective_from : normalizeBusinessDate(body.effectiveFrom, '生效日期');
      const effectiveTo = body.effectiveTo === undefined && old ? old.effective_to : optionalDate(body.effectiveTo);
      assertDateRange(effectiveFrom, effectiveTo);
      const isDefault = boolInt(body.isDefault, old ? Boolean(old.is_default) : false);
      const active = boolInt(body.active, old ? Boolean(old.active) : true);
      if (isDefault && body.replaceDefault) {
        db.prepare('UPDATE salesperson_group_memberships SET is_default=0,updated_at=?,updated_by=? WHERE salesperson_id=? AND id<>?')
          .run(now, actor.id, salespersonId, membershipId || '');
      }
      if (old) {
        if (old.salesperson_id !== salespersonId) throw new HttpError(400, '成员关系所属销售员不可变更');
        db.prepare(`UPDATE salesperson_group_memberships SET sales_group_id=?,is_default=?,active=?,effective_from=?,effective_to=?,updated_at=?,updated_by=? WHERE id=?`)
          .run(salesGroupId, isDefault, active, effectiveFrom, effectiveTo, now, actor.id, old.id);
        audit(db, actor.id, 'UPDATE', 'SALESPERSON_GROUP_MEMBERSHIP', old.id, `${salespersonId}:${salesGroupId}`);
      } else {
        targetId = id();
        db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,effective_to,created_at,updated_at,created_by,updated_by)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(targetId, salespersonId, salesGroupId, isDefault, active, effectiveFrom, effectiveTo, now, now, actor.id, actor.id);
        audit(db, actor.id, 'CREATE', 'SALESPERSON_GROUP_MEMBERSHIP', targetId, `${salespersonId}:${salesGroupId}`);
      }
      const rows = membershipRows(db, salespersonId);
      validateMembershipDefaults(rows);
      for (const row of rows.filter((item) => item.active)) {
        const target = db.prepare('SELECT active FROM sales_groups WHERE id=?').get(row.sales_group_id);
        if (!target?.active) throw conflict('有效成员关系不能引用停用销售组', 'SALESPERSON_GROUP_INACTIVE');
      }
    });
  } catch (error) { translateConstraintError(error, '销售员成员关系与现有日期版本冲突'); }
  return send(res, membershipId ? 200 : 201, { membership: membershipRow(db.prepare(`SELECT m.*,p.name salesperson_name,g.name sales_group_name FROM salesperson_group_memberships m JOIN salesperson_profiles p ON p.id=m.salesperson_id JOIN sales_groups g ON g.id=m.sales_group_id WHERE m.id=?`).get(targetId)) });
}

export function resolveSalespersonGroup(db, userId, businessDate) {
  const date = normalizeBusinessDate(businessDate, '业务日期');
  const person = db.prepare('SELECT * FROM salesperson_profiles WHERE user_id=? AND active=1').get(userId);
  if (!person) throw conflict('登录用户未关联有效销售员', 'SALESPERSON_LINK_UNAVAILABLE');
  const rows = db.prepare(`SELECT m.*,g.active group_active FROM salesperson_group_memberships m JOIN sales_groups g ON g.id=m.sales_group_id
    WHERE m.salesperson_id=? AND m.active=1 AND m.effective_from<=? AND (m.effective_to IS NULL OR m.effective_to>=?)`).all(person.id, date, date);
  const valid = rows.filter((row) => row.group_active);
  const defaults = valid.filter((row) => row.is_default);
  if (!valid.length || defaults.length !== 1) throw conflict('销售员在业务日期没有唯一有效默认销售组', 'SALESPERSON_DEFAULT_GROUP_UNAVAILABLE');
  return { salespersonId: person.id, salesGroupId: defaults[0].sales_group_id };
}
