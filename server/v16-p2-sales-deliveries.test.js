import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import {
  ROUTE_PRESENTATIONS,
  DISABLED_ROUTE_PRESENTATIONS,
} from '../src/navigation/presentationMetadata.js';

const enabledByRoute = new Map(ROUTE_PRESENTATIONS.map((route) => [route.route, route]));

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const source = readFileSync(join(repoRoot, 'src/pages/logistics-finance.jsx'), 'utf8');
const styles = readFileSync(join(repoRoot, 'src/styles/v16-sales-deliveries.css'), 'utf8');
const main = readFileSync(join(repoRoot, 'src/main.jsx'), 'utf8');
const app = readFileSync(join(repoRoot, 'src/App.jsx'), 'utf8');
const serverApp = readFileSync(join(repoRoot, 'server/app.js'), 'utf8');

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `${start} must exist`);
  assert.ok(to > from, `${end} must follow ${start}`);
  return source.slice(from, to);
}

const list = section('export function SalesDeliveries(', 'function SalesDeliveryListRowV16(');
const row = section('function SalesDeliveryListRowV16(', 'function SalesDeliveryDetailV16(');
const detail = section('function SalesDeliveryDetailV16(', 'function SalesDeliveryModal(');

describe('V1.6.2 Phase 1 sales-delivery presentation contract', () => {
  test('1. list does not render CompactRecord or CompactRecordList', () => {
    assert.doesNotMatch(list, /CompactRecord/);
    assert.match(list, /SalesDeliveryListRowV16/);
  });

  test('2. list does not render BusinessPageHeader', () => {
    assert.doesNotMatch(list, /BusinessPageHeader/);
  });

  test('3. list has no permanent business explanation', () => {
    assert.doesNotMatch(list, /HelpDisclosure|业务说明|确认后才影响库存/);
  });

  test('4. status filters are exactly all, draft, confirmed, cancelled', () => {
    const labels = [...list.matchAll(/\{ value: '[^']*', label: '([^']+)' \}/g)].map((match) => match[1]);
    assert.deepEqual(labels, ['全部', '草稿', '已确认', '已取消']);
  });

  test('5. archive visibility is a separate pressed control', () => {
    assert.match(list, /aria-pressed=\{includeArchived \? 'true' : 'false'\}/);
    assert.match(list, />\s*归档记录\s*</);
  });

  test('6. archived marker is separate from document status', () => {
    assert.match(row, /data-status=\{item\.status\}/);
    assert.match(row, />已归档</);
  });

  test('7. row consumes canonical list fields', () => {
    for (const token of ['delivery_no', 'customerName', 'warehouseName', 'delivery_date', 'total_cents', 'itemCount', 'qualityState']) {
      assert.match(source, new RegExp(`item\\.${token}`));
    }
  });

  test('8. row does not expose creator metadata', () => {
    assert.doesNotMatch(row, /creatorName|confirmedByName/);
  });

  test('9. list OQC quality is contextual and localized', () => {
    assert.match(source, /function salesDeliveryListQualityLabel\b/);
    assert.match(source, /salesDeliveryListQualityLabel\(item\.qualityState\)/);
    assert.match(source, /OQC \$\{label\.replace/);
  });

  test('10. list has independent loading, empty, no-result and error states', () => {
    for (const state of ['LOADING', 'EMPTY', 'NO_RESULTS', 'ERROR', 'READY']) {
      assert.match(list, new RegExp(`listState === '${state}'`));
    }
  });

  test('11. detail does not use the legacy status group', () => {
    assert.doesNotMatch(detail, /business-status-group/);
  });

  test('12. detail section order matches the V1.6.2 Phase 1 contract', () => {
    const labels = ['概要', '来源销售订单', '出库明细', '质量', '结算与关联', '操作记录', '管理'];
    let cursor = -1;
    for (const label of labels) {
      const next = detail.indexOf(label, cursor + 1);
      assert.ok(next > cursor, `${label} must appear in order`);
      cursor = next;
    }
  });

  test('13. detail identity keeps status and archive marker separate', () => {
    assert.match(detail, /salesDeliveryStatusPresentation\(detail\.status\)/);
    assert.match(detail, /v16-sales-delivery-detail__archive/);
  });

  test('14. detail lines preserve tracking disclosure and source quantity context', () => {
    assert.match(detail, /item\.trackingAllocations/);
    assert.match(detail, /批次 \/ 序列号/);
    assert.match(detail, /订购 \{quantity\(ordered\)\} · 已发 \{quantity\(delivered\)\}/);
  });

  test('15. quality state remains contextual in detail', () => {
    assert.match(detail, /detail\.qualityState/);
    assert.match(detail, /salesDeliveryQualityLabel\(quality\)/);
  });

  test('16. OQC state machine derives primary from quality.code exactly as required', () => {
    // State derivation matches IQC: PASS|WAIVED => confirm; NOT_INSPECTED => create; INSPECTION_DRAFT => go; FAIL|STALE => create retest.
    assert.match(detail, /submittable = code === 'PASS' \|\| code === 'WAIVED'/);
    assert.match(detail, /notInspected = code === 'NOT_INSPECTED'/);
    assert.match(detail, /inspectionDraft = code === 'INSPECTION_DRAFT'/);
    assert.match(detail, /needsRetest = code === 'FAIL' \|\| code === 'STALE'/);
  });

  test('17. NOT_INSPECTED surfaces 创建 OQC', () => {
    assert.match(detail, /notInspected[\s\S]{0,200}创建 OQC/);
  });

  test('18. INSPECTION_DRAFT surfaces 前往 OQC', () => {
    assert.match(detail, /inspectionDraft[\s\S]{0,200}前往 OQC/);
  });

  test('19. PASS and WAIVED surface 确认出库', () => {
    assert.match(detail, /submittable[\s\S]{0,200}确认出库/);
  });

  test('20. FAIL and STALE surface 创建 OQC 复检', () => {
    assert.match(detail, /needsRetest[\s\S]{0,200}创建 OQC 复检/);
  });

  test('21. OQC creation keeps the existing API body and navigates to the new inspection', () => {
    assert.match(detail, /api\('\/api\/oqc', \{ method: 'POST', body: \{ sales_delivery_id: id \} \}\)/);
    assert.match(detail, /navigateToPage\('oqc', \{[\s\S]+documentId: inspectionId[\s\S]+documentType: 'OQC_INSPECTION'[\s\S]+sourcePage: 'sales-deliveries'[\s\S]+sourceDocumentId: id/);
  });

  test('22. go OQC uses the existing inspectionId from qualityState', () => {
    assert.match(detail, /inspectionId = detail\?\.qualityState\?\.inspectionId/);
    assert.match(detail, /navigateToPage\('oqc'[\s\S]+OQC_INSPECTION[\s\S]+sales-deliveries/);
  });

  test('23. OQC actions are gated by OQC_MANAGE / OQC_VIEW', () => {
    assert.match(detail, /canManageOqc = can\(user, 'OQC_MANAGE'\)/);
    assert.match(detail, /canViewOqc = can\(user, 'OQC_VIEW'\) \|\| canManageOqc/);
    assert.match(detail, /notInspected[\s\S]{0,200}canManageOqc \? \{ kind: 'oqc-create'[\s\S]+创建 OQC[\s\S]{0,40}\}/);
    assert.match(detail, /inspectionDraft[\s\S]{0,200}canViewOqc \? \{ kind: 'oqc-go'[\s\S]+前往 OQC[\s\S]{0,40}\}/);
    assert.match(detail, /needsRetest[\s\S]{0,200}canManageOqc \? \{ kind: 'oqc-create'[\s\S]+创建 OQC 复检[\s\S]{0,40}\}/);
  });

  test('24. confirm uses the existing state action endpoint', () => {
    assert.match(detail, /api\('\/api\/sales-deliveries\/' \+ id, \{ method: 'POST', body: \{ action \} \}\)/);
    assert.match(detail, /act\('confirm'\)/);
  });

  test('25. archive eligibility is analyzed before confirmation', () => {
    assert.match(detail, /\/api\/lifecycle\/analyze\?entityType=SALES_DELIVERY/);
    assert.match(detail, /if \(!eligibility\.allowed\)/);
    assert.match(detail, /setConfirm\('archive'\)/);
  });

  test('26. archive and restore remain lifecycle actions, never DELETE', () => {
    assert.match(detail, /api\('\/api\/lifecycle\/archive'/);
    assert.match(detail, /api\('\/api\/lifecycle\/restore'/);
    assert.doesNotMatch(detail, /method: 'DELETE'/);
  });

  test('27. restore remains USERS_MANAGE only', () => {
    assert.match(detail, /can\(user, 'USERS_MANAGE'\)/);
    assert.match(detail, /archived && canRestore/);
  });

  test('28. archive wording never claims irreversible deletion', () => {
    for (const forbidden of ['永久删除', '彻底删除', '不可恢复']) {
      assert.doesNotMatch(list + row + detail, new RegExp(forbidden));
    }
  });

  test('29. editor path remains the existing SalesDeliveryModal and uses legacy endpoints', () => {
    assert.match(list, /<SalesDeliveryModal/);
    assert.match(detail, /api\('\/api\/sales-deliveries\/' \+ id/);
    assert.match(source, /api\(["']\/api\/sales-deliveries["'], \{ method: ["']POST["'], body: form \}\)/);
    assert.match(source, /api\(["']\/api\/sales-deliveries\/["'] \+ value\.id, \{ method: ["']PATCH["'], body: form \}\)/);
  });

  test('30. cancel uses the existing action and safe copy', () => {
    assert.match(detail, /act\('cancel'\)/);
    assert.match(detail, /取消后该单据将不能继续编辑或确认/);
  });

  test('31. V1.6.2 stylesheet is isolated and imported after v16-purchase-receipts', () => {
    assert.match(
      main,
      /v16-purchase-receipts\.css';\s*import '\.\/styles\/v16-sales-deliveries\.css'/,
    );
    assert.match(
      styles,
      /v16-sales-deliveries|v16-sales-delivery-detail|v16-sales-delivery-editor/,
    );
    assert.doesNotMatch(styles, /\.purchase-receipt/);
  });

  test('32. server relationship query no longer uses DISTINCT JOIN for sales invoices', () => {
    assert.doesNotMatch(
      serverApp,
      /SELECT DISTINCT v\.id,v\.invoice_no documentNo,v\.status FROM sales_invoices v JOIN sales_invoice_items/,
    );
    assert.match(
      serverApp,
      /SELECT v\.id,v\.invoice_no documentNo,v\.status FROM sales_invoices v WHERE EXISTS[\s\S]+sales_invoice_items i WHERE i\.invoice_id=v\.id AND i\.delivery_id=\?[\s\S]+ORDER BY v\.created_at,v\.id/,
    );
  });

  test('33. server sales-return relationship ordering uses deterministic created_at, id', () => {
    assert.match(
      serverApp,
      /SELECT id,return_no documentNo,status FROM return_orders WHERE source_type='SALES'[\s\S]+ORDER BY created_at, id/,
    );
  });

  test('34. canonical 53 enabled / 5 disabled routes remain and sales-deliveries parentRoute stays a primary', () => {
    assert.equal(ROUTE_PRESENTATIONS.length, 53, 'canonical 53 enabled routes must remain enabled');
    assert.equal(DISABLED_ROUTE_PRESENTATIONS.length, 5, 'frozen five disabled routes must remain disabled');

    const salesDeliveryRoute = enabledByRoute.get('sales-deliveries');
    assert.ok(salesDeliveryRoute, 'sales-deliveries route must remain enabled');
    assert.deepEqual(
      [...(salesDeliveryRoute.any || [])].sort(),
      ['SALES_DELIVERIES_MANAGE', 'SALES_DELIVERIES_VIEW'],
      'sales-deliveries route must keep its access contract',
    );
    assert.equal(salesDeliveryRoute.parentRoute, undefined, 'sales-deliveries stays a primary route (no contextual parent)');

    // OQC contextual parent must remain sales-deliveries.
    const oqcRoute = enabledByRoute.get('oqc');
    assert.ok(oqcRoute, 'oqc route must remain enabled');
    assert.equal(oqcRoute.parentRoute, 'sales-deliveries', 'OQC contextual parent must remain sales-deliveries');

    // The MobileShell header back registration chain is intact.
    assert.match(app, /setHeaderBackAction = \(action\) => setDocumentBackAction\(\(\) => action\)/);
    assert.match(app, /setHeaderBackAction, registerHeaderBackAction \}\}>/);
  });

  test('35. MobileShell header back handler chain still wired for sales-deliveries detail', () => {
    assert.match(list, /setHeaderBackAction\(handler\)/);
    assert.match(list, /selectedId \? returnToList : null/);
    assert.match(list, /editor[\s\S]{0,80}selectedId \? closeEditorOnly : returnToList/);
  });

  test('36. confirm action respects server quality gate (frontend does not bypass)', () => {
    // Frontend primary may surface 确认出库, but the server still owns quality gate.
    assert.match(detail, /submittable[\s\S]{0,200}primary = \{ kind: 'confirm'/);
    assert.match(
      serverApp,
      /if \(action === 'confirm'\)[\s\S]{0,2000}assertQualityGate\(db, ['"]OQC['"], deliveryId\)/,
    );
  });
});
