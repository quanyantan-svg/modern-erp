// 用户可见文案位的唯一识别实现。
//
// 界面语言守卫（Requirement §36.19 PL-LANG-01..07 / Design §32.19.5）与
// 用户可见文案守卫（Requirement §36.22 PL-UX-01/02 / Design §32.22.8）判定
// 的是**同一批位置**，规则不同：前者禁英文散文，后者禁研发内部标识。因此
// 位置识别只有这一处实现，两个守卫都从这里取事实。
//
// 只扫描会呈现给最终用户的位置：
//   · 前端展示位（label / title / placeholder / description / context … 的字面量）；
//   · 前端 JSX 文本节点；
//   · 前端通知与 toast 文案；
//   · 后端响应消息位（HttpError 消息、响应体 message/error、helper 首参）。
//
// **不**扫描源码注释、route key、permission code、CSS 类名、data-testid、
// SQL、表名列名等内部标识符（Requirement §36.22 PL-UX-08）。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..', '..', '..');

export function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

export const isTestFile = (file) => /(^|[\\/])[^\\/]*\.test\.(jsx?|mjs)$/.test(file) || /\.integration\.(jsx?|mjs)$/.test(file);

export function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** 前端展示位的 prop 名。`context` 是业务上下文说明，同样是用户可见文案。 */
const FRONTEND_PROP = /\b(label|title|placeholder|aria-label|subtitle|description|summary|emptyText|context|help|hint|formalLabel|mobileLabel|ariaLabel)\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
const FRONTEND_OBJECT_FIELD = /\b(label|title|message|description|placeholder|summary|context|formalLabel|mobileLabel|emptyText|hint|helpText|ariaLabel)\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
const FRONTEND_NOTIFY = /\b(?:notify|setToast)\s*\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
const FRONTEND_TOAST = /\bmessage\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
// JSX 文本节点：> 文本 <。必须排除代码片段（含括号、分号、逗号、等号、引号、冒号、问号）。
const FRONTEND_JSX_TEXT = />([^<>{}()[\];=,.'"`$#\\|:?]*[A-Za-z][^<>{}()[\];=,.'"`$#\\|:?]*)</g;

/**
 * `src/navigation/domainMetadata.js` 的 `label` 是**领域标识符**，按 Requirement
 * §36.19 PL-NAVI-03 保留英文、不得进入用户界面，因此不参与用户可见文案判定。
 */
const DOMAIN_METADATA = resolve(root, 'src', 'navigation', 'domainMetadata.js');

// 后端响应体里会呈现给用户的文本位。字段集合沿用 §36.19 `PL-LANG-04` 已批准的
// 范围（error / message / resolution）；扩大扫描面属于守卫合同变更，需要业务
// 所有者批准后另行登记，不在实现里自行扩权。
const BACKEND_RESPONSE_FIELD = /\b(?:error|message|resolution)\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
const BACKEND_HELPER_ARG = /\b(?:mutationConflict|trackingError|conflictError|badRequest|invalidRequest)\s*\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;

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

function inspect(out, file, line, text, source) {
  if (!text || !text.trim()) return;
  out.push({ file: relative(root, file).replace(/\\/g, '/'), line, text: text.trim(), source });
}

function scanFrontend(file, out) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of [FRONTEND_PROP, FRONTEND_OBJECT_FIELD]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (file === DOMAIN_METADATA && match[1] === 'label') continue;
      inspect(out, file, lineOf(text, match.index), match[2] ?? match[3] ?? match[4], 'display-label');
    }
  }
  for (const pattern of [FRONTEND_NOTIFY, FRONTEND_TOAST]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      inspect(out, file, lineOf(text, match.index), match[1] ?? match[2] ?? match[3], 'notify');
    }
  }
  // JSX 文本节点只在 .jsx 里存在；.js 文件里的 `>` / `<` 是运算符。
  if (file.endsWith('.jsx')) {
    FRONTEND_JSX_TEXT.lastIndex = 0;
    for (const match of text.matchAll(FRONTEND_JSX_TEXT)) {
      inspect(out, file, lineOf(text, match.index), match[1], 'jsx-text');
    }
  }
}

function scanBackend(file, out) {
  const text = readFileSync(file, 'utf8');
  for (const { raw, index } of httpErrorMessages(text)) {
    inspect(out, file, lineOf(text, index), raw, 'http-error');
  }
  for (const pattern of [BACKEND_RESPONSE_FIELD, BACKEND_HELPER_ARG]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      inspect(out, file, lineOf(text, match.index), match[1] ?? match[2] ?? match[3], 'response-field');
    }
  }
}

/** 前端扫描集合：src/ 下的全部实现文件，测试文件除外。 */
export function frontendFiles() {
  return walk(resolve(root, 'src')).filter((file) => !isTestFile(file));
}

/**
 * 后端扫描集合：只扫描请求处理层。server/database/ 是 MySQL worker 内部协议，
 * server/migrations/ 是 schema 演进，两者都不产生面向最终用户的消息。
 */
export function backendFiles() {
  return [
    resolve(root, 'server', 'app.js'),
    ...walk(resolve(root, 'server', 'lib')),
    ...walk(resolve(root, 'server', 'modules')),
  ].filter((file) => !isTestFile(file));
}

/**
 * 采集全部用户可见文案位。
 *
 * @returns {{ file: string, line: number, text: string, source: string }[]}
 */
export function collectUserVisibleTexts() {
  const out = [];
  for (const file of frontendFiles()) scanFrontend(file, out);
  for (const file of backendFiles()) scanBackend(file, out);
  const grouped = new Map();
  for (const entry of out) {
    const key = `${entry.file}:${entry.line}:${entry.text}`;
    if (!grouped.has(key)) grouped.set(key, entry);
  }
  return [...grouped.values()].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
}
