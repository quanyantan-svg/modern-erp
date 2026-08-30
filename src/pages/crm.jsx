import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Active, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, can, dateTime, money } from '../components/ui.jsx';

export function Contacts({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ search });
    api(`/api/contacts?${params}`).then((r) => setItems(r.contacts)).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => { void load(); }, []);

  return (
    <Panel title="联系人管理" subtitle="客户和供应商联系人档案">
      <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索姓名或电话" action={can(user, 'CRM_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增联系人</button>}/>
      <div className="table-wrap">
        <table>
          <thead><tr><th>姓名</th><th>性别</th><th>职位</th><th>电话</th><th>手机</th><th>邮箱</th><th>所属单位</th><th>主联系人</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong></td>
                <td>{item.gender === 'MALE' ? '男' : item.gender === 'FEMALE' ? '女' : '-'}</td>
                <td>{item.position || '-'}</td>
                <td>{item.phone || '-'}</td>
                <td>{item.mobile || '-'}</td>
                <td>{item.email || '-'}</td>
                <td>{item.customerName || item.supplierName || '-'}</td>
                <td>{item.is_primary ? '是' : ''}</td>
                <td>{can(user, 'CRM_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无联系人"/>}
      </div>
      {editing && <ContactModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('联系人已保存'); }} />}
    </Panel>
  );
}

