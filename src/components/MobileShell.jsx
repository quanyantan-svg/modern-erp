// M1 Mobile Shell — layout infrastructure only.
//
// Responsibilities:
//   - mobile top bar
//   - main content container
//   - canonical five-tab bottom navigation
//   - safe-area spacing
//   - active tab state
//   - current page title
//   - current user / role summary where appropriate
//
// This component MUST NOT make business API calls.
// It does not know how sales orders, inventory or vouchers work.
//
// M1 contract:
//   - 5 active tabs: messages / approvals / apps / workspace / profile
//   - bottom nav stays fixed, respects safe-area-inset-bottom
//   - active state clearly visible
//   - touch targets >= 44x44 CSS px
//   - usable at 320px width
//
// V1.6 P1A contract (replaces the legacy collaboration tab with workspace/工作台):
//   - exactly 5 enabled tabs
//   - exact labels: 消息 / 审批 / 应用 / 工作台 / 我的
//   - internal keys: messages / approvals / apps / workspace / profile
//   - no active legacy collaboration tab.

import { useCallback } from 'react';
import { Icon } from './icons.jsx';

const TAB_ICONS = {
  messages: <Icon name="message" size={24}/>,
  approvals: <Icon name="approval" size={24}/>,
  apps: <Icon name="apps" size={24}/>,
  workspace: <Icon name="dashboard" size={24}/>,
  profile: <Icon name="user" size={24}/>,
};

const TABS = [
  { key: 'messages', label: '消息', icon: 'messages', enabled: true },
  { key: 'approvals', label: '审批', icon: 'approvals', enabled: true },
  { key: 'apps', label: '应用', icon: 'apps', enabled: true },
  { key: 'workspace', label: '工作台', icon: 'workspace', enabled: true },
  { key: 'profile', label: '我的', icon: 'profile', enabled: true },
];

// MobileHeader — top bar of the mobile shell.
//   Shows: optional back action + page title + optional right action.
function MobileHeader({ brand, pageTitle, pageSubtitle, backAction, rightAction, root }) {
  return (
    <header className={`mobile-header${root ? ' mobile-header--root' : ''}`} data-testid="mobile-header">
      <div className="mobile-header__brand">
        {backAction ? (
          <button
            type="button"
            className="mobile-header__back"
            data-testid="mobile-header-back"
            aria-label="返回应用"
            onClick={backAction}
          >
            <Icon name="back" size={22} />
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
    <div className="mobile-shell v16-mobile-enterprise" data-testid="mobile-shell">
      <MobileHeader
        brand={brand}
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle}
        backAction={backAction}
        rightAction={rightAction}
        root={activeTab === 'apps' && !backAction}
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
