import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

const BUSINESS_CATEGORY_BY_STATUS = Object.freeze({
  400: 'VALIDATION',
  401: 'PERMISSION_DENIED',
  403: 'PERMISSION_DENIED',
  404: 'VALIDATION',
  409: 'BUSINESS_RULE_BLOCKED',
  413: 'VALIDATION',
  415: 'VALIDATION',
});

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      if (typeof details.code === 'string') this.code = details.code;
      if (typeof details.resolution === 'string') this.resolution = details.resolution;
    }
    if (!this.code) this.code = BUSINESS_CATEGORY_BY_STATUS[status] || 'INTERNAL_ERROR';
  }
}

// V1.4-E1 canonical structured-error serializer. Existing clients that read
// `error` continue to work; new clients can opt into `code/message/details/
// resolution/requestId` without breaking legacy consumers.
export function serializeError(error, requestId) {
  const safe = {
    error: '服务器内部错误',
    code: 'INTERNAL_ERROR',
    message: '服务器内部错误',
    details: undefined,
    resolution: undefined,
    requestId,
  };
  if (error instanceof HttpError) {
    safe.status = error.status;
    safe.error = error.message;
    safe.code = error.code || BUSINESS_CATEGORY_BY_STATUS[error.status] || 'INTERNAL_ERROR';
    safe.message = error.message;
    safe.details = error.details;
    if (error.resolution) safe.resolution = error.resolution;
  } else if (error && typeof error === 'object' && typeof error.message === 'string') {
    safe.error = '服务器内部错误';
    safe.message = '服务器内部错误';
    if (error.code) safe.code = String(error.code);
  }
  return safe;
}

export function allow(actor, permission) {
  if (!actor.permissions.includes(permission)) {
    const error = new HttpError(403, '没有执行此操作的权限');
    error.deniedPermissions = [permission];
    throw error;
  }
}

export function allowAny(actor, permissions) {
  if (!permissions.some((permission) => actor.permissions.includes(permission))) {
    const error = new HttpError(403, '没有查看此功能的权限');
    error.deniedPermissions = [...permissions];
    throw error;
  }
}

// V1.4-E2: bounded compatibility wrapper for the inventory transfer confirm
// capability. The canonical permission is INVENTORY_TRANSFER_CONFIRM.
// INVENTORY_TRANSFER_APPROVE remains a deprecated alias during the V1.4
// compatibility window so existing role grants do not lock out operators.
// ADMIN keeps full-permission access via the existing reconciliation.
const TRANSFER_CONFIRM_ALIASES = Object.freeze(['INVENTORY_TRANSFER_CONFIRM', 'INVENTORY_TRANSFER_APPROVE']);

export function allowInventoryTransferConfirm(actor) {
  if (!actor || !Array.isArray(actor.permissions)) {
    const error = new HttpError(403, '没有执行此操作的权限');
    error.deniedPermissions = [...TRANSFER_CONFIRM_ALIASES];
    throw error;
  }
  const granted = actor.permissions.some((permission) => TRANSFER_CONFIRM_ALIASES.includes(permission));
  if (!granted) {
    const error = new HttpError(403, '没有执行此操作的权限');
    error.deniedPermissions = [...TRANSFER_CONFIRM_ALIASES];
    throw error;
  }
}

export function hasInventoryTransferConfirm(actor) {
  if (!actor || !Array.isArray(actor.permissions)) return false;
  return actor.permissions.some((permission) => TRANSFER_CONFIRM_ALIASES.includes(permission));
}

export async function readJson(req) {
  const chunks = [];
  let size = 0;
  const configuredLimit = Number(process.env.HTTP_JSON_LIMIT_BYTES || 1_000_000);
  const limit = Number.isSafeInteger(configuredLimit) && configuredLimit >= 1_024 && configuredLimit <= 10_000_000
    ? configuredLimit : 1_000_000;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, '请求内容过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (!contentType.startsWith('application/json')) throw new HttpError(415, '请求内容类型必须为 application/json');
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new HttpError(400, 'JSON 请求体必须为对象');
    return parsed;
  } catch {
    throw new HttpError(400, '请求不是有效的 JSON');
  }
}

export function assertAllowedFields(body, allowed) {
  const accepted = new Set(allowed);
  const unexpected = Object.keys(body).filter((key) => !accepted.has(key));
  if (unexpected.length) throw new HttpError(400, `请求包含不支持的字段: ${unexpected.join(', ')}`);
}

