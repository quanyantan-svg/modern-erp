import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Active, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, can, dateTime, money, quantity } from '../components/ui.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import TrackingAllocationEditor from '../components/TrackingAllocationEditor.jsx';
import { copySourceAllocations } from '../lib/tracking.js';
import { presentBusinessValue } from '../lib/presentation.js';
import { BusinessAction, BusinessPageHeader, BusinessPageShell, BusinessActionBar, CompactRecordList, RecordCard, HelpDisclosure } from '../components/design-system.jsx';
import { BomApprovalBadge, BomAnalysisActions, BomBatchMaintenance, BomLifecycleActions, BomTree } from '../components/BomGovernancePanel.jsx';

const ISSUE_STATUS_LABELS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const RECEIPT_STATUS_LABELS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const PO_STATUS_LABELS = { PENDING: '待生产', IN_PROGRESS: '生产中', COMPLETED: '已完成', CANCELLED: '已取消' };

// Material List lifecycle vocabulary (Requirement §29.8 A.2).
const MATERIAL_LIST_STATUS_LABELS = {
  GENERATED: '已生成',
  CONTROLLED_EDIT: '受控编辑中',
  APPROVED: '已审核',
  RELEASED: '已下达',
};

// Operation Plan lifecycle vocabulary.
const PLAN_STATUS_LABELS = {
  NOT_STARTED: '未提交',
  SUBMITTED: '已提交',
  APPROVED: '已审核',
  RELEASED: '已下达',
  EXECUTABLE: '可执行',
};

const OPERATION_STATUS_LABELS = {
  NOT_STARTED: '未开始',
  SUBMITTED: '已提交',
  APPROVED: '已审核',
  RELEASED: '已下达',
  IN_PROGRESS: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  SKIPPED: '已跳过',
  OUTSOURCED: '已委外交接',
};

const TOPOLOGY_LABELS = {
  LINEAR: '线性',
  NETWORK: '网络',
  PARALLEL: '并行',
  SPLIT: '拆分',
  MERGE: '合并',
  ALTERNATE: '可选替代',
};

const RECEIPT_QUALITY_LABELS = {
  PENDING: '待检',
  PASSED: '检验合格',
  FAILED: '检验不合格',
  WAIVED: '已放行',
  BLOCKED: '质量门禁拦截',
  NONE: '未触发',
};

const SUPPLEMENT_REASON_OPTIONS = [
  { value: 'SHORTAGE', label: '缺料' },
  { value: 'YIELD_LOSS', label: '良率损耗' },
  { value: 'QUALITY_REPLACEMENT', label: '质量换料' },
  { value: 'OTHER', label: '其他' },
];

const RETURN_REASON_OPTIONS = [
  { value: 'MATERIAL_DEFECT', label: '材料不良' },
  { value: 'GOOD_RETURN', label: '良品退回' },
  { value: 'PROCESS_DEFECT', label: '制程不良' },
  { value: 'OTHER', label: '其他' },
];

const SCHEDULE_DIRECTION_OPTIONS = [
  { value: 'FORWARD', label: '正排（自计划开工顺排）' },
  { value: 'BACKWARD', label: '倒排（自计划完工逆排）' },
];

const statusLabel = (labels, key, fallback) => labels[key] || fallback || key || '—';

Object.assign(PO_STATUS_LABELS, {
  DRAFT: '\u8349\u7a3f',
  SUBMITTED: '\u5df2\u63d0\u4ea4',
  APPROVED: '\u5df2\u5ba1\u6838',
  REJECTED: '\u5df2\u9a73\u56de',
  RELEASED: '\u5df2\u4e0b\u8fbe',
});

export function Boms({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState(null);
  const [detail, setDetail] = useState(null);
  const [products, setProducts] = useState([]);
  const [filterProduct, setFilterProduct] = useState('');
  const [tab, setTab] = useState('list');
  const canManageBom = can(user, 'ENGINEERING_BOM_MANAGE');
  const canApproveBom = can(user, 'ENGINEERING_BOM_APPROVE');
  const load = () => api('/api/engineering/boms?product=' + filterProduct)
    .then((r) => setItems(r.boms || []))
    .catch((e) => notify(e.message, 'error'));
  useEffect(() => {
    api('/api/products').then((r) => setProducts(r.products)).catch((e) => notify(e.message, 'error'));
    void load();
  }, [filterProduct]);
  const filtered = items.filter((b) => !search || [b.product_code, b.version, b.purpose, b.approval_status, b.creator_name].join('|').toLowerCase().includes(search.toLowerCase()));
  return <BusinessPageShell className="boms-v15" width="rail">
    <BusinessPageHeader title="BOM"
      primaryAction={canManageBom && <BusinessAction hierarchy="primary" onClick={() => setView({})}>新建 BOM</BusinessAction>}
      help={<HelpDisclosure summary="生命周期与权限说明"><p>使用 ENGINEERING_BOM_MANAGE 维护；使用 ENGINEERING_BOM_APPROVE 审核。审核通过 + 启用 的 BOM 才会被生产 / 计划引用。</p></HelpDisclosure>} />
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索 BOM"
      extra={<select aria-label="产品筛选" value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)}>
        <option value="">全部产品</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
      </select>} />
    <nav className="boms-tabs" aria-label="BOM 子模块">
      <button type="button" className={`boms-tab${tab === 'list' ? ' is-active' : ''}`} onClick={() => setTab('list')}>BOM 列表</button>
      <button type="button" className={`boms-tab${tab === 'tree' ? ' is-active' : ''}`} onClick={() => setTab('tree')}>多层结构</button>
      <button type="button" className={`boms-tab${tab === 'batch' ? ' is-active' : ''}`} onClick={() => setTab('batch')}>批量维护</button>
    </nav>
    {tab === 'list' && (
      <CompactRecordList>
        {filtered.map((b) => (
          <RecordCard key={b.id}
            title={`${b.product_code} · ${b.version}`}
            subtitle={`用途 ${b.purpose || 'GENERAL'} · 物料 ${b.item_count}`}
            status={<BomApprovalBadge bom={b} />}
            facts={[
              { label: '生效', value: b.effective_from || '永久' },
              { label: '失效', value: b.effective_to || '永久' },
              { label: '审核', value: b.approver_name || '—' },
              { label: '创建', value: b.creator_name || '—' },
            ]}
            onClick={() => setDetail(b)} />
        ))}
        {!filtered.length && <Empty text="没有BOM记录" />}
      </CompactRecordList>
    )}
    {tab === 'tree' && (
      <BomTree bomId={detail?.id || filtered[0]?.id} notify={notify} />
    )}
    {tab === 'batch' && (
      <BomBatchMaintenance boms={filtered} canManage={canManageBom}
        notify={notify} onChanged={load} />
    )}
    {detail && <BomDetailModal detail={detail} boms={filtered} onClose={() => setDetail(null)} onEdit={() => { setView({ id: detail.id }); setDetail(null); }}
      notify={notify} canManage={canManageBom} canApprove={canApproveBom} onChanged={load} />}
    {view && <BomModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api} products={products}/>}
  </BusinessPageShell>;
}

function BomDetailModal({ detail, boms, onClose, onEdit, notify, canManage, canApprove, onChanged }) {
  const [analysisResult, setAnalysisResult] = useState(null);
  return <Modal title={`${detail.product_code} · ${detail.version}`} onClose={onClose} wide>
    <dl className="record-card-meta">
      <div><dt>用途</dt><dd>{detail.purpose || 'GENERAL'}</dd></div>
      <div><dt>状态</dt><dd>{detail.status === 'ACTIVE' ? '启用' : '停用'}</dd></div>
      <div><dt>审核</dt><dd>{detail.approval_status || '—'}</dd></div>
      <div><dt>生效</dt><dd>{detail.effective_from || '永久'}</dd></div>
      <div><dt>失效</dt><dd>{detail.effective_to || '永久'}</dd></div>
      <div><dt>备注</dt><dd>{detail.remark || '—'}</dd></div>
    </dl>
    <BomAnalysisActions bomId={detail.id} productId={detail.product_id} boms={boms} onResult={setAnalysisResult} notify={notify} />
    <BomLifecycleActions bom={detail} onChanged={() => { onChanged?.(); onClose(); }} notify={notify} canManage={canManage} canApprove={canApprove} />
    {analysisResult && (
      <section className="bom-analysis-result">
        <header><strong>分析结果</strong></header>
        {analysisResult.lines && <ul>{analysisResult.lines.map((line) => <li key={line.product_id}>{line.product_code} · 用量 {line.quantity} · 损耗 {line.scrap_rate} · 材料成本 {line.line_material_cost_cents}</li>)}</ul>}
        {analysisResult.total_material_cost_cents !== undefined && <p>材料成本合计：{analysisResult.total_material_cost_cents} 分</p>}
        {analysisResult.usages && <ul>{analysisResult.usages.map((u) => <li key={u.parent_bom_id}>{u.parent_product_code} v{u.version} · {u.purpose} · {u.approval_status}</li>)}</ul>}
        {analysisResult.items && <ul>{analysisResult.items.map((it) => <li key={it.product_id}>{it.product_code} · {it.quantity}</li>)}</ul>}
        {analysisResult.diff && <ul>{analysisResult.diff.map((it) => <li key={it.product_id}>{it.product_id} · {it.status}</li>)}</ul>}
      </section>
    )}
    <BusinessActionBar>
      <button type="button" className="secondary" onClick={onClose}>关闭</button>
      {canManage && detail.status === 'ACTIVE' && detail.approval_status === 'DRAFT' && <button type="button" className="primary" onClick={onEdit}>编辑草稿</button>}
    </BusinessActionBar>
  </Modal>;
}

