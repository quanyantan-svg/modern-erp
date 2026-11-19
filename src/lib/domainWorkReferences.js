import { api } from '../api.js';

function descriptor(endpoint, kind, scope = {}) {
  const scopeKey = Object.entries(scope).map(([key, value]) => `${key}=${value || ''}`).join('&');
  return {
    key: `${endpoint}:${kind}:${scopeKey}`,
    enabled: scope.enabled !== false,
    async search({ q = '', limit = 20, offset = 0, selectedId = '', signal } = {}) {
      const query = new URLSearchParams({ kind, limit: String(limit), offset: String(offset) });
      if (q) query.set('q', q);
      if (selectedId) query.set('selectedId', selectedId);
      Object.entries(scope).forEach(([key, value]) => { if (key !== 'enabled' && value) query.set(key, String(value)); });
      const result = await api(`${endpoint}?${query.toString()}`, { signal });
      return { items: result.items || [], total: Number(result.total || 0) };
    },
  };
}

export const planningWorkReferences = {
  demand: (type) => descriptor('/api/planning/work-references', `DEMAND_${type}`),
  supply: (type) => descriptor('/api/planning/work-references', `SUPPLY_${type}`),
};

export const salesWorkReferences = {
  order: () => descriptor('/api/sales/work-references', 'SALES_ORDER'),
  orderItem: (salesOrderId) => descriptor('/api/sales/work-references', 'SALES_ORDER_ITEM', { salesOrderId, enabled: Boolean(salesOrderId) }),
  product: () => descriptor('/api/sales/work-references', 'PRODUCT'),
  warehouse: () => descriptor('/api/sales/work-references', 'WAREHOUSE'),
  supply: (type) => descriptor('/api/sales/work-references', type),
};

export const inventoryWorkReferences = {
  owner: (ownerType) => descriptor('/api/inventory/work-references', ownerType),
  lot: ({ productId = '', warehouseId = '' } = {}) => descriptor('/api/inventory/work-references', 'LOT', { productId, warehouseId }),
  serial: ({ productId = '', warehouseId = '' } = {}) => descriptor('/api/inventory/work-references', 'SERIAL', { productId, warehouseId }),
  entity: (kind, { warehouseId = '' } = {}) => descriptor('/api/inventory/work-references', kind, { warehouseId }),
  valuationSnapshot: () => descriptor('/api/inventory/work-references', 'VALUATION_SNAPSHOT'),
};

export const workflowWorkReferences = {
  participant: () => descriptor('/api/platform/workflow-participants', 'USER'),
};

export const platformWorkReferences = {
  organization: () => descriptor('/api/platform/work-references', 'ORGANIZATION'),
};

export function managementBookReference() {
  return {
    key: 'accounting:management-book',
    async search({ q = '', limit = 20, offset = 0, selectedId = '', signal } = {}) {
      const result = await api('/api/management/books', { signal });
      const term = q.trim().toLocaleLowerCase('zh-CN');
      const rows = (result.managementBooks || []).map((row) => ({
        id: row.id, code: row.code, name: row.name, secondaryText: row.legal_entity,
        active: row.status !== 'CLOSED',
      }));
      const filtered = rows.filter((row) => !term || `${row.code} ${row.name} ${row.secondaryText}`.toLocaleLowerCase('zh-CN').includes(term));
      const page = filtered.slice(offset, offset + limit);
      const selected = selectedId ? rows.find((row) => row.id === selectedId) : null;
      if (selected && !page.some((row) => row.id === selected.id)) page.unshift(selected);
      return { items: page, total: filtered.length };
    },
  };
}

export function accountingSubjectReference(excludeId = '') {
  return {
    key: `accounting:subject:${excludeId}`,
    async search({ q = '', limit = 20, offset = 0, selectedId = '', signal } = {}) {
      const result = await api('/api/accounting/subjects', { signal });
      const term = q.trim().toLocaleLowerCase('zh-CN');
      const rows = (result.subjects || []).filter((row) => row.id !== excludeId).map((row) => ({
        id: row.id, code: row.code, name: row.name, secondaryText: row.type, active: row.active !== 0 && row.active !== false,
      }));
      const filtered = rows.filter((row) => !term || `${row.code} ${row.name}`.toLocaleLowerCase('zh-CN').includes(term));
      const page = filtered.slice(offset, offset + limit);
      const selected = selectedId ? rows.find((row) => row.id === selectedId) : null;
      if (selected && !page.some((row) => row.id === selected.id)) page.unshift(selected);
      return { items: page, total: filtered.length };
    },
  };
}

const ENGINEERING_SOURCES = {
  SHIFT: ['/api/engineering/shifts', 'shifts'],
  SHIFT_PATTERN: ['/api/engineering/shift-patterns', 'patterns'],
  CALENDAR_TEMPLATE: ['/api/engineering/calendar-templates', 'templates'],
  WORK_CENTER: ['/api/work-centers/enhanced', 'workCenters'],
  ACTIVITY: ['/api/engineering/basic-activities', 'activities'],
};

export function engineeringWorkReference(kind) {
  const [endpoint, responseKey] = ENGINEERING_SOURCES[kind];
  return {
    key: `engineering:${kind}`,
    async search({ q = '', limit = 20, offset = 0, selectedId = '', signal } = {}) {
      const result = await api(endpoint, { signal });
      const term = q.trim().toLocaleLowerCase('zh-CN');
      const rows = (result[responseKey] || []).map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        secondaryText: kind === 'SHIFT' ? `${row.start_minute}–${row.end_minute} 分钟` : '',
        active: row.active !== false && row.active !== 0,
      }));
      const filtered = rows.filter((row) => !term || `${row.code} ${row.name}`.toLocaleLowerCase('zh-CN').includes(term));
      const page = filtered.slice(offset, offset + limit);
      const selected = selectedId ? rows.find((row) => row.id === selectedId) : null;
      if (selected && !page.some((row) => row.id === selected.id)) page.unshift(selected);
      return { items: page, total: filtered.length };
    },
  };
}
