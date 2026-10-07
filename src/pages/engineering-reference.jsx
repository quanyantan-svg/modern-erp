// V17 Master & Engineering Domain Closure — Engineering Reference workbench.
//
// Mobile-first page exposing:
//   - Shift / Shift Pattern / Calendar Template / Work Calendar
//   - Basic Activity / Workshop Formula
//   - Resource / Equipment / Operation / Control Code
//   - Work Center
//
// Implementation discipline (per erp-mobile-taste):
//   - One dominant heading; compact segmented sub-navigation.
//   - LIST → DETAIL → EDITOR pattern; no card-everywhere.
//   - Backend governs lifecycle; UI surfaces state + actions that the
//     backend actually permits.
//   - Workshop Formula UI MUST call backend safe parser; never eval /
//     Function on the client.
//
// Skeleton: existing Engineering Reference backend already returns the
// canonical contracts (see server/modules/engineering-reference.js).

import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, Empty, FormActions, Modal, Status } from '../components/ui.jsx';
import {
  BusinessAction, BusinessActionBar, BusinessPageHeader, BusinessPageShell,
  CompactRecordList, HelpDisclosure, RecordCard, RecordList,
} from '../components/design-system.jsx';

const SECTIONS = [
  { key: 'calendar', label: '日历与班次', summary: 'Shift / Pattern / Calendar / Template' },
  { key: 'formula', label: '公式', summary: 'Workshop Formula (受限语法)' },
  { key: 'resources', label: '资源 / 设备', summary: 'Resource / Equipment' },
  { key: 'operations', label: '作业 / 控制码', summary: 'Operation / Control Code / Activity' },
  { key: 'work-centers', label: '工作中心', summary: 'Work Center (能力 / 停用)' },
];

const STATUS_LABELS = { ACTIVE: '启用', INACTIVE: '停用', DRAFT: '草稿' };

function SectionTabs({ value, onChange }) {
  return <nav className="engineering-reference-tabs" aria-label="工程基础资料子模块">
    {SECTIONS.map((section) => (
      <button key={section.key} type="button"
        className={`engineering-reference-tab${value === section.key ? ' is-active' : ''}`}
        onClick={() => onChange(section.key)}>{section.label}</button>
    ))}
  </nav>;
}

function MetaList({ items }) {
  if (!items || items.length === 0) return null;
  return <dl className="record-card-meta">
    {items.slice(0, 6).map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value || '—'}</dd></div>)}
  </dl>;
}

function EntityList({ items, onSelect = () => {}, emptyText }) {
  if (!items || items.length === 0) return <Empty text={emptyText || '暂无数据'} />;
  return <CompactRecordList>
    {items.map((item) => (
      <RecordCard key={item.id} title={item.code || item.title} subtitle={item.name || item.subtitle}
        status={<Status status={(item.active === 0 || item.status === 'INACTIVE') ? 'inactive' : 'active'} label={STATUS_LABELS[item.status] || (item.active === 0 ? '停用' : '启用')} />}
        facts={(item.facts || []).slice(0, 4)}
        onClick={() => onSelect(item)} />
    ))}
  </CompactRecordList>;
}

