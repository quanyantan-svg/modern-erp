// W11-A U3-A — CREDIT_VIEW-only query-context options.
//
// This module is deliberately separate from the frozen SC101/SC102 reader.
// It projects only the customer and Credit Object identity needed to start a
// query. Authorization is resolved before search, grouping, count and page;
// the requested business date is only an effective-data filter.

import {
  HttpError,
  normalizeBusinessDate,
  requiredCode,
  requiredText,
  send,
} from '../lib/http.js';
import { buildSearchPatterns } from '../lib/search-fold.js';
import { currentBusinessDate, resolveCreditProfileReadScope } from './credit-scope.js';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 100;

function paginationValue(value, { fallback, minimum, maximum, label }) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new HttpError(400, `${label}无效`, { code: 'CREDIT_QUERY_OPTIONS_INVALID_PAGINATION' });
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(400, `${label}超出允许范围`, { code: 'CREDIT_QUERY_OPTIONS_INVALID_PAGINATION' });
  }
  return parsed;
}

function readInput(url) {
  const rawBusinessDate = String(url.searchParams.get('businessDate') || '').trim();
  const businessDate = rawBusinessDate
    ? normalizeBusinessDate(rawBusinessDate)
    : currentBusinessDate();
  const q = String(url.searchParams.get('q') || '').trim();
  if (q.length > MAX_QUERY_LENGTH) {
    throw new HttpError(400, '查询文本过长', { code: 'CREDIT_QUERY_OPTIONS_INVALID_INPUT' });
  }

  const rawIdentity = {
    customerId: String(url.searchParams.get('customerId') || '').trim(),
    creditObjectType: String(url.searchParams.get('creditObjectType') || '').trim(),
    creditObjectId: String(url.searchParams.get('creditObjectId') || '').trim(),
  };
  const identityParts = Object.values(rawIdentity).filter(Boolean).length;
  if (identityParts !== 0 && identityParts !== 3) {
    throw new HttpError(400, '精确信用查询身份必须同时包含客户、对象类型和对象', {
      code: 'CREDIT_QUERY_OPTIONS_INVALID_INPUT',
    });
  }
  const identity = identityParts === 3 ? {
    customerId: requiredText(rawIdentity.customerId, '客户', 128),
    creditObjectType: requiredCode(rawIdentity.creditObjectType, '信用对象类型'),
    creditObjectId: requiredText(rawIdentity.creditObjectId, '信用对象', 128),
  } : null;

  return {
    businessDate,
    q,
    identity,
    limit: paginationValue(url.searchParams.get('limit'), {
      fallback: DEFAULT_LIMIT, minimum: 1, maximum: MAX_LIMIT, label: '分页大小',
    }),
    offset: paginationValue(url.searchParams.get('offset'), {
      fallback: 0, minimum: 0, maximum: Number.MAX_SAFE_INTEGER, label: '分页偏移',
    }),
  };
}

function buildAuthorizedRelation(readScope, input) {
  const where = [
    'cp.effective_from<=?',
    '(cp.effective_to IS NULL OR cp.effective_to>=?)',
  ];
  const args = [input.businessDate, input.businessDate];

  if (readScope.predicateSql) {
    where.push(readScope.predicateSql);
    args.push(...readScope.predicateArgs);
  }
  if (input.identity) {
    where.push('cp.customer_id=?', 'cp.credit_object_type=?', 'cp.credit_object_id=?');
    args.push(input.identity.customerId, input.identity.creditObjectType, input.identity.creditObjectId);
  }
  if (input.q) {
    // W11-A U3 — the search matches the derived, folded and byte-exact search
    // keys. The pattern is folded first, escaped second and positioned third,
    // and the statement names its escape character, so `%`, `_` and `\` are
    // ordinary characters and the result cannot depend on the engine collation
    // or on the SQL mode.
    const { prefix, contains } = buildSearchPatterns(input.q);
    where.push(`(c.code_search_key LIKE ? ESCAPE '!'
      OR c.name_search_key LIKE ? ESCAPE '!'
      OR cp.credit_object_type_search_key LIKE ? ESCAPE '!'
      OR cp.credit_object_id_search_key LIKE ? ESCAPE '!')`);
    args.push(prefix, contains, prefix, contains);
  }

  return {
    sql: `FROM credit_profile cp
      JOIN customers c ON c.id=cp.customer_id
      WHERE ${where.join(' AND ')}`,
    args,
  };
}

