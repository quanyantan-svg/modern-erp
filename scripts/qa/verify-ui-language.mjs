// 界面语言守卫（Requirement §36.19 PL-LANG-01..07 / Design §32.19.5）。
//
// 目的：最终用户界面上不允许出现英文。历史缺陷有两条来源：
//   ① 前端文案本身是英文（启动器分组标题是 8 个英文域名、全大写英文页眉眉标、
//      中文句子里夹着 canonical / legacy / fail closed / override 等英文单词）；
//   ② 后端错误消息是英文，且经 `server/lib/http.js` 的 serializeError →
//      响应体 message → `src/lib/copy.js` 的 `return serverMessage` 原样透出。
//
// 判定方式：只扫描**会呈现给最终用户**的位置（前端文案位 + 后端响应消息位），
// 不扫描 route key、permission code、CSS 类名、data-testid、SQL、表名列名等
// 内部标识符。
//
// 词形分类（决定一个英文 token 是不是「英文散文」）：
//   path       —— 含 `/`，是路径片段（`/api/planning/mrp/runs`）；
//   identifier —— camelCase（`bomId`）、snake_case（`commercial_source_marker`）；
//   constant   —— 全大写枚举 / 常量（`REJECT`、`SALES_SUB_REPORTS`、`M&Q`、`A-61`）；
//   prose      —— 其余（`Duplicate`、`legacy`、`Preview`），这些才是要改的。
//
// 位置差异：前端文案位里的全大写 token 是**英文散文**（页眉眉标），必须改；
// 后端消息位里的全大写 token 是枚举值，保留。中文书名号「」内的内容是显式标注的
// 技术标识符，不参与判定。
//
// 白名单是**显式枚举**：领域专名与缩写、内部条目编号、产品名。
// 白名单条目必须逐条可读，不得使用通配规则（Requirement §36.19 PL-LANG-07）。
//
// 只读：不连数据库、不写仓库、不改任何业务数据。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..', '..');

/**
 * 允许保留的英文词。分三类：领域专名与缩写、内部条目编号用词、产品名用词。
 * 大小写敏感：`MRP` 与 `mrp` 不同义，不混用。
 */
const ALLOWED_WORDS = new Set([
  // 制造、质量与财务缩写
  'MRP', 'BOM', 'WIP', 'IQC', 'OQC', 'GRNI', 'LOT', 'SERIAL', 'UOM', 'ABC', 'GL', 'AR', 'AP',
  'COGS', 'SKU', 'OEM', 'FIFO', 'LIFO', 'EOQ', 'GRN', 'IRN', 'DN', 'SO', 'PO', 'PR', 'MFG',
  // 通用技术缩写与格式
  'JSON', 'CSV', 'PDF', 'HTML', 'XML', 'SQL', 'API', 'ID', 'Code', 'HTTP', 'URL', 'OK', 'UI',
  'ERP', 'SaaS', 'UTF', 'GBK', 'PDF', 'MIME',
  // 产品名
  'Modern', 'ERP',
  // 内部批次编号用词
  'Wave',
  // 行业与质量专名
  'VMI', 'QCP', 'CAS',
]);

/** 形如 `SC01` / `PRC-04` / `PL-RI-01` / `M&Q` / `A-61` / `IND_A` / `YYYY-MM` 的内部编号与枚举常量。 */
const INTERNAL_NUMBERING = /^(?:Wave\d+|[A-Z]{1,6}&[A-Z]{1,6}|[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+|[A-Z]{2,}(?:_[A-Z0-9]+)+|[A-Z]{2,6}\d{1,4})$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const isTestFile = (file) => /(^|[\\/])[^\\/]*\.test\.(jsx?|mjs)$/.test(file) || /\.integration\.(jsx?|mjs)$/.test(file);

function classifyToken(token) {
  if (INTERNAL_NUMBERING.test(token)) return 'constant';
  if (/^[a-z][a-zA-Z0-9]*[A-Z]/.test(token)) return 'identifier';
  if (/^[a-z]+(_[a-z0-9]+)+$/.test(token)) return 'identifier';
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(token)) return 'identifier';
  if (/^[A-Z][A-Z0-9&]*$/.test(token)) return 'all-caps';
  return 'prose';
}

