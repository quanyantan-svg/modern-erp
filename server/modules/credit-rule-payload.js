import { HttpError } from '../lib/http.js';

function payloadError(status, code, message) {
  return new HttpError(status, message, { code });
}

function assertSemanticValue(value, { status, seen = new WeakSet(), topLevel = false } = {}) {
  if (topLevel && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    throw payloadError(status, 'CREDIT_RULE_PAYLOAD_TYPE_INVALID', '信用规则结果载荷必须为 JSON 对象');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw payloadError(status, 'CREDIT_RULE_PAYLOAD_NUMBER_INVALID', '信用规则结果载荷数值必须有限');
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw payloadError(status, 'CREDIT_RULE_PAYLOAD_NUMBER_UNSAFE', '信用规则结果载荷整数超出安全范围');
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw payloadError(status, 'CREDIT_RULE_PAYLOAD_TYPE_INVALID', '信用规则结果载荷包含不支持的值');
  }
  if (seen.has(value)) {
    throw payloadError(status, 'CREDIT_RULE_PAYLOAD_TYPE_INVALID', '信用规则结果载荷不得包含循环引用');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = assertSemanticValue(value[index], { status, seen });
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw payloadError(status, 'CREDIT_RULE_PAYLOAD_TYPE_INVALID', '信用规则结果载荷必须为普通 JSON 对象');
    }
    for (const key of Object.keys(value)) {
      value[key] = assertSemanticValue(value[key], { status, seen });
    }
  }
  seen.delete(value);
  return value;
}

// JSON.parse validates the grammar. This second, non-materializing pass exists
// only to detect duplicate object keys while the original text is still
// observable (SQLite TEXT and direct parser tests). MySQL native JSON may have
// already discarded that lexical fact; the production Writer never accepts
// raw JSON text and therefore cannot create a duplicate-key object.
function assertNoDuplicateKeys(text, status) {
  let offset = 0;
  const skip = () => { while (/\s/.test(text[offset] || '')) offset += 1; };
  const stringToken = () => {
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      if (text[offset] === '\\') { offset += 2; continue; }
      if (text[offset] === '"') { offset += 1; return text.slice(start, offset); }
      offset += 1;
    }
    return text.slice(start);
  };
  const scalar = () => {
    while (offset < text.length && !/[\s,\]}]/.test(text[offset])) offset += 1;
  };
  const value = () => {
    skip();
    if (text[offset] === '{') {
      offset += 1; skip();
      const keys = new Set();
      if (text[offset] === '}') { offset += 1; return; }
      while (offset < text.length) {
        skip();
        const key = JSON.parse(stringToken());
        if (keys.has(key)) {
          throw payloadError(status, 'CREDIT_RULE_PAYLOAD_DUPLICATE_KEY', `信用规则结果载荷包含重复键：${key}`);
        }
        keys.add(key);
        skip(); offset += 1; // colon; grammar was already validated by JSON.parse
        value(); skip();
        if (text[offset] === '}') { offset += 1; return; }
        offset += 1; // comma
      }
      return;
    }
    if (text[offset] === '[') {
      offset += 1; skip();
      if (text[offset] === ']') { offset += 1; return; }
      while (offset < text.length) {
        value(); skip();
        if (text[offset] === ']') { offset += 1; return; }
        offset += 1; // comma
      }
      return;
    }
    if (text[offset] === '"') { stringToken(); return; }
    scalar();
  };
  value();
}

export function validateCreditRulePayloadValue(value) {
  return assertSemanticValue(value, { status: 400, topLevel: true });
}

export function parseCreditRulePayload(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    throw payloadError(409, 'CREDIT_RULE_PAYLOAD_MISSING', '信用规则结果载荷缺失');
  }
  const text = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw payloadError(409, 'CREDIT_RULE_PAYLOAD_INVALID_JSON', '信用规则结果载荷不是合法 JSON');
  }
  assertNoDuplicateKeys(text, 409);
  return assertSemanticValue(parsed, { status: 409, topLevel: true });
}
