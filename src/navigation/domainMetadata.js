export const BUSINESS_DOMAINS = Object.freeze([
  Object.freeze({ key: 'master-engineering', label: 'Master & Engineering', navigationLabel: '主数据与工程' }),
  Object.freeze({ key: 'sales-customer', label: 'Sales & Customer', navigationLabel: '销售与客户' }),
  Object.freeze({ key: 'planning', label: 'Planning', navigationLabel: '计划' }),
  Object.freeze({ key: 'procurement-outsourcing', label: 'Procurement & Outsourcing', navigationLabel: '采购与委外' }),
  Object.freeze({ key: 'manufacturing-quality', label: 'Manufacturing & Quality', navigationLabel: '制造与质量' }),
  Object.freeze({ key: 'inventory-warehouse', label: 'Inventory & Warehouse', navigationLabel: '库存与仓储' }),
  Object.freeze({ key: 'finance-operations', label: 'Finance Operations', navigationLabel: '财务运营' }),
  Object.freeze({ key: 'accounting-analytics', label: 'Accounting & Analytics', navigationLabel: '会计与分析' }),
]);

export const PLATFORM_DOMAIN = Object.freeze({ key: 'platform', label: 'Platform', navigationLabel: '系统设置' });
export const DOMAIN_DEFINITIONS = Object.freeze([...BUSINESS_DOMAINS, PLATFORM_DOMAIN]);
export const BUSINESS_DOMAIN_KEYS = Object.freeze(BUSINESS_DOMAINS.map((domain) => domain.key));
export const CANONICAL_DOMAIN_KEYS = Object.freeze(DOMAIN_DEFINITIONS.map((domain) => domain.key));
export const DOMAIN_BY_KEY = Object.freeze(Object.fromEntries(DOMAIN_DEFINITIONS.map((domain) => [domain.key, domain])));
export const DESKTOP_GROUP_ORDER = Object.freeze([
  ...BUSINESS_DOMAINS.map((domain) => domain.navigationLabel),
  PLATFORM_DOMAIN.navigationLabel,
]);
