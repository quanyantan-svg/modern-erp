import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';
import {
  SELF_CUSTOMER,
  runObservedCreditCheck,
  seedCreditQueryWorld,
  seedObservedReceivable,
  shiftCreditDate,
} from '../../server/test-utils/wave11-a-credit-query-fixture.js';
import { HISTORICAL, TODAY } from '../../server/test-utils/wave11-sec-scope-fixture.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const evidenceDir = process.env.U3_BROWSER_EVIDENCE_DIR
  || join(tmpdir(), `modern-erp-w11a-u3-browser-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`);
const dbTempDir = mkdtempSync(join(tmpdir(), 'modern-erp-w11a-u3-db-'));
const db = createDatabase(join(dbTempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const evidence = { startedAt: new Date().toISOString(), edgePath, evidenceDir, cases: {}, responsive: [], requests: [] };
let browser;
let activePage;

function record(id, payload) {
  evidence.cases[id] = { result: 'PASS', ...payload };
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function insertUnknownSourceReceivable() {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO account_receivables(id,voucher_no,customer_id,source_type,source_id,amount_cents,paid_cents,
      write_off_cents,status,due_date,creator_id,created_at,business_date,updated_at,open_amount_cents,item_class,
      recognition_mode,item_kind,conversion_state)
    VALUES('ar-u3-unknown','AR-U3-UNKNOWN',?,'MANUAL','manual-u3',50000,0,0,'PENDING','',?, ?,?,?,50000,
      'SOURCE','DIRECT_BUSINESS_OPEN_ITEM','FINAL','OPEN')`)
    .run(SELF_CUSTOMER, 'w11-admin', now, TODAY, now);
}

async function prepareFixture() {
  await seedCreditQueryWorld(db);

  // Browser identities are deliberately narrower than the fixture writers.
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO roles(id,code,name,description,system_role,created_at)
    VALUES('role-u3-credit-only','U3_CREDIT_ONLY','U3 CREDIT_VIEW only','browser acceptance',0,?)`).run(stamp);
  db.prepare(`INSERT INTO roles(id,code,name,description,system_role,created_at)
    VALUES('role-u3-denied','U3_DENIED','U3 no credit','browser acceptance',0,?)`).run(stamp);
  db.prepare("INSERT INTO role_permissions(role_id,permission_code) VALUES('role-u3-credit-only','CREDIT_VIEW')").run();
  db.prepare("UPDATE users SET role_id='role-u3-credit-only' WHERE id='w11-self'").run();
  db.prepare("UPDATE users SET role_id='role-u3-denied' WHERE id='w11-none'").run();

  seedObservedReceivable(db, { dueDate: TODAY });
  runObservedCreditCheck(db, { authorizationContext: 'u3-not-overdue' });
  db.prepare("UPDATE account_receivables SET due_date=? WHERE id='ar-w11-overdue'")
    .run(shiftCreditDate(TODAY, -20));
  runObservedCreditCheck(db, { authorizationContext: 'u3-overdue-complete', proposedDeltaCents: 200000 });
  insertUnknownSourceReceivable();
  runObservedCreditCheck(db, { authorizationContext: 'u3-overdue-partial', proposedDeltaCents: 200001 });
  runObservedCreditCheck(db, { businessDate: HISTORICAL, authorizationContext: 'u3-historical-unknown' });
  for (let index = 0; index < 14; index += 1) {
    runObservedCreditCheck(db, { authorizationContext: `u3-page-${index}`, proposedDeltaCents: index + 1 });
  }

  // Category-only variants retain genuine persisted identities/payloads while
  // making each frozen server category observable in this disposable fixture.
  const variants = db.prepare(`SELECT id FROM credit_check_results
    WHERE credit_profile_id IN (SELECT id FROM credit_profile WHERE customer_id=?)
    ORDER BY evaluated_at,id LIMIT 4`).all(SELF_CUSTOMER);
  assert.equal(variants.length, 4);
  db.prepare("UPDATE credit_check_results SET reason_codes_json='[\"OVER_LIMIT\"]' WHERE id=?").run(variants[0].id);
  db.prepare("UPDATE credit_check_results SET decision='WARNING' WHERE id=?").run(variants[1].id);
  db.prepare("UPDATE credit_check_results SET decision='BLOCK' WHERE id=?").run(variants[2].id);
  db.prepare("UPDATE credit_check_results SET decision='SPECIAL_APPROVAL_REQUIRED' WHERE id=?").run(variants[3].id);
}

async function login(baseUrl, username) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'w11-fixture-1234' }),
  });
  assert.equal(response.status, 200, `${username} login failed`);
  return response.json();
}

