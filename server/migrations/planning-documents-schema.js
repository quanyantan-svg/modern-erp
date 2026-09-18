// M12 — Production Instruction, Purchase Instruction, Purchase Requisition.
//
// Three new planning-document families that bridge the M11 immutable
// MRP snapshot to the existing execution documents (Production Order,
// Purchase Order). None of the new tables mutate completed MRP
// calculations; instead they reference mrp_run_results rows so that
// downstream traceability can be reconstructed:
//
//   MRP MAKE result
//     -> Production Instruction item
//        -> Production Order
//
//   MRP BUY result
//     -> Purchase Instruction item
//        -> Purchase Requisition item (with approval)
//           -> Purchase Order
//
// All tables are append-only by convention; mutation only happens on
// status transitions documented below. Production Instruction and
// Purchase Instruction follow DRAFT / RELEASED / CANCELLED. Purchase
// Requisition follows DRAFT / SUBMITTED / APPROVED / REJECTED and is
// the only family that joins the Approval Center.

import { randomBytes } from 'node:crypto';

const newId = () => `id-${randomBytes(8).toString('hex')}`;

export function migratePlanningDocumentsSchema(db) {
  // ---------- Production Instructions ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_instructions (
      id TEXT PRIMARY KEY,
      instruction_no TEXT NOT NULL UNIQUE,
      mrp_run_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','RELEASED','CANCELLED')),
      planned_date TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      released_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      released_at TEXT,
      FOREIGN KEY (mrp_run_id) REFERENCES mrp_runs(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (released_by) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_production_instructions_run
      ON production_instructions(mrp_run_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_production_instructions_status
      ON production_instructions(status);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS production_instruction_items (
      id TEXT PRIMARY KEY,
      instruction_id TEXT NOT NULL,
      mrp_result_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      need_by_date TEXT,
      bom_id TEXT,
      routing_id TEXT,
      production_order_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (instruction_id) REFERENCES production_instructions(id) ON DELETE CASCADE,
      FOREIGN KEY (mrp_result_id) REFERENCES mrp_run_results(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (bom_id) REFERENCES boms(id),
      FOREIGN KEY (routing_id) REFERENCES product_routings(id),
      FOREIGN KEY (production_order_id) REFERENCES production_orders(id)
    );
  `);

  // One instruction item carries at most one production_order_id.
  // Idempotency guarantee: re-issuing the generate action finds a
  // non-null production_order_id and returns 409.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_production_instruction_items_production_order
      ON production_instruction_items(production_order_id)
      WHERE production_order_id IS NOT NULL;
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_production_instruction_items_instruction
      ON production_instruction_items(instruction_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_production_instruction_items_result
      ON production_instruction_items(mrp_result_id);
  `);

  // ---------- Purchase Requisitions (declared before purchase_instruction_items
  // because purchase_instruction_items.purchase_requisition_id references it) ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_requisitions (
      id TEXT PRIMARY KEY,
      requisition_no TEXT NOT NULL UNIQUE,
      source_instruction_id TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','CANCELLED')),
      required_date TEXT,
      notes TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      reviewer_id TEXT,
      rejection_reason TEXT NOT NULL DEFAULT '',
      purchase_order_id TEXT,
      submitted_at TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_instruction_id) REFERENCES purchase_instructions(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      FOREIGN KEY (reviewer_id) REFERENCES users(id),
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_status
      ON purchase_requisitions(status);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_purchase_requisitions_creator
      ON purchase_requisitions(creator_id);
  `);

  // ---------- Purchase Instructions ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_instructions (
      id TEXT PRIMARY KEY,
      instruction_no TEXT NOT NULL UNIQUE,
      mrp_run_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','RELEASED','CANCELLED')),
      planned_date TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      released_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      released_at TEXT,
      FOREIGN KEY (mrp_run_id) REFERENCES mrp_runs(id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (released_by) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_purchase_instructions_run
      ON purchase_instructions(mrp_run_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_purchase_instructions_status
      ON purchase_instructions(status);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_instruction_items (
      id TEXT PRIMARY KEY,
      instruction_id TEXT NOT NULL,
      mrp_result_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      need_by_date TEXT,
      purchase_requisition_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (instruction_id) REFERENCES purchase_instructions(id) ON DELETE CASCADE,
      FOREIGN KEY (mrp_result_id) REFERENCES mrp_run_results(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (purchase_requisition_id) REFERENCES purchase_requisitions(id)
    );
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_instruction_items_requisition
      ON purchase_instruction_items(purchase_requisition_id)
      WHERE purchase_requisition_id IS NOT NULL;
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_purchase_instruction_items_instruction
      ON purchase_instruction_items(instruction_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_purchase_instruction_items_result
      ON purchase_instruction_items(mrp_result_id);
  `);

  // ---------- Purchase Requisition Items ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_requisition_items (
      id TEXT PRIMARY KEY,
      requisition_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      preferred_supplier_id TEXT,
      unit_price_cents INTEGER NOT NULL DEFAULT 0 CHECK(unit_price_cents >= 0),
      amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(amount_cents >= 0),
      purchase_instruction_item_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (requisition_id) REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (preferred_supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (purchase_instruction_item_id) REFERENCES purchase_instruction_items(id)
    );
  `);

  // One requisition item carries at most one PO via its parent
  // requisition (purchase_requisitions.purchase_order_id). Enforced
  // via UNIQUE index on the header column.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_requisitions_po
      ON purchase_requisitions(purchase_order_id)
      WHERE purchase_order_id IS NOT NULL;
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_purchase_requisition_items_requisition
      ON purchase_requisition_items(requisition_id);
  `);
}

export function makePlanningDocumentId() {
  return newId();
}