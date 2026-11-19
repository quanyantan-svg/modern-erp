import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';

import { listInventoryWorkReferences } from './modules/inventory-work-references.js';
import { listPlanningWorkReferences } from './modules/planning-work-references.js';
import { listPlatformWorkReferences } from './modules/platform-work-references.js';
import { listSalesWorkReferences } from './modules/sales-work-references.js';
import { listWorkflowParticipants } from './modules/platform-workflow-engine.js';
import { createTempDb } from './test-utils/temp-db.js';
import { read } from './test-utils/wave11-sec-scope-fixture.js';

let handle;
let db;

beforeEach(() => {
  handle = createTempDb({ label: 'advanced-business-references' });
  db = handle.db;
});

afterEach(() => handle?.cleanup());

const actor = (permissions) => ({ id: 'user-admin', roleCode: 'ADMIN', permissions });

test('domain endpoints expose the shared business-reference projection and fail closed', async () => {
  const sales = await read(listSalesWorkReferences, db, actor(['SALES_VIEW']), { kind: 'PRODUCT', limit: 5 });
  const inventory = await read(listInventoryWorkReferences, db, actor(['INVENTORY_VIEW']), { kind: 'SUPPLIER', limit: 5 });
  const valuation = await read(listInventoryWorkReferences, db, actor(['INVENTORY_ABC_MANAGE']), { kind: 'VALUATION_SNAPSHOT', limit: 5 });
  const planning = await read(listPlanningWorkReferences, db, actor(['MRP_VIEW']), { kind: 'DEMAND_SALES_ORDER', limit: 5 });
  const workflow = await read(listWorkflowParticipants, db, actor(['WORKFLOW_TASK_ACT']), { kind: 'USER', limit: 5 });
  const organizations = await read(listPlatformWorkReferences, db, actor(['NUMBERING_MANAGE']), { kind: 'ORGANIZATION', limit: 5 });

  for (const result of [sales, inventory, valuation, planning, workflow, organizations]) {
    assert.equal(result.statusCode, 200);
    assert.deepEqual(Object.keys(result.body).sort(), ['items', 'kind', 'limit', 'offset', 'total']);
    for (const item of result.body.items) {
      assert.deepEqual(Object.keys(item).sort(), ['active', 'code', 'id', 'name', 'secondaryText']);
    }
  }

  const denied = await read(listInventoryWorkReferences, db, actor([]), { kind: 'SUPPLIER' });
  assert.equal(denied.statusCode, 403);
  const invalid = await read(listSalesWorkReferences, db, actor(['SALES_VIEW']), { kind: 'UNKNOWN' });
  assert.equal(invalid.statusCode, 400);
});

test('search total and selected hydration stay on the same authorized relation', async () => {
  const all = await read(listSalesWorkReferences, db, actor(['SALES_VIEW']), { kind: 'PRODUCT', limit: 5 });
  assert.ok(all.body.items.length > 0);
  const selectedId = all.body.items[0].id;
  const hydrated = await read(listSalesWorkReferences, db, actor(['SALES_VIEW']), {
    kind: 'PRODUCT', q: '不会命中的业务名称', selectedId, limit: 5,
  });
  assert.equal(hydrated.statusCode, 200);
  assert.equal(hydrated.body.total, 0);
  assert.equal(hydrated.body.items.some((item) => item.id === selectedId), true);
});

test('advanced editors no longer ask users for the targeted technical identifiers', () => {
  const engineering = readFileSync(new URL('../src/pages/engineering-reference.jsx', import.meta.url), 'utf8');
  const planning = readFileSync(new URL('../src/pages/planning-reservations.jsx', import.meta.url), 'utf8');
  const sales = readFileSync(new URL('../src/pages/sales-wave7.jsx', import.meta.url), 'utf8');
  const inventory = readFileSync(new URL('../src/pages/inventory-work.jsx', import.meta.url), 'utf8');
  const accounting = readFileSync(new URL('../src/pages/accounting-analytics.jsx', import.meta.url), 'utf8');
  const workflow = readFileSync(new URL('../src/pages/platform-workflow-tasks.jsx', import.meta.url), 'utf8');
  const numbering = readFileSync(new URL('../src/pages/platform-numbering.jsx', import.meta.url), 'utf8');
  const bindings = readFileSync(new URL('../src/pages/platform-workflow-bindings.jsx', import.meta.url), 'utf8');

  assert.doesNotMatch(engineering, /班次 ID|班制 ID|日历模板 ID|工作中心 ID|基础活动 ID/);
  assert.doesNotMatch(planning, /需求来源 ID|供应来源 ID/);
  assert.doesNotMatch(sales, /销售订单 ID|订单行 ID|货品 ID|仓库 ID|预计量来源 ID/);
  assert.doesNotMatch(inventory, /所有权对象 ID|批号 ID|序列号 ID|财务估值快照 ID/);
  assert.doesNotMatch(accounting, /上级科目 ID/);
  assert.doesNotMatch(workflow, /接收人 ID/);
  assert.doesNotMatch(numbering, /value=\{form\.orgId\}[^\n]*<\/input>/);
  assert.doesNotMatch(bindings, /value=\{form\.orgId\}[^\n]*<\/input>/);
  assert.doesNotMatch(accounting, /<input[^>]+value=\{form\.managementBookId\}/);
  for (const source of [engineering, planning, sales, inventory, accounting, workflow, numbering, bindings]) assert.match(source, /BusinessReferenceSelector/);
});
