// Inventory & Warehouse — Responsive UAT at 320 / 390 / 430 / 680 CSS px.
// Drives the live frontend at http://127.0.0.1:5181 using playwright-core / Edge.
// Captures console / pageerror / horizontal overflow / primary action visibility
// across the canonical inventory surfaces.

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
    await page.waitForTimeout(500); // settle layout
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
        navCoversContent = r.bottom > window.innerHeight - 1;
      }
      // sheet/modal check
      const sheet = document.querySelector('.sheet, .modal, [role="dialog"]');
      return {
        viewportWidth: winW,
        documentWidth: docW,
        overflow,
        primaryVisible,
        primaryMinHeight: primaryMin,
        navEl: !!navEl,
        sheetOpen: !!sheet,
        navCoversContent,
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

  for (const viewport of VIEWPORTS) {
    for (const surface of SURFACES) {
      const result = await checkSurface(page, baseUrl, viewport, surface);
      const passed = result.ok
        && !result.evidence.overflow
        && (result.evidence.primaryMinHeight === 0 || result.evidence.primaryMinHeight >= 44)
        && !result.evidence.navCoversContent
        && result.errors.length === 0;
      const line = `${passed ? '[32mPASS[0m' : '[31mFAIL[0m'} ${viewport.label}px ${surface.route}`;
      const detail = result.ok
        ? `w=${result.evidence.documentWidth}/${result.evidence.viewportWidth} overflow=${result.evidence.overflow} primaryH=${result.evidence.primaryMinHeight} navCovers=${result.evidence.navCoversContent} errors=${result.errors.length}`
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