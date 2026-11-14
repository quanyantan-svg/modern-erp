#!/usr/bin/env node
/**
 * 生产依赖分层与供应链门禁（PL-RI-03）。
 *
 * 依据：Requirement §36.16.4、Design §32.16.5。
 *
 * 四类判定：
 *   1. **分类** —— 只在构建 / 测试期执行、运行时不被 `node server/index.js`
 *      加载的包必须归入 `devDependencies`；运行时依赖保持最小集合。
 *   2. **解析版本** —— lockfile 中关键包的**实际解析版本**必须落在已修复区间。
 *   3. **生产图** —— `pnpm list --prod` 不得包含任何构建期包。
 *   4. **公告** —— 必须使用 npm 官方 advisory 数据源，或组织批准且实现兼容
 *      audit API 的镜像。镜像不支持 audit、网络失败或输出不可解析，一律
 *      `INCONCLUSIVE` 且**非零退出**，绝不记为 PASS。
 *
 * high / critical 一律阻断；moderate / low 必须登记可达性、生产暴露面与处置决定。
 *
 * 本脚本**只读**：不写 override、不写 ignore、不更新 lockfile、不安装任何包。
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 只在构建 / 测试期执行、运行时不被加载的包。 */
const BUILD_ONLY_PACKAGES = ['vite', '@vitejs/plugin-react'];

/**
 * 关键包的最低已修复版本。
 *
 * 依据执行时官方 advisory；**不得**把版本号写死为永久豁免 ——
 * 每次执行都会重新核对解析版本。
 */
const REQUIRED_RESOLVED = [
  {
    name: 'vite',
    // GHSA-587h-7wmj-h5pm / GHSA-698v-4r3x-3vcv：受影响区间 >=7.0.0 <=7.3.6。
    minVersion: '7.3.7',
    advisory: 'GHSA-587h-7wmj-h5pm',
    reason: 'launch-editor 存在性检查在 Windows 上可被绕过',
  },
  {
    name: 'source-map-js',
    // GHSA-68fv-2mgg-jv7q：受影响区间 >=1.0.0 <1.2.2。
    minVersion: '1.2.2',
    advisory: 'GHSA-68fv-2mgg-jv7q',
    reason: '索引化 source-map 段偏移可导致事件循环拒绝服务',
  },
];

/**
 * moderate / low 公告的处置登记。
 *
 * 每条必须写明：可达性、生产暴露面、处置决定。缺一即视为未处置。
 */
const ADVISORY_DISPOSITIONS = new Map([
  // 例：['pkg', 'GHSA-xxxx-yyyy-zzzz', { reachable: false, exposure: '...', decision: '...' }]
]);

/** npm 官方 advisory 数据源（Requirement §36.16.4 首选）。 */
const OFFICIAL_ADVISORY_REGISTRY = 'https://registry.npmjs.org/';

function parseArgs(argv) {
  const args = { registry: null, skipAudit: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--registry') args.registry = argv[++i];
    else if (argv[i].startsWith('--registry=')) args.registry = argv[i].slice('--registry='.length);
    else if (argv[i] === '--skip-audit') args.skipAudit = true;
  }
  return args;
}

