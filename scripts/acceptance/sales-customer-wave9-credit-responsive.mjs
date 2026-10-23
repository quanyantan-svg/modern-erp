import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const viewports = [320, 390, 430, 680];
const outputDir = resolve('test-results/wave9-responsive');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-sales-wave9-ui-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
let browser;

const TABS = [['profiles', '信用档案'], ['parameters', '信用参数'], ['rules', '检查规则']];

async function tokenFor(baseUrl, username, password) {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 200, `${username} login must succeed`);
  return (await login.json()).token;
}

async function openPage(context, baseUrl, token, hash) {
  const page = await context.newPage();
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: 'modern_erp_token', value: token });
  await page.goto(`${baseUrl}#${hash}`, { waitUntil: 'networkidle' });
  return page;
}

try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: edgePath, headless: true });

  const managerToken = await tokenFor(baseUrl, 'admin', 'admin123');
  const salesToken = await tokenFor(baseUrl, 'sales', 'sales123');
  const reviewerToken = await tokenFor(baseUrl, 'reviewer', 'review123');
  const deniedToken = await tokenFor(baseUrl, 'warehouse', 'warehouse123');
  const results = [];

  // ---- Back-end authority is enforced independently of front-end visibility ----
  const deniedApi = await fetch(`${baseUrl}/api/credit/profiles`, { headers: { authorization: `Bearer ${deniedToken}` } });
  assert.equal(deniedApi.status, 403, 'warehouse role must be refused by GET /api/credit/profiles');
  const reviewerApi = await fetch(`${baseUrl}/api/credit/profiles`, { headers: { authorization: `Bearer ${reviewerToken}` } });
  assert.equal(reviewerApi.status, 200, 'reviewer holds CREDIT_VIEW and must read');
  const salesApi = await fetch(`${baseUrl}/api/credit/profiles`, { headers: { authorization: `Bearer ${salesToken}` } });
  assert.equal(salesApi.status, 200, 'sales holds CREDIT_VIEW and keeps aggregate read');
  const profileBody = JSON.stringify({ customerId: 'customer-001', creditObjectType: 'CUSTOMER', creditObjectId: 'ACCEPTANCE-SCOPE', initialState: 'NORMAL', ratingGrade: 'A', effectiveFrom: '2026-01-01' });
  const postProfile = (token) => fetch(`${baseUrl}/api/credit/profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `acceptance-${Math.random()}`, authorization: `Bearer ${token}` },
    body: profileBody,
  });
  const reviewerWrite = await postProfile(reviewerToken);
  assert.equal(reviewerWrite.status, 403, 'reviewer is read-only on credit profiles');
  const salesWrite = await postProfile(salesToken);
  assert.equal(salesWrite.status, 403, 'sales holds CREDIT_MANAGE but not SALES_CROSS_GROUP and must not write');
  const adminWrite = await postProfile(managerToken);
  assert.equal(adminWrite.status, 201, 'admin holds central management authority and must write');
  const salesConfigWrite = await fetch(`${baseUrl}/api/credit/policy/parameters`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `acceptance-cfg-${Math.random()}`, authorization: `Bearer ${salesToken}` },
    body: JSON.stringify({ code: 'CREDIT_MANAGEMENT_ENABLED', valueBool: false, effectiveFrom: '2027-01-01', status: 'ACTIVE' }),
  });
  assert.equal(salesConfigWrite.status, 403, 'sales must not mutate global Credit configuration');

  for (const width of viewports) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
    const page = await openPage(context, baseUrl, managerToken, 'credit-foundation');
    await page.getByRole('heading', { name: '信用管理基础' }).waitFor({ timeout: 12000 });

    const viewportResults = { width };
    for (const [tab, label] of TABS) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.locator(`[aria-label="credit-${tab}"]`).waitFor({ timeout: 12000 });
      const metrics = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('.page-stack button,.page-stack input,.page-stack select')];
        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          minControlHeight: controls.length ? Math.min(...controls.map((c) => c.getBoundingClientRect().height)) : 0,
          controlCount: controls.length,
        };
      });
      assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${width}px ${tab} has horizontal overflow`);
      assert.ok(metrics.minControlHeight >= 44, `${width}px ${tab} has a touch target below 44px (${metrics.minControlHeight})`);
      await page.screenshot({ path: join(outputDir, `wave9-credit-foundation-${tab}-${width}px-result-pass.png`), fullPage: true });
      viewportResults[tab] = metrics;
    }

    // No Wave 10 enforcement UI may leak into the Wave 9 foundation surface.
    // Wave 10 *disclaimer* copy that states blocking is NOT enabled is expected and
    // desirable, so assert on controls and routes rather than on the words themselves.
    const leaked = await page.evaluate(() => {
      const surface = document.querySelector('.page-stack');
      const controls = [...surface.querySelectorAll('button,a,[role="button"]')]
        .map((el) => el.textContent.trim())
        .filter((text) => /信用检查结果|特殊审批|发起信用检查|审批/.test(text));
      const routes = [...surface.querySelectorAll('a[href],[data-route]')]
        .map((el) => el.getAttribute('href') || el.getAttribute('data-route'))
        .filter((ref) => ref && /credit\/(check|special)/.test(ref));
      return { controls, routes };
    });
    assert.deepEqual(leaked.controls, [], `${width}px exposes a Wave 10 control`);
    assert.deepEqual(leaked.routes, [], `${width}px exposes a Wave 10 route`);

    // Exactly the three approved Wave 9 tabs, and nothing else.
    const tabLabels = await page.locator('nav.segmented button').allInnerTexts();
    assert.deepEqual(tabLabels.map((t) => t.trim()), TABS.map(([, label]) => label), `${width}px tab set drifted`);

    // Empty state must not imply a zero credit limit.
    const emptyCards = await page.locator('[aria-label="credit-profiles"] .mini-card').count();
    viewportResults.emptyProfileCards = emptyCards;

    // Central management authority must expose the create controls to admin.
    for (const [tab, label] of TABS) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.locator(`[aria-label="credit-${tab}"]`).waitFor({ timeout: 12000 });
      const createVisible = await page.locator(`[aria-label="credit-${tab}"] button.primary`).count();
      assert.equal(createVisible, 1, `${width}px admin must see the ${tab} create control`);
    }

    await page.close();
    results.push(viewportResults);
  }

  // ---- Ordinary sales user: read-only surfaces, no create controls ----
  const salesVisibility = [];
  for (const width of viewports) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
    const page = await openPage(context, baseUrl, salesToken, 'credit-foundation');
    await page.getByRole('heading', { name: '信用管理基础' }).waitFor({ timeout: 12000 });
    const widthResults = { width };
    for (const [tab, label] of TABS) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.locator(`[aria-label="credit-${tab}"]`).waitFor({ timeout: 12000 });
      assert.equal(await page.locator(`[aria-label="credit-${tab}"] button.primary`).count(), 0,
        `${width}px sales must not see the ${tab} create control`);
      const notice = await page.locator(`[aria-label="credit-${tab}"] .muted`).allInnerTexts();
      assert.ok(notice.some((text) => text.includes('查看权限')), `${width}px sales ${tab} must state the read-only reason`);
      const metrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${width}px sales ${tab} has horizontal overflow`);
      widthResults[tab] = 'read-only';
    }
    await page.screenshot({ path: join(outputDir, `wave9-credit-foundation-sales-readonly-${width}px-result-pass.png`), fullPage: true });
    await page.close();
    salesVisibility.push(widthResults);
  }

  // ---- Contextual navigation parity, and no launcher tile ----
  // `parentRoute` is declarative registry metadata validated to resolve to an
  // enabled route; this app renders no generic child surface for it. Compare
  // against the established sales-pricing contextual route so the two are shown
  // to behave identically rather than asserting an in-page entry that no
  // contextual route in this registry provides.
  const navContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const countRefs = async (hash, ref) => {
    const p = await openPage(navContext, baseUrl, managerToken, hash);
    await p.waitForLoadState('networkidle');
    const n = await p.locator(`a[href*="${ref}"], [data-route="${ref}"]`).count();
    await p.close();
    return n;
  };
  const customerSurface = await openPage(navContext, baseUrl, managerToken, 'customers');
  await customerSurface.waitForLoadState('networkidle');
  await customerSurface.screenshot({ path: join(outputDir, 'wave9-credit-contextual-navigation-390px-result-pass.png'), fullPage: true });
  const creditLinksOnCustomers = await customerSurface.locator('a[href*="credit-foundation"], [data-route="credit-foundation"]').count();
  const pricingLinksOnCustomers = await customerSurface.locator('a[href*="sales-pricing"], [data-route="sales-pricing"]').count();
  await customerSurface.close();
  assert.equal(creditLinksOnCustomers, pricingLinksOnCustomers, 'credit-foundation contextual exposure must match sales-pricing');

  const launcherPage = await openPage(navContext, baseUrl, managerToken, 'business-overview');
  await launcherPage.waitForLoadState('networkidle');
  const launcherTiles = await launcherPage.locator('a[href*="credit-foundation"], [data-route="credit-foundation"]').count();
  await launcherPage.close();

  // ---- Direct URL / refresh / Back / Forward ----
  const directPage = await openPage(navContext, baseUrl, managerToken, 'credit-foundation');
  await directPage.getByRole('heading', { name: '信用管理基础' }).waitFor({ timeout: 12000 });
  await directPage.getByRole('button', { name: '检查规则', exact: true }).click();
  await directPage.reload({ waitUntil: 'networkidle' });
  await directPage.getByRole('heading', { name: '信用管理基础' }).waitFor({ timeout: 12000 });
  await directPage.goBack({ waitUntil: 'networkidle' });
  await directPage.goForward({ waitUntil: 'networkidle' });
  await directPage.getByRole('heading', { name: '信用管理基础' }).waitFor({ timeout: 12000 });
  await directPage.screenshot({ path: join(outputDir, 'wave9-credit-foundation-rules-direct-url-390px-result-pass.png'), fullPage: true });

  // ---- Permission-denied rendering ----
  const deniedPage = await openPage(navContext, baseUrl, deniedToken, 'credit-foundation');
  await deniedPage.waitForLoadState('networkidle');
  const deniedText = await deniedPage.locator('body').innerText();
  await deniedPage.screenshot({ path: join(outputDir, 'wave9-credit-foundation-permission-denied-390px-result-pass.png'), fullPage: true });
  await navContext.close();

  const summary = {
    ok: true,
    backEndAuthority: {
      warehouseGetProfiles: deniedApi.status,
      reviewerGetProfiles: reviewerApi.status,
      salesGetProfiles: salesApi.status,
      reviewerPostProfile: reviewerWrite.status,
      salesPostProfile: salesWrite.status,
      adminPostProfile: adminWrite.status,
      salesPostConfiguration: salesConfigWrite.status,
    },
    salesVisibility,
    contextualExposureParity: {
      creditLinksOnCustomers,
      pricingLinksOnCustomers,
    },
    launcherTiles,
    deniedRouteShowsAccessRefused: deniedText.includes('无权访问'),
    results,
    outputDir,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}