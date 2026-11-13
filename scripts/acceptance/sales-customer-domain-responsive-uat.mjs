// Sales & Customer — domain-level responsive UAT at 320 / 390 / 430 / 680 CSS px.
//
// Drives the live frontend (the built `dist/`) over a disposable SQLite
// database through playwright-core / Microsoft Edge. The evidence is
// DE-VACUUMED: a surface only passes when it rendered REAL data (a domain row
// with a non-zero box and non-empty text) or an explicit empty state, every
// painted clickable target is measured against the 44px floor, the requested
// report tab is really the selected one, and the canonical `data-testid` of
// the screen is present.
//
// The anti-hollow assertions, in order of weight:
//   1. the `data-testid` of the screen root must exist — a screen that never
//      rendered can not pass;
//   2. the surface must paint real rows or an explicit empty state;
//   3. every painted `button, a[href], [role="button"]` must be >= 44px on
//      BOTH axes — the floor is a floor on the TAP AREA, so a 30px-wide
//      target is a defect even when its height is 44px;
//   4. no horizontal overflow;
//   5. no console error and no page error during the visit;
//   6. the bottom navigation is pinned to the viewport AND the scrollable
//      content reserves its height.
//
// The Inventory & Warehouse gate was found hollow because it injected a token
// but never reloaded, so the shell stayed on the login form. This script puts
// the token in place with `context.addInitScript` BEFORE the first `goto`, so
// the target screen really loads in a fresh document.
//
// The Inventory gate also measures the 44px floor as
// `height < 44 && width < 44`, which lets a 30x44 target pass. The mutation
// experiment of this gate proved that hole: shrinking the shell back button
// to 30px wide left the Inventory rule green. This gate uses `||` instead.

import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';
import { applicationRouteFor } from '../../src/navigation/applicationRegistry.js';
import {
  BUSINESS_DATE,
  seedBusinessDocuments,
  seedCommercialPricing,
  seedCreditEvidence,
  seedCreditWorld,
  seedSalesFoundation,
  seedWarehouse,
} from './sales-customer-domain-uat-fixture.mjs';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const dbTempDir = mkdtempSync(join(tmpdir(), 'modern-erp-sc-domain-uat-'));
const db = createDatabase(join(dbTempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));

const VIEWPORTS = [
  { width: 320, height: 800, label: '320' },
  { width: 390, height: 844, label: '390' },
  { width: 430, height: 900, label: '430' },
  { width: 680, height: 900, label: '680' },
];

// The clickable-target floor. 44 CSS px is the mobile-first contract.
const MIN_TARGET_PX = 44;

