// V17 Master & Engineering Domain Closure — Engineering Change Order.
//
// Mobile-first workbench for:
//   - ECO DRAFT → PENDING → APPROVED → APPLIED lifecycle
//   - Impact preview (no mutation) before apply
//   - Atomic apply (transaction + audit, no historical snapshot pollution)
//
// Backend contracts:
//   - GET    /api/engineering/changes
//   - POST   /api/engineering/changes
//   - GET    /api/engineering/changes/:id
//   - POST   /api/engineering/changes/:id/submit
//   - POST   /api/engineering/changes/:id/approve
//   - POST   /api/engineering/changes/:id/reject
//   - POST   /api/engineering/changes/:id/impact-preview
//   - POST   /api/engineering/changes/:id/apply
//   - POST   /api/engineering/changes/:id/cleanup
//
// Implementation discipline (per erp-mobile-taste):
//   - LIST → DETAIL → EDITOR/WORKFLOW.
//   - State machine shown clearly; actions gated by permission + state.
//   - Impact preview is not destructive; explicit Apply button required.
//   - Use-Up-Old cleanup acknowledges current inventory only — full
//     expected inbound supply is deferred (CROSS_DOMAIN_DEPENDENCY).

import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, ConfirmAction, Empty, FormActions, Modal } from '../components/ui.jsx';
import {
  BusinessAction, BusinessActionBar, BusinessPageHeader, BusinessPageShell,
  CompactRecordList, HelpDisclosure, RecordCard,
} from '../components/design-system.jsx';

const ECO_STATUS_LABELS = {
  DRAFT: '草稿', PENDING: '待审核', APPROVED: '已审核', REJECTED: '已驳回',
  WITHDRAWN: '已撤回', APPLIED: '已应用', CANCELLED: '已取消',
};
const CHANGE_TYPE_LABELS = {
  IMMEDIATE: '立即变更', EFFECTIVE_DATE: '按日期生效', USE_UP_OLD: '用完旧料',
};
const OP_LABELS = {
  ADD_COMPONENT: '新增子项', MODIFY_COMPONENT: '修改子项',
  DELETE_COMPONENT: '删除子项', INVALIDATE_COMPONENT: '失效子项',
  MODIFY_HEADER: '修改 BOM 头',
};
const ALLOWED_OPS_BY_TYPE = {
  IMMEDIATE: new Set(['ADD_COMPONENT', 'MODIFY_COMPONENT', 'DELETE_COMPONENT', 'INVALIDATE_COMPONENT', 'MODIFY_HEADER']),
  EFFECTIVE_DATE: new Set(['ADD_COMPONENT', 'MODIFY_COMPONENT', 'INVALIDATE_COMPONENT', 'MODIFY_HEADER']),
  USE_UP_OLD: new Set(['MODIFY_COMPONENT', 'MODIFY_HEADER']),
};

function useCollection(endpoint, deps = []) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    api(endpoint).then((res) => { setItems(res.changes || res.items || res.substitutes || res.boms || []); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, deps);
  return { items, setItems, loading, reload: load };
}

function EcoList({ ecos: list, canManage, onSelect, onCreate }) {
  return <CompactRecordList>
    {list.map((eco) => (
      <RecordCard key={eco.id} title={`${eco.doc_no} · ${eco.title}`}
        subtitle={`目标 BOM ${eco.target_bom_product_code || '—'} · ${CHANGE_TYPE_LABELS[eco.change_type] || eco.change_type}`}
        status={<span className="status-chip">{ECO_STATUS_LABELS[eco.status] || eco.status}</span>}
        facts={eco.effective_date ? [{ label: '生效日期', value: eco.effective_date }] : []}
        onClick={() => onSelect(eco)} />
    ))}
    {!list.length && <Empty text="暂无工程变更单" />}
    {canManage && <button className="secondary" onClick={onCreate}>新建变更单</button>}
  </CompactRecordList>;
}

