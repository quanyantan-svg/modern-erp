import { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  Empty, FormActions, Loading, Modal, Panel, Status, Toolbar, can, dateTime, quantity,
} from '../components/ui.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';

const SALES_STATUS_LABEL = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const PURCHASE_STATUS_LABEL = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };

function useSalesDiscounts(notify) {
  const [rows, setRows] = useState([]);
  const reload = () => api('/api/sales-discounts').then((r) => setRows(r.salesDiscounts || [])).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void reload(); }, []);
  return { rows, reload };
}

function usePurchaseDiscounts(notify) {
  const [rows, setRows] = useState([]);
  const reload = () => api('/api/purchase-discounts').then((r) => setRows(r.purchaseDiscounts || [])).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void reload(); }, []);
  return { rows, reload };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchCustomers(notify) {
  try { return (await api('/api/customers')).customers || []; } catch (e) { notify(e.message, 'error'); return []; }
}
async function fetchSuppliers(notify) {
  try { return (await api('/api/suppliers')).suppliers || []; } catch (e) { notify(e.message, 'error'); return []; }
}
async function fetchReceivablesForCustomer(customerId) {
  if (!customerId) return [];
  const r = await api(`/api/accounts-receivable?customer=${encodeURIComponent(customerId)}&status=PENDING`);
  return (r.receivables || []).filter((row) => Number(row.amountCents) > 0);
}
async function fetchPayablesForSupplier(supplierId) {
  if (!supplierId) return [];
  const r = await api(`/api/accounts-payable?supplier=${encodeURIComponent(supplierId)}&status=PENDING`);
  return (r.payables || []).filter((row) => Number(row.amountCents) > 0);
}

// =====================================================================
// Sales Discount
// =====================================================================

export function SalesDiscounts({ user, notify }) {
  const { rows, reload } = useSalesDiscounts(notify);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  async function openDetail(row) {
    try { const result = await api(`/api/sales-discounts/${row.id}`); setViewing(result.salesDiscount); }
    catch (error) { notify(error.message, 'error'); }
  }

  async function changeState(row, action) {
    try {
      await api(`/api/sales-discounts/${row.id}/${action}`, { method: 'POST', body: {} });
      notify(action === 'confirm' ? '销售折让已确认' : '销售折让已取消');
      setViewing(null);
      await reload();
    } catch (error) { notify(error.message, 'error'); }
  }

  return <Panel title="销售折让" subtitle="DRAFT 编辑；确认时按来源应收原子扣减；不写凭证、不进审批中心">
    <Toolbar search={() => {}} placeholder="" action={can(user, 'SALES_DISCOUNT_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建折让</button>}/>
    <p className="section-hint">折让金额不得超过来源应收剩余可折让额度（销售退货 + 历史折让之和不超过原应收）。</p>
    <div className="table-wrap"><table>
      <thead><tr><th>折让单号</th><th>状态</th><th>客户</th><th>来源应收</th><th>业务日期</th><th className="number">折让金额</th><th>原因</th><th>创建人</th><th>确认时间</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id} className="clickable" onClick={() => void openDetail(row)}>
        <td className="mono">{row.discountNo}</td>
        <td><Status status={row.status} label={SALES_STATUS_LABEL[row.status] || row.status}/></td>
        <td>{row.customerName}</td>
        <td className="mono">{row.reason || '—'}</td>
        <td>{row.businessDate}</td>
        <td className="number">{quantity(row.amountCents)}</td>
        <td>{row.reason || '—'}</td>
        <td>{row.creatorName}</td>
        <td className="dim">{dateTime(row.confirmedAt)}</td>
      </tr>)}</tbody>
    </table>{!rows.length && <Empty text="没有销售折让记录"/>}</div>
    {editing && <SalesDiscountModal value={editing} notify={notify} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); notify('销售折让已保存'); }}/>}
    {viewing && <SalesDiscountDetail value={viewing} onClose={() => setViewing(null)} onEdit={() => { setViewing(null); setEditing(viewing); }} onAction={changeState}/>}
  </Panel>;
}

