import { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  Empty, FormActions, Loading, Modal, Panel, Status, Toolbar, can, dateTime, quantity,
} from '../components/ui.jsx';
import {
  BusinessActionBar, BusinessPageHeader, BusinessState, DestructiveButton, InlineAlert,
  PrimaryButton, RecordCard, RecordList, SecondaryButton, StatusChip, SummaryCard,
} from '../components/design-system.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import { presentStatus } from '../lib/presentation.js';

function useInventoryScraps(notify) {
  const [rows, setRows] = useState([]);
  const reload = () => api('/api/inventory-scraps').then((r) => setRows(r.inventoryScraps || [])).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void reload(); }, []);
  return { rows, reload };
}

function useInventoryPeriodClosures(notify) {
  const [rows, setRows] = useState([]);
  const reload = () => api('/api/inventory-period-closures').then((r) => setRows(r.inventoryPeriodClosures || [])).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void reload(); }, []);
  return { rows, reload };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function currentPeriodKey() {
  return new Date().toISOString().slice(0, 7);
}

// =====================================================================
// Inventory Scrap page
// =====================================================================

export function InventoryScraps({ user, notify }) {
  const { rows, reload } = useInventoryScraps(notify);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    api('/api/warehouses').then((r) => setWarehouses(r.warehouses || [])).catch((e) => notify(e.message, 'error'));
    api('/api/products').then((r) => setProducts(r.products || [])).catch((e) => notify(e.message, 'error'));
  }, []);

  async function openDetail(row) {
    try { const result = await api(`/api/inventory-scraps/${row.id}`); setViewing(result.inventoryScrap); }
    catch (error) { notify(error.message, 'error'); }
  }

  async function changeState(row, action) {
    try {
      await api(`/api/inventory-scraps/${row.id}/${action}`, { method: 'POST' });
      notify(action === 'confirm' ? '报废单已确认' : '报废单已取消');
      setViewing(null);
      await reload();
    } catch (error) { notify(error.message, 'error'); }
  }

  return <Panel title="库存报废" subtitle="DRAFT 草稿可编辑，确认后扣减库存并写入库存异动；已确认与已取消单据只读">
    <Toolbar search={() => {}} placeholder="" action={can(user, 'INVENTORY_SCRAP_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建报废单</button>}/>
    <p className="section-hint">报废单确认时按仓库 + 货品校验库存，任一行不足则整张单据回滚。</p>
    <div className="table-wrap"><table><thead><tr><th>报废单号</th><th>状态</th><th>报废日期</th><th className="number">明细数</th><th className="number">报废数量</th><th>原因</th><th>创建人</th><th>确认时间</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="clickable" onClick={() => void openDetail(row)}><td className="mono">{row.scrapNo}</td><td><Status status={row.status} label={presentStatus(row.status).label}/></td><td>{row.scrapDate}</td><td className="number">{row.itemCount}</td><td className="number">{quantity(row.totalQuantity)}</td><td>{row.reason || '—'}</td><td>{row.creatorName}</td><td className="dim">{dateTime(row.confirmedAt)}</td></tr>)}</tbody></table>{!rows.length && <BusinessState kind="EMPTY" title="没有库存报废记录" description="确认报废后会扣减库存并写入库存异动表。"/>}</div>
    {editing && <InventoryScrapModal value={editing} warehouses={warehouses} products={products} notify={notify} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); notify('报废单已保存'); }}/>}
    {viewing && <InventoryScrapDetail value={viewing} onClose={() => setViewing(null)} onEdit={() => { setViewing(null); setEditing(viewing); }} onAction={changeState}/>}
  </Panel>;
}