function EcoEditor({ editor, onClose, notify, refresh }) {
  const isEdit = Boolean(editor.id);
  const [body, setBody] = useState(() => isEdit ? {
    docNo: editor.doc_no, title: editor.title, reason: editor.reason || '',
    changeType: editor.change_type, effectiveDate: editor.effective_date || '',
    versionUpgrade: editor.version_upgrade || 1, targetBomId: editor.target_bom_id,
    items: (editor.items || []).map((item) => ({
      opType: item.op_type, productId: item.product_id, quantity: item.quantity, scrapRate: item.scrap_rate,
      fromProductId: item.from_product_id, toProductId: item.to_product_id, notes: item.notes || '',
    })),
  } : { docNo: '', title: '', reason: '', changeType: 'IMMEDIATE', effectiveDate: '',
    versionUpgrade: 1, targetBomId: '', items: [] });
  const allowed = ALLOWED_OPS_BY_TYPE[body.changeType] || new Set();
  const [bomList, setBomList] = useState([]);
  useEffect(() => {
    api('/api/engineering/boms').then((res) => setBomList(res.boms || []))
      .catch(() => setBomList([]));
  }, []);
  const addItem = () => setBody({ items: [...body.items, { opType: 'MODIFY_COMPONENT', productId: '', quantity: 1, scrapRate: 0, fromProductId: '', toProductId: '', notes: '' }] });
  const updateItem = (idx, patch) => setBody({ items: body.items.map((item, i) => i === idx ? { ...item, ...patch } : item) });
  const removeItem = (idx) => setBody({ items: body.items.filter((_, i) => i !== idx) });

  const save = async () => {
    try {
      await api('/api/engineering/changes', { method: 'POST', body });
      notify('已保存');
      refresh?.();
      onClose();
    } catch (err) { notify(err.message, 'error'); }
  };

  return <Modal title={isEdit ? `查看变更单 ${editor.doc_no}` : '新建工程变更单'} onClose={onClose} wide>
    <form className="engineering-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label>单号<input value={body.docNo} onChange={(e) => setBody({ ...body, docNo: e.target.value })} required /></label>
      <label>标题<input value={body.title} onChange={(e) => setBody({ ...body, title: e.target.value })} required /></label>
      <label className="full">变更原因<textarea rows={2} value={body.reason} onChange={(e) => setBody({ ...body, reason: e.target.value })} /></label>
      <label>变更类型
        <select value={body.changeType} onChange={(e) => setBody({ ...body, changeType: e.target.value })}>
          {Object.entries(CHANGE_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      {body.changeType === 'EFFECTIVE_DATE' && (
        <label>生效日期<input type="date" value={body.effectiveDate} onChange={(e) => setBody({ ...body, effectiveDate: e.target.value })} required /></label>
      )}
      <label>版本升级量<input type="number" value={body.versionUpgrade} min={1} onChange={(e) => setBody({ ...body, versionUpgrade: Number(e.target.value) })} /></label>
      <label>目标 BOM
        <select value={body.targetBomId} onChange={(e) => setBody({ ...body, targetBomId: e.target.value })} required>
          <option value="">请选择</option>
          {bomList.map((b) => <option key={b.id} value={b.id}>{b.product_code} · {b.version} · {b.purpose}</option>)}
        </select>
      </label>
      <section className="engineering-eco-items">
        <header><strong>变更明细</strong><button type="button" className="secondary" onClick={addItem}>＋ 增行</button></header>
        {body.items.map((item, idx) => (
          <article key={idx} className="engineering-eco-item">
            <div className="engineering-eco-item-grid">
              <label>操作
                <select value={item.opType} onChange={(e) => updateItem(idx, { opType: e.target.value })}>
                  {Object.entries(OP_LABELS).filter(([key]) => allowed.has(key)).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </label>
              <label>产品 ID<input value={item.productId} onChange={(e) => updateItem(idx, { productId: e.target.value })} /></label>
              <label>数量<input type="number" value={item.quantity || ''} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })} /></label>
              <label>损耗率<input type="number" step="0.01" value={item.scrapRate || ''} onChange={(e) => updateItem(idx, { scrapRate: Number(e.target.value) })} /></label>
              <label>从<input value={item.fromProductId} onChange={(e) => updateItem(idx, { fromProductId: e.target.value })} /></label>
              <label>到<input value={item.toProductId} onChange={(e) => updateItem(idx, { toProductId: e.target.value })} /></label>
              <button type="button" className="danger-text" onClick={() => removeItem(idx)}>移除</button>
            </div>
          </article>
        ))}
      </section>
      <FormActions onClose={onClose} />
    </form>
  </Modal>;
}

function EcoActions({ eco, refresh, notify, canManage, canApprove, previewReady }) {
  const [pending, setPending] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const call = async (action, body) => {
    try {
      setPending(action);
      await api(`/api/engineering/changes/${eco.id}/${action}`, { method: 'POST', ...(body ? { body } : {}) });
      notify('已完成');
      await refresh?.();
    } catch (err) { notify(err.message, 'error'); }
    finally { setPending(null); }
  };
  return <BusinessActionBar>
    {eco.status === 'DRAFT' && canManage && <button className="secondary" disabled={pending === 'submit'} onClick={() => call('submit')}>提交审核</button>}
    {eco.status === 'PENDING' && canApprove && <>
      <button className="primary" disabled={pending === 'approve' || !canApprove} onClick={() => call('approve')}>审核通过</button>
      <label className="eco-reject-reason">驳回原因<input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} /></label>
      <button className="danger-text" disabled={pending === 'reject' || !rejectReason.trim()} onClick={() => call('reject', { reason: rejectReason })}>驳回</button>
    </>}
    {eco.status === 'APPROVED' && canManage && previewReady && <ConfirmAction
      title="确认应用工程变更？"
      message="系统将按当前影响预览生成新 BOM 版本并保留旧版本与审计记录。"
      buttonLabel="Apply（确认应用）"
      confirmLabel="确认 Apply"
      onConfirm={() => call('apply')} />}
  </BusinessActionBar>;
}

