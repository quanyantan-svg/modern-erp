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
  test('launcher uses a dense fixed two-line rhythm without reducing touch targets', () => {
    assert.match(css, /\.mobile-launcher\s*\{[^}]*gap:20px/s);
    assert.match(css, /\.mobile-launcher__item\s*\{[^}]*grid-template-rows:36px 34px[^}]*min-height:84px/s);
    assert.match(css, /\.mobile-launcher__item-label\s*\{[^}]*min-height:32px[^}]*line-height:16px/s);
  });

  test('ordinary launcher icons are plain and only category leaders retain a tint', () => {
    assert.match(css, /\.mobile-launcher__item-icon\s*\{[^}]*background:transparent/s);
    assert.match(css, /\.mobile-launcher__item:first-child \.mobile-launcher__item-icon\s*\{[^}]*background:var\(--mobile-app-accent-soft\)/s);
    assert.match(launcher, /OPTICALLY_COMPACT_ICONS/);
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
