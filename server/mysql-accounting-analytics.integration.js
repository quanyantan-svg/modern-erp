// Accounting & Analytics 域 —— 真实 MySQL 8 验收套件（受保护 campaign 子进程）。
//
// Requirement: docs/requirements/accounting-analytics.md §35.8.1 第 6 项
// Design:    docs/design/accounting-analytics.md §31.8 / §31.13
//
// 本套件只在受保护的 disposable MySQL 目标上运行，且只在 ACK-4 capability 被
// 消费之后启动。它证明两件事：
//
//   1. **Parity**：本域 45 张新表与 AA-W5 的加列，在真实 MySQL 8 目录中的结构
//      （列、UNIQUE、CHECK）与 canonical SQLite 快照一致 —— 用生产比较器
//      `assertM1CoreInformationSchemaParity` 判定，不另写一份比较逻辑。
//   2. **Behaviour / Concurrency**：本域的权威写入路径与并发边界在真实 MySQL 上
//      成立：两个独立应用进程共享同一个 MySQL 数据库，并发请求后的权威事实由
//      第三个进程直接从 MySQL 读取判定。
//
// 它**不**连接生产或开发数据库，**不**在 MySQL 之外写任何权威事实。

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createDatabase as createSqliteDatabase } from './db.js';
import { captureSqliteSnapshot } from './database/mysql-schema.js';
import { assertM1CoreInformationSchemaParity } from './test-utils/m1-core-schema-parity.js';
import { openM1CoreG07ExistingAdapter } from './test-utils/m1-core-g07-existing-adapter.js';
import { consumePortableChildLease } from '../scripts/gates/ack4/ack4-runtime.mjs';

// The depreciation policy books the **cumulative** amount through the run
// period minus what is already booked, so the first run must be in the asset's
// own purchase month; a later month books the catch-up too.
const PERIOD = '2027-02';
const RECEIPT_DATE = '2027-02-15';
const FIXTURE_BUSINESS_DATE = '2027-02-20';
const RECEIPT_AMOUNT_CENTS = 120000;

// 本域七个 migration 声明的 45 张新表，加上 AA-W5 加列的两张既有表。
const AA_PARITY_TABLES = Object.freeze([
  'accounting_close_check_snapshots', 'accounting_event_attempts', 'accounting_events',
  'accounting_generation_runs', 'accounting_reconciliation_items', 'accounting_reconciliation_runs',
  'accounting_rule_bindings', 'accounting_scopes', 'allocation_results', 'allocation_rules',
  'asset_change_requests', 'asset_depreciation_runs', 'asset_disposals', 'asset_loans',
  'asset_locations', 'asset_split_merge_records', 'asset_stocktake_items', 'asset_stocktakes',
  'asset_types', 'cost_adjustments', 'cost_collection_plans', 'depreciation_policies',
  'internal_settlement_prices', 'internal_settlements', 'management_books',
  'operating_ledger_entries', 'operating_period_closures', 'period_end_definitions',
  'period_end_runs', 'product_costing_profiles', 'production_cost_closings', 'profit_centers',
  'profit_transfer_runs', 'provisional_receipt_adjustments', 'provisional_receipts',
  'purchase_expense_allocation_rules', 'purchase_expense_allocations', 'purchase_expenses',
  'report_instance_values', 'report_instances', 'report_template_items',
  'report_template_permissions', 'report_templates', 'voucher_corrections', 'voucher_template_items',
  'fixed_assets', 'asset_depreciations',
]);

function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`AA_MYSQL_BLOCKED:${name}_REQUIRED`);
  return value;
}

async function httpRequest(baseUrl, { method, path, token, body }) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

/** Fire two requests at the two application processes at the same time. */
async function race(applicationA, applicationB, requestA, requestB) {
  const [a, b] = await Promise.all([
    httpRequest(applicationA, requestA),
    httpRequest(applicationB, requestB),
  ]);
  return { a, b };
}

