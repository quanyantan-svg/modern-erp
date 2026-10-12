import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { AppLink } from '../navigation/AppNavigationContext.jsx';
import { money } from '../components/ui.jsx';
import {
  BusinessAction, BusinessPageHeader, BusinessPageShell, EmptyState, InlineAlert,
  RecordCard, RecordList, SegmentedControl, Skeleton, SummaryCard,
} from '../components/design-system.jsx';

const asRows = (result, key) => Array.isArray(result?.[key]) ? result[key] : [];

export function FinanceInvoices({ notify }) {
  const [sales, setSales] = useState([]);
  const [purchase, setPurchase] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      const [salesResult, purchaseResult] = await Promise.all([api('/api/sales-invoices'), api('/api/supplier-bills')]);
      setSales(asRows(salesResult, 'salesInvoices'));
      setPurchase(asRows(purchaseResult, 'supplierBills'));
    } catch (error) { notify(error.message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const postedSales = sales.filter((row) => row.status === 'POSTED');
  const postedPurchase = purchase.filter((row) => row.status === 'POSTED');
  return <BusinessPageShell className="finance-hub finance-invoice-hub" width="rail">
    <BusinessPageHeader title="发票管理" context="销售发票、采购发票与来源业务的统一工作入口" secondaryActions={<BusinessAction onClick={load}>刷新</BusinessAction>}/>
    <section className="finance-hero" aria-label="发票概览"><div><span>INVOICE CONTROL</span><h2>从业务来源到正式应收应付</h2><p>保留来源、确认模式、贷记状态与最终 open item 的完整追溯。</p></div><div className="finance-hero__metric"><strong>{sales.length + purchase.length}</strong><span>当前发票 / 账单</span></div></section>
    <div className="finance-summary-grid"><SummaryCard label="已过账销售发票" value={postedSales.length} detail={money(postedSales.reduce((sum, row) => sum + Number(row.gross_cents || 0), 0))}/><SummaryCard label="已过账供应商账单" value={postedPurchase.length} detail={money(postedPurchase.reduce((sum, row) => sum + Number(row.gross_cents || 0), 0))}/></div>
    <div className="finance-workstream-grid">
      <AppLink className="finance-workstream" page="sales-invoices"><small>应收侧</small><strong>销售发票</strong><span>开票、过账、贷记与来源追溯</span><b>进入工作台 →</b></AppLink>
      <AppLink className="finance-workstream" page="supplier-bills"><small>应付侧</small><strong>供应商账单</strong><span>匹配、过账、验证与贷记</span><b>进入工作台 →</b></AppLink>
    </div>
    {loading ? <Skeleton lines={3}/> : <RecordList className="finance-recent-list">{[...sales.map((row) => ({ ...row, side: 'AR', no: row.invoice_no, date: row.invoice_date })), ...purchase.map((row) => ({ ...row, side: 'AP', no: row.bill_no, date: row.bill_date }))].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8).map((row) => <RecordCard key={`${row.side}:${row.id}`} title={row.no} subtitle={`${row.side} · ${row.date}`} status={<span className={`status-chip status-chip--${String(row.status).toLowerCase()}`}>{row.status}</span>} facts={[{ label: '含税金额', value: money(row.gross_cents) }, { label: '确认模式', value: row.recognition_mode || '待确认' }]} />)}</RecordList>}
  </BusinessPageShell>;
}

const TREASURY_TABS = [
  { value: 'accounts', label: '账户' }, { value: 'movements', label: '流水' },
  { value: 'requests', label: '付款申请' }, { value: 'notes', label: '票据' },
  { value: 'bank', label: '银行对账' }, { value: 'close', label: '业务关账' },
];

