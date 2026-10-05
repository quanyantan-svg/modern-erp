// V2 Stage 3 / Wave 3B — Customer domain ownership.
//
// Second live production route family migrated using the Wave 1
// route-table dispatch infrastructure (after Wave 3A's warehouses).
// This module is the single canonical implementation owner for
// /api/customers (GET, POST, PATCH, DELETE). Authorization,
// transaction, and audit remain at the handler boundary; the
// route-table only carries dispatch and ownership metadata.
//
// The handler bodies and customerInput behavior are textually /
// semantically identical to the previous server/app.js
// implementation. Only the lifecycle delegation for DELETE was
// extracted into a thin wrapper so the customer route family has
// one coherent owner after migration.
//
// The shared paymentTermsDays helper is imported from
// server/lib/payment-terms.js (extracted in this wave); the same
// canonical implementation continues to serve the still-unmigrated
// Supplier / Sales Order / Purchase Order callers in server/app.js.

import { id } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError,
  allow,
  allowAny,
  optionalText,
  readJson,
  requiredCode,
  requiredText,
  send,
} from '../lib/http.js';
import { paymentTermsDays } from '../lib/payment-terms.js';
import { deleteMasterRecord } from './data-lifecycle.js';

export function listCustomers(db, res, actor, url) {
  allowAny(actor, ['CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE']);
  const search = `%${url.searchParams.get('search')?.trim() ?? ''}%`;
  const customers = db.prepare(`SELECT id,code,name,contact,phone,address,payment_terms_days paymentTermsDays,active,created_at createdAt,updated_at updatedAt
    FROM customers WHERE code LIKE ? OR name LIKE ? OR contact LIKE ? ORDER BY code`).all(search, search, search)
    .map((row) => ({ ...row, active: Boolean(row.active) }));
  return send(res, 200, { customers });
}

export async function createCustomer(db, req, res, actor) {
  allow(actor, 'CUSTOMERS_MANAGE');
  const body = await readJson(req);
  const customer = customerInput(body);
  const customerId = id(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,payment_terms_days,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)`)
    .run(customerId, customer.code, customer.name, customer.contact, customer.phone, customer.address, customer.paymentTermsDays, now, now);
  audit(db, actor.id, 'CREATE', 'CUSTOMER', customerId, customer.code);
  return send(res, 201, { id: customerId });
}

export async function updateCustomer(db, req, res, actor, customerId) {
  allow(actor, 'CUSTOMERS_MANAGE');
  const current = db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
  if (!current) throw new HttpError(404, '客户不存在');
  const body = await readJson(req); const customer = customerInput({ ...current, ...body });
  const active = body.active === undefined ? current.active : Boolean(body.active) ? 1 : 0;
  db.prepare('UPDATE customers SET code=?,name=?,contact=?,phone=?,address=?,payment_terms_days=?,active=?,updated_at=? WHERE id=?')
    .run(customer.code, customer.name, customer.contact, customer.phone, customer.address, customer.paymentTermsDays, active, new Date().toISOString(), customerId);
  audit(db, actor.id, 'UPDATE', 'CUSTOMER', customerId, customer.code);
  return send(res, 200, { ok: true });
}

export function customerInput(body) {
  return { code: requiredCode(body.code, '客户编码'), name: requiredText(body.name, '客户名称', 100),
    contact: optionalText(body.contact, 50), phone: optionalText(body.phone, 30), address: optionalText(body.address, 200),
    paymentTermsDays: paymentTermsDays(body.paymentTermsDays ?? body.payment_terms_days) };
}

// Thin delegation wrapper. The lifecycle implementation in
// server/modules/data-lifecycle.js owns all canonical delete
// semantics (permission, reference checks, transaction, audit,
// response); this function only re-routes the customer route
// family to that single source of truth. No permission check,
// no validation, no transaction, no audit, and no response
// transformation is added here.
export function deleteCustomer(db, res, actor, customerId) {
  return deleteMasterRecord(db, res, actor, 'customer', customerId);
}