function InventoryScrapModal({ value, warehouses, products, notify, onClose, onSaved }) {
  const initialItems = value.items?.length
    ? value.items.map((item) => ({ warehouseId: item.warehouseId, productId: item.productId, quantity: item.quantity, reason: item.reason || '' }))
    : [{ warehouseId: '', productId: '', quantity: '', reason: '' }];
  const [form, setForm] = useState({
    scrapDate: value.scrap_date || today(),
    reason: value.reason || '',
    notes: value.notes || '',
    items: initialItems,
  });

  function updateLine(index, patch) {
    setForm({ ...form, items: form.items.map((item, i) => i === index ? { ...item, ...patch } : item) });
  }

  async function save(event) {
    event.preventDefault();
    try {
      const payload = {
        scrapDate: form.scrapDate,
        reason: form.reason,
        notes: form.notes,
        items: form.items.map((item) => ({
          warehouseId: item.warehouseId,
          productId: item.productId,
          quantity: Number(item.quantity),
          reason: item.reason || '',
        })),
      };
      const url = value.id ? `/api/inventory-scraps/${value.id}` : '/api/inventory-scraps';
      const method = value.id ? 'PATCH' : 'POST';
      await api(url, { method, body: payload });
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return <Modal title={value.id ? '编辑库存报废单' : '新建库存报废单'} onClose={onClose} wide>
    <form onSubmit={save}>
      <div className="form-grid order-head">
        <label>报废日期<input type="date" value={form.scrapDate} onChange={(e) => setForm({ ...form, scrapDate: e.target.value })} required/></label>
        <label className="full">报废原因<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="如：过期、损坏、滞销、检测不合格" maxLength={200}/></label>
        <label className="full">备注（可选）<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={200}/></label>
      </div>
      <div className="line-title"><div><strong>报废明细</strong><small className="block">每个仓库 + 货品仅允许一行；数量必须为正数，确认时校验库存。</small></div><button type="button" className="secondary" onClick={() => setForm({ ...form, items: [...form.items, { warehouseId: '', productId: '', quantity: '', reason: '' }] })}>＋ 添加一行</button></div>
      <div className="line-table scrap-lines">
        <div className="line-row line-header"><span>#</span><span>仓库</span><span>货品</span><span className="number">数量</span><span>原因</span><span/></div>
        {form.items.map((line, index) => <div className="line-row" key={index}>
          <span>{index + 1}</span>
          <select value={line.warehouseId} onChange={(e) => updateLine(index, { warehouseId: e.target.value })} required>
            <option value="">请选择仓库</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
          <select value={line.productId} onChange={(e) => updateLine(index, { productId: e.target.value })} required>
            <option value="">请选择货品</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
          <input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} placeholder="如 5" required/>
          <input value={line.reason} onChange={(e) => updateLine(index, { reason: e.target.value })} maxLength={200} placeholder="可选"/>
          <button type="button" className="remove" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}>×</button>
        </div>)}
      </div>
      <FormActions onClose={onClose} saveText="保存草稿"/>
    </form>
  </Modal>;
}

function InventoryScrapDetail({ value, onClose, onEdit, onAction }) {
  const navigation = useAppNavigation();
  const canViewMovements = navigation.canNavigate('inventory-transactions');
  return <Modal title="库存报废单详情" onClose={onClose} wide>
    <div className="detail-head"><div><span className="mono">{value.scrap_no}</span><h3>{value.reason || '无原因'}</h3><p>{value.notes || '—'}</p></div><Status status={value.status} label={value.statusLabel}/></div>
    <div className="detail-grid">
      <div><span>报废日期</span><strong>{value.scrap_date}</strong></div>
      <div><span>创建人</span><strong>{value.creatorName}</strong></div>
      <div><span>确认人</span><strong>{value.confirmedByName || '尚未确认'}</strong></div>
      <div><span>确认时间</span><strong>{dateTime(value.confirmed_at)}</strong></div>
      {value.status === 'CANCELLED' && <div><span>取消人</span><strong>{value.cancelledByName || '—'}</strong></div>}
    </div>
    <div className="table-wrap inset">
      <table>
        <thead><tr><th>#</th><th>仓库</th><th>货品</th><th className="number">报废数量</th><th>原因</th></tr></thead>
        <tbody>{value.items.map((item) => <tr key={item.id}><td>{item.line_no}</td><td>{item.warehouseName}</td><td><strong>{item.productName}</strong><small className="block mono">{item.productCode}</small></td><td className="number">{quantity(item.quantity)}</td><td>{item.reason || '—'}</td></tr>)}</tbody>
      </table>
    </div>
    {value.status === 'DRAFT' && <div className="form-actions">
      <button type="button" className="secondary" onClick={onClose}>关闭</button>
      <button type="button" className="row-action" onClick={onEdit}>编辑</button>
      <button type="button" className="danger-button" onClick={() => onAction(value, 'cancel')}>取消报废</button>
      <button type="button" className="approve-button" onClick={() => onAction(value, 'confirm')}>确认报废</button>
    </div>}
    {value.status === 'CONFIRMED' && canViewMovements && <p className="section-hint">报废已生成库存异动，可在<strong> 库存异动 </strong>按来源单号 <span className="mono">{value.scrap_no}</span> 查询。</p>}
    {value.status === 'CANCELLED' && <p className="section-hint">已取消的报废单未对库存或异动表产生任何影响。</p>}
  </Modal>;
}

