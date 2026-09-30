import { useMemo } from 'react';
import { Icon } from './icons.jsx';
import {
  buildMobileApplicationGroups,
  buildMobileCommonItems,
} from '../navigation/applicationMetadata.js';

// V1.6 P1B application launcher.
//
// Replaces V1.5's "select a numbered domain to see its applications"
// interaction with a direct grid that lists every authorized core
// application under its flowchart-aligned business group.
//
// Public props:
//   - groups: optional pre-built groups (from buildMobileApplicationGroups)
//   - common: optional pre-built "常用" items
//   - icons:  icon name -> React element map
//   - onItemSelect: (item) => void
//   - emptyText: rendered when nothing is authorized
//
// The launcher itself owns no selection state. It is a presentational
// shell over the items passed in.

function ApplicationTile({ item, icons, onItemSelect }) {
  const icon = icons[item.iconKey] || <Icon name="apps" size={22}/>;
  const key = item.key || item.page;
  return (
    <button
      type="button"
      data-page={item.page}
      data-testid={`v16-launcher-tile-${key}`}
      className="v16-launcher-tile"
      aria-label={`打开${item.label}`}
      onClick={() => onItemSelect?.(item)}
    >
      <span className="v16-launcher-tile__icon" aria-hidden="true">{icon}</span>
      <span className="v16-launcher-tile__label">{item.label}</span>
    </button>
  );
}

function ApplicationGrid({ items, icons, onItemSelect }) {
  if (!items.length) return null;
  return (
    <div className="v16-launcher-grid" role="list">
      {items.map((item) => (
        <div role="listitem" key={item.key || item.page}>
          <ApplicationTile item={item} icons={icons} onItemSelect={onItemSelect} />
        </div>
      ))}
    </div>
  );
}

function UtilityDisclosure({ group, icons, onItemSelect }) {
  if (!group.items.length) return null;
  return (
    <details
      className="v16-utility__disclosure"
      data-testid={`v16-launcher-utility-${group.key}`}
    >
      <summary>
        <span>{group.label}</span>
        <span className="v16-utility__count">{group.items.length}</span>
      </summary>
      <div className="v16-utility__list">
        {group.items.map((item) => {
          const icon = icons[item.iconKey] || <Icon name="apps" size={16}/>;
          const key = item.key || item.page;
          return (
            <button
              type="button"
              key={key}
              data-page={item.page}
              data-testid={`v16-launcher-utility-item-${key}`}
              className="v16-utility__item"
              aria-label={`打开${item.label}`}
              onClick={() => onItemSelect?.(item)}
            >
              <span className="v16-utility__item-label">
                <span className="v16-utility__item-icon" aria-hidden="true">{icon}</span>
                <span>{item.label}</span>
              </span>
              <span aria-hidden="true">›</span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

export default function MobileLauncher({
  groups: providedGroups,
  common: providedCommon,
  visibleNav,
  icons = {},
  onItemSelect,
  emptyText = '暂无可用应用',
}) {
  // Allow tests / external callers to provide pre-built groups, or to
  // pass a raw visibleNav and let the launcher build groups itself.
  const groups = useMemo(() => {
    if (providedGroups) return providedGroups.filter((group) => group.items?.length);
    if (visibleNav) return buildMobileApplicationGroups(visibleNav).filter((group) => group.items?.length);
    return [];
  }, [providedGroups, visibleNav]);

  const common = useMemo(() => {
    if (providedCommon) return providedCommon;
    if (visibleNav) return buildMobileCommonItems(visibleNav);
    return [];
  }, [providedCommon, visibleNav]);

  const coreGroups = useMemo(() => groups.filter((group) => group.kind === 'domain'), [groups]);
  const utilityGroups = useMemo(() => groups.filter((group) => group.kind === 'utility'), [groups]);

  if (!coreGroups.length && !utilityGroups.length && !common.length) {
    return (
      <div className="v16-mobile-enterprise" data-testid="v16-launcher-empty">
        <div className="v16-empty">{emptyText}</div>
      </div>
    );
  }

  return (
    <div className="v16-mobile-enterprise v16-launcher mobile-launcher application-workspace" data-testid="v16-launcher" aria-label="应用">
      <div className="v16-page">
        {common.length > 0 && (
          <section className="v16-section v16-launcher-common" aria-label="常用">
            <div className="v16-section-title">常用</div>
            <ApplicationGrid items={common} icons={icons} onItemSelect={onItemSelect} />
          </section>
        )}

        {coreGroups.map((group) => (
          <section
            key={group.key}
            className="v16-section v16-launcher-group"
            aria-label={group.label}
            data-testid={`v16-launcher-group-${group.key}`}
          >
            <div className="v16-section-title">{group.label}</div>
            <ApplicationGrid items={group.items} icons={icons} onItemSelect={onItemSelect} />
          </section>
        ))}

        {utilityGroups.length > 0 && (
          <section className="v16-section v16-utility" aria-label="更多入口">
            {utilityGroups.map((group) => (
              <UtilityDisclosure
                key={group.key}
                group={group}
                icons={icons}
                onItemSelect={onItemSelect}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
