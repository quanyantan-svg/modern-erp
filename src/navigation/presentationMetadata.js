// Compatibility projection. Canonical definitions live in applicationRegistry.js.
import {
  ACTIVE_APPLICATION_ROUTES, APPROVAL_FAMILIES, DESKTOP_GROUP_ORDER,
  DISABLED_APPLICATION_ROUTES, PRIMARY_DOMAINS, TECHNICAL_ROUTE_ALIASES,
} from './applicationRegistry.js';

const project = (item) => Object.freeze({
  ...item.presentation,
  ...(item.key === 'approvals' ? { approvalFamilies: APPROVAL_FAMILIES } : {}),
});

export { APPROVAL_FAMILIES, PRIMARY_DOMAINS, TECHNICAL_ROUTE_ALIASES };
export const ROUTE_PRESENTATIONS = Object.freeze(ACTIVE_APPLICATION_ROUTES.map(project));
export const DISABLED_ROUTE_PRESENTATIONS = Object.freeze(DISABLED_APPLICATION_ROUTES.map(project));
export const presentationForRoute = (routeKey) => ROUTE_PRESENTATIONS.find((item) => item.route === routeKey) || null;

export function buildNavigationGroups(icons = {}) {
  const all = [...ACTIVE_APPLICATION_ROUTES, ...DISABLED_APPLICATION_ROUTES];
  return DESKTOP_GROUP_ORDER.map((label) => ({
    label,
    items: all.filter((item) => item.desktopNavigation.group === label).map((item) => ({
      key: item.key, label: item.title, icon: icons[item.desktopNavigation.iconKey],
      ...item.access, ...(item.enabled ? {} : { enabled: false }), presentation: project(item),
    })),
  }));
}