export function FinanceTreasury({ notify }) {
  const [tab, setTab] = useState('accounts');
  const [data, setData] = useState({ accounts: [], movements: [], requests: [], notes: [], statements: [], reconciliations: [], closes: [] });
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      const [accounts, movements, requests, notes, statements, reconciliations, closes] = await Promise.all([
        api('/api/finance/settlement-accounts'), api('/api/finance/treasury-movements'), api('/api/finance/payment-requests'),
        api('/api/finance/notes'), api('/api/finance/bank-statements'), api('/api/finance/bank-reconciliations'), api('/api/finance/business-close'),
      ]);
      setData({ accounts: asRows(accounts, 'settlementAccounts'), movements: asRows(movements, 'movements'), requests: asRows(requests, 'paymentRequests'), notes: asRows(notes, 'notes'), statements: asRows(statements, 'bankStatements'), reconciliations: asRows(reconciliations, 'reconciliations'), closes: asRows(closes, 'state') });
    } catch (error) { notify(error.message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const totalBalance = useMemo(() => data.accounts.reduce((sum, row) => sum + Number(row.balance_cents || 0), 0), [data.accounts]);
  const body = {
    accounts: data.accounts.map((row) => <RecordCard key={row.id} title={row.account_name} subtitle={`${row.code || row.account_no} · ${row.account_type}`} status={<span className="status-chip status-chip--posted">{row.active ? '启用' : '停用'}</span>} facts={[{ label: '当前余额', value: money(row.balance_cents) }, { label: '币种', value: row.currency }]} actions={<AppLink page="bank-accounts">维护账户</AppLink>}/>),
    movements: data.movements.map((row) => <RecordCard key={row.id} title={row.source_type} subtitle={`${row.business_date} · ${row.direction}`} facts={[{ label: '金额', value: money(row.amount_cents) }, { label: '外部参考', value: row.external_reference || '—' }]}/>),
    requests: data.requests.map((row) => <RecordCard key={row.id} title={row.request_no} subtitle={`${row.side} · ${row.business_date}`} status={<span className="status-chip">{row.status}</span>} facts={[{ label: '金额', value: money(row.amount_cents) }, { label: '事由', value: row.reason }]}/>),
    notes: data.notes.map((row) => <RecordCard key={row.id} title={row.note_no} subtitle={`${row.direction} · 到期 ${row.due_date}`} status={<span className="status-chip">{row.status}</span>} facts={[{ label: '票面金额', value: money(row.face_amount_cents) }, { label: '承兑行', value: row.bank_name || '—' }]}/>),
    bank: [...data.statements.map((row) => <RecordCard key={`s:${row.id}`} title={row.statement_no} subtitle={`银行对账单 · ${row.statement_date}`} facts={[{ label: '期末余额', value: money(row.closing_balance_cents) }, { label: '流水数', value: row.total_count }]} />), ...data.reconciliations.map((row) => <RecordCard key={`r:${row.id}`} title="银行对账任务" subtitle={row.statement_id} status={<span className="status-chip">{row.status}</span>} />)],
    close: data.closes.map((row) => <RecordCard key={row.close_type} title={`${row.close_type} 业务关账`} subtitle={row.closed_through_date ? `已关至 ${row.closed_through_date}` : '尚未关账'} status={<span className="status-chip">{row.status}</span>} />),
  }[tab] || [];
  return <BusinessPageShell className="finance-hub finance-treasury-hub" width="rail">
    <BusinessPageHeader title="资金管理" context="结算账户、资金流水、票据、付款申请、银行对账与资金关账" secondaryActions={<BusinessAction onClick={load}>刷新</BusinessAction>}/>
    <section className="finance-hero finance-hero--treasury"><div><span>TREASURY CONTROL</span><h2>每一笔资金变动都可追溯</h2><p>余额是 canonical movement 的派生结果；审批不等于资金执行。</p></div><div className="finance-hero__metric"><strong>{money(totalBalance)}</strong><span>{data.accounts.length} 个结算账户</span></div></section>
    <SegmentedControl label="资金工作区" options={TREASURY_TABS} value={tab} onChange={setTab}/>
    {tab === 'bank' && !data.statements.length && <InlineAlert tone="info" title="尚无银行对账单">通过银行流水导入建立只读银行事实，再与资金流水匹配。</InlineAlert>}
    {loading ? <Skeleton lines={4}/> : body.length ? <RecordList className="finance-record-grid">{body}</RecordList> : <EmptyState title="当前工作区暂无记录" description="数据建立后会在此形成可追溯列表。"/>}
  </BusinessPageShell>;
}
