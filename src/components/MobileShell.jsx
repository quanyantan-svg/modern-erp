// M1 Mobile Shell — layout infrastructure only.
//
// Responsibilities:
//   - mobile top bar
//   - main content container
//   - bottom navigation (4 enabled tabs + 1 disabled tab)
//   - safe-area spacing
//   - active tab state
//   - current page title
//   - current user / role summary where appropriate
//
// This component MUST NOT make business API calls.
// It does not know how sales orders, inventory or vouchers work.
//
// M1 contract:
//   - 4 active tabs: messages / approvals / apps / profile
//   - 1 disabled tab: directory ("敬请期待")
//   - disabled tab does not navigate, does not throw
//   - bottom nav stays fixed, respects safe-area-inset-bottom
//   - active state clearly visible
//   - touch targets >= 44x44 CSS px
//   - usable at 320px width

import { useCallback } from 'react';

// Reusable inline SVG icon (matches existing App.jsx style).
const MobileIcon = ({ d, size = 22, strokeWidth = 1.8 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const TAB_ICONS = {
  messages: (
    <MobileIcon d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  ),
  approvals: (
    <MobileIcon d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  ),
  apps: (
    <MobileIcon d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
  ),
  directory: (
    <MobileIcon d="M17 20h5v-2a3 3 0 0 0-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 0 1 5.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 0 1 9.288 0M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm6 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
  ),
  profile: (
    <MobileIcon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
  ),
};

const TABS = [
  { key: 'messages', label: '消息', icon: 'messages', enabled: true },
  { key: 'approvals', label: '审批', icon: 'approvals', enabled: true },
  { key: 'apps', label: '应用', icon: 'apps', enabled: true },
  { key: 'directory', label: '通讯录', icon: 'directory', enabled: false, hint: '敬请期待' },
  { key: 'profile', label: '我的', icon: 'profile', enabled: true },
];

// MobileHeader — top bar of the mobile shell.
//   Shows: optional back action + page title + optional right action.
function MobileHeader({ brand, pageTitle, pageSubtitle, backAction, rightAction }) {
  return (
    <header className="mobile-header" data-testid="mobile-header">
      <div className="mobile-header__brand">
        {backAction ? (
          <button
            type="button"
            className="mobile-header__back"
            data-testid="mobile-header-back"
            aria-label="返回应用"
            onClick={backAction}
          >
            <MobileIcon d="M15 18l-6-6 6-6" size={22} />
          </button>
        ) : null}
        <div>
          {pageTitle ? (
            <>
              <div className="mobile-header__title">{pageTitle}</div>
              {pageSubtitle ? (
                <div className="mobile-header__sub">{pageSubtitle}</div>
              ) : null}
            </>
          ) : (
            <div className="mobile-header__title">{brand}</div>
          )}
        </div>
      </div>
      {rightAction ? (
        <div className="mobile-header__actions">{rightAction}</div>
      ) : null}
    </header>
  );
}

// MobileBottomNav — fixed bottom navigation.
//   Renders 5 tabs in a 5-column grid.
//   Disabled tabs are visually muted, do not navigate, do not throw.
//   onTabChange: (tabKey) => void
function MobileBottomNav({ activeTab, onTabChange, tabBadges = {} }) {
  return (
    <nav
      className="mobile-bottom-nav"
      data-testid="mobile-bottom-nav"
      role="navigation"
      aria-label="底部导航"
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        const className = [
          'mobile-bottom-nav__item',
          isActive ? 'mobile-bottom-nav__item--active' : '',
          tab.enabled ? '' : 'mobile-bottom-nav__item--disabled',
        ]
          .filter(Boolean)
          .join(' ');

        if (!tab.enabled) {
          return (
            <button
              type="button"
              key={tab.key}
              data-testid={`bottom-tab-${tab.key}`}
              data-disabled="true"
              className={className}
              aria-disabled="true"
              aria-label={`${tab.label}(尚未开通)`}
              onClick={(e) => {
                e.preventDefault();
                // Disabled tab must not navigate or throw.
              }}
            >
              <span className="mobile-bottom-nav__icon">{TAB_ICONS[tab.icon]}</span>
              <span className="mobile-bottom-nav__label">{tab.label}</span>
              {tab.hint ? (
                <span className="mobile-bottom-nav__hint">{tab.hint}</span>
              ) : null}
            </button>
          );
        }

        return (
          <button
            type="button"
            key={tab.key}
            data-testid={`bottom-tab-${tab.key}`}
            className={className}
            aria-current={isActive ? 'page' : undefined}
            aria-label={tab.label}
            onClick={() => onTabChange && onTabChange(tab.key)}
          >
            <span className="mobile-bottom-nav__icon">{TAB_ICONS[tab.icon]}{tabBadges[tab.key] > 0 ? <span className="mobile-bottom-nav__badge" aria-label={`${tabBadges[tab.key]} 项待处理`}>{tabBadges[tab.key] > 99 ? '99+' : tabBadges[tab.key]}</span> : null}</span>
            <span className="mobile-bottom-nav__label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// MobileShell — public component.
//
// Props:
//   brand         (string)  — product brand text
//   pageTitle     (string?) — current page title; falls back to brand
//   pageSubtitle  (string?) — current page subtitle
//   activeTab     (string)  — currently active tab key
//   onTabChange   (fn)      — (tabKey) => void
//   backAction    (fn?)      — return from an application to the launcher
//   rightAction   (node?)   — top bar right-side action
//   children      (node)    — main page content
export default function MobileShell({
  brand = 'Modern ERP',
  pageTitle,
  pageSubtitle,
  activeTab,
  onTabChange,
  backAction,
  rightAction,
  tabBadges,
  children,
}) {
  const handleTabChange = useCallback(
    (key) => {
      if (typeof onTabChange === 'function') onTabChange(key);
    },
    [onTabChange]
  );

  return (
    <div className="mobile-shell" data-testid="mobile-shell">
      <MobileHeader
        brand={brand}
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle}
        backAction={backAction}
        rightAction={rightAction}
      />
      <main className="mobile-main" data-testid="mobile-main">
        {children}
      </main>
      <MobileBottomNav activeTab={activeTab} onTabChange={handleTabChange} tabBadges={tabBadges} />
    </div>
  );
}

// Export tab list for testability and external use.
export { TABS as MOBILE_TABS };
