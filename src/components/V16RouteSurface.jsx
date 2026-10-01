import { useEffect, useRef } from 'react';
import { MOBILE_APPLICATION_GROUPS } from '../navigation/applicationMetadata.js';
import { presentationForRoute } from '../navigation/presentationMetadata.js';

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

const INTERNAL_ROUTES = new Set(['material-requirements-plan', 'manufacturing-analytics']);
const CONTEXTUAL_ROUTES = new Set([
  'dashboard', 'sales-discounts', 'purchase-discounts', 'sales-invoices', 'payment-collections',
  'supplier-bills', 'payment-disbursements', 'bank-accounts', 'product-costs', 'cost-rates',
  'iqc', 'oqc', 'quality-control-points', 'tasks', 'timesheets', 'notifications',
]);

function applicationGroupFor(routeKey) {
  return MOBILE_APPLICATION_GROUPS.find((group) => group.items.some((item) => item.page === routeKey))?.key || 'contextual';
}

function classificationFor(metadata, applicationGroup) {
  if (INTERNAL_ROUTES.has(metadata?.route)) return 'INTERNAL';
  if (CONTEXTUAL_ROUTES.has(metadata?.route)) return 'CONTEXTUAL';
  return 'CORE';
}

export function routeRolloutDescriptor(routeKey) {
  const metadata = presentationForRoute(routeKey);
  const applicationGroup = applicationGroupFor(routeKey);
  return {
    metadata,
    applicationGroup,
    classification: classificationFor(metadata, applicationGroup),
    state: V16_FROZEN_ROUTES.has(routeKey) ? 'frozen' : 'migrated',
    archetype: String(metadata?.template || 'WORKFLOW').toLowerCase(),
    module: ({
      'master-data': 'master', sales: 'sales', production: 'production', purchasing: 'purchasing',
      inventory: 'inventory', analytics: 'analytics', planning: 'production',
      'planning-production': 'production', 'planning-purchasing': 'purchasing',
    })[metadata?.domain] || 'master',
  };
}

export default function V16RouteSurface({ route, children }) {
  const descriptor = routeRolloutDescriptor(route);
  const surfaceRef = useRef(null);
  useEffect(() => {
    if (descriptor.state !== 'migrated' || !surfaceRef.current) return undefined;
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
    >
      {children}
    </div>
  );
}
