import { createContext, useContext } from 'react';
import { serializeRouteLocation } from './routeLocation.js';

const AppNavigationContext = createContext({
  currentLocation: null,
  currentRoute: null,
  currentPage: null,
  target: null,
  canNavigate: () => false,
  navigate: () => false,
  hrefFor: (routeKey, target) => serializeRouteLocation({ routeKey, target }),
  navigateToPage: () => false,
  setHeaderBackAction: () => {},
  registerHeaderBackAction: () => () => {},
});

export function AppNavigationProvider({ value, children }) {
  return <AppNavigationContext.Provider value={value}>{children}</AppNavigationContext.Provider>;
}

export function useAppNavigation() {
  return useContext(AppNavigationContext);
}

export function AppLink({ page, documentId, documentType, target, children, onClick, ...props }) {
  const { canNavigate, navigate, navigateToPage, hrefFor = (routeKey, nextTarget) => serializeRouteLocation({ routeKey, target: nextTarget }) } = useAppNavigation();
  const exactTarget = documentId ? { documentId, ...(documentType ? { documentType } : {}) } : (target || null);
  if (!canNavigate(page)) return <span {...props}>{children}</span>;
  return <a
    {...props}
    href={hrefFor(page, exactTarget)}
    onClick={(event) => {
      event.preventDefault();
      onClick?.(event);
      if (navigate) navigate({ routeKey: page, target: exactTarget });
      else navigateToPage(page, exactTarget);
    }}
  >{children}</a>;
}
