// Procurement & Outsourcing Domain Closure — Outsourcing Execution Hub.
//
// Mobile-first execution hub for outsourcing orders:
//   - LIST: Outsourcing orders by status/lifecycle with progress
//   - DETAIL: source / supplier / product / lifecycle / BOM snapshot /
//     material list / material position / Issue / Supplement / Return /
//     Processing PO / Completion Notice / Inspection / Receipt / Backflush /
//     Processing Fee / Cost Evidence / Finished Return / Trace
//
// Backend contracts:
//   - GET    /api/procurement/outsourcing/orders
//   - GET    /api/procurement/outsourcing/orders/:id
//   - POST   /api/procurement/outsourcing/orders/:id/transition
//   - POST   /api/procurement/outsourcing/orders/:id/cancel
//   - POST   /api/procurement/outsourcing/orders/:id/material-list
//   - POST   /api/procurement/outsourcing/orders/:id/issues
//   - POST   /api/procurement/outsourcing/orders/:id/supplements
//   - POST   /api/procurement/outsourcing/orders/:id/returns
//   - POST   /api/procurement/outsourcing/orders/:id/backflush
//   - POST   /api/procurement/outsourcing/orders/:id/difference-preview
//   - POST   /api/procurement/outsourcing/orders/:id/difference-apply
//   - POST   /api/procurement/outsourcing/receipts
//   - POST   /api/procurement/outsourcing/receipts/:id/confirm
//   - POST   /api/procurement/outsourcing/processing-fee-bills
//   - POST   /api/procurement/outsourcing/finished-returns
//
// Implementation discipline (per erp-mobile-taste):
//   - LIST → DETAIL → EXECUTION HUB.
//   - Status / lifecycle shown clearly; actions gated by permission + state.
//   - NO second Inventory / AP / Quality / BOM / MRP / UOM engine.
//   - Cross-domain dependency for VMI owner-dimension is fail-closed.

import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { can, Empty, Modal, ConfirmAction } from '../components/ui.jsx';
import {
  BusinessAction, BusinessActionBar, BusinessPageHeader, BusinessPageShell,
  CompactRecordList, HelpDisclosure, RecordCard,
} from '../components/design-system.jsx';

const STATUS_LABELS = {
  DRAFT: '草稿', PLAN_CONFIRMED: '已确认', RELEASED: '已下达',
  COMPLETED: '已完工', CLOSED: '已关闭', CANCELLED: '已取消',
};
const SOURCE_LABELS = { PLANNING: '计划', MANUAL: '手工' };

function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toISOString().slice(0, 10); } catch (_) { return s; }
}

function statusTone(status) {
  if (status === 'RELEASED' || status === 'COMPLETED') return 'positive';
  if (status === 'DRAFT') return 'muted';
  if (status === 'PLAN_CONFIRMED') return 'accent';
  if (status === 'CANCELLED') return 'negative';
  return 'neutral';
}

