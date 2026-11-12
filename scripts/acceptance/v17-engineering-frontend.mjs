import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v17-engineering-frontend');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-engineering-ui-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const widths = [320, 390, 430, 680];
const routes = ['engineering-reference', 'boms', 'engineering-substitute', 'engineering-change'];
let browser;

// A reference master must exist so that the lifecycle actions (update /
// deactivate) are actually rendered and can be asserted. Without a fixture
// the lifecycle assertions would silently be skipped.
function ensureReferenceMaster() {
  const now = new Date().toISOString();
  const shiftId = 'v17-ui-shift';
  if (!db.prepare('SELECT 1 FROM engineering_shifts WHERE id=?').get(shiftId)) {
    db.prepare(`INSERT INTO engineering_shifts(id,code,name,start_minute,end_minute,active,notes,created_at,updated_at)
      VALUES(?,?,?,?,?,1,?,?,?)`).run(shiftId, 'V17-UI-SHIFT', '验收用班次', 480, 600, '浏览器验收夹具', now, now);
  }
}

try {
  mkdirSync(outputDir, { recursive: true });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(login.status, 200, 'admin login must succeed');
  const token = (await login.json()).token;
  ensureReferenceMaster();
  browser = await chromium.launch({ executablePath: edgePath, headless: true });

  for (const width of widths) {
    for (const route of routes) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(`${baseUrl}/#${route}`, { waitUntil: 'networkidle' });
      const surface = page.getByTestId(`mobile-application-view-${route}`);
      await surface.waitFor({ timeout: 8000 });
      const metrics = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyText: document.body.innerText,
      }));
      assert.ok(metrics.bodyText.trim().length > 0, `${route}@${width}: empty surface`);
      assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `${route}@${width}: horizontal overflow ${metrics.scrollWidth}/${metrics.clientWidth}`);
      assert.deepEqual(errors, [], `${route}@${width}: browser errors`);

      // The reference master lifecycle must be REACHABLE from the console, not
      // only from the API. Open the first master and assert that its update /
      // deactivate actions exist and keep the 44px touch-target baseline.
      if (route === 'engineering-reference') {
        const firstCard = surface.locator('button.record-card').first();
        assert.ok(await firstCard.count() > 0, `engineering-reference@${width}: no reference master row to open`);
        {
          await firstCard.click();
          const editAction = page.getByRole('button', { name: '编辑', exact: true });
          await editAction.waitFor({ timeout: 8000 });
          const deactivateAction = page.getByRole('button', { name: '停用', exact: true });
          assert.equal(await deactivateAction.count(), 1, `engineering-reference@${width}: the deactivate action must be present`);
          const undersized = await page.evaluate(() => {
            const targets = [...document.querySelectorAll('button')].filter((node) => {
              const box = node.getBoundingClientRect();
              return box.width > 0 && box.height > 0 && box.height < 43.5;
            });
            return targets.map((node) => ({ label: node.textContent.trim(), height: node.getBoundingClientRect().height }));
          });
          assert.deepEqual(undersized, [], `engineering-reference@${width}: touch targets below 44px ${JSON.stringify(undersized)}`);
          const modalOverflow = await page.evaluate(() => {
            const modal = document.querySelector('[role="dialog"], .modal, .sheet');
            if (!modal) return null;
            return modal.scrollWidth - modal.clientWidth;
          });
          assert.ok(modalOverflow === null || modalOverflow <= 1, `engineering-reference@${width}: the detail sheet overflows by ${modalOverflow}`);
          await page.screenshot({ path: join(outputDir, `${route}-detail-${width}.png`), fullPage: true });
        }
      }

      await page.screenshot({ path: join(outputDir, `${route}-${width}.png`), fullPage: true });
      await context.close();
      console.log(`PASS ${route} @ ${width}px`);
    }
  }
  console.log('V17 ENGINEERING FRONTEND RESPONSIVE ACCEPTANCE = PASS');
} finally {
  await browser?.close().catch(() => {});
  await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
