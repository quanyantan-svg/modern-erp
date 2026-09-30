import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = join(repoRoot, 'src');
const serverDir = join(repoRoot, 'server');
const stylesDir = join(srcDir, 'styles');
const readSrc = (path) => readFileSync(join(srcDir, path), 'utf8');
const readServer = (path) => readFileSync(join(serverDir, path), 'utf8');
const readStyles = (path) => readFileSync(join(stylesDir, path), 'utf8');

const masterData = readSrc('pages/master-data.jsx');
const v16Tokens = readStyles('v16-tokens.css');
const v16Enterprise = readStyles('v16-mobile-enterprise.css');
const mainJsx = readSrc('main.jsx');
const v16SalesOrdersCss = readStyles('v16-sales-orders.css');

// Extract just the `Orders` function body so the contract checks are scoped to
// the LIST MODE branch and don't accidentally pick up PurchaseOrders strings.
function extractFunctionSource(source, signature) {
  const startMatch = source.match(signature);
  assert.ok(startMatch, `Function signature ${signature} must exist in source`);
  const start = startMatch.index;
  // Walk forward from the start of the signature, find the function's opening
  // brace (the brace AFTER the parameter list, not a destructured `{` inside
  // the parameter list), then track depth.
  let i = source.indexOf('(', startMatch.index);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        // Move to first non-whitespace, expect `{`.
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

function extractOrdersListSource() {
  return extractFunctionSource(masterData, /export function Orders\(/);
}

function extractSalesOrderListRowSource() {
  return extractFunctionSource(masterData, /function SalesOrderListRow\(/);
}

const ordersList = extractOrdersListSource();
const listRow = extractSalesOrderListRowSource();

describe('V1.6 P2 — sales order LIST contracts', () => {
  test('1. Orders LIST branch no longer imports or renders CompactRecord / CompactRecordList', () => {
    assert.doesNotMatch(ordersList, /<CompactRecord\b/);
    assert.doesNotMatch(ordersList, /<CompactRecordList\b/);
    // The component file may still import CompactRecord for PurchaseOrders.
    // We only require the Orders LIST branch to not render either component.
    // Confirm by checking that the actual JSX in the Orders LIST branch uses
    // SalesOrderListRow only.
    assert.match(ordersList, /<SalesOrderListRow\b/);
  });

  test('2. Orders LIST branch no longer renders BusinessPageHeader title="销售订单"', () => {
    assert.doesNotMatch(ordersList, /<BusinessPageHeader\b/);
  });

  test('3. Orders LIST branch no longer renders permanent <HelpDisclosure summary="流程说明"> paragraph', () => {
    assert.doesNotMatch(ordersList, /<HelpDisclosure\b/);
    assert.doesNotMatch(ordersList, /销售订单审批只代表业务授权，不等于已经出货/);
    assert.doesNotMatch(ordersList, /审批完成后，实际履约继续通过销售出货处理/);
  });

  test('4. Exact status filter labels remain 全部 / 草稿 / 待审批 / 已审批 / 已驳回', () => {
    assert.match(masterData, /\{ value: '', label: '全部' \}/);
    assert.match(masterData, /\{ value: 'DRAFT', label: '草稿' \}/);
    assert.match(masterData, /\{ value: 'SUBMITTED', label: '待审批' \}/);
    assert.match(masterData, /\{ value: 'APPROVED', label: '已审批' \}/);
    assert.match(masterData, /\{ value: 'REJECTED', label: '已驳回' \}/);
    // The Orders LIST must still consume ORDER_STATUS_OPTIONS.
    assert.match(ordersList, /options=\{ORDER_STATUS_OPTIONS\}/);
  });

  test('5. List filter labels must not include 待出货 / 部分出货 / 已出货 / 已完成', () => {
    assert.doesNotMatch(ordersList, /'待出货'/);
    assert.doesNotMatch(ordersList, /'部分出货'/);
    assert.doesNotMatch(ordersList, /'已出货'/);
    assert.doesNotMatch(ordersList, /'已完成'/);
  });

  test('6. requestedDeliveryDate drives the displayed delivery commitment', () => {
    assert.match(listRow, /order\.requestedDeliveryDate/);
    // Helper exists and renders 交期 MM-DD inside a template literal.
    assert.match(masterData, /function orderDeliveryDateLabel/);
    assert.match(masterData, /交期 \$\{part/);
  });

  test('7. createdAt is NOT used as a delivery-date fallback', () => {
    // The dedicated helper must not consult createdAt inside its body.
    const helperSrc = extractFunctionSource(masterData, /function orderDeliveryDateLabel\(/);
    assert.doesNotMatch(helperSrc, /createdAt/);
    // The list row meta line must use the dedicated helper output and not
    // fall back to createdAt.
    assert.match(listRow, /orderDeliveryDateLabel\(order\.requestedDeliveryDate\)/);
    assert.doesNotMatch(listRow, /createdAt/);
  });

  test('8. Normal list row reads orderNo / customerName / requestedDeliveryDate / totalCents / itemCount', () => {
    assert.match(listRow, /order\.orderNo/);
    assert.match(listRow, /order\.customerName/);
    assert.match(listRow, /order\.requestedDeliveryDate/);
    assert.match(listRow, /order\.totalCents/);
    assert.match(listRow, /order\.itemCount/);
  });

  test('9. Approved fulfillment context maps deliveryCount correctly', () => {
    assert.match(masterData, /function orderFulfillmentLabel/);
    assert.match(masterData, /order\.status !== 'APPROVED'[\s\S]*?return null/);
    // deliveryCount === 0 → 待出货
    assert.match(masterData, /Number\(order\.deliveryCount\) \|\| 0[\s\S]*?return '待出货'/);
    // deliveryCount > 0 → 已关联 N 张出货单
    assert.match(masterData, /`已关联 \$\{count\} 张出货单`/);
    // Wired into the row.
    assert.match(listRow, /orderFulfillmentLabel\(order\)/);
  });

  test('10. Source does NOT infer 已完成 / 已全部出货 / 部分出货 from deliveryCount', () => {
    assert.doesNotMatch(listRow, /已完成/);
    assert.doesNotMatch(listRow, /已全部出货/);
    assert.doesNotMatch(listRow, /部分出货/);
    assert.doesNotMatch(masterData.match(/function orderFulfillmentLabel[\s\S]*?\n\}/)[0],
      /已完成|已全部出货|部分出货/);
  });

  test('11. creatorName / createdAt / updatedAt / submittedAt / reviewedAt are not rendered in the list row', () => {
    for (const field of ['creatorName', 'createdAt', 'updatedAt', 'submittedAt', 'reviewedAt']) {
      assert.doesNotMatch(listRow, new RegExp(`order\\.${field}`));
    }
  });

  test('12. Rejected reason is conditional on REJECTED status', () => {
    assert.match(listRow, /order\.status === 'REJECTED' \? order\.rejectionReason : null/);
    assert.match(listRow, /驳回：\{rejection\}/);
    // Must not render for non-rejected orders.
    assert.doesNotMatch(listRow, /驳回：\{order\.rejectionReason\}/);
  });

  test('13. Draft edit/delete remains available through overflow', () => {
    assert.match(listRow, /onEdit\(order\)/);
    assert.match(listRow, /onDelete\(order\)/);
    assert.match(listRow, /<ConfirmDelete\b/);
    assert.match(listRow, /buttonLabel="删除草稿"/);
    assert.match(listRow, /未提交草稿删除后无法恢复/);
    // Orders LIST still wires both callbacks.
    assert.match(ordersList, /onEdit=\{\(row\) => setEditing\(row\)\}/);
    assert.match(ordersList, /onDelete=\{deleteOrder\}/);
  });

  test('14. P2 did not modify server / API / database / migration / business logic files', () => {
    const staged = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
    const lines = staged.split('\n').filter(Boolean);
    const forbidden = /^(?:.*\s)?(?:server\/app\.js|server\/db\.js|server\/database\/|server\/migrations\/|server\/modules\/|server\/lib\/|server\/index\.js)\b/;
    const offenders = lines.filter((line) => forbidden.test(line));
    assert.deepEqual(offenders, [], `P2 must not modify backend executable files: ${offenders.join('; ')}`);
  });

  test('15. P1 / P1.1 contracts remain unchanged', () => {
    // Five-tab bottom navigation.
    const mobileShell = readSrc('components/MobileShell.jsx');
    for (const token of ["key: 'messages'", "key: 'approvals'", "key: 'apps'", "key: 'workspace'", "key: 'profile'"]) {
      assert.match(mobileShell, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.doesNotMatch(mobileShell, /key:\s*'cloud'/);
    // Six launcher groups.
    const applicationMetadata = readSrc('navigation/applicationMetadata.js');
    for (const group of ['基础资料', '销售管理', '生产管理', '采购管理', '库存管理', '决策报表']) {
      assert.match(applicationMetadata, new RegExp(group));
    }
    // Workspace sections.
    assert.match(masterData, /v16-workspace__section-title/);
    assert.match(masterData, /待处理|最近业务|常用操作/);
    // Brand + module colors frozen.
    assert.match(v16Tokens, /--v16-brand:\s*#1769E0/i);
    assert.match(v16Tokens, /--v16-module-sales:\s*#1769E0/i);
    // No glassmorphism.
    assert.doesNotMatch(v16Enterprise, /backdrop-filter\s*:\s*blur/i);
  });
});

describe('V1.6 P2 — stylesheet isolation', () => {
  test('v16-sales-orders.css exists and is loaded by main.jsx', () => {
    assert.ok(existsSync(join(stylesDir, 'v16-sales-orders.css')), 'v16-sales-orders.css must exist');
    assert.ok(statSync(join(stylesDir, 'v16-sales-orders.css')).size > 0);
    const imports = mainJsx.match(/import\s+['"][^'"]*v16-[^'"]*['"]/g) || [];
    assert.deepEqual(imports, [
      "import './styles/v16-tokens.css'",
      "import './styles/v16-mobile-enterprise.css'",
      "import './styles/v16-sales-orders.css'",
    ]);
  });

  test('P2 styles are scoped to v16-sales-orders prefix and not appended to styles.css', () => {
    const legacyStyles = readSrc('styles.css');
    assert.doesNotMatch(legacyStyles, /\.v16-sales-orders/);
    assert.match(v16SalesOrdersCss, /\.v16-mobile-enterprise\s+\.v16-sales-orders/);
    assert.match(v16SalesOrdersCss, /\.v16-sales-order-row\b/);
    assert.match(v16SalesOrdersCss, /\.v16-sales-order-status\b/);
    assert.match(v16SalesOrdersCss, /\.v16-sales-order-fulfillment\b/);
    assert.match(v16SalesOrdersCss, /\.v16-sales-order-rejection\b/);
  });

  test('P2 styles do not use broad global selectors and avoid backdrop-filter glassmorphism', () => {
    // Sanity: no rule targeting `body`, `html`, or unprefixed `.order-...`.
    assert.doesNotMatch(v16SalesOrdersCss, /^\s*(body|html)\b/m);
    assert.doesNotMatch(v16SalesOrdersCss, /backdrop-filter\s*:\s*blur/i);
  });
});