// V21 — Inventory mobile hub (Wave E UI surfaces).
// Frozen by solution.md §27.47 (Mobile Inventory & Warehouse architecture).
// Single hub surfaces UAT-05..28 by linking to their canonical pages and
// surfacing summary metrics from inventory-overview.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api.js';
import { useActor } from '../actor.js';

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

const SECTIONS = [
  { key: 'transfers', label: '库存调拨', route: 'inventory-transfers', permission: ['INVENTORY_TRANSFER_VIEW','INVENTORY_TRANSFER_CONFIRM'] },
  { key: 'stocktake', label: '库存盘点', route: 'inventory-stocktake', permission: ['INVENTORY_CHECK_CREATE','INVENTORY_CHECK_APPROVE'] },
  { key: 'native', label: '库存原生收发', route: 'inventory-native', permission: ['INVENTORY_NATIVE_DOCUMENT_VIEW','INVENTORY_NATIVE_DOCUMENT_MANAGE'] },
  { key: 'bin', label: '仓库仓位', route: 'inventory-bin', permission: ['WAREHOUSE_BIN_VIEW','WAREHOUSE_BIN_MANAGE'] },
  { key: 'barcode', label: '条码扫描', route: 'inventory-barcode', permission: ['INVENTORY_BARCODE_RULE_VIEW','INVENTORY_BARCODE_RULE_MANAGE'] },
  { key: 'lot', label: '批次调整', route: 'inventory-lot', permission: ['INVENTORY_LOT_ADJUSTMENT_VIEW','INVENTORY_LOT_ADJUSTMENT_MANAGE'] },
  { key: 'form', label: '形态转换', route: 'inventory-form', permission: ['INVENTORY_FORM_CONVERSION_VIEW','INVENTORY_FORM_CONVERSION_MANAGE'] },
  { key: 'period', label: '库存期间', route: 'inventory-period', permission: ['INVENTORY_PERIOD_CLOSE_VIEW','INVENTORY_PERIOD_CLOSE_MANAGE'] },
  { key: 'reports', label: '库存报表', route: 'inventory-reports', permission: ['INVENTORY_REPORT_VIEW'] },
];

export default function InventoryHub() {
  const actor = useActor();
  const [instant, setInstant] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!actor?.token) return;
    try {
      const r = await apiClient.get('/api/inventory/compatibility/aggregate', {}, actor.token).catch(() => ({ aggregates: [] }));
      setInstant(r?.aggregates || []);
    } finally { setLoading(false); }
  }, [actor?.token]);

  useEffect(() => { load(); }, [load]);

  const hasPermission = useCallback((perms) => {
    if (!actor?.permissions) return true;
    return perms.some((p) => actor.permissions.includes(p));
  }, [actor?.permissions]);

  const totals = useMemo(() => {
    const out = { total: 0, available: 0, positions: 0 };
    for (const r of instant) {
      out.total += Number(r.totalQuantity || 0);
      out.available += Number(r.availableQuantity || 0);
      out.positions += Number(r.positionCount || 0);
    }
    return out;
  }, [instant]);

  return (
    <div className="inventory-hub" data-screen="inventory-hub">
      <header className="hub-header">
        <h2>库存业务</h2>
        <button type="button" onClick={load} disabled={loading} aria-label="refresh">刷新</button>
      </header>
      <section className="hub-summary" aria-label="库存汇总">
        <article className="hub-card"><header>在库总量</header><strong>{formatNumber(totals.total)}</strong></article>
        <article className="hub-card"><header>可发量</header><strong>{formatNumber(totals.available)}</strong></article>
        <article className="hub-card"><header>库存位置数</header><strong>{formatNumber(totals.positions)}</strong></article>
      </section>
      <section className="hub-sections" aria-label="库存业务">
        {SECTIONS.filter((s) => hasPermission(s.permission)).map((s) => (
          <a key={s.key} href={`#/${s.route}`} className="hub-tile" data-route={s.route}>
            <span className="hub-tile-label">{s.label}</span>
            <span className="hub-tile-arrow" aria-hidden="true">›</span>
          </a>
        ))}
      </section>
    </div>
  );
}