/**
 * 读取 `multipart/form-data` 请求体。
 *
 * 附件子系统专用（Design §32.6.1）。与 `readJson` **完全分开**：
 *   - 独立的大小上限（默认 10 MB，由 `HTTP_ATTACHMENT_LIMIT_BYTES` 控制），
 *     不复用 JSON 的 1 MB 上限，也不改动 `readJson` 的任何行为；
 *   - 只解析第一段带 filename 的部分作为文件，其余作为字段。
 *
 * 不引入任何第三方 multipart 依赖：边界解析必须自己负责，且必须在超限时**立即**停止读取。
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {{limitBytes?: number, allowedTypes?: string[]|null}} options
 * @returns {Promise<{fields: Record<string,string>, file: {filename: string, contentType: string|null, body: Buffer}|null}>}
 */
export async function readMultipart(req, { limitBytes = 0, allowedTypes = null } = {}) {
  const configured = Number(process.env.HTTP_ATTACHMENT_LIMIT_BYTES || 10 * 1024 * 1024);
  const limit = Number.isSafeInteger(limitBytes) && limitBytes >= 1024
    ? limitBytes
    : (Number.isSafeInteger(configured) && configured >= 1024 && configured <= 50 * 1024 * 1024
      ? configured : 10 * 1024 * 1024);
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError(415, '请求内容类型必须为 multipart/form-data');
  }
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch ? String(boundaryMatch[1] || boundaryMatch[2] || '').trim() : '';
  if (!boundary) throw new HttpError(400, 'multipart 请求缺少 boundary');

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, '附件内容超过大小上限');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new HttpError(400, 'multipart 请求体为空');

  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  let file = null;
  let cursor = buffer.indexOf(delimiter);
  while (cursor !== -1) {
    const partStart = cursor + delimiter.length;
    if (buffer.slice(partStart, partStart + 2).toString('latin1') === '--') break; // 结束分隔符
    const next = buffer.indexOf(delimiter, partStart);
    if (next === -1) break;
    let part = buffer.slice(partStart, next);
    if (part.slice(-2).toString('latin1') === '\r\n') part = part.slice(0, -2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/i.exec(headerText);
      const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
      const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
      const name = nameMatch ? nameMatch[1] : '';
      if (filenameMatch) {
        if (!file) {
          file = {
            filename: filenameMatch[1],
            contentType: typeMatch ? typeMatch[1].trim() : null,
            body,
          };
        }
      } else {
        fields[name] = body.toString('utf8');
      }
    }
    cursor = next;
  }
  if (!file) throw new HttpError(400, 'multipart 请求缺少文件部分');
  if (allowedTypes && !allowedTypes.includes(String(file.contentType || ''))) {
    throw new HttpError(415, '附件类型不在允许清单内');
  }
  return { fields, file };
}

export function requiredText(value, label, maxLength) {
  const text = String(value ?? '').trim();
  if (!text) throw new HttpError(400, `${label}不能为空`);
  if (text.length > maxLength) throw new HttpError(400, `${label}不能超过 ${maxLength} 个字符`);
  return text;
}

export function optionalText(value, maxLength) {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) throw new HttpError(400, `内容不能超过 ${maxLength} 个字符`);
  return text;
}

// V1.4-E2: validates that an authoritative business date is provided in
// YYYY-MM-DD form. Rejects empty / malformed / non-canonical values so the
// rest of the system never receives an ambiguous timestamp.
export function normalizeBusinessDate(value, label = '业务日期') {
  if (value === undefined || value === null || value === '') {
    throw new HttpError(400, `请填写${label}`);
  }
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new HttpError(400, `${label}格式应为 YYYY-MM-DD`);
  // Sanity check: calendar-valid month and day.
  const [year, month, day] = text.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new HttpError(400, `${label}格式应为 YYYY-MM-DD`);
  }
  const probe = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.getUTCFullYear() !== year || (probe.getUTCMonth() + 1) !== month || probe.getUTCDate() !== day) {
    throw new HttpError(400, `${label}不是有效的日历日`);
  }
  return text;
}

export function requiredCode(value, label) {
  const text = requiredText(value, label, 50);
  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new HttpError(400, `${label}只能包含字母、数字、下划线和短横线`);
  }
  return text.toUpperCase();
}

export function bearer(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

export function send(res, status, body) {
  res.statusCode = status;
  if (body === null) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self'");
  res.removeHeader('X-Powered-By');
}

export function serveStatic(res, pathname, distDir) {
  if (!distDir || !existsSync(distDir)) throw new HttpError(404, '前端尚未构建，请先运行 pnpm build');
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const root = resolve(distDir);
  let file = resolve(root, requested);
  const traversal = relative(root, file);
  if (traversal.startsWith('..') || isAbsolute(traversal) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(distDir, 'index.html');
  }
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
  };
  res.statusCode = 200;
  res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}
