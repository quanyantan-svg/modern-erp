// Platform 通用工作流 —— 流程设计工作面（PL-04 / WF-01、WF-02）。
//
// 设计来源：docs/design/platform.md §32.1.2、§32.2.1、§32.3.2。
//
// LIST → DETAIL → EDITOR：
//   - LIST：流程模板列表；
//   - DETAIL：模板的版本列表（草稿 / 已发布 / 已停用）与发布、停用动作；
//   - EDITOR：定义编辑（节点图 JSON）+ 试运行（不产生任何业务副作用）。
//
// 定义结构由服务端校验（节点标识唯一、入口存在、无孤立节点、每条路径可达结束节点、
// 审批节点必须声明 onApprove、条件节点必须声明 onTrue / onFalse）。

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, Loading, dateTime } from '../components/ui.jsx';
import {
  BottomActionBar, BusinessPageShell, EmptyState, FormRow, InlineAlert, Sheet, StatusChip,
} from '../components/design-system.jsx';
import '../styles/platform-operations.css';

const TEMPLATE_STATUS_LABELS = { DRAFT: '草稿', PUBLISHED: '已发布', RETIRED: '已停用' };
const VERSION_STATUS_LABELS = { DRAFT: '草稿', PUBLISHED: '已发布', RETIRED: '已停用' };

const STARTER_DEFINITION = JSON.stringify({
  entry: 'start',
  nodes: [
    {
      key: 'start',
      type: 'APPROVAL',
      participants: [{ type: 'ROLE', value: 'REVIEWER' }],
      onApprove: { next: 'END' },
      onReject: { next: 'END' },
    },
  ],
}, null, 2);