function EcoDetail({ eco, onClose, refresh, notify, canManage, canApprove }) {
  const [detail, setDetail] = useState(eco);
  const [preview, setPreview] = useState(null);
  const load = () => api(`/api/engineering/changes/${eco.id}`).then((res) => setDetail(res.change));
  useEffect(() => { void load(); }, [eco.id]);
  const runPreview = async () => {
    try {
      const r = await api(`/api/engineering/changes/${eco.id}/impact-preview`, {});
      setPreview(r);
      notify('预览已生成（未应用）');
    } catch (err) { notify(err.message, 'error'); }
  };
  return <Modal title={`${eco.doc_no} · ${eco.title}`} onClose={onClose} wide>
    <dl className="record-card-meta">
      <div><dt>类型</dt><dd>{CHANGE_TYPE_LABELS[detail.change_type] || detail.change_type}</dd></div>
      <div><dt>状态</dt><dd>{ECO_STATUS_LABELS[detail.status] || detail.status}</dd></div>
      <div><dt>生效日期</dt><dd>{detail.effective_date || '—'}</dd></div>
      <div><dt>原因</dt><dd>{detail.reason || '—'}</dd></div>
      <div><dt>版本升级</dt><dd>{detail.version_upgrade}</dd></div>
    </dl>
    <h4>变更明细</h4>
    <CompactRecordList>
      {(detail.items || []).map((item) => (
        <Record key={item.id || item.line_no} title={`${OP_LABELS[item.op_type] || item.op_type} · ${item.product_id || ''}`}
          subtitle={item.notes || (item.from_product_id ? `${item.from_product_id} → ${item.to_product_id}` : '')}
          facts={[{ label: '数量', value: item.quantity || '—' }, { label: '损耗', value: item.scrap_rate || '—' }]} />
      ))}
    </CompactRecordList>
    <BusinessActionBar>
      <button className="secondary" onClick={onClose}>关闭</button>
      <button className="secondary" onClick={runPreview}>预览影响</button>
      <EcoActions eco={detail} canManage={canManage} canApprove={canApprove} previewReady={Boolean(preview)}
        refresh={async () => { await load(); await refresh?.(); }} notify={notify} />
    </BusinessActionBar>
    {preview && (
      <section className="engineering-eco-preview">
        <h4>影响预览（未应用）</h4>
        <p>受影响 BOM: {preview.affectedBoms?.length || 0}；差异条目: {preview.diff?.length || 0}。</p>
        {preview.diff && preview.diff.length > 0 && (
          <ul>{preview.diff.map((d, idx) => <li key={idx}>{d.op} {d.product_id ? `· ${d.product_id}` : ''} {d.summary || ''}</li>)}</ul>
        )}
      </section>
    )}
  </Modal>;
}

export default function EngineeringChange({ user, notify }) {
  const { items: ecos, reload } = useCollection('/api/engineering/changes');
  const canManage = can(user, 'ENGINEERING_CHANGE_MANAGE');
  const canApprove = can(user, 'ENGINEERING_CHANGE_APPROVE');
  const [editor, setEditor] = useState(null);
  const [detail, setDetail] = useState(null);
  return <BusinessPageShell className="engineering-change-v15" width="rail">
    <BusinessPageHeader title="工程变更"
      help={<HelpDisclosure summary="使用提示"><p>变更单经审核后才可应用；Use-Up-Old 仅基于当前库存做清理候选，预计入供应尚未纳入本阶段判断。</p></HelpDisclosure>} />
    <EcoList ecos={ecos} canManage={canManage}
      onSelect={(eco) => setDetail(eco)}
      onCreate={() => setEditor({})} />
    {editor && <EcoEditor editor={editor} onClose={() => setEditor(null)} notify={notify} refresh={reload} />}
    {detail && <EcoDetail eco={detail} onClose={() => setDetail(null)} refresh={reload} notify={notify}
      canManage={canManage} canApprove={canApprove} />}
  </BusinessPageShell>;
}
