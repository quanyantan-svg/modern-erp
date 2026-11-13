// Inventory & Warehouse — Responsive UAT at 320 / 390 / 430 / 680 CSS px.
// Drives the live frontend at http://127.0.0.1:5181 using playwright-core / Edge.
// Captures console / pageerror / horizontal overflow / primary action visibility
// across the canonical inventory surfaces.
//
// V24 (2026-11-12) — the evidence is de-vacuumed: a surface only passes when
// it rendered REAL data (a domain row with a non-zero box and non-empty text)
// or an explicit empty state, every painted clickable target is measured
// against the 44px floor, and the canonical inventory work surface is walked
// tab by tab so a tab that renders nothing can no longer pass as "element
// exists".

import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-inv-responsive-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));

const VIEWPORTS = [
  { width: 320, height: 800, label: '320' },
  { width: 390, height: 844, label: '390' },
  { width: 430, height: 900, label: '430' },
  { width: 680, height: 900, label: '680' },
];

// Canonical Inventory surfaces (frozen by solution.md §27.47)
const SURFACES = [
  { route: 'warehouses', label: 'Inventory Hub / Warehouse' },
  { route: 'inventory', label: 'Instant Stock' },
  { route: 'inventory-transactions', label: 'Inventory Transactions / Reports' },
  { route: 'inventory-scraps', label: 'Adjustment / Scrap' },
  { route: 'inventory-month-end', label: 'Period' },
  { route: 'traceability', label: 'Traceability' },
];

const results = [];
async function loginToken(page, username, password) {
  const r = await page.evaluate(async ({ username, password }) => {
    const result = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return result.json();
  }, { username, password });
  return r.token;
}

async function checkSurface(page, baseUrl, viewport, surface) {
  const browserErrors = [];
  const handler1 = (msg) => { if (msg.type() === 'error') browserErrors.push(`console: ${msg.text()}`); };
  const handler2 = (err) => browserErrors.push(`pageerror: ${err.message}`);
  page.on('console', handler1);
  page.on('pageerror', handler2);
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${baseUrl}#${surface.route}`, { waitUntil: 'networkidle', timeout: 15000 });
    // The surface loads its data asynchronously: wait until the domain list has
    // painted (or until an explicit empty state is on screen) before the
    // layout is measured.
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('.inv-work-row, .v16-inventory-row, .inv-work-list > *, table tbody tr, .compact-record');
      const empty = document.querySelectorAll('.canonical-empty-state, .business-state, .empty-state, .inv-work-empty, .empty');
      return rows.length > 0 || empty.length > 0;
    }, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800); // settle layout
    const evidence = await page.evaluate(() => {
      // horizontal overflow
      const docEl = document.documentElement;
      const bodyEl = document.body;
      const docW = Math.max(docEl.scrollWidth, bodyEl.scrollWidth);
      const winW = window.innerWidth;
      const overflow = docW > winW + 2; // tolerate 2px rounding
      // primary action visible: look for any primary button in the bottom nav or header
      const primaryBtn = document.querySelector('button.primary, a.primary, [data-role="primary"]');
      let primaryVisible = false;
      let primaryMin = 0;
      if (primaryBtn) {
        const r = primaryBtn.getBoundingClientRect();
        primaryVisible = r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight;
        primaryMin = Math.min(r.width, r.height);
      }
      // bottom nav presence
      const navEl = document.querySelector('nav.bottom-nav, [data-role="bottom-nav"], .bottom-nav, .mobile-bottom-nav');
      let navCoversContent = false;
      if (navEl) {
        const r = navEl.getBoundingClientRect();
        // The bottom navigation must be pinned to the viewport AND the
        // scrollable content must reserve its height, otherwise the last
        // rows of a list sit behind the navigation.
        const pinned = Math.abs(r.bottom - window.innerHeight) <= 1;
        const scroller = document.querySelector('.mobile-shell, .mobile-application-view, .v16-route-surface, main');
        const reserved = scroller ? (parseFloat(getComputedStyle(scroller).paddingBottom) || 0) : 0;
        navCoversContent = !pinned || reserved < r.height - 1;
      }
      // sheet/modal check
      const sheet = document.querySelector('.sheet, .modal, [role="dialog"]');
      // REAL DATA: a domain row with a non-zero box and non-empty text, or an
      // explicit empty state that names the reason. A surface that only shows
      // its chrome is not evidence.
      const rowSelectors = ['.inv-work-row', '.v16-inventory-row', '.inv-work-list > *', 'table tbody tr', '.compact-record', '.inventory-record', '.mobile-card__row'];
      let renderedRows = 0;
      for (const selector of rowSelectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        renderedRows += nodes.filter((node) => {
          const r = node.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (node.innerText || '').trim().length > 0;
        }).length;
      }
      const emptyStates = Array.from(document.querySelectorAll('.canonical-empty-state, .business-state, .empty-state, .inv-work-empty, .empty'))
        .filter((node) => (node.innerText || '').trim().length > 0).length;
      // Every painted clickable target is measured: a target that is painted
      // but smaller than the 44px floor is a defect.
      const targets = Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
        .filter((node) => {
          const r = node.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== 'hidden';
        })
        .map((node) => {
          const r = node.getBoundingClientRect();
          return { text: (node.innerText || node.getAttribute('aria-label') || '').trim().slice(0, 24), width: Math.round(r.width), height: Math.round(r.height) };
        });
      const undersized = targets.filter((target) => target.height < 44 && target.width < 44);
      return {
        viewportWidth: winW,
        documentWidth: docW,
        overflow,
        primaryVisible,
        primaryMinHeight: primaryMin,
        navEl: !!navEl,
        sheetOpen: !!sheet,
        navCoversContent,
        renderedRows,
        emptyStates,
        targetCount: targets.length,
        undersizedTargets: undersized.slice(0, 5),
        undersizedTargetCount: undersized.length,
      };
    });
    return { ok: true, evidence, errors: browserErrors };
  } catch (e) {
    return { ok: false, error: e.message, errors: browserErrors };
  } finally {
    page.off('console', handler1);
    page.off('pageerror', handler2);
  }
}

