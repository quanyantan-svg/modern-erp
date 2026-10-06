import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Active, Empty, FormActions, Modal, Panel, Toolbar, can } from '../components/ui.jsx';

export function Workflows({ user, notify }) {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api('/api/workflows').then((response) => setItems(response.workflows)).catch((error) => notify(error.message, 'error'));

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
                <td><strong>{item.name}</strong></td><td>{item.entity_type}</td><td><Active active={item.active}/></td><td>{item.creatorName}</td>
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
  const [form, setForm] = useState({ name: '', entity_type: 'ORDER', steps: [{ approver_id: '', step_name: '' }], ...value });
  const [users, setUsers] = useState([]);
  useEffect(() => { api('/api/users').then((response) => setUsers(response.users || [])); }, []);
  function addStep() { setForm((current) => ({ ...current, steps: [...current.steps, { approver_id: '', step_name: '' }] })); }
  function removeStep(index) { setForm((current) => ({ ...current, steps: current.steps.filter((_, itemIndex) => itemIndex !== index) })); }
  function updateStep(index, field, value) {
    const steps = [...form.steps];
    steps[index] = { ...steps[index], [field]: value };
    setForm((current) => ({ ...current, steps }));
  }
  async function save(event) {
    event.preventDefault();
    try { await api('/api/workflows', { method: 'POST', body: form }); onSaved(); }
    catch (error) { notify(error.message, 'error'); }
  }
  return (
    <Modal title="新建审批流程" onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="form-grid">
          <label>流程名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required/></label>
          <label>适用业务<select value={form.entity_type} onChange={(event) => setForm({ ...form, entity_type: event.target.value })}>
            <option value="ORDER">销售订单</option><option value="PURCHASE_ORDER">采购订单</option><option value="PRODUCTION_ORDER">生产工单</option>
          </select></label>
        </div>
        <h4>审批步骤</h4>
        <div className="table-wrap"><table><thead><tr><th>步骤</th><th>审批人</th><th></th></tr></thead><tbody>
          {form.steps.map((step, index) => <tr key={index}><td>第 {index + 1} 步</td><td><select value={step.approver_id} onChange={(event) => updateStep(index, 'approver_id', event.target.value)} required><option value="">选择审批人</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></td><td><button type="button" className="danger-button" onClick={() => removeStep(index)}>删除</button></td></tr>)}
        </tbody></table></div>
        <button type="button" className="secondary" onClick={addStep}>+ 添加步骤</button>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}
