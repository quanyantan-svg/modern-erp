import { useEffect, useState } from 'react';

// Single canonical breakpoint helper. Returns true when the viewport
// matches the given media query. SSR-safe (returns false initially).
//
// The same hook is used by both App.jsx for layout switching and by
// focused tests. The default initial value (false) ensures tests that
// run in jsdom (where matchMedia is not implemented) see a stable
// desktop layout and never silently fall into mobile mode.
//
// M1 contract:
//   < 768px   → mobile  (useMobile() === true)
//   >= 768px  → tablet / desktop
//   >= 1024px → desktop (useDesktop() === true)
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mql = window.matchMedia(query);
    const handler = (event) => setMatches(event.matches);
    setMatches(mql.matches);
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    if (mql.addListener) {
      mql.addListener(handler);
      return () => mql.removeListener(handler);
    }
    return undefined;
  }, [query]);

  return matches;
}

// Convenience: mobile shell threshold (< 768px).
// Note: max-width: 767.98px matches the canonical CSS breakpoint.
export function useMobile() {
  return useMediaQuery('(max-width: 767.98px)');
}

// Convenience: desktop shell threshold (>= 1024px).
export function useDesktop() {
  return useMediaQuery('(min-width: 1024px)');
}