export default function PlatformWorkflowDesigner({ user, notify }) {
  const canManage = can(user, 'WORKFLOW_MANAGE');
  const [templates, setTemplates] = useState([]);
  const [state, setState] = useState('LOADING');
  const [detail, setDetail] = useState(null);
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    setState('LOADING');
    try {
      const response = await api('/api/platform/workflow-templates');
      setTemplates(response.templates || []);
      setState('READY');
    } catch (error) {
      setState('ERROR');
      notify(error.message, 'error');
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  async function openTemplate(templateId) {
    try {
      const response = await api(`/api/platform/workflow-templates/${templateId}`);
      setDetail(response);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  return (
    <BusinessPageShell className="platform-ops" width="rail" data-testid="platform-workflow-designer-page">
      <header className="platform-ops__hero">
        <div>
          <span>WORKFLOW DESIGNER</span>
          <h2>流程设计</h2>
        </div>
        <p>定义流程模板与节点图，草稿经发布后不可变；试运行只走一遍节点图，不产生任何业务副作用。</p>
      </header>

      {!canManage && <InlineAlert tone="info">当前账号为只读，编辑与发布流程需要 WORKFLOW_MANAGE 权限。</InlineAlert>}

      <div className="platform-ops__toolbar">
        <strong>共 {templates.length} 个模板</strong>
        {canManage && <button type="button" className="primary" onClick={() => setEditor({ mode: 'create' })}>＋ 新建模板</button>}
      </div>

      {state === 'LOADING' && <Loading/>}
      {state === 'ERROR' && <EmptyState title="流程模板加载失败" action={<button type="button" className="secondary" onClick={() => void load()}>重新加载</button>}/>}
      {state === 'READY' && templates.length === 0 && <div className="platform-ops__empty">还没有流程模板。</div>}

      {state === 'READY' && (
        <div className="platform-ops__list">
          {templates.map((template) => (
            <article key={template.id} className="platform-ops__card">
              <header>
                <h3>{template.name}</h3>
                <StatusChip status={template.status}>{TEMPLATE_STATUS_LABELS[template.status] || template.status}</StatusChip>
              </header>
              <p className="platform-ops__code">{template.code} · {template.documentType}</p>
              <dl className="platform-ops__facts">
                <div><dt>当前版本</dt><dd>V{template.currentVersion}</dd></div>
                <div><dt>创建时间</dt><dd>{dateTime(template.createdAt)}</dd></div>
              </dl>
              <div className="platform-ops__actions">
                <button type="button" className="secondary" onClick={() => void openTemplate(template.id)}>查看版本</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {detail && (
        <TemplateDetailSheet
          detail={detail}
          canManage={canManage}
          notify={notify}
          onClose={() => setDetail(null)}
          onChanged={async () => { await openTemplate(detail.template.id); await load(); }}
          onEdit={(version) => setEditor({ mode: 'version', template: detail.template, version })}
        />
      )}

      {editor && (
        <DefinitionEditorSheet
          editor={editor}
          canManage={canManage}
          notify={notify}
          onClose={() => setEditor(null)}
          onChanged={async () => { setEditor(null); await load(); }}
        />
      )}
    </BusinessPageShell>
  );
}

function TemplateDetailSheet({ detail, canManage, notify, onClose, onChanged, onEdit }) {
  const { template, versions } = detail;

  async function publish(versionId) {
    try {
      await api(`/api/platform/workflow-versions/${versionId}/publish`, { method: 'POST', body: {} });
      notify('版本已发布', 'success');
      await onChanged();
    } catch (error) { notify(error.message, 'error'); }
  }

  async function retire(versionId) {
    try {
      await api(`/api/platform/workflow-versions/${versionId}/retire`, { method: 'POST', body: {} });
      notify('版本已停用', 'success');
      await onChanged();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Sheet title={`${template.name} · 版本`} onClose={onClose}>
      <div className="platform-ops__form">
        <p className="platform-ops__hint">
          {template.code} · 适用单据类型 {template.documentType} · 当前版本 V{template.currentVersion}
        </p>
        {versions.length === 0 && <div className="platform-ops__empty">该模板还没有版本。</div>}
        {versions.map((version) => (
          <article key={version.id} className="platform-ops__card">
            <header>
              <h3>V{version.version}</h3>
              <StatusChip status={version.status}>{VERSION_STATUS_LABELS[version.status] || version.status}</StatusChip>
            </header>
            <dl className="platform-ops__facts">
              <div><dt>变更说明</dt><dd>{version.changeNote || '—'}</dd></div>
              <div><dt>发布时间</dt><dd>{version.publishedAt ? dateTime(version.publishedAt) : '未发布'}</dd></div>
            </dl>
            {canManage && (
              <div className="platform-ops__actions">
                <button type="button" className="secondary" onClick={() => onEdit(version)}>查看 / 编辑</button>
                {version.status === 'DRAFT' && (
                  <button type="button" className="primary" onClick={() => publish(version.id)}>发布</button>
                )}
                {version.status === 'PUBLISHED' && (
                  <button type="button" className="secondary" onClick={() => retire(version.id)}>停用</button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      <BottomActionBar>
        <button type="button" className="secondary" onClick={onClose}>关闭</button>
        {canManage && (
          <button type="button" className="primary" onClick={() => onEdit({ version: versions[versions.length - 1], definition: versions[versions.length - 1]?.definition })}>
            新建版本
          </button>
        )}
      </BottomActionBar>
    </Sheet>
  );
}

function DefinitionEditorSheet({ editor, canManage, notify, onClose, onChanged }) {
  const isCreate = editor.mode === 'create';
  const template = editor.template;
  const version = editor.version;
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState({
    code: '', name: '', documentType: '', changeNote: '',
  });
  const [definitionText, setDefinitionText] = useState(
    JSON.stringify(version?.definition || editor.definition || JSON.parse(STARTER_DEFINITION), null, 2),
  );
  const [variablesText, setVariablesText] = useState('{}');
  const [testResult, setTestResult] = useState(null);

  function parseDefinition() {
    try {
      return JSON.parse(definitionText);
    } catch (error) {
      throw new Error(`定义不是合法 JSON：${error.message}`);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const definition = parseDefinition();
      if (isCreate) {
        await api('/api/platform/workflow-templates', {
          method: 'POST',
          body: {
            code: meta.code, name: meta.name, documentType: meta.documentType, definition,
          },
        });
        notify('流程模板已创建', 'success');
      } else {
        await api(`/api/platform/workflow-templates/${template.id}/versions`, {
          method: 'POST', body: { definition, changeNote: meta.changeNote },
        });
        notify('新版本已创建', 'success');
      }
      await onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    try {
      const definition = parseDefinition();
      const variables = JSON.parse(variablesText || '{}');
      const response = await api('/api/platform/workflow-test-runs', {
        method: 'POST', body: { definition, variables },
      });
      setTestResult(response.result);
      notify('试运行完成', 'success');
    } catch (error) {
      setTestResult(null);
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={isCreate ? '新建流程模板' : `编辑流程定义 · ${template.code}`} onClose={onClose}>
      <div className="platform-ops__form">
        {isCreate && (
          <>
            <FormRow label="模板编码" required>
              <input value={meta.code} onChange={(event) => setMeta({ ...meta, code: event.target.value.toUpperCase() })} placeholder="WF-SALES-ORDER"/>
            </FormRow>
            <FormRow label="模板名称" required>
              <input value={meta.name} onChange={(event) => setMeta({ ...meta, name: event.target.value })}/>
            </FormRow>
            <FormRow label="适用单据类型" required>
              <input value={meta.documentType} onChange={(event) => setMeta({ ...meta, documentType: event.target.value.toUpperCase() })} placeholder="SALES_ORDER"/>
            </FormRow>
          </>
        )}
        {!isCreate && (
          <FormRow label="变更说明">
            <input value={meta.changeNote} onChange={(event) => setMeta({ ...meta, changeNote: event.target.value })}/>
          </FormRow>
        )}
        <FormRow label="节点图定义 (JSON)" required hint="entry + nodes；节点类型 APPROVAL / PARALLEL_APPROVAL / CONDITION / NOTIFY / CC / END">
          <textarea rows={12} value={definitionText} onChange={(event) => setDefinitionText(event.target.value)} spellCheck={false}/>
        </FormRow>
        <FormRow label="试运行变量 (JSON)">
          <textarea rows={4} value={variablesText} onChange={(event) => setVariablesText(event.target.value)} spellCheck={false}/>
        </FormRow>
        {testResult && (
          <div className="platform-ops__card">
            <header><h3>试运行路径</h3></header>
            <ol className="platform-ops__member-list">
              {(testResult.path || []).map((step) => (
                <li key={step.nodeKey}>
                  <span>{step.nodeKey} · {step.nodeType}</span>
                  <span className="platform-ops__code">
                    {step.branchTaken ? `分支 ${step.branchTaken}` : `参与人 ${(step.participants || []).length}`}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <BottomActionBar>
        <button type="button" className="secondary" onClick={onClose}>取消</button>
        <button type="button" className="secondary" disabled={busy} onClick={runTest}>试运行</button>
        {canManage && <button type="button" className="primary" disabled={busy} onClick={save}>{isCreate ? '创建' : '保存为新版本'}</button>}
      </BottomActionBar>
    </Sheet>
  );
}