function ContactModal({ value, onClose, onSaved }) {
  const [form, setForm] = useState({
    customer_id: '', supplier_id: '', name: '', gender: '', position: '', phone: '', mobile: '', email: '', wechat: '', birthday: '', remark: '', is_primary: false, ...value
  });
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);

  useEffect(() => {
    api('/api/customers').then((r) => setCustomers(r.customers || []));
    api('/api/suppliers').then((r) => setSuppliers(r.suppliers || []));
  }, []);

  async function save(e) {
    e.preventDefault();
    try {
      if (value.id) {
        await api(`/api/contacts/${value.id}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/contacts', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title={value.id ? '编辑联系人' : '新增联系人'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>姓名<input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} required/></label>
        <label>性别<select value={form.gender} onChange={(e) => setForm({...form, gender: e.target.value})}>
          <option value="">未选择</option>
          <option value="MALE">男</option>
          <option value="FEMALE">女</option>
        </select></label>
        <label>职位<input value={form.position} onChange={(e) => setForm({...form, position: e.target.value})}/></label>
        <label>电话<input value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})}/></label>
        <label>手机<input value={form.mobile} onChange={(e) => setForm({...form, mobile: e.target.value})}/></label>
        <label>邮箱<input type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})}/></label>
        <label>微信<input value={form.wechat} onChange={(e) => setForm({...form, wechat: e.target.value})}/></label>
        <label>生日<input type="date" value={form.birthday} onChange={(e) => setForm({...form, birthday: e.target.value})}/></label>
        <label>客户<select value={form.customer_id} onChange={(e) => setForm({...form, customer_id: e.target.value, supplier_id: ''})}>
          <option value="">无</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
        </select></label>
        <label>供应商<select value={form.supplier_id} onChange={(e) => setForm({...form, supplier_id: e.target.value, customer_id: ''})}>
          <option value="">无</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
        </select></label>
        <label className="check full"><input type="checkbox" checked={form.is_primary} onChange={(e) => setForm({...form, is_primary: e.target.checked})}/> 设为主联系人</label>
        <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

// ============ Customer Followups ============

export function Followups({ user, notify }) {
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ customerId });
    api(`/api/customer-followups?${params}`).then((r) => setItems(r.followups)).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => {
    api('/api/customers').then((r) => setCustomers(r.customers || []));
    void load();
  }, []);

  const typeMap = { VISIT: '拜访', CALL: '电话', EMAIL: '邮件', MEETING: '会议', OTHER: '其他' };

  return (
    <Panel title="客户跟进" subtitle="客户拜访和跟进记录">
      <Toolbar action={can(user, 'CRM_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增跟进</button>}/>
      <div className="filters">
        <label>客户<select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">全部客户</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
        </select></label>
        <button onClick={load}>查询</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>跟进日期</th><th>客户</th><th>类型</th><th>内容</th><th>下次计划</th><th>下次日期</th><th>跟进人</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.followup_date}</td>
                <td>{item.customerName}</td>
                <td><Badge>{typeMap[item.followup_type] || item.followup_type}</Badge></td>
                <td>{item.content}</td>
                <td>{item.next_plan || '-'}</td>
                <td>{item.next_date || '-'}</td>
                <td>{item.handlerName}</td>
                <td>{can(user, 'CRM_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无跟进记录"/>}
      </div>
      {editing && <FollowupModal customers={customers} value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('跟进记录已保存'); }} />}
    </Panel>
  );
}

function FollowupModal({ customers, value, onClose, onSaved }) {
  const [form, setForm] = useState({
    customer_id: '', followup_type: 'VISIT', followup_date: new Date().toISOString().slice(0, 10),
    content: '', next_plan: '', next_date: '', handler_id: user?.id || '', ...value
  });

  async function save(e) {
    e.preventDefault();
    try {
      await api('/api/customer-followups', { method: 'POST', body: form });
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title="新增跟进记录" onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>客户<select value={form.customer_id} onChange={(e) => setForm({...form, customer_id: e.target.value})} required>
          <option value="">选择客户</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
        </select></label>
        <label>跟进方式<select value={form.followup_type} onChange={(e) => setForm({...form, followup_type: e.target.value})}>
          <option value="VISIT">拜访</option>
          <option value="CALL">电话</option>
          <option value="EMAIL">邮件</option>
          <option value="MEETING">会议</option>
          <option value="OTHER">其他</option>
        </select></label>
        <label>跟进日期<input type="date" value={form.followup_date} onChange={(e) => setForm({...form, followup_date: e.target.value})} required/></label>
        <label className="full">跟进内容<textarea value={form.content} onChange={(e) => setForm({...form, content: e.target.value})} rows={3} required/></label>
        <label className="full">下次计划<input value={form.next_plan} onChange={(e) => setForm({...form, next_plan: e.target.value})}/></label>
        <label>下次跟进日期<input type="date" value={form.next_date} onChange={(e) => setForm({...form, next_date: e.target.value})}/></label>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

// ============ Sales Activities ============

export function SalesActivities({ user, notify }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ status });
    api(`/api/sales-activities?${params}`).then((r) => setItems(r.activities)).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => { void load(); }, []);

  const typeMap = { CAMPAIGN: '市场活动', SEMINAR: '研讨会', EXHIBITION: '展会', VISIT: '拜访', OTHER: '其他' };
  const statusMap = { PLANNING: '计划中', IN_PROGRESS: '进行中', COMPLETED: '已完成', CANCELLED: '已取消' };

  return (
    <Panel title="销售活动" subtitle="市场活动和展会管理">
      <Toolbar action={can(user, 'CRM_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建活动</button>}/>
      <div className="filters">
        <label>状态<select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部</option>
          <option value="PLANNING">计划中</option>
          <option value="IN_PROGRESS">进行中</option>
          <option value="COMPLETED">已完成</option>
          <option value="CANCELLED">已取消</option>
        </select></label>
        <button onClick={load}>查询</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>活动编号</th><th>标题</th><th>类型</th><th>开始日期</th><th>预算</th><th>实际费用</th><th>状态</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.activity_no}</td>
                <td><strong>{item.title}</strong></td>
                <td><Badge>{typeMap[item.activity_type]}</Badge></td>
                <td>{item.start_date}</td>
                <td className="number">{money(item.budget_cents)}</td>
                <td className="number">{money(item.actual_cost_cents)}</td>
                <td><Badge type={item.status === 'COMPLETED' ? 'success' : item.status === 'CANCELLED' ? 'danger' : ''}>{statusMap[item.status]}</Badge></td>
                <td>
                  <button className="row-action" onClick={() => setEditing(item)}>编辑</button>
                  {can(user, 'CRM_MANAGE') && <button className="row-action danger" onClick={() => deleteActivity(item)}>删除</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无销售活动"/>}
      </div>
      {editing && <ActivityModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('活动已保存'); }} />}
    </Panel>
  );

  async function deleteActivity(item) {
    if (!confirm(`确认删除活动 "${item.title}"?`)) return;
    try {
      await api(`/api/sales-activities/${item.id}`, { method: 'DELETE' });
      notify('活动已删除');
      load();
    } catch (e) { notify(e.message, 'error'); }
  }
}

function ActivityModal({ value, onClose, onSaved }) {
  const [form, setForm] = useState({
    activity_type: 'CAMPAIGN', title: '', content: '', start_date: new Date().toISOString().slice(0, 10),
    end_date: '', location: '', budget_cents: 0, actual_cost_cents: 0, participants: '', status: 'PLANNING', result: '', ...value
  });

  async function save(e) {
    e.preventDefault();
    try {
      if (value.id) {
        await api(`/api/sales-activities/${value.id}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/sales-activities', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title={value.id ? '编辑活动' : '新建活动'} onClose={onClose} wide>
      <form className="form-grid" onSubmit={save}>
        <label>活动类型<select value={form.activity_type} onChange={(e) => setForm({...form, activity_type: e.target.value})}>
          <option value="CAMPAIGN">市场活动</option>
          <option value="SEMINAR">研讨会</option>
          <option value="EXHIBITION">展会</option>
          <option value="VISIT">拜访</option>
          <option value="OTHER">其他</option>
        </select></label>
        <label>活动标题<input value={form.title} onChange={(e) => setForm({...form, title: e.target.value})} required/></label>
        <label>开始日期<input type="date" value={form.start_date} onChange={(e) => setForm({...form, start_date: e.target.value})} required/></label>
        <label>结束日期<input type="date" value={form.end_date} onChange={(e) => setForm({...form, end_date: e.target.value})}/></label>
        <label>活动地点<input value={form.location} onChange={(e) => setForm({...form, location: e.target.value})}/></label>
        <label>预算(元)<input type="number" value={form.budget_cents / 100} step="0.01" onChange={(e) => setForm({...form, budget_cents: Math.round(e.target.value * 100)})}/></label>
        <label>实际费用(元)<input type="number" value={form.actual_cost_cents / 100} step="0.01" onChange={(e) => setForm({...form, actual_cost_cents: Math.round(e.target.value * 100)})}/></label>
        <label>状态<select value={form.status} onChange={(e) => setForm({...form, status: e.target.value})}>
          <option value="PLANNING">计划中</option>
          <option value="IN_PROGRESS">进行中</option>
          <option value="COMPLETED">已完成</option>
          <option value="CANCELLED">已取消</option>
        </select></label>
        <label className="full">参与人员<input value={form.participants} onChange={(e) => setForm({...form, participants: e.target.value})} placeholder="多人用逗号分隔"/></label>
        <label className="full">活动内容<textarea value={form.content} onChange={(e) => setForm({...form, content: e.target.value})} rows={2}/></label>
        <label className="full">活动结果<textarea value={form.result} onChange={(e) => setForm({...form, result: e.target.value})} rows={2}/></label>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}
