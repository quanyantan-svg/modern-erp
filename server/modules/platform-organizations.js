// Platform 组织主数据与作用域登记（PL-03）。
//
// 设计来源：docs/design/platform.md §32.5；Requirement §36.5。
//
// 本模块是组织主数据的**唯一 owner**（PL-DEC-02：所有权由 Master & Engineering 移交 Platform）。
// 它只提供**组织注册表**与**作用域登记**两件事：
//   - 组织注册表：法人实体 / 业务单元 + 父子层级 + 启停用；
//   - 作用域登记：作用域 ↔ 组织的绑定（SINGLE 恰好一个 / MULTI 多个）。
//
// 明确不做：
//   - **不向业务表铺开 org_id**（多组织业务数据隔离）—— Requirement §36.5 判为 `OUT_OF_SCOPE`，
//     遵守 solution.md §20.7 的加法式逐域迁移原则；
//   - **不改 accounting_scopes.org_scope 的校验语义**（那是自由文本标签 + COSTING_SCOPE_OWNERS）——
//     二者通过 scope_code ↔ accounting_scopes.code 的**显式映射**关联，不合并、不替换；
//   - **不改 departments** —— 它是成本维度且从未被查询使用，不是组织轴。

import {
  allow, allowAny, assertAllowedFields, HttpError, optionalText, readJson, requiredCode,
  requiredText, send,
} from '../lib/http.js';
import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';

const ORG_TYPES = ['LEGAL_ENTITY', 'BUSINESS_UNIT'];
const ORG_STATUSES = ['ACTIVE', 'INACTIVE'];
const BINDING_MODES = ['SINGLE', 'MULTI'];

function nowIso() { return new Date().toISOString(); }

function notFound(message, code) { return new HttpError(404, message, { code }); }
function conflict(message, code) { return new HttpError(409, message, { code }); }

