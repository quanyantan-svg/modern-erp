import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Active, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, can, dateTime, money } from '../components/ui.jsx';

function currentPeriod() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function IncomeStatement({ user, notify }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const query = () => {
    if (!/^\d{4}-\d{2}$/.test(period)) {
      setError('请输入合法期间 YYYY-MM');
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    api(`/api/reports/income-statement?period=${encodeURIComponent(period)}`)
      .then((r) => { setData(r); setError(null); })
      .catch((e) => { setError(e.message || '查询失败'); setData(null); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { query(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const isEmpty = data && (!data.sections || data.sections.every(s => s.subjects.length === 0));

  return <div className="income-statement">
    <div className="search-bar">
      <label>期间</label>
      <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 160 }} />
      <button className="primary" onClick={query} disabled={loading}>{loading ? '查询中…' : '查询'}</button>
      {data && <span className="dim" style={{ marginLeft: 12 }}>范围 {data.periodRange?.startDate} 至 {data.periodRange?.endDate}</span>}
    </div>
    {error && <div className="error-banner">{error}</div>}
    {loading && <Loading />}
    {data && !loading && <>
      <div className="is-summary">
        <div className="is-summary-card"><span>营业收入</span><strong className="positive">{money(data.revenue)}</strong></div>
        <div className="is-summary-card"><span>营业成本与费用</span><strong className="negative">{money(data.expense)}</strong></div>
        <div className="is-summary-card"><span>营业利润</span><strong className={data.profit >= 0 ? 'positive' : 'negative'}>{money(data.profit)}</strong></div>
      </div>
      {isEmpty && <Empty text={`期间 ${data.period} 无 POSTED 凭证,无利润表数据`} />}
      {!isEmpty && data.sections.map((section) => (
        <div key={section.type} className="is-section">
          <h3>{section.name} <small className="dim">（{section.type}）</small></h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>科目编码</th><th>科目名称</th><th className="number">净额</th></tr></thead>
              <tbody>
                {section.subjects.map((s) => <tr key={s.code}><td className="mono">{s.code}</td><td><strong>{s.name}</strong></td><td className="number"><strong className={s.amount >= 0 ? 'positive' : 'negative'}>{money(s.amount)}</strong></td></tr>)}
                <tr className="subtotal-row"><td colSpan={2}>小计</td><td className="number"><strong>{money(section.subtotal)}</strong></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>}
  </div>;
}

export function Accounting({ user, notify }) {
  const [subjects, setSubjects] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [tab, setTab] = useState('vouchers');
  useEffect(() => {
    Promise.all([api('/api/accounting-subjects'), api('/api/accounting-vouchers')]).then(([s, v]) => {
      setSubjects(s.subjects || []);
      setVouchers(v.vouchers || []);
    }).catch((e) => notify(e.message, 'error'));
  }, []);
  function formatMoney(c) { return money(c); }
  const showReport = can(user, 'REPORT_VIEW');
  return <Panel title="财务凭证" subtitle="总账与业务单据的桥接">
    <div className="tabs"><button className={tab === 'subjects' ? 'active' : ''} onClick={() => setTab('subjects')}>会计科目</button><button className={tab === 'vouchers' ? 'active' : ''} onClick={() => setTab('vouchers')}>凭证列表</button>{showReport && <button className={tab === 'income' ? 'active' : ''} onClick={() => setTab('income')}>利润表</button>}</div>
    {tab === 'subjects' && <div className="table-wrap"><table><thead><tr><th>科目编码</th><th>科目名称</th><th>类型</th><th>余额方向</th></tr></thead><tbody>{subjects.map((s) => <tr key={s.id}><td className="mono">{s.code}</td><td><strong>{s.name}</strong></td><td>{s.type === 'ASSET' ? '资产' : s.type === 'LIABILITY' ? '负债' : s.type === 'EQUITY' ? '所有者权益' : s.type === 'REVENUE' ? '收入' : '成本'}</td><td>{s.direction === 'DEBIT' ? '借方' : '贷方'}</td></tr>)}</tbody></table></div>}
    {tab === 'vouchers' && <><Toolbar search={() => {}} placeholder="搜索凭证号"/><div className="table-wrap"><table><thead><tr><th>凭证号</th><th>来源</th><th>凭证日期</th><th>制单人</th><th>创建时间</th><th/></tr></thead><tbody>{vouchers.map((v) => <tr key={v.id}><td className="mono">{v.voucher_no}</td><td>{v.source_type === 'SALES_ORDER' ? '销售订单' : v.source_type === 'PURCHASE_ORDER' ? '采购订单' : '库存调拨'}</td><td>{v.voucher_date}</td><td>{v.creatorName}</td><td className="dim">{dateTime(v.created_at)}</td><td><button className="row-action" onClick={() => { api(`/api/accounting-vouchers/${v.id}`).then((r) => setViewing(r.voucher)).catch((e) => notify(e.message, 'error')); }}>查看</button></td></tr>)}</tbody></table>{!vouchers.length && <Empty text="没有凭证记录"/>}</div></>}
    {tab === 'income' && showReport && <IncomeStatement user={user} notify={notify} />}
    {viewing && <VoucherDetail value={viewing} onClose={() => setViewing(null)} formatMoney={formatMoney}/>}
  </Panel>;
}



function CashManagement({ user, notify }) {
  const [tab, setTab] = useState('journals');
  const [journals, setJournals] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [bills, setBills] = useState([]);
  const [filters, setFilters] = useState({});
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);
  
  useEffect(() => {
    Promise.all([
      api('/api/cash-journals'),
      api('/api/bank-accounts'),
      api('/api/bills')
    ]).then(([j, b, bi]) => {
      setJournals(j.journals || []);
      setBankAccounts(b.bankAccounts || []);
      setBills(bi.bills || []);
    }).catch(e => notify(e.message, 'error'));
  }, []);
  
  function refresh() {
    let url = '/api/cash-journals';
    const params = [];
    if (filters.account_type) params.push('account_type=' + filters.account_type);
    if (filters.start_date) params.push('start_date=' + filters.start_date);
    if (filters.end_date) params.push('end_date=' + filters.end_date);
    if (params.length) url += '?' + params.join('&');
    api(url).then(r => setJournals(r.journals || [])).catch(e => notify(e.message, 'error'));
  }
  
  const accountTypeMap = { CASH: '现金', BANK: '银行存款' };
  const journalTypeMap = { RECEIPT: '收款', PAYMENT: '付款', TRANSFER: '转账' };
  const billTypeMap = { DRAFT: '银行承兑', ACCEPTANCE: '商业承兑', LC: '信用证' };
  const billStatusMap = { PENDING: '待处理', ENDORSED: '已背书', DISCOUNTED: '已贴现', PAID: '已到期', CANCELLED: '已作废' };
  
  return <Panel title="出纳管理" subtitle="现金日记账、银行日记账与票据管理">
    <div className="tabs" style={{marginBottom: '16px', display: 'flex', gap: '4px', borderBottom: '1px solid var(--border-default)', paddingBottom: '12px'}}>
      <button className={tab === 'journals' ? 'primary' : 'secondary'} onClick={() => setTab('journals')}>日记账</button>
      <button className={tab === 'accounts' ? 'primary' : 'secondary'} onClick={() => setTab('accounts')}>银行账户</button>
      <button className={tab === 'bills' ? 'primary' : 'secondary'} onClick={() => setTab('bills')}>票据管理</button>
    </div>
    
    {tab === 'journals' && <>
      <div className="search-bar">
        <select value={filters.account_type || ''} onChange={e => setFilters({...filters, account_type: e.target.value})} style={{width: '120px'}}>
          <option value="">全部账户</option>
          <option value="CASH">现金</option>
          <option value="BANK">银行存款</option>
        </select>
        <input type="date" value={filters.start_date || ''} onChange={e => setFilters({...filters, start_date: e.target.value})} style={{width: '140px'}}/>
        <input type="date" value={filters.end_date || ''} onChange={e => setFilters({...filters, end_date: e.target.value})} style={{width: '140px'}}/>
        <button className="secondary" onClick={refresh}>查询</button>
        <button className="primary" onClick={() => setCreating({account_type: 'BANK'})}>+ 录入日记账</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>单据号</th><th>日期</th><th>账户</th><th>方向</th><th>金额</th><th>摘要</th><th>操作人</th><th></th></tr></thead>
          <tbody>
            {journals.map(j => <tr key={j.id}>
              <td className="mono">{j.journal_no}</td>
              <td>{j.journal_date}</td>
              <td>{j.account_type === 'BANK' ? j.bank_name + ' ' + j.bankAccountNo : '现金'}</td>
              <td><span className={j.direction === 'IN' ? 'status submitted' : 'status rejected'}>{j.direction === 'IN' ? '收入' : '支出'}</span></td>
              <td className="number"><strong className={j.direction === 'IN' ? 'positive' : 'negative'}>{money(j.amount_cents)}</strong></td>
              <td>{j.summary}</td>
              <td>{j.operatorName}</td>
              <td><button className="secondary small" onClick={() => setViewing(j)}>详情</button></td>
            </tr>)}
          </tbody>
        </table>
        {!journals.length && <div className="empty-state"><p>暂无日记账记录</p></div>}
      </div>
    </>}
    
    {tab === 'accounts' && <>
      <div className="action-bar">
        <button className="primary" onClick={() => setCreating({type: 'account'})}>+ 添加银行账户</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>银行名称</th><th>账号</th><th>户名</th><th className="number">余额</th></tr></thead>
          <tbody>
            {bankAccounts.map(a => <tr key={a.id}>
              <td><strong>{a.bank_name}</strong></td>
              <td className="mono">{a.account_no}</td>
              <td>{a.account_name}</td>
              <td className="number"><strong>{money(a.balance_cents)}</strong></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </>}
    
    {tab === 'bills' && <>
      <div className="action-bar">
        <button className="primary" onClick={() => setCreating({type: 'bill'})}>+ 新增票据</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>票号</th><th>类型</th><th>方向</th><th className="number">票面金额</th><th>到期日期</th><th>状态</th></tr></thead>
          <tbody>
            {bills.map(b => <tr key={b.id}>
              <td className="mono">{b.bill_no}</td>
              <td>{billTypeMap[b.bill_type] || b.bill_type}</td>
              <td>{b.direction === 'RECEIVABLE' ? '应收票据' : '应付票据'}</td>
              <td className="number"><strong>{money(b.face_amount_cents)}</strong></td>
              <td>{b.due_date}</td>
              <td>{billStatusMap[b.status] || b.status}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </>}
    
    {creating && <CashJournalForm bankAccounts={bankAccounts} value={creating} onClose={() => setCreating(null)} onSave={() => { setCreating(null); refresh(); }} notify={notify}/>}
    {viewing && <CashJournalDetail value={viewing} onClose={() => setViewing(null)}/>}
  </Panel>;
}

function CashJournalForm({ bankAccounts, value, onClose, onSave, notify }) {
  const [form, setForm] = useState({
    account_type: value.account_type || 'BANK',
    bank_id: '',
    direction: 'IN',
    amount_cents: '',
    summary: '',
    journal_date: new Date().toISOString().slice(0, 10),
    counterparty_name: '',
    remark: ''
  });
  
  async function save() {
    if (!form.amount_cents) { notify('请输入金额', 'error'); return; }
    try {
      await api('/api/cash-journals', { method: 'POST', body: form });
      notify('保存成功');
      onSave();
    } catch (e) { notify(e.message, 'error'); }
  }
  
  return <Modal title="录入日记账" onClose={onClose}>
    <div className="modal-body">
      <div className="form-grid">
        <label className="full">
          账户类型
          <select value={form.account_type} onChange={e => setForm({...form, account_type: e.target.value})}>
            <option value="CASH">现金</option>
            <option value="BANK">银行存款</option>
          </select>
        </label>
        {form.account_type === 'BANK' && <label className="full">
          银行账户
          <select value={form.bank_id} onChange={e => setForm({...form, bank_id: e.target.value})}>
            <option value="">选择账户</option>
            {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} {a.account_no}</option>)}
          </select>
        </label>}
        <label>
          收支方向
          <select value={form.direction} onChange={e => setForm({...form, direction: e.target.value})}>
            <option value="IN">收款</option>
            <option value="OUT">付款</option>
          </select>
        </label>
        <label>
          日期
          <input type="date" value={form.journal_date} onChange={e => setForm({...form, journal_date: e.target.value})}/>
        </label>
        <label className="full">
          金额（元）
          <input type="number" value={form.amount_cents} onChange={e => setForm({...form, amount_cents: e.target.value})} placeholder="请输入金额"/>
        </label>
        <label className="full">
          对方单位
          <input value={form.counterparty_name} onChange={e => setForm({...form, counterparty_name: e.target.value})}/>
        </label>
        <label className="full">
          摘要
          <input value={form.summary} onChange={e => setForm({...form, summary: e.target.value})}/>
        </label>
      </div>
    </div>
    <div className="modal-footer">
      <button className="secondary" onClick={onClose}>取消</button>
      <button className="primary" onClick={save}>保存</button>
    </div>
  </Modal>;
}

function CashJournalDetail({ value, onClose }) {
  return <Modal title={"日记账详情 " + value.journal_no} onClose={onClose}>
    <div className="modal-body">
      <div className="form-grid">
        <label>单据号<span className="mono">{value.journal_no}</span></label>
        <label>日期<span>{value.journal_date}</span></label>
        <label>账户<span>{value.account_type === 'BANK' ? value.bank_name : '现金'}</span></label>
        <label>方向<span className={value.direction === 'IN' ? 'positive' : 'negative'}>{value.direction === 'IN' ? '收入' : '支出'}</span></label>
        <label className="full">金额<span className="mono"><strong>{money(value.amount_cents)}</strong></span></label>
        <label className="full">摘要<span>{value.summary}</span></label>
        <label className="full">操作人<span>{value.operatorName}</span></label>
      </div>
    </div>
    <div className="modal-footer">
      <button className="secondary" onClick={onClose}>关闭</button>
    </div>
  </Modal>;
}


function VoucherDetail({ value, onClose, formatMoney }) {
  if (!value) return null;
  return <Modal title={`凭证 ${value.voucher_no}`} onClose={onClose} wide>
    <div className="detail-head"><div><span className="mono">{value.voucher_no}</span><h3>{value.source_type === 'SALES_ORDER' ? '销售订单' : value.source_type === 'PURCHASE_ORDER' ? '采购订单' : '库存调拨'}</h3><p>凭证日期：{value.voucher_date} · 制单人：{value.creatorName}</p></div></div>
    <div className="table-wrap"><table><thead><tr><th>方向</th><th>科目</th><th>金额</th><th>摘要</th></tr></thead><tbody>
      {value.entries?.map((e) => <tr key={e.id}><td className={e.direction === 'DEBIT' ? 'positive' : 'negative'}>{e.direction === 'DEBIT' ? '借' : '贷'}</td><td>{e.subjectCode} {e.subjectName}</td><td className="number"><strong>{money(e.amount_cents)}</strong></td><td>{e.summary}</td></tr>)}
    </tbody><tfoot><tr><td colspan="2"/><td className="number"><strong>借方合计：{money(value.debitTotal)}</strong></td><td className="number"><strong>贷方合计：{money(value.creditTotal)}</strong></td></tr></tfoot></table></div>
  </Modal>;
}