function useCollection(endpoint, responseKey, deps = []) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const load = () => {
    setLoading(true);
    api(endpoint).then((res) => { setItems(res[responseKey] || []); setError(null); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, deps);
  return { items, setItems, loading, error, reload: load };
}

function CalendarSection({ user, notify, canManage }) {
  const shifts = useCollection('/api/engineering/shifts', 'shifts');
  const patterns = useCollection('/api/engineering/shift-patterns', 'patterns');
  const calTpls = useCollection('/api/engineering/calendar-templates', 'templates');
  const calendars = useCollection('/api/engineering/work-calendars', 'calendars');
  const [selected, setSelected] = useState(null);
  const [editor, setEditor] = useState(null);
  const refresh = () => { shifts.reload(); patterns.reload(); calTpls.reload(); calendars.reload(); };

  const lists = [
    { id: 'shift', label: '班次', rows: shifts.items.map((s) => ({
      id: s.id, code: s.code, name: s.name, active: s.active, raw: s,
      facts: [
        { label: '起始', value: `${Math.floor(s.start_minute / 60)}:${String(s.start_minute % 60).padStart(2, '0')}` },
        { label: '结束', value: `${Math.floor(s.end_minute / 60)}:${String(s.end_minute % 60).padStart(2, '0')}` },
        { label: '备注', value: s.notes || '—' },
      ],
    })) },
    { id: 'pattern', label: '班制', rows: patterns.items.map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.active ? 'ACTIVE' : 'INACTIVE', facts: [] })) },
    { id: 'calendar-template', label: '日历模板', rows: calTpls.items.map((t) => ({ id: t.id, code: t.code, name: t.name, status: t.active ? 'ACTIVE' : 'INACTIVE', facts: [{ label: '工作日', value: t.work_days }, { label: '班制', value: t.shift_pattern_code || '—' }] })) },
    { id: 'work-calendar', label: '工作日历', rows: calendars.items.map((c) => ({ id: c.id, code: c.code, name: c.name, status: c.active ? 'ACTIVE' : 'INACTIVE', facts: [{ label: '模板', value: c.template_code || '—' }, { label: '起止', value: `${c.start_date} ~ ${c.end_date}` }] })) },
  ];

  const onCreate = (kind) => setEditor({ kind });
  const onSelect = (item) => {
    const kind = lists.find((l) => l.rows.some((r) => r.id === item.id))?.id;
    setSelected({ ...item, kind });
  };

  return <section className="engineering-reference-section">
    <div className="engineering-reference-section-head">
      <h3>工作日历与班次</h3>
      {canManage && <BusinessAction hierarchy="primary" onClick={() => onCreate('shift')}>新建班次</BusinessAction>}
    </div>
    <RecordList>
      {lists.map((list) => (
        <article key={list.id} className="engineering-reference-list-block">
          <header><strong>{list.label}</strong><span>{list.rows.length}</span>
            {canManage && <button type="button" className="secondary" onClick={() => onCreate(list.id)}>新建</button>}
          </header>
          <EntityList items={list.rows} onSelect={onSelect} emptyText={`暂无${list.label}`} />
        </article>
      ))}
    </RecordList>
    {editor && <CalendarKindEditor kind={editor.kind} onClose={() => { setEditor(null); refresh(); }} notify={notify} />}
    {selected && <CalendarDetailView item={selected} onClose={() => setSelected(null)} />}
  </section>;
}

function CalendarKindEditor({ kind, onClose, notify }) {
  const [body, setBody] = useState(() => defaultCalendarBody(kind));
  const save = async () => {
    try {
      const endpoint = calendarEndpoint(kind);
      await api(endpoint, { method: 'POST', body });
      notify('已保存');
      onClose();
    } catch (err) { notify(err.message, 'error'); }
  };
  return <Modal title={calendarLabel(kind)} onClose={onClose}>
    <form className="engineering-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      {calendarFields(kind, body, setBody)}
      <FormActions onClose={onClose} />
    </form>
  </Modal>;
}

function CalendarDetailView({ item, onClose }) {
  return <Modal title={`${item.code} · ${item.name}`} onClose={onClose}>
    <MetaList items={item.facts} />
    <p className="record-card-facts">当前资料的状态与关键属性。历史已引用资料不在界面提供硬删除。</p>
  </Modal>;
}

