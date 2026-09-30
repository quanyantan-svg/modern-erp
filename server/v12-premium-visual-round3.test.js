import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const css = read('src', 'styles.css');
const launcher = read('src', 'components', 'MobileLauncher.jsx');
const shell = read('src', 'components', 'MobileShell.jsx');
const visualAcceptance = read('scripts', 'acceptance', 'v12-visual-acceptance.mjs');

describe('V1.2 premium visual polish round 3', () => {
  // V1.6 P1B: launcher CSS moved to v16-mobile-enterprise.css.
  const v16Css = read('src', 'styles', 'v16-mobile-enterprise.css');

  test('V1.6 launcher uses a dense fixed two-line rhythm without reducing touch targets', () => {
    assert.match(v16Css, /\.v16-launcher-grid\s*\{[^}]*gap:\s*var\(--v16-space-3\)/s);
    assert.match(v16Css, /\.v16-launcher-tile\s*\{[^}]*min-height:\s*82px/s);
    assert.match(v16Css, /\.v16-launcher-tile__label\s*\{[^}]*line-height:\s*1\.35/s);
  });

  test('V1.6 launcher tile icons use a soft accent background consistently', () => {
    assert.match(v16Css, /\.v16-launcher-tile__icon\s*\{[^}]*background:\s*var\(--v16-accent-soft\)/s);
    // V1.6 removed the "category leader tint" asymmetry; every tile uses
    // the same soft accent background.
    assert.match(v16Css, /\.v16-quick-action__icon\s*\{[^}]*background:\s*var\(--v16-accent-soft\)/s);
  });

  test('application root has its own compact header treatment and no forced back affordance', () => {
    assert.match(shell, /root=\{activeTab === 'apps' && !backAction\}/);
    assert.match(css, /\.mobile-header--root \.mobile-header__title\s*\{[^}]*font-size:20px/s);
  });

  test('visual acceptance distinguishes viewport and full-page evidence', () => {
    assert.match(visualAcceptance, /fullPage\s*=\s*false/);
    assert.match(visualAcceptance, /fullPage:\s*true/);
    for (const position of ['top', 'middle', 'bottom']) assert.match(visualAcceptance, new RegExp(`launcher-${position}`));
  });

  test('generated visual evidence defaults to ignored temporary output while preserving an explicit output override', () => {
    assert.match(visualAcceptance, /process\.argv\[2\]\s*\?\s*resolve\(process\.argv\[2\]\)/);
    assert.match(visualAcceptance, /resolve\(repoRoot, '\.tmp\/v12-visual'\)/);
    assert.doesNotMatch(visualAcceptance, /artifacts\/v12-visual/);
    assert.match(visualAcceptance, /mkdir\(outputDir, \{ recursive: true \}\)/);
  });
});
