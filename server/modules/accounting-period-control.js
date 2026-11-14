import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, readJson, send } from '../lib/http.js';
import { assertProfitTransferred } from './accounting-period-end.js';
import { systemHealth } from './financial-inventory.js';
import { lockPeriodAxes, periodEndDate } from './period-control.js';
import { PERIOD_AXES } from './period-action-registry.js';

const CLOSE_AXES = Object.freeze([
  PERIOD_AXES.INVENTORY,
  PERIOD_AXES.FINANCE_AR,
  PERIOD_AXES.FINANCE_AP,
  PERIOD_AXES.FINANCE_TREASURY,
  PERIOD_AXES.LEGAL_ACCOUNTING,
]);

function checklist(db, period) {
  const specs = [
    ['ENTERED', '录入中凭证', '请先提交或删除'],
    ['SUBMITTED', '待审核凭证', '请先审核或驳回'],
    ['REJECTED', '已驳回凭证', '请修改后重新提交或删除'],
  ];
  const items = specs.map(([status, item, resolution]) => {
    const count = Number(db.prepare('SELECT COUNT(*) cnt FROM accounting_vouchers WHERE voucher_date LIKE ? AND status=?')
      .get(`${period}%`, status).cnt);
    return { item, passed: count === 0, detail: count === 0 ? `无${item}` : `有 ${count} 张${item}，${resolution}` };
  });
  return { passed: items.every((item) => item.passed), items };
}

function assertCloseSequence(db, closure) {
  const earlierOpen = db.prepare("SELECT period FROM period_closures WHERE period<? AND status<>'CLOSED' ORDER BY period LIMIT 1")
    .get(closure.period);
  if (earlierOpen) {
    throw new HttpError(409, `必须先关闭更早期间 ${earlierOpen.period}`, { code: 'PERIOD_SEQUENCE_INVALID' });
  }
}

function assertLatestClosed(db, closure) {
  const later = db.prepare("SELECT period FROM period_closures WHERE period>? AND status='CLOSED' ORDER BY period DESC LIMIT 1")
    .get(closure.period);
  if (later) throw new HttpError(409, `必须先反结账最新期间 ${later.period}`, { code: 'PERIOD_NOT_LATEST' });
}

function assertCloseDependencies(db, period) {
  // Design §31.16.2 — the legal period may only close when the inventory axis
  // is closed for that period (the inventory axis closes continuously, so a
  // closed inventory period means the axis is closed through the accounting
  // period end) and all three Finance axes are closed through that boundary.
  const inventory = db.prepare("SELECT 1 FROM inventory_period_closures WHERE period_key=? AND status='CLOSED'").get(period);
  if (!inventory) {
    throw new HttpError(409, '必须先完成对应存货期间结账', {
      code: 'PERIOD_DEPENDENCY_NOT_CLOSED', axis: PERIOD_AXES.INVENTORY, period, requiredThrough: period,
    });
  }
  const endDate = periodEndDate(period);
  for (const closeType of ['AR', 'AP', 'TREASURY']) {
    const row = db.prepare('SELECT closed_through_date FROM finance_business_close_state WHERE close_type=?').get(closeType);
    if (!row || !row.closed_through_date || row.closed_through_date < endDate) {
      throw new HttpError(409, `${closeType} 必须先结账至 ${endDate}`, {
        code: 'PERIOD_DEPENDENCY_NOT_CLOSED', axis: `FINANCE_${closeType}`, period, requiredThrough: endDate,
      });
    }
  }
}

export function listPeriodClosures(db, res, actor, url) {
  allowAny(actor, ['PERIOD_CLOSE_VIEW', 'PERIOD_CLOSE_MANAGE']);
  const year = url.searchParams.get('year') || new Date().getFullYear();
  const closures = db.prepare('SELECT pc.*, u.display_name closed_by_name FROM period_closures pc LEFT JOIN users u ON u.id=pc.closed_by WHERE pc.period_year=? ORDER BY pc.period_month DESC')
    .all(parseInt(year));
  return send(res, 200, { closures });
}

export async function createPeriodClosure(db, req, res, actor) {
  allow(actor, 'PERIOD_CLOSE_MANAGE');
  const body = await readJson(req);
  const year = Number(body.year);
  const month = Number(body.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new HttpError(400, '期间年月无效', { code: 'PERIOD_SCOPE_REQUIRED' });
  }
  const period = `${year}-${String(month).padStart(2, '0')}`;
  if (db.prepare('SELECT id FROM period_closures WHERE period=?').get(period)) throw new HttpError(409, '期间已存在');
  const closureId = id();
  db.prepare('INSERT INTO period_closures(id,period,period_year,period_month,closure_type,created_at) VALUES(?,?,?,?,?,?)')
    .run(closureId, period, year, month, body.closure_type || 'MONTH', new Date().toISOString());
  return send(res, 201, { id: closureId, period });
}

