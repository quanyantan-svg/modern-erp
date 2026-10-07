// V17 Master & Engineering Domain Closure — Substitute & Configuration.
//
// Mobile-first workbench for:
//   - Substitute Scheme + Substitute relations (with deterministic resolver)
//   - Configurable BOM (selectable / replaceable / modifiable + config_group)
//
// Backend contracts:
//   - GET /api/engineering/substitute-schemes
//   - POST /api/engineering/substitute-schemes
//   - GET /api/engineering/substitutes
//   - POST /api/engineering/substitutes
//   - DELETE /api/engineering/substitutes/:id
//   - GET /api/engineering/substitutes/resolve?product_id=...
//   - POST /api/engineering/configurable-boms/preview
//   - POST /api/engineering/configurable-boms/validate
//
// Implementation discipline (per erp-mobile-taste):
//   - Compact segmented navigation between Substitute / Configuration.
//   - Lists → Detail → Editor pattern.
//   - Resolver preview is informational only; never creates stock /
//     production side effects.

import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, Empty, FormActions, Modal } from '../components/ui.jsx';
import {
  BusinessAction, BusinessActionBar, BusinessPageHeader, BusinessPageShell,
  CompactRecordList, HelpDisclosure, RecordCard,
} from '../components/design-system.jsx';

const STRATEGY_LABELS = {
  MIXED: '混用', MANUAL: '手工', BATCH: '整批', BATCH_MIXED: '整批 + 混用',
};
const METHOD_LABELS = {
  REPLACE: '替代', SUPERSEDE: '取代', PROPORTION: '按比例',
};
const STATUS_LABELS = { ACTIVE: '启用', INACTIVE: '停用' };