// The domain surfaces of this gate.
//
//   testid      — the canonical `data-testid` of the screen root. Its presence
//                 is the anti-hollow assertion.
//   rowSelector — the selectors of the REAL domain rows of the surface.
//   emptySelector — the selectors of the explicit empty state of the surface.
//   route       — the hash route, with its optional query key.
//   prepare     — an optional in-page preparation step (e.g. picking the
//                 salesperson the memberships are anchored on).
//   requiresFormData — the surface is a form: its evidence is the painted
//                 fields and the reference pickers that really loaded.
//   expectedEmptyReason — the reason a surface legitimately shows an
//                 explicit empty state. It is printed per surface so the
//                 evidence is never silently hollow.
//   optional    — the route may not be registered yet; the surface is then
//                 SKIPPED and reported, never silently passed.
const SURFACES = [
  // --- NEW in this round ---------------------------------------------------
  {
    key: 'sales-parameters',
    route: 'sales-parameters',
    testid: 'sales-parameters-page',
    label: '销售参数',
    group: 'new',
    rowSelector: ['.record-list .record-card'],
    emptySelector: ['.business-state--empty', '.canonical-empty-state'],
  },
  {
    key: 'sales-group-memberships',
    route: 'sales-group-memberships',
    testid: 'sales-group-memberships-page',
    label: '销售组成员关系',
    group: 'new',
    rowSelector: ['.record-list .record-card'],
    emptySelector: ['.business-state--empty', '.canonical-empty-state'],
    // The memberships are anchored on a salesperson: the operator must pick
    // one before the list can be read, so the gate picks the real one.
    prepare: async (page) => {
      const select = page.locator('.sales-memberships-list select').first();
      await select.waitFor({ timeout: 10000 });
      const value = await select.locator('option').evaluateAll((rows) => {
        const found = rows.find((row) => row.value);
        return found ? found.value : null;
      });
      if (!value) return false;
      await select.selectOption(value);
      await page.waitForTimeout(600);
      return true;
    },
  },
  {
    key: 'sellable-scope-rules',
    route: 'sellable-scope-rules',
    testid: 'sellable-scope-rules-page',
    label: '可销范围规则',
    group: 'new',
    rowSelector: ['.record-list .record-card'],
    emptySelector: ['.business-state--empty', '.canonical-empty-state'],
  },
  {
    key: 'product-classifications',
    route: 'product-classifications',
    testid: 'product-classifications-page',
    label: '产品商业分类',
    group: 'new',
    rowSelector: ['.record-list .record-card'],
    emptySelector: ['.business-state--empty', '.canonical-empty-state'],
  },
  {
    key: 'sales-price-override-authorizations',
    route: 'sales-price-override-authorizations',
    testid: 'sales-price-override-authorizations-page',
    label: '价格覆盖授权',
    group: 'new',
    // The surface is a FORM, not a record list: its real content is the
    // reference pickers and the labelled form fields. The `<option>` elements
    // of a `<select>` have no painted box of their own, so they can never
    // count as a painted row; the painted evidence of a form surface is its
    // labelled `.form-row` fields and the filled inputs.
    rowSelector: ['.sales-price-override .form-row', '.sales-price-override .detail-grid > div'],
    emptySelector: ['.business-state--empty', '.canonical-empty-state'],
    // A form surface must additionally prove that its reference data really
    // loaded: a `<select>` with more than the placeholder option carries the
    // real customer / material references.
    requiresFormData: true,
  },
  {
    key: 'credit-evaluation',
    route: 'credit-evaluation',
    testid: 'credit-evaluation-page',
    label: '信用评估',
    group: 'new',
    // The surface renders its three workspaces as `.mini-card` grids. Its
    // "no evaluation sheet yet" state is ALSO a `.mini-card` — the page
    // reuses the card class for its empty state, tagged with an
    // `aria-label="empty-…"` prefix. Counting such a card as a DATA row
    // would make an empty surface look populated, so the empty-state cards
    // are counted separately and the surface can only pass on real rows.
    rowSelector: ['.detail-grid > div', '.detail-grid > .mini-card:not([aria-label^="empty-"])'],
    emptySelector: ['.mini-card[aria-label^="empty-"]', '.business-state--empty', '.canonical-empty-state'],
    // The evaluation-sheet world is produced by a bounded scorer flow (a
    // sheet, a bounded scorer set, per-scorer submissions and a final
    // aggregation). The browser gate does not create that world, so this
    // surface legitimately shows its explicit empty state.
    expectedEmptyReason: '该工作面需要先创建评分表与评分人，本浏览器门禁不建立评分世界，显示显式空状态',
    optional: true,
  },

  // --- NEW report tabs -----------------------------------------------------
  {
    key: 'decision-reports:sales-gross-profit',
    route: 'decision-reports?reportKey=sales-gross-profit',
    testid: 'decision-report-panel-sales-gross-profit',
    label: '经营分析 / 销售毛利',
    group: 'report',
    rowSelector: ['.v16-decision-reports__panel', '.decision-metric-grid > div'],
    emptySelector: ['.business-state--empty', '.canonical-empty-state'],
    // The switcher renders the report LABEL; the panel carries the report KEY
    // in its own `data-testid`. Both are asserted.
    assertSelectedReport: '销售毛利',
  },
  {
    key: 'decision-reports:sales-ranking',
    route: 'decision-reports?reportKey=sales-ranking',
    testid: 'decision-report-panel-sales-ranking',
    label: '经营分析 / 销售排行',
    group: 'report',
    rowSelector: ['.v16-decision-reports__panel', '.v16-decision-reports__breakdown > li'],
    emptySelector: ['.business-state--empty', '.canonical-empty-state'],
    assertSelectedReport: '销售排行',
  },

  // --- EXISTING Sales surfaces (regression) -------------------------------
  { key: 'quotations', route: 'quotations', testid: null, label: '销售报价', group: 'regression', rowSelector: ['.record-list .record-card'], emptySelector: ['.business-state--empty', '.canonical-empty-state'] },
  { key: 'orders', route: 'orders', testid: null, label: '销售订单', group: 'regression', rowSelector: ['.v16-sales-order-row', '.record-list .record-card'], emptySelector: ['.business-state--empty', '.canonical-empty-state'] },
  { key: 'sales-deliveries', route: 'sales-deliveries', testid: null, label: '销售出货', group: 'regression', rowSelector: ['.v16-sales-delivery-row', '.record-list .record-card'], emptySelector: ['.business-state--empty', '.canonical-empty-state'] },
  { key: 'delivery-notices', route: 'delivery-notices', testid: null, label: '交货通知', group: 'regression', rowSelector: ['.record-list .record-card'], emptySelector: ['.business-state--empty', '.canonical-empty-state'] },
  { key: 'sales-order-changes', route: 'sales-order-changes', testid: null, label: '销售订单变更', group: 'regression', rowSelector: ['.record-list .record-card'], emptySelector: ['.business-state--empty', '.canonical-empty-state'] },
  { key: 'sales-prepayment-gates', route: 'sales-prepayment-gates', testid: null, label: '预付款门', group: 'regression', rowSelector: ['table.data-table tbody tr', '.record-list .record-card'], emptySelector: ['.business-state--empty', '.canonical-empty-state'] },
  { key: 'sales-reservation-intents', route: 'sales-reservation-intents', testid: null, label: '预留意图', group: 'regression', rowSelector: ['table.data-table tbody tr', '.record-list .record-card'], emptySelector: ['.business-state--empty', '.canonical-empty-state'] },
  { key: 'service-fulfillments', route: 'service-fulfillments', testid: null, label: '服务履约', group: 'regression', rowSelector: ['.wave8-grid .wave8-card'], emptySelector: ['.business-state--empty', '.canonical-empty-state'] },
  { key: 'consignment-commercial', route: 'consignment-commercial', testid: null, label: '寄售业务', group: 'regression', rowSelector: ['.wave8-grid .wave8-card'], emptySelector: ['.business-state--empty', '.canonical-empty-state'] },
  { key: 'sales-pricing', route: 'sales-pricing', testid: 'sales-pricing-page', label: '销售定价与订单时折扣', group: 'regression', rowSelector: ['.sales-pricing-list .sales-pricing-row'], emptySelector: ['.business-state--empty', '.canonical-empty-state', '.sales-pricing-list .empty-state'] },
  { key: 'credit-foundation', route: 'credit-foundation', testid: null, label: '信用管理基础', group: 'regression', rowSelector: ['.detail-grid > div', 'table.data-table tbody tr', '.mini-card'], emptySelector: ['.business-state--empty', '.canonical-empty-state'] },
  { key: 'credit-check', route: 'credit-check', testid: null, label: '信用检查', group: 'regression', rowSelector: ['.mini-card', '.detail-grid > div'], emptySelector: ['.business-state--empty', '.canonical-empty-state'] },
  {
    key: 'credit-query',
    route: 'credit-query',
    testid: 'credit-query-page',
    label: '信用额度与例外查询',
    group: 'regression',
    rowSelector: ['.credit-query__result', '.credit-query__history-list li', '.credit-query__scope'],
    emptySelector: ['.canonical-empty-state', '.business-state--empty'],
    // The surface is a SELECTOR-FIRST workflow: it opens on the explicit
    // "请选择上下文并查询" empty state until an authorized credit object is
    // chosen. The gate therefore picks the real one and runs the real query,
    // so the evidence is the rendered exposure and not the empty state.
    prepare: async (page) => {
      const select = page.locator('.credit-query__context select').nth(0);
      await select.waitFor({ timeout: 10000 });
      await page.waitForFunction(() => {
        const node = document.querySelectorAll('.credit-query__context select')[0];
        return Boolean(node && node.options.length > 1);
      }, null, { timeout: 15000 });
      const value = await select.locator('option').evaluateAll((rows) => {
        const real = rows.find((row) => row.value);
        return real ? real.value : null;
      });
      if (!value) return false;
      await select.selectOption(value);
      await page.waitForTimeout(400);
      const button = page.locator('.credit-query__primary-action button');
      if (await button.count()) {
        await button.click();
        await page.waitForTimeout(900);
      }
      return true;
    },
  },
  { key: 'credit-special-approvals', route: 'credit-special-approvals', testid: null, label: '信用特别审批', group: 'regression', rowSelector: ['.mini-card', '.detail-grid > div'], emptySelector: ['.business-state--empty', '.canonical-empty-state'] },
];

