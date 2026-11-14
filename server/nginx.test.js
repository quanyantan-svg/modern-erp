import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nginxConfigPath = join(root, 'deploy', 'nginx', 'modern-erp.conf');

function readConfig() {
  return readFileSync(nginxConfigPath, 'utf8');
}

function locations(config) {
  return [...config.matchAll(/location\s+([^\s{]+)\s*\{/g)].map(match => match[1]);
}

describe('nginx reverse proxy config', () => {
  test('config file exists and defines one HTTP server block', () => {
    const config = readConfig();

    assert.ok(existsSync(nginxConfigPath));
    assert.match(config, /server\s*\{/);
    assert.match(config, /^\s*listen\s+80;$/m);
    assert.match(config, /^\s*listen\s+\[::\]:80;$/m);
    assert.match(config, /^\s*server_name\s+_;$/m);
  });

  test('all request paths use the same proxy to the local Node service', () => {
    const config = readConfig();

    assert.deepEqual(locations(config), ['/']);
    assert.match(config, /^\s*proxy_pass\s+http:\/\/127\.0\.0\.1:3001;$/m);
    assert.doesNotMatch(config, /root\s+|alias\s+|try_files\s+|\/api\s*\{|\/assets\s*\{/);
  });

  test('required proxy headers are forwarded', () => {
    const config = readConfig();

    assert.match(config, /^\s*proxy_set_header\s+Host\s+\$host;$/m);
    assert.match(config, /^\s*proxy_set_header\s+X-Real-IP\s+\$remote_addr;$/m);
    // The client may send its own X-Forwarded-For; only the peer address may
    // be forwarded, otherwise the source IP in login lockout and audit records
    // is attacker controlled.
    assert.match(config, /^\s*proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;$/m);
    assert.doesNotMatch(config, /\$proxy_add_x_forwarded_for/);
    assert.match(config, /^\s*proxy_set_header\s+X-Forwarded-Proto\s+\$scheme;$/m);
  });

  test('keeps body size and timeout settings modest', () => {
    const config = readConfig();

    // Must stay above the application attachment limit (HTTP_ATTACHMENT_LIMIT_BYTES,
    // 10 MiB by default) so uploads are not rejected by the proxy.
    assert.match(config, /^\s*client_max_body_size\s+12m;$/m);
    assert.match(config, /^\s*proxy_connect_timeout\s+10s;$/m);
    assert.match(config, /^\s*proxy_send_timeout\s+60s;$/m);
    assert.match(config, /^\s*proxy_read_timeout\s+60s;$/m);
    assert.doesNotMatch(config, /websocket|Upgrade|443|ssl|certbot|0\.0\.0\.0/i);
  });

  test('compresses JSON and static responses', () => {
    const config = readConfig();

    assert.match(config, /^\s*gzip\s+on;$/m);
    assert.match(config, /^\s*gzip_types\s+.*application\/json.*$/m);
  });
});
