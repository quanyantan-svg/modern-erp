// M12 — Production Instruction, Purchase Instruction, Purchase Requisition.
//
// Three related planning-document families that bridge the immutable
// M11 MRP snapshot to the existing execution documents. The pages
// share patterns (list + detail modal) so we keep them in one file.
// Each list honours role permissions via the can() helper; detail
// views render cross-document links (来源 MRP / 关联制令单 / 关联请购单 /
// 生成的采购订单) using the canonical AppLink navigation.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Badge, can, Empty, FormActions, Loading, Modal, Panel, Status, Toolbar } from '../components/ui.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';

const PI_STATUS_LABELS = { DRAFT: '草稿', RELEASED: '已下达', CANCELLED: '已取消' };
const PUI_STATUS_LABELS = { DRAFT: '草稿', RELEASED: '已下达', CANCELLED: '已取消' };
const PR_STATUS_LABELS = {
  DRAFT: '草稿', SUBMITTED: '待审批', APPROVED: '已审批', REJECTED: '已驳回', CANCELLED: '已取消',
};

const PI_STATUS_VARIANT = { DRAFT: 'draft', RELEASED: 'approved', CANCELLED: 'rejected' };
const PUI_STATUS_VARIANT = { DRAFT: 'draft', RELEASED: 'approved', CANCELLED: 'rejected' };
const PR_STATUS_VARIANT = { DRAFT: 'draft', SUBMITTED: 'pending', APPROVED: 'approved', REJECTED: 'rejected', CANCELLED: 'rejected' };

function fmtQty(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(n);
}

