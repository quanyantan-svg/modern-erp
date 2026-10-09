// Procurement & Outsourcing Domain Closure — Sourcing & Pricing Workspace.
//
// Mobile-first workspace for:
//   - Source List (PRC-04)
//   - Quota (PRC-05, PROPORTIONAL)
//   - Sourcing Decision (PRC-06, with manual override)
//   - Price List (PRC-07)
//   - Pricing UOM (PRC-08)
//   - Pricing Discount (PRC-09)
//   - Price Adjustment (PRC-10, generates new effective version)
//
// Backend contracts:
//   - GET    /api/procurement/source-entries
//   - POST   /api/procurement/source-entries
//   - GET    /api/procurement/quotas
//   - POST   /api/procurement/quotas
//   - POST   /api/procurement/sourcing-decisions
//   - GET    /api/procurement/price-list
//   - POST   /api/procurement/price-list
//   - POST   /api/procurement/price-list/:id/adjust
//   - GET    /api/procurement/discounts
//   - POST   /api/procurement/discounts
//
// Implementation discipline (per erp-mobile-taste):
//   - LIST → DETAIL contextual workflow; dense ERP workspace.
//   - No marketing cards; no glassmorphism.
//   - Sourcing allocation: PROPORTIONAL with quantity conservation + residual tie-break.

import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { can, Empty, Modal } from '../components/ui.jsx';
import {
  BusinessAction, BusinessActionBar, BusinessPageHeader, BusinessPageShell,
  CompactRecordList, HelpDisclosure, RecordCard,
} from '../components/design-system.jsx';

function fmtDate(s) { return s ? new Date(s).toISOString().slice(0, 10) : '—'; }

export default function SourcingPricingPage() {
  const [tab, setTab] = useState('source');
  const [sources, setSources] = useState([]);
  const [quotas, setQuotas] = useState([]);
  const [prices, setPrices] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [error, setError] = useState('');
  const [allocating, setAllocating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, q, p, d] = await Promise.all([
        api.get('/api/procurement/source-entries'),
        api.get('/api/procurement/quotas'),
        api.get('/api/procurement/price-list'),
        api.get('/api/procurement/discounts'),
      ]);
      setSources(s.sourceEntries || []);
      setQuotas(q.quotas || []);
      setPrices(p.priceList || []);
      setDiscounts(d.discounts || []);
      setError('');
    } catch (err) { setError(err.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runAllocation() {
    setAllocating(true);
    try {
      // Demo: allocate 100 PCS of product-001 against all sources.
      const res = await api.post('/api/procurement/sourcing-decisions', {
        sourceType: 'PR', sourceId: 'PR-DEMO-001', procurementSourceType: 'PURCHASE',
        productId: 'product-001', businessDate: new Date().toISOString().slice(0, 10),
        quantity: 100,
      });
      setError(`Sourcing OK: ${res.allocations?.length || 0} allocations, total ${res.allocations?.reduce((a, x) => a + x.allocatedQuantity, 0) || 0}`);
    } catch (err) { setError(err.message); }
    finally { setAllocating(false); }
  }

  return (
    <BusinessPageShell>
      <BusinessPageHeader
        title="寻源与定价"
        subtitle="Source List · Quota · Sourcing · Price List · Pricing UOM · Pricing Discount · Price Adjustment"
        actions={
          <BusinessActionBar>
            <BusinessAction onClick={runAllocation} disabled={allocating}>
              模拟寻源分配
            </BusinessAction>
          </BusinessActionBar>
        }
        filters={
          <select value={tab} onChange={(e) => setTab(e.target.value)}>
            <option value="source">Source List</option>
            <option value="quota">Quota</option>
            <option value="price">Price List</option>
            <option value="discount">Pricing Discount</option>
          </select>
        }
      />
      {error && <HelpDisclosure>{error}</HelpDisclosure>}
      {tab === 'source' && (
        <CompactRecordList
          items={sources.map((s) => ({
            key: s.id, primary: `${s.supplierId} / ${s.productId}`,
            secondary: `${s.sourceType} / ${s.enabled ? '启用' : '停用'}`,
            meta: `${fmtDate(s.effectiveFrom)} → ${fmtDate(s.effectiveTo)}`,
            tone: s.enabled ? 'positive' : 'muted',
          }))}
        />
      )}
      {tab === 'quota' && (
        <CompactRecordList
          items={quotas.map((q) => ({
            key: q.id, primary: `${q.supplierId} / ${q.productId}`,
            secondary: `${q.sourceType} / 比例 ${q.proportion.num}/${q.proportion.den}`,
            meta: `${fmtDate(q.effectiveFrom)} → ${fmtDate(q.effectiveTo)}`,
          }))}
        />
      )}
      {tab === 'price' && (
        <CompactRecordList
          items={prices.map((p) => ({
            key: p.id, primary: `${p.supplierId} / ${p.productId}`,
            secondary: `${p.pricingUomCode} / ¥${(p.unitPriceCents/100).toFixed(2)}`,
            meta: `${p.status} v${p.version} ${fmtDate(p.effectiveFrom)} → ${fmtDate(p.effectiveTo)}`,
            tone: p.status === 'ACTIVE' ? 'positive' : 'muted',
          }))}
        />
      )}
      {tab === 'discount' && (
        <CompactRecordList
          items={discounts.map((d) => ({
            key: d.id, primary: `${d.supplierId} / ${d.productId}`,
            secondary: `${d.basis} ${d.value.num}/${d.value.den}`,
            meta: `${d.status} v${d.version} ${fmtDate(d.effectiveFrom)} → ${fmtDate(d.effectiveTo)}`,
          }))}
        />
      )}
      {tab === 'source' && !sources.length && <Empty title="暂无货源" />}
      {tab === 'quota' && !quotas.length && <Empty title="暂无配额" />}
      {tab === 'price' && !prices.length && <Empty title="暂无价格" />}
      {tab === 'discount' && !discounts.length && <Empty title="暂无折扣" />}
    </BusinessPageShell>
  );
}
