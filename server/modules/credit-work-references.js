// Credit work references — read-only, actor-scoped business reference projection.
//
// Requirement : document.md §34.17 SC-UX-03（业务对象选择）
// Design      : solution.md §29.54.3（参照 API 合同与授权收敛）、§32.22.4（通用选择器协议）
//
// The endpoint projects the minimum identity a final user needs to pick a
// business object: a business code, a name, a secondary label and whether the
// record is currently usable. It never projects a credit amount, a rating, a
// sub-limit or any other credit fact.
//
// Authorization is resolved before search, count and page. Search, count and
// page all run on the same authorized relation, and the count is taken on
// that relation too, so a total can never describe more rows than the caller
// is allowed to see.

import { HttpError, send } from '../lib/http.js';
import { actorHas } from './sales-scope.js';
import {
  creditScopePredicate,
  currentBusinessDate,
  requireCreditEvaluationAuthority,
  requireCreditManagementAuthority,
  requireCreditSpecialApprovalRequestAuthority,
  resolveCreditReadMode,
  requireCreditReadScope,
} from './credit-scope.js';

const KINDS = new Set(['PROFILE_CONTEXT', 'SALESPERSON', 'SALES_ORDER', 'SALES_DELIVERY', 'CHECK_RESULT', 'EVALUATOR']);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 100;
const MAX_ID_LENGTH = 128;

// The reference items are user visible, so a status, a stage or a decision is
// projected as the Chinese business label and never as the stored enum value.
// The mapping happens here and not in SQL, so no string concatenation has to
// cross the SQLite and MySQL dialect boundary.
const STAGE_LABELS = Object.freeze({
  SO_SUBMIT: '销售订单提交',
  SO_APPROVE: '销售订单审批',
  SALES_DELIVERY_CONFIRM: '销售出货确认',
});
const ORDER_STATUS_LABELS = Object.freeze({
  DRAFT: '草稿',
  SUBMITTED: '待审批',
  APPROVED: '已审批',
  REJECTED: '已驳回',
});
const DELIVERY_STATUS_LABELS = Object.freeze({
  DRAFT: '草稿',
  CONFIRMED: '已确认',
  CANCELLED: '已取消',
});
const DECISION_LABELS = Object.freeze({
  SPECIAL_APPROVAL_REQUIRED: '需要特别审批',
});

function businessLabel(labels, value, fallback) {
  return labels[value] || fallback;
}

// The identity projection of a reference row: a business code, a name, the
// secondary business label and whether the row is currently usable.
function identityItem(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    secondaryText: row.secondary_text,
    active: Number(row.active) === 1,
  };
}