function SalesDiscountModal({ value, notify, onClose, onSaved }) {
  const [customers, setCustomers] = useState([]);
  const [receivables, setReceivables] = useState([]);
  const [form, setForm] = useState({
    customerId: value.customer_id || '',
    sourceReceivableId: value.source_receivable_id || '',
    amountCents: value.amount_cents ? Number(value.amount_cents) : '',
    businessDate: value.business_date || today(),
    reason: value.reason || '',
    notes: value.notes || '',
  });

  useEffect(() => { void fetchCustomers(notify).then(setCustomers); }, []);
  useEffect(() => { void fetchReceivablesForCustomer(form.customerId).then(setReceivables); }, [form.customerId]);

  async function save(event) {
    event.preventDefault();
    try {
      const payload = {
        customerId: form.customerId,
        sourceReceivableId: form.sourceReceivableId,
        amountCents: Number(form.amountCents),
        businessDate: form.businessDate,
        reason: form.reason,
        notes: form.notes,
      };
      const url = value.id ? `/api/sales-discounts/${value.id}` : '/api/sales-discounts';
      const method = value.id ? 'PATCH' : 'POST';
      await api(url, { method, body: payload });
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  const selectedSource = receivables.find((r) => r.id === form.sourceReceivableId);

  return <Modal title={value.id ? '编辑销售折让' : '新建销售折让'} onClose={onClose} wide>
    <form onSubmit={save}>
      <div className="form-grid order-head">
        <label>客户<select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value, sourceReceivableId: '' })} required>
          <option value="">请选择客户</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
        </select></label>
        <label>业务日期<input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} required/></label>
        <label className="full">来源应收<select value={form.sourceReceivableId} onChange={(e) => setForm({ ...form, sourceReceivableId: e.target.value })} required disabled={!form.customerId}>
          <option value="">{form.customerId ? '请选择来源应收' : '请先选择客户'}</option>
          {receivables.map((r) => <option key={r.id} value={r.id}>{r.documentNo} · {r.businessDate} · ¥{(r.amountCents / 100).toFixed(2)}</option>)}
        </select></label>
        {selectedSource && <div className="full detail-grid" style={{ marginBottom: 8 }}>
          <div><span>原应收金额</span><strong>¥{(Number(selectedSource.amountCents) / 100).toFixed(2)}</strong></div>
          <div><span>当前未收余额</span><strong>¥{(Number(selectedSource.outstandingCents) / 100).toFixed(2)}</strong></div>
        </div>}
        <label>折让金额（分）<input type="number" min="1" step="1" value={form.amountCents} onChange={(e) => setForm({ ...form, amountCents: e.target.value })} required/></label>
        <label className="full">原因<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} maxLength={200}/></label>
        <label className="full">备注<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={200}/></label>
      </div>
      <FormActions onClose={onClose} saveText="保存草稿"/>
    </form>
  </Modal>;
}

function SalesDiscountDetail({ value, onClose, onEdit, onAction }) {
  const navigation = useAppNavigation();
  const canViewReceivables = navigation.canNavigate('accounts-receivable');
  return <Modal title="销售折让详情" onClose={onClose} wide>
    <div className="detail-head"><div><span className="mono">{value.discount_no}</span><h3>{value.reason || '销售折让'}</h3><p>{value.notes || '—'}</p></div><Status status={value.status} label={value.statusLabel}/></div>
    <div className="detail-grid">
      <div><span>客户</span><strong>{value.customerName}</strong></div>
      <div><span>业务日期</span><strong>{value.business_date}</strong></div>
      <div><span>创建人</span><strong>{value.creatorName}</strong></div>
      <div><span>确认人</span><strong>{value.confirmedByName || '尚未确认'}</strong></div>
      <div><span>确认时间</span><strong>{dateTime(value.confirmed_at)}</strong></div>
      {value.status === 'CANCELLED' && <div><span>取消人</span><strong>{value.cancelledByName || '—'}</strong></div>}
      <div><span>折让金额</span><strong>¥{(value.amountCents / 100).toFixed(2)}</strong></div>
      <div><span>客户当前净欠款</span><strong>¥{(value.customerNetCents / 100).toFixed(2)}</strong></div>
    </div>
    <h4>来源应收</h4>
    {value.source ? <div className="detail-grid">
      <div><span>应收单号</span><strong>{value.source.documentNo}</strong></div>
      <div><span>业务日期</span><strong>{value.source.businessDate}</strong></div>
      <div><span>原应收</span><strong>¥{(value.source.amountCents / 100).toFixed(2)}</strong></div>
      <div><span>当前未收</span><strong>¥{(value.source.outstandingCents / 100).toFixed(2)}</strong></div>
    </div> : <Empty text="来源应收不存在"/>}
    <h4>来源额度</h4>
    <div className="detail-grid">
      <div><span>原应收金额</span><strong>¥{(value.sourceCapacity.originalCents / 100).toFixed(2)}</strong></div>
      <div><span>已使用额度</span><strong>¥{(value.sourceCapacity.consumedCents / 100).toFixed(2)}</strong></div>
      <div><span>剩余可折让</span><strong>¥{(value.sourceCapacity.remainingCents / 100).toFixed(2)}</strong></div>
    </div>
    {value.status === 'DRAFT' && <div className="form-actions">
      <button type="button" className="secondary" onClick={onClose}>关闭</button>
      <button type="button" className="row-action" onClick={onEdit}>编辑</button>
      <button type="button" className="danger-button" onClick={() => onAction(value, 'cancel')}>取消折让</button>
      <button type="button" className="approve-button" onClick={() => onAction(value, 'confirm')}>确认折让</button>
    </div>}
    {value.status === 'CONFIRMED' && canViewReceivables && <p className="section-hint">折让已生成应收调整，可在<strong> 应收账款 </strong>按客户查询。</p>}
    {value.status === 'CANCELLED' && <p className="section-hint">已取消的销售折让未对应收账款或凭证产生任何影响。</p>}
  </Modal>;
}