function seedReceipt(db, { receiptId, itemId, amountCents = RECEIPT_AMOUNT_CENTS }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
     VALUES(?,?,NULL,'supplier-001','warehouse-001','user-warehouse',?,'CONFIRMED',?,'','user-warehouse',?,?,?,?)`,
  ).run(receiptId, `RCPT-${receiptId}`, amountCents, RECEIPT_DATE, now, now, now, 'user-warehouse');
  db.prepare(
    `INSERT OR REPLACE INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
     VALUES(?,?,'product-001',1,?,?,1)`,
  ).run(itemId, receiptId, amountCents, amountCents);
  return { receiptId, itemId };
}

/**
 * Write one POSTED voucher as the fact basis of the report and collection
 * assertions. The report reads by business date, so the fixture carries a
 * business date inside the report period.
 */
function seedPostedVoucher(db, { id, subjectCode = '1403', debitCents = 50000, counterSubjectCode = '2202' }) {
  const now = new Date().toISOString();
  const subject = db.prepare('SELECT id FROM accounting_subjects WHERE code=?').get(subjectCode);
  assert.ok(subject, `会计科目 ${subjectCode} 必须存在`);
  const counter = db.prepare('SELECT id FROM accounting_subjects WHERE code=?').get(counterSubjectCode);
  assert.ok(counter, `对方科目 ${counterSubjectCode} 必须存在`);
  db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,business_date,remark,creator_id,created_at,updated_at,status,voucher_origin,period)
    VALUES(?,?,'AA_MYSQL_FIXTURE',?,?,?,'AA MySQL fixture','user-accounting',?,?,'POSTED','MANUAL',?)`)
    .run(id, 'V-' + id, id, FIXTURE_BUSINESS_DATE, FIXTURE_BUSINESS_DATE, now, now, PERIOD);
  db.prepare('INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,line_no) VALUES(?,?,?,?,?,?,?)')
    .run(`${id}-e1`, id, subject.id, 'DEBIT', debitCents, 'AA MySQL fixture', 1);
  db.prepare('INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,line_no) VALUES(?,?,?,?,?,?,?)')
    .run(`${id}-e2`, id, counter.id, 'CREDIT', debitCents, 'AA MySQL fixture', 2);
}

