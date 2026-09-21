import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Badge, Empty, FormActions, Loading, Modal, Panel, Toolbar, can } from '../components/ui.jsx';

function notifyError(notify, error, fallback) {
  const message = error?.message || (typeof error === 'string' ? error : fallback || '操作失败');
  notify(message, 'error');
}

const IQC_OQC_STATUSES = [
  { value: 'PENDING', label: '待检验' },
  { value: 'COMPLETED', label: '已完成' },
];
const IQC_OQC_RESULTS = [
  { value: 'PASS', label: '合格' },
  { value: 'FAIL', label: '不合格' },
];
const IQC_OQC_INSPECTION_TYPES = [
  { value: 'NORMAL', label: '常规' },
  { value: 'SAMPLING', label: '抽样' },
  { value: 'FULL', label: '全检' },
];

const STATUS_LABEL = Object.fromEntries(IQC_OQC_STATUSES.map((s) => [s.value, s.label]));
const RESULT_LABEL = Object.fromEntries(IQC_OQC_RESULTS.map((s) => [s.value, s.label]));
const TYPE_LABEL = Object.fromEntries(IQC_OQC_INSPECTION_TYPES.map((s) => [s.value, s.label]));

function statusBadgeType(status) {
  if (status === 'COMPLETED') return 'success';
  return 'draft';
}

function resultBadgeType(result) {
  if (result === 'PASS') return 'success';
  if (result === 'FAIL') return 'danger';
  return '';
}

function ensureNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function formatDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

// ============ IQC 来料检验 ============