function defaultCalendarBody(kind) {
  switch (kind) {
    case 'shift': return { code: '', name: '', startMinute: 480, endMinute: 1020 };
    case 'pattern': return { code: '', name: '', shiftIds: [] };
    case 'calendar-template': return { code: '', name: '', workDays: [1, 2, 3, 4, 5] };
    case 'work-calendar': return { code: '', name: '', startDate: '', endDate: '' };
    default: return {};
  }
}
function calendarEndpoint(kind) {
  return ({ shift: '/api/engineering/shifts', pattern: '/api/engineering/shift-patterns',
    'calendar-template': '/api/engineering/calendar-templates', 'work-calendar': '/api/engineering/work-calendars' })[kind];
}
function calendarLabel(kind) {
  return ({ shift: '新建班次', pattern: '新建班制', 'calendar-template': '新建日历模板', 'work-calendar': '新建工作日历' })[kind];
}
function calendarFields(kind, body, setBody) {
  const set = (field, transform = (value) => value) => (e) => setBody((prev) => ({ ...prev, [field]: transform(e.target.value) }));
  if (kind === 'shift') return <>
    <label>编码<input value={body.code || ''} onChange={set('code')} required /></label>
    <label>名称<input value={body.name || ''} onChange={set('name')} required /></label>
    <label>起始分钟<input type="number" value={body.startMinute ?? 0} onChange={set('startMinute', Number)} /></label>
    <label>结束分钟<input type="number" value={body.endMinute ?? 0} onChange={set('endMinute', Number)} /></label>
  </>;
  if (kind === 'pattern') return <>
    <label>编码<input value={body.code || ''} onChange={set('code')} required /></label>
    <label>名称<input value={body.name || ''} onChange={set('name')} required /></label>
    <label className="full">班次 ID（逗号分隔）<input value={(body.shiftIds || []).join(',')} onChange={set('shiftIds', (value) => value.split(',').map((item) => item.trim()).filter(Boolean))} required /></label>
  </>;
  if (kind === 'calendar-template') return <>
    <label>编码<input value={body.code || ''} onChange={set('code')} required /></label>
    <label>名称<input value={body.name || ''} onChange={set('name')} required /></label>
    <label>班制 ID<input value={body.shiftPatternId || ''} onChange={set('shiftPatternId')} /></label>
  </>;
  return <>
    <label>编码<input value={body.code || ''} onChange={set('code')} required /></label>
    <label>名称<input value={body.name || ''} onChange={set('name')} required /></label>
    <label>起始<input type="date" value={body.startDate || ''} onChange={set('startDate')} required /></label>
    <label>结束<input type="date" value={body.endDate || ''} onChange={set('endDate')} required /></label>
    <label className="full">日历模板 ID<input value={body.templateId || ''} onChange={set('templateId')} /></label>
  </>;
}

function FormulaSection({ user, notify, canManage }) {
  const formulas = useCollection('/api/engineering/workshop-formulas', 'formulas');
  const activities = useCollection('/api/engineering/basic-activities', 'activities');
  const [editor, setEditor] = useState(null);
  const refresh = () => { formulas.reload(); activities.reload(); };
  return <section className="engineering-reference-section">
    <div className="engineering-reference-section-head">
      <h3>公式与基础活动</h3>
      {canManage && <BusinessActionBar><BusinessAction hierarchy="secondary" onClick={() => setEditor({ kind: 'activity' })}>新建基础活动</BusinessAction><BusinessAction hierarchy="primary" onClick={() => setEditor({ kind: 'formula' })}>新建公式</BusinessAction></BusinessActionBar>}
    </div>
    <article className="engineering-reference-block">
      <header><strong>车间公式</strong><span>{formulas.items.length}</span></header>
      <EntityList items={formulas.items.map((f) => ({ id: f.id, code: f.code, name: f.name,
        status: f.active ? 'ACTIVE' : 'INACTIVE',
        facts: [{ label: '公式', value: f.formula }, { label: '变量', value: f.variables || '[]' }] }))}
        onSelect={(item) => setEditor({ kind: 'formula', item })} canManage={canManage}
        emptyText="暂无公式" />
    </article>
    <article className="engineering-reference-block">
      <header><strong>基础活动</strong><span>{activities.items.length}</span></header>
      <EntityList items={activities.items.map((a) => ({ id: a.id, code: a.code, name: a.name,
        status: a.active ? 'ACTIVE' : 'INACTIVE',
        facts: [{ label: '阶段', value: a.stage }, { label: '单位', value: a.unit || '—' }] }))}
        onSelect={(item) => setEditor({ kind: 'activity-view', item })} emptyText="暂无基础活动" />
    </article>
    {editor?.kind === 'formula' && <FormulaEditor editor={editor} onClose={() => { setEditor(null); refresh(); }} notify={notify} />}
    {editor?.kind === 'activity' && <ReferenceCreateEditor kind="activity" onClose={() => { setEditor(null); refresh(); }} notify={notify} />}
    {editor?.kind === 'activity-view' && <ReferenceDetail item={editor.item} title="基础活动" onClose={() => setEditor(null)} />}
  </section>;
}

