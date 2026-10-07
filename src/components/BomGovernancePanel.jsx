// V17 Master & Engineering Domain Closure — Reusable BOM Lifecycle / Batch /
// Tree / Analysis surface component.
//
// Pure rendering component; lives in components/ so it can be embedded into
// the existing manufacturing.jsx Boms screen (Wave B-compatible) without
// blocking other modules. State and effects stay in the parent.

import { useState } from 'react';
import { api } from '../api.js';
import { ConfirmAction, Empty } from './ui.jsx';
import { BusinessAction, BusinessActionBar, CompactRecordList, RecordCard } from './design-system.jsx';

const APPROVAL_LABELS = {
  DRAFT: '草稿', PENDING: '待审核', APPROVED: '已审核', REJECTED: '已驳回', WITHDRAWN: '已撤回',
};
const PURPOSE_LABELS = { GENERAL: '通用', SELF_MAKE: '自制', OUTSOURCE: '委外' };

export function BomLifecycleActions({ bom, onChanged, notify, canManage, canApprove }) {
  const [rejectReason, setRejectReason] = useState('');
  if (!bom) return null;
  const call = async (path, body) => {
    try {
      await api(`/api/engineering/boms/${bom.id}/${path}`, body ? { method: 'POST', body } : { method: 'POST' });
      notify('操作成功');
      onChanged?.();
    } catch (err) { notify(err.message, 'error'); }
  };
  return <BusinessActionBar>
    {bom.approval_status === 'DRAFT' && canManage && (
      <button className="secondary" onClick={() => call('submit')}>提交审核</button>
    )}
    {bom.approval_status === 'PENDING' && canApprove && (
      <>
        <button className="primary" onClick={() => call('approve')}>审核通过</button>
        <label className="bom-reject-reason">驳回原因<input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} /></label>
        <button className="danger-text" disabled={!rejectReason.trim()} onClick={() => call('reject', { reason: rejectReason })}>驳回</button>
      </>
    )}
    {bom.status === 'ACTIVE' && bom.approval_status === 'APPROVED' && canManage && (
      <button className="danger-text" onClick={() => call('deactivate')}>停用</button>
    )}
  </BusinessActionBar>;
}

export function BomTree({ bomId, notify }) {
  const [levels, setLevels] = useState(3);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [root, setRoot] = useState(null);
  const load = () => {
    if (!bomId) return;
    setLoading(true);
    api(`/api/engineering/boms/tree?bom_id=${bomId}&levels=${levels}`)
      .then((res) => { setRoot(res.root); setNodes(res.nodes || []); setLoading(false); })
      .catch((err) => { notify(err.message, 'error'); setLoading(false); });
  };
  return <section className="bom-tree">
    <header>
      <strong>BOM 多层结构</strong>
      <select aria-label="展开层数" value={levels} onChange={(e) => { setLevels(Number(e.target.value)); }}>
        {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>展开 {n} 层</option>)}
      </select>
      <BusinessAction hierarchy="secondary" onClick={load}>展开</BusinessAction>
    </header>
    {root && <p className="bom-tree-root">根：{root.product_code}</p>}
    {nodes.length > 0 && <BomTreeList nodes={nodes} />}
    {loading && <p>展开中…</p>}
    {!root && !loading && <Empty text="点击展开查看多层结构" />}
  </section>;
}

function BomTreeList({ nodes }) {
  // Group by depth.
  const byDepth = nodes.reduce((acc, n) => {
    (acc[n.depth] = acc[n.depth] || []).push(n);
    return acc;
  }, {});
  return <div className="bom-tree-depths">
    {Object.keys(byDepth).sort((a, b) => Number(a) - Number(b)).map((depth) => (
      <section key={depth}>
        <header><span>层级 {Number(depth) + 1}</span></header>
        <CompactRecordList>
          {byDepth[depth].map((n) => (
            <RecordCard key={`${n.bom_id}-${n.line_no}-${n.product_id}`}
              title={`${n.product_code || n.product_id} · ${n.product_name || ''}`}
              subtitle={`用量 ${n.quantity}${n.scrap_rate ? ` · 损耗 ${n.scrap_rate}` : ''}`}
              status={<span className="status-chip">{n.child_status || '—'}</span>}
              facts={[
                { label: '子 BOM', value: n.child_bom_id ? `${n.child_status} · ${n.child_approval || '—'}` : '—' },
                { label: '深度', value: n.depth },
              ]} />
          ))}
        </CompactRecordList>
      </section>
    ))}
  </div>;
}

export function BomAnalysisActions({ bomId, productId, boms = [], onResult, notify }) {
  const [compareId, setCompareId] = useState('');
  const call = async (path, query) => {
    try {
      const r = await api(`/api/engineering/${path}?${query}`);
      onResult(r);
      notify('已生成分析结果');
    } catch (err) { notify(err.message, 'error'); }
  };
  return <BusinessActionBar>
    <button className="secondary" onClick={() => call('boms/where-used', `product_id=${encodeURIComponent(productId)}`)}>反查</button>
    <button className="secondary" onClick={() => call('boms/consolidated', `bom_id=${encodeURIComponent(bomId)}`)}>汇总</button>
    <button className="secondary" onClick={() => call('boms/cost', `bom_id=${encodeURIComponent(bomId)}`)}>材料成本参考</button>
    <label className="bom-compare-select">对比版本
      <select value={compareId} onChange={(event) => setCompareId(event.target.value)}>
        <option value="">请选择</option>
        {boms.filter((candidate) => candidate.id !== bomId).map((candidate) => (
          <option key={candidate.id} value={candidate.id}>{candidate.product_code} · {candidate.version}</option>
        ))}
      </select>
    </label>
    <button className="secondary" disabled={!compareId}
      onClick={() => call('boms/compare', `left=${encodeURIComponent(bomId)}&right=${encodeURIComponent(compareId)}`)}>对比</button>
  </BusinessActionBar>;
}