function fmtDate(value) {
  if (!value) return '—';
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '—';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function emptyCreateForm() {
  return { mrpRunId: '', plannedDate: todayIso(), notes: '', items: [] };
}

function emptyCreateItem() {
  return { mrpResultId: '', quantity: '', needByDate: '' };
}

// ============================================================
// Production Instruction
// ============================================================

export function ProductionInstructionsPage({ user, notify }) {
  const canManage = can(user, 'PRODUCTION_INSTRUCTION_MANAGE');
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState(null);
  const [creating, setCreating] = useState(null);
  const load = () => api(`/api/production-instructions?status=${encodeURIComponent(status)}`)
    .then((result) => setRows(result.instructions || []))
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  if (rows === null) return <Panel title="生产指令" subtitle="根据 MRP 生产建议下达生产指令，并可生成制令单">
    <Loading/>
  </Panel>;
  const filtered = rows.filter((row) => !search
    || (row.instructionNo || '').toLowerCase().includes(search.toLowerCase())
    || (row.productName || '').toLowerCase().includes(search.toLowerCase()));
  if (selection) {
    return <Panel title="生产指令" subtitle={`指令号 ${selection.instructionNo}`}
      action={<button className="secondary" onClick={() => setSelection(null)}>← 返回</button>}>
      <ProductionInstructionDetail instructionId={selection.id} notify={notify} onChanged={() => { void load(); }}/>
    </Panel>;
  }
  return <Panel title="生产指令" subtitle="根据 MRP 生产建议下达生产指令，并可生成制令单"
    action={canManage && <button className="primary" onClick={() => setCreating({ create: true })}>＋ 新建生产指令</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索指令号或 MRP"
      extra={<select aria-label="状态" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">全部状态</option>
        <option value="DRAFT">草稿</option>
        <option value="RELEASED">已下达</option>
        <option value="CANCELLED">已取消</option>
      </select>}
    />
    <div className="table-wrap"><table><thead><tr>
      <th>指令号</th><th>来源 MRP</th><th className="number">项目数</th>
      <th className="number">总数量</th><th>计划日期</th><th>状态</th><th>制令单状态</th>
    </tr></thead><tbody>
      {filtered.map((row) => <tr className="clickable" key={row.id} onClick={() => setSelection(row)}>
        <td className="mono strong-text">{row.instructionNo}</td>
        <td><AppLink page="mrp" documentId={row.mrpRunId}>{row.productName || row.mrpRunId?.slice(-6)}</AppLink></td>
        <td className="number">{row.itemCount}</td>
        <td className="number">{fmtQty(row.totalQuantity)}</td>
        <td>{fmtDate(row.plannedDate)}</td>
        <td><Status status={PI_STATUS_VARIANT[row.status] || 'draft'} label={PI_STATUS_LABELS[row.status] || row.status}/></td>
        <td>{row.convertedItemCount > 0
          ? <Badge type="success">已生成 {row.convertedItemCount} 条</Badge>
          : <span className="dim">未生成</span>}</td>
      </tr>)}
    </tbody></table>{!filtered.length && <Empty text="没有符合条件的生产指令"/>}</div>
    {creating && <ProductionInstructionCreate value={creating} onClose={() => setCreating(null)}
      onSaved={() => { setCreating(null); void load(); }} notify={notify}/>}
  </Panel>;
}

function ProductionInstructionCreate({ value, onClose, onSaved, notify }) {
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [run, setRun] = useState(null);
  const [items, setItems] = useState([emptyCreateItem()]);
  const [plannedDate, setPlannedDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/planning/mrp/runs?status=COMPLETED').then((res) => setRuns(res.runs || [])).catch(() => setRuns([]));
  }, []);

  useEffect(() => {
    if (!selectedRunId) { setRun(null); return; }
    api('/api/planning/mrp/runs/' + selectedRunId).then((res) => {
      const make = (res.run.results || []).filter((r) => r.suggestion_type === 'MAKE');
      setRun({ ...res.run, results: make });
      setItems(make.length ? make.map(() => emptyCreateItem()) : [emptyCreateItem()]);
    }).catch(() => setRun(null));
  }, [selectedRunId]);

  const makeRows = (run?.results || []).filter((r) => r.suggestion_type === 'MAKE');
  const save = async () => {
    if (!selectedRunId) { notify('请选择 MRP 计算', 'error'); return; }
    const body = {
      mrpRunId: selectedRunId,
      plannedDate,
      notes,
      items: items.filter((item) => item.mrpResultId && Number(item.quantity) > 0).map((item) => ({
        mrpResultId: item.mrpResultId,
        quantity: Number(item.quantity),
        needByDate: item.needByDate || null,
      })),
    };
    if (!body.items.length) { notify('请至少添加一条指令明细', 'error'); return; }
    setBusy(true);
    try {
      await api('/api/production-instructions', { method: 'POST', body });
      notify('生产指令已创建');
      onSaved();
    } catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  };

  return <Modal title="新建生产指令" onClose={onClose} wide>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="full">来源 MRP 计算<select value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)} required>
        <option value="">选择已完成的 MRP 计算</option>
        {runs.map((r) => <option key={r.id} value={r.id}>{r.run_code} - {r.run_name}</option>)}
      </select></label>
      <label>计划日期<input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)}/></label>
      <label className="full">备注<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={200}/></label>
      {makeRows.length > 0 && <div className="full">
        <div className="form-section-head"><span>指令明细（MAKE 建议）</span></div>
        <div className="forecast-items-editor">
          {items.map((item, index) => {
            const target = makeRows[index];
            return <article className="forecast-item-editor" key={index}>
              <div className="forecast-item-editor__fields">
                <label>建议产品<select value={item.mrpResultId} onChange={(event) => setItems((current) => current.map((it, i) => i === index ? { ...it, mrpResultId: event.target.value } : it))} required>
                  <option value="">选择 MAKE 建议</option>
                  {makeRows.map((row) => <option key={row.id} value={row.id}>{row.product_code} - {row.product_name}（建议 {fmtQty(row.suggested_quantity)}）</option>)}
                </select></label>
                <label>本次指令数量<input type="number" min="0.000001" step="0.000001" value={item.quantity} onChange={(event) => setItems((current) => current.map((it, i) => i === index ? { ...it, quantity: event.target.value } : it))} required/></label>
                <label>需求日期<input type="date" value={item.needByDate} onChange={(event) => setItems((current) => current.map((it, i) => i === index ? { ...it, needByDate: event.target.value } : it))}/></label>
                {target && <p className="dim small full">MRP 建议数量 {fmtQty(target.suggested_quantity)}，剩余可下达 {fmtQty(Math.max(0, Number(target.suggested_quantity)))}</p>}
              </div>
            </article>;
          })}
        </div>
      </div>}
      <FormActions onClose={onClose} saveText={busy ? '保存中…' : '保存草稿'}/>
    </form>
  </Modal>;
}

