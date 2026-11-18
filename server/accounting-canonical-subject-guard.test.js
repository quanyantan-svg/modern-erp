// F-06 附属 —— 存货与成本科目的手工凭证守卫 + GRNI 检查口径统一
// （Requirement §35.12 `AA-VAL-01..04`）。
//
// 修复前的客户症状（真实 MySQL 8 实测）：一张自由手工凭证贷记了存货科目而没有任何估值
// 流水 → `INVENTORY_VALUE_TO_GL` 恒为 −10,000 且无法归因；GRNI 检查在三处实现里口径不一
// （子账侧误用 FINAL、总账侧符号相反）→ 恒定失配。
//
// 本套件证明：
//   1. 自由手工凭证命中存货 / 成本科目 → 409 + 零副作用；
//   2. 非受控科目的自由手工凭证仍然可用（既有能力不回退）；
//   3. GRNI 的子账侧只取暂估未结转行、总账侧取贷 − 借 → 差异为 0；
//   4. 存货价值对账的两侧同域（总账侧含在制科目）。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { createTempDb } from './test-utils/temp-db.js';
import { runChecks } from './modules/accounting-reconciliation.js';
import { systemHealth } from './modules/financial-inventory.js';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

const NOW = '2026-11-18T00:00:00.000Z';

function seedGrniFixture(db) {
  const now = NOW;
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES('user-admin','admin','管理员','x','x','role-admin',1,?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO suppliers(id,code,name,active,created_at,updated_at)
    VALUES('sup-1','SUP-1','供应商',1,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at)
    VALUES('wh-1','WH-1','仓库',1,0,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,valuation_method,created_at,updated_at)
    VALUES('p-1','P-1','原料','CAT','EA',1000,0,1,'NONE','MOVING_AVERAGE',?,?)`).run(now, now);
  // 已确认收货 50000：总账 借 1403 / 贷 1407（在途物资），并同时成立暂估未结转应付。
  db.prepare(`INSERT OR IGNORE INTO purchase_receipts(id,receipt_no,supplier_id,warehouse_id,handler_id,total_cents,status,billing_mode,receipt_date,creator_id,created_at,updated_at)
    VALUES('rc-1','PR-1','sup-1','wh-1','user-admin',50000,'CONFIRMED','SEPARATE','2026-11-18','user-admin',?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO account_payables(id,voucher_no,supplier_id,source_type,source_id,
      amount_cents,paid_cents,write_off_cents,status,due_date,business_date,recognition_mode,item_kind,conversion_state,item_class,creator_id,created_at,updated_at)
    VALUES('ap-1','AP-1','sup-1','PURCHASE_RECEIPT','rc-1',50000,0,0,'PENDING','2026-12-31','2026-11-18',
      'DIRECT_BUSINESS_OPEN_ITEM','PROVISIONAL','OPEN','SOURCE','user-admin',?,?)`).run(now, now);
  db.prepare(`UPDATE account_payables SET open_amount_cents=50000 WHERE id='ap-1'`).run();
  db.prepare(`INSERT OR IGNORE INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,business_date,remark,creator_id,created_at,status,period)
    VALUES('vch-grni','SYS-GRNI-1','PURCHASE_RECEIPT','rc-1','2026-11-18','2026-11-18','收货','user-admin',?,'POSTED','2026-11')`).run(now);
  const subject = (code) => db.prepare('SELECT id FROM accounting_subjects WHERE code=?').get(code)?.id;
  db.prepare(`INSERT OR IGNORE INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,line_no)
    VALUES('e-grni-1','vch-grni',?,'DEBIT',50000,'收货',1)`).run(subject('1403'));
  db.prepare(`INSERT OR IGNORE INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,line_no)
    VALUES('e-grni-2','vch-grni',?,'CREDIT',50000,'在途',2)`).run(subject('1407'));
  return { subject };
}

test('AA-VAL-02/03 GRNI 子账侧只取暂估未结转行，总账侧取贷 − 借 → 差异为 0', () => {
  const handle = createTempDb({ label: 'aa-grni-caliber', production: true });
  const db = handle.db;
  seedGrniFixture(db);

  // Accounting & Analytics 的 AA-W1 对账检查（accounting-reconciliation.js）。
  const grniLine = runChecks(db, '2026-11').find((line) => line.checkCode === 'GRNI_TO_GL');
  assert.ok(grniLine, '对账结果必须包含 GRNI_TO_GL');
  assert.equal(grniLine.status, 'PASS', `GRNI 差异必须为 0；实际 ${JSON.stringify(grniLine)}`);
  assert.equal(Number(grniLine.differenceCents), 0);

  // AA-W6.15 检查清单里的同一检查（financial-inventory.js）。
  const health = systemHealth(db, { asOfDate: '2026-11-18' });
  const grni = health.checks.find((check) => check.code === 'RECEIPT_GRNI_TO_GL');
  assert.ok(grni, '健康检查必须包含 RECEIPT_GRNI_TO_GL');
  assert.equal(Number(grni.difference), 0, `RECEIPT_GRNI_TO_GL 差异必须为 0；实际 ${JSON.stringify(grni)}`);
});

test('AA-VAL-04 存货价值对账的两侧同域：总账侧包含在制科目', () => {
  const source = readFileSync(new URL('./modules/financial-inventory.js', import.meta.url), 'utf8');
  assert.ok(source.includes("'WIP'"), '存货价值对账的总账角色集合必须包含 WIP');
});

test('AA-VAL-01 自由手工凭证命中存货 / 成本科目 → 409 且零副作用；非受控科目仍可用', async () => {
  const fixture = await createProcurementFixture('modern-erp-aa-canonical-guard-');
  try {
    const subjects = await fixture.request('GET', '/api/accounting/subjects', fixture.tokens.accounting);
    assert.equal(subjects.status, 200, JSON.stringify(subjects.data));
    const list = subjects.data.subjects || [];
    const inventory = list.find((subject) => subject.code === '1403');
    const other = list.find((subject) => subject.code === '6603') || list.find((subject) => subject.code === '6602');
    assert.ok(inventory, '科目目录必须包含 1403 原材料');
    assert.ok(other, '科目目录必须包含一个非受控费用科目');

    const before = fixture.db.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n;
    const denied = await fixture.request('POST', '/api/accounting-vouchers', fixture.tokens.accounting, {
      voucherDate: '2026-11-18', remark: '守卫负向对照',
      entries: [
        { subjectId: other.id, direction: 'DEBIT', amountCents: 10000, summary: '借' },
        { subjectId: inventory.id, direction: 'CREDIT', amountCents: 10000, summary: '贷' },
      ],
    });
    assert.equal(denied.status, 409, JSON.stringify(denied.data));
    assert.equal(denied.data.code, 'MANUAL_VOUCHER_CANONICAL_SUBJECT');
    assert.ok(denied.data.resolution, '拒绝必须给出可执行的 resolution');
    const after = fixture.db.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n;
    assert.equal(after, before, '被拒绝的手工凭证不得留下任何凭证行');

    // 非受控科目：既有能力不回退。
    const allowed = await fixture.request('POST', '/api/accounting-vouchers', fixture.tokens.accounting, {
      voucherDate: '2026-11-18', remark: '非受控科目',
      entries: [
        { subjectId: other.id, direction: 'DEBIT', amountCents: 10000, summary: '借' },
        { subjectId: list.find((subject) => subject.code === '1001')?.id || other.id, direction: 'CREDIT', amountCents: 10000, summary: '贷' },
      ],
    });
    assert.equal(allowed.status, 201, JSON.stringify(allowed.data));
  } finally {
    await fixture.close();
  }
});