function FormulaEditor({ editor, onClose, notify }) {
  const isExisting = Boolean(editor.item);
  const [body, setBody] = useState(() => isExisting ? {
    code: editor.item.code, name: editor.item.name, formula: editor.item.formula, variables: editor.item.variables || '[]',
  } : { code: '', name: '', formula: '', variables: '[]' });
  const [test, setTest] = useState(null);
  const save = async () => {
    try {
      const variables = JSON.parse(body.variables || '[]');
      if (!Array.isArray(variables)) throw new Error('变量必须是 JSON 数组');
      await api('/api/engineering/workshop-formulas', { method: 'POST', body: { ...body, variables } });
      notify('已保存');
      onClose();
    } catch (err) { notify(err.message, 'error'); }
  };
  const tryEvaluate = async () => {
    try {
      if (!editor.item?.id) throw new Error('请先保存公式；保存时由后端安全解析器验证语法');
      const variables = {};
      try { (JSON.parse(body.variables || '[]') || []).forEach((v) => { variables[v] = 1; }); } catch { /* ignore */ }
      const ev = await api(`/api/engineering/workshop-formulas/${editor.item.id}/evaluate`, { method: 'POST', body: { variables } });
      setTest({ ok: true, value: ev.value });
    } catch (err) {
      setTest({ ok: false, error: err.message });
    }
  };
  return <Modal title={isExisting ? '查看与试算公式' : '新建公式'} onClose={onClose} wide>
    <form className="engineering-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label>编码<input value={body.code} onChange={(e) => setBody({ ...body, code: e.target.value })} required disabled={isExisting} /></label>
      <label>名称<input value={body.name} onChange={(e) => setBody({ ...body, name: e.target.value })} required disabled={isExisting} /></label>
      <label className="full">公式
        <textarea rows={3} value={body.formula} onChange={(e) => setBody({ ...body, formula: e.target.value })} required disabled={isExisting} />
        <small className="variable-hint">允许：数字 / e_ 前缀变量 / + - * / ^ ( ) ；禁止 eval / Function / 函数调用；长度 ≤ 256，深度 ≤ 20。</small>
      </label>
      <label className="full">变量 JSON<input value={body.variables} onChange={(e) => setBody({ ...body, variables: e.target.value })} placeholder='["e_qty","e_run"]' disabled={isExisting} /></label>
      <BusinessActionBar>
        {isExisting && <button type="button" className="secondary" onClick={tryEvaluate}>试算</button>}
        {isExisting ? <button type="button" className="primary" onClick={onClose}>关闭</button> : <button type="submit" className="primary">保存</button>}
      </BusinessActionBar>
      {test && (test.ok
        ? <p className="engineering-form-result engineering-form-result--ok">试算成功：{String(test.value)}</p>
        : <p className="engineering-form-result engineering-form-result--fail">试算失败：{test.error}</p>)}
    </form>
  </Modal>;
}

function ResourcesSection({ user, notify, canManage }) {
  const resources = useCollection('/api/engineering/resources', 'resources');
  const equipment = useCollection('/api/engineering/equipment', 'equipment');
  const [editor, setEditor] = useState(null);
  const refresh = () => { resources.reload(); equipment.reload(); };
  return <section className="engineering-reference-section">
    <div className="engineering-reference-section-head">
      <h3>资源与设备</h3>
      {canManage && <BusinessAction hierarchy="primary" onClick={() => setEditor({ kind: 'resource' })}>新建资源</BusinessAction>}
    </div>
    <article className="engineering-reference-block">
      <header><strong>资源</strong><span>{resources.items.length}</span></header>
      <EntityList items={resources.items.map((r) => ({ id: r.id, code: r.code, name: r.name,
        status: r.active ? 'ACTIVE' : 'INACTIVE',
        facts: [{ label: '类别', value: r.category }, { label: '数量', value: r.quantity }, { label: '工作中心', value: r.work_center_code || '—' }] }))}
        onSelect={(item) => setEditor({ kind: 'view', title: '资源', item })} emptyText="暂无资源" />
    </article>
    <article className="engineering-reference-block">
      <header><strong>设备</strong><span>{equipment.items.length}</span>{canManage && <button type="button" className="secondary" onClick={() => setEditor({ kind: 'equipment' })}>新建设备</button>}</header>
      <EntityList items={equipment.items.map((e) => ({ id: e.id, code: e.code, name: e.name,
        status: e.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
        facts: [{ label: '型号', value: e.model || '—' }, { label: '工作中心', value: e.work_center_code || '—' }] }))}
        onSelect={(item) => setEditor({ kind: 'view', title: '设备', item })} emptyText="暂无设备" />
    </article>
    {editor?.kind === 'view' ? <ReferenceDetail item={editor.item} title={editor.title} onClose={() => setEditor(null)} /> : editor && <ReferenceCreateEditor kind={editor.kind} notify={notify} onClose={() => { setEditor(null); refresh(); }} />}
  </section>;
}

