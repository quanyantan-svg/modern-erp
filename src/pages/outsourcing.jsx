// 委外核心执行工作面（Requirement §31.15；Design §26.35）。
//
// 单一 Route 下的分岗任务工作面：
//   - 委外业务员：订单列表 → 订单详情 → 用料快照 / 加工费 PO / 发补退料 / 倒冲 / 报表；
//   - 委外收货员：收货队列 → 收货上下文 → 完工通知创建与确认 → 待检收货录入与生效；
//   - IQC 人员：委外待检来源 → canonical 检验单 → 返回委外来源。
//
// 业务身份只来自 URL（documentType + documentId）：刷新与 Back/Forward 从 URL
// 与服务端读模型恢复，不把敏感详情写进 URL 或浏览器存储。前端不写库存、
// WIP 余额、成本或 IQC 结论，所有写入都走既有 canonical Writer。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { can, Empty, FormActions, Modal } from '../components/ui.jsx';
import {
  BottomActionBar, BusinessAction, BusinessActionBar, BusinessContentSection, BusinessPageHeader, BusinessPageShell,
  CompactRecord, CompactRecordList, DateField, DetailSection, FormRow, HelpDisclosure, InlineAlert,
  PrimaryButton, QuantityField, RecordCard, SecondaryButton, SelectField, StatusChip, TextField,
} from '../components/design-system.jsx';
import { useAppNavigation } from '../navigation/AppNavigationContext.jsx';

const STATUS_LABELS = {
  DRAFT: '草稿', PLAN_CONFIRMED: '已确认计划', RELEASED: '已下达',
  COMPLETED: '已完工', CLOSED: '已关闭', CANCELLED: '已取消',
};
const SOURCE_LABELS = { PLANNING: '计划', MANUAL: '手工' };
const TRANSITION_LABELS = {
  CONFIRM_PLAN: '确认计划', RELEASE: '下达订单', COMPLETE: '标记完工', CLOSE: '关闭订单',
};
const NEXT_ACTION_LABELS = {
  CREATE_NOTICE: '创建完工通知', CONFIRM_NOTICE: '确认完工通知',
  CREATE_PENDING_RECEIPT: '录入待检收货', WAIT_IQC: '等待质检结论',
};
const NOTICE_STATUS_LABELS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const RECEIPT_STATUS_LABELS = { PENDING_INSPECTION: '待检', EFFECTED: '已生效', CANCELLED: '已取消' };
const PO_STATUS_LABELS = { DRAFT: '草稿', SUBMITTED: '已提交', APPROVED: '已审批', REJECTED: '已驳回' };
const WORKSPACE_LABELS = { business: '委外业务', receiving: '委外收货', quality: '委外质检' };

function money(cents) { return `¥${(Number(cents || 0) / 100).toFixed(2)}`; }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function fmtDate(value) {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

function fmtNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(number);
}

function partnerName(record) {
  if (!record) return '—';
  if (record.supplierName) return `${record.supplierName}（${record.supplierCode || record.supplierId}）`;
  return record.supplierId || '—';
}

function productName(record) {
  if (!record) return '—';
  if (record.productName) return `${record.productName}（${record.productCode || record.productId}）`;
  return record.productId || '—';
}

function availableWorkspaces(user) {
  const permissions = new Set(user?.permissions || []);
  const workspaces = [];
  if (permissions.has('OUTSOURCING_VIEW') || permissions.has('OUTSOURCING_MANAGE') || permissions.has('OUTSOURCING_RELEASE')) {
    workspaces.push('business');
  }
  if (permissions.has('OUTSOURCING_RECEIVING_MANAGE')) workspaces.push('receiving');
  if (permissions.has('IQC_VIEW') || permissions.has('IQC_MANAGE')) workspaces.push('quality');
  return workspaces;
}

export default function OutsourcingPage({ user, notify }) {
  const navigation = useAppNavigation();
  const target = navigation.target;
  const workspaces = useMemo(() => availableWorkspaces(user), [user]);
  const [workspace, setWorkspace] = useState(() => workspaces[0] || 'business');
  const [denied, setDenied] = useState('');

  // 深链接的业务身份只从 URL 恢复；刷新与 Back/Forward 走同一条路径。
  const focus = useMemo(() => {
    if (!target?.documentId) return null;
    const documentType = target.documentType || 'OUTSOURCING_ORDER';
    return { documentType, documentId: String(target.documentId) };
  }, [target?.documentId, target?.documentType]);

  useEffect(() => {
    if (!focus) { setDenied(''); return; }
    // 深链解析按**岗位**而不是文档类型硬编码：同一个委外订单，业务岗看宽详情，
    // 收货岗看受限收货上下文。
    let required = null;
    if (focus.documentType === 'OUTSOURCING_ORDER') {
      required = workspaces.includes('business') ? 'business' : (workspaces.includes('receiving') ? 'receiving' : null);
    } else if (focus.documentType === 'RECEIPT_NOTICE' || focus.documentType === 'OUTSOURCING_RECEIPT') {
      required = 'receiving';
    } else if (focus.documentType === 'IQC_INSPECTION') {
      required = 'quality';
    }
    if (!required || !workspaces.includes(required)) {
      setDenied('你没有打开该单据的岗位权限。');
      return;
    }
    setDenied('');
    setWorkspace(required);
  }, [focus?.documentType, focus?.documentId, workspaces.join(',')]);

  if (!workspaces.length) {
    return (
      <BusinessPageShell>
        <BusinessPageHeader title="委外加工" context="委外核心执行工作面" />
        <InlineAlert tone="danger" title="无岗位权限">当前账号没有委外业务、委外收货或委外质检权限。</InlineAlert>
      </BusinessPageShell>
    );
  }

  return (
    <BusinessPageShell>
      <BusinessPageHeader
        title="委外加工"
        context="委外核心执行工作面"
        secondaryActions={workspaces.length > 1 ? (
          <SelectField
            aria-label="切换岗位任务"
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
          >
            {workspaces.map((key) => (<option key={key} value={key}>{WORKSPACE_LABELS[key]}</option>))}
          </SelectField>
        ) : null}
      />
      {denied ? <InlineAlert tone="danger" title="无权访问">{denied}</InlineAlert> : null}
      {workspace === 'business' ? (
        <BusinessWorkspace user={user} notify={notify} navigation={navigation} focus={focus} />
      ) : null}
      {workspace === 'receiving' ? (
        <ReceivingWorkspace user={user} notify={notify} navigation={navigation} focus={focus} />
      ) : null}
      {workspace === 'quality' ? (
        <QualityWorkspace user={user} notify={notify} navigation={navigation} focus={focus} />
      ) : null}
    </BusinessPageShell>
  );
}

