import { useState } from 'react';
import { api } from '../api.js';

const stateLabel = { AVAILABLE: '可用', HOLD: '冻结', CONSUMED: '已领用', DELIVERED: '已交付', SCRAPPED: '已报废' };

export default function Traceability({ notify }) {
  const [query, setQuery] = useState({ type: 'SERIAL', id: '', direction: 'BACKWARD' });
  const [result, setResult] = useState(null);
  async function search(e) {
    e.preventDefault();
    try { setResult(await api(`/api/traceability?type=${query.type}&code=${encodeURIComponent(query.id)}&direction=${query.direction}`)); }
    catch (error) { notify(error.message, 'error'); }
  }
  return <section className="panel traceability-page">
    <header className="panel-head"><div><h2>批次 / 序列号追溯</h2><p>从权威物理身份查看来源、质量、移动、生产谱系与客户交付。</p></div></header>
    <form className="toolbar traceability-search" onSubmit={search}>
      <select aria-label="身份类型" value={query.type} onChange={(e) => setQuery({ ...query, type: e.target.value })}><option value="LOT">批次</option><option value="SERIAL">序列号</option></select>
      <input aria-label="身份标识" value={query.id} onChange={(e) => setQuery({ ...query, id: e.target.value })} placeholder="输入批次号或序列号" required/>
      <select aria-label="追溯方向" value={query.direction} onChange={(e) => setQuery({ ...query, direction: e.target.value })}><option value="BACKWARD">向后追溯</option><option value="FORWARD">向前追溯</option></select>
      <button className="primary" type="submit">开始追溯</button>
    </form>
    {result && <div className="trace-chain">
      <article className="mobile-card"><small>物理身份</small><h3>{result.identity.lot_code || result.identity.serial_number}</h3><p>{stateLabel[result.identity.status || result.identity.lifecycle_state] || result.identity.status || result.identity.lifecycle_state}</p><p>当前位置：{result.identity.current_warehouse_id || '按批次库存明细查看'}</p></article>
      {result.legacyNotice && <article className="mobile-card"><strong>{result.legacyNotice}</strong><p>系统不会为未启用跟踪的历史业务推断虚假身份或谱系。</p></article>}
      <article className="mobile-card"><h3>库存移动</h3>{result.movements.map((x) => <div className="mobile-card__row" key={x.id}><span>{x.source_type}</span><strong>{x.direction} {x.quantity}</strong></div>)}</article>
      <article className="mobile-card"><h3>生产谱系</h3>{result.genealogy.length ? result.genealogy.map((x) => <div className="mobile-card__row" key={x.id}><span>生产工单 {x.production_order_id}</span><strong>{x.allocated_quantity}</strong></div>) : <p>没有权威谱系分配</p>}</article>
      <article className="mobile-card"><h3>下游交付</h3>{result.downstream.length ? result.downstream.map((x) => <div className="mobile-card__row" key={x.id}><span>{x.delivery_no || x.source_type}</span><strong>{x.customer_name || '在库/生产中'}</strong></div>) : <p>暂无客户交付影响</p>}</article>
    </div>}
  </section>;
}
