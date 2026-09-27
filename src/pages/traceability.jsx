import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { BusinessPageHeader, BusinessState, InlineAlert } from '../components/design-system.jsx';

const stateLabel = { AVAILABLE: '可用', HOLD: '冻结', CONSUMED: '已领用', DELIVERED: '已交付', SCRAPPED: '已报废' };
const directionLabel = { IN: '入库', OUT: '出库' };

export default function Traceability({ notify }) {
  const [query, setQuery] = useState({ type: 'SERIAL', id: '', direction: 'BACKWARD' });
  const [identities, setIdentities] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const loadIdentities = async (type = query.type, search = '') => {
    try { const response = await api(`/api/tracking/identities?type=${type}&search=${encodeURIComponent(search)}`); setIdentities(response.identities || []); }
    catch (error) { notify(error.message, 'error'); }
  };
  useEffect(() => { void loadIdentities(query.type); }, [query.type]);
  async function search(event, identityCode = query.id) {
    event?.preventDefault(); setLoading(true);
    try { setResult(await api(`/api/traceability?type=${query.type}&code=${encodeURIComponent(identityCode)}&direction=${query.direction}`)); setQuery((current) => ({ ...current, id: identityCode })); }
    catch (error) { notify(error.message, 'error'); }
    finally { setLoading(false); }
  }
  return <section className="panel traceability-page">
    <BusinessPageHeader title="批次 / 序列号追溯" context="只展示已存在的身份、来源单据、库存移动与生产谱系证据。"/>
    <form className="toolbar traceability-search" onSubmit={search}>
      <select aria-label="身份类型" value={query.type} onChange={(event) => { setQuery({ ...query, type: event.target.value, id: '' }); setResult(null); }}><option value="LOT">批次</option><option value="SERIAL">序列号</option></select>
      <input aria-label="身份标识" value={query.id} onChange={(event) => setQuery({ ...query, id: event.target.value })} placeholder="输入批次号或序列号" required/>
      <select aria-label="追溯方向" value={query.direction} onChange={(event) => setQuery({ ...query, direction: event.target.value })}><option value="BACKWARD">向后追溯</option><option value="FORWARD">向前追溯</option></select>
      <button className="primary" type="submit">开始追溯</button>
    </form>
    <div className="trace-identity-list">{identities.map((identity) => <button type="button" className="inventory-record" key={identity.id} onClick={() => void search(null, identity.identityCode)}><span className="inventory-record__main"><strong>{identity.identityCode}</strong><span>{identity.productCode} · {identity.productName}</span></span><strong>{identity.currentQuantity}</strong><span>{identity.warehouseCodes || '无当前仓库'} · {stateLabel[identity.status] || identity.status}</span></button>)}{!identities.length && <BusinessState kind="EMPTY" title={`暂无${query.type === 'LOT' ? '批次' : '序列号'}身份`} description="跟踪身份会在受支持的入库或生产流程确认后出现。"/>}</div>
    {loading && <BusinessState kind="LOADING" title="正在加载追溯证据"/>}
    {result && !loading && <div className="trace-chain">
      <article className="mobile-card"><small>物理身份</small><h3>{result.identity.lot_code || result.identity.serial_number}</h3><p>{result.identity.productCode} · {result.identity.productName}</p><p>{stateLabel[result.identity.status || result.identity.lifecycle_state] || result.identity.status || result.identity.lifecycle_state}</p><p>当前仓库：{result.identity.currentWarehouseCode ? `${result.identity.currentWarehouseCode} · ${result.identity.currentWarehouseName}` : (query.type === 'LOT' ? '按批次仓库余额查看' : '已离开库存')}</p>{query.type === 'LOT' && <p>当前数量：{result.identity.currentQuantity}</p>}<span className="tracking-badge">{result.provenance?.label}</span></article>
      {result.legacyNotice && <InlineAlert tone="warning" title="历史数据 / 来源信息不完整">系统保留已证明的身份和移动，不会根据货品、数量或日期猜测上下游关系。</InlineAlert>}
      <article className="mobile-card"><h3>来源与库存移动</h3>{result.movements.length ? result.movements.map((movement) => <div className="mobile-card__row" key={movement.id}><span><b>{movement.sourceDocumentNo || '历史来源不完整'}</b><small className="block">{movement.sourceDocumentLabel} · {movement.business_date || '业务日期缺失'} · {movement.warehouseCode || '仓库信息缺失'}</small></span><strong>{directionLabel[movement.direction] || movement.direction} {movement.quantity}</strong></div>) : <p>历史数据 / 来源信息不完整</p>}</article>
      <article className="mobile-card"><h3>生产谱系</h3>{result.genealogy.length ? result.genealogy.map((edge) => <div className="mobile-card__row" key={edge.id}><span>生产工单 {edge.productionOrderNo || '单号缺失'}<small className="block">{edge.inputIdentityCode || '上游身份缺失'} → {edge.outputIdentityCode || '下游身份缺失'}</small></span><strong>{edge.allocated_quantity}</strong></div>) : <p>没有权威谱系分配；系统不会生成推测关系。</p>}</article>
      <article className="mobile-card"><h3>下游影响</h3>{result.downstream.length ? result.downstream.map((movement) => <div className="mobile-card__row" key={movement.id}><span>{movement.sourceDocumentNo || '来源信息不完整'}<small className="block">{movement.customerCode ? `${movement.customerCode} · ${movement.customerName}` : movement.sourceDocumentLabel}</small></span><strong>{directionLabel[movement.direction] || movement.direction} {movement.quantity}</strong></div>) : <p>暂无可证明的下游交付或库存移动。</p>}</article>
    </div>}
  </section>;
}
