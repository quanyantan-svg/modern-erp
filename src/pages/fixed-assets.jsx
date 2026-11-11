// Accounting & Analytics — AA-W5 固定资产完整生命周期.
//
// The page follows the LIST → DETAIL → EDITOR pattern required by AGENTS.md §7:
// the card list is the entry point, the depreciation / disposal history is the
// detail view and every write happens in a modal editor.
//
// Canonical owner: server/modules/fixed-assets.js
// Requirement: docs/requirements/accounting-analytics.md §35.4.5
// Design:    docs/design/accounting-analytics.md §31.5

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Badge, Empty, FormActions, Loading, Modal, Panel, Status, Toolbar, YuanField, can, money } from '../components/ui.jsx';
import { BusinessAction, BusinessPageHeader, BusinessPageShell, HelpDisclosure } from '../components/design-system.jsx';

const CARD_STATUS_LABELS = {
  DRAFT: '草稿',
  ACTIVE: '在用',
  IDLE: '闲置',
  DISPOSING: '处置中',
  DISPOSED: '已处置',
};

const CARD_STATUS_BADGE = {
  DRAFT: 'info',
  ACTIVE: 'success',
  IDLE: 'warning',
  DISPOSING: 'warning',
  DISPOSED: 'danger',
};

const DEPRECIATION_METHOD_LABELS = {
  STRAIGHT_LINE: '直线法',
  DOUBLE_DECLINING: '双倍余额递减',
  WORKLOAD: '工作量法',
};

const DISPOSAL_STATUS_LABELS = {
  DRAFT: '草稿',
  SUBMITTED: '待审核',
  APPROVED: '已审核',
  POSTED: '已过账',
  REJECTED: '已驳回',
};

function currentPeriod() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

