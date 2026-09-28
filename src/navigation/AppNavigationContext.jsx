import { createContext, useContext } from 'react';

const AppNavigationContext = createContext({
  currentPage: null,
  target: null,
  canNavigate: () => false,
  navigateToPage: () => false,
});

export function AppNavigationProvider({ value, children }) {
  return <AppNavigationContext.Provider value={value}>{children}</AppNavigationContext.Provider>;
}

export function useAppNavigation() {
  return useContext(AppNavigationContext);
}

export function AppLink({ page, documentId, documentType, target, children, onClick, ...props }) {
  const { canNavigate, navigateToPage } = useAppNavigation();
  if (!canNavigate(page)) return <span {...props}>{children}</span>;
  return <a
    {...props}
    href={`#${page}`}
    onClick={(event) => {
      event.preventDefault();
      onClick?.(event);
      navigateToPage(page, documentId ? { documentId, documentType } : (target || null));
    }}
  >{children}</a>;
}
