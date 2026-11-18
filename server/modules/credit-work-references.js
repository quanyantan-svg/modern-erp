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

function input(url) {
  const kind = String(url.searchParams.get('kind') || '').trim();
  const q = String(url.searchParams.get('q') || '').trim();
  const customerId = String(url.searchParams.get('customerId') || '').trim();
  if (!KINDS.has(kind)) throw new HttpError(400, '引用类型无效', { code: 'CREDIT_WORK_REFERENCE_KIND_INVALID' });
  if (q.length > 100 || customerId.length > 128) throw new HttpError(400, '查询条件无效', { code: 'CREDIT_WORK_REFERENCE_INPUT_INVALID' });
  return { kind, q, customerId };
}

function search(q, expressions) {
  if (!q) return { sql: '', args: [] };
  const value = `%${q.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_')}%`;
  return { sql: ` AND (${expressions.map((value) => `${value} LIKE ? ESCAPE '!'`).join(' OR ')})`, args: expressions.map(() => value) };
}

function page(db, sql, args) {
  return db.prepare(`${sql} LIMIT 50`).all(...args).map((row) => ({
    id: row.id,
    code: row.code || row.id,
    name: row.name || row.code || row.id,
    secondaryText: row.secondary_text || '',
    status: row.status || '',
  }));
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

export function listCreditWorkReferences(db, res, actor, url) {
  const value = input(url);
  let rows = [];

  if (value.kind === 'PROFILE_CONTEXT') {
    const term = search(value.q, ['c.code', 'c.name']);
    if (mayManage(actor)) {
      requireCreditManagementAuthority(actor);
      rows = page(db, `SELECT c.id,c.code,c.name,'客户' secondary_text,c.active,
        CASE WHEN c.active=1 THEN '启用' ELSE '停用' END status
        FROM customers c WHERE 1=1${term.sql} ORDER BY c.active DESC,c.code,c.id`, term.args);
    } else {
      const { predicate } = readableScope(db, actor);
      const day = currentBusinessDate();
      rows = page(db, `SELECT DISTINCT c.id,c.code,c.name,'客户' secondary_text,c.active,
        CASE WHEN c.active=1 THEN '启用' ELSE '停用' END status
        FROM customers c JOIN credit_profile cp ON cp.customer_id=c.id
          AND cp.effective_from<=? AND (cp.effective_to IS NULL OR cp.effective_to>=?)
        WHERE ${predicate.sql}${term.sql} ORDER BY c.active DESC,c.code,c.id`,
      [day, day, ...predicate.args, ...term.args]);
    }
  } else if (value.kind === 'SALESPERSON') {
    const term = search(value.q, ['sp.salesperson_code', 'sp.name']);
    if (mayManage(actor)) {
      requireCreditManagementAuthority(actor);
      rows = page(db, `SELECT sp.id,sp.salesperson_code code,sp.name,'销售员' secondary_text,
        CASE WHEN sp.active=1 THEN '启用' ELSE '停用' END status
        FROM salesperson_profiles sp WHERE sp.active=1${term.sql} ORDER BY sp.salesperson_code,sp.id`, term.args);
    } else {
      requireCreditEvaluationAuthority(actor);
      const { predicate } = readableScope(db, actor);
      const day = currentBusinessDate();
      rows = page(db, `SELECT DISTINCT sp.id,sp.salesperson_code code,sp.name,'销售员' secondary_text,
        CASE WHEN sp.active=1 THEN '启用' ELSE '停用' END status
        FROM salesperson_profiles sp JOIN credit_profile cp ON cp.salesperson_id=sp.id
          AND cp.effective_from<=? AND (cp.effective_to IS NULL OR cp.effective_to>=?)
        WHERE sp.active=1 AND ${predicate.sql}${term.sql} ORDER BY sp.salesperson_code,sp.id`,
      [day, day, ...predicate.args, ...term.args]);
    }
  } else if (value.kind === 'EVALUATOR') {
    requireCreditEvaluationAuthority(actor);
    const term = search(value.q, ['u.username', 'u.display_name', 'r.name']);
    rows = page(db, `SELECT u.id,u.username code,u.display_name name,r.name secondary_text,
      CASE WHEN u.active=1 THEN '启用' ELSE '停用' END status
      FROM users u JOIN roles r ON r.id=u.role_id WHERE 1=1${term.sql}
      ORDER BY u.display_name,u.username,u.id`, term.args);
  } else {
    const { predicate } = readableScope(db, actor);
    const day = currentBusinessDate();
    if (value.kind === 'SALES_ORDER') {
      requireCreditEvaluationAuthority(actor);
      const term = search(value.q, ['so.order_no', 'c.code', 'c.name']);
      const customer = value.customerId ? ' AND so.customer_id=?' : '';
      rows = page(db, `SELECT DISTINCT so.id,so.order_no code,c.name,
        '销售订单' secondary_text,so.status
        FROM sales_orders so JOIN customers c ON c.id=so.customer_id
        JOIN credit_profile cp ON cp.customer_id=so.customer_id
          AND cp.effective_from<=? AND (cp.effective_to IS NULL OR cp.effective_to>=?)
        WHERE ${predicate.sql}${customer}${term.sql} ORDER BY so.order_no DESC,so.id`,
      [day, day, ...predicate.args, ...(value.customerId ? [value.customerId] : []), ...term.args]);
    } else if (value.kind === 'SALES_DELIVERY') {
      requireCreditEvaluationAuthority(actor);
      const term = search(value.q, ['sd.delivery_no', 'c.code', 'c.name']);
      const customer = value.customerId ? ' AND sd.customer_id=?' : '';
      rows = page(db, `SELECT DISTINCT sd.id,sd.delivery_no code,c.name,
        '销售出货' secondary_text,sd.status
        FROM sales_deliveries sd JOIN customers c ON c.id=sd.customer_id
        JOIN credit_profile cp ON cp.customer_id=sd.customer_id
          AND cp.effective_from<=? AND (cp.effective_to IS NULL OR cp.effective_to>=?)
        WHERE ${predicate.sql}${customer}${term.sql} ORDER BY sd.delivery_no DESC,sd.id`,
      [day, day, ...predicate.args, ...(value.customerId ? [value.customerId] : []), ...term.args]);
    } else {
      requireCreditSpecialApprovalRequestAuthority(actor);
      const term = search(value.q, ['ccr.id', 'so.order_no', 'c.code', 'c.name']);
      rows = page(db, `SELECT ccr.id,COALESCE(so.order_no,ccr.id) code,c.name,
        ccr.stage secondary_text,ccr.decision status
        FROM credit_check_results ccr JOIN credit_profile cp ON cp.id=ccr.credit_profile_id
        JOIN customers c ON c.id=cp.customer_id LEFT JOIN sales_orders so ON so.id=ccr.sales_order_id
        WHERE ccr.decision='SPECIAL_APPROVAL_REQUIRED' AND ${predicate.sql}${term.sql}
        ORDER BY ccr.evaluated_at DESC,ccr.id`, [...predicate.args, ...term.args]);
    }
  }
  send(res, 200, { kind: value.kind, options: rows });
}
