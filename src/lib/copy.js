export const ROLE_DISPLAY_NAME = Object.freeze({
  'role-admin': '系统管理员',
  'role-sales': '销售人员',
  'role-reviewer': '审批人员',
  'role-warehouse': '仓库人员',
  'role-accounting': '财务人员',
  ADMIN: '系统管理员',
  SALES: '销售人员',
  REVIEWER: '审批人员',
  WAREHOUSE: '仓库人员',
  ACCOUNTING: '财务人员',
});

export const BUSINESS_CONFLICT_COPY = Object.freeze({
  RECORD_REFERENCED: '无法删除该记录。该记录已经被业务单据使用；如以后不再使用，可以将其停用。',
  RECORD_MUST_BE_INACTIVE: '请先停用该记录，再进行删除。',
  DOCUMENT_NOT_DRAFT: '无法删除该单据。该单据已经进入业务流程，不能直接删除。',
  DOCUMENT_HAS_DOWNSTREAM: '无法删除该单据。该单据已经生成后续业务，必须保留来源关系。',
  WAREHOUSE_NOT_EMPTY: '无法停用仓库。仓库中仍有库存，请先完成库存处理。',
  CLOSED_PERIOD: '该期间已结账，不能再记入或修改该期间的业务。',
});

const TECHNICAL_ERROR = /(?:SQLITE|FOREIGN KEY|UNIQUE constraint|NOT NULL constraint|SQL syntax|database exception|stack trace|NetworkError|Failed to fetch|HTTP\s*[45]\d\d|\b(?:undefined|NaN|Infinity)\b)/i;

export function roleDisplayName(user = {}) {
  return ROLE_DISPLAY_NAME[user.roleId] || ROLE_DISPLAY_NAME[user.roleCode] || user.roleName || '业务用户';
}

export function safeErrorMessage({ status, code, serverMessage, network = false } = {}) {
  if (network) return '网络连接异常，请检查网络后重试';
  if (code && BUSINESS_CONFLICT_COPY[code]) return BUSINESS_CONFLICT_COPY[code];
  if (status === 401) return code === 'INVALID_CREDENTIALS' ? '账号或密码不正确' : '登录状态已失效，请重新登录';
  if (status === 403) return '你没有执行此操作的权限';
  if (status === 404) return '内容不存在或已被删除';
  if (status >= 500) return '暂时无法完成，请稍后重试';
  if (TECHNICAL_ERROR.test(String(serverMessage || ''))) return status === 409 ? '当前内容与已有业务冲突，请检查后重试' : '暂时无法完成，请稍后重试';
  if (serverMessage) return serverMessage;
  if (status === 400) return '请检查填写内容';
  if (status === 409) return '当前状态已发生变化，请刷新后重试';
  return '暂时无法完成，请稍后重试';
}

