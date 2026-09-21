import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Active, Badge, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, can, dateTime, money } from '../components/ui.jsx';

export function Projects({ user, notify }) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ status });
    api(`/api/projects?${params}`).then((r) => setItems(r.projects)).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => { void load(); }, []);

  function viewDetail(item) {
    api(`/api/projects/${item.id}`).then((r) => setDetail(r.project)).catch((e) => notify(e.message, 'error'));
  }

  const typeMap = { IT: 'IT项目', CONSTRUCTION: '工程项目', RND: '研发项目', MARKETING: '市场项目', OTHER: '其他' };
  const statusMap = { PLANNING: '计划中', IN_PROGRESS: '进行中', SUSPENDED: '已暂停', COMPLETED: '已完成', CANCELLED: '已取消' };

  return (
    <Panel title="项目立项">
      <Toolbar action={can(user, 'PROJECT_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建项目</button>}/>
      <div className="filters">
        <label>状态<select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部</option>
          <option value="PLANNING">计划中</option>
          <option value="IN_PROGRESS">进行中</option>
          <option value="COMPLETED">已完成</option>
        </select></label>
        <button onClick={load}>查询</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>项目编号</th><th>项目名称</th><th>类型</th><th>开始日期</th><th className="number">预算</th><th>项目经理</th><th>状态</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.project_no}</td>
                <td><strong>{item.name}</strong></td>
                <td><Badge>{typeMap[item.project_type]}</Badge></td>
                <td>{item.start_date}</td>
                <td className="number">{money(item.budget_cents)}</td>
                <td>{item.managerName}</td>
                <td><Badge type={item.status === 'COMPLETED' ? 'success' : ''}>{statusMap[item.status]}</Badge></td>
                <td>
                  <button className="row-action" onClick={() => viewDetail(item)}>详情</button>
                  {can(user, 'PROJECT_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无项目"/>}
      </div>
      {editing && <ProjectModal user={user} notify={notify} value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('项目已保存'); }} />}
      {detail && <ProjectDetailModal project={detail} onClose={() => setDetail(null)}/>}
    </Panel>
  );
}

function ProjectModal({ user, notify, value, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', description: '', project_type: 'IT', customer_id: '',
    start_date: new Date().toISOString().slice(0, 10), end_date: '', budget_cents: 0, manager_id: user?.id || '', ...value
  });
  const [customers, setCustomers] = useState([]);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    api('/api/customers').then((r) => setCustomers(r.customers || [])).catch(() => {});
    api('/api/users/lookup').then((r) => setUsers(r.users || [])).catch((e) => notify(e.message, 'error'));
  }, []);

  async function save(e) {
    e.preventDefault();
    try {
      if (value.id) {
        await api(`/api/projects/${value.id}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/projects', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title={value.id ? '编辑项目' : '新建项目'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>项目名称<input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} required/></label>
        <label>项目类型<select value={form.project_type} onChange={(e) => setForm({...form, project_type: e.target.value})}>
          <option value="IT">IT项目</option>
          <option value="RND">研发项目</option>
          <option value="MARKETING">市场项目</option>
          <option value="OTHER">其他</option>
        </select></label>
        <label>开始日期<input type="date" value={form.start_date} onChange={(e) => setForm({...form, start_date: e.target.value})} required/></label>
        <label>项目经理<select value={form.manager_id} onChange={(e) => setForm({...form, manager_id: e.target.value})} required>
          <option value="">选择经理</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}
        </select></label>
        <label className="full">项目描述<textarea value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} rows={2}/></label>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

function ProjectDetailModal({ project, onClose }) {
  const statusMap = { PLANNING: '计划中', IN_PROGRESS: '进行中', COMPLETED: '已完成' };
  return (
    <Modal title={`项目详情 - ${project.name}`} onClose={onClose}>
      <div className="detail-grid">
        <div>项目编号: {project.project_no}</div>
        <div>项目经理: {project.managerName}</div>
        <div>开始日期: {project.start_date}</div>
        <div>状态: <Badge>{statusMap[project.status]}</Badge></div>
      </div>
      <h4>任务列表 ({project.tasks?.length || 0})</h4>
      <div className="table-wrap">
        <table>
          <thead><tr><th>任务</th><th>负责人</th><th>状态</th><th>进度</th></tr></thead>
          <tbody>
            {project.tasks?.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.assigneeName || '-'}</td>
                <td>{t.status}</td>
                <td>{t.progress}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FormActions onClose={onClose}/>
    </Modal>
  );
}

// ============ Project Tasks ============

export function ProjectTasks({ user, notify }) {
  const [items, setItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ projectId });
    api(`/api/project-tasks?${params}`).then((r) => setItems(r.tasks)).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => {
    api('/api/projects').then((r) => setProjects(r.projects || []));
    void load();
  }, []);

  const priorityMap = { LOW: '低', MEDIUM: '中', HIGH: '高', URGENT: '紧急' };
  const statusMap = { PENDING: '待开始', IN_PROGRESS: '进行中', COMPLETED: '已完成' };

  return (
    <Panel title="任务管理">
      <Toolbar action={can(user, 'PROJECT_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建任务</button>}/>
      <div className="filters">
        <label>所属项目<select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">全部项目</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.project_no} - {p.name}</option>)}
        </select></label>
        <button onClick={load}>查询</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>任务编号</th><th>任务名称</th><th>所属项目</th><th>负责人</th><th>优先级</th><th>状态</th><th>进度</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.task_no}</td>
                <td><strong>{item.name}</strong></td>
                <td>{item.projectName}</td>
                <td>{item.assigneeName || '-'}</td>
                <td><Badge>{priorityMap[item.priority]}</Badge></td>
                <td>{statusMap[item.status]}</td>
                <td>{item.progress}%</td>
                <td>{can(user, 'PROJECT_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无任务"/>}
      </div>
      {editing && <TaskModal projects={projects} notify={notify} value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('任务已保存'); }} />}
    </Panel>
  );
}

function TaskModal({ projects, notify, value, onClose, onSaved }) {
  const [form, setForm] = useState({
    project_id: '', name: '', description: '', priority: 'MEDIUM', planned_start: '', estimated_hours: 0, ...value
  });
  const [users, setUsers] = useState([]);

  useEffect(() => {
    api('/api/users').then((r) => setUsers(r.users || []));
  }, []);

  async function save(e) {
    e.preventDefault();
    try {
      if (value.id) {
        await api(`/api/project-tasks/${value.id}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/project-tasks', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title={value.id ? '编辑任务' : '新建任务'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>所属项目<select value={form.project_id} onChange={(e) => setForm({...form, project_id: e.target.value})} required>
          <option value="">选择项目</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.project_no} - {p.name}</option>)}
        </select></label>
        <label>任务名称<input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} required/></label>
        <label>优先级<select value={form.priority} onChange={(e) => setForm({...form, priority: e.target.value})}>
          <option value="LOW">低</option>
          <option value="MEDIUM">中</option>
          <option value="HIGH">高</option>
          <option value="URGENT">紧急</option>
        </select></label>
        <label>计划开始<input type="date" value={form.planned_start} onChange={(e) => setForm({...form, planned_start: e.target.value})}/></label>
        <label className="full">任务描述<textarea value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} rows={2}/></label>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

