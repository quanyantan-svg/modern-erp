import { useEffect, useState } from 'react';
import { api } from '../api.js';

const can = (user, permission) => Boolean(user?.permissions?.includes(permission));
const today = () => new Date().toISOString().slice(0, 10);
const emptyHeader = () => ({ code: '', name: '', currencyCode: 'CNY', effectiveFrom: today() });
const emptyEntry = () => ({ materialId: '', customerId: '', pricingUomCode: '', qtyBreakMinMicros: '0', effectiveFrom: today(), unitPriceCents: '' });
const emptyRule = () => ({ ruleKey: '', lineScope: 'LINE', applicationMode: 'AUTOMATIC', discountKind: 'PERCENT', discountBps: '', discountAmountCents: '', effectiveFrom: today() });

export default function SalesPricing({ user, notify }) {
  const [tab, setTab] = useState('prices');
  const [rows, setRows] = useState({ prices: [], discounts: [] });
  const [selected, setSelected] = useState(null);
  const [header, setHeader] = useState(emptyHeader);
  const [entry, setEntry] = useState(emptyEntry);
  const [rule, setRule] = useState(emptyRule);
  const manageable = can(user, 'SALES_PRICING_MANAGE');

  async function openDetail(row, activeTab = tab) {
    try {
      const result = await api(activeTab === 'prices' ? `/api/sales-price-lists/${row.id}` : `/api/sales-discount-schemes/${row.id}`);
      setSelected(activeTab === 'prices' ? result.priceList : result.scheme);
    } catch (error) { notify(error.message, 'error'); }
  }
  async function load(preferredId = selected?.id, activeTab = tab) {
    try {
      const [prices, discounts] = await Promise.all([api('/api/sales-price-lists'), api('/api/sales-discount-schemes')]);
      const next = { prices: prices.priceLists || [], discounts: discounts.schemes || [] };
      setRows(next);
      const current = next[activeTab].find((item) => item.id === preferredId);
      if (current) await openDetail(current, activeTab); else if (preferredId) setSelected(null);
    } catch (error) { notify(error.message, 'error'); }
  }
  useEffect(() => { void load(); }, []);

  async function switchTab(nextTab) { setTab(nextTab); setSelected(null); await load(undefined, nextTab); }
  async function createHeader(event) {
    event.preventDefault();
    try {
      const discount = tab === 'discounts';
      const body = discount
        ? { schemeCode: header.code, name: header.name, currencyCode: header.currencyCode, effectiveFrom: header.effectiveFrom, priority: 0, version: 1 }
        : { priceListCode: header.code, name: header.name, currencyCode: header.currencyCode, effectiveFrom: header.effectiveFrom, priority: 0 };
      const result = await api(discount ? '/api/sales-discount-schemes' : '/api/sales-price-lists', { method: 'POST', body });
      const created = discount ? result.scheme : result.priceList;
      setHeader(emptyHeader()); await load(created.id); notify('草稿已创建');
    } catch (error) { notify(error.message, 'error'); }
  }
  async function addChild(event) {
    event.preventDefault();
    try {
      if (tab === 'prices') {
        await api(`/api/sales-price-lists/${selected.id}/entries`, { method: 'POST', body: {
          materialId: entry.materialId, customerId: entry.customerId || null, customerScopeType: entry.customerId ? 'CUSTOMER' : 'ALL',
          pricingUomCode: entry.pricingUomCode, qtyBreakMinMicros: Number(entry.qtyBreakMinMicros), qtyBreakMaxMicros: null,
          effectiveFrom: entry.effectiveFrom, unitPriceCents: Number(entry.unitPriceCents),
        } });
        setEntry(emptyEntry());
      } else {
        await api(`/api/sales-discount-schemes/${selected.id}/rules`, { method: 'POST', body: {
          ruleKey: rule.ruleKey, lineScope: rule.lineScope, applicationMode: rule.applicationMode, discountKind: rule.discountKind,
          discountBps: rule.discountKind === 'PERCENT' ? Number(rule.discountBps) : undefined,
          discountAmountCents: rule.discountKind === 'AMOUNT' ? Number(rule.discountAmountCents) : undefined,
          customerScopeType: 'ALL', qtyBreakMinMicros: 0, qtyBreakMaxMicros: null, effectiveFrom: rule.effectiveFrom,
        } });
        setRule(emptyRule());
      }
      await load(selected.id); notify('配置已追加');
    } catch (error) { notify(error.message, 'error'); }
  }
  async function transition(action) {
    try {
      const resource = tab === 'prices' ? 'sales-price-lists' : 'sales-discount-schemes';
      await api(`/api/${resource}/${selected.id}/${action}`, { method: 'POST', body: {}, headers: { 'Idempotency-Key': `${resource}-${selected.id}-${action}-${crypto.randomUUID()}` } });
      await load(selected.id); notify(action === 'activate' ? '已启用' : '已退役');
    } catch (error) { notify(error.message, 'error'); }
  }

  const list = rows[tab];
  return <main className="business-page sales-pricing-page" data-testid="sales-pricing-page">
    <header className="business-page-header"><div><h1>销售定价与订单时折扣</h1><p>维护本位币价目表与折扣方案；解析和试算保持纯读。</p></div></header>
    <div className="segmented" role="tablist"><button type="button" className={tab === 'prices' ? 'active' : ''} onClick={() => void switchTab('prices')}>价目表</button><button type="button" className={tab === 'discounts' ? 'active' : ''} onClick={() => void switchTab('discounts')}>折扣方案</button></div>
    {manageable && <form className="form-grid sales-pricing-editor" onSubmit={createHeader}><label>编码<input required value={header.code} onChange={(event) => setHeader({ ...header, code: event.target.value })}/></label><label>名称<input required value={header.name} onChange={(event) => setHeader({ ...header, name: event.target.value })}/></label><label>币种<input required value={header.currencyCode} onChange={(event) => setHeader({ ...header, currencyCode: event.target.value })}/></label><label>生效日期<input type="date" required value={header.effectiveFrom} onChange={(event) => setHeader({ ...header, effectiveFrom: event.target.value })}/></label><button className="primary" type="submit">新建草稿</button></form>}
    <div className="sales-pricing-workspace"><section className="sales-pricing-list" aria-label="配置列表">{list.map((row) => <button type="button" key={row.id} className={`panel sales-pricing-row ${selected?.id === row.id ? 'selected' : ''}`} onClick={() => void openDetail(row)}><span><strong>{row.price_list_code || row.scheme_code}</strong><small>{row.name}</small></span><span><small>{row.currency_code} · {row.effective_from} 起</small><b>{row.status}</b></span></button>)}{!list.length && <div className="empty-state">暂无配置</div>}</section>
      {selected && <section className="panel sales-pricing-detail" aria-label="配置详情"><header><div><h2>{selected.name}</h2><p>{selected.price_list_code || selected.scheme_code} · {selected.status}</p></div>{manageable && <div className="sales-pricing-actions">{selected.status === 'DRAFT' && <button type="button" className="primary" onClick={() => void transition('activate')}>启用</button>}{selected.status === 'ACTIVE' && <button type="button" onClick={() => void transition('retire')}>退役</button>}</div>}</header>
        <div className="sales-pricing-history">{tab === 'prices' ? <><b>价格条目 {selected.entries?.length || 0}</b><span>不可变版本 {selected.versions?.length || 0}</span>{selected.entries?.map((item) => <div key={item.id}><code>{item.material_id}</code><span>{item.pricing_uom_code} · {item.qty_break_min_micros}+</span></div>)}</> : <><b>规则版本 {selected.rules?.length || 0}</b>{selected.rules?.map((item) => <div key={item.id}><code>{item.rule_key} v{item.rule_version}</code><span>{item.line_scope} · {item.application_mode}</span></div>)}</>}</div>
        {manageable && selected.status === 'DRAFT' && (tab === 'prices' ? <form className="form-grid sales-pricing-child" onSubmit={addChild}><h3>新增价格条目</h3><label>物料 ID<input required value={entry.materialId} onChange={(event) => setEntry({ ...entry, materialId: event.target.value })}/></label><label>客户 ID（可空）<input value={entry.customerId} onChange={(event) => setEntry({ ...entry, customerId: event.target.value })}/></label><label>计价单位<input required value={entry.pricingUomCode} onChange={(event) => setEntry({ ...entry, pricingUomCode: event.target.value })}/></label><label>起始数量（微单位）<input type="number" min="0" required value={entry.qtyBreakMinMicros} onChange={(event) => setEntry({ ...entry, qtyBreakMinMicros: event.target.value })}/></label><label>单价（分）<input type="number" min="0" required value={entry.unitPriceCents} onChange={(event) => setEntry({ ...entry, unitPriceCents: event.target.value })}/></label><label>生效日期<input type="date" required value={entry.effectiveFrom} onChange={(event) => setEntry({ ...entry, effectiveFrom: event.target.value })}/></label><button className="primary" type="submit">追加条目与版本</button></form> : <form className="form-grid sales-pricing-child" onSubmit={addChild}><h3>新增折扣规则</h3><label>规则键<input required value={rule.ruleKey} onChange={(event) => setRule({ ...rule, ruleKey: event.target.value })}/></label><label>范围<select value={rule.lineScope} onChange={(event) => setRule({ ...rule, lineScope: event.target.value })}><option value="LINE">LINE</option><option value="HEADER">HEADER</option></select></label><label>应用方式<select value={rule.applicationMode} onChange={(event) => setRule({ ...rule, applicationMode: event.target.value })}><option value="AUTOMATIC">自动</option><option value="MANUAL">手工</option></select></label><label>折扣类型<select value={rule.discountKind} onChange={(event) => setRule({ ...rule, discountKind: event.target.value })}><option value="PERCENT">基点</option><option value="AMOUNT">固定金额</option></select></label><label>{rule.discountKind === 'PERCENT' ? '折扣基点' : '折扣金额（分）'}<input type="number" min="0" required value={rule.discountKind === 'PERCENT' ? rule.discountBps : rule.discountAmountCents} onChange={(event) => setRule({ ...rule, [rule.discountKind === 'PERCENT' ? 'discountBps' : 'discountAmountCents']: event.target.value })}/></label><label>生效日期<input type="date" required value={rule.effectiveFrom} onChange={(event) => setRule({ ...rule, effectiveFrom: event.target.value })}/></label><button className="primary" type="submit">追加规则版本</button></form>)}</section>}
    </div>
    <style>{`.sales-pricing-page{max-width:1080px;margin:0 auto;padding:clamp(16px,3vw,32px);display:grid;gap:18px;overflow-x:hidden}.sales-pricing-editor,.sales-pricing-child{padding:16px;border:1px solid var(--border,#dbe2ea);border-radius:12px}.sales-pricing-workspace{display:grid;grid-template-columns:minmax(240px,.8fr) minmax(0,1.4fr);gap:14px;align-items:start}.sales-pricing-list,.sales-pricing-history{display:grid;gap:10px}.sales-pricing-row{width:100%;text-align:left;display:flex;justify-content:space-between;gap:12px;min-width:0;background:var(--surface,#fff)}.sales-pricing-row>span,.sales-pricing-history>div{display:flex;justify-content:space-between;gap:8px;min-width:0;flex-wrap:wrap}.sales-pricing-row.selected{outline:2px solid var(--primary,#2563eb)}.sales-pricing-detail{display:grid;gap:16px}.sales-pricing-detail>header{display:flex;justify-content:space-between;gap:12px}.sales-pricing-actions{display:flex;gap:8px}.sales-pricing-page button,.sales-pricing-page input,.sales-pricing-page select{min-height:44px}.sales-pricing-child h3{grid-column:1/-1;margin:0}@media(max-width:680px){.sales-pricing-workspace{grid-template-columns:1fr}.sales-pricing-editor,.sales-pricing-child{grid-template-columns:1fr}.sales-pricing-detail>header{align-items:flex-start;flex-direction:column}.sales-pricing-row{flex-direction:column}}`}</style>
  </main>;
}