/** 源码里可能用 `\uXXXX` 转义写中文；判定前先还原，否则会把中文误判成英文。 */
function decodeEscapes(text) {
  return String(text).replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** 取出待判定的英文散文 token。 */
function proseTokens(text, { source }) {
  const raw = decodeEscapes(text).trim();
  if (raw.length <= 1) return [];                       // 单个字符不可能是英文散文
  if (/^[\w.+-]+@[\w.-]+$/.test(raw)) return [];         // 邮箱占位符
  const hasCjk = /[㐀-鿿]/.test(raw);
  const stripped = raw
    .replace(/「[^」]*」/g, ' ')
    .replace(/\$\{[^}]*\}/g, ' ')   // 模板插值里的变量名不是文案
    .replace(/\/[\w.{}:/-]+/g, ' '); // URL 路径片段
  const tokens = stripped.match(/[A-Za-z][A-Za-z0-9_&-]*/g) || [];
  const prose = [];
  for (const token of tokens) {
    if (ALLOWED_WORDS.has(token)) continue;
    const kind = classifyToken(token);
    if (kind === 'prose') { prose.push(token); continue; }
    if (kind === 'all-caps') {
      // 显示标签必须是中文；纯英文串（含多词英文眉标）也必须中文。
      // 中文句子里引用的枚举值（全大写）保留 —— 它是用户需要原样引用的标识符。
      if (source === 'display-label' || !hasCjk) prose.push(token);
      continue;
    }
    // identifier / constant：允许
  }
  return prose;
}

const findings = [];

function inspect(file, line, text, source) {
  for (const word of proseTokens(text, { source })) {
    findings.push({ file: relative(root, file).replace(/\\/g, '/'), line, word, text: text.trim(), source });
  }
}

// --- 前端文案位 -----------------------------------------------------------

const FRONTEND_PROP = /\b(label|title|placeholder|aria-label|subtitle|description|summary|emptyText|context|help|hint|formalLabel|mobileLabel|ariaLabel)\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
// `src/navigation/domainMetadata.js` 的 `label` 是**领域标识符**，按 Requirement §36.19
// PL-NAVI-03 保留英文、不得进入用户界面，因此不参与本守卫的文案判定；
// 「英文 label 是否被误用到界面」由导航可达性守卫的 PL-NAVI-03/04 断言负责。
const FRONTEND_OBJECT_FIELD = /\b(label|title|message|description|placeholder|summary|context|formalLabel|mobileLabel|emptyText|hint|helpText|ariaLabel)\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
const DOMAIN_METADATA = resolve(root, 'src', 'navigation', 'domainMetadata.js');
const FRONTEND_NOTIFY = /\b(?:notify|setToast)\s*\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
const FRONTEND_TOAST = /\bmessage\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
// JSX 文本节点：> 文本 <。必须排除代码片段（含括号、分号、逗号、等号、引号、冒号、问号）。
const FRONTEND_JSX_TEXT = />([^<>{}()[\];=,.'"`$#\\|:?]*[A-Za-z][^<>{}()[\];=,.'"`$#\\|:?]*)</g;

function scanFrontend(file) {
  const text = readFileSync(file, 'utf8');
  for (const [pattern, source] of [[FRONTEND_PROP, 'display-label'], [FRONTEND_OBJECT_FIELD, 'display-label']]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[2] ?? match[3] ?? match[4];
      if (!value || !/[A-Za-z]/.test(value)) continue;
      if (file === DOMAIN_METADATA && source === 'display-label' && match[1] === 'label') continue;
      inspect(file, lineOf(text, match.index), value, source);
    }
  }
  for (const [pattern, source] of [[FRONTEND_NOTIFY, 'notify'], [FRONTEND_TOAST, 'toast']]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[1] ?? match[2] ?? match[3];
      if (!value || !/[A-Za-z]/.test(value)) continue;
      inspect(file, lineOf(text, match.index), value, source);
    }
  }
  // JSX 文本节点只在 .jsx 里存在；.js 文件里的 `>` / `<` 是运算符。
  if (file.endsWith('.jsx')) {
    FRONTEND_JSX_TEXT.lastIndex = 0;
    for (const match of text.matchAll(FRONTEND_JSX_TEXT)) {
      const value = match[1];
      if (!value || !/[A-Za-z]/.test(value)) continue;
      inspect(file, lineOf(text, match.index), value, 'jsx-text');
    }
  }
}

