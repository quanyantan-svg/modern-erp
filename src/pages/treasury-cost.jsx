import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Active, Badge, ConfirmAction, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, YuanField, can, dateTime, money } from '../components/ui.jsx';
import { yuanToNonNegativeCents } from '../lib/money.js';
import { BusinessAction, BusinessPageHeader, BusinessPageShell } from '../components/design-system.jsx';

export function CashJournals({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [accountType, setAccountType] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ search, startDate, endDate, accountType });
    api(`/api/cash-journals?${params}`).then((r) => setItems(r.journals)).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => { void load(); }, [startDate, endDate, accountType]);

  return (
    <Panel title="现金日记账">
      <Toolbar
        search={search} setSearch={setSearch} onSearch={load}
        placeholder="搜索单号、摘要或对方单位"
        action={can(user, 'CASH_JOURNALS_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增记录</button>}
      />
      <div className="filters">
        <label>开始日期<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}/></label>
        <label>结束日期<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}/></label>
        <label>账户类型<select value={accountType} onChange={(e) => setAccountType(e.target.value)}>
          <option value="">全部</option>
          <option value="CASH">现金</option>
          <option value="BANK">银行</option>
        </select></label>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>单据号</th><th>日期</th><th>类型</th><th>账户</th><th>方向</th><th className="number">金额</th><th>摘要</th><th>操作员</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.journal_no}</td>
                <td>{item.journal_date}</td>
                <td><Badge>{item.journal_type === 'RECEIPT' ? '收款' : item.journal_type === 'PAYMENT' ? '付款' : '转账'}</Badge></td>
                <td>{item.account_type === 'CASH' ? '现金' : '银行'}{item.bankName ? ` - ${item.bankName}` : ''}</td>
                <td><Badge type={item.direction === 'IN' ? 'success' : 'danger'}>{item.direction === 'IN' ? '收入' : '支出'}</Badge></td>
                <td className="number">{money(item.amount_cents)}</td>
                <td>{item.summary}</td>
                <td>{item.operatorName}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无日记账记录"/>}
      </div>
      {editing && <CashJournalModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('日记账已保存'); }} />}
    </Panel>
  );
}

