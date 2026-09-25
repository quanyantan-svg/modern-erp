import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const systemdDir = join(root, 'deploy', 'systemd');

function readUnit(name) {
  return readFileSync(join(systemdDir, name), 'utf8');
}

function section(unit, name) {
  const match = unit.match(new RegExp(`\\[${name}\\]([\\s\\S]*?)(?=\\n\\[|$)`));
  return match ? match[1] : '';
}

function directive(unit, name) {
  const match = unit.match(new RegExp(`^${name}=(.+)$`, 'm'));
  return match ? match[1].trim() : undefined;
}

describe('systemd deployment files', () => {
  test('application service uses the dedicated production layout', () => {
    const unit = readUnit('modern-erp.service');

    assert.ok(section(unit, 'Unit'));
    assert.ok(section(unit, 'Service'));
    assert.ok(section(unit, 'Install'));
    assert.equal(directive(unit, 'Type'), 'simple');
    assert.equal(directive(unit, 'User'), 'modern-erp');
    assert.equal(directive(unit, 'Group'), 'modern-erp');
    assert.equal(directive(unit, 'WorkingDirectory'), '/opt/modern-erp');
    assert.equal(directive(unit, 'EnvironmentFile'), '/etc/modern-erp/env');
    assert.equal(directive(unit, 'ExecStart'), '/usr/bin/node server/index.js');
    assert.equal(directive(unit, 'KillSignal'), 'SIGTERM');
    assert.equal(directive(unit, 'Restart'), 'on-failure');
    assert.equal(directive(unit, 'RestartSec'), '5s');
    assert.equal(directive(unit, 'WantedBy'), 'multi-user.target');
  });

  test('application service does not use root, www-data, PM2, or public bind overrides', () => {
    const unit = readUnit('modern-erp.service');

    assert.doesNotMatch(unit, /^User=(root|www-data)$/m);
    assert.doesNotMatch(unit, /^Group=(root|www-data)$/m);
    assert.doesNotMatch(unit, /pm2/i);
    assert.doesNotMatch(unit, /0\.0\.0\.0/);
  });

  test('backup service invokes the verified backup script only', () => {
    const unit = readUnit('modern-erp-backup.service');

    assert.ok(section(unit, 'Unit'));
    assert.ok(section(unit, 'Service'));
    assert.equal(directive(unit, 'Type'), 'oneshot');
    assert.equal(directive(unit, 'User'), 'modern-erp');
    assert.equal(directive(unit, 'Group'), 'modern-erp');
    assert.equal(directive(unit, 'WorkingDirectory'), '/opt/modern-erp');
    assert.equal(directive(unit, 'EnvironmentFile'), '/etc/modern-erp/env');
    assert.equal(directive(unit, 'ExecStart'), '/usr/bin/node scripts/admin/backup-db.mjs');
    assert.ok(existsSync(join(root, 'scripts', 'admin', 'backup-db.mjs')));
    assert.doesNotMatch(unit, /restore-db|systemctl\s+stop|modern-erp\.service/);
  });

  test('backup timer is a persistent daily timer mapped to the backup service', () => {
    const unit = readUnit('modern-erp-backup.timer');

    assert.ok(section(unit, 'Unit'));
    assert.ok(section(unit, 'Timer'));
    assert.ok(section(unit, 'Install'));
    assert.equal(directive(unit, 'OnCalendar'), '*-*-* 02:30:00');
    assert.equal(directive(unit, 'Persistent'), 'true');
    assert.equal(directive(unit, 'Unit'), 'modern-erp-backup.service');
    assert.equal(directive(unit, 'WantedBy'), 'timers.target');
  });
});
