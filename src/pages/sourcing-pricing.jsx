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
//   - Pricing preview (Active Design §26.36.8): the browser never recomputes
//     an authoritative amount, it asks the server resolver.
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
//   - POST   /api/procurement/pricing/preview
//
// Implementation discipline (per erp-mobile-taste):
//   - LIST → DETAIL contextual workflow; dense ERP workspace.
//   - No marketing cards; no glassmorphism.

import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { Empty, FormActions, Modal, can } from '../components/ui.jsx';
import {
  BusinessAction, BusinessContentSection, BusinessPageHeader, BusinessPageShell,
  CompactRecord, CompactRecordList, HelpDisclosure, InlineAlert,
} from '../components/design-system.jsx';

function fmtDate(s) { return s ? new Date(s).toISOString().slice(0, 10) : '—'; }
function money(cents) { return `¥${(Number(cents || 0) / 100).toFixed(2)}`; }
function todayIso() { return new Date().toISOString().slice(0, 10); }

export default function SourcingPricingPage({ user, notify }) {
  const [tab, setTab] = useState('source');
  const [sources, setSources] = useState([]);
  const [quotas, setQuotas] = useState([]);
  const [prices, setPrices] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);

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

  const canManage = can(user, 'PROCUREMENT_CONFIG_MANAGE');

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
            <option value="preview">取价预览</option>
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
        <>
          <BusinessContentSection
            title="价格条目"
            description="每个价格条目按计价单位保存单价；新增或调整会生成新的生效版本"
            action={canManage ? <BusinessAction onClick={() => setEditor({ kind: 'price' })}>新增价格条目</BusinessAction> : null}
          >
            <CompactRecordList>
              {prices.map((p) => (
                <CompactRecord
                  key={p.id}
                  title={`${p.supplierId} / ${p.productId}`}
                  subtitle={`${p.pricingUomCode} / ${money(p.unitPriceCents)}`}
                  metadata={[{ label: '版本与有效期', value: `${p.status} v${p.version} ${fmtDate(p.effectiveFrom)} → ${fmtDate(p.effectiveTo)}` }]}
                  action={canManage ? (
                    <BusinessAction onClick={() => setEditor({ kind: 'adjust', entry: p })}>调整版本</BusinessAction>
                  ) : null}
                />
              ))}
            </CompactRecordList>
            {!prices.length && <Empty title="暂无价格" text="普通采购订单必须有有效价格条目才能创建。"/>}
          </BusinessContentSection>
        </>
      )}
      {tab === 'discount' && (
        <BusinessContentSection
          title="定价折扣"
          description="折扣只在明确的计价金额基数上计算，并随价格证据一起冻结"
          action={canManage ? <BusinessAction onClick={() => setEditor({ kind: 'discount' })}>新增折扣</BusinessAction> : null}
        >
          <CompactRecordList>
            {discounts.map((d) => <CompactRecord key={d.id} title={`${d.supplierId} / ${d.productId}`} subtitle={`${d.basis} ${d.value.num}/${d.value.den}`} metadata={[{ label: '版本与有效期', value: `${d.status} v${d.version} ${fmtDate(d.effectiveFrom)} → ${fmtDate(d.effectiveTo)}` }]}/>)}
          </CompactRecordList>
          {!discounts.length && <Empty title="暂无折扣" text="折扣是可选的；没有折扣时按价格条目金额计价。"/>}
        </BusinessContentSection>
      )}
      {tab === 'preview' && <PricingPreviewPanel notify={notify}/>}
      {tab === 'source' && (
        <SourceOverridePanel canManage={canManage} notify={notify} onChanged={load} />
      )}
      {tab === 'source' && !sources.length && <Empty title="暂无货源" />}
      {tab === 'quota' && !quotas.length && <Empty title="暂无配额" />}
      {editor && (
        <PricingEditor
          value={editor}
          notify={notify}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); notify('定价资料已保存'); }}
        />
      )}
    </BusinessPageShell>
  );
}