export function getClosureChecklist(db, res, actor, url) {
  allow(actor, 'PERIOD_CLOSE_MANAGE');
  const period = url.searchParams.get('period');
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) throw new HttpError(400, '请指定期间，格式: YYYY-MM');
  const closure = db.prepare('SELECT * FROM period_closures WHERE period=?').get(period);
  if (!closure) return send(res, 200, { checklist: [], passed: false, detail: '期间未初始化，请先创建期间记录' });
  if (closure.status === 'CLOSED') return send(res, 200, { checklist: [], passed: false, detail: '期间已结账' });
  const result = checklist(db, period);
  return send(res, 200, { checklist: result.items, passed: result.passed });
}

export async function closePeriod(db, req, res, actor, closureId) {
  allow(actor, 'PERIOD_CLOSE_MANAGE');
  const now = new Date().toISOString();
  transaction(db, () => {
    lockPeriodAxes(db, CLOSE_AXES);
    const closure = db.prepare('SELECT * FROM period_closures WHERE id=?').get(closureId);
    if (!closure) throw new HttpError(404, '期间不存在');
    if (closure.status === 'CLOSED') throw new HttpError(409, '期间已结账', { code: 'FINANCIAL_PERIOD_CLOSED' });
    assertCloseSequence(db, closure);
    assertCloseDependencies(db, closure.period);
    const endDate = periodEndDate(closure.period);
    const health = systemHealth(db, { asOfDate: endDate });
    const blocking = health.checks.filter((item) => item.severity === 'BLOCKING' && item.status === 'FAIL');
    if (blocking.length) throw new HttpError(409, `会计结账健康检查失败: ${blocking.map((item) => item.code).join(', ')}`);
    assertProfitTransferred(db, closure.period);
    const result = checklist(db, closure.period);
    if (!result.passed) {
      throw new HttpError(409, `结账前置检查未通过: ${result.items.filter((item) => !item.passed).map((item) => item.detail).join('; ')}`, {
        code: 'PERIOD_DEPENDENCY_NOT_CLOSED',
      });
    }
    db.prepare("UPDATE period_closures SET status='CLOSED',closed_by=?,closed_at=?,checklist_passed=1 WHERE id=?")
      .run(actor.id, now, closureId);
    audit(db, actor.id, 'CLOSE_PERIOD', 'PERIOD_CLOSURE', closureId, `结账期间 ${closure.period}`, {
      businessDate: endDate, before: { status: closure.status }, after: { status: 'CLOSED' },
    });
  });
  return send(res, 200, { ok: true, message: '期间结账成功' });
}

export async function unclosePeriod(db, req, res, actor, closureId) {
  if (actor.roleCode !== 'ADMIN') throw new HttpError(403, '仅系统管理员可执行会计期间重新打开');
  const body = await readJson(req);
  const reason = String(body.reason || '').trim();
  if (!reason) throw new HttpError(400, '重新打开期间必须填写原因', { code: 'PERIOD_REOPEN_REASON_REQUIRED' });
  const now = new Date().toISOString();
  transaction(db, () => {
    lockPeriodAxes(db, [PERIOD_AXES.LEGAL_ACCOUNTING]);
    const closure = db.prepare('SELECT * FROM period_closures WHERE id=?').get(closureId);
    if (!closure) throw new HttpError(404, '期间不存在');
    if (closure.status !== 'CLOSED') throw new HttpError(409, '期间未结账，无需反结账');
    assertLatestClosed(db, closure);
    // Design §31.16.2 — a legal reopen locks the operating books of that
    // period (sorted by book id) before it proves that no operating period
    // depends on it any more.
    const books = db.prepare(`SELECT DISTINCT c.management_book_id FROM operating_period_closures c
      JOIN management_books b ON b.id=c.management_book_id WHERE c.period=? ORDER BY c.management_book_id`).all(closure.period);
    for (const book of books) {
      lockPeriodAxes(db, [PERIOD_AXES.OPERATING], { managementBookId: book.management_book_id });
    }
    const operating = db.prepare("SELECT management_book_id FROM operating_period_closures WHERE period=? AND status='CLOSED' LIMIT 1")
      .get(closure.period);
    if (operating) {
      throw new HttpError(409, '必须先反结账对应经营期间', {
        code: 'PERIOD_DEPENDENCY_NOT_CLOSED', axis: PERIOD_AXES.OPERATING, managementBookId: operating.management_book_id,
      });
    }
    db.prepare('INSERT INTO period_reopen_history(id,period_closure_id,period,previous_closed_by,previous_closed_at,reason,reopened_by,reopened_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id(), closureId, closure.period, closure.closed_by, closure.closed_at, reason, actor.id, now);
    db.prepare("UPDATE period_closures SET status='OPEN',reopen_reason=?,checklist_passed=0 WHERE id=?").run(reason, closureId);
    audit(db, actor.id, 'UNCLOSE_PERIOD', 'PERIOD_CLOSURE', closureId, `反结账期间 ${closure.period}：${reason}`, {
      businessDate: periodEndDate(closure.period), before: { status: 'CLOSED' }, after: { status: 'OPEN' },
    });
  });
  return send(res, 200, { ok: true, message: '反结账成功' });
}
