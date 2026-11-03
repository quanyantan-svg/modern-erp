// M1C-WP2–WP6-R1 focused regression suite — 委外收货生效的重复确认、幂等重放
// 与并发竞争。
//
// Contract source:
//   - Requirement docs/requirements/procurement-outsourcing.md §31.13
//     MC-REQ-05（“建待检收货”与“确认库存效力”是两个不同动作；重复确认与并发转换
//     不得重复计入库存、成本或通知数量）、MC-REQ-09（事务边界与幂等 scope 三元组；
//     容量检查在事务内以权威口径比较）、MC-REQ-10（收货生效只认收货管理权限）、
//     MC-REQ-11（业务门禁拒绝 409 审计恰好 1 条；403 审计不含业务单据标识；
//     400 输入失败不写 Domain 审计）
//   - Active Design docs/design/procurement-outsourcing-m1-core.md §5.4（两个动作；
//     重复确认与并发转换不得重复计入）、§6（事务边界与幂等）、§9.2（零副作用域与
//     拒绝审计边界）、§9.3（错误码与零副作用）
//
// Defect under repair (P0-02): inside the authoritative transaction
// `confirmOutsourcingReceipt()` returned silently when the re-read receipt was
// already `EFFECTED`, so the outer handler reported HTTP 200 success for a
// request that had neither a recorded idempotent replay nor any effect of its
// own.
//
// Every positive case drives the production HTTP API. The one white-box case
// reproduces the MySQL race window deterministically on SQLite, because a
// single-connection SQLite server cannot interleave two requests between the
// pre-transaction read and the in-transaction re-read.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  createApprovedProcessingPo, createProcurementFixture, outsourcingReceiptBody,
} from './test-support/procurement-http-fixture.js';
import { confirmOutsourcingReceipt } from './modules/outsourcing-finance.js';

