import { useState } from 'react';
import { api, setToken } from '../api.js';

// The login screen lives in its own module so the first visit downloads a
// small chunk instead of the whole master-data chunk (115 kB) that carries the
// customer / order / product / warehouse screens.
export function Login({ onLogin, notify }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true);
    try { const result = await api('/api/auth/login', { method: 'POST', body: form }); setToken(result.token); onLogin(result.user); }
    catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  }
  return <div className="login-page">
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">M</div>
          <strong>Modern ERP</strong>
        </div>
        <h2>登录</h2>
        <p className="lead">企业运营管理平台</p>
        <form onSubmit={submit}>
          <label>账号<input autoFocus required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="username"/></label>
          <label>密码<input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password"/></label>
          <button className="primary wide" disabled={busy}>{busy ? '正在验证…' : '登录'}</button>
        </form>
        <p className="footnote">请使用由系统管理员分配的账号登录。如需协助，请联系企业 IT 支持。</p>
      </div>
    </div>
  </div>;
}

export default Login;
