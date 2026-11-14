// Platform 职责分离规则维护面（PL-02）。
//
// 设计来源：docs/design/platform.md §32.4.7；Requirement §36.4。
//
// 四个分区：族覆盖登记 / 规则 / 升级待办 / 判定记录。
// 规则集合的可创建范围由后端声明（GET /api/platform/sod/coverage 的 creatable），
// 前端**不自行发明**可选项 —— 不可求值的约束在界面上根本不会出现。

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, Loading, dateTime } from '../components/ui.jsx';
import {
  BottomActionBar, BusinessPageShell, EmptyState, FormRow, InlineAlert, SegmentedControl,
  Sheet, StatusChip,
} from '../components/design-system.jsx';
import '../styles/platform-operations.css';

const TABS = [
  { value: 'coverage', label: '族覆盖' },
  { value: 'rules', label: '规则' },
  { value: 'escalations', label: '升级待办' },
  { value: 'evaluations', label: '判定记录' },
];

const CONSTRAINT_LABELS = {
  SAME_PERSON_FORBIDDEN: '禁止同一人',
  SAME_ROLE_FORBIDDEN: '禁止同角色',
  SAME_DEPARTMENT_FORBIDDEN: '禁止同部门',
  MIN_APPROVERS: '最小通过人数',
};

const RESOLUTION_LABELS = { REJECT: '拒绝', ESCALATE: '升级至上级' };

const COVERAGE_LABELS = {
  RULE_COVERED: '平台规则覆盖',
  NATIVE_GUARD: '既有防护负责',
  UNCOVERED: '职责分离缺口',
};

const DECISION_LABELS = { PASS: '通过', VIOLATED: '违规', ESCALATED: '升级' };