function runPnpm(args, { allowFailure = false } = {}) {
  const result = spawnSync('pnpm', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  if (result.error) return { ok: false, reason: `pnpm 不可用: ${result.error.message}`, stdout: '', stderr: '' };
  if (result.status !== 0 && !allowFailure) {
    return {
      ok: false,
      reason: `pnpm ${args.join(' ')} 退出码 ${result.status}`,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  }
  return { ok: true, stdout: result.stdout || '', stderr: result.stderr || '', status: result.status };
}

/** 比较 semver 版本号（只处理 x.y.z[-pre] 形式）。 */
function compareVersions(a, b) {
  const parse = (v) => String(v).split('-')[0].split('.').map((n) => Number(n) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) - (right[i] || 0);
  }
  return 0;
}

/**
 * 从 lockfile 的 `packages:` 段读取解析版本。
 *
 * 传递依赖不会出现在 `pnpm list` 的顶层输出里，必须回到 lockfile 读取事实。
 */
function lockfileResolvedVersions() {
  const versions = new Map();
  let text = '';
  try {
    text = readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
  } catch {
    return versions;
  }
  const packagesIndex = text.indexOf('\npackages:');
  if (packagesIndex === -1) return versions;
  const section = text.slice(packagesIndex + 1);
  const end = section.indexOf('\nsnapshots:');
  const body = end === -1 ? section : section.slice(0, end);
  const entryRe = /^ {2}(@?[^@\s][^:\s]*)@(\d[^:\s]*):$/gm;
  let match;
  while ((match = entryRe.exec(body)) !== null) {
    if (!versions.has(match[1])) versions.set(match[1], match[2]);
  }
  return versions;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const problems = [];
  const notes = [];

  /* ---------- 1. manifest 分类 ---------- */
  const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys(manifest.dependencies || {});
  const devDeps = Object.keys(manifest.devDependencies || {});

  if (!manifest.packageManager) {
    problems.push('package.json 缺少 packageManager：必须固定受支持的 pnpm 精确版本');
  } else if (!/^pnpm@\d+\.\d+\.\d+$/.test(manifest.packageManager)) {
    problems.push(`packageManager 必须是精确的 pnpm 版本（pnpm@x.y.z），实际为 "${manifest.packageManager}"`);
  } else {
    notes.push(`packageManager = ${manifest.packageManager}`);
  }

  for (const name of BUILD_ONLY_PACKAGES) {
    if (deps.includes(name)) {
      problems.push(`构建期包 "${name}" 仍在 dependencies：它不被 node server/index.js 加载，必须归入 devDependencies`);
    }
    if (!devDeps.includes(name)) {
      problems.push(`构建期包 "${name}" 未登记在 devDependencies`);
    }
  }

  /* ---------- 2. 生产图（pnpm list --prod） ---------- */
  const listResult = runPnpm(['list', '--prod', '--json']);
  let productionPackages = new Set();
  if (!listResult.ok) {
    problems.push(`无法读取生产依赖图: ${listResult.reason}`);
  } else {
    let parsed = null;
    try { parsed = JSON.parse(listResult.stdout); } catch { parsed = null; }
    if (!parsed || !Array.isArray(parsed) || !parsed.length) {
      problems.push('pnpm list --prod 输出不可解析');
    } else {
      for (const project of parsed) {
        for (const [name, meta] of Object.entries(project.dependencies || {})) {
          productionPackages.add(name);
          if (BUILD_ONLY_PACKAGES.includes(name)) {
            problems.push(`生产依赖图包含构建期包 "${name}"（${meta?.version || '未知版本'}）`);
          }
        }
      }
      notes.push(`生产依赖图共 ${productionPackages.size} 个包：${[...productionPackages].sort().join(', ')}`);
    }
  }

  /* ---------- 3. 关键包的解析版本 ---------- */
  const lockfileVersions = lockfileResolvedVersions();
  const fullList = runPnpm(['list', '--json', '--depth', 'Infinity'], { allowFailure: true });
  const resolved = new Map();
  if (fullList.ok) {
    try {
      const parsed = JSON.parse(fullList.stdout);
      for (const project of parsed) {
        for (const group of ['dependencies', 'devDependencies']) {
          for (const [name, meta] of Object.entries(project[group] || {})) {
            if (meta?.version) resolved.set(name, meta.version);
          }
        }
      }
    } catch { /* 解析失败在下面的必需包检查中体现 */ }
  }
  for (const requirement of REQUIRED_RESOLVED) {
    const version = resolved.get(requirement.name) || lockfileVersions.get(requirement.name);
    if (!version) {
      problems.push(`无法确定 "${requirement.name}" 的解析版本（lockfile / pnpm list 未返回）`);
      continue;
    }
    if (compareVersions(version, requirement.minVersion) < 0) {
      problems.push(
        `"${requirement.name}" 解析为 ${version}，低于已修复版本 ${requirement.minVersion}`
        + `（${requirement.advisory}：${requirement.reason}）`,
      );
    } else {
      notes.push(`${requirement.name} 解析为 ${version}（>= ${requirement.minVersion}，${requirement.advisory}）`);
    }
  }

  /* ---------- 4. 公告（advisory） ---------- */
  const auditRegistry = args.registry || process.env.ERP_ADVISORY_REGISTRY || OFFICIAL_ADVISORY_REGISTRY;
  let auditState = 'SKIPPED';
  let auditDetail = '';
  const advisories = [];

  if (args.skipAudit) {
    auditState = 'SKIPPED';
    auditDetail = '显式跳过（--skip-audit）：本次结果不得作为发布证据';
    problems.push('依赖审计被跳过：发布候选必须执行依赖审计');
  } else {
    const audit = runPnpm(['audit', '--prod', '--json', `--registry=${auditRegistry}`], { allowFailure: true });
    let parsed = null;
    try { parsed = JSON.parse(audit.stdout); } catch { parsed = null; }
    const entries = parsed?.advisories || parsed?.vulnerabilities;
    if (!entries) {
      /*
       * 没有可解析的公告结果 —— 可能是镜像不支持 audit API、网络不可达或输出损坏。
       * 三种情况一律 INCONCLUSIVE：**绝不**把「没有公告」当成 PASS。
       */
      auditState = 'INCONCLUSIVE';
      const lines = `${audit.stderr || ''}\n${audit.stdout || ''}`
        .split('\n').map((l) => l.trim()).filter(Boolean);
      const hint = lines.find((l) => /ERR_|error|Error|not exist|ENOTFOUND|timeout/i.test(l))
        || lines[0] || '无输出';
      auditDetail = `依赖审计没有可解析结果（数据源 ${auditRegistry}）：${hint}`;
    } else {
      const list = Array.isArray(entries) ? entries : Object.values(entries);
      const counts = { low: 0, moderate: 0, high: 0, critical: 0 };
      for (const entry of list) {
        const severity = String(entry.severity || '').toLowerCase();
        const moduleName = entry.module_name || entry.name || (entry.findings && entry.findings[0]?.paths?.[0]?.name) || '未知';
        const advisoryId = entry.github_advisory_id || entry.url || entry.id || '未知公告';
        const finding = (entry.findings || [])[0] || {};
        const paths = (finding.paths || []).map((p) => String(p));
        const reachable = paths.length > 0 && !paths.every((p) => p.startsWith('dev:'));
        advisories.push({ severity, moduleName, advisoryId, reachable, paths });
        if (counts[severity] !== undefined) counts[severity] += 1;
      }
      const blocking = advisories.filter((a) => a.severity === 'high' || a.severity === 'critical');
      if (blocking.length) {
        auditState = 'FAIL';
        for (const advisory of blocking) {
          problems.push(
            `生产依赖存在 ${advisory.severity} 公告 ${advisory.advisoryId}（${advisory.moduleName}）`
            + `：${advisory.paths.slice(0, 3).join(' | ')}`,
          );
        }
      } else {
        const undisposed = advisories.filter((a) => (a.severity === 'moderate' || a.severity === 'low')
          && !ADVISORY_DISPOSITIONS.has(`${a.moduleName} ${a.advisoryId}`));
        if (undisposed.length) {
          auditState = 'FAIL';
          for (const advisory of undisposed) {
            problems.push(
              `生产依赖存在未登记处置的 ${advisory.severity} 公告 ${advisory.advisoryId}（${advisory.moduleName}）：`
              + '必须登记可达性、生产暴露面与处置决定',
            );
          }
        } else {
          auditState = 'PASS';
        }
      }
      auditDetail = `数据源 ${auditRegistry}；high ${counts.high} / critical ${counts.critical} / moderate ${counts.moderate} / low ${counts.low}`;
    }
  }

  /* ---------- 报告 ---------- */
  process.stdout.write('=== PL-RI-03 生产依赖分层与供应链门禁 ===\n');
  for (const note of notes) process.stdout.write(`  · ${note}\n`);
  process.stdout.write(`  · 依赖审计：${auditState} —— ${auditDetail}\n`);
  if (advisories.length) {
    process.stdout.write('  · 公告清单：\n');
    for (const advisory of advisories) {
      const disposition = ADVISORY_DISPOSITIONS.get(`${advisory.moduleName} ${advisory.advisoryId}`);
      process.stdout.write(
        `      ${advisory.severity} ${advisory.moduleName} ${advisory.advisoryId}`
        + ` 可达性=${advisory.reachable ? '生产可达' : '仅开发路径'}`
        + ` 处置=${disposition ? '已登记' : '未登记'}\n`,
      );
    }
  }
  process.stdout.write('\n=== 结论 ===\n');
  if (auditState === 'INCONCLUSIVE') {
    problems.push(`依赖审计不可判定（INCONCLUSIVE）：${auditDetail}；不得记录为 PASS`);
  }
  if (problems.length) {
    for (const problem of problems) process.stdout.write(`  FAIL ${problem}\n`);
    process.stdout.write(`FAIL: ${problems.length} 项不合规\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('PASS: 生产依赖分层、解析版本与公告判定全部通过\n');
}

main();
