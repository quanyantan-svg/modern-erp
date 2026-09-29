import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { describe, test } from 'node:test';

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const metadataSource = readFileSync(new URL('../src/navigation/applicationMetadata.js', import.meta.url), 'utf8');
const legacyMediaHook = new URL('../src/hooks/useMediaQuery.js', import.meta.url);

describe('V1.2 canonical interface cleanup', () => {
  test('the application renders exactly one canonical workspace shell', () => {
    assert.equal((appSource.match(/<MobileShell/g) || []).length, 1);
    assert.doesNotMatch(appSource, /isMobile|useMobile|useDesktop|useMediaQuery|matchMedia|innerWidth/);
  });

  test('the obsolete viewport routing hook has been removed', () => {
    assert.equal(existsSync(legacyMediaHook), false);
  });

  test('legacy desktop chrome selectors and layout tokens are gone', () => {
    for (const selector of ['.app-shell', '.main-area', '.sidebar', '.topbar', '.user-area', '.user-info']) {
      assert.equal(cssSource.includes(selector), false, `${selector} must not remain in canonical CSS`);
    }
    assert.doesNotMatch(cssSource, /--sidebar-width|--topbar-height/);
  });

  test('responsive CSS does not switch between duplicate interface variants', () => {
    assert.doesNotMatch(cssSource, /\.desktop-only|\.mobile-only|routing-list-desktop|routing-list-mobile/);
    assert.doesNotMatch(cssSource, /hide desktop chrome|existing desktop pages|Legacy desktop tables/);
  });

  test('navigation metadata describes one application information architecture', () => {
    assert.doesNotMatch(metadataSource, /desktop navigation/i);
    assert.match(metadataSource, /Authorization still comes only/);
    assert.match(metadataSource, /authorizedByPage/);
  });
});
