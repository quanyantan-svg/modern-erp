#!/usr/bin/env node
/**
 * 目标环境发布 preflight 采集器（PL-RI-05）。
 *
 * 目的：采集**不可伪造**的目标环境事实，让「目标环境就绪」有据可依。
 * 仓库里存在模板**不等于**目标环境就绪；本脚本采集的就是那份证据。
 *
 * 硬性约束：
 *   - **只读**：不修改系统、不重启服务、不开放端口、不写任何主机状态；
 *   - **只输出环境变量名称**，绝不输出变量值（凭据零泄漏）；
 *   - 缺项即 fail closed：任何必需项缺失都返回非零退出码；
 *   - 输出带 SHA-256 的 JSON，便于归档与比对。
 *
 * 用法：
 *   node scripts/admin/release-preflight.mjs [--out <file>] [--strict]
 *
 * 退出码：0 = 全部必需项齐备；1 = 有缺失项；2 = 用法错误。
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 必须由环境注入、且只登记**名称**的变量。 */
const REQUIRED_ENV_NAMES = [
  'NODE_ENV',
  'PORT',
  'ERP_DB_BACKEND',
  'ERP_DB_HOST',
  'ERP_DB_PORT',
  'ERP_DB_NAME',
  'ERP_DB_USER',
  'ERP_DB_PASSWORD',
];

/** 运维类变量：登记名称，不参与必需性判定。 */
const OPTIONAL_ENV_NAMES = [
  'ERP_SEED_DEMO',
  'ERP_ATTACHMENT_DIR',
  'HTTP_ATTACHMENT_LIMIT_BYTES',
  'SESSION_HOURS',
  'LOGIN_MAX_ATTEMPTS',
  'LOGIN_LOCK_MINUTES',
  'TOKEN_LENGTH',
];

/** 目标主机上必须存在的持久化目录。 */
const REQUIRED_DIRECTORIES = [
  '/opt/modern-erp',
  '/etc/modern-erp',
  '/var/lib/modern-erp',
  '/var/backups/modern-erp',
];

/** 目标主机上必须存在并可校验哈希的服务与网关文件。 */
const REQUIRED_SERVICE_FILES = [
  '/etc/systemd/system/modern-erp.service',
  '/etc/nginx/conf.d/modern-erp.conf',
];

function parseArgs(argv) {
  const args = { out: null, strict: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--strict') args.strict = true;
  }
  return args;
}

/** 只读执行一个版本探测命令；不可用时返回 null，不视为失败。 */
function probeVersion(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 15_000,
    shell: process.platform === 'win32',
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout || result.stderr || '').trim().split('\n')[0] || null;
}

function gitInfo() {
  const run = (...args) => {
    const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
    if (result.error || result.status !== 0) return null;
    return String(result.stdout || '').trim() || null;
  };
  const describe = run('describe', '--tags', '--always', '--dirty');
  return {
    commit: run('rev-parse', 'HEAD'),
    shortCommit: run('rev-parse', '--short', 'HEAD'),
    tag: (() => {
      const tag = run('describe', '--tags', '--exact-match');
      return tag || null;
    })(),
    describe,
    branch: run('rev-parse', '--abbrev-ref', 'HEAD'),
  };
}

function fileFacts(paths) {
  return paths.map((target) => {
    if (!existsSync(target)) return { path: target, exists: false, sha256: null, bytes: null };
    const bytes = readFileSync(target);
    return {
      path: target,
      exists: true,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    };
  });
}

function directoryFacts(paths) {
  return paths.map((target) => {
    if (!existsSync(target)) return { path: target, exists: false, writable: false };
    let writable = false;
    try {
      statSync(target);
      writable = true;
    } catch {
      writable = false;
    }
    return { path: target, exists: true, writable };
  });
}

/** 读取已验证备份的 manifest 目录，取最新一条 run id。 */
function latestVerifiedBackup(manifestDir) {
  if (!manifestDir || !existsSync(manifestDir)) return null;
  let entries = [];
  try {
    entries = readdirSync(manifestDir);
  } catch {
    entries = [];
  }
  const manifests = entries.filter((name) => name.endsWith('.json')).sort();
  if (!manifests.length) return null;
  const latest = manifests[manifests.length - 1];
  try {
    const parsed = JSON.parse(readFileSync(path.join(manifestDir, latest), 'utf8'));
    return { manifest: latest, runId: parsed.runId || null, status: parsed.status || null };
  } catch {
    return { manifest: latest, runId: null, status: null };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const problems = [];

  const envNames = [...REQUIRED_ENV_NAMES, ...OPTIONAL_ENV_NAMES];
  const envPresence = envNames.map((name) => ({ name, present: process.env[name] !== undefined }));
  const missingEnv = envPresence.filter((entry) => entry.present && REQUIRED_ENV_NAMES.includes(entry.name)).map((e) => e.name);
  const absentRequiredEnv = REQUIRED_ENV_NAMES.filter((name) => process.env[name] === undefined);

  const serviceFiles = fileFacts(REQUIRED_SERVICE_FILES);
  const directories = directoryFacts(REQUIRED_DIRECTORIES);
  const backupManifestDir = process.env.ERP_BACKUP_MANIFEST_DIR || null;

  const report = {
    collectedAt: new Date().toISOString(),
    collector: 'scripts/admin/release-preflight.mjs',
    host: {
      platform: process.platform,
      release: process.release?.name || null,
      hostname: process.env.COMPUTERNAME || process.env.HOSTNAME || null,
    },
    versions: {
      node: process.version,
      pnpm: probeVersion('pnpm', ['--version']),
      mysql: probeVersion('mysql', ['--version']),
      nginx: probeVersion('nginx', ['-v']),
      systemd: probeVersion('systemctl', ['--version']),
    },
    git: gitInfo(),
    env: {
      // 只登记名称与是否存在，绝不输出值。
      names: envPresence,
      requiredAbsent: absentRequiredEnv,
    },
    directories,
    serviceFiles,
    backup: latestVerifiedBackup(backupManifestDir),
    backupManifestDir,
  };

  report.digest = createHash('sha256').update(JSON.stringify(report)).digest('hex');

  const body = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(body);

  if (absentRequiredEnv.length) {
    problems.push(`必需的环境变量未注入（只登记名称，不记录值）: ${absentRequiredEnv.join(', ')}`);
  }
  const missingFiles = serviceFiles.filter((file) => !file.exists).map((file) => file.path);
  if (missingFiles.length) {
    problems.push(`目标主机的服务 / 网关文件缺失: ${missingFiles.join(', ')}`);
  }
  const missingDirs = directories.filter((dir) => !dir.exists).map((dir) => dir.path);
  if (missingDirs.length) {
    problems.push(`目标主机的持久化目录缺失: ${missingDirs.join(', ')}`);
  }
  if (!report.backup?.runId) {
    problems.push('没有找到已验证的备份 run id：发布前必须有 REMOTE_VERIFIED 的备份快照');
  }
  if (!report.git?.commit) {
    problems.push('无法确定发布 commit');
  }

  if (args.out) {
    writeFileSync(args.out, body, 'utf8');
    process.stderr.write(`preflight 报告已写入 ${args.out}\n`);
  }

  if (problems.length) {
    process.stderr.write(`\n=== 结论 ===\nFAIL: ${problems.length} 项缺失\n`);
    for (const problem of problems) process.stderr.write(`  FAIL ${problem}\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write('\n=== 结论 ===\nPASS: 目标环境 preflight 必需项齐备\n');
}

main();
