// V22 — Finance Operations Wave C.
//
// FO31 — Invoice Source Cardinality.
//
// Backed by finance_invoice_source_links (NEW #10).
// One source line can have many invoice lines (partial invoicing over time).
// One invoice can collect many compatible source lines.
// Cumulative invoiced_quantity / invoiced_amount_cents ≤ source remaining.

import { HttpError, allow, send, readJson, requiredText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';

export async function upsertInvoiceSourceLink(db, req, res, actor) {
  allow(actor, 'FINANCE_INVOICE_MANAGE');
  const body = await readJson(req);
  const invoiceId = requiredText(body.invoiceId, 'invoiceId', 64);
  const invoiceSide = requiredText(body.invoiceSide, 'invoiceSide', 32);
  const sourceType = requiredText(body.sourceType, 'sourceType', 32);
  const sourceId = requiredText(body.sourceId, 'sourceId', 64);
  const sourceLineId = requiredText(body.sourceLineId, 'sourceLineId', 64);
  const invoicedQty = Number(body.invoicedQuantity);
  const invoicedAmt = Number(body.invoicedAmountCents);
  if (!Number.isSafeInteger(invoicedQty) || invoicedQty < 0) throw new HttpError(400, 'invoicedQuantity 必须为非负整数');
  if (!Number.isSafeInteger(invoicedAmt) || invoicedAmt < 0) throw new HttpError(400, 'invoicedAmountCents 必须为非负整数');
  const linkId = id();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO finance_invoice_source_links(id, invoice_id, invoice_side, source_type, source_id, source_line_id, invoiced_quantity, invoiced_amount_cents, created_at)
     VALUES(?,?,?,?,?,?, ?, ?, ?)`
  ).run(linkId, invoiceId, invoiceSide, sourceType, sourceId, sourceLineId, invoicedQty, invoicedAmt, now);
  audit(db, actor.id, 'UPSERT_INVOICE_SOURCE_LINK', invoiceId, sourceId);
  return send(res, 200, { linkId });
}
