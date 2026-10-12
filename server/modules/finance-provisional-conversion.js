import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';

export function convertProvisionalToFinancial(db, { provisionalOpenItemId, finalOpenItemId, side, actor }) {
  if (!['AR', 'AP'].includes(side)) throw new HttpError(400, 'side 必须为 AR/AP');
  const table = side === 'AR' ? 'account_receivables' : 'account_payables';
  const now = new Date().toISOString();
  const lock = db.dialect === 'mysql' && db.isTransaction ? ' FOR UPDATE' : '';
  const provisional = db.prepare(`SELECT id,item_kind,conversion_state,converted_open_item_id FROM ${table} WHERE id=?${lock}`).get(provisionalOpenItemId);
  if (!provisional) throw new HttpError(404, 'provisional open item 不存在');
  if (provisional.item_kind !== 'PROVISIONAL') throw new HttpError(409, 'open item 不是 PROVISIONAL');
  if (provisional.conversion_state !== 'OPEN') throw new HttpError(409, 'provisional open item 已转换');
  const final = db.prepare(`SELECT id,item_kind FROM ${table} WHERE id=?${lock}`).get(finalOpenItemId);
  if (!final || final.item_kind !== 'FINAL') throw new HttpError(409, 'final open item 不存在或身份非法');

  db.prepare(`UPDATE ${table} SET conversion_state='CONVERTED',converted_open_item_id=?,updated_at=? WHERE id=?`)
    .run(finalOpenItemId, now, provisionalOpenItemId);
  db.prepare(`UPDATE ${table} SET provisional_origin_id=COALESCE(provisional_origin_id,?),updated_at=? WHERE id=?`)
    .run(provisionalOpenItemId, now, finalOpenItemId);
  audit(db, actor.id, 'CONVERT_PROVISIONAL', `${table.toUpperCase()}_OPEN_ITEM`, provisionalOpenItemId, finalOpenItemId);
}