function ProductionInstructionDetail({ instructionId, notify, onChanged }) {
  const [data, setData] = useState(null);
  const load = () => api('/api/production-instructions/' + instructionId)
    .then((result) => setData(result.instruction))
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [instructionId]);
  if (!data) return <Loading/>;
  const act = async (action, body = {}) => {
    try {
      await api(`/api/production-instructions/${instructionId}/${action}`, { method: 'POST', body });
      notify('操作已执行');
      void load();
      onChanged && onChanged();
    } catch (error) { notify(error.message, 'error'); }
  };
  const generateForItem = async (item) => {
    try {
      await api(`/api/production-instructions/${instructionId}/generate-production-order`, { method: 'POST', body: { itemId: item.id } });
      notify('已生成制令单');
      void load();
      onChanged && onChanged();
    } catch (error) { notify(error.message, 'error'); }
  };
  return <div className="planning-documents-detail">
    <div className="form-grid">
      <label>指令号<span className="mono strong-text">{data.instruction_no}</span></label>
      <label>状态<span><Status status={PI_STATUS_VARIANT[data.status] || 'draft'} label={PI_STATUS_LABELS[data.status] || data.status}/></span></label>
      <label>来源 MRP<span><AppLink page="mrp" documentId={data.mrp_run_id}>{data.runCode}</AppLink></span></label>
      <label>计划日期<span>{fmtDate(data.planned_date)}</span></label>
      <label>制单人<span>{data.creatorName || '—'}</span></label>
      <label>下达人<span>{data.releaserName || '—'}</span></label>
      <label>下达时间<span>{data.released_at?.slice(0, 16).replace('T', ' ') || '—'}</span></label>
      <label className="full">备注<span>{data.notes || '—'}</span></label>
    </div>
    <h3>指令明细</h3>
    <div className="table-wrap"><table><thead><tr>
      <th>产品</th><th className="number">建议数量</th><th className="number">已下达</th><th className="number">本次指令</th>
      <th>需求日期</th><th>BOM</th><th>路线</th><th>制令单</th>
    </tr></thead><tbody>
      {(data.items || []).map((item) => <tr key={item.id}>
        <td><strong>{item.productName}</strong><small className="block mono dim">{item.productCode}</small></td>
        <td className="number">{fmtQty(item.mrpSuggestedQuantity)}</td>
        <td className="number">{fmtQty(item.convertedQuantity)}</td>
        <td className="number"><strong>{fmtQty(item.quantity)}</strong></td>
        <td>{fmtDate(item.need_by_date || item.mrpNeedByDate)}</td>
        <td>{item.bomVersion ? `${item.bomVersion}（${item.bomStatus}）` : ''}</td>
        <td>{item.routingCode || '—'}</td>
        <td>{item.productionOrderNo
          ? <AppLink page="production-orders" documentId={item.production_order_id}>{item.productionOrderNo}</AppLink>
          : data.status === 'RELEASED' && can({ permissions: ['PRODUCTION_INSTRUCTION_MANAGE'] }, 'PRODUCTION_INSTRUCTION_MANAGE')
            ? <button type="button" className="secondary small" onClick={() => generateForItem(item)}>生成制令单</button>
            : <span className="dim">未生成</span>}</td>
      </tr>)}
    </tbody></table></div>
    <div className="form-actions">
      {data.status === 'DRAFT' && <>
        <button type="button" className="primary" onClick={() => act('release')}>下达生产指令</button>
        <button type="button" className="danger-button" onClick={() => act('cancel')}>取消指令</button>
      </>}
      {data.status === 'RELEASED' && <button type="button" className="danger-button" onClick={() => act('cancel')}>取消指令</button>}
    </div>
  </div>;
}

// ============================================================
// Purchase Instruction
// ============================================================

