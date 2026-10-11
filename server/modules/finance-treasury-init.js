// V22 — Finance Operations Wave A.
//
// FO08 — Treasury initialization (bank_accounts opening balance + cash
// opening).
//
// bank_accounts is canonical (Wave D will introduce applyTreasuryMovement
// but Wave A establishes the opening balance path).

import { allow, send, readJson, requiredText } from '../lib/http.js';
import { audit } from '../lib/audit.js';

export function postTreasuryOpening(db, req, res, actor) {
  allow(actor, 'FINANCE_TREASURY_MANAGE');
  return Promise.resolve().then(async () => {
    const body = await readJson(req);
    const accountId = requiredText(body.accountId, 'accountId', 64);
    const openingCents = Number(body.openingBalanceCents ?? 0);
    if (!Number.isSafeInteger(openingCents) || openingCents < 0) {
      throw new Error('openingBalanceCents must be a non-negative integer');
    }
    const now = new Date().toISOString();
    db.prepare(`UPDATE bank_accounts SET balance_cents=?, updated_at=? WHERE id=?`)
      .run(openingCents, now, accountId);
    audit(db, actor.id, 'TREASURY_OPENING', 'BANK_ACCOUNT', accountId, String(openingCents));
    return send(res, 200, { accountId, openingBalanceCents: openingCents });
  });
}
