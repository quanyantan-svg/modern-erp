#!/usr/bin/env node
/**
 * 目标环境发布验证器（PL-RI-05）。
 *
 * 从**客户端**验证目标环境的事实，不修改目标主机任何状态：
 *   - HTTP → HTTPS 跳转；
 *   - TLS 证书链、域名匹配与有效期；
 *   - HSTS；
 *   - 静态资源；
 *   - live / ready 健康检查；
 *   - API 鉴权边界（未认证必须 401，不得 500）；
 *   - 上传上限（超过上限必须 413）；
 *   - 客户端 IP 传递（服务端不得回显被伪造的 X-Forwarded-For）。
 *
 * 用法：
 *   node scripts/admin/verify-release-target.mjs --host erp.example.com [--upload-limit-bytes 12582912]
 *
 * 退出码：0 = 全部检查通过；1 = 有检查失败；2 = 用法错误。
 */

import { connect } from 'node:tls';
import { createHash } from 'node:crypto';

function parseArgs(argv) {
  const args = { host: null, uploadLimitBytes: 12 * 1024 * 1024, timeoutMs: 15_000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--host') args.host = argv[++i];
    else if (argv[i] === '--upload-limit-bytes') args.uploadLimitBytes = Number(argv[++i]);
    else if (argv[i] === '--timeout-ms') args.timeoutMs = Number(argv[++i]);
  }
  return args;
}

function usage() {
  process.stderr.write('用法: node scripts/admin/verify-release-target.mjs --host <domain> [--upload-limit-bytes <n>]\n');
  process.exit(2);
}

/** 只读 TLS 握手，取回证书事实。 */
function inspectTls(host, timeoutMs) {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: timeoutMs });
    const done = (value) => { try { socket.destroy(); } catch { /* 已销毁 */ } resolve(value); };
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      const validTo = certificate.valid_to ? new Date(certificate.valid_to) : null;
      done({
        ok: true,
        authorized: socket.authorized,
        authorizationError: socket.authorizationError || null,
        subject: certificate.subject || null,
        issuer: certificate.issuer || null,
        validFrom: certificate.valid_from || null,
        validTo: certificate.valid_to || null,
        daysRemaining: validTo ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000) : null,
        fingerprint256: certificate.fingerprint256 || null,
        protocol: socket.getProtocol ? socket.getProtocol() : null,
      });
    });
    socket.once('error', (error) => done({ ok: false, error: error.message }));
    socket.once('timeout', () => done({ ok: false, error: 'TLS 握手超时' }));
  });
}

