import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Active, Badge, ConfirmAction, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, can, dateTime, money } from '../components/ui.jsx';
import { centsToYuanInput, yuanToCents } from '../lib/money.js';

function currentPeriod() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ============ Accounting label maps ============
//
// Source labels for accounting vouchers. Backend creates MANUAL vouchers
// via createAccountingVoucher and SALES_ORDER / PURCHASE_ORDER via legacy
// auto-posting paths. unknown source_type renders the raw code (never
// silently masks as another business type).
const VOUCHER_SOURCE_LABELS = {
  MANUAL: '手工凭证',
  SALES_ORDER: '销售订单',
  PURCHASE_ORDER: '采购订单',
  INVENTORY_TRANSFER: '库存调拨',
};
function voucherSourceLabel(type) {
  if (!type) return '—';
  return VOUCHER_SOURCE_LABELS[type] || '其他业务来源';
}

const VOUCHER_STATUS_LABELS = {
  ENTERED: '草稿',
  SUBMITTED: '待审批',
  POSTED: '已审批',
  REJECTED: '已驳回',
};
// Map raw status to existing CSS class. POSTED reuses .status.completed
// (green/success) since no dedicated .status.posted rule exists.
// CSS is intentionally untouched (per scope rule).
const VOUCHER_STATUS_BADGE = {
  ENTERED: { type: 'info', status: 'draft' },
  SUBMITTED: { type: 'warning', status: 'submitted' },
  POSTED: { type: 'success', status: 'completed' },
  REJECTED: { type: 'danger', status: 'rejected' },
};

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