function OperationsSection({ user, notify, canManage }) {
  const operations = useCollection('/api/engineering/operations', 'operations');
  const codes = useCollection('/api/engineering/control-codes', 'codes');
  const [editor, setEditor] = useState(null);
  const refresh = () => { operations.reload(); codes.reload(); };
  return <section className="engineering-reference-section">
    <div className="engineering-reference-section-head">
      <h3>作业与控制码</h3>
      {canManage && <BusinessAction hierarchy="primary" onClick={() => setEditor({ kind: 'operation' })}>新建作业</BusinessAction>}
    </div>
    <article className="engineering-reference-block">
      <header><strong>作业</strong><span>{operations.items.length}</span></header>
      <EntityList items={operations.items.map((o) => ({ id: o.id, code: o.code, name: o.name,
        status: o.active ? 'ACTIVE' : 'INACTIVE',
        facts: [{ label: '标准工时', value: `${o.standard_minutes} 分钟` }, { label: '活动', value: o.activity_code || '—' }, { label: '工作中心', value: o.work_center_code || '—' }] }))}
        onSelect={(item) => setEditor({ kind: 'view', title: '作业', item })} emptyText="暂无作业" />
    </article>
    <article className="engineering-reference-block">
      <header><strong>控制码</strong><span>{codes.items.length}</span>{canManage && <button type="button" className="secondary" onClick={() => setEditor({ kind: 'control-code' })}>新建控制码</button>}</header>
      <EntityList items={codes.items.map((c) => ({ id: c.id, code: c.code, name: c.name,
        status: c.active ? 'ACTIVE' : 'INACTIVE',
        facts: [{ label: '类别', value: c.category }, { label: '策略', value: c.policy }] }))}
        onSelect={(item) => setEditor({ kind: 'view', title: '控制码', item })} emptyText="暂无控制码" />
    </article>
    {editor?.kind === 'view' ? <ReferenceDetail item={editor.item} title={editor.title} onClose={() => setEditor(null)} /> : editor && <ReferenceCreateEditor kind={editor.kind} notify={notify} onClose={() => { setEditor(null); refresh(); }} />}
  </section>;
}

function WorkCenterSection({ user, notify, canManage, onChange }) {
  const workCenters = useCollection('/api/work-centers/enhanced', 'workCenters');
  const [selected, setSelected] = useState(null);
  return <section className="engineering-reference-section">
    <div className="engineering-reference-section-head">
      <h3>工作中心</h3>
    </div>
    <EntityList items={workCenters.items.map((w) => ({
      id: w.id, code: w.code, name: w.name, status: w.active ? 'ACTIVE' : 'INACTIVE',
      facts: [
        { label: '类型', value: w.type },
        { label: '能力', value: `${w.capacity_hours} h` },
        { label: '效率', value: `${w.default_efficiency_pct}%` },
        { label: '日历', value: w.calendar_code || '—' },
        { label: '委外', value: w.is_outsource ? '是' : '否' },
      ],
    }))}
      onSelect={(item) => setSelected(item)}
      canManage={canManage}
      emptyText="暂无工作中心" />
    {selected && <WorkCenterDetail item={selected} onClose={() => setSelected(null)} canManage={canManage} onChanged={() => { workCenters.reload(); onChange?.(); }} notify={notify} />}
  </section>;
}

function WorkCenterDetail({ item, onClose, canManage, onChanged, notify }) {
  const deactivate = async () => {
    try {
      await api(`/api/work-centers/${item.id}/deactivate`, { method: 'POST' });
      notify('已停用'); onChanged?.(); onClose();
    } catch (err) { notify(err.message, 'error'); }
  };
  return <Modal title={`${item.code} · ${item.name}`} onClose={onClose}>
    <MetaList items={item.facts} />
    {canManage && <BusinessActionBar>
      <button className="secondary" onClick={onClose}>关闭</button>
      {item.status === 'ACTIVE' && <button className="danger-text" onClick={deactivate}>停用</button>}
    </BusinessActionBar>}
  </Modal>;
}

