/**
 * G0 文档迁移索引与历史引用解析。
 *
 * 用途：
 *  1. 建立 master 基线上的 H2 章节表（原文件 / 原章节 / 原起止行号）；
 *  2. 把每个章节定位到 G0 迁移后的新文件与新起止行号（支持一个原章节
 *     映射到多个目标区间的分段映射，例如 §35）；
 *  3. 解析历史引用 `document.md:NNNN` / `solution.md §X.Y`，
 *     使迁移前写在正文里的旧行号、旧章节路径仍然可以精确定位。
 *
 * 约束：
 *  - 只读。绝不修改任何仓库文件、数据库或 Git 状态；
 *  - 只用 Node.js 内置模块，无第三方依赖；
 *  - 全部内容从 Git 对象读取（迁移基线 commit + 当前 HEAD），不依赖
 *    工作树状态，也不依赖任何临时目录。
 *
 * 迁移基线 commit 由调用方显式传入，不得硬编码在解析逻辑里。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';

export const DEFAULT_BASELINE = '4cb8c477aa00988bbfebef905764565cdfe62b71';

export function git(repoRoot, args, { maxBuffer = 512 * 1024 * 1024 } = {}) {
  return execFileSync('git', args, { cwd: repoRoot, maxBuffer, encoding: 'utf8' });
}

/**
 * 读取某个目标版本中的文件内容（LF 归一）。
 * ref === 'WORKTREE' 时从工作树磁盘读取（用于提交前自检）；
 * 否则从 Git 对象读取（用于校验已提交状态）。
 */
export function showFile(repoRoot, ref, path) {
  if (ref === 'WORKTREE') {
    const abs = joinPath(repoRoot, path);
    if (!existsSync(abs)) return '';
    return readFileSync(abs, 'utf8').replace(/\r/g, '');
  }
  const buf = execFileSync('git', ['show', `${ref}:${path}`], { cwd: repoRoot, maxBuffer: 512 * 1024 * 1024 });
  return buf.toString('utf8').replace(/\r/g, '');
}

/** 列出某目标版本下的全部 Markdown 文件（UTF-8 原始路径，不做 quotePath 转义）。 */
export function listMarkdown(repoRoot, ref) {
  if (ref === 'WORKTREE') {
    return git(repoRoot, ['-c', 'core.quotePath=false', 'ls-files', '-co', '--exclude-standard'])
      .split('\n')
      .filter(Boolean)
      .filter(f => f.endsWith('.md'));
  }
  return git(repoRoot, ['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', ref])
    .split('\n')
    .filter(Boolean)
    .filter(f => f.endsWith('.md'));
}

/**
 * 按标题切分文档。代码围栏内的 `#` 不算标题。
 *
 * mode='h2'  —— 只由 H2（`##`）划分：H2 是迁移映射的记账单位，
 *               每个块覆盖该 H2 到下一个 H2 之间的全部内容。
 * mode='all' —— 由 H2–H4 共同划分：用于深引用（如 `§31.12`、`§37.54.4`）的精确定位。
 *
 * 返回 [{ title, depth, sectionId, startLine, endLine, body }]，行号 1-based，闭区间。
 */
