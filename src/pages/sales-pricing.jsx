import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatMicros, formatMoney } from '../lib/format.js';
import { yuanToNonNegativeCents } from '../lib/money.js';

const can = (user, permission) => Boolean(user?.permissions?.includes(permission));
const today = () => new Date().toISOString().slice(0, 10);
const emptyHeader = () => ({ code: '', name: '', currencyCode: 'CNY', effectiveFrom: today() });
const emptyEntry = () => ({ materialId: '', customerId: '', pricingUomCode: '', qtyBreakMin: '0', effectiveFrom: today(), unitPriceYuan: '' });
const emptyRule = () => ({ ruleKey: '', lineScope: 'LINE', applicationMode: 'AUTOMATIC', discountKind: 'PERCENT', discountBps: '', discountAmountYuan: '', effectiveFrom: today() });

export default function SalesPricing({ user, notify }) {
  const [tab, setTab] = useState('prices');
  const [rows, setRows] = useState({ prices: [], discounts: [] });
  const [selected, setSelected] = useState(null);
  const [header, setHeader] = useState(emptyHeader);
  const [entry, setEntry] = useState(emptyEntry);
  const [rule, setRule] = useState(emptyRule);
  const [references, setReferences] = useState({ products: [], customers: [] });
  const [referenceMessage, setReferenceMessage] = useState('');
  const manageable = can(user, 'SALES_PRICING_MANAGE');
  const canReadProducts = can(user, 'PRODUCTS_VIEW') || can(user, 'PRODUCTS_MANAGE');
  const canReadCustomers = can(user, 'CUSTOMERS_VIEW') || can(user, 'CUSTOMERS_MANAGE');

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
  useEffect(() => {
    void load();
    const requests = [
      canReadProducts ? api('/api/products') : Promise.resolve({ products: [] }),
      canReadCustomers ? api('/api/customers') : Promise.resolve({ customers: [] }),
    ];
    Promise.all(requests).then(([products, customers]) => {
      setReferences({ products: products.products || [], customers: customers.customers || [] });
      if (!canReadProducts) setReferenceMessage('当前账号没有查看货品资料的权限，不能新增价格条目。');
      else if (!canReadCustomers) setReferenceMessage('当前账号没有查看客户资料的权限，只能维护适用于全部客户的价格。');
    }).catch((error) => setReferenceMessage(error.message || '业务参照加载失败'));
  }, []);

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
        const unitPriceCents = yuanToNonNegativeCents(entry.unitPriceYuan);
        const qtyBreakMinMicros = Math.round(Number(entry.qtyBreakMin || 0) * 1_000_000);
        if (unitPriceCents === null || !Number.isSafeInteger(qtyBreakMinMicros) || qtyBreakMinMicros < 0) {
          notify('请填写有效的起始数量和最多两位小数的单价', 'error');
          return;
        }
        await api(`/api/sales-price-lists/${selected.id}/entries`, { method: 'POST', body: {
          materialId: entry.materialId, customerId: entry.customerId || null, customerScopeType: entry.customerId ? 'CUSTOMER' : 'ALL',
          pricingUomCode: entry.pricingUomCode, qtyBreakMinMicros, qtyBreakMaxMicros: null,
          effectiveFrom: entry.effectiveFrom, unitPriceCents,
        } });
        setEntry(emptyEntry());
      } else {
        const discountAmountCents = rule.discountKind === 'AMOUNT' ? yuanToNonNegativeCents(rule.discountAmountYuan) : undefined;
        if (rule.discountKind === 'AMOUNT' && discountAmountCents === null) {
          notify('折扣金额必须是最多两位小数的非负金额', 'error');
          return;
        }
        await api(`/api/sales-discount-schemes/${selected.id}/rules`, { method: 'POST', body: {
          ruleKey: rule.ruleKey, lineScope: rule.lineScope, applicationMode: rule.applicationMode, discountKind: rule.discountKind,
          discountBps: rule.discountKind === 'PERCENT' ? Number(rule.discountBps) : undefined,
          discountAmountCents,
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
        <div className="sales-pricing-history">{tab === 'prices' ? <><b>价格条目 {selected.entries?.length || 0}</b><span>不可变版本 {selected.versions?.length || 0}</span>{selected.entries?.map((item) => { const product = references.products.find((row) => row.id === item.material_id); return <div key={item.id}><code>{product ? `${product.code} · ${product.name}` : '货品资料不可见'}</code><span>{item.pricing_uom_code} · {formatMicros(item.qty_break_min_micros)} 起 · {formatMoney(item.unit_price_cents)}</span></div>; })}</> : <><b>规则版本 {selected.rules?.length || 0}</b>{selected.rules?.map((item) => <div key={item.id}><code>{item.rule_key} v{item.rule_version}</code><span>{item.line_scope} · {item.application_mode}</span></div>)}</>}</div>
        {referenceMessage && <p className="muted">{referenceMessage}</p>}
        {manageable && selected.status === 'DRAFT' && (tab === 'prices' ? <form className="form-grid sales-pricing-child" onSubmit={addChild}><h3>新增价格条目</h3><label>货品<select required disabled={!canReadProducts} value={entry.materialId} onChange={(event) => { const product = references.products.find((row) => row.id === event.target.value); setEntry({ ...entry, materialId: event.target.value, pricingUomCode: product?.baseUomCode || product?.base_uom_code || entry.pricingUomCode }); }}><option value="">请选择货品</option>{references.products.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label><label>适用客户（可选）<select disabled={!canReadCustomers} value={entry.customerId} onChange={(event) => setEntry({ ...entry, customerId: event.target.value })}><option value="">全部客户</option>{references.customers.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label><label>计价单位<input required value={entry.pricingUomCode} onChange={(event) => setEntry({ ...entry, pricingUomCode: event.target.value })}/></label><label>起始数量<input type="number" min="0" step="0.000001" required value={entry.qtyBreakMin} onChange={(event) => setEntry({ ...entry, qtyBreakMin: event.target.value })}/></label><label>单价（元）<input type="number" min="0" step="0.01" inputMode="decimal" required value={entry.unitPriceYuan} onChange={(event) => setEntry({ ...entry, unitPriceYuan: event.target.value })}/></label><label>生效日期<input type="date" required value={entry.effectiveFrom} onChange={(event) => setEntry({ ...entry, effectiveFrom: event.target.value })}/></label><button className="primary" type="submit" disabled={!canReadProducts}>追加条目与版本</button></form> : <form className="form-grid sales-pricing-child" onSubmit={addChild}><h3>新增折扣规则</h3><label>规则键<input required value={rule.ruleKey} onChange={(event) => setRule({ ...rule, ruleKey: event.target.value })}/></label><label>范围<select value={rule.lineScope} onChange={(event) => setRule({ ...rule, lineScope: event.target.value })}><option value="LINE">行</option><option value="HEADER">表头</option></select></label><label>应用方式<select value={rule.applicationMode} onChange={(event) => setRule({ ...rule, applicationMode: event.target.value })}><option value="AUTOMATIC">自动</option><option value="MANUAL">手工</option></select></label><label>折扣类型<select value={rule.discountKind} onChange={(event) => setRule({ ...rule, discountKind: event.target.value })}><option value="PERCENT">基点</option><option value="AMOUNT">固定金额</option></select></label><label>{rule.discountKind === 'PERCENT' ? '折扣基点' : '折扣金额（元）'}<input type="number" min="0" step={rule.discountKind === 'PERCENT' ? '1' : '0.01'} inputMode={rule.discountKind === 'PERCENT' ? 'numeric' : 'decimal'} required value={rule.discountKind === 'PERCENT' ? rule.discountBps : rule.discountAmountYuan} onChange={(event) => setRule({ ...rule, [rule.discountKind === 'PERCENT' ? 'discountBps' : 'discountAmountYuan']: event.target.value })}/></label><label>生效日期<input type="date" required value={rule.effectiveFrom} onChange={(event) => setRule({ ...rule, effectiveFrom: event.target.value })}/></label><button className="primary" type="submit">追加规则版本</button></form>)}</section>}
    </div>
    <style>{`.sales-pricing-page{max-width:1080px;margin:0 auto;padding:clamp(16px,3vw,32px);display:grid;gap:18px;overflow-x:hidden}.sales-pricing-editor,.sales-pricing-child{padding:16px;border:1px solid var(--border,#dbe2ea);border-radius:12px}.sales-pricing-workspace{display:grid;grid-template-columns:minmax(240px,.8fr) minmax(0,1.4fr);gap:14px;align-items:start}.sales-pricing-list,.sales-pricing-history{display:grid;gap:10px}.sales-pricing-row{width:100%;text-align:left;display:flex;justify-content:space-between;gap:12px;min-width:0;background:var(--surface,#fff)}.sales-pricing-row>span,.sales-pricing-history>div{display:flex;justify-content:space-between;gap:8px;min-width:0;flex-wrap:wrap}.sales-pricing-row.selected{outline:2px solid var(--primary,#2563eb)}.sales-pricing-detail{display:grid;gap:16px}.sales-pricing-detail>header{display:flex;justify-content:space-between;gap:12px}.sales-pricing-actions{display:flex;gap:8px}.sales-pricing-page button,.sales-pricing-page input,.sales-pricing-page select{min-height:44px}.sales-pricing-child h3{grid-column:1/-1;margin:0}@media(max-width:680px){.sales-pricing-workspace{grid-template-columns:1fr}.sales-pricing-editor,.sales-pricing-child{grid-template-columns:1fr}.sales-pricing-detail>header{align-items:flex-start;flex-direction:column}.sales-pricing-row{flex-direction:column}}`}</style>
  </main>;
}
