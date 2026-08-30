import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Active, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, can, dateTime, money } from '../components/ui.jsx';

export function IQCInspections({ user, notify }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ status });
    api(`/api/iqc?${params}`).then((r) => setItems(r.inspections)).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => { void load(); }, []);

  function viewDetail(item) {
    api(`/api/iqc/${item.id}`).then((r) => setDetail(r.inspection)).catch((e) => notify(e.message, 'error'));
  }

  const statusMap = { PENDING: '待检验', PASSED: '合格', FAILED: '不合格', ACCEPTED_WITH_REMARK: '让步接收' };
  const resultMap = { PASS: '合格', FAIL: '不合格', ACCEPT: '让步接收' };

  return (
    <Panel title="IQC来料检验" subtitle="来料质量检验管理">
      <Toolbar action={can(user, 'QC_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建检验单</button>}/>
      <div className="filters">
        <label>状态<select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部</option>
          <option value="PENDING">待检验</option>
          <option value="PASSED">合格</option>
          <option value="FAILED">不合格</option>
          <option value="ACCEPTED_WITH_REMARK">让步接收</option>
        </select></label>
        <button onClick={load}>查询</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>检验单号</th><th>检验日期</th><th>供应商</th><th>检验员</th><th>状态</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.inspection_no}</td>
                <td>{item.inspection_date}</td>
                <td>{item.supplierName}</td>
                <td>{item.inspectorName}</td>
                <td><Badge type={item.status === 'PASSED' ? 'success' : item.status === 'FAILED' ? 'danger' : ''}>{statusMap[item.status]}</Badge></td>
                <td>
                  <button className="row-action" onClick={() => viewDetail(item)}>详情</button>
                  {can(user, 'QC_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无检验记录"/>}
      </div>
      {editing && <IQCModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('检验单已保存'); }} />}
      {detail && <IQCDetailModal inspection={detail} onClose={() => setDetail(null)} />}
    </Panel>
  );
}

