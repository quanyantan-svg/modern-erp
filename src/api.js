const TOKEN_KEY = 'modern_erp_token';

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
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401 && path !== '/api/auth/login') {
    setToken('');
    window.dispatchEvent(new Event('erp:unauthorized'));
  }
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || '请求失败（' + response.status + '）');
  return data;
}