function BalanceSheet({ user, notify }) {
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
    api(`/api/reports/balance-sheet?period=${encodeURIComponent(period)}`)
      .then((r) => { setData(r); setError(null); })
      .catch((e) => { setError(e.message || '查询失败'); setData(null); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { query(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const isEmpty = data && data.assets.subjects.length === 0 && data.liabilities.subjects.length === 0 && data.equity.subjects.length === 0 && data.equity.unclosedProfit === 0;

  const renderSection = (title, section, totalKey) => (
    <div className="bs-section">
      <h3>{title} <small className="dim">（{section.total >= 0 ? '合计' : '负数'}）</small></h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>科目编码</th><th>科目名称</th><th className="number">金额</th></tr></thead>
          <tbody>
            {section.subjects.map((s) => <tr key={s.code}><td className="mono">{s.code}</td><td><strong>{s.name}</strong></td><td className="number"><strong className={s.amount >= 0 ? 'positive' : 'negative'}>{money(s.amount)}</strong></td></tr>)}
            {totalKey === 'equity' && (
              <tr className="bs-virtual-row"><td colSpan={2}>未结转损益（虚拟行，不持久化）</td><td className="number"><strong className={data.equity.unclosedProfit >= 0 ? 'positive' : 'negative'}>{money(data.equity.unclosedProfit)}</strong></td></tr>
            )}
            <tr className="subtotal-row"><td colSpan={2}>小计</td><td className="number"><strong>{money(totalKey === 'equity' ? data.equity.total : section.total)}</strong></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  return <div className="balance-sheet">
    <div className="search-bar">
      <label>期间</label>
      <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 160 }} />
      <button className="primary" onClick={query} disabled={loading}>{loading ? '查询中…' : '查询'}</button>
      {data && <span className="dim" style={{ marginLeft: 12 }}>截至 {data.asOfDate}</span>}
    </div>
    {error && <div className="error-banner">{error}</div>}
    {loading && <Loading />}
    {data && !loading && <>
      <div className={`bs-equation-banner ${data.equationValid ? 'valid' : 'invalid'}`}>
        {data.equationValid
          ? <><strong>资产 = 负债 + 权益</strong><span className="dim">（恒等式成立，差额 {money(data.difference)}）</span></>
          : <><strong>⚠ 资产 ≠ 负债 + 权益</strong><span className="dim">（差额 {money(data.difference)}，请检查未结转损益或凭证数据）</span></>}
      </div>
      {isEmpty && <Empty text={`截至 ${data.asOfDate} 无 POSTED 凭证,无资产负债表数据`} />}
      {!isEmpty && <>
        {renderSection('资产', data.assets, 'assets')}
        {renderSection('负债', data.liabilities, 'liabilities')}
        {renderSection('所有者权益', data.equity, 'equity')}
        <div className="bs-totals">
          <div className="bs-total-row"><span>资产合计</span><strong className={data.totalAssets >= 0 ? 'positive' : 'negative'}>{money(data.totalAssets)}</strong></div>
          <div className="bs-total-row"><span>负债和权益合计</span><strong>{money(data.totalLiabilitiesAndEquity)}</strong></div>
        </div>
      </>}
    </>}
  </div>;
}

const PERIOD_STATUS_LABELS = {
  OPEN: '未结账',
  CLOSED: '已结账',
};
const PERIOD_STATUS_BADGE = {
  OPEN: { type: 'info', status: 'draft' },
  CLOSED: { type: 'success', status: 'completed' },
};
const PERIOD_CLOSURE_TYPE_LABELS = {
  MONTH: '月结',
};

function PeriodManagement({ user, notify }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [closures, setClosures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [selectedPeriod, setSelectedPeriod] = useState(null); // 'YYYY-MM' string
  const [checklist, setChecklist] = useState(null);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistError, setChecklistError] = useState(null);

  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const canView = can(user, 'PERIOD_CLOSE_VIEW');
  const canManage = can(user, 'PERIOD_CLOSE_MANAGE');

  function load() {
    setLoading(true);
    setError(null);
    api(`/api/period-closures?year=${encodeURIComponent(year)}`)
      .then((r) => {
        setClosures(r.closures || []);
        setError(null);
      })
      .catch((e) => {
        setError(e.message || '加载期间列表失败');
        setClosures([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year]);

  const monthList = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  const closureByPeriod = useMemo(() => {
    const map = new Map();
    for (const c of closures) map.set(c.period, c);
    return map;
  }, [closures]);

  function loadChecklist(period) {
    setChecklistLoading(true);
    setChecklistError(null);
    setChecklist(null);
    api(`/api/period-closures/closure-checklist?period=${encodeURIComponent(period)}`)
      .then((r) => setChecklist(r))
      .catch((e) => setChecklistError(e.message || '加载结账检查失败'))
      .finally(() => setChecklistLoading(false));
  }

  function selectPeriod(period) {
    setSelectedPeriod(period);
    loadChecklist(period);
  }

  async function createPeriod(period) {
    const [y, m] = period.split('-');
    setBusy(true);
    try {
      await api('/api/period-closures', { method: 'POST', body: { year: Number(y), month: Number(m) } });
      notify(`期间 ${period} 已初始化`);
      load();
      selectPeriod(period);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function closePeriod(closureId) {
    setBusy(true);
    try {
      await api(`/api/period-closures/${closureId}/close`, { method: 'POST', body: {} });
      notify(`期间 ${selectedPeriod} 已结账`);
      setConfirm(null);
      load();
      loadChecklist(selectedPeriod);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function unclosePeriod(closureId) {
    setBusy(true);
    try {
      await api(`/api/period-closures/${closureId}/unclose`, { method: 'POST', body: {} });
      notify(`期间 ${selectedPeriod} 已重开`);
      setConfirm(null);
      load();
      loadChecklist(selectedPeriod);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const selectedClosure = selectedPeriod ? closureByPeriod.get(selectedPeriod) : null;

  return <div className="period-closures">
    <div className="search-bar">
      <label>年度</label>
      <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())} style={{ width: 110 }} />
      <button className="primary" onClick={load} disabled={loading}>{loading ? '加载中…' : '刷新'}</button>
      {!canView && <span className="dim">当前账号无期间查看权限</span>}
    </div>
    {error && <div className="error-banner">{error}</div>}
    {loading && <Loading />}
    {!loading && canView && <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>期间</th>
              <th>状态</th>
              <th>结账类型</th>
              <th>结账人</th>
              <th>结账时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {monthList.map((m) => {
              const period = `${year}-${m}`;
              const c = closureByPeriod.get(period);
              const status = c?.status;
              const isSelected = selectedPeriod === period;
              return <tr key={period} className={isSelected ? 'selected' : ''}>
                <td className="mono"><strong>{period}</strong></td>
                <td>{status
                  ? <Badge type={PERIOD_STATUS_BADGE[status]?.type}>{PERIOD_STATUS_LABELS[status] || status}</Badge>
                  : <span className="dim">未初始化</span>}</td>
                <td>{c?.closure_type ? (PERIOD_CLOSURE_TYPE_LABELS[c.closure_type] || c.closure_type) : '—'}</td>
                <td>{c?.closed_by_name || '—'}</td>
                <td className="dim">{c?.closed_at ? dateTime(c.closed_at) : '—'}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {!c && canManage && <button className="secondary" disabled={busy} onClick={() => createPeriod(period)}>初始化</button>}
                  {c && status === 'OPEN' && canManage && <button className="secondary" disabled={busy} onClick={() => selectPeriod(period)}>结账检查</button>}
                  {c && status === 'CLOSED' && canManage && <button className="secondary" disabled={busy} onClick={() => { setSelectedPeriod(period); loadChecklist(period); }}>查看</button>}
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {selectedPeriod && <div className="period-detail" style={{ marginTop: 16 }}>
        <h3>期间 {selectedPeriod} 详情</h3>
        {!selectedClosure && <Empty text={`期间 ${selectedPeriod} 尚未初始化,无法结账。请先点击行内「初始化」创建期间记录。`} />}
        {selectedClosure && <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <span>状态:</span>
            <Badge type={PERIOD_STATUS_BADGE[selectedClosure.status]?.type}>{PERIOD_STATUS_LABELS[selectedClosure.status] || selectedClosure.status}</Badge>
            {selectedClosure.closed_by_name && <span className="dim">结账人 {selectedClosure.closed_by_name}{selectedClosure.closed_at ? ` · ${dateTime(selectedClosure.closed_at)}` : ''}</span>}
          </div>
          {checklistLoading && <Loading />}
          {checklistError && <div className="error-banner">{checklistError}</div>}
          {checklist && !checklistLoading && <>
            {checklist.detail && <div className="error-banner">{checklist.detail}</div>}
            {checklist.checklist && checklist.checklist.length > 0 && <div className="table-wrap" style={{ marginBottom: 12 }}>
              <table>
                <thead><tr><th>检查项</th><th>状态</th><th>说明</th></tr></thead>
                <tbody>
                  {checklist.checklist.map((item, idx) => <tr key={idx}>
                    <td><strong>{item.item}</strong></td>
                    <td>{item.passed ? <Badge type="success">通过</Badge> : <Badge type="danger">阻塞</Badge>}</td>
                    <td>{item.detail}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>}
            {!checklist.detail && <div className={`bs-equation-banner ${checklist.passed ? 'valid' : 'invalid'}`}>
              {checklist.passed
                ? <><strong>结账检查通过</strong><span className="dim">（可关闭该期间）</span></>
                : <><strong>结账检查未通过</strong><span className="dim">（请先处理阻塞项后再关闭）</span></>}
            </div>}
          </>}
          {canManage && <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {selectedClosure.status === 'OPEN' && <button className="primary" disabled={busy || !checklist || !checklist.passed || Boolean(checklist.detail)} onClick={() => setConfirm({ kind: 'close', closureId: selectedClosure.id, period: selectedPeriod })}>关闭期间</button>}
            {selectedClosure.status === 'CLOSED' && <button className="secondary" disabled={busy} onClick={() => setConfirm({ kind: 'unclose', closureId: selectedClosure.id, period: selectedPeriod })}>重开期间</button>}
          </div>}
        </>}
      </div>}
    </>}
    {confirm && <Modal title={confirm.kind === 'close' ? '确认关闭会计期间' : '确认重开会计期间'} onClose={() => !busy && setConfirm(null)}>
      <div className="modal-body">
        <p>{confirm.kind === 'close'
          ? `确认关闭会计期间 ${confirm.period}?关闭后该期间的会计凭证将受到结账保护。`
          : `确认重开会计期间 ${confirm.period}?重开后可以再次在该期间录入凭证。`}</p>
      </div>
      <div className="modal-footer">
        <button type="button" className="secondary" disabled={busy} onClick={() => setConfirm(null)}>取消</button>
        <button type="button" className="primary" disabled={busy} onClick={() => confirm.kind === 'close' ? closePeriod(confirm.closureId) : unclosePeriod(confirm.closureId)}>
          {confirm.kind === 'close' ? '关闭' : '重开'}
        </button>
      </div>
    </Modal>}
  </div>;
}

function TrialBalanceReport({ user, notify }) {
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
    api(`/api/reports/trial-balance?period=${encodeURIComponent(period)}`)
      .then((r) => { setData(r); setError(null); })
      .catch((e) => { setError(e.message || '查询失败'); setData(null); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { query(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const rows = data?.trialBalance || [];
  const totalDebit = rows.reduce((s, r) => s + Number(r.periodDebit || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + Number(r.periodCredit || 0), 0);
  // Period debit / credit 是 gross movement，不依赖 direction 字段，直接相加即可。
  // Opening / Closing 余额按 backend 返回的 openingDirection / closingDirection 归类：
  //  正负号不能独立判定借贷侧（credit-normal 科目的 closing 正余额表示 CREDIT 侧）。
  //  零余额不进任一侧合计，避免污染 footer。
  const sumByDirection = (balanceField, directionField, side) =>
    rows.reduce((s, r) =>
      s + (r[directionField] === side ? Math.abs(Number(r[balanceField] || 0)) : 0), 0);
  const totalOpeningDebit = sumByDirection('openingBalance', 'openingDirection', 'DEBIT');
  const totalOpeningCredit = sumByDirection('openingBalance', 'openingDirection', 'CREDIT');
  const totalClosingDebit = sumByDirection('closingBalance', 'closingDirection', 'DEBIT');
  const totalClosingCredit = sumByDirection('closingBalance', 'closingDirection', 'CREDIT');
  const periodBalanced = totalDebit === totalCredit;
  const periodDiff = totalDebit - totalCredit;

  return <div className="trial-balance">
    <div className="search-bar">
      <label>期间</label>
      <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 160 }} />
      <button className="primary" onClick={query} disabled={loading}>{loading ? '查询中…' : '查询'}</button>
      {data && <span className="dim" style={{ marginLeft: 12 }}>范围 {data.period?.startDate} 至 {data.period?.endDate}</span>}
    </div>
    {error && <div className="error-banner">{error}</div>}
    {loading && <Loading />}
    {data && !loading && <>
      <div className={`bs-equation-banner ${periodBalanced ? 'valid' : 'invalid'}`}>
        {periodBalanced
          ? <><strong>借方发生额 = 贷方发生额</strong><span className="dim">（本期借贷相等）</span></>
          : <><strong>⚠ 借方 ≠ 贷方</strong><span className="dim">（本期借贷发生额差额 {money(periodDiff)}）</span></>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>科目编码</th>
              <th>科目名称</th>
              <th className="number">期初余额</th>
              <th className="number">本期借方</th>
              <th className="number">本期贷方</th>
              <th className="number">期末余额</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.code}</td>
                <td><strong>{r.name}</strong></td>
                <td className="number">
                  <strong className={r.openingDirection === 'DEBIT' ? 'positive' : (r.openingDirection === 'CREDIT' ? 'negative' : '')}>
                    {r.openingDirection === 'DEBIT' ? '借 ' : r.openingDirection === 'CREDIT' ? '贷 ' : ''}{money(Math.abs(r.openingBalance))}
                  </strong>
                </td>
                <td className="number">{money(r.periodDebit)}</td>
                <td className="number">{money(r.periodCredit)}</td>
                <td className="number">
                  <strong className={r.closingDirection === 'DEBIT' ? 'positive' : (r.closingDirection === 'CREDIT' ? 'negative' : '')}>
                    {r.closingDirection === 'DEBIT' ? '借 ' : r.closingDirection === 'CREDIT' ? '贷 ' : ''}{money(Math.abs(r.closingBalance))}
                  </strong>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6}><Empty text={`期间 ${period} 无 POSTED 凭证`} /></td></tr>}
          </tbody>
          <tfoot>
            <tr className="subtotal-row">
              <td colSpan={2}>合计</td>
              <td className="number">借 {money(totalOpeningDebit)} / 贷 {money(totalOpeningCredit)}</td>
              <td className="number"><strong>{money(totalDebit)}</strong></td>
              <td className="number"><strong>{money(totalCredit)}</strong></td>
              <td className="number">借 {money(totalClosingDebit)} / 贷 {money(totalClosingCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>}
  </div>;
}

export function Accounting({ user, notify }) {
  const [subjects, setSubjects] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [tab, setTab] = useState('vouchers');

  function loadVouchers() {
    api('/api/accounting-vouchers').then((r) => setVouchers(r.vouchers || []))
      .catch((e) => notify(e.message, 'error'));
  }

  useEffect(() => {
    Promise.all([api('/api/accounting-subjects'), api('/api/accounting-vouchers')]).then(([s, v]) => {
      setSubjects(s.subjects || []);
      setVouchers(v.vouchers || []);
    }).catch((e) => notify(e.message, 'error'));
  }, []);
  function formatMoney(c) { return money(c); }
  const showReport = can(user, 'REPORT_VIEW');
  const canCreateVoucher = can(user, 'ACCOUNTING_VIEW');
  const showPeriod = can(user, 'PERIOD_CLOSE_VIEW');
  return <Panel title="财务凭证">
    <div className="tabs"><button className={tab === 'subjects' ? 'active' : ''} onClick={() => setTab('subjects')}>会计科目</button><button className={tab === 'vouchers' ? 'active' : ''} onClick={() => setTab('vouchers')}>凭证列表</button>{showReport && <button className={tab === 'income' ? 'active' : ''} onClick={() => setTab('income')}>利润表</button>}{showReport && <button className={tab === 'balance' ? 'active' : ''} onClick={() => setTab('balance')}>资产负债表</button>}{showReport && <button className={tab === 'trial' ? 'active' : ''} onClick={() => setTab('trial')}>试算平衡表</button>}{showPeriod && <button className={tab === 'period' ? 'active' : ''} onClick={() => setTab('period')}>会计期间</button>}</div>
    {tab === 'subjects' && <div className="table-wrap"><table><thead><tr><th>科目编码</th><th>科目名称</th><th>类型</th><th>余额方向</th></tr></thead><tbody>{subjects.map((s) => <tr key={s.id}><td className="mono">{s.code}</td><td><strong>{s.name}</strong></td><td>{s.type === 'ASSET' ? '资产' : s.type === 'LIABILITY' ? '负债' : s.type === 'EQUITY' ? '所有者权益' : s.type === 'REVENUE' ? '收入' : '成本'}</td><td>{s.direction === 'DEBIT' ? '借方' : '贷方'}</td></tr>)}</tbody></table></div>}
    {tab === 'vouchers' && <><Toolbar search={() => {}} placeholder="搜索凭证号" action={canCreateVoucher && <button className="primary" onClick={() => setEditing({})}>＋ 新建凭证</button>}/><div className="table-wrap"><table><thead><tr><th>凭证号</th><th>来源</th><th>凭证日期</th><th>制单人</th><th>状态</th><th>创建时间</th><th/></tr></thead><tbody>{vouchers.map((v) => <tr key={v.id}><td className="mono">{v.voucher_no}</td><td>{voucherSourceLabel(v.source_type)}</td><td>{v.voucher_date}</td><td>{v.creatorName}</td><td><Badge type={VOUCHER_STATUS_BADGE[v.status]?.type}>{VOUCHER_STATUS_LABELS[v.status] || v.status}</Badge></td><td className="dim">{dateTime(v.created_at)}</td><td><button className="row-action" onClick={() => { api(`/api/accounting-vouchers/${v.id}`).then((r) => setViewing(r.voucher)).catch((e) => notify(e.message, 'error')); }}>查看</button></td></tr>)}</tbody></table>{!vouchers.length && <Empty text="没有凭证记录"/>}</div></>}
    {tab === 'income' && showReport && <IncomeStatement user={user} notify={notify} />}
    {tab === 'balance' && showReport && <BalanceSheet user={user} notify={notify} />}
    {tab === 'trial' && showReport && <TrialBalanceReport user={user} notify={notify} />}
    {tab === 'period' && showPeriod && <PeriodManagement user={user} notify={notify} />}
    {editing && <VoucherModal subjects={subjects} value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); loadVouchers(); notify('凭证已保存'); }} notify={notify}/>}
    {viewing && <VoucherDetail user={user} value={viewing} onClose={() => setViewing(null)} onChanged={() => { setViewing(null); loadVouchers(); }} onEdit={(voucher) => { setEditing(voucher); setViewing(null); }} formatMoney={formatMoney} notify={notify}/>}
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
  
  return <Panel title="出纳管理">
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
    if (!form.amount_cents || Number(form.amount_cents) <= 0) { notify('金额必须大于 0', 'error'); return; }
    try {
      await api('/api/cash-journals', { method: 'POST', body: form });
      notify('已保存');
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


function VoucherModal({ subjects, value, onClose, onSaved, notify }) {
  const isEdit = Boolean(value?.id);
  // Form state holds YUAN strings (the unit the user types in). Conversion
  // to backend integer cents happens only at the request boundary via
  // yuanToCents(). See src/lib/money.js for the unit boundary contract.
  const [form, setForm] = useState(() => ({
    voucherDate: value?.voucher_date || new Date().toISOString().slice(0, 10),
    remark: value?.remark || '',
    entries: value?.entries?.length
      ? value.entries.map((e) => ({
          subjectId: e.subject_id || e.subjectId || '',
          direction: e.direction || 'DEBIT',
          amount: centsToYuanInput(e.amount_cents ?? e.amountCents),
          summary: e.summary || '',
        }))
      : [{ subjectId: '', direction: 'DEBIT', amount: '', summary: '' },
         { subjectId: '', direction: 'CREDIT', amount: '', summary: '' }],
  }));

  function setEntry(i, field, val) {
    const next = [...form.entries];
    next[i] = { ...next[i], [field]: val };
    setForm({ ...form, entries: next });
  }
  function addEntry() {
    setForm({ ...form, entries: [...form.entries, { subjectId: '', direction: 'DEBIT', amount: '', summary: '' }] });
  }
  function removeEntry(i) {
    setForm({ ...form, entries: form.entries.filter((_, idx) => idx !== i) });
  }

  // Frontend UX validation; backend still authoritatively enforces.
  // Convert each entry's yuan amount to integer cents for arithmetic so
  // balance check operates in cents space (no float drift).
  const { validation, debitTotal, creditTotal } = (() => {
    if (form.entries.length < 2) return { validation: '至少需要两条分录', debitTotal: 0, creditTotal: 0 };
    let debit = 0, credit = 0;
    for (const [i, e] of form.entries.entries()) {
      if (!e.subjectId) return { validation: `第 ${i + 1} 行科目不能为空`, debitTotal: 0, creditTotal: 0 };
      if (!['DEBIT', 'CREDIT'].includes(e.direction)) return { validation: `第 ${i + 1} 行方向不合法`, debitTotal: 0, creditTotal: 0 };
      const cents = yuanToCents(e.amount);
      if (cents === null || cents <= 0) return { validation: `第 ${i + 1} 行金额必须大于 0`, debitTotal: 0, creditTotal: 0 };
      if (e.direction === 'DEBIT') debit += cents; else credit += cents;
    }
    const diff = Math.abs(debit - credit);
    if (diff !== 0) return { validation: `借贷不平衡:借方 ${debit / 100} 元 / 贷方 ${credit / 100} 元`, debitTotal: debit, creditTotal: credit };
    return { validation: null, debitTotal: debit, creditTotal: credit };
  })();

  async function save(e) {
    e.preventDefault();
    if (validation) { notify(validation, 'error'); return; }
    // Build the canonical request body: entries in integer cents (backend contract).
    const body = {
      voucherDate: form.voucherDate,
      remark: form.remark,
      entries: form.entries.map((e) => ({
        subjectId: e.subjectId,
        direction: e.direction,
        amountCents: yuanToCents(e.amount),
        summary: e.summary,
      })),
    };
    try {
      if (isEdit) {
        await api(`/api/accounting-vouchers/${value.id}`, { method: 'PATCH', body });
      } else {
        await api('/api/accounting-vouchers', { method: 'POST', body });
      }
      onSaved();
    } catch (err) { notify(err.message, 'error'); }
  }

  const balanced = validation === null && form.entries.length >= 2;

  return <Modal title={isEdit ? `编辑凭证 ${value.voucher_no}` : '新建凭证'} onClose={onClose} wide>
    <form className="form-grid" onSubmit={save}>
      <label>凭证日期<input type="date" value={form.voucherDate} onChange={(e) => setForm({ ...form, voucherDate: e.target.value })} required/></label>
      <label className="full">摘要<input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })}/></label>
      <h4 className="full">分录</h4>
      <div className="table-wrap full">
        <table>
          <thead><tr><th>#</th><th>科目</th><th>方向</th><th className="number">金额（元）</th><th>摘要</th><th/></tr></thead>
          <tbody>
            {form.entries.map((entry, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><select value={entry.subjectId} onChange={(e) => setEntry(i, 'subjectId', e.target.value)} required>
                  <option value="">选择科目</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}
                </select></td>
                <td><select value={entry.direction} onChange={(e) => setEntry(i, 'direction', e.target.value)}>
                  <option value="DEBIT">借</option>
                  <option value="CREDIT">贷</option>
                </select></td>
                <td><input type="number" step="0.01" min="0" value={entry.amount} onChange={(e) => setEntry(i, 'amount', e.target.value)} required/></td>
                <td><input value={entry.summary} onChange={(e) => setEntry(i, 'summary', e.target.value)}/></td>
                <td>{form.entries.length > 2 && <button type="button" className="danger-button" onClick={() => removeEntry(i)}>删除</button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="subtotal-row">
              <td colSpan={2}>合计</td>
              <td className="number"><strong>借 {money(debitTotal)}</strong></td>
              <td className="number"><strong>贷 {money(creditTotal)}</strong></td>
              <td colSpan={2}><strong className={balanced ? 'positive' : 'negative'}>{balanced ? '借贷平衡' : '不平衡'}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="full" style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="secondary" onClick={addEntry}>+ 新增分录</button>
      </div>
      {validation && <div className="error-banner full">{validation}</div>}
      <div className="form-actions full">
        <button type="button" className="secondary" onClick={onClose}>取消</button>
        <button type="submit" className="primary" disabled={Boolean(validation)}>{isEdit ? '保存' : '保存为已录入'}</button>
      </div>
    </form>
  </Modal>;
}

function VoucherDetail({ user, value, onClose, onChanged, onEdit, formatMoney, notify }) {
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  if (!value) return null;

  const status = value.status;
  const editable = value.source_type === 'MANUAL' && (status === 'ENTERED' || status === 'REJECTED') && can(user, 'ACCOUNTING_VIEW');
  const deletable = editable;
  const canSubmit = status === 'ENTERED' && can(user, 'VOUCHER_SUBMIT');
  // Re-submit is allowed for REJECTED too (backend submitAccountingVoucher accepts both ENTERED and REJECTED).
  const canResubmit = status === 'REJECTED' && can(user, 'VOUCHER_SUBMIT') && value.source_type === 'MANUAL';
  const canApprove = status === 'SUBMITTED' && can(user, 'VOUCHER_APPROVE') && value.creator_id !== user?.id;
  const isReadOnly = status === 'POSTED';

  async function submit() {
    try {
      await api(`/api/accounting-vouchers/${value.id}/submit`, { method: 'POST', body: {} });
      notify('凭证已提交');
      onChanged();
    } catch (e) { notify(e.message, 'error'); }
  }
  async function approve() {
    try {
      await api(`/api/accounting-vouchers/${value.id}/approve`, { method: 'POST', body: {} });
      notify('凭证已审批通过');
      onChanged();
    } catch (e) { notify(e.message, 'error'); }
  }
  async function reject() {
    const reason = rejectionReason.trim();
    if (!reason) { notify('驳回时必须填写原因', 'error'); return; }
    try {
      await api(`/api/accounting-vouchers/${value.id}/reject`, { method: 'POST', body: { rejectionReason: reason } });
      notify('凭证已驳回');
      setRejecting(false); setRejectionReason('');
      onChanged();
    } catch (e) { notify(e.message, 'error'); }
  }
  async function remove() {
    try {
      await api(`/api/accounting-vouchers/${value.id}`, { method: 'DELETE' });
      notify('凭证已删除');
      onChanged();
    } catch (e) { notify(e.message, 'error'); }
  }

  const statusBadge = VOUCHER_STATUS_BADGE[status];
  return <Modal title={`凭证 ${value.voucher_no}`} onClose={onClose} wide>
    <div className="detail-head">
      <div>
        <span className="mono">{value.voucher_no}</span>
        <h3>{voucherSourceLabel(value.source_type)}{statusBadge && <> · <Badge type={statusBadge.type}>{VOUCHER_STATUS_LABELS[status] || status}</Badge></>}</h3>
        <p>凭证日期：{value.voucher_date} · 制单人：{value.creatorName}{value.approver_id ? ` · 审核人：${value.approver_id}` : ''}</p>
        {status === 'REJECTED' && value.rejection_reason && <p className="dim">驳回原因：{value.rejection_reason}</p>}
      </div>
    </div>
    <div className="table-wrap"><table><thead><tr><th>方向</th><th>科目</th><th>金额</th><th>摘要</th></tr></thead><tbody>
      {value.entries?.map((e) => <tr key={e.id}><td className={e.direction === 'DEBIT' ? 'positive' : 'negative'}>{e.direction === 'DEBIT' ? '借' : '贷'}</td><td>{e.subjectCode} {e.subjectName}</td><td className="number"><strong>{money(e.amount_cents)}</strong></td><td>{e.summary}</td></tr>)}
    </tbody><tfoot><tr><td colspan="2"/><td className="number"><strong>借方合计：{money(value.debitTotal)}</strong></td><td className="number"><strong>贷方合计：{money(value.creditTotal)}</strong></td></tr></tfoot></table></div>
    {rejecting && <div className="form-grid" style={{ marginTop: 12 }}>
      <label className="full">驳回原因<textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows={2} required/></label>
      <div className="form-actions full">
        <button type="button" className="secondary" onClick={() => { setRejecting(false); setRejectionReason(''); }}>取消</button>
        <button type="button" className="danger-button" onClick={reject} disabled={!rejectionReason.trim()}>确认驳回</button>
      </div>
    </div>}
    {!rejecting && (canSubmit || canResubmit || canApprove || editable || deletable) && <div className="form-actions full" style={{ marginTop: 12 }}>
      {(canSubmit || canResubmit) && <button type="button" className="primary" onClick={submit}>{canResubmit ? '重新提交' : '提交'}</button>}
      {canApprove && <button type="button" className="primary" onClick={approve}>审批通过</button>}
      {canApprove && <button type="button" className="danger-button" onClick={() => setRejecting(true)}>驳回</button>}
      {editable && <button type="button" className="secondary" onClick={() => onEdit?.(value)}>编辑</button>}
      {deletable && <ConfirmAction destructive buttonLabel="删除" title={`删除凭证 ${value.voucher_no}？`} message="删除后将无法恢复。" confirmLabel="删除" onConfirm={remove}/>}
    </div>}
    {isReadOnly && <p className="dim full" style={{ marginTop: 12 }}>已过账凭证为只读。</p>}
  </Modal>;
}