function PricingEditor({ value, notify, onClose, onSaved }) {
  const [form, setForm] = useState(
    value.kind === 'adjust'
      ? { unitPriceCents: value.entry.unitPriceCents, effectiveFrom: todayIso(), effectiveTo: '' }
      : value.kind === 'discount'
        ? { supplierId: '', productId: '', sourceType: 'PURCHASE', basis: 'PERCENT', numerator: 10, denominator: 100, effectiveFrom: todayIso(), effectiveTo: '' }
        : { supplierId: '', productId: '', sourceType: 'PURCHASE', pricingUomCode: '', unitPriceCents: '', effectiveFrom: todayIso(), effectiveTo: '' },
  );

  async function submit(event) {
    event.preventDefault();
    try {
      if (value.kind === 'adjust') {
        await api(`/api/procurement/price-list/${value.entry.id}/adjust`, {
          method: 'POST',
          body: {
            unitPriceCents: Number(form.unitPriceCents),
            effectiveFrom: form.effectiveFrom,
            effectiveTo: form.effectiveTo || null,
          },
        });
      } else if (value.kind === 'discount') {
        await api('/api/procurement/discounts', {
          method: 'POST',
          body: {
            supplierId: form.supplierId,
            productId: form.productId,
            sourceType: form.sourceType,
            basis: form.basis,
            value: { num: Number(form.numerator), den: Number(form.denominator) },
            effectiveFrom: form.effectiveFrom,
            effectiveTo: form.effectiveTo || null,
          },
        });
      } else {
        await api('/api/procurement/price-list', {
          method: 'POST',
          body: {
            supplierId: form.supplierId,
            productId: form.productId,
            sourceType: form.sourceType,
            pricingUomCode: form.pricingUomCode,
            unitPriceCents: Number(form.unitPriceCents),
            effectiveFrom: form.effectiveFrom,
            effectiveTo: form.effectiveTo || null,
          },
        });
      }
      onSaved();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  const title = value.kind === 'adjust' ? '调整价格版本' : value.kind === 'discount' ? '新增定价折扣' : '新增价格条目';

  return (
    <Modal title={title} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        {value.kind !== 'adjust' && (
          <>
            <label>供应商<input required value={form.supplierId} placeholder="供应商 ID" onChange={(e) => setForm({ ...form, supplierId: e.target.value })}/></label>
            <label>货品<input required value={form.productId} placeholder="货品 ID" onChange={(e) => setForm({ ...form, productId: e.target.value })}/></label>
            <label>来源
              <select value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })}>
                <option value="PURCHASE">采购</option>
                <option value="OUTSOURCE">委外</option>
              </select>
            </label>
          </>
        )}
        {value.kind === 'price' && (
          <label>计价单位<input required value={form.pricingUomCode} placeholder="例如 EA / BOX" onChange={(e) => setForm({ ...form, pricingUomCode: e.target.value })}/></label>
        )}
        {value.kind === 'discount' && (
          <>
            <label>折扣基础
              <select value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })}>
                <option value="PERCENT">百分比</option>
                <option value="FLAT">每计价单位固定额</option>
              </select>
            </label>
            <label>折扣分子<input type="number" min="0" required value={form.numerator} onChange={(e) => setForm({ ...form, numerator: e.target.value })}/></label>
            <label>折扣分母<input type="number" min="1" required value={form.denominator} onChange={(e) => setForm({ ...form, denominator: e.target.value })}/></label>
          </>
        )}
        {value.kind !== 'discount' && (
          <label>单价（分）<input type="number" min="0" step="1" required value={form.unitPriceCents} onChange={(e) => setForm({ ...form, unitPriceCents: e.target.value })}/></label>
        )}
        <label>生效日期<input type="date" required value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}/></label>
        <label>失效日期<input type="date" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}/></label>
        <InlineAlert tone="info" title="金额由服务端计算">
          浏览器只提交单价与生效区间；行金额、折扣与舍入由服务端在写单据事务内计算并冻结。
        </InlineAlert>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

function PricingPreviewPanel({ notify }) {
  const [form, setForm] = useState({
    supplierId: '', productId: '', sourceType: 'PURCHASE',
    documentUomCode: '', quantity: '1', businessDate: todayIso(),
  });
  const [pricing, setPricing] = useState(null);
  const [error, setError] = useState('');

  async function preview(event) {
    event.preventDefault();
    try {
      const result = await api('/api/procurement/pricing/preview', {
        method: 'POST',
        body: {
          supplierId: form.supplierId,
          productId: form.productId,
          sourceType: form.sourceType,
          documentUomCode: form.documentUomCode || undefined,
          documentQuantity: { num: Number(form.quantity), den: 1 },
          businessDate: form.businessDate,
        },
      });
      setPricing(result.pricing);
      setError('');
    } catch (requestError) {
      setPricing(null);
      setError(requestError.message);
      notify(requestError.message, 'error');
    }
  }

  return (
    <BusinessContentSection
      title="取价预览"
      description="调用服务端取价原语，展示计价单位换算、折扣与舍入证据"
    >
      <form className="form-grid" onSubmit={preview}>
        <label>供应商<input required value={form.supplierId} placeholder="供应商 ID" onChange={(e) => setForm({ ...form, supplierId: e.target.value })}/></label>
        <label>货品<input required value={form.productId} placeholder="货品 ID" onChange={(e) => setForm({ ...form, productId: e.target.value })}/></label>
        <label>单据单位<input value={form.documentUomCode} placeholder="留空使用基础单位" onChange={(e) => setForm({ ...form, documentUomCode: e.target.value })}/></label>
        <label>单据数量<input type="number" min="0.000001" step="any" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })}/></label>
        <label>业务日期<input type="date" required value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })}/></label>
        <div className="full"><button className="primary">预览取价</button></div>
      </form>
      {error && <InlineAlert tone="danger" title="无法取价">{error}</InlineAlert>}
      {pricing && (
        <CompactRecordList>
          <CompactRecord
            title="取价证据"
            subtitle={`${pricing.pricingUomCode || '赠品零价'} · ${pricing.roundingContract}`}
            metadata={[
              { label: '价格条目', value: pricing.priceEntryId ? `${pricing.priceEntryId} v${pricing.priceVersion}` : '赠品零价' },
              { label: '单据单位 / 数量', value: `${pricing.documentUomCode || '基础单位'} ${pricing.documentQuantity.num}/${pricing.documentQuantity.den}` },
              { label: '基础数量', value: `${pricing.baseQuantity.num}/${pricing.baseQuantity.den}` },
              { label: '计价数量', value: pricing.pricingQuantity ? `${pricing.pricingQuantity.num}/${pricing.pricingQuantity.den}` : '—' },
            ]}
            metrics={[
              { label: '计价单价', value: money(pricing.unitPriceCents) },
              { label: '折前金额', value: money(pricing.netCents) },
              { label: '折扣金额', value: money(pricing.discountCents) },
              { label: '行金额', value: money(pricing.grossCents) },
            ]}
          />
        </CompactRecordList>
      )}
    </BusinessContentSection>
  );
}

