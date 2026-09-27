import { test } from 'node:test';
import assert from 'node:assert/strict';

// V1.4-E1 — status presentation + canonical action vocabulary.
// These tests import the browser-target modules through Node's ESM loader.
const presentation = await import('./presentation.js');
const { presentStatus, STATUS_GROUPS, ACTION_VERBS, isCanonicalVerb } = presentation;

test('presentStatus maps known backend enums to canonical labels', () => {
  assert.equal(presentStatus('DRAFT').label, '草稿');
  assert.equal(presentStatus('SUBMITTED').label, '已提交');
  assert.equal(presentStatus('APPROVED').label, '已审批');
  assert.equal(presentStatus('REJECTED').label, '已驳回');
  assert.equal(presentStatus('CONFIRMED').label, '已确认');
  assert.equal(presentStatus('TRANSFERRED').label, '已调拨');
  assert.equal(presentStatus('CANCELLED').label, '已取消');
  assert.equal(presentStatus('REVERSED').label, '已作废');
  assert.equal(presentStatus('CLOSED').label, '已结账');
});

test('presentStatus returns a semantic group per enum', () => {
  assert.equal(presentStatus('SUBMITTED').group, STATUS_GROUPS.APPROVAL);
  assert.equal(presentStatus('CONFIRMED').group, STATUS_GROUPS.EXECUTION);
  assert.equal(presentStatus('TRANSFERRED').group, STATUS_GROUPS.EXECUTION);
  assert.equal(presentStatus('POSTED').group, STATUS_GROUPS.COMMERCIAL);
  assert.equal(presentStatus('CLOSED').group, STATUS_GROUPS.PERIOD);
  assert.equal(presentStatus('INACTIVE').group, STATUS_GROUPS.MASTER);
});

test('presentStatus honours context overrides for master/forecast/period', () => {
  assert.equal(presentStatus('ACTIVE', 'forecast.status').label, '已生效');
  assert.equal(presentStatus('OPEN', 'period.status').label, '未结账');
  assert.equal(presentStatus('CLOSED', 'period.status').label, '已结账');
  assert.equal(presentStatus('ACTIVE', 'master.status').label, '启用');
  assert.equal(presentStatus('INACTIVE', 'master.status').label, '已停用');
});

test('presentStatus unknown status returns labelled fallback', () => {
  const result = presentStatus('SOMETHING_NEW');
  assert.equal(result.known, false);
  assert.equal(result.label, '状态待确认');
  assert.equal(result.group, STATUS_GROUPS.UNKNOWN);
});

test('presentStatus empty status renders a dash and unknown group', () => {
  const result = presentStatus('');
  assert.equal(result.label, '—');
  assert.equal(result.known, false);
});

test('canonical action vocabulary exposes the V1.4-D verbs', () => {
  assert.equal(ACTION_VERBS.CONFIRM_RECEIPT, '确认入库');
  assert.equal(ACTION_VERBS.CONFIRM_DELIVERY, '确认出库');
  assert.equal(ACTION_VERBS.CONFIRM_ISSUE, '确认领料');
  assert.equal(ACTION_VERBS.CONFIRM_TRANSFER, '确认调拨');
  assert.equal(ACTION_VERBS.APPROVE, '审核');
  assert.equal(ACTION_VERBS.REJECT, '驳回');
});

test('isCanonicalVerb detects legacy ambiguous labels and accepts canonical ones', () => {
  assert.equal(isCanonicalVerb('确认入库'), true);
  assert.equal(isCanonicalVerb('处理'), false);
  assert.equal(isCanonicalVerb('执行'), false);
  assert.equal(isCanonicalVerb('OK'), false);
  assert.equal(isCanonicalVerb('提交完成'), false);
});

const copy = await import('./copy.js');
const { classifyApiError, safeErrorMessage, ERROR_CATEGORIES, ROLE_DISPLAY_NAME } = copy;

test('classifyApiError maps known status codes to categories', () => {
  assert.equal(classifyApiError({ status: 403, code: 'PERMISSION_DENIED' }).category, ERROR_CATEGORIES.PERMISSION);
  assert.equal(classifyApiError({ status: 404, message: 'x' }).category, ERROR_CATEGORIES.MISSING_PREREQUISITE);
  assert.equal(classifyApiError({ status: 409, code: 'INVALID_DOCUMENT_STATE' }).category, ERROR_CATEGORIES.VALIDATION);
  assert.equal(classifyApiError({ status: 409, code: 'PRECHECK_BLOCKED' }).category, ERROR_CATEGORIES.BUSINESS_RULE);
  assert.equal(classifyApiError({ status: 500, message: 'x' }).category, ERROR_CATEGORIES.SERVER);
});

test('classifyApiError surfaces resolution and requestId from new envelope', () => {
  const interpreted = classifyApiError({
    status: 409,
    code: 'PRECHECK_BLOCKED',
    message: '存在阻断项',
    resolution: '请先处理阻断项',
    requestId: 'req-001',
  });
  assert.equal(interpreted.resolution, '请先处理阻断项');
  assert.equal(interpreted.requestId, 'req-001');
  assert.equal(interpreted.category, ERROR_CATEGORIES.BUSINESS_RULE);
});

test('classifyApiError falls back to legacy error field', () => {
  const interpreted = classifyApiError({ status: 400, message: '请求包含不支持的字段: foo' });
  assert.equal(interpreted.category, ERROR_CATEGORIES.VALIDATION);
  assert.equal(interpreted.message, '请求包含不支持的字段: foo');
});

test('classifyApiError handles fetch failures as network errors', () => {
  const interpreted = classifyApiError({ name: 'TypeError', message: 'Failed to fetch' });
  assert.equal(interpreted.category, ERROR_CATEGORIES.NETWORK);
});

test('safeErrorMessage continues to mask technical details', () => {
  assert.equal(safeErrorMessage({ status: 500, serverMessage: 'SQLITE BUSY: database is locked' }), '暂时无法完成，请稍后重试');
});

test('REVIEWER role display name updated to 业务审核员', () => {
  assert.equal(ROLE_DISPLAY_NAME['role-reviewer'], '业务审核员');
  assert.equal(ROLE_DISPLAY_NAME.REVIEWER, '业务审核员');
});