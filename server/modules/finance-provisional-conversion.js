// V22 — Finance Operations Wave A.
//
// FO13 — Provisional → Financial Conversion.
//
// Full Wave B/C consumer arrives later. Wave A installs the data-level
// helper that flips conversion_state / converted_open_item_id on the
// provisional row.

import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';

export function convertProvisionalToFinancial(db, { provisionalOpenItemId, finalOpenItemId, side, actor }) {
  const table = side === 'AR' ? 'account_receivables' : 'account_payables';
  const now = new Date().toISOString();
  const prov = db.prepare(`SELECT id, item_kind, conversion_state, amount_cents FROM ${table} WHERE id=?`)
    .get(provisionalOpenItemId);
  if (!prov) throw new HttpError(404, 'provisional item 不存在');
  if (prov.item_kind !== 'PROVISIONAL') throw new HttpError(409, 'open item 不是 PROVISIONAL');
  if (prov.conversion_state !== 'OPEN') throw new HttpError(409, 'provisional item 已转换');

  db.prepare(`UPDATE ${table} SET conversion_state='CONVERTED', converted_open_item_id=?, updated_at=? WHERE id=?`)
    .run(finalOpenItemId, now, provisionalOpenItemId);
  audit(db, actor.id, 'CONVERT_PROVISIONAL', `${table.toUpperCase()}_OPEN_ITEM`, provisionalOpenItemId, finalOpenItemId);
}