function readInput(url) {
  const kind = String(url.searchParams.get('kind') || '').trim();
  if (!KINDS.has(kind)) throw new HttpError(400, '引用类型无效', { code: 'CREDIT_WORK_REFERENCE_KIND_INVALID' });
  const q = String(url.searchParams.get('q') || '').trim();
  const customerId = String(url.searchParams.get('customerId') || '').trim();
  const selectedId = String(url.searchParams.get('selectedId') || '').trim();
  if (q.length > MAX_QUERY_LENGTH) throw new HttpError(400, '查询文本过长', { code: 'CREDIT_WORK_REFERENCE_INPUT_INVALID' });
  if (customerId.length > MAX_ID_LENGTH || selectedId.length > MAX_ID_LENGTH) {
    throw new HttpError(400, '查询条件无效', { code: 'CREDIT_WORK_REFERENCE_INPUT_INVALID' });
  }
  return {
    kind,
    q,
    customerId,
    selectedId,
    limit: paginationValue(url.searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: paginationValue(url.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function paginationValue(raw, fallback, minimum, maximum) {
  const value = String(raw ?? '').trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new HttpError(400, '分页参数无效', { code: 'CREDIT_WORK_REFERENCE_INPUT_INVALID' });
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(400, '分页参数超出允许范围', { code: 'CREDIT_WORK_REFERENCE_INPUT_INVALID' });
  }
  return parsed;
}

function searchClause(q, expressions) {
  if (!q) return { sql: '', args: [] };
  const value = `%${q.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_')}%`;
  return {
    sql: ` AND (${expressions.map((expression) => `${expression} LIKE ? ESCAPE '!'`).join(' OR ')})`,
    args: expressions.map(() => value),
  };
}

function mayManage(actor) {
  return actor?.roleCode === 'ADMIN' || (actorHas(actor, 'CREDIT_MANAGE') && actorHas(actor, 'SALES_CROSS_GROUP'));
}

function readableScope(db, actor) {
  const mode = resolveCreditReadMode(db, actor);
  requireCreditReadScope(mode.mode);
  return {
    mode,
    predicate: creditScopePredicate(mode.mode, {
      aggregateExpr: "cp.salesperson_scope_key='*'",
      selfExpr: 'cp.salesperson_scope_key=?',
      selfValue: mode.selfSalespersonId,
    }),
  };
}

// The order of a reference page is pinned to a byte-exact collation, so two
// pages of the same authorized relation can neither skip nor repeat a row
// because the engine collation considered two different codes equal.
function byteOrder(db, expression) {
  return db.dialect === 'mysql' ? `${expression} COLLATE utf8mb4_0900_bin` : `${expression} COLLATE BINARY`;
}

function effectiveProfile(db, actor, alias) {
  const { predicate } = readableScope(db, actor);
  const day = currentBusinessDate();
  return {
    sql: `EXISTS (SELECT 1 FROM credit_profile cp
      WHERE cp.${alias}
      AND cp.effective_from<=? AND (cp.effective_to IS NULL OR cp.effective_to>=?)
      AND ${predicate.sql})`,
    args: [day, day, ...predicate.args],
  };
}

function buildRelation(db, actor, input) {
  if (input.kind === 'PROFILE_CONTEXT') {
    if (mayManage(actor)) {
      requireCreditManagementAuthority(actor);
      return {
        identity: 'c.id',
        columns: `c.id,c.code,c.name,'客户' secondary_text,c.active`,
        from: 'FROM customers c',
        where: ['1=1'],
        args: [],
        order: `c.active DESC,${byteOrder(db, 'c.code')},${byteOrder(db, 'c.id')}`,
        search: ['c.code', 'c.name'],
        toItem: identityItem,
      };
    }
    const profile = effectiveProfile(db, actor, 'customer_id=c.id');
    return {
      identity: 'c.id',
      columns: `c.id,c.code,c.name,'客户' secondary_text,c.active`,
      from: 'FROM customers c',
      where: [profile.sql],
      args: profile.args,
      order: `c.active DESC,${byteOrder(db, 'c.code')},${byteOrder(db, 'c.id')}`,
      search: ['c.code', 'c.name'],
      toItem: identityItem,
    };
  }

  if (input.kind === 'SALESPERSON') {
    if (mayManage(actor)) {
      requireCreditManagementAuthority(actor);
      return {
        identity: 'sp.id',
        columns: `sp.id,sp.salesperson_code code,sp.name,'销售员' secondary_text,sp.active`,
        from: 'FROM salesperson_profiles sp',
        where: ['sp.active=1'],
        args: [],
        order: `${byteOrder(db, 'sp.salesperson_code')},${byteOrder(db, 'sp.id')}`,
        search: ['sp.salesperson_code', 'sp.name'],
        toItem: identityItem,
      };
    }
    requireCreditEvaluationAuthority(actor);
    const profile = effectiveProfile(db, actor, 'salesperson_id=sp.id');
    return {
      identity: 'sp.id',
      columns: `sp.id,sp.salesperson_code code,sp.name,'销售员' secondary_text,sp.active`,
      from: 'FROM salesperson_profiles sp',
      where: ['sp.active=1', profile.sql],
      args: profile.args,
      order: `${byteOrder(db, 'sp.salesperson_code')},${byteOrder(db, 'sp.id')}`,
      search: ['sp.salesperson_code', 'sp.name'],
      toItem: identityItem,
    };
  }

  if (input.kind === 'EVALUATOR') {
    requireCreditEvaluationAuthority(actor);
    return {
      identity: 'u.id',
      columns: 'u.id,u.username code,u.display_name name,r.name secondary_text,u.active',
      from: 'FROM users u JOIN roles r ON r.id=u.role_id',
      where: ['1=1'],
      args: [],
      order: `${byteOrder(db, 'u.display_name')},${byteOrder(db, 'u.username')},${byteOrder(db, 'u.id')}`,
      search: ['u.username', 'u.display_name', 'r.name'],
      toItem: identityItem,
    };
  }

  const { predicate } = readableScope(db, actor);
  const day = currentBusinessDate();

  if (input.kind === 'SALES_ORDER') {
    requireCreditEvaluationAuthority(actor);
    const term = input.customerId ? ' AND so.customer_id=?' : '';
    const args = input.customerId ? [input.customerId] : [];
    return {
      identity: 'so.id',
      columns: 'so.id,so.order_no code,c.name,so.status state,CASE WHEN so.status=\'REJECTED\' THEN 0 ELSE 1 END active',
      from: 'FROM sales_orders so JOIN customers c ON c.id=so.customer_id',
      where: [
        `EXISTS (SELECT 1 FROM credit_profile cp WHERE cp.customer_id=so.customer_id
          AND cp.effective_from<=? AND (cp.effective_to IS NULL OR cp.effective_to>=?)
          AND ${predicate.sql})`,
        term,
      ],
      args: [day, day, ...predicate.args, ...args],
      order: `${byteOrder(db, 'so.order_no')} DESC,${byteOrder(db, 'so.id')} DESC`,
      search: ['so.order_no', 'c.code', 'c.name'],
      toItem: (row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        secondaryText: businessLabel(ORDER_STATUS_LABELS, row.state, '未知状态'),
        active: Number(row.active) === 1,
      }),
    };
  }

  if (input.kind === 'SALES_DELIVERY') {
    requireCreditEvaluationAuthority(actor);
    const term = input.customerId ? ' AND sd.customer_id=?' : '';
    const args = input.customerId ? [input.customerId] : [];
    return {
      identity: 'sd.id',
      columns: 'sd.id,sd.delivery_no code,c.name,sd.status state,CASE WHEN sd.status=\'CANCELLED\' THEN 0 ELSE 1 END active',
      from: 'FROM sales_deliveries sd JOIN customers c ON c.id=sd.customer_id',
      where: [
        `EXISTS (SELECT 1 FROM credit_profile cp WHERE cp.customer_id=sd.customer_id
          AND cp.effective_from<=? AND (cp.effective_to IS NULL OR cp.effective_to>=?)
          AND ${predicate.sql})`,
        term,
      ],
      args: [day, day, ...predicate.args, ...args],
      order: `${byteOrder(db, 'sd.delivery_no')} DESC,${byteOrder(db, 'sd.id')} DESC`,
      search: ['sd.delivery_no', 'c.code', 'c.name'],
      toItem: (row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        secondaryText: businessLabel(DELIVERY_STATUS_LABELS, row.state, '未知状态'),
        active: Number(row.active) === 1,
      }),
    };
  }

  requireCreditSpecialApprovalRequestAuthority(actor);
  return {
    identity: 'ccr.id',
    columns: `ccr.id,COALESCE(so.order_no,sd.delivery_no) code,c.name,
      ccr.decision decision,ccr.stage stage,ccr.business_date business_date,1 active`,
    from: `FROM credit_check_results ccr
      JOIN credit_profile cp ON cp.id=ccr.credit_profile_id
      JOIN customers c ON c.id=cp.customer_id
      LEFT JOIN sales_orders so ON so.id=ccr.sales_order_id
      LEFT JOIN sales_deliveries sd ON sd.id=ccr.sales_delivery_id`,
    where: ["ccr.decision='SPECIAL_APPROVAL_REQUIRED'", predicate.sql],
    args: [...predicate.args],
    order: `${byteOrder(db, 'ccr.evaluated_at')} DESC,${byteOrder(db, 'ccr.id')} DESC`,
    search: ['so.order_no', 'sd.delivery_no', 'c.code', 'c.name'],
    toItem: (row) => ({
      id: row.id,
      code: row.code,
      name: businessLabel(DECISION_LABELS, row.decision, '未知结论'),
      secondaryText: `${businessLabel(STAGE_LABELS, row.stage, '未知阶段')} · ${row.business_date}`,
      active: Number(row.active) === 1,
    }),
  };
}

export function listCreditWorkReferences(db, res, actor, url) {
  const input = readInput(url);
  const relation = buildRelation(db, actor, input);
  const where = relation.where.filter(Boolean);
  const whereSql = where.join(' AND ');
  const term = searchClause(input.q, relation.search);

  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM (
      SELECT ${relation.identity} ${relation.from} WHERE ${whereSql}
    ) authorized_refs`).get(...relation.args);
  const total = Number(totalRow?.total || 0);

  const rows = db.prepare(`SELECT ${relation.columns} ${relation.from}
    WHERE ${whereSql}${term.sql} ORDER BY ${relation.order} LIMIT ? OFFSET ?`)
    .all(...relation.args, ...term.args, input.limit, input.offset);

  const items = rows.map(relation.toItem);

  // A selected id is hydrated on the same authorized relation, so a row the
  // caller may not read is absent exactly like a row that does not exist. The
  // hydrated row never changes the total.
  if (input.selectedId) {
    const hydrated = db.prepare(`SELECT ${relation.columns} ${relation.from}
      WHERE ${whereSql} AND ${relation.identity}=? LIMIT 1`)
      .get(...relation.args, input.selectedId);
    if (hydrated && !items.some((item) => item.id === hydrated.id)) {
      items.unshift(relation.toItem(hydrated));
    }
  }

  return send(res, 200, {
    kind: input.kind,
    items,
    total,
    limit: input.limit,
    offset: input.offset,
  });
}

export const __creditWorkReferenceInternals = Object.freeze({
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_QUERY_LENGTH,
  MAX_ID_LENGTH,
  STAGE_LABELS,
  ORDER_STATUS_LABELS,
  DELIVERY_STATUS_LABELS,
  DECISION_LABELS,
  businessLabel,
});
