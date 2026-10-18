// Wave 7 — Sales Prepayment Gates + Reservation Intents UI.
//
// solution.md §29.16 / §29.17 + document.md §34.3.12 / §34.3.13.
//
// Two screens rendered from the same page module:
//   * PrepaymentGates     — required-amount → three gate stages (PLANNING_RELEASE,
//                           RESERVATION, DELIVERY) → PASS / WARN / BLOCK / OVERRIDE_REQUIRED
//   * ReservationIntents  — request → grant → consume → release; four reservation modes
//                           (INVENTORY_LOCK / MANUAL_RESERVATION / ON_HAND_RESERVATION /
//                           EXPECTED_SUPPLY_RESERVATION) with finite-capacity audit.
//
// Both screens keep Sales's intent-only role. Canonical truth lives in:
//   * Finance `settlement_unapplied_balances` (R-SAL-15 parent lock)
//   * Inventory `inventory_locks` (INVENTORY_LOCK mode)
//   * Planning `planning_reservations` (MANUAL / ON_HAND / EXPECTED modes)
// Sales does NOT maintain a shadow balance — every UI mutation is a thin
// delegating adapter call. The UI surfaces block reasons + remaining capacity.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAppNavigation } from '../navigation/AppNavigationContext.jsx';

const GATE_STAGES = ['PLANNING_RELEASE', 'RESERVATION', 'DELIVERY'];
const GATE_DECISION_LABELS = {
  PASS: '通过',
  WARN: '部分通过',
  BLOCK: '不通过',
  OVERRIDE_REQUIRED: '需特批',
};
const RESERVATION_MODE_LABELS = {
  INVENTORY_LOCK: '库存锁定',
  MANUAL_RESERVATION: '手工预留',
  ON_HAND_RESERVATION: '在库量预留',
  EXPECTED_SUPPLY_RESERVATION: '预计量预留',
};
const INTENT_STATE_LABELS = {
  NONE: '未提交',
  REQUESTED: '已申请',
  GRANTED: '已授信',
  RELEASED: '已释放',
  CONSUMED: '已消耗',
};

function formatCents(value) {
  const v = Number(value || 0);
  return `${(v / 100).toFixed(2)} 元`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
}

async function callApi(method, path, body) {
  // `api()` already throws ApiError on non-2xx and returns parsed JSON.
  return api(path, body ? { method, body } : { method });
}

function useApiList(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await callApi('GET', path);
      setData(json);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, deps);
  return { data, error, loading, reload };
}

// ---------- Prepayment Gates ----------

