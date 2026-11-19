import { HttpError, send } from './http.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_TEXT = 128;

function integerParam(raw, fallback, min, max) {
  const text = String(raw ?? '').trim();
  if (!text) return fallback;
  if (!/^\d+$/.test(text)) throw new HttpError(400, '分页参数无效');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, '分页参数超出允许范围');
  return value;
}

export function readWorkReferenceInput(url, kinds) {
  const kind = String(url.searchParams.get('kind') || '').trim();
  if (!kinds.has(kind)) throw new HttpError(400, '业务参照类型无效');
  const q = String(url.searchParams.get('q') || '').trim();
  const selectedId = String(url.searchParams.get('selectedId') || '').trim();
  if (q.length > MAX_TEXT || selectedId.length > MAX_TEXT) throw new HttpError(400, '业务参照查询条件过长');
  return {
    kind,
    q,
    selectedId,
    limit: integerParam(url.searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: integerParam(url.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function likeTerm(value) {
  return `%${value.replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_')}%`;
}

export function sendWorkReferencePage(db, res, input, relation) {
  const where = [...(relation.where || ['1=1'])];
  const args = [...(relation.args || [])];
  if (input.q) {
    where.push(`(${relation.search.map((column) => `${column} LIKE ? ESCAPE '!'`).join(' OR ')})`);
    const term = likeTerm(input.q);
    args.push(...relation.search.map(() => term));
  }
  const whereSql = where.join(' AND ');
  const groupSql = relation.groupBy ? ` GROUP BY ${relation.groupBy}` : '';
  const total = relation.groupBy
    ? Number(db.prepare(`SELECT COUNT(*) total FROM (SELECT 1 ${relation.from} WHERE ${whereSql}${groupSql}) work_refs`).get(...args)?.total || 0)
    : Number(db.prepare(`SELECT COUNT(*) total ${relation.from} WHERE ${whereSql}`).get(...args)?.total || 0);
  const rows = db.prepare(`SELECT ${relation.columns} ${relation.from} WHERE ${whereSql}${groupSql} ORDER BY ${relation.order} LIMIT ? OFFSET ?`)
    .all(...args, input.limit, input.offset);
  const items = rows.map(relation.toItem);

  if (input.selectedId && !items.some((item) => item.id === input.selectedId)) {
    const selectedWhere = [...(relation.where || ['1=1']), `${relation.identity}=?`].join(' AND ');
    const row = db.prepare(`SELECT ${relation.columns} ${relation.from} WHERE ${selectedWhere}${groupSql} LIMIT 1`)
      .get(...(relation.args || []), input.selectedId);
    if (row) items.unshift(relation.toItem(row));
  }
  return send(res, 200, { kind: input.kind, items, total, limit: input.limit, offset: input.offset });
}

export function referenceItem(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    secondaryText: row.secondaryText || '',
    active: row.active === undefined || Number(row.active) === 1,
  };
}