function TabNav({ value, onChange, items }) {
  return <nav className="engineering-substitute-tabs" aria-label="替代料与配置子模块">
    {items.map((item) => (
      <button key={item.key} type="button"
        className={`engineering-substitute-tab${value === item.key ? ' is-active' : ''}`}
        onClick={() => onChange(item.key)}>{item.label}</button>
    ))}
  </nav>;
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

function SchemeSection({ user, notify, canManage }) {
  const schemes = useCollection('/api/engineering/substitute-schemes', 'schemes');
  const substitutes = useCollection('/api/engineering/substitutes', 'substitutes');
  const [editingScheme, setEditingScheme] = useState(null);
  const [editingSubstitute, setEditingSubstitute] = useState(null);
  const refresh = () => { schemes.reload(); substitutes.reload(); };

  return <section className="engineering-substitute-section">
    <div className="engineering-substitute-section-head">
      <h3>替代料方案</h3>
      {canManage && <BusinessAction hierarchy="primary" onClick={() => setEditingScheme({ create: true })}>新建方案</BusinessAction>}
    </div>
    <CompactRecordList>
      {schemes.items.map((s) => (
        <RecordCard key={s.id} title={`${s.code} · ${s.name}`}
          subtitle={`${STRATEGY_LABELS[s.strategy] || s.strategy} / ${METHOD_LABELS[s.method] || s.method}`}
          status={<span className="status-chip">{STATUS_LABELS[s.active ? 'ACTIVE' : 'INACTIVE']}</span>}
          facts={[{ label: '策略', value: STRATEGY_LABELS[s.strategy] || s.strategy }, { label: '方式', value: METHOD_LABELS[s.method] || s.method }]}
          actions={canManage && <button className="secondary" onClick={() => setEditingScheme(s)}>查看</button>}
          onClick={() => setEditingScheme(s)} />
      ))}
    </CompactRecordList>
    {!schemes.items.length && <Empty text="暂无替代料方案" />}

    <h4 className="engineering-substitute-subhead">替代关系</h4>
    <CompactRecordList>
      {substitutes.items.map((sub) => (
        <RecordCard key={sub.id} title={`${sub.primary_product_code} → ${sub.substitute_product_code}`}
          subtitle={`${sub.scheme_code} · 优先级 ${sub.priority} · 比例 ${sub.ratio}`}
          status={<span className="status-chip">{sub.active ? '启用' : '停用'}</span>}
          facts={[
            { label: '主料', value: sub.primary_product_name || sub.primary_product_code },
            { label: '替代', value: sub.substitute_product_name || sub.substitute_product_code },
            { label: '生效', value: sub.effective_from || '永久' },
            { label: '失效', value: sub.effective_to || '永久' },
          ]}
          onClick={() => setEditingSubstitute(sub)} />
      ))}
    </CompactRecordList>
    {!substitutes.items.length && <Empty text="暂无替代关系" />}
    {canManage && <BusinessActionBar>
      <button className="secondary" onClick={() => setEditingSubstitute({ create: true, schemes: schemes.items })}>新建替代关系</button>
    </BusinessActionBar>}

    {editingScheme && <SchemeEditor editor={editingScheme} onClose={() => { setEditingScheme(null); refresh(); }} notify={notify} />}
    {editingSubstitute && <SubstituteEditor editor={editingSubstitute} schemes={schemes.items} onClose={() => { setEditingSubstitute(null); refresh(); }} notify={notify} />}
  </section>;
}

function SchemeEditor({ editor, onClose, notify }) {
  const isEdit = !editor.create;
  const [body, setBody] = useState(() => isEdit ? {
    code: editor.code, name: editor.name, strategy: editor.strategy, method: editor.method,
  } : { code: '', name: '', strategy: 'MIXED', method: 'REPLACE' });
  const save = async () => {
    try {
      await api('/api/engineering/substitute-schemes', { method: 'POST', body });
      notify('已保存');
      onClose();
    } catch (err) { notify(err.message, 'error'); }
  };
  return <Modal title={isEdit ? `查看方案 ${editor.code}` : '新建替代方案'} onClose={onClose}>
    <form className="engineering-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label>编码<input value={body.code} onChange={(e) => setBody({ ...body, code: e.target.value })} required disabled={isEdit} /></label>
      <label>名称<input value={body.name} onChange={(e) => setBody({ ...body, name: e.target.value })} required disabled={isEdit} /></label>
      <label>策略
        <select value={body.strategy} onChange={(e) => setBody({ ...body, strategy: e.target.value })} disabled={isEdit}>
          {Object.entries(STRATEGY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <label>方式
        <select value={body.method} onChange={(e) => setBody({ ...body, method: e.target.value })} disabled={isEdit}>
          {Object.entries(METHOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      {isEdit ? <BusinessActionBar><button type="button" className="primary" onClick={onClose}>关闭</button></BusinessActionBar> : <FormActions onClose={onClose} />}
    </form>
  </Modal>;
}

function SubstituteEditor({ editor, schemes, onClose, notify }) {
  const isEdit = !editor.create;
  const [body, setBody] = useState(() => isEdit ? {
    schemeId: editor.scheme_id, primaryProductId: editor.primary_product_id,
    substituteProductId: editor.substitute_product_id, priority: editor.priority, ratio: editor.ratio,
    effectiveFrom: editor.effective_from || '', effectiveTo: editor.effective_to || '',
  } : { schemeId: schemes[0]?.id || '', primaryProductId: '', substituteProductId: '',
    priority: 1, ratio: 1, effectiveFrom: '', effectiveTo: '' });
  const save = async () => {
    try {
      await api('/api/engineering/substitutes', { method: 'POST', body });
      notify('已保存');
      onClose();
    } catch (err) { notify(err.message, 'error'); }
  };
  return <Modal title={isEdit ? `替代关系 ${editor.primary_product_code} → ${editor.substitute_product_code}` : '新建替代关系'} onClose={onClose}>
    <form className="engineering-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label>所属方案
        <select value={body.schemeId} onChange={(e) => setBody({ ...body, schemeId: e.target.value })} required disabled={isEdit}>
          {schemes.map((s) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
        </select>
      </label>
      <label>主料 ID<input value={body.primaryProductId} onChange={(e) => setBody({ ...body, primaryProductId: e.target.value })} required disabled={isEdit} /></label>
      <label>替代料 ID<input value={body.substituteProductId} onChange={(e) => setBody({ ...body, substituteProductId: e.target.value })} required disabled={isEdit} /></label>
      <label>优先级<input type="number" value={body.priority} onChange={(e) => setBody({ ...body, priority: Number(e.target.value) })} required disabled={isEdit} /></label>
      <label>比例<input type="number" value={body.ratio} onChange={(e) => setBody({ ...body, ratio: Number(e.target.value) })} required disabled={isEdit} /></label>
      <label>生效日期<input type="date" value={body.effectiveFrom} onChange={(e) => setBody({ ...body, effectiveFrom: e.target.value })} disabled={isEdit} /></label>
      <label>失效日期<input type="date" value={body.effectiveTo} onChange={(e) => setBody({ ...body, effectiveTo: e.target.value })} disabled={isEdit} /></label>
      <BusinessActionBar>
        <button type="button" className={isEdit ? 'primary' : 'secondary'} onClick={onClose}>{isEdit ? '关闭' : '取消'}</button>
        {!isEdit && <button type="submit" className="primary">保存</button>}
      </BusinessActionBar>
      {isEdit && <p className="engineering-form-help">历史已引用的替代关系不在 UI 提供 hard-delete；当前端点仅支持新增关系。</p>}
    </form>
  </Modal>;
}

function ResolverSection({ user, notify }) {
  const [productId, setProductId] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const run = async () => {
    try {
      const r = await api(`/api/engineering/substitutes/resolve?product_id=${encodeURIComponent(productId)}`);
      setResults(r.substitutes || []);
      setError(null);
    } catch (err) { setError(err.message); }
  };
  return <section className="engineering-substitute-section">
    <div className="engineering-substitute-section-head">
      <h3>替代料解析</h3>
    </div>
    <form className="engineering-form" onSubmit={(e) => { e.preventDefault(); run(); }}>
      <label>主料 ID<input value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="主料产品 ID" /></label>
      <BusinessActionBar>
        <button type="submit" className="primary" disabled={!productId}>解析</button>
      </BusinessActionBar>
    </form>
    {error && <p className="engineering-form-result engineering-form-result--fail">{error}</p>}
    {results && (
      results.length
        ? <CompactRecordList>{results.map((r) => (
            <Record key={r.id} title={`${r.primary_product_code || ''} → ${r.substitute_product_code}`}
              subtitle={`${r.scheme_code} · ${STRATEGY_LABELS[r.strategy] || r.strategy} · ${METHOD_LABELS[r.method] || r.method}`}
              status={<span className="status-chip">优先级 {r.priority}</span>}
              facts={[{ label: '比例', value: r.ratio }]} />
          ))}</CompactRecordList>
        : <Empty text="当前主料没有可解析的替代料" />
    )}
  </section>;
}

function ConfigurableBomSection({ user, notify, canManage }) {
  const [boms, setBoms] = useState([]);
  const [bomId, setBomId] = useState('');
  const [choices, setChoices] = useState({});
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/api/engineering/boms').then((res) => setBoms(res.boms || []))
      .catch((err) => setError(err.message));
  }, []);

  const runPreview = async () => {
    try {
      const r = await api('/api/engineering/configurable-boms/preview', { method: 'POST', body: { bomId, choices } });
      setPreview(r);
      setError(null);
    } catch (err) { setError(err.message); }
  };

  return <section className="engineering-substitute-section">
    <div className="engineering-substitute-section-head">
      <h3>可配置 BOM 预览</h3>
    </div>
    <form className="engineering-form" onSubmit={(e) => { e.preventDefault(); runPreview(); }}>
      <label>选择 BOM
        <select value={bomId} onChange={(e) => setBomId(e.target.value)} required>
          <option value="">请选择</option>
          {boms.map((b) => <option key={b.id} value={b.id}>{b.product_code} · {b.version} · {b.purpose}</option>)}
        </select>
      </label>
      <BusinessActionBar>
        <button type="submit" className="primary" disabled={!bomId}>生成预览</button>
      </BusinessActionBar>
    </form>
    {error && <p className="engineering-form-result engineering-form-result--fail">{error}</p>}
    {preview && (
      <CompactRecordList>
        {preview.items.map((item) => (
          <RecordCard key={`${item.bom_id}-${item.id}`} title={`${item.code || ''} ${item.name || ''}`}
            subtitle={`用量 ${item.quantity}${item.scrap_rate ? ` · 损耗 ${item.scrap_rate}` : ''}`}
            status={<span className="status-chip">{(item.is_replaceable || item.is_modifiable) ? '可调' : (item.is_selectable ? '可选' : '固定')}</span>}
            facts={[
              { label: '可配置组', value: item.config_group || '—' },
              { label: '可替换', value: item.is_replaceable ? '是' : '否' },
              { label: '可调整', value: item.is_modifiable ? '是' : '否' },
              { label: '可选择', value: item.is_selectable ? '是' : '否' },
            ]} />
        ))}
      </CompactRecordList>
    )}
    {preview && preview.warnings?.length > 0 && (
      <ul className="engineering-form-warnings">{preview.warnings.map((w, idx) => <li key={idx}>{w}</li>)}</ul>
    )}
    <p className="engineering-form-help">可配置 BOM 仅做派生预览，不会产生库存、生产或会计副作用。Sales 侧配置能力由后续 Domain 承担。</p>
  </section>;
}

function Record({ title, subtitle, status, facts }) {
  return <RecordCard title={title} subtitle={subtitle} status={status}
    facts={facts} onClick={() => {}} />;
}

export default function EngineeringSubstitute({ user, notify }) {
  const [tab, setTab] = useState('substitute');
  const canManage = can(user, 'ENGINEERING_SUBSTITUTE_MANAGE') || can(user, 'ENGINEERING_CONFIGURABLE_MANAGE');
  return <BusinessPageShell className="engineering-substitute-v15" width="rail">
    <BusinessPageHeader title="替代料与可配置 BOM"
      help={<HelpDisclosure summary="说明"><p>替代料解析（resolver）暴露给上游 Planning 使用；可配置 BOM 仅做派生预览，不改变库存或会计。</p></HelpDisclosure>} />
    <TabNav value={tab} onChange={setTab} items={[
      { key: 'substitute', label: '替代料' },
      { key: 'configurable', label: '可配置 BOM' },
    ]} />
    {tab === 'substitute' && <>
      <SchemeSection user={user} notify={notify} canManage={canManage} />
      <ResolverSection user={user} notify={notify} />
    </>}
    {tab === 'configurable' && <ConfigurableBomSection user={user} notify={notify} canManage={canManage} />}
  </BusinessPageShell>;
}
