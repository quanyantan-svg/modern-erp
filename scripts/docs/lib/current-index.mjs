/**
 * G0 文档体系的「当前文档完整性」索引。
 *
 * 用途（与 `migration-index.mjs` 互补）：
 *   1. 建立当前目标版本下的 Markdown 结构索引：文件、标题、章节正文、元数据；
 *   2. 提供 **结构化** 历史引用解析：以「章节号 + 标题」为锚，
 *      使历史引用在正文被合法修改后**仍然可追溯**（而不是要求逐字不变）；
 *   3. 提供 Active 合同集合、待审集合、元数据解析、正文指纹等原语。
 *
 * 约束：
 *   - 只读。绝不修改任何仓库文件、数据库或 Git 状态；
 *   - 只用 Node.js 内置模块，无第三方依赖；
 *   - 全部内容从 Git 对象读取（`WORKTREE` 时从工作树磁盘读取），不写临时文件。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { showFile, listMarkdown, git } from './migration-index.mjs';

/** 正文的比较指纹：折叠所有空白，避免纯排版差异造成假阳性。 */
export function normalizeBody(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/** 判定一个正文是否「足够大」，值得纳入重复检测（避免样板文字造成噪声）。 */
export const DUPLICATE_MIN_CHARS = 500;

/**
 * 切分标题，返回带编号、层级、行区间与「自有正文」的标题列表。
 *
 * `ownBody` = 从标题行到**下一个任意层级标题**之前的文本，
 * 即**不含子章节**的正文。这样比较两个版本时，
 * 父章节的编号不会因为子章节的改动而误报。
 */
export function splitHeadings(text) {
  const lines = text.split('\n');
  const heads = [];
  let fence = false, fenceChar = '';
  for (let i = 0; i < lines.length; i++) {
    const fm = /^\s*(```+|~~~+)/.exec(lines[i]);
    if (fm) {
      if (!fence) { fence = true; fenceChar = fm[1][0]; }
      else if (fm[1][0] === fenceChar) fence = false;
      continue;
    }
    if (fence) continue;
    const m = /^(#{1,6})\s+(.*)/.exec(lines[i]);
    if (!m) continue;
    const idm = /^(\d+(?:\.\d+)*)/.exec(m[2].trim());
    heads.push({
      title: m[2].trim(),
      depth: m[1].length,
      id: idm ? idm[1] : null,
      startLine: i + 1,
      ownBody: '',
      body: '',
      endLine: lines.length,
    });
  }
  heads.forEach((h, k) => {
    const ownEnd = k + 1 < heads.length ? heads[k + 1].startLine - 1 : lines.length;
    h.ownBody = lines.slice(h.startLine - 1, ownEnd).join('\n');
    const sectionEnd = k + 1 < heads.length ? heads[k + 1].startLine - 1 : lines.length;
    h.endLine = sectionEnd;
    h.body = lines.slice(h.startLine - 1, sectionEnd).join('\n');
  });
  return heads;
}

/**
 * 解析文件开头的元数据引用块（连续的 `> ` 行）。
 * 返回 { key: value }；键为中文标签或 ASCII 标签，`**` 等 Markdown 标记会被剥离。
 *
 * 约定：跳过标题与空行，直到遇到第一行引用块；此后连续引用行都属于元数据块，
 * 遇到第一个非引用、非空行即结束。
 */
export function parseMetadata(text) {
  const meta = {};
  const lines = text.split('\n');
  let started = false;
  for (const line of lines) {
    if (!started) {
      if (line.trim() === '') continue;
      if (line.startsWith('#')) continue;   // 跳过 H1 标题
      if (!line.startsWith('>')) break;    // 元数据块必须紧跟在标题之后
      started = true;
    } else if (line.trim() !== '' && !line.startsWith('>')) {
      break;                                // 元数据块结束
    }
    if (!line.startsWith('>')) continue;
    const m = /^>\s*([^:：]{1,24}?)\s*[:：]\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].replace(/[*`_]/g, '').trim();
    if (!key) continue;
    meta[key] = m[2].trim();
  }
  return meta;
}

/** 文件是否在给定前缀目录下。 */
export function under(file, dir) {
  return file === dir || file.startsWith(dir + '/');
}

/**
 * 建立当前目标版本的文档索引。
 * ref === 'WORKTREE' 时从工作树读取，否则从 Git 对象读取。
 */
export function buildCurrentIndex(repoRoot, ref) {
  const files = listMarkdown(repoRoot, ref);
  const byFile = new Map();
  for (const f of files) {
    const text = showFile(repoRoot, ref, f);
    byFile.set(f, {
      file: f,
      text,
      headings: splitHeadings(text),
      meta: parseMetadata(text),
    });
  }
  return { ref, files, byFile };
}

/** Active 合同集合：根合同文件 + 各 Domain 当前有效 Requirement / Design 正文。 */
export function activeContractFiles(index) {
  return index.files.filter(f =>
    f === 'document.md' || f === 'solution.md' ||
    under(f, 'docs/requirements') || under(f, 'docs/design'));
}

/** 待审候选集合。 */
export function reviewFiles(index) {
  return index.files.filter(f => under(f, 'docs/reviews'));
}

/**
 * 章节正文指纹表：file -> [{ id, title, fingerprint }]
 * 只收录足够大的正文（见 DUPLICATE_MIN_CHARS）。
 */