export function PurchaseInstructionsPage({ user, notify }) {
  const canManage = can(user, 'PURCHASE_INSTRUCTION_MANAGE');
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState(null);
  const [creating, setCreating] = useState(null);
  const load = () => api(`/api/purchase-instructions?status=${encodeURIComponent(status)}`)
    .then((result) => setRows(result.instructions || []))
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  if (rows === null) return <Panel title="采购指令" subtitle="根据 MRP 采购建议下达采购指令，并可生成请购单">
    <Loading/>
  </Panel>;
  const filtered = rows.filter((row) => !search
    || (row.instructionNo || '').toLowerCase().includes(search.toLowerCase())
    || (row.runCode || '').toLowerCase().includes(search.toLowerCase()));
  if (selection) {
    return <Panel title="采购指令" subtitle={`指令号 ${selection.instructionNo}`}
      action={<button className="secondary" onClick={() => setSelection(null)}>← 返回</button>}>
      <PurchaseInstructionDetail instructionId={selection.id} notify={notify} onChanged={() => { void load(); }}/>
    </Panel>;
  }
  return <Panel title="采购指令" subtitle="根据 MRP 采购建议下达采购指令，并可生成请购单"
    action={canManage && <button className="primary" onClick={() => setCreating({ create: true })}>＋ 新建采购指令</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索指令号或 MRP"
      extra={<select aria-label="状态" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">全部状态</option>
        <option value="DRAFT">草稿</option>
        <option value="RELEASED">已下达</option>
        <option value="CANCELLED">已取消</option>
      </select>}
    />
    <div className="table-wrap"><table><thead><tr>
      <th>指令号</th><th>来源 MRP</th><th className="number">项目数</th>
      <th className="number">总数量</th><th>计划日期</th><th>状态</th><th>请购单</th>
    </tr></thead><tbody>
      {filtered.map((row) => <tr className="clickable" key={row.id} onClick={() => setSelection(row)}>
        <td className="mono strong-text">{row.instructionNo}</td>
        <td><AppLink page="mrp" documentId={row.mrpRunId}>{row.runCode}</AppLink></td>
        <td className="number">{row.itemCount}</td>
        <td className="number">{fmtQty(row.totalQuantity)}</td>
        <td>{fmtDate(row.plannedDate)}</td>
        <td><Status status={PUI_STATUS_VARIANT[row.status] || 'draft'} label={PUI_STATUS_LABELS[row.status] || row.status}/></td>
        <td>{row.convertedItemCount > 0
          ? <Badge type="success">已生成 {row.convertedItemCount} 条</Badge>
          : <span className="dim">未生成</span>}</td>
      </tr>)}
    </tbody></table>{!filtered.length && <Empty text="没有符合条件的采购指令"/>}</div>
    {creating && <PurchaseInstructionCreate value={creating} onClose={() => setCreating(null)}
      onSaved={() => { setCreating(null); void load(); }} notify={notify}/>}
  </Panel>;
}

function PurchaseInstructionCreate({ value, onClose, onSaved, notify }) {
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [run, setRun] = useState(null);
  const [items, setItems] = useState([emptyCreateItem()]);
  const [plannedDate, setPlannedDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/planning/mrp/runs?status=COMPLETED').then((res) => setRuns(res.runs || [])).catch(() => setRuns([]));
  }, []);

  useEffect(() => {
    if (!selectedRunId) { setRun(null); return; }
    api('/api/planning/mrp/runs/' + selectedRunId).then((res) => {
      const buy = (res.run.results || []).filter((r) => r.suggestion_type === 'BUY');
      setRun({ ...res.run, results: buy });
      setItems(buy.length ? buy.map(() => emptyCreateItem()) : [emptyCreateItem()]);
    }).catch(() => setRun(null));
  }, [selectedRunId]);

  const buyRows = (run?.results || []).filter((r) => r.suggestion_type === 'BUY');
  const save = async () => {
    if (!selectedRunId) { notify('请选择 MRP 计算', 'error'); return; }
    const body = {
      mrpRunId: selectedRunId,
      plannedDate,
      notes,
      items: items.filter((item) => item.mrpResultId && Number(item.quantity) > 0).map((item) => ({
        mrpResultId: item.mrpResultId,
        quantity: Number(item.quantity),
        needByDate: item.needByDate || null,
      })),
    };
    if (!body.items.length) { notify('请至少添加一条指令明细', 'error'); return; }
    setBusy(true);
    try {
      await api('/api/purchase-instructions', { method: 'POST', body });
      notify('采购指令已创建');
      onSaved();
    } catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  };

  return <Modal title="新建采购指令" onClose={onClose} wide>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="full">来源 MRP 计算<select value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)} required>
        <option value="">选择已完成的 MRP 计算</option>
        {runs.map((r) => <option key={r.id} value={r.id}>{r.run_code} - {r.run_name}</option>)}
      </select></label>
      <label>计划日期<input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)}/></label>
      <label className="full">备注<input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={200}/></label>
      {buyRows.length > 0 && <div className="full">
        <div className="form-section-head"><span>指令明细（BUY 建议）</span></div>
        <div className="forecast-items-editor">
          {items.map((item, index) => <article className="forecast-item-editor" key={index}>
            <div className="forecast-item-editor__fields">
              <label>建议产品<select value={item.mrpResultId} onChange={(event) => setItems((current) => current.map((it, i) => i === index ? { ...it, mrpResultId: event.target.value } : it))} required>
                <option value="">选择 BUY 建议</option>
                {buyRows.map((row) => <option key={row.id} value={row.id}>{row.product_code} - {row.product_name}（建议 {fmtQty(row.suggested_quantity)}）</option>)}
              </select></label>
              <label>本次指令数量<input type="number" min="0.000001" step="0.000001" value={item.quantity} onChange={(event) => setItems((current) => current.map((it, i) => i === index ? { ...it, quantity: event.target.value } : it))} required/></label>
              <label>需求日期<input type="date" value={item.needByDate} onChange={(event) => setItems((current) => current.map((it, i) => i === index ? { ...it, needByDate: event.target.value } : it))}/></label>
            </div>
          </article>)}
        </div>
      </div>}
      <FormActions onClose={onClose} saveText={busy ? '保存中…' : '保存草稿'}/>
    </form>
  </Modal>;
}

