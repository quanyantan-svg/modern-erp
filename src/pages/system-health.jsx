import { useEffect, useState } from 'react';
import { api } from '../api.js';

const statusLabel = { PASS: '通过', WARNING: '警告', FAIL: '失败' };

export default function SystemHealth({ notify }) {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load(date = asOfDate) {
    setLoading(true);
    try { setResult(await api(`/api/system-health?asOfDate=${encodeURIComponent(date)}`)); }
    catch (error) { notify(error.message, 'error'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  return <section className="panel system-health-page">
    <header className="panel-head">
      <div><h2>系统健康与核对中心</h2><p>只读 CHECK 模式；不修改、不自动修复任何数据。</p></div>
      <div className="toolbar"><input aria-label="截止日期" type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)}/><button className="primary" type="button" onClick={() => load()} disabled={loading}>{loading ? '检查中…' : '重新检查'}</button></div>
    </header>
    {loading && !result ? <p>正在执行只读核对…</p> : result && <>
      <article className="mobile-card"><small>总体状态 · {result.asOfDate}</small><h3>{statusLabel[result.overallStatus] || result.overallStatus}</h3><p>自动修复：{result.autoRepair ? '已启用' : '禁用'} · 口径：已过账/权威子账</p></article>
      <div className="trace-chain">{result.checks.map((check) => <article className="mobile-card" key={check.code}>
        <div className="mobile-card__row"><strong>{check.code}</strong><span className={`badge ${check.status === 'PASS' ? 'success' : check.status === 'WARNING' ? 'warning' : 'danger'}`}>{statusLabel[check.status] || check.status}</span></div>
        <p>{check.explanation || '权威数据源核对'}</p><p>差额：{check.difference}</p>
        {check.affectedSourceRecords?.length > 0 && <details><summary>受影响来源（{check.affectedSourceRecords.length}）</summary><p>{check.affectedSourceRecords.join('、')}</p></details>}
      </article>)}</div>
    </>}
  </section>;
}
