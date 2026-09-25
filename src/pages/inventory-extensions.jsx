import { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  Empty, FormActions, Loading, Modal, Panel, Status, Toolbar, can, dateTime, quantity,
} from '../components/ui.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';

const SCRAP_STATUS_LABEL = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const PERIOD_STATUS_LABEL = { CLOSED: '已结账', REOPENED: '已反结账' };

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
    <div className="table-wrap"><table><thead><tr><th>报废单号</th><th>状态</th><th>报废日期</th><th className="number">明细数</th><th className="number">报废数量</th><th>原因</th><th>创建人</th><th>确认时间</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="clickable" onClick={() => void openDetail(row)}><td className="mono">{row.scrapNo}</td><td><Status status={row.status} label={SCRAP_STATUS_LABEL[row.status] || row.status}/></td><td>{row.scrapDate}</td><td className="number">{row.itemCount}</td><td className="number">{quantity(row.totalQuantity)}</td><td>{row.reason || '—'}</td><td>{row.creatorName}</td><td className="dim">{dateTime(row.confirmedAt)}</td></tr>)}</tbody></table>{!rows.length && <Empty text="没有库存报废记录"/>}</div>
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
  const [viewing, setViewing] = useState(null);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const canManage = can(user, 'INVENTORY_PERIOD_CLOSE_MANAGE');
  const latestClosed = rows.find((row) => row.status === 'CLOSED');

  async function openDetail(row) {
    try { const result = await api(`/api/inventory-period-closures/${row.id}`); setViewing(result.inventoryPeriodClosure); }
    catch (error) { notify(error.message, 'error'); }
  }

  async function reopen(row) {
    if (!canManage) { notify('没有权限反结账', 'error'); return; }
    try {
      await api(`/api/inventory-period-closures/${row.id}/reopen`, { method: 'POST' });
      notify(`期间 ${row.period_key} 已反结账`);
      reload();
    } catch (error) { notify(error.message, 'error'); }
  }

  return <Panel title="存货月结" subtitle="按月冻结库存期间并生成只读快照；不影响库存数量与会计期间">
    <Toolbar search={() => {}} placeholder="" action={canManage && <button className="primary" onClick={() => setShowCloseForm(true)}>＋ 执行月结</button>}/>
    <p className="section-hint">期末库存 = 当前库存 − 期末之后发生的净异动；不重新计算库存价值，仅记录数量快照。月结不影响会计期间，不进入审批中心。</p>
    <div className="table-wrap"><table><thead><tr><th>期间</th><th>状态</th><th>结账时间</th><th>结账人</th><th className="number">快照条目</th><th>反结时间</th><th>反结人</th><th/></tr></thead><tbody>{rows.map((row) => {
      const canReopenThis = canManage && row.status === 'CLOSED' && (!latestClosed || latestClosed.period_key === row.period_key);
      return <tr key={row.id} className="clickable" onClick={() => void openDetail(row)}>
        <td className="mono">{row.period_key}</td>
        <td><Status status={row.status} label={PERIOD_STATUS_LABEL[row.status] || row.status}/></td>
        <td className="dim">{dateTime(row.closed_at)}</td>
        <td>{row.closedByName}</td>
        <td className="number">{row.snapshotCount}</td>
        <td className="dim">{dateTime(row.reopened_at)}</td>
        <td>{row.reopenedByName || '—'}</td>
        <td>{canReopenThis && <button type="button" className="row-action" onClick={(event) => { event.stopPropagation(); void reopen(row); }}>反结账</button>}</td>
      </tr>;
    })}</tbody></table>{!rows.length && <Empty text="尚未执行存货月结"/>}</div>
    {showCloseForm && <CloseInventoryPeriodModal notify={notify} onClose={() => setShowCloseForm(false)} onSaved={() => { setShowCloseForm(false); reload(); notify('存货月结已保存'); }}/>}
    {viewing && <InventoryPeriodClosureDetail value={viewing} onClose={() => setViewing(null)}/>}
  </Panel>;
}

function CloseInventoryPeriodModal({ notify, onClose, onSaved }) {
  const [period, setPeriod] = useState(currentPeriodKey());
  async function save(event) {
    event.preventDefault();
    try { await api('/api/inventory-period-closures', { method: 'POST', body: { period, notes: '' } }); onSaved(); }
    catch (error) { notify(error.message, 'error'); }
  }
  return <Modal title="执行存货月结" onClose={onClose}>
    <form onSubmit={save}>
      <div className="form-grid order-head">
        <label>期间 (YYYY-MM)<input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-08" pattern="\d{4}-(0[1-9]|1[0-2])" required/></label>
        <p className="full section-hint">建议结账已结束的自然月；系统会按库存与库存异动计算期末数量并写入快照，且不修改库存或凭证。</p>
      </div>
      <FormActions onClose={onClose} saveText="结账"/>
    </form>
  </Modal>;
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
    </div>
    <h4>期间汇总</h4>
    <div className="detail-grid">
      <div><span>仓库数</span><strong>{value.summary?.warehouseCount || 0}</strong></div>
      <div><span>货品数</span><strong>{value.summary?.productCount || 0}</strong></div>
      <div><span>期内入库数量</span><strong>{quantity(value.summary?.totalInQuantity || 0)}</strong></div>
      <div><span>期内出库数量</span><strong>{quantity(value.summary?.totalOutQuantity || 0)}</strong></div>
    </div>
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