function presentOrganization(row) {
  return {
    id: row.id, code: row.code, name: row.name, orgType: row.org_type,
    parentOrgId: row.parent_org_id, status: row.status,
    effectiveFrom: row.effective_from, effectiveTo: row.effective_to,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function presentScope(row, bindings = []) {
  return {
    id: row.id, scopeCode: row.scope_code, name: row.name, bindingMode: row.binding_mode,
    createdAt: row.created_at, organizationIds: bindings,
  };
}

/**
 * 防环：父链不得回到自身，也不得形成环。
 * 返回 true 表示合法。
 */
function assertNoCycle(db, orgId, parentOrgId) {
  if (!parentOrgId) return true;
  if (parentOrgId === orgId) throw conflict('组织不能以自身或后代为上级', 'PLATFORM_ORGANIZATION_CYCLE');
  const seen = new Set();
  let current = parentOrgId;
  while (current) {
    if (current === orgId) throw conflict('组织层级不能形成环', 'PLATFORM_ORGANIZATION_CYCLE');
    if (seen.has(current)) break;
    seen.add(current);
    const row = db.prepare('SELECT parent_org_id FROM organizations WHERE id=?').get(current);
    if (!row) break;
    current = row.parent_org_id;
  }
  return true;
}

/**
 * 解析一个作用域绑定的组织 id 列表。
 * SINGLE 模式必须恰好绑定一个组织 —— 绑定 0 个或多个都是配置错误，必须失败即拒绝。
 */
export function resolveOrganizationScope(db, scopeCode) {
  const scope = db.prepare('SELECT * FROM organization_scopes WHERE scope_code=?').get(String(scopeCode));
  if (!scope) throw notFound('作用域不存在', 'PLATFORM_SCOPE_NOT_FOUND');
  const bindings = db.prepare(
    'SELECT b.org_id FROM organization_scope_bindings b JOIN organizations o ON o.id=b.org_id'
    + ' WHERE b.scope_id=? AND o.status=\'ACTIVE\' ORDER BY o.code',
  ).all(scope.id).map((row) => row.org_id);
  if (scope.binding_mode === 'SINGLE' && bindings.length !== 1) {
    throw conflict(
      `作用域 ${scope.scope_code} 是单组织绑定，当前绑定了 ${bindings.length} 个组织`,
      'PLATFORM_SCOPE_BINDING_INVALID',
    );
  }
  return { scope, organizationIds: bindings };
}

/** 列出 `accounting_scopes` 的自由文本作用域码（只读投影，供操作员建立显式映射）。 */
function listExternalAccountingScopes(db) {
  try {
    return db.prepare('SELECT code, name, status FROM accounting_scopes ORDER BY code').all();
  } catch (_) {
    // accounting_scopes 不存在时（例如尚未跑过核算域迁移）返回空列表，不影响平台能力。
    return [];
  }
}

export async function listOrganizations(db, res, actor, url) {
  allow(actor, 'ORGANIZATIONS_VIEW');
  const status = url.searchParams.get('status');
  const orgType = url.searchParams.get('orgType');
  const filters = [];
  const params = [];
  if (status) {
    filters.push('status=?');
    params.push(requiredCode(status, '组织状态'));
  }
  if (orgType) {
    filters.push('org_type=?');
    params.push(requiredCode(orgType, '组织类型'));
  }
  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM organizations${where} ORDER BY code`).all(...params);
  return send(res, 200, { organizations: rows.map(presentOrganization) });
}

export async function getOrganization(db, res, actor, orgId) {
  allow(actor, 'ORGANIZATIONS_VIEW');
  const row = db.prepare('SELECT * FROM organizations WHERE id=?').get(orgId);
  if (!row) throw notFound('组织不存在', 'PLATFORM_ORGANIZATION_NOT_FOUND');
  const children = db.prepare('SELECT id, code, name FROM organizations WHERE parent_org_id=? ORDER BY code').all(orgId);
  const scopes = db.prepare(
    'SELECT s.scope_code FROM organization_scope_bindings b JOIN organization_scopes s ON s.id=b.scope_id'
    + ' WHERE b.org_id=? ORDER BY s.scope_code',
  ).all(orgId).map((entry) => entry.scope_code);
  return send(res, 200, { organization: presentOrganization(row), children, scopes });
}

export async function createOrganization(db, req, res, actor) {
  allow(actor, 'ORGANIZATIONS_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['code', 'name', 'orgType', 'parentOrgId', 'effectiveFrom', 'effectiveTo']);
  const code = requiredCode(body.code, '组织编码');
  const name = requiredText(body.name, '组织名称', 100);
  const orgType = requiredCode(body.orgType, '组织类型');
  if (!ORG_TYPES.includes(orgType)) throw new HttpError(400, '组织类型无效');
  const parentOrgId = body.parentOrgId ? String(body.parentOrgId).trim() : null;
  const row = createOrganizationRecord(db, {
    code, name, orgType, parentOrgId,
    effectiveFrom: body.effectiveFrom || null, effectiveTo: body.effectiveTo || null, actor,
  });
  return send(res, 201, { organization: presentOrganization(row) });
}

function createOrganizationRecord(db, { code, name, orgType, parentOrgId, effectiveFrom, effectiveTo, actor }) {
  return transaction(db, () => {
    const existing = db.prepare('SELECT id FROM organizations WHERE code=?').get(code);
    if (existing) throw conflict('组织编码已存在', 'PLATFORM_ORGANIZATION_CODE_CONFLICT');
    if (parentOrgId) {
      const parent = db.prepare('SELECT id FROM organizations WHERE id=?').get(parentOrgId);
      if (!parent) throw notFound('上级组织不存在', 'PLATFORM_ORGANIZATION_NOT_FOUND');
    }
    const orgId = id();
    const now = nowIso();
    db.prepare(
      'INSERT INTO organizations(id, code, name, org_type, parent_org_id, status, effective_from, effective_to, created_by, created_at, updated_at)'
      + ' VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    ).run(orgId, code, name, orgType, parentOrgId || null, 'ACTIVE', effectiveFrom, effectiveTo, actor.id, now, now);
    audit(db, actor.id, 'ORGANIZATION_CREATE', 'ORGANIZATION', orgId, `创建组织 ${code}`);
    return db.prepare('SELECT * FROM organizations WHERE id=?').get(orgId);
  });
}

export async function updateOrganization(db, req, res, actor, orgId) {
  allow(actor, 'ORGANIZATIONS_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['name', 'orgType', 'parentOrgId', 'effectiveFrom', 'effectiveTo']);
  const row = transaction(db, () => {
    const current = db.prepare('SELECT * FROM organizations WHERE id=?').get(orgId);
    if (!current) throw notFound('组织不存在', 'PLATFORM_ORGANIZATION_NOT_FOUND');
    const name = body.name === undefined ? current.name : requiredText(body.name, '组织名称', 100);
    const orgType = body.orgType === undefined
      ? current.org_type : requiredCode(body.orgType, '组织类型');
    if (!ORG_TYPES.includes(orgType)) throw new HttpError(400, '组织类型无效');
    const parentOrgId = body.parentOrgId === undefined
      ? current.parent_org_id : (body.parentOrgId ? String(body.parentOrgId).trim() : null);
    if (parentOrgId) {
      const parent = db.prepare('SELECT id FROM organizations WHERE id=?').get(parentOrgId);
      if (!parent) throw notFound('上级组织不存在', 'PLATFORM_ORGANIZATION_NOT_FOUND');
    }
    assertNoCycle(db, orgId, parentOrgId);
    const now = nowIso();
    db.prepare(
      'UPDATE organizations SET name=?, org_type=?, parent_org_id=?, effective_from=?, effective_to=?, updated_at=? WHERE id=?',
    ).run(
      name, orgType, parentOrgId || null,
      body.effectiveFrom === undefined ? current.effective_from : (body.effectiveFrom || null),
      body.effectiveTo === undefined ? current.effective_to : (body.effectiveTo || null),
      now, orgId,
    );
    audit(db, actor.id, 'ORGANIZATION_UPDATE', 'ORGANIZATION', orgId, `更新组织 ${current.code}`);
    return db.prepare('SELECT * FROM organizations WHERE id=?').get(orgId);
  });
  return send(res, 200, { organization: presentOrganization(row) });
}

export async function setOrganizationStatus(db, req, res, actor, orgId) {
  allow(actor, 'ORGANIZATIONS_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['status', 'reason']);
  const status = requiredCode(body.status, '组织状态');
  if (!ORG_STATUSES.includes(status)) throw new HttpError(400, '组织状态无效');
  const row = transaction(db, () => {
    const current = db.prepare('SELECT * FROM organizations WHERE id=?').get(orgId);
    if (!current) throw notFound('组织不存在', 'PLATFORM_ORGANIZATION_NOT_FOUND');
    if (status === 'INACTIVE') {
      // 停用前必须没有启用中的子组织 —— 否则层级上会出现"父已停用、子仍启用"的悬挂结构。
      const activeChildren = db.prepare(
        "SELECT COUNT(*) n FROM organizations WHERE parent_org_id=? AND status='ACTIVE'",
      ).get(orgId).n;
      if (activeChildren) {
        throw conflict('该组织下仍有启用中的子组织，无法停用', 'PLATFORM_ORGANIZATION_HAS_ACTIVE_CHILDREN');
      }
    }
    db.prepare('UPDATE organizations SET status=?, updated_at=? WHERE id=?').run(status, nowIso(), orgId);
    audit(db, actor.id, 'ORGANIZATION_DISABLE', 'ORGANIZATION', orgId,
      `组织 ${current.code} 状态置为 ${status}${body.reason ? `：${optionalText(body.reason, 200)}` : ''}`);
    return db.prepare('SELECT * FROM organizations WHERE id=?').get(orgId);
  });
  return send(res, 200, { organization: presentOrganization(row) });
}

export async function listOrganizationScopes(db, res, actor) {
  allow(actor, 'ORGANIZATIONS_VIEW');
  const scopes = db.prepare('SELECT * FROM organization_scopes ORDER BY scope_code').all();
  const payload = scopes.map((scope) => {
    const bindings = db.prepare(
      'SELECT b.org_id FROM organization_scope_bindings b JOIN organizations o ON o.id=b.org_id'
      + ' WHERE b.scope_id=? ORDER BY o.code',
    ).all(scope.id).map((row) => row.org_id);
    return presentScope(scope, bindings);
  });
  return send(res, 200, { scopes: payload, externalAccountingScopes: listExternalAccountingScopes(db) });
}

export async function createOrganizationScope(db, req, res, actor) {
  allow(actor, 'ORGANIZATION_SCOPE_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['scopeCode', 'name', 'bindingMode']);
  const scopeCode = requiredCode(body.scopeCode, '作用域编码');
  const name = requiredText(body.name, '作用域名称', 100);
  const bindingMode = requiredCode(body.bindingMode, '绑定模式');
  if (!BINDING_MODES.includes(bindingMode)) throw new HttpError(400, '绑定模式无效');
  const scope = transaction(db, () => {
    const existing = db.prepare('SELECT id FROM organization_scopes WHERE scope_code=?').get(scopeCode);
    if (existing) throw conflict('作用域编码已存在', 'PLATFORM_SCOPE_CODE_CONFLICT');
    const scopeId = id();
    db.prepare(
      'INSERT INTO organization_scopes(id, scope_code, name, binding_mode, created_at) VALUES(?,?,?,?,?)',
    ).run(scopeId, scopeCode, name, bindingMode, nowIso());
    audit(db, actor.id, 'ORGANIZATION_SCOPE_CREATE', 'ORGANIZATION_SCOPE', scopeId, `创建作用域 ${scopeCode}`);
    return db.prepare('SELECT * FROM organization_scopes WHERE id=?').get(scopeId);
  });
  return send(res, 201, { scope: presentScope(scope, []) });
}

export async function bindOrganizationScope(db, req, res, actor, scopeId) {
  allow(actor, 'ORGANIZATION_SCOPE_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['orgId']);
  const orgId = requiredText(body.orgId, '组织', 200);
  const result = transaction(db, () => {
    const scope = db.prepare('SELECT * FROM organization_scopes WHERE id=?').get(scopeId);
    if (!scope) throw notFound('作用域不存在', 'PLATFORM_SCOPE_NOT_FOUND');
    const org = db.prepare('SELECT * FROM organizations WHERE id=?').get(orgId);
    if (!org) throw notFound('组织不存在', 'PLATFORM_ORGANIZATION_NOT_FOUND');
    if (org.status !== 'ACTIVE') throw conflict('只能绑定启用中的组织', 'PLATFORM_ORGANIZATION_INACTIVE');
    const current = db.prepare(
      'SELECT b.org_id FROM organization_scope_bindings b WHERE b.scope_id=?',
    ).all(scope.id).map((row) => row.org_id);
    if (current.includes(orgId)) {
      return { scope, organizationIds: current, unchanged: true };
    }
    if (scope.binding_mode === 'SINGLE' && current.length >= 1) {
      throw conflict(
        `作用域 ${scope.scope_code} 是单组织绑定，请先解绑现有组织`,
        'PLATFORM_SCOPE_BINDING_INVALID',
      );
    }
    db.prepare(
      'INSERT INTO organization_scope_bindings(id, scope_id, org_id, created_at) VALUES(?,?,?,?)',
    ).run(id(), scope.id, orgId, nowIso());
    const after = db.prepare(
      'SELECT b.org_id FROM organization_scope_bindings b WHERE b.scope_id=?',
    ).all(scope.id).map((row) => row.org_id);
    audit(db, actor.id, 'ORGANIZATION_SCOPE_BIND', 'ORGANIZATION_SCOPE', scope.id,
      `作用域 ${scope.scope_code} 绑定组织 ${org.code}`);
    return { scope, organizationIds: after, unchanged: false };
  });
  return send(res, 200, { scope: presentScope(result.scope, result.organizationIds), unchanged: result.unchanged });
}

export async function unbindOrganizationScope(db, req, res, actor, scopeId) {
  allow(actor, 'ORGANIZATION_SCOPE_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, ['orgId']);
  const orgId = requiredText(body.orgId, '组织', 200);
  const result = transaction(db, () => {
    const scope = db.prepare('SELECT * FROM organization_scopes WHERE id=?').get(scopeId);
    if (!scope) throw notFound('作用域不存在', 'PLATFORM_SCOPE_NOT_FOUND');
    db.prepare('DELETE FROM organization_scope_bindings WHERE scope_id=? AND org_id=?').run(scope.id, orgId);
    const after = db.prepare(
      'SELECT b.org_id FROM organization_scope_bindings b WHERE b.scope_id=?',
    ).all(scope.id).map((row) => row.org_id);
    audit(db, actor.id, 'ORGANIZATION_SCOPE_UNBIND', 'ORGANIZATION_SCOPE', scope.id,
      `作用域 ${scope.scope_code} 解绑组织 ${orgId}`);
    return { scope, organizationIds: after };
  });
  return send(res, 200, { scope: presentScope(result.scope, result.organizationIds) });
}

/**
 * 按作用域解析单个组织（单组织作用域的便捷入口）。
 * 多组织作用域没有唯一答案 —— 调用方必须显式处理歧义。
 */
export function resolveSingleOrganizationForScope(db, scopeCode) {
  const { scope, organizationIds } = resolveOrganizationScope(db, scopeCode);
  if (organizationIds.length !== 1) {
    throw conflict(
      `作用域 ${scope.scope_code} 当前绑定 ${organizationIds.length} 个组织，无法解析为单一组织`,
      'PLATFORM_SCOPE_BINDING_INVALID',
    );
  }
  return organizationIds[0];
}