/**
 * Walk every tab of the canonical Inventory & Warehouse work surface. Each
 * tab must render real data or an explicit empty state, and it must not
 * raise a console error — a tab that renders nothing can no longer pass.
 */
async function walkWorkSurfaceTabs(page, baseUrl, viewport) {
  const errors = [];
  const handler = (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); };
  const handler2 = (err) => errors.push(`pageerror: ${err.message}`);
  page.on('console', handler);
  page.on('pageerror', handler2);
  const results = [];
  try {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${baseUrl}#inventory`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(800);
    const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.inv-work-tabs button')).map((node) => node.innerText.trim()));
    for (const label of tabs) {
      const before = errors.length;
      const clicked = await page.evaluate((text) => {
        const button = Array.from(document.querySelectorAll('.inv-work-tabs button')).find((node) => node.innerText.trim() === text);
        if (!button) return false;
        button.click();
        return true;
      }, label);
      if (!clicked) { results.push({ label, ok: false, detail: 'tab not found' }); continue; }
      await page.waitForTimeout(900);
      const state = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.inv-work-row, .v16-inventory-row, .inv-work-list > *, .inventory-record, .mobile-card__row'))
          .filter((node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (node.innerText || '').trim().length > 0; }).length;
        const empty = Array.from(document.querySelectorAll('.canonical-empty-state, .business-state, .empty'))
          .filter((node) => (node.innerText || '').trim().length > 0).length;
        // A form surface carries its data in real fields: a filled input,
        // select or textarea, or a labelled value.
        const formFields = Array.from(document.querySelectorAll('input, select, textarea'))
          .filter((node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
          .filter((node) => String(node.value || '').trim().length > 0 || node.tagName.toLowerCase() === 'select').length;
        const docEl = document.documentElement;
        const overflow = Math.max(docEl.scrollWidth, document.body.scrollWidth) > window.innerWidth + 2;
        const undersized = Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
          .filter((node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
          .filter((node) => { const r = node.getBoundingClientRect(); return r.height < 44 && r.width < 44; }).length;
        return { rows, empty, formFields, overflow, undersized };
      });
      const ok = state.rows > 0 || state.empty > 0 || state.formFields > 0;
      results.push({
        label,
        ok: ok && !state.overflow && state.undersized === 0 && errors.length === before,
        detail: `rows=${state.rows} empty=${state.empty} fields=${state.formFields} overflow=${state.overflow} undersized=${state.undersized} errors=${errors.length - before}`,
      });
    }
  } finally {
    page.off('console', handler);
    page.off('pageerror', handler2);
  }
  return results;
}

async function main() {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const token = await loginToken(page, 'admin', 'admin123');
  await page.evaluate((t) => localStorage.setItem('modern_erp_token', t), token);
  // The token must be in place BEFORE the application mounts: without the
  // reload the shell keeps the login screen and every surface check would
  // measure the login form instead of the inventory screen.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // The canonical work surface is walked tab by tab: every tab must render
  // real data or an explicit empty state.
  for (const viewport of VIEWPORTS) {
    const tabResults = await walkWorkSurfaceTabs(page, baseUrl, viewport);
    for (const entry of tabResults) {
      const line = `${entry.ok ? '[32mPASS[0m' : '[31mFAIL[0m'} ${viewport.label}px inventory:${entry.label}`;
      console.log(`${line} :: ${entry.detail}`);
      results.push({ viewport: viewport.label, surface: `inventory:${entry.label}`, passed: entry.ok, evidence: entry.detail, errors: [] });
    }
  }

  for (const viewport of VIEWPORTS) {
    for (const surface of SURFACES) {
      const result = await checkSurface(page, baseUrl, viewport, surface);
      const passed = result.ok
        && !result.evidence.overflow
        && (result.evidence.primaryMinHeight === 0 || result.evidence.primaryMinHeight >= 44)
        && !result.evidence.navCoversContent
        && result.errors.length === 0
        // REAL DATA: rows rendered, or an explicit empty state
        && (result.evidence.renderedRows > 0 || result.evidence.emptyStates > 0)
        // every painted clickable target meets the 44px floor
        && result.evidence.undersizedTargetCount === 0;
      const line = `${passed ? '[32mPASS[0m' : '[31mFAIL[0m'} ${viewport.label}px ${surface.route}`;
      const detail = result.ok
        ? `w=${result.evidence.documentWidth}/${result.evidence.viewportWidth} overflow=${result.evidence.overflow} primaryH=${result.evidence.primaryMinHeight} navCovers=${result.evidence.navCoversContent} rows=${result.evidence.renderedRows} empty=${result.evidence.emptyStates} targets=${result.evidence.targetCount} undersized=${result.evidence.undersizedTargetCount} errors=${result.errors.length}`
        : `error: ${result.error} errors=${JSON.stringify(result.errors).slice(0,120)}`;
      console.log(`${line} :: ${detail}`);
      results.push({ viewport: viewport.label, surface: surface.route, passed, evidence: result.evidence || result.error, errors: result.errors });
    }
  }

  await browser.close();
  server.close();

  const pass = results.filter((r) => r.passed).length;
  const fail = results.filter((r) => !r.passed).length;
  console.log(`\n=== INVENTORY & WAREHOUSE — RESPONSIVE UAT ===\nPASS=${pass} FAIL=${fail} TOTAL=${results.length}`);
  if (fail > 0) {
    console.log('Failures:');
    for (const f of results.filter((r) => !r.passed)) console.log(`  ${f.viewport}px ${f.surface}: ${JSON.stringify(f.evidence).slice(0,200)}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

await main();