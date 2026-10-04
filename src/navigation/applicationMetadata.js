// Compatibility projection. Canonical launcher entries live in applicationRegistry.js.
import { APPLICATION_LAUNCHER_GROUPS, MOBILE_COMMON_PRIORITY } from './applicationRegistry.js';
import { presentationForRoute } from './presentationMetadata.js';

export const MOBILE_APPLICATION_GROUPS = Object.freeze(APPLICATION_LAUNCHER_GROUPS.map((group) => Object.freeze({
  ...group,
  items: Object.freeze(group.items.map((item) => Object.freeze({ ...item, page: item.routeKey, mobileLabel: item.label }))),
})));
export const DEFERRED_MOBILE_APPLICATIONS = Object.freeze([]);
export { MOBILE_COMMON_PRIORITY };

export function buildMobileApplicationGroups(visibleNav = [], options = {}) {
  const authorizedByPage = new Map(visibleNav.map((item) => [item.key, item]));
  const isItemVisible = options.isItemVisible || (() => true);
  return MOBILE_APPLICATION_GROUPS.map((group) => ({
    key: group.key, label: group.label, kind: group.kind, module: group.module || null,
    items: group.items.flatMap((metadata) => {
      const navigationItem = authorizedByPage.get(metadata.page);
      if (!navigationItem || !isItemVisible(metadata)) return [];
      return [{
        ...navigationItem, presentation: presentationForRoute(metadata.page), page: navigationItem.key,
        label: metadata.label || navigationItem.label, iconKey: metadata.iconKey, key: metadata.key, group: metadata.group,
        reportKey: metadata.reportKey, formalLabel: metadata.formalLabel, target: metadata.target,
      }];
    }),
  })).filter((group) => group.items.length > 0);
}

export function buildMobileCommonItems(visibleNav = [], options = {}) {
  const authorizedByPage = new Map(visibleNav.map((item) => [item.key, item]));
  const isItemVisible = options.isItemVisible || (() => true);
  const items = [];
  for (const page of MOBILE_COMMON_PRIORITY) {
    if (items.length >= 3) break;
    const navigationItem = authorizedByPage.get(page);
    if (!navigationItem || !isItemVisible({ page, reportKey: null, target: null })) continue;
    items.push({ ...navigationItem, page, label: navigationItem.label, iconKey: navigationItem.iconKey, key: page, reportKey: null, target: null });
  }
  return items;
}