// ===========================================================================
// 委外业务员工作面
// ===========================================================================
function BusinessWorkspace({ user, notify, navigation, focus }) {
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [creatingOpening, setCreatingOpening] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (search.trim()) params.set('q', search.trim());
      const data = await api(`/api/procurement/outsourcing/orders?${params.toString()}`, { method: 'GET' });
      setOrders(data.outsourcingOrders || []);
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, [status, search]);

  useEffect(() => { load(); }, [load]);

  const openOrder = (orderId) => navigation.navigateToPage('outsourcing', {
    documentId: orderId, documentType: 'OUTSOURCING_ORDER',
  });

  return (
    <>
      <BusinessPageHeader
        title="委外订单"
        context="按角色展示任务、状态与下一步"
        primaryAction={can(user, 'OUTSOURCING_MANAGE') ? (
          <>
            <BusinessAction hierarchy="primary" onClick={() => setCreating(true)}>新建委外订单</BusinessAction>
            <BusinessAction onClick={() => setCreatingOpening(true)}>新建期初委外订单</BusinessAction>
          </>
        ) : null}
        secondaryActions={(
          <>
            <TextField
              aria-label="搜索委外订单"
              placeholder="单号 / 供应商 / 成品"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <SelectField aria-label="按状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">全部状态</option>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (<option key={key} value={key}>{label}</option>))}
            </SelectField>
          </>
        )}
      />
      {error ? <InlineAlert tone="danger" title="加载失败">{error}</InlineAlert> : null}
      {!orders.length && !error ? <Empty title="暂无委外订单" text="新建订单或由计划释放委外订单" /> : null}
      <CompactRecordList data-testid="outsourcing-order-list">
        {orders.map((order) => (
          <CompactRecord
            key={order.id}
            title={order.orderNo}
            subtitle={`${partnerName(order)} / ${productName(order)}`}
            status={<StatusChip status={order.status}>{STATUS_LABELS[order.status] || order.status}</StatusChip>}
            metadata={[
              { label: '数量', value: `${fmtNumber(order.orderQuantity)} ${order.unit || ''}` },
              { label: '业务日期', value: fmtDate(order.businessDate) },
              { label: '来源', value: SOURCE_LABELS[order.sourceType] || order.sourceType },
            ]}
            action={<SecondaryButton type="button" onClick={() => openOrder(order.id)}>打开详情</SecondaryButton>}
          />
        ))}
      </CompactRecordList>
      {creatingOpening ? (
        <CreateOpeningOrderSheet
          user={user}
          notify={notify}
          onClose={() => setCreatingOpening(false)}
          onCreated={() => { setCreatingOpening(false); load(); }}
        />
      ) : null}
      {creating ? (
        <CreateOrderSheet
          user={user}
          notify={notify}
          onClose={() => setCreating(false)}
          onCreated={(orderId) => { setCreating(false); load(); openOrder(orderId); }}
        />
      ) : null}
      {can(user, 'SUPPLIER_BILL_MANAGE') ? <ProcessingFeeProfilePanel user={user} notify={notify} /> : null}
      {focus?.documentType === 'OUTSOURCING_ORDER' ? (
        <OrderDetailSheet
          user={user}
          notify={notify}
          navigation={navigation}
          orderId={focus.documentId}
          onClose={() => navigation.navigateToPage('outsourcing', {})}
          onChanged={load}
        />
      ) : null}
    </>
  );
}

