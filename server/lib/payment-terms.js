// V2 Stage 3 / Wave 3B — shared payment-terms-days helper.
//
// Extracted VERBATIM from server/app.js (previously the app-local
// `paymentTermsDays(value)` declared at app.js:1495) so it can be
// imported by the migrated customer module while remaining a single
// canonical implementation for the still-unmigrated Supplier / Sales
// Order / Purchase Order code in server/app.js.
//
// Caller proof (re-run on master @ b39155ee, NOT a Stage 0 static
// snapshot):
//
//   - server/app.js:1182  supplierInput(...)            → still in app.js
//   - server/app.js:1455  orderInput(...)               → still in app.js
//   - server/app.js:1492  customerInput(...)            → server/modules/customers.js
//   - server/app.js:1762  purchaseOrderInput(...)       → still in app.js
//
// The function body, error condition, error status, and exact Chinese
// error message remain unchanged. No caller is rewritten by this
// extraction; the surrounding Supplier / Order / Purchase Order code
// is untouched.

import { HttpError } from './http.js';

export function paymentTermsDays(value) {
  const n = value === undefined || value === null || value === '' ? 0 : Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 3650) throw new HttpError(400, '付款条款天数必须是 0–3650 的整数');
  return n;
}
