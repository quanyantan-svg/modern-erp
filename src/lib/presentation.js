// V1.4-E1 canonical status presentation.
//
// Goal: stop scattering `status === 'SUBMITTED' ? '待审核' : ...` ternaries
// across pages. Pages should call `presentStatus(status, context)` and
// receive a single source of truth for label, semantic group and tone.
//
// The backend persisted enum values are unchanged in E1. The mapping only
// affects what the user sees.

export const STATUS_GROUPS = Object.freeze({
  APPROVAL: 'approval',
  EXECUTION: 'execution',
  COMMERCIAL: 'commercial',
  SETTLEMENT: 'settlement',
  PERIOD: 'period',
  MASTER: 'master',
  TRACKING: 'tracking',
  UNKNOWN: 'unknown',
});

export const STATUS_TONES = Object.freeze({
  DRAFT: 'neutral',
  PENDING: 'warning',
  IN_PROGRESS: 'info',
  APPROVED: 'success',
  CONFIRMED: 'success',
  TRANSFERRED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'muted',
  REVERSED: 'muted',
  CLOSED: 'muted',
  POSTED: 'success',
  PARTIAL: 'info',
  OPEN: 'warning',
  OVERDUE: 'danger',
  HOLD: 'warning',
  AVAILABLE: 'success',
  CONSUMED: 'muted',
  DELIVERED: 'info',
  SCRAPPED: 'danger',
  SETTLED: 'success',
  PARTIALLY_SETTLED: 'info',
  WAITING_MATCH: 'warning',
  EXPIRED: 'danger',
  INACTIVE: 'muted',
  UNKNOWN: 'muted',
});

const GROUP_FOR_STATUS = Object.freeze({
  DRAFT: STATUS_GROUPS.APPROVAL,
  ENTERED: STATUS_GROUPS.APPROVAL,
  SUBMITTED: STATUS_GROUPS.APPROVAL,
  APPROVED: STATUS_GROUPS.APPROVAL,
  POSTED: STATUS_GROUPS.COMMERCIAL,
  REJECTED: STATUS_GROUPS.APPROVAL,
  ACTIVE: STATUS_GROUPS.MASTER,
  INACTIVE: STATUS_GROUPS.MASTER,
  DISCONTINUED: STATUS_GROUPS.MASTER,
  RELEASED: STATUS_GROUPS.EXECUTION,
  PENDING: STATUS_GROUPS.EXECUTION,
  IN_PROGRESS: STATUS_GROUPS.EXECUTION,
  CONFIRMED: STATUS_GROUPS.EXECUTION,
  TRANSFERRED: STATUS_GROUPS.EXECUTION,
  COMPLETED: STATUS_GROUPS.EXECUTION,
  PARTIAL: STATUS_GROUPS.EXECUTION,
  CANCELLED: STATUS_GROUPS.APPROVAL,
  CLOSED: STATUS_GROUPS.PERIOD,
  OPEN: STATUS_GROUPS.PERIOD,
  REOPENED: STATUS_GROUPS.PERIOD,
  HOLD: STATUS_GROUPS.TRACKING,
  EXPIRED: STATUS_GROUPS.TRACKING,
  OVERDUE: STATUS_GROUPS.SETTLEMENT,
  REVERSED: STATUS_GROUPS.SETTLEMENT,
  AVAILABLE: STATUS_GROUPS.TRACKING,
  CONSUMED: STATUS_GROUPS.TRACKING,
  DELIVERED: STATUS_GROUPS.TRACKING,
  SCRAPPED: STATUS_GROUPS.TRACKING,
  SETTLED: STATUS_GROUPS.SETTLEMENT,
  PARTIALLY_SETTLED: STATUS_GROUPS.SETTLEMENT,
  WAITING_MATCH: STATUS_GROUPS.SETTLEMENT,
});

const GROUP_LABEL = Object.freeze({
  [STATUS_GROUPS.APPROVAL]: '授权审批',
  [STATUS_GROUPS.EXECUTION]: '实物执行',
  [STATUS_GROUPS.COMMERCIAL]: '商业/会计',
  [STATUS_GROUPS.SETTLEMENT]: '结算',
  [STATUS_GROUPS.PERIOD]: '期间',
  [STATUS_GROUPS.MASTER]: '主数据',
  [STATUS_GROUPS.TRACKING]: '身份跟踪',
  [STATUS_GROUPS.UNKNOWN]: '状态',
});

// Context-sensitive label overrides. The same internal enum may carry a
// different user-facing meaning depending on document family. E1 only
// registers overrides where the meaning is already proven by existing
// docs and pages; ambiguous cases fall back to the canonical label.
const CONTEXT_OVERRIDES = Object.freeze({
  'forecast.status': { ACTIVE: '已生效' },
  'production.status': { PENDING: '待生产', IN_PROGRESS: '生产中' },
  'quality.status': { PENDING: '待检验' },
  'period.status': { OPEN: '未结账', CLOSED: '已结账' },
  'master.status': { ACTIVE: '启用', INACTIVE: '已停用', DISCONTINUED: '已停用' },
  'tracking.status': { HOLD: '已冻结' },
  'reviewer.role': { label: '业务审核员' },
});