function OrderDetailSheet({ user, notify, navigation, orderId, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const [showPo, setShowPo] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api(`/api/procurement/outsourcing/orders/${orderId}`, { method: 'GET' });
      setDetail(data);
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!can(user, 'OUTSOURCING_MANAGE') && !can(user, 'OUTSOURCING_RELEASE')) { setReport(null); return; }
    api(`/api/reports/outsourcing/execution`, { method: 'GET' })
      .then((data) => setReport((data.report || []).find((row) => row.orderId === orderId) || null))
      .catch(() => setReport(null));
  }, [user, orderId]);

  if (error) {
    return (
      <DetailSheet title="委外订单" onClose={onClose}>
        <InlineAlert tone="danger" title="无法打开">{error}</InlineAlert>
      </DetailSheet>
    );
  }
  if (!detail) return null;

  const order = detail.outsourcingOrder;
  const materials = detail.materials || [];
  const snapshotReady = materials.length > 0;
  const nextTransition = {
    DRAFT: 'CONFIRM_PLAN', PLAN_CONFIRMED: 'RELEASE', RELEASED: 'COMPLETE', COMPLETED: 'CLOSE',
  }[order.status];

  async function transition(action) {
    setBusy(true);
    try {
      await api(`/api/procurement/outsourcing/orders/${orderId}/transition`, { method: 'POST', body: { action } });
      notify(`${TRANSITION_LABELS[action] || action}已完成`);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  async function cancelOrder() {
    setBusy(true);
    try {
      await api(`/api/procurement/outsourcing/orders/${orderId}/cancel`, { method: 'POST', body: {} });
      notify('委外订单已取消');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  const blockedReason = {
    CONFIRM_PLAN: snapshotReady ? null : '需先建立用料清单快照',
    RELEASE: snapshotReady ? null : '需先建立用料清单快照',
    COMPLETE: '需已生效收货净量达到订单数量',
    CLOSE: '需无待检收货、无未结完工通知且材料 WIP 余量为零',
  }[nextTransition];

  return (
    <DetailSheet title={`委外订单 ${order.orderNo}`} onClose={onClose}>
      {error ? <InlineAlert tone="danger" title="操作未完成">{error}</InlineAlert> : null}
      <DetailSection title="订单信息">
        <RecordCard
          title={order.orderNo}
          subtitle={`${SOURCE_LABELS[order.sourceType] || order.sourceType}来源`}
          status={<StatusChip status={order.status}>{STATUS_LABELS[order.status] || order.status}</StatusChip>}
          facts={[
            { label: '供应商', value: partnerName(order) },
            { label: '成品', value: productName(order) },
            { label: '订单数量', value: `${fmtNumber(order.orderQuantity)} ${order.unit || ''}` },
            { label: '业务日期', value: fmtDate(order.businessDate) },
            { label: '预期完工', value: fmtDate(order.expectedCompletionDate) },
            { label: '用料快照', value: snapshotReady ? '已形成' : '未形成' },
          ]}
        />
      </DetailSection>

      <DetailSection title="加工费采购订单">
        {detail.processingPo ? (
          <RecordCard
            title={`${detail.processingPo.poNo}`}
            subtitle={`${PO_STATUS_LABELS[detail.processingPo.status] || detail.processingPo.status}`}
            facts={detail.processingPo.items.map((item) => ({
              label: `行 ${item.lineNo}`, value: `${fmtNumber(item.quantity)} × ${fmtNumber(item.unitPriceCents / 100)}`,
            }))}
          />
        ) : (
          <HelpDisclosure summary="尚未创建加工费采购订单">
            <p>加工费采购订单只能在已下达状态下由委外业务岗创建，并交由既有采购订单审批流程审批。</p>
          </HelpDisclosure>
        )}
      </DetailSection>

      <DetailSection title="用料与 WIP 位置">
        {!materials.length ? (
          <Empty title="尚未建立用料清单快照" text="用料快照须在订单草稿确认计划时形成" />
        ) : (
          <CompactRecordList>
            {materials.map((material) => (
              <CompactRecord
                key={material.id}
                title={material.productId}
                subtitle={`需求 ${fmtNumber(material.requiredQuantity)} ${material.unit || ''}`}
                metadata={[
                  { label: '已发', value: fmtNumber(material.issuedQuantity) },
                  { label: '已补', value: fmtNumber(material.supplementedQuantity) },
                  { label: '已退', value: fmtNumber(material.returnedQuantity) },
                  { label: '已倒冲', value: fmtNumber(material.backflushedQuantity) },
                  { label: '供应商 WIP 余量', value: `${fmtNumber(material.supplierWipRemaining)} ${material.unit || ''}` },
                ]}
              />
            ))}
          </CompactRecordList>
        )}
      </DetailSection>

      <DetailSection title="完工通知与收货">
        <CompactRecordList>
          {(detail.notices || []).map((notice) => (
            <CompactRecord
              key={notice.id}
              title={notice.noticeNo}
              subtitle={`${NOTICE_STATUS_LABELS[notice.status] || notice.status} / 数量 ${fmtNumber(notice.quantity)}`}
              status={<StatusChip status={notice.status}>{NOTICE_STATUS_LABELS[notice.status] || notice.status}</StatusChip>}
            />
          ))}
          {(detail.receipts || []).map((receipt) => (
            <CompactRecord
              key={receipt.id}
              title={receipt.receipt_no}
              subtitle={`${RECEIPT_STATUS_LABELS[receipt.business_status] || receipt.business_status} / 数量 ${fmtNumber(receipt.quantity)}`}
              status={<StatusChip status={receipt.business_status}>{RECEIPT_STATUS_LABELS[receipt.business_status] || receipt.business_status}</StatusChip>}
            />
          ))}
          {!(detail.notices || []).length && !(detail.receipts || []).length ? (
            <Empty title="尚无通知与收货" text="收货岗在委外收货工作面创建完工通知与待检收货" />
          ) : null}
        </CompactRecordList>
      </DetailSection>

      <ProcessingFeeBillPanel
        user={user}
        notify={notify}
        outsourcingOrderId={orderId}
        onChanged={load}
      />

      {report ? (
        <DetailSection title="执行报表">
          <RecordCard
            title="执行口径"
            facts={[
              { label: '累计已生效', value: fmtNumber(report.cumulativeFinished) },
              { label: '待检数量', value: fmtNumber(report.pendingInspection) },
              { label: '进度', value: `${fmtNumber(Number(report.progress || 0) * 100)}%` },
              { label: '成本证据', value: report.costEvidenceStatus || '—' },
            ]}
          />
        </DetailSection>
      ) : null}

      <BusinessActionBar
        primary={nextTransition && (can(user, 'OUTSOURCING_RELEASE') || can(user, 'OUTSOURCING_MANAGE')) ? (
          <BusinessAction
            hierarchy="primary"
            disabled={busy || Boolean(blockedReason)}
            disabledReason={blockedReason || undefined}
            onClick={() => transition(nextTransition)}
          >
            {TRANSITION_LABELS[nextTransition]}
          </BusinessAction>
        ) : null}
        secondary={(
          <>
            {can(user, 'OUTSOURCING_MANAGE') && order.status === 'DRAFT' ? (
              <BusinessAction disabled={busy} onClick={() => setEditor('snapshot')}>建立用料快照</BusinessAction>
            ) : null}
            {can(user, 'OUTSOURCING_MANAGE') && order.status === 'RELEASED' ? (
              <BusinessAction disabled={busy} onClick={() => setShowPo(true)}>创建加工费 PO</BusinessAction>
            ) : null}
            {can(user, 'OUTSOURCING_MATERIAL_EXECUTE') && ['RELEASED', 'COMPLETED'].includes(order.status) ? (
              <BusinessAction disabled={busy} onClick={() => setEditor('issue')}>发料</BusinessAction>
            ) : null}
            {can(user, 'OUTSOURCING_MATERIAL_EXECUTE') && order.status === 'RELEASED' ? (
              <BusinessAction disabled={busy} onClick={() => setEditor('supplement')}>补料</BusinessAction>
            ) : null}
            {can(user, 'OUTSOURCING_MATERIAL_EXECUTE') && ['RELEASED', 'COMPLETED'].includes(order.status) ? (
              <BusinessAction disabled={busy} onClick={() => setEditor('return')}>退料</BusinessAction>
            ) : null}
          </>
        )}
        destructive={['DRAFT', 'PLAN_CONFIRMED'].includes(order.status) && can(user, 'OUTSOURCING_MANAGE') ? (
          <BusinessAction hierarchy="danger" disabled={busy} onClick={cancelOrder}>取消订单</BusinessAction>
        ) : null}
      />

      {editor ? (
        <MaterialActionSheet
          mode={editor}
          user={user}
          notify={notify}
          orderId={orderId}
          materials={materials}
          bomId={order.bomId}
          productId={order.productId}
          onClose={() => setEditor(null)}
          onDone={async () => { setEditor(null); await load(); onChanged?.(); }}
        />
      ) : null}
      {showPo ? (
        <ProcessingPoSheet
          user={user}
          notify={notify}
          orderId={orderId}
          onClose={() => setShowPo(false)}
          onDone={async () => { setShowPo(false); await load(); onChanged?.(); }}
        />
      ) : null}
    </DetailSheet>
  );
}

function MaterialActionSheet({ mode, user, notify, orderId, materials, bomId, productId, onClose, onDone }) {
  const [materialListId, setMaterialListId] = useState(materials[0]?.id || '');
  const [quantityValue, setQuantityValue] = useState('');
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => `os-${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const modeMeta = {
    issue: { title: '委外发料', path: 'issues', hint: '发料把企业仓物料移动到供应商 WIP 位置。' },
    supplement: { title: '委外补料', path: 'supplements', hint: '补料用于损耗等场景，同样进入供应商 WIP 位置。' },
    return: { title: '委外退料', path: 'returns', hint: '退料把未耗用的 WIP 退回原企业仓；已关闭订单不可退料。' },
  }[mode];

  if (mode === 'snapshot') {
    return (
      <SnapshotSheet
        notify={notify}
        orderId={orderId}
        bomId={bomId}
        productId={productId}
        onClose={onClose}
        onDone={onDone}
      />
    );
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { materialListId, quantity: Number(quantityValue), idempotencyKey };
      if (mode === 'supplement') body.reason = reason;
      await api(`/api/procurement/outsourcing/orders/${orderId}/${modeMeta.path}`, { method: 'POST', body });
      notify(`${modeMeta.title}已提交`);
      onDone();
    } catch (err) {
      // 表单内容保留，便于按错误原因纠正后重试。
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <DetailSheet title={modeMeta.title} onClose={onClose}>
      <InlineAlert tone="info">{modeMeta.hint}</InlineAlert>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error ? <InlineAlert tone="danger" title="提交未完成">{error}</InlineAlert> : null}
        <FormRow label="物料行" required>
          <SelectField value={materialListId} onChange={(event) => setMaterialListId(event.target.value)} required>
            {materials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.productId} · 需求 {fmtNumber(material.requiredQuantity)}
              </option>
            ))}
          </SelectField>
        </FormRow>
        <FormRow label="数量" required>
          <QuantityField aria-label="数量" value={quantityValue} onChange={(event) => setQuantityValue(event.target.value)} required />
        </FormRow>
        {mode === 'supplement' ? (
          <FormRow label="补料原因" required>
            <TextField aria-label="补料原因" value={reason} onChange={(event) => setReason(event.target.value)} required />
          </FormRow>
        ) : null}
        <BottomActionBar>
          <SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy || !materials.length}>{modeMeta.title}</PrimaryButton>
        </BottomActionBar>
      </form>
    </DetailSheet>
  );
}

/**
 * 建立用料清单快照：逐行绑定来源仓。
 *
 * 快照必须在 DRAFT 阶段形成（Requirement §31.15；已批准 MC-REQ-03），因此这个
 * 编辑器只在草稿状态出现；提交后订单才能确认计划并下达。
 */
function SnapshotSheet({ notify, orderId, bomId, productId, onClose, onDone }) {
  const [bom, setBom] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [bindings, setBindings] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api(`/api/procurement/outsourcing/options?kind=bom&productId=${encodeURIComponent(productId || '')}`, { method: 'GET' })
      .then((data) => {
        if (cancelled) return;
        const matched = (data.options || []).find((option) => option.id === bomId) || null;
        setBom(matched);
        setBindings(Object.fromEntries((matched?.items || []).map((item) => [item.productId, ''])));
      })
      .catch((err) => { if (!cancelled) setError(err.message); });
    api('/api/procurement/outsourcing/options?kind=warehouse', { method: 'GET' })
      .then((data) => { if (!cancelled) setWarehouses(data.options || []); })
      .catch(() => { if (!cancelled) setWarehouses([]); });
    return () => { cancelled = true; };
  }, [bomId, productId]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/api/procurement/outsourcing/orders/${orderId}/material-list`, {
        method: 'POST',
        body: {
          items: (bom?.items || []).map((item) => ({
            productId: item.productId,
            sourceWarehouseId: bindings[item.productId],
          })),
        },
      });
      notify('用料清单快照已建立');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  const items = bom?.items || [];
  const ready = items.length > 0 && items.every((item) => bindings[item.productId]);

  return (
    <DetailSheet title="建立用料清单快照" onClose={onClose}>
      <InlineAlert tone="info">
        快照逐行取自已批准的 OUTSOURCE BOM；每行必须绑定一个企业来源仓。快照形成后订单才能确认计划。
      </InlineAlert>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error ? <InlineAlert tone="danger" title="提交未完成">{error}</InlineAlert> : null}
        {!bom ? <Empty title="没有可用的已批准 OUTSOURCE BOM" text="订单必须先绑定业务日期上已批准且生效的委外 BOM" /> : null}
        {items.map((item) => (
          <FormRow key={item.productId} label={`用料 ${item.productId}（每单位 ${fmtNumber(item.quantity)}）`} required>
            <SelectField
              aria-label={`来源仓 ${item.productId}`}
              value={bindings[item.productId] || ''}
              onChange={(event) => setBindings({ ...bindings, [item.productId]: event.target.value })}
              required
            >
              <option value="">请选择来源仓</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}（{warehouse.code}）</option>
              ))}
            </SelectField>
          </FormRow>
        ))}
        <BottomActionBar>
          <SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy || !ready}>建立快照</PrimaryButton>
        </BottomActionBar>
      </form>
    </DetailSheet>
  );
}

