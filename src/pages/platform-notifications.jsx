// Platform 通知中心（PL-11）—— 既有页面扩展。
//
// 设计来源：docs/design/platform.md §32.7.2、§32.7.3；Requirement §36.7。
//
// 扩展点：分类 / 优先级 / 跳转 / 未读徽标 / 订阅管理。
// 列表与未读计数同源（后端同一 WHERE 条件：当前用户 + is_read）。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Badge, can, dateTime } from '../components/ui.jsx';
import {
  BusinessPageHeader, BusinessPageShell, HelpDisclosure, InlineAlert, SegmentedControl, Sheet,
} from '../components/design-system.jsx';
import { useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import '../styles/platform-operations.css';

const TYPE_LABELS = { INFO: '信息', WARNING: '警告', SUCCESS: '成功', ERROR: '错误' };
const TYPE_TONES = { INFO: 'info', WARNING: 'warning', SUCCESS: 'success', ERROR: 'danger' };
const PRIORITY_LABELS = { LOW: '低', NORMAL: '普通', HIGH: '高' };

const TABS = [
  { value: 'ALL', label: '全部' },
  { value: 'UNREAD', label: '未读' },
  { value: 'SUBSCRIPTIONS', label: '订阅' },
];

// 通知分类 → 可跳转的工作面。通知生产者在站内通知里不带 actionUrl 时，
// 由分类推导跳转目标，落到该分类的 canonical 工作面。
const CATEGORY_ROUTES = {
  APPROVAL_SALES_ORDER: 'orders',
  APPROVAL_PURCHASE_ORDER: 'purchase-orders',
  APPROVAL_PURCHASE_REQUISITION: 'purchase-requisitions',
  APPROVAL_INVENTORY_CHECK: 'inventory',
  APPROVAL_ACCOUNTING_VOUCHER: 'accounting',
  APPROVAL_PRODUCTION_ORDER: 'production-orders',
  APPROVAL_CREDIT_SPECIAL_APPROVAL: 'credit-special-approvals',
  WORKFLOW: 'workflow-tasks',
  INVENTORY_PERIOD_CLOSE: 'inventory-month-end',
};

function jumpRouteOf(item) {
  if (item.actionUrl) {
    const raw = String(item.actionUrl);
    const hashIndex = raw.indexOf('#');
    const hash = hashIndex >= 0 ? raw.slice(hashIndex + 1) : raw.replace(/^\//, '');
    const routeKey = hash.split('?')[0];
    return routeKey || null;
  }
  return CATEGORY_ROUTES[item.category] || null;
}

export function Notifications({ user, notify, workflowTaskCount = 0 }) {
  const navigation = useAppNavigation();
  const canManage = can(user, 'NOTIFICATION_MANAGE');
  const [tab, setTab] = useState('ALL');
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [subscriptions, setSubscriptions] = useState([]);
  const [subscriptionSheet, setSubscriptionSheet] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const query = tab === 'UNREAD' ? '?unreadOnly=true&limit=100' : '?limit=100';
      const response = await api(`/api/notifications${query}`);
      setItems(response.notifications || []);
      setUnreadCount(response.unreadCount || 0);
      setTotal(response.total || 0);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, notify]);

  const loadSubscriptions = useCallback(async () => {
    try {
      const response = await api('/api/platform/notification-subscriptions');
      setSubscriptions(response.subscriptions || []);
    } catch (error) {
      notify(error.message, 'error');
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === 'SUBSCRIPTIONS') void loadSubscriptions(); }, [tab, loadSubscriptions]);

  async function markAllRead() {
    try {
      const response = await api('/api/notifications/read', { method: 'POST', body: {} });
      setUnreadCount(response.unreadCount || 0);
      notify('已全部标为已读');
      await load();
    } catch (error) { notify(error.message, 'error'); }
  }

  async function markRead(notificationId) {
    try {
      const response = await api('/api/notifications/read', { method: 'POST', body: { notificationId } });
      setUnreadCount(response.unreadCount || 0);
      await load();
    } catch (error) { notify(error.message, 'error'); }
  }

  const categories = useMemo(() => {
    const distinct = new Set(items.map((item) => item.category).filter(Boolean));
    return [...distinct].sort();
  }, [items]);

  function jumpTo(item) {
    const routeKey = jumpRouteOf(item);
    if (!routeKey) return;
    if (!navigation.canNavigate(routeKey)) {
      notify('没有权限打开该单据所在的工作面', 'error');
      return;
    }
    navigation.navigate({ routeKey });
  }

  return (
    <BusinessPageShell className="notifications-v15 platform-ops" width="rail" data-testid="platform-notifications-page">
      <BusinessPageHeader
        title="通知中心"
        context={`${unreadCount} 条未读 / 共 ${total} 条`}
        help={<HelpDisclosure summary="通知说明">
          <p>桌面通知中心与移动端“消息”共享同一数据源和已读状态；未读徽标与审批待办徽标彼此独立。</p>
        </HelpDisclosure>}
      />

      <div className="platform-ops__tabs">
        <SegmentedControl label="通知分区" options={TABS} value={tab} onChange={setTab}/>
      </div>

      {tab !== 'SUBSCRIPTIONS' && (
        <div className="platform-ops__toolbar">
          <strong>共 {items.length} 条</strong>
          <button type="button" className="secondary" onClick={markAllRead}>全部标为已读</button>
        </div>
      )}

      {tab === 'SUBSCRIPTIONS' && (
        <section>
          <p className="platform-ops__note">
            订阅决定「按角色 / 按订阅」路由的通知是否送达；外部通道（邮件 / 短信）本轮为 OUT_OF_SCOPE。
          </p>
          {subscriptions.length === 0 && <div className="platform-ops__empty">还没有订阅。</div>}
          <div className="platform-ops__list">
            {subscriptions.map((subscription) => (
              <article key={`${subscription.category}:${subscription.eventType}`} className="platform-ops__card">
                <header><h3>{subscription.category}</h3></header>
                <dl className="platform-ops__facts">
                  <div><dt>事件</dt><dd>{subscription.eventType}</dd></div>
                  <div><dt>通道</dt><dd>{subscription.channel}</dd></div>
                </dl>
              </article>
            ))}
          </div>
          {canManage && (
            <div className="platform-ops__toolbar">
              <button type="button" className="primary" onClick={() => setSubscriptionSheet({ mode: 'create' })}>＋ 新建订阅</button>
            </div>
          )}
        </section>
      )}

      {tab !== 'SUBSCRIPTIONS' && (
        <div className="platform-ops__list">
          {workflowTaskCount > 0 && (
            <article className="platform-ops__card" data-testid="platform-workflow-task-badge">
              <header>
                <h3>我的流程任务</h3>
                <span className="platform-ops__badge is-pending">{workflowTaskCount} 条待处理</span>
              </header>
              <p>通用工作流引擎的待办独立于业务审批中心的待办计数，两者互不合并。</p>
              <div className="platform-ops__actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (!navigation.canNavigate('workflow-tasks')) { notify('没有权限打开流程任务工作面', 'error'); return; }
                    navigation.navigate({ routeKey: 'workflow-tasks' });
                  }}
                >
                  前往处理
                </button>
              </div>
            </article>
          )}
          {items.map((item) => {
            const routeKey = jumpRouteOf(item);
            return (
              <article key={item.id} className="platform-ops__card">
                <header>
                  <h3>{item.title}</h3>
                  <Badge type={TYPE_TONES[item.type]}>{TYPE_LABELS[item.type] || item.type}</Badge>
                </header>
                {item.content && <p>{item.content}</p>}
                <dl className="platform-ops__facts">
                  <div><dt>分类</dt><dd>{item.category || '—'}</dd></div>
                  <div><dt>优先级</dt><dd>{PRIORITY_LABELS[item.priority] || item.priority}</dd></div>
                  <div><dt>时间</dt><dd>{dateTime(item.createdAt)}</dd></div>
                  <div><dt>状态</dt><dd>{item.isRead ? '已读' : '未读'}</dd></div>
                </dl>
                <div className="platform-ops__actions">
                  {!item.isRead && (
                    <button type="button" className="secondary" onClick={() => markRead(item.id)}>标为已读</button>
                  )}
                  {routeKey && (
                    <button type="button" className="secondary" onClick={() => jumpTo(item)}>前往处理</button>
                  )}
                </div>
              </article>
            );
          })}
          {!loading && items.length === 0 && <div className="platform-ops__empty">没有通知。</div>}
        </div>
      )}

      {subscriptionSheet && (
        <SubscriptionSheet
          categories={categories}
          canManage={canManage}
          notify={notify}
          onClose={() => setSubscriptionSheet(null)}
          onChanged={async () => { setSubscriptionSheet(null); await loadSubscriptions(); }}
        />
      )}
    </BusinessPageShell>
  );
}

