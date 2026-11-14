// PL-RI-05 —— 目标环境发布证据门禁回归。
//
// 覆盖 Requirement §36.16.6 与 Design §32.16.7：
//   * 仓库只提供模板，模板存在不等于目标环境就绪；
//   * TLS 模板的占位符未替换时必须让 `nginx -t` 失败；
//   * preflight 只登记环境变量**名称**，绝不输出值；
//   * preflight 缺项即 fail closed；
//   * 目标环境验证器对不可达目标必须失败（非零退出）。
//
// 证据层级：全部为**本地离线**证据。没有连接任何目标主机、对象存储或公网服务。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const TEMPLATE = join(repoRoot, 'deploy', 'nginx', 'modern-erp-tls.conf.example');

function runNode(script, args = [], env = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
  };
}

test('T1 TLS 模板：两处占位符齐备，且证书路径内嵌域名占位符（未替换时 nginx -t 必然失败）', () => {
  const template = readFileSync(TEMPLATE, 'utf8');
  assert.ok(template.includes('__SERVER_NAME__'), '模板必须保留 server_name 占位符');
  assert.ok(template.includes('__CERTIFICATE_PATH__'), '模板必须保留证书路径占位符');
  const certificateLine = template.split('\n').find((line) => line.includes('ssl_certificate ') && !line.includes('key'));
  assert.ok(certificateLine, '模板必须声明 ssl_certificate');
  assert.ok(
    certificateLine.includes('__SERVER_NAME__') || certificateLine.includes('__CERTIFICATE_PATH__'),
    '证书路径必须含占位符：未替换时该路径不存在，nginx 解析配置即失败',
  );
  // 占位符未替换时，证书路径所在的目录一定不存在 —— 这是 fail-closed 的物理依据。
  const pathValue = certificateLine.replace(/^\s*ssl_certificate\s+/, '').replace(/;\s*$/, '');
  assert.ok(pathValue.includes('__'), `证书路径仍带占位符，实际为 ${pathValue}`);
});

test('T2 TLS 模板：80 只跳转、443 反代 127.0.0.1:3001，不对外暴露应用或数据库端口', () => {
  const template = readFileSync(TEMPLATE, 'utf8');
  assert.ok(template.includes('return 301 https://'), '80 端口必须只做 HTTPS 跳转');
  assert.ok(template.includes('proxy_pass http://127.0.0.1:3001;'), '443 必须反代到 127.0.0.1:3001');
  assert.ok(!/listen\s+3001/.test(template), '模板不得直接监听应用端口');
  assert.ok(!/listen\s+3306/.test(template), '模板不得监听数据库端口');
  assert.ok(!/proxy_pass\s+https?:\/\/[^1]/.test(template.replace('http://127.0.0.1:3001', '')),
    '除 127.0.0.1:3001 外不得出现其他反代目标');
});

test('T3 preflight：缺项即 fail closed，且绝不输出环境变量的值', () => {
  const result = runNode(join(here, 'release-preflight.mjs'), [], {
    ERP_DB_PASSWORD: 'super-secret-value-must-not-leak',
    ERP_DB_HOST: 'db.internal',
  });
  assert.notEqual(result.status, 0, '目标主机事实缺失时必须非零退出');
  assert.ok(result.output.includes('FAIL'), '必须明确报告失败');
  assert.ok(!result.output.includes('super-secret-value-must-not-leak'), '环境变量的值不得出现在输出中');
  assert.ok(!result.output.includes('db.internal'), '环境变量的值不得出现在输出中');
  // 只登记名称。
  assert.ok(result.output.includes('ERP_DB_PASSWORD'), '必须登记环境变量名称');
});

test('T4 preflight：输出为带 SHA-256 摘要的 JSON，且记录发布 commit', () => {
  const result = runNode(join(here, 'release-preflight.mjs'), [], {});
  const jsonStart = result.stdout.indexOf('{');
  assert.ok(jsonStart >= 0, '必须输出 JSON');
  const parsed = JSON.parse(result.stdout.slice(jsonStart));
  assert.match(parsed.digest, /^[0-9a-f]{64}$/, '必须带 SHA-256 摘要');
  assert.ok(parsed.git?.commit, '必须记录发布 commit');
  assert.ok(parsed.versions?.node, '必须记录 Node 版本');
  // 摘要是正文事实的摘要：去掉 digest 字段后重算必须一致。
  const { digest, ...rest } = parsed;
  assert.equal(createHash('sha256').update(JSON.stringify(rest)).digest('hex'), digest,
    '摘要必须是正文事实的摘要');
});

test('T5 目标环境验证器：目标不可达时必须失败（非零退出）', () => {
  const result = runNode(join(here, 'verify-release-target.mjs'),
    ['--host', 'release-target.invalid', '--timeout-ms', '3000']);
  assert.notEqual(result.status, 0, '不可达目标必须非零退出');
  assert.ok(result.output.includes('FAIL'), '必须明确报告失败');
});
