import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import { archiveCancelledDocument, lifecycleArchiveClause, restoreArchivedDocument } from './modules/lifecycle-engine.js';

describe('V1.5 D1 real MySQL purchase receipt archive', () => {
  let mysql; let db;
  const at = '2026-09-29T08:00:00.000Z';
  const actor = { id: 'd1-mysql-admin', roleCode: 'ADMIN', permissions: ['PURCHASE_RECEIPTS_MANAGE', 'PURCHASE_RECEIPTS_VIEW', 'USERS_MANAGE'] };

  before(() => {
    mysql = createTempDb({ label: 'mysql-v15-d1', production: true });
    db = mysql.db;
    db.prepare("INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,'role-admin',1,?)")
      .run(actor.id, actor.id, 'D1 MySQL Admin', 'x', 'x', at);
    db.prepare("INSERT INTO suppliers(id,code,name,active,created_at,updated_at) VALUES('d1-s','D1-S','D1 Supplier',1,?,?)").run(at, at);
    db.prepare("INSERT INTO warehouses(id,code,name,active,created_at,updated_at) VALUES('d1-w','D1-W','D1 Warehouse',1,?,?)").run(at, at);
    db.prepare("INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,inventory_classification) VALUES('d1-p','D1-P','D1 Product','EA',500,0,1,?,?,'EA','NONE','MOVING_AVERAGE','OTHER_INVENTORY')").run(at, at);
    db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,creator_id,created_at,updated_at) VALUES('d1-po','PO-D1-MYSQL','d1-s','APPROVED',1000,?,?,?)").run(actor.id, at, at);
    db.prepare("INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('d1-poi','d1-po','d1-p',2,500,1000,1)").run();
    db.prepare("INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at) VALUES('d1-pr','PR-D1-MYSQL','d1-po','d1-s','d1-w',?,1000,'CANCELLED','2026-10-15','',?,?,?)").run(actor.id, actor.id, at, at);
    db.prepare("INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_order_item_id) VALUES('d1-pri','d1-pr','d1-p',2,500,1000,1,'d1-poi')").run();
  });

  after(() => mysql.cleanup());

  test('archive, list filtering, deterministic repeat and restore preserve all business data', () => {
    const header = db.prepare("SELECT * FROM purchase_receipts WHERE id='d1-pr'").get();
    const line = db.prepare("SELECT * FROM purchase_receipt_items WHERE id='d1-pri'").get();
    const archived = archiveCancelledDocument(db, actor, { entityType: 'PURCHASE_RECEIPT', entityId: 'd1-pr', reason: 'MySQL D1 contract' });
    assert.equal(archived.archived, true);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM purchase_receipts pr WHERE ${lifecycleArchiveClause('PURCHASE_RECEIPT', 'pr.id')}`).get().n, 0);
    assert.deepEqual(db.prepare("SELECT * FROM purchase_receipts WHERE id='d1-pr'").get(), header);
    assert.deepEqual(db.prepare("SELECT * FROM purchase_receipt_items WHERE id='d1-pri'").get(), line);
    assert.throws(
      () => archiveCancelledDocument(db, actor, { entityType: 'PURCHASE_RECEIPT', entityId: 'd1-pr', reason: 'repeat' }),
      (error) => error.code === 'ALREADY_ARCHIVED',
    );
    const restored = restoreArchivedDocument(db, actor, { entityType: 'PURCHASE_RECEIPT', entityId: 'd1-pr' });
    assert.equal(restored.archived, false);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM purchase_receipts pr WHERE ${lifecycleArchiveClause('PURCHASE_RECEIPT', 'pr.id')}`).get().n, 1);
    assert.equal(db.prepare("SELECT status FROM purchase_receipts WHERE id='d1-pr'").get().status, 'CANCELLED');
    assert.deepEqual(db.prepare("SELECT * FROM purchase_receipt_items WHERE id='d1-pri'").get(), line);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='PURCHASE_RECEIPT' AND entity_id='d1-pr' AND action IN ('ARCHIVE','RESTORE')").get().n, 2);
  });
});
