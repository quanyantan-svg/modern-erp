// 信用工作面的业务参照描述符（Requirement §34.17 SC-UX-03；Design §29.54.2、§29.54.3）。
//
// 本模块只描述「去哪一类参照、带着哪些筛选条件」，不复制授权逻辑，也不保存第二份
// 业务事实：候选集合、总数与可见范围全部由后端参照端点决定。
//
// 组件协议（Design §32.22.4）：
//   descriptor.search({ q, limit, offset, selectedId, signal })
//     → { items: [{ id, code, name, secondaryText, active }], total }

import { api } from '../api.js';

function creditDescriptor(kind, { customerId = '', enabled = true } = {}) {
  return {
    key: `${kind}:${customerId}`,
    enabled,
    async search({ q = '', limit = 20, offset = 0, selectedId = '', signal } = {}) {
      const query = new URLSearchParams({ kind });
      if (q) query.set('q', q);
      if (limit) query.set('limit', String(limit));
      if (offset) query.set('offset', String(offset));
      if (selectedId) query.set('selectedId', selectedId);
      if (customerId) query.set('customerId', customerId);
      const result = await api(`/api/credit/work-references?${query.toString()}`, { signal });
      return { items: result?.items || [], total: Number(result?.total || 0) };
    },
  };
}

export const creditWorkReferences = Object.freeze({
  // 档案、检查与评分表使用的客户上下文；只投影客户身份，不投影额度与评级。
  profileContext: (options = {}) => creditDescriptor('PROFILE_CONTEXT', options),
  salesperson: (options = {}) => creditDescriptor('SALESPERSON', options),
  salesOrder: (options = {}) => creditDescriptor('SALES_ORDER', options),
  salesDelivery: (options = {}) => creditDescriptor('SALES_DELIVERY', options),
  checkResult: (options = {}) => creditDescriptor('CHECK_RESULT', options),
  evaluator: (options = {}) => creditDescriptor('EVALUATOR', options),
});

export default creditWorkReferences;
