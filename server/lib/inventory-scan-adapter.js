// V21 — Scan Adapter (Wave D).
//
// Frozen by `solution.md §27.36 / §27.37 / §27.41`.
// Scan engine is INV-40 / INV-41 Integration-Backed. Resolve barcode + physical
// validation. Does NOT create business documents.

import { parseBarcode, logResolution } from './inventory-barcode.js';
import { HttpError } from './http.js';
import { computePositionKey } from './inventory-position.js';

export function resolveScan(db, barcode, context = {}) {
  const parsed = parseBarcode(db, barcode);
  logResolution(db, { id: context.actorId || 'system' }, barcode, parsed, context.source || 'SCAN_VALIDATE');
  return parsed;
}

// Physical validation helper for INV-41 inbound/outbound scan validation.
export function validateScanForInventory(db, barcode, position) {
  const parsed = parseBarcode(db, barcode);
  // product_id sanity: parsed.fields.product_code must map to a product
  if (parsed.fields.product_code) {
    const prod = db.prepare(`SELECT id FROM products WHERE code=?`).get(parsed.fields.product_code);
    if (!prod) throw new HttpError(400, `条码 ${barcode} 对应产品不存在`);
    if (prod.id !== position.productId) throw new HttpError(409, `条码产品 ${prod.id} 与目标 ${position.productId} 不一致`);
  }
  return { parsed, ok: true };
}

// Detect duplicate serial scan in idempotency window (5 minutes).
export function isDuplicateSerialScan(db, barcode, source) {
  const window = 5 * 60 * 1000;
  const cutoff = new Date(Date.now() - window).toISOString();
  const recent = db.prepare(`
    SELECT id, resolved_at FROM inventory_barcode_resolution_log
     WHERE barcode=? AND source=? AND resolved_at >= ?
  `).get(barcode, source, cutoff);
  return Boolean(recent);
}