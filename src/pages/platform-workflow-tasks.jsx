// Platform 通用工作流 —— 我的流程任务工作面（PL-04 / WF-05、WF-06）。
//
// 设计来源：docs/design/platform.md §32.1.2、§32.3.2、§32.3.6。
//
// 待办只呈现分配给当前用户的任务；任务动作由服务端状态机校验
// （APPROVE / REJECT / RETURN / TRANSFER / ADD_SIGN / SKIP）。

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, Loading, dateTime } from '../components/ui.jsx';
import {
  BottomActionBar, BusinessPageShell, EmptyState, FormRow, InlineAlert, SegmentedControl,
  Sheet, StatusChip,
} from '../components/design-system.jsx';
import '../styles/platform-operations.css';

const TABS = [
  { value: 'PENDING', label: '待处理' },
  { value: 'COMPLETED', label: '已处理' },
  { value: 'ALL', label: '全部' },
];

const TASK_STATUS_LABELS = { PENDING: '待处理', COMPLETED: '已完成', CANCELLED: '已取消', TRANSFERRED: '已转办' };

const ACTION_LABELS = {
  APPROVE: '同意', REJECT: '驳回', RETURN: '退回', TRANSFER: '转办', ADD_SIGN: '加签', SKIP: '跳过',
};

export default function PlatformWorkflowTasks({ user, notify }) {
  const canAct = can(user, 'WORKFLOW_TASK_ACT');
  const [tab, setTab] = useState('PENDING');
  const [tasks, setTasks] = useState([]);
  const [state, setState] = useState('LOADING');
  const [acting, setActing] = useState(null);

  const load = useCallback(async () => {
    setState('LOADING');
    try {
      const response = await api('/api/platform/workflow-tasks');
      setTasks(response.tasks || []);
      setState('READY');
    } catch (error) {
      setState('ERROR');
      notify(error.message, 'error');
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const visible = tab === 'ALL' ? tasks : tasks.filter((task) => task.status === tab);
  const pendingCount = tasks.filter((task) => task.status === 'PENDING').length;

  return (
    <BusinessPageShell className="platform-ops" width="rail" data-testid="platform-workflow-tasks-page">
      <header className="platform-ops__hero">
        <div>
          <span>WORKFLOW TASKS</span>
          <h2>我的流程任务</h2>
        </div>
        <p>只显示分配给当前用户的流程任务；徽标独立于业务审批中心的待办计数。</p>
      </header>

      <div className="platform-ops__tabs">
        <SegmentedControl label="任务分区" options={TABS} value={tab} onChange={setTab}/>
      </div>

      {state === 'LOADING' && <Loading/>}
      {state === 'ERROR' && <EmptyState title="流程任务加载失败" action={<button type="button" className="secondary" onClick={() => void load()}>重新加载</button>}/>}
      {state === 'READY' && (
        <>
          <p className="platform-ops__note">当前有 {pendingCount} 条待处理任务。</p>
          {visible.length === 0 && <div className="platform-ops__empty">该分区没有流程任务。</div>}
          <div className="platform-ops__list">
            {visible.map((task) => (
              <article key={task.id} className="platform-ops__card">
                <header>
                  <h3>流程任务</h3>
                  <StatusChip status={task.status}>{TASK_STATUS_LABELS[task.status] || task.status}</StatusChip>
                </header>
                <p className="platform-ops__code">实例 {task.instanceId}</p>
                <dl className="platform-ops__facts">
                  <div><dt>节点实例</dt><dd>{task.nodeInstanceId}</dd></div>
                  <div><dt>创建时间</dt><dd>{dateTime(task.createdAt)}</dd></div>
                  <div><dt>已执行动作</dt><dd>{task.action ? (ACTION_LABELS[task.action] || task.action) : '—'}</dd></div>
                  <div><dt>处理时间</dt><dd>{task.completedAt ? dateTime(task.completedAt) : '—'}</dd></div>
                </dl>
                {task.comment && <p className="platform-ops__hint">处理意见：{task.comment}</p>}
                {canAct && task.status === 'PENDING' && (
                  <div className="platform-ops__actions">
                    <button type="button" className="primary" onClick={() => setActing(task)}>处理</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      {acting && (
        <TaskActionSheet
          task={acting}
          canAct={canAct}
          notify={notify}
          onClose={() => setActing(null)}
          onChanged={async () => { setActing(null); await load(); }}
        />
      )}
    </BusinessPageShell>
  );
}

function TaskActionSheet({ task, canAct, notify, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState('APPROVE');
  const [comment, setComment] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  async function submit() {
    setBusy(true);
    try {
      const payload = {};
      if (action === 'TRANSFER' || action === 'ADD_SIGN') {
        if (!assigneeId) throw new Error('转办 / 加签必须指定接收人');
        payload.assigneeId = assigneeId;
      }
      await api(`/api/platform/workflow-tasks/${task.id}/complete`, {
        method: 'POST', body: { action, comment, payload },
      });
      notify('任务已处理', 'success');
      await onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="处理流程任务" onClose={onClose}>
      <div className="platform-ops__form">
        <p className="platform-ops__hint">实例 {task.instanceId} · 节点实例 {task.nodeInstanceId}</p>
        <FormRow label="动作" required>
          <select value={action} onChange={(event) => setAction(event.target.value)}>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </FormRow>
        {(action === 'TRANSFER' || action === 'ADD_SIGN') && (
          <FormRow label="接收人 id" required>
            <input value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}/>
          </FormRow>
        )}
        <FormRow label="处理意见">
          <textarea rows={4} value={comment} onChange={(event) => setComment(event.target.value)}/>
        </FormRow>
        {!canAct && <InlineAlert tone="info">处理流程任务需要 WORKFLOW_TASK_ACT 权限。</InlineAlert>}
      </div>
      <BottomActionBar>
        <button type="button" className="secondary" onClick={onClose}>取消</button>
        {canAct && <button type="button" className="primary" disabled={busy} onClick={submit}>提交</button>}
      </BottomActionBar>
    </Sheet>
  );
}