// =====================================================================
// Purchase Discount
// =====================================================================

export function PurchaseDiscounts({ user, notify }) {
  const { rows, reload } = usePurchaseDiscounts(notify);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  async function openDetail(row) {
    try { const result = await api(`/api/purchase-discounts/${row.id}`); setViewing(result.purchaseDiscount); }
    catch (error) { notify(error.message, 'error'); }
  }

  async function changeState(row, action) {
    try {
      await api(`/api/purchase-discounts/${row.id}/${action}`, { method: 'POST', body: {} });
      notify(action === 'confirm' ? '采购折让已确认' : '采购折让已取消');
      setViewing(null);
      await reload();
    } catch (error) { notify(error.message, 'error'); }
  }

  return <Panel title="采购折让" subtitle="DRAFT 编辑；确认时按来源应付原子扣减；不写凭证、不进审批中心">
    <Toolbar search={() => {}} placeholder="" action={can(user, 'PURCHASE_DISCOUNT_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建折让</button>}/>
    <p className="section-hint">折让金额不得超过来源应付剩余可折让额度（采购退货 + 历史折让之和不超过原应付）。</p>
    <div className="table-wrap"><table>
      <thead><tr><th>折让单号</th><th>状态</th><th>供应商</th><th>来源应付</th><th>业务日期</th><th className="number">折让金额</th><th>原因</th><th>创建人</th><th>确认时间</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id} className="clickable" onClick={() => void openDetail(row)}>
        <td className="mono">{row.discountNo}</td>
        <td><Status status={row.status} label={PURCHASE_STATUS_LABEL[row.status] || row.status}/></td>
        <td>{row.supplierName}</td>
        <td className="mono">{row.reason || '—'}</td>
        <td>{row.businessDate}</td>
        <td className="number">{quantity(row.amountCents)}</td>
        <td>{row.reason || '—'}</td>
        <td>{row.creatorName}</td>
        <td className="dim">{dateTime(row.confirmedAt)}</td>
      </tr>)}</tbody>
    </table>{!rows.length && <Empty text="没有采购折让记录"/>}</div>
    {editing && <PurchaseDiscountModal value={editing} notify={notify} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); notify('采购折让已保存'); }}/>}
    {viewing && <PurchaseDiscountDetail value={viewing} onClose={() => setViewing(null)} onEdit={() => { setViewing(null); setEditing(viewing); }} onAction={changeState}/>}
  </Panel>;
}

function PurchaseDiscountModal({ value, notify, onClose, onSaved }) {
  const [suppliers, setSuppliers] = useState([]);
  const [payables, setPayables] = useState([]);
  const [form, setForm] = useState({
    supplierId: value.supplier_id || '',
    sourcePayableId: value.source_payable_id || '',
    amountCents: value.amount_cents ? Number(value.amount_cents) : '',
    businessDate: value.business_date || today(),
    reason: value.reason || '',
    notes: value.notes || '',
  });

  useEffect(() => { void fetchSuppliers(notify).then(setSuppliers); }, []);
  useEffect(() => { void fetchPayablesForSupplier(form.supplierId).then(setPayables); }, [form.supplierId]);

  async function save(event) {
    event.preventDefault();
    try {
      const payload = {
        supplierId: form.supplierId,
        sourcePayableId: form.sourcePayableId,
        amountCents: Number(form.amountCents),
        businessDate: form.businessDate,
        reason: form.reason,
        notes: form.notes,
      };
      const url = value.id ? `/api/purchase-discounts/${value.id}` : '/api/purchase-discounts';
      const method = value.id ? 'PATCH' : 'POST';
      await api(url, { method, body: payload });
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  const selectedSource = payables.find((r) => r.id === form.sourcePayableId);

  return <Modal title={value.id ? '编辑采购折让' : '新建采购折让'} onClose={onClose} wide>
    <form onSubmit={save}>
      <div className="form-grid order-head">
        <label>供应商<select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value, sourcePayableId: '' })} required>
          <option value="">请选择供应商</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
        </select></label>
        <label>业务日期<input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} required/></label>
        <label className="full">来源应付<select value={form.sourcePayableId} onChange={(e) => setForm({ ...form, sourcePayableId: e.target.value })} required disabled={!form.supplierId}>
          <option value="">{form.supplierId ? '请选择来源应付' : '请先选择供应商'}</option>
          {payables.map((p) => <option key={p.id} value={p.id}>{p.documentNo} · {p.businessDate} · ¥{(p.amountCents / 100).toFixed(2)}</option>)}
        </select></label>
        {selectedSource && <div className="full detail-grid" style={{ marginBottom: 8 }}>
          <div><span>原应付金额</span><strong>¥{(Number(selectedSource.amountCents) / 100).toFixed(2)}</strong></div>
          <div><span>当前未付余额</span><strong>¥{(Number(selectedSource.outstandingCents) / 100).toFixed(2)}</strong></div>
        </div>}
        <label>折让金额（分）<input type="number" min="1" step="1" value={form.amountCents} onChange={(e) => setForm({ ...form, amountCents: e.target.value })} required/></label>
        <label className="full">原因<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} maxLength={200}/></label>
        <label className="full">备注<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={200}/></label>
      </div>
      <FormActions onClose={onClose} saveText="保存草稿"/>
    </form>
  </Modal>;
}

