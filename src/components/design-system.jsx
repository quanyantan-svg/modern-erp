import { Icon } from './icons.jsx';
import { statusLabel } from '../lib/status.js';
import { presentStatus } from '../lib/presentation.js';

export function PageHeader({ title, subtitle, action, large = false }) { return <header className={`page-header${large ? ' page-header--large' : ''}`}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && <div className="page-header__action">{action}</div>}</header>; }
export function SectionHeader({ title, subtitle, action }) { return <header className="section-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>; }

// V1.4-E1: canonical page header. Page bodies pass `context` (e.g. business
// scope or date basis) and `status` so the header itself, not the body, owns
// that surface. The single `primaryAction` is the page's main call-to-
// action; `secondaryActions` are subordinate and visually demoted.
export function BusinessPageHeader({
  title,
  breadcrumb,
  context,
  status,
  statusContext,
  primaryAction,
  secondaryActions,
  meta,
  back,
  help,
  overflowActions,
  statusSlot,
  collapseSecondaryOnMobile = false,
}) {
  const statusNode = (() => {
    if (!status) return null;
    const presentation = presentStatus(status, statusContext);
    return (
      <span
        className={`status-chip status-chip--${presentation.tone}`}
        data-group={presentation.group}
        title={presentation.groupLabel}
      >
        {presentation.label}
      </span>
    );
  })();
  const secondary = Array.isArray(secondaryActions) ? secondaryActions : secondaryActions ? [secondaryActions] : [];
  return (
    <header className="page-header page-header--business">
      <div className="page-header__leading">
        {back && <span className="page-header__back">{back}</span>}
        <div>
          {breadcrumb && <div className="page-header__breadcrumb" aria-label="面包屑">{breadcrumb}</div>}
          <span className="page-header__route-context">{title}</span>
          {context && <p className="page-header__context">{context}</p>}
        </div>
      </div>
      <div className="page-header__trailing">
        {meta && <div className="page-header__meta">{meta}</div>}
        {statusSlot || statusNode}
        {secondary.length > 0 && (
          <div className={`page-header__secondary${collapseSecondaryOnMobile ? ' page-header__secondary--collapsible' : ''}`}>{secondary}</div>
        )}
        {overflowActions && <div className="page-header__overflow">{overflowActions}</div>}
        {help && <span className="page-header__help">{help}</span>}
        {primaryAction && (
          <div className="page-header__action page-header__action--primary">
            {primaryAction}
          </div>
        )}
      </div>
    </header>
  );
}

export function BusinessPageShell({ children, className = '', width = 'wide' }) {
  return <main className={`business-page-shell business-page-shell--${width} ${className}`.trim()}>{children}</main>;
}

export function BusinessStatusGroup({ items = [], label = '业务状态' }) {
  return <div className="business-status-group" aria-label={label}>{items.map((item) => {
    const presentation = presentStatus(item.status, item.context);
    return <span className="business-status-group__item" key={item.key || item.label}><small>{item.label}</small><span className={`status-chip status-chip--${presentation.tone}`}>{presentation.label}</span></span>;
  })}</div>;
}

export function BusinessDetailLayout({ children, rail, className = '' }) {
  return <div className={`business-detail-layout ${className}`.trim()}><div className="business-detail-layout__main">{children}</div>{rail && <aside className="business-detail-layout__rail">{rail}</aside>}</div>;
}

export function BusinessContentSection({ title, description, action, tone = 'default', children, className = '' }) {
  return <section className={`business-content-section business-content-section--${tone} ${className}`.trim()}><header><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header><div className="business-content-section__body">{children}</div></section>;
}

export function BusinessSummarySection(props) { return <BusinessContentSection {...props} tone="summary" />; }
export function BusinessRelationSection(props) { return <BusinessContentSection {...props} tone="relation" />; }
export function BusinessAuditSection(props) { return <BusinessContentSection {...props} tone="audit" />; }
export function BusinessDangerZone(props) { return <BusinessContentSection {...props} tone="danger" />; }
export function HelpDisclosure({ summary = '查看说明', children }) { return <details className="help-disclosure"><summary>{summary}</summary><div>{children}</div></details>; }

export function BusinessAction({ hierarchy = 'secondary', disabledReason, children, className = '', ...props }) {
  const classes = { primary: 'primary', secondary: 'secondary', tertiary: 'ghost', danger: 'danger-button' };
  return <span className="business-action"><button className={`${classes[hierarchy] || classes.secondary} ${className}`.trim()} title={disabledReason || props.title} {...props}>{children}</button>{disabledReason && <small>{disabledReason}</small>}</span>;
}

// V1.4-E1: action hierarchy wrapper. The single primary slot enforces
// "usually one obvious primary action" from solution.md §21.9.1. Destructive
// actions are routed to a separate slot so they cannot be visually confused
// with the page's main submission.
export function BusinessActionBar({
  primary,
  secondary,
  destructive,
  navigation,
  layout = 'inline',
}) {
  return (
    <div className={`business-action-bar business-action-bar--${layout}`}>
      {navigation && <div className="business-action-bar__nav">{navigation}</div>}
      {secondary && (
        <div className="business-action-bar__secondary">
          {Array.isArray(secondary) ? secondary : [secondary]}
        </div>
      )}
      {primary && <div className="business-action-bar__primary">{primary}</div>}
      {destructive && (
        <div className="business-action-bar__destructive">
          {Array.isArray(destructive) ? destructive : [destructive]}
        </div>
      )}
    </div>
  );
}
export function GroupedList({ title, children, className = '' }) { return <section className={`grouped-section ${className}`}>{title && <h2>{title}</h2>}<div className="grouped-list">{children}</div></section>; }
export function ListRow({ title, subtitle, meta, status, onClick, children }) { const Tag = onClick ? 'button' : 'div'; return <Tag type={onClick ? 'button' : undefined} className="list-row" onClick={onClick}><div className="list-row__content"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}{children}</div><div className="list-row__aside">{status}{meta && <small>{meta}</small>}{onClick && <Icon name="chevron" size={18}/>}</div></Tag>; }
export function FormSection({ title, description, children }) { return <fieldset className="form-section"><legend>{title}</legend>{description && <p>{description}</p>}<div className="form-section__body">{children}</div></fieldset>; }
export function FormRow({ label, hint, error, required, children }) { return <label className={`form-row${error ? ' form-row--error' : ''}`}><span className="field-label">{label}{required && <i aria-hidden="true">*</i>}</span>{children}{error ? <small role="alert">{error}</small> : hint && <small>{hint}</small>}</label>; }
export function TextField(props) { return <input {...props}/>; }
export function TextArea(props) { return <textarea {...props}/>; }
export function SelectField({ children, ...props }) { return <select {...props}>{children}</select>; }
export function DateField(props) { return <input type="date" {...props}/>; }
export function MoneyField(props) { return <input type="number" inputMode="decimal" step="0.01" {...props}/>; }
export function QuantityField(props) { return <input type="number" inputMode="decimal" {...props}/>; }
export function PrimaryButton({ className = '', ...props }) { return <button className={`primary ${className}`} {...props}/>; }
export function SecondaryButton({ className = '', ...props }) { return <button className={`secondary ${className}`} {...props}/>; }
export function TertiaryButton({ className = '', ...props }) { return <button className={`ghost ${className}`} {...props}/>; }
export function DestructiveButton({ className = '', ...props }) { return <button className={`danger-button ${className}`} {...props}/>; }
export function IconButton({ label, icon, className = '', ...props }) { return <button type="button" className={`icon-button ${className}`} aria-label={label} {...props}>{icon}</button>; }
export function SegmentedControl({ options, value, onChange, label = '视图选项' }) { return <div className="segmented-control" role="group" aria-label={label}>{options.map((option) => <button type="button" key={option.value} className={value === option.value ? 'is-selected' : ''} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>; }
export function BottomActionBar({ children }) { return <div className="bottom-action-bar">{children}</div>; }
export function SummaryCard({ label, value, detail }) { return <article className="summary-card"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>; }

export function SearchField({ value, onChange, onSubmit, placeholder = '搜索', label = placeholder }) { return <form className="search-field" role="search" onSubmit={(event) => { event.preventDefault(); onSubmit?.(); }}><Icon name="search" size={18}/><input aria-label={label} value={value} onChange={(event) => onChange?.(event.target.value)} placeholder={placeholder}/>{value && <button type="button" aria-label="清除搜索" onClick={() => onChange?.('')}><Icon name="close" size={16}/></button>}</form>; }
export function FilterButton({ activeCount = 0, children = '筛选', ...props }) { return <button type="button" className={`filter-button${activeCount ? ' is-active' : ''}`} {...props}><Icon name="filter" size={17}/><span>{children}</span>{activeCount > 0 && <b>{activeCount}</b>}</button>; }
export function Sheet({ title, onClose, children, className = '' }) { return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}><section className={`sheet ${className}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" aria-label="关闭" onClick={onClose}><Icon name="close" size={20}/></button></header><div className="sheet__body">{children}</div></section></div>; }
export function FilterSheet({ title = '筛选', onClose, onReset, onApply, children }) { return <Sheet title={title} onClose={onClose} className="filter-sheet"><div className="filter-sheet__fields">{children}</div><BottomActionBar><SecondaryButton type="button" onClick={onReset}>重置</SecondaryButton><PrimaryButton type="button" onClick={onApply}>应用筛选</PrimaryButton></BottomActionBar></Sheet>; }
export function StatusChip({ status, domain, children }) { return <span className={`status-chip status-chip--${String(status || 'unknown').toLowerCase()}`}>{children || statusLabel(status, domain)}</span>; }
export function RecordList({ children, className = '', ...props }) { return <div {...props} className={`record-list ${className}`}>{children}</div>; }
export function RecordCard({ title, subtitle, status, facts = [], actions, onClick, children, className = '', ...props }) { const Tag = onClick ? 'button' : 'article'; return <Tag {...props} type={onClick ? 'button' : undefined} className={`record-card ${className}`} onClick={onClick}><header><div><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div>{status}</header>{facts.length > 0 && <dl>{facts.slice(0, 6).map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}{children}{actions && <footer onClick={(event) => event.stopPropagation()}>{actions}</footer>}</Tag>; }
export function CompactRecordList({ children, className = '', ...props }) { return <div {...props} className={`compact-record-list ${className}`.trim()}>{children}</div>; }
export function CompactRecord({ title, subtitle, status, metadata = [], metrics = [], action, onOpen, children, className = '', ...props }) { return <article {...props} className={`compact-record ${className}`.trim()}><header className="compact-record__header"><div className="compact-record__identity">{onOpen ? <button type="button" className="compact-record__open" onClick={onOpen}>{title}</button> : <strong>{title}</strong>}{subtitle && <span>{subtitle}</span>}</div>{status && <div className="compact-record__status">{status}</div>}</header>{metadata.length > 0 && <dl className="compact-record__metadata">{metadata.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value ?? '—'}</dd></div>)}</dl>}{metrics.length > 0 && <dl className="compact-record__metrics">{metrics.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value ?? '—'}</dd></div>)}</dl>}{children}{action && <footer className="compact-record__action">{action}</footer>}</article>; }
export function DetailSection({ title, action, children }) { return <section className="detail-section"><header><h2>{title}</h2>{action}</header><div className="detail-section__body">{children}</div></section>; }
export function KeyValueRow({ label, value, children }) { return <div className="key-value-row"><span>{label}</span><strong>{children ?? value ?? '—'}</strong></div>; }
export function ActionMenu({ label = '更多操作', children }) { return <details className="canonical-action-menu"><summary aria-label={label}><Icon name="more" size={20}/></summary><div>{children}</div></details>; }
export function ActionSheet({ title = '操作', onClose, children }) { return <Sheet title={title} onClose={onClose} className="action-sheet"><div className="action-sheet__actions">{children}</div></Sheet>; }
export function ConfirmSheet({ title = '确认操作', message, confirmLabel = '确认', onClose, onConfirm, children }) { return <Sheet title={title} onClose={onClose} className="confirm-sheet"><div className="confirm-sheet__message">{children || <p>{message}</p>}</div><BottomActionBar><SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton><PrimaryButton type="button" onClick={onConfirm}>{confirmLabel}</PrimaryButton></BottomActionBar></Sheet>; }
export function DangerSheet({ title = '请确认', message, confirmLabel = '确认', onClose, onConfirm, children }) { return <Sheet title={title} onClose={onClose} className="danger-sheet"><InlineAlert tone="danger">{children || message}</InlineAlert><BottomActionBar><SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton><DestructiveButton type="button" onClick={onConfirm}>{confirmLabel}</DestructiveButton></BottomActionBar></Sheet>; }
export function InlineAlert({ tone = 'info', title, children }) { return <div className={`inline-alert inline-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>{title && <strong>{title}</strong>}<div>{children}</div></div>; }
export function EmptyState({ title = '暂无数据', description, action }) { return <div className="canonical-empty-state"><Icon name="inbox" size={28}/><strong>{title}</strong>{description && <p>{description}</p>}{action}</div>; }
export function Skeleton({ lines = 3 }) { return <div className="skeleton" role="status" aria-label="加载中">{Array.from({ length: lines }, (_, index) => <span key={index}/>)}</div>; }

// V1.4-E1 canonical state component. Distinguishes the seven reasons a list
// surface might be blank without forcing every page to invent its own copy.
// `kind` selects the pre-built template; `title` and `description` may
// override the copy per page. `action` is the optional recovery link.
const STATE_PRESETS = Object.freeze({
  LOADING: {
    icon: 'inbox',
    title: '正在载入',
    description: '请稍候，正在加载业务数据。',
    tone: 'info',
  },
  EMPTY: {
    icon: 'inbox',
    title: '尚无业务数据',
    description: '当前列表中没有任何记录。',
    tone: 'muted',
  },
  NO_RESULTS: {
    icon: 'search',
    title: '当前条件无匹配',
    description: '没有符合筛选条件的记录，可尝试调整或清除筛选。',
    tone: 'muted',
  },
  FILTER_EMPTY: {
    icon: 'search',
    title: '当前条件无匹配',
    description: '没有符合筛选条件的记录，可尝试调整或清除筛选。',
    tone: 'muted',
  },
  PREREQUISITE_REQUIRED: {
    icon: 'info',
    title: '需要先完成前置条件',
    description: '当前操作依赖尚未建立的数据或业务流程。',
    tone: 'warning',
  },
  PERMISSION_DENIED: {
    icon: 'info',
    title: '没有查看此内容的权限',
    description: '当前账号缺少访问此页面的业务权限，请联系管理员。',
    tone: 'warning',
  },
  PERMISSION_LIMITED: {
    icon: 'info',
    title: '可查看的内容受限',
    description: '当前账号只能查看已授权的业务范围。',
    tone: 'warning',
  },
  BUSINESS_BLOCKED: {
    icon: 'error',
    title: '业务规则不允许此操作',
    description: '当前状态或数据不满足业务校验。',
    tone: 'danger',
  },
  ERROR: {
    icon: 'error',
    title: '加载失败',
    description: '暂时无法完成，请稍后重试。',
    tone: 'danger',
  },
});

export function BusinessState({ kind = 'EMPTY', title, description, action, retry, retryLabel = '重试', requestId, details }) {
  const preset = STATE_PRESETS[kind] || STATE_PRESETS.EMPTY;
  const finalTitle = title || preset.title;
  const finalDescription = description || preset.description;
  const iconName = preset.icon;
  return (
    <div className={`business-state business-state--${preset.tone}`} role={preset.tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={iconName} size={28} />
      <strong>{finalTitle}</strong>
      <p>{finalDescription}</p>
      {action && <div className="business-state__action">{action}</div>}
      {retry && <div className="business-state__action"><SecondaryButton type="button" onClick={retry}>{retryLabel}</SecondaryButton></div>}
      {kind === 'ERROR' && requestId && (
        <small className="business-state__request">请求编号：{requestId}</small>
      )}
      {kind === 'ERROR' && details && (
        <details className="business-state__details">
          <summary>查看技术详情</summary>
          <pre>{typeof details === 'string' ? details : JSON.stringify(details, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

// V1.4-E1 responsive list primitive. The same data, status and actions feed
// both the desktop row layout and a stacked mobile card. Pages compose
// `renderDesktopRow` and `renderMobileCard` instead of duplicating shapes.
export function ResponsiveBusinessList({
  items,
  isLoading,
  state,
  renderDesktopRow,
  renderMobileCard,
  renderEmpty,
  keyOf,
  className = '',
}) {
  if (isLoading) {
    return state && <BusinessState kind="LOADING" />;
  }
  if (!Array.isArray(items) || items.length === 0) {
    if (state) return state;
    if (renderEmpty) return renderEmpty();
    return <BusinessState kind="EMPTY" />;
  }
  return (
    <div className={`responsive-business-list ${className}`}>
      <div className="responsive-business-list__desktop" role="table">
        {items.map((item, index) => (
          <div key={keyOf ? keyOf(item, index) : index} role="row">
            {renderDesktopRow(item, index)}
          </div>
        ))}
      </div>
      <div className="responsive-business-list__mobile">
        {items.map((item, index) => (
          <div key={keyOf ? `m-${keyOf(item, index)}` : `m-${index}`}>
            {renderMobileCard(item, index)}
          </div>
        ))}
      </div>
    </div>
  );
}

export { presentStatus, STATUS_GROUPS, ACTION_VERBS } from '../lib/presentation.js';
export function RelationshipCard({ label, documentNo, status, onClick }) { return <button type="button" className="relationship-card" onClick={onClick}><div><span>{label}</span><strong>{documentNo}</strong></div>{status}{onClick && <Icon name="chevron" size={18}/>}</button>; }
export function LifecycleBadge({ archived, classification }) { const text = archived ? '已归档' : ({ SAFE_DELETE: '可直接删除', SAFE_CHAIN_DELETE: '可整链删除', SAFE_REVERSAL_CLEANUP: '可回滚后清理', ARCHIVE_ONLY: '只能归档', BLOCKED: '当前无法删除' }[classification] || '生命周期待分析'); return <span className={`lifecycle-badge lifecycle-badge--${archived ? 'archived' : String(classification || 'unknown').toLowerCase()}`}>{text}</span>; }
export function DependencyGraphSheet({ graph, onClose, actions }) { return <Sheet title="业务链分析" onClose={onClose} className="dependency-graph-sheet"><div className="dependency-graph-list">{graph?.nodes?.map((node) => <article key={node.key} className={node.selectedForCleanup ? 'is-selected' : 'is-dependent'}><header><strong>{node.documentNo}</strong><StatusChip status={node.status}/></header><span>{node.label}</span><small>{node.effective ? '已有业务影响' : '无库存或财务影响'}{node.period ? ` · ${node.period}` : ''}</small></article>)}</div>{graph?.blockers?.map((blocker) => <InlineAlert key={blocker.code} tone="danger">{blocker.message}</InlineAlert>)}{actions && <BottomActionBar>{actions}</BottomActionBar>}</Sheet>; }