// =====================================================================
// Inventory Month-End page
// =====================================================================

export function InventoryMonthEnd({ user, notify }) {
  const { rows, reload } = useInventoryPeriodClosures(notify);
  const [status, setStatus] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [reopening, setReopening] = useState(null);
  const canManage = can(user, 'INVENTORY_PERIOD_CLOSE_MANAGE');

  const reloadStatus = () => api('/api/inventory-period-closures/status').then((result) => setStatus(result.status)).catch((error) => notify(error.message, 'error'));
  useEffect(() => { void reloadStatus(); }, []);

  async function openDetail(row) {
    try { const result = await api(`/api/inventory-period-closures/${row.id}`); setViewing(result.inventoryPeriodClosure); }
    catch (error) { notify(error.message, 'error'); }
  }

  async function reopen(row, reason) {
    try {
      await api(`/api/inventory-period-closures/${row.id}/reopen`, { method: 'POST', body: { reason } });
      notify(`期间 ${row.period_key} 已反结账`);
      setReopening(null);
      await Promise.all([reload(), reloadStatus()]);
    } catch (error) { notify(error.message, 'error'); }
  }

  return <div className="inventory-period-page">
    <BusinessPageHeader
      title="存货期间结账"
      context="先运行预检查，再冻结已结束自然月的存货数量快照。结账不会修改库存流水或会计凭证。"
      status={status?.latestStatus}
      meta={status?.closedThrough ? `已结至 ${status.closedThrough}` : '尚无结账基线'}
      primaryAction={canManage && <PrimaryButton type="button" disabled={!status?.canClose} onClick={() => setShowCloseForm(true)}>执行月结</PrimaryButton>}
    />
    <div className="inventory-period-summary">
      <SummaryCard label="最近期间" value={status?.latestPeriod || '—'} detail={status?.latestStatus === 'REOPENED' ? '等待重新结账' : '最近操作记录'}/>
      <SummaryCard label="下一可结期间" value={status?.nextClosablePeriod || '—'} detail="仅允许连续的已结束自然月"/>
      <SummaryCard label="历史记录" value={rows.length} detail="含结账与反结账轨迹"/>
    </div>
    <InlineAlert>快照只读取权威 <code>business_date</code>。遗留日期无法验证、负库存、未完成单据或一致性差异都会阻止结账。</InlineAlert>
    {rows.length ? <RecordList className="inventory-period-list">{rows.map((row) => {
      const canReopenThis = canManage && row.status === 'CLOSED' && status?.latestPeriod === row.period_key;
      return <RecordCard key={row.id} title={row.period_key} subtitle={`结账人 ${row.closedByName} · ${dateTime(row.closed_at)}`}
        status={<StatusChip status={row.status} domain="period.status"/>}
        facts={[
          { label: '快照条目', value: row.snapshotCount },
          { label: '预检查', value: row.closeChecks?.overallStatus || '—' },
          { label: '反结时间', value: dateTime(row.reopened_at) },
          { label: '反结人', value: row.reopenedByName || '—' },
        ]}
        onClick={() => void openDetail(row)}
        actions={<BusinessActionBar secondary={<SecondaryButton type="button" onClick={() => void openDetail(row)}>查看详情</SecondaryButton>}
          destructive={canReopenThis && <DestructiveButton type="button" onClick={() => setReopening(row)}>反结账</DestructiveButton>}/>}/>; })}</RecordList>
      : <BusinessState kind="EMPTY" title="尚未执行存货月结" description="运行预检查并结账后，这里会显示只读快照与完整审计历史。" action={canManage && status?.canClose ? <PrimaryButton type="button" onClick={() => setShowCloseForm(true)}>执行首次月结</PrimaryButton> : null}/>}
    {showCloseForm && <CloseInventoryPeriodModal initialPeriod={status?.nextClosablePeriod} notify={notify} onClose={() => setShowCloseForm(false)} onSaved={async () => { setShowCloseForm(false); await Promise.all([reload(), reloadStatus()]); notify('存货月结已完成'); }}/>}
    {reopening && <ReopenInventoryPeriodModal row={reopening} onClose={() => setReopening(null)} onConfirm={(reason) => reopen(reopening, reason)}/>}
    {viewing && <InventoryPeriodClosureDetail value={viewing} onClose={() => setViewing(null)}/>}
  </div>;
}

