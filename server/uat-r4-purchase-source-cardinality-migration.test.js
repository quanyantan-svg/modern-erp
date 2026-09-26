// R4 — Migration coverage for `migrateR4PurchaseSourceCardinality`.
//
// Validates the schema migration independently from the API-focused tests:
//   * clean migration succeeds
//   * wrong inverse UNIQUE no longer exists
//   * non-unique back-link lookup index exists
//   * forward UNIQUE constraint exists
//   * multiple PUI rows can share one purchase_requisition_id
//   * same purchase_instruction_item_id cannot appear twice in PR items
//   * duplicate precheck fails closed
//   * migration is idempotent
//   * SQLite path covered directly; MySQL path covered by the same DDL
//     idiom already used elsewhere in the migration set
//     (`server/migrations/v13-phase6b-traceability-quality.js:112`,
//      `server/migrations/planning-documents-schema.js:84-87,179-183,215-218`)
//     and is exercised under the MySQL gate suite, not here.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createDatabase } from './db.js';
import { migrateR4PurchaseSourceCardinality } from './migrations/r4-purchase-source-cardinality.js';

let tmp; let db;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'modern-erp-r4-mig-'));
  db = createDatabase(join(tmp, 'erp.db'));
});

after?.async?.();

describe('R4 source-cardinality migration', () => {
  function seedStubMrpRun(database, runId) {
    database.prepare(`INSERT INTO mrp_runs(id, run_code, run_name, horizon_start, horizon_end, demand_source_mode, status, summary, created_by, created_at, updated_at)
                      VALUES(?, ?, 'R4-mig', ?, ?, 'SALES_ORDERS', 'COMPLETED', '', ?, datetime('now'), datetime('now'))`)
      .run(runId, runId, '2026-09-26', '2026-09-26', 'user-admin');
    database.prepare(`INSERT INTO mrp_run_results(id, run_id, product_id, gross_requirement, net_requirement, suggestion_type, suggested_quantity, need_by_date)
                      VALUES(?, ?, 'r4-mig-prod-A', 5, 5, 'BUY', 5, '2026-09-26')`).run('mrp-stub-res-' + runId, runId);
  }

  function seedStubProducts(database) {
    database.prepare(`INSERT OR IGNORE INTO products(id, code, name, category, unit, price_cents, stock_quantity, active, base_uom_code, created_at, updated_at)
                      VALUES('r4-mig-prod-A', 'R4-MIG-A', 'R4 mig prod A', 'R4', 'EA', 10000, 0, 1, 'EA', datetime('now'), datetime('now'))`).run();
  }

  test('migration is registered and runs cleanly during bootstrap', () => {
    // createDatabase already invoked the migration chain; assert the
    // resulting schema shape.
    const backLinkUnique = db.prepare(`
      SELECT 1 FROM sqlite_master
       WHERE type='index' AND name='idx_purchase_instruction_items_requisition'
    `).get();
    assert.equal(backLinkUnique, undefined, 'wrong-direction unique back-link index must be dropped');
    const lookup = db.prepare(`
      SELECT 1 FROM sqlite_master
       WHERE type='index' AND name='idx_purchase_instruction_items_requisition_lookup'
    `).get();
    assert.ok(lookup, 'non-unique back-link lookup index must exist');
    const forward = db.prepare(`
      SELECT 1 FROM sqlite_master
       WHERE type='index' AND name='idx_purchase_requisition_items_pui'
    `).get();
    assert.ok(forward, 'forward partial unique constraint must exist');
  });

  test('forward UNIQUE is partial: NULL purchase_instruction_item_id values are exempt', () => {
    seedStubProducts(db);
    const now = new Date().toISOString();
    const prId = 'pr-r4-null-' + Date.now().toString(36);
    db.prepare(`INSERT INTO purchase_requisitions(id, requisition_no, source_instruction_id, status, request_date, required_date, notes, creator_id, created_at, updated_at)
                VALUES(?, ?, NULL, 'DRAFT', ?, ?, '', ?, ?, ?)`).run(prId, prId, '2026-09-26', '2026-09-26', 'user-admin', now, now);
    const insert = db.prepare(`INSERT INTO purchase_requisition_items(id, requisition_id, product_id, quantity, unit_price_cents, amount_cents, purchase_instruction_item_id, created_at)
                               VALUES(?, ?, ?, ?, ?, ?, NULL, ?)`);
    insert.run('prii-null-A', prId, 'r4-mig-prod-A', 1, 10000, 10000, now);
    insert.run('prii-null-B', prId, 'r4-mig-prod-A', 1, 10000, 10000, now);
    const rows = db.prepare(`SELECT COUNT(*) cnt FROM purchase_requisition_items WHERE purchase_instruction_item_id IS NULL AND requisition_id=?`).get(prId);
    assert.equal(Number(rows.cnt), 2);
  });

  test('forward UNIQUE prevents duplicate non-null purchase_instruction_item_id', () => {
    seedStubProducts(db);
    const stamp = Date.now().toString(36);
    const runId = 'mrp-r4-mig-dup-' + stamp;
    seedStubMrpRun(db, runId);
    const piiId = 'pii-r4-dup-' + stamp;
    const puiId = 'pui-r4-dup-' + stamp;
    const pr1Id = 'pr-r4-dup-1-' + stamp;
    const pr2Id = 'pr-r4-dup-2-' + stamp;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO purchase_instructions(id, instruction_no, mrp_run_id, status, planned_date, notes, created_by, released_by, created_at, updated_at, released_at)
                VALUES(?, ?, ?, 'RELEASED', ?, '', ?, ?, ?, ?, ?)`)
      .run(puiId, puiId, runId, '2026-09-26', 'user-admin', 'user-admin', now, now, now);
    db.prepare(`INSERT INTO purchase_instruction_items(id, instruction_id, mrp_result_id, product_id, quantity, need_by_date, purchase_requisition_id, created_at)
                VALUES(?, ?, ?, ?, 5, '2026-09-26', NULL, ?)`)
      .run(piiId, puiId, 'mrp-stub-res-' + runId, 'r4-mig-prod-A', now);
    db.prepare(`INSERT INTO purchase_requisitions(id, requisition_no, source_instruction_id, status, request_date, required_date, notes, creator_id, created_at, updated_at)
                VALUES(?, ?, ?, 'DRAFT', ?, ?, '', ?, ?, ?)`).run(pr1Id, pr1Id, puiId, '2026-09-26', '2026-09-26', 'user-admin', now, now);
    db.prepare(`INSERT INTO purchase_requisitions(id, requisition_no, source_instruction_id, status, request_date, required_date, notes, creator_id, created_at, updated_at)
                VALUES(?, ?, ?, 'DRAFT', ?, ?, '', ?, ?, ?)`).run(pr2Id, pr2Id, puiId, '2026-09-26', '2026-09-26', 'user-admin', now, now);
    db.prepare(`INSERT INTO purchase_requisition_items(id, requisition_id, product_id, quantity, unit_price_cents, amount_cents, purchase_instruction_item_id, created_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?)`).run('prii-dup-1', pr1Id, 'r4-mig-prod-A', 5, 10000, 50000, piiId, now);
    let threw = false;
    try {
      db.prepare(`INSERT INTO purchase_requisition_items(id, requisition_id, product_id, quantity, unit_price_cents, amount_cents, purchase_instruction_item_id, created_at)
                  VALUES(?, ?, ?, ?, ?, ?, ?, ?)`).run('prii-dup-2', pr2Id, 'r4-mig-prod-A', 5, 10000, 50000, piiId, now);
    } catch (error) {
      threw = true;
      assert.match(String(error.message), /UNIQUE constraint failed/);
    }
    assert.equal(threw, true, 'duplicate non-null purchase_instruction_item_id must be rejected by the DB-level forward UNIQUE');
  });

  test('multiple PUI rows may share one purchase_requisition_id', () => {
    seedStubProducts(db);
    const stamp = Date.now().toString(36);
    const runId = 'mrp-r4-mig-share-' + stamp;
    seedStubMrpRun(db, runId);
    const puiId = 'pui-r4-share-' + stamp;
    const prId = 'pr-r4-share-' + stamp;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO purchase_instructions(id, instruction_no, mrp_run_id, status, planned_date, notes, created_by, released_by, created_at, updated_at, released_at)
                VALUES(?, ?, ?, 'RELEASED', ?, '', ?, ?, ?, ?, ?)`)
      .run(puiId, puiId, runId, '2026-09-26', 'user-admin', 'user-admin', now, now, now);
    db.prepare(`INSERT INTO purchase_requisitions(id, requisition_no, source_instruction_id, status, request_date, required_date, notes, creator_id, created_at, updated_at)
                VALUES(?, ?, ?, 'DRAFT', ?, ?, '', ?, ?, ?)`).run(prId, prId, puiId, '2026-09-26', '2026-09-26', 'user-admin', now, now);
    const insertPii = db.prepare(`INSERT INTO purchase_instruction_items(id, instruction_id, mrp_result_id, product_id, quantity, need_by_date, purchase_requisition_id, created_at)
                                  VALUES(?, ?, ?, ?, 5, '2026-09-26', ?, ?)`);
    const resultId = 'mrp-stub-res-' + runId;
    insertPii.run('pii-share-1', puiId, resultId, 'r4-mig-prod-A', prId, now);
    insertPii.run('pii-share-2', puiId, resultId, 'r4-mig-prod-A', prId, now);
    insertPii.run('pii-share-3', puiId, resultId, 'r4-mig-prod-A', prId, now);
    const rows = db.prepare(`SELECT COUNT(*) cnt FROM purchase_instruction_items WHERE purchase_requisition_id=?`).get(prId);
    assert.equal(Number(rows.cnt), 3, 'multiple PUI rows must share one purchase_requisition_id');
  });

  test('duplicate precheck fails closed when migration is run manually on bad data', () => {
    const stubDb = {
      prepare: () => ({ all: () => [{ purchase_instruction_item_id: 'pii-stub', cnt: 2 }] }),
      exec: () => { throw new Error('exec should not be called when precheck fails'); },
    };
    assert.throws(() => migrateR4PurchaseSourceCardinality(stubDb), /R4 source-cardinality migration aborted/);
  });

  test('migration is idempotent on a clean schema (re-running is a no-op)', () => {
    const tmp3 = mkdtempSync(join(tmpdir(), 'modern-erp-r4-mig-idem-'));
    try {
      const db3 = createDatabase(join(tmp3, 'erp.db'));
      migrateR4PurchaseSourceCardinality(db3);
      migrateR4PurchaseSourceCardinality(db3);
      const lookup = db3.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_purchase_instruction_items_requisition_lookup'`).get();
      assert.ok(lookup);
      const forward = db3.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_purchase_requisition_items_pui'`).get();
      assert.ok(forward);
    } finally {
      try { rmSync(tmp3, { recursive: true, force: true }); } catch {}
    }
  });
});

function future_date(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}