function SubscriptionSheet({ categories, canManage, notify, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ category: categories[0] || '', eventType: '', subscribed: true });

  async function save(subscribed = form.subscribed) {
    setBusy(true);
    try {
      await api('/api/platform/notification-subscriptions', {
        method: 'POST',
        body: { category: form.category, eventType: form.eventType, subscribed },
      });
      notify(subscribed ? '订阅已建立' : '订阅已取消', 'success');
      await onChanged();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="通知订阅" onClose={onClose}>
      <div className="platform-ops__form">
        <label className="form-row">
          <span className="field-label">分类 *</span>
          <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value.toUpperCase() })}
            placeholder="APPROVAL_SALES_ORDER"/>
        </label>
        <label className="form-row">
          <span className="field-label">事件类型 *</span>
          <input value={form.eventType} onChange={(event) => setForm({ ...form, eventType: event.target.value.toUpperCase() })}
            placeholder="APPROVAL_PENDING"/>
        </label>
        <InlineAlert tone="info">
          订阅只影响站内通知的「按订阅」路由；取消订阅即取消该分类事件的送达。
        </InlineAlert>
      </div>
      <div className="bottom-action-bar">
        <button type="button" className="secondary" onClick={onClose}>取消</button>
        {canManage && (
          <>
            <button type="button" className="secondary" disabled={busy}
              onClick={() => save(false)}>取消订阅</button>
            <button type="button" className="primary" disabled={busy} onClick={() => save(true)}>订阅</button>
          </>
        )}
      </div>
    </Sheet>
  );
}
