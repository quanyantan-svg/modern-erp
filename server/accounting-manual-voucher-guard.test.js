// 手工凭证守卫的受控科目族扩展与旁路闭合（Requirement §35.13 `AA-VAL-05..12`）。
//
// §35.12 的守卫只有**一处**实现，且只挂在凭证**创建**路径上：
//   - 改分录（`PATCH /api/accounting-vouchers/:id`）不校验 → 「先建一张违规凭证再改分录」可绕过；
//   - 冲销（`POST /api/accounting-vouchers/:id/reverse`）不校验 → 「对违规凭证冲销」可绕过。
// 只扩科目集合封不住这两个旁路。
//
// 本套件证明：
//   1. 受控科目集合已扩展到成本与差异族（6401 / 6404 / 6408 …）；
//   2. 三条写路径共用同一守卫，创建 / 改分录 / 冲销全部 409 + 零副作用；
//   3. 非受控科目仍可自由录入（能力不回退）；
//   4. 守卫的抛出点在全仓**有且仅有一处**（静态断言）。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

const VOUCHER_DATE = '2026-11-18';

describe('手工凭证守卫：受控科目族扩展与旁路闭合（§35.13）', () => {
  let fixture;
  let subjects;

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-aa-manual-voucher-guard-');
    const response = await fixture.request('GET', '/api/accounting/subjects', fixture.tokens.accounting);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    subjects = response.data.subjects || [];
  });
  after(async () => { try { fixture.close(); } catch { /* 清理失败不影响结论 */ } });

  function subjectId(code) {
    const found = subjects.find((subject) => subject.code === code);
    assert.ok(found, `科目目录必须包含 ${code}`);
    return found.id;
  }

  function voucherCount() {
    return Number(fixture.db.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n);
  }

  function entryCount() {
    return Number(fixture.db.prepare('SELECT COUNT(*) n FROM accounting_entries').get().n);
  }

  async function createManualVoucher(entries, remark = '手工凭证') {
    return fixture.request('POST', '/api/accounting-vouchers', fixture.tokens.accounting, {
      voucherDate: VOUCHER_DATE, remark, entries,
    });
  }

  test('AA-VAL-AC-01/02 存货族与成本差异族命中受控科目 → 409 且零副作用', async () => {
    const beforeVouchers = voucherCount();
    const beforeEntries = entryCount();
    const other = subjectId('6603');
    for (const code of ['1403', '1405', '1406', '1404', '1407', '6401', '6404', '6408']) {
      const denied = await createManualVoucher([
        { subjectId: other, direction: 'DEBIT', amountCents: 10000, summary: '借' },
        { subjectId: subjectId(code), direction: 'CREDIT', amountCents: 10000, summary: '贷' },
      ], `守卫负向对照 ${code}`);
      assert.equal(denied.status, 409, `${code} 必须被守卫拒绝：${JSON.stringify(denied.data)}`);
      assert.equal(denied.data.code, 'MANUAL_VOUCHER_CANONICAL_SUBJECT');
      assert.ok(denied.data.resolution, '拒绝必须给出可执行的 resolution');
    }
    assert.equal(voucherCount(), beforeVouchers, '被拒绝的手工凭证不得留下凭证行');
    assert.equal(entryCount(), beforeEntries, '被拒绝的手工凭证不得留下分录行');
  });

  test('AA-VAL-AC-03 改分录路径：把分录改成受控科目 → 409 且原分录与状态不变', async () => {
    const other = subjectId('6603');
    const cash = subjectId('1001');
    const created = await createManualVoucher([
      { subjectId: other, direction: 'DEBIT', amountCents: 10000, summary: '借' },
      { subjectId: cash, direction: 'CREDIT', amountCents: 10000, summary: '贷' },
    ], '改分录正对照');
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const beforeVouchers = voucherCount();
    const beforeEntries = entryCount();
    const beforeLines = fixture.db.prepare('SELECT subject_id, direction, amount_cents FROM accounting_entries WHERE voucher_id=? ORDER BY line_no').all(created.data.id);

    const denied = await fixture.request('PATCH', `/api/accounting-vouchers/${created.data.id}`, fixture.tokens.accounting, {
      voucherDate: VOUCHER_DATE, remark: '试图改为存货科目',
      entries: [
        { subjectId: other, direction: 'DEBIT', amountCents: 10000, summary: '借' },
        { subjectId: subjectId('1403'), direction: 'CREDIT', amountCents: 10000, summary: '贷' },
      ],
    });
    assert.equal(denied.status, 409, JSON.stringify(denied.data));
    assert.equal(denied.data.code, 'MANUAL_VOUCHER_CANONICAL_SUBJECT');
    assert.equal(voucherCount(), beforeVouchers, '被拒绝的改分录不得留下凭证行');
    assert.equal(entryCount(), beforeEntries, '被拒绝的改分录不得留下分录行');
    const afterLines = fixture.db.prepare('SELECT subject_id, direction, amount_cents FROM accounting_entries WHERE voucher_id=? ORDER BY line_no').all(created.data.id);
    assert.deepEqual(afterLines, beforeLines, '原凭证的分录必须逐字未变');
    assert.equal(fixture.db.prepare('SELECT status FROM accounting_vouchers WHERE id=?').get(created.data.id).status, 'ENTERED');
  });

  test('AA-VAL-AC-04 冲销路径：含受控科目的既有手工凭证被拒；合法手工凭证仍可冲销', async () => {
    const other = subjectId('6603');
    const cash = subjectId('1001');
    // 既有（历史）违规手工凭证：现在已无法经 API 产生，用直接 SQL 构造以模拟历史数据。
    const now = new Date().toISOString();
    const legacyId = 'manual-legacy-controlled';
    fixture.db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,business_date,remark,creator_id,created_at,status,period,voucher_origin)
      VALUES(?,?,'MANUAL',?,?,?,?,?,?,'POSTED','2026-11','MANUAL')`)
      .run(legacyId, 'VCH-LEGACY-1', legacyId, VOUCHER_DATE, VOUCHER_DATE, '历史违规凭证', 'user-admin', now);
    fixture.db.prepare(`INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,line_no)
      VALUES(?,?,?,'DEBIT',10000,'借',1)`).run('e-legacy-1', legacyId, other);
    fixture.db.prepare(`INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,line_no)
      VALUES(?,?,?,'CREDIT',10000,'贷',2)`).run('e-legacy-2', legacyId, subjectId('1403'));

    const beforeVouchers = voucherCount();
    const denied = await fixture.request('POST', `/api/accounting-vouchers/${legacyId}/reverse`, fixture.tokens.accounting, {
      reason: '试图冲销违规凭证', businessDate: VOUCHER_DATE,
    });
    assert.equal(denied.status, 409, JSON.stringify(denied.data));
    assert.equal(denied.data.code, 'MANUAL_VOUCHER_CANONICAL_SUBJECT');
    assert.equal(voucherCount(), beforeVouchers, '被拒绝的冲销不得产生冲销凭证');

    // 合法手工凭证：冲销仍然成功（既有能力不回退）。
    const created = await createManualVoucher([
      { subjectId: other, direction: 'DEBIT', amountCents: 10000, summary: '借' },
      { subjectId: cash, direction: 'CREDIT', amountCents: 10000, summary: '贷' },
    ], '合法冲销正对照');
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal((await fixture.request('POST', `/api/accounting-vouchers/${created.data.id}/submit`, fixture.tokens.accounting)).status, 200);
    assert.equal((await fixture.request('POST', `/api/accounting-vouchers/${created.data.id}/approve`, fixture.tokens.reviewer)).status, 200);
    const beforeReverse = voucherCount();
    const reversed = await fixture.request('POST', `/api/accounting-vouchers/${created.data.id}/reverse`, fixture.tokens.accounting, {
      reason: '正常冲销', businessDate: VOUCHER_DATE,
    });
    assert.equal(reversed.status, 201, JSON.stringify(reversed.data));
    assert.equal(voucherCount(), beforeReverse + 1, '合法冲销必须产生一张冲销凭证');
  });

  test('AA-VAL-AC-06 非受控科目仍然可以自由录入（能力不回退）', async () => {
    const created = await createManualVoucher([
      { subjectId: subjectId('6603'), direction: 'DEBIT', amountCents: 10000, summary: '借' },
      { subjectId: subjectId('1001'), direction: 'CREDIT', amountCents: 10000, summary: '贷' },
    ], '非受控科目');
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM accounting_vouchers WHERE id=?').get(created.data.id).n, 1);
  });

  test('AA-VAL-AC-07 守卫的唯一实现：全仓抛出点有且仅有一处', () => {
    const serverDir = fileURLToPath(new URL('.', import.meta.url));
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) files.push(full);
      }
    };
    walk(serverDir);
    const throwing = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (text.includes('MANUAL_VOUCHER_CANONICAL_SUBJECT')) {
        throwing.push(relative(serverDir, file).replaceAll('\\', '/'));
      }
    }
    assert.deepEqual(throwing, ['modules/accounting-manual-voucher-guard.js'],
      `守卫的错误码必须只出现在唯一的守卫实现里，实际：${throwing.join(', ')}`);
  });
});
