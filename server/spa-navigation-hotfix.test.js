import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer as createViteServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const appSource = read('src/App.jsx');
const workflowSource = read('src/components/MobileWorkflowProgress.jsx');
const masterSource = read('src/pages/master-data.jsx');
const logisticsSource = read('src/pages/logistics-finance.jsx');
const approvalSource = read('src/components/MobileApprovalCenter.jsx');

let vite;
let AppLink;
let AppNavigationProvider;
let MobileWorkflowProgress;
let RelationshipSections;
let relationshipPage;
let orderWorkflowStages;

before(async () => {
  vite = await createViteServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  ({ AppLink, AppNavigationProvider } = await vite.ssrLoadModule('/src/navigation/AppNavigationContext.jsx'));
  MobileWorkflowProgress = (await vite.ssrLoadModule('/src/components/MobileWorkflowProgress.jsx')).default;
  ({ RelationshipSections, relationshipPage } = await vite.ssrLoadModule('/src/pages/logistics-finance.jsx'));
  ({ orderWorkflowStages } = await vite.ssrLoadModule('/src/pages/master-data.jsx'));
});

after(async () => { await vite?.close(); });

function renderWithNavigation(child, allowed = true) {
  return renderToStaticMarkup(createElement(AppNavigationProvider, {
    value: { target: null, canNavigate: () => allowed, navigateToPage: () => true },
  }, child));
}