describe('M1C-WP2–WP6-R1 — outsourcing receipt effect idempotency and concurrency', () => {
  let fixture;

  const isoDate = (offset = 0) => {
    const value = new Date();
    value.setDate(value.getDate() + offset);
    return value.toISOString().slice(0, 10);
  };

  const SNAPSHOT_TABLES = [
    'outsourcing_receipts', 'outsourcing_receipt_items', 'outsourcing_cost_evidences',
    'outsourcing_material_list',
    'inventory', 'inventory_transactions', 'tracked_inventory_movements',
    'inventory_valuation_movements', 'inventory_valuation_balances',
  ];

  function businessSnapshot() {
    const snapshot = {};
    for (const table of SNAPSHOT_TABLES) {
      snapshot[table] = JSON.stringify(fixture.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    }
    return snapshot;
  }

  function rejectAudits(entityType, entityId) {
    return Number(fixture.db.prepare(
      "SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type=? AND entity_id=?",
    ).get(entityType, entityId).n);
  }

  async function qualifyOutsourceSupplier() {
    const result = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), supplierWipWarehouseId: 'warehouse-002',
    });
    assert.equal(result.status, 200, result.data.error);
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES(?, 'MOVING_AVERAGE', ?, 'warehouse-001', NULL, NULL, 1000, 1000000, ?)
      ON CONFLICT(balance_key) DO NOTHING`).run(`NONE:warehouse-001:product-001`, 'product-001', now);
  }

  async function releaseOrder(quantity) {
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: quantity, unit: 'EA',
      businessDate: isoDate(0),
    });
    assert.equal(order.status, 201, order.data.error);
    const orderId = order.data.id;
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fixture.tokens.admin, { action: 'PLAN_CONFIRMED' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fixture.tokens.admin, { action: 'RELEASED' });
    return orderId;
  }

  async function createPendingReceipt(orderId, key, quantity = 2) {
    const processingPoId = await createApprovedProcessingPo(fixture, orderId, key);
    const poItem = fixture.db.prepare('SELECT * FROM purchase_order_items WHERE order_id=?').get(processingPoId);
    const notice = await fixture.request('POST', '/api/receipt-notices', fixture.tokens.admin, {
      businessType: 'OUTSOURCE', outsourcingOrderId: orderId, processingPoId,
      warehouseId: 'warehouse-001', noticeDate: isoDate(0),
      items: [{ productId: 'product-001', quantity: 4 }], idempotencyKey: `notice-${key}`,
    });
    assert.equal(notice.status, 201, JSON.stringify(notice.data));
    await fixture.request('POST', `/api/receipt-notices/${notice.data.id}/confirm`, fixture.tokens.admin);
    const noticeItem = fixture.db.prepare('SELECT * FROM receipt_notice_items WHERE notice_id=?').get(notice.data.id);
    const source = {
      processingPoId, processingPoItemId: poItem.id, sourceNoticeId: notice.data.id,
      sourceNoticeItemId: noticeItem.id, productId: 'product-001',
      unitCode: poItem.document_uom_code || 'EA', warehouseId: 'warehouse-001',
    };
    const created = await fixture.request('POST', '/api/procurement/outsourcing/receipts',
      fixture.tokens.outsourcingReceiving, {
        orderId, quantity, receivedDate: isoDate(0), businessDate: isoDate(0),
        processingPoId: source.processingPoId, sourceNoticeId: source.sourceNoticeId,
        warehouseId: source.warehouseId, processingFeeCents: 200,
        ...outsourcingReceiptBody(source, quantity, 200),
      }, { 'idempotency-key': `receipt-${key}` });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    return created.data.id;
  }

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-m1c-wp2-wp6-r1-effect-');
    await qualifyOutsourceSupplier();
  });
  after(async () => { await fixture.close(); });

  // =========================================================================
  // A — the sequential repeat, the exact replay and the key conflicts
  // =========================================================================
  describe('A a repeated effect is either an exact replay or an explicit refusal', () => {
    test('A-1 the exact same key and fingerprint replays the recorded result', async () => {
      const orderId = await releaseOrder(10);
      const receiptId = await createPendingReceipt(orderId, `a-1-${orderId}`);
      const key = `a-1-effect-${orderId}`;

      const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': key });
      assert.equal(effected.status, 200, JSON.stringify(effected.data));
      assert.equal(effected.data.ok, true);

      const before = businessSnapshot();
      const rejectsBefore = rejectAudits('OUTSOURCING_RECEIPT', receiptId);
      const replayed = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': key });
      assert.equal(replayed.status, 200, JSON.stringify(replayed.data));
      assert.equal(replayed.data.replayed, true);
      assert.equal(replayed.data.totalMaterialValueCents, effected.data.totalMaterialValueCents,
        'the replay returns the recorded result, not a new one');
      assert.deepEqual(replayed.data.incrementalRows, effected.data.incrementalRows);

      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay untouched on an exact replay`);
      }
      assert.equal(rejectAudits('OUTSOURCING_RECEIPT', receiptId), rejectsBefore,
        'an exact replay is not a business rejection');
    });

    test('A-2 the same key with different content is refused with 409 and one rejection audit', async () => {
      const orderId = await releaseOrder(10);
      const receiptId = await createPendingReceipt(orderId, `a-2-${orderId}`);
      const key = `a-2-effect-${orderId}`;

      const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': key });
      assert.equal(effected.status, 200, JSON.stringify(effected.data));

      const before = businessSnapshot();
      const rejectsBefore = rejectAudits('OUTSOURCING_RECEIPT', receiptId);
      const conflict = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
        fixture.tokens.outsourcingReceiving, { materialIdentities: [{ materialListId: 'material-x', lotId: 'LOT-X' }] },
        { 'idempotency-key': key });
      assert.equal(conflict.status, 409, JSON.stringify(conflict.data));
      assert.equal(conflict.data.code, 'OUTSOURCING_RECEIPT_IDEMPOTENCY_CONFLICT');

      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay untouched when the same key carries different content`);
      }
      assert.equal(rejectAudits('OUTSOURCING_RECEIPT', receiptId), rejectsBefore + 1,
        'exactly one business rejection audit');
    });

    test('A-3 a different key repeating the effect is refused with 409 and one rejection audit', async () => {
      const orderId = await releaseOrder(10);
      const receiptId = await createPendingReceipt(orderId, `a-3-${orderId}`);

      const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `a-3-first-${orderId}` });
      assert.equal(effected.status, 200, JSON.stringify(effected.data));

      const receiptBefore = fixture.db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(receiptId);
      const before = businessSnapshot();
      const rejectsBefore = rejectAudits('OUTSOURCING_RECEIPT', receiptId);

      const repeated = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `a-3-second-${orderId}` });
      assert.equal(repeated.status, 409, JSON.stringify(repeated.data));
      assert.equal(repeated.data.code, 'OUTSOURCING_RECEIPT_ALREADY_EFFECTED');

      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay untouched when the effect is repeated`);
      }
      assert.deepEqual(fixture.db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(receiptId), receiptBefore,
        'the refused request leaves the receipt unchanged field by field');
      assert.equal(rejectAudits('OUTSOURCING_RECEIPT', receiptId), rejectsBefore + 1,
        'exactly one business rejection audit');
      const rejection = fixture.db.prepare(
        "SELECT entity_id, detail FROM audit_logs WHERE action='REJECT' AND entity_type='OUTSOURCING_RECEIPT' AND entity_id=? ORDER BY created_at DESC, id DESC LIMIT 1",
      ).get(receiptId);
      assert.equal(rejection.entity_id, receiptId, 'the rejection audit carries the business document id');
      assert.match(rejection.detail, /OUTSOURCING_RECEIPT_ALREADY_EFFECTED/,
        'the rejection audit records the exact error code');
    });

    test('A-4 the effect never happens twice: no duplicate WIP, finished goods, valuation or cost record', async () => {
      const orderId = await releaseOrder(10);
      const receiptId = await createPendingReceipt(orderId, `a-4-${orderId}`);

      const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `a-4-first-${orderId}` });
      assert.equal(effected.status, 200, JSON.stringify(effected.data));

      const counted = {
        inventory: Number(fixture.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=?").get(receiptId).n),
        valuation: Number(fixture.db.prepare("SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=?").get(receiptId).n),
        evidences: Number(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receiptId).n),
      };
      assert.ok(counted.inventory > 0 && counted.valuation > 0 && counted.evidences === 1,
        'the effect produced exactly one finished goods receipt, its valuation and one cost evidence');

      const repeated = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `a-4-second-${orderId}` });
      assert.equal(repeated.status, 409);

      assert.equal(Number(fixture.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=?").get(receiptId).n), counted.inventory);
      assert.equal(Number(fixture.db.prepare("SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=?").get(receiptId).n), counted.valuation);
      assert.equal(Number(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receiptId).n), counted.evidences);
    });
  });

  // =========================================================================
  // B — two concurrent requests, at most one effect
  // =========================================================================
  describe('B two concurrent effect requests produce at most one effect', () => {
    test('B-1 two requests with different keys: one effects, the other fails explicitly', async () => {
      const orderId = await releaseOrder(10);
      const receiptId = await createPendingReceipt(orderId, `b-1-${orderId}`);

      const [first, second] = await Promise.all([
        fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
          fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `b-1-first-${orderId}` }),
        fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
          fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `b-1-second-${orderId}` }),
      ]);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 409], `exactly one request may effect the receipt, got ${statuses}`);
      const refused = first.status === 409 ? first : second;
      assert.equal(refused.data.code, 'OUTSOURCING_RECEIPT_ALREADY_EFFECTED');

      assert.equal(fixture.db.prepare('SELECT business_status status FROM outsourcing_receipts WHERE id=?').get(receiptId).status, 'EFFECTED');
      assert.equal(Number(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receiptId).n), 1,
        'the concurrent pair produced exactly one cost evidence');
      assert.equal(rejectAudits('OUTSOURCING_RECEIPT', receiptId), 1,
        'exactly one business rejection audit for the losing request');
    });

    test('B-2 the second request that enters the transaction after the state changed fails explicitly', async () => {
      const orderId = await releaseOrder(10);
      const receiptId = await createPendingReceipt(orderId, `b-2-${orderId}`);

      const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `b-2-first-${orderId}` });
      assert.equal(effected.status, 200, JSON.stringify(effected.data));

      // The MySQL race window: the second request reads PENDING_INSPECTION
      // before the transaction and EFFECTED inside it. A single-connection
      // SQLite server cannot interleave two HTTP requests that way, so the
      // window is reproduced with a controlled database wrapper that only
      // changes the in-transaction re-read.
      const snapshotBefore = businessSnapshot();
      const rejectsBefore = rejectAudits('OUTSOURCING_RECEIPT', receiptId);
      const raced = await confirmWithConcurrentEffect(receiptId, `b-2-race-${orderId}`);
      assert.equal(raced.status, 409, JSON.stringify(raced.data));
      assert.equal(raced.data.code, 'OUTSOURCING_RECEIPT_ALREADY_EFFECTED');

      const snapshotAfter = businessSnapshot();
      for (const table of Object.keys(snapshotBefore)) {
        assert.equal(snapshotAfter[table], snapshotBefore[table],
          `${table} must stay untouched when the concurrent request loses the race`);
      }
      assert.equal(rejectAudits('OUTSOURCING_RECEIPT', receiptId), rejectsBefore + 1,
        'exactly one business rejection audit');
    });
  });

  // =========================================================================
  // C — the authorization and the input failure boundaries
  // =========================================================================
  describe('C the rejection audit boundary of the effect action', () => {
    test('C-1 a 403 refusal writes exactly one audit and leaks no business document id', async () => {
      const orderId = await releaseOrder(10);
      const receiptId = await createPendingReceipt(orderId, `c-1-${orderId}`);
      const authorizationBefore = Number(fixture.db.prepare(
        "SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type='AUTHORIZATION'",
      ).get().n);
      const before = businessSnapshot();

      const refused = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
        fixture.tokens.outsourcing, {}, { 'idempotency-key': `c-1-refused-${orderId}` });
      assert.equal(refused.status, 403, JSON.stringify(refused.data));
      assert.equal(Number(fixture.db.prepare(
        "SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type='AUTHORIZATION'",
      ).get().n), authorizationBefore + 1, 'exactly one authorization rejection audit');

      const audit = fixture.db.prepare(
        "SELECT entity_id, detail FROM audit_logs WHERE action='REJECT' AND entity_type='AUTHORIZATION' ORDER BY created_at DESC, id DESC LIMIT 1",
      ).get();
      assert.equal(audit.entity_id, null, 'the authorization refusal audit carries no business document id');
      assert.ok(!String(audit.detail).includes(receiptId), 'the authorization refusal audit does not leak the receipt id');
      assert.ok(!JSON.stringify(refused.data).includes(receiptId), 'the 403 response does not leak the receipt id');

      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay untouched when the effect is not authorized`);
      }
    });

    test('C-2 a 400 input failure writes no Domain rejection audit', async () => {
      const orderId = await releaseOrder(10);
      const receiptId = await createPendingReceipt(orderId, `c-2-${orderId}`);
      const rejectsBefore = rejectAudits('OUTSOURCING_RECEIPT', receiptId);
      const before = businessSnapshot();

      const refused = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, {});
      assert.equal(refused.status, 400, JSON.stringify(refused.data));

      const after = businessSnapshot();
      for (const table of Object.keys(before)) {
        assert.equal(after[table], before[table], `${table} must stay untouched when the request is malformed`);
      }
      assert.equal(rejectAudits('OUTSOURCING_RECEIPT', receiptId), rejectsBefore,
        'a 400 input failure writes no Domain rejection audit');
    });
  });

  /**
   * Reproduces the MySQL race window deterministically on SQLite.
   *
   * The wrapped database reports the receipt as still `PENDING_INSPECTION` for
   * the read that happens before the transaction, and as `EFFECTED` for the
   * authoritative re-read inside the transaction — exactly the state a
   * concurrent request leaves behind. Everything else is the production
   * database, the production handler and the production transaction.
   */
  async function confirmWithConcurrentEffect(receiptId, idempotencyKey) {
    const db = fixture.db;
    const receiptSelect = 'SELECT * FROM outsourcing_receipts WHERE id=?';
    let inTransaction = false;
    const wrapped = {
      get dialect() { return db.dialect; },
      exec(sql) {
        const result = db.exec(sql);
        if (/^BEGIN/i.test(sql)) inTransaction = true;
        else if (/^(COMMIT|ROLLBACK)/i.test(sql)) inTransaction = false;
        return result;
      },
      prepare(sql) {
        const statement = db.prepare(sql);
        if (sql !== receiptSelect) return statement;
        return {
          get: (...args) => {
            const row = statement.get(...args);
            if (!row || !inTransaction) return row;
            return { ...row, business_status: 'EFFECTED' };
          },
          all: (...args) => statement.all(...args),
          run: (...args) => statement.run(...args),
        };
      },
    };

    const chunks = [Buffer.from(JSON.stringify({}))];
    const req = {
      headers: { 'idempotency-key': idempotencyKey, 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() { yield* chunks; },
    };
    let status = 0;
    let body = {};
    const res = {
      set statusCode(value) { status = value; },
      get statusCode() { return status; },
      setHeader() {},
      end(payload) { body = payload ? JSON.parse(payload) : {}; },
    };
    const actor = { id: 'user-outsourcing-receiving', permissions: ['OUTSOURCING_RECEIVING_MANAGE'] };
    try {
      await confirmOutsourcingReceipt(wrapped, req, res, actor, receiptId);
    } catch (error) {
      status = error.status || 500;
      body = { code: error.code, message: error.message };
    }
    return { status, data: body };
  }
});
