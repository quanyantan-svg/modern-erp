import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Active, Badge, Empty, FormActions, Modal, Panel, Toolbar, can, dateTime } from '../components/ui.jsx';
import { BusinessPageHeader, BusinessPageShell, HelpDisclosure } from '../components/design-system.jsx';


// ============ Notifications ============

export function Notifications({ user, notify }) {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = () => {
    api('/api/notifications').then((r) => {
      setItems(r.notifications);
      setUnreadCount(r.unreadCount);
    }).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => { void load(); }, []);

  async function markAllRead() {
    try {
      await api('/api/notifications/read', { method: 'POST', body: {} });
      notify('已全部标为已读');
      load();
    } catch (e) { notify(e.message, 'error'); }
  }

  const typeMap = { INFO: '信息', WARNING: '警告', SUCCESS: '成功', ERROR: '错误' };
  const typeColors = { INFO: '', WARNING: 'warning', SUCCESS: 'success', ERROR: 'danger' };

  return (
    <BusinessPageShell className="notifications-v15" width="rail">
      <BusinessPageHeader title="通知中心" context={`${unreadCount} 条未读`} help={<HelpDisclosure summary="通知说明"><p>桌面通知中心与移动端“消息”共享同一数据源和已读状态。</p></HelpDisclosure>}/>
      <Toolbar action={<button className="secondary" onClick={markAllRead}>全部标为已读</button>}/>
      <div className="table-wrap">
        <table>
          <thead><tr><th>类型</th><th>标题</th><th>内容</th><th>时间</th><th>状态</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className={item.is_read ? 'read-row' : ''}>
                <td><Badge type={typeColors[item.type]}>{typeMap[item.type]}</Badge></td>
                <td><strong>{item.title}</strong></td>
                <td>{item.content}</td>
                <td className="dim">{dateTime(item.created_at)}</td>
                <td>{item.is_read ? <span className="dim">已读</span> : <Badge type="info">新</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无通知"/>}
      </div>
    </BusinessPageShell>
  );
}

// ============ Workflows ============

export function Workflows({ user, notify }) {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = () => api('/api/workflows').then((r) => setItems(r.workflows)).catch((e) => notify(e.message, 'error'));

  useEffect(() => { void load(); }, []);

  return (
    <Panel title="审批流程">
      <Toolbar action={can(user, 'WORKFLOW_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建流程</button>}/>
      <div className="table-wrap">
        <table>
          <thead><tr><th>流程名称</th><th>适用业务</th><th>状态</th><th>创建人</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong></td>
                <td>{item.entity_type}</td>
                <td><Active active={item.active}/></td>
                <td>{item.creatorName}</td>
                <td>{can(user, 'WORKFLOW_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无审批流程"/>}
      </div>
      {editing && <WorkflowModal notify={notify} value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('流程已保存'); }} />}
    </Panel>
  );
}

function WorkflowModal({ notify, value, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', entity_type: 'ORDER', steps: [{ approver_id: '', step_name: '' }], ...value
  });
  const [users, setUsers] = useState([]);

  useEffect(() => {
    api('/api/users').then((r) => setUsers(r.users || []));
  }, []);

  function addStep() { setForm((f) => ({ ...f, steps: [...f.steps, { approver_id: '', step_name: '' }] })); }
  function removeStep(i) { setForm((f) => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) })); }
  function updateStep(i, field, val) {
    const steps = [...form.steps];
    steps[i] = { ...steps[i], [field]: val };
    setForm((f) => ({ ...f, steps }));
  }

  async function save(e) {
    e.preventDefault();
    try {
      await api('/api/workflows', { method: 'POST', body: form });
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title="新建审批流程" onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="form-grid">
          <label>流程名称<input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} required/></label>
          <label>适用业务<select value={form.entity_type} onChange={(e) => setForm({...form, entity_type: e.target.value})}>
            <option value="ORDER">销售订单</option>
            <option value="PURCHASE_ORDER">采购订单</option>
            <option value="PRODUCTION_ORDER">生产工单</option>
          </select></label>
        </div>
        <h4>审批步骤</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>步骤</th><th>审批人</th><th></th></tr></thead>
            <tbody>
              {form.steps.map((step, i) => (
                <tr key={i}>
                  <td>第 {i + 1} 步</td>
                  <td><select value={step.approver_id} onChange={(e) => updateStep(i, 'approver_id', e.target.value)} required>
                    <option value="">选择审批人</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select></td>
                  <td><button type="button" className="danger-button" onClick={() => removeStep(i)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="secondary" onClick={addStep}>+ 添加步骤</button>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}
