// Mobile Application Launcher.
//
// Responsibilities:
//   - visual application-grid primitive
//   - group heading primitive
//   - responsive 3-column mobile grid
//   - app card / icon primitive
//
// It receives groups/items as props so that M2 can wire real permission
// data and M3+ can extend without changing this primitive.
//
// M1 contract:
//   - No hardcoded roles (test_sales / test_warehouse / etc.)
//   - No permission logic
//   - No API calls
//   - No business knowledge
//
// Role visibility is resolved before this presentational component receives
// its groups. It never evaluates roles or permissions itself.

import { Icon } from './icons.jsx';

const OPTICALLY_COMPACT_ICONS = new Set([
  'customers', 'suppliers', 'products', 'warehouses', 'mrpRuns',
  'planningDocuments', 'inventory', 'accounting', 'cleanup', 'notifications',
]);

// Group shape:
//   { key, label, accent, items: [{ page, key, label, iconKey }] }
//
// Item shape:
//   { key, label, iconKey }
//   iconKey is one of the existing keys in src/App.jsx `ic` map.
//   (icons are passed in via the `icons` prop to keep this primitive
//    free of business knowledge).
export default function MobileLauncher({ groups = [], icons = {}, onItemSelect, emptyText = '暂无可用应用' }) {
  if (!groups.length) {
    return (
      <div className="mobile-launcher" data-testid="mobile-launcher">
        <div className="mobile-launcher__empty" data-testid="mobile-launcher-empty">
          {emptyText}
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-launcher" data-testid="mobile-launcher">
      {groups.map((group) => {
        if (!group || !Array.isArray(group.items) || group.items.length === 0) {
          return null;
        }
        return (
          <div
            key={group.key || group.label}
            className={`mobile-launcher__group mobile-launcher__group--${group.accent || 'slate'} mobile-launcher__group--${group.key || 'other'}`}
            data-testid={`mobile-launcher-group-${group.label}`}
          >
            <h2 className="mobile-launcher__group-label">{group.label}</h2>
            <div className="mobile-launcher__grid">
              {group.items.map((item) => {
                const icon = icons[item.iconKey];
                const itemKey = item.page || item.key;
                const reactKey = item.key || item.page;
                return (
                  <button
                    type="button"
                    key={reactKey}
                    data-page={itemKey}
                    data-testid={`mobile-launcher-item-${itemKey}`}
                    className="mobile-launcher__item"
                    onClick={() => onItemSelect && onItemSelect(item)}
                    aria-label={`打开${item.label}`}
                  >
                    <span
                      className={`mobile-launcher__item-icon${OPTICALLY_COMPACT_ICONS.has(item.iconKey) ? ' mobile-launcher__item-icon--compact' : ''}`}
                      aria-hidden="true"
                    >
                      {icon || <Icon name="apps" />}
                    </span>
                    <span className="mobile-launcher__item-label">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
