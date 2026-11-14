// Platform 编号规则维护面（PL-09）。
//
// 设计来源：docs/design/platform.md §32.8；Requirement §36.8。
//
// 两个分区：
//   - 编号规则：既有 6 种已覆盖单据 + 请购单的规则表；单号格式逐字符不变。
//   - 待迁移单据：13 种以上尚未接入编号服务的单据（Requirement §36.8 判为
//     OUT_OF_SCOPE），在 Operator 工作面以「待迁移」状态可见。

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, Loading } from '../components/ui.jsx';
import {
  BottomActionBar, BusinessPageShell, EmptyState, FormRow, InlineAlert, SegmentedControl,
  Sheet, StatusChip,
} from '../components/design-system.jsx';
import '../styles/platform-operations.css';

const TABS = [
  { value: 'rules', label: '编号规则' },
  { value: 'pending', label: '待迁移单据' },
];

const PERIOD_MODE_LABELS = { NONE: '无期间', MONTH: '按月', YEAR: '按年' };

export default function PlatformNumbering({ user, notify }) {
  const canManage = can(user, 'NUMBERING_MANAGE');
  const [tab, setTab] = useState('rules');
  const [series, setSeries] = useState([]);
  const [pendingTypes, setPendingTypes] = useState([]);
  const [state, setState] = useState('LOADING');
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    setState('LOADING');
    try {
      const response = await api('/api/platform/number-series');
      setSeries(response.series || []);
      setPendingTypes(response.pendingDocumentTypes || []);
      setState('READY');
    } catch (error) {
      setState('ERROR');
      notify(error.message, 'error');
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  return (
    <BusinessPageShell className="platform-ops" width="rail" data-testid="platform-numbering-page">
      <header className="platform-ops__hero">
        <div>
          <span>NUMBERING SERVICE</span>
          <h2>编号规则</h2>
        </div>
        <p>统一编号服务按「单据类型 + 组织 + 期间」发放单号；既有单号格式保持不变，历史数据与既有断言不受影响。</p>
      </header>

      {!canManage && <InlineAlert tone="info">当前账号为只读，维护编号规则需要 NUMBERING_MANAGE 权限。</InlineAlert>}

      <div className="platform-ops__tabs">
        <SegmentedControl label="工作面分区" options={TABS} value={tab} onChange={setTab}/>
      </div>

      {state === 'LOADING' && <Loading/>}
      {state === 'ERROR' && <EmptyState title="编号规则加载失败" action={<button type="button" className="secondary" onClick={() => void load()}>重新加载</button>}/>}

      {state === 'READY' && tab === 'rules' && (
        <RulesPanel
          series={series}
          canManage={canManage}
          onCreate={() => setEditor({ mode: 'create' })}
          onEdit={(rule) => setEditor({ mode: 'edit', rule })}
        />
      )}

      {state === 'READY' && tab === 'pending' && <PendingPanel pendingTypes={pendingTypes} series={series}/>}

      {editor && (
        <NumberSeriesEditorSheet
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

function RulesPanel({ series, canManage, onCreate, onEdit }) {
  return (
    <section>
      <div className="platform-ops__toolbar">
        <strong>共 {series.length} 条规则</strong>
        {canManage && <button type="button" className="primary" onClick={onCreate}>＋ 新建规则</button>}
      </div>
      {series.length === 0 && <div className="platform-ops__empty">还没有编号规则。</div>}
      <div className="platform-ops__list">
        {series.map((rule) => (
          <article key={rule.id} className="platform-ops__card">
            <header>
              <h3>{rule.documentType}</h3>
              <StatusChip status={rule.active ? 'ACTIVE' : 'INACTIVE'}>{rule.active ? '生效中' : '已停用'}</StatusChip>
            </header>
            <dl className="platform-ops__facts">
              <div><dt>前缀</dt><dd>{rule.prefix}</dd></div>
              <div><dt>后缀</dt><dd>{rule.suffix || '—'}</dd></div>
              <div><dt>期间模式</dt><dd>{PERIOD_MODE_LABELS[rule.periodMode] || rule.periodMode}</dd></div>
              <div><dt>补零长度</dt><dd>{rule.padLength}</dd></div>
            </dl>
            <p className="platform-ops__code">
              组织维度：{rule.orgId || '全局'}
            </p>
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

function PendingPanel({ pendingTypes, series }) {
  const migrated = new Set(series.map((rule) => rule.documentType));
  const remaining = pendingTypes.filter((item) => !migrated.has(item.documentType));
  return (
    <section>
      <p className="platform-ops__note">
        下列单据尚未接入编号服务，按 Requirement §36.8 判为 OUT_OF_SCOPE（迁移会触碰已冻结域的造号行为），
        在本工作面以「待迁移」状态可见。
      </p>
      {remaining.length === 0 && <div className="platform-ops__empty">没有待迁移的单据。</div>}
      <div className="platform-ops__list">
        {remaining.map((item) => (
          <article key={item.documentType} className="platform-ops__card">
            <header>
              <h3>{item.documentType}</h3>
              <span className="platform-ops__badge is-pending">待迁移</span>
            </header>
            <p className="platform-ops__code">{item.source}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function NumberSeriesEditorSheet({ editor, canManage, notify, onClose, onChanged }) {
  const isCreate = editor.mode === 'create';
  const rule = editor.rule;
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    documentType: '',
    orgId: '',
    prefix: rule?.prefix || '',
    suffix: rule?.suffix || '',
    periodMode: rule?.periodMode || 'MONTH',
    padLength: rule?.padLength ?? 5,
  });

  async function save() {
    setBusy(true);
    try {
      if (isCreate) {
        await api('/api/platform/number-series', { method: 'POST', body: form });
        notify('编号规则已创建', 'success');
      } else {
        await api(`/api/platform/number-series/${rule.id}`, {
          method: 'PATCH',
          body: {
            prefix: form.prefix,
            suffix: form.suffix,
            periodMode: form.periodMode,
            padLength: Number(form.padLength),
          },
        });
        notify('编号规则已更新', 'success');
      }
      await onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await api(`/api/platform/number-series/${rule.id}`, {
        method: 'PATCH', body: { active: !rule.active },
      });
      notify(rule.active ? '编号规则已停用' : '编号规则已启用', 'success');
      await onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={isCreate ? '新建编号规则' : `编辑编号规则 ${rule.documentType}`} onClose={onClose}>
      <div className="platform-ops__form">
        {isCreate && (
          <FormRow label="单据类型" required hint="字母、数字、下划线或短横线">
            <input value={form.documentType} onChange={(event) => setForm({ ...form, documentType: event.target.value.toUpperCase() })} placeholder="SO"/>
          </FormRow>
        )}
        {isCreate && (
          <FormRow label="组织维度" hint="留空表示全局编号段">
            <input value={form.orgId} onChange={(event) => setForm({ ...form, orgId: event.target.value })}/>
          </FormRow>
        )}
        <FormRow label="编号前缀" required>
          <input value={form.prefix} onChange={(event) => setForm({ ...form, prefix: event.target.value })}/>
        </FormRow>
        <FormRow label="编号后缀">
          <input value={form.suffix} onChange={(event) => setForm({ ...form, suffix: event.target.value })}/>
        </FormRow>
        <FormRow label="期间模式" required>
          <select value={form.periodMode} onChange={(event) => setForm({ ...form, periodMode: event.target.value })}>
            {Object.entries(PERIOD_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </FormRow>
        <FormRow label="补零长度" required hint="1–12 的整数">
          <input type="number" inputMode="numeric" min="1" max="12" value={form.padLength}
            onChange={(event) => setForm({ ...form, padLength: event.target.value })}/>
        </FormRow>
        {!isCreate && (
          <InlineAlert tone="info">
            修改既有规则会改变后续单号格式；历史单号与既有断言不受影响，但请谨慎评估。
          </InlineAlert>
        )}
      </div>
      <BottomActionBar>
        <button type="button" className="secondary" onClick={onClose}>取消</button>
        {!isCreate && canManage && (
          <button type="button" className="secondary" disabled={busy} onClick={toggleActive}>
            {rule.active ? '停用' : '启用'}
          </button>
        )}
        {canManage && <button type="button" className="primary" disabled={busy} onClick={save}>保存</button>}
      </BottomActionBar>
    </Sheet>
  );
}