async function contextFor(baseUrl, token, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  const page = await context.newPage();
  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/credit/') && !url.includes('/api/customers')) return;
    let body = null;
    try { body = await response.json(); } catch { /* evidence remains status + URL */ }
    evidence.requests.push({ at: new Date().toISOString(), method: response.request().method(), url, status: response.status(), body });
  });
  return { context, page };
}

async function openCredit(page, baseUrl) {
  await page.goto(`${baseUrl}/#credit-query`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid="credit-query-page"]').waitFor({ timeout: 15000 });
}

async function chooseFirstOption(page) {
  const select = page.locator('.credit-query__context select').nth(0);
  await select.waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.credit-query__context select')[0]?.options.length > 1);
  const options = await select.locator('option').evaluateAll((rows) => rows.map((row) => ({ value: row.value, text: row.textContent })));
  const value = options.find((row) => row.text.includes('CUS-W11-SELF'))?.value || options[1]?.value;
  assert.ok(value, 'authorized self Credit Object option is required');
  await select.selectOption(value);
  return value;
}

async function directApi(page, path) {
  return page.evaluate(async (target) => {
    const response = await fetch(target, { headers: { authorization: `Bearer ${localStorage.getItem('modern_erp_token')}` } });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, path);
}

async function switchToHistory(page) {
  await page.locator('.segmented-control button').nth(1).click();
  await page.locator('.credit-query__workspace').waitFor();
  await page.waitForFunction(() => !document.querySelector('.credit-query__workspace .skeleton'));
}

async function applyCategory(page, category) {
  await page.locator('.filter-button').click();
  await page.locator('.filter-sheet select').nth(0).selectOption(category);
  await page.locator('.filter-sheet .primary').click();
  await page.waitForFunction(() => !document.querySelector('.credit-query__workspace .skeleton'));
}

async function collectResponsive(page, width, label) {
  const metrics = await page.evaluate(() => {
    const root = document.querySelector('.credit-query');
    const viewportRight = document.documentElement.clientWidth;
    const interactive = [...root.querySelectorAll('button,input,select,summary')].filter((node) => {
      const style = getComputedStyle(node); const box = node.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0;
    });
    const main = root.getBoundingClientRect();
    // A real horizontal overflow is an element whose painted box leaves the
    // viewport while its own overflow is still visible. Intentionally
    // scrollable containers are excluded because they own their overflow.
    const overflowingElements = [...root.querySelectorAll('*')].filter((node) => {
      const style = getComputedStyle(node);
      if (style.overflowX !== 'visible') return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.right > viewportRight + 0.5;
    }).slice(0, 6).map((node) => ({
      tag: node.tagName,
      className: String(node.className || '').slice(0, 80),
      right: Math.round(node.getBoundingClientRect().right * 100) / 100,
    }));
    const boxes = interactive.map((node) => node.getBoundingClientRect());
    const pagination = root.querySelector('.credit-query__pagination');
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainLeft: Math.round(main.left * 100) / 100, mainRight: Math.round(main.right * 100) / 100,
      minTargetHeight: Math.min(...boxes.map((box) => box.height)),
      minTargetWidth: Math.min(...boxes.map((box) => box.width)),
      focusableCount: interactive.length,
      selectedFilters: document.querySelectorAll('.filter-button.is-active').length,
      hash: location.hash,
      overflowingElements,
      paginationText: pagination ? pagination.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) : '',
      paginationButtons: pagination ? pagination.querySelectorAll('button').length : 0,
    };
  });
  assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${width}px ${label}: horizontal overflow`);
  assert.ok(metrics.mainLeft >= 0 && metrics.mainRight <= width + 0.5, `${width}px ${label}: main out of bounds`);
  assert.ok(metrics.minTargetHeight >= 40, `${width}px ${label}: target below 40px`);
  assert.ok(metrics.focusableCount > 0, `${width}px ${label}: no interactive target`);
  assert.deepEqual(metrics.overflowingElements, [], `${width}px ${label}: element outside the viewport`);
  return { width, label, ...metrics };
}

// §8 long identity / money / date proof: the rendered values are measured in
// the real browser instead of being asserted from the CSS contract.
async function collectDetailContent(page) {
  const content = await page.evaluate(() => {
    const root = document.querySelector('.credit-query');
    const facts = [...root.querySelectorAll('.credit-query__facts--detail > div')].map((row) => {
      const dd = row.querySelector('dd');
      const box = dd?.getBoundingClientRect();
      return {
        label: row.querySelector('dt')?.textContent?.trim() || '',
        valueLength: (dd?.textContent || '').trim().length,
        valueRight: box ? Math.round(box.right * 100) / 100 : null,
        overflows: dd ? dd.scrollWidth > dd.clientWidth + 1 : false,
      };
    });
    const recorded = [...root.querySelectorAll('.credit-query__recorded dd')].map((dd) => (dd.textContent || '').trim());
    const idFact = facts.find((row) => row.label.includes('检查结果 ID')) || null;
    const dateFact = facts.find((row) => row.label.includes('评估时间')) || null;
    return {
      factCount: facts.length,
      checkResultIdLength: idFact?.valueLength || 0,
      checkResultIdRight: idFact?.valueRight || null,
      evaluatedAtLength: dateFact?.valueLength || 0,
      longestFactLength: Math.max(0, ...facts.map((row) => row.valueLength)),
      overflowingFacts: facts.filter((row) => row.overflows).map((row) => row.label),
      recordedValueCount: recorded.length,
      longestRecordedLength: Math.max(0, ...recorded.map((text) => text.length)),
      overdueAlertText: (root.querySelector('.credit-query__detail .inline-alert')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      currentContextPresent: Boolean(root.querySelector('.credit-query__current-context')),
      recordedSectionPresent: Boolean(root.querySelector('.credit-query__recorded')),
    };
  });
  assert.ok(content.checkResultIdLength > 0, 'detail must render the canonical Check Result ID');
  assert.deepEqual(content.overflowingFacts, [], 'detail facts overflow their own column');
  return content;
}

// §8 focus / keyboard operability proof measured on the real focus ring.
async function collectKeyboard(page, width, label) {
  const stops = [];
  for (let index = 0; index < 14; index += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const node = document.activeElement;
      if (!node || node === document.body) return null;
      const box = node.getBoundingClientRect();
      return {
        tag: node.tagName,
        className: String(node.className || '').slice(0, 60),
        ariaLabel: node.getAttribute('aria-label') || '',
        text: (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
        right: Math.round(box.right * 100) / 100,
        viewportRight: document.documentElement.clientWidth,
      };
    });
    if (stop) stops.push(stop);
  }
  const distinct = new Set(stops.map((stop) => `${stop.tag}.${stop.className}.${stop.text}`));
  const outside = stops.filter((stop) => stop.right > stop.viewportRight + 0.5);
  assert.ok(distinct.size >= 4, `${width}px ${label}: fewer than four keyboard focus stops`);
  assert.deepEqual(outside, [], `${width}px ${label}: focused element outside the viewport`);
  return { width, label, focusStops: stops.length, distinctFocusStops: distinct.size, outOfViewportFocus: outside.length };
}

// Real keyboard activation of the history entry, proving the deep link is
// reachable without a pointer.
async function openDetailByKeyboard(page) {
  const button = page.locator('.credit-query__history-list li button').first();
  await button.focus();
  const focused = await page.evaluate(() => ({
    tag: document.activeElement?.tagName,
    isRowButton: document.activeElement === document.querySelector('.credit-query__history-list li button'),
  }));
  assert.equal(focused.tag, 'BUTTON');
  assert.equal(focused.isRowButton, true);
  await page.keyboard.press('Enter');
  await page.locator('.credit-query__detail').waitFor();
  return focused;
}

async function closeFilterSheet(page) {
  const sheet = page.locator('.filter-sheet');
  if (await sheet.count()) {
    await sheet.locator('button[aria-label]').first().click();
    await sheet.waitFor({ state: 'detached' }).catch(() => {});
  }
}

try {
  assert.ok(existsSync(edgePath), `Microsoft Edge not found: ${edgePath}`);
  assert.ok(existsSync(resolve('dist/index.html')), 'dist/index.html is required; run pnpm build first');
  mkdirSync(evidenceDir, { recursive: true });
  await prepareFixture();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const creditLogin = await login(baseUrl, 'w11-self');
  const deniedLogin = await login(baseUrl, 'w11-none');
  assert.deepEqual(creditLogin.user.permissions, ['CREDIT_VIEW']);
  assert.deepEqual(deniedLogin.user.permissions, []);
  browser = await chromium.launch({ executablePath: edgePath, headless: true });

  const main = await contextFor(baseUrl, creditLogin.token);
  activePage = main.page;
  await main.page.goto(baseUrl, { waitUntil: 'networkidle' });
  const launcherVisible = await main.page.locator('[data-testid="v16-launcher-tile-credit-query"]').count();
  assert.equal(launcherVisible, 1);
  await main.page.locator('[data-testid="v16-launcher-tile-credit-query"]').click();
  await main.page.locator('[data-testid="credit-query-page"]').waitFor();
  await chooseFirstOption(main.page);
  const optionResponse = evidence.requests.findLast((item) => item.url.includes('/api/credit/query-options'));
  assert.equal(optionResponse?.status, 200);
  assert.equal(evidence.requests.some((item) => item.url.includes('/api/customers')), false);
  record('B01', {
    fixture: 'w11-self / aggregate+self membership', role: creditLogin.user.roleCode,
    permissions: creditLogin.user.permissions, action: 'launcher -> selector',
    request: optionResponse, dom: { launcherVisible, route: await main.page.evaluate(() => location.hash) },
  });

  const denied = await contextFor(baseUrl, deniedLogin.token);
  await denied.page.goto(baseUrl, { waitUntil: 'networkidle' });
  assert.equal(await denied.page.locator('[data-testid="v16-launcher-tile-credit-query"]').count(), 0);
  await denied.page.goto(`${baseUrl}/#credit-query`, { waitUntil: 'networkidle' });
  await denied.page.locator('[data-testid="route-state-permission_denied"]').waitFor();
  const deniedApi = await directApi(denied.page, '/api/credit/query-options');
  assert.equal(deniedApi.status, 403);
  assert.equal(await denied.page.locator('[data-testid="credit-query-page"]').count(), 0);
  record('B02', { fixture: 'w11-none', role: deniedLogin.user.roleCode, permissions: [], action: 'launcher + direct URL + API', request: deniedApi, dom: { routeState: 'permission_denied', dataRows: 0 } });
  await denied.context.close();

  const exposureWait = main.page.waitForResponse((res) => res.url().includes('/api/credit/exposure'));
  await main.page.locator('.credit-query__primary-action button').click();
  const exposureHttp = await exposureWait;
  const exposureBody = await exposureHttp.json();
  assert.equal(exposureHttp.status(), 200);
  const aggregate = exposureBody.exposure.scopes.find((row) => row.scopeType === 'CUSTOMER_AGGREGATE');
  assert.ok(aggregate && Number.isSafeInteger(aggregate.creditLimitCents));
  assert.ok(aggregate.components && aggregate.computedPolicyIdentity?.hashContractVersion);
  await main.page.locator('.credit-query__result').waitFor();
  assert.ok(await main.page.locator('.credit-query__amounts dd').count() >= 4);
  record('B03', { fixture: 'authorized first selector option', role: creditLogin.user.roleCode, permissions: ['CREDIT_VIEW'], action: 'SC101 query', request: { status: exposureHttp.status(), body: exposureBody }, dom: { scopeCards: await main.page.locator('.credit-query__scope').count(), amountFields: await main.page.locator('.credit-query__amounts dd').count() } });

  await switchToHistory(main.page);
  const categoryProof = {};
  for (const category of ['OVER_LIMIT', 'OVERDUE', 'WARNING', 'BLOCK', 'SPECIAL_APPROVAL']) {
    const apiResult = await directApi(main.page, `/api/credit/exceptions?category=${category}&limit=100&offset=0`);
    assert.equal(apiResult.status, 200);
    assert.ok(apiResult.body.total > 0, `${category} fixture missing`);
    assert.ok(apiResult.body.exceptions.every((row) => row.categories.includes(category)), `${category} server filter mismatch`);
    categoryProof[category] = { total: apiResult.body.total, ids: apiResult.body.exceptions.map((row) => row.checkResultId) };
  }
  assert.ok(categoryProof.OVERDUE.ids.some((id) => categoryProof.OVER_LIMIT.ids.includes(id)), 'category overlap missing');
  await applyCategory(main.page, 'OVERDUE');
  assert.ok(await main.page.locator('.credit-query__history-list li').count() > 0);
  record('B04', { fixture: 'five persisted category variants + observed overdue', role: creditLogin.user.roleCode, permissions: ['CREDIT_VIEW'], action: 'server category filters + UI OVERDUE filter', request: categoryProof, dom: { visibleRows: await main.page.locator('.credit-query__history-list li').count(), activeFilter: await main.page.locator('.filter-button.is-active').count() } });

  // Clear category through the sheet, then prove the two UI pages match the server order.
  await main.page.locator('.filter-button').click();
  await main.page.locator('.filter-sheet select').nth(0).selectOption('');
  await main.page.locator('.filter-sheet .primary').click();
  await main.page.waitForFunction(() => !document.querySelector('.credit-query__workspace .skeleton'));
  const pageOne = await directApi(main.page, `/api/credit/exceptions?customerId=${SELF_CUSTOMER}&limit=20&offset=0`);
  const pageTwo = await directApi(main.page, `/api/credit/exceptions?customerId=${SELF_CUSTOMER}&limit=20&offset=20`);
  assert.equal(pageOne.status, 200); assert.equal(pageTwo.status, 200);
  assert.equal(pageOne.body.total, pageTwo.body.total); assert.ok(pageOne.body.total > 20);
  const idsOne = pageOne.body.exceptions.map((row) => row.checkResultId);
  const idsTwo = pageTwo.body.exceptions.map((row) => row.checkResultId);
  assert.equal(idsOne.some((id) => idsTwo.includes(id)), false);
  const nextButton = main.page.locator('.credit-query__pagination button').nth(1);
  await nextButton.click();
  await main.page.waitForFunction(() => !document.querySelector('.credit-query__workspace .skeleton'));
  assert.ok((await main.page.locator('.credit-query__pagination').innerText()).includes(String(pageOne.body.total)));
  record('B05', { fixture: '14 additional production-writer checks', role: creditLogin.user.roleCode, permissions: ['CREDIT_VIEW'], action: 'page 1 -> page 2', request: { total: pageOne.body.total, pageOne: idsOne, pageTwo: idsTwo }, dom: { secondPageRows: await main.page.locator('.credit-query__history-list li').count() } });

  // Return to page one and open a known detail through the UI.
  await main.page.locator('.credit-query__pagination button').nth(0).click();
  await main.page.waitForFunction(() => !document.querySelector('.credit-query__workspace .skeleton'));
  await main.page.locator('.credit-query__history-list li button').first().click();
  await main.page.locator('.credit-query__detail').waitFor();
  const knownHash = await main.page.evaluate(() => location.hash);
  const knownId = decodeURIComponent(knownHash.split('/').slice(1).join('/'));
  const known = await directApi(main.page, `/api/credit/exceptions/${encodeURIComponent(knownId)}`);
  const unknown = await directApi(main.page, '/api/credit/exceptions/not-a-real-result');
  const otherRow = db.prepare(`SELECT r.id FROM credit_check_results r JOIN credit_profile cp ON cp.id=r.credit_profile_id
    WHERE cp.customer_id='cus-w11-other' AND r.scope_type='SALESPERSON_SUB_LIMIT' LIMIT 1`).get();
  const outOfScope = await directApi(main.page, `/api/credit/exceptions/${encodeURIComponent(otherRow.id)}`);
  assert.equal(known.status, 200);
  assert.deepEqual({ status: unknown.status, code: unknown.body.code }, { status: 404, code: 'CREDIT_EXCEPTION_NOT_FOUND' });
  assert.deepEqual({ status: outOfScope.status, code: outOfScope.body.code }, { status: 404, code: 'CREDIT_EXCEPTION_NOT_FOUND' });
  await main.page.reload({ waitUntil: 'networkidle' });
  await main.page.locator('.credit-query__detail').waitFor();
  const refreshHash = await main.page.evaluate(() => location.hash);
  await main.page.goBack({ waitUntil: 'networkidle' });
  await main.page.locator('.credit-query__history-list').waitFor();
  const backHash = await main.page.evaluate(() => location.hash);
  await main.page.goForward({ waitUntil: 'networkidle' });
  await main.page.locator('.credit-query__detail').waitFor();
  const forwardHash = await main.page.evaluate(() => location.hash);

  // A direct hash link must resolve in a fresh document without the list.
  const directContext = await contextFor(baseUrl, creditLogin.token);
  await directContext.page.goto(`${baseUrl}/#credit-query/${encodeURIComponent(knownId)}`, { waitUntil: 'networkidle' });
  await directContext.page.locator('.credit-query__detail').waitFor();
  const directHash = await directContext.page.evaluate(() => location.hash);
  const directFacts = await directContext.page.locator('.credit-query__facts--detail').innerText();
  assert.ok(directFacts.includes(knownId), 'direct hash link must render the canonical Check Result ID');
  assert.equal(await directContext.page.locator('.credit-query__history-list').count(), 0);
  await directContext.context.close();

  // A tampered identity must stay on the neutral, non-enumerating 404 surface.
  const tamperedContext = await contextFor(baseUrl, creditLogin.token);
  const tamperedId = `CCHK2:${'0'.repeat(64)}:SALESPERSON_SUB_LIMIT`;
  await tamperedContext.page.goto(`${baseUrl}/#credit-query/${encodeURIComponent(tamperedId)}`, { waitUntil: 'networkidle' });
  await tamperedContext.page.locator('.credit-query__detail').waitFor();
  const tamperedText = (await tamperedContext.page.locator('.credit-query__detail').innerText()).replace(/\s+/g, ' ').trim();
  assert.ok(tamperedText.includes('记录不存在或无权查看'), `tampered URL must show the neutral 404 surface: ${tamperedText}`);
  assert.ok(!/CREDIT_EXCEPTION_NOT_FOUND|500|Internal Server Error/.test(tamperedText));
  await tamperedContext.context.close();

  record('B06', { fixture: { knownId, otherScopeId: otherRow.id }, role: creditLogin.user.roleCode, permissions: ['CREDIT_VIEW'], action: 'list click + direct hash + refresh + back/forward + unknown/unauthorized/tampered', request: { known: known.status, unknown, outOfScope }, dom: { hash: await main.page.evaluate(() => location.hash), refreshHash, backHash, forwardHash, directHash, detail: await main.page.locator('.credit-query__detail').count(), tamperedText } });

  const currentWait = main.page.waitForResponse((res) => res.url().includes('/api/credit/exposure'));
  await main.page.locator('.credit-query__current-context .primary').click();
  const currentResponse = await currentWait;
  assert.equal(currentResponse.status(), 200);
  await main.page.locator('.credit-query__current-context .credit-query__result').waitFor();
  record('B07', { fixture: knownId, role: creditLogin.user.roleCode, permissions: ['CREDIT_VIEW'], action: 'historical detail -> current exposure', request: { status: currentResponse.status(), url: currentResponse.url() }, dom: { historicalPayload: await main.page.locator('.credit-query__recorded').count(), currentResult: await main.page.locator('.credit-query__current-context .credit-query__result').count() } });

  const statuses = await directApi(main.page, '/api/credit/exceptions?limit=100&offset=0');
  const overdueStates = [...new Set(statuses.body.exceptions.map((row) => `${row.overdueEvidence.status}/${row.overdueEvidence.completeness}`))];
  for (const expected of ['PROVEN_OVERDUE/COMPLETE', 'PROVEN_OVERDUE/PARTIAL', 'PROVEN_NOT_OVERDUE/COMPLETE', 'UNKNOWN/PARTIAL']) {
    assert.ok(overdueStates.includes(expected), `missing overdue state ${expected}`);
  }

  // The UNKNOWN evidence must never read as normal, not-overdue or zero risk.
  const unknownRow = statuses.body.exceptions.find((row) => row.overdueEvidence?.status === 'UNKNOWN');
  const provenRow = statuses.body.exceptions.find((row) => row.overdueEvidence?.status === 'PROVEN_OVERDUE' && row.overdueEvidence?.completeness === 'COMPLETE');
  assert.ok(unknownRow && provenRow, 'UNKNOWN and PROVEN_OVERDUE/COMPLETE rows are required');
  const evidenceContext = await contextFor(baseUrl, creditLogin.token);
  await evidenceContext.page.goto(`${baseUrl}/#credit-query/${encodeURIComponent(unknownRow.checkResultId)}`, { waitUntil: 'networkidle' });
  await evidenceContext.page.locator('.credit-query__detail .inline-alert').first().waitFor();
  const unknownAlertClass = await evidenceContext.page.locator('.credit-query__detail .inline-alert').first().getAttribute('class');
  const unknownAlertTitle = (await evidenceContext.page.locator('.credit-query__detail .inline-alert strong').first().innerText()).trim();
  const unknownAlertText = (await evidenceContext.page.locator('.credit-query__detail .inline-alert').first().innerText()).replace(/\s+/g, ' ').trim();
  assert.ok(unknownAlertClass.includes('inline-alert--warning'), `UNKNOWN evidence must be a warning surface: ${unknownAlertClass}`);
  assert.equal(unknownAlertTitle, '未知');
  // The affirmative not-overdue and zero-risk labels must never appear.
  for (const forbidden of ['无逾期', '已证实未逾期', '零风险', '¥0.00']) {
    assert.ok(!unknownAlertText.includes(forbidden), `UNKNOWN evidence must not read as ${forbidden}: ${unknownAlertText}`);
  }
  await evidenceContext.page.goto(`${baseUrl}/#credit-query/${encodeURIComponent(provenRow.checkResultId)}`, { waitUntil: 'networkidle' });
  await evidenceContext.page.locator('.credit-query__detail .inline-alert').first().waitFor();
  const provenAlertText = (await evidenceContext.page.locator('.credit-query__detail .inline-alert').first().innerText()).replace(/\s+/g, ' ').trim();
  assert.ok(provenAlertText.includes('已证实逾期'), `PROVEN_OVERDUE must read as overdue: ${provenAlertText}`);
  await evidenceContext.context.close();

  record('B08', { fixture: 'current, overdue, partial-source and legacy/backdated rows', role: creditLogin.user.roleCode, permissions: ['CREDIT_VIEW'], action: 'read history evidence presentations', request: { status: statuses.status, overdueStates }, dom: { detailAlert: await main.page.locator('.credit-query__detail .inline-alert').count(), unknownAlertTitle, unknownAlertText, unknownAlertClass, provenAlertText } });

  // B09 uses the browser transport only: a held request proves the loading
  // state and the stale-read guard, an abort proves the real retry affordance
  // without replacing authorization.
  await main.page.goto(`${baseUrl}/#credit-query`, { waitUntil: 'networkidle' });
  // The same-document hash navigation keeps the SPA state, so the retry proof
  // needs a real document load to return to the SC101 tab.
  await main.page.reload({ waitUntil: 'networkidle' });
  await main.page.locator('[data-testid="credit-query-page"]').waitFor();
  let holdFirstRequest = true;
  let releaseFirstRequest;
  const firstRequestGate = new Promise((resolve) => { releaseFirstRequest = resolve; });
  let heldRequests = 0;
  await main.page.route('**/api/credit/query-options**', async (route) => {
    if (holdFirstRequest) { holdFirstRequest = false; heldRequests += 1; await firstRequestGate; }
    await route.continue().catch(() => {});
  });
  const searchInput = main.page.locator('.credit-query__context input').nth(0);
  await searchInput.fill('CUS-W11-OTHER');
  // The loading skeleton only exists while the debounced read is in flight.
  await main.page.waitForFunction(() => document.querySelector('.credit-query__context .skeleton'), null, { timeout: 10000 });
  const loadingVisible = await main.page.locator('.credit-query__context .skeleton').count();
  await searchInput.fill('CUS-W11-SELF');
  await main.page.waitForFunction(() => !document.querySelector('.credit-query__context .skeleton'), null, { timeout: 10000 });
  const newestContext = await main.page.locator('.credit-query__context').innerText();
  // Releasing the held read lets the superseded request finish after the newest
  // one; the rendered context must still belong to the newest query.
  releaseFirstRequest();
  await main.page.waitForTimeout(1200);
  const contextAfterStale = await main.page.locator('.credit-query__context').innerText();
  assert.equal(contextAfterStale, newestContext);
  await main.page.unroute('**/api/credit/query-options**');
  await chooseFirstOption(main.page);
  let aborted = false;
  await main.page.route('**/api/credit/exposure**', async (route) => {
    if (!aborted) { aborted = true; await route.abort('internetdisconnected'); } else await route.continue();
  });
  await main.page.locator('.credit-query__primary-action button').click();
  await main.page.locator('.credit-query__retry').waitFor();
  await main.page.locator('.credit-query__retry').click();
  await main.page.locator('.credit-query__result').waitFor();
  await main.page.unroute('**/api/credit/exposure**');
  const conflict = await directApi(main.page, '/api/credit/query-options?customerId=cus-w11-self');
  assert.equal(conflict.status, 400);
  await searchInput.fill('definitely-no-u3-match');
  await main.page.waitForFunction(() => document.querySelector('.canonical-empty-state'));
  record('B09', { fixture: 'held superseded selector read + one network abort + real invalid/empty queries', role: creditLogin.user.roleCode, permissions: ['CREDIT_VIEW'], action: 'rapid search, loading, stale-read guard, network retry, invalid and empty', request: { heldRequests, aborted, invalid: conflict }, dom: { loadingVisible, retryRecovered: await main.page.locator('.credit-query__result').count(), emptyState: await main.page.locator('.canonical-empty-state').count(), staleContextUnchanged: contextAfterStale === newestContext } });

  // Responsive proof covers SC101, list/filter/pagination, detail and the
  // historical-to-current separation at every required width.
  for (const width of [320, 390, 430, 680]) {
    await main.page.setViewportSize({ width, height: 844 });
    await main.page.goto(`${baseUrl}/#credit-query`, { waitUntil: 'networkidle' });
    await main.page.reload({ waitUntil: 'networkidle' });
    await main.page.locator('[data-testid="credit-query-page"]').waitFor();
    await chooseFirstOption(main.page);
    await main.page.locator('.credit-query__primary-action button').click();
    await main.page.locator('.credit-query__result').waitFor();
    evidence.responsive.push(await collectResponsive(main.page, width, 'sc101'));
    await main.page.screenshot({ path: join(evidenceDir, `sc101-${width}.png`), fullPage: true });

    await switchToHistory(main.page);
    evidence.responsive.push(await collectResponsive(main.page, width, 'history-list'));
    evidence.responsive.push(await collectKeyboard(main.page, width, 'history-list'));
    await main.page.screenshot({ path: join(evidenceDir, `history-list-${width}.png`), fullPage: true });

    await main.page.locator('.filter-button').click();
    await main.page.locator('.filter-sheet').waitFor();
    evidence.responsive.push(await collectResponsive(main.page, width, 'filter-sheet'));
    await main.page.screenshot({ path: join(evidenceDir, `filter-sheet-${width}.png`), fullPage: true });
    await closeFilterSheet(main.page);

    // The deep link is opened with the keyboard only, so the same evidence
    // proves both keyboard operability and the encoded identity round-trip.
    const keyboardFocus = await openDetailByKeyboard(main.page);
    evidence.responsive.push(await collectResponsive(main.page, width, 'detail'));
    evidence.responsive.push(await collectKeyboard(main.page, width, 'detail'));
    const detailContent = await collectDetailContent(main.page);
    evidence.responsive.push({ width, label: 'detail-content', keyboardFocus, ...detailContent });
    await main.page.screenshot({ path: join(evidenceDir, `detail-${width}.png`), fullPage: true });

    await main.page.locator('.credit-query__current-context .primary').click();
    await main.page.locator('.credit-query__current-context .credit-query__result').waitFor();
    evidence.responsive.push(await collectResponsive(main.page, width, 'detail-current'));
    await main.page.screenshot({ path: join(evidenceDir, `detail-current-${width}.png`), fullPage: true });
  }
  await main.context.close();

  evidence.completedAt = new Date().toISOString();
  evidence.summary = { passed: Object.keys(evidence.cases).length, expected: 9, result: 'PASS' };
  const resultPath = join(evidenceDir, 'browser-acceptance-results.json');
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
  const screenshotFiles = ['sc101', 'history-list', 'filter-sheet', 'detail', 'detail-current']
    .flatMap((label) => [320, 390, 430, 680].map((width) => `${label}-${width}.png`));
  const manifest = {
    result: { file: 'browser-acceptance-results.json', sha256: sha256(resultPath) },
    screenshots: screenshotFiles.map((file) => ({ file, sha256: sha256(join(evidenceDir, file)) })),
  };
  writeFileSync(join(evidenceDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  process.stdout.write(`${JSON.stringify({ ok: true, evidenceDir, summary: evidence.summary, responsive: evidence.responsive, manifest }, null, 2)}\n`);
} catch (error) {
  evidence.completedAt = new Date().toISOString();
  evidence.failure = { name: error.name, message: error.message, stack: error.stack };
  mkdirSync(evidenceDir, { recursive: true });
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: join(evidenceDir, 'failure-state.png'), fullPage: true }).catch(() => {});
  }
  writeFileSync(join(evidenceDir, 'browser-acceptance-failure.json'), JSON.stringify(evidence, null, 2));
  process.stderr.write(`${JSON.stringify({ ok: false, evidenceDir, failure: evidence.failure }, null, 2)}\n`);
  throw error;
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(dbTempDir, { recursive: true, force: true });
}