function PurchaseInstructionDetail({ instructionId, notify, onChanged }) {
  const [data, setData] = useState(null);
  const load = () => api('/api/purchase-instructions/' + instructionId)
    .then((result) => setData(result.instruction))
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [instructionId]);
  if (!data) return <Loading/>;
  const act = async (action) => {
    try {
      await api(`/api/purchase-instructions/${instructionId}/${action}`, { method: 'POST' });
      notify('操作已执行');
      void load();
      onChanged && onChanged();
    } catch (error) { notify(error.message, 'error'); }
  };
  const canManage = can({ permissions: ['PURCHASE_INSTRUCTION_MANAGE'] }, 'PURCHASE_INSTRUCTION_MANAGE');
  return <div className="planning-documents-detail">
    <div className="form-grid">
      <label>指令号<span className="mono strong-text">{data.instruction_no}</span></label>
      <label>状态<span><Status status={PUI_STATUS_VARIANT[data.status] || 'draft'} label={PUI_STATUS_LABELS[data.status] || data.status}/></span></label>
      <label>来源 MRP<span><AppLink page="mrp" documentId={data.mrp_run_id}>{data.runCode}</AppLink></span></label>
      <label>计划日期<span>{fmtDate(data.planned_date)}</span></label>
      <label>制单人<span>{data.creatorName || '—'}</span></label>
      <label>下达人<span>{data.releaserName || '—'}</span></label>
      <label className="full">备注<span>{data.notes || '—'}</span></label>
    </div>
    <h3>指令明细</h3>
    <div className="table-wrap"><table><thead><tr>
      <th>产品</th><th className="number">建议数量</th><th className="number">已下达</th><th className="number">本次指令</th>
      <th>需求日期</th><th>请购单</th>
    </tr></thead><tbody>
      {(data.items || []).map((item) => <tr key={item.id}>
        <td><strong>{item.productName}</strong><small className="block mono dim">{item.productCode}</small></td>
        <td className="number">{fmtQty(item.mrpSuggestedQuantity)}</td>
        <td className="number">{fmtQty(item.convertedQuantity)}</td>
        <td className="number"><strong>{fmtQty(item.quantity)}</strong></td>
        <td>{fmtDate(item.need_by_date || item.mrpNeedByDate)}</td>
        <td>{item.purchaseRequisitionNo
          ? <AppLink page="purchase-requisitions" documentId={item.purchase_requisition_id}>{item.purchaseRequisitionNo}</AppLink>
          : data.status === 'RELEASED' && canManage
            ? <button type="button" className="secondary small"
                onClick={async () => {
                  try {
                    await api(`/api/purchase-requisitions`, {
                      method: 'POST',
                      body: {
                        sourceInstructionId: data.id,
                        requiredDate: item.need_by_date || data.planned_date,
                        notes: '由采购指令自动生成',
                        items: [{
                          productId: item.product_id,
                          quantity: item.quantity,
                          purchaseInstructionItemId: item.id,
                        }],
                      },
                    });
                    notify('请购单已生成');
                    void load();
                    onChanged && onChanged();
                  } catch (error) { notify(error.message, 'error'); }
                }}>生成请购单</button>
            : <span className="dim">未生成</span>}</td>
      </tr>)}
    </tbody></table></div>
    <div className="form-actions">
      {data.status === 'DRAFT' && <>
        <button type="button" className="primary" onClick={() => act('release')}>下达采购指令</button>
        <button type="button" className="danger-button" onClick={() => act('cancel')}>取消指令</button>
      </>}
      {data.status === 'RELEASED' && <button type="button" className="danger-button" onClick={() => act('cancel')}>取消指令</button>}
    </div>
  </div>;
}

// ============================================================
// Purchase Requisition
// ============================================================

