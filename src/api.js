import { safeErrorMessage } from './lib/copy.js';

const TOKEN_KEY = 'modern_erp_token';

export class ApiError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
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
  } catch {
    throw new ApiError(safeErrorMessage({ network: true }));
  }
  if (response.status === 401 && path !== '/api/auth/login') {
    setToken('');
    window.dispatchEvent(new Event('erp:unauthorized'));
  }
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = data?.details?.code || data?.code || '';
    throw new ApiError(safeErrorMessage({ status: response.status, code, serverMessage: data?.error }), response.status, code);
  }
  return data;
}
