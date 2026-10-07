import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { PERMISSIONS, createDatabase } from './db.js';
import { APPROVAL_DOCUMENT_TYPES } from './modules/approvals.js';
import { LIFECYCLE_ENTITIES } from './modules/lifecycle-engine.js';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');
const appSource = source('src/App.jsx');
const shellSource = source('src/components/MobileShell.jsx');
const designSource = source('src/components/design-system.jsx');
const uiSource = `${designSource}\n${source('src/components/ui.jsx')}`;
const materialPlanSource = source('src/pages/material-requirements-plan.jsx');
const lifecycleTestSource = source('server/v12-lifecycle-cleanup.test.js');
const browserAcceptanceSource = source('scripts/acceptance/p3-ui-acceptance.mjs');
let tempDir;

before(() => { tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v12-release-')); });
after(() => { rmSync(tempDir, { recursive: true, force: true }); });

describe('V1.2 release registries', () => {
  test('permission, role, approval and lifecycle registries stay canonical', () => {
    assert.equal(PERMISSIONS.length, 122);
    assert.deepEqual(APPROVAL_DOCUMENT_TYPES, ['SALES_ORDER', 'PURCHASE_ORDER', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER', 'PURCHASE_REQUISITION']);
    assert.equal(Object.keys(LIFECYCLE_ENTITIES).length, 25);

    const db = createDatabase(join(tempDir, 'registry.db'));
    assert.equal(db.prepare('SELECT COUNT(*) count FROM roles').get().count, 5);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM role_permissions WHERE role_id='role-admin'").get().count, 122);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    db.close();
  });

  test('fresh and second database startup are idempotent', () => {
    const path = join(tempDir, 'second-start.db');
    createDatabase(path).close();
    const reopened = createDatabase(path);
    assert.equal(reopened.prepare('SELECT COUNT(*) count FROM permissions').get().count, 122);
    assert.equal(reopened.prepare('SELECT COUNT(*) count FROM roles').get().count, 5);
    assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(), []);
    reopened.close();
  });
});

describe('V1.2 unified product acceptance contract', () => {
  test('one canonical shell and five fixed tabs serve every viewport', () => {
    assert.equal((appSource.match(/<MobileShell/g) || []).length, 1);
    assert.doesNotMatch(appSource, /isMobile|useDesktop|useMediaQuery|matchMedia|innerWidth/);
    // V1.6 P1A: cloud/云翼/签核 replaced by workspace/工作台/审批.
    for (const label of ['消息', '审批', '应用', '工作台', '我的']) assert.match(shellSource, new RegExp(`label: '${label}'`));
    assert.equal((shellSource.match(/enabled: true/g) || []).length, 5);
  });

  test('shared product primitives cover lists, forms, filters, actions, status and errors', () => {
    for (const primitive of ['RecordCard', 'FormRow', 'FilterSheet', 'ActionSheet', 'DangerSheet', 'StatusChip', 'ErrorState', 'BottomActionBar']) {
      assert.match(uiSource, new RegExp(`export function ${primitive}\\b`));
    }
  });

  test('material plan keeps one enterprise-row architecture and all explicit controls', () => {
    assert.match(materialPlanSource, /function MaterialResultRowV16/);
    for (const filter of ['all', 'make', 'buy', 'shortage']) assert.match(materialPlanSource, new RegExp(`value: '${filter}'`));
    assert.match(materialPlanSource, /本次没有物料需求/);
    assert.match(materialPlanSource, /MaterialTraceSheetV16/);
    assert.doesNotMatch(materialPlanSource, /MaterialCard|<table|desktop/i);
  });
});

describe('V1.2 lifecycle and real-browser acceptance matrix', () => {
  test('all ten destructive lifecycle cases have executable coverage', () => {
    const contracts = [
      'simple bad draft deletes directly',
      'released instruction chain is effective and destructive cleanup is disabled',
      'confirmed purchase receipt destructive cleanup is refused without changing effects',
      'effective receipt cleanup remains disabled regardless of dependency expansion',
      'includeExternal: true',
      'closed inventory period blocks cleanup',
      'archive is hidden in normal list',
      'includeArchived=true',
      '/api/lifecycle/restore',
      'effective cleanup guard runs before legacy reversal work',
    ];
    const allLifecycleCoverage = lifecycleTestSource + source('server/v12-lifecycle-product.test.js');
    for (const contract of contracts) assert.ok(allLifecycleCoverage.includes(contract), `missing lifecycle coverage: ${contract}`);
  });

  test('real Edge acceptance declares every required width and role', () => {
    for (const width of [375, 414, 768, 1024, 1440, 1600, 1920]) assert.match(browserAcceptanceSource, new RegExp(`width: ${width}\\b`));
    for (const role of ['admin', 'sales', 'reviewer', 'warehouse', 'accounting']) assert.match(browserAcceptanceSource, new RegExp(`label: '${role}'`));
    for (const check of ['login completes', 'canonical tabs', 'centered workspace', 'no page overflow', 'calculation basis opens', 'filter sheet opens', 'keyboard focus reaches a control', 'console errors=0', 'unexpected HTTP=0']) assert.ok(browserAcceptanceSource.includes(check));
  });
});
