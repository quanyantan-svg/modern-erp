// Platform 组织与作用域（PL-03）。
//
// 设计来源：docs/design/platform.md §32.5；Requirement §36.5。
//
// 组织主数据所有权归 Platform（PL-DEC-02）。本工作面只做两件事：
//   - 组织注册表维护（列表 / 详情 / 编辑 / 启停用 + 层级）；
//   - 作用域分配（作用域 ↔ 组织的绑定）。
// 不做多组织业务数据隔离 —— 那是 Requirement §36.5 判定的 OUT_OF_SCOPE。

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, Loading } from '../components/ui.jsx';
import {
  BottomActionBar, BusinessPageShell, EmptyState, FormRow, InlineAlert, SegmentedControl,
  Sheet, StatusChip,
} from '../components/design-system.jsx';
import '../styles/platform-operations.css';

const TABS = [
  { value: 'organizations', label: '组织注册表' },
  { value: 'scopes', label: '作用域分配' },
];

const ORG_TYPE_LABELS = { LEGAL_ENTITY: '法人实体', BUSINESS_UNIT: '业务单元' };
const BINDING_MODE_LABELS = { SINGLE: '单组织', MULTI: '多组织' };

export default function PlatformOrganizations({ user, notify }) {
  const canManage = can(user, 'ORGANIZATIONS_MANAGE');
  const canManageScope = can(user, 'ORGANIZATION_SCOPE_MANAGE');
  const [tab, setTab] = useState('organizations');
  const [organizations, setOrganizations] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [externalScopes, setExternalScopes] = useState([]);
  const [state, setState] = useState('LOADING');
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    setState('LOADING');
    try {
      const [organizationResponse, scopeResponse] = await Promise.all([
        api('/api/platform/organizations'),
        api('/api/platform/organization-scopes'),
      ]);
      setOrganizations(organizationResponse.organizations || []);
      setScopes(scopeResponse.scopes || []);
      setExternalScopes(scopeResponse.externalAccountingScopes || []);
      setState('READY');
    } catch (error) {
      setState('ERROR');
      notify(error.message, 'error');
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  return (
    <BusinessPageShell className="platform-ops" width="rail" data-testid="platform-organizations-page">
      <header className="platform-ops__hero">
        <div>
          <span>ORGANIZATION REGISTRY</span>
          <h2>组织与作用域</h2>
        </div>
        <p>维护法人实体与业务单元的组织树，并把作用域绑定到组织；库存与财务口径看法人实体，销售与采购执行看业务单元。</p>
      </header>

      {!canManage && !canManageScope && (
        <InlineAlert tone="info">当前账号为只读，维护组织需要 ORGANIZATIONS_MANAGE 权限。</InlineAlert>
      )}

      <div className="platform-ops__tabs">
        <SegmentedControl label="工作面分区" options={TABS} value={tab} onChange={setTab}/>
      </div>

      {state === 'LOADING' && <Loading/>}
      {state === 'ERROR' && <EmptyState title="组织注册表加载失败" action={<button type="button" className="secondary" onClick={() => void load()}>重新加载</button>}/>}

      {state === 'READY' && tab === 'organizations' && (
        <OrganizationsPanel
          organizations={organizations}
          canManage={canManage}
          onCreate={() => setEditor({ kind: 'organization', mode: 'create' })}
          onEdit={(organization) => setEditor({ kind: 'organization', mode: 'edit', organization })}
        />
      )}

      {state === 'READY' && tab === 'scopes' && (
        <ScopesPanel
          scopes={scopes}
          organizations={organizations}
          externalScopes={externalScopes}
          canManageScope={canManageScope}
          onCreate={() => setEditor({ kind: 'scope', mode: 'create' })}
          onBind={(scope) => setEditor({ kind: 'scope', mode: 'bind', scope })}
          onChanged={load}
          notify={notify}
        />
      )}

      {editor?.kind === 'organization' && (
        <OrganizationEditorSheet
          organizations={organizations}
          organization={editor.organization}
          isCreate={editor.mode === 'create'}
          canManage={canManage}
          notify={notify}
          onClose={() => setEditor(null)}
          onChanged={async () => { setEditor(null); await load(); }}
        />
      )}

      {editor?.kind === 'scope' && editor.mode === 'create' && (
        <ScopeEditorSheet
          notify={notify}
          onClose={() => setEditor(null)}
          onChanged={async () => { setEditor(null); await load(); }}
        />
      )}

      {editor?.kind === 'scope' && editor.mode === 'bind' && (
        <ScopeBindingSheet
          scope={editor.scope}
          organizations={organizations}
          canManageScope={canManageScope}
          notify={notify}
          onClose={() => setEditor(null)}
          onChanged={async () => { setEditor(null); await load(); }}
        />
      )}
    </BusinessPageShell>
  );
}

function OrganizationsPanel({ organizations, canManage, onCreate, onEdit }) {
  const byParent = new Map();
  for (const organization of organizations) {
    const key = organization.parentOrgId || '';
    byParent.set(key, [...(byParent.get(key) || []), organization]);
  }
  const roots = byParent.get('') || [];
  const renderNode = (organization, depth) => (
    <div key={organization.id}>
      <article className="platform-ops__card">
        <header>
          <h3>{organization.name}</h3>
          <StatusChip status={organization.status}>{organization.status === 'ACTIVE' ? '启用' : '停用'}</StatusChip>
        </header>
        <p className="platform-ops__code">{organization.code} · {ORG_TYPE_LABELS[organization.orgType] || organization.orgType}</p>
        <dl className="platform-ops__facts">
          <div><dt>上级组织</dt><dd>{organizations.find((item) => item.id === organization.parentOrgId)?.name || '顶级'}</dd></div>
          <div><dt>生效日期</dt><dd>{organization.effectiveFrom || '—'}</dd></div>
        </dl>
        {canManage && (
          <div className="platform-ops__actions">
            <button type="button" className="secondary" onClick={() => onEdit(organization)}>编辑</button>
          </div>
        )}
      </article>
      {(byParent.get(organization.id) || []).map((child) => renderNode(child, depth + 1))}
    </div>
  );
  return (
    <section>
      <div className="platform-ops__toolbar">
        <strong>共 {organizations.length} 个组织</strong>
        {canManage && <button type="button" className="primary" onClick={onCreate}>＋ 新建组织</button>}
      </div>
      {roots.length === 0 && <div className="platform-ops__empty">还没有组织，先建一个法人实体作为根节点。</div>}
      <div className="platform-ops__list">{roots.map((organization) => renderNode(organization, 0))}</div>
    </section>
  );
}

function ScopesPanel({ scopes, organizations, externalScopes, canManageScope, onCreate, onBind, onChanged, notify }) {
  const organizationName = (organizationId) => organizations.find((item) => item.id === organizationId)?.name || organizationId;

  async function unbind(scope, organizationId) {
    try {
      await api(`/api/platform/organization-scopes/${scope.id}/unbind`, { method: 'POST', body: { orgId: organizationId } });
      notify('已解除组织绑定', 'success');
      await onChanged();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <section>
      <div className="platform-ops__toolbar">
        <strong>共 {scopes.length} 个作用域</strong>
        {canManageScope && <button type="button" className="primary" onClick={onCreate}>＋ 新建作用域</button>}
      </div>
      {externalScopes.length > 0 && (
        <p className="platform-ops__note">
          核算域的自由文本作用域（{externalScopes.map((scope) => scope.code).join('、')}）与本注册表通过显式映射关联，
          两者的校验语义互不影响。
        </p>
      )}
      {scopes.length === 0 && <div className="platform-ops__empty">还没有作用域。</div>}
      <div className="platform-ops__list">
        {scopes.map((scope) => (
          <article key={scope.id} className="platform-ops__card">
            <header>
              <h3>{scope.name}</h3>
              <span className="platform-ops__badge">{BINDING_MODE_LABELS[scope.bindingMode] || scope.bindingMode}</span>
            </header>
            <p className="platform-ops__code">{scope.scopeCode}</p>
            {scope.organizationIds?.length ? (
              <ul className="platform-ops__member-list">
                {scope.organizationIds.map((organizationId) => (
                  <li key={organizationId}>
                    <span>{organizationName(organizationId)}</span>
                    {canManageScope && (
                      <button type="button" className="secondary" onClick={() => unbind(scope, organizationId)}>解绑</button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="platform-ops__hint">尚未绑定组织。</p>
            )}
            {canManageScope && (
              <div className="platform-ops__actions">
                <button type="button" className="secondary" onClick={() => onBind(scope)}>分配组织</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function OrganizationEditorSheet({ organizations, organization, isCreate, canManage, notify, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    code: organization?.code || '',
    name: organization?.name || '',
    orgType: organization?.orgType || 'LEGAL_ENTITY',
    parentOrgId: organization?.parentOrgId || '',
    effectiveFrom: organization?.effectiveFrom || '',
    effectiveTo: organization?.effectiveTo || '',
  });
  const [status, setStatus] = useState(organization?.status || 'ACTIVE');

  async function save() {
    setBusy(true);
    try {
      if (isCreate) {
        await api('/api/platform/organizations', {
          method: 'POST',
          body: {
            code: form.code,
            name: form.name,
            orgType: form.orgType,
            parentOrgId: form.parentOrgId || null,
            effectiveFrom: form.effectiveFrom || null,
            effectiveTo: form.effectiveTo || null,
          },
        });
        notify('组织已创建', 'success');
      } else {
        await api(`/api/platform/organizations/${organization.id}`, {
          method: 'PATCH',
          body: {
            name: form.name,
            orgType: form.orgType,
            parentOrgId: form.parentOrgId || null,
            effectiveFrom: form.effectiveFrom || null,
            effectiveTo: form.effectiveTo || null,
          },
        });
        notify('组织已更新', 'success');
      }
      await onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(next) {
    setBusy(true);
    try {
      await api(`/api/platform/organizations/${organization.id}/status`, { method: 'POST', body: { status: next } });
      notify(next === 'ACTIVE' ? '组织已启用' : '组织已停用', 'success');
      await onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={isCreate ? '新建组织' : `编辑组织 ${organization.code}`} onClose={onClose}>
      <div className="platform-ops__form">
        {isCreate && (
          <FormRow label="组织编码" required hint="字母、数字、下划线或短横线">
            <input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="ORG-001"/>
          </FormRow>
        )}
        <FormRow label="组织名称" required>
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/>
        </FormRow>
        <FormRow label="组织类型" required hint="法人实体用于库存与财务口径；业务单元用于销售与采购执行">
          <select value={form.orgType} onChange={(event) => setForm({ ...form, orgType: event.target.value })}>
            <option value="LEGAL_ENTITY">法人实体</option>
            <option value="BUSINESS_UNIT">业务单元</option>
          </select>
        </FormRow>
        <FormRow label="上级组织" hint="留空表示顶级组织">
          <select value={form.parentOrgId} onChange={(event) => setForm({ ...form, parentOrgId: event.target.value })}>
            <option value="">顶级组织</option>
            {organizations.filter((item) => item.id !== organization?.id).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </FormRow>
        <FormRow label="生效日期">
          <input type="date" value={form.effectiveFrom || ''} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}/>
        </FormRow>
        <FormRow label="失效日期">
          <input type="date" value={form.effectiveTo || ''} onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })}/>
        </FormRow>
      </div>
      <BottomActionBar>
        <button type="button" className="secondary" onClick={onClose}>取消</button>
        {!isCreate && canManage && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => changeStatus(status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')}
          >
            {status === 'ACTIVE' ? '停用' : '启用'}
          </button>
        )}
        {canManage && <button type="button" className="primary" disabled={busy} onClick={save}>保存</button>}
      </BottomActionBar>
    </Sheet>
  );
}

function ScopeEditorSheet({ notify, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ scopeCode: '', name: '', bindingMode: 'SINGLE' });

  async function save() {
    setBusy(true);
    try {
      await api('/api/platform/organization-scopes', { method: 'POST', body: form });
      notify('作用域已创建', 'success');
      await onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="新建作用域" onClose={onClose}>
      <div className="platform-ops__form">
        <FormRow label="作用域编码" required>
          <input value={form.scopeCode} onChange={(event) => setForm({ ...form, scopeCode: event.target.value.toUpperCase() })} placeholder="SCOPE-CN"/>
        </FormRow>
        <FormRow label="作用域名称" required>
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/>
        </FormRow>
        <FormRow label="绑定模式" required hint="单组织模式必须恰好绑定一个组织">
          <select value={form.bindingMode} onChange={(event) => setForm({ ...form, bindingMode: event.target.value })}>
            <option value="SINGLE">单组织</option>
            <option value="MULTI">多组织</option>
          </select>
        </FormRow>
      </div>
      <BottomActionBar>
        <button type="button" className="secondary" onClick={onClose}>取消</button>
        <button type="button" className="primary" disabled={busy} onClick={save}>保存</button>
      </BottomActionBar>
    </Sheet>
  );
}

function ScopeBindingSheet({ scope, organizations, canManageScope, notify, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [organizationId, setOrganizationId] = useState('');

  async function bind() {
    setBusy(true);
    try {
      await api(`/api/platform/organization-scopes/${scope.id}/bind`, { method: 'POST', body: { orgId: organizationId } });
      notify('组织已绑定', 'success');
      await onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={`为 ${scope.scopeCode} 分配组织`} onClose={onClose}>
      <div className="platform-ops__form">
        <FormRow label="组织" required hint="只能绑定启用中的组织">
          <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
            <option value="">选择组织</option>
            {organizations.filter((item) => item.status === 'ACTIVE').map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </FormRow>
        {scope.bindingMode === 'SINGLE' && scope.organizationIds?.length > 0 && (
          <InlineAlert tone="info">单组织作用域已有绑定，请先解绑再绑定新的组织。</InlineAlert>
        )}
      </div>
      <BottomActionBar>
        <button type="button" className="secondary" onClick={onClose}>取消</button>
        {canManageScope && <button type="button" className="primary" disabled={busy || !organizationId} onClick={bind}>绑定</button>}
      </BottomActionBar>
    </Sheet>
  );
}
