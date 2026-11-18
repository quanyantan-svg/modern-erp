// F-05 —— 期初跟踪身份：登记入口、RBAC 与端到端可用性。
//
// F-02 的服务端合同（Requirement §32.15 `IW-OPEN-04`）要求跟踪物料的期初行携带
// **已存在**的批次 / 序列号身份。但期初恰恰是这些身份在系统里的第一次事实：
// 此前没有任何业务单据能带出它，界面也没有登记入口 —— 跟踪物料的期初因此
// **在界面上录不出来**（只有 API 能做）。
//
// 本套件证明：
//   1. 期初流程自己拥有身份登记入口（守卫是期初的既有权限码，不新增权限码）；
//   2. 同一货品的同一批号 / 序列号重复登记**不产生第二条身份**（幂等）；
//   3. 无权 actor 被后端 403 拒绝，且零副作用；
//   4. 跟踪方式与身份类型不一致时固定拒绝，不得凭空造身份；
//   5. 端到端：登记身份 → 建期初单 → 确认 → 身份级估值池成立（界面路径可走通）。

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

let fixture = null;

async function ensureFixture() {
  if (fixture) return fixture;
  fixture = await createProcurementFixture('modern-erp-f05-opening-identity-');
  const created = await fixture.request('POST', '/api/products', fixture.tokens.admin, {
    code: 'F05-LOT-001', name: 'F05 批次料', unit: 'EA', priceCents: 1000, trackingPolicy: 'LOT',
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const serial = await fixture.request('POST', '/api/products', fixture.tokens.admin, {
    code: 'F05-SER-001', name: 'F05 序列号料', unit: 'EA', priceCents: 1000, trackingPolicy: 'SERIAL',
  });
  assert.equal(serial.status, 201, JSON.stringify(serial.data));
  const plain = await fixture.request('POST', '/api/products', fixture.tokens.admin, {
    code: 'F05-PLAIN-001', name: 'F05 普通料', unit: 'EA', priceCents: 1000,
  });
  assert.equal(plain.status, 201, JSON.stringify(plain.data));
  const warehouses = await fixture.request('GET', '/api/warehouses', fixture.tokens.warehouse);
  assert.equal(warehouses.status, 200, JSON.stringify(warehouses.data));
  fixture.lotProductId = created.data.product?.id || created.data.id;
  fixture.serialProductId = serial.data.product?.id || serial.data.id;
  fixture.plainProductId = plain.data.product?.id || plain.data.id;
  fixture.warehouseId = warehouses.data.warehouses?.[0]?.id;
  assert.ok(fixture.lotProductId && fixture.serialProductId && fixture.plainProductId && fixture.warehouseId);
  return fixture;
}

test.after(async () => { if (fixture) await fixture.close(); });

test('F-05 期初身份登记：批次 / 序列号可登记，同码重复登记不产生第二条身份', async () => {
  const fx = await ensureFixture();
  const lot = await fx.request('POST', '/api/inventory/opening-identities', fx.tokens.warehouse, {
    productId: fx.lotProductId, kind: 'LOT', code: 'F05-LOT-A',
  });
  assert.equal(lot.status, 201, JSON.stringify(lot.data));
  assert.ok(lot.data.id);
  assert.equal(lot.data.existing, false);

  const again = await fx.request('POST', '/api/inventory/opening-identities', fx.tokens.warehouse, {
    productId: fx.lotProductId, kind: 'LOT', code: 'F05-LOT-A',
  });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.id, lot.data.id, '同一货品同一批号必须复用同一条身份');
  assert.equal(again.data.existing, true);

  const rows = fx.db.prepare('SELECT id,lot_code FROM inventory_lots WHERE product_id=?').all(fx.lotProductId);
  assert.equal(rows.length, 1, '重复登记不得产生第二条身份主档');

  const serial = await fx.request('POST', '/api/inventory/opening-identities', fx.tokens.warehouse, {
    productId: fx.serialProductId, kind: 'SERIAL', code: 'F05-SN-001',
  });
  assert.equal(serial.status, 201, JSON.stringify(serial.data));
  const serialRows = fx.db.prepare('SELECT id FROM inventory_serials WHERE product_id=?').all(fx.serialProductId);
  assert.equal(serialRows.length, 1);
});

test('F-05 无权 actor 被后端拒绝：403 且零副作用', async () => {
  const fx = await ensureFixture();
  const before = fx.db.prepare('SELECT COUNT(*) n FROM inventory_lots').get().n;
  const denied = await fx.request('POST', '/api/inventory/opening-identities', fx.tokens.sales, {
    productId: fx.lotProductId, kind: 'LOT', code: 'F05-LOT-DENIED',
  });
  assert.equal(denied.status, 403, JSON.stringify(denied.data));
  const after = fx.db.prepare('SELECT COUNT(*) n FROM inventory_lots').get().n;
  assert.equal(after, before, '被拒绝的登记不得留下身份主档');
});

test('F-05 跟踪方式不匹配固定拒绝：不得凭空造身份', async () => {
  const fx = await ensureFixture();
  const mismatch = await fx.request('POST', '/api/inventory/opening-identities', fx.tokens.warehouse, {
    productId: fx.plainProductId, kind: 'LOT', code: 'F05-LOT-PLAIN',
  });
  assert.equal(mismatch.status, 409, JSON.stringify(mismatch.data));
  assert.equal(mismatch.data.code, 'TRACKING_POLICY_MISMATCH');

  const wrongKind = await fx.request('POST', '/api/inventory/opening-identities', fx.tokens.warehouse, {
    productId: fx.lotProductId, kind: 'SERIAL', code: 'F05-SN-WRONG',
  });
  assert.equal(wrongKind.status, 409, JSON.stringify(wrongKind.data));

  const missingCode = await fx.request('POST', '/api/inventory/opening-identities', fx.tokens.warehouse, {
    productId: fx.lotProductId, kind: 'LOT',
  });
  assert.equal(missingCode.status, 400, JSON.stringify(missingCode.data));

  const orphan = fx.db.prepare('SELECT COUNT(*) n FROM inventory_lots WHERE lot_code IN (?,?)')
    .get('F05-LOT-PLAIN', 'F05-SN-WRONG');
  assert.equal(Number(orphan.n), 0, '被拒绝的登记不得留下身份主档');
});

test('F-05 端到端：登记身份 → 期初单 → 确认后身份级估值池成立', async () => {
  const fx = await ensureFixture();
  const identity = await fx.request('POST', '/api/inventory/opening-identities', fx.tokens.warehouse, {
    productId: fx.lotProductId, kind: 'LOT', code: 'F05-LOT-E2E',
  });
  assert.equal(identity.status, 201, JSON.stringify(identity.data));

  const opened = await fx.request('POST', '/api/inventory-initialization/open', fx.tokens.warehouse, {});
  assert.equal(opened.status, 200, JSON.stringify(opened.data));

  const created = await fx.request('POST', '/api/inventory/opening-documents', fx.tokens.warehouse, {
    businessDate: '2026-11-18',
    items: [{
      productId: fx.lotProductId, warehouseId: fx.warehouseId, quantity: 20,
      unitCostCents: 4000, lotId: identity.data.id,
    }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));

  const confirmed = await fx.request('POST', `/api/inventory/opening-documents/${created.data.id}/confirm`, fx.tokens.warehouse, {});
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

  const pool = fx.db.prepare('SELECT balance_key,quantity,value_cents FROM inventory_valuation_balances WHERE balance_key=?')
    .get(`LOT:${fx.warehouseId}:${fx.lotProductId}:${identity.data.id}`);
  assert.ok(pool, '按界面登记的批次身份期初后必须形成身份级估值池');
  assert.equal(Number(pool.quantity), 20);
  assert.equal(Number(pool.value_cents), 80000);

  const unvalued = fx.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OPENING_INVENTORY' AND valuation_status<>'VALUED'").get();
  assert.equal(Number(unvalued.n), 0, '期初移动必须完成权威估值');
});
