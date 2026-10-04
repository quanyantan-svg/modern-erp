import { useEffect, useRef } from 'react';
import { applicationRouteFor, RESPONSIVE_MODES } from '../navigation/applicationRegistry.js';

export const V16_FROZEN_ROUTES = Object.freeze(new Set([
  'dashboard',
  'orders',
  'purchase-receipts',
  'mrp-runs',
  'material-requirements-plan',
  'inventory',
  'inventory-scraps',
  'inventory-month-end',
  'inventory-transactions',
  'decision-reports',
]));

export function routeRolloutDescriptor(routeKey) {
  const route = applicationRouteFor(routeKey);
  const metadata = route?.presentation || null;
  return {
    metadata,
    applicationGroup: route?.applicationGroup || 'contextual',
    classification: route?.classification || 'CORE',
    state: V16_FROZEN_ROUTES.has(routeKey) ? 'frozen' : 'migrated',
    archetype: String(route?.archetype || 'WORKFLOW').toLowerCase(),
    module: ({
      'master-data': 'master', sales: 'sales', production: 'production', purchasing: 'purchasing',
      inventory: 'inventory', analytics: 'analytics', planning: 'production',
      'planning-production': 'production', 'planning-purchasing': 'purchasing',
    })[route?.domain] || 'master',
    responsiveMode: route?.responsiveMode || RESPONSIVE_MODES.LEGACY_ADAPTER,
  };
}

export default function V16RouteSurface({ route, children }) {
  const descriptor = routeRolloutDescriptor(route);
  const surfaceRef = useRef(null);
  useEffect(() => {
    if (descriptor.state !== 'migrated' || descriptor.responsiveMode !== RESPONSIVE_MODES.LEGACY_ADAPTER || !surfaceRef.current) return undefined;
    const surface = surfaceRef.current;
    const labelMobileTableCells = () => {
      for (const table of surface.querySelectorAll('.table-wrap table')) {
        const labels = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim());
        table.dataset.v16MobileTable = 'true';
        for (const row of table.querySelectorAll('tbody tr')) {
          [...row.children].forEach((cell, index) => {
            if (labels[index]) cell.dataset.v16Label = labels[index];
          });
        }
      }
    };
    labelMobileTableCells();
    const observer = new MutationObserver(labelMobileTableCells);
    observer.observe(surface, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [descriptor.state, route]);
  return (
    <div
      ref={surfaceRef}
      className="v16-route-surface"
      data-route={route}
      data-rollout-state={descriptor.state}
      data-route-classification={descriptor.classification}
      data-application-group={descriptor.applicationGroup}
      data-archetype={descriptor.archetype}
      data-module={descriptor.module}
      data-responsive-mode={descriptor.responsiveMode}
    >
      {children}
    </div>
  );
}