// 货源 override 面板（PRC-04 / Requirement §31.19.1）。
//
// override 是**有界、有限、可审计**的放行事实：权限 + 必填原因 + 生效区间 +
// 恰好一条审计，且只在区间内放行。它不改写货源主数据。
//
// 后端合同：
//   - GET  /api/procurement/source-overrides
//   - POST /api/procurement/source-entries/override
function SourceOverridePanel({ canManage, notify, onChanged }) {
  const [overrides, setOverrides] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    supplierId: '', productId: '', sourceType: 'PURCHASE', reason: '',
    effectiveFrom: todayIso(), effectiveTo: todayIso(),
  });

  const load = useCallback(async () => {
    try {
      const data = await api('/api/procurement/source-overrides', { method: 'GET' });
      setOverrides(data.overrides || []);
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/api/procurement/source-entries/override', {
        method: 'POST',
        body: {
          supplierId: form.supplierId.trim(),
          productId: form.productId.trim(),
          sourceType: form.sourceType,
          reason: form.reason.trim(),
          effectiveFrom: form.effectiveFrom,
          effectiveTo: form.effectiveTo,
        },
      });
      setForm({ ...form, reason: '' });
      await load();
      if (onChanged) onChanged();
      notify('货源 override 已登记');
    } catch (err) {
      setError(err.message || '登记失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BusinessContentSection
      title="货源 override"
      description="在指定日期区间内放行一个供应商 / 货品 / 货源类型；区间之外不放行，也不改写货源主数据"
    >
      {error ? <InlineAlert tone="danger" title="操作未完成">{error}</InlineAlert> : null}
      {canManage ? (
        <form onSubmit={submit}>
          <div className="field-grid">
            <label>
              <span>供应商</span>
              <input
                aria-label="override 供应商"
                value={form.supplierId}
                onChange={(event) => setForm({ ...form, supplierId: event.target.value })}
              />
            </label>
            <label>
              <span>货品</span>
              <input
                aria-label="override 货品"
                value={form.productId}
                onChange={(event) => setForm({ ...form, productId: event.target.value })}
              />
            </label>
            <label>
              <span>货源类型</span>
              <select
                aria-label="override 货源类型"
                value={form.sourceType}
                onChange={(event) => setForm({ ...form, sourceType: event.target.value })}
              >
                <option value="PURCHASE">采购货源</option>
                <option value="OUTSOURCE">委外货源</option>
              </select>
            </label>
            <label>
              <span>生效开始</span>
              <input
                aria-label="override 生效开始"
                type="date"
                value={form.effectiveFrom}
                onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
              />
            </label>
            <label>
              <span>生效结束</span>
              <input
                aria-label="override 生效结束"
                type="date"
                value={form.effectiveTo}
                onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })}
              />
            </label>
            <label>
              <span>原因</span>
              <input
                aria-label="override 原因"
                value={form.reason}
                onChange={(event) => setForm({ ...form, reason: event.target.value })}
              />
            </label>
          </div>
          <BusinessAction hierarchy="primary" type="submit" disabled={busy}>登记 override</BusinessAction>
        </form>
      ) : null}
      <CompactRecordList data-testid="sourcing-override-list">
        {overrides.map((item) => (
          <CompactRecord
            key={item.id}
            title={`${item.supplierId} / ${item.productId}`}
            subtitle={`${item.sourceType} / ${item.status}`}
            metadata={[
              { label: '生效区间', value: `${fmtDate(item.effectiveFrom)} → ${fmtDate(item.effectiveTo)}` },
              { label: '原因', value: item.reason },
            ]}
          />
        ))}
      </CompactRecordList>
      {!overrides.length ? <Empty title="暂无 override" text="没有有效货源时，可按有界区间登记一次有原因的放行。" /> : null}
    </BusinessContentSection>
  );
}
