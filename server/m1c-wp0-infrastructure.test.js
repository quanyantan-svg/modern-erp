import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const schema = read('server/migrations/procurement-outsourcing-schema.js');
const dbSource = read('server/db.js');
const v13 = read('server/migrations/v13-phase1-contracts.js');
const inventoryMutation = read('server/lib/inventory-mutation.js');
const mysqlSchema = read('server/database/mysql-schema.js');
const mysqlAdapter = read('server/database/mysql-adapter.js');
const glPolicy = read('server/modules/outsourcing-gl-policy.js');
const outsourcingFinance = read('server/modules/outsourcing-finance.js');
const commercialGolive = read('server/modules/commercial-golive.js');

function stripComments(source) {
  return source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
}

test('M1C-WP-0 registers only the approved new inventory source literals', () => {
  assert.match(inventoryMutation, /'OUTSOURCING_SUPPLEMENT'/);
  assert.match(inventoryMutation, /'OUTSOURCING_BACKFLUSH'/);
  assert.match(inventoryMutation, /const SOURCE_TYPES = new Set/);
});

test('M1C-WP-0 additive schema covers M-01 through M-07 without history backfill or M-15', () => {
  for (const table of [
    'receipt_notice_item_sources',
    'schedule_consumption_effects',
    'outsourcing_wip_identity_effects',
    'outsourcing_wip_identity_effect_allocations',
    'outsourcing_wip_identity_balances',
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`));
  }

  assert.match(schema, /converted_quantity REAL,/,
    'converted_quantity must remain nullable with no DEFAULT 0');
  assert.doesNotMatch(schema, /converted_quantity REAL NOT NULL|converted_quantity REAL[^\n]*DEFAULT\s+0/);
  assert.match(schema, /legacy_unverified_wip_quantity REAL'/,
    'legacy WIP evidence column must remain nullable');
  assert.doesNotMatch(schema, /legacy_unverified_wip_quantity[^\n]*DEFAULT\s+0/);
  assert.match(schema, /UNIQUE\(business_event_type, business_event_id, business_event_item_id, reverses_effect_key\)/);
  assert.match(schema, /PRIMARY KEY\(material_list_id, identity_key\)/);

  assert.doesNotMatch(schema, /UPDATE\s+receipt_notice_item_sources/i);
  assert.doesNotMatch(schema, /UPDATE\s+outsourcing_material_list\s+SET\s+legacy_unverified_wip_quantity/i);
  assert.doesNotMatch(schema, /tracked_inventory_movements[^\n]*identity_key/i,
    'M-15 is separately authorized and must not enter WP-0');
});

test('M1C-WP-0 columns preserve unknown historical facts and approved defaults', () => {
  const required = [
    "'purchase_receipts', 'source_notice_id', 'source_notice_id TEXT'",
    "'purchase_receipt_items', 'source_notice_item_source_id', 'source_notice_item_source_id TEXT'",
    "'purchase_receipt_items', 'delivery_schedule_id', 'delivery_schedule_id TEXT'",
    "'outsourcing_receipts', 'warehouse_id', 'warehouse_id TEXT'",
    "'outsourcing_receipts', 'source_notice_id', 'source_notice_id TEXT'",
    "'outsourcing_receipts', 'business_date', 'business_date TEXT'",
    "'outsourcing_receipts', 'version', 'version INTEGER NOT NULL DEFAULT 0'",
    "'outsourcing_receipt_items', 'unit_code', \"unit_code TEXT NOT NULL DEFAULT 'EA'\"",
    "'outsourcing_material_list', 'source_warehouse_id', 'source_warehouse_id TEXT'",
    "'outsourcing_material_list', 'legacy_unverified_wip_quantity', 'legacy_unverified_wip_quantity REAL'",
    "'outsourcing_material_list', 'identity_evidence_state', \"identity_evidence_state TEXT NOT NULL DEFAULT 'NONE'\"",
  ];
  for (const contract of required) assert.ok(schema.includes(contract), `missing ${contract}`);
});

test('M1-P-03 grant matrix keeps only the approved role-accounting permission in WP-0', () => {
  assert.match(dbSource, /\['SUPPLIER_BILL_MANAGE', '管理供应商账单正式过账'\]/);
  assert.match(dbSource, /'role-accounting': \[[^\]]*'SUPPLIER_BILL_MANAGE'/);
  assert.match(v13, /'role-accounting':[\s\S]*?'SUPPLIER_BILL_MANAGE'/);

  const accountingSeed = dbSource.match(/'role-accounting': \[([^\]]+)\]/)?.[1] || '';
  assert.doesNotMatch(accountingSeed, /OUTSOURCING_MANAGE|OUTSOURCING_RECEIVING_MANAGE|OUTSOURCING_MATERIAL_EXECUTE|IQC_MANAGE/,
    'role-accounting must not hold outsourcing execution or receiving rights');

  // Active Design §2.3 assigns the 委外收货员 creation to M1C-WP-2 and §8.1.3
  // marks both outsourcing technical IDs as pending role definitions, so
  // M1C-WP0-R1 removed them from the WP-0 seed.
  for (const role of ['role-outsourcing', 'role-outsourcing-receiving']) {
    assert.equal(dbSource.includes(`'${role}'`), false, `${role} must not be seeded by M1C-WP-0`);
    assert.equal(v13.includes(`'${role}'`), false, `${role} must not enter the V13 desired permission set`);
  }
});

test('WP-0 retains canonical transaction and lock-order guards for later writers', () => {
  assert.match(dbSource, /SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE/);
  assert.match(inventoryMutation, /\.map\(\(p\) => p\.positionKey\)\)\]\.sort\(\)/);
  assert.match(inventoryMutation, /ORDER BY position_key ASC/);
});

test('WP-0 schema remains on the canonical SQLite snapshot to MySQL reconciliation path', () => {
  assert.match(mysqlAdapter, /captureSqliteSnapshot\(createSqliteSnapshot, seedDemo\)/);
  assert.match(mysqlAdapter, /bootstrapMySql\(adapter, snapshot\)/);
  assert.match(mysqlSchema, /planMySqlAdditiveReconciliation\(snapshot,/);
  assert.match(mysqlSchema, /for \(const check of extractChecks\(table\.sql\)\) definitions\.push\(`CHECK/);
});

test('R1-A 来源级 Guard 判定依据必须是账单行的商业来源而非路由或表头', () => {
  assert.match(glPolicy, /export const OUTSOURCING_GL_POLICY_CODE = 'OUTSOURCING_GL_POLICY_NOT_APPROVED'/);
  assert.match(glPolicy, /supplier_bill_items WHERE bill_id=\? AND commercial_source_type=\?/);
  assert.match(glPolicy, /'OUTSOURCING_RECEIPT_ITEM'/);
  assert.doesNotMatch(stripComments(glPolicy), /supplier_bills\.commercial_source_type/,
    '判定不得依赖恒为 NULL 的账单表头来源列');
  assert.match(stripComments(glPolicy), /'REJECT'/);
  assert.match(stripComments(glPolicy), /'SUPPLIER_BILL'/);
});

test('R1-A 全部正式过账与匹配入口都必须调用同一个来源级 Guard', () => {
  assert.match(outsourcingFinance, /assertSupplierBillGlPostable\(\s*db,\s*billId,\s*actor\.id,\s*'POST_PROCESSING_FEE_BILL'\s*\)/);
  assert.match(commercialGolive, /assertSupplierBillGlPostable\(\s*db,\s*billId,\s*actorId,\s*'POST_SUPPLIER_BILL'\s*\)/);
  assert.match(commercialGolive, /assertSupplierBillGlPostable\(\s*db,\s*billId,\s*actorId,\s*'MATCH_SUPPLIER_BILL'\s*\)/);
  assert.match(commercialGolive, /matchSupplierBill\(\s*db,\s*match\[1\],\s*await readJson\(req\),\s*actor\.id\s*\)/,
    '共享匹配入口必须把操作人传给来源级 Guard');
});

test('R1-A 加工费正式过账只认 SUPPLIER_BILL_MANAGE，草稿创建权限语义不变', () => {
  assert.match(outsourcingFinance, /const POSTING_PERMISSIONS = \['SUPPLIER_BILL_MANAGE'\]/);
  assert.match(outsourcingFinance, /const FINANCE_PERMISSIONS = \['SUPPLIER_BILL_MANAGE', 'OUTSOURCING_MANAGE'\]/);
  assert.match(outsourcingFinance, /export async function createProcessingFeeBill\(db, req, res, actor\) \{\s*assertFinancePermission\(actor\);/,
    '草稿创建必须保留原定权限语义');
  assert.match(outsourcingFinance, /export async function postProcessingFeeBill\(db, req, res, actor, billId\) \{\s*assertPostingPermission\(actor\);/,
    '正式过账必须先做只认 SUPPLIER_BILL_MANAGE 的权限检查');
});

test('R1-B 收货生效只认 OUTSOURCING_RECEIVING_MANAGE，其他动作未被误伤', () => {
  assert.match(outsourcingFinance, /const RECEIVE_EFFECT_PERMISSIONS = \['OUTSOURCING_RECEIVING_MANAGE'\]/);
  assert.match(outsourcingFinance, /export async function confirmOutsourcingReceipt\(db, req, res, actor, receiptId\) \{\s*assertReceiveEffectPermission\(actor\);/);
  assert.match(outsourcingFinance, /const RECEIVE_PERMISSIONS = \['OUTSOURCING_RECEIVING_MANAGE', 'OUTSOURCING_MANAGE'\]/,
    '收货录入等其他动作的权限语义不得被 R1-B 改变');
  assert.match(outsourcingFinance, /const MATERIAL_PERMISSIONS = \['OUTSOURCING_MATERIAL_EXECUTE', 'OUTSOURCING_MANAGE'\]/,
    '委外材料执行权限不得被 R1-B 改变');
});
