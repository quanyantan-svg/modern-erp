// Procurement & Outsourcing Domain Closure — Sourcing & Pricing Workspace.
//
// Mobile-first workspace for:
//   - Source List (PRC-04)
//   - Quota (PRC-05, PROPORTIONAL)
//   - Sourcing Decision (PRC-06, write entry safely closed)
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
//   - GET    /api/procurement/price-list
//   - POST   /api/procurement/price-list
//   - POST   /api/procurement/price-list/:id/adjust
//   - GET    /api/procurement/discounts
//   - POST   /api/procurement/discounts
//
// Implementation discipline (per erp-mobile-taste):
//   - LIST → DETAIL contextual workflow; dense ERP workspace.
//   - No marketing cards; no glassmorphism.

import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { Empty } from '../components/ui.jsx';
import {
  BusinessPageHeader, BusinessPageShell,
  CompactRecord, CompactRecordList, HelpDisclosure,
} from '../components/design-system.jsx';

function fmtDate(s) { return s ? new Date(s).toISOString().slice(0, 10) : '—'; }

export default function SourcingPricingPage() {
  const [tab, setTab] = useState('source');
  const [sources, setSources] = useState([]);
  const [quotas, setQuotas] = useState([]);
  const [prices, setPrices] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, q, p, d] = await Promise.all([
        api('/api/procurement/source-entries', { method: 'GET' }),
        api('/api/procurement/quotas', { method: 'GET' }),
        api('/api/procurement/price-list', { method: 'GET' }),
        api('/api/procurement/discounts', { method: 'GET' }),
      ]);
      setSources(s.sourceEntries || []);
      setQuotas(q.quotas || []);
      setPrices(p.priceList || []);
      setDiscounts(d.discounts || []);
      setError('');
    } catch (err) { setError(err.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <BusinessPageShell>
      <BusinessPageHeader
        title="寻源与定价"
        context="Source List · Quota · Sourcing · Price List · Pricing UOM · Pricing Discount · Price Adjustment"
        secondaryActions={
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
        <CompactRecordList data-testid="sourcing-source-list">
          {sources.map((s) => <CompactRecord key={s.id} title={`${s.supplierId} / ${s.productId}`} subtitle={`${s.sourceType} / ${s.enabled ? '启用' : '停用'}`} metadata={[{ label: '有效期', value: `${fmtDate(s.effectiveFrom)} → ${fmtDate(s.effectiveTo)}` }]}/>)}
        </CompactRecordList>
      )}
      {tab === 'quota' && (
        <CompactRecordList>
          {quotas.map((q) => <CompactRecord key={q.id} title={`${q.supplierId} / ${q.productId}`} subtitle={`${q.sourceType} / 比例 ${q.proportion.num}/${q.proportion.den}`} metadata={[{ label: '有效期', value: `${fmtDate(q.effectiveFrom)} → ${fmtDate(q.effectiveTo)}` }]}/>)}
        </CompactRecordList>
      )}
      {tab === 'price' && (
        <CompactRecordList>
          {prices.map((p) => <CompactRecord key={p.id} title={`${p.supplierId} / ${p.productId}`} subtitle={`${p.pricingUomCode} / ¥${(p.unitPriceCents/100).toFixed(2)}`} metadata={[{ label: '版本与有效期', value: `${p.status} v${p.version} ${fmtDate(p.effectiveFrom)} → ${fmtDate(p.effectiveTo)}` }]}/>)}
        </CompactRecordList>
      )}
      {tab === 'discount' && (
        <CompactRecordList>
          {discounts.map((d) => <CompactRecord key={d.id} title={`${d.supplierId} / ${d.productId}`} subtitle={`${d.basis} ${d.value.num}/${d.value.den}`} metadata={[{ label: '版本与有效期', value: `${d.status} v${d.version} ${fmtDate(d.effectiveFrom)} → ${fmtDate(d.effectiveTo)}` }]}/>)}
        </CompactRecordList>
      )}
      {tab === 'source' && !sources.length && <Empty title="暂无货源" />}
      {tab === 'quota' && !quotas.length && <Empty title="暂无配额" />}
      {tab === 'price' && !prices.length && <Empty title="暂无价格" />}
      {tab === 'discount' && !discounts.length && <Empty title="暂无折扣" />}
    </BusinessPageShell>
  );
}