function BomModal({ user, value, onClose, notify, api, products }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [form, setForm] = useState({ productId: '', version: '1.0', purpose: 'GENERAL', effectiveFrom: '', effectiveTo: '', approvalStatus: 'DRAFT', remark: '', items: [] });
  useEffect(() => {
    if (value.id) api('/api/engineering/boms/' + value.id).then((r) => setDetail(r.bom)).catch((e) => notify(e.message, 'error'));
  }, []);
  useEffect(() => {
    if (value.id && detail && !form.productId) {
      setForm({ productId: detail.product_id || '', version: detail.version || '1.0', purpose: detail.purpose || 'GENERAL', effectiveFrom: detail.effective_from || '', effectiveTo: detail.effective_to || '', approvalStatus: detail.approval_status || 'DRAFT', remark: detail.remark || '', items: (detail.items || []).map((item) => ({ ...item, productId: item.product_id, scrapRate: item.scrap_rate })) });
    }
  }, [detail]);
  const setItems = (items) => setForm((f) => ({ ...f, items }));
  const save = async () => {
    try {
      if (value.id) {
        await api('/api/engineering/boms/' + value.id, { method: 'PATCH', body: form });
        notify('BOM 更改已保存');
      } else {
        await api('/api/engineering/boms', { method: 'POST', body: form });
        notify('BOM 已创建');
      }
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  const addItem = () => setItems([...form.items, { productId: '', quantity: 1, scrapRate: 0 }]);
  const updateItem = (i, field, val) => setItems(form.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  const removeItem = (i) => setItems(form.items.filter((_, idx) => idx !== i));
  const usedProducts = products.filter((p) => p.id !== form.productId);
  return <Modal title={value.id ? 'BOM详情' : '新建BOM'} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    {!value.id && <label>产品<select value={form.productId} onChange={(e) => setForm({...form, productId: e.target.value})} required><option value="">选择产品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></label>}
    <label>版本号<input value={form.version} onChange={(e) => setForm({...form, version: e.target.value})} required/></label>
    <label>用途<select value={form.purpose} onChange={(e) => setForm({...form, purpose: e.target.value})}><option value="GENERAL">通用</option><option value="SELF_MAKE">自制</option><option value="OUTSOURCE">委外</option></select></label>
    <label>审核状态<span>{form.approvalStatus === 'DRAFT' ? '草稿' : form.approvalStatus}</span></label>
    <label>生效日期<input type="date" value={form.effectiveFrom} onChange={(e) => setForm({...form, effectiveFrom: e.target.value})}/></label>
    <label>失效日期<input type="date" value={form.effectiveTo} onChange={(e) => setForm({...form, effectiveTo: e.target.value})}/></label>
    <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
    <div className="full"><div className="form-section-head"><span>物料组成</span><button type="button" className="secondary" onClick={addItem} disabled={detail?.status === 'DISCONTINUED'}>＋ 增行</button></div>
      <table className="line-table"><thead><tr><th>物料</th><th className="number">用量</th><th className="number">损耗率</th><th/></tr></thead><tbody>
        {form.items.map((item, i) => <tr key={i}>
          <td><select value={item.productId || item.product_id || ''} onChange={(e) => updateItem(i, 'productId', e.target.value)} required disabled={detail?.status === 'DISCONTINUED'}><option value="">选择物料</option>{usedProducts.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></td>
          <td><input type="number" value={item.quantity} min="0.001" step="0.001" onChange={(e) => updateItem(i, 'quantity', Number(e.target.value))} required disabled={detail?.status === 'DISCONTINUED'}/></td>
          <td><input type="number" value={item.scrapRate ?? item.scrap_rate ?? 0} min="0" max="1" step="0.01" onChange={(e) => updateItem(i, 'scrapRate', Number(e.target.value))} disabled={detail?.status === 'DISCONTINUED'}/></td>
          <td><button type="button" className="danger-text" onClick={() => removeItem(i)} disabled={detail?.status === 'DISCONTINUED'}>x</button></td>
        </tr>)}
      </tbody></table>
    </div>
    <FormActions onClose={onClose}/>
  </form></Modal>;
}

// ============ Production Orders ============

// ============ M6 Workflow helpers ============

function ProductionWorkflowTrace({ detail, materialIssues, productionReceipts }) {
  // Material Issue / Receipt are derived purely from confirmed documents
  // (DRAFT / CANCELLED are not stock-affecting).
  const bomReady = Boolean(detail?.bomId);
  const orderCreated = Boolean(detail?.id);
  const orderStarted = ['IN_PROGRESS', 'COMPLETED'].includes(detail?.status);
  const orderCompleted = detail?.status === 'COMPLETED';
  const issuedCount = materialIssues.filter((mi) => mi.status === 'CONFIRMED').length;
  const receivedCount = productionReceipts.filter((pr) => pr.status === 'CONFIRMED').length;
  const stages = [
    { key: 'master', label: 'BOM / 制品工序标准', state: bomReady || detail?.activeRoutingId ? 'completed' : 'optional', hint: [bomReady ? `BOM v${detail.bomVersion}` : '', detail?.activeRoutingCode ? `工序 ${detail.activeRoutingCode}` : ''].filter(Boolean).join(' · ') || '均可独立维护', documentType: null },
    { key: 'order', label: '制令单', state: orderCreated ? 'completed' : 'pending', hint: detail?.order_no, documentType: null },
    { key: 'start', label: '已开工', state: orderStarted ? 'completed' : 'pending', hint: orderStarted ? (detail?.actual_start || '') : '待开工', documentType: null },
    { key: 'issue', label: '用料出库', state: issuedCount ? 'completed' : orderStarted ? 'current' : 'pending', hint: issuedCount ? `已出库 ${issuedCount} 单` : '待出库', documentType: 'materialIssue', pageKey: 'material-issues' },
    { key: 'receipt', label: '生产入库', state: receivedCount ? 'completed' : 'pending', hint: receivedCount ? `已入库 ${receivedCount} 单` : '待入库', documentType: 'productionReceipt', pageKey: 'production-receipts' },
    { key: 'complete', label: '已完工', state: orderCompleted ? 'completed' : 'pending', hint: orderCompleted ? (detail?.actual_finish || '') : '待完工', documentType: null },
  ];
  return <div className="workflow-trace" data-testid="production-workflow-trace">
    <ol>
      {stages.map((stage) => <li key={stage.key} className={`workflow-stage workflow-stage--${stage.state}`}>
        <span className="workflow-stage__dot" aria-hidden="true">{stage.state === 'completed' ? '✓' : stage.state === 'current' ? '●' : '○'}</span>
        <div className="workflow-stage__body">
          <strong>{stage.label}</strong>
          <small>{stage.hint || '—'}</small>
          {stage.documentType && stage.pageKey && (issuedCount || receivedCount) ? <small className="workflow-stage__link">
            {stage.key === 'issue' ? materialIssues.filter((mi) => mi.status === 'CONFIRMED').map((mi) => <AppLink key={mi.id} page={stage.pageKey} documentId={mi.id} documentType={stage.documentType} className="link-button">{mi.issueNo}</AppLink>)
              : productionReceipts.filter((pr) => pr.status === 'CONFIRMED').map((pr) => <AppLink key={pr.id} page={stage.pageKey} documentId={pr.id} documentType={stage.documentType} className="link-button">{pr.receiptNo}</AppLink>)}
          </small> : null}
        </div>
      </li>)}
    </ol>
  </div>;
}

function LinkedDocuments({ materialIssues, productionReceipts }) {
  const issued = materialIssues.filter((mi) => mi.status === 'CONFIRMED');
  const received = productionReceipts.filter((pr) => pr.status === 'CONFIRMED');
  if (!issued.length && !received.length) return null;
  return <div className="related-block" data-testid="production-related-documents">
    <div className="form-section-head">关联单据</div>
    <div className="related-grid">
      <div>
        <strong>用料出库（{issued.length}）</strong>
        {issued.map((mi) => <div key={mi.id} className="related-row">
          <AppLink page="material-issues" documentId={mi.id} documentType="materialIssue" className="link-button">{mi.issueNo}</AppLink>
          <span className="dim">{dateTime(mi.confirmedAt || mi.createdAt)}</span>
        </div>)}
      </div>
      <div>
        <strong>生产入库（{received.length}）</strong>
        {received.map((pr) => <div key={pr.id} className="related-row">
          <AppLink page="production-receipts" documentId={pr.id} documentType="productionReceipt" className="link-button">{pr.receiptNo}</AppLink>
          <span className="dim">{dateTime(pr.confirmedAt || pr.createdAt)}</span>
        </div>)}
      </div>
    </div>
  </div>;
}

// ============ Production Orders Page ============

export function ProductionOrders({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const { target, navigateToPage } = useAppNavigation();
  const load = () => api('/api/production-orders?search=' + encodeURIComponent(search) + '&status=' + status).then((r) => setItems(r.orders)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  useEffect(() => {
    if (target?.page === 'production-orders' && target.documentId) {
      setView({ id: target.documentId });
    } else setView(null);
  }, [target?.page, target?.documentId]);
  return <BusinessPageShell className="production-orders-v15" width="rail">
    <BusinessPageHeader title="制令单" primaryAction={can(user, 'PRODUCTION_ORDERS_CREATE') && <BusinessAction hierarchy="primary" onClick={() => setView({})}>新建制令单</BusinessAction>} help={<HelpDisclosure summary="生产说明"><p>制令单承接已下达生产指令，开工后冻结 BOM、工序与成本快照。</p></HelpDisclosure>}/>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索工单号或产品" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="PENDING">待生产</option><option value="IN_PROGRESS">生产中</option><option value="COMPLETED">已完成</option><option value="CANCELLED">已取消</option></select>}/>
    <div className="table-wrap"><table><thead><tr><th>工单号</th><th>产品</th><th className="number">数量</th><th>计划开始</th><th>状态</th><th>完工</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id} onClick={() => { setView({ id: item.id }); navigateToPage('production-orders', { documentId: item.id }); }} style={{cursor:'pointer'}}><td className="mono">{item.order_no}</td><td>{item.productName}</td><td className="number">{quantity(item.quantity)}</td><td>{item.planned_start || '-'}</td><td><Status status={item.status?.toLowerCase()} label={PO_STATUS_LABELS[item.status] || item.statusLabel}/></td><td className="number">{quantity(item.totalOutput)}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有制令单"/>}</div>
    {view && <ProductionOrderModal user={user} value={view} onClose={() => { setView(null); navigateToPage('production-orders', null, { replace: true }); void load(); }} notify={notify} api={api}/>}
  </BusinessPageShell>;
}

// ============ Execution hub sections (Requirement §29.8 A.2) ============
// Each section renders REAL server data, exposes a single primary action and
// keeps its own modal drafts so the execution hub stays scrollable on mobile.

function HubSection({ id, title, subtitle, actions, badge, children, open: initiallyOpen = true }) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  return <section className="mq-hub-section" data-testid={`mq-section-${id}`}>
    <header className="mq-hub-section__head">
      <button type="button" className="mq-hub-section__toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        <span className="mq-hub-section__title">{title}</span>
        {subtitle && <small>{subtitle}</small>}
      </button>
      {badge && <span className="mq-hub-section__badge">{badge}</span>}
      {actions && <div className="mq-hub-section__actions" onClick={(event) => event.stopPropagation()}>{actions}</div>}
    </header>
    {expanded && <div className="mq-hub-section__body">{children}</div>}
  </section>;
}

function MaterialListSection({ user, detail, lines, setLines, dirty, onEdit, onApprove, onRelease, notify, api, orderId }) {
  const materialListStatus = detail?.materialListStatus || 'GENERATED';
  const canEdit = can(user, 'PRODUCTION_ORDERS_CREATE');
  const canApprove = can(user, 'PRODUCTION_PLAN_MANAGE');
  const editable = canEdit && ['GENERATED', 'CONTROLLED_EDIT'].includes(materialListStatus) && !['RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(detail?.status);
  return <HubSection id="material" title="用料清单" subtitle="受控编辑 · 审核 · 下达"
    badge={<Status status={materialListStatus.toLowerCase()} label={statusLabel(MATERIAL_LIST_STATUS_LABELS, materialListStatus)}/>}
    actions={<>
      {editable && <BusinessAction hierarchy="secondary" onClick={onEdit}>{dirty ? '提交编辑' : '受控编辑'}</BusinessAction>}
      {canApprove && materialListStatus === 'CONTROLLED_EDIT' && <BusinessAction hierarchy="primary" onClick={onApprove}>审核</BusinessAction>}
      {canApprove && materialListStatus === 'APPROVED' && <BusinessAction hierarchy="primary" onClick={onRelease}>下达</BusinessAction>}
    </>}>
    <CompactRecordList>
      {(detail?.items || []).map((item) => (
        <RecordCard key={item.id}
          title={item.productName || item.productCode || item.id}
          subtitle={`${item.productCode || ''} ${item.unit ? `· ${item.unit}` : ''}`}
          status={<Status status={(item.materialListStatus || materialListStatus).toLowerCase()} label={statusLabel(MATERIAL_LIST_STATUS_LABELS, item.materialListStatus || materialListStatus)}/>}
          facts={[
            { label: '需求数量', value: quantity(item.requiredQuantity ?? item.quantity) },
            { label: '单位用量', value: quantity(item.quantityPerUnit ?? item.quantity_per_unit ?? 0) },
            { label: '损耗率', value: item.scrapRate ?? item.scrap_rate_snapshot ?? item.scrap_rate ?? 0 },
            { label: '已净领', value: quantity(item.netIssued || 0) },
            { label: '剩余领料', value: quantity(item.remainingQuantity ?? item.quantity) },
            { label: '备注', value: item.remark || item.material_list_remark || '—' },
          ]}
          className="mq-hub-record">
          {editable && <div className="mq-line-edit">
            <label>损耗率<input type="number" min="0" max="0.99" step="0.01" value={item.scrapRate ?? item.scrap_rate_snapshot ?? 0} onChange={(event) => setLines(lines.map((line) => line.id === item.id ? { ...line, scrapRate: Number(event.target.value) } : line))}/></label>
            <label>备注<input value={item.remark ?? item.material_list_remark ?? ''} onChange={(event) => setLines(lines.map((line) => line.id === item.id ? { ...line, remark: event.target.value } : line))}/></label>
          </div>}
        </RecordCard>
      ))}
    </CompactRecordList>
    {!detail?.items?.length && <Empty text="该制令单暂无用料清单行"/>}
  </HubSection>;
}

function OperationPlanSection({ user, operations, loading, onSubmit, onApprove, onRelease, onSchedule, onOutsource, notify }) {
  const canPlan = can(user, 'PRODUCTION_PLAN_MANAGE');
  const canComplete = can(user, 'PRODUCTION_ORDERS_COMPLETE');
  const planStatus = operations?.[0]?.plan_status || operations?.[0]?.planStatus || 'NOT_STARTED';
  return <HubSection id="operations" title="工序计划" subtitle="提交 · 审核 · 下达 · 排程 · 委外交接"
    badge={<Status status={String(planStatus).toLowerCase()} label={statusLabel(PLAN_STATUS_LABELS, planStatus)}/>}
    actions={<>
      {canPlan && <BusinessAction hierarchy="secondary" onClick={onSubmit}>提交</BusinessAction>}
      {canPlan && <BusinessAction hierarchy="secondary" onClick={onApprove}>审核</BusinessAction>}
      {canPlan && <BusinessAction hierarchy="primary" onClick={onRelease}>下达</BusinessAction>}
      {canPlan && <BusinessAction hierarchy="secondary" onClick={onSchedule}>排程</BusinessAction>}
    </>}>
    {loading && <Loading/>}
    {!loading && <CompactRecordList>
      {(operations || []).map((op) => {
        const status = op.status || op.executionStatus || 'NOT_STARTED';
        const outsource = Number(op.is_outsource ?? op.isOutsource ?? 0) === 1;
        return <RecordCard key={op.id}
          title={`${op.sequence_no ?? op.sequenceNo ?? '?'} · ${op.operation_name || op.operationName || op.operation_code || op.operationCode || '工序'}`}
          subtitle={`${op.operation_code || op.operationCode || ''} ${op.work_center_name || op.workCenterName ? `· ${op.work_center_name || op.workCenterName}` : ''}`}
          status={<Status status={String(status).toLowerCase()} label={statusLabel(OPERATION_STATUS_LABELS, status)}/>}
          facts={[
            { label: '计划状态', value: statusLabel(PLAN_STATUS_LABELS, op.plan_status || op.planStatus) },
            { label: '工作中心', value: op.work_center_name || op.workCenterName || '—' },
            { label: '拓扑', value: statusLabel(TOPOLOGY_LABELS, op.topology || 'LINEAR') },
            { label: '良品 / 报废', value: `${quantity(op.good)} / ${quantity(op.scrap)}` },
            { label: '已下达', value: op.released ? '是' : '否' },
            { label: '委外', value: outsource ? '是' : '否' },
          ]}
          className="mq-hub-record">
          {outsource && canComplete && <div className="mq-hub-record__actions">
            <BusinessAction hierarchy="secondary" onClick={() => onOutsource(op)}>委外交接</BusinessAction>
          </div>}
        </RecordCard>;
      })}
    </CompactRecordList>}
    {!loading && !(operations || []).length && <Empty text="该制令单尚未生成工序计划"/>}
  </HubSection>;
}

function QualitySection({ inspections, receipts, loading }) {
  const receiptStates = (receipts || []).map((receipt) => receipt.quality_state || receipt.qualityState || 'NONE');
  return <HubSection id="quality" title="质量" subtitle="待检工作台与收货质量门禁"
    badge={<Status status={(receiptStates.includes('BLOCKED') ? 'blocked' : receiptStates.includes('PENDING') ? 'pending' : 'approved').toLowerCase()} label={receiptStates.includes('BLOCKED') ? '质量门禁拦截' : receiptStates.includes('PENDING') ? '存在待检' : '质量状态正常'}/>}>
    {loading && <Loading/>}
    {!loading && <CompactRecordList>
      {(inspections || []).map((inspection) => (
        <RecordCard key={inspection.id}
          title={inspection.code || `检验 ${inspection.id}`}
          subtitle={`${inspection.productionOrderNo || ''} · ${inspection.source_type === 'PRODUCTION_RECEIPT' ? '生产入库检验' : '工序检验'}`}
          status={<Status status={String(inspection.result || inspection.status || 'DRAFT').toLowerCase()} label={inspection.result || statusLabel({ DRAFT: '待判定', COMPLETED: '已判定', CANCELLED: '已取消' }, inspection.status, inspection.status)}/>}
          facts={[
            { label: '业务日期', value: inspection.business_date || inspection.businessDate || '—' },
            { label: '检验类型', value: inspection.inspection_type || inspection.inspectionType || 'NORMAL' },
            { label: '来源单据', value: inspection.source_id || inspection.sourceId || '—' },
          ]}
          actions={<AppLink page="production-quality" documentId={inspection.id} className="link-button">判定</AppLink>}>
        </RecordCard>
      ))}
    </CompactRecordList>}
    {!loading && !(inspections || []).length && <Empty text="该制令单暂无待检任务"/>}
    <div className="form-section-head">收货质量状态</div>
    <CompactRecordList>
      {(receipts || []).map((receipt) => {
        const state = receipt.quality_state || receipt.qualityState || 'NONE';
        return <RecordCard key={receipt.id}
          title={receipt.receiptNo || receipt.receipt_no || `入库 ${receipt.id}`}
          subtitle={`数量 ${quantity(receipt.quantity)}`}
          status={<Status status={String(state).toLowerCase()} label={statusLabel(RECEIPT_QUALITY_LABELS, state)}/>}
          facts={[
            { label: '不合格', value: receipt.nonconforming ? '是' : '否' },
            { label: '入库日期', value: receipt.receiptDate || receipt.receipt_date || '—' },
          ]}/>;
      })}
    </CompactRecordList>
    {!(receipts || []).length && <Empty text="该制令单暂无生产入库记录"/>}
  </HubSection>;
}

function ByproductSection({ user, byproducts, products, loading, onCreate }) {
  const canManage = can(user, 'PRODUCTION_BYPART_MANAGE');
  return <HubSection id="byproduct" title="副产品" subtitle="副产品登记与数量维护"
    badge={<Status status={byproducts?.length ? 'approved' : 'draft'} label={byproducts?.length ? `${byproducts.length} 项` : '暂无'}/>}
    actions={canManage ? <BusinessAction hierarchy="primary" onClick={onCreate}>新建副产品</BusinessAction> : null}>
    {loading && <Loading/>}
    {!loading && <CompactRecordList>
      {(byproducts || []).map((byproduct) => (
        <RecordCard key={byproduct.id}
          title={byproduct.productName || byproduct.product_code || byproduct.productCode || `副产品 ${byproduct.id}`}
          subtitle={byproduct.productCode || byproduct.product_code || ''}
          facts={[
            { label: '计划数量', value: quantity(byproduct.plannedQuantity ?? byproduct.planned_quantity ?? 0) },
            { label: '备注', value: byproduct.remark || '—' },
          ]}/>
      ))}
    </CompactRecordList>}
    {!loading && !(byproducts || []).length && <Empty text="该制令单暂无副产品记录"/>}
  </HubSection>;
}

function MaterialExecutionSection({ user, detail, materialIssues, warehouses, onSupplement, onReturn, onBatchIssue, onOpenIssue }) {
  const canSupplement = can(user, 'PRODUCTION_SUPPLEMENT_MANAGE');
  const canReturn = can(user, 'PRODUCTION_RETURN_MANAGE');
  const canBatch = can(user, 'PRODUCTION_BATCH_ISSUE_MANAGE');
  const confirmedIssues = (materialIssues || []).filter((issue) => issue.status === 'CONFIRMED');
  return <HubSection id="material-execution" title="补料 / 退料 / 合并领料" subtitle="用料执行入口"
    badge={<Status status={confirmedIssues.length ? 'approved' : 'draft'} label={confirmedIssues.length ? `已出库 ${confirmedIssues.length} 单` : '暂无出库'}/>}
    actions={<>
      {canSupplement && <BusinessAction hierarchy="secondary" onClick={onSupplement}>补料</BusinessAction>}
      {canReturn && <BusinessAction hierarchy="secondary" onClick={onReturn}>退料</BusinessAction>}
      {canBatch && <BusinessAction hierarchy="primary" onClick={onBatchIssue}>合并领料</BusinessAction>}
    </>}>
    <CompactRecordList>
      {(materialIssues || []).map((issue) => (
        <RecordCard key={issue.id}
          title={issue.issueNo || issue.issue_no || `出库 ${issue.id}`}
          subtitle={`${issue.warehouseName || issue.warehouse_name || ''} ${issue.issueDate || issue.issue_date ? `· ${issue.issueDate || issue.issue_date}` : ''}`}
          status={<Status status={String(issue.status || 'DRAFT').toLowerCase()} label={statusLabel(ISSUE_STATUS_LABELS, issue.status)}/>}
          facts={[{ label: '物料项', value: issue.itemCount ?? issue.item_count ?? '—' }]}
          actions={<button type="button" className="secondary" onClick={() => onOpenIssue?.(issue)}>查看</button>}/>
      ))}
    </CompactRecordList>
    {!(materialIssues || []).length && <Empty text="该制令单暂无用料出库单"/>}
  </HubSection>;
}

function ProductionOrderModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [products, setProducts] = useState([]);
  const [boms, setBoms] = useState([]);
  const [materialIssues, setMaterialIssues] = useState([]);
  const [productionReceipts, setProductionReceipts] = useState([]);
  const [execution, setExecution] = useState(null);
  const [report, setReport] = useState({ operationId: '', goodQuantity: 0, scrapQuantity: 0, laborSeconds: '', machineSeconds: '', scrapReason: '', remark: '' });
  const [form, setForm] = useState({ productId: '', bomId: '', quantity: 1, plannedStart: '', plannedFinish: '', remark: '' });
  // --- Execution hub state (Requirement §29.8 A.2) ---
  const [operations, setOperations] = useState([]);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [inspections, setInspections] = useState([]);
  const [inspectionsLoading, setInspectionsLoading] = useState(false);
  const [byproducts, setByproducts] = useState([]);
  const [byproductsLoading, setByproductsLoading] = useState(false);
  const [warehouses, setWarehouses] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [materialLines, setMaterialLines] = useState([]);
  const [materialDirty, setMaterialDirty] = useState(false);
  const [outsourceDraft, setOutsourceDraft] = useState(null);
  const [scheduleDraft, setScheduleDraft] = useState(null);
  const [supplementDraft, setSupplementDraft] = useState(null);
  const [returnDraft, setReturnDraft] = useState(null);
  const [batchDraft, setBatchDraft] = useState(null);
  const [byproductDraft, setByproductDraft] = useState(null);
  const [issueDetail, setIssueDetail] = useState(null);
  const refreshDetail = () => {
    if (!value.id) return;
    api('/api/production-orders/' + value.id).then((r) => setDetail(r.order)).catch((e) => notify(e.message, 'error'));
    api(`/api/production-material-issues?status=&search=&page=1`).then((r) => setMaterialIssues((r.materialIssues || []).filter((mi) => String(mi.productionOrderId ?? mi.production_order_id ?? '') === String(value.id)))).catch(() => setMaterialIssues([]));
    api(`/api/production-receipts?status=`).then((r) => setProductionReceipts((r.productionReceipts || []).filter((pr) => String(pr.productionOrderId ?? pr.production_order_id ?? '') === String(value.id)))).catch(() => setProductionReceipts([]));
    api(`/api/manufacturing/orders/${value.id}/execution`).then((r) => setExecution(r)).catch(() => setExecution(null));
    loadOperations();
    loadInspections();
    loadByproducts();
  };
  const loadOperations = () => {
    if (!value.id) return;
    setOperationsLoading(true);
    api(`/api/production-orders/${value.id}/operations`)
      .then((r) => setOperations(r.operations || []))
      .catch(() => setOperations([]))
      .finally(() => setOperationsLoading(false));
  };
  const loadInspections = () => {
    if (!value.id) return;
    setInspectionsLoading(true);
    // The order-scoped list is authoritative; the receipt-sourced list is a
    // second view of the same worklist and is merged (deduplicated by id).
    const requests = [
      api(`/api/production-inspections?productionOrderId=${value.id}`).catch(() => ({ inspections: [] })),
      api(`/api/production-inspections?sourceType=PRODUCTION_RECEIPT`).catch(() => ({ inspections: [] })),
    ];
    Promise.all(requests)
      .then(([scoped, receiptSourced]) => {
        const merged = new Map();
        for (const entry of scoped.inspections || []) {
          if (String(entry.production_order_id ?? entry.productionOrderId ?? '') === String(value.id)) merged.set(entry.id, entry);
        }
        for (const entry of receiptSourced.inspections || []) {
          if (String(entry.production_order_id ?? entry.productionOrderId ?? '') === String(value.id)) merged.set(entry.id, entry);
        }
        setInspections([...merged.values()]);
      })
      .catch(() => setInspections([]))
      .finally(() => setInspectionsLoading(false));
  };
  const loadByproducts = () => {
    if (!value.id) return;
    setByproductsLoading(true);
    api(`/api/production-byproducts?orderId=${value.id}`)
      .then((r) => setByproducts(r.byproducts || []))
      .catch(() => setByproducts((detail?.byproducts) || []))
      .finally(() => setByproductsLoading(false));
  };
  useEffect(() => {
    api('/api/products').then((r) => setProducts(r.products)).catch((e) => notify(e.message, 'error'));
    api('/api/warehouses').then((r) => setWarehouses(r.warehouses || [])).catch(() => setWarehouses([]));
    api('/api/suppliers').then((r) => setSuppliers((r.suppliers || []).filter((s) => s.active !== false))).catch(() => setSuppliers([]));
    if (value.id) refreshDetail();
  }, []);
  useEffect(() => {
    if (form.productId) api('/api/boms?product=' + form.productId).then((r) => setBoms(r.boms.filter((b) => b.status === 'ACTIVE'))).catch(() => setBoms([]));
    else setBoms([]);
  }, [form.productId]);
  useEffect(() => {
    if (value.id && detail && !form.productId) {
      setForm({ productId: detail.product_id || '', bomId: detail.bom_id || '', quantity: detail.quantity || 1, plannedStart: detail.planned_start || '', plannedFinish: detail.planned_finish || '', remark: detail.remark || '' });
    }
  }, [detail]);
  useEffect(() => {
    if (!detail?.items) return;
    setMaterialLines((detail.items || []).map((item) => ({
      id: item.id,
      scrapRate: item.scrapRate ?? item.scrap_rate_snapshot ?? item.scrap_rate ?? 0,
      remark: item.remark || item.material_list_remark || '',
    })));
    setMaterialDirty(false);
  }, [detail?.items]);
  const save = async () => {
    try {
      await api('/api/production-orders', { method: 'POST', body: form });
      notify('制令单已创建');
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  const startOrder = async () => {
    try {
      await api('/api/production-orders/' + value.id, { method: 'POST', body: { action: 'start' } });
      notify('已开工');
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const completeOrder = async () => {
    try {
      await api('/api/production-orders/' + value.id, { method: 'POST', body: { action: 'complete' } });
      notify('已完工');
      refreshDetail();
    } catch (e) { notify(`无法完工：${e.message}`, 'error'); }
  };
  const transitionOrder = async (target, successMessage) => {
    try {
      await api(`/api/production-orders/${value.id}/state`, { method: 'POST', body: { target } });
      notify(successMessage);
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const cancelOrder = async () => {
    try {
      await api('/api/production-orders/' + value.id, { method: 'POST', body: { action: 'cancel' } });
      notify('已取消');
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const submitReport = async () => {
    try {
      const created = await api('/api/manufacturing/operation-reports', { method: 'POST', body: { productionOrderId: value.id, productionOperationId: report.operationId, goodQuantity: Number(report.goodQuantity), scrapQuantity: Number(report.scrapQuantity), laborSeconds: report.laborSeconds === '' ? null : Number(report.laborSeconds), machineSeconds: report.machineSeconds === '' ? null : Number(report.machineSeconds), scrapReason: report.scrapReason || null, remark: report.remark } });
      await api(`/api/manufacturing/operation-reports/${created.id}/confirm`, { method: 'POST' });
      notify('报工已确认'); setReport({ operationId: '', goodQuantity: 0, scrapQuantity: 0, laborSeconds: '', machineSeconds: '', scrapReason: '', remark: '' }); refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const completeOperationAction = async (operationId, operationName) => {
    try {
      await api(`/api/manufacturing/operations/${operationId}/complete`, { method: 'POST' });
      notify(`工序 ${operationName} 已完成`);
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  // --- Material List controlled edit / approve / release ---
  const submitMaterialListEdit = async () => {
    try {
      const lines = materialLines.map((line) => ({ lineId: line.id, scrapRate: Number(line.scrapRate || 0), remark: line.remark || '' }));
      await api(`/api/production-orders/${value.id}/material-list/edit`, { method: 'POST', body: { lines } });
      notify('用料清单受控编辑已提交');
      setMaterialDirty(false);
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const approveMaterialList = async () => {
    try {
      await api(`/api/production-orders/${value.id}/material-list/approve`, { method: 'POST' });
      notify('用料清单已审核');
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const releaseMaterialList = async () => {
    try {
      await api(`/api/production-orders/${value.id}/material-list/release`, { method: 'POST' });
      notify('用料清单已下达');
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  // --- Operation Plan lifecycle ---
  const submitOperationPlan = async () => {
    try {
      await api(`/api/production-orders/${value.id}/plan/submit`, { method: 'POST' });
      notify('工序计划已提交');
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const approveOperationPlan = async () => {
    try {
      await api(`/api/production-orders/${value.id}/plan/approve`, { method: 'POST' });
      notify('工序计划已审核');
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const releaseOperationPlan = async () => {
    try {
      await api(`/api/production-orders/${value.id}/plan/release`, { method: 'POST' });
      notify('工序计划已下达');
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const submitSchedule = async () => {
    try {
      await api(`/api/production-orders/${value.id}/schedule`, { method: 'POST', body: {
        direction: scheduleDraft.direction,
        mode: scheduleDraft.direction,
        plannedStart: scheduleDraft.plannedStart || undefined,
        plannedFinish: scheduleDraft.plannedFinish || undefined,
      } });
      notify(scheduleDraft.direction === 'BACKWARD' ? '倒排完成' : '正排完成');
      setScheduleDraft(null);
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const submitOutsourceHandoff = async () => {
    try {
      await api(`/api/production-operations/${outsourceDraft.operation.id}/outsource-handoff`, { method: 'POST', body: { supplierId: outsourceDraft.supplierId } });
      notify('委外交接已完成');
      setOutsourceDraft(null);
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  // --- Material execution entry points ---
  const submitSupplement = async () => {
    try {
      const created = await api('/api/production-material-supplements', { method: 'POST', body: {
        productionOrderId: value.id,
        warehouseId: supplementDraft.warehouseId,
        reasonCode: supplementDraft.reasonCode,
        remark: supplementDraft.remark || '',
        supplementDate: supplementDraft.supplementDate,
        items: supplementDraft.items.map((item) => ({ productId: item.productId, quantity: Number(item.quantity) })),
      } });
      notify(`补料单 ${created.supplementNo || created.id} 已创建`);
      setSupplementDraft(null);
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const submitReturn = async () => {
    try {
      const created = await api('/api/production-material-returns-with-reason', { method: 'POST', body: {
        originalIssueId: returnDraft.originalIssueId,
        reasonCode: returnDraft.reasonCode,
        remark: returnDraft.remark || '',
        returnDate: returnDraft.returnDate,
        items: returnDraft.items.map((item) => ({ originalIssueItemId: item.originalIssueItemId, quantity: Number(item.quantity) })),
      } });
      notify(`退料单 ${created.returnNo || created.id} 已创建`);
      setReturnDraft(null);
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const submitBatchIssue = async () => {
    try {
      const created = await api('/api/production-batch-issues', { method: 'POST', body: {
        warehouseId: batchDraft.warehouseId,
        issueDate: batchDraft.issueDate,
        remark: batchDraft.remark || '',
        orders: batchDraft.orders.map((entry) => ({
          productionOrderId: entry.productionOrderId,
          items: entry.items.map((item) => ({ requirementLineId: item.requirementLineId, issueQuantity: Number(item.issueQuantity) })),
        })),
      } });
      notify(`合并领料单 ${created.batchNo || created.id} 已创建`);
      setBatchDraft(null);
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const submitByproduct = async () => {
    try {
      await api('/api/production-byproducts', { method: 'POST', body: {
        productionOrderId: value.id,
        productId: byproductDraft.productId,
        plannedQuantity: Number(byproductDraft.plannedQuantity || 0),
        remark: byproductDraft.remark || '',
      } });
      notify('副产品已登记');
      setByproductDraft(null);
      loadByproducts();
    } catch (e) { notify(e.message, 'error'); }
  };
  const openIssueDetail = (issue) => {
    api(`/api/production-material-issues/${issue.id}`).then((r) => setIssueDetail(r.materialIssue)).catch((e) => notify(e.message, 'error'));
  };
  // Choosing the original issue populates the returnable lines from real data
  // so the退料 form never submits a bare ID with an empty line list.
  const selectReturnIssue = (issueId) => {
    setReturnDraft((draft) => ({ ...draft, originalIssueId: issueId, items: [] }));
    if (!issueId) return;
    api(`/api/production-material-issues/${issueId}`)
      .then((r) => {
        const issue = r.materialIssue || {};
        setReturnDraft((draft) => ({
          ...draft,
          originalIssueId: issueId,
          items: (issue.items || []).map((item) => ({ originalIssueItemId: item.id, quantity: item.issueQuantity ?? 0, productLabel: `${item.productCode || ''} ${item.productName || ''}`.trim() })),
        }));
      })
      .catch((e) => notify(e.message, 'error'));
  };
  const canCompleteOrder = (() => {
    if (!execution?.operations?.length) return { ready: true };
    const incomplete = execution.operations.find((op) => !['COMPLETED', 'CANCELLED'].includes(op.status));
    if (incomplete) return { ready: false, reason: `工序 ${incomplete.sequence_no} · ${incomplete.operation_name} 尚未完成` };
    return { ready: true };
  })();
  return <Modal title={value.id ? '制令单详情' : '新建制令单'} onClose={onClose} wide>
    {value.id && detail ? <>
      <div className="form-grid">
        <label>工单号<span className="mono">{detail.order_no}</span></label>
        <label>状态<Status status={detail.status?.toLowerCase()} label={PO_STATUS_LABELS[detail.status] || detail.statusLabel}/></label>
        <label>产品<span>{detail.productName}</span></label>
        <label>计划数量<span>{quantity(detail.quantity)}</span></label>
        <label>计划开始<span>{detail.planned_start || '-'}</span></label>
        <label>计划完工<span>{detail.planned_finish || '-'}</span></label>
        <label>实际开工<span>{detail.actual_start || '-'}</span></label>
        <label>实际完工<span>{detail.actual_finish || '-'}</span></label>
        <label>来源生产指令<span>{detail.sourceInstruction?.instruction_no || (detail.source_type === 'MANUAL' ? '手工制令' : '-')}</span></label>
        <label>BOM快照<span>{detail.bom_id ? `v${detail.bom_version_snapshot || detail.bomVersion || ''}` : '未关联'}</span></label>
        <label>工序快照<span>{detail.routing_version_snapshot ? <>v{detail.routing_version_snapshot} · {detail.routingSnapshot?.length || 0} 道工序 {detail.activeRoutingId && <AppLink page="product-routings" documentId={detail.activeRoutingId} documentType="productRouting" className="link-button">查看主数据</AppLink>}</> : '无工序快照'}</span></label>
        <label>创建人<span>{detail.creatorName}</span></label>
      </div>
      <div className="form-section-head" style={{marginTop:'1rem'}}>生产流程</div>
      <ProductionWorkflowTrace detail={detail} materialIssues={materialIssues} productionReceipts={productionReceipts} />
      <LinkedDocuments materialIssues={materialIssues} productionReceipts={productionReceipts} />
      <div className="mq-hub">
        <MaterialListSection user={user} detail={detail} lines={materialLines} setLines={(next) => { setMaterialLines(next); setMaterialDirty(true); }} dirty={materialDirty}
          onEdit={submitMaterialListEdit} onApprove={approveMaterialList} onRelease={releaseMaterialList} notify={notify} api={api} orderId={value.id}/>
        <OperationPlanSection user={user} operations={operations} loading={operationsLoading}
          onSubmit={submitOperationPlan} onApprove={approveOperationPlan} onRelease={releaseOperationPlan}
          onSchedule={() => setScheduleDraft({ direction: 'FORWARD', plannedStart: detail?.planned_start || '', plannedFinish: detail?.planned_finish || '' })}
          onOutsource={(op) => setOutsourceDraft({ operation: op, supplierId: '' })} notify={notify}/>
        <MaterialExecutionSection user={user} detail={detail} materialIssues={materialIssues} warehouses={warehouses}
          onSupplement={() => setSupplementDraft({ warehouseId: warehouses[0]?.id || '', reasonCode: 'SHORTAGE', remark: '', supplementDate: today(), items: [] })}
          onReturn={() => setReturnDraft({ originalIssueId: '', reasonCode: 'GOOD_RETURN', remark: '', returnDate: today(), items: [] })}
          onBatchIssue={() => setBatchDraft({ warehouseId: warehouses[0]?.id || '', issueDate: today(), remark: '', orders: [] })}
          onOpenIssue={openIssueDetail}/>
        <QualitySection inspections={inspections} receipts={productionReceipts} loading={inspectionsLoading}/>
        <ByproductSection user={user} byproducts={byproducts} products={products} loading={byproductsLoading}
          onCreate={() => setByproductDraft({ productId: '', plannedQuantity: 1, remark: '' })}/>
      </div>
      <div className="form-section-head" style={{marginTop:'1rem'}}>物料清单</div>
      <table className="line-table"><thead><tr><th>物料</th><th className="number">需求数量</th><th className="number">已净领</th><th className="number">剩余领料</th></tr></thead><tbody>
        {(detail.items || []).map((item) => <tr key={item.id}><td>{item.productName}</td><td className="number">{quantity(item.requiredQuantity ?? item.quantity)}</td><td className="number">{quantity(item.netIssued || 0)}</td><td className="number">{quantity(item.remainingQuantity ?? item.quantity)}</td></tr>)}
      </tbody>
      {!detail.items?.length && <tbody><tr><td colSpan="4" style={{textAlign:'center',color:'#999'}}>无配料记录</td></tr></tbody>}
      </table>
      {!!execution?.operations?.length && <>
        <div className="form-section-head" style={{marginTop:'1rem'}}>工艺进度</div>
        <div className="mobile-card-list">{execution.operations.map((op) => {
          const operationCanComplete = ['NOT_STARTED', 'IN_PROGRESS'].includes(op.status) && detail.status === 'IN_PROGRESS' && op.inputAvailable > 0 && op.remainingUnprocessed === 0 && can(user, 'PRODUCTION_ORDERS_COMPLETE');
          return <article className="mobile-card" key={op.id}><h3>{op.sequence_no} · {op.operation_name}</h3><div className="mobile-card__row"><span>状态</span><strong>{op.status}</strong></div><div className="mobile-card__row"><span>良品 / 报废</span><strong>{quantity(op.good)} / {quantity(op.scrap)}</strong></div><div className="mobile-card__row"><span>可报工 / 剩余</span><strong>{quantity(op.inputAvailable)} / {quantity(op.remainingUnprocessed)}</strong></div><div className="mobile-card__row"><span>计划 / 实际负荷</span><strong>{op.plannedLoadMinutes} / {op.actualLoadMinutes ?? '证据缺失'} 分钟</strong></div><div className="mobile-card__row"><span>实际良率</span><strong>{op.actualYieldBps == null ? '—' : `${(op.actualYieldBps / 100).toFixed(2)}%`}</strong></div>{operationCanComplete && <div className="mobile-card__row"><button type="button" className="primary" onClick={() => completeOperationAction(op.id, op.operation_name)}>完成工序 {op.sequence_no}</button></div>}</article>;
        })}</div>
        {detail.status === 'IN_PROGRESS' && can(user, 'PRODUCTION_ORDERS_START') && <div className="form-grid"><label>报工工序<select value={report.operationId} onChange={(e) => setReport({...report, operationId:e.target.value})}><option value="">选择当前可报工工序</option>{execution.operations.filter((op) => !['COMPLETED','CANCELLED'].includes(op.status) && op.remainingUnprocessed > 0).map((op) => <option key={op.id} value={op.id}>{op.sequence_no} · {op.operation_name}（剩余 {quantity(op.remainingUnprocessed)}）</option>)}</select></label><label>本次良品<input type="number" min="0" value={report.goodQuantity} onChange={(e) => setReport({...report, goodQuantity:e.target.value})}/></label><label>本次报废<input type="number" min="0" value={report.scrapQuantity} onChange={(e) => setReport({...report, scrapQuantity:e.target.value})}/></label><label>报废原因<select value={report.scrapReason} onChange={(e) => setReport({...report, scrapReason:e.target.value})}><option value="">无报废</option><option value="PROCESS_DEFECT">制程缺陷</option><option value="MATERIAL_DEFECT">材料缺陷</option><option value="SETUP_LOSS">调机损耗</option><option value="QUALITY_FAILURE">质量不合格</option><option value="OTHER">其他</option></select></label><label>人工工时（秒）<input type="number" min="0" value={report.laborSeconds} onChange={(e) => setReport({...report, laborSeconds:e.target.value})}/></label><label>设备工时（秒）<input type="number" min="0" value={report.machineSeconds} onChange={(e) => setReport({...report, machineSeconds:e.target.value})}/></label><label className="full">备注<input value={report.remark} onChange={(e) => setReport({...report, remark:e.target.value})}/></label><div className="full"><button className="primary" type="button" disabled={!report.operationId} onClick={submitReport}>确认报工</button></div></div>}
      </>}
      <div className="form-grid" style={{marginTop:'1rem'}}><label>计划生产<span>{quantity(detail.quantity)}</span></label><label>已净入库<span>{quantity(detail.netReceived || 0)}</span></label><label>剩余入库<span>{quantity(detail.remainingReceivable ?? detail.quantity)}</span></label><label>当前物料最多支持新增入库<span>{quantity(detail.maximumAdditionalReceipt || 0)}</span></label></div>
      <div className="form-actions" style={{marginTop:'1rem'}}>
        {detail.status === 'DRAFT' && can(user, 'PRODUCTION_ORDERS_CREATE') && <button className="primary" onClick={() => transitionOrder('SUBMITTED', '\u5df2\u63d0\u4ea4\u5ba1\u6279')}>\u63d0\u4ea4</button>}
        {detail.status === 'SUBMITTED' && can(user, 'PRODUCTION_ORDERS_APPROVE') && <button className="primary" onClick={() => transitionOrder('APPROVED', '\u5df2\u5ba1\u6838')}>\u5ba1\u6838</button>}
        {detail.status === 'APPROVED' && can(user, 'PRODUCTION_ORDERS_RELEASE') && <button className="primary" onClick={() => transitionOrder('RELEASED', '\u5df2\u4e0b\u8fbe')}>\u4e0b\u8fbe</button>}
        {detail.status === 'RELEASED' && can(user, 'PRODUCTION_ORDERS_START') && <button className="primary" onClick={startOrder}>\u5f00\u5de5</button>}
        {detail.status === 'PENDING' && can(user, 'PRODUCTION_ORDERS_START') && <button className="primary" onClick={startOrder}>开工</button>}
        {detail.status === 'IN_PROGRESS' && can(user, 'PRODUCTION_ORDERS_COMPLETE') && <button className="primary" disabled={!canCompleteOrder.ready} title={canCompleteOrder.ready ? '' : canCompleteOrder.reason} onClick={completeOrder}>完工{!canCompleteOrder.ready ? '（尚未满足）' : ''}</button>}
        {!canCompleteOrder.ready && canCompleteOrder.reason && <div className="form-section-note">完工前置：{canCompleteOrder.reason}</div>}
        {detail.status !== 'COMPLETED' && (can(user, 'PRODUCTION_ORDERS_CREATE') || can(user, 'PRODUCTION_ORDERS_START')) && <button className="danger-button" onClick={cancelOrder}>取消</button>}
        <button className="secondary" onClick={onClose}>关闭</button>
      </div>
      {outsourceDraft && <Modal title="委外交接" onClose={() => setOutsourceDraft(null)}><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void submitOutsourceHandoff(); }}>
        <label>工序<span>{outsourceDraft.operation.sequence_no} · {outsourceDraft.operation.operation_name || outsourceDraft.operation.operation_code}</span></label>
        <label>委外供应商<select value={outsourceDraft.supplierId} onChange={(e) => setOutsourceDraft({ ...outsourceDraft, supplierId: e.target.value })} required><option value="">选择供应商</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
        <FormActions onClose={() => setOutsourceDraft(null)} saveText="确认交接"/>
      </form></Modal>}
      {scheduleDraft && <Modal title="工序排程" onClose={() => setScheduleDraft(null)}><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void submitSchedule(); }}>
        <label>排程方向<select value={scheduleDraft.direction} onChange={(e) => setScheduleDraft({ ...scheduleDraft, direction: e.target.value })}>{SCHEDULE_DIRECTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>计划开始<input type="date" value={scheduleDraft.plannedStart} onChange={(e) => setScheduleDraft({ ...scheduleDraft, plannedStart: e.target.value })}/></label>
        <label>计划完工<input type="date" value={scheduleDraft.plannedFinish} onChange={(e) => setScheduleDraft({ ...scheduleDraft, plannedFinish: e.target.value })}/></label>
        <FormActions onClose={() => setScheduleDraft(null)} saveText="执行排程"/>
      </form></Modal>}
      {supplementDraft && <Modal title="生产补料" onClose={() => setSupplementDraft(null)}><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void submitSupplement(); }}>
        <label>仓库<select value={supplementDraft.warehouseId} onChange={(e) => setSupplementDraft({ ...supplementDraft, warehouseId: e.target.value })} required><option value="">选择仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
        <label>补料原因<select value={supplementDraft.reasonCode} onChange={(e) => setSupplementDraft({ ...supplementDraft, reasonCode: e.target.value })}>{SUPPLEMENT_REASON_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>补料日期<input type="date" value={supplementDraft.supplementDate} onChange={(e) => setSupplementDraft({ ...supplementDraft, supplementDate: e.target.value })}/></label>
        <div className="full"><div className="form-section-head"><span>补料明细</span><button type="button" className="secondary" onClick={() => setSupplementDraft({ ...supplementDraft, items: [...supplementDraft.items, { productId: '', quantity: 1 }] })}>＋ 增行</button></div>
          <div className="mq-line-editor">
            {supplementDraft.items.map((item, index) => <div key={index} className="mq-line-editor__row">
              <label>物料<select value={item.productId} onChange={(e) => setSupplementDraft({ ...supplementDraft, items: supplementDraft.items.map((row, i) => i === index ? { ...row, productId: e.target.value } : row) })} required><option value="">选择物料</option>{(detail?.items || []).map((orderItem) => <option key={orderItem.id} value={orderItem.product_id || orderItem.productId}>{orderItem.productCode} · {orderItem.productName}</option>)}</select></label>
              <label>数量<input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(e) => setSupplementDraft({ ...supplementDraft, items: supplementDraft.items.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row) })} required/></label>
              <button type="button" className="danger-text" onClick={() => setSupplementDraft({ ...supplementDraft, items: supplementDraft.items.filter((_, i) => i !== index) })}>x</button>
            </div>)}
            {!supplementDraft.items.length && <p className="hint">点击「＋ 增行」选择需要补料的物料。</p>}
          </div>
        </div>
        <label className="full">备注<input value={supplementDraft.remark} onChange={(e) => setSupplementDraft({ ...supplementDraft, remark: e.target.value })}/></label>
        <FormActions onClose={() => setSupplementDraft(null)} saveText="创建补料"/>
      </form></Modal>}
      {returnDraft && <Modal title="生产退料" onClose={() => setReturnDraft(null)}><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void submitReturn(); }}>
        <label>原出库单<select value={returnDraft.originalIssueId || ''} onChange={(e) => selectReturnIssue(e.target.value)} required><option value="">选择已确认出库单</option>{(materialIssues || []).filter((issue) => issue.status === 'CONFIRMED').map((issue) => <option key={issue.id} value={issue.id}>{issue.issueNo}</option>)}</select></label>
        <label>退料原因<select value={returnDraft.reasonCode} onChange={(e) => setReturnDraft({ ...returnDraft, reasonCode: e.target.value })}>{RETURN_REASON_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>退料日期<input type="date" value={returnDraft.returnDate} onChange={(e) => setReturnDraft({ ...returnDraft, returnDate: e.target.value })}/></label>
        <div className="full"><div className="form-section-head"><span>退料明细</span></div>
          <div className="mq-line-editor">
            {returnDraft.items.map((item, index) => <div key={item.originalIssueItemId || index} className="mq-line-editor__row mq-line-editor__row--block">
              <label>物料<span>{item.productLabel || item.originalIssueItemId}</span></label>
              <label>退料数量<input type="number" min="0.001" step="0.001" value={item.quantity} onChange={(e) => setReturnDraft({ ...returnDraft, items: returnDraft.items.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row) })} required/></label>
            </div>)}
            {!!returnDraft.originalIssueId && !returnDraft.items.length && <p className="hint">该出库单没有可退的明细行。</p>}
            {!returnDraft.originalIssueId && <p className="hint">先选择已确认的出库单，再调整退料数量。</p>}
          </div>
        </div>
        <label className="full">备注<input value={returnDraft.remark} onChange={(e) => setReturnDraft({ ...returnDraft, remark: e.target.value })}/></label>
        <FormActions onClose={() => setReturnDraft(null)} saveText="创建退料"/>
      </form></Modal>}
      {batchDraft && <Modal title="合并领料" onClose={() => setBatchDraft(null)}><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void submitBatchIssue(); }}>
        <label>仓库<select value={batchDraft.warehouseId} onChange={(e) => setBatchDraft({ ...batchDraft, warehouseId: e.target.value })} required><option value="">选择仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
        <label>领料日期<input type="date" value={batchDraft.issueDate} onChange={(e) => setBatchDraft({ ...batchDraft, issueDate: e.target.value })}/></label>
        <label className="full">备注<input value={batchDraft.remark} onChange={(e) => setBatchDraft({ ...batchDraft, remark: e.target.value })}/></label>
        <div className="full"><div className="form-section-head"><span>领料明细</span><button type="button" className="secondary" onClick={() => setBatchDraft({ ...batchDraft, orders: [...batchDraft.orders, { productionOrderId: value.id, items: (detail?.items || []).map((item) => ({ requirementLineId: item.id, issueQuantity: item.remainingQuantity ?? item.quantity ?? 0 })) }] })}>＋ 增行</button></div>
          <div className="mq-line-editor">
            {batchDraft.orders.map((entry, index) => <div key={index} className="mq-line-editor__row mq-line-editor__row--block">
              <label>制令单<span className="mono">{detail?.order_no}</span></label>
              <label>需求行<select value={entry.items[0]?.requirementLineId || ''} onChange={(e) => setBatchDraft({ ...batchDraft, orders: batchDraft.orders.map((row, i) => i === index ? { ...row, items: [{ ...row.items[0], requirementLineId: e.target.value }] } : row) })} required><option value="">选择需求行</option>{(detail?.items || []).map((item) => <option key={item.id} value={item.id}>{item.productCode} · {item.productName}</option>)}</select></label>
              <label>出库量<input type="number" min="0.001" step="0.001" value={entry.items[0]?.issueQuantity ?? 0} onChange={(e) => setBatchDraft({ ...batchDraft, orders: batchDraft.orders.map((row, i) => i === index ? { ...row, items: [{ ...row.items[0], issueQuantity: e.target.value }] } : row) })} required/></label>
              <button type="button" className="danger-text" onClick={() => setBatchDraft({ ...batchDraft, orders: batchDraft.orders.filter((_, i) => i !== index) })}>x</button>
            </div>)}
            {!batchDraft.orders.length && <p className="hint">点击「＋ 增行」选择需要合并领料的需求行。</p>}
          </div>
        </div>
        <FormActions onClose={() => setBatchDraft(null)} saveText="创建合并领料"/>
      </form></Modal>}
      {byproductDraft && <Modal title="新建副产品" onClose={() => setByproductDraft(null)}><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void submitByproduct(); }}>
        <label>副产品产品<select value={byproductDraft.productId} onChange={(e) => setByproductDraft({ ...byproductDraft, productId: e.target.value })} required><option value="">选择产品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
        <label>计划数量<input type="number" min="0" step="0.001" value={byproductDraft.plannedQuantity} onChange={(e) => setByproductDraft({ ...byproductDraft, plannedQuantity: e.target.value })} required/></label>
        <label className="full">备注<input value={byproductDraft.remark} onChange={(e) => setByproductDraft({ ...byproductDraft, remark: e.target.value })}/></label>
        <FormActions onClose={() => setByproductDraft(null)} saveText="创建副产品"/>
      </form></Modal>}
      {issueDetail && <Modal title={`用料出库单 ${issueDetail.issueNo || ''}`} onClose={() => setIssueDetail(null)}><div className="mq-criteria">
        <div><strong>状态</strong><span>{statusLabel(ISSUE_STATUS_LABELS, issueDetail.status, issueDetail.status)}</span></div>
        <div><strong>仓库</strong><span>{issueDetail.warehouseName || issueDetail.warehouse_name || '—'}</span></div>
        <div><strong>领料日期</strong><span>{issueDetail.issueDate || issueDetail.issue_date || '—'}</span></div>
        <div><strong>明细项数</strong><span>{(issueDetail.items || []).length}</span></div>
      </div><div className="form-actions"><button type="button" className="secondary" onClick={() => setIssueDetail(null)}>关闭</button></div></Modal>}
    </> : <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>产品<select value={form.productId} onChange={(e) => setForm({...form, productId: e.target.value})} required><option value="">选择产品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></label>
      <label>BOM版本<select value={form.bomId} onChange={(e) => setForm({...form, bomId: e.target.value})} required><option value="">选择BOM</option>{boms.map((b) => <option key={b.id} value={b.id}>v{b.version}</option>)}</select></label>
      <label>生产数量<input type="number" value={form.quantity} min="1" onChange={(e) => setForm({...form, quantity: Number(e.target.value)})} required/></label>
      <label>计划开始<input type="date" value={form.plannedStart} onChange={(e) => setForm({...form, plannedStart: e.target.value})}/></label>
      <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
      <FormActions onClose={onClose}/>
    </form>}
  </Modal>;
}

export function ManufacturingAnalytics({ user, notify }) {
  const [tab, setTab] = useState('wip'); const [data, setData] = useState([]); const [analyticalOnly, setAnalyticalOnly] = useState(false);
  const [range, setRange] = useState({ from: '', to: '' });
  const isSummaryTab = tab === 'execution' || tab === 'materialIssue';
  useEffect(() => {
    if (isSummaryTab) {
      const query = new URLSearchParams();
      if (range.from) query.set('from', range.from);
      if (range.to) query.set('to', range.to);
      const path = tab === 'execution'
        ? `/api/manufacturing-analytics/execution-summary${query.toString() ? `?${query}` : ''}`
        : `/api/manufacturing-analytics/material-issue-summary${query.toString() ? `?${query}` : ''}`;
      api(path).then((r) => { setData(r.rows || []); setAnalyticalOnly(false); }).catch((e) => { setData([]); notify(e.message, 'error'); });
      return;
    }
    api(`/api/manufacturing/reports/${tab}`).then((r) => { setData(r.rows || []); setAnalyticalOnly(Boolean(r.analyticalOnly)); }).catch((e) => notify(e.message, 'error'));
  }, [tab, range.from, range.to]);
  const tabContext = tab === 'wip' ? '在制' : tab === 'yield' ? '良率 / 报废' : tab === 'capacity' ? '产能' : tab === 'cost' ? '生产成本' : tab === 'execution' ? '执行汇总' : '物料领用汇总';
  return <BusinessPageShell className="manufacturing-analytics-v15" width="rail">
    <BusinessPageHeader title="生产执行分析" context={tabContext} help={<HelpDisclosure summary="分析口径"><p>在制、良率、产能与管理成本均由权威生产事件派生；管理成本不等同于财务库存计价。</p></HelpDisclosure>}/>
    <div className="tabs">
      <button className={tab==='wip'?'active':''} onClick={() => setTab('wip')}>在制</button>
      <button className={tab==='yield'?'active':''} onClick={() => setTab('yield')}>良率 / 报废</button>
      <button className={tab==='capacity'?'active':''} onClick={() => setTab('capacity')}>产能</button>
      <button className={tab==='execution'?'active':''} onClick={() => setTab('execution')}>执行汇总</button>
      <button className={tab==='materialIssue'?'active':''} onClick={() => setTab('materialIssue')}>物料领用汇总</button>
      {can(user,'PRODUCTION_COSTS_VIEW') && <button className={tab==='cost'?'active':''} onClick={() => setTab('cost')}>生产成本</button>}
    </div>
    {isSummaryTab && <div className="form-grid mq-range">
      <label>起始日期<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })}/></label>
      <label>截止日期<input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })}/></label>
    </div>}
    {analyticalOnly && <p className="hint">生产成本为管理分析，不等同于财务库存计价，也不会自动生成总账凭证。</p>}
    <div className="mobile-card-list">{data.map((row, index) => <article className="mobile-card" key={row.orderId || row.requirementId || `${row.work_center_id}-${row.planned_date}` || index}><h3>{row.orderNo || row.productCode || row.work_center_name || '生产分析'}</h3>{tab==='wip' && <><div className="mobile-card__row"><span>计划 / 物料支持</span><strong>{quantity(row.plannedQuantity)} / {quantity(row.materialSupportedQuantity)}</strong></div><div className="mobile-card__row"><span>当前工序</span><strong>{row.currentOperation || '—'}</strong></div><div className="mobile-card__row"><span>末工序良品 / 报废</span><strong>{quantity(row.finalGood)} / {quantity(row.scrap)}</strong></div></>}{tab==='yield' && <><div className="mobile-card__row"><span>良品 / 报废</span><strong>{quantity(row.goodQuantity)} / {quantity(row.scrapQuantity)}</strong></div><div className="mobile-card__row"><span>良率 / 报废率</span><strong>{(row.yieldBps/100).toFixed(2)}% / {(row.scrapRateBps/100).toFixed(2)}%</strong></div></>}{tab==='capacity' && <><div className="mobile-card__row"><span>计划日期</span><strong>{row.planned_date || '—'}</strong></div><div className="mobile-card__row"><span>能力 / 计划 / 实际</span><strong>{row.daily_capacity_minutes} / {row.planned_minutes} / {row.actual_minutes} 分钟</strong></div><div className="mobile-card__row"><span>负荷</span><strong>{row.overloaded ? '超负荷' : '正常'}</strong></div></>}{tab==='cost' && <><div className="mobile-card__row"><span>标准总成本</span><strong>{money(row.baseline?.standard_total_cents || 0)}</strong></div><div className="mobile-card__row"><span>实际/暂估总成本</span><strong>{row.totalCostCents == null ? '证据不完整' : money(row.totalCostCents)}</strong></div><div className="mobile-card__row"><span>成本证据</span><strong>{presentBusinessValue('costEvidence', row.materialQuality).label}</strong></div></>}{tab==='execution' && <><div className="mobile-card__row"><span>制品</span><strong>{row.productName || row.productCode || '—'}</strong></div><div className="mobile-card__row"><span>计划数量</span><strong>{quantity(row.plannedQuantity)}</strong></div><div className="mobile-card__row"><span>报工良品 / 报废</span><strong>{quantity(row.reportedGood)} / {quantity(row.reportedScrap)}</strong></div><div className="mobile-card__row"><span>净入库</span><strong>{quantity(row.netReceived)}</strong></div><div className="mobile-card__row"><span>进度 / 良率</span><strong>{row.progress ?? 0}% / {row.yield == null ? '—' : `${(row.yield / 100).toFixed(2)}%`}</strong></div><div className="mobile-card__row"><span>工单状态</span><strong>{statusLabel(PO_STATUS_LABELS, row.status, row.status)}</strong></div></>}{tab==='materialIssue' && <><div className="mobile-card__row"><span>物料</span><strong>{row.productName || row.productCode || '—'}</strong></div><div className="mobile-card__row"><span>需求数量</span><strong>{quantity(row.requiredQuantity)}</strong></div><div className="mobile-card__row"><span>已领 / 补料</span><strong>{quantity(row.issued)} / {quantity(row.supplemented)}</strong></div><div className="mobile-card__row"><span>已退</span><strong>{quantity(row.returned)}</strong></div><div className="mobile-card__row"><span>净领 / 剩余</span><strong>{quantity(row.net)} / {quantity(row.remaining)}</strong></div></>}</article>)}</div>
    {!data.length && <Empty text="暂无生产分析数据"/>}
  </BusinessPageShell>;
}

// ============ Material Issues ============

export function MaterialIssues({ user, notify }) {
  const { target } = useAppNavigation();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/production-material-issues?status=' + status).then((r) => setItems(r.materialIssues || [])).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  useEffect(() => {
    if (target?.page === 'material-issues' && target.documentId) {
      setView({ id: target.documentId });
    }
  }, [target]);
  const canManage = can(user, 'PRODUCTION_MATERIAL_ISSUE_MANAGE');
  const filtered = items.filter((item) => !search || item.issueNo.includes(search) || (item.productionOrderNo || '').includes(search));
  return <BusinessPageShell className="material-issues-v15" width="rail">
    <BusinessPageHeader title="用料出库" primaryAction={canManage && <BusinessAction hierarchy="primary" onClick={() => setView({ create: true })}>新建出库单</BusinessAction>} help={<HelpDisclosure summary="业务说明"><p>用料出库引用制令单，确认领料后才扣减组件库存并形成 WIP。</p></HelpDisclosure>}/>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索出库单号或制令单号" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="CONFIRMED">已确认</option><option value="CANCELLED">已取消</option></select>}/>
    <div className="table-wrap"><table><thead><tr><th>出库单号</th><th>制令单号</th><th>仓库</th><th>领料日期</th><th>状态</th><th className="number">物料项</th><th>创建人</th></tr></thead><tbody>
      {filtered.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:'pointer'}}>
        <td className="mono">{item.issueNo}</td>
        <td className="mono">{item.productionOrderNo}</td>
        <td>{item.warehouseName}</td>
        <td>{item.issueDate || '-'}</td>
        <td><Status status={item.status?.toLowerCase()} label={ISSUE_STATUS_LABELS[item.status] || item.statusLabel}/></td>
        <td className="number">{item.itemCount}</td>
        <td>{item.creatorName}</td>
      </tr>)}
    </tbody></table>{!filtered.length && <Empty text="没有用料出库单"/>}</div>
    {view && <MaterialIssueModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </BusinessPageShell>;
}

function MaterialIssueModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [warehouses, setWarehouses] = useState([]);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [prefill, setPrefill] = useState(null);
  const [returnDraft, setReturnDraft] = useState(null);
  const [form, setForm] = useState({ productionOrderId: '', warehouseId: '', issueDate: new Date().toISOString().slice(0, 10), remark: '', items: [] });
  const refresh = () => {
    if (value.id) api('/api/production-material-issues/' + value.id).then((r) => setDetail(r.materialIssue)).catch((e) => notify(e.message, 'error'));
  };
  useEffect(() => {
    api('/api/warehouses').then((r) => setWarehouses(r.warehouses || [])).catch((e) => notify(e.message, 'error'));
    api('/api/production-orders').then((r) => setOrders(r.orders || [])).catch((e) => notify(e.message, 'error'));
    api('/api/products').then((r) => setProducts(r.products || [])).catch((e) => notify(e.message, 'error'));
    if (value.id) refresh();
  }, []);
  useEffect(() => {
    if (value.id && detail && !form.productionOrderId) {
      setForm({
        productionOrderId: detail.productionOrderId,
        warehouseId: detail.warehouseId,
        issueDate: detail.issueDate || new Date().toISOString().slice(0, 10),
        remark: detail.remark || '',
        items: (detail.items || []).map((it) => ({
          requirementLineId: it.requirementLineId,
          productId: it.productId,
          plannedQuantity: it.plannedQuantity,
          issueQuantity: it.issueQuantity,
          trackingAllocations: it.trackingAllocations || [],
        })),
      });
    }
  }, [detail]);
  useEffect(() => {
    if (!value.id && form.productionOrderId) {
      api('/api/production-material-issues/prefill-from-bom?productionOrderId=' + form.productionOrderId + (form.warehouseId ? '&warehouseId=' + form.warehouseId : ''))
        .then((r) => {
          if (r.hasBom) {
            setPrefill(r);
            setForm((f) => ({ ...f, items: r.items.map((it) => ({ requirementLineId: it.requirementLineId, productId: it.productId, plannedQuantity: it.plannedQuantity, netIssuedQuantity: it.netIssuedQuantity, remainingQuantity: it.remainingQuantity, currentStock: it.currentStock, issueQuantity: it.issueQuantity })) }));
          } else {
            setPrefill(r);
          }
        })
        .catch(() => setPrefill(null));
    }
  }, [form.productionOrderId, form.warehouseId]);
  const isCreate = !value.id;
  const setItems = (items) => setForm((f) => ({ ...f, items }));
  const save = async () => {
    try {
      const payload = { productionOrderId: form.productionOrderId, warehouseId: form.warehouseId, issueDate: form.issueDate, remark: form.remark, items: form.items };
      if (value.id) {
        await api('/api/production-material-issues/' + value.id, { method: 'PATCH', body: payload });
        notify('用料出库单更改已保存');
      } else {
        await api('/api/production-material-issues', { method: 'POST', body: payload });
        notify('用料出库单已创建');
      }
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  const confirmIssue = async () => {
    try {
      await api('/api/production-material-issues/' + value.id + '/confirm', { method: 'POST' });
      notify('已确认出库');
      refresh();
    } catch (e) { notify(e.message, 'error'); }
  };
  const cancelIssue = async () => {
    try {
      await api('/api/production-material-issues/' + value.id + '/cancel', { method: 'POST' });
      notify('已取消');
      refresh();
    } catch (e) { notify(e.message, 'error'); }
  };
  const returnMaterial = async () => {
    try {
      const created = await api('/api/production-material-returns', { method: 'POST', body: { originalIssueId: value.id, items: [{ originalIssueItemId: returnDraft.item.id, quantity: Number(returnDraft.quantity), trackingAllocations: returnDraft.trackingAllocations }] } });
      await api('/api/production-material-returns/' + created.id + '/confirm', { method: 'POST' });
      notify('生产退料已确认'); setReturnDraft(null); refresh();
    } catch (e) { notify(e.message, 'error'); }
  };
  const deleteIssue = async () => {
    try { await api('/api/production-material-issues/' + value.id, { method: 'DELETE' }); notify('未过账出库单已删除'); onClose(); }
    catch (e) { notify(e.message, 'error'); }
  };
  const orderOptions = orders.filter((o) => o.status === 'IN_PROGRESS');
  const status = detail?.status;
  const readOnly = !isCreate && status !== 'DRAFT';
  return <Modal title={value.id ? '用料出库单' : '新建用料出库单'} onClose={onClose} wide>
    {value.id && detail ? <>
      <div className="form-grid">
        <label>出库单号<span className="mono">{detail.issueNo}</span></label>
        <label>状态<Status status={detail.status?.toLowerCase()} label={ISSUE_STATUS_LABELS[detail.status] || detail.statusLabel}/></label>
        <label>制令单<span className="mono">{detail.productionOrderNo}</span></label>
        <label>制品<span>{detail.productCode} - {detail.productName}</span></label>
        <label>仓库<span>{detail.warehouseName}</span></label>
        <label>领料日期<span>{detail.issueDate || '-'}</span></label>
        <label>创建人<span>{detail.creatorName}</span></label>
        <label>确认人<span>{detail.confirmedByName || '-'}</span></label>
        <label className="full">备注<span>{detail.remark || '-'}</span></label>
      </div>
      <div className="form-section-head" style={{marginTop:'1rem'}}>出库明细</div>
      <table className="line-table"><thead><tr><th>物料</th><th className="number">计划用量</th><th className="number">本次出库</th><th className="number">出库前库存</th><th className="number">出库后库存</th><th>更正</th></tr></thead><tbody>
        {(detail.items || []).map((it) => <tr key={it.id}>
          <td>{it.productCode} - {it.productName}</td>
          <td className="number">{Number(it.plannedQuantity || 0).toFixed(3)}</td>
          <td className="number">{Number(it.issueQuantity).toFixed(3)} {it.unit}</td>
          <td className="number">{it.beforeQuantity == null ? '-' : Number(it.beforeQuantity).toFixed(3)}</td>
          <td className="number">{it.afterQuantity == null ? '-' : Number(it.afterQuantity).toFixed(3)}</td>
          <td>{status === 'CONFIRMED' && detail.productionOrderStatus === 'IN_PROGRESS' && <button type="button" className="secondary" onClick={() => setReturnDraft({ item: it, quantity: it.issueQuantity, trackingAllocations: copySourceAllocations(it.trackingAllocations || []) })}>生产退料</button>}</td>
        </tr>)}
      </tbody></table>
      <div className="form-actions" style={{marginTop:'1rem'}}>
        {status === 'DRAFT' && <>
          <button className="primary" onClick={confirmIssue}>确认出库</button>
          <button className="danger-button" onClick={cancelIssue}>取消</button>
          <button className="danger-text" onClick={deleteIssue}>删除草稿</button>
        </>}
        <button className="secondary" onClick={onClose}>关闭</button>
      </div>
      {returnDraft && <Modal title="生产退料身份" onClose={() => setReturnDraft(null)}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void returnMaterial(); }}>
        <label>退料数量<input type="number" min="0.001" max={returnDraft.item.issueQuantity} step="0.001" value={returnDraft.quantity} onChange={(event) => setReturnDraft({ ...returnDraft, quantity: Number(event.target.value), trackingAllocations: [] })}/></label>
        <TrackingAllocationEditor product={products.find((product) => product.id === returnDraft.item.productId)} warehouseId={detail.warehouseId} quantity={returnDraft.quantity} businessDate={new Date().toISOString().slice(0, 10)} direction="RETURN_IN" value={returnDraft.trackingAllocations} sourceAllocations={returnDraft.item.trackingAllocations || []} onChange={(trackingAllocations) => setReturnDraft({ ...returnDraft, trackingAllocations })} notify={notify}/>
        <FormActions onClose={() => setReturnDraft(null)} saveText="确认退料"/>
      </form></Modal>}
    </> : <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>制令单<select value={form.productionOrderId} onChange={(e) => { setForm({ ...form, productionOrderId: e.target.value, items: [] }); setPrefill(null); }} required>
        <option value="">选择制令单</option>
        {orderOptions.map((o) => <option key={o.id} value={o.id}>{o.order_no} · {o.productName} · {o.statusLabel || o.status}</option>)}
      </select></label>
      <label>仓库<select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} required>
        <option value="">选择仓库</option>
        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
      </select></label>
      <label>领料日期<input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })}/></label>
      <label className="full">备注<input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })}/></label>
      {prefill && !prefill.hasBom && <div className="full" style={{padding:'0.5rem', background:'var(--bg-grouped)', borderRadius:'4px'}}>未关联 BOM，需手工选择用料</div>}
      <div className="full"><div className="form-section-head"><span>权威需求行</span></div>
        <table className="line-table"><thead><tr><th>物料</th><th className="number">需求</th><th className="number">已净领</th><th className="number">剩余</th><th className="number">当前库存</th><th className="number">本次出库量</th></tr></thead><tbody>
          {form.items.map((item, i) => <tr key={i}>
            <td>{prefill?.items?.find((it) => it.requirementLineId === item.requirementLineId)?.productCode} - {prefill?.items?.find((it) => it.requirementLineId === item.requirementLineId)?.productName}</td>
            <td className="number">{quantity(item.plannedQuantity)}</td>
            <td className="number">{quantity(item.netIssuedQuantity || 0)}</td>
            <td className="number">{quantity(item.remainingQuantity || 0)}</td>
            <td className="number">{quantity(item.currentStock || 0)}</td>
            <td><input type="number" value={item.issueQuantity} min="0.001" step="0.001" onChange={(e) => setItems(form.items.map((it, idx) => idx === i ? { ...it, issueQuantity: Number(e.target.value), trackingAllocations: [] } : it))} required/></td>
          </tr>)}
        </tbody></table>
        {form.items.map((item, i) => <TrackingAllocationEditor key={`issue-tracking-${item.requirementLineId || i}`} product={products.find((product) => product.id === item.productId)} warehouseId={form.warehouseId} quantity={item.issueQuantity} businessDate={form.issueDate} direction="OUT" value={item.trackingAllocations || []} onChange={(trackingAllocations) => setItems(form.items.map((row, index) => index === i ? { ...row, trackingAllocations } : row))} notify={notify}/>)}
        {!form.items.length && <div style={{textAlign:'center', padding:'0.5rem', color:'#999'}}>{prefill?.hasBom ? '点击「＋ 增行」从 BOM 带出用料' : '选择制令单后手工添加出库物料'}</div>}
      </div>
      <FormActions onClose={onClose} saveText="保存草稿"/>
    </form>}
  </Modal>;
}

// ============ Production Receipts ============

export function ProductionReceipts({ user, notify }) {
  const { target } = useAppNavigation();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/production-receipts?status=' + status).then((r) => setItems(r.productionReceipts || [])).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  useEffect(() => {
    if (target?.page === 'production-receipts' && target.documentId) {
      setView({ id: target.documentId });
    }
  }, [target]);
  const canManage = can(user, 'PRODUCTION_RECEIPT_MANAGE');
  const filtered = items.filter((item) => !search || item.receiptNo.includes(search) || (item.productionOrderNo || '').includes(search));
  return <BusinessPageShell className="production-receipts-v15" width="rail">
    <BusinessPageHeader title="生产入库" primaryAction={canManage && <BusinessAction hierarchy="primary" onClick={() => setView({ create: true })}>新建入库单</BusinessAction>} help={<HelpDisclosure summary="业务说明"><p>生产入库引用制令单和可证明的生产执行结果，确认后增加制品库存并结转 WIP。</p></HelpDisclosure>}/>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索入库单号或制令单号" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="CONFIRMED">已确认</option><option value="CANCELLED">已取消</option></select>}/>
    <div className="table-wrap"><table><thead><tr><th>入库单号</th><th>制令单号</th><th>制品</th><th>仓库</th><th className="number">本次入库</th><th>入库日期</th><th>状态</th></tr></thead><tbody>
      {filtered.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:'pointer'}}>
        <td className="mono">{item.receiptNo}</td>
        <td className="mono">{item.productionOrderNo}</td>
        <td>{item.productCode} - {item.productName}</td>
        <td>{item.warehouseName}</td>
        <td className="number">{quantity(item.quantity)}</td>
        <td>{item.receiptDate || '-'}</td>
        <td><Status status={item.status?.toLowerCase()} label={RECEIPT_STATUS_LABELS[item.status] || item.statusLabel}/></td>
      </tr>)}
    </tbody></table>{!filtered.length && <Empty text="没有生产入库单"/>}</div>
    {view && <ProductionReceiptModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </BusinessPageShell>;
}

function ProductionReceiptModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [warehouses, setWarehouses] = useState([]);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [orderSummary, setOrderSummary] = useState(null);
  const [reversalDraft, setReversalDraft] = useState(null);
  const [nonconformingDraft, setNonconformingDraft] = useState(null);
  const [form, setForm] = useState({ productionOrderId: '', warehouseId: '', quantity: 1, receiptDate: new Date().toISOString().slice(0, 10), remark: '' });
  const refresh = () => {
    if (value.id) api('/api/production-receipts/' + value.id).then((r) => setDetail(r.productionReceipt)).catch((e) => notify(e.message, 'error'));
  };
  useEffect(() => {
    api('/api/warehouses').then((r) => setWarehouses(r.warehouses || [])).catch((e) => notify(e.message, 'error'));
    api('/api/production-orders').then((r) => setOrders(r.orders || [])).catch((e) => notify(e.message, 'error'));
    api('/api/products').then((r) => setProducts(r.products || [])).catch((e) => notify(e.message, 'error'));
    if (value.id) refresh();
  }, []);
  useEffect(() => {
    if (value.id && detail && !form.productionOrderId) {
      setForm({
        productionOrderId: detail.productionOrderId,
        warehouseId: detail.warehouseId,
        quantity: detail.quantity,
        receiptDate: detail.receiptDate || new Date().toISOString().slice(0, 10),
        remark: detail.remark || '',
        trackingAllocations: detail.trackingAllocations || [],
      });
    }
  }, [detail]);
  useEffect(() => {
    if (!value.id && form.productionOrderId) api('/api/production-orders/' + form.productionOrderId).then((r) => setOrderSummary(r.order)).catch(() => setOrderSummary(null));
  }, [form.productionOrderId]);
  const save = async () => {
    try {
      const payload = { productionOrderId: form.productionOrderId, warehouseId: form.warehouseId, quantity: form.quantity, receiptDate: form.receiptDate, remark: form.remark, trackingAllocations: form.trackingAllocations || [] };
      if (value.id) {
        await api('/api/production-receipts/' + value.id, { method: 'PATCH', body: payload });
        notify('生产入库单更改已保存');
      } else {
        await api('/api/production-receipts', { method: 'POST', body: payload });
        notify('生产入库单已创建');
      }
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  const confirmReceipt = async () => {
    try {
      await api('/api/production-receipts/' + value.id + '/confirm', { method: 'POST' });
      notify('已确认入库');
      refresh();
    } catch (e) { notify(e.message, 'error'); }
  };
  const cancelReceipt = async () => {
    try {
      await api('/api/production-receipts/' + value.id + '/cancel', { method: 'POST' });
      notify('已取消');
      refresh();
    } catch (e) { notify(e.message, 'error'); }
  };
  const reverseReceipt = async () => {
    try {
      const created = await api('/api/production-receipt-reversals', { method: 'POST', body: { originalReceiptId: value.id, quantity: Number(reversalDraft.quantity), trackingAllocations: reversalDraft.trackingAllocations } });
      await api('/api/production-receipt-reversals/' + created.id + '/confirm', { method: 'POST' });
      notify('生产入库冲销已确认'); setReversalDraft(null); refresh();
    } catch (e) { notify(e.message, 'error'); }
  };
  const deleteReceipt = async () => {
    try { await api('/api/production-receipts/' + value.id, { method: 'DELETE' }); notify('未过账生产入库已删除'); onClose(); }
    catch (e) { notify(e.message, 'error'); }
  };
  const markNonconforming = async () => {
    if (!nonconformingDraft?.reason?.trim()) { notify('不合格必须填写原因', 'error'); return; }
    try {
      await api(`/api/production-receipts/${value.id}/nonconforming`, { method: 'POST', body: { reason: nonconformingDraft.reason.trim() } });
      notify('生产入库已标记不合格');
      setNonconformingDraft(null);
      refresh();
    } catch (e) { notify(e.message, 'error'); }
  };
  const orderOptions = orders.filter((o) => o.status === 'IN_PROGRESS');
  const status = detail?.status;
  return <Modal title={value.id ? '生产入库单' : '新建生产入库单'} onClose={onClose} wide>
    {value.id && detail ? <>
      <div className="form-grid">
        <label>入库单号<span className="mono">{detail.receiptNo}</span></label>
        <label>状态<Status status={detail.status?.toLowerCase()} label={RECEIPT_STATUS_LABELS[detail.status] || detail.statusLabel}/></label>
        <label>制令单<span className="mono">{detail.productionOrderNo}</span></label>
        <label>制品<span>{detail.productCode} - {detail.productName}</span></label>
        <label>计划数量<span>{Number(detail.plannedQuantity || 0).toFixed(3)}</span></label>
        <label>本次入库<span>{quantity(detail.quantity)}</span></label>
        <label>累计入库<span>{Number(detail.cumulativeReceived || 0).toFixed(3)}</span></label>
        <label>仓库<span>{detail.warehouseName}</span></label>
        <label>入库前库存<span>{detail.beforeQuantity == null ? '-' : Number(detail.beforeQuantity).toFixed(3)}</span></label>
        <label>入库后库存<span>{detail.afterQuantity == null ? '-' : Number(detail.afterQuantity).toFixed(3)}</span></label>
        <label>入库日期<span>{detail.receiptDate || '-'}</span></label>
        <label>创建人<span>{detail.creatorName}</span></label>
        <label>确认人<span>{detail.confirmedByName || '-'}</span></label>
        <label className="full">备注<span>{detail.remark || '-'}</span></label>
      </div>
      <div className="form-actions" style={{marginTop:'1rem'}}>
        {status === 'DRAFT' && <>
          <button className="primary" onClick={confirmReceipt}>确认入库</button>
          <button className="danger-button" onClick={cancelReceipt}>取消</button>
          <button className="danger-text" onClick={deleteReceipt}>删除草稿</button>
        </>}
        {status === 'CONFIRMED' && detail.productionOrderStatus === 'IN_PROGRESS' && <button className="danger-button" onClick={() => setReversalDraft({ quantity: detail.quantity, trackingAllocations: copySourceAllocations(detail.trackingAllocations || []) })}>入库冲销</button>}
        {status === 'CONFIRMED' && !detail.nonconforming && can(user, 'PRODUCTION_RECEIPT_MANAGE') && <button className="danger-button" onClick={() => setNonconformingDraft({ reason: '' })}>标记不合格</button>}
        <button className="secondary" onClick={onClose}>关闭</button>
      </div>
      {reversalDraft && <Modal title="生产入库冲销身份" onClose={() => setReversalDraft(null)}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void reverseReceipt(); }}>
        <label>冲销数量<input type="number" min="0.001" max={detail.quantity} step="0.001" value={reversalDraft.quantity} onChange={(event) => setReversalDraft({ ...reversalDraft, quantity: Number(event.target.value), trackingAllocations: [] })}/></label>
        <TrackingAllocationEditor product={products.find((product) => product.id === detail.product_id)} warehouseId={detail.warehouseId} quantity={reversalDraft.quantity} businessDate={new Date().toISOString().slice(0, 10)} direction="OUT" value={reversalDraft.trackingAllocations} onChange={(trackingAllocations) => setReversalDraft({ ...reversalDraft, trackingAllocations })} notify={notify}/>
        <FormActions onClose={() => setReversalDraft(null)} saveText="确认冲销"/>
      </form></Modal>}
      {nonconformingDraft && <Modal title="标记生产入库不合格" onClose={() => setNonconformingDraft(null)}><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void markNonconforming(); }}>
        <label className="full">不合格原因<textarea rows={3} value={nonconformingDraft.reason} onChange={(event) => setNonconformingDraft({ ...nonconformingDraft, reason: event.target.value })} required placeholder="请填写不合格原因"/></label>
        <FormActions onClose={() => setNonconformingDraft(null)} saveText="确认不合格"/>
      </form></Modal>}
    </> : <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>制令单<select value={form.productionOrderId} onChange={(e) => setForm({ ...form, productionOrderId: e.target.value, trackingAllocations: [] })} required>
        <option value="">选择制令单</option>
        {orderOptions.map((o) => <option key={o.id} value={o.id}>{o.order_no} · {o.productName} · {o.statusLabel || o.status}</option>)}
      </select></label>
      <label>仓库<select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} required>
        <option value="">选择仓库</option>
        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
      </select></label>
      <label>本次入库数量<input type="number" value={form.quantity} min="0.001" step="0.001" onChange={(e) => setForm({ ...form, quantity: Number(e.target.value), trackingAllocations: [] })} required/></label>
      {orderSummary && <div className="full" style={{padding:'0.75rem', background:'var(--bg-grouped)', borderRadius:'4px'}}>计划 {quantity(orderSummary.quantity)} · 已净入库 {quantity(orderSummary.netReceived || 0)} · 剩余 {quantity(orderSummary.remainingReceivable || 0)} · 当前物料最多支持新增入库 {quantity(orderSummary.maximumAdditionalReceipt || 0)}</div>}
      <label>入库日期<input type="date" value={form.receiptDate} onChange={(e) => setForm({ ...form, receiptDate: e.target.value })}/></label>
      <label className="full">备注<input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })}/></label>
      <TrackingAllocationEditor product={products.find((product) => product.id === (orderSummary?.product_id || orderSummary?.productId || orders.find((order) => order.id === form.productionOrderId)?.product_id))} warehouseId={form.warehouseId} quantity={form.quantity} businessDate={form.receiptDate} direction="IN" value={form.trackingAllocations || []} onChange={(trackingAllocations) => setForm({ ...form, trackingAllocations })} notify={notify}/>
      <FormActions onClose={onClose} saveText="保存草稿"/>
    </form>}
  </Modal>;
}

// ============ Projects ============