const CANONICAL_LABEL = Object.freeze({
  DRAFT: '草稿',
  ENTERED: '草稿',
  SUBMITTED: '已提交',
  APPROVED: '已审批',
  POSTED: '已过账',
  REJECTED: '已驳回',
  RELEASED: '已下达',
  PENDING: '待处理',
  IN_PROGRESS: '进行中',
  CONFIRMED: '已确认',
  TRANSFERRED: '已调拨',
  COMPLETED: '已完成',
  PARTIAL: '部分',
  CANCELLED: '已取消',
  REVERSED: '已作废',
  CLOSED: '已结账',
  OPEN: '未结账',
  REOPENED: '已重新开放',
  ACTIVE: '启用',
  INACTIVE: '已停用',
  DISCONTINUED: '已停用',
  HOLD: '已占用',
  EXPIRED: '已过期',
  OVERDUE: '已逾期',
  AVAILABLE: '可用',
  CONSUMED: '已领用',
  DELIVERED: '已交付',
  SCRAPPED: '已报废',
  SETTLED: '已结清',
  PARTIALLY_SETTLED: '部分结清',
  WAITING_MATCH: '待匹配',
});

const BUSINESS_VALUE_LABELS = Object.freeze({
  taxMode: Object.freeze({ NO_TAX: '不含税', EXCLUSIVE: '价外税', INCLUSIVE: '价内税' }),
  billingMode: Object.freeze({ SEPARATE: '分离开票', DIRECT_BILL: '直接开票', AUTO_BILL: '自动开票' }),
  inventoryDirection: Object.freeze({ IN: '入库', OUT: '出库' }),
  samplingMode: Object.freeze({ FULL: '全检', FIXED_QUANTITY: '固定数量', PERCENTAGE: '百分比' }),
  costEvidence: Object.freeze({ AUTHORITATIVE: '权威证据', PARTIAL: '部分证据', ESTIMATED: '暂估证据' }),
});

const BUSINESS_VALUE_FALLBACKS = Object.freeze({
  taxMode: '税模式待确认',
  billingMode: '计费模式待确认',
  inventoryDirection: '方向待确认',
  samplingMode: '抽样方式待确认',
  costEvidence: '成本证据待确认',
});

export function presentBusinessValue(family, value) {
  const raw = value == null ? '' : String(value).toUpperCase();
  const label = BUSINESS_VALUE_LABELS[family]?.[raw];
  return {
    raw,
    label: label || (raw ? (BUSINESS_VALUE_FALLBACKS[family] || '待确认') : '—'),
    known: Boolean(label),
  };
}

function resolveContextLabel(status, context) {
  if (!context) return undefined;
  const override = CONTEXT_OVERRIDES[context];
  if (!override) return undefined;
  return override[status];
}

export function presentStatus(status, context) {
  const raw = status == null ? '' : String(status).toUpperCase();
  if (!raw) {
    return {
      raw: '',
      label: '—',
      tone: STATUS_TONES.UNKNOWN,
      group: STATUS_GROUPS.UNKNOWN,
      groupLabel: GROUP_LABEL[STATUS_GROUPS.UNKNOWN],
      known: false,
    };
  }
  const label = resolveContextLabel(raw, context) || CANONICAL_LABEL[raw] || '状态待确认';
  const group = GROUP_FOR_STATUS[raw] || STATUS_GROUPS.UNKNOWN;
  const tone = STATUS_TONES[raw] || STATUS_TONES.UNKNOWN;
  return {
    raw,
    label,
    tone,
    group,
    groupLabel: GROUP_LABEL[group],
    known: raw in CANONICAL_LABEL || Boolean(resolveContextLabel(raw, context)),
  };
}

// Canonical action vocabulary from solution.md §21.9.2. Pages that need a
// semantic label (instead of "处理/执行/OK") pick from this list.
export const ACTION_VERBS = Object.freeze({
  CREATE_DRAFT: '新增草稿',
  SAVE_DRAFT: '保存草稿',
  SUBMIT: '提交',
  WITHDRAW: '撤回',
  APPROVE: '审核',
  REJECT: '驳回',
  CONFIRM_RECEIPT: '确认入库',
  CONFIRM_DELIVERY: '确认出库',
  CONFIRM_ISSUE: '确认领料',
  CONFIRM_RETURN: '确认退料',
  CONFIRM_COMPLETION: '确认完工',
  CONFIRM_TRANSFER: '确认调拨',
  CONFIRM_WRITE_OFF: '确认核销',
  CLOSE: '关闭',
  CANCEL: '作废',
  REVERSE: '冲销',
});

const ACTION_VERB_BY_CODE = Object.freeze(Object.fromEntries(
  Object.entries(ACTION_VERBS).map(([code, label]) => [label, code]),
));

export function actionVerb(code) {
  return ACTION_VERBS[code] || code;
}

export function isCanonicalVerb(label) {
  return label != null && ACTION_VERB_BY_CODE[label] != null;
}
