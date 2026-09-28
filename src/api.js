import { safeErrorMessage, classifyApiError } from './lib/copy.js';

const TOKEN_KEY = 'modern_erp_token';

export class ApiError extends Error {
  constructor({ message, status = 0, code = '', details, resolution, requestId, cause }) {
    super(message || '操作未完成');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.resolution = resolution;
    this.requestId = requestId;
    this.cause = cause;
  }
}

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
export function setToken(token) { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); }

export async function api(path, options = {}) {
  const headers = { ...options.headers };
  if (options.body && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    options = { ...options, body: JSON.stringify(options.body) };
  }
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch (cause) {
    const wrapped = new ApiError({
      message: safeErrorMessage({ network: true }),
      status: 0,
      code: 'NETWORK_FAILURE',
      cause,
    });
    throw wrapped;
  }
  if (response.status === 401 && path !== '/api/auth/login') {
    setToken('');
    window.dispatchEvent(new Event('erp:unauthorized'));
  }
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    // V1.4-E1: prefer the canonical structured envelope; fall back to
    // legacy `error` field for any endpoint that has not migrated yet.
    const payload = data || {};
    const message = payload.message || payload.error || '';
    const code = payload.code || (payload.details && payload.details.code) || '';
    throw new ApiError({
      message: safeErrorMessage({
        status: response.status,
        code,
        serverMessage: message,
      }),
      status: response.status,
      code,
      details: payload.details,
      resolution: payload.resolution || (payload.details && payload.details.resolution),
      requestId: payload.requestId || response.headers.get('X-Request-Id'),
    });
  }
  return data;
}

export async function download(path) {
  const token = getToken();
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  let response;
  try {
    response = await fetch(path, { headers });
  } catch (cause) {
    throw new ApiError({
      message: safeErrorMessage({ network: true }),
      status: 0,
      code: 'NETWORK_FAILURE',
      cause,
    });
  }
  if (response.status === 401) {
    setToken('');
    window.dispatchEvent(new Event('erp:unauthorized'));
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const code = payload.code || (payload.details && payload.details.code) || '';
    throw new ApiError({
      message: safeErrorMessage({ status: response.status, code, serverMessage: payload.message || payload.error || '' }),
      status: response.status,
      code,
      details: payload.details,
      resolution: payload.resolution || (payload.details && payload.details.resolution),
      requestId: payload.requestId || response.headers.get('X-Request-Id'),
    });
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || 'report.csv';
  return { blob: await response.blob(), filename };
}

// Convenience: re-exported interpreter so pages do not need a second import
// when they only have the ApiError instance.
export function interpretApiError(error) {
  return classifyApiError(error);
}