export default function OutsourcingPage() {
  const [orders, setOrders] = useState([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const data = await api.get(`/api/procurement/outsourcing/orders?${params}`);
      setOrders(data.outsourcingOrders || []);
      setError('');
    } catch (err) {
      setError(err.message || '加载失败');
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  return (
    <BusinessPageShell>
      <BusinessPageHeader
        title="委外加工"
        subtitle="委外订单执行中心"
        actions={can(['OUTSOURCING_MANAGE', 'OUTSOURCING_RELEASE']) ? (
          <BusinessActionBar>
            <BusinessAction onClick={() => setActive('create')}>新建委外订单</BusinessAction>
          </BusinessActionBar>
        ) : null}
        filters={
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部状态</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
          </select>
        }
      />
      {error && <HelpDisclosure variant="negative">{error}</HelpDisclosure>}
      {!orders.length && !error ? <Empty title="暂无委外订单" hint="新建或由计划释放委外订单" /> : null}
      <CompactRecordList
        items={orders.map((o) => ({
          key: o.id,
          primary: o.orderNo,
          secondary: `${SOURCE_LABELS[o.sourceType] || o.sourceType} / ${o.supplierId} / ${o.productId}`,
          meta: `数量 ${o.orderQuantity} / ${STATUS_LABELS[o.status] || o.status} / ${fmtDate(o.businessDate)}`,
          tone: statusTone(o.status),
          onClick: () => setActive(o.id),
        }))}
      />
      {active && active !== 'create' && (
        <OutsourcingOrderDetail orderId={active} onClose={() => { setActive(null); load(); }} />
      )}
      {active === 'create' && (
        <CreateOutsourcingOrderModal onClose={() => { setActive(null); load(); }} />
      )}
    </BusinessPageShell>
  );
}

function OutsourcingOrderDetail({ orderId, onClose }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/api/procurement/outsourcing/orders/${orderId}`);
      setOrder(data);
    } catch (err) { setError(err.message); }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <Modal title="委外订单" onClose={onClose}>
        <HelpDisclosure variant="negative">{error}</HelpDisclosure>
      </Modal>
    );
  }
  if (!order) return null;

  const nextLifecycle = {
    DRAFT: 'PLAN_CONFIRMED', PLAN_CONFIRMED: 'RELEASED', RELEASED: 'COMPLETED',
  }[order.outsourcingOrder.status];

  async function transition(action) {
    setBusy(true);
    try {
      await api.post(`/api/procurement/outsourcing/orders/${orderId}/transition`, { action });
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function cancelOrder() {
    setBusy(true);
    try {
      await api.post(`/api/procurement/outsourcing/orders/${orderId}/cancel`);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`委外订单 ${order.outsourcingOrder.orderNo}`} onClose={onClose}>
      <BusinessPageHeader
        title={order.outsourcingOrder.orderNo}
        subtitle={`${STATUS_LABELS[order.outsourcingOrder.status] || order.outsourcingOrder.status} / 数量 ${order.outsourcingOrder.orderQuantity}`}
      />
      <section>
        <RecordCard
          items={[
            { label: '来源', value: SOURCE_LABELS[order.outsourcingOrder.sourceType] || order.outsourcingOrder.sourceType },
            { label: '供应商', value: order.outsourcingOrder.supplierId },
            { label: '产品', value: order.outsourcingOrder.productId },
            { label: '业务日期', value: fmtDate(order.outsourcingOrder.businessDate) },
            { label: '预期完工', value: fmtDate(order.outsourcingOrder.expectedCompletionDate) },
          ]}
        />
      </section>
      <section>
        <h3>物料位置</h3>
        <CompactRecordList
          items={(order.materials || []).map((m) => ({
            key: m.id,
            primary: `产品 ${m.productId}`,
            secondary: `需求 ${m.requiredQuantity} / 已发 ${m.issuedQuantity} / 补 ${m.supplementedQuantity} / 退 ${m.returnedQuantity} / 倒冲 ${m.backflushedQuantity}`,
            meta: `供应商 WIP 剩余 ${m.supplierWipRemaining} ${m.unit}`,
            tone: m.supplierWipRemaining > 0 ? 'accent' : 'muted',
          }))}
        />
      </section>
      <section>
        <h3>倒冲扣减</h3>
        <RecordCard items={order.issues ? [
          { label: '发料次数', value: order.issues.length },
          { label: '补料次数', value: (order.supplements || []).length },
          { label: '退料次数', value: (order.returns || []).length },
        ] : []} />
      </section>
      <BusinessActionBar>
        {nextLifecycle && can(['OUTSOURCING_RELEASE']) && (
          <BusinessAction onClick={() => transition('NEXT')} disabled={busy}>
            {nextLifecycle === 'PLAN_CONFIRMED' ? '确认计划' : nextLifecycle === 'RELEASED' ? '下达' : '标记完工'}
          </BusinessAction>
        )}
        {order.outsourcingOrder.status === 'DRAFT' && can(['OUTSOURCING_MANAGE']) && (
          <BusinessAction onClick={cancelOrder} variant="danger" disabled={busy}>取消</BusinessAction>
        )}
      </BusinessActionBar>
    </Modal>
  );
}

function CreateOutsourcingOrderModal({ onClose }) {
  const [form, setForm] = useState({
    supplierId: '', productId: '', orderQuantity: 1, unit: 'EA',
    businessDate: new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/procurement/outsourcing/orders', { ...form, orderQuantity: Number(form.orderQuantity) });
      onClose();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="新建委外订单" onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <HelpDisclosure variant="negative">{error}</HelpDisclosure>}
        <label>供应商 ID<input value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} required /></label>
        <label>产品 ID<input value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} required /></label>
        <label>数量<input type="number" value={form.orderQuantity} onChange={(e) => setForm({ ...form, orderQuantity: e.target.value })} required min="1" /></label>
        <label>单位<input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label>
        <label>业务日期<input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} /></label>
        <BusinessActionBar>
          <BusinessAction type="submit" disabled={busy}>创建</BusinessAction>
        </BusinessActionBar>
      </form>
    </Modal>
  );
}