// ============ Timesheets ============

export function Timesheets({ user, notify }) {
  const [items, setItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ projectId });
    api(`/api/timesheets?${params}`).then((r) => setItems(r.timesheets)).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => {
    api('/api/projects').then((r) => setProjects(r.projects || []));
    void load();
  }, []);

  return (
    <Panel title="工时记录">
      <Toolbar action={<button className="primary" onClick={() => setEditing({})}>＋ 记录工时</button>}/>
      <div className="filters">
        <label>项目<select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">全部项目</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.project_no} - {p.name}</option>)}
        </select></label>
        <button onClick={load}>查询</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>工作日期</th><th>项目</th><th>人员</th><th className="number">工时</th><th>说明</th><th>可计费</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.work_date}</td>
                <td>{item.projectName}</td>
                <td>{item.userName}</td>
                <td className="number">{item.hours}h</td>
                <td>{item.description || '-'}</td>
                <td>{item.billable ? '是' : '否'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无工时记录"/>}
      </div>
      {editing && <TimesheetModal projects={projects} user={user} notify={notify} value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('工时已记录'); }} />}
    </Panel>
  );
}

function TimesheetModal({ projects, user, notify, value, onClose, onSaved }) {
  const [form, setForm] = useState({
    project_id: '', user_id: user?.id || '', work_date: new Date().toISOString().slice(0, 10),
    hours: 0, description: '', billable: true, ...value
  });
  const [users, setUsers] = useState([]);

  useEffect(() => {
    api('/api/users').then((r) => setUsers(r.users || []));
  }, []);

  async function save(e) {
    e.preventDefault();
    try {
      await api('/api/timesheets', { method: 'POST', body: form });
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title="记录工时" onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>项目<select value={form.project_id} onChange={(e) => setForm({...form, project_id: e.target.value})} required>
          <option value="">选择项目</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.project_no} - {p.name}</option>)}
        </select></label>
        <label>工作日期<input type="date" value={form.work_date} onChange={(e) => setForm({...form, work_date: e.target.value})} required/></label>
        <label>工时<input type="number" value={form.hours} min="0.5" step="0.5" onChange={(e) => setForm({...form, hours: Number(e.target.value)})} required/></label>
        <label>填报人<select value={form.user_id} onChange={(e) => setForm({...form, user_id: e.target.value})} required>
          <option value="">选择人员</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select></label>
        <label className="check full"><input type="checkbox" checked={form.billable} onChange={(e) => setForm({...form, billable: e.target.checked})}/> 可计费工时</label>
        <label className="full">工作说明<input value={form.description} onChange={(e) => setForm({...form, description: e.target.value})}/></label>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}


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
    <Panel title="通知中心">
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
    </Panel>
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