function subjectBalance(db, code, period) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n
     FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id
     JOIN accounting_subjects s ON s.id=e.subject_id
     WHERE s.code=? AND v.status='POSTED' AND v.period=?`,
  ).get(code, period);
  return Number(row.n);
}

describe('Accounting & Analytics — 真实 MySQL 8 域级验收', () => {
  let db;
  let fixture;
  let applications;
  let subjectTokens;

  before(() => {
    const targetProofPath = requiredEnvironment('ERP_AA_MYSQL_TARGET_PROOF');
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
    consumePortableChildLease({
      leasePath: requiredEnvironment('ERP_AA_MYSQL_ACK4_CHILD_LEASE'),
      consumedDir: resolve(requiredEnvironment('ERP_AA_MYSQL_ACK4_CHILD_CONSUMED_DIR')),
      rootPublicKey: requiredEnvironment('ERP_AA_MYSQL_ACK4_ROOT_PUBLIC_KEY'),
      expected: {
        rootPid: process.ppid, childPid: process.pid,
        childStartedAt: requiredEnvironment('ERP_AA_MYSQL_CHILD_STARTED_AT'),
        commitSha, target: JSON.parse(readFileSync(targetProofPath, 'utf8')),
        manifest: 'ACCOUNTING_ANALYTICS_MYSQL_V1', operation: 'RUN_AA_HTTP_FIXTURES',
      },
    });
    delete process.env.ERP_AA_MYSQL_ACK4_ROOT_PUBLIC_KEY;
    if (process.env.ERP_DB_BACKEND !== 'mysql' || process.env.ERP_TEST_DB_BACKEND !== 'mysql') {
      throw new Error('AA_MYSQL_BLOCKED:MYSQL_BACKEND_REQUIRED');
    }
    const parsed = JSON.parse(readFileSync(requiredEnvironment('ERP_AA_MYSQL_FIXTURE_PATH'), 'utf8'));
    applications = parsed.applications;
    subjectTokens = parsed.subjectTokens;
    db = openM1CoreG07ExistingAdapter({ targetProofPath }).db;
    assert.equal(db.dialect, 'mysql');
    fixture = {
      request: (method, path, token, body) => httpRequest(applications.A, { method, path, token, body }),
    };
  });

  after(() => db?.close());

  test('AA 域 47 张表在真实 MySQL 8 目录上与 canonical SQLite 结构一致', async () => {
    const snapshot = captureSqliteSnapshot((path) => createSqliteDatabase(path), false);
    // ASCII-only observation of the live catalogue default, so the evidence
    // survives a lossy diagnostic writer.
    const observed = db.prepare("SELECT COLUMN_DEFAULT d,EXTRA e FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='fixed_assets' AND COLUMN_NAME='unit'").get();
    const observedText = String(observed?.d ?? '');
    const sqliteUnit = snapshot.tables.find((t) => t.name === 'fixed_assets').columns.find((c) => c.name === 'unit');
    console.log('AA_PARITY_RAW_MYSQL_DEFAULT', JSON.stringify(observedText), [...observedText].map((c) => c.codePointAt(0).toString(16)).join(' '));
    console.log('AA_PARITY_RAW_SQLITE_DEFAULT', JSON.stringify(String(sqliteUnit?.dflt_value ?? '')), [...String(sqliteUnit?.dflt_value ?? '')].map((c) => c.codePointAt(0).toString(16)).join(' '));
    console.log('AA_PARITY_MYSQL_EXTRA', JSON.stringify(String(observed?.e ?? '')));
    const { readMySqlInformationSchemaContract } = await import('./test-utils/m1-core-schema-parity.js');
    const contract = readMySqlInformationSchemaContract(db, 'fixed_assets');
    const contractUnit = contract.columns.find((item) => item.column_name === 'unit');
    const contractText = String(contractUnit?.column_default ?? '');
    console.log('AA_PARITY_CONTRACT_DEFAULT', JSON.stringify(contractText), [...contractText].map((c) => c.codePointAt(0).toString(16)).join(' '));
    const literalQuery = db.prepare("SELECT COLUMN_DEFAULT column_default FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='fixed_assets' AND COLUMN_NAME='unit'").get();
    const literalText = String(literalQuery?.column_default ?? '');
    console.log('AA_PARITY_LITERAL_DEFAULT', JSON.stringify(literalText), [...literalText].map((c) => c.codePointAt(0).toString(16)).join(' '));
    const result = assertM1CoreInformationSchemaParity(db, snapshot, AA_PARITY_TABLES);
    assert.equal(result.source, 'information_schema');
    assert.equal(result.status, 'MATCHED');
    assert.equal(result.tables.length, AA_PARITY_TABLES.length);
  });

  test('AA-W5 折旧按政策自动计提并在真实 MySQL 上生成可对账凭证', async () => {
    const receiptId = 'aa-my-receipt-1';
    const itemId = 'aa-my-receipt-item-1';
    seedReceipt(db, { receiptId, itemId });

    const type = await fixture.request('POST', '/api/fixed-asset-types', subjectTokens.accounting, { code: 'AA-EQ', name: '设备' });
    assert.equal(type.status, 201, JSON.stringify(type.data));
    const location = await fixture.request('POST', '/api/fixed-asset-locations', subjectTokens.accounting, { code: 'AA-WH', name: 'A 厂房' });
    assert.equal(location.status, 201, JSON.stringify(location.data));
    const policy = await fixture.request('POST', '/api/depreciation-policies', subjectTokens.accounting, {
      code: 'AA-POL', name: '直线折旧政策', method: 'STRAIGHT_LINE',
      useful_life_months: 60, residual_rate_bp: 0, start_rule: 'FROM_PURCHASE',
    });
    assert.equal(policy.status, 201, JSON.stringify(policy.data));

    const card = await fixture.request('POST', '/api/fixed-assets/transfer', subjectTokens.accounting, {
      receipt_id: receiptId,
      lines: [{ item_id: itemId, asset_code: 'FA-AA-MY-001', asset_name: '真实 MySQL 测试设备', policy_id: policy.data.id }],
    });
    assert.equal(card.status, 201, JSON.stringify(card.data));
    const assetId = card.data.assets[0].id;

    const monthly = Math.floor(RECEIPT_AMOUNT_CENTS / 60);
    const run = await fixture.request('POST', '/api/fixed-assets/depreciation', subjectTokens.accounting, { period: PERIOD });
    assert.equal(run.status, 201, JSON.stringify(run.data));
    assert.equal(Number(run.data.run.total_cents), monthly);

    // The authoritative facts are read from the real MySQL server, not from the
    // process that issued the request.
    const assetRow = db.prepare('SELECT accumulated_depreciation_cents,net_value_cents,book_value_cents FROM fixed_assets WHERE id=?').get(assetId);
    assert.equal(Number(assetRow.accumulated_depreciation_cents), monthly);
    assert.equal(Number(assetRow.net_value_cents), RECEIPT_AMOUNT_CENTS - monthly);
    assert.equal(subjectBalance(db, '6602', PERIOD), monthly);
    assert.equal(subjectBalance(db, '1602', PERIOD), -monthly);
    const voucher = db.prepare("SELECT * FROM accounting_vouchers WHERE source_type='FIXED_ASSET_DEPRECIATION_RUN' AND source_id=?").get(run.data.id);
    assert.ok(voucher, '折旧必须生成系统凭证');
    assert.equal(voucher.status, 'POSTED');

    // Idempotency on real MySQL: the same period must not book twice.
    const again = await fixture.request('POST', '/api/fixed-assets/depreciation', subjectTokens.accounting, { period: PERIOD });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM asset_depreciations WHERE asset_id=?').get(assetId).n), 1);
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type=?').get('FIXED_ASSET_DEPRECIATION_RUN').n), 1);
  });

  test('AA-W1 会计科目在真实 MySQL 上可维护且编码唯一', async () => {
    const code = 'AA-MY-SUBJECT-1';
    const created = await fixture.request('POST', '/api/accounting/subjects', subjectTokens.accounting, {
      code, name: '真实 MySQL 科目', type: 'EXPENSE', direction: 'DEBIT',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const row = db.prepare('SELECT code,name,type,direction,active FROM accounting_subjects WHERE id=?').get(created.data.id);
    assert.ok(row, '科目必须落在真实 MySQL 上');
    assert.equal(row.code, code);
    assert.equal(Number(row.active), 1);

    const duplicated = await fixture.request('POST', '/api/accounting/subjects', subjectTokens.accounting, {
      code, name: '重复编码', type: 'EXPENSE', direction: 'DEBIT',
    });
    assert.equal(duplicated.status, 409, JSON.stringify(duplicated.data));
    assert.equal(duplicated.data.code, 'ACCOUNTING_SUBJECT_CODE_EXISTS');
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM accounting_subjects WHERE code=?').get(code).n), 1);

    const deactivated = await fixture.request('POST', `/api/accounting/subjects/${created.data.id}/deactivate`, subjectTokens.accounting, {});
    assert.equal(deactivated.status, 200, JSON.stringify(deactivated.data));
    assert.equal(Number(db.prepare('SELECT active FROM accounting_subjects WHERE id=?').get(created.data.id).active), 0);
  });

  test('AA-W1 对账快照在真实 MySQL 上留痕且可回看', async () => {
    const run = await fixture.request('POST', '/api/accounting/reconciliation/run', subjectTokens.accounting, { period: PERIOD });
    assert.equal(run.status, 200, JSON.stringify(run.data));
    const runs = db.prepare('SELECT * FROM accounting_reconciliation_runs WHERE period=?').all(PERIOD);
    assert.equal(runs.length, 1, '对账必须留下唯一快照');
    const items = db.prepare('SELECT * FROM accounting_reconciliation_items WHERE run_id=?').all(runs[0].id);
    assert.ok(items.length > 0, '对账快照必须留下逐项检查结果');
    for (const item of items) {
      assert.ok(['PASS', 'FAIL'].includes(item.status), `检查项状态非法：${item.status}`);
      assert.ok(String(item.check_code).length > 0);
    }
  });

  test('AA-W2 凭证模板与规则在真实 MySQL 上落库', async () => {
    const template = await fixture.request('POST', '/api/accounting/voucher-templates', subjectTokens.accounting, {
      templateCode: 'AA-MY-TPL', name: '真实 MySQL 模板',
      items: [
        { accountingRole: 'DEPRECIATION_EXPENSE', direction: 'DEBIT', amountSource: 'SOURCE_AMOUNT' },
        { accountingRole: 'ACCUMULATED_DEPRECIATION', direction: 'CREDIT', amountSource: 'SOURCE_AMOUNT' },
      ],
    });
    assert.equal(template.status, 201, JSON.stringify(template.data));
    const templateRow = db.prepare('SELECT template_code,status FROM voucher_templates WHERE id=?').get(template.data.id);
    assert.equal(templateRow.template_code, 'AA-MY-TPL');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM voucher_template_items WHERE template_id=?').get(template.data.id).n, 2);

    const rule = await fixture.request('POST', '/api/accounting/rules', subjectTokens.accounting, {
      sourceType: 'AA_MY_SOURCE', eventType: 'AA_MY_EVENT', templateId: template.data.id, validFrom: '2020-01-01',
    });
    assert.equal(rule.status, 201, JSON.stringify(rule.data));
    const ruleRow = db.prepare('SELECT source_type,event_type,template_id,status FROM accounting_rule_bindings WHERE id=?').get(rule.data.id);
    assert.equal(ruleRow.source_type, 'AA_MY_SOURCE');
    assert.equal(ruleRow.status, 'ACTIVE');
  });

  test('AA-W4 报表生命周期在真实 MySQL 上成立', async () => {
    seedPostedVoucher(db, { id: 'aa-my-report-voucher-1' });
    const template = await fixture.request('POST', '/api/accounting/report-templates', subjectTokens.accounting, {
      templateCode: 'AA-MY-RPT', name: '真实 MySQL 报表',
      items: [{ itemCode: 'BAL', name: '期末余额', levelNo: 1, sortNo: 1, sourceKind: 'GL_BALANCE', sourceJson: { subjectCode: '1403', measure: 'CLOSING' } }],
    });
    assert.equal(template.status, 201, JSON.stringify(template.data));
    const templateId = template.data.reportTemplate.id;
    assert.ok(templateId, '报表模板必须返回 reportTemplate.id');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM report_template_items WHERE template_id=?').get(templateId).n, 1);

    const published = await fixture.request('POST', `/api/accounting/report-templates/${templateId}/publish`, subjectTokens.accounting, {});
    assert.equal(published.status, 200, JSON.stringify(published.data));
    assert.equal(db.prepare('SELECT status FROM report_templates WHERE id=?').get(templateId).status, 'PUBLISHED');

    const instance = await fixture.request('POST', '/api/accounting/report-instances', subjectTokens.accounting, { templateId, period: PERIOD });
    assert.equal(instance.status, 201, JSON.stringify(instance.data));
    const instanceId = instance.data.reportInstance.id;

    const computed = await fixture.request('POST', `/api/accounting/report-instances/${instanceId}/compute`, subjectTokens.accounting, {});
    assert.equal(computed.status, 200, JSON.stringify(computed.data));
    for (const table of ['report_templates', 'report_template_items', 'report_instances', 'report_instance_values']) {
      console.log('AA_REPORT_COUNT', table, Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n));
    }
    console.log('AA_REPORT_INSTANCE_ID', instanceId, 'TEMPLATE_ID', templateId);
    console.log('AA_REPORT_VALUES_FOR_INSTANCE', Number(db.prepare('SELECT COUNT(*) n FROM report_instance_values WHERE instance_id=?').get(instanceId).n));
    console.log('AA_REPORT_ITEMS_FOR_TEMPLATE', Number(db.prepare('SELECT COUNT(*) n FROM report_template_items WHERE template_id=?').get(templateId).n));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM report_instance_values WHERE instance_id=?').get(instanceId).n, 1);

    const submitted = await fixture.request('POST', `/api/accounting/report-instances/${instanceId}/submit`, subjectTokens.accounting, {});
    assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
    assert.equal(db.prepare('SELECT status FROM report_instances WHERE id=?').get(instanceId).status, 'SUBMITTED');

    // SOD: the submitter must not approve the same instance.
    const selfApprove = await fixture.request('POST', `/api/accounting/report-instances/${instanceId}/approve`, subjectTokens.accounting, { approved: true });
    assert.equal(selfApprove.status, 403, JSON.stringify(selfApprove.data));
    assert.equal(selfApprove.data.code, 'REPORT_INSTANCE_SOD_VIOLATION');
    assert.equal(db.prepare('SELECT status FROM report_instances WHERE id=?').get(instanceId).status, 'SUBMITTED');

    const approved = await fixture.request('POST', `/api/accounting/report-instances/${instanceId}/approve`, subjectTokens.admin, { approved: true });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(db.prepare('SELECT status FROM report_instances WHERE id=?').get(instanceId).status, 'APPROVED');
  });

  test('AA-W6 核算范围与暂估差异调整在真实 MySQL 上成立', async () => {
    const scope = await fixture.request('POST', '/api/accounting/scopes', subjectTokens.accounting, {
      code: 'AA-MY-SCOPE', name: '真实 MySQL 核算范围', orgScope: 'ORGANIZATION', ownerScope: 'NONE',
    });
    assert.equal(scope.status, 201, JSON.stringify(scope.data));
    assert.ok(db.prepare('SELECT * FROM accounting_scopes WHERE id=?').get(scope.data.accountingScope.id));

    const receiptId = 'aa-my-provisional-receipt-1';
    seedReceipt(db, { receiptId, itemId: 'aa-my-provisional-item-1', amountCents: 100000 });
    const provisional = await fixture.request('POST', '/api/accounting/provisional-receipts', subjectTokens.accounting, {
      sourceReceiptId: receiptId, estimateCents: 100000, basis: '供应商暂估单价',
    });
    assert.equal(provisional.status, 201, JSON.stringify(provisional.data));
    const provisionalId = provisional.data.provisionalReceipt.id;

    const adjusted = await fixture.request('POST', `/api/accounting/provisional-receipts/${provisionalId}/adjust`, subjectTokens.accounting, {
      finalCents: 120000, reason: '正式发票高于暂估',
    });
    assert.equal(adjusted.status, 200, JSON.stringify(adjusted.data));
    const adjustment = db.prepare('SELECT * FROM provisional_receipt_adjustments WHERE id=?').get(adjusted.data.adjustment.id);
    assert.ok(adjustment, '暂估差异调整必须落在真实 MySQL 上');
    assert.equal(Number(adjustment.difference_cents), 20000);
    assert.ok(adjustment.voucher_id, '暂估差异必须生成凭证');
    assert.equal(db.prepare("SELECT status FROM accounting_vouchers WHERE id=?").get(adjustment.voucher_id).status, 'POSTED');
    // The estimate must not be rewritten by the adjustment.
    assert.equal(Number(db.prepare('SELECT estimate_cents FROM provisional_receipts WHERE id=?').get(provisionalId).estimate_cents), 100000);
  });

  test('AA-W7 经营账簿与经营关账在真实 MySQL 上成立', async () => {
    const book = await fixture.request('POST', '/api/management/books', subjectTokens.accounting, {
      code: 'AA-MY-BOOK', name: '真实 MySQL 经营账簿', legalEntity: '测试法人',
    });
    assert.equal(book.status, 201, JSON.stringify(book.data));
    const bookId = book.data.managementBook.id;
    assert.ok(db.prepare('SELECT * FROM management_books WHERE id=?').get(bookId));

    const center = await fixture.request('POST', '/api/management/profit-centers', subjectTokens.accounting, {
      code: 'AA-MY-PC', name: '真实 MySQL 经营单元', managementBookId: bookId,
    });
    assert.equal(center.status, 201, JSON.stringify(center.data));
    assert.ok(db.prepare('SELECT * FROM profit_centers WHERE id=?').get(center.data.profitCenter.id));

    const collected = await fixture.request('POST', '/api/management/collect', subjectTokens.accounting, {
      managementBookId: bookId, period: PERIOD, source: { kind: 'GL', accountCode: '1403' },
    });
    assert.equal(collected.status, 201, JSON.stringify(collected.data));
    const ledger = db.prepare('SELECT * FROM operating_ledger_entries WHERE management_book_id=? AND period=?').all(bookId, PERIOD);
    assert.ok(Array.isArray(ledger));

    // AA-W7.11 — the operating period closure must refuse while the cost
    // allocation of the period is not complete. The refusal is the contract.
    const refused = await fixture.request('POST', '/api/management/period-closures', subjectTokens.accounting, { managementBookId: bookId, period: PERIOD });
    assert.equal(refused.status, 409, JSON.stringify(refused.data));
    assert.equal(refused.data.code, 'MANAGEMENT_ALLOCATION_INCOMPLETE');

    const rule = await fixture.request('POST', '/api/management/allocation-rules', subjectTokens.accounting, {
      code: 'AA-MY-RULE', name: '真实 MySQL 分摊规则', managementBookId: bookId, basisType: 'EQUAL',
      driver: { targets: [{ profitCenterId: center.data.profitCenter.id, weight: 100 }] },
    });
    assert.equal(rule.status, 201, JSON.stringify(rule.data));
    const allocated = await fixture.request('POST', '/api/management/allocation-runs', subjectTokens.accounting, {
      managementBookId: bookId, period: PERIOD, ruleId: rule.data.allocationRule.id,
    });
    assert.equal(allocated.status, 201, JSON.stringify(allocated.data));

    // AA-W7.12 — the legal accounting period must be closed first, so the
    // operating period closure is refused while it is still open.
    const closed = await fixture.request('POST', '/api/management/period-closures', subjectTokens.accounting, { managementBookId: bookId, period: PERIOD });
    assert.equal(closed.status, 409, JSON.stringify(closed.data));
    assert.equal(closed.data.code, 'MANAGEMENT_LEGAL_PERIOD_NOT_CLOSED');
    // A refused closure must leave no partial state behind.
    const closure = db.prepare('SELECT * FROM operating_period_closures WHERE management_book_id=? AND period=?').get(bookId, PERIOD);
    assert.equal(closure, undefined, '被拒绝的经营关账不得留下关账记录');
  });

  test('AA-W1.15 并发创建同一科目在真实 MySQL 上只落一条', async () => {
    const code = 'AA-MY-RACE-SUBJECT';
    const body = { code, name: '并发科目', type: 'EXPENSE', direction: 'DEBIT' };
    const { a, b } = await race(
      applications.A, applications.B,
      { method: 'POST', path: '/api/accounting/subjects', token: subjectTokens.accounting, body },
      { method: 'POST', path: '/api/accounting/subjects', token: subjectTokens.accounting, body },
    );
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409], `并发创建必须一个成功一个拒绝，实际 ${JSON.stringify(statuses)} A=${JSON.stringify(a.data)} B=${JSON.stringify(b.data)}`);
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM accounting_subjects WHERE code=?').get(code).n), 1,
      '真实 MySQL 的 UNIQUE 约束必须保证只落一条');
  });

  test('AA-W2 并发创建同一模板在真实 MySQL 上只落一条', async () => {
    const templateCode = 'AA-MY-RACE-TPL';
    const body = {
      templateCode, name: '并发模板',
      items: [{ accountingRole: 'DEPRECIATION_EXPENSE', direction: 'DEBIT', amountSource: 'SOURCE_AMOUNT' }],
    };
    const { a, b } = await race(
      applications.A, applications.B,
      { method: 'POST', path: '/api/accounting/voucher-templates', token: subjectTokens.accounting, body },
      { method: 'POST', path: '/api/accounting/voucher-templates', token: subjectTokens.accounting, body },
    );
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409], `并发创建必须一个成功一个拒绝，实际 ${JSON.stringify(statuses)} A=${JSON.stringify(a.data)} B=${JSON.stringify(b.data)}`);
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM voucher_templates WHERE template_code=?').get(templateCode).n), 1);
  });

  test('AA-W6 并发建立同一核算范围在真实 MySQL 上只落一条', async () => {
    const code = 'AA-MY-RACE-SCOPE';
    const body = { code, name: '并发核算范围', orgScope: 'ORGANIZATION', ownerScope: 'NONE' };
    const { a, b } = await race(
      applications.A, applications.B,
      { method: 'POST', path: '/api/accounting/scopes', token: subjectTokens.accounting, body },
      { method: 'POST', path: '/api/accounting/scopes', token: subjectTokens.accounting, body },
    );
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 409], `并发建立必须一个成功一个拒绝，实际 ${JSON.stringify(statuses)} A=${JSON.stringify(a.data)} B=${JSON.stringify(b.data)}`);
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM accounting_scopes WHERE code=?').get(code).n), 1);
  });

  test('本域全部金额列在真实 MySQL 上是安全整数分', () => {
    const unsafe = [];
    for (const table of AA_PARITY_TABLES) {
      const columns = db.prepare(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME LIKE '%\\_cents'",
      ).all(table);
      for (const column of columns) {
        const rows = db.prepare(`SELECT \`${column.COLUMN_NAME}\` v FROM \`${table}\` WHERE \`${column.COLUMN_NAME}\` IS NOT NULL`).all();
        for (const row of rows) {
          const value = Number(row.v);
          if (!Number.isSafeInteger(value)) unsafe.push(`${table}.${column.COLUMN_NAME}=${row.v}`);
        }
      }
    }
    assert.deepEqual(unsafe, [], '金额列必须是安全整数分');
  });
});