function CloseInventoryPeriodModal({ initialPeriod, notify, onClose, onSaved }) {
  const [period, setPeriod] = useState(initialPeriod || currentPeriodKey());
  const [notes, setNotes] = useState('');
  const [precheck, setPrecheck] = useState(null);
  const [confirmWarnings, setConfirmWarnings] = useState(false);
  const [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    try {
      const result = await api('/api/inventory-period-closures/check', { method: 'POST', body: { period } });
      setPrecheck(result.precheck); setConfirmWarnings(false);
    } catch (error) { notify(error.message, 'error'); }
    finally { setChecking(false); }
  }
  async function save(event) { event.preventDefault(); try {
    await api('/api/inventory-period-closures', { method: 'POST', body: { period, notes, confirmWarnings } }); onSaved();
  } catch (error) { notify(error.message, 'error'); } }
  const warning = precheck?.overallStatus === 'WARNING';
  const ready = precheck && precheck.overallStatus !== 'BLOCKED' && (!warning || confirmWarnings);
  return <Modal title="执行存货月结" onClose={onClose}>
    <form onSubmit={save}>
      <div className="form-grid order-head">
        <label>期间 (YYYY-MM)<input value={period} onChange={(event) => { setPeriod(event.target.value); setPrecheck(null); }} placeholder="2026-08" pattern="\d{4}-(0[1-9]|1[0-2])" required/></label>
        <label className="full">结账备注<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={200}/></label>
      </div>
      {!precheck && <BusinessState kind="EMPTY" title="尚未运行预检查" description="结账前必须检查期间顺序、库存、单据、追踪身份与财务一致性。"/>}
      {precheck && <PrecheckResults value={precheck}/>}
      {warning && <label className="inventory-period-warning-confirm"><input type="checkbox" checked={confirmWarnings} onChange={(event) => setConfirmWarnings(event.target.checked)}/>我已审阅并接受上述非阻断警告</label>}
      <BusinessActionBar secondary={[<SecondaryButton key="cancel" type="button" onClick={onClose}>取消</SecondaryButton>, <SecondaryButton key="check" type="button" disabled={checking} onClick={() => void check()}>{checking ? '检查中…' : '运行预检查'}</SecondaryButton>]}
        primary={<PrimaryButton type="submit" disabled={!ready}>确认结账</PrimaryButton>}/>
    </form>
  </Modal>;
}

function PrecheckResults({ value }) {
  const tone = value.overallStatus === 'PASS' ? 'success' : value.overallStatus === 'WARNING' ? 'warning' : 'danger';
  return <div className="inventory-precheck"><InlineAlert tone={tone} title={`预检查：${value.overallStatus}`}>阻断 {value.summary.blockingCount} · 警告 {value.summary.warningCount} · 通过 {value.summary.passCount}</InlineAlert>
    <div className="inventory-precheck__list">{value.checks.map((check) => <article key={check.code} className={`inventory-precheck__item is-${check.status.toLowerCase()}`}>
      <div><strong>{check.title}</strong><small>{check.code}</small></div><span>{check.status}{check.count ? ` · ${check.count}` : ''}</span>
      {check.status === 'FAIL' && <p>{check.resolution}</p>}
    </article>)}</div></div>;
}