export function bodyFingerprints(index, files) {
  const map = new Map();
  for (const f of files) {
    const entry = index.byFile.get(f);
    if (!entry) continue;
    const list = [];
    for (const h of entry.headings) {
      if (h.depth < 2 || h.depth > 4) continue;
      const fp = normalizeBody(h.body);
      if (fp.length < DUPLICATE_MIN_CHARS) continue;
      list.push({ id: h.id, title: h.title, fingerprint: fp, depth: h.depth });
    }
    map.set(f, list);
  }
  return map;
}

/**
 * 比较两个版本之间「自有正文」发生变化的章节编号。
 *
 * 返回 { changed: string[], added: string[], removed: string[] }，
 * 编号按出现顺序，重复的同一编号只保留一次。
 */
export function diffOwnBodies(oldText, newText) {
  const { changed, added, removed } = diffTraceableBodies(oldText, newText);
  return { changed, added, removed };
}

/**
 * 为 N7 提供逐提交差异：编号 H2–H6 可由章节 ID 追溯，其余内容必须由完整路径追溯。
 * 比较使用原始正文（仅统一 CRLF），避免空白或格式变化被规范化后静默漏报。
 */
export function diffTraceableBodies(oldText, newText) {
  const snapshot = (text) => {
    const normalized = text.replace(/\r/g, '');
    const headings = splitHeadings(normalized);
    const sections = new Map();
    const ownedLines = new Set();
    for (const h of headings) {
      if (h.depth < 2 || h.depth > 6 || !h.id) continue;
      if (!sections.has(h.id)) sections.set(h.id, h.ownBody);
      const lineCount = h.ownBody.split('\n').length;
      for (let line = h.startLine; line < h.startLine + lineCount; line++) ownedLines.add(line);
    }
    const unowned = normalized.split('\n')
      .filter((_, index) => !ownedLines.has(index + 1))
      .join('\n');
    return { sections, unowned };
  };

  const oldSnapshot = snapshot(oldText);
  const newSnapshot = snapshot(newText);
  const oldMap = oldSnapshot.sections;
  const newMap = newSnapshot.sections;
  const changed = [], added = [], removed = [];
  for (const [id, fp] of newMap) {
    if (!oldMap.has(id)) added.push(id);
    else if (oldMap.get(id) !== fp) changed.push(id);
  }
  for (const id of oldMap.keys()) if (!newMap.has(id)) removed.push(id);
  return {
    changed,
    added,
    removed,
    unownedChanged: oldSnapshot.unowned !== newSnapshot.unowned,
  };
}

/**
 * 结构化历史引用解析。
 *
 * 以「章节号 + 标题」为锚，在当前目标版本中定位：
 *   - 先要求编号与标题同时命中（precision = 'section'）；
 *   - 编号命中但标题已变（precision = 'id'，标题漂移）；
 *   - 编号命中多处时返回全部候选（precision = 'ambiguous'）。
 *
 * 这样即使正文被合法修改，历史引用依然**可追溯**；
 * 逐字定位由 migration 模式负责。
 */
export function resolveStructural(index, { file, sectionId, title }) {
  const hits = [];
  for (const f of index.files) {
    const entry = index.byFile.get(f);
    if (!entry) continue;
    for (const h of entry.headings) {
      if (h.id !== sectionId) continue;
      hits.push({ file: f, id: h.id, title: h.title, startLine: h.startLine, endLine: h.endLine });
    }
  }
  if (!hits.length) return { ok: false, reason: 'section-id-not-found' };
  const titleNorm = normalizeBody(title).replace(/^\d+(?:\.\d+)*\s*/, '');
  const exact = hits.filter(h => normalizeBody(h.title).replace(/^\d+(?:\.\d+)*\s*/, '') === titleNorm);
  if (exact.length === 1) return { ok: true, precision: 'section', hits: exact };
  if (exact.length > 1) return { ok: true, precision: 'ambiguous', hits: exact };
  if (hits.length === 1) return { ok: true, precision: 'id', hits };
  return { ok: true, precision: 'ambiguous', hits };
}

/** 读取某个文件在指定 ref 下的文本（不存在时返回 null）。 */
export function fileText(repoRoot, ref, file) {
  if (ref === 'WORKTREE') {
    const abs = joinPath(repoRoot, file);
    if (!existsSync(abs)) return null;
    return readFileSync(abs, 'utf8').replace(/\r/g, '');
  }
  const listed = git(repoRoot, ['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', ref, '--', file])
    .split('\n').filter(Boolean);
  if (!listed.includes(file)) return null;
  return showFile(repoRoot, ref, file);
}

/** 取某文件在 ref 下是否存在。 */
export function fileExists(repoRoot, ref, file) {
  if (ref === 'WORKTREE') {
    return index_files(repoRoot).includes(file);
  }
  try {
    const out = git(repoRoot, ['ls-tree', '-r', '--name-only', ref, '--', file]);
    return out.split('\n').filter(Boolean).length > 0;
  } catch {
    return false;
  }
}

let _filesCache = null;
function index_files(repoRoot) {
  if (_filesCache) return _filesCache;
  _filesCache = git(repoRoot, ['-c', 'core.quotePath=false', 'ls-files', '-co', '--exclude-standard'])
    .split('\n').filter(Boolean);
  return _filesCache;
}

/** 供 N5 使用的目录内文件枚举。 */
export function filesInDir(index, dir) {
  return index.files.filter(f => under(f, dir));
}

/** 供 N5 使用的：目录直属（不含子目录）的 .md 文件。 */
export function directChildren(index, dir) {
  return index.files.filter(f => f.startsWith(dir + '/') && !f.slice(dir.length + 1).includes('/'));
}