const REFERENCE_EDITOR = {
  activity: { title: '新建基础活动', endpoint: '/api/engineering/basic-activities', initial: { code: '', name: '', stage: 'PROCESS', unit: '', defaultQuantity: 0 } },
  resource: { title: '新建资源', endpoint: '/api/engineering/resources', initial: { code: '', name: '', category: 'MACHINE', quantity: 1, unit: '', workCenterId: '' } },
  equipment: { title: '新建设备', endpoint: '/api/engineering/equipment', initial: { code: '', name: '', model: '', serial: '', workCenterId: '' } },
  operation: { title: '新建作业', endpoint: '/api/engineering/operations', initial: { code: '', name: '', standardMinutes: 0, activityId: '', workCenterId: '' } },
  'control-code': { title: '新建控制码', endpoint: '/api/engineering/control-codes', initial: { code: '', name: '', category: 'PROCESSING', policy: '' } },
};

function ReferenceCreateEditor({ kind, onClose, notify }) {
  const config = REFERENCE_EDITOR[kind];
  const [body, setBody] = useState(config.initial);
  const labels = { code: '编码', name: '名称', stage: '阶段', unit: '单位', defaultQuantity: '默认数量', category: '类别', quantity: '数量', workCenterId: '工作中心 ID', model: '型号', serial: '序列号', standardMinutes: '标准工时（分钟）', activityId: '基础活动 ID', policy: '策略' };
  const field = (name, type = 'text') => <label key={name}>{labels[name] || name}<input type={type} value={body[name]} onChange={(event) => setBody({ ...body, [name]: type === 'number' ? Number(event.target.value) : event.target.value })} required={['code', 'name'].includes(name)} /></label>;
  const save = async () => {
    try { await api(config.endpoint, { method: 'POST', body }); notify('已保存'); onClose(); }
    catch (error) { notify(error.message, 'error'); }
  };
  const fields = kind === 'activity'
    ? [field('code'), field('name'), field('stage'), field('unit'), field('defaultQuantity', 'number')]
    : kind === 'resource'
    ? [field('code'), field('name'), field('category'), field('quantity', 'number'), field('unit'), field('workCenterId')]
    : kind === 'equipment'
      ? [field('code'), field('name'), field('model'), field('serial'), field('workCenterId')]
      : kind === 'operation'
        ? [field('code'), field('name'), field('standardMinutes', 'number'), field('activityId'), field('workCenterId')]
        : [field('code'), field('name'), field('category'), field('policy')];
  return <Modal title={config.title} onClose={onClose}>
    <form className="engineering-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {fields}<FormActions onClose={onClose} />
    </form>
  </Modal>;
}

function ReferenceDetail({ item, title, onClose }) {
  return <Modal title={`${title}·${item.code || ''} ${item.name || ''}`} onClose={onClose}>
    <MetaList items={item.facts || []} />
    <BusinessActionBar><button type="button" className="primary" onClick={onClose}>关闭</button></BusinessActionBar>
  </Modal>;
}

export default function EngineeringReference({ user, notify }) {
  const [section, setSection] = useState('calendar');
  const canManage = can(user, 'ENGINEERING_REFERENCE_MANAGE');
  const canManageWorkCenters = can(user, 'WORK_CENTERS_MANAGE');
  return <BusinessPageShell className="engineering-reference-v15" width="rail">
    <BusinessPageHeader title="工程基础资料"
      help={<HelpDisclosure summary="工作面说明"><p>本工作面集中维护班次/日历/公式/资源/作业/工作中心等工程基础资料。所有历史已被引用的资料使用 active lifecycle (active=0 停用)，不在 UI 暴露 hard-delete。</p></HelpDisclosure>} />
    <SectionTabs value={section} onChange={setSection} />
    {section === 'calendar' && <CalendarSection user={user} notify={notify} canManage={canManage} />}
    {section === 'formula' && <FormulaSection user={user} notify={notify} canManage={canManage} />}
    {section === 'resources' && <ResourcesSection user={user} notify={notify} canManage={canManage} />}
    {section === 'operations' && <OperationsSection user={user} notify={notify} canManage={canManage} />}
    {section === 'work-centers' && <WorkCenterSection user={user} notify={notify} canManage={canManageWorkCenters} />}
  </BusinessPageShell>;
}