function ProcessingPoSheet({ user, notify, orderId, onClose, onDone }) {
  const [unitPriceCents, setUnitPriceCents] = useState('');
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => `os-po-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/api/procurement/outsourcing/orders/${orderId}/processing-fee-purchase-orders`, {
        method: 'POST',
        body: {
          unitPriceCents: Math.round(Number(unitPriceCents) * 100),
          orderDate,
          expectedDeliveryDate: expectedDeliveryDate || null,
          paymentTerms,
        },
        headers: { 'idempotency-key': idempotencyKey },
      });
      notify('加工费采购订单草稿已创建，请交采购订单审批流程处理');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <DetailSheet title="创建加工费采购订单" onClose={onClose}>
      <InlineAlert tone="info">加工费采购订单只是草稿；审批仍由既有采购订单审批角色完成，本岗位没有自动批准权。</InlineAlert>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error ? <InlineAlert tone="danger" title="提交未完成">{error}</InlineAlert> : null}
        <FormRow label="加工费单价（元）" required>
          <QuantityField aria-label="加工费单价（元）" value={unitPriceCents} onChange={(event) => setUnitPriceCents(event.target.value)} required />
        </FormRow>
        <FormRow label="订单日期" required>
          <DateField value={orderDate} onChange={(event) => setOrderDate(event.target.value)} required />
        </FormRow>
        <FormRow label="期望交付日期">
          <DateField value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} />
        </FormRow>
        <FormRow label="付款条件">
          <TextField value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} />
        </FormRow>
        <BottomActionBar>
          <SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy}>创建草稿</PrimaryButton>
        </BottomActionBar>
      </form>
    </DetailSheet>
  );
}

function CreateOrderSheet({ user, notify, onClose, onCreated }) {
  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [boms, setBoms] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [handoffs, setHandoffs] = useState([]);
  const [form, setForm] = useState({ supplierId: '', productId: '', bomId: '', orderQuantity: '1', unit: 'EA', planningHandoffId: '', sourceWarehouseId: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const query = `businessDate=${encodeURIComponent(businessDate)}`;
      try {
        const [supplierData, productData, bomData, warehouseData, handoffData] = await Promise.all([
          api(`/api/procurement/outsourcing/options?kind=supplier&${query}`, { method: 'GET' }),
          api(`/api/procurement/outsourcing/options?kind=product`, { method: 'GET' }),
          api(`/api/procurement/outsourcing/options?kind=bom&${query}`, { method: 'GET' }),
          api(`/api/procurement/outsourcing/options?kind=warehouse`, { method: 'GET' }),
          api(`/api/procurement/outsourcing/options?kind=handoff`, { method: 'GET' }),
        ]);
        if (cancelled) return;
        setSuppliers(supplierData.options || []);
        setProducts(productData.options || []);
        setBoms(bomData.options || []);
        setWarehouses(warehouseData.options || []);
        setHandoffs(handoffData.options || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [businessDate]);

  const productBoms = boms.filter((bom) => !form.productId || bom.productId === form.productId);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = {
        supplierId: form.supplierId,
        productId: form.productId,
        orderQuantity: Number(form.orderQuantity),
        unit: form.unit,
        businessDate,
      };
      if (form.planningHandoffId) body.planningHandoffId = form.planningHandoffId;
      else if (form.bomId) body.bomId = form.bomId;
      const created = await api('/api/procurement/outsourcing/orders', { method: 'POST', body });
      notify('委外订单已创建');
      onCreated(created.id);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <DetailSheet title="新建委外订单" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error ? <InlineAlert tone="danger" title="提交未完成">{error}</InlineAlert> : null}
        <FormRow label="业务日期" hint="供应商资格与 BOM 有效性按该业务日期判断" required>
          <DateField aria-label="业务日期" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} required />
        </FormRow>
        <FormRow label="委外供应商" required>
          <SelectField aria-label="委外供应商" value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })} required>
            <option value="">请选择合格供应商</option>
            {suppliers.map((option) => (
              <option key={option.id} value={option.id}>{option.name}（{option.code}）</option>
            ))}
          </SelectField>
        </FormRow>
        <FormRow label="成品" required>
          <SelectField aria-label="成品" value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value, bomId: '' })} required>
            <option value="">请选择成品</option>
            {products.map((option) => (
              <option key={option.id} value={option.id}>{option.name}（{option.code}）</option>
            ))}
          </SelectField>
        </FormRow>
        <FormRow label="计划交接来源" hint="选择计划移交单时，订单数量由计划来源决定">
          <SelectField aria-label="计划交接来源" value={form.planningHandoffId} onChange={(event) => setForm({ ...form, planningHandoffId: event.target.value })}>
            <option value="">手工建单</option>
            {handoffs.map((option) => (
              <option key={option.id} value={option.id}>
                {option.productName} · {fmtNumber(option.quantity)} · 需求日期 {fmtDate(option.needDate)}
              </option>
            ))}
          </SelectField>
        </FormRow>
        <FormRow label="OUTSOURCE BOM" hint="只列出业务日期上已批准且生效的委外 BOM">
          <SelectField aria-label="OUTSOURCE BOM" value={form.bomId} onChange={(event) => setForm({ ...form, bomId: event.target.value })} disabled={Boolean(form.planningHandoffId)}>
            <option value="">请选择已批准 OUTSOURCE BOM</option>
            {productBoms.map((option) => (
              <option key={option.id} value={option.id}>
                {option.productName} · v{option.version} · 生效 {fmtDate(option.effectiveFrom)}
              </option>
            ))}
          </SelectField>
        </FormRow>
        <FormRow label="订单数量" required>
          <QuantityField aria-label="订单数量" value={form.orderQuantity} onChange={(event) => setForm({ ...form, orderQuantity: event.target.value })} required />
        </FormRow>
        <FormRow label="单位" required>
          <TextField aria-label="单位" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} required />
        </FormRow>
        <BottomActionBar>
          <SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy}>创建订单</PrimaryButton>
        </BottomActionBar>
      </form>
    </DetailSheet>
  );
}

