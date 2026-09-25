// M1 Mobile Page — reusable container for future M2+ work.
//
// Provides standard mobile page structure:
//   - title (and optional subtitle)
//   - optional action area in the header
//   - scrollable body with state variants (default / loading / empty / error)
//   - optional sticky bottom action bar that does not overlap bottom nav
//   - safe-area padding baked in via parent .mobile-shell
//
// M1 is infrastructure only. This component does NOT perform API calls
// and does NOT own any business state.

export default function MobilePage({
  title,
  subtitle,
  actions,
  bodyState = 'default', // 'default' | 'loading' | 'empty' | 'error'
  emptyText = '暂无数据',
  loadingText = '加载中…',
  errorText = '加载失败',
  bottomActions,
  children,
}) {
  const bodyClassName = [
    'mobile-page__body',
    bodyState === 'loading' ? 'mobile-page__body--loading' : '',
    bodyState === 'empty' ? 'mobile-page__body--empty' : '',
    bodyState === 'error' ? 'mobile-page__body--error' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className="mobile-page" data-testid="mobile-page">
      {(title || actions) && (
        <header className="mobile-page__header">
          <div className="mobile-page__heading">
            {title ? <div className="mobile-page__title">{title}</div> : null}
            {subtitle ? <div className="mobile-page__subtitle">{subtitle}</div> : null}
          </div>
          {actions ? <div className="mobile-page__actions">{actions}</div> : null}
        </header>
      )}

      {bodyState === 'loading' ? (
        <div className={bodyClassName} data-testid="mobile-page-loading">
          {loadingText}
        </div>
      ) : bodyState === 'empty' ? (
        <div className={bodyClassName} data-testid="mobile-page-empty">
          {emptyText}
        </div>
      ) : bodyState === 'error' ? (
        <div className={bodyClassName} data-testid="mobile-page-error">
          {errorText}
        </div>
      ) : (
        <div className={bodyClassName} data-testid="mobile-page-body">
          {children}
        </div>
      )}

      {bottomActions ? (
        <div className="mobile-page__action-bar" data-testid="mobile-page-action-bar">
          {bottomActions}
        </div>
      ) : null}
    </section>
  );
}