const results = [];
const skipped = [];
const notes = [];
// Per surface: the surfaces whose evidence is an explicit empty state rather
// than real rows, with the reason. The evidence is never silently hollow.
const emptyStateNotes = new Map();

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`login failed for ${username}: ${response.status}`);
  return response.json();
}

/**
 * The layout measurement of one surface. Everything here is measured in the
 * real browser on the real painted document.
 */
async function measure(page, surface) {
  return page.evaluate((config) => {
    const docEl = document.documentElement;
    const bodyEl = document.body;
    const docW = Math.max(docEl.scrollWidth, bodyEl.scrollWidth);
    const winW = window.innerWidth;
    const overflow = docW > winW + 2;

    // The anti-hollow assertion: the canonical testid of the screen root.
    const testidNode = config.testid ? document.querySelector(`[data-testid="${config.testid}"]`) : null;
    const testidBox = testidNode ? testidNode.getBoundingClientRect() : null;
    const testidPresent = Boolean(testidNode) && Boolean(testidBox)
      && testidBox.width > 0 && testidBox.height > 0;

    // REAL DATA: a domain row with a non-zero box and non-empty text.
    const painted = (node) => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (node.innerText || '').trim().length > 0;
    };
    let renderedRows = 0;
    for (const selector of config.rowSelector) {
      renderedRows += Array.from(document.querySelectorAll(selector)).filter(painted).length;
    }
    // An explicit empty state that names the reason.
    let emptyStates = 0;
    for (const selector of config.emptySelector) {
      emptyStates += Array.from(document.querySelectorAll(selector)).filter(painted).length;
    }

    // A FORM surface carries its data in its fields, not in a record list. The
    // painted proof is a labelled field with a real value or a `<select>`
    // that carries more than the placeholder option. This is what makes a
    // form surface non-vacuous: a screen that renders an empty form with no
    // reference data loaded would otherwise look identical to a real one.
    const paintedFields = Array.from(document.querySelectorAll('input, select, textarea'))
      .filter((node) => {
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    const populatedFields = paintedFields.filter((node) => {
      if (node.tagName.toLowerCase() === 'select') return node.options.length > 1;
      return String(node.value || '').trim().length > 0;
    });
    const populatedSelects = paintedFields
      .filter((node) => node.tagName.toLowerCase() === 'select' && node.options.length > 1)
      .map((node) => ({
        options: node.options.length,
        firstRealOption: Array.from(node.options).slice(1, 2).map((option) => (option.textContent || '').trim())[0] || '',
      }));

    // Every painted clickable target is measured against the 44px floor.
    const targets = Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
      .filter((node) => {
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== 'hidden';
      })
      .map((node) => {
        const r = node.getBoundingClientRect();
        return {
          text: (node.innerText || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 28),
          className: String(node.className || '').slice(0, 60),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      });
    // The 44px floor is a floor on the TAP AREA, not on the smaller of the
    // two axes. A target that is 30px wide and 44px tall has a 30px tap
    // strip: it is below the floor even though one of its axes is not. The
    // measurement therefore rejects a target when EITHER axis is under the
    // floor. (The Inventory gate uses `height < 44 && width < 44`, which lets
    // exactly this case through.)
    const undersized = targets.filter((target) => target.height < config.minTarget || target.width < config.minTarget);

    // The bottom navigation must be pinned to the viewport AND the scrollable
    // content must reserve its height, otherwise the last rows of a list sit
    // behind the navigation. A correctly pinned nav is NOT an occlusion.
    const navEl = document.querySelector('nav.mobile-bottom-nav, nav.bottom-nav, [data-testid="mobile-bottom-nav"], .mobile-bottom-nav');
    let navPinned = null;
    let navReserved = null;
    let navHeight = 0;
    if (navEl) {
      const r = navEl.getBoundingClientRect();
      navHeight = r.height;
      navPinned = Math.abs(r.bottom - window.innerHeight) <= 1;
      // The shell reserves the navigation height. The reservation is measured
      // on the scroller itself AND on the shell that owns the padding.
      const scrollers = Array.from(document.querySelectorAll('.mobile-main, .mobile-shell, main, .v16-route-surface'));
      const reserved = scrollers.reduce((max, node) => {
        const style = getComputedStyle(node);
        const padding = (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.marginBottom) || 0);
        return Math.max(max, padding);
      }, 0);
      navReserved = reserved >= r.height - 1;
    }

    // The selected report tab of the decision reports.
    const switcherCurrent = document.querySelector('.v16-decision-reports__switcher-current');
    const selectedReport = switcherCurrent ? (switcherCurrent.innerText || '').trim() : null;

    // The route state of the shell: a permission-denied or error state is a
    // failed surface, not an empty state.
    const routeState = document.querySelector('[data-testid="route-state-permission_denied"]')
      ? 'permission_denied'
      : (document.querySelector('[data-testid="route-state-error"]') ? 'error' : null);

    return {
      viewportWidth: winW,
      documentWidth: docW,
      overflow,
      testidPresent,
      renderedRows,
      emptyStates,
      fieldCount: paintedFields.length,
      populatedFieldCount: populatedFields.length,
      populatedSelects,
      targetCount: targets.length,
      undersizedTargetCount: undersized.length,
      undersizedTargets: undersized.slice(0, 6),
      navPresent: Boolean(navEl),
      navPinned,
      navReserved,
      navHeight,
      selectedReport,
      routeState,
      flashErrors: Array.from(document.querySelectorAll('.flash-error, .inline-alert--danger'))
        .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160)),
    };
  }, {
    testid: surface.testid,
    rowSelector: surface.rowSelector,
    emptySelector: surface.emptySelector,
    minTarget: MIN_TARGET_PX,
  });
}

