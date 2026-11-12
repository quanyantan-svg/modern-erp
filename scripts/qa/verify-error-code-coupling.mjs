// 跨域错误码耦合守卫（2026-11-12）
//
// 背景：域级验收审计发现，Sales 域已签发的 Wave 7 行为依赖 Planning 域的
// **内部**错误码分类。Planning 合法地改了自己的内部错误码，就击穿了另一个
// 域的已签发结论（PLAN-DEF-08）。本脚本把这类耦合变成机器可验证的清单，
// 使它不能再静默复发。
//
// 耦合分三类，处置方式不同：
//   LOCAL —— 消费方引用的是自己定义的错误码。不是耦合。
//   DECISION —— 消费方用生产方的错误码做**自己的业务判断**。
//               必须消除：消费方在自己的模块内自包含地判定。
//   CONTRACT_TRANSLATION —— 消费方只把生产方的明细翻译成自己的对外错误码，
//               不用它做业务判断。允许，但必须在下面的登记表中显式登记
//               理由；生产方改该码属跨域合同变更，须走对应域的
//               Requirement / Design 裁定。
//   FRONTEND_CONTRACT —— 前端按后端错误码分支。它是**已发布**的 API 合同，
//               同样必须登记，否则后端改码会静默改变前端行为。
//
// 另有一条硬规则：引用一个**生产代码中已不存在**的错误码是死引用，一律 FAIL。
//
// 扫描范围：生产代码（server/ 与 src/）。测试与集成测试文件是对合同的
// **断言**，不是耦合，因此排除在规则之外，但单独列出以便查阅。
//
// 用法：node scripts/qa/verify-error-code-coupling.mjs
// 只读：不写任何文件、不碰数据库。发现未登记的耦合或死引用时返回非零退出码。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['server', 'src'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

// 已登记的跨模块耦合。每一条都必须写明理由；未登记的耦合一律 FAIL。
const APPROVED_COUPLINGS = [
  {
    consumer: 'server/modules/sales-reservation-intent.js',
    code: 'PLANNING_RESERVATION_CAPACITY_EXCEEDED',
    owner: 'server/modules/planning-domain.js',
    class: 'CONTRACT_TRANSLATION',
    rationale: 'Planning 是预留容量计算的唯一 owner；Sales 只把它的明细（remaining / requested）翻译成 Sales 的对外错误码，不用该码做任何业务判断。Planning 改该码属跨域合同变更，须回到 Planning 的 Requirement / Design 裁定。',
  },
  {
    consumer: 'src/pages/master-data.jsx',
    code: 'PERMISSION_DENIED',
    owner: 'server/lib/http.js',
    class: 'FRONTEND_CONTRACT',
    rationale: '权限拒绝是已发布的 HTTP 状态码合同（401 / 403），前端按它分支提示。改该码必须同时改前端，属跨域合同变更。',
  },
];

const DRIVER_CODE = /^(SQLITE_|ER_|ERDUP|NODE_|MYSQL_)/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const posix = (file) => relative(ROOT, file).split(sep).join('/');
const isTestFile = (file) => /\.test\.[a-z]+$/.test(file) || /\.integration\.[a-z]+$/.test(file)
  || file.includes('/test-fixtures/') || file.includes('/__tests__/');

const allFiles = SCAN_DIRS.flatMap((dir) => walk(join(ROOT, dir)));
const productionFiles = allFiles.filter((file) => !isTestFile(posix(file)));
const testFiles = allFiles.filter((file) => isTestFile(posix(file)));

const CAUGHT_RE = /\b(?:error|err|cause)\??\.code\s*===?\s*'([A-Z][A-Z0-9_]{3,})'/g;
const LITERAL_RE = /'([A-Z][A-Z0-9_]{3,})'/g;

// owner：一个错误码在哪些**生产代码**文件里出现。
const owners = new Map();
for (const file of productionFiles) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(LITERAL_RE)) {
    if (!owners.has(match[1])) owners.set(match[1], new Set());
    owners.get(match[1]).add(posix(file));
  }
}

const findings = [];
for (const file of productionFiles) {
  const consumer = posix(file);
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(CAUGHT_RE)) {
    const code = match[1];
    const definedIn = [...(owners.get(code) || [])].filter((f) => f !== consumer).sort();
    if (!definedIn.length && !owners.has(code)) {
      findings.push({ consumer, code, definedIn, kind: 'DEAD' });
      continue;
    }
    if (!definedIn.length) {
      findings.push({ consumer, code, definedIn, kind: 'LOCAL' });
      continue;
    }
    if (DRIVER_CODE.test(code)) {
      findings.push({ consumer, code, definedIn, kind: 'DRIVER' });
      continue;
    }
    const approval = APPROVED_COUPLINGS.find((entry) => entry.consumer === consumer && entry.code === code);
    const ownerMatch = approval && definedIn.includes(approval.owner);
    findings.push({
      consumer,
      code,
      definedIn,
      kind: ownerMatch ? approval.class : 'UNAPPROVED',
      rationale: ownerMatch ? approval.rationale : undefined,
    });
  }
}

// 测试文件里的引用单独统计：那是**对合同的断言**，不是耦合。
const testAssertions = [];
for (const file of testFiles) {
  const consumer = posix(file);
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(CAUGHT_RE)) {
    testAssertions.push({ consumer, code: match[1] });
  }
}

const groups = {
  APPROVED: findings.filter((f) => f.kind === 'CONTRACT_TRANSLATION' || f.kind === 'FRONTEND_CONTRACT'),
  UNAPPROVED: findings.filter((f) => f.kind === 'UNAPPROVED'),
  DEAD: findings.filter((f) => f.kind === 'DEAD'),
  DRIVER: findings.filter((f) => f.kind === 'DRIVER'),
  LOCAL: findings.filter((f) => f.kind === 'LOCAL'),
};

console.log('=== 跨域错误码耦合清单 ===');
console.log(`扫描生产文件 ${productionFiles.length} 个（另排除测试/集成测试文件 ${testFiles.length} 个）\n`);
for (const [title, list] of [
  ['已登记的契约耦合', groups.APPROVED],
  ['未登记的跨模块耦合（必须处置）', groups.UNAPPROVED],
  ['死引用（引用的错误码在生产代码中已不存在）', groups.DEAD],
  ['驱动级错误码（非域间耦合）', groups.DRIVER],
]) {
  console.log(`--- ${title} (${list.length}) ---`);
  for (const f of list) {
    console.log(`  ${f.consumer}  <-  ${f.code}`);
    console.log(`      定义方: ${f.definedIn.join(', ') || '（生产代码中不存在）'}`);
    if (f.rationale) console.log(`      理由: ${f.rationale}`);
  }
}
console.log(`--- 本模块自有错误码（${groups.LOCAL.length}，非耦合）---`);
console.log(`--- 测试/集成测试中的合同断言（${testAssertions.length} 处，非耦合）---`);

console.log('\n=== 结论 ===');
console.log(`  已登记 ${groups.APPROVED.length} / 未登记 ${groups.UNAPPROVED.length} / 死引用 ${groups.DEAD.length}`);
if (groups.UNAPPROVED.length || groups.DEAD.length) {
  console.log('\n  FAIL：存在未登记的跨模块耦合或死引用。');
  console.log('  处置：消费方必须在自己的模块内自包含地判定（DECISION 类）；');
  console.log('        确属契约转译的耦合登记进本脚本的 APPROVED_COUPLINGS 并写明理由。');
  process.exit(1);
}
console.log('\n  PASS：没有未登记的跨模块错误码耦合，也没有死引用。');
