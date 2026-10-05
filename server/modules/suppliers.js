// V2 Stage 3 / Wave 3C — Supplier domain ownership.
//
// Third live production route family migrated using the Wave 1
// route-table dispatch infrastructure (after Wave 3A's warehouses and
// Wave 3B's customers). This module is the single canonical
// implementation owner for /api/suppliers (GET, POST, PATCH, DELETE).
// Authorization, transaction, and audit remain at the handler
// boundary; the route-table only carries dispatch and ownership
// metadata.
//
// The handler bodies and supplierInput behavior are textually /
// semantically identical to the previous server/app.js implementation.
// Only the lifecycle delegation for DELETE was extracted into a thin
// wrapper so the supplier route family has one coherent owner after
// migration.
//
// The shared paymentTermsDays helper continues to be imported from
// server/lib/payment-terms.js (extracted in Wave 3B); the same
// canonical implementation continues to serve the still-unmigrated
// Sales Order / Purchase Order callers in server/app.js.

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

export function listSuppliers(db, res, actor, url) {
  allowAny(actor, ['SUPPLIERS_VIEW', 'SUPPLIERS_MANAGE']);
  const search = `%${url.searchParams.get('search')?.trim() ?? ''}%`;
  const suppliers = db.prepare(`SELECT id,code,name,contact,phone,address,payment_terms_days paymentTermsDays,active,created_at createdAt,updated_at updatedAt
    FROM suppliers WHERE code LIKE ? OR name LIKE ? OR contact LIKE ? ORDER BY code`).all(search, search, search)
    .map((row) => ({ ...row, active: Boolean(row.active) }));
  return send(res, 200, { suppliers });
}

export async function createSupplier(db, req, res, actor) {
  allow(actor, 'SUPPLIERS_MANAGE');
  const body = await readJson(req);
  const supplier = supplierInput(body);
  const supplierId = id(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,email,payment_terms_days,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)`)
    .run(supplierId, supplier.code, supplier.name, supplier.contact, supplier.phone, supplier.address, supplier.email, supplier.paymentTermsDays, now, now);
  audit(db, actor.id, 'CREATE', 'SUPPLIER', supplierId, supplier.code);
  return send(res, 201, { id: supplierId });
}

export async function updateSupplier(db, req, res, actor, supplierId) {
  allow(actor, 'SUPPLIERS_MANAGE');
  const current = db.prepare('SELECT * FROM suppliers WHERE id=?').get(supplierId);
  if (!current) throw new HttpError(404, '供应商不存在');
  const body = await readJson(req); const supplier = supplierInput({ ...current, ...body });
  const active = body.active === undefined ? current.active : Boolean(body.active) ? 1 : 0;
  db.prepare('UPDATE suppliers SET code=?,name=?,contact=?,phone=?,address=?,email=?,payment_terms_days=?,active=?,updated_at=? WHERE id=?')
    .run(supplier.code, supplier.name, supplier.contact, supplier.phone, supplier.address, supplier.email, supplier.paymentTermsDays, active, new Date().toISOString(), supplierId);
  audit(db, actor.id, 'UPDATE', 'SUPPLIER', supplierId, supplier.code);
  return send(res, 200, { ok: true });
}

export function supplierInput(body) {
  return {
    code: requiredCode(body.code, '供应商编码'),
    name: requiredText(body.name, '供应商名称', 100),
    contact: optionalText(body.contact, 50),
    phone: optionalText(body.phone, 30),
    address: optionalText(body.address, 200),
    email: optionalText(body.email, 100),
    paymentTermsDays: paymentTermsDays(body.paymentTermsDays ?? body.payment_terms_days),
  };
}

// Thin delegation wrapper. The lifecycle implementation in
// server/modules/data-lifecycle.js owns all canonical delete
// semantics (permission, reference checks, transaction, audit,
// response); this function only re-routes the supplier route family
// to that single source of truth. No permission check, no
// validation, no transaction, no audit, and no response
// transformation is added here.
export function deleteSupplier(db, res, actor, supplierId) {
  return deleteMasterRecord(db, res, actor, 'supplier', supplierId);
}
