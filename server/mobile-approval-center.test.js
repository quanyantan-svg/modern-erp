import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer as createViteServer } from 'vite';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const approvalSource = readFileSync(join(root, 'src', 'components', 'MobileApprovalCenter.jsx'), 'utf8');
const appSource = readFileSync(join(root, 'src', 'App.jsx'), 'utf8');
const shellSource = readFileSync(join(root, 'src', 'components', 'MobileShell.jsx'), 'utf8');
const backendSource = readFileSync(join(root, 'server', 'modules', 'approvals.js'), 'utf8');
const appBackendSource = readFileSync(join(root, 'server', 'app.js'), 'utf8');
const css = readFileSync(join(root, 'src', 'styles.css'), 'utf8');

let db;
let httpServer;
let baseUrl;
let tempDir;
let vite;
let ApprovalCard;
let ApprovalDetail;
let ApprovalListState;
let ApprovalTabs;
let APPROVAL_TABS;
let approvalActionRequest;
let MobileApprovalCenter;
let MobileShell;
const tokens = {};

const future = '2099-06-01T08:00:00.000Z';
const handled = '2099-06-02T08:00:00.000Z';

function seedFixtures() {
  const inventoryQuantity = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity;
  const insertSales = db.prepare(`INSERT INTO sales_orders
    (id,order_no,customer_id,status,total_cents,remark,rejection_reason,creator_id,reviewer_id,submitted_at,reviewed_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertSales.run('z-so-pending','SO-M3-PENDING','customer-001','SUBMITTED',123400,'sales pending','','user-sales',null,future,null,future,future);
  insertSales.run('r-so-reject-target','SO-M3-REJECT-TARGET','customer-001','SUBMITTED',133400,'sales reject target','','user-sales',null,future,null,future,future);
  insertSales.run('self-so-pending','SO-M3-SELF','customer-001','SUBMITTED',143400,'sales self','','user-admin',null,future,null,future,future);
  insertSales.run('m3-so-approved','SO-M3-APPROVED','customer-001','APPROVED',223400,'sales approved','','user-sales','user-admin',future,handled,future,handled);
  insertSales.run('m3-so-rejected','SO-M3-REJECTED','customer-001','REJECTED',323400,'sales rejected','budget','user-sales','user-admin',future,handled,future,handled);
  insertSales.run('m3-so-created','SO-M3-CREATED','customer-001','DRAFT',423400,'sales own','','user-admin',null,null,null,future,future);
  for (const id of ['z-so-pending','r-so-reject-target','self-so-pending','m3-so-approved','m3-so-rejected','m3-so-created']) {
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES(?,?,?,?,?,?,?)`).run(`${id}-line`,id,'product-001',1,123400,123400,1);
  }

  const insertPurchase = db.prepare(`INSERT INTO purchase_orders
    (id,order_no,supplier_id,status,total_cents,remark,rejection_reason,creator_id,reviewer_id,submitted_at,reviewed_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertPurchase.run('y-po-pending','PO-M3-PENDING','supplier-001','SUBMITTED',140000,'purchase pending','','user-sales',null,future,null,future,future);
  insertPurchase.run('q-po-reject-target','PO-M3-REJECT-TARGET','supplier-001','SUBMITTED',150000,'purchase reject target','','user-sales',null,future,null,future,future);
  insertPurchase.run('m3-po-approved','PO-M3-APPROVED','supplier-001','APPROVED',240000,'purchase approved','','user-sales','user-admin',future,handled,future,handled);
  insertPurchase.run('m3-po-rejected','PO-M3-REJECTED','supplier-001','REJECTED',340000,'purchase rejected','price','user-sales','user-admin',future,handled,future,handled);
  insertPurchase.run('m3-po-created','PO-M3-CREATED','supplier-001','DRAFT',440000,'purchase own','','user-admin',null,null,null,future,future);
  for (const id of ['y-po-pending','q-po-reject-target','m3-po-approved','m3-po-rejected','m3-po-created']) {
    db.prepare(`INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES(?,?,?,?,?,?,?)`).run(`${id}-line`,id,'product-001',1,140000,140000,1);
  }

  const insertCheck = db.prepare(`INSERT INTO inventory_checks
    (id,check_no,warehouse_id,status,checked_at,creator_id,created_at,product_id,system_quantity,actual_quantity,difference,reason,reviewer_id,reviewed_at,remark)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertCheck.run('x-check-pending','IC-M3-PENDING','warehouse-001','SUBMITTED',future,'user-warehouse',future,'product-001',inventoryQuantity,inventoryQuantity + 2,2,'count',null,null,'');
  insertCheck.run('m3-check-approved','IC-M3-APPROVED','warehouse-001','APPROVED',future,'user-warehouse',future,'product-001',10,12,2,'count','user-admin',handled,'');
  insertCheck.run('m3-check-created','IC-M3-CREATED','warehouse-001','DRAFT',null,'user-admin',future,'product-001',10,10,0,'',null,null,'');

  const insertVoucher = db.prepare(`INSERT INTO accounting_vouchers
    (id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at,status,period,approver_id,approved_at,updated_at,rejection_reason,submitted_at,submitted_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertVoucher.run('w-voucher-pending','VCH-M3-PENDING','MANUAL','w-voucher-pending','2099-06-01','voucher pending','user-accounting',future,'SUBMITTED','2099-06',null,null,future,'',future,'user-accounting');
  insertVoucher.run('p-voucher-reject-target','VCH-M3-REJECT-TARGET','MANUAL','p-voucher-reject-target','2099-06-01','voucher reject target','user-accounting',future,'SUBMITTED','2099-06',null,null,future,'',future,'user-accounting');
  insertVoucher.run('m3-voucher-approved','VCH-M3-APPROVED','MANUAL','m3-voucher-approved','2099-06-01','voucher approved','user-accounting',future,'POSTED','2099-06','user-admin',handled,handled,'',future,'user-accounting');
  insertVoucher.run('m3-voucher-rejected','VCH-M3-REJECTED','MANUAL','m3-voucher-rejected','2099-06-01','voucher rejected','user-accounting',future,'REJECTED','2099-06','user-admin',handled,handled,'missing file',future,'user-accounting');
  insertVoucher.run('m3-voucher-created','VCH-M3-CREATED','MANUAL','m3-voucher-created','2099-06-01','voucher own','user-admin',future,'ENTERED','2099-06',null,null,future,'',null,null);
  for (const id of ['w-voucher-pending','p-voucher-reject-target','m3-voucher-approved','m3-voucher-rejected','m3-voucher-created']) {
    db.prepare('INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES(?,?,?,?,?,?)').run(`${id}-d`,id,'subject-001','DEBIT',560000,'debit');
    db.prepare('INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES(?,?,?,?,?,?)').run(`${id}-c`,id,'subject-002','CREDIT',560000,'credit');
  }

  const insertPurchaseReq = db.prepare(`INSERT INTO purchase_requisitions
    (id,requisition_no,status,required_date,notes,rejection_reason,creator_id,reviewer_id,submitted_at,reviewed_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  insertPurchaseReq.run('z-pr-pending','PR-M3-PENDING','SUBMITTED','2099-06-30','pr pending','','user-sales',null,future,null,future,future);
  insertPurchaseReq.run('r-pr-reject-target','PR-M3-REJECT-TARGET','SUBMITTED','2099-06-30','pr reject target','','user-sales',null,future,null,future,future);
  insertPurchaseReq.run('self-pr-pending','PR-M3-SELF','SUBMITTED','2099-06-30','pr self','','user-admin',null,future,null,future,future);
  insertPurchaseReq.run('m3-pr-approved','PR-M3-APPROVED','APPROVED','2099-06-30','pr approved','','user-sales','user-admin',future,handled,future,handled);
  insertPurchaseReq.run('m3-pr-rejected','PR-M3-REJECTED','REJECTED','2099-06-30','pr rejected','budget','user-sales','user-admin',future,handled,future,handled);
  insertPurchaseReq.run('m3-pr-created','PR-M3-CREATED','DRAFT','2099-06-30','pr own','','user-admin',null,null,null,future,future);
  for (const id of ['z-pr-pending','r-pr-reject-target','self-pr-pending','m3-pr-approved','m3-pr-rejected','m3-pr-created']) {
    db.prepare(`INSERT INTO purchase_requisition_items(id,requisition_id,product_id,quantity,unit_price_cents,amount_cents,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(`${id}-line`,id,'product-001',1,123400,123400,future);
  }
}

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  tokens[username] = data.token;
}

async function request(path, username = 'admin', options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[username]}`, ...options.headers }, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-m3r-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  seedFixtures();
  httpServer = createServer(createApp(db, { distDir: resolve(root, 'dist') }));
  await new Promise((resolveListen) => httpServer.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  await login('admin', 'admin123'); await login('sales', 'sales123'); await login('reviewer', 'review123'); await login('warehouse', 'warehouse123'); await login('accounting', 'accounting123');
  vite = await createViteServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  const module = await vite.ssrLoadModule('/src/components/MobileApprovalCenter.jsx');
  ({ ApprovalCard, ApprovalDetail, ApprovalListState, ApprovalTabs, APPROVAL_TABS, approvalActionRequest } = module);
  MobileApprovalCenter = module.default;
  MobileShell = (await vite.ssrLoadModule('/src/components/MobileShell.jsx')).default;
});

after(async () => {
  await vite?.close();
  await new Promise((resolveClose, reject) => httpServer.close((error) => error ? reject(error) : resolveClose()));
  db.close(); rmSync(tempDir, { recursive: true, force: true });
});

describe('M3R approval aggregation API', () => {
  test('requires authentication', async () => { assert.equal((await fetch(`${baseUrl}/api/approvals`)).status, 401); });
  test('rejects an unknown tab', async () => { assert.equal((await request('/api/approvals?tab=nope')).status, 400); });
  test('defaults to pending and limit 50', async () => { const { data } = await request('/api/approvals'); assert.equal(data.tab, 'pending'); assert.equal(data.limit, 50); });
  test('caps the limit at 100', async () => { assert.equal((await request('/api/approvals?limit=500')).data.limit, 100); });
  test('normalizes invalid limit to 50', async () => { assert.equal((await request('/api/approvals?limit=bad')).data.limit, 50); });
  test('returns all four count buckets in one request', async () => { assert.deepEqual(Object.keys((await request('/api/approvals')).data.counts), ['pending','approved','rejected','created']); });
  test('admin pending includes exactly the five supported document types', async () => { const types = new Set((await request('/api/approvals')).data.items.filter((i) => i.submittedAt === future).map((i) => i.documentType)); assert.deepEqual(types, new Set(['SALES_ORDER','PURCHASE_ORDER','INVENTORY_CHECK','ACCOUNTING_VOUCHER','PURCHASE_REQUISITION'])); });
  test('pending excludes self-created documents', async () => { assert.ok(!(await request('/api/approvals')).data.items.some((item) => item.initiatorId === 'user-admin')); });
  test('approved returns records handled by current actor', async () => { const items = (await request('/api/approvals?tab=approved')).data.items; assert.ok(items.some((i) => i.documentNo === 'SO-M3-APPROVED')); assert.ok(items.every((i) => i.handlerName === '系统管理员')); });
  test('rejected returns records handled by current actor', async () => { const items = (await request('/api/approvals?tab=rejected')).data.items; assert.ok(items.some((i) => i.documentNo === 'VCH-M3-REJECTED')); assert.ok(items.every((i) => i.status === 'REJECTED')); });
  test('inventory check is absent from rejected because it has no reject transition', async () => { assert.ok(!(await request('/api/approvals?tab=rejected')).data.items.some((i) => i.documentType === 'INVENTORY_CHECK')); });
  test('created returns only documents initiated by current actor', async () => { assert.ok((await request('/api/approvals?tab=created')).data.items.every((i) => i.initiatorId === 'user-admin')); });
  test('reviewer visibility covers sales, purchase and purchase requisition approvals', async () => { const types = new Set((await request('/api/approvals', 'reviewer')).data.items.map((i) => i.documentType)); assert.deepEqual(types, new Set(['SALES_ORDER','PURCHASE_ORDER','PURCHASE_REQUISITION'])); });
  test('sales role cannot see pending approvals without approval permission', async () => { assert.deepEqual((await request('/api/approvals', 'sales')).data.items, []); });
  test('accounting role cannot see pending voucher approvals without VOUCHER_APPROVE', async () => { assert.deepEqual((await request('/api/approvals', 'accounting')).data.items, []); });
  test('warehouse role cannot use legacy transfer approval permission to see approval items', async () => { assert.deepEqual((await request('/api/approvals', 'warehouse')).data.items, []); });
  test('inventory transfers never appear in any tab', async () => { for (const tab of ['pending','approved','rejected','created']) assert.ok(!(await request(`/api/approvals?tab=${tab}`)).data.items.some((i) => i.documentType.includes('TRANSFER'))); });
  test('unrelated operational documents never appear', () => { assert.doesNotMatch(backendSource, /PURCHASE_RECEIPT|SALES_DELIVERY|SALES_RETURN|PURCHASE_RETURN|\bIQC\b|\bOQC\b|PRODUCTION_ORDER/); });
  test('results use stable timestamp then id descending order', async () => { const items = (await request('/api/approvals')).data.items.filter((i) => i.submittedAt === future); const sorted = [...items].sort((a,b) => b.documentId.localeCompare(a.documentId)); assert.deepEqual(items.map((i) => i.documentId), sorted.map((i) => i.documentId)); });
  test('response contains normalized card and detail fields', async () => { const item = (await request('/api/approvals')).data.items.find((i) => i.documentNo === 'SO-M3-PENDING'); for (const key of ['key','documentType','documentTypeLabel','documentId','documentNo','status','statusLabel','initiatorName','createdAt','submittedAt','amountCents','summary','itemCount','lines','canApprove','canReject']) assert.ok(Object.hasOwn(item,key), key); });
  test('sales amount remains integer cents', async () => { assert.equal((await request('/api/approvals')).data.items.find((i) => i.documentNo === 'SO-M3-PENDING').amountCents, 123400); });
  test('voucher amount derives from debit entries in integer cents', async () => { assert.equal((await request('/api/approvals')).data.items.find((i) => i.documentNo === 'VCH-M3-PENDING').amountCents, 560000); });
  test('order line preview is bounded and normalized', async () => { const lines = (await request('/api/approvals')).data.items.find((i) => i.documentNo === 'SO-M3-PENDING').lines; assert.equal(lines.length, 1); assert.ok(lines[0].productName); assert.equal(lines[0].amountCents, 123400); });
  test('voucher line preview is bounded and normalized', async () => { const lines = (await request('/api/approvals')).data.items.find((i) => i.documentNo === 'VCH-M3-PENDING').lines; assert.equal(lines.length, 2); assert.ok(lines.every((line) => Number.isSafeInteger(line.amountCents))); });
  test('inventory check exposes quantities and no reject action', async () => { const item = (await request('/api/approvals')).data.items.find((i) => i.documentNo === 'IC-M3-PENDING'); assert.equal(item.difference, 2); assert.equal(item.canApprove, true); assert.equal(item.canReject, false); });
  test('read endpoint is registered after authentication', () => { assert.ok(appBackendSource.indexOf("const actor = authenticate") < appBackendSource.indexOf("pathname === '/api/approvals'")); });
  test('aggregation defines no generic mutation endpoint', () => { assert.doesNotMatch(appBackendSource, /\/api\/approvals\/[^']+.*(?:POST|PATCH|DELETE)/); });
});

describe('M3R existing workflow dispatch contracts', () => {
  const item = (documentType) => ({ documentType, documentId: 'doc 1' });
  test('sales approve uses existing endpoint', () => { assert.deepEqual(approvalActionRequest(item('SALES_ORDER'),'approve'), { path:'/api/orders/doc%201/approve', options:{ method:'POST' } }); });
  test('sales reject uses reason contract', () => { assert.deepEqual(approvalActionRequest(item('SALES_ORDER'),'reject','why').options.body, { reason:'why' }); });
  test('purchase approve uses existing endpoint', () => { assert.equal(approvalActionRequest(item('PURCHASE_ORDER'),'approve').path, '/api/purchase-orders/doc%201/approve'); });
  test('purchase reject uses reason contract', () => { assert.deepEqual(approvalActionRequest(item('PURCHASE_ORDER'),'reject','why').options.body, { reason:'why' }); });
  test('inventory check approve uses PATCH action contract', () => { assert.deepEqual(approvalActionRequest(item('INVENTORY_CHECK'),'approve'), { path:'/api/inventory-checks/doc%201', options:{ method:'PATCH', body:{ action:'APPROVE' } } }); });
  test('inventory check reject is unavailable', () => { assert.throws(() => approvalActionRequest(item('INVENTORY_CHECK'),'reject'), /不支持/); });
  test('voucher approve uses existing endpoint', () => { assert.equal(approvalActionRequest(item('ACCOUNTING_VOUCHER'),'approve').path, '/api/accounting-vouchers/doc%201/approve'); });
  test('voucher reject uses rejectionReason contract', () => { assert.deepEqual(approvalActionRequest(item('ACCOUNTING_VOUCHER'),'reject','why').options.body, { rejectionReason:'why' }); });
  test('purchase requisition approve uses existing endpoint', () => { assert.deepEqual(approvalActionRequest(item('PURCHASE_REQUISITION'),'approve'), { path:'/api/purchase-requisitions/doc%201/approve', options:{ method:'POST' } }); });
  test('purchase requisition reject uses reason contract', () => { assert.deepEqual(approvalActionRequest(item('PURCHASE_REQUISITION'),'reject','why').options.body, { reason:'why' }); });
  test('inventory transfer has no dispatch path', () => { assert.throws(() => approvalActionRequest(item('INVENTORY_TRANSFER'),'approve'), /不支持/); });
});

describe('M3R actions reuse existing state machines', () => {
  test('an actor without approval permission remains forbidden', async () => { assert.equal((await request('/api/orders/z-so-pending/approve','sales',{method:'POST'})).status, 403); });
  test('self approval remains blocked by the sales state machine', async () => { assert.equal((await request('/api/orders/self-so-pending/approve','admin',{method:'POST'})).status, 409); });
  test('sales order approve moves the item from pending to approved', async () => { assert.equal((await request('/api/orders/z-so-pending/approve','admin',{method:'POST'})).status, 200); assert.ok(!(await request('/api/approvals')).data.items.some((i) => i.documentId === 'z-so-pending')); assert.ok((await request('/api/approvals?tab=approved')).data.items.some((i) => i.documentId === 'z-so-pending')); });
  test('repeat sales approval is rejected by the existing state guard', async () => { assert.equal((await request('/api/orders/z-so-pending/approve','admin',{method:'POST'})).status, 409); });
  test('sales order reject records the reason and moves tabs', async () => { assert.equal((await request('/api/orders/r-so-reject-target/reject','admin',{method:'POST',body:{reason:'mobile reason'}})).status, 200); const item=(await request('/api/approvals?tab=rejected')).data.items.find((i)=>i.documentId==='r-so-reject-target'); assert.equal(item.rejectionReason,'mobile reason'); });
  test('purchase order approve moves the item to approved', async () => { assert.equal((await request('/api/purchase-orders/y-po-pending/approve','admin',{method:'POST'})).status, 200); assert.ok((await request('/api/approvals?tab=approved')).data.items.some((i)=>i.documentId==='y-po-pending')); });
  test('purchase order reject records the reason', async () => { assert.equal((await request('/api/purchase-orders/q-po-reject-target/reject','admin',{method:'POST',body:{reason:'price mismatch'}})).status, 200); assert.equal((await request('/api/approvals?tab=rejected')).data.items.find((i)=>i.documentId==='q-po-reject-target').rejectionReason,'price mismatch'); });
  test('purchase requisition approve moves the item to approved', async () => { assert.equal((await request('/api/purchase-requisitions/z-pr-pending/approve','admin',{method:'POST'})).status, 200); assert.ok((await request('/api/approvals?tab=approved')).data.items.some((i)=>i.documentId==='z-pr-pending')); });
  test('purchase requisition reject records the reason', async () => { assert.equal((await request('/api/purchase-requisitions/r-pr-reject-target/reject','admin',{method:'POST',body:{reason:'budget tight'}})).status, 200); assert.equal((await request('/api/approvals?tab=rejected')).data.items.find((i)=>i.documentId==='r-pr-reject-target').rejectionReason,'budget tight'); });
  test('self approval remains blocked by the purchase requisition state machine', async () => { assert.equal((await request('/api/purchase-requisitions/self-pr-pending/approve','admin',{method:'POST'})).status, 409); });
  test('inventory check approve uses the transactional stock adjustment', async () => { const before=db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity; assert.equal((await request('/api/inventory-checks/x-check-pending','admin',{method:'PATCH',body:{action:'APPROVE'}})).status,200); assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity,before+2); assert.ok((await request('/api/approvals?tab=approved')).data.items.some((i)=>i.documentId==='x-check-pending')); });
  test('accounting voucher approve moves the item to approved', async () => { assert.equal((await request('/api/accounting-vouchers/w-voucher-pending/approve','admin',{method:'POST'})).status,200); assert.ok((await request('/api/approvals?tab=approved')).data.items.some((i)=>i.documentId==='w-voucher-pending')); });
  test('accounting voucher reject uses its native reason field', async () => { assert.equal((await request('/api/accounting-vouchers/p-voucher-reject-target/reject','admin',{method:'POST',body:{rejectionReason:'attachment missing'}})).status,200); assert.equal((await request('/api/approvals?tab=rejected')).data.items.find((i)=>i.documentId==='p-voucher-reject-target').rejectionReason,'attachment missing'); });
  test('pending count reflects completed actions without full-list fanout', async () => { const data=(await request('/api/approvals?tab=pending&limit=1')).data; assert.equal(data.items.length,1); assert.ok(data.counts.pending >= 0); assert.ok(!data.items.some((i)=>['z-so-pending','r-so-reject-target','y-po-pending','q-po-reject-target','x-check-pending','w-voucher-pending','p-voucher-reject-target','z-pr-pending','r-pr-reject-target'].includes(i.documentId))); });
});

describe('M3R mobile approval UI', () => {
  const sample = { key:'SALES_ORDER:1',documentType:'SALES_ORDER',documentTypeLabel:'销售订单',documentId:'1',documentNo:'SO-1',status:'SUBMITTED',statusLabel:'待审批',initiatorName:'张三',submittedAt:future,amountCents:123400,summary:'大客户',remark:'加急',itemCount:1,lines:[{productName:'企业路由器',quantity:1,unit:'台',amountCents:123400}],canApprove:true,canReject:true };
  test('defines four enabled tabs and disabled copied tab', () => { assert.deepEqual(APPROVAL_TABS.map((t) => [t.key,!!t.disabled]), [['pending',false],['approved',false],['rejected',false],['created',false],['copied',true]]); });
  test('tabs render counts from one response', () => { const html=renderToStaticMarkup(createElement(ApprovalTabs,{activeTab:'pending',counts:{pending:4,approved:3,rejected:2,created:1},onChange(){}})); assert.match(html,/待审批<span>4<\/span>/); assert.match(html,/>4<\/span>/); });
  test('copied tab is disabled and marked unavailable', () => { const html=renderToStaticMarkup(createElement(ApprovalTabs,{activeTab:'pending',counts:{},onChange(){}})); assert.match(html,/aria-disabled="true"[^>]*disabled=""/); assert.match(html,/暂未开放/); });
  test('card renders type, number, status, initiator, time and amount', () => { const html=renderToStaticMarkup(createElement(ApprovalCard,{item:sample,onSelect(){},onAction(){}})); for (const text of ['销售订单','SO-1','待审批','张三','¥1,234.00']) assert.match(html,new RegExp(text)); });
  test('pending card exposes approve and reject actions', () => { const html=renderToStaticMarkup(createElement(ApprovalCard,{item:sample,onSelect(){},onAction(){}})); assert.match(html,/>\u9a73\u56de<\/button>/); assert.match(html,/>\u901a\u8fc7<\/button>/); });
  test('busy card disables mutation actions', () => { const html=renderToStaticMarkup(createElement(ApprovalCard,{item:sample,busy:true,onSelect(){},onAction(){}})); assert.equal((html.match(/disabled=""/g)||[]).length,2); });
  test('handled card has no action bar', () => { const html=renderToStaticMarkup(createElement(ApprovalCard,{item:{...sample,status:'APPROVED',canApprove:false,canReject:false},onSelect(){},onAction(){}})); assert.doesNotMatch(html,/mobile-approval-card__actions/); });
  test('detail renders core facts and line preview', () => { const html=renderToStaticMarkup(createElement(ApprovalDetail,{item:sample,onBack(){},onAction(){}})); assert.match(html,/返回审批列表/); assert.match(html,/明细摘要/); assert.match(html,/企业路由器/); });
  test('detail renders rejection reason when present', () => { const html=renderToStaticMarkup(createElement(ApprovalDetail,{item:{...sample,rejectionReason:'金额不符',canApprove:false,canReject:false},onBack(){},onAction(){}})); assert.match(html,/驳回原因/); assert.match(html,/金额不符/); });
  test('loading state is explicit', () => { assert.match(renderToStaticMarkup(createElement(ApprovalListState,{loading:true,items:[]})),/data-testid="approval-loading"/); });
  test('empty state is explicit', () => { assert.match(renderToStaticMarkup(createElement(ApprovalListState,{items:[],loading:false})),/data-testid="approval-empty"/); });
  test('error state includes retry action', () => { const html=renderToStaticMarkup(createElement(ApprovalListState,{items:[],error:'boom',onRetry(){}})); assert.match(html,/data-testid="approval-error"/); assert.match(html,/\u91cd\u8bd5/); });
  test('center starts in a loading state before its first fetch resolves', () => { assert.match(renderToStaticMarkup(createElement(MobileApprovalCenter,{})),/data-testid="approval-loading"/); });
  test('bottom navigation renders pending badge', () => { const html=renderToStaticMarkup(createElement(MobileShell,{activeTab:'apps',tabBadges:{approvals:12}})); assert.match(html,/mobile-bottom-nav__badge/); assert.match(html,/>12<\/span>/); });
  test('bottom navigation caps large badges', () => { const html=renderToStaticMarkup(createElement(MobileShell,{activeTab:'apps',tabBadges:{approvals:120}})); assert.match(html,/>99\+<\/span>/); });
  test('App fetches pending count after mobile session load', () => { assert.match(appSource,/api\('\/api\/approvals\?tab=pending&limit=1'\)/); });
  test('App mounts approval center only in approvals mobile tab', () => { assert.match(appSource,/mobileTab === 'approvals'[\s\S]{0,160}<MobileApprovalCenter/); });
  test('successful mutations refresh the active list', () => { assert.match(approvalSource,/await api\(request\.path, request\.options\)[\s\S]*?await load\(activeTab\)/); });
  test('busy guard and disabled controls protect against double action', () => { assert.match(approvalSource,/if \(!dialog \|\| busy\) return/); assert.match(approvalSource,/disabled=\{busy/); });
  test('reject reason is trimmed before dispatch', () => { assert.match(approvalSource,/approvalActionRequest\(dialog\.item, dialog\.action, reason\.trim\(\)\)/); });
  test('approval confirmation is explicit', () => { assert.match(approvalSource,/确认审批通过/); });
  test('copied tab cannot invoke tab change', () => { assert.match(approvalSource,/onClick=\{\(\) => !tab\.disabled && onChange\(tab\.key\)\}/); });
  test('sticky detail actions clear the bottom nav safe area', () => { assert.match(css,/\.mobile-approval-detail__actions\s*\{[^}]*bottom:\s*calc\(72px \+ env\(safe-area-inset-bottom/s); });
  test('touch targets stay at least 44px high', () => { assert.match(css,/\.mobile-approval-tabs__item\s*\{[^}]*min-height:\s*44px/s); assert.match(css,/\.mobile-approval-card__actions button,[^}]*min-height:\s*44px/s); });
  test('approval badge is wired through shell props', () => { assert.match(shellSource,/tabBadges\[tab\.key\] > 0/); });
  test('canonical Approvals business page remains mounted', () => { assert.match(appSource,/approvals:\s*<Approvals notify=\{notify\}\/>/); });
});
