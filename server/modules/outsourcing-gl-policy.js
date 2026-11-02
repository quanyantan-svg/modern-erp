// M1C-WP0-R1 — source-level Business Policy Guard for outsourcing-sourced
// supplier bills.
//
// Contract source: MC-REQ-15 (docs/requirements/procurement-outsourcing.md
// §31.13) and the M1-Core Active Design §9.4.
//
// The judgement is source-based, never route-based and never operator-based:
// a supplier bill is an outsourcing processing-fee bill when ANY of its lines
// carries commercial_source_type = 'OUTSOURCING_RECEIPT_ITEM'. The bill header
// column supplier_bills.commercial_source_type is NOT written by the
// outsourcing writer (its value stays NULL), so reading only that column would
// miss the case.
//
// The guard must run before any state mutation, so that a rejection leaves the
// bill, the AP subledger, the vouchers and the outsourcing cost evidence
// byte-identical. It is therefore called OUTSIDE the surrounding transaction:
// the rejection audit row is committed on its own and survives the throw.
//
// The same guard serves the outsourcing specific entry point and the shared
// supplier-bill entry points, so an admin who inherits every permission is
// rejected exactly like a finance user.

import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';

export const OUTSOURCING_GL_POLICY_CODE = 'OUTSOURCING_GL_POLICY_NOT_APPROVED';

const OUTSOURCING_SOURCE_TYPE = 'OUTSOURCING_RECEIPT_ITEM';

export function isOutsourcingSourcedSupplierBill(db, billId) {
  return Boolean(db.prepare(
    'SELECT 1 FROM supplier_bill_items WHERE bill_id=? AND commercial_source_type=? LIMIT 1',
  ).get(billId, OUTSOURCING_SOURCE_TYPE));
}

// `action` names the entry point that attempted the write so the rejection
// audit stays attributable; `actorId` may be null for internal service calls
// that carry no operator.
export function assertSupplierBillGlPostable(db, billId, actorId, action) {
  if (!isOutsourcingSourcedSupplierBill(db, billId)) return;
  audit(
    db,
    actorId ?? null,
    'REJECT',
    'SUPPLIER_BILL',
    billId,
    `${action} 拒绝：委外加工费账单来源级业务策略未获批 ${OUTSOURCING_GL_POLICY_CODE}`,
  );
  throw new HttpError(409, '委外加工费账单的正式过账与匹配尚未获批', {
    code: OUTSOURCING_GL_POLICY_CODE,
  });
}
