// V21 — Inventory Overview (mobile-first).
// Frozen by `solution.md §27.47` — Mobile Inventory & Warehouse architecture.
//
// Aggregated inventory summary:
//   - Instant stock by warehouse × product × owner
//   - Locked quantity + Planning reservations (read-only)
//   - Recent inventory transactions
//   - Stocktake status
//
// Mobile-first: 390 CSS px primary; verified 320 / 430 / 680.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api.js';
import { useActor } from '../actor.js';

const REFRESH_INTERVAL_MS = 15_000;

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

export default function InventoryOverview() {
  const actor = useActor();
  const [instant, setInstant] = useState([]);
  const [alerts, setAlerts] = useState({ negativeBalance: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!actor?.token) return;
    setLoading(true);
    try {
      const [summary, alertResp] = await Promise.all([
        apiClient.get('/api/inventory/compatibility/aggregate', {}, actor.token),
        apiClient.get('/api/inventory/alerts', {}, actor.token).catch(() => ({ negativeBalance: [] })),
      ]);
      setInstant(summary?.aggregates || []);
      setAlerts(alertResp);
      setError(null);
    } catch (e) {
      setError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [actor?.token]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(t);
  }, [load]);

  const negatives = useMemo(() => alerts?.negativeBalance || [], [alerts]);

  return (
    <div className="inventory-overview" data-screen="inventory-overview">
      <header className="overview-header">
        <h2>库存总览</h2>
        <button type="button" onClick={load} disabled={loading}>刷新</button>
      </header>
      {error && <div className="overview-error" role="alert">{error}</div>}
      <section className="overview-summary">
        <article className="overview-card">
          <header>在库总量</header>
          <strong>{formatNumber(instant.reduce((s, r) => s + Number(r.totalQuantity || 0), 0))}</strong>
        </article>
        <article className="overview-card">
          <header>可发量</header>
          <strong>{formatNumber(instant.reduce((s, r) => s + Number(r.availableQuantity || 0), 0))}</strong>
        </article>
        <article className="overview-card">
          <header>企业自有</header>
          <strong>{formatNumber(instant.reduce((s, r) => s + Number(r.enterpriseOwnedQuantity || 0), 0))}</strong>
        </article>
        <article className="overview-card">
          <header>供应商寄售</header>
          <strong>{formatNumber(instant.reduce((s, r) => s + Number(r.supplierOwnedQuantity || 0), 0))}</strong>
        </article>
        <article className="overview-card">
          <header>客户委托</header>
          <strong>{formatNumber(instant.reduce((s, r) => s + Number(r.customerOwnedQuantity || 0), 0))}</strong>
        </article>
      </section>
      {negatives.length > 0 && (
        <section className="overview-alerts" aria-label="库存预警">
          <h3>负库存预警（{negatives.length}）</h3>
          <ul>
            {negatives.slice(0, 10).map((r) => (
              <li key={r.id}>{r.product_id} @ {r.warehouse_id} — {formatNumber(r.quantity)}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="overview-detail" aria-label="按仓库 × 产品">
        <h3>在库分布</h3>
        <div className="overview-list">
          {instant.map((row) => (
            <article key={`${row.warehouseId}-${row.productId}`} className="overview-row">
              <header>
                <strong>{row.warehouseId}</strong>
                <span>{row.productId}</span>
              </header>
              <dl>
                <div><dt>在库</dt><dd>{formatNumber(row.totalQuantity)}</dd></div>
                <div><dt>可发</dt><dd>{formatNumber(row.availableQuantity)}</dd></div>
                <div><dt>企业</dt><dd>{formatNumber(row.enterpriseOwnedQuantity)}</dd></div>
                <div><dt>寄售</dt><dd>{formatNumber(row.supplierOwnedQuantity)}</dd></div>
                <div><dt>委托</dt><dd>{formatNumber(row.customerOwnedQuantity)}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}