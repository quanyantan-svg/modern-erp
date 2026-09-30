import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const css = read('src', 'styles.css');
const app = read('src', 'App.jsx');
const icons = read('src', 'components', 'icons.jsx');
const launcher = read('src', 'components', 'MobileLauncher.jsx');
const shell = read('src', 'components', 'MobileShell.jsx');

describe('V1.2 premium visual system', () => {
  test('uses one tree-shakeable line icon family through the canonical wrapper', () => {
    assert.match(icons, /from 'lucide-react'/);
    assert.match(icons, /export function Icon\b/);
    assert.doesNotMatch(app, /const Icon\s*=|<svg\b/);
    assert.doesNotMatch(launcher, /<svg\b|FallbackIcon/);
  });

  test('keeps the exact five-tab contract with 24px canonical icons', () => {
    // V1.6 P1A: cloud/云翼/签核 replaced by workspace/工作台/审批.
    for (const label of ['消息', '审批', '应用', '工作台', '我的']) assert.match(shell, new RegExp(`label: '${label}'`));
    assert.match(shell, /<Icon name="message" size=\{24\}/);
    assert.match(css, /\.mobile-bottom-nav__item\s*\{[^}]*min-height:58px/s);
  });

  test('ships restrained motion with a reduced-motion escape hatch', () => {
    assert.match(css, /180ms cubic-bezier\(\.2,\.8,\.2,1\)/);
    assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
    assert.doesNotMatch(css, /parallax|scroll-trigger|bounce/);
  });

  test('preserves the centered canonical workspace at every wide viewport', () => {
    assert.match(css, /--app-max-width:\s*600px/);
    assert.match(css, /\.mobile-shell\s*\{[^}]*max-width:\s*var\(--app-max-width\)[^}]*margin:\s*0 auto/s);
    assert.doesNotMatch(css, /@media\s*\(min-width:[^)]+\)[\s\S]{0,250}(?:sidebar|desktop-table)/i);
  });

  test('defines premium hierarchy for sheets, cards, empty states and focus', () => {
    assert.match(css, /\.sheet::before, \.modal::before/);
    assert.match(css, /\.record-card\s*\{[^}]*padding:16px/s);
    assert.match(css, /\.canonical-empty-state > svg/);
    assert.match(css, /:where\(button, input, select, textarea, summary, a\):focus-visible/);
  });
});