// ===========================================================================
// 委外收货员工作面
// ===========================================================================
function ReceivingWorkspace({ user, notify, navigation, focus }) {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api('/api/procurement/outsourcing/receiving-queue', { method: 'GET' });
      setTasks(data.tasks || []);
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <BusinessPageHeader title="委外收货任务" context="完工通知、待检收货与收货生效" />
      {error ? <InlineAlert tone="danger" title="加载失败">{error}</InlineAlert> : null}
      {!tasks.length && !error ? <Empty title="暂无收货任务" text="已下达且存在加工费 PO 的委外订单会出现在这里" /> : null}
      <CompactRecordList data-testid="outsourcing-receiving-queue">
        {tasks.map((task) => (
          <CompactRecord
            key={task.order.id}
            title={task.order.orderNo}
            subtitle={`${partnerName(task.order)} / ${productName(task.order)}`}
            status={<StatusChip status={task.order.status}>{STATUS_LABELS[task.order.status] || task.order.status}</StatusChip>}
            metadata={[
              { label: '订单数量', value: fmtNumber(task.quantities.ordered) },
              { label: '已生效', value: fmtNumber(task.quantities.effected) },
              { label: '待检', value: fmtNumber(task.quantities.pendingInspection) },
              { label: '剩余可收', value: fmtNumber(task.quantities.remainingToReceive) },
            ]}
            action={(
              <SecondaryButton
                type="button"
                onClick={() => navigation.navigateToPage('outsourcing', {
                  documentId: task.order.id, documentType: 'OUTSOURCING_ORDER',
                })}
              >
                打开收货
              </SecondaryButton>
            )}
          >
            {task.nextActions?.length ? (
              <p className="muted">下一步：{task.nextActions.map((action) => NEXT_ACTION_LABELS[action] || action).join('、')}</p>
            ) : (
              <p className="muted">当前没有可由收货岗执行的动作。</p>
            )}
          </CompactRecord>
        ))}
      </CompactRecordList>
      {focus && ['OUTSOURCING_ORDER', 'RECEIPT_NOTICE', 'OUTSOURCING_RECEIPT'].includes(focus.documentType) ? (
        <ReceivingContextSheet
          user={user}
          notify={notify}
          navigation={navigation}
          focus={focus}
          onClose={() => navigation.navigateToPage('outsourcing', {})}
          onChanged={load}
        />
      ) : null}
    </>
  );
}

function ReceivingContextSheet({ user, notify, navigation, focus, onClose, onChanged }) {
  const [context, setContext] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [noticeQuantity, setNoticeQuantity] = useState('');
  const [receiptQuantity, setReceiptQuantity] = useState('');
  const [processingFeeCents, setProcessingFeeCents] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [warehouses, setWarehouses] = useState([]);
  const [selectedNotice, setSelectedNotice] = useState('');

  const query = focus.documentType === 'RECEIPT_NOTICE'
    ? `noticeId=${encodeURIComponent(focus.documentId)}`
    : (focus.documentType === 'OUTSOURCING_RECEIPT'
      ? `receiptId=${encodeURIComponent(focus.documentId)}`
      : `orderId=${encodeURIComponent(focus.documentId)}`);

  const load = useCallback(async () => {
    try {
      const data = await api(`/api/procurement/outsourcing/receiving-context?${query}`, { method: 'GET' });
      setContext(data.receivingContext);
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);


  useEffect(() => {
    if (context?.warehouses) setWarehouses(context.warehouses);
  }, [context]);

  if (error && !context) {
    return (
      <DetailSheet title="委外收货" onClose={onClose}>
        <InlineAlert tone="danger" title="无法打开">{error}</InlineAlert>
      </DetailSheet>
    );
  }
  if (!context) return null;

  const order = context.order;
  const approvedPo = context.processingPo && context.processingPo.status === 'APPROVED' ? context.processingPo : null;
  const draftNotice = context.notices.find((notice) => notice.status === 'DRAFT');
  const confirmedNotice = context.notices.find((notice) => notice.status === 'CONFIRMED');

  async function createNotice() {
    setBusy(true);
    setError('');
    try {
      await api('/api/receipt-notices', {
        method: 'POST',
        body: {
          businessType: 'OUTSOURCE',
          outsourcingOrderId: order.id,
          processingPoId: context.processingPo.id,
          warehouseId: warehouseId || context.notices[0]?.warehouseId || warehouses[0]?.id,
          noticeDate: new Date().toISOString().slice(0, 10),
          items: [{ productId: order.productId, quantity: Number(noticeQuantity) }],
        },
      });
      notify('完工通知已创建（草稿）');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  async function confirmNotice(noticeId) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/receipt-notices/${noticeId}/confirm`, { method: 'POST', body: {} });
      notify('完工通知已确认');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  async function createReceipt() {
    setBusy(true);
    setError('');
    try {
      const notice = context.notices.find((item) => item.id === selectedNotice) || confirmedNotice;
      const source = notice?.items?.[0];
      const poItem = approvedPo?.items?.[0];
      await api('/api/procurement/outsourcing/receipts', {
        method: 'POST',
        body: {
          orderId: order.id,
          quantity: Number(receiptQuantity),
          receivedDate: new Date().toISOString().slice(0, 10),
          businessDate: new Date().toISOString().slice(0, 10),
          processingFeeCents: Math.round(Number(processingFeeCents || 0) * 100),
          processingPoId: approvedPo.id,
          sourceNoticeId: notice.id,
          warehouseId: notice.warehouseId || warehouseId,
          items: [{
            productId: order.productId,
            quantity: Number(receiptQuantity),
            unitCode: poItem?.unitCode || null,
            unitPriceCents: Math.round(Number(processingFeeCents || 0) * 100),
            processingPoItemId: poItem?.id,
            sourceNoticeItemId: source?.id,
          }],
        },
        headers: { 'idempotency-key': `os-receipt-${order.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` },
      });
      notify('待检收货已录入（尚未入库）');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  async function effectReceipt(receiptId) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/procurement/outsourcing/receipts/${receiptId}/confirm`, {
        method: 'POST', body: {}, headers: { 'idempotency-key': `os-effect-${receiptId}` },
      });
      notify('收货已生效并入企业仓');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <DetailSheet title={`委外收货 ${order.orderNo}`} onClose={onClose}>
      {error ? <InlineAlert tone="danger" title="操作未完成">{error}</InlineAlert> : null}
      <DetailSection title="收货范围">
        <RecordCard
          title={order.orderNo}
          subtitle={`${partnerName(order)} / ${productName(order)}`}
          facts={[
            { label: '订单数量', value: fmtNumber(context.quantities.ordered) },
            { label: '已生效', value: fmtNumber(context.quantities.effected) },
            { label: '待检', value: fmtNumber(context.quantities.pendingInspection) },
            { label: '剩余可收', value: fmtNumber(context.quantities.remainingToReceive) },
          ]}
        />
      </DetailSection>

      <DetailSection title="加工费采购订单">
        {context.processingPo ? (
          <RecordCard
            title={context.processingPo.poNo}
            subtitle={PO_STATUS_LABELS[context.processingPo.status] || context.processingPo.status}
            facts={context.processingPo.items.map((item) => ({
              label: `行 ${item.lineNo}`, value: `${fmtNumber(item.quantity)} ${item.unitCode || ''}`,
            }))}
          />
        ) : <Empty title="尚无加工费采购订单" text="收货岗不能在缺少加工费 PO 时创建完工通知" />}
      </DetailSection>

      <DetailSection title="完工通知">
        {context.notices.length ? (
          <CompactRecordList>
            {context.notices.map((notice) => (
              <CompactRecord
                key={notice.id}
                title={notice.noticeNo}
                subtitle={`${NOTICE_STATUS_LABELS[notice.status] || notice.status} / 数量 ${fmtNumber(notice.quantity)} / 目标仓 ${notice.warehouseId || '—'}`}
                status={<StatusChip status={notice.status}>{NOTICE_STATUS_LABELS[notice.status] || notice.status}</StatusChip>}
                action={notice.status === 'DRAFT' ? (
                  <BusinessAction disabled={busy} onClick={() => confirmNotice(notice.id)}>确认通知</BusinessAction>
                ) : null}
              />
            ))}
          </CompactRecordList>
        ) : <Empty title="尚无完工通知" text="完工通知必须来自本订单的已批准加工费 PO" />}
      </DetailSection>

      <DetailSection title="委外收货">
        {context.receipts.length ? (
          <CompactRecordList>
            {context.receipts.map((receipt) => (
              <CompactRecord
                key={receipt.id}
                title={receipt.receiptNo}
                subtitle={`${RECEIPT_STATUS_LABELS[receipt.businessStatus] || receipt.businessStatus} / 数量 ${fmtNumber(receipt.quantity)}`}
                status={<StatusChip status={receipt.businessStatus}>{RECEIPT_STATUS_LABELS[receipt.businessStatus] || receipt.businessStatus}</StatusChip>}
                action={receipt.businessStatus === 'PENDING_INSPECTION' ? (
                  <BusinessAction disabled={busy} onClick={() => effectReceipt(receipt.id)}>收货生效</BusinessAction>
                ) : null}
              />
            ))}
          </CompactRecordList>
        ) : <Empty title="尚无委外收货" text="从已确认完工通知录入待检收货" />}
      </DetailSection>

      <BusinessActionBar
        secondary={(
          <>
            {approvedPo && !confirmedNotice ? (
              <>
                <FormRow label="完工通知数量" required>
                  <QuantityField aria-label="完工通知数量" value={noticeQuantity} onChange={(event) => setNoticeQuantity(event.target.value)} />
                </FormRow>
                <FormRow label="目标仓库" required>
                  <SelectField aria-label="目标仓库" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
                    <option value="">请选择目标仓</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>{warehouse.name}（{warehouse.code}）</option>
                    ))}
                  </SelectField>
                </FormRow>
                <BusinessAction disabled={busy || !noticeQuantity || !warehouseId} onClick={createNotice}>创建完工通知</BusinessAction>
              </>
            ) : null}
            {confirmedNotice ? (
              <>
                <FormRow label="来源完工通知" required>
                  <SelectField aria-label="来源完工通知" value={selectedNotice} onChange={(event) => setSelectedNotice(event.target.value)}>
                    <option value="">{confirmedNotice.noticeNo}</option>
                  </SelectField>
                </FormRow>
                <FormRow label="收货数量" required>
                  <QuantityField aria-label="收货数量" value={receiptQuantity} onChange={(event) => setReceiptQuantity(event.target.value)} />
                </FormRow>
                <FormRow label="加工费（元）" required>
                  <QuantityField aria-label="加工费（元）" value={processingFeeCents} onChange={(event) => setProcessingFeeCents(event.target.value)} />
                </FormRow>
                <BusinessAction disabled={busy || !receiptQuantity} onClick={createReceipt}>录入待检收货</BusinessAction>
              </>
            ) : null}
          </>
        )}
      />
    </DetailSheet>
  );
}

