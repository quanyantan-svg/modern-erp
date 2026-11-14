/**
 * 历史引用纠错登记（DOC-REF-CORR-01）。
 *
 * 背景：append-only 的历史文档（`log/YYYY-MM-DD.md`）中可能存在**已写下的**失效相对链接。
 * 这些行不能改写、删除或伪造（AGENTS.md §12），因此 N1 只能**如实报告**它们。
 * 本模块提供一种**精确**的例外机制：登记在册的断链可以被判为 `CORRECTED_REFERENCE`。
 *
 * 窄口径合同（缺一不可，任何一条不满足即**不覆盖**）：
 *   1. 原文件路径必须精确相等（仓库相对路径，不允许通配符）；
 *   2. 错误目标必须精确相等（不允许通配符）；
 *   3. 原行内容哈希必须精确相等（SHA-256，64 位十六进制）；
 *   4. 正确目标必须可达（文件存在 + 锚点存在）；
 *   5. 登记必须唯一 —— 同一 (原文件, 错误目标, 行哈希) 不得重复登记。
 *
 * 本模块**不得**提供通配忽略、模糊匹配或「按文件名批量修复」。
 * 登记与实际漂移（行内容变化）会使登记失效并被报出，防止登记退化为
 * 「预授权未来任意修复」的后门。
 *
 * 本模块只**只读**；不修改任何仓库文件、数据库或 Git 状态。
 */

import { createHash } from 'node:crypto';

/** 纠错登记文件路径。 */
export const CORRECTIONS_PATH = 'docs/acceptance/document-reference-corrections.md';

/** 登记条目所在小节的标题标记。解析只在该标记之后的小节内进行。 */
const CORRECTIONS_HEADING_RE = /^#{1,6}\s+DOC-REF-CORR-01\b/;

const CORRECTION_ID_RE = /^DOC-REF-CORR-\d{2,}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 通配符字符：任何出现在路径或目标里的通配符都被拒绝。 */
const GLOB_RE = /[*?[\]{}]/;

const COLUMN_COUNT = 8;

function stripCode(cell) {
  return String(cell ?? '').trim().replace(/^`+/, '').replace(/`+$/, '').trim();
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/[ ]/g, '')));
}

/**
 * 计算一行原文的稳定内容哈希。
 *
 * 归一化规则：去掉行尾 `\r`（工作树 CRLF 与 Git blob LF 必须同值）与首尾空白。
 * 这样同一行在提交前后、工作树与 Git 对象之间得到相同哈希。
 */
export function hashLine(line) {
  return createHash('sha256')
    .update(String(line ?? '').replace(/\r/g, '').trim())
    .digest('hex');
}

/**
 * 解析纠错登记正文。
 *
 * @param {string|null} text 登记文件正文
 * @returns {{entries: Array<{id: string, sourceFile: string, lineHash: string, oldTarget: string, newTarget: string, registeredAt: string, owner: string, approval: string}>, errors: string[]}}
 */
export function parseCorrections(text) {
  const entries = [];
  const errors = [];
  if (!text) return { entries, errors };
  const lines = String(text).replace(/\r/g, '').split('\n');
  let inSection = false;
  const seenIds = new Set();
  const seenTriples = new Map();
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      inSection = CORRECTIONS_HEADING_RE.test(line);
      continue;
    }
    if (!inSection) continue;
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== COLUMN_COUNT) {
      errors.push(`  登记行不是 ${COLUMN_COUNT} 列（纠错 ID / 原文件 / 原行内容哈希 / 错误目标 / 正确目标 / 登记日期 / Owner / 批准依据）: ${trimmed}`);
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    /*
     * 数据行的纠错 ID 必须用反引号包裹 —— 这是「数据行」与「表头行」的唯一无歧义区分。
     * 包裹了但不是合法 ID 形式的行是**格式错误**，必须报出。
     */
    if (!/^`[^`]+`$/.test(cells[0])) continue;
    const id = stripCode(cells[0]);
    if (!CORRECTION_ID_RE.test(id)) {
      errors.push(`  登记行的纠错 ID 非法（必须是 DOC-REF-CORR-NN）: ${cells[0]}`);
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(`  纠错 ID 重复登记: ${id}`);
      continue;
    }
    const sourceFile = stripCode(cells[1]);
    const lineHash = stripCode(cells[2]).toLowerCase();
    const oldTarget = stripCode(cells[3]);
    const newTarget = stripCode(cells[4]);
    const registeredAt = stripCode(cells[5]);
    const owner = stripCode(cells[6]);
    const approval = stripCode(cells[7]);

    let bad = null;
    if (!sourceFile) bad = '缺少原文件';
    else if (GLOB_RE.test(sourceFile)) bad = `原文件含通配符: ${sourceFile}`;
    else if (sourceFile.startsWith('/') || sourceFile.includes('..')) bad = `原文件必须是仓库相对路径且不得含 ..: ${sourceFile}`;
    else if (!SHA256_RE.test(lineHash)) bad = `原行内容哈希非法（必须是 64 位小写十六进制）: ${cells[2]}`;
    else if (!oldTarget) bad = '缺少错误目标';
    else if (GLOB_RE.test(oldTarget)) bad = `错误目标含通配符: ${oldTarget}`;
    else if (!newTarget) bad = '缺少正确目标';
    else if (GLOB_RE.test(newTarget)) bad = `正确目标含通配符: ${newTarget}`;
    else if (oldTarget === newTarget) bad = `正确目标与错误目标相同: ${newTarget}`;
    else if (!DATE_RE.test(registeredAt)) bad = `登记日期非法（必须是 YYYY-MM-DD）: ${cells[5]}`;
    else if (!owner) bad = '缺少 Owner';
    else if (!approval) bad = '缺少批准依据';
    if (bad) {
      errors.push(`  纠错登记 ${id} 不合法 —— ${bad}`);
      continue;
    }

    const triple = `${sourceFile} ${oldTarget} ${lineHash}`;
    if (seenTriples.has(triple)) {
      errors.push(`  纠错登记重复（同一原文件 + 错误目标 + 原行内容哈希）: ${id} 与 ${seenTriples.get(triple)}`);
      continue;
    }
    seenIds.add(id);
    seenTriples.set(triple, id);
    entries.push({ id, sourceFile, lineHash, oldTarget, newTarget, registeredAt, owner, approval });
  }
  return { entries, errors };
}

/**
 * 查找能覆盖某条当前断链的登记条目。
 *
 * 覆盖要求（全部满足）：原文件、错误目标、原行内容哈希三者**完全相等**。
 * 任何一项不等即视为**未登记**，断链继续 fail closed。
 */
export function correctionFor(corrections, broken) {
  const candidates = (corrections?.entries || []).filter((entry) => (
    entry.sourceFile === broken.from
    && entry.oldTarget === broken.target
    && entry.lineHash === broken.lineHash
  ));
  return candidates.length ? { entry: candidates[0] } : null;
}

/** 登记条目的稳定标识（用于失效检测与报告）。 */
export function correctionKey(entry) {
  return `${entry.id} ${entry.sourceFile} ${entry.oldTarget} ${entry.lineHash}`;
}
