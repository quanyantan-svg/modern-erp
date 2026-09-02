// src/lib/money.js
//
// Pure yuan/cents boundary helpers for the manual voucher UI.
//
// Backend canonical storage is integer cents (see accounting_entries.amount_cents
// and createAccountingVoucher / updateAccountingVoucher in server/app.js).
// The UI presents amounts in yuan decimal. These helpers live at that boundary.
//
// Conversion rules:
//   - "1"       -> 100
//   - "1.5"     -> 150
//   - "1.50"    -> 150
//   - "10000"   -> 1000000
//   - "10000.01"-> 1000001
//   - "0.01"    -> 1
//
// Anything with more than 2 decimal places, or non-positive, or malformed,
// returns null. Integer arithmetic (no Math.round on floats) guarantees no
// drift like 10000.01 -> 1000000.9999999.

const YUAN_TO_CENTS_RE = /^\d+(\.\d+)?$/;

function parseYuanToCents(yuan, allowZero) {
  if (yuan === '' || yuan === null || yuan === undefined) return null;
  const s = String(yuan).trim();
  if (!s) return null;
  if (!YUAN_TO_CENTS_RE.test(s)) return null;
  // Accounting entries are always positive amounts (DEBIT/CREDIT direction is
  // a separate field). The regex above already rejects '-' / '+' prefixes, so
  // any negative or signed input returns null.
  const dot = s.indexOf('.');
  const whole = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? '' : s.slice(dot + 1);
  if (frac.length > 2) return null; // >2 decimal places: reject per UX convention
  const wholeCents = Number(whole) * 100;
  const fracPadded = (frac + '00').slice(0, 2);
  const fracCents = Number(fracPadded);
  if (!Number.isFinite(wholeCents) || !Number.isFinite(fracCents)) return null;
  const cents = wholeCents + fracCents;
  if (!Number.isSafeInteger(cents) || cents < 0 || (!allowZero && cents === 0)) return null;
  return cents;
}

export function yuanToCents(yuan) {
  return parseYuanToCents(yuan, false);
}

// Cost components may legitimately be zero, while still requiring the same
// exact decimal-to-integer conversion used by accounting entries.
export function yuanToNonNegativeCents(yuan) {
  return parseYuanToCents(yuan, true);
}

// Convert integer cents to a fixed-2-decimal yuan string for display in
// <input value=...> on edit-mode init. Use only for displaying cents back
// to a yuan input; never for arithmetic.
//
//   1000000 -> "10000.00"
//   1000001 -> "10000.01"
//   1       -> "0.01"
//   0       -> "0.00"
//   null    -> ""
export function centsToYuanInput(cents) {
  if (cents === null || cents === undefined || cents === '') return '';
  const n = Number(cents);
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(n));
  const whole = Math.trunc(abs / 100);
  const frac = abs - whole * 100;
  return `${sign}${whole}.${String(frac).padStart(2, '0')}`;
}
