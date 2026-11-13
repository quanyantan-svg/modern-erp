/**
 * N7 与 Git 提交追溯 Hook 共用的受治理路径合同。
 *
 * 这里是唯一机器可读定义。任何调用方只能复用，不能另行缩小范围。
 */
export const GOVERNED_FILES = Object.freeze([
  'document.md',
  'solution.md',
  'docs/status/PROJECT_STATUS.md',
  'docs/decisions/OPEN-BUSINESS-DECISIONS.md',
  // N7-LEDGER-01 的变更追溯台账自身也必须可追溯：
  // 否则台账可以被无声地扩成「预授权未来提交」的后门。
  'docs/acceptance/n7-traceability-ledger.md',
]);

export const GOVERNED_DIRS = Object.freeze([
  'docs/requirements/',
  'docs/design/',
  'docs/reviews/',
]);

export function isGovernedPath(file) {
  const normalized = String(file || '').replaceAll('\\', '/');
  return GOVERNED_FILES.includes(normalized)
    || (normalized.endsWith('.md') && GOVERNED_DIRS.some((dir) => normalized.startsWith(dir)));
}
