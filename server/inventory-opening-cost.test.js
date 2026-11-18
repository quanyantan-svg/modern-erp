// F-02 —— 期初库存必须计价（Inventory & Warehouse / Accounting & Analytics）。
//
// 修复前的客户症状：
//   1. 期初单确认后恒为 `LEGACY_UNVALUED` → `LEGACY_UNVALUED_MOVEMENTS` 与
//      `INVENTORY_QUANTITY_VS_VALUATION` 两项 BLOCKING 永久失败，权威结账被挡死；
//   2. 期初批次没有身份级估值池 → 委外发料被 409 `OUTSOURCING_VALUATION_UNVERIFIED`
//      挡住，批次料一旦从期初进来就走不通委外。
//
// 本套件证明：期初行带成本 → 确认后权威估值流水成立、身份级估值池成立、
// 总账同步，且两项 BLOCKING 检查与 `INVENTORY_VALUE_TO_GL` 同时为 0 差异。

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTempDb } from './test-utils/temp-db.js';
import { confirmOpeningDocument, createOpeningDocument, openInitialization } from './modules/inventory-opening.js';
import { systemHealth } from './modules/financial-inventory.js';

const actor = { id: 'user-admin', permissions: ['INVENTORY_OPENING_MANAGE'] };
const req = (body) => ({
  headers: { 'content-type': 'application/json' },
  [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(body)); },
});
const res = () => {
  const response = { statusCode: 0, body: null, setHeader() {}, getHeader() { return null; }, write() {}, on() {}, once() {} };
  response.end = (chunk) => { if (chunk) response.body = JSON.parse(chunk); };
  return response;
};

function seed(db) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES('user-admin','admin','管理员','x','x','role-admin',1,?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at)
    VALUES('wh-open','WH-OPEN','期初仓',1,0,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,valuation_method,created_at,updated_at)
    VALUES('p-open-plain','P-OPEN-PLAIN','期初普通料','CAT','EA',1000,0,1,'NONE','MOVING_AVERAGE',?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,valuation_method,created_at,updated_at)
    VALUES('p-open-lot','P-OPEN-LOT','期初批次料','CAT','EA',1000,0,1,'LOT','LOT_SPECIFIC_POOL',?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO inventory_lots(id,product_id,lot_code,status,created_source_type,created_source_id,created_at)
    VALUES('lot-open','p-open-lot','LOT-OPEN-001','AVAILABLE','MANUAL','seed',?)`).run(now);
}

function healthDifference(db, code) {
  const check = systemHealth(db, { asOfDate: '9999-12-31' }).checks.find((item) => item.code === code);
  return check ? check.difference : null;
}

test('F-02 期初行带成本：确认后权威估值成立、身份级估值池成立、总账同步', async () => {
  const handle = createTempDb({ label: 'f02-opening-cost', production: true });
  const db = handle.db;
  seed(db);
  openInitialization(db, actor);
  const created = res();
  await createOpeningDocument(db, req({
    businessDate: '2026-11-18',
    items: [
      { productId: 'p-open-plain', warehouseId: 'wh-open', quantity: 10, unitCostCents: 2500 },
      { productId: 'p-open-lot', warehouseId: 'wh-open', quantity: 20, unitCostCents: 4000, lotId: 'lot-open' },
    ],
  }), created, actor);
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const docId = created.body.id;

  const confirmed = res();
  confirmOpeningDocument(db, confirmed, actor, docId);
  assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));

  // 期初移动不再是未估值。
  const transactions = db.prepare("SELECT valuation_status FROM inventory_transactions WHERE source_type='OPENING_INVENTORY'").all();
  assert.equal(transactions.length, 2);
  assert.ok(transactions.every((row) => row.valuation_status === 'VALUED'), '期初移动必须完成权威估值');

  // 估值流水按身份落池：批次料必须有身份级估值池（委外发料的估值闸门读它）。
  const pools = db.prepare('SELECT balance_key,quantity,value_cents FROM inventory_valuation_balances').all();
  const lotPool = pools.find((row) => row.balance_key === 'LOT:wh-open:p-open-lot:lot-open');
  assert.ok(lotPool, '批次期初必须建立身份级估值池');
  assert.equal(Number(lotPool.quantity), 20);
  assert.equal(Number(lotPool.value_cents), 80000);
  const plainPool = pools.find((row) => row.balance_key === 'NONE:wh-open:p-open-plain');
  assert.equal(Number(plainPool.quantity), 10);
  assert.equal(Number(plainPool.value_cents), 25000);

  // 总账同步：期初权益是存货价值的对方科目，借贷必须平衡。
  const voucher = db.prepare("SELECT id FROM accounting_vouchers WHERE source_type='OPENING_INVENTORY' AND source_id=?").get(docId);
  assert.ok(voucher, '期初必须生成总账凭证');
  const entries = db.prepare('SELECT direction,amount_cents FROM accounting_entries WHERE voucher_id=?').all(voucher.id);
  const debit = entries.filter((row) => row.direction === 'DEBIT').reduce((sum, row) => sum + Number(row.amount_cents), 0);
  const credit = entries.filter((row) => row.direction === 'CREDIT').reduce((sum, row) => sum + Number(row.amount_cents), 0);
  assert.equal(debit, credit);
  assert.equal(debit, 105000);

  // 两项被阻断的 BLOCKING 检查与存货价值对账同时归零。
  assert.equal(healthDifference(db, 'LEGACY_UNVALUED_MOVEMENTS'), 0);
  assert.equal(healthDifference(db, 'INVENTORY_QUANTITY_VS_VALUATION'), 0);
  assert.equal(healthDifference(db, 'INVENTORY_VALUE_TO_GL'), 0);
});

test('F-02 期初行缺成本固定拒绝：不得凭空估价', async () => {
  const handle = createTempDb({ label: 'f02-opening-cost', production: true });
  const db = handle.db;
  seed(db);
  openInitialization(db, actor);
  const created = res();
  await assert.rejects(
    () => createOpeningDocument(db, req({
      businessDate: '2026-11-18',
      items: [{ productId: 'p-open-plain', warehouseId: 'wh-open', quantity: 10 }],
    }), created, actor),
    /成本单价/,
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM opening_inventory_items').get().n, 0);
});

test('F-02 负向对照：批次期初行必须带属于该货品的已存在批次身份', async () => {
  const handle = createTempDb({ label: 'f02-opening-cost', production: true });
  const db = handle.db;
  seed(db);
  openInitialization(db, actor);
  const created = res();
  await assert.rejects(
    () => createOpeningDocument(db, req({
      businessDate: '2026-11-18',
      items: [{ productId: 'p-open-lot', warehouseId: 'wh-open', quantity: 20, unitCostCents: 4000 }],
    }), created, actor),
    /批次身份/,
  );
  await assert.rejects(
    () => createOpeningDocument(db, req({
      businessDate: '2026-11-18',
      items: [{ productId: 'p-open-lot', warehouseId: 'wh-open', quantity: 20, unitCostCents: 4000, lotId: 'lot-of-another-product' }],
    }), created, actor),
    /批次不存在|不属于该货品/,
  );
});