export function PurchaseRequisitionsPage({ user, notify }) {
  const canManage = can(user, 'PURCHASE_REQUISITION_MANAGE');
  const canApprove = can(user, 'PURCHASE_REQUISITION_APPROVE');
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState(null);
  const [creating, setCreating] = useState(null);
  const load = () => api(`/api/purchase-requisitions?status=${encodeURIComponent(status)}`)
    .then((result) => setRows(result.requisitions || []))
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  if (rows === null) return <Panel title="请购单" subtitle="由采购指令生成或直接创建，经审批后可生成采购订单">
    <Loading/>
  </Panel>;
  const filtered = rows.filter((row) => !search
    || (row.requisitionNo || '').toLowerCase().includes(search.toLowerCase())
    || (row.sourceInstructionNo || '').toLowerCase().includes(search.toLowerCase())
    || (row.creatorName || '').toLowerCase().includes(search.toLowerCase()));
  if (selection) {
    return <Panel title="请购单" subtitle={`单号 ${selection.requisitionNo}`}
      action={<button className="secondary" onClick={() => setSelection(null)}>← 返回</button>}>
      <PurchaseRequisitionDetail requisitionId={selection.id} notify={notify} onChanged={() => { void load(); }} canManage={canManage} canApprove={canApprove}/>
    </Panel>;
  }
  return <Panel title="请购单" subtitle="由采购指令生成或直接创建，经审批后可生成采购订单"
    action={canManage && <button className="primary" onClick={() => setCreating({ create: true })}>＋ 新建请购单</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索单号或来源指令"
      extra={<select aria-label="状态" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">全部状态</option>
        <option value="DRAFT">草稿</option>
        <option value="SUBMITTED">待审批</option>
        <option value="APPROVED">已审批</option>
        <option value="REJECTED">已驳回</option>
        <option value="CANCELLED">已取消</option>
      </select>}
    />
    <div className="table-wrap"><table><thead><tr>
      <th>单号</th><th>来源采购指令</th><th className="number">项目数</th>
      <th className="number">总数量</th><th>需求日期</th><th>申请人</th><th>状态</th><th>采购订单</th>
    </tr></thead><tbody>
      {filtered.map((row) => <tr className="clickable" key={row.id} onClick={() => setSelection(row)}>
        <td className="mono strong-text">{row.requisitionNo}</td>
        <td>{row.sourceInstructionNo
          ? <AppLink page="purchase-instructions" documentId={row.sourceInstructionId}>{row.sourceInstructionNo}</AppLink>
          : <span className="dim">直接创建</span>}</td>
        <td className="number">{row.itemCount}</td>
        <td className="number">{fmtQty(row.totalQuantity)}</td>
        <td>{fmtDate(row.requiredDate)}</td>
        <td>{row.creatorName || '—'}</td>
        <td><Status status={PR_STATUS_VARIANT[row.status] || 'draft'} label={PR_STATUS_LABELS[row.status] || row.status}/></td>
        <td>{row.purchaseOrderNo
          ? <AppLink page="purchase-orders" documentId={row.purchaseOrderId}>{row.purchaseOrderNo}</AppLink>
          : <span className="dim">未生成</span>}</td>
      </tr>)}
    </tbody></table>{!filtered.length && <Empty text="没有符合条件的请购单"/>}</div>
    {creating && <PurchaseRequisitionCreate value={creating} onClose={() => setCreating(null)}
      onSaved={() => { setCreating(null); void load(); }} notify={notify}/>}
  </Panel>;
}

function PurchaseRequisitionCreate({ value, onClose, onSaved, notify }) {
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [instructions, setInstructions] = useState([]);
  const [form, setForm] = useState({
    sourceInstructionId: '',
    requiredDate: todayIso(),
    notes: '',
    items: [],
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/products').then((res) => setProducts(res.products || []));
    api('/api/suppliers').then((res) => setSuppliers(res.suppliers || []));
    api('/api/purchase-instructions?status=RELEASED').then((res) => setInstructions(res.instructions || []));
  }, []);
  const addItem = () => setForm((current) => ({ ...current, items: [...current.items, { productId: '', quantity: '', preferredSupplierId: '', unitPriceCents: 0, amountCents: 0 }] }));
  const updateItem = (index, field, value) => setForm((current) => ({
    ...current,
    items: current.items.map((item, i) => i === index ? { ...item, [field]: value } : item),
  }));
  const removeItem = (index) => setForm((current) => ({ ...current, items: current.items.filter((_, i) => i !== index) }));
  const save = async () => {
    const body = {
      ...form,
      items: form.items.filter((item) => item.productId && Number(item.quantity) > 0).map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
        preferredSupplierId: item.preferredSupplierId || null,
        unitPriceCents: Math.trunc(Number(item.unitPriceCents) || 0),
        amountCents: Math.trunc(Number(item.amountCents) || 0),
      })),
    };
    if (!body.items.length) { notify('请至少添加一条明细', 'error'); return; }
    setBusy(true);
    try {
      await api('/api/purchase-requisitions', { method: 'POST', body });
      notify('请购单已创建');
      onSaved();
    } catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  };

  return <Modal title="新建请购单" onClose={onClose} wide>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="full">来源采购指令<select value={form.sourceInstructionId} onChange={(event) => setForm({ ...form, sourceInstructionId: event.target.value })}>
        <option value="">（无关联）</option>
        {instructions.map((ins) => <option key={ins.id} value={ins.id}>{ins.instructionNo}</option>)}
      </select></label>
      <label>需求日期<input type="date" value={form.requiredDate} onChange={(event) => setForm({ ...form, requiredDate: event.target.value })} required/></label>
      <label className="full">备注<input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={200}/></label>
      <div className="full">
        <div className="form-section-head"><span>请购明细</span><button type="button" className="secondary" onClick={addItem}>＋ 增加</button></div>
        <div className="forecast-items-editor">
          {form.items.map((item, index) => <article className="forecast-item-editor" key={index}>
            <div className="forecast-item-editor__fields">
              <label>产品<select value={item.productId} onChange={(event) => updateItem(index, 'productId', event.target.value)} required>
                <option value="">选择产品</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
              </select></label>
              <label>数量<input type="number" min="0.000001" step="0.000001" value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} required/></label>
              <label>参考供应商<select value={item.preferredSupplierId} onChange={(event) => updateItem(index, 'preferredSupplierId', event.target.value)}>
                <option value="">（不指定）</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
              </select></label>
              <label>参考单价（分）<input type="number" min="0" step="1" value={item.unitPriceCents} onChange={(event) => updateItem(index, 'unitPriceCents', event.target.value)}/></label>
              <label>参考金额（分）<input type="number" min="0" step="1" value={item.amountCents} onChange={(event) => updateItem(index, 'amountCents', event.target.value)}/></label>
            </div>
            <button type="button" className="danger-text" onClick={() => removeItem(index)}>删除</button>
          </article>)}
          {!form.items.length && <Empty text="尚未添加明细"/>}
        </div>
      </div>
      <FormActions onClose={onClose} saveText={busy ? '保存中…' : '保存草稿'}/>
    </form>
  </Modal>;
}

