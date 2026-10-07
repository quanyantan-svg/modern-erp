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
const styles = readFileSync(join(repoRoot, 'src/styles/v16-purchase-receipts.css'), 'utf8');
const main = readFileSync(join(repoRoot, 'src/main.jsx'), 'utf8');
const app = readFileSync(join(repoRoot, 'src/App.jsx'), 'utf8');

function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `${start} must exist`);
  assert.ok(to > from, `${end} must follow ${start}`);
  return source.slice(from, to);
}

const list = section('export function PurchaseReceipts(', 'function PurchaseReceiptListRowV16(');
const row = section('function PurchaseReceiptListRowV16(', 'function PurchaseReceiptDetail(');
const legacyDetail = section('function PurchaseReceiptDetail(', 'function PurchaseReceiptModal(');
const legacyModal = section('function PurchaseReceiptModal(', 'function PurchaseReceiptDetailV16(');
const detail = section('function PurchaseReceiptDetailV16(', 'function PurchaseReceiptEditorV16(');
const editor = section('function PurchaseReceiptEditorV16(', 'export function SalesDeliveries(');

describe('V1.6 P4 purchase receipt presentation contract', () => {
  test('1. list does not render CompactRecord or CompactRecordList', () => {
    assert.doesNotMatch(list, /CompactRecord/);
    assert.match(list, /PurchaseReceiptListRowV16/);
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
    for (const token of ['receipt_no', 'supplierName', 'warehouseName', 'receipt_date', 'total_cents', 'qualityState']) {
      assert.match(row, new RegExp(`item\\.${token}`));
    }
    assert.match(source, /item\.itemCount/);
  });

  test('8. row does not expose creator metadata', () => {
    assert.doesNotMatch(row, /creatorName|confirmedByName/);
  });

  test('9. list quality is contextual and localized', () => {
    assert.match(row, /purchaseReceiptListQualityLabel\(item\.qualityState\)/);
    assert.match(source, /IQC \$\{label\.replace/);
  });

  test('10. list has independent loading, empty, no-result and error states', () => {
    for (const state of ['LOADING', 'EMPTY', 'NO_RESULTS', 'ERROR', 'READY']) {
      assert.match(list, new RegExp(`listState === '${state}'`));
    }
  });

  test('11. detail does not use the legacy status group or normal visibility label', () => {
    assert.doesNotMatch(detail, /business-status-group|正常显示/);
  });

  test('12. detail section order matches the P4 document contract', () => {
    const labels = ['概要', '来源采购订单', '入库明细', '质量', '结算与关联', '操作记录', '管理'];
    let cursor = -1;
    for (const label of labels) {
      const next = detail.indexOf(label, cursor + 1);
      assert.ok(next > cursor, `${label} must appear in order`);
      cursor = next;
    }
  });

  test('13. detail identity keeps status and archive marker separate', () => {
    assert.match(detail, /purchaseReceiptStatusPresentation\(detail\.status\)/);
    assert.match(detail, /v16-purchase-receipt-detail__archive/);
  });

  test('14. billing modes are localized without GRNI in P4 detail', () => {
    assert.match(source, /SEPARATE: '独立建账'/);
    assert.match(source, /AUTO_BILL: '自动建账'/);
    assert.match(source, /LEGACY_DIRECT: '历史直接结算'/);
    assert.doesNotMatch(detail, /GRNI/);
  });

  test('15. detail lines preserve tracking disclosure', () => {
    assert.match(detail, /item\.trackingAllocations/);
    assert.match(detail, /批次 \/ 序列号/);
  });

  test('16. quality state remains contextual in detail', () => {
    assert.match(detail, /detail\.qualityState/);
    assert.match(detail, /purchaseReceiptQualityLabel\(quality\)/);
  });

  test('17. confirm uses the existing state action endpoint', () => {
    assert.match(detail, /api\('\/api\/purchase-receipts\/' \+ id, \{ method: 'POST', body: \{ action \} \}\)/);
    assert.match(detail, /act\('confirm'\)/);
  });

  test('18. IQC creation keeps the existing API body', () => {
    assert.match(detail, /api\('\/api\/iqc', \{ method: 'POST', body: \{ purchase_receipt_id: id \} \}\)/);
  });

  test('19. quality matrix guides but does not auto-confirm', () => {
    assert.match(detail, /code === 'PASS' \|\| code === 'WAIVED'/);
    assert.doesNotMatch(detail, /createQuality[\s\S]{0,160}act\('confirm'\)/);
  });

  test('20. archive eligibility is analyzed before confirmation', () => {
    assert.match(detail, /\/api\/lifecycle\/analyze\?entityType=PURCHASE_RECEIPT/);
    assert.match(detail, /if \(!eligibility\.allowed\)/);
    assert.match(detail, /setConfirm\('archive'\)/);
  });

  test('21. archive and restore remain lifecycle actions, never DELETE', () => {
    assert.match(detail, /api\('\/api\/lifecycle\/archive'/);
    assert.match(detail, /api\('\/api\/lifecycle\/restore'/);
    assert.doesNotMatch(detail, /method: 'DELETE'/);
  });

  test('22. restore remains USERS_MANAGE only', () => {
    assert.match(detail, /can\(user, 'USERS_MANAGE'\)/);
    assert.match(detail, /archived && canRestore/);
  });

  test('23. archive wording never claims irreversible deletion', () => {
    for (const forbidden of ['永久删除', '彻底删除', '不可恢复']) {
      assert.doesNotMatch(list + row + detail + editor, new RegExp(forbidden));
    }
  });

  test('24. cancellation uses the existing action and safe copy', () => {
    assert.match(detail, /act\('cancel'\)/);
    assert.match(detail, /取消后该单据将不能继续编辑或确认，也不会增加库存/);
  });

  test('25. legacy wrappers cannot render the old modal or detail', () => {
    assert.match(legacyDetail, /return null/);
    assert.match(legacyModal, /return null/);
    assert.doesNotMatch(legacyModal, /<Modal/);
  });

  test('26. editor is a full-page task and not a Modal', () => {
    assert.match(editor, /v16-purchase-receipt-editor/);
    assert.doesNotMatch(editor, /<Modal\b/);
  });

  test('27. editor has no desktop line table or add-product action', () => {
    assert.doesNotMatch(editor, /line-table|line-header|添加货品/);
  });

  test('28. source purchase order is required and immutable while editing', () => {
    assert.match(editor, /value=\{form\.purchaseOrderId\}/);
    assert.match(editor, /required\s+disabled=\{Boolean\(order\.id\)\}/);
  });

  test('29. supplier remains source-derived and non-editable', () => {
    assert.match(editor, /value=\{form\.supplierId\} disabled required/);
    assert.match(editor, /supplierId: orderMatch\.supplierId/);
  });

  test('30. TrackingAllocationEditor keeps IN direction and authoritative context', () => {
    assert.match(editor, /<TrackingAllocationEditor/);
    assert.match(editor, /direction="IN"/);
    assert.match(editor, /warehouseId=\{form\.warehouseId\}/);
    assert.match(editor, /businessDate=\{form\.receiptDate\}/);
    assert.match(editor, /quantity=\{Number\(item\.quantity \|\| 0\)\}/);
  });

  test('31. quantity changes clear tracking allocations', () => {
    assert.match(editor, /hasOwnProperty\.call\(patch, 'quantity'\)/);
    assert.match(editor, /next\.trackingAllocations = \[\]/);
  });

  test('32. create and patch payload contract is preserved', () => {
    assert.match(editor, /purchaseOrderId: form\.purchaseOrderId/);
    assert.match(editor, /supplierId: form\.supplierId/);
    assert.match(editor, /warehouseId: form\.warehouseId/);
    assert.match(editor, /receiptDate: form\.receiptDate/);
    assert.match(editor, /billingMode: form\.billingMode/);
    assert.match(editor, /remark: form\.remark/);
    assert.match(editor, /api\('\/api\/purchase-receipts', \{ method: 'POST', body \}\)/);
    assert.match(editor, /method: 'PATCH', body/);
  });

  test('33. editor remains save-draft only', () => {
    assert.match(editor, /保存草稿/);
    assert.doesNotMatch(editor, /保存并确认|确认入库|创建 IQC/);
  });

  test('34. P4 stylesheet is isolated and imported last', () => {
    assert.match(main, /v16-sales-order-document\.css';\s*import '\.\/styles\/v16-purchase-receipts\.css'/);
    assert.match(styles, /v16-purchase-receipts|v16-purchase-receipt-detail|v16-purchase-receipt-editor/);
  });

  test('35. P4 product contract: purchase-receipts canonical route + contextual IQC parent + access contract stable', () => {
    // V1.6 P4 rebuilt the purchase-receipt presentation surface. The frozen
    // product contract this phase must preserve:
    //   - canonical 50 enabled / 5 disabled route inventory
    //   - purchase-receipts route keeps its access contract (PURCHASE_RECEIPTS_VIEW /
    //     PURCHASE_RECEIPTS_MANAGE)
    //   - IQC still has parentRoute = purchase-receipts (contextual classification
    //     contract preserved)
    //   - the MobileShell header back handler chain still wires setHeaderBackAction
    assert.equal(ROUTE_PRESENTATIONS.length, 50, 'canonical 50 enabled routes must remain enabled');
    assert.equal(DISABLED_ROUTE_PRESENTATIONS.length, 5, 'frozen five disabled routes must remain disabled');

    const receiptRoute = enabledByRoute.get('purchase-receipts');
    assert.ok(receiptRoute, 'purchase-receipts route must remain enabled');
    assert.deepEqual(
      [...(receiptRoute.any || [])].sort(),
      ['PURCHASE_RECEIPTS_MANAGE', 'PURCHASE_RECEIPTS_VIEW'],
      'purchase-receipts route must keep its access contract',
    );
    assert.equal(receiptRoute.parentRoute, undefined, 'purchase-receipts stays a primary route (no contextual parent)');

    const iqcRoute = enabledByRoute.get('iqc');
    assert.ok(iqcRoute, 'iqc route must remain enabled');
    assert.equal(iqcRoute.parentRoute, 'purchase-receipts', 'IQC contextual parent must remain purchase-receipts');

    // The MobileShell header back registration chain is intact.
    assert.match(app, /const setHeaderBackAction = \(action\) => setDocumentBackAction\(\(\) => action\)/);
    assert.match(app, /setHeaderBackAction,\s*registerHeaderBackAction/);
  });

  test('36. MobileShell header back registration stores handlers as values', () => {
    assert.match(app, /const setHeaderBackAction = \(action\) => setDocumentBackAction\(\(\) => action\)/);
    assert.match(app, /setHeaderBackAction,\s*registerHeaderBackAction/);
  });
});