export function IQCInspections({ user, notify }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    api(`/api/iqc${params.toString() ? `?${params}` : ''}`)
      .then((r) => setItems(r.inspections || []))
      .catch((e) => notifyError(notify, e, '加载检验单失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function viewDetail(item) {
    api(`/api/iqc/${item.id}`)
      .then((r) => setDetail(r.inspection))
      .catch((e) => notifyError(notify, e, '加载检验单详情失败'));
  }

  function handleSaved() {
    setEditing(null);
    setDetail(null);
    load();
    notify('检验单已保存', 'success');
  }

  function handleComplete(item) {
    const qualified = Number(prompt('合格数量', '0') || 0);
    if (!Number.isFinite(qualified) || qualified < 0) { notify('合格数量必须为非负数', 'error'); return; }
    const reject = Number(prompt('不合格数量', '0') || 0);
    if (!Number.isFinite(reject) || reject < 0) { notify('不合格数量必须为非负数', 'error'); return; }
    const resultRaw = prompt('检验结果 (PASS / FAIL)', 'PASS');
    if (!IQC_OQC_RESULTS.some((r) => r.value === resultRaw)) { notify('请选择检验结果', 'error'); return; }
    api(`/api/iqc/${item.id}/complete`, { method: 'POST', body: { result: resultRaw, qualified_quantity: qualified, reject_quantity: reject } })
      .then(() => { notify('检验单已完成', 'success'); load(); })
      .catch((e) => notifyError(notify, e, '完成检验单失败'));
  }

  return (
    <Panel title="IQC 来料检验" subtitle="来料质量检验管理">
      <Toolbar action={can(user, 'IQC_MANAGE') && <button className="primary" onClick={() => setEditing({ mode: 'create' })}>＋ 新建检验单</button>} />
      <div className="filters">
        <label>状态
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部</option>
            {IQC_OQC_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <button onClick={load}>查询</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>检验单号</th>
              <th>创建时间</th>
              <th>供应商</th>
              <th>检验员</th>
              <th>送检数量</th>
              <th>抽样数量</th>
              <th>状态</th>
              <th>结果</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.iqc_no}</td>
                <td>{formatDate(item.created_at)}</td>
                <td>{item.supplier_name}</td>
                <td>{item.inspector_name}</td>
                <td>{ensureNumber(item.total_quantity)}</td>
                <td>{ensureNumber(item.sample_quantity)}</td>
                <td><Badge type={statusBadgeType(item.status)}>{STATUS_LABEL[item.status] || item.status}</Badge></td>
                <td>{item.result ? <Badge type={resultBadgeType(item.result)}>{RESULT_LABEL[item.result] || item.result}</Badge> : '—'}</td>
                <td>
                  <button className="row-action" onClick={() => viewDetail(item)}>详情</button>
                  {can(user, 'IQC_MANAGE') && item.status === 'PENDING' && (
                    <>
                      <button className="row-action" onClick={() => setEditing({ mode: 'edit', id: item.id })}>编辑</button>
                      <button className="row-action" onClick={() => handleComplete(item)}>完成</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !items.length && <Empty text="暂无检验记录" />}
        {loading && <Loading />}
      </div>
      {editing && (
        <IQCModal
          user={user}
          notify={notify}
          mode={editing.mode}
          inspectionId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      {detail && <IQCDetailModal inspection={detail} onClose={() => setDetail(null)} />}
    </Panel>
  );
}

function IQCModal({ user, notify, mode, inspectionId, onClose, onSaved }) {
  const [form, setForm] = useState({
    supplier_id: '',
    inspection_type: 'NORMAL',
    total_quantity: 0,
    sample_quantity: 0,
    qualified_quantity: 0,
    reject_quantity: 0,
    remark: '',
    items: [{ product_id: '', batch_no: '', quantity: 0, sample_size: 0, qualified: 1, reject_reason: '' }],
  });
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const isEdit = mode === 'edit' && inspectionId;

  useEffect(() => {
    setLoadError(null);
    api('/api/lookup/suppliers')
      .then((r) => setSuppliers(r.suppliers || []))
      .catch((e) => setLoadError(`供应商加载失败: ${e.message}`));
    api('/api/products')
      .then((r) => setProducts(r.products || []))
      .catch((e) => setLoadError(`产品加载失败: ${e.message}`));
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    api(`/api/iqc/${inspectionId}`)
      .then((r) => {
        const inspection = r.inspection || {};
        setForm({
          supplier_id: inspection.supplier_id || '',
          inspection_type: inspection.inspection_type || 'NORMAL',
          total_quantity: ensureNumber(inspection.total_quantity),
          sample_quantity: ensureNumber(inspection.sample_quantity),
          qualified_quantity: ensureNumber(inspection.qualified_quantity),
          reject_quantity: ensureNumber(inspection.reject_quantity),
          remark: inspection.remark || '',
          items: (inspection.items || []).map((item) => ({
            product_id: item.product_id || '',
            batch_no: item.batch_no || '',
            quantity: ensureNumber(item.quantity),
            sample_size: ensureNumber(item.sample_size),
            qualified: Number(item.qualified) === 1 ? 1 : 0,
            reject_reason: item.reject_reason || '',
          })),
        });
      })
      .catch((e) => setLoadError(`加载检验单失败: ${e.message}`));
  }, [isEdit, inspectionId]);

  function setItem(i, field, value) {
    setForm((f) => {
      const items = [...f.items];
      items[i] = { ...items[i], [field]: value };
      return { ...f, items };
    });
  }

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { product_id: '', batch_no: '', quantity: 0, sample_size: 0, qualified: 1, reject_reason: '' }] }));
  }

  function removeItem(i) {
    setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  }

  async function save(e) {
    e.preventDefault();
    if (!form.supplier_id) { notify('供应商不能为空', 'error'); return; }
    if (!form.items.length) { notify('至少需要一条检验明细', 'error'); return; }
    for (let i = 0; i < form.items.length; i++) {
      const item = form.items[i];
      if (!item.product_id) { notify(`第 ${i + 1} 行产品不能为空`, 'error'); return; }
      if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 0) {
        notify(`第 ${i + 1} 行数量必须为非负数`, 'error'); return;
      }
      if (!Number.isFinite(Number(item.sample_size)) || Number(item.sample_size) < 0) {
        notify(`第 ${i + 1} 行抽样数必须为非负数`, 'error'); return;
      }
      if (Number(item.sample_size) > Number(item.quantity)) {
        notify(`第 ${i + 1} 行抽样数不能大于数量`, 'error'); return;
      }
    }
    try {
      if (isEdit) {
        await api(`/api/iqc/${inspectionId}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/iqc', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) {
      notifyError(notify, error, '保存失败');
    }
  }

  return (
    <Modal title={isEdit ? '编辑来料检验单' : '新建来料检验单'} onClose={onClose} wide>
      <form onSubmit={save}>
        {loadError && <div className="form-error">{loadError}</div>}
        <div className="form-grid">
          <label>供应商
            <select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} required>
              <option value="">选择供应商</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
            </select>
          </label>
          <label>检验类型
            <select value={form.inspection_type} onChange={(e) => setForm({ ...form, inspection_type: e.target.value })}>
              {IQC_OQC_INSPECTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label>送检数量
            <input type="number" min="0" step="1" value={form.total_quantity} onChange={(e) => setForm({ ...form, total_quantity: Number(e.target.value) })} required />
          </label>
          <label>抽样数量
            <input type="number" min="0" step="1" value={form.sample_quantity} onChange={(e) => setForm({ ...form, sample_quantity: Number(e.target.value) })} required />
          </label>
          <label>合格数量
            <input type="number" min="0" step="1" value={form.qualified_quantity} onChange={(e) => setForm({ ...form, qualified_quantity: Number(e.target.value) })} />
          </label>
          <label>不合格数量
            <input type="number" min="0" step="1" value={form.reject_quantity} onChange={(e) => setForm({ ...form, reject_quantity: Number(e.target.value) })} />
          </label>
          <label className="full">备注
            <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
          </label>
        </div>
        <h4>检验明细</h4>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>产品</th>
                <th>批次</th>
                <th>数量</th>
                <th>抽样数</th>
                <th>是否合格</th>
                <th>不合格原因</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {form.items.map((item, i) => (
                <tr key={i}>
                  <td>
                    <select value={item.product_id} onChange={(e) => setItem(i, 'product_id', e.target.value)} required>
                      <option value="">选择产品</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <input value={item.batch_no} onChange={(e) => setItem(i, 'batch_no', e.target.value)} />
                  </td>
                  <td>
                    <input type="number" min="0" step="1" value={item.quantity} onChange={(e) => setItem(i, 'quantity', Number(e.target.value))} required />
                  </td>
                  <td>
                    <input type="number" min="0" step="1" value={item.sample_size} onChange={(e) => setItem(i, 'sample_size', Number(e.target.value))} />
                  </td>
                  <td>
                    <select value={item.qualified} onChange={(e) => setItem(i, 'qualified', Number(e.target.value))}>
                      <option value={1}>合格</option>
                      <option value={0}>不合格</option>
                    </select>
                  </td>
                  <td>
                    <input value={item.reject_reason} onChange={(e) => setItem(i, 'reject_reason', e.target.value)} />
                  </td>
                  <td>
                    <button type="button" className="danger-button" onClick={() => removeItem(i)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="secondary" onClick={addItem}>+ 添加明细</button>
        <div className="form-section-head">检验员: {user?.displayName || user?.username || '当前用户'}</div>
        <FormActions onClose={onClose} saveText={isEdit ? '保存修改' : '创建'} />
      </form>
    </Modal>
  );
}

function IQCDetailModal({ inspection, onClose }) {
  return (
    <Modal title={`来料检验单详情 - ${inspection.iqc_no}`} onClose={onClose} wide>
      <div className="detail-grid">
        <div>供应商: {inspection.supplier_name}</div>
        <div>创建时间: {formatDate(inspection.created_at)}</div>
        <div>检验员: {inspection.inspector_name}</div>
        <div>状态: <Badge type={statusBadgeType(inspection.status)}>{STATUS_LABEL[inspection.status] || inspection.status}</Badge></div>
        <div>结果: {inspection.result ? <Badge type={resultBadgeType(inspection.result)}>{RESULT_LABEL[inspection.result] || inspection.result}</Badge> : '—'}</div>
        <div>送检数量: {ensureNumber(inspection.total_quantity)}</div>
        <div>抽样数量: {ensureNumber(inspection.sample_quantity)}</div>
        <div>合格数量: {ensureNumber(inspection.qualified_quantity)}</div>
        <div>不合格数量: {ensureNumber(inspection.reject_quantity)}</div>
        <div>检验类型: {TYPE_LABEL[inspection.inspection_type] || inspection.inspection_type}</div>
        <div className="full">备注: {inspection.remark || '—'}</div>
      </div>
      <h4>检验明细</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>产品</th>
              <th>批次</th>
              <th>数量</th>
              <th>抽样数</th>
              <th>是否合格</th>
              <th>不合格原因</th>
            </tr>
          </thead>
          <tbody>
            {(inspection.items || []).map((item) => (
              <tr key={item.id}>
                <td>{item.product_code} - {item.product_name}</td>
                <td>{item.batch_no || '—'}</td>
                <td>{ensureNumber(item.quantity)}</td>
                <td>{ensureNumber(item.sample_size)}</td>
                <td><Badge type={item.qualified === 1 ? 'success' : 'danger'}>{item.qualified === 1 ? '合格' : '不合格'}</Badge></td>
                <td>{item.reject_reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FormActions onClose={onClose} saveText="关闭" />
    </Modal>
  );
}

// ============ OQC 出货检验 ============

export function OQCInspections({ user, notify }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    api(`/api/oqc${params.toString() ? `?${params}` : ''}`)
      .then((r) => setItems(r.inspections || []))
      .catch((e) => notifyError(notify, e, '加载检验单失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function viewDetail(item) {
    api(`/api/oqc/${item.id}`)
      .then((r) => setDetail(r.inspection))
      .catch((e) => notifyError(notify, e, '加载检验单详情失败'));
  }

  function handleSaved() {
    setEditing(null);
    setDetail(null);
    load();
    notify('检验单已保存', 'success');
  }

  function handleComplete(item) {
    const qualified = Number(prompt('合格数量', '0') || 0);
    if (!Number.isFinite(qualified) || qualified < 0) { notify('合格数量必须为非负数', 'error'); return; }
    const reject = Number(prompt('不合格数量', '0') || 0);
    if (!Number.isFinite(reject) || reject < 0) { notify('不合格数量必须为非负数', 'error'); return; }
    const resultRaw = prompt('检验结果 (PASS / FAIL)', 'PASS');
    if (!IQC_OQC_RESULTS.some((r) => r.value === resultRaw)) { notify('请选择检验结果', 'error'); return; }
    api(`/api/oqc/${item.id}/complete`, { method: 'POST', body: { result: resultRaw, qualified_quantity: qualified, reject_quantity: reject } })
      .then(() => { notify('检验单已完成', 'success'); load(); })
      .catch((e) => notifyError(notify, e, '完成检验单失败'));
  }

  return (
    <Panel title="OQC 出货检验" subtitle="出货质量检验管理">
      <Toolbar action={can(user, 'OQC_MANAGE') && <button className="primary" onClick={() => setEditing({ mode: 'create' })}>＋ 新建检验单</button>} />
      <div className="filters">
        <label>状态
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部</option>
            {IQC_OQC_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <button onClick={load}>查询</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>检验单号</th>
              <th>创建时间</th>
              <th>客户</th>
              <th>检验员</th>
              <th>送检数量</th>
              <th>抽样数量</th>
              <th>状态</th>
              <th>结果</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.oqc_no}</td>
                <td>{formatDate(item.created_at)}</td>
                <td>{item.customer_name}</td>
                <td>{item.inspector_name}</td>
                <td>{ensureNumber(item.total_quantity)}</td>
                <td>{ensureNumber(item.sample_quantity)}</td>
                <td><Badge type={statusBadgeType(item.status)}>{STATUS_LABEL[item.status] || item.status}</Badge></td>
                <td>{item.result ? <Badge type={resultBadgeType(item.result)}>{RESULT_LABEL[item.result] || item.result}</Badge> : '—'}</td>
                <td>
                  <button className="row-action" onClick={() => viewDetail(item)}>详情</button>
                  {can(user, 'OQC_MANAGE') && item.status === 'PENDING' && (
                    <>
                      <button className="row-action" onClick={() => setEditing({ mode: 'edit', id: item.id })}>编辑</button>
                      <button className="row-action" onClick={() => handleComplete(item)}>完成</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !items.length && <Empty text="暂无检验记录" />}
        {loading && <Loading />}
      </div>
      {editing && (
        <OQCModal
          user={user}
          notify={notify}
          mode={editing.mode}
          inspectionId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      {detail && <OQCDetailModal inspection={detail} onClose={() => setDetail(null)} />}
    </Panel>
  );
}

function OQCModal({ user, notify, mode, inspectionId, onClose, onSaved }) {
  const [form, setForm] = useState({
    customer_id: '',
    inspection_type: 'NORMAL',
    total_quantity: 0,
    sample_quantity: 0,
    qualified_quantity: 0,
    reject_quantity: 0,
    remark: '',
    items: [{ product_id: '', batch_no: '', quantity: 0, sample_size: 0, qualified: 1, reject_reason: '' }],
  });
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const isEdit = mode === 'edit' && inspectionId;

  useEffect(() => {
    setLoadError(null);
    api('/api/lookup/customers')
      .then((r) => setCustomers(r.customers || []))
      .catch((e) => setLoadError(`客户加载失败: ${e.message}`));
    api('/api/products')
      .then((r) => setProducts(r.products || []))
      .catch((e) => setLoadError(`产品加载失败: ${e.message}`));
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    api(`/api/oqc/${inspectionId}`)
      .then((r) => {
        const inspection = r.inspection || {};
        setForm({
          customer_id: inspection.customer_id || '',
          inspection_type: inspection.inspection_type || 'NORMAL',
          total_quantity: ensureNumber(inspection.total_quantity),
          sample_quantity: ensureNumber(inspection.sample_quantity),
          qualified_quantity: ensureNumber(inspection.qualified_quantity),
          reject_quantity: ensureNumber(inspection.reject_quantity),
          remark: inspection.remark || '',
          items: (inspection.items || []).map((item) => ({
            product_id: item.product_id || '',
            batch_no: item.batch_no || '',
            quantity: ensureNumber(item.quantity),
            sample_size: ensureNumber(item.sample_size),
            qualified: Number(item.qualified) === 1 ? 1 : 0,
            reject_reason: item.reject_reason || '',
          })),
        });
      })
      .catch((e) => setLoadError(`加载检验单失败: ${e.message}`));
  }, [isEdit, inspectionId]);

  function setItem(i, field, value) {
    setForm((f) => {
      const items = [...f.items];
      items[i] = { ...items[i], [field]: value };
      return { ...f, items };
    });
  }

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { product_id: '', batch_no: '', quantity: 0, sample_size: 0, qualified: 1, reject_reason: '' }] }));
  }

  function removeItem(i) {
    setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  }

  async function save(e) {
    e.preventDefault();
    if (!form.customer_id) { notify('客户不能为空', 'error'); return; }
    if (!form.items.length) { notify('至少需要一条检验明细', 'error'); return; }
    for (let i = 0; i < form.items.length; i++) {
      const item = form.items[i];
      if (!item.product_id) { notify(`第 ${i + 1} 行产品不能为空`, 'error'); return; }
      if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 0) {
        notify(`第 ${i + 1} 行数量必须为非负数`, 'error'); return;
      }
      if (!Number.isFinite(Number(item.sample_size)) || Number(item.sample_size) < 0) {
        notify(`第 ${i + 1} 行抽样数必须为非负数`, 'error'); return;
      }
      if (Number(item.sample_size) > Number(item.quantity)) {
        notify(`第 ${i + 1} 行抽样数不能大于数量`, 'error'); return;
      }
    }
    try {
      if (isEdit) {
        await api(`/api/oqc/${inspectionId}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/oqc', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) {
      notifyError(notify, error, '保存失败');
    }
  }

  return (
    <Modal title={isEdit ? '编辑出货检验单' : '新建出货检验单'} onClose={onClose} wide>
      <form onSubmit={save}>
        {loadError && <div className="form-error">{loadError}</div>}
        <div className="form-grid">
          <label>客户
            <select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} required>
              <option value="">选择客户</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
            </select>
          </label>
          <label>检验类型
            <select value={form.inspection_type} onChange={(e) => setForm({ ...form, inspection_type: e.target.value })}>
              {IQC_OQC_INSPECTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label>送检数量
            <input type="number" min="0" step="1" value={form.total_quantity} onChange={(e) => setForm({ ...form, total_quantity: Number(e.target.value) })} required />
          </label>
          <label>抽样数量
            <input type="number" min="0" step="1" value={form.sample_quantity} onChange={(e) => setForm({ ...form, sample_quantity: Number(e.target.value) })} required />
          </label>
          <label>合格数量
            <input type="number" min="0" step="1" value={form.qualified_quantity} onChange={(e) => setForm({ ...form, qualified_quantity: Number(e.target.value) })} />
          </label>
          <label>不合格数量
            <input type="number" min="0" step="1" value={form.reject_quantity} onChange={(e) => setForm({ ...form, reject_quantity: Number(e.target.value) })} />
          </label>
          <label className="full">备注
            <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} />
          </label>
        </div>
        <h4>检验明细</h4>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>产品</th>
                <th>批次</th>
                <th>数量</th>
                <th>抽样数</th>
                <th>是否合格</th>
                <th>不合格原因</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {form.items.map((item, i) => (
                <tr key={i}>
                  <td>
                    <select value={item.product_id} onChange={(e) => setItem(i, 'product_id', e.target.value)} required>
                      <option value="">选择产品</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <input value={item.batch_no} onChange={(e) => setItem(i, 'batch_no', e.target.value)} />
                  </td>
                  <td>
                    <input type="number" min="0" step="1" value={item.quantity} onChange={(e) => setItem(i, 'quantity', Number(e.target.value))} required />
                  </td>
                  <td>
                    <input type="number" min="0" step="1" value={item.sample_size} onChange={(e) => setItem(i, 'sample_size', Number(e.target.value))} />
                  </td>
                  <td>
                    <select value={item.qualified} onChange={(e) => setItem(i, 'qualified', Number(e.target.value))}>
                      <option value={1}>合格</option>
                      <option value={0}>不合格</option>
                    </select>
                  </td>
                  <td>
                    <input value={item.reject_reason} onChange={(e) => setItem(i, 'reject_reason', e.target.value)} />
                  </td>
                  <td>
                    <button type="button" className="danger-button" onClick={() => removeItem(i)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="secondary" onClick={addItem}>+ 添加明细</button>
        <div className="form-section-head">检验员: {user?.displayName || user?.username || '当前用户'}</div>
        <FormActions onClose={onClose} saveText={isEdit ? '保存修改' : '创建'} />
      </form>
    </Modal>
  );
}

function OQCDetailModal({ inspection, onClose }) {
  return (
    <Modal title={`出货检验单详情 - ${inspection.oqc_no}`} onClose={onClose} wide>
      <div className="detail-grid">
        <div>客户: {inspection.customer_name}</div>
        <div>创建时间: {formatDate(inspection.created_at)}</div>
        <div>检验员: {inspection.inspector_name}</div>
        <div>状态: <Badge type={statusBadgeType(inspection.status)}>{STATUS_LABEL[inspection.status] || inspection.status}</Badge></div>
        <div>结果: {inspection.result ? <Badge type={resultBadgeType(inspection.result)}>{RESULT_LABEL[inspection.result] || inspection.result}</Badge> : '—'}</div>
        <div>送检数量: {ensureNumber(inspection.total_quantity)}</div>
        <div>抽样数量: {ensureNumber(inspection.sample_quantity)}</div>
        <div>合格数量: {ensureNumber(inspection.qualified_quantity)}</div>
        <div>不合格数量: {ensureNumber(inspection.reject_quantity)}</div>
        <div>检验类型: {TYPE_LABEL[inspection.inspection_type] || inspection.inspection_type}</div>
        <div className="full">备注: {inspection.remark || '—'}</div>
      </div>
      <h4>检验明细</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>产品</th>
              <th>批次</th>
              <th>数量</th>
              <th>抽样数</th>
              <th>是否合格</th>
              <th>不合格原因</th>
            </tr>
          </thead>
          <tbody>
            {(inspection.items || []).map((item) => (
              <tr key={item.id}>
                <td>{item.product_code} - {item.product_name}</td>
                <td>{item.batch_no || '—'}</td>
                <td>{ensureNumber(item.quantity)}</td>
                <td>{ensureNumber(item.sample_size)}</td>
                <td><Badge type={item.qualified === 1 ? 'success' : 'danger'}>{item.qualified === 1 ? '合格' : '不合格'}</Badge></td>
                <td>{item.reject_reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FormActions onClose={onClose} saveText="关闭" />
    </Modal>
  );
}
