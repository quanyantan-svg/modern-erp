import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import { requestFingerprint } from './modules/financial-controls.js';
import { resolveSalesPrice } from './modules/sales-pricing.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'mysql-concurrency-sales-wave2-worker.mjs');
const RPC_TIMEOUT_MS = 15_000;
const ACTOR = '00000000-0000-4000-8000-000000000001';
const CUSTOMER = '00000000-0000-4000-8000-000000000002';
const PRODUCT = '00000000-0000-4000-8000-000000000003';
const PRODUCT_2 = '00000000-0000-4000-8000-000000000004';
const LIST_OLD = '00000000-0000-4000-8000-000000000101';
const LIST_ALT = '00000000-0000-4000-8000-000000000102';
const LIST_DRAFT = '00000000-0000-4000-8000-000000000103';
const LIST_A = '00000000-0000-4000-8000-000000000104';
const LIST_B = '00000000-0000-4000-8000-000000000105';
const ENTRY_OLD = '00000000-0000-4000-8000-000000000201';
const ENTRY_ALT = '00000000-0000-4000-8000-000000000202';
const ENTRY_DRAFT = '00000000-0000-4000-8000-000000000203';
const ORDER = '00000000-0000-4000-8000-000000000401';
const ORDER_LINE = '00000000-0000-4000-8000-000000000402';
const CREATOR = '00000000-0000-4000-8000-000000000403';