export function PrepaymentGates({ query = {} } = {}) {
  const navigation = useAppNavigation();
  const initialSalesOrderId = query.salesOrderId || (navigation?.target?.salesOrderId) || '';
  const [salesOrderId, setSalesOrderId] = useState(initialSalesOrderId);
  const [requiredAmount, setRequiredAmount] = useState('');
  const [ratioBasis, setRatioBasis] = useState('ORDER_VALUE');
  const [snapshotKey, setSnapshotKey] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  const requirements = useApiList('/api/sales-prepayment-requirements', []);
  const gateResults = useApiList(
    salesOrderId ? `/api/sales-prepayment-gate-results?salesOrderId=${encodeURIComponent(salesOrderId)}` : '/api/sales-prepayment-gate-results',
    [salesOrderId],
  );

  const filteredRequirements = useMemo(() => {
    if (!requirements.data?.requirements) return [];
    if (!salesOrderId) return requirements.data.requirements;
    return requirements.data.requirements.filter((r) => r.sales_order_id === salesOrderId);
  }, [requirements.data, salesOrderId]);

  async function createRequirement() {
    if (!salesOrderId || !requiredAmount) {
      setFlash({ type: 'error', message: '请填写销售订单与预付款金额' });
      return;
    }
    setBusy(true);
    try {
      await callApi('POST', '/api/sales-prepayment-requirements', {
        salesOrderId,
        lineNo: 0,
        requiredAmountCents: Number(requiredAmount),
        ratioBasis,
      });
      setFlash({ type: 'ok', message: '预付款要求已保存' });
      setRequiredAmount('');
      await Promise.all([requirements.reload(), gateResults.reload()]);
    } catch (e) {
      setFlash({ type: 'error', message: e.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function evaluate(stage) {
    setBusy(true);
    try {
      await callApi('POST', `/api/sales-orders/${encodeURIComponent(salesOrderId)}/prepayment-gate/${stage}`, snapshotKey ? { snapshotKey } : {});
      setFlash({ type: 'ok', message: `门 ${stage} 评估完成` });
      await gateResults.reload();
    } catch (e) {
      setFlash({ type: 'error', message: e.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function overrideGate(id) {
    if (!overrideReason.trim()) {
      setFlash({ type: 'error', message: '请填写覆盖原因' });
      return;
    }
    setBusy(true);
    try {
      await callApi('POST', `/api/sales-prepayment-gate-results/${encodeURIComponent(id)}/override`, { reason: overrideReason });
      setFlash({ type: 'ok', message: '门结果已覆盖' });
      setOverrideReason('');
      await gateResults.reload();
    } catch (e) {
      setFlash({ type: 'error', message: e.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="prepayment-gates">
      <h2>预付款门</h2>
      <p className="muted">销售预付款门负责读取 Finance 端预付款余额，按 PLANNING_RELEASE / RESERVATION / DELIVERY 三个阶段评估订单是否能继续推进。所有评估都在同一事务内持有 Finance 父级结算余额锁，避免并发通过陈旧余额放行。</p>

      <div className="form-row">
        <label>
          <span>销售订单</span>
          <input value={salesOrderId} onChange={(e) => setSalesOrderId(e.target.value)} placeholder="so-id" />
        </label>
        <label>
          <span>预付款要求 (分)</span>
          <input type="number" min="0" value={requiredAmount} onChange={(e) => setRequiredAmount(e.target.value)} placeholder="例如 50000" />
        </label>
        <label>
          <span>比例基础</span>
          <select value={ratioBasis} onChange={(e) => setRatioBasis(e.target.value)}>
            <option value="ORDER_VALUE">按订单总额</option>
            <option value="LINE_VALUE">按订单行</option>
          </select>
        </label>
        <label>
          <span>幂等快照键</span>
          <input value={snapshotKey} onChange={(e) => setSnapshotKey(e.target.value)} placeholder="留空使用系统自动键" />
        </label>
        <button type="button" className="primary" disabled={busy} onClick={createRequirement}>保存要求</button>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.message}</div>}

      <div className="stage-row" aria-label="gate-stages">
        {GATE_STAGES.map((stage) => (
          <button key={stage} type="button" disabled={busy || !salesOrderId} onClick={() => evaluate(stage)}>{stage}</button>
        ))}
      </div>

      <h3>已配置预付款要求</h3>
      {requirements.error && <div className="flash flash-error">{requirements.error}</div>}
      {requirements.loading && <p className="muted">加载中...</p>}
      {filteredRequirements.length === 0 ? (
        <p className="muted">尚未配置预付款要求。请填写上方表单保存。</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>订单</th>
              <th>金额</th>
              <th>比例基础</th>
              <th>生效期间</th>
            </tr>
          </thead>
          <tbody>
            {filteredRequirements.map((row) => (
              <tr key={row.id}>
                <td>{row.sales_order_id}</td>
                <td>{formatCents(row.required_amount_cents)}</td>
                <td>{row.ratio_basis}</td>
                <td>{row.effective_from || '起'} → {row.effective_to || '∞'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>门评估结果</h3>
      {gateResults.error && <div className="flash flash-error">{gateResults.error}</div>}
      {!gateResults.data?.results?.length ? (
        <p className="muted">尚无评估记录。请先点击上方阶段按钮触发评估。</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>阶段</th>
              <th>决定</th>
              <th>已应用/已退款/剩余</th>
              <th>原因/特批</th>
              <th>快照键</th>
              <th>动作</th>
            </tr>
          </thead>
          <tbody>
            {gateResults.data.results.map((row) => (
              <tr key={row.id}>
                <td>{row.stage}</td>
                <td><strong>{GATE_DECISION_LABELS[row.gateDecision] || row.gateDecision}</strong></td>
                <td>
                  <div>要求剩余 {formatCents(row.requiredRemainingCents)}</div>
                  <div>可参与 {formatCents(row.eligibleAdvanceCents)}</div>
                  <div className="muted">已应用 {formatCents(row.appliedAmountCents)} / 已退款 {formatCents(row.refundedAmountCents)}</div>
                </td>
                <td>{row.overrideReason || <span className="muted">—</span>}</td>
                <td><code>{row.snapshotKey}</code></td>
                <td>
                  {row.gateDecision !== 'PASS' && row.gateDecision !== 'OVERRIDE_REQUIRED' ? (
                    <div className="inline-form">
                      <input placeholder="覆盖原因" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                      <button type="button" disabled={busy} onClick={() => overrideGate(row.id)}>特批</button>
                    </div>
                  ) : (
                    <span className="muted">无需动作</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------- Reservation Intents ----------

export function ReservationIntents({ query = {} } = {}) {
  const navigation = useAppNavigation();
  const initialSalesOrderId = query.salesOrderId || (navigation?.target?.salesOrderId) || '';
  const [salesOrderId, setSalesOrderId] = useState(initialSalesOrderId);
  const [salesOrderItemId, setSalesOrderItemId] = useState('');
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [mode, setMode] = useState('INVENTORY_LOCK');
  const [quantity, setQuantity] = useState('');
  const [expectedSupplySourceType, setExpectedSupplySourceType] = useState('PLANNED_ORDER');
  const [expectedSupplySourceId, setExpectedSupplySourceId] = useState('');
  const [expectedSupplyCapacity, setExpectedSupplyCapacity] = useState('');
  const [consumerEvent, setConsumerEvent] = useState('MANUAL');
  const [consumeQty, setConsumeQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  const intents = useApiList(
    salesOrderId ? `/api/sales-reservation-intents?salesOrderId=${encodeURIComponent(salesOrderId)}` : '/api/sales-reservation-intents',
    [salesOrderId],
  );

  async function reload() {
    await intents.reload();
  }

  async function requestIntent() {
    if (!salesOrderId || !productId || !quantity) {
      setFlash({ type: 'error', message: '请填写订单、产品与数量' });
      return;
    }
    setBusy(true);
    try {
      const body = {
        salesOrderId,
        salesOrderItemId: salesOrderItemId || null,
        productId,
        warehouseId: warehouseId || null,
        reservationMode: mode,
        quantity: Number(quantity),
      };
      if (mode === 'EXPECTED_SUPPLY_RESERVATION') {
        body.expectedSupplySourceType = expectedSupplySourceType;
        body.expectedSupplySourceId = expectedSupplySourceId || null;
        body.expectedSupplyCapacity = Number(expectedSupplyCapacity || 0);
      }
      await callApi('POST', '/api/sales-reservation-intents', body);
      setFlash({ type: 'ok', message: '预留意图已提交' });
      setQuantity('');
      await reload();
    } catch (e) {
      setFlash({ type: 'error', message: e.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function act(intentId, action) {
    setBusy(true);
    try {
      const body = {};
      if (action === 'consume') body.quantity = Number(consumeQty);
      if (action === 'release') body.consumerEvent = consumerEvent;
      await callApi('POST', `/api/sales-reservation-intents/${encodeURIComponent(intentId)}/${action}`, body);
      setFlash({ type: 'ok', message: `${action} 完成` });
      await reload();
    } catch (e) {
      setFlash({ type: 'error', message: e.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="reservation-intents">
      <h2>预留意图</h2>
      <p className="muted">销售仅持有预留意图。库存锁定事实由 Inventory 维护，预备量与有限供给由 Planning 维护。EXPECTED 模式必须提供真实有限容量，缺省时拒绝放行。</p>

      <div className="form-row">
        <label>
          <span>销售订单</span>
          <input value={salesOrderId} onChange={(e) => setSalesOrderId(e.target.value)} placeholder="so-id" />
        </label>
        <label>
          <span>订单行 (可选)</span>
          <input value={salesOrderItemId} onChange={(e) => setSalesOrderItemId(e.target.value)} placeholder="soi-id" />
        </label>
        <label>
          <span>产品</span>
          <input value={productId} onChange={(e) => setProductId(e.target.value)} placeholder="product-id" />
        </label>
        <label>
          <span>仓库</span>
          <input value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} placeholder="wh-id (可选)" />
        </label>
        <label>
          <span>预留模式</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="INVENTORY_LOCK">{RESERVATION_MODE_LABELS.INVENTORY_LOCK}</option>
            <option value="MANUAL_RESERVATION">{RESERVATION_MODE_LABELS.MANUAL_RESERVATION}</option>
            <option value="ON_HAND_RESERVATION">{RESERVATION_MODE_LABELS.ON_HAND_RESERVATION}</option>
            <option value="EXPECTED_SUPPLY_RESERVATION">{RESERVATION_MODE_LABELS.EXPECTED_SUPPLY_RESERVATION}</option>
          </select>
        </label>
        <label>
          <span>数量</span>
          <input type="number" min="0" step="0.0001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </label>
      </div>

      {mode === 'EXPECTED_SUPPLY_RESERVATION' && (
        <div className="form-row">
          <label>
            <span>预计量来源类型</span>
            <select value={expectedSupplySourceType} onChange={(e) => setExpectedSupplySourceType(e.target.value)}>
              <option value="PLANNED_ORDER">PLANNED_ORDER</option>
              <option value="PURCHASE_ORDER">PURCHASE_ORDER</option>
              <option value="PRODUCTION_ORDER">PRODUCTION_ORDER</option>
              <option value="EXPECTED">EXPECTED</option>
            </select>
          </label>
          <label>
            <span>预计量来源 ID</span>
            <input value={expectedSupplySourceId} onChange={(e) => setExpectedSupplySourceId(e.target.value)} />
          </label>
          <label>
            <span>有限供给容量</span>
            <input type="number" min="0" step="0.0001" value={expectedSupplyCapacity} onChange={(e) => setExpectedSupplyCapacity(e.target.value)} />
          </label>
        </div>
      )}

      <div className="form-row">
        <button type="button" className="primary" disabled={busy} onClick={requestIntent}>提交预留意图</button>
        <label>
          <span>释放/消费事件</span>
          <select value={consumerEvent} onChange={(e) => setConsumerEvent(e.target.value)}>
            <option value="MANUAL">MANUAL</option>
            <option value="SO_CHANGED">SO_CHANGED</option>
            <option value="SO_CANCELLED">SO_CANCELLED</option>
            <option value="SO_CLOSED">SO_CLOSED</option>
            <option value="DELIVERY_CONFIRMED">DELIVERY_CONFIRMED</option>
            <option value="RETURNED">RETURNED</option>
            <option value="REPLACEMENT">REPLACEMENT</option>
          </select>
        </label>
        <label>
          <span>消费数量 (CONSUMED 时)</span>
          <input type="number" min="0" step="0.0001" value={consumeQty} onChange={(e) => setConsumeQty(e.target.value)} />
        </label>
      </div>

      {flash && <div className={`flash flash-${flash.type}`}>{flash.message}</div>}

      <h3>当前意图</h3>
      {intents.error && <div className="flash flash-error">{intents.error}</div>}
      {!intents.data?.intents?.length ? (
        <p className="muted">尚未提交预留意图。</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>订单 / 行</th>
              <th>模式</th>
              <th>状态</th>
              <th>申请 / 授信 / 消耗 / 释放</th>
              <th>规划预留 / 库存锁</th>
              <th>动作</th>
            </tr>
          </thead>
          <tbody>
            {intents.data.intents.map((row) => (
              <tr key={row.id}>
                <td>
                  <div>{row.salesOrderId}</div>
                  <div className="muted">{row.salesOrderItemId || '—'}</div>
                </td>
                <td>{RESERVATION_MODE_LABELS[row.reservationMode] || row.reservationMode}</td>
                <td>{INTENT_STATE_LABELS[row.intentState] || row.intentState}</td>
                <td>
                  <div>申请 {formatNumber(row.requestedQty)}</div>
                  <div>授信 {formatNumber(row.grantedQty)}</div>
                  <div>消耗 {formatNumber(row.consumedQty)}</div>
                  <div>释放 {formatNumber(row.releasedQty)}</div>
                </td>
                <td>
                  <div>{row.planningReservationId ? `规划 ${row.planningReservationId}` : <span className="muted">—</span>}</div>
                  <div>{row.inventoryLockId ? `锁 ${row.inventoryLockId}` : <span className="muted">—</span>}</div>
                  {row.expectedSupplyCapacity != null && (
                    <div className="muted">期望容量 {formatNumber(row.expectedSupplyCapacity)}</div>
                  )}
                </td>
                <td>
                  <div className="action-stack">
                    {['REQUESTED', 'NONE'].includes(row.intentState) && (
                      <button type="button" disabled={busy} onClick={() => act(row.id, 'grant')}>GRANT</button>
                    )}
                    {row.intentState === 'GRANTED' && (
                      <button type="button" disabled={busy} onClick={() => act(row.id, 'consume')}>CONSUME</button>
                    )}
                    {['REQUESTED', 'GRANTED'].includes(row.intentState) && (
                      <button type="button" disabled={busy} onClick={() => act(row.id, 'release')}>RELEASE</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default { PrepaymentGates, ReservationIntents };