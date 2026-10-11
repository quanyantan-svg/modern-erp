// V22 — Finance Operations Wave A.
//
// FO08 — Treasury initialization (bank_accounts opening balance + cash
// opening).
//
// bank_accounts is canonical (Wave D will introduce applyTreasuryMovement
// but Wave A establishes the opening balance path).

import { allow, HttpError, send, readJson, requiredText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { transaction } from '../db.js';
import { assertFinanceBusinessDateOpen } from './finance-business-close.js';
import { refreshSettlementAccountBalance } from './finance-treasury-movement.js';

export function postTreasuryOpening(db, req, res, actor) {
  allow(actor, 'FINANCE_TREASURY_MANAGE');
  return Promise.resolve().then(async () => {
    const body = await readJson(req);
    const accountId = requiredText(body.accountId, 'accountId', 64);
    const openingCents = Number(body.openingBalanceCents ?? 0);
    if (!Number.isSafeInteger(openingCents) || openingCents < 0) {
      throw new HttpError(400, 'openingBalanceCents must be a non-negative integer');
    }
    const businessDate = requiredText(body.businessDate, 'businessDate', 16);
    const now = new Date().toISOString();
    transaction(db, () => {
      assertFinanceBusinessDateOpen(db, 'TREASURY', businessDate);
      const account = db.prepare(`SELECT id FROM bank_accounts WHERE id=? AND active=1`).get(accountId);
      if (!account) throw new HttpError(409, 'settlement account not found or inactive');
      db.prepare(`UPDATE bank_accounts SET opening_balance_cents=?, updated_at=? WHERE id=?`)
        .run(openingCents, now, accountId);
      refreshSettlementAccountBalance(db, accountId);
      audit(db, actor.id, 'TREASURY_OPENING', 'BANK_ACCOUNT', accountId, String(openingCents));
    });
    return send(res, 200, { accountId, openingBalanceCents: openingCents });
  });
}