class Worker {
  constructor(name) {
    this.name = name; this.pending = new Map(); this.stderr = '';
    this.child = spawn(process.execPath, [workerPath], { cwd: repoRoot, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      let reply; try { reply = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(reply.id); if (!pending) return;
      this.pending.delete(reply.id); clearTimeout(pending.timer);
      if (reply.ok) pending.resolve(reply.result); else pending.reject(Object.assign(new Error(reply.error.message), reply.error));
    });
    this.child.on('exit', (code) => {
      for (const [, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(new Error(`${name} exited ${code}: ${this.stderr}`)); }
      this.pending.clear();
    });
  }
  run(command) {
    const id = randomUUID();
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.name} RPC timeout: ${JSON.stringify(command)}`)); }, RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }
  async close() { try { await this.run({ action: 'close' }); } catch {} try { this.child.stdin.end(); } catch {} }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function processRow(db, connectionId) {
  try { return db.prepare('SELECT ID,STATE,INFO FROM information_schema.PROCESSLIST WHERE ID=?').get(connectionId); }
  catch { return null; }
}
function waitForInfo(db, connectionId, fragment, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const row = processRow(db, connectionId);
    if (String(row?.INFO || '').toUpperCase().includes(fragment.toUpperCase())) return row;
    sleep(25);
  }
  return null;
}
function resolverBody(overrides = {}) {
  return { customerId: CUSTOMER, materialId: PRODUCT, pricingUomCode: 'EA', quantityDecimal: '1',
    businessDate: '2026-10-15', explicitPriceListIds: [LIST_OLD], ...overrides };
}

describe('Sales & Customer Wave 2 real MySQL coherent resolver and writer concurrency', () => {
  let handle; let db; let resolver; let writer; let resolverRegistration; let writerRegistration;
  before(async () => {
    handle = createTempDb({ label: 'sales-wave2-concurrency', production: true }); db = handle.db;
    assert.equal(db.dialect, 'mysql');
    const stamp = new Date().toISOString();
    db.prepare("INSERT INTO roles(id,code,name,description,system_role,created_at) VALUES('wave2-role','WAVE2','Wave2','',0,?)").run(stamp);
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at,name)
      VALUES(?,'wave2-actor','Wave2 Actor','','','wave2-role',1,?,'Wave2 Actor')`).run(ACTOR, stamp);
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at,name)
      VALUES(?,'wave2-creator','Wave2 Creator','','','wave2-role',1,?,'Wave2 Creator')`).run(CREATOR, stamp);
    db.prepare('INSERT INTO customers(id,code,name,contact,phone,address,payment_terms_days,active,created_at,updated_at) VALUES(?,?,?,?,?,?,0,1,?,?)')
      .run(CUSTOMER, 'W2-C', 'Wave2 Customer', '', '', '', stamp, stamp);
    db.prepare('INSERT IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES(?,?,1,?,?)').run('EA', 'Each', stamp, stamp);
    for (const [id, code] of [[PRODUCT, 'W2-P1'], [PRODUCT_2, 'W2-P2']]) {
      db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code)
        VALUES(?,?,?,'EA',0,0,1,?,?,'EA')`).run(id, code, code, stamp, stamp);
      db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,default_upper_delivery_tolerance_bps,
        default_lower_delivery_tolerance_bps,service_classification,active,created_at,updated_at)
        VALUES(?,?,1,0,0,0,1,?,?)`).run(randomUUID(), id, stamp, stamp);
    }
    db.prepare(`INSERT INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
      sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,active,created_at,updated_at)
      VALUES('SYSTEM','SYSTEM',NULL,0,0,0,0,0,'DISABLED','DISABLED',1,?,?)`).run(stamp, stamp);
    const addList = (id, code, status, fallback = null) => db.prepare(`INSERT INTO sales_price_lists(id,price_list_code,name,currency_code,priority,
      fallback_price_list_id,effective_from,effective_to,status,activated_at,activated_by,created_at,created_by,updated_at,updated_by)
      VALUES(?,?,?,'CNY',0,?,'2026-01-01',NULL,?,?,?, ?,?,?,?)`)
      .run(id, code, code, fallback, status, status === 'ACTIVE' ? stamp : null, status === 'ACTIVE' ? ACTOR : null, stamp, ACTOR, stamp, ACTOR);
    addList(LIST_OLD, 'W2-OLD', 'ACTIVE'); addList(LIST_ALT, 'W2-ALT', 'ACTIVE'); addList(LIST_DRAFT, 'W2-DRAFT', 'DRAFT');
    addList(LIST_A, 'W2-A', 'ACTIVE', LIST_OLD); addList(LIST_B, 'W2-B', 'ACTIVE', LIST_OLD);
    const addEntry = (id, listId) => db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,
      material_identity_key,customer_scope_key,pricing_uom_code,pricing_identity_key,qty_break_min_micros,qty_break_max_micros,effective_from,effective_to,created_at,created_by)
      VALUES(?,?,?,NULL,'ALL',?,'A','EA',?,0,NULL,'2026-01-01',NULL,?,?)`)
      .run(id, listId, PRODUCT, `M:${Buffer.from(PRODUCT).toString('hex').toUpperCase()}`, 'U:4541|Q:0000000000000000|D:20260101', stamp, ACTOR);
    addEntry(ENTRY_OLD, LIST_OLD); addEntry(ENTRY_ALT, LIST_ALT); addEntry(ENTRY_DRAFT, LIST_DRAFT);
    for (const [id, entryId, cents] of [
      ['00000000-0000-4000-8000-000000000301', ENTRY_OLD, 100],
      ['00000000-0000-4000-8000-000000000302', ENTRY_ALT, 200],
      ['00000000-0000-4000-8000-000000000303', ENTRY_DRAFT, 300],
    ]) db.prepare('INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by) VALUES(?,?,1,?,?,?,?)')
      .run(id, entryId, cents, JSON.stringify({ unitPriceCents: cents }), stamp, ACTOR);
    db.prepare(`INSERT INTO customer_commercial_extensions(customer_id,effective_from,default_pricing_list_id,default_payment_terms_days,
      default_settlement_method,sellable_scope_mode,effective_to,created_at,updated_at,created_by,updated_by)
      VALUES(?,'2026-01-01',?,NULL,NULL,'ALL_SALES_ENABLED',NULL,?,?,?,?)`)
      .run(CUSTOMER, LIST_OLD, stamp, stamp, ACTOR, ACTOR);
    const evidence = resolveSalesPrice(db, resolverBody(), { id: ACTOR, permissions: ['SALES_PRICING_VIEW'] });
    const priceSnapshot = { contractVersion: 'SALES_PRICE_SNAPSHOT_V1', businessDate: '2026-10-15', requestFingerprint: evidence.fingerprint,
      materialId: PRODUCT, requestedUomCode: 'EA', quantityMicros: 1_000_000, unitPriceCents: 100, catalogUnitPriceCents: 100,
      grossAmountCents: 100, giftLine: false, evidence };
    const discountEvidence = { contractVersion: 'ORDER_DISCOUNT_V1', explicitZeroDiscount: true,
      lineDiscountCentsByLine: { [ORDER_LINE]: 0 }, headerDiscountCentsTotal: 0,
      headerAllocationCentsByLine: { [ORDER_LINE]: 0 }, totalDiscountCents: 0,
      finalLineCentsByLine: { [ORDER_LINE]: 100 }, appliedRuleEvidence: [],
      pricingEvidenceByLine: { [ORDER_LINE]: evidence },
      roundingEvidence: { contract: 'HALF_UP_CENT_V1', allocation: 'LARGEST_REMAINDER_LINE_NO_LINE_ID' }, manualOverride: null };
    discountEvidence.fingerprint = requestFingerprint(discountEvidence);
    const discountSnapshot = { contractVersion: 'ORDER_DISCOUNT_SNAPSHOT_V1', businessDate: '2026-10-15', requestFingerprint: discountEvidence.fingerprint,
      lineId: ORDER_LINE, grossAmountCents: 100, finalAmountCents: 100, lineDiscountCents: 0, headerAllocationCents: 0, evidence: discountEvidence };
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,
      requested_delivery_date,reservation_intent_state,commercial_close_state,effective_version) VALUES(?, 'SO-R-SAL-11',?,'SUBMITTED',100,'',?,?,?,'2026-10-15','2026-10-15','NONE','OPEN',1)`)
      .run(ORDER, CUSTOMER, CREATOR, stamp, stamp);
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,document_uom_code,
      document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,base_quantity_num,base_quantity_den,
      is_gift_line,pricing_uom_code_applied,upper_delivery_tolerance_bps,lower_delivery_tolerance_bps,price_snapshot_json,discount_snapshot_json)
      VALUES(?,?,?,1,100,100,1,'EA',1000000,1000000,1,1,1000000,1000000,0,'EA',0,0,?,?)`)
      .run(ORDER_LINE, ORDER, PRODUCT, JSON.stringify(priceSnapshot), JSON.stringify(discountSnapshot));
    resolver = new Worker('resolver'); writer = new Worker('writer');
    resolverRegistration = await resolver.run({ action: 'register' }); writerRegistration = await writer.run({ action: 'register' });
    assert.notEqual(resolverRegistration.connectionId, writerRegistration.connectionId);
    assert.notEqual(resolverRegistration.processId, writerRegistration.processId);
  });
  after(async () => { await resolver?.close(); await writer?.close(); handle?.cleanup(); });
  beforeEach(() => {
    db.prepare("UPDATE sales_price_lists SET status='ACTIVE',retired_at=NULL,retired_by=NULL WHERE id=?").run(LIST_OLD);
    db.prepare('UPDATE customer_commercial_extensions SET default_pricing_list_id=? WHERE customer_id=?').run(LIST_OLD, CUSTOMER);
  });

  async function resolverWriterRace(resolveBody, mutation) {
    const resolving = resolver.run({ action: 'resolve-price-delay', body: resolveBody, delaySeconds: 2 });
    assert.ok(waitForInfo(db, resolverRegistration.connectionId, 'SLEEP'), 'resolver must be observed after acquiring its shared gate');
    const writing = writer.run(mutation);
    const wait = waitForInfo(db, writerRegistration.connectionId, 'MYSQL_TRANSACTION_GATES');
    assert.ok(wait, `writer must wait at canonical gate, process=${JSON.stringify(processRow(db, writerRegistration.connectionId))}`);
    const resolved = await resolving;
    const written = await writing;
    return { resolved, written };
  }

  test('R-W2-01 resolver keeps coherent price/version evidence while retirement waits', async () => {
    const auditBefore = Number(db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n);
    const { resolved, written } = await resolverWriterRace(resolverBody(), { action: 'retire-price-list', listId: LIST_OLD, key: 'w2-retire' });
    assert.equal(resolved.status, 200, JSON.stringify(resolved));
    assert.equal(resolved.body.pricing.resolvedPriceCents, 100);
    assert.equal(resolved.body.pricing.version, 1);
    assert.equal(written.status, 200, JSON.stringify(written));
    assert.equal(db.prepare('SELECT status FROM sales_price_lists WHERE id=?').get(LIST_OLD).status, 'RETIRED');
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n), auditBefore + 1);
  });

  test('R-W2-02 customer-default update waits and cannot mix resolver roots', async () => {
    const { resolved, written } = await resolverWriterRace(resolverBody({ explicitPriceListIds: [] }), {
      action: 'update-customer-default', versionId: `${CUSTOMER}~2026-01-01`, body: { defaultPricingListId: LIST_ALT },
    });
    assert.equal(resolved.status, 200, JSON.stringify(resolved));
    assert.equal(resolved.body.pricing.priceListId, LIST_OLD);
    assert.equal(resolved.body.pricing.resolvedPriceCents, 100);
    assert.equal(written.status, 200, JSON.stringify(written));
    const after = await resolver.run({ action: 'resolve-price', body: resolverBody({ explicitPriceListIds: [] }) });
    assert.equal(after.status, 200, JSON.stringify(after));
    assert.equal(after.body.pricing.priceListId, LIST_ALT);
    assert.equal(after.body.pricing.resolvedPriceCents, 200);
  });

  test('R-W2-03 version append and activation serialize with atomic success or fail-closed outcome', async () => {
    db.prepare("UPDATE sales_price_lists SET status='DRAFT',activated_at=NULL,activated_by=NULL WHERE id=?").run(LIST_DRAFT);
    db.prepare('DELETE FROM sales_price_list_versions WHERE entry_id=? AND version>1').run(ENTRY_DRAFT);
    const [append, activate] = await Promise.all([
      resolver.run({ action: 'append-price-version', listId: LIST_DRAFT, entryId: ENTRY_DRAFT, body: { unitPriceCents: 350 } }),
      writer.run({ action: 'activate-price-list', listId: LIST_DRAFT, key: `w2-activate-${randomUUID()}` }),
    ]);
    assert.equal(activate.status, 200, JSON.stringify(activate));
    assert.ok([201, 409].includes(append.status), JSON.stringify(append));
    const versions = db.prepare('SELECT version,unit_price_cents FROM sales_price_list_versions WHERE entry_id=? ORDER BY version').all(ENTRY_DRAFT);
    if (append.status === 201) assert.deepEqual(versions.map((row) => [Number(row.version), Number(row.unit_price_cents)]), [[1, 300], [2, 350]]);
    else {
      assert.equal(append.code, 'ACTIVE_CONFIGURATION_IMMUTABLE');
      assert.deepEqual(versions.map((row) => [Number(row.version), Number(row.unit_price_cents)]), [[1, 300]]);
    }
    const resolved = await resolver.run({ action: 'resolve-price', body: resolverBody({ explicitPriceListIds: [LIST_DRAFT] }) });
    assert.equal(resolved.status, 200, JSON.stringify(resolved));
    assert.equal(resolved.body.pricing.resolvedPriceCents, append.status === 201 ? 350 : 300);
  });

  test('R-W2-04 competing activation and retirement serialize to a valid terminal state with atomic audit', async () => {
    db.prepare("UPDATE sales_price_lists SET status='DRAFT',activated_at=NULL,activated_by=NULL,retired_at=NULL,retired_by=NULL WHERE id=?").run(LIST_DRAFT);
    const auditBefore = Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PRICE_LIST' AND entity_id=?").get(LIST_DRAFT).n);
    const [activation, retirement] = await Promise.all([
      resolver.run({ action: 'activate-price-list', listId: LIST_DRAFT, key: `w2-compete-activate-${randomUUID()}` }),
      writer.run({ action: 'retire-price-list', listId: LIST_DRAFT, key: `w2-compete-retire-${randomUUID()}` }),
    ]);
    assert.equal(activation.status, 200, JSON.stringify(activation));
    assert.ok([200, 409].includes(retirement.status), JSON.stringify(retirement));
    if (retirement.status === 409) assert.equal(retirement.code, 'INVALID_LIFECYCLE');
    const expectedStatus = retirement.status === 200 ? 'RETIRED' : 'ACTIVE';
    assert.equal(db.prepare('SELECT status FROM sales_price_lists WHERE id=?').get(LIST_DRAFT).status, expectedStatus);
    const auditAfter = Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_PRICE_LIST' AND entity_id=?").get(LIST_DRAFT).n);
    assert.equal(auditAfter - auditBefore, retirement.status === 200 ? 2 : 1);
  });

  test('R-W2-05 shared fallback is not a cycle, true cycles and duplicate roots remain rejected', async () => {
    const shared = await resolver.run({ action: 'resolve-price', body: resolverBody({ materialId: PRODUCT_2, explicitPriceListIds: [LIST_A, LIST_B] }) });
    assert.equal(shared.status, 409);
    assert.equal(shared.code, 'PRICE_NOT_CONFIGURED');
    const duplicate = await resolver.run({ action: 'resolve-price', body: resolverBody({ explicitPriceListIds: [LIST_A, LIST_A] }) });
    assert.equal(duplicate.status, 422);
    assert.equal(duplicate.code, 'DUPLICATE_ROOT');
    db.prepare('UPDATE sales_price_lists SET fallback_price_list_id=? WHERE id=?').run(LIST_A, LIST_OLD);
    const cycle = await resolver.run({ action: 'resolve-price', body: resolverBody({ materialId: PRODUCT_2, explicitPriceListIds: [LIST_A] }) });
    assert.equal(cycle.status, 409);
    assert.equal(cycle.code, 'FALLBACK_CYCLE');
    db.prepare('UPDATE sales_price_lists SET fallback_price_list_id=NULL WHERE id=?').run(LIST_OLD);
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM mysql_transaction_gates WHERE gate_id=1').get().n), 1);
  });

  test('R-SAL-11 order approval and pricing retirement preserve the immutable SO snapshot', async () => {
    db.prepare("UPDATE sales_orders SET status='SUBMITTED',reviewer_id=NULL,reviewed_at=NULL WHERE id=?").run(ORDER);
    const before = db.prepare('SELECT price_snapshot_json,discount_snapshot_json FROM sales_order_items WHERE id=?').get(ORDER_LINE);
    const [approval, retirement] = await Promise.all([
      resolver.run({ action: 'approve-sales-order', orderId: ORDER, key: `r-sal-11-approve-${randomUUID()}` }),
      writer.run({ action: 'retire-price-list', listId: LIST_OLD, key: `r-sal-11-retire-${randomUUID()}` }),
    ]);
    assert.equal(approval.status, 200, JSON.stringify(approval));
    assert.equal(retirement.status, 200, JSON.stringify(retirement));
    assert.equal(db.prepare('SELECT status FROM sales_orders WHERE id=?').get(ORDER).status, 'APPROVED');
    assert.deepEqual(db.prepare('SELECT price_snapshot_json,discount_snapshot_json FROM sales_order_items WHERE id=?').get(ORDER_LINE), before);
  });
});
