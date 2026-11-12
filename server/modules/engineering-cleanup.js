// V17 Master & Engineering Domain Closure — Use-Up-Old cleanup candidates
// (2026-11-12 remediation round).
//
// Requirement §28.4 "Use-Up-Old | PARTIAL — CROSS_DOMAIN_DEPENDENCY | 当前库存可
// 引用；预计入供应类型依赖未来 Domain":
//
//   - IN SCOPE here: the **current inventory** reference — which components of
//     a superseded BOM version still hold stock.
//   - OUT OF SCOPE: the "expected incoming supply" leg. It depends on the
//     Planning domain's planned supply and the Procurement domain's open
//     purchase orders; the Requirement explicitly defers it to those domains.
//
// The engineering domain therefore READS the current inventory projection and
// never writes it: inventory mutation stays with the Inventory domain.

import { allow, send } from '../lib/http.js';

export function listEngineeringCleanupCandidates(db, res, actor, url) {
  allow(actor, 'ENGINEERING_BOM_VIEW');
  const productId = String(url?.searchParams?.get('productId') || url?.searchParams?.get('product_id') || '').trim();
  const params = [];
  let where = '';
  if (productId) {
    where = ' AND b.product_id = ?';
    params.push(productId);
  }
  // A candidate is a stocked component that is no longer part of the product's
  // current ACTIVE BOM. Both facts come from canonical tables: the BOM master
  // (`boms` / `bom_items`) and the inventory projection (`inventory`).
  const rows = db.prepare(`
    SELECT p.id product_id, p.code product_code, p.name product_name,
      c.id component_id, c.code component_code, c.name component_name,
      i.quantity on_hand_quantity,
      bi.bom_id superseded_bom_id, b.version superseded_bom_version, b.status superseded_bom_status
    FROM inventory i
    JOIN bom_items bi ON bi.product_id = i.product_id
    JOIN boms b ON b.id = bi.bom_id
    JOIN products p ON p.id = b.product_id
    JOIN products c ON c.id = i.product_id
    WHERE i.quantity > 0
      AND NOT EXISTS (
        SELECT 1 FROM bom_items cbi
        JOIN boms cb ON cb.id = cbi.bom_id
        WHERE cbi.product_id = i.product_id
          AND cb.product_id = b.product_id
          AND cb.status = 'ACTIVE'
      )${where}
    ORDER BY p.code, c.code, b.version
  `).all(...params);
  const candidates = rows.map((row) => ({
    ...row,
    on_hand_quantity: Number(row.on_hand_quantity || 0),
    // The expected-incoming leg is deliberately absent: it is a
    // CROSS_DOMAIN_DEPENDENCY owned by Planning / Procurement.
    expectedIncoming: null,
    expectedIncomingSource: 'CROSS_DOMAIN_DEPENDENCY',
  }));
  return send(res, 200, { candidates });
}
