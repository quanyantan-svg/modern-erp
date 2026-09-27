import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, serializeError } from './lib/http.js';

// V1.4-E1 — structured error foundation
test('HttpError preserves legacy message and details', () => {
  const error = new HttpError(409, '业务冲突');
  assert.equal(error.status, 409);
  assert.equal(error.message, '业务冲突');
  assert.equal(error.code, 'BUSINESS_RULE_BLOCKED');
});

test('HttpError picks up code/resolution from details object', () => {
  const error = new HttpError(400, '校验失败', { code: 'INVALID_DOCUMENT_STATE', resolution: '请重新载入后再操作' });
  assert.equal(error.code, 'INVALID_DOCUMENT_STATE');
  assert.equal(error.resolution, '请重新载入后再操作');
});

test('serializeError returns canonical envelope plus legacy error', () => {
  const error = new HttpError(409, '来源请购明细不可修改', { code: 'INVALID_DOCUMENT_STATE' });
  const safe = serializeError(error, 'req-123');
  assert.equal(safe.code, 'INVALID_DOCUMENT_STATE');
  assert.equal(safe.message, '来源请购明细不可修改');
  assert.equal(safe.error, '来源请购明细不可修改');
  assert.equal(safe.requestId, 'req-123');
  assert.equal(safe.status, 409);
});

test('serializeError sanitises unknown errors', () => {
  const safe = serializeError(new Error('database is on fire'), 'req-xyz');
  assert.equal(safe.code, 'INTERNAL_ERROR');
  assert.equal(safe.message, '服务器内部错误');
  assert.equal(safe.error, '服务器内部错误');
  assert.equal(safe.requestId, 'req-xyz');
  assert.equal(safe.status, undefined);
});

test('serializeError keeps resolution when provided', () => {
  const error = new HttpError(409, '业务阻断', { code: 'PRECHECK_BLOCKED', resolution: '请先处理阻断项' });
  const safe = serializeError(error, 'req-1');
  assert.equal(safe.resolution, '请先处理阻断项');
  assert.equal(safe.code, 'PRECHECK_BLOCKED');
});