function assertNoEffectiveAmbiguity(db, relation) {
  const row = db.prepare(`SELECT cp.customer_id,cp.credit_object_type,cp.credit_object_id,
      cp.salesperson_scope_key,COUNT(*) AS duplicate_count
    ${relation.sql}
    GROUP BY cp.customer_id,cp.credit_object_type,cp.credit_object_id,cp.salesperson_scope_key
    HAVING COUNT(*)>1
    ORDER BY cp.customer_id,cp.credit_object_type,cp.credit_object_id,cp.salesperson_scope_key
    LIMIT 1`).get(...relation.args);
  if (row) {
    throw new HttpError(409, '信用档案生效版本不唯一', {
      code: 'CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS',
    });
  }
}

// The logical group of the projection. The derived search key columns join
// the group key because the live MySQL runs with ONLY_FULL_GROUP_BY, which
// rejects an order expression that is not grouped. Each added column is a
// deterministic function of a column that is already grouped, so the grouping
// partition and its result are exactly the same as before.
const LOGICAL_GROUP = `cp.customer_id,c.code,c.code_search_key,c.name,c.name_search_key,c.active,
  cp.credit_object_type,cp.credit_object_type_search_key,cp.credit_object_id,cp.credit_object_id_search_key`;

// The deterministic order of the projection. Every comparison is pinned to a
// byte-exact collation, so the order never depends on a column default, on a
// connection default or on an engine default.
//
// The business identities come first: the folded customer code, the original
// customer code bytes, the stable customer identity bytes, the normalized
// Credit Object type, the normalized Credit Object identity, the original
// Credit Object type bytes and the original Credit Object identity bytes.
function logicalOrder(db) {
  if (db.dialect === 'mysql') {
    return `c.code_search_key COLLATE utf8mb4_0900_bin,c.code COLLATE utf8mb4_0900_bin,
      cp.customer_id COLLATE utf8mb4_0900_bin,
      cp.credit_object_type_search_key COLLATE utf8mb4_0900_bin,
      cp.credit_object_id_search_key COLLATE utf8mb4_0900_bin,
      cp.credit_object_type COLLATE utf8mb4_0900_bin,
      cp.credit_object_id COLLATE utf8mb4_0900_bin`;
  }
  return `c.code_search_key COLLATE BINARY,c.code COLLATE BINARY,
    cp.customer_id COLLATE BINARY,
    cp.credit_object_type_search_key COLLATE BINARY,
    cp.credit_object_id_search_key COLLATE BINARY,
    cp.credit_object_type COLLATE BINARY,
    cp.credit_object_id COLLATE BINARY`;
}

export function listCreditQueryOptions(db, res, actor, url) {
  const input = readInput(url);
  // The canonical resolver decides authorization from the server's current
  // date. businessDate is deliberately not forwarded into that decision.
  const readScope = resolveCreditProfileReadScope(db, actor);
  const relation = buildAuthorizedRelation(readScope, input);
  assertNoEffectiveAmbiguity(db, relation);

  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM (
      SELECT cp.customer_id,cp.credit_object_type,cp.credit_object_id
      ${relation.sql}
      GROUP BY cp.customer_id,cp.credit_object_type,cp.credit_object_id
    ) authorized_options`).get(...relation.args);

  const rows = db.prepare(`SELECT cp.customer_id,c.code AS customer_code,c.name AS customer_name,
      c.active AS customer_active,cp.credit_object_type,cp.credit_object_id,
      MAX(CASE WHEN cp.salesperson_scope_key='*' THEN 1 ELSE 0 END) AS has_aggregate,
      MAX(CASE WHEN cp.salesperson_scope_key<>'*' THEN 1 ELSE 0 END) AS has_sub_limit
    ${relation.sql}
    GROUP BY ${LOGICAL_GROUP}
    ORDER BY ${logicalOrder(db)}
    LIMIT ? OFFSET ?`).all(...relation.args, input.limit, input.offset);

  const options = rows.map((row) => ({
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    customerActive: Boolean(row.customer_active),
    creditObjectType: row.credit_object_type,
    creditObjectId: row.credit_object_id,
    availableScopeTypes: [
      ...(Number(row.has_aggregate) ? ['CUSTOMER_AGGREGATE'] : []),
      ...(Number(row.has_sub_limit) ? ['SALESPERSON_SUB_LIMIT'] : []),
    ],
  }));

  return send(res, 200, {
    options,
    total: Number(totalRow?.total || 0),
    limit: input.limit,
    offset: input.offset,
    businessDate: input.businessDate,
  });
}

export const __creditQueryOptionsInternals = Object.freeze({
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_QUERY_LENGTH,
  readInput,
});