export default function PlatformSodRules({ user, notify }) {
  const canManage = can(user, 'SOD_RULES_MANAGE');
  const [tab, setTab] = useState('coverage');
  const [coverage, setCoverage] = useState(null);
  const [rules, setRules] = useState([]);
  const [escalations, setEscalations] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [state, setState] = useState('LOADING');
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    setState('LOADING');
    try {
      const [coverageResponse, ruleResponse, escalationResponse, evaluationResponse] = await Promise.all([
        api('/api/platform/sod/coverage'),
        api('/api/platform/sod/rules'),
        api('/api/platform/sod/escalations'),
        api('/api/platform/sod/evaluations?limit=100'),
      ]);
      setCoverage(coverageResponse);
      setRules(ruleResponse.rules || []);
      setEscalations(escalationResponse.escalations || []);
      setEvaluations(evaluationResponse.evaluations || []);
      setState('READY');
    } catch (error) {
      setState('ERROR');
      notify(error.message, 'error');
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  return (
    <BusinessPageShell className="platform-ops" width="rail" data-testid="platform-sod-rules-page">
      <header className="platform-ops__hero">
        <div>
          <span>SEPARATION OF DUTIES</span>
          <h2>职责分离规则</h2>
        </div>
        <p>为审批族配置职责分离约束、处置方式与升级角色；规则变更全部留痕。</p>
      </header>

      {!canManage && <InlineAlert tone="info">当前账号为只读，维护职责分离规则需要 SOD_RULES_MANAGE 权限。</InlineAlert>}

      <div className="platform-ops__tabs">
        <SegmentedControl label="工作面分区" options={TABS} value={tab} onChange={setTab}/>
      </div>

      {state === 'LOADING' && <Loading/>}
      {state === 'ERROR' && <EmptyState title="职责分离配置加载失败" action={<button type="button" className="secondary" onClick={() => void load()}>重新加载</button>}/>}

      {state === 'READY' && tab === 'coverage' && (
        <CoveragePanel coverage={coverage}/>
      )}

      {state === 'READY' && tab === 'rules' && (
        <RulesPanel
          rules={rules}
          creatable={coverage?.creatable}
          canManage={canManage}
          onCreate={() => setEditor({ mode: 'create' })}
          onEdit={(rule) => setEditor({ mode: 'edit', rule })}
        />
      )}

      {state === 'READY' && tab === 'escalations' && (
        <EscalationsPanel escalations={escalations}/>
      )}

      {state === 'READY' && tab === 'evaluations' && (
        <EvaluationsPanel evaluations={evaluations}/>
      )}

      {editor && (
        <RuleEditorSheet
          editor={editor}
          creatable={coverage?.creatable}
          families={coverage?.families || []}
          canManage={canManage}
          notify={notify}
          onClose={() => setEditor(null)}
          onChanged={async () => { setEditor(null); await load(); }}
        />
      )}
    </BusinessPageShell>
  );
}

function CoveragePanel({ coverage }) {
  if (!coverage) return null;
  const families = coverage.families || [];
  const uncovered = families.filter((family) => family.coverage === 'UNCOVERED');
  return (
    <section>
      {uncovered.length > 0 && (
        <InlineAlert tone="danger" title="存在职责分离缺口">
          {uncovered.map((family) => family.label).join('、')} 既无平台规则也无既有防护。
        </InlineAlert>
      )}
      <p className="platform-ops__note">
        每个审批族都必须被一条平台规则覆盖，或显式登记为「该族无平台约束，由既有自审批防护负责」。
      </p>
      <div className="platform-ops__list">
        {families.map((family) => (
          <article
            key={family.businessType}
            className={`platform-ops__card platform-ops__coverage is-${
              family.coverage === 'RULE_COVERED' ? 'covered'
                : family.coverage === 'NATIVE_GUARD' ? 'native' : 'uncovered'}`}
          >
            <header>
              <h3>{family.label}</h3>
              <span className={`platform-ops__badge is-${
                family.coverage === 'RULE_COVERED' ? 'covered'
                  : family.coverage === 'NATIVE_GUARD' ? 'native' : 'uncovered'}`}>
                {COVERAGE_LABELS[family.coverage] || family.coverage}
              </span>
            </header>
            <p>{family.note}</p>
            <dl className="platform-ops__facts">
              <div><dt>平台规则</dt><dd>{family.activeRuleCount} 生效 / {family.ruleCount} 总数</dd></div>
              <div><dt>既有防护</dt><dd>{family.nativeGuard ? `${family.nativeGuard.statusCode} 拦截` : '无'}</dd></div>
            </dl>
            {family.nativeGuard && <p className="platform-ops__code">既有防护文案：{family.nativeGuard.message}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}

function RulesPanel({ rules, creatable, canManage, onCreate, onEdit }) {
  const [filter, setFilter] = useState('ALL');
  const visible = filter === 'ALL' ? rules : rules.filter((rule) => rule.businessType === filter);
  const familyOptions = (creatable?.businessTypes || []);
  return (
    <section>
      <div className="platform-ops__toolbar">
        <select aria-label="按审批族过滤" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="ALL">全部审批族</option>
          {familyOptions.map((businessType) => (
            <option key={businessType} value={businessType}>{businessType}</option>
          ))}
        </select>
        {canManage && <button type="button" className="primary" onClick={onCreate}>＋ 新建规则</button>}
      </div>
      {visible.length === 0 && <div className="platform-ops__empty">该范围内没有职责分离规则。</div>}
      <div className="platform-ops__list">
        {visible.map((rule) => (
          <article key={rule.id} className="platform-ops__card">
            <header>
              <h3>{rule.businessTypeLabel}</h3>
              <StatusChip status={rule.status}>{rule.status === 'ACTIVE' ? '生效中' : '已停用'}</StatusChip>
            </header>
            <p className="platform-ops__code">{rule.code}</p>
            <dl className="platform-ops__facts">
              <div><dt>约束</dt><dd>{CONSTRAINT_LABELS[rule.constraintType] || rule.constraintType}</dd></div>
              <div><dt>处置</dt><dd>{RESOLUTION_LABELS[rule.resolution] || rule.resolution}</dd></div>
              <div><dt>决策动作</dt><dd>{rule.action}</dd></div>
              <div><dt>升级角色</dt><dd>{rule.escalateToRole || '—'}</dd></div>
            </dl>
            {canManage && (
              <div className="platform-ops__actions">
                <button type="button" className="secondary" onClick={() => onEdit(rule)}>编辑</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function EscalationsPanel({ escalations }) {
  const pending = escalations.filter((item) => !item.handled);
  if (!escalations.length) return <div className="platform-ops__empty">当前没有升级待办。</div>;
  return (
    <section>
      <p className="platform-ops__note">
        升级处置的载体：违规者的决策被拒并留痕后，由升级角色的成员走该族原有审批入口完成决策。
        共 {pending.length} 条待处理。
      </p>
      <div className="platform-ops__list">
        {escalations.map((item) => (
          <article key={item.key} className="platform-ops__card">
            <header>
              <h3>{item.businessTypeLabel} · {item.documentNo || item.businessId}</h3>
              <span className={`platform-ops__badge is-${item.handled ? 'covered' : 'pending'}`}>
                {item.handled ? '已处理' : '待处理'}
              </span>
            </header>
            <dl className="platform-ops__facts">
              <div><dt>命中规则</dt><dd>{item.ruleCode || '—'}</dd></div>
              <div><dt>升级角色</dt><dd>{item.escalateToRole || '—'}</dd></div>
              <div><dt>被拒操作人</dt><dd>{item.actorName}</dd></div>
              <div><dt>时间</dt><dd>{dateTime(item.evaluatedAt)}</dd></div>
            </dl>
            {item.escalateMembers?.length > 0 && (
              <ul className="platform-ops__member-list">
                {item.escalateMembers.map((member) => (
                  <li key={member.id}><span>{member.displayName}</span><span className="platform-ops__code">{member.id}</span></li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function EvaluationsPanel({ evaluations }) {
  if (!evaluations.length) return <div className="platform-ops__empty">还没有判定记录。</div>;
  return (
    <section className="platform-ops__scroll-x">
      <table className="platform-ops__table">
        <thead>
          <tr><th>时间</th><th>审批族</th><th>业务对象</th><th>判定</th><th>规则</th><th>说明</th></tr>
        </thead>
        <tbody>
          {evaluations.map((item) => (
            <tr key={item.id}>
              <td>{dateTime(item.evaluatedAt)}</td>
              <td>{item.businessTypeLabel}</td>
              <td className="wrap">{item.businessId}</td>
              <td>{DECISION_LABELS[item.decision] || item.decision}</td>
              <td className="wrap">{item.ruleCode || '—'}</td>
              <td className="wrap">{item.reason || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RuleEditorSheet({ editor, creatable, families, canManage, notify, onClose, onChanged }) {
  const isCreate = editor.mode === 'create';
  const rule = editor.rule;
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    code: '',
    businessType: families[0]?.businessType || '',
    constraintType: creatable?.constraintTypes?.[0] || 'SAME_PERSON_FORBIDDEN',
    resolution: creatable?.resolutions?.[0] || 'REJECT',
    escalateToRole: '',
  });

  const familyLabel = (businessType) => families.find((item) => item.businessType === businessType)?.label || businessType;
  const needsEscalateRole = form.resolution === 'ESCALATE';

  async function save() {
    setBusy(true);
    try {
      if (isCreate) {
        await api('/api/platform/sod/rules', {
          method: 'POST',
          body: {
            code: form.code,
            businessType: form.businessType,
            constraintType: form.constraintType,
            resolution: form.resolution,
            ...(needsEscalateRole ? { escalateToRole: form.escalateToRole } : {}),
          },
        });
        notify('职责分离规则已创建', 'success');
      } else {
        await api(`/api/platform/sod/rules/${rule.id}`, {
          method: 'PATCH',
          body: {
            constraintType: form.constraintType,
            resolution: form.resolution,
            ...(needsEscalateRole ? { escalateToRole: form.escalateToRole } : {}),
          },
        });
        notify('职责分离规则已更新', 'success');
      }
      await onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus() {
    setBusy(true);
    try {
      const next = rule.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await api(`/api/platform/sod/rules/${rule.id}/status`, { method: 'POST', body: { status: next } });
      notify(next === 'ACTIVE' ? '规则已启用' : '规则已停用', 'success');
      await onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={isCreate ? '新建职责分离规则' : `编辑规则 ${rule.code}`} onClose={onClose}>
      <div className="platform-ops__form">
        {isCreate && (
          <FormRow label="规则编码" required hint="字母、数字、下划线或短横线；保存后不可修改">
            <input
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              placeholder="SOD-SALES-ORDER-SAME-ROLE"
            />
          </FormRow>
        )}
        {isCreate && (
          <FormRow label="审批族" required hint="只能选择已登记的审批族">
            <select value={form.businessType} onChange={(event) => setForm({ ...form, businessType: event.target.value })}>
              {families.map((family) => (
                <option key={family.businessType} value={family.businessType}>{family.label}</option>
              ))}
            </select>
          </FormRow>
        )}
        {!isCreate && (
          <p className="platform-ops__note">
            审批族与规则编码是身份，创建后不可修改。当前族：{familyLabel(rule.businessType)}。
          </p>
        )}
        <FormRow label="约束类型" required>
          <select value={form.constraintType} onChange={(event) => setForm({ ...form, constraintType: event.target.value })}>
            {(creatable?.constraintTypes || []).map((constraintType) => (
              <option key={constraintType} value={constraintType}>{CONSTRAINT_LABELS[constraintType] || constraintType}</option>
            ))}
          </select>
        </FormRow>
        <FormRow label="违规处置" required>
          <select value={form.resolution} onChange={(event) => setForm({ ...form, resolution: event.target.value })}>
            {(creatable?.resolutions || []).map((resolution) => (
              <option key={resolution} value={resolution}>{RESOLUTION_LABELS[resolution] || resolution}</option>
            ))}
          </select>
        </FormRow>
        {needsEscalateRole && (
          <FormRow label="升级角色" required hint="升级角色成员对「禁止同角色」约束豁免，避免升级死锁">
            <input
              value={form.escalateToRole}
              onChange={(event) => setForm({ ...form, escalateToRole: event.target.value.toUpperCase() })}
              placeholder="REVIEWER"
            />
          </FormRow>
        )}
        {creatable?.uncreatableConstraintReasons && (
          <InlineAlert tone="info" title="当前不可创建的约束类型">
            {Object.entries(creatable.uncreatableConstraintReasons).map(([key, reason]) => (
              <p key={key} className="platform-ops__hint">{CONSTRAINT_LABELS[key] || key}：{reason}</p>
            ))}
          </InlineAlert>
        )}
      </div>
      <BottomActionBar>
        <button type="button" className="secondary" onClick={onClose}>取消</button>
        {canManage && !isCreate && (
          <button type="button" className="secondary" disabled={busy} onClick={toggleStatus}>
            {rule.status === 'ACTIVE' ? '停用' : '启用'}
          </button>
        )}
        {canManage && <button type="button" className="primary" disabled={busy} onClick={save}>保存</button>}
      </BottomActionBar>
    </Sheet>
  );
}