async function httpRequest(url, { method = 'GET', headers = {}, body = null, redirect = 'manual', timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method, headers, body, redirect, signal: controller.signal });
    const text = await response.text();
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      location: response.headers.get('location'),
      body: text.slice(0, 4096),
      bodyLength: text.length,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.host) usage();
  const host = args.host;
  const checks = [];

  const record = (id, title, ok, detail) => {
    checks.push({ id, title, ok, detail });
    process.stdout.write(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${title}${detail ? ` — ${detail}` : ''}\n`);
  };

  /* 1. HTTP → HTTPS 跳转 */
  try {
    const response = await httpRequest(`http://${host}/`, { timeoutMs: args.timeoutMs });
    const location = response.location || '';
    const ok = [301, 302, 307, 308].includes(response.status) && location.startsWith('https://');
    record('T1', 'HTTP 只跳转到 HTTPS', ok, ok ? `${response.status} → ${location}` : `status=${response.status} location=${location || '(无)'}`);
  } catch (error) {
    record('T1', 'HTTP 只跳转到 HTTPS', false, error.message);
  }

  /* 2. TLS 证书链 / 域名匹配 / 有效期 */
  const tls = await inspectTls(host, args.timeoutMs);
  if (!tls.ok) {
    record('T2', 'TLS 证书链、域名匹配与有效期', false, tls.error);
  } else {
    const days = tls.daysRemaining;
    const chainOk = tls.authorized === true;
    const notExpired = days !== null && days > 0;
    const ok = chainOk && notExpired;
    record('T2', 'TLS 证书链、域名匹配与有效期', ok,
      `authorized=${chainOk} issuer=${tls.issuer?.O || '(未知)'} 剩余天数=${days}`);
  }

  /* 3. HSTS */
  try {
    const response = await httpRequest(`https://${host}/`, { timeoutMs: args.timeoutMs });
    const hsts = response.headers['strict-transport-security'] || '';
    const ok = Boolean(hsts) && /max-age=\d{5,}/.test(hsts);
    record('T3', 'HSTS 已启用', ok, ok ? hsts : '(缺失)');
  } catch (error) {
    record('T3', 'HSTS 已启用', false, error.message);
  }

  /* 4. 静态资源 */
  try {
    const response = await httpRequest(`https://${host}/`, { timeoutMs: args.timeoutMs });
    const contentType = response.headers['content-type'] || '';
    const ok = response.status === 200 && /text\/html/.test(contentType);
    record('T4', '静态资源可访问', ok, `status=${response.status} content-type=${contentType}`);
  } catch (error) {
    record('T4', '静态资源可访问', false, error.message);
  }

  /* 5. live / ready */
  for (const [id, path] of [['T5', '/api/health/live'], ['T6', '/api/health/ready']]) {
    try {
      const response = await httpRequest(`https://${host}${path}`, { timeoutMs: args.timeoutMs });
      const ok = response.status === 200;
      record(id, `${path} 健康检查`, ok, `status=${response.status}`);
    } catch (error) {
      record(id, `${path} 健康检查`, false, error.message);
    }
  }

  /* 6. API 鉴权边界：未认证必须 401 */
  try {
    const response = await httpRequest(`https://${host}/api/inventory`, { timeoutMs: args.timeoutMs });
    const ok = response.status === 401 || response.status === 403;
    record('T7', '未认证访问受保护 API 必须被拒绝', ok, `status=${response.status}`);
  } catch (error) {
    record('T7', '未认证访问受保护 API 必须被拒绝', false, error.message);
  }

  /* 7. 上传上限：超过上限必须 413 */
  try {
    const oversize = Buffer.alloc(args.uploadLimitBytes + 1024, 0x41);
    const response = await httpRequest(`https://${host}/api/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: oversize,
      timeoutMs: Math.max(args.timeoutMs, 30_000),
    });
    const ok = response.status === 413;
    record('T8', `超过 ${args.uploadLimitBytes} 字节的上传必须被拒绝`, ok, `status=${response.status}`);
  } catch (error) {
    record('T8', '上传上限', false, error.message);
  }

  /* 8. 客户端 IP 传递：服务端不得回显被伪造的 X-Forwarded-For */
  try {
    const spoofed = '203.0.113.77';
    const response = await httpRequest(`https://${host}/api/health/live`, {
      headers: { 'x-forwarded-for': spoofed, 'x-real-ip': spoofed },
      timeoutMs: args.timeoutMs,
    });
    const echoed = response.body.includes(spoofed)
      || Object.values(response.headers).some((value) => String(value).includes(spoofed));
    record('T9', '服务端不得回显被伪造的 X-Forwarded-For', !echoed,
      echoed ? '响应中出现了伪造 IP' : '未出现伪造 IP（权威证据仍是主机侧审计日志）');
  } catch (error) {
    record('T9', '客户端 IP 传递', false, error.message);
  }

  const failures = checks.filter((check) => !check.ok);
  const report = {
    host,
    checkedAt: new Date().toISOString(),
    tls: tls.ok ? { issuer: tls.issuer?.O || null, validTo: tls.validTo, daysRemaining: tls.daysRemaining ?? null } : { error: tls.error },
    checks: checks.map(({ id, title, ok, detail }) => ({ id, title, ok, detail })),
  };
  report.digest = createHash('sha256').update(JSON.stringify(report)).digest('hex');

  process.stdout.write(`\n=== 结论 ===\n`);
  process.stdout.write(`目标: ${host}\n`);
  process.stdout.write(`检查 ${checks.length} 项，失败 ${failures.length} 项\n`);
  if (failures.length) {
    process.stdout.write('FAIL: 目标环境发布验证未通过\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write('PASS: 目标环境发布验证全部通过\n');
}

main();