describe('canonical SPA navigation', () => {
  test('1 related navigation renders the canonical destination hash', () => {
    assert.match(renderWithNavigation(createElement(AppLink, { page: 'sales-deliveries' }, 'delivery')), /href="#sales-deliveries"/);
  });
  test('2 App navigation writes hash only when it differs', () => {
    assert.match(appSource, /location\.hash !== hash/);
  });
  test('3 no full reload mechanism is introduced', () => {
    for (const source of [appSource, workflowSource, masterSource, logisticsSource]) assert.doesNotMatch(source, /location\.reload|location\.replace|window\.location\.href\s*=/);
  });
  test('4 changing page replaces the old business component', () => {
    assert.match(appSource, /<RouteScreen route=\{route\}/);
    assert.match(appSource, /setMobileApplication\(\{ page: route\.key/);
  });
  test('5 MobileShell remains the stable mobile wrapper', () => {
    assert.match(appSource, /AppNavigationProvider[\s\S]*?<MobileShell[\s\S]*?<\/MobileShell>/);
  });
  test('6 unknown page key is rejected safely', () => {
    assert.match(appSource, /if \(normalized\.invalid \|\| !route \|\| !userCanAccessRoute\(user, route\)\)[\s\S]*?return false/);
  });
  test('7 unauthorized destinations render non-clickable text', () => {
    const html = renderWithNavigation(createElement(AppLink, { page: 'accounting' }, 'voucher'), false);
    assert.doesNotMatch(html, /<a/); assert.match(html, /<span>voucher<\/span>/);
  });
  test('hashchange uses the same canonical navigation function', () => {
    assert.match(appSource, /addEventListener\('hashchange', applyBrowserLocation\)/);
  });
  test('hash synchronization is idempotent', () => {
    assert.match(appSource, /canonicalHash !== location\.hash/);
    assert.match(appSource, /history\.replaceState\(null, '', canonicalHash\)/);
  });
});

describe('sales related-document navigation', () => {
  const salesTrace = { downstream: [{ id: 'sd-1', type: 'SALES_DELIVERY', documentNo: 'SD-1', returns: [{ id: 'sr-1', type: 'SALES_RETURN', documentNo: 'SR-1' }] }] };
  const stages = () => orderWorkflowStages({ orderNo: 'SO-1', status: 'APPROVED' }, salesTrace, 'sales');
  test('8 Sales Order → Sales Delivery targets the delivery page and exact id', () => {
    const stage = stages().find((item) => item.key === 'logistics'); assert.equal(stage.pageKey, 'sales-deliveries'); assert.equal(stage.documentId, 'sd-1');
  });
  test('9 Sales Delivery → Sales Order uses the orders page', () => { assert.equal(relationshipPage('SALES_ORDER'), 'orders'); });
  test('10 Sales Return → Sales Delivery uses the delivery page', () => { assert.equal(relationshipPage('SALES_DELIVERY'), 'sales-deliveries'); });
  test('11 linked Sales Return targets returns with exact id', () => { const stage=stages().find((item)=>item.key==='return'); assert.equal(stage.pageKey,'returns'); assert.equal(stage.documentId,'sr-1'); });
  test('workflow link carries document context through AppLink', () => {
    const html=renderWithNavigation(createElement(MobileWorkflowProgress,{stages:[stages().find((item)=>item.key==='logistics')]})); assert.match(html,/href="#sales-deliveries\/sd-1(?:\?documentType=SALES_DELIVERY)?"/); assert.match(html,/SD-1/);
  });
});

describe('purchase related-document navigation', () => {
  const purchaseTrace = { downstream: [{ id: 'pr-1', type: 'PURCHASE_RECEIPT', documentNo: 'PR-1', returns: [{ id: 'pret-1', type: 'PURCHASE_RETURN', documentNo: 'PRET-1' }] }] };
  const stages = () => orderWorkflowStages({ orderNo: 'PO-1', status: 'APPROVED' }, purchaseTrace, 'purchase');
  test('12 Purchase Order → Purchase Receipt targets receipt page', () => { const stage=stages().find((item)=>item.key==='logistics'); assert.equal(stage.pageKey,'purchase-receipts'); assert.equal(stage.documentId,'pr-1'); });
  test('13 Purchase Receipt → Purchase Order targets purchase orders', () => { assert.equal(relationshipPage('PURCHASE_ORDER'),'purchase-orders'); });
  test('14 Purchase Return → Purchase Receipt targets receipt page', () => { assert.equal(relationshipPage('PURCHASE_RECEIPT'),'purchase-receipts'); });
  test('15 linked Purchase Return targets returns with exact id', () => { const stage=stages().find((item)=>item.key==='return'); assert.equal(stage.pageKey,'returns'); assert.equal(stage.documentId,'pret-1'); });
});

describe('M3 and M5 related navigation audit', () => {
  test('16 approval detail currently exposes no raw original-document hash', () => { assert.doesNotMatch(approvalSource, /href=.*#|location\.hash/); });
  test('17 inventory movement sources are intentionally non-clickable (except M6 production sources)', () => {
    const section=logisticsSource.slice(logisticsSource.indexOf('export function InventoryTransactions'), logisticsSource.indexOf('// ============ Accounts Receivable'));
    assert.doesNotMatch(section, /AppLink page="purchase-receipts"/);
    assert.doesNotMatch(section, /AppLink page="sales-deliveries"/);
    assert.match(section, /item\.ref_no/);
    assert.match(section, /sourcePage\(item\.tx_type\)/);
  });
  test('18 unknown movement source remains safe text', () => { assert.match(logisticsSource, /typeMap\[item\.tx_type\] \|\| '库存异动'/); });
});

describe('navigation state and regression contracts', () => {
  test('19 navigation does not reset the authenticated session', () => {
    const block=appSource.slice(appSource.indexOf('const navigate = useCallback'), appSource.indexOf('const navigateToPage', appSource.indexOf('const navigate = useCallback')));
    assert.doesNotMatch(block, /setUser|setToken|logout/);
  });
  test('20 business pages are selected once through RouteScreen', () => { assert.equal((appSource.match(/<RouteScreen route=\{route\}/g)||[]).length,1); });
  test('21 related navigation keeps the Applications tab active', () => { assert.match(appSource, /const navigate = useCallback[\s\S]*?setMobileTab\('apps'\)/); });
  test('22 return to Applications still clears the selected application', () => { assert.match(appSource, /function returnToMobileApplications\(\)[\s\S]*?setMobileApplication\(null\)/); });
  test('23 one canonical shell is rendered without viewport branching', () => {
    assert.equal((appSource.match(/<MobileShell/g) || []).length, 1);
    assert.doesNotMatch(appSource, /isMobile|useMobile|useMediaQuery|matchMedia|innerWidth/);
  });
  test('24 M2 launcher uses canonical navigation', () => { assert.match(appSource, /function handleMobileApplicationSelect\(item\) \{[\s\S]*?navigate\(\{ routeKey: item\.page/); });
  test('25 M3 approval mutation dispatch is unchanged', () => { assert.match(approvalSource, /await api\(request\.path, request\.options\)/); });
  test('26 M4 relationship data rendering is unchanged', () => { assert.match(logisticsSource, /relation\.upstream/); assert.match(logisticsSource, /relation\.downstream/); });
  test('27 M5 inventory behavior code is outside navigation changes', () => { assert.match(masterSource, /INVENTORY_ADJUSTMENT_MANAGE/); assert.match(logisticsSource, /INVENTORY_ADJUSTMENT/); });
  test('28 registered permissions reflect Core Scope Cleanup', async () => {
    const { PERMISSIONS } = await import('../server/db.js');
    // M14 reached 113 entries; subsequent M5/V13 hardening added
    // SUPPLIERS_VIEW and INVENTORY_TRANSFER_CONFIRM (114); Core Scope
    // Cleanup removed CRM_VIEW, CRM_MANAGE, PROJECT_VIEW,
    // PROJECT_MANAGE (110).
    assert.equal(PERMISSIONS.length, 184);
  });
  test('exact targets initialize Sales Delivery and Purchase Receipt detail state', () => {
    assert.match(logisticsSource, /target\?\.page === 'sales-deliveries'[\s\S]{0,100}documentId/);
    assert.match(logisticsSource, /target\?\.page === 'purchase-receipts'[\s\S]{0,100}documentId/);
  });
  test('exact targets initialize sales and purchase return tabs safely', () => {
    assert.match(logisticsSource, /target\?\.documentType === 'PURCHASE_RETURN'/);
    assert.match(logisticsSource, /target\?\.page === 'returns' && target\.documentId/);
  });
  test('all inspected internal links use AppLink instead of raw hashes', () => {
    for (const source of [masterSource, logisticsSource, workflowSource]) assert.doesNotMatch(source, /href=["'{`]#/);
  });
});
