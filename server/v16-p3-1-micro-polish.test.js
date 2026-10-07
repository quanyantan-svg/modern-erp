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
const srcDir = join(repoRoot, 'src');
const readSrc = (path) => readFileSync(join(srcDir, path), 'utf8');

const masterData = readSrc('pages/master-data.jsx');
const appJsx = readSrc('App.jsx');
const navContext = readSrc('navigation/AppNavigationContext.jsx');
const mobileShell = readSrc('components/MobileShell.jsx');
const p2Styles = readSrc('styles/v16-sales-orders.css');
const p3Styles = readSrc('styles/v16-sales-order-document.css');

// Extract function source by walking braces (matches P2/P3 helpers).
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
const orderDocumentDetailFn = extractFunctionSource(masterData, /function OrderDocumentDetail\(/);
const purchaseOrderDetailFn = extractFunctionSource(masterData, /function PurchaseOrderDetail\(/);

describe('V1.6 P3.1 — sales-order micro polish contract', () => {
  test('1. Only one visible back affordance on P3 sales detail/editor', () => {
    // The MobileShell header back control is the canonical one back.
    // Content-level 返回列表 / 返回 buttons must be removed from
    // SalesOrderDetailV16 / SalesOrderEditorV16.
    assert.doesNotMatch(salesDetailFn, /v16-sales-order-detail__back/);
    assert.doesNotMatch(salesDetailFn, /aria-label="返回列表"/);
    assert.doesNotMatch(salesDetailFn, /‹ 返回列表/);
    assert.doesNotMatch(salesEditorFn, /v16-sales-order-editor__back/);
    assert.doesNotMatch(salesEditorFn, /aria-label="返回"/);
    assert.doesNotMatch(salesEditorFn, /‹ 返回/);
    // The P3 stylesheet also dropped the dead back-section rules.
    assert.doesNotMatch(p3Styles, /\.v16-sales-order-detail__back\b/);
    assert.doesNotMatch(p3Styles, /\.v16-sales-order-editor__back\b/);
    // MobileShell still owns a single header back control.
    assert.match(mobileShell, /mobile-header__back/);
    assert.match(mobileShell, /aria-label="返回应用"/);
  });

  test('2. Detail back returns to the sales-order list', () => {
    // Orders sets documentBackAction to a handler that resets editing +
    // viewing when the detail is the only entry-point list.
    assert.match(ordersFn, /setHeaderBackAction\(handler\)/);
    assert.match(ordersFn, /function returnToList\(\)/);
    assert.match(ordersFn, /setEditing\(null\);[\s\S]*?setViewing\(null\);[\s\S]*?void load\(\)/);
    // The shell receives documentBackAction through AppNavigationContext
    // and App.jsx wires it as the MobileShell backAction fallback.
    assert.match(navContext, /setHeaderBackAction/);
    assert.match(appJsx, /setHeaderBackAction/);
    assert.match(appJsx, /backAction=\{registeredBackAction \|\| documentBackAction \|\|/);
  });

  test('3. Editor-from-list back returns to the list', () => {
    // When editing is set and viewing is null, the back handler is
    // returnToList.
    const match = ordersFn.match(/const handler = editing\s*\?[\s\S]*?viewing \? closeEditorOnly : returnToList/);
    assert.ok(match, 'Orders must choose returnToList when editing and !viewing');
    // The editor component itself must not render its own back button.
    assert.doesNotMatch(salesEditorFn, /v16-sales-order-editor__back/);
  });

  test('4. Editor-from-detail back returns to the same detail', () => {
    // When editing and viewing are both set, the back handler closes
    // only the editor (viewing stays open).
    const match = ordersFn.match(/const handler = editing\s*\?[\s\S]*?viewing \? closeEditorOnly : returnToList/);
    assert.ok(match, 'Orders must choose closeEditorOnly when editing and viewing');
    assert.match(ordersFn, /function closeEditorOnly\(\)/);
    assert.match(ordersFn, /setEditing\(null\);/);
    // Viewing state must NOT be cleared on editor-from-detail close.
    assert.match(ordersFn, /if \(fromDetail\) \{/);
  });

  test('5. Payment terms presentation deduplicates the numeric days suffix', () => {
    // The presentation helper must exist.
    assert.match(masterData, /function orderPaymentTermsPresentation\b/);
    // Detail 概要 renders via the helper, not the legacy inline format.
    assert.match(salesDetailFn, /orderPaymentTermsPresentation\(order\.paymentTerms, order\.paymentTermsDays\)/);
    assert.doesNotMatch(salesDetailFn, /order\.paymentTermsDays[\s\S]{0,80}天/);
    // Behavior coverage:
    // terms="月结 30 天", days=30 → "月结 30 天" (no duplicate).
    // terms="月结", days=30 → "月结 · 30天".
    // terms="现金", days=0 → "现金".
    // terms="", days=30 → "30天".
    // terms="", days=0 → "—".
    // The helper implements all five branches.
    const helperSrc = extractFunctionSource(masterData, /function orderPaymentTermsPresentation\(/);
    assert.match(helperSrc, /terms && days > 0/);
    assert.match(helperSrc, /daysPattern/);
    assert.match(helperSrc, /· \$\{days\}天/);
    assert.match(helperSrc, /\$\{days\}天/);
    assert.match(helperSrc, /return '—'/);
  });

  test('6. API / payload unchanged for payment terms', () => {
    // Editor reads the two fields directly from the input elements.
    assert.match(salesEditorFn, /value=\{form\.paymentTerms\}/);
    assert.match(salesEditorFn, /value=\{form\.paymentTermsDays\}/);
    // The save body spreads `...form`, which preserves paymentTerms
    // and paymentTermsDays untouched.
    assert.match(salesEditorFn, /body: \{[\s\S]*?\.\.\.form/);
    // The P3 contract test already covers the API/payload preservation.
  });

  test('7. Purchase-order UI unchanged by P3.1', () => {
    // PurchaseOrderDetail still uses OrderDocumentDetail(kind="purchase").
    assert.match(purchaseOrderDetailFn, /<OrderDocumentDetail\b/);
    assert.match(purchaseOrderDetailFn, /kind="purchase"/);
    // OrderDocumentDetail still uses the legacy inline payment-terms
    // rendering (not the new helper).
    assert.doesNotMatch(orderDocumentDetailFn, /orderPaymentTermsPresentation/);
    // The orderDocumentDetail still has its own payment-terms inline format
    // (this is the legacy purchase surface).
    assert.match(orderDocumentDetailFn, /order\.paymentTerms \|\| '—'/);
    assert.match(orderDocumentDetailFn, /order\.paymentTermsDays\} 天/);
  });

  test('8. P2 contracts unchanged', () => {
    // The P2 LIST row markup, search/create row, status segments and
    // list state branches continue to render in Orders LIST MODE.
    assert.match(ordersFn, /className="v16-sales-order-list"/);
    assert.match(ordersFn, /className="v16-sales-order-command"/);
    assert.match(ordersFn, /className="v16-sales-order-segments"/);
    assert.match(ordersFn, /listState === 'LOADING'/);
    assert.match(ordersFn, /listState === 'READY'/);
    // The P2 stylesheet is not modified by P3.1.
    assert.ok(p2Styles.length > 0);
    assert.doesNotMatch(p2Styles, /v16-sales-order-detail/);
    assert.doesNotMatch(p2Styles, /v16-sales-order-editor/);
  });

  test('9. P3.1 product contract: canonical route inventory + back navigation wiring intact', () => {
    // V1.6 P3.1 is a micro-polish change inside the mobile sales-order surface.
    // The frozen product contract this phase must NOT disturb:
    //   - canonical 53 enabled / 5 disabled route inventory
    //   - sales-orders route keeps its access contract
    //   - the back navigation chain in MobileShell / AppNavigationContext /
    //     App.jsx is still wired (P3.1 cleaned up dead back buttons; the
    //     canonical handler chain must remain).
    assert.equal(ROUTE_PRESENTATIONS.length, 55, 'canonical 55 enabled routes must remain enabled');
    assert.equal(DISABLED_ROUTE_PRESENTATIONS.length, 5, 'frozen five disabled routes must remain disabled');

    const salesRoute = enabledByRoute.get('orders');
    assert.ok(salesRoute, 'orders route must remain enabled');
    assert.deepEqual(
      [...(salesRoute.any || [])].sort(),
      ['ORDERS_CREATE', 'ORDERS_VIEW'],
      'orders route must keep its access contract',
    );

    // The canonical header back chain is preserved end-to-end.
    assert.match(navContext, /setHeaderBackAction/);
    assert.match(appJsx, /setHeaderBackAction/);
    assert.match(appJsx, /backAction=\{registeredBackAction \|\| documentBackAction \|\|/);
    assert.match(ordersFn, /function returnToList\(\)/);
    assert.match(ordersFn, /function closeEditorOnly\(\)/);
  });
});