function PurchaseRequisitionDetail({ requisitionId, notify, onChanged, canManage, canApprove }) {
  const [data, setData] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const load = () => api('/api/purchase-requisitions/' + requisitionId)
    .then((result) => { setData(result.requisition); })
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [requisitionId]);
  useEffect(() => {
    if (showGenerate) api('/api/suppliers').then((res) => setSuppliers(res.suppliers || []));
  }, [showGenerate]);
  if (!data) return <Loading/>;
  const act = async (action, body = {}) => {
    try {
      await api(`/api/purchase-requisitions/${requisitionId}/${action}`, { method: 'POST', body });
      notify('操作已执行');
      setShowReject(false);
      setShowGenerate(false);
      void load();
      onChanged && onChanged();
    } catch (error) { notify(error.message, 'error'); }
  };
  return <div className="planning-documents-detail">
    <div className="form-grid">
      <label>单号<span className="mono strong-text">{data.requisition_no}</span></label>
      <label>状态<span><Status status={PR_STATUS_VARIANT[data.status] || 'draft'} label={PR_STATUS_LABELS[data.status] || data.status}/></span></label>
      <label>来源采购指令<span>{data.sourceInstructionNo
        ? <AppLink page="purchase-instructions" documentId={data.source_instruction_id}>{data.sourceInstructionNo}</AppLink>
        : '—'}</span></label>
      <label>需求日期<span>{fmtDate(data.required_date)}</span></label>
      <label>申请人<span>{data.creatorName || '—'}</span></label>
      <label>审核人<span>{data.reviewerName || '—'}</span></label>
      <label>提交时间<span>{data.submitted_at?.slice(0, 16).replace('T', ' ') || '—'}</span></label>
      <label>审批时间<span>{data.reviewed_at?.slice(0, 16).replace('T', ' ') || '—'}</span></label>
      {data.rejection_reason && <label className="full">驳回原因<span className="danger-text">{data.rejection_reason}</span></label>}
      <label className="full">备注<span>{data.notes || '—'}</span></label>
    </div>
    <h3>请购明细</h3>
    <div className="table-wrap"><table><thead><tr>
      <th>产品</th><th className="number">数量</th><th className="number">参考单价（分）</th><th className="number">参考金额（分）</th><th>参考供应商</th>
    </tr></thead><tbody>
      {(data.items || []).map((item) => <tr key={item.id}>
        <td><strong>{item.productName}</strong><small className="block mono dim">{item.productCode}</small></td>
        <td className="number">{fmtQty(item.quantity)}</td>
        <td className="number">{fmtQty(item.unitPriceCents)}</td>
        <td className="number">{fmtQty(item.amountCents)}</td>
        <td>{item.supplierName ? `${item.supplierCode} - ${item.supplierName}` : '—'}</td>
      </tr>)}
      <tr>
        <td colSpan={2}><strong>合计</strong></td>
        <td className="number"><strong>{fmtQty(data.totalQuantity)}</strong></td>
        <td className="number"><strong>{fmtQty(data.totalAmountCents)}</strong></td>
        <td/>
      </tr>
    </tbody></table></div>
    <div className="form-actions">
      {data.status === 'DRAFT' && canManage && <>
        <button type="button" className="primary" onClick={() => act('submit')}>提交</button>
        <button type="button" className="danger-button" onClick={() => act('cancel')}>取消</button>
      </>}
      {data.status === 'SUBMITTED' && canApprove && <>
        <button type="button" className="primary" onClick={() => act('approve')}>审批通过</button>
        <button type="button" className="danger-button" onClick={() => setShowReject(true)}>驳回</button>
      </>}
      {data.status === 'SUBMITTED' && !canApprove && <span className="dim">等待审核人审批</span>}
      {data.status === 'APPROVED' && canManage && !data.purchase_order_id && <button type="button" className="primary" onClick={() => setShowGenerate(true)}>生成采购订单</button>}
      {data.status === 'APPROVED' && data.purchase_order_id && <span className="dim">已生成采购订单 {data.purchaseOrderNo}</span>}
      {data.status === 'REJECTED' && canManage && <>
        <button type="button" className="primary" onClick={() => act('submit')}>重新提交</button>
        <button type="button" className="danger-button" onClick={() => act('cancel')}>取消</button>
      </>}
    </div>
    {showReject && <Modal title="驳回请购单" onClose={() => setShowReject(false)}>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); if (!rejectReason.trim()) return; void act('reject', { reason: rejectReason }); }}>
        <label className="full">驳回原因<textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={200} required/></label>
        <FormActions onClose={() => setShowReject(false)} saveText="确认驳回"/>
      </form>
    </Modal>}
    {showGenerate && <Modal title="生成采购订单" onClose={() => setShowGenerate(false)}>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); if (!supplierId) return; void act('generate-purchase-order', { supplierId }); }}>
        <label className="full">请选择供应商<select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
          <option value="">选择供应商</option>
          {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
        </select></label>
        <p className="full dim">采购订单将以草稿状态创建，由审核人按既有流程审批。</p>
        <FormActions onClose={() => setShowGenerate(false)} saveText="生成"/>
      </form>
    </Modal>}
  </div>;
}

