import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { can, Loading } from '../components/ui.jsx';
import { BusinessPageShell, EmptyState, InlineAlert, SegmentedControl, StatusChip } from '../components/design-system.jsx';
import { useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import '../styles/planning-workbench.css';

const qty = (value) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(Number(value || 0));
const ORDER_FILTERS = [{ value: '', label: '全部' }, { value: 'DRAFT', label: '草稿' }, { value: 'CONFIRMED', label: '已确认' }, { value: 'RELEASED', label: '已释放' }];
const ORDER_STATUS_LABELS = { DRAFT: '草稿', CONFIRMED: '已确认', RELEASED: '已释放', CLOSED: '已关闭', CANCELLED: '已取消' };
const SUPPLY_TYPE_LABELS = { MAKE: '生产', BUY: '采购', OUTSOURCE: '委外' };

export default function PlanningWorkbench({ user, notify }) {
  const { currentPage } = useAppNavigation();
  return currentPage === 'planned-orders'
    ? <PlannedOrders user={user} notify={notify}/>
    : <PlannerWorkbench notify={notify}/>;
}

function PlannedOrders({ user, notify }) {
  const canManage = can(user, 'MRP_MANAGE');
  const canRelease = can(user, 'PLANNED_ORDER_RELEASE');
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('');
  const [state, setState] = useState('LOADING');
  const [busyId, setBusyId] = useState(null);
  const load = async () => {
    setState('LOADING');
    try { const data = await api('/api/planning/planned-orders'); setRows(data.plannedOrders || []); setState('READY'); }
    catch (error) { setState('ERROR'); notify(error.message, 'error'); }
  };
  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => rows.filter((row) => !filter || row.status === filter), [rows, filter]);
  const act = async (row, action) => {
    setBusyId(row.id);
    try { await api(`/api/planning/planned-orders/${row.id}/${action}`, { method: 'POST' }); notify(action === 'confirm' ? '计划订单已确认' : '计划订单已释放'); await load(); }
    catch (error) { notify(error.message, 'error'); } finally { setBusyId(null); }
  };
  return <BusinessPageShell className="planning-closure" width="rail">
    <header className="planning-hero"><div><span>PLANNING CONTROL</span><h2>计划订单</h2></div><p>确认供给建议，再安全释放到生产、采购或委外交接。</p></header>
    <SegmentedControl label="计划订单状态" options={ORDER_FILTERS} value={filter} onChange={setFilter}/>
    {state === 'LOADING' && <Loading/>}
    {state === 'ERROR' && <EmptyState title="加载失败" action={<button className="secondary" onClick={() => void load()}>重新加载</button>}/>}
    {state === 'READY' && visible.length === 0 && <EmptyState title="暂无计划订单" description="完成 MRP 运算后，系统会形成可追溯的计划订单。"/>}
    <div className="planning-order-list">{visible.map((row) => <article className="planning-order" key={row.id}>
      <div className="planning-order__identity"><span className="mono">{row.order_no}</span><StatusChip status={row.status}>{ORDER_STATUS_LABELS[row.status] || '未知状态'}</StatusChip></div>
      <h3>{row.product_name}</h3><p className="mono planning-order__code">{row.product_code}</p>
      <dl><div><dt>供给类型</dt><dd>{SUPPLY_TYPE_LABELS[row.supply_type] || '未配置'}</dd></div><div><dt>计划数量</dt><dd>{qty(row.quantity)} {row.unit}</dd></div><div><dt>需求日期</dt><dd>{row.need_date || '—'}</dd></div><div><dt>剩余</dt><dd>{qty(row.remaining_quantity)} {row.unit}</dd></div></dl>
      <div className="planning-order__actions">{canManage && row.status === 'DRAFT' && <button className="secondary" disabled={busyId === row.id} onClick={() => void act(row, 'confirm')}>确认</button>}{canRelease && row.status === 'CONFIRMED' && <button className="primary" disabled={busyId === row.id} onClick={() => void act(row, 'release')}>释放供给</button>}</div>
    </article>)}</div>
  </BusinessPageShell>;
}

function PlannerWorkbench({ notify }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('LOADING');
  const [exception, setException] = useState('ALL');
  const load = async () => { setState('LOADING'); try { setData(await api('/api/planning/workbench')); setState('READY'); } catch (error) { setState('ERROR'); notify(error.message, 'error'); } };
  useEffect(() => { void load(); }, []);
  const rows = (data?.workbench?.rows || data?.rows || []).filter((row) => exception === 'ALL' || row.exception === exception);
  const shortages = (data?.workbench?.rows || data?.rows || []).filter((row) => row.exception === 'SHORTAGE').length;
  return <BusinessPageShell className="planning-closure" width="rail">
    <header className="planning-hero"><div><span>PLANNER WORKBENCH</span><h2>计划员工作台</h2></div><p>先看例外，再追踪需求、确定供给与计划余额。</p></header>
    {state === 'LOADING' && <Loading/>}
    {state === 'ERROR' && <EmptyState title="工作台加载失败" action={<button className="secondary" onClick={() => void load()}>重新加载</button>}/>}
    {state === 'READY' && <>
      <section className="planning-pulse"><div><span>物料</span><strong>{data?.workbench?.rows?.length || data?.rows?.length || 0}</strong></div><div className={shortages ? 'is-danger' : ''}><span>短缺例外</span><strong>{shortages}</strong></div><div><span>计划窗口</span><strong>{data?.workbench?.from || data?.from} → {data?.workbench?.to || data?.to}</strong></div></section>
      <SegmentedControl label="例外筛选" value={exception} onChange={setException} options={[{value:'ALL',label:'全部'},{value:'SHORTAGE',label:'短缺'},{value:'EXCESS',label:'超储'}]}/>
      {!rows.length && <InlineAlert tone="success">当前筛选没有计划例外。</InlineAlert>}
      <div className="planning-balance-list">{rows.map((row) => <article key={row.id} className={`planning-balance ${row.exception ? `is-${row.exception.toLowerCase()}` : ''}`}>
        <div><strong className="mono">{row.code}</strong><h3>{row.name}</h3></div><StatusChip status={row.exception || 'NORMAL'}>{row.exception === 'SHORTAGE' ? '短缺' : row.exception === 'EXCESS' ? '超储' : '正常'}</StatusChip>
        <dl><div><dt>现存量</dt><dd>{qty(row.onHand)}</dd></div><div><dt>需求</dt><dd>{qty(row.demand)}</dd></div><div><dt>确定供给</dt><dd>{qty(row.firmSupply)}</dd></div><div><dt>计划供给</dt><dd>{qty(row.plannedSupply)}</dd></div><div><dt>预计余额</dt><dd>{qty(row.projectedBalance)}</dd></div><div><dt>强预留</dt><dd>{qty(row.strongReserved)}</dd></div></dl>
      </article>)}</div>
    </>}
  </BusinessPageShell>;
}