// ===========================================================================
// 委外质检工作面
// ===========================================================================
function QualityWorkspace({ user, notify, navigation, focus }) {
  const [candidates, setCandidates] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api('/api/iqc/source-candidates?sourceType=OUTSOURCING_RECEIPT', { method: 'GET' });
      setCandidates(data.candidates || []);
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createInspection(candidate) {
    setBusy(true);
    setError('');
    try {
      const created = await api('/api/iqc', {
        method: 'POST', body: { outsourcing_receipt_id: candidate.sourceId },
      });
      notify('检验单已创建');
      navigation.navigateToPage('iqc', { documentId: created.id, documentType: 'IQC_INSPECTION' });
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <BusinessPageHeader title="委外待检来源" context="canonical IQC 的委外收货来源" />
      {error ? <InlineAlert tone="danger" title="操作未完成">{error}</InlineAlert> : null}
      {!candidates.length && !error ? <Empty title="暂无待检委外收货" text="收货岗录入待检收货后会出现在这里" /> : null}
      <CompactRecordList data-testid="outsourcing-inspection-candidates">
        {candidates.map((candidate) => (
          <CompactRecord
            key={candidate.sourceId}
            title={candidate.sourceNo}
            subtitle={`${candidate.orderNo || '—'} / ${candidate.supplierName || candidate.supplierId}`}
            status={<StatusChip status={candidate.businessStatus}>{RECEIPT_STATUS_LABELS[candidate.businessStatus] || candidate.businessStatus}</StatusChip>}
            metadata={[
              { label: '成品', value: candidate.productCode || candidate.productId },
              { label: '数量', value: fmtNumber(candidate.quantity) },
              { label: '目标仓', value: candidate.warehouseId || '—' },
            ]}
            action={(
              <>
                <BusinessAction disabled={busy} onClick={() => createInspection(candidate)}>创建检验单</BusinessAction>
                <SecondaryButton
                  type="button"
                  onClick={() => navigation.navigateToPage('outsourcing', {
                    documentId: candidate.sourceId, documentType: 'OUTSOURCING_RECEIPT',
                  })}
                >
                  查看委外来源
                </SecondaryButton>
              </>
            )}
          />
        ))}
      </CompactRecordList>
      {focus?.documentType === 'IQC_INSPECTION' ? (
        <InspectionContextSheet
          navigation={navigation}
          inspectionId={focus.documentId}
          onClose={() => navigation.navigateToPage('outsourcing', {})}
        />
      ) : null}
    </>
  );
}

function InspectionContextSheet({ navigation, inspectionId, onClose }) {
  const [context, setContext] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api(`/api/iqc/${inspectionId}`, { method: 'GET' })
      .then(async (data) => {
        if (cancelled) return;
        const receiptId = data.inspection?.outsourcing_receipt_id;
        if (!receiptId) { setContext(null); return; }
        const quality = await api(`/api/procurement/outsourcing/receipts/${receiptId}/quality-context`, { method: 'GET' });
        if (!cancelled) setContext(quality.qualityContext);
      })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [inspectionId]);

  return (
    <DetailSheet title="委外检验来源" onClose={onClose}>
      {error ? <InlineAlert tone="danger" title="无法打开">{error}</InlineAlert> : null}
      {context ? (
        <>
          <DetailSection title="来源收货">
            <RecordCard
              title={context.receipt.receiptNo}
              subtitle={`${context.receipt.orderNo || '—'} / ${context.receipt.supplierName || context.receipt.supplierId}`}
              facts={[
                { label: '成品', value: context.receipt.productCode || context.receipt.productId },
                { label: '数量', value: fmtNumber(context.receipt.quantity) },
                { label: '目标仓', value: context.receipt.warehouseId || '—' },
                { label: '质量状态', value: context.qualityState?.label || '—' },
              ]}
            />
          </DetailSection>
          <BottomActionBar>
            <SecondaryButton type="button" onClick={onClose}>关闭</SecondaryButton>
            <PrimaryButton
              type="button"
              onClick={() => navigation.navigateToPage('iqc', { documentId: inspectionId, documentType: 'IQC_INSPECTION' })}
            >
              打开检验单
            </PrimaryButton>
          </BottomActionBar>
        </>
      ) : null}
    </DetailSheet>
  );
}

