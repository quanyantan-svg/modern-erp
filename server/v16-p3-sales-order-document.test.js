import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = join(repoRoot, 'src');
const readSrc = (path) => readFileSync(join(srcDir, path), 'utf8');

const masterData = readSrc('pages/master-data.jsx');

// Extract function source by walking braces (matches P2 helper, but tolerant
// of destructured `{}` in parameter lists).
function extractFunctionSource(source, signature) {
  const startMatch = source.match(signature);
  assert.ok(startMatch, `Function signature ${signature} must exist in source`);
  const start = startMatch.index;
  let i = source.indexOf('(', startMatch.index);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        i++;
        while (i < source.length && /\s/.test(source[i])) i++;
        if (source[i] !== '{') throw new Error('function body opener not found');
        break;
      }
    }
  }
  const bodyStart = i;
  depth = 0;
  for (let j = bodyStart; j < source.length; j++) {
    const ch = source[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, j + 1);
    }
  }
  throw new Error('Function has no matching closing brace');
}

const ordersFn = extractFunctionSource(masterData, /export function Orders\(/);
const salesDetailFn = extractFunctionSource(masterData, /function SalesOrderDetailV16\(/);
const salesEditorFn = extractFunctionSource(masterData, /function SalesOrderEditorV16\(/);
const orderDetailStub = extractFunctionSource(masterData, /^function OrderDetail\(/m);
const orderEditorStub = extractFunctionSource(masterData, /^function OrderEditor\(/m);
const orderDocumentDetailFn = extractFunctionSource(masterData, /function OrderDocumentDetail\(/);
const purchaseOrderDetailFn = extractFunctionSource(masterData, /function PurchaseOrderDetail\(/);
const purchaseOrderEditorFn = extractFunctionSource(masterData, /function PurchaseOrderEditor\(/);

describe('V1.6 P3 — sales-order document contract', () => {
  test('1. OrderDetail no longer renders sales through OrderDocumentDetail(kind="sales")', () => {
    assert.ok(orderDetailStub, 'OrderDetail stub must exist');
    // The stub body must not invoke OrderDocumentDetail.
    assert.doesNotMatch(orderDetailStub, /OrderDocumentDetail/);
    // The Orders top-level branch must call SalesOrderDetailV16 for the
    // viewing path and must not call OrderDocumentDetail(kind="sales").
    assert.match(ordersFn, /<SalesOrderDetailV16\b/);
    assert.doesNotMatch(ordersFn, /OrderDocumentDetail[\s\S]*?kind="sales"/);
    assert.doesNotMatch(ordersFn, /<OrderDetail\b/);
  });

  test('2. PurchaseOrderDetail still uses existing purchase presentation', () => {
    assert.match(purchaseOrderDetailFn, /<OrderDocumentDetail\b/);
    assert.match(purchaseOrderDetailFn, /kind="purchase"/);
    // And it must not route through SalesOrderDetailV16.
    assert.doesNotMatch(purchaseOrderDetailFn, /SalesOrderDetailV16/);
  });

  test('3. Sales detail contains no BusinessPageHeader duplicate identity', () => {
    assert.doesNotMatch(salesDetailFn, /<BusinessPageHeader\b/);
  });

  test('4. Sales detail contains no HelpDisclosure 流程说明', () => {
    assert.doesNotMatch(salesDetailFn, /<HelpDisclosure\b/);
    assert.doesNotMatch(salesDetailFn, /销售订单审批只代表业务授权/);
    assert.doesNotMatch(salesDetailFn, /审批、出货、结算分别保持独立状态/);
  });

  test('5. Sales detail does not render MobileWorkflowProgress', () => {
    assert.doesNotMatch(salesDetailFn, /MobileWorkflowProgress/);
  });

  test('6. Sales detail does not present invoice / AR / settlement fake state', () => {
    // The fake-state row labels must not appear as searchable text inside
    // the sales detail rendering.
    assert.doesNotMatch(salesDetailFn, /销售发票/);
    assert.doesNotMatch(salesDetailFn, /应收账款/);
    assert.doesNotMatch(salesDetailFn, /收款 \/ 核销/);
    assert.doesNotMatch(salesDetailFn, /已全部出货/);
    assert.doesNotMatch(salesDetailFn, /部分出货/);
    assert.doesNotMatch(salesDetailFn, />已完成</);
  });

  test('7. Detail uses orderNo / customerName / totalCents / orderDate / requestedDeliveryDate / paymentTerms', () => {
    for (const token of [
      'order.orderNo',
      'order.customerName',
      'order.totalCents',
      'order.orderDate',
      'order.requestedDeliveryDate',
      'order.paymentTerms',
    ]) {
      assert.match(salesDetailFn, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  test('8. Detail lines use productName / productCode / quantity / unitPriceCents / amountCents', () => {
    assert.match(salesDetailFn, /item\.productName/);
    assert.match(salesDetailFn, /item\.productCode/);
    assert.match(salesDetailFn, /item\.quantity/);
    assert.match(salesDetailFn, /item\.unitPriceCents/);
    assert.match(salesDetailFn, /item\.amountCents/);
  });

  test('9. Detail progress uses trace.downstream only for delivery relation', () => {
    assert.match(salesDetailFn, /trace\?\.downstream \|\| \[\]/);
    assert.match(salesDetailFn, /api\(`\/api\/workflow\/sales-orders\/\$\{id\}`\)/);
  });

  test('10. Returns are derived only from actual downstream returns', () => {
    assert.match(salesDetailFn, /deliveries\.flatMap\(\(item\) => item\.returns \|\| \[\]\)/);
  });

  test('11. DRAFT / REJECTED editing remains available', () => {
    assert.match(salesDetailFn, /\['DRAFT', 'REJECTED'\]\.includes\(status\)/);
    assert.match(salesDetailFn, /onEdit\(order\)/);
  });

  test('12. SUBMIT still calls POST /api/orders/:id/submit', () => {
    assert.match(salesDetailFn, /api\(`\/api\/orders\/\$\{id\}\/submit`, \{ method: 'POST' \}\)/);
  });

  test('13. APPROVED sales-outbound navigation does not auto-create anything', () => {
    // SalesOrderDetailV16 navigates only via navigation.navigateToPage.
    assert.match(salesDetailFn, /navigation\.navigateToPage\('sales-deliveries'\)/);
    assert.doesNotMatch(salesDetailFn, /api\(['"`]\/api\/sales-deliveries/);
  });

  test('14. OrderEditor no longer renders Modal', () => {
    // The stub must not render Modal.
    assert.doesNotMatch(orderEditorStub, /<Modal\b/);
    assert.doesNotMatch(ordersFn, /<OrderEditor\b/);
    // SalesOrderEditorV16 must not use Modal either.
    assert.doesNotMatch(salesEditorFn, /<Modal\b/);
  });

  test('15. Sales editor no longer renders line-table / line-header', () => {
    assert.doesNotMatch(salesEditorFn, /className="line-table"/);
    assert.doesNotMatch(salesEditorFn, /className="line-row line-header"/);
  });

  test('16. Existing payload shape remains unchanged', () => {
    // The editor POST/PUT must continue to send the legacy body.
    assert.match(salesEditorFn, /order\.id \? `\/api\/orders\/\$\{order\.id\}` : '\/api\/orders'/);
    assert.match(salesEditorFn, /method: order\.id \? 'PUT' : 'POST'/);
    assert.match(salesEditorFn, /unitPriceCents: yuanToNonNegativeCents\(x\.price\)/);
  });

  test('17. applyCustomerSnapshot behavior remains', () => {
    assert.match(salesEditorFn, /function applyCustomerSnapshot\(customerId\)/);
    assert.match(salesEditorFn, /current\.shipToContactName \|\| customer\?\.contact/);
    assert.match(salesEditorFn, /paymentTermsDays: customer\?\.paymentTermsDays \?\? 0/);
  });

  test('18. Save remains draft-only', () => {
    // Save action text is 保存草稿 (no save-and-submit).
    assert.match(salesEditorFn, /'保存草稿'/);
  });

  test('19. No save-and-submit action exists', () => {
    assert.doesNotMatch(salesEditorFn, /保存并提交/);
    assert.doesNotMatch(salesDetailFn, /保存并提交/);
  });

  test('20. PurchaseOrderEditor unchanged by P3', () => {
    // The function must continue to use <Modal wide> for the purchase editor.
    assert.match(purchaseOrderEditorFn, /<Modal\b/);
    assert.match(purchaseOrderEditorFn, /className="line-table"/);
    // And must still call applySupplierSnapshot.
    assert.match(purchaseOrderEditorFn, /function applySupplierSnapshot\(supplierId\)/);
  });

  test('21. P2 sales-order LIST contracts remain intact', () => {
    // The P2 enterprise row, command row, status segment and list state
    // markup must continue to render in Orders LIST MODE.
    assert.match(ordersFn, /className="v16-sales-order-list"/);
    assert.match(ordersFn, /className="v16-sales-order-command"/);
    assert.match(ordersFn, /className="v16-sales-order-segments"/);
    // The P2 helper functions must still exist and be wired into the row
    // component rendered inside Orders LIST MODE.
    assert.match(masterData, /function orderStatusPresentation\b/);
    assert.match(masterData, /function orderDeliveryDateLabel\b/);
    assert.match(masterData, /function orderFulfillmentLabel\b/);
    assert.match(masterData, /orderStatusPresentation\(order\.status\)/);
    assert.match(masterData, /orderDeliveryDateLabel\(order\.requestedDeliveryDate\)/);
    assert.match(masterData, /orderFulfillmentLabel\(order\)/);
    // P2 list state branches remain.
    assert.match(ordersFn, /listState === 'LOADING'/);
    assert.match(ordersFn, /listState === 'EMPTY'/);
    assert.match(ordersFn, /listState === 'NO_RESULTS'/);
    assert.match(ordersFn, /listState === 'ERROR'/);
    assert.match(ordersFn, /listState === 'READY'/);
  });

  test('22. No backend / API / database / migration changes by P3', () => {
    const staged = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
    const lines = staged.split('\n').filter(Boolean);
    const forbidden = /^(?:.*\s)?(?:server\/app\.js|server\/db\.js|server\/database\/|server\/migrations\/|server\/modules\/|server\/lib\/|server\/index\.js)\b/;
    const offenders = lines.filter((line) => forbidden.test(line));
    assert.deepEqual(offenders, [], `P3 must not modify backend executable files: ${offenders.join('; ')}`);
    // OrderDocumentDetail is preserved unchanged so purchase detail still
    // branches through it.
    assert.match(orderDocumentDetailFn, /isSales = kind === 'sales'/);
    assert.match(orderDocumentDetailFn, /kind === 'sales'/);
    assert.match(purchaseOrderDetailFn, /kind="purchase"/);
  });
});