function CashJournalModal({ value, onClose, onSaved }) {
  const [form, setForm] = useState({
    journal_type: 'RECEIPT', account_type: 'CASH', bank_account: '',
    amount_cents: 0, direction: 'IN', counterparty_type: '', counterparty_id: '',
    counterparty_name: '', subject_id: '', summary: '', journal_date: new Date().toISOString().slice(0, 10), remark: ''
  });

  async function save(e) {
    e.preventDefault();
    try {
      await api('/api/cash-journals', { method: 'POST', body: form });
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title="新增日记账" onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>业务类型<select value={form.journal_type} onChange={(e) => setForm({...form, journal_type: e.target.value})}>
          <option value="RECEIPT">收款</option>
          <option value="PAYMENT">付款</option>
          <option value="TRANSFER">转账</option>
        </select></label>
        <label>账户类型<select value={form.account_type} onChange={(e) => setForm({...form, account_type: e.target.value})}>
          <option value="CASH">现金</option>
          <option value="BANK">银行</option>
        </select></label>
        <label>日期<input type="date" value={form.journal_date} onChange={(e) => setForm({...form, journal_date: e.target.value})} required/></label>
        <label>收支方向<select value={form.direction} onChange={(e) => setForm({...form, direction: e.target.value})}>
          <option value="IN">收入</option>
          <option value="OUT">支出</option>
        </select></label>
        <label className="full">金额（元）<YuanField valueCents={form.amount_cents} onChangeCents={(amount_cents) => setForm({...form, amount_cents})} min={0.01} required/></label>
        <label className="full">对方单位<input value={form.counterparty_name} onChange={(e) => setForm({...form, counterparty_name: e.target.value})}/></label>
        <label className="full">摘要<input value={form.summary} onChange={(e) => setForm({...form, summary: e.target.value})} required/></label>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

// ============ Bank Accounts ============

export function BankAccounts({ user, notify }) {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = () => api('/api/bank-accounts').then((r) => setItems(r.bankAccounts || [])).catch((e) => notify(e.message, 'error'));

  useEffect(() => { void load(); }, []);

  return (
    <BusinessPageShell className="bank-accounts-v15" width="rail">
      <BusinessPageHeader title="银行账户" context="结算账户配置" primaryAction={can(user, 'BANK_ACCOUNTS_MANAGE') && <BusinessAction hierarchy="primary" onClick={() => setEditing({})}>新增账户</BusinessAction>}/>
      <div className="table-wrap">
        <table>
          <thead><tr><th>开户银行</th><th>账号</th><th>户名</th><th className="number">余额</th><th>状态</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.bank_name}</td>
                <td className="mono">{item.account_no}</td>
                <td><strong>{item.account_name}</strong></td>
                <td className="number">{money(item.balance_cents)}</td>
                <td><Active active={item.active}/></td>
                <td>{can(user, 'BANK_ACCOUNTS_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无银行账户"/>}
      </div>
      {editing && <BankAccountModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('银行账户已保存'); }} />}
    </BusinessPageShell>
  );
}

function BankAccountModal({ value, onClose, onSaved }) {
  const [form, setForm] = useState({ bank_name: '', account_no: '', account_name: '', initial_balance_cents: 0, remark: '', active: true, ...value });

  async function save(e) {
    e.preventDefault();
    try {
      if (value.id) {
        await api(`/api/bank-accounts/${value.id}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/bank-accounts', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title={value.id ? '编辑账户' : '新增账户'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>开户银行<input value={form.bank_name} onChange={(e) => setForm({...form, bank_name: e.target.value})} required/></label>
        <label>账号<input value={form.account_no} onChange={(e) => setForm({...form, account_no: e.target.value})} required/></label>
        <label>户名<input value={form.account_name} onChange={(e) => setForm({...form, account_name: e.target.value})} required/></label>
        <label>期初余额（元）<YuanField valueCents={form.initial_balance_cents} onChangeCents={(initial_balance_cents) => setForm({...form, initial_balance_cents})} min={0}/></label>
        <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
        {value.id && <label className="check full"><input type="checkbox" checked={form.active} onChange={(e) => setForm({...form, active: e.target.checked})}/> 启用该账户</label>}
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

// ============ Bills ============

export function Bills({ user, notify }) {
  const [items, setItems] = useState([]);
  const [billType, setBillType] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ billType, status });
    api(`/api/bills?${params}`).then((r) => setItems(r.bills)).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => { void load(); }, [billType, status]);

  return (
    <Panel title="票据管理">
      <Toolbar action={can(user, 'BILLS_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增票据</button>}/>
      <div className="filters">
        <label>票据类型<select value={billType} onChange={(e) => setBillType(e.target.value)}>
          <option value="">全部</option>
          <option value="RECEIVABLE">应收票据</option>
          <option value="PAYABLE">应付票据</option>
        </select></label>
        <label>状态<select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部</option>
          <option value="PENDING">待承兑</option>
          <option value="ACCEPTED">已承兑</option>
          <option value="DISCOUNTED">已贴现</option>
          <option value="PAID">已到期</option>
        </select></label>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>票据号</th><th>类型</th><th>出票日期</th><th>到期日期</th><th>对方单位</th><th className="number">票面金额</th><th>状态</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.bill_no}</td>
                <td><Badge>{item.direction === 'RECEIVABLE' ? '应收' : '应付'}</Badge></td>
                <td>{item.issue_date}</td>
                <td>{item.due_date}</td>
                <td>{item.drawer_name || item.payee_name || '—'}</td>
                <td className="number">{money(item.face_amount_cents)}</td>
                <td><Badge type={item.status === 'PAID' ? 'success' : item.status === 'PENDING' ? 'warning' : ''}>{({ PENDING: '待承兑', ACCEPTED: '已承兑', DISCOUNTED: '已贴现', PAID: '已到期', CANCELLED: '已作废' })[item.status] || '状态待确认'}</Badge></td>
                <td>{can(user, 'BILLS_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无票据"/>}
      </div>
      {editing && <BillModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('票据已保存'); }} />}
    </Panel>
  );
}

function BillModal({ value, onClose, onSaved }) {
  const [form, setForm] = useState({
    bill_type: 'DRAFT', direction: 'RECEIVABLE', bill_no: '', counterparty_type: 'CUSTOMER', counterparty_id: '',
    face_amount_cents: 0, issue_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    status: 'PENDING', remark: '', ...value
  });
  const [counterparties, setCounterparties] = useState([]);

  useEffect(() => {
    if (form.direction === 'RECEIVABLE') {
      api('/api/customers').then((r) => setCounterparties(r.customers || []));
    } else {
      api('/api/suppliers').then((r) => setCounterparties(r.suppliers || []));
    }
  }, [form.bill_type]);

  async function save(e) {
    e.preventDefault();
    try {
      if (value.id) {
        await api(`/api/bills/${value.id}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/bills', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title={value.id ? '编辑票据' : '新增票据'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>票据类型<select value={form.bill_type} onChange={(e) => setForm({...form, bill_type: e.target.value})}>
          <option value="DRAFT">银行汇票</option>
          <option value="ACCEPTANCE">商业承兑</option>
          <option value="LC">信用证</option>
        </select></label>
        <label>收付方向<select value={form.direction} onChange={(e) => setForm({...form, direction: e.target.value, counterparty_id: ''})}><option value="RECEIVABLE">应收</option><option value="PAYABLE">应付</option></select></label>
        <label>票据号<input value={form.bill_no} onChange={(e) => setForm({...form, bill_no: e.target.value})} placeholder="系统自动生成"/></label>
        <label>对方单位<select value={form.counterparty_id} onChange={(e) => setForm({...form, counterparty_id: e.target.value})} required>
          <option value="">选择单位</option>
          {counterparties.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
        </select></label>
        <label>票面金额（元）<YuanField valueCents={form.face_amount_cents} onChangeCents={(face_amount_cents) => setForm({...form, face_amount_cents})} min={0.01} required/></label>
        <label>出票日期<input type="date" value={form.issue_date} onChange={(e) => setForm({...form, issue_date: e.target.value})} required/></label>
        <label>到期日期<input type="date" value={form.due_date} onChange={(e) => setForm({...form, due_date: e.target.value})} required/></label>
        <label>状态<select value={form.status} onChange={(e) => setForm({...form, status: e.target.value})}>
          <option value="PENDING">待承兑</option>
          <option value="ACCEPTED">已承兑</option>
          <option value="DISCOUNTED">已贴现</option>
          <option value="PAID">已到期</option>
          <option value="CANCELLED">已作废</option>
        </select></label>
        <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

// ============ Fixed Assets ============

export function FixedAssets({ user, notify }) {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [viewDep, setViewDep] = useState(null);
  const [depreciations, setDepreciations] = useState([]);

  const load = () => api('/api/fixed-assets').then((r) => setItems(r.assets || [])).catch((e) => notify(e.message, 'error'));

  useEffect(() => { void load(); }, []);

  function viewDepreciations(asset) {
    setViewDep(asset);
    api(`/api/fixed-assets/${asset.id}/depreciations`).then((r) => setDepreciations(r.depreciations || [])).catch((e) => notify(e.message, 'error'));
  }

  async function calculateDep(assetId) {
    try {
      await api('/api/fixed-assets/depreciation', { method: 'POST', body: { assetId, depreciationDate: new Date().toISOString().slice(0, 10) } });
      notify('折旧已计提');
      load();
      viewDepreciations({ id: assetId });
    } catch (e) { notify(e.message, 'error'); }
  }

  return (
    <Panel title="固定资产">
      <Toolbar action={can(user, 'FIXED_ASSETS_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增资产</button>}/>
      <div className="table-wrap">
        <table>
          <thead><tr><th>资产编号</th><th>资产名称</th><th>类别</th><th>购置日期</th><th className="number">原值</th><th className="number">累计折旧</th><th className="number">净值</th><th>状态</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.asset_code}</td>
                <td><strong>{item.asset_name}</strong></td>
                <td>{item.category}</td>
                <td>{item.purchase_date}</td>
                <td className="number">{money(item.purchase_amount_cents)}</td>
                <td className="number">{money(item.totalDepreciatedCents || 0)}</td>
                <td className="number"><strong>{money(item.net_value_cents)}</strong></td>
                <td><Badge type={item.status === 'IN_USE' ? 'success' : ''}>{item.status === 'IN_USE' ? '使用中' : item.status === 'DISPOSED' ? '已处置' : '状态待确认'}</Badge></td>
                <td>
                  <button className="row-action" onClick={() => viewDepreciations(item)}>折旧记录</button>
                  {can(user, 'FIXED_ASSETS_MANAGE') && <ConfirmAction className="row-action" buttonLabel="计提折旧" title="确认计提本月折旧？" message="确认后将生成本月折旧记录。" confirmLabel="确认计提" onConfirm={() => calculateDep(item.id)}/>}
                  {can(user, 'FIXED_ASSETS_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无固定资产"/>}
      </div>
      {editing && <FixedAssetModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('固定资产已保存'); }} />}
      {viewDep && <DepreciationModal asset={viewDep} depreciations={depreciations} onClose={() => setViewDep(null)}/>}
    </Panel>
  );
}

function FixedAssetModal({ value, onClose, onSaved }) {
  const [form, setForm] = useState({
    asset_code: '', asset_name: '', category: '电子设备', purchase_date: new Date().toISOString().slice(0, 10),
    purchase_amount_cents: 0, useful_life_months: 60, salvage_value_cents: 0, depreciation_method: 'STRAIGHT_LINE', remark: '', status: 'IN_USE', ...value
  });

  async function save(e) {
    e.preventDefault();
    try {
      if (value.id) {
        await api(`/api/fixed-assets/${value.id}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/fixed-assets', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title={value.id ? '编辑资产' : '新增资产'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>资产编号<input value={form.asset_code} onChange={(e) => setForm({...form, asset_code: e.target.value})} required/></label>
        <label>资产名称<input value={form.asset_name} onChange={(e) => setForm({...form, asset_name: e.target.value})} required/></label>
        <label>资产类别<select value={form.category} onChange={(e) => setForm({...form, category: e.target.value})}>
          <option value="电子设备">电子设备</option>
          <option value="办公设备">办公设备</option>
          <option value="运输设备">运输设备</option>
          <option value="建筑物">建筑物</option>
          <option value="机器设备">机器设备</option>
          <option value="其他">其他</option>
        </select></label>
        <label>购置日期<input type="date" value={form.purchase_date} onChange={(e) => setForm({...form, purchase_date: e.target.value})} required/></label>
        <label>原值（元）<YuanField valueCents={form.purchase_amount_cents} onChangeCents={(purchase_amount_cents) => setForm({...form, purchase_amount_cents})} min={0.01} required/></label>
        <label>使用月数<input type="number" value={form.useful_life_months} min="1" onChange={(e) => setForm({...form, useful_life_months: Number(e.target.value)})} required/></label>
        <label>残值（元）<YuanField valueCents={form.salvage_value_cents} onChangeCents={(salvage_value_cents) => setForm({...form, salvage_value_cents})} min={0}/></label>
        <label>折旧方法<select value={form.depreciation_method} onChange={(e) => setForm({...form, depreciation_method: e.target.value})}>
          <option value="STRAIGHT_LINE">直线法</option>
          <option value="NONE">不提折旧</option>
        </select></label>
        {value.id && <label>状态<select value={form.status} onChange={(e) => setForm({...form, status: e.target.value})}>
          <option value="IN_USE">使用中</option>
          <option value="MAINTENANCE">维修中</option>
          <option value="SCRAPPED">已报废</option>
          <option value="SOLD">已出售</option>
        </select></label>}
        <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

function DepreciationModal({ asset, depreciations, onClose }) {
  return (
    <Modal title={`${asset.asset_name} - 折旧记录`} onClose={onClose}>
      <div className="table-wrap">
        <table>
          <thead><tr><th>计提日期</th><th className="number">折旧金额</th><th>操作员</th></tr></thead>
          <tbody>
            {depreciations.map((d) => (
              <tr key={d.id}>
                <td>{d.depreciation_date}</td>
                <td className="number">{money(d.depreciation_cents)}</td>
                <td>{d.creatorName}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!depreciations.length && <Empty text="暂无折旧记录"/>}
      </div>
      <FormActions onClose={onClose}/>
    </Modal>
  );
}
// ============ Product Costs ============

export async function runCostSave(request, onSaved, notify) {
  try {
    await request();
    onSaved();
    return true;
  } catch (error) {
    notify(error.message, 'error');
    return false;
  }
}

export function ProductCosts({ user, notify }) {
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ productId });
    api(`/api/product-costs?${params}`).then((r) => setItems(r.costs)).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => {
    api('/api/product-costs/products').then((r) => setProducts(r.products || [])).catch((e) => notify(e.message, 'error'));
  }, []);
  useEffect(() => { void load(); }, [productId]);

  return (
    <Panel title="产品标准成本">
      <Toolbar action={can(user, 'COST_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 设置标准成本</button>}/>
      <div className="filters">
        <label>产品<select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">全部产品</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
        </select></label>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>产品编码</th><th>产品名称</th><th>生效日期</th><th className="number">材料成本</th><th className="number">人工成本</th><th className="number">制造费用</th><th className="number">标准成本</th><th>设置人</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.productCode}</td>
                <td><strong>{item.productName}</strong></td>
                <td>{item.effectiveDate}</td>
                <td className="number">{money(item.materialCostCents)}</td>
                <td className="number">{money(item.laborCostCents)}</td>
                <td className="number">{money(item.overheadCostCents)}</td>
                <td className="number"><strong>{money(item.standardCostCents)}</strong></td>
                <td>{item.creatorName}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无标准成本数据"/>}
      </div>
      {editing && <ProductCostModal products={products} value={editing} notify={notify} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('标准成本已保存'); }} />}
    </Panel>
  );
}

export function ProductCostModal({ products, value, notify, onClose, onSaved, apiClient = api }) {
  const [form, setForm] = useState({
    productId: '', materialCostYuan: '0.00', laborCostYuan: '0.00', overheadCostYuan: '0.00',
    effectiveDate: new Date().toISOString().slice(0, 10), remark: '', ...value
  });

  const componentCents = [form.materialCostYuan, form.laborCostYuan, form.overheadCostYuan].map(yuanToNonNegativeCents);
  const standardCostCents = componentCents.every((amount) => amount !== null) ? componentCents.reduce((sum, amount) => sum + amount, 0) : null;

  async function save(e) {
    e.preventDefault();
    if (standardCostCents === null) return notify('成本必须是最多两位小数的非负金额', 'error');
    const [materialCostCents, laborCostCents, overheadCostCents] = componentCents;
    await runCostSave(() => apiClient('/api/product-costs', { method: 'POST', body: {
        productId: form.productId, materialCostCents, laborCostCents, overheadCostCents,
        standardCostCents, effectiveDate: form.effectiveDate, remark: form.remark,
      } }), onSaved, notify);
  }

  return (
    <Modal title="设置标准成本" onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>产品<select value={form.productId} onChange={(e) => setForm({...form, productId: e.target.value})} required disabled={!!value.id}>
          <option value="">选择产品</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
        </select></label>
        <label>生效日期<input type="date" value={form.effectiveDate} onChange={(e) => setForm({...form, effectiveDate: e.target.value})} required/></label>
        <label>材料成本(元)<input type="number" min="0" value={form.materialCostYuan} step="0.01" onChange={(e) => setForm({...form, materialCostYuan: e.target.value})} required/></label>
        <label>人工成本(元)<input type="number" min="0" value={form.laborCostYuan} step="0.01" onChange={(e) => setForm({...form, laborCostYuan: e.target.value})} required/></label>
        <label>制造费用(元)<input type="number" min="0" value={form.overheadCostYuan} step="0.01" onChange={(e) => setForm({...form, overheadCostYuan: e.target.value})} required/></label>
        <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
        <div className="full"><strong>标准成本: {standardCostCents === null ? '金额格式无效' : money(standardCostCents)}</strong></div>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

// ============ Cost Rates ============

export function CostRates({ user, notify }) {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = () => api('/api/cost-rates').then((r) => setItems(r.rates)).catch((e) => notify(e.message, 'error'));

  useEffect(() => { void load(); }, []);

  const rateTypes = { MATERIAL_RATE: '材料费率', LABOR_RATE: '人工费率', OVERHEAD_RATE: '制造费用率' };

  return (
    <Panel title="费用项目">
      <Toolbar action={can(user, 'COST_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增费用项目</button>}/>
      <div className="table-wrap">
        <table>
          <thead><tr><th>费率类型</th><th className="number">费率值</th><th>单位</th><th>生效日期</th><th>设置人</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><Badge>{rateTypes[item.rateType] || item.rateType}</Badge></td>
                <td className="number">{item.rateValue}</td>
                <td>{item.unit}</td>
                <td>{item.effectiveDate}</td>
                <td>{item.creatorName}</td>
                <td>{can(user, 'COST_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无费用项目"/>}
      </div>
      {editing && <CostRateModal value={editing} notify={notify} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('费用项目已保存'); }} />}
    </Panel>
  );
}

export function CostRateModal({ value, notify, onClose, onSaved, apiClient = api }) {
  const [form, setForm] = useState({ rateType: 'LABOR_RATE', rateValue: 0, unit: '元/小时', effectiveDate: new Date().toISOString().slice(0, 10), remark: '', ...value });

  async function save(e) {
    e.preventDefault();
    await runCostSave(() => {
      if (value.id) {
        return apiClient(`/api/cost-rates/${value.id}`, { method: 'PATCH', body: form });
      }
      return apiClient('/api/cost-rates', { method: 'POST', body: form });
    }, onSaved, notify);
  }

  return (
    <Modal title={value.id ? '编辑费用项目' : '新增费用项目'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>费率类型<select value={form.rateType} onChange={(e) => setForm({...form, rateType: e.target.value})}>
          <option value="MATERIAL_RATE">材料费率</option>
          <option value="LABOR_RATE">人工费率</option>
          <option value="OVERHEAD_RATE">制造费用率</option>
        </select></label>
        <label>费率值<input type="number" min="0" value={form.rateValue} step="0.01" onChange={(e) => setForm({...form, rateValue: Number(e.target.value)})} required/></label>
        <label>单位<input value={form.unit} onChange={(e) => setForm({...form, unit: e.target.value})} placeholder="小时/件/米等"/></label>
        <label>生效日期<input type="date" value={form.effectiveDate} onChange={(e) => setForm({...form, effectiveDate: e.target.value})} required/></label>
        <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}
// ============ IQC Inspections ============