// --- 后端响应消息位 -------------------------------------------------------

/** 取 `HttpError(` 第二个参数里的字符串内容（支持引号与模板字面量）。 */
function httpErrorMessages(text) {
  const results = [];
  const pattern = /(?:new\s+)?HttpError\s*\(/g;
  for (const match of text.matchAll(pattern)) {
    let index = match.index + match[0].length;
    let depth = 1;
    let foundComma = false;
    while (index < text.length) {
      const char = text[index];
      if (char === '(' || char === '[' || char === '{') depth += 1;
      else if (char === ')' || char === ']' || char === '}') {
        depth -= 1;
        if (depth === 0) break;
      } else if (char === ',' && depth === 1) {
        foundComma = true;
        index += 1;
        break;
      }
      index += 1;
    }
    if (!foundComma) continue;
    const argument = text.slice(index).trimStart();
    const literal = argument.match(/^(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/);
    if (literal) results.push({ raw: literal[1] ?? literal[2] ?? literal[3], index });
  }
  return results;
}

/** `send(res, 4xx, { error: '…' })` 这类响应体里的 message / error / resolution。 */
const BACKEND_RESPONSE_FIELD = /\b(?:error|message|resolution)\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
/** 形如 `mutationConflict('English', code)` 的 helper 调用。 */
const BACKEND_HELPER_ARG = /\b(?:mutationConflict|trackingError|conflictError|badRequest|invalidRequest)\s*\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;

function scanBackend(file) {
  const text = readFileSync(file, 'utf8');
  for (const { raw, index } of httpErrorMessages(text)) {
    inspect(file, lineOf(text, index), raw, 'http-error');
  }
  for (const [pattern, source] of [[BACKEND_RESPONSE_FIELD, 'response-field'], [BACKEND_HELPER_ARG, 'helper-arg']]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[1] ?? match[2] ?? match[3];
      if (!value || !/[A-Za-z]/.test(value)) continue;
      inspect(file, lineOf(text, match.index), value, source);
    }
  }
}

// --- 执行 -----------------------------------------------------------------

const frontendFiles = walk(resolve(root, 'src')).filter((file) => !isTestFile(file));
// 后端只扫描请求处理层：server/app.js、server/lib/、server/modules/。
// server/database/ 是 MySQL worker 内部协议，server/migrations/ 是 schema 演进，
// 两者都不产生面向最终用户的消息。
const backendFiles = [
  resolve(root, 'server', 'app.js'),
  ...walk(resolve(root, 'server', 'lib')),
  ...walk(resolve(root, 'server', 'modules')),
].filter((file) => !isTestFile(file));

/**
 * 守卫结论。回归测试直接 import 本函数 —— 不在测试进程里再拉起子进程，
 * 避免在 FULL 门禁的并行负载下额外占用进程与内存。
 */
export function collectLanguageFindings() {
  findings.length = 0;
  for (const file of frontendFiles) scanFrontend(file);
  for (const file of backendFiles) scanBackend(file);
  const grouped = new Map();
  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}`;
    if (!grouped.has(key)) grouped.set(key, finding);
  }
  return {
    scannedFrontend: frontendFiles.length,
    scannedBackend: backendFiles.length,
    englishFindings: grouped.size,
    findings: [...grouped.values()].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file))),
  };
}

function main() {
  const report = collectLanguageFindings();
  process.stdout.write(`${JSON.stringify({
    scannedFrontend: report.scannedFrontend,
    scannedBackend: report.scannedBackend,
    englishFindings: report.englishFindings,
  }, null, 2)}\n`);

  if (report.englishFindings) {
    process.stdout.write('\n--- 用户可见英文残留 ---\n');
    for (const finding of report.findings) {
      process.stdout.write(`${finding.file}:${finding.line} [${finding.source}] ${finding.word} — ${finding.text}\n`);
    }
    process.stdout.write(`\n界面语言守卫失败：${report.englishFindings} 处用户可见英文残留\n`);
    process.exit(1);
  }
  process.stdout.write('\n界面语言守卫 PASS：用户可见英文残留为 0\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