export function splitSections(text, { mode = 'h2' } = {}) {
  const lines = text.split('\n');
  const heads = [];
  let fence = false;
  let fenceChar = '';
  for (let i = 0; i < lines.length; i++) {
    const fm = /^\s*(```+|~~~+)/.exec(lines[i]);
    if (fm) {
      if (!fence) { fence = true; fenceChar = fm[1][0]; }
      else if (fm[1][0] === fenceChar) { fence = false; }
      continue;
    }
    if (fence) continue;
    const m = /^(#{2,6})\s+(.*)/.exec(lines[i]);
    if (!m) continue;
    const depth = m[1].length;
    if (depth > 4) continue;
    if (mode === 'h2' && depth !== 2) continue;
    heads.push({ title: m[2].trim(), depth, startLine: i + 1 });
  }
  heads.forEach((h, k) => {
    h.endLine = k + 1 < heads.length ? heads[k + 1].startLine - 1 : lines.length;
    h.body = lines.slice(h.startLine - 1, h.endLine).join('\n');
    const idm = /^(\d+(?:\.\d+)*)/.exec(h.title);
    h.sectionId = idm ? idm[1] : null;
  });
  return { sections: heads, lines };
}

/** 行号 -> 该行在文本中的字符偏移。 */
function lineOffsetTable(lines) {
  const offsets = new Array(lines.length + 1);
  let acc = 0;
  for (let i = 0; i < lines.length; i++) { offsets[i] = acc; acc += lines[i].length + 1; }
  offsets[lines.length] = acc;
  return offsets;
}

/**
 * 建立 HEAD 侧的大字符串索引，把字符偏移映射回 (文件, 行号)。
 * 一次构建、全局复用，避免对每个章节做 O(files) 次全文搜索。
 */
export class TreeIndex {
  constructor(repoRoot, ref) {
    this.repoRoot = repoRoot;
    this.ref = ref;
    this.files = listMarkdown(repoRoot, ref);
    this.parts = [];
    this.meta = [];
    let cursor = 0;
    for (const f of this.files) {
      const text = showFile(repoRoot, ref, f);
      const lines = text.split('\n');
      const offsets = lineOffsetTable(lines);
      this.parts.push(text);
      this.meta.push({ file: f, base: cursor, lines, offsets });
      cursor += text.length + 1; // +1 对应分隔用的换行
    }
    this.haystack = this.parts.join('\n');
  }

  /** 在整棵树中查找精确文本，返回 [{ file, startLine, endLine }]。 */
  locate(text) {
    const needle = text.replace(/\s+$/, '');
    if (!needle) return [];
    const hits = [];
    let idx = this.haystack.indexOf(needle);
    while (idx !== -1) {
      const hit = this.toLocation(idx, needle.length);
      if (hit) hits.push(hit);
      idx = this.haystack.indexOf(needle, idx + 1);
      if (hits.length > 8) break;
    }
    return hits;
  }

  toLocation(charIndex, length) {
    const m = this.fileAt(charIndex);
    if (!m) return null;
    const local = charIndex - m.base;
    const startLine = this.lineOfOffset(m, local);
    const endLine = this.lineOfOffset(m, local + Math.max(0, length - 1));
    return { file: m.file, startLine, endLine };
  }

  /** 二分查找包含该字符偏移的文件。 */
  fileAt(charIndex) {
    let lo = 0, hi = this.meta.length - 1, found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.meta[mid].base <= charIndex) { found = this.meta[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }

  lineOfOffset(m, local) {
    let lo = 0, hi = m.lines.length - 1, lineIdx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (m.offsets[mid] <= local) { lineIdx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return lineIdx + 1;
  }
}

export function sha16(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * 建立完整迁移索引。
 * baselineRef = 迁移前的 master 基线；targetRef = 迁移后的当前 HEAD。
 */
export function buildMigrationIndex(repoRoot, baselineRef, targetRef) {
  const tree = new TreeIndex(repoRoot, targetRef);
  const h2Sources = [];
  const deepSources = [];
  for (const file of ['document.md', 'solution.md']) {
    const text = showFile(repoRoot, baselineRef, file);
    const toEntry = s => ({
      sourceFile: file,
      sourceSection: s.title,
      sourceSectionId: s.sectionId,
      sourceDepth: s.depth,
      sourceStartLine: s.startLine,
      sourceEndLine: s.endLine,
      body: s.body,
      bodyHash: sha16(s.body),
    });
    for (const s of splitSections(text, { mode: 'h2' }).sections) h2Sources.push(toEntry(s));
    for (const s of splitSections(text, { mode: 'all' }).sections) deepSources.push(toEntry(s));
  }

  // H2 是记账单位：单独定位（含分段映射）。
  const h2Entries = h2Sources.map(src => {
    const segments = resolveSegments(tree, src);
    return { ...src, segments, targetFiles: [...new Set(segments.map(s => s.file))] };
  });

  // 深引用（H3/H4）不单独全文搜索：由所属 H2 的目标区间按行偏移推导，
  // 既避免 O(files) 重复搜索，也天然处理 §35 的拆分。
  const deepEntries = deepSources.map(src => {
    const parent = h2Entries.find(h =>
      h.sourceFile === src.sourceFile &&
      src.sourceStartLine >= h.sourceStartLine && src.sourceEndLine <= h.sourceEndLine);
    let segments = [];
    if (parent) {
      segments = parent.segments
        .filter(s => src.sourceStartLine >= s.sourceLineStart && src.sourceEndLine <= s.sourceLineEnd)
        .map(s => ({
          file: s.file,
          startLine: s.startLine + (src.sourceStartLine - s.sourceLineStart),
          endLine: s.startLine + (src.sourceEndLine - s.sourceLineStart),
          segment: s.segment,
          sourceLineStart: src.sourceStartLine,
          sourceLineEnd: src.sourceEndLine,
        }));
    }
    return { ...src, segments, targetFiles: [...new Set(segments.map(s => s.file))], parentSection: parent && parent.sourceSection };
  });

  return { baselineRef, targetRef, entries: deepEntries, h2Entries, tree };
}

/** 章节是否仍留在原根文件中（未迁移）。 */
export function isRetained(entry) {
  return entry.segments.length > 0 && entry.segments.every(s => s.file === entry.sourceFile);
}

/**
 * 把一个源章节定位到目标区间。
 *  - 整段命中 -> 单区间映射；
 *  - 整段不命中但可按标题边界切成两段且两段分别命中 -> 分段映射
 *    （§35 即属此类：§35.0–§35.17 归档，§35.18–§35.19 属于当前基线）。
 */
function resolveSegments(tree, src) {
  const whole = tree.locate(src.body);
  if (whole.length) {
    return whole.map(h => ({
      ...h,
      segment: 'full',
      sourceLineStart: src.sourceStartLine,
      sourceLineEnd: src.sourceEndLine,
    }));
  }

  // 分段探测：以章节体内的标题行为候选切点，要求前后两段各自能独立命中。
  const lines = src.body.split('\n');
  const candidates = [];
  for (let i = 1; i < lines.length; i++) {
    if (/^#{3,6}\s+/.test(lines[i])) candidates.push(i);
  }
  for (const cut of candidates) {
    const prefix = lines.slice(0, cut).join('\n');
    const suffix = lines.slice(cut).join('\n');
    const preHits = tree.locate(prefix);
    if (!preHits.length) continue;
    const sufHits = tree.locate(suffix);
    if (!sufHits.length) continue;
    const segments = [];
    for (const p of preHits) {
      segments.push({ ...p, segment: 'part-a', sourceLineStart: src.sourceStartLine, sourceLineEnd: src.sourceStartLine + cut - 1 });
    }
    for (const s of sufHits) {
      segments.push({ ...s, segment: 'part-b', sourceLineStart: src.sourceStartLine + cut, sourceLineEnd: src.sourceEndLine });
    }
    return segments;
  }
  return [];
}

/**
 * 解析历史引用。
 * 支持：
 *   solution.md:12607            （迁移前的行号）
 *   solution.md:19700-19710
 *   document.md §31.12           （迁移前的章节号）
 *   solution.md §37.54.4
 */
export function resolveReference(index, reference) {
  const lineM = /^(document|solution)\.md[:：](\d+)(?:\s*[-–]\s*(\d+))?$/.exec(reference.trim());
  const secM = /^(document|solution)\.md\s*§\s*(\d+(?:\.\d+)*)$/.exec(reference.trim());

  if (lineM) {
    const file = `${lineM[1]}.md`;
    const line = parseInt(lineM[2], 10);
    // 取包含该行的最深章节（深引用定位需要精确到 H3/H4）
    const containing = index.entries.filter(e =>
      e.sourceFile === file && line >= e.sourceStartLine && line <= e.sourceEndLine);
    if (!containing.length) return { ok: false, reason: 'no-section-contains-line', reference };
    const maxDepth = Math.max(...containing.map(e => e.sourceDepth));
    const owner = containing
      .filter(e => e.sourceDepth === maxDepth)
      .sort((a, b) => (a.sourceEndLine - a.sourceStartLine) - (b.sourceEndLine - b.sourceStartLine))[0];
    return buildResolution(index, owner, {
      kind: 'line',
      sourceLine: line,
      sourceLineEnd: lineM[3] ? parseInt(lineM[3], 10) : line,
    });
  }

  if (secM) {
    const file = `${secM[1]}.md`;
    const id = secM[2];
    // 顶层章节号（如 §29、§37.54）按整节解析；深引用（如 §31.12、§37.54.4）按子节解析。
    const exactH2 = index.h2Entries.filter(e => e.sourceFile === file && e.sourceSectionId === id);
    const exactDeep = index.entries.filter(e => e.sourceFile === file && e.sourceSectionId === id);
    const exact = exactH2.length ? exactH2 : exactDeep;
    if (exact.length) {
      const owner = exact.slice().sort((a, b) => a.sourceStartLine - b.sourceStartLine)[0];
      return buildResolution(index, owner, {
        kind: 'section', sectionId: id,
        candidates: exact.length > 1 ? exact.map(e => e.sourceSection) : undefined,
      });
    }
    const loose = index.entries.filter(e => e.sourceFile === file && e.sourceSectionId && e.sourceSectionId.startsWith(id + '.'));
    if (loose.length) {
      const owner = loose.slice().sort((a, b) => a.sourceDepth - b.sourceDepth)[0];
      return buildResolution(index, owner, { kind: 'section', sectionId: id, matchedBy: 'prefix', candidates: loose.map(e => e.sourceSectionId) });
    }
    return { ok: false, reason: 'section-not-found', reference };
  }

  return { ok: false, reason: 'unrecognised-reference', reference };
}

function buildResolution(index, owner, extra) {
  const segs = owner.segments.map(s => ({
    ...s,
    newLines: `${s.startLine}-${s.endLine}`,
    sourceLines: `${s.sourceLineStart}-${s.sourceLineEnd}`,
  }));
  const segsFor = extra.kind === 'line'
    ? segs.map(s => ({
      ...s,
      covers: extra.sourceLine >= s.sourceLineStart && extra.sourceLineEnd <= s.sourceLineEnd,
    }))
    : segs;
  return {
    ok: segs.length > 0,
    reference: extra.kind === 'line' ? `${owner.sourceFile}:${extra.sourceLine}` : `${owner.sourceFile} §${extra.sectionId}`,
    kind: extra.kind,
    baselineRef: index.baselineRef,
    sourceFile: owner.sourceFile,
    sourceSection: owner.sourceSection,
    sourceSectionId: owner.sourceSectionId,
    sourceLines: `${owner.sourceStartLine}-${owner.sourceEndLine}`,
    bodyHash: owner.bodyHash,
    segments: segsFor,
    candidates: extra.candidates,
  };
}