function IQCModal({ value, onClose, onSaved }) {
  const [form, setForm] = useState({
    source_type: 'MANUAL', source_id: '', supplier_id: '', inspector_id: user?.id || '',
    inspection_date: new Date().toISOString().slice(0, 10), items: [{ product_id: '', quantity: 0 }], remark: ''
  });
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [inspectors, setInspectors] = useState([]);

  useEffect(() => {
    api('/api/suppliers').then((r) => setSuppliers(r.suppliers || []));
    api('/api/products').then((r) => setProducts(r.products || []));
    if (value.id) {
      api(`/api/iqc/${value.id}`).then((r) => setForm({ ...form, ...r.inspection, items: r.inspection.items || [] }));
    }
  }, []);

  function addItem() { setForm((f) => ({ ...f, items: [...f.items, { product_id: '', quantity: 0 }] })); }
  function removeItem(i) { setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) })); }
  function updateItem(i, field, val) {
    const items = [...form.items];
    items[i] = { ...items[i], [field]: val };
    setForm((f) => ({ ...f, items }));
  }

  async function save(e) {
    e.preventDefault();
    try {
      if (value.id) {
        await api(`/api/iqc/${value.id}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/iqc', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title={value.id ? '编辑检验单' : '新建检验单'} onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="form-grid">
          <label>供应商<select value={form.supplier_id} onChange={(e) => setForm({...form, supplier_id: e.target.value})} required>
            <option value="">选择供应商</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
          </select></label>
          <label>检验日期<input type="date" value={form.inspection_date} onChange={(e) => setForm({...form, inspection_date: e.target.value})} required/></label>
          <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
        </div>
        <h4>检验明细</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>产品</th><th>数量</th><th>抽样数</th><th>合格数</th><th>不合格数</th><th>结果</th><th></th></tr></thead>
            <tbody>
              {form.items.map((item, i) => (
                <tr key={i}>
                  <td><select value={item.product_id} onChange={(e) => updateItem(i, 'product_id', e.target.value)} required>
                    <option value="">选择产品</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                  </select></td>
                  <td><input type="number" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', Number(e.target.value))} required/></td>
                  <td><input type="number" value={item.sampled_quantity} onChange={(e) => updateItem(i, 'sampled_quantity', Number(e.target.value))}/></td>
                  <td><input type="number" value={item.qualified_quantity} onChange={(e) => updateItem(i, 'qualified_quantity', Number(e.target.value))}/></td>
                  <td><input type="number" value={item.defective_quantity} onChange={(e) => updateItem(i, 'defective_quantity', Number(e.target.value))}/></td>
                  <td><select value={item.inspection_result} onChange={(e) => updateItem(i, 'inspection_result', e.target.value)}>
                    <option value="PASS">合格</option>
                    <option value="FAIL">不合格</option>
                    <option value="ACCEPT">让步接收</option>
                  </select></td>
                  <td><button type="button" className="danger-button" onClick={() => removeItem(i)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="secondary" onClick={addItem}>+ 添加明细</button>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

function IQCDetailModal({ inspection, onClose }) {
  const resultMap = { PASS: '合格', FAIL: '不合格', ACCEPT: '让步接收' };
  const statusMap = { PENDING: '待检验', PASSED: '合格', FAILED: '不合格', ACCEPTED_WITH_REMARK: '让步接收' };
  return (
    <Modal title={`检验单详情 - ${inspection.inspection_no}`} onClose={onClose} wide>
      <div className="detail-grid">
        <div>供应商: {inspection.supplierName}</div>
        <div>检验日期: {inspection.inspection_date}</div>
        <div>检验员: {inspection.inspectorName}</div>
        <div>状态: <Badge type={inspection.status === 'PASSED' ? 'success' : inspection.status === 'FAILED' ? 'danger' : ''}>{statusMap[inspection.status]}</Badge></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>产品</th><th>数量</th><th>抽样数</th><th>合格数</th><th>不合格数</th><th>不合格率</th><th>结果</th></tr></thead>
          <tbody>
            {inspection.items?.map((item) => (
              <tr key={item.id}>
                <td>{item.productCode} - {item.productName}</td>
                <td>{item.quantity}</td>
                <td>{item.sampled_quantity}</td>
                <td>{item.qualified_quantity}</td>
                <td>{item.defective_quantity}</td>
                <td>{(item.defect_rate * 100).toFixed(2)}%</td>
                <td><Badge type={item.inspection_result === 'PASS' ? 'success' : 'danger'}>{resultMap[item.inspection_result]}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FormActions onClose={onClose}/>
    </Modal>
  );
}

// ============ OQC Inspections ============

export function OQCInspections({ user, notify }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ status });
    api(`/api/oqc?${params}`).then((r) => setItems(r.inspections)).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => { void load(); }, []);

  function viewDetail(item) {
    api(`/api/oqc/${item.id}`).then((r) => setDetail(r.inspection)).catch((e) => notify(e.message, 'error'));
  }

  const statusMap = { PENDING: '待检验', PASSED: '合格', FAILED: '不合格', ACCEPTED_WITH_REMARK: '让步接收' };

  return (
    <Panel title="OQC出货检验" subtitle="出货质量检验管理">
      <Toolbar action={can(user, 'QC_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建检验单</button>}/>
      <div className="filters">
        <label>状态<select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部</option>
          <option value="PENDING">待检验</option>
          <option value="PASSED">合格</option>
          <option value="FAILED">不合格</option>
        </select></label>
        <button onClick={load}>查询</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>检验单号</th><th>检验日期</th><th>客户</th><th>检验员</th><th>状态</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.inspection_no}</td>
                <td>{item.inspection_date}</td>
                <td>{item.customerName}</td>
                <td>{item.inspectorName}</td>
                <td><Badge type={item.status === 'PASSED' ? 'success' : item.status === 'FAILED' ? 'danger' : ''}>{statusMap[item.status]}</Badge></td>
                <td>
                  <button className="row-action" onClick={() => viewDetail(item)}>详情</button>
                  {can(user, 'QC_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无检验记录"/>}
      </div>
      {editing && <OQCModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('检验单已保存'); }} />}
      {detail && <OQCDetailModal inspection={detail} onClose={() => setDetail(null)} />}
    </Panel>
  );
}

function OQCModal({ value, onClose, onSaved }) {
  const [form, setForm] = useState({
    source_type: 'MANUAL', source_id: '', customer_id: '', inspector_id: user?.id || '',
    inspection_date: new Date().toISOString().slice(0, 10), items: [{ product_id: '', quantity: 0 }], remark: ''
  });
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);

  useEffect(() => {
    api('/api/customers').then((r) => setCustomers(r.customers || []));
    api('/api/products').then((r) => setProducts(r.products || []));
    if (value.id) {
      api(`/api/oqc/${value.id}`).then((r) => setForm({ ...form, ...r.inspection, items: r.inspection.items || [] }));
    }
  }, []);

  function addItem() { setForm((f) => ({ ...f, items: [...f.items, { product_id: '', quantity: 0 }] })); }
  function removeItem(i) { setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) })); }
  function updateItem(i, field, val) {
    const items = [...form.items];
    items[i] = { ...items[i], [field]: val };
    setForm((f) => ({ ...f, items }));
  }

  async function save(e) {
    e.preventDefault();
    try {
      if (value.id) {
        await api(`/api/oqc/${value.id}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/oqc', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title={value.id ? '编辑检验单' : '新建检验单'} onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="form-grid">
          <label>客户<select value={form.customer_id} onChange={(e) => setForm({...form, customer_id: e.target.value})} required>
            <option value="">选择客户</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
          </select></label>
          <label>检验日期<input type="date" value={form.inspection_date} onChange={(e) => setForm({...form, inspection_date: e.target.value})} required/></label>
          <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
        </div>
        <h4>检验明细</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>产品</th><th>数量</th><th>抽样数</th><th>合格数</th><th>不合格数</th><th>结果</th><th></th></tr></thead>
            <tbody>
              {form.items.map((item, i) => (
                <tr key={i}>
                  <td><select value={item.product_id} onChange={(e) => updateItem(i, 'product_id', e.target.value)} required>
                    <option value="">选择产品</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                  </select></td>
                  <td><input type="number" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', Number(e.target.value))} required/></td>
                  <td><input type="number" value={item.sampled_quantity} onChange={(e) => updateItem(i, 'sampled_quantity', Number(e.target.value))}/></td>
                  <td><input type="number" value={item.qualified_quantity} onChange={(e) => updateItem(i, 'qualified_quantity', Number(e.target.value))}/></td>
                  <td><input type="number" value={item.defective_quantity} onChange={(e) => updateItem(i, 'defective_quantity', Number(e.target.value))}/></td>
                  <td><select value={item.inspection_result} onChange={(e) => updateItem(i, 'inspection_result', e.target.value)}>
                    <option value="PASS">合格</option>
                    <option value="FAIL">不合格</option>
                  </select></td>
                  <td><button type="button" className="danger-button" onClick={() => removeItem(i)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="secondary" onClick={addItem}>+ 添加明细</button>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

function OQCDetailModal({ inspection, onClose }) {
  const resultMap = { PASS: '合格', FAIL: '不合格', ACCEPT: '让步接收' };
  const statusMap = { PENDING: '待检验', PASSED: '合格', FAILED: '不合格' };
  return (
    <Modal title={`检验单详情 - ${inspection.inspection_no}`} onClose={onClose} wide>
      <div className="detail-grid">
        <div>客户: {inspection.customerName}</div>
        <div>检验日期: {inspection.inspection_date}</div>
        <div>检验员: {inspection.inspectorName}</div>
        <div>状态: <Badge type={inspection.status === 'PASSED' ? 'success' : inspection.status === 'FAILED' ? 'danger' : ''}>{statusMap[inspection.status]}</Badge></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>产品</th><th>数量</th><th>抽样数</th><th>合格数</th><th>不合格数</th><th>结果</th></tr></thead>
          <tbody>
            {inspection.items?.map((item) => (
              <tr key={item.id}>
                <td>{item.productCode} - {item.productName}</td>
                <td>{item.quantity}</td>
                <td>{item.sampled_quantity}</td>
                <td>{item.qualified_quantity}</td>
                <td>{item.defective_quantity}</td>
                <td><Badge type={item.inspection_result === 'PASS' ? 'success' : 'danger'}>{resultMap[item.inspection_result]}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FormActions onClose={onClose}/>
    </Modal>
  );
}
// ============ Contacts ============