function PurchaseDiscountDetail({ value, onClose, onEdit, onAction }) {
  const navigation = useAppNavigation();
  const canViewPayables = navigation.canNavigate('accounts-payable');
  return <Modal title="采购折让详情" onClose={onClose} wide>
    <div className="detail-head"><div><span className="mono">{value.discount_no}</span><h3>{value.reason || '采购折让'}</h3><p>{value.notes || '—'}</p></div><Status status={value.status} label={value.statusLabel}/></div>
    <div className="detail-grid">
      <div><span>供应商</span><strong>{value.supplierName}</strong></div>
      <div><span>业务日期</span><strong>{value.business_date}</strong></div>
      <div><span>创建人</span><strong>{value.creatorName}</strong></div>
      <div><span>确认人</span><strong>{value.confirmedByName || '尚未确认'}</strong></div>
      <div><span>确认时间</span><strong>{dateTime(value.confirmed_at)}</strong></div>
      {value.status === 'CANCELLED' && <div><span>取消人</span><strong>{value.cancelledByName || '—'}</strong></div>}
      <div><span>折让金额</span><strong>¥{(value.amountCents / 100).toFixed(2)}</strong></div>
      <div><span>供应商当前净欠款</span><strong>¥{(value.supplierNetCents / 100).toFixed(2)}</strong></div>
    </div>
    <h4>来源应付</h4>
    {value.source ? <div className="detail-grid">
      <div><span>应付单号</span><strong>{value.source.documentNo}</strong></div>
      <div><span>业务日期</span><strong>{value.source.businessDate}</strong></div>
      <div><span>原应付</span><strong>¥{(value.source.amountCents / 100).toFixed(2)}</strong></div>
      <div><span>当前未付</span><strong>¥{(value.source.outstandingCents / 100).toFixed(2)}</strong></div>
    </div> : <Empty text="来源应付不存在"/>}
    <h4>来源额度</h4>
    <div className="detail-grid">
      <div><span>原应付金额</span><strong>¥{(value.sourceCapacity.originalCents / 100).toFixed(2)}</strong></div>
      <div><span>已使用额度</span><strong>¥{(value.sourceCapacity.consumedCents / 100).toFixed(2)}</strong></div>
      <div><span>剩余可折让</span><strong>¥{(value.sourceCapacity.remainingCents / 100).toFixed(2)}</strong></div>
    </div>
    {value.status === 'DRAFT' && <div className="form-actions">
      <button type="button" className="secondary" onClick={onClose}>关闭</button>
      <button type="button" className="row-action" onClick={onEdit}>编辑</button>
      <button type="button" className="danger-button" onClick={() => onAction(value, 'cancel')}>取消折让</button>
      <button type="button" className="approve-button" onClick={() => onAction(value, 'confirm')}>确认折让</button>
    </div>}
    {value.status === 'CONFIRMED' && canViewPayables && <p className="section-hint">折让已生成应付调整，可在<strong> 应付账款 </strong>按供应商查询。</p>}
    {value.status === 'CANCELLED' && <p className="section-hint">已取消的采购折让未对应付账款或凭证产生任何影响。</p>}
  </Modal>;
}

export default function Discounts({ user, notify, page }) {
  if (page === 'purchase-discounts') return <PurchaseDiscounts user={user} notify={notify}/>;
  return <SalesDiscounts user={user} notify={notify}/>;
}