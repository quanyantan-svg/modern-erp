// Platform 通用工作流 —— 实例监控工作面（PL-04 / WF-07、WF-08）。
//
// 设计来源：docs/design/platform.md §32.1.2、§32.3.2。
//
// 实例状态机：RUNNING → SUSPENDED → RUNNING / TERMINATED / COMPLETED / CANCELLED。
// 重新部署会终止旧实例并以指定版本启动新实例。

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, Loading, dateTime } from '../components/ui.jsx';
import {
  BottomActionBar, BusinessPageShell, EmptyState, FormRow, InlineAlert, Sheet, StatusChip,
} from '../components/design-system.jsx';
import '../styles/platform-operations.css';

const INSTANCE_STATUS_LABELS = {
  RUNNING: '进行中', SUSPENDED: '已暂停', COMPLETED: '已完成', TERMINATED: '已终止', CANCELLED: '已取消',
};

const NODE_STATUS_LABELS = {
  PENDING: '待进入', ACTIVE: '进行中', COMPLETED: '已完成', SKIPPED: '已跳过', CANCELLED: '已取消',
};

export default function PlatformWorkflowMonitor({ user, notify }) {
  const canControl = can(user, 'WORKFLOW_CONTROL');
  const canRedeploy = can(user, 'WORKFLOW_REDEPLOY');
  const [instances, setInstances] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [state, setState] = useState('LOADING');
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setState('LOADING');
    try {
      const query = statusFilter ? `?status=${statusFilter}` : '';
      const response = await api(`/api/platform/workflow-instances${query}`);
      setInstances(response.instances || []);
      setState('READY');
    } catch (error) {
      setState('ERROR');
      notify(error.message, 'error');
    }
  }, [statusFilter, notify]);

  useEffect(() => { void load(); }, [load]);

  async function openInstance(instanceId) {
    try {
      const response = await api(`/api/platform/workflow-instances/${instanceId}`);
      setDetail(response);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  return (
    <BusinessPageShell className="platform-ops" width="rail" data-testid="platform-workflow-monitor-page">
      <header className="platform-ops__hero">
        <div>
          <span>WORKFLOW MONITOR</span>
          <h2>流程监控</h2>
        </div>
        <p>查看流程实例的节点、任务与事件轨迹，并执行暂停、恢复、终止与重新部署。</p>
      </header>

      <div className="platform-ops__toolbar">
        <select aria-label="按实例状态过滤" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(INSTANCE_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <strong>共 {instances.length} 个实例</strong>
      </div>

      {state === 'LOADING' && <Loading/>}
      {state === 'ERROR' && <EmptyState title="流程实例加载失败" action={<button type="button" className="secondary" onClick={() => void load()}>重新加载</button>}/>}
      {state === 'READY' && instances.length === 0 && <div className="platform-ops__empty">没有符合条件的流程实例。</div>}

      {state === 'READY' && (
        <div className="platform-ops__list">
          {instances.map((instance) => (
            <article key={instance.id} className="platform-ops__card">
              <header>
                <h3>{instance.documentType} · {instance.documentId}</h3>
                <StatusChip status={instance.status}>{INSTANCE_STATUS_LABELS[instance.status] || instance.status}</StatusChip>
              </header>
              <dl className="platform-ops__facts">
                <div><dt>组织</dt><dd>{instance.orgId || '全局'}</dd></div>
                <div><dt>启动时间</dt><dd>{dateTime(instance.startedAt)}</dd></div>
                <div><dt>结束时间</dt><dd>{instance.completedAt ? dateTime(instance.completedAt) : '—'}</dd></div>
                <div><dt>终止原因</dt><dd>{instance.cancelReason || '—'}</dd></div>
              </dl>
              <div className="platform-ops__actions">
                <button type="button" className="secondary" onClick={() => void openInstance(instance.id)}>查看详情</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {detail && (
        <InstanceDetailSheet
          detail={detail}
          canControl={canControl}
          canRedeploy={canRedeploy}
          notify={notify}
          onClose={() => setDetail(null)}
          onChanged={async () => { await openInstance(detail.instance.id); await load(); }}
        />
      )}
    </BusinessPageShell>
  );
}

function InstanceDetailSheet({ detail, canControl, canRedeploy, notify, onClose, onChanged }) {
  const { instance, nodes, tasks, events } = detail;
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');

  async function control(action) {
    setBusy(true);
    try {
      const body = action === 'resume' ? {} : { reason: reason || undefined };
      await api(`/api/platform/workflow-instances/${instance.id}/${action}`, { method: 'POST', body });
      notify('实例状态已更新', 'success');
      await onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={`流程实例 ${instance.documentType} · ${instance.documentId}`} onClose={onClose}>
      <div className="platform-ops__form">
        <p className="platform-ops__hint">
          实例 {instance.id} · 当前状态 {INSTANCE_STATUS_LABELS[instance.status] || instance.status}
        </p>

        <div className="platform-ops__card">
          <header><h3>节点</h3></header>
          {nodes.length === 0 && <p className="platform-ops__hint">没有节点记录。</p>}
          <ul className="platform-ops__member-list">
            {nodes.map((node) => (
              <li key={node.id}>
                <span>{node.sequenceNo}. {node.nodeKey} · {node.nodeType}</span>
                <span className="platform-ops__code">{NODE_STATUS_LABELS[node.status] || node.status}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="platform-ops__card">
          <header><h3>任务</h3></header>
          {tasks.length === 0 && <p className="platform-ops__hint">没有任务记录。</p>}
          <ul className="platform-ops__member-list">
            {tasks.map((task) => (
              <li key={task.id}>
                <span>执行人 {task.assigneeId}</span>
                <span className="platform-ops__code">{task.status}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="platform-ops__card">
          <header><h3>事件轨迹</h3></header>
          {events.length === 0 && <p className="platform-ops__hint">没有事件记录。</p>}
          <ul className="platform-ops__member-list">
            {events.map((event) => (
              <li key={event.id}>
                <span>{event.eventType} · {event.fromStatus || '—'} → {event.toStatus || '—'}</span>
                <span className="platform-ops__code">{dateTime(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>

        {canControl && (
          <>
            <FormRow label="操作原因" hint="暂停 / 终止时写入事件轨迹">
              <input value={reason} onChange={(event) => setReason(event.target.value)}/>
            </FormRow>
            <InlineAlert tone="info">
              {canRedeploy ? '重新部署需要选择目标版本，会终止旧实例并启动新实例。' : '重新部署需要 WORKFLOW_REDEPLOY 权限。'}
            </InlineAlert>
          </>
        )}
      </div>
      <BottomActionBar>
        <button type="button" className="secondary" onClick={onClose}>关闭</button>
        {canControl && instance.status === 'RUNNING' && (
          <button type="button" className="secondary" disabled={busy} onClick={() => control('suspend')}>暂停</button>
        )}
        {canControl && instance.status === 'SUSPENDED' && (
          <button type="button" className="secondary" disabled={busy} onClick={() => control('resume')}>恢复</button>
        )}
        {canControl && ['RUNNING', 'SUSPENDED'].includes(instance.status) && (
          <button type="button" className="danger-button" disabled={busy} onClick={() => control('terminate')}>终止</button>
        )}
      </BottomActionBar>
    </Sheet>
  );
}
