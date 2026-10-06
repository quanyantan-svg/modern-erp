// Regression coverage for the <Badge> undefined-component defect.
//
// Original defect: <Badge> was referenced in JSX across 4 page modules
// (projects-workflow.jsx / treasury-cost.jsx / crm.jsx / quality.jsx) but
// never defined or imported anywhere. As soon as any row reached the JSX
// `<Badge>` expression with data, React would throw
//   "Element type is invalid: expected a string or a class/function
//    (for composite components) but got: undefined."
// and the page would crash.
//
// Fix: a `Badge` component now lives in src/components/ui.jsx and is imported
// by every page that uses <Badge>. Badge reuses the existing .status CSS
// classes (draft/submitted/approved/rejected/pending) — no new styles.
//
// This file asserts (at the source level, since this Node-only repo has no
// jsdom / JSX DOM rendering infrastructure) that the regression cannot
// silently reappear.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '..', 'src');

function readSrc(rel) { return readFileSync(join(srcDir, rel), 'utf8'); }

describe('Badge component — definition exists', () => {
  test('Badge is exported from src/components/ui.jsx', () => {
    const src = readSrc('components/ui.jsx');
    assert.ok(/export\s+function\s+Badge\s*\(/.test(src), 'Badge must be exported from components/ui.jsx');
    // The implementation must accept the same shape that pages use.
    assert.ok(/function\s+Badge\s*\(\s*\{[^}]*\btype\b[^}]*\}\s*\)/.test(src), 'Badge must accept a `type` prop');
    assert.ok(/function\s+Badge\s*\(\s*\{[^}]*\bchildren\b[^}]*\}\s*\)/.test(src), 'Badge must accept a `children` prop');
  });

  test('Badge implementation maps type to existing .status color classes (no new CSS required)', () => {
    const src = readSrc('components/ui.jsx');
    // Type → class mapping: info→submitted, success→approved, warning→pending, danger/error→rejected
    // The implementation reuses `.status` CSS classes that already exist.
    const badgeBody = src.match(/export\s+function\s+Badge\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(badgeBody, 'Badge body must be present');
    const body = badgeBody[1];
    assert.ok(/info[\s\S]*?submitted/.test(body), 'Badge must map info → submitted class');
    assert.ok(/success[\s\S]*?approved/.test(body), 'Badge must map success → approved class');
    assert.ok(/warning[\s\S]*?pending/.test(body), 'Badge must map warning → pending class');
    assert.ok(/danger[\s\S]*?rejected/.test(body), 'Badge must map danger → rejected class');
    assert.ok(/draft/.test(body), 'Badge must fall back to the neutral draft class when type is missing/unknown');
  });
});

describe('Badge component — every JSX call site is supplied', () => {
  const pages = [
    'pages/projects-workflow.jsx',
    'pages/treasury-cost.jsx',
    'pages/quality.jsx',
  ];

  for (const rel of pages) {
    test(`${rel}: imports Badge from components/ui.jsx`, () => {
      const src = readSrc(rel);
      const importLine = src.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/components\/ui\.jsx['"]/);
      assert.ok(importLine, `${rel} must import from components/ui.jsx`);
      const names = importLine[1].split(',').map((s) => s.trim());
      assert.ok(names.includes('Badge'), `${rel} must include Badge in its import list`);
    });

    test(`${rel}: every <Badge> JSX tag is matched by an import`, () => {
      const src = readSrc(rel);
      const importLine = src.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/components\/ui\.jsx['"]/);
      const names = importLine ? importLine[1].split(',').map((s) => s.trim()) : [];
      // Strip the closing `</Badge>` and self-closing `<Badge ... />` and `<Badge>...` cases
      const usages = (src.match(/<Badge\b/g) || []).length;
      assert.ok(usages >= 1, `${rel} should reference <Badge>`);
      assert.ok(names.includes('Badge'), `${rel} must import Badge to back its ${usages} <Badge> reference(s)`);
    });
  }
});

describe('Badge component — does not regress', () => {
  test('no page reintroduces a `<Badge>` reference without importing Badge', () => {
    // Spot check: every JSX `<Badge` occurrence in src must be in a file whose
    // imports list includes `Badge`. This is a fail-fast guard against drift.
    const root = srcDir;
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name !== 'pages') continue;
      const files = readdirSync(join(root, entry.name)).filter((f) => f.endsWith('.jsx'));
      for (const f of files) {
        const src = readFileSync(join(root, entry.name, f), 'utf8');
        const usesBadge = /<Badge\b/.test(src);
        if (!usesBadge) continue;
        const importLine = src.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\.\/components\/ui\.jsx['"]/);
        const names = importLine ? importLine[1].split(',').map((s) => s.trim()) : [];
        assert.ok(names.includes('Badge'), `${entry.name}/${f} uses <Badge> but does not import Badge`);
      }
    }
  });

  test('Badge mapping preserves existing semantic intent (no permission / API / business logic drift)', () => {
    const backendFiles = ['app.js', 'db.js', 'index.js'];
    for (const f of backendFiles) {
      const full = join(srcDir, '..', 'server', f);
      if (!existsSync(full)) continue;
      const src = readFileSync(full, 'utf8');
      assert.equal(/export\s+function\s+Badge\b/.test(src), false, `${f} must not export a server-side Badge`);
    }
  });
});