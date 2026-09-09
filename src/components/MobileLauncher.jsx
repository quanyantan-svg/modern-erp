// M1 Mobile Application Launcher Foundation.
//
// M1 responsibilities only:
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
// M2 will plug in real role-specific groups derived from existing
// navGroups and can()/allow() helpers in App.jsx.

// Local minimal icon primitive for launcher fallback. Real icons are
// passed in via the `icons` prop from App.jsx; this is only used if
// an item's iconKey is missing from the supplied icon map.
function FallbackIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
    </svg>
  );
}

// Group shape:
//   { label: string, items: [{ key, label, iconKey }] }
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
            key={group.label}
            className="mobile-launcher__group"
            data-testid={`mobile-launcher-group-${group.label}`}
          >
            <div className="mobile-launcher__group-label">{group.label}</div>
            <div className="mobile-launcher__grid">
              {group.items.map((item) => {
                const icon = icons[item.iconKey];
                return (
                  <button
                    type="button"
                    key={item.key}
                    data-testid={`mobile-launcher-item-${item.key}`}
                    className="mobile-launcher__item"
                    onClick={() => onItemSelect && onItemSelect(item)}
                  >
                    <span className="mobile-launcher__item-icon" aria-hidden="true">
                      {icon || <FallbackIcon />}
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