export function BomBatchMaintenance({ boms, onChanged, notify, canManage }) {
  const [filter, setFilter] = useState({ productIds: [] });
  const [changes, setChanges] = useState([]);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  const addChange = (type) => setChanges([...changes, { type, ...(type === 'modify' ? { componentProductId: '', quantity: 1, scrapRate: 0 } : type === 'add' ? { componentProductId: '', quantity: 1, scrapRate: 0 } : type === 'remove' ? { componentProductId: '' } : { fromProductId: '', toProductId: '' }) }]);
  const updateChange = (idx, patch) => setChanges(changes.map((c, i) => i === idx ? { ...c, ...patch } : c));
  const removeChange = (idx) => setChanges(changes.filter((_, i) => i !== idx));

  const runPreview = async () => {
    try {
      const r = await api('/api/engineering/boms/batch-preview', { method: 'POST', body: { filter, changes } });
      setPreview(r);
      setError(null);
    } catch (err) { setError(err.message); }
  };
  const runApply = async () => {
    try {
      const r = await api('/api/engineering/boms/batch-apply', { method: 'POST', body: { filter, changes } });
      notify(`已应用：${r.appliedCount} 个 BOM`);
      setPreview(null);
      setChanges([]);
      onChanged?.();
    } catch (err) { notify(err.message, 'error'); }
  };

  return <section className="bom-batch">
    <header><strong>批量维护（Preview → Apply）</strong></header>
    <p className="business-action__help">选择修改类型与目标 → 生成预览 → 明确 Apply 才落库。</p>
    <fieldset className="bom-batch-targets">
      <legend>目标 BOM</legend>
      {boms.map((bom) => (
        <label key={bom.id}>
          <input type="checkbox" checked={filter.productIds.includes(bom.product_id)}
            onChange={(event) => setFilter((current) => ({
              ...current,
              productIds: event.target.checked
                ? [...new Set([...current.productIds, bom.product_id])]
                : current.productIds.filter((id) => id !== bom.product_id),
            }))} />
          <span>{bom.product_code} · {bom.version} · {bom.purpose || 'GENERAL'}</span>
        </label>
      ))}
    </fieldset>
    <BusinessActionBar>
      <button type="button" className="secondary" onClick={() => addChange('add')}>＋ 新增</button>
      <button type="button" className="secondary" onClick={() => addChange('modify')}>✎ 修改</button>
      <button type="button" className="secondary" onClick={() => addChange('remove')}>－ 删除</button>
      <button type="button" className="secondary" onClick={() => addChange('replace')}>⇄ 替换</button>
    </BusinessActionBar>
    {changes.map((c, idx) => (
      <article key={idx} className="bom-batch-change">
        <header>
          <strong>{c.type}</strong>
          <button type="button" className="danger-text" onClick={() => removeChange(idx)}>移除</button>
        </header>
        {c.type === 'replace' ? (
          <div className="bom-batch-row">
            <label>从<input value={c.fromProductId} onChange={(e) => updateChange(idx, { fromProductId: e.target.value })} /></label>
            <label>到<input value={c.toProductId} onChange={(e) => updateChange(idx, { toProductId: e.target.value })} /></label>
          </div>
        ) : (
          <div className="bom-batch-row">
            <label>物料 ID<input value={c.componentProductId} onChange={(e) => updateChange(idx, { componentProductId: e.target.value })} /></label>
            <label>用量<input type="number" value={c.quantity ?? ''} onChange={(e) => updateChange(idx, { quantity: Number(e.target.value) })} /></label>
            <label>损耗率<input type="number" step="0.01" value={c.scrapRate ?? ''} onChange={(e) => updateChange(idx, { scrapRate: Number(e.target.value) })} /></label>
          </div>
        )}
      </article>
    ))}
    <BusinessActionBar>
      <button type="button" className="secondary" disabled={!changes.length || !filter.productIds.length} onClick={runPreview}>Preview</button>
      {preview && canManage && <ConfirmAction
        title="确认应用 BOM 批量维护？"
        message={`将按当前预览修改 ${preview.previewCount || 0} 个 BOM。此操作会写入工程变更审计。`}
        buttonLabel="Apply（确认应用）"
        confirmLabel="确认 Apply"
        onConfirm={runApply} />}
    </BusinessActionBar>
    {error && <p className="engineering-form-result engineering-form-result--fail">{error}</p>}
    {preview && (
      <section className="bom-batch-preview">
        <header><strong>预览（未应用）</strong><span>受影响 BOM：{preview.previewCount}</span></header>
        <CompactRecordList>
          {(preview.targets || []).map((target) => (
            <RecordCard key={target.bom_id} title={`${target.product_id} · ${target.version} · ${target.purpose || ''}`}
              subtitle={`${(target.item_diff || []).length} 条差异`}
              facts={(target.item_diff || []).slice(0, 4).map((d, idx) => ({ label: `差异 ${idx + 1}`, value: `${d.type}${d.product_id || d.from_product_id ? ` · ${d.product_id || d.from_product_id}` : ''}` }))} />
          ))}
        </CompactRecordList>
      </section>
    )}
  </section>;
}

export function BomApprovalBadge({ bom }) {
  if (!bom) return null;
  const approval = APPROVAL_LABELS[bom.approval_status] || bom.approval_status;
  const purpose = PURPOSE_LABELS[bom.purpose] || bom.purpose;
  return <span className={`status-chip status-chip--${(bom.approval_status || 'unknown').toLowerCase()}`}>
    {approval} · {purpose}
  </span>;
}