// 详情容器：移动端使用底部面板，桌面端保持单屏可读。
function DetailSheet({ title, onClose, children }) {
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <div className="sheet__body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {children}
        </div>
      </section>
    </div>
  );
}

// 委外加工费账单工作面（OUT-20 / Requirement §31.19.3）。
//
// 草稿账单只是「待结算事实的登记」；**过账**才产生 canonical 应付与凭证
// （金额上界按收货生效时确认的加工费份额执行）。已过账的账单可按行**红冲**。
//
// 后端合同：
//   - GET  /api/procurement/outsourcing/processing-fee-bills?outsourcingOrderId=
//   - POST /api/procurement/outsourcing/processing-fee-bills/:id/post
//   - POST /api/procurement/outsourcing/processing-fee-bills/:id/reverse
function ProcessingFeeBillPanel({ user, notify, outsourcingOrderId, onChanged }) {
  const [bills, setBills] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reversing, setReversing] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (outsourcingOrderId) params.set('outsourcingOrderId', outsourcingOrderId);
      const data = await api(`/api/procurement/outsourcing/processing-fee-bills?${params.toString()}`, { method: 'GET' });
      setBills(data.processingFeeBills || []);
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, [outsourcingOrderId]);

  useEffect(() => { load(); }, [load]);

  const post = async (billId) => {
    setBusy(true);
    try {
      await api(`/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, { method: 'POST', body: {} });
      await load();
      if (onChanged) onChanged();
      notify('加工费账单已过账');
    } catch (err) {
      setError(err.message || '过账失败');
    } finally {
      setBusy(false);
    }
  };

  const reverse = async (billId, itemId, quantity) => {
    setBusy(true);
    try {
      await api(`/api/procurement/outsourcing/processing-fee-bills/${billId}/reverse`, {
        method: 'POST',
        body: {
          items: [{ billItemId: itemId, quantity: Number(quantity) }],
          reason: '委外加工费红冲',
          businessDate: todayIso(),
        },
      });
      setReversing(null);
      await load();
      if (onChanged) onChanged();
      notify('加工费账单已红冲');
    } catch (err) {
      setError(err.message || '红冲失败');
    } finally {
      setBusy(false);
    }
  };

  const canPost = can(user, 'SUPPLIER_BILL_MANAGE');

  return (
    <DetailSection title="加工费账单">
      {error ? <InlineAlert tone="danger" title="操作未完成">{error}</InlineAlert> : null}
      <CompactRecordList data-testid="outsourcing-processing-fee-bills">
        {bills.map((bill) => (
          <CompactRecord
            key={bill.id}
            title={bill.billNo || bill.id}
            subtitle={`${bill.supplierInvoiceNo || '未填发票号'} / ${money(bill.netCents)}`}
            status={<StatusChip status={bill.status}>{bill.status}</StatusChip>}
            metadata={[
              { label: '账单日期', value: fmtDate(bill.billDate) },
              { label: '过账状态', value: bill.processingFeePostingState || '未过账' },
              { label: '已红冲金额', value: money(bill.processingFeeReversedCents) },
            ]}
            action={canPost && bill.status === 'DRAFT' ? (
              <SecondaryButton type="button" disabled={busy} onClick={() => post(bill.id)}>过账</SecondaryButton>
            ) : null}
          />
        ))}
      </CompactRecordList>
      {!bills.length ? <Empty title="尚无加工费账单" text="加工费账单在收货生效后由财务岗按已约定的加工费单价登记。" /> : null}
      {canPost && bills.some((bill) => bill.status === 'POSTED') ? (
        <BusinessContentSection title="红冲" description="已过账的加工费账单可按行红冲：数量守恒，金额反向">
          <CompactRecordList>
            {bills.filter((bill) => bill.status === 'POSTED').map((bill) => (
              <CompactRecord
                key={bill.id}
                title={bill.billNo || bill.id}
                subtitle={`已过账 ${money(bill.netCents)}`}
                metadata={(bill.items || []).map((item) => ({
                  label: `行 ${item.lineNo}`, value: `${fmtNumber(item.quantity)} × ${money(item.unitPriceCents)}`,
                }))}
                action={(bill.items || []).map((item) => (
                  <SecondaryButton
                    key={item.id}
                    type="button"
                    disabled={busy}
                    onClick={() => (reversing === `${bill.id}:${item.id}`
                      ? reverse(bill.id, item.id, item.quantity)
                      : setReversing(`${bill.id}:${item.id}`))}
                  >
                    {reversing === `${bill.id}:${item.id}` ? '确认红冲' : '红冲'}
                  </SecondaryButton>
                ))}
              />
            ))}
          </CompactRecordList>
        </BusinessContentSection>
      ) : null}
    </DetailSection>
  );
}

// 委外加工费会计档案维护面板（OUT-20 / C-P02）。
//
// 档案是过账的**唯一**科目来源：缺位或未批准时过账一律 fail closed。维护面
// 只做「列出 / 建立 / 改变批准状态」三件事；改政策就是换一套档案，既有档案的
// 科目、税率与有效期不被改写。维护权限是财务侧的过账权限。
//
// 后端合同：
//   - GET  /api/procurement/outsourcing/processing-fee-accounting-profiles
//   - POST /api/procurement/outsourcing/processing-fee-accounting-profiles
//   - POST /api/procurement/outsourcing/processing-fee-accounting-profiles/:id/approval
function ProcessingFeeProfilePanel({ user, notify }) {
  const [profiles, setProfiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    scope: 'SUPPLIER', supplierId: '', profileCode: '', taxMode: 'NO_TAX',
    processingFeeRole: 'OUTSOURCING_PROCESSING_FEE', effectiveFrom: todayIso(),
  });

  const load = useCallback(async () => {
    try {
      const data = await api('/api/procurement/outsourcing/processing-fee-accounting-profiles', { method: 'GET' });
      setProfiles(data.processingFeeAccountingProfiles || []);
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api('/api/procurement/outsourcing/processing-fee-accounting-profiles', {
        method: 'POST',
        body: {
          scope: form.scope,
          supplierId: form.scope === 'SUPPLIER' ? form.supplierId.trim() : undefined,
          profileCode: form.profileCode.trim(),
          taxMode: form.taxMode,
          processingFeeRole: form.processingFeeRole.trim(),
          effectiveFrom: form.effectiveFrom,
        },
      });
      setForm({ ...form, profileCode: '' });
      await load();
      notify('加工费会计档案已建立');
    } catch (err) {
      setError(err.message || '建立失败');
    } finally {
      setBusy(false);
    }
  };

  const changeState = async (profileId, approvalState) => {
    setBusy(true);
    try {
      await api(`/api/procurement/outsourcing/processing-fee-accounting-profiles/${profileId}/approval`, {
        method: 'POST', body: { approvalState },
      });
      await load();
      notify(approvalState === 'APPROVED' ? '档案已批准' : '档案已暂停');
    } catch (err) {
      setError(err.message || '状态变更失败');
    } finally {
      setBusy(false);
    }
  };

  const canManage = can(user, 'SUPPLIER_BILL_MANAGE');

  return (
    <BusinessContentSection
      title="加工费会计档案"
      description="委外加工费过账的科目只来自已批准的档案；档案缺位时过账一律拒绝"
    >
      {error ? <InlineAlert tone="danger" title="操作未完成">{error}</InlineAlert> : null}
      <CompactRecordList data-testid="outsourcing-processing-fee-profiles">
        {profiles.map((profile) => (
          <CompactRecord
            key={profile.id}
            title={profile.profileCode}
            subtitle={`${profile.scope === 'GLOBAL' ? '全局' : profile.supplierId} / ${profile.taxMode}`}
            status={<StatusChip status={profile.approvalState}>{profile.approvalState}</StatusChip>}
            metadata={[
              { label: '借方角色', value: profile.processingFeeRole },
              { label: '进项税角色', value: profile.inputTaxRole || '—' },
              { label: '差异角色', value: profile.varianceRole || '—' },
              { label: '生效区间', value: `${fmtDate(profile.effectiveFrom)} → ${fmtDate(profile.effectiveTo)}` },
            ]}
            action={canManage ? (
              profile.approvalState === 'APPROVED' ? (
                <SecondaryButton type="button" disabled={busy} onClick={() => changeState(profile.id, 'SUSPENDED')}>暂停</SecondaryButton>
              ) : (
                <SecondaryButton type="button" disabled={busy} onClick={() => changeState(profile.id, 'APPROVED')}>批准</SecondaryButton>
              )
            ) : null}
          />
        ))}
      </CompactRecordList>
      {!profiles.length ? <Empty title="暂无会计档案" text="没有已批准的档案时，委外加工费过账一律拒绝。" /> : null}
      {canManage ? (
        <form onSubmit={create}>
          <div className="field-grid">
            <label>
              <span>范围</span>
              <select
                aria-label="档案范围"
                value={form.scope}
                onChange={(event) => setForm({ ...form, scope: event.target.value })}
              >
                <option value="SUPPLIER">供应商级</option>
                <option value="GLOBAL">全局</option>
              </select>
            </label>
            <label>
              <span>供应商</span>
              <input
                aria-label="档案供应商"
                value={form.supplierId}
                disabled={form.scope !== 'SUPPLIER'}
                onChange={(event) => setForm({ ...form, supplierId: event.target.value })}
              />
            </label>
            <label>
              <span>档案编码</span>
              <input
                aria-label="档案编码"
                value={form.profileCode}
                onChange={(event) => setForm({ ...form, profileCode: event.target.value })}
              />
            </label>
            <label>
              <span>税务口径</span>
              <select
                aria-label="档案税务口径"
                value={form.taxMode}
                onChange={(event) => setForm({ ...form, taxMode: event.target.value })}
              >
                <option value="NO_TAX">不计进项税</option>
                <option value="EXCLUSIVE">不含税</option>
                <option value="INCLUSIVE">含税</option>
              </select>
            </label>
            <label>
              <span>加工费借方角色码</span>
              <input
                aria-label="档案加工费借方角色码"
                value={form.processingFeeRole}
                onChange={(event) => setForm({ ...form, processingFeeRole: event.target.value })}
              />
            </label>
            <label>
              <span>生效起始日</span>
              <input
                aria-label="档案生效起始日"
                type="date"
                value={form.effectiveFrom}
                onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
              />
            </label>
          </div>
          <BusinessAction hierarchy="primary" type="submit" disabled={busy}>建立档案</BusinessAction>
        </form>
      ) : null}
    </BusinessContentSection>
  );
}

// 期初委外订单创建面（OUT-23 / Requirement §31.19.5）。
//
// 期初单据承载**上线日之前已经存在的委外事实**：可以只有订单（没有供应商 WIP
// 结余），也可以带物料行承载期初委外 WIP。期初不产生历史凭证与应付。
//
// 后端合同：
//   - POST /api/procurement/outsourcing/opening-orders
function CreateOpeningOrderSheet({ user, notify, onClose, onCreated }) {
  const [form, setForm] = useState({
    supplierId: '', productId: '', orderQuantity: '', unit: 'EA',
    businessDate: todayIso(), remark: '',
  });
  const [materials, setMaterials] = useState([{ productId: '', quantity: '', sourceWarehouseId: 'warehouse-001' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const updateMaterial = (index, patch) => {
    setMaterials(materials.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const items = materials
        .filter((item) => item.productId.trim() && String(item.quantity).trim() !== '')
        .map((item) => ({
          productId: item.productId.trim(),
          quantity: Number(item.quantity),
          sourceWarehouseId: item.sourceWarehouseId.trim() || undefined,
        }));
      await api('/api/procurement/outsourcing/opening-orders', {
        method: 'POST',
        body: {
          supplierId: form.supplierId.trim(),
          productId: form.productId.trim(),
          orderQuantity: Number(form.orderQuantity),
          unit: form.unit.trim() || undefined,
          businessDate: form.businessDate,
          remark: form.remark.trim() || undefined,
          items: items.length ? items : undefined,
        },
      });
      if (onCreated) onCreated();
      notify('期初委外订单已建立');
    } catch (err) {
      setError(err.message || '建立失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="新建期初委外订单" onClose={onClose}>
      <form onSubmit={submit}>
        {error ? <InlineAlert tone="danger" title="操作未完成">{error}</InlineAlert> : null}
        <FormRow label="供应商">
          <TextField
            aria-label="期初供应商"
            value={form.supplierId}
            onChange={(event) => setForm({ ...form, supplierId: event.target.value })}
          />
        </FormRow>
        <FormRow label="委外成品">
          <TextField
            aria-label="期初委外成品"
            value={form.productId}
            onChange={(event) => setForm({ ...form, productId: event.target.value })}
          />
        </FormRow>
        <FormRow label="订单数量">
          <QuantityField
            aria-label="期初订单数量"
            value={form.orderQuantity}
            onChange={(event) => setForm({ ...form, orderQuantity: event.target.value })}
          />
        </FormRow>
        <FormRow label="业务日期">
          <DateField
            aria-label="期初业务日期"
            value={form.businessDate}
            onChange={(event) => setForm({ ...form, businessDate: event.target.value })}
          />
        </FormRow>
        <FormRow label="备注">
          <TextField
            aria-label="期初备注"
            value={form.remark}
            onChange={(event) => setForm({ ...form, remark: event.target.value })}
          />
        </FormRow>
        <FormRow label="期初物料行">
          <div>
            {materials.map((item, index) => (
              <div key={index} className="field-grid">
                <TextField
                  aria-label={`期初物料 ${index + 1} 货品`}
                  value={item.productId}
                  onChange={(event) => updateMaterial(index, { productId: event.target.value })}
                />
                <QuantityField
                  aria-label={`期初物料 ${index + 1} 数量`}
                  value={item.quantity}
                  onChange={(event) => updateMaterial(index, { quantity: event.target.value })}
                />
                <TextField
                  aria-label={`期初物料 ${index + 1} 来源仓`}
                  value={item.sourceWarehouseId}
                  onChange={(event) => updateMaterial(index, { sourceWarehouseId: event.target.value })}
                />
              </div>
            ))}
            <BusinessAction
              type="button"
              onClick={() => setMaterials([...materials, { productId: '', quantity: '', sourceWarehouseId: 'warehouse-001' }])}
            >
              增加物料行
            </BusinessAction>
          </div>
        </FormRow>
        <FormActions onClose={onClose} saveText="建立期初委外订单" />
      </form>
    </Modal>
  );
}
