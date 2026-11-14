// Platform 通用工作流 —— 模板绑定工作面（PL-04 / WF-03）。
//
// 设计来源：docs/design/platform.md §32.1.2、§32.3.1。
//
// 绑定把「单据类型 + 组织 + 条件」映射到一个已发布的流程版本。
// 同一单据类型 + 组织只能有一条生效绑定（唯一约束由 schema 保证）。

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, Loading, dateTime } from '../components/ui.jsx';
import {
  BottomActionBar, BusinessPageShell, EmptyState, FormRow, InlineAlert, Sheet, StatusChip,
} from '../components/design-system.jsx';
import '../styles/platform-operations.css';

const BINDING_STATUS_LABELS = { ACTIVE: '生效中', INACTIVE: '已停用' };

export default function PlatformWorkflowBindings({ user, notify }) {
  const canManage = can(user, 'WORKFLOW_MANAGE');
  const [bindings, setBindings] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [state, setState] = useState('LOADING');
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    setState('LOADING');
    try {
      const [bindingResponse, templateResponse] = await Promise.all([
        api('/api/platform/workflow-bindings'),
        api('/api/platform/workflow-templates'),
      ]);
      setBindings(bindingResponse.bindings || []);
      setTemplates(templateResponse.templates || []);
      setState('READY');
    } catch (error) {
      setState('ERROR');
      notify(error.message, 'error');
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  return (
    <BusinessPageShell className="platform-ops" width="rail" data-testid="platform-workflow-bindings-page">
      <header className="platform-ops__hero">
        <div>
          <span>WORKFLOW BINDINGS</span>
          <h2>流程绑定</h2>
        </div>
        <p>把单据类型与组织绑定到已发布的流程版本；同一单据类型 + 组织只允许一条生效绑定。</p>
      </header>

      {!canManage && <InlineAlert tone="info">当前账号为只读，维护绑定需要 WORKFLOW_MANAGE 权限。</InlineAlert>}

      <div className="platform-ops__toolbar">
        <strong>共 {bindings.length} 条绑定</strong>
        {canManage && <button type="button" className="primary" onClick={() => setEditor({ mode: 'create' })}>＋ 新建绑定</button>}
      </div>

      {state === 'LOADING' && <Loading/>}
      {state === 'ERROR' && <EmptyState title="流程绑定加载失败" action={<button type="button" className="secondary" onClick={() => void load()}>重新加载</button>}/>}
      {state === 'READY' && bindings.length === 0 && <div className="platform-ops__empty">还没有流程绑定。</div>}

      {state === 'READY' && (
        <div className="platform-ops__list">
          {bindings.map((binding) => {
            const template = templates.find((item) => item.id === binding.templateId);
            return (
              <article key={binding.id} className="platform-ops__card">
                <header>
                  <h3>{binding.documentType}</h3>
                  <StatusChip status={binding.status}>{BINDING_STATUS_LABELS[binding.status] || binding.status}</StatusChip>
                </header>
                <dl className="platform-ops__facts">
                  <div><dt>流程模板</dt><dd>{template ? template.name : binding.templateId}</dd></div>
                  <div><dt>组织</dt><dd>{binding.orgId || '全局'}</dd></div>
                  <div><dt>优先级</dt><dd>{binding.priority}</dd></div>
                  <div><dt>更新时间</dt><dd>{dateTime(binding.updatedAt)}</dd></div>
                </dl>
                {binding.condition && <p className="platform-ops__code">条件：{JSON.stringify(binding.condition)}</p>}
              </article>
            );
          })}
        </div>
      )}

      {editor && (
        <BindingEditorSheet
          templates={templates}
          canManage={canManage}
          notify={notify}
          onClose={() => setEditor(null)}
          onChanged={async () => { setEditor(null); await load(); }}
        />
      )}
    </BusinessPageShell>
  );
}

function BindingEditorSheet({ templates, canManage, notify, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    documentType: '', orgId: '', templateId: '', versionId: '', priority: 0, conditionText: '',
  });
  const [versions, setVersions] = useState([]);

  async function loadVersions(templateId) {
    if (!templateId) { setVersions([]); return; }
    try {
      const response = await api(`/api/platform/workflow-templates/${templateId}`);
      setVersions(response.versions || []);
    } catch (error) {
      setVersions([]);
      notify(error.message, 'error');
    }
  }

  async function save() {
    setBusy(true);
    try {
      let condition = null;
      if (form.conditionText.trim()) {
        try {
          condition = JSON.parse(form.conditionText);
        } catch (error) {
          throw new Error(`绑定条件不是合法 JSON：${error.message}`);
        }
      }
      await api('/api/platform/workflow-bindings', {
        method: 'POST',
        body: {
          documentType: form.documentType,
          orgId: form.orgId || '',
          templateId: form.templateId,
          versionId: form.versionId,
          condition,
          priority: Number(form.priority) || 0,
        },
      });
      notify('流程绑定已创建', 'success');
      await onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const publishedVersions = versions.filter((version) => version.status === 'PUBLISHED');

  return (
    <Sheet title="新建流程绑定" onClose={onClose}>
      <div className="platform-ops__form">
        <FormRow label="单据类型" required>
          <input value={form.documentType} onChange={(event) => setForm({ ...form, documentType: event.target.value.toUpperCase() })} placeholder="SALES_ORDER"/>
        </FormRow>
        <FormRow label="组织" hint="留空表示全局组织">
          <input value={form.orgId} onChange={(event) => setForm({ ...form, orgId: event.target.value })}/>
        </FormRow>
        <FormRow label="流程模板" required>
          <select
            value={form.templateId}
            onChange={(event) => { setForm({ ...form, templateId: event.target.value, versionId: '' }); void loadVersions(event.target.value); }}
          >
            <option value="">选择模板</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name}（{template.code}）</option>
            ))}
          </select>
        </FormRow>
        <FormRow label="流程版本" required hint="只能绑定已发布的版本">
          <select value={form.versionId} onChange={(event) => setForm({ ...form, versionId: event.target.value })}>
            <option value="">选择版本</option>
            {publishedVersions.map((version) => (
              <option key={version.id} value={version.id}>V{version.version}</option>
            ))}
          </select>
        </FormRow>
        <FormRow label="优先级" hint="数值越大越优先">
          <input type="number" inputMode="numeric" value={form.priority}
            onChange={(event) => setForm({ ...form, priority: event.target.value })}/>
        </FormRow>
        <FormRow label="绑定条件 (JSON)" hint="可留空；条件求值只使用白名单字段与白名单运算符">
          <textarea rows={4} value={form.conditionText} onChange={(event) => setForm({ ...form, conditionText: event.target.value })} spellCheck={false}/>
        </FormRow>
      </div>
      <BottomActionBar>
        <button type="button" className="secondary" onClick={onClose}>取消</button>
        {canManage && <button type="button" className="primary" disabled={busy} onClick={save}>保存</button>}
      </BottomActionBar>
    </Sheet>
  );
}