function ReopenInventoryPeriodModal({ row, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  return <Modal title={`反结账 ${row.period_key}`} onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onConfirm(reason); }}>
    <InlineAlert tone="warning">只能反结最近已结期间；同月会计期间必须为打开状态。快照保留并将在重结时重建。</InlineAlert>
    <label>反结账原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} required/></label>
    <BusinessActionBar secondary={<SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton>} destructive={<DestructiveButton type="submit" disabled={!reason.trim()}>确认反结账</DestructiveButton>}/>
  </form></Modal>;
}

function InventoryPeriodClosureDetail({ value, onClose }) {
  const navigation = useAppNavigation();
  const canViewMovements = navigation.canNavigate('inventory-transactions');
  return <Modal title={`存货月结 ${value.period_key}`} onClose={onClose} wide>
    <div className="detail-head"><div><span className="mono">{value.period_key}</span><h3>{value.notes || '—'}</h3><p>期间范围 {value.periodRange?.startDate} 至 {value.periodRange?.endDate}</p></div><Status status={value.status} label={value.statusLabel}/></div>
    <div className="detail-grid">
      <div><span>结账时间</span><strong>{dateTime(value.closed_at)}</strong></div>
      <div><span>结账人</span><strong>{value.closedByName}</strong></div>
      <div><span>反结时间</span><strong>{dateTime(value.reopened_at)}</strong></div>
      <div><span>反结人</span><strong>{value.reopenedByName || '—'}</strong></div>
      <div><span>反结原因</span><strong>{value.reopen_reason || '—'}</strong></div>
    </div>
    {value.closeChecks && <PrecheckResults value={value.closeChecks}/>}
    <h4>期间汇总</h4>
    <div className="detail-grid">
      <div><span>仓库数</span><strong>{value.summary?.warehouseCount || 0}</strong></div>
      <div><span>货品数</span><strong>{value.summary?.productCount || 0}</strong></div>
      <div><span>期内入库数量</span><strong>{quantity(value.summary?.totalInQuantity || 0)}</strong></div>
      <div><span>期内出库数量</span><strong>{quantity(value.summary?.totalOutQuantity || 0)}</strong></div>
    </div>
    <h4>审计历史</h4>
    <div className="inventory-period-audit">{value.audits?.map((entry) => <div key={entry.id}><strong>{entry.action}</strong><span>{entry.actorName || '系统'} · {dateTime(entry.created_at)}</span><p>{entry.detail}</p></div>)}</div>
    <div className="table-wrap inset">
      <table>
        <thead><tr><th>仓库</th><th>货品</th><th className="number">本期入库</th><th className="number">本期出库</th><th className="number">期末数量</th></tr></thead>
        <tbody>{value.snapshots?.length ? value.snapshots.map((snap) => <tr key={snap.id}><td>{snap.warehouseName}</td><td><strong>{snap.productName}</strong><small className="block mono">{snap.productCode}</small></td><td className="number">{quantity(snap.periodInQuantity)}</td><td className="number">{quantity(snap.periodOutQuantity)}</td><td className="number">{quantity(snap.closingQuantity)}</td></tr>) : <tr><td colSpan={5}><Empty text="该期间内未发生库存异动"/></td></tr>}</tbody>
      </table>
    </div>
    {canViewMovements && <p className="section-hint">如需追溯本期内的明细，可前往<strong> 库存异动 </strong>按期间 {value.period_key} 筛选。</p>}
  </Modal>;
}

// Default export: combined panel for the single-page launcher if needed.
export default function InventoryExtensions({ user, notify, page }) {
  if (page === 'inventory-month-end') return <InventoryMonthEnd user={user} notify={notify}/>;
  return <InventoryScraps user={user} notify={notify}/>;
}