// ============================================================
// PlanningDocumentsHub — entrypoint when no specific document selected.
// The user lands here from the sidebar nav; from there they can
// drill into any of the three families.
// ============================================================

export function PlanningDocumentsHub({ user, notify }) {
  const { target } = useAppNavigation();
  const [tab, setTab] = useState('production-instructions');
  useEffect(() => {
    if (target?.page === 'production-instructions') setTab('production-instructions');
    else if (target?.page === 'purchase-instructions') setTab('purchase-instructions');
    else if (target?.page === 'purchase-requisitions') setTab('purchase-requisitions');
  }, [target]);
  return <Panel title="计划单据" subtitle="由 MRP 建议生成的生产指令、采购指令与请购单"
    action={<div className="planning-tabs">
      <button className={tab === 'production-instructions' ? 'active' : ''} onClick={() => setTab('production-instructions')}>生产指令</button>
      <button className={tab === 'purchase-instructions' ? 'active' : ''} onClick={() => setTab('purchase-instructions')}>采购指令</button>
      <button className={tab === 'purchase-requisitions' ? 'active' : ''} onClick={() => setTab('purchase-requisitions')}>请购单</button>
    </div>}>
    {tab === 'production-instructions' && <ProductionInstructionsPage user={user} notify={notify}/>}
    {tab === 'purchase-instructions' && <PurchaseInstructionsPage user={user} notify={notify}/>}
    {tab === 'purchase-requisitions' && <PurchaseRequisitionsPage user={user} notify={notify}/>}
  </Panel>;
}

export default PlanningDocumentsHub;