export function FixedAssets({ user, notify }) {
  const [assets, setAssets] = useState([]);
  const [summary, setSummary] = useState(null);
  const [types, setTypes] = useState([]);
  const [locations, setLocations] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [period, setPeriod] = useState(currentPeriod());
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [assetResult, typeResult, locationResult, policyResult] = await Promise.all([
        api('/api/fixed-assets'),
        api('/api/fixed-asset-types').catch(() => ({ assetTypes: [] })),
        api('/api/fixed-asset-locations').catch(() => ({ assetLocations: [] })),
        api('/api/depreciation-policies').catch(() => ({ policies: [] })),
      ]);
      setAssets(assetResult.assets || []);
      setSummary(assetResult.summary || null);
      setTypes(typeResult.assetTypes || []);
      setLocations(locationResult.assetLocations || []);
      setPolicies(policyResult.policies || []);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function runDepreciation() {
    if (!/^\d{4}-\d{2}$/.test(period)) {
      notify('请输入合法期间 YYYY-MM', 'error');
      return;
    }
    try {
      const result = await api('/api/fixed-assets/depreciation', { method: 'POST', body: { period } });
      const total = Number(result?.run?.total_cents || 0);
      notify(total > 0 ? `折旧已计提：${money(total)}` : '该期间没有可计提的折旧');
      load();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  const visibleAssets = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return assets;
    return assets.filter((item) => `${item.asset_code} ${item.asset_name}`.toLowerCase().includes(keyword));
  }, [assets, search]);

  const activeCount = useMemo(() => assets.filter((item) => item.card_status === 'ACTIVE').length, [assets]);

  return (
    <BusinessPageShell>
      <BusinessPageHeader
        title="固定资产"
        context="资产卡片 · 折旧政策 · 按期间计提 · 处置"
        help={<HelpDisclosure summary="折旧如何计算"><p>折旧金额由折旧政策（方法 / 年限 / 残值率 / 起算规则）与卡片原值自动计算，按期间批量入账并生成凭证；手工金额只作为受控调整，且不得超过剩余可折旧金额。</p></HelpDisclosure>}
        primaryAction={can(user, 'FIXED_ASSETS_MANAGE') && (
          <BusinessAction hierarchy="primary" onClick={() => setEditing({})}>新增资产</BusinessAction>
        )}
        secondaryActions={can(user, 'FIXED_ASSET_DEPRECIATE') && [
          <span key="period" className="inline-actions">
            <input aria-label="折旧期间" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
            <button className="secondary" onClick={runDepreciation}>按期间计提折旧</button>
          </span>,
        ]}
      />

      <div className="settlement-summary">
        <div><span>卡片数</span><strong>{summary?.totalCount ?? assets.length}</strong></div>
        <div><span>在用卡片</span><strong>{activeCount}</strong></div>
        <div><span>原值合计</span><strong>{money(summary?.totalOriginal || 0)}</strong></div>
        <div><span>累计折旧</span><strong>{money(summary?.totalDepreciation || 0)}</strong></div>
        <div><span>净值合计</span><strong>{money(summary?.totalNetValue || 0)}</strong></div>
      </div>

      <Toolbar search={search} setSearch={setSearch} onSearch={() => {}} placeholder="搜索资产编号或名称" />

      <Panel title="资产卡片">
        {loading ? <Loading /> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>资产编号</th><th>资产名称</th><th>类别</th><th>购置日期</th>
                  <th className="number">原值</th><th className="number">累计折旧</th><th className="number">净值</th>
                  <th>状态</th><th />
                </tr>
              </thead>
              <tbody>
                {visibleAssets.map((item) => (
                  <tr key={item.id} className="clickable" onClick={() => setDetail(item)}>
                    <td className="mono">{item.asset_code}</td>
                    <td>{item.asset_name}</td>
                    <td>{item.category}</td>
                    <td>{item.purchase_date || '—'}</td>
                    <td className="number">{money(item.original_value_cents ?? item.purchase_amount_cents ?? 0)}</td>
                    <td className="number">{money(item.accumulated_depreciation_cents || 0)}</td>
                    <td className="number">{money(item.net_value_cents || 0)}</td>
                    <td><Badge type={CARD_STATUS_BADGE[item.card_status] || 'info'}>{CARD_STATUS_LABELS[item.card_status] || '草稿'}</Badge></td>
                    <td className="actions" onClick={(event) => event.stopPropagation()}>
                      {can(user, 'FIXED_ASSETS_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleAssets.length && <Empty title="还没有资产卡片" text="可以通过采购转固或手工新增建立第一张资产卡片。" />}
          </div>
        )}
      </Panel>

      <Panel title="基础资料" subtitle="资产类别 · 资产位置 · 折旧政策">
        <div className="form-grid">
          <div>
            <h3>资产类别</h3>
            {types.length ? types.map((item) => <div key={item.id} className="list-row">{item.code} · {item.name}</div>) : <Empty title="暂无资产类别" />}
          </div>
          <div>
            <h3>资产位置</h3>
            {locations.length ? locations.map((item) => <div key={item.id} className="list-row">{item.code} · {item.name}</div>) : <Empty title="暂无资产位置" />}
          </div>
          <div>
            <h3>折旧政策</h3>
            {policies.length ? policies.map((item) => (
              <div key={item.id} className="list-row">
                {item.code} · {item.name} · {DEPRECIATION_METHOD_LABELS[item.method] || item.method} · {item.useful_life_months} 个月
              </div>
            )) : <Empty title="暂无折旧政策" />}
          </div>
        </div>
      </Panel>

      {editing && (
        <FixedAssetModal
          value={editing}
          types={types}
          locations={locations}
          policies={policies}
          notify={notify}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); notify('资产卡片已保存'); }}
        />
      )}
      {detail && (
        <AssetDetailModal
          asset={detail}
          user={user}
          notify={notify}
          onClose={() => setDetail(null)}
          onChanged={() => { load(); }}
        />
      )}
    </BusinessPageShell>
  );
}

function FixedAssetModal({ value, types, locations, policies, notify, onClose, onSaved }) {
  const [form, setForm] = useState({
    asset_code: '',
    asset_name: '',
    asset_type_id: '',
    location_id: '',
    policy_id: '',
    purchase_date: new Date().toISOString().slice(0, 10),
    original_value_cents: 0,
    residual_value_cents: 0,
    remark: '',
    ...value,
  });

  async function save(event) {
    event.preventDefault();
    try {
      const body = {
        asset_code: form.asset_code,
        asset_name: form.asset_name,
        purchase_date: form.purchase_date || null,
        original_value_cents: Number(form.original_value_cents || 0),
        residual_value_cents: Number(form.residual_value_cents || 0),
        remark: form.remark || '',
      };
      if (form.asset_type_id) body.asset_type_id = form.asset_type_id;
      if (form.location_id) body.location_id = form.location_id;
      if (form.policy_id) body.policy_id = form.policy_id;
      if (value.id) {
        await api(`/api/fixed-assets/${value.id}`, { method: 'PATCH', body });
      } else {
        await api('/api/fixed-assets', { method: 'POST', body });
      }
      onSaved();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  return (
    <Modal title={value.id ? '编辑资产卡片' : '新增资产卡片'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>资产编号<input value={form.asset_code} onChange={(event) => setForm({ ...form, asset_code: event.target.value })} required /></label>
        <label>资产名称<input value={form.asset_name} onChange={(event) => setForm({ ...form, asset_name: event.target.value })} required /></label>
        <label>资产类别<select value={form.asset_type_id || ''} onChange={(event) => setForm({ ...form, asset_type_id: event.target.value })}>
          <option value="">未指定</option>
          {types.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
        </select></label>
        <label>资产位置<select value={form.location_id || ''} onChange={(event) => setForm({ ...form, location_id: event.target.value })}>
          <option value="">未指定</option>
          {locations.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
        </select></label>
        <label>折旧政策<select value={form.policy_id || ''} onChange={(event) => setForm({ ...form, policy_id: event.target.value })}>
          <option value="">未指定</option>
          {policies.map((item) => <option key={item.id} value={item.id}>{item.code} · {DEPRECIATION_METHOD_LABELS[item.method] || item.method}</option>)}
        </select></label>
        <label>购置日期<input type="date" value={form.purchase_date || ''} onChange={(event) => setForm({ ...form, purchase_date: event.target.value })} /></label>
        <label>原值（元）<YuanField valueCents={form.original_value_cents} onChangeCents={(original_value_cents) => setForm({ ...form, original_value_cents })} min={0.01} required /></label>
        <label>残值（元）<YuanField valueCents={form.residual_value_cents} onChangeCents={(residual_value_cents) => setForm({ ...form, residual_value_cents })} min={0} /></label>
        <label className="full">备注<input value={form.remark || ''} onChange={(event) => setForm({ ...form, remark: event.target.value })} /></label>
        <FormActions onClose={onClose} />
      </form>
    </Modal>
  );
}

function AssetDetailModal({ asset, user, notify, onClose, onChanged }) {
  const [depreciations, setDepreciations] = useState([]);
  const [disposals, setDisposals] = useState([]);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const [depreciationResult, disposalResult] = await Promise.all([
        api(`/api/fixed-assets/${asset.id}/depreciations`),
        api(`/api/fixed-assets/${asset.id}/disposals`).catch(() => ({ disposals: [] })),
      ]);
      setDepreciations(depreciationResult.depreciations || []);
      setDisposals(disposalResult.disposals || []);
    } catch (error) {
      notify(error.message, 'error');
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [asset.id]);

  async function submitDisposal(disposalId) {
    try {
      await api(`/api/fixed-assets/disposals/${disposalId}/submit`, { method: 'POST', body: {} });
      notify('处置单已提交');
      load();
      onChanged();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function approveDisposal(disposalId) {
    try {
      await api(`/api/fixed-assets/disposals/${disposalId}/approve`, { method: 'POST', body: {} });
      notify('处置单已过账');
      load();
      onChanged();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  return (
    <Modal title={`${asset.asset_code} · ${asset.asset_name}`} onClose={onClose} wide>
      <div className="detail-grid">
        <div><span>卡片状态</span><Status status={asset.card_status} label={CARD_STATUS_LABELS[asset.card_status] || '草稿'} /></div>
        <div><span>原值</span><strong>{money(asset.original_value_cents || 0)}</strong></div>
        <div><span>累计折旧</span><strong>{money(asset.accumulated_depreciation_cents || 0)}</strong></div>
        <div><span>净值</span><strong>{money(asset.net_value_cents || 0)}</strong></div>
      </div>

      <h3>折旧记录</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>日期</th><th>期间</th><th>类型</th><th className="number">金额</th><th>说明</th></tr></thead>
          <tbody>
            {depreciations.map((row) => (
              <tr key={row.id}>
                <td>{row.depreciation_date}</td>
                <td>{row.period || '—'}</td>
                <td>{row.depreciation_type === 'ADJUSTMENT' ? '手工调整' : '自动计提'}</td>
                <td className="number">{money(row.depreciation_amount_cents || 0)}</td>
                <td>{row.remark}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!depreciations.length && <Empty title="暂无折旧记录" />}
      </div>

      <h3>处置单</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>处置单号</th><th>方式</th><th>处置日期</th><th>状态</th><th /></tr></thead>
          <tbody>
            {disposals.map((row) => (
              <tr key={row.id}>
                <td className="mono">{row.disposal_no}</td>
                <td>{row.disposal_type}</td>
                <td>{row.disposal_date}</td>
                <td>{DISPOSAL_STATUS_LABELS[row.status] || row.status}</td>
                <td className="actions">
                  {row.status === 'DRAFT' && <button className="row-action" onClick={() => submitDisposal(row.id)}>提交</button>}
                  {row.status === 'SUBMITTED' && <button className="row-action" onClick={() => approveDisposal(row.id)}>审核过账</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!disposals.length && <Empty title="暂无处置单" />}
      </div>

      {creating && (
        <DisposalModal
          asset={asset}
          notify={notify}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); onChanged(); }}
        />
      )}

      <FormActions onClose={onClose} />
      {can(user, 'FIXED_ASSET_DISPOSE') && (
        <BusinessAction hierarchy="primary" onClick={() => setCreating(true)}>发起处置</BusinessAction>
      )}
    </Modal>
  );
}

function DisposalModal({ asset, notify, onClose, onSaved }) {
  const [form, setForm] = useState({
    disposal_type: 'SCRAP',
    disposal_date: new Date().toISOString().slice(0, 10),
    proceeds_cents: 0,
    reason: '',
  });

  async function save(event) {
    event.preventDefault();
    try {
      await api(`/api/fixed-assets/${asset.id}/disposals`, {
        method: 'POST',
        body: { ...form, proceeds_cents: Number(form.proceeds_cents || 0) },
      });
      onSaved();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  return (
    <Modal title={`${asset.asset_code} · 发起处置`} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>处置方式<select value={form.disposal_type} onChange={(event) => setForm({ ...form, disposal_type: event.target.value })}>
          <option value="SCRAP">报废</option>
          <option value="SALE">出售</option>
          <option value="REDUCTION">减少</option>
        </select></label>
        <label>处置日期<input type="date" value={form.disposal_date} onChange={(event) => setForm({ ...form, disposal_date: event.target.value })} required /></label>
        <label>处置价（元）<YuanField valueCents={form.proceeds_cents} onChangeCents={(proceeds_cents) => setForm({ ...form, proceeds_cents })} min={0} /></label>
        <label className="full">处置原因<input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} required /></label>
        <FormActions onClose={onClose} />
      </form>
    </Modal>
  );
}