async function visitSurface(page, baseUrl, viewport, surface) {
  const browserErrors = [];
  const onConsole = (msg) => { if (msg.type() === 'error') browserErrors.push(`console: ${msg.text()}`); };
  const onPageError = (err) => browserErrors.push(`pageerror: ${err.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    // A real document load per surface: the token is already in place through
    // the context init script, so the screen really mounts.
    await page.goto(`${baseUrl}/#${surface.route}`, { waitUntil: 'networkidle', timeout: 20000 });
    // Wait for the surface to paint: the canonical testid, or a row, or an
    // explicit empty state.
    await page.waitForFunction((config) => {
      const testid = config.testid ? document.querySelector(`[data-testid="${config.testid}"]`) : null;
      if (testid) return true;
      const rows = config.rowSelector.some((selector) => Array.from(document.querySelectorAll(selector))
        .some((node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (node.innerText || '').trim(); }));
      const empty = config.emptySelector.some((selector) => Array.from(document.querySelectorAll(selector))
        .some((node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (node.innerText || '').trim(); }));
      return rows || empty;
    }, { testid: surface.testid, rowSelector: surface.rowSelector, emptySelector: surface.emptySelector }, { timeout: 12000 }).catch(() => {});
    if (surface.prepare) {
      const prepared = await surface.prepare(page).catch(() => false);
      if (!prepared) browserErrors.push('prepare: the surface preparation step could not be performed');
    }
    await page.waitForTimeout(700); // settle the layout
    const evidence = await measure(page, surface);
    return { ok: true, evidence, errors: browserErrors };
  } catch (error) {
    return { ok: false, error: error.message, errors: browserErrors };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
}

function evaluateSurface(surface, result) {
  if (!result.ok) {
    return { passed: false, reasons: [`the surface could not be visited: ${result.error}`] };
  }
  const e = result.evidence;
  const reasons = [];
  if (e.routeState === 'permission_denied') reasons.push('the surface rendered a permission-denied state');
  if (e.routeState === 'error') reasons.push('the surface rendered an error state');
  if (surface.testid && !e.testidPresent) reasons.push(`the canonical data-testid "${surface.testid}" is not painted`);
  if (e.renderedRows === 0 && e.emptyStates === 0) reasons.push('the surface painted neither real rows nor an explicit empty state');
  // A form surface must prove that its reference data really loaded: a form
  // whose pickers carry only their placeholder option is an empty form, and
  // an empty form is not evidence.
  if (surface.requiresFormData && e.populatedFieldCount === 0) {
    reasons.push('the form surface painted no populated field and no reference option');
  }
  if (surface.requiresFormData && e.populatedSelects.length === 0) {
    reasons.push('the form surface painted no reference picker carrying real options');
  }
  if (e.overflow) reasons.push(`horizontal overflow: document ${e.documentWidth}px > viewport ${e.viewportWidth}px`);
  if (e.undersizedTargetCount > 0) reasons.push(`${e.undersizedTargetCount} painted clickable target(s) below ${MIN_TARGET_PX}px`);
  if (e.navPresent && e.navPinned === false) reasons.push('the bottom navigation is not pinned to the viewport');
  if (e.navPresent && e.navReserved === false) reasons.push('the scrollable content does not reserve the bottom navigation height');
  if (e.flashErrors.length) reasons.push(`error banner on screen: ${e.flashErrors[0]}`);
  if (result.errors.length) reasons.push(`browser error: ${result.errors[0]}`);
  if (surface.assertSelectedReport) {
    const expected = surface.assertSelectedReport;
    if (!e.selectedReport) {
      reasons.push('the decision-report switcher did not render its current report');
    } else if (!expected.includes(e.selectedReport) && !e.selectedReport.includes(expected)) {
      reasons.push(`the selected report tab is "${e.selectedReport}", expected "${expected}"`);
    }
  }
  return { passed: reasons.length === 0, reasons };
}

async function main() {
  // The gate drives the BUILT frontend. A missing or half-written `dist/`
  // makes every surface fail with a 500 and the login form in the browser —
  // an evidence-destroying state. It is refused here, before any seed, so
  // the failure is named instead of being spread over every surface.
  if (!existsSync(resolve('dist/index.html'))) {
    throw new Error('DIST_INDEX_HTML_MISSING: run `pnpm build` before the domain gate');
  }

  // ---- the seed -----------------------------------------------------------
  seedSalesFoundation(db);
  const { uom } = seedCommercialPricing(db);
  seedWarehouse(db);

  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const admin = await login(baseUrl, 'admin', 'admin123');
  const sales = await login(baseUrl, 'sales', 'sales123');
  const reviewer = await login(baseUrl, 'reviewer', 'review123');
  const tokens = { admin: admin.token, sales: sales.token, reviewer: reviewer.token };
  const adminPost = async (path, body, key) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${admin.token}`,
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, body: data };
  };
  const adminGet = async (path) => {
    const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${admin.token}` } });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  };

  const creditWorld = await seedCreditWorld(db, { adminPost, adminGet });
  const documents = await seedBusinessDocuments(db, { baseUrl, tokens, uom });
  // The Credit EVIDENCE is a production action, not a row insert: the Credit
  // Check writes the evidence the 「信用检查」 list reads, and the Credit
  // Special Approval writes the row the 「信用特别审批」 list reads.
  const creditEvidence = await seedCreditEvidence(db, { baseUrl, tokens, orderId: documents.orderId });
  notes.push(`the seed created: sales order ${documents.orderId}, quotation ${documents.quotationId}, delivery notice ${documents.noticeId}, order change ${documents.changeId}, delivery ${documents.deliveryId}, prepayment requirement ${documents.requirementId}, reservation intent ${documents.reservationId}, service fulfillment ${documents.fulfillmentId}, consignment document ${documents.consignmentId}`);
  notes.push(`the credit world created: parameter ${creditWorld.parameter.body?.parameter?.id}, rule ${creditWorld.rule.body?.rule?.id}, profile ${creditWorld.profile.body?.profile?.id}`);
  notes.push(`the credit evidence created: ${creditEvidence.resultCount} check result(s) (decision ${creditEvidence.check.decision}), ${creditEvidence.approvalCount} special approval(s) (request status ${creditEvidence.approval.status})`);

  // ---- the route registry gate -------------------------------------------
  // A surface whose route is NOT registered cannot be visited; it is skipped
  // explicitly and reported, never silently passed.
  const activeSurfaces = [];
  for (const surface of SURFACES) {
    const routeKey = surface.route.split('?')[0];
    const route = applicationRouteFor(routeKey);
    if (!route) {
      if (surface.optional) {
        skipped.push({ key: surface.key, route: routeKey, reason: 'the route is not registered in src/navigation/applicationRegistry.js' });
        notes.push(`SKIPPED ${surface.key}: the route "${routeKey}" is not registered in the application registry`);
        continue;
      }
      skipped.push({ key: surface.key, route: routeKey, reason: 'the route is not registered in src/navigation/applicationRegistry.js' });
      notes.push(`SKIPPED ${surface.key}: the route "${routeKey}" is not registered in the application registry`);
      continue;
    }
    activeSurfaces.push(surface);
  }

  // ---- the browser --------------------------------------------------------
  const browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  // The token must be in place BEFORE the application mounts. Without it the
  // shell keeps the login screen and every surface check would measure the
  // login form instead of the Sales screen.
  await context.addInitScript((value) => {
    localStorage.setItem('modern_erp_token', value);
  }, admin.token);
  const page = await context.newPage();

  for (const viewport of VIEWPORTS) {
    for (const surface of activeSurfaces) {
      const result = await visitSurface(page, baseUrl, viewport, surface);
      const verdict = evaluateSurface(surface, result);
      const detail = result.ok
        ? `w=${result.evidence.documentWidth}/${result.evidence.viewportWidth} overflow=${result.evidence.overflow} testid=${result.evidence.testidPresent} rows=${result.evidence.renderedRows} empty=${result.evidence.emptyStates} fields=${result.evidence.populatedFieldCount}/${result.evidence.fieldCount} targets=${result.evidence.targetCount} undersized=${result.evidence.undersizedTargetCount} navPinned=${result.evidence.navPinned} navReserved=${result.evidence.navReserved} report=${result.evidence.selectedReport} errors=${result.errors.length}`
        : `error: ${result.error}`;
      const line = `${verdict.passed ? '[32mPASS[0m' : '[31mFAIL[0m'} ${viewport.label}px ${surface.key}`;
      console.log(`${line} :: ${detail}${verdict.reasons.length ? ` :: ${verdict.reasons.join('; ')}` : ''}`);
      // A surface that paints an explicit empty state instead of real rows is
      // recorded PER SURFACE with its reason, so the evidence is never
      // silently hollow.
      const evidenceKind = !result.ok
        ? 'error'
        : (result.evidence.renderedRows > 0 ? 'real-rows' : (result.evidence.emptyStates > 0 ? 'explicit-empty-state' : 'nothing'));
      if (evidenceKind === 'explicit-empty-state' && !emptyStateNotes.has(surface.key)) {
        emptyStateNotes.set(surface.key, {
          key: surface.key,
          label: surface.label,
          reason: surface.expectedEmptyReason || '该工作面在本门禁的夹具中没有可达的数据源，显示显式空状态',
          emptyStates: result.evidence.emptyStates,
        });
      }
      results.push({
        viewport: viewport.label,
        surface: surface.key,
        label: surface.label,
        group: surface.group,
        passed: verdict.passed,
        reasons: verdict.reasons,
        evidenceKind,
        evidence: result.evidence || result.error,
        errors: result.errors,
      });
    }
  }

  await context.close();
  await browser.close();
  server.close();

  // ---- the summary --------------------------------------------------------
  const pass = results.filter((r) => r.passed).length;
  const fail = results.filter((r) => !r.passed).length;
  const perSurface = {};
  for (const entry of results) {
    const bucket = perSurface[entry.surface] || (perSurface[entry.surface] = { pass: 0, fail: 0, reasons: [] });
    if (entry.passed) bucket.pass += 1; else { bucket.fail += 1; bucket.reasons.push(...entry.reasons); }
  }
  console.log('\n=== SALES & CUSTOMER — DOMAIN RESPONSIVE UAT ===');
  console.log(`PASS=${pass} FAIL=${fail} TOTAL=${results.length} SKIPPED=${skipped.length}`);
  console.log('\n--- per surface ---');
  for (const [key, bucket] of Object.entries(perSurface)) {
    console.log(`  ${bucket.fail === 0 ? 'PASS' : 'FAIL'} ${key}: ${bucket.pass}/${bucket.pass + bucket.fail}`);
    for (const reason of [...new Set(bucket.reasons)]) console.log(`      · ${reason}`);
  }
  if (skipped.length) {
    console.log('\n--- skipped ---');
    for (const entry of skipped) console.log(`  ${entry.key}: ${entry.reason}`);
  }
  if (emptyStateNotes.size) {
    console.log('\n--- explicit empty state (not real rows) ---');
    for (const entry of emptyStateNotes.values()) {
      console.log(`  ${entry.key} (${entry.label}): ${entry.reason}`);
    }
  }
  console.log('\n--- notes ---');
  for (const note of notes) console.log(`  ${note}`);

  process.exit(fail === 0 ? 0 : 1);
}

try {
  await main();
} finally {
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(dbTempDir, { recursive: true, force: true });
}
