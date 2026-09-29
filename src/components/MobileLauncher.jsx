import { useMemo, useState } from 'react';
import { Icon } from './icons.jsx';

const OPTICALLY_COMPACT_ICONS = new Set([
  'customers', 'suppliers', 'products', 'warehouses', 'mrpRuns',
  'planningDocuments', 'inventory', 'accounting', 'cleanup', 'notifications',
]);

function ApplicationItem({ item, icons, onItemSelect, compact = false }) {
  const icon = icons[item.iconKey] || <Icon name="apps" />;
  const itemKey = item.page || item.key;
  return <button type="button" data-page={itemKey} data-testid={`mobile-launcher-item-${itemKey}`}
    className={`application-item${compact ? ' application-item--compact' : ''}`}
    onClick={() => onItemSelect?.(item)} aria-label={`打开${item.label}`}>
    <span className={`application-item__icon${OPTICALLY_COMPACT_ICONS.has(item.iconKey) ? ' application-item__icon--compact' : ''}`} aria-hidden="true">{icon}</span>
    <span className="application-item__copy"><strong>{item.label}</strong>{item.presentation?.description && !compact && <small>{item.presentation.description}</small>}</span>
    {compact && <Icon name="chevronRight" size={16}/>}
  </button>;
}

function UtilityGroups({ groups, icons, onItemSelect }) {
  if (!groups.length) return null;
  return <div className="application-utilities" aria-label="更多应用">
    {groups.map((group) => <details key={group.key} className="application-utilities__group">
      <summary>{group.label}<span>{group.items.length}</span></summary>
      <div>{group.items.map((item) => <ApplicationItem key={item.key || `${item.page}:${item.reportKey || ''}`} item={item} icons={icons} onItemSelect={onItemSelect} compact/>)}</div>
    </details>)}
  </div>;
}

export default function MobileLauncher({ groups = [], icons = {}, onItemSelect, emptyText = '暂无可用应用' }) {
  const domains = useMemo(() => groups.filter((group) => group.kind === 'domain' && group.items?.length), [groups]);
  const utilities = useMemo(() => groups.filter((group) => group.kind === 'utility' && group.items?.length), [groups]);
  const [selectedKey, setSelectedKey] = useState(domains[0]?.key || '');
  const selected = domains.find((group) => group.key === selectedKey) || domains[0];

  if (!domains.length && !utilities.length) {
    return <div className="mobile-launcher" data-testid="mobile-launcher"><div className="mobile-launcher__empty" data-testid="mobile-launcher-empty">{emptyText}</div></div>;
  }

  const shortcuts = utilities.find((group) => group.key === 'workspace');
  const remainingUtilities = utilities.filter((group) => group.key !== 'workspace');
  const shortcutItems = shortcuts?.items.filter((item) => item.tier === 'shortcut') || [];
  const workspaceUtilities = shortcuts?.items.filter((item) => item.tier !== 'shortcut') || [];
  const disclosedUtilities = workspaceUtilities.length
    ? [{ key: 'finance-tools', label: '财务工具', kind: 'utility', items: workspaceUtilities }, ...remainingUtilities]
    : remainingUtilities;
  const primary = selected?.items.filter((item) => item.tier === 'primary') || [];
  const more = selected?.items.filter((item) => item.tier !== 'primary') || [];

  return <section className="mobile-launcher application-workspace" data-testid="mobile-launcher" aria-label="应用">
    <header className="application-workspace__header"><div><span>APPLICATIONS</span><h1>应用</h1></div><small>按业务流程进入工作</small></header>
    <nav className="application-domain-nav" aria-label="业务领域">
      <p>业务领域</p>
      <div>{domains.map((group, index) => <button type="button" key={group.key} data-testid={`mobile-launcher-group-${group.label}`} className={selected?.key === group.key ? 'is-selected' : ''} aria-current={selected?.key === group.key ? 'page' : undefined} onClick={() => setSelectedKey(group.key)}><span className="application-domain-nav__index">{String(index + 1).padStart(2, '0')}</span><span className="application-domain-nav__label">{group.label}</span><span className="application-domain-nav__indicator" aria-hidden="true">→</span></button>)}</div>
    </nav>
    <section className="application-domain-content" aria-live="polite">
      <header><div><span>当前领域</span><h2>{selected?.label}</h2></div><small>{primary.length} 个主要入口</small></header>
      <div className="application-domain-content__primary">{primary.map((item) => <ApplicationItem key={item.key || `${item.page}:${item.reportKey || ''}`} item={item} icons={icons} onItemSelect={onItemSelect}/>)}</div>
      {more.length > 0 && <details className="application-domain-content__more"><summary>更多{selected?.label}能力 <span>{more.length}</span></summary><div>{more.map((item) => <ApplicationItem key={item.key || `${item.page}:${item.reportKey || ''}`} item={item} icons={icons} onItemSelect={onItemSelect} compact/>)}</div></details>}
    </section>
    <aside className="application-shortcuts">
      <header><div><span>ROLE WORKSPACE</span><h2>我的工作区</h2></div><small>常用入口与设置</small></header>
      <div className="application-shortcuts__primary">{shortcutItems.map((item) => <ApplicationItem key={item.key || item.page} item={item} icons={icons} onItemSelect={onItemSelect} compact/>)}</div>
      <UtilityGroups groups={disclosedUtilities} icons={icons} onItemSelect={onItemSelect}/>
    </aside>
  </section>;
}
