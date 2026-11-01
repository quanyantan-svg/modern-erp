#!/usr/bin/env node
/**
 * ERP 文档一致性检查（双模式）。
 *
 * 本脚本把「历史迁移证明」与「当前文档完整性」拆成两种**语义不同**的检查：
 *
 * ── migration 模式（Historical Migration Verification）────────────────────
 *   固定验证 G0 当时是否**无损**迁移：
 *     Source = 4cb8c477aa00988bbfebef905764565cdfe62b71（G0 迁移前的 master）
 *     Target = 1aa753d6e72fdfb37968601d26cfdd422b794948（G0 验收锚点）
 *   目标锚定在验收锚点上，**不随 HEAD 漂移**，因此历史证明永远可独立复跑。
 *
 *   C1 迁移章节覆盖     —— master 基线上的每一个 H2 章节都有归属，覆盖率必须 100%
 *   C2 内容一致性       —— 已迁移章节正文逐字保留且只出现一次；保留章节逐字未改
 *   C3 映射表完整性     —— MIGRATION-MAP.md 的行数、目标文件、新行范围、内容哈希与实际一致
 *   C4 链接与锚点       —— Markdown 链接与标题锚点可达；区分新增失效与历史遗留
 *   C5 历史引用解析     —— 迁移前的 document.md:NNNN / solution.md §X.Y 仍可解析
 *   C6 重复 Active 合同 —— 同一份合同正文不得出现在多个文件中
 *
 * ── current 模式（Current Documentation Integrity）────────────────────────
 *   验证持续开发后的**当前**文档是否自洽。合法修改已迁移合同**不得**被误报为迁移丢失。
 *
 *   N1 链接与锚点可达        —— 相对 G0 验收锚点不得新增失效链接
 *   N2 合同 ID 唯一          —— 规范章节号唯一、不与根文件保留编号冲突、与文件自身标题一致
 *   N3 无重复 Active 合同正文 —— Active 集合内不得出现第二份同一合同正文
 *   N4 元数据与状态规范      —— Active 合同文件必须声明 状态 / Owner / 权威来源
 *   N5 索引与真实路径一致    —— 索引 README 必须登记本目录全部正文，且链接可达
 *   N6 历史锚点仍可追溯      —— 历史行号 / 章节引用在当前结构中仍能定位（结构化解析）
 *   N7 已批准合同的修改可追溯 —— 后续修改必须能经「变更记录 + Git Diff」定位到提交
 *   N8 待审合同不得冒充已批准 —— 待审候选必须声明 PENDING / NOT_AUTHORIZED / NOT_ISSUED
 *   N9 G0 历史迁移证明可独立复跑 —— 现场重跑 migration 模式的 C1–C6
 *
 * 用法：
 *   node scripts/docs/check-doc-consistency.mjs                       # current 模式（默认）
 *   node scripts/docs/check-doc-consistency.mjs --mode current
 *   node scripts/docs/check-doc-consistency.mjs --mode migration
 *   node scripts/docs/check-doc-consistency.mjs --mode migration --target <commit>
 *   node scripts/docs/check-doc-consistency.mjs --mode current --target HEAD
 *   node scripts/docs/check-doc-consistency.mjs --mode current --target WORKTREE --only N7
 *
 * 约束：
 *   - 只读：只执行 git show / ls-tree / ls-files，不写任何文件、不碰数据库；
 *   - 只用 Node.js 内置模块；
 *   - 失败时返回非零退出码；
 *   - 不修改 FAST / FULL / HEAVY 测试分组；
 *   - 正式检查不依赖临时目录；回归测试在独立临时克隆中运行。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMigrationIndex, listMarkdown, showFile, splitSections, git, resolveReference, isRetained,
} from './lib/migration-index.mjs';
import {
  buildCurrentIndex, activeContractFiles, reviewFiles, bodyFingerprints, diffOwnBodies,
  resolveStructural, fileText, under, directChildren,
} from './lib/current-index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** G0 迁移前的 master 基线。 */
const DEFAULT_BASELINE = '4cb8c477aa00988bbfebef905764565cdfe62b71';
/** G0 验收锚点：migration 模式的默认目标，固定不随 HEAD 漂移。 */
const ACCEPTED_ANCHOR = '1aa753d6e72fdfb37968601d26cfdd422b794948';

/** 根文件保留的编号范围：document.md 保留 §0–§25，solution.md 保留 §0–§20。 */
const ROOT_REQUIREMENT_MAX = 25;
const ROOT_DESIGN_MAX = 20;

/** 必须可解析的历史引用抽样（取自独立审计报告给出的具体引用）。 */
const SAMPLE_REFERENCES = [
  'solution.md:12607',
  'solution.md:19698',
  'solution.md:19700-19710',
  'document.md:11187',
  'solution.md §29',
  'solution.md §37.54',
  'solution.md §35',
  'solution.md §35.27',
  'document.md §31.12',
  'document.md §22',
];

/** 受治理的合同与登记文件（用于 N7 的变更追溯范围）。 */
const GOVERNED_FILES = [
  'document.md',
  'solution.md',
  'docs/status/PROJECT_STATUS.md',
  'docs/decisions/OPEN-BUSINESS-DECISIONS.md',
];

/** 索引目录（若目录内存在 README.md，则要求它登记本目录全部直属正文）。 */
const INDEX_DIRS = [
  'docs/requirements',
  'docs/design',
  'docs/reviews',
  'docs/acceptance',
  'docs/decisions',
];

const results = [];
let failures = 0;

function record(id, title, ok, detail) {
  results.push({ id, title, ok });
  if (!ok) failures++;
  process.stdout.write(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${title}\n`);
  if (detail) {
    const lines = Array.isArray(detail) ? detail : [detail];
    for (const l of lines.slice(0, 20)) process.stdout.write(`       ${l}\n`);
    if (lines.length > 20) process.stdout.write(`       … 另有 ${lines.length - 20} 条\n`);
  }
}

function parseArgs(argv) {
  let mode = 'current';
  let baseline = DEFAULT_BASELINE;
  let target = null;
  let anchor = ACCEPTED_ANCHOR;
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode') mode = argv[++i];
    else if (argv[i] === '--baseline') baseline = argv[++i];
    else if (argv[i] === '--target') target = argv[++i];
    else if (argv[i] === '--anchor') anchor = argv[++i];
    else if (argv[i] === '--only') only = argv[++i];
  }
  return { mode, baseline, target, anchor, only };
}

/* ---------------- 链接 / 锚点 ---------------- */
function headingSlugs(text) {
  const slugs = new Set();
  let fence = false, fenceChar = '';
  for (const line of text.split('\n')) {
    const fm = /^\s*(```+|~~~+)/.exec(line);
    if (fm) { if (!fence) { fence = true; fenceChar = fm[1][0]; } else if (fm[1][0] === fenceChar) { fence = false; } continue; }
    if (fence) continue;
    const m = /^#{1,6}\s+(.*)/.exec(line);
    if (m) slugs.add(slugify(m[1]));
  }
  return slugs;
}
function slugify(s) {
  return s.trim().toLowerCase().replace(/[^\w一-鿿\- ]+/g, '').replace(/\s+/g, '-');
}

function scanLinks(ref, files, knownFiles = null) {
  const content = new Map();
  for (const f of files) content.set(f, showFile(REPO_ROOT, ref, f));
  const known = knownFiles || files;
  const allFiles = new Set(known);
  const broken = [];
  const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const f of files) {
    const text = content.get(f);
    let m; linkRe.lastIndex = 0;
    while ((m = linkRe.exec(text))) {
      const target = m[1];
      if (/^(https?:|mailto:|data:)/i.test(target)) continue;
      const [pathPart, anchor] = target.split('#');
      let ok = true, why = '';
      if (pathPart) {
        const base = path.posix.dirname(f);
        const abs = path.posix.normalize(path.posix.join(base, pathPart));
        const isDir = pathPart.endsWith('/');
        const hasFile = allFiles.has(abs);
        const hasDir = isDir && known.some(x => x.startsWith(abs));
        if (!hasFile && !hasDir) { ok = false; why = `目标不存在: ${abs}`; }
      }
      if (ok && anchor) {
        const tfile = pathPart ? path.posix.normalize(path.posix.join(path.posix.dirname(f), pathPart)) : f;
        const ttext = content.get(tfile) ?? (known.includes(tfile) ? showFile(REPO_ROOT, ref, tfile) : undefined);
        if (ttext === undefined) { ok = false; why = '锚点目标文件不存在'; }
        else if (!headingSlugs(ttext).has(slugify(anchor))) { ok = false; why = `锚点 #${anchor} 在 ${tfile} 中不存在`; }
      }
      if (!ok) broken.push({ from: f, target, why });
    }
  }
  return broken;
}

/* ================= migration 模式（C1–C6） ================= */

function runMigrationChecks(baseline, target) {
  const index = buildMigrationIndex(REPO_ROOT, baseline, target);
  const h2 = index.h2Entries;
  const retained = h2.filter(isRetained);
  const relocated = h2.filter(e => !isRetained(e));
  const unmapped = h2.filter(e => e.segments.length === 0);

  /* C1 覆盖 */
  const total = h2.length;
  record('C1', '迁移章节覆盖率 100%', unmapped.length === 0,
    unmapped.length
      ? ['未定位章节 ' + unmapped.length + ' 个:',
        ...unmapped.map(e => `  ${e.sourceFile} :: ${e.sourceSection} (原行 ${e.sourceStartLine}-${e.sourceEndLine})`)]
      : [`master 基线共 ${total} 个 H2 章节：${retained.length} 个保留在根文件，${relocated.length} 个已迁移，全部定位到目标文件`]);

  /* C2 内容一致性 */
  const dup = relocated.filter(e => index.tree.locate(e.body).length > 1);
  record('C2', '已迁移正文逐字保留且唯一', dup.length === 0,
    dup.length
      ? dup.map(e => `  重复出现: ${e.sourceSection} -> ${index.tree.locate(e.body).map(x => x.file).join(', ')}`)
      : [`${relocated.length} 个已迁移章节正文均逐字命中且只出现一次`]);

  /* C3 映射表完整性 */
  const mapText = showFile(REPO_ROOT, target, 'docs/status/MIGRATION-MAP.md');
  const mapRows = mapText.split('\n')
    .filter(l => /^\| `(document|solution)\.md` \|/.test(l))
    .map(l => {
      const c = l.split('|').map(x => x.trim().replace(/`/g, ''));
      return {
        sourceFile: c[1], sourceSection: c[2], sourceLines: c[3], sourceSha: c[4],
        kind: c[5], targets: c[6], hash: c[7],
      };
    });
  const mapProblems = [];
  if (mapRows.length !== relocated.length) {
    mapProblems.push(`映射表数据行 ${mapRows.length}，实际已迁移章节 ${relocated.length}`);
  }
  for (const row of mapRows) {
    const e = relocated.find(x => x.sourceFile === row.sourceFile && x.sourceSection === row.sourceSection);
    if (!e) { mapProblems.push(`映射表条目在基线中不存在: ${row.sourceFile} :: ${row.sourceSection}`); continue; }
    if (row.hash !== e.bodyHash) mapProblems.push(`内容哈希不符: ${row.sourceFile} :: ${row.sourceSection}`);
    const declared = [...row.targets.matchAll(/([^`\s:]+):(\d+)-(\d+)/g)].map(m => ({ file: m[1], startLine: +m[2], endLine: +m[3] }));
    const actual = e.segments.map(s => ({ file: s.file, startLine: s.startLine, endLine: s.endLine }));
    if (declared.length !== actual.length) {
      mapProblems.push(`目标区间数不符: ${row.sourceFile} :: ${row.sourceSection}  表=${declared.length} 实际=${actual.length}`);
    } else {
      for (const d of declared) {
        const a = actual.find(x => x.file === d.file && x.startLine === d.startLine && x.endLine === d.endLine);
        if (!a) mapProblems.push(`目标区间不符: ${row.sourceFile} :: ${row.sourceSection}  表=${d.file}:${d.startLine}-${d.endLine}  实际=${actual.map(x => `${x.file}:${x.startLine}-${x.endLine}`).join(' + ')}`);
      }
    }
  }
  record('C3', 'MIGRATION-MAP 与实际迁移一致', mapProblems.length === 0,
    mapProblems.length ? mapProblems : [`${mapRows.length} 行映射：目标文件、新行范围、内容哈希全部与实际一致`]);

  /* C4 链接与锚点 */
  const targetFiles = listMarkdown(REPO_ROOT, target);
  const baselineFiles = listMarkdown(REPO_ROOT, baseline);
  const brokenTarget = scanLinks(target, targetFiles);
  const brokenBaseline = scanLinks(baseline, baselineFiles);
  const baselineKeys = new Set(brokenBaseline.map(b => `${b.from} -> ${b.target}`));
  const newBroken = brokenTarget.filter(b => !baselineKeys.has(`${b.from} -> ${b.target}`));
  record('C4', '无新增失效链接与锚点', newBroken.length === 0,
    newBroken.length
      ? newBroken.map(b => `  NEW_BROKEN ${b.from} -> ${b.target}  (${b.why})`)
      : [`目标版本失效链接 ${brokenTarget.length} 条，全部为基线已存在的历史遗留；新增 ${newBroken.length} 条`]);

  /* C5 历史引用解析 */
  const sampleResults = SAMPLE_REFERENCES.map(ref => ({ ref, r: resolveReference(index, ref) }));
  const unresolved = sampleResults.filter(x => !x.r.ok);
  record('C5', '历史引用抽样可解析', unresolved.length === 0,
    unresolved.length
      ? unresolved.map(x => `  无法解析: ${x.ref} (${x.r.reason})`)
      : sampleResults.map(x => `  ${x.ref} -> ${x.r.segments.map(s => `${s.file}:${s.newLines}`).join(' + ')}`));

  /* C6 重复 Active 合同 */
  const multi = relocated.filter(e => index.tree.locate(e.body).length > 1);
  const split = relocated.filter(e => index.tree.locate(e.body).length === 0 && e.segments.length > 1);
  record('C6', '无重复 Active 合同正文', multi.length === 0,
    multi.length
      ? multi.map(e => `  正文在多个位置出现: ${e.sourceSection}`)
      : [`每份迁移正文只对应一个目标文件；分段映射 ${split.length} 个（§35 拆分为归档段 + 当前基线段）`]);
}

/* ================= current 模式（N1–N9） ================= */

/** 从元数据中取出规范章节号（`document.md §31` / `solution.md §37.54`）。 */
function canonicalId(meta) {
  for (const key of ['来源', '权威来源']) {
    const v = meta[key];
    if (!v) continue;
    const m = /(?:document|solution)\.md\s*§\s*(\d+(?:\.\d+)*)/.exec(v);
    if (m) return m[1];
  }
  return null;
}

function runCurrentChecks(target, anchor, only = null) {
  const cur = buildCurrentIndex(REPO_ROOT, target);

  if (only !== null) {
    if (only !== 'N7') throw new Error(`current 模式仅支持聚焦检查 N7，收到: ${only}`);
    const trace = traceabilityProblems(anchor, target, cur);
    record('N7', '已批准合同的修改可经变更记录与 Git Diff 追溯', trace.problems.length === 0,
      trace.problems.length ? trace.problems : trace.detail);
    return;
  }

  /* N1 链接与锚点 */
  const curBroken = scanLinks(target, cur.files);
  const anchorBroken = scanLinks(anchor, listMarkdown(REPO_ROOT, anchor));
  const anchorKeys = new Set(anchorBroken.map(b => `${b.from} -> ${b.target}`));
  const newBroken = curBroken.filter(b => !anchorKeys.has(`${b.from} -> ${b.target}`));
  record('N1', '当前文档无新增失效链接与锚点', newBroken.length === 0,
    newBroken.length
      ? newBroken.map(b => `  NEW_BROKEN ${b.from} -> ${b.target}  (${b.why})`)
      : [`当前失效链接 ${curBroken.length} 条，全部为 G0 验收锚点已存在的历史遗留；新增 ${newBroken.length} 条`]);

  /* N2 合同 ID 唯一 */
  const active = activeContractFiles(cur);
  const reqFiles = active.filter(f => f === 'document.md' || under(f, 'docs/requirements'));
  const desFiles = active.filter(f => f === 'solution.md' || under(f, 'docs/design'));
  const idProblems = [];
  for (const [set, label, rootMax] of [[reqFiles, 'Requirement', ROOT_REQUIREMENT_MAX], [desFiles, 'Design', ROOT_DESIGN_MAX]]) {
    const owners = new Map();
    for (const f of set) {
      const entry = cur.byFile.get(f);
      const cid = canonicalId(entry.meta);
      if (!cid) continue;
      if (!owners.has(cid)) owners.set(cid, []);
      owners.get(cid).push(f);
      const rootNum = parseInt(cid.split('.')[0], 10);
      if (Number.isFinite(rootNum) && rootNum <= rootMax) {
        idProblems.push(`${label} 规范章节 §${cid} 与根文件保留范围（§0–§${rootMax}）冲突: ${f}`);
      }
      const hasHeading = entry.headings.some(h => h.id === cid || (h.id && h.id.startsWith(cid + '.')));
      if (!hasHeading) {
        idProblems.push(`${label} 文件声明规范章节 §${cid}，但文件内无对应标题: ${f}`);
      }
    }
    for (const [cid, files] of owners) {
      if (files.length > 1) idProblems.push(`${label} 规范章节 §${cid} 被 ${files.length} 个文件同时声明: ${files.join(', ')}`);
    }
  }
  record('N2', '合同章节 ID 唯一且不与根文件保留范围冲突', idProblems.length === 0,
    idProblems.length ? idProblems : [
      `Requirement 规范章节 ${[...new Set(reqFiles.map(f => canonicalId(cur.byFile.get(f).meta)).filter(Boolean))].sort().join(' / ')}`,
      `Design 规范章节 ${[...new Set(desFiles.map(f => canonicalId(cur.byFile.get(f).meta)).filter(Boolean))].sort().join(' / ')}`,
    ]);

  /* N3 无重复 Active 合同正文 */
  const dupProblems = [];
  const fpMap = bodyFingerprints(cur, active);
  const activeByFp = new Map();
  for (const [file, list] of fpMap) {
    for (const item of list) {
      if (!activeByFp.has(item.fingerprint)) activeByFp.set(item.fingerprint, []);
      activeByFp.get(item.fingerprint).push({ file, id: item.id });
    }
  }
  for (const hits of activeByFp.values()) {
    if (hits.length > 1) {
      dupProblems.push(`  同一合同正文出现在 ${hits.length} 处: ${hits.map(h => `${h.file} §${h.id}`).join(' | ')}`);
    }
  }
  const review = reviewFiles(cur);
  const reviewFp = bodyFingerprints(cur, review);
  for (const [file, list] of reviewFp) {
    for (const item of list) {
      const hits = activeByFp.get(item.fingerprint);
      if (hits) {
        dupProblems.push(`  待审候选复制了 Active 合同正文: ${file} §${item.id} ≡ ${hits.map(h => `${h.file} §${h.id}`).join(', ')}`);
      }
    }
  }
  record('N3', '无重复 Active 合同正文', dupProblems.length === 0,
    dupProblems.length ? dupProblems : [`Active 合同文件 ${active.length} 个；章节正文指纹无重复；待审候选 ${review.length} 个，未复制 Active 正文`]);

  /* N4 元数据与状态规范 */
  const metaProblems = [];
  for (const f of active) {
    const meta = cur.byFile.get(f).meta;
    for (const key of ['状态', 'Owner', '权威来源']) {
      if (!meta[key]) metaProblems.push(`  缺少元数据「${key}」: ${f}`);
    }
    if (meta['状态'] && !/ACTIVE/.test(meta['状态'])) {
      metaProblems.push(`  Active 合同文件的状态必须含 ACTIVE，实际为「${meta['状态']}」: ${f}`);
    }
  }
  record('N4', 'Active 合同元数据与状态规范', metaProblems.length === 0,
    metaProblems.length ? metaProblems : [`${active.length} 个 Active 合同文件均声明 状态 / Owner / 权威来源，且状态为 ACTIVE`]);

  /* N5 索引与真实路径一致 */
  const idxProblems = [];
  for (const dir of INDEX_DIRS) {
    const readme = `${dir}/README.md`;
    if (!cur.byFile.has(readme)) continue;
    const text = cur.byFile.get(readme).text;
    for (const child of directChildren(cur, dir)) {
      if (child === readme) continue;
      const base = child.slice(dir.length + 1);
      if (!text.includes(base)) idxProblems.push(`  索引未登记本目录正文: ${readme} 缺少 ${base}`);
    }
    for (const b of scanLinks(target, [readme], cur.files)) {
      idxProblems.push(`  索引链接失效: ${readme} -> ${b.target} (${b.why})`);
    }
  }
  record('N5', '索引登记与真实路径一致', idxProblems.length === 0,
    idxProblems.length ? idxProblems : [`${INDEX_DIRS.length} 个索引目录：直属正文全部登记，链接全部可达`]);

  /* N6 历史锚点仍可追溯 */
  const baselineText = {
    'document.md': showFile(REPO_ROOT, DEFAULT_BASELINE, 'document.md'),
    'solution.md': showFile(REPO_ROOT, DEFAULT_BASELINE, 'solution.md'),
  };
  const baseSections = {
    'document.md': splitSections(baselineText['document.md'], { mode: 'all' }).sections,
    'solution.md': splitSections(baselineText['solution.md'], { mode: 'all' }).sections,
  };
  const traceProblems = [];
  const traceDetail = [];
  for (const ref of SAMPLE_REFERENCES) {
    const lineM = /^(document|solution)\.md[:：](\d+)(?:\s*[-–]\s*(\d+))?$/.exec(ref.trim());
    const secM = /^(document|solution)\.md\s*§\s*(\d+(?:\.\d+)*)$/.exec(ref.trim());
    let owner = null;
    let file = null;
    if (lineM) {
      file = `${lineM[1]}.md`;
      const line = parseInt(lineM[2], 10);
      const containing = baseSections[file].filter(s => line >= s.startLine && line <= s.endLine);
      if (containing.length) {
        const maxDepth = Math.max(...containing.map(s => s.depth));
        owner = containing.filter(s => s.depth === maxDepth)
          .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0];
      }
    } else if (secM) {
      file = `${secM[1]}.md`;
      const id = secM[2];
      const exact = baseSections[file].filter(s => s.sectionId === id);
      owner = exact.length ? exact[exact.length - 1] : null;
      if (!owner) {
        const loose = baseSections[file].filter(s => s.sectionId && s.sectionId.startsWith(id + '.'));
        owner = loose.length ? loose[0] : null;
      }
    }
    if (!owner) { traceProblems.push(`  无法在基线中定位: ${ref}`); continue; }
    const r = resolveStructural(cur, { file, sectionId: owner.sectionId, title: owner.title });
    if (!r.ok) { traceProblems.push(`  当前结构中已无法定位: ${ref} (基线 §${owner.sectionId})`); continue; }
    traceDetail.push(`  ${ref} -> ${r.hits.map(h => `${h.file} §${h.id} (${h.startLine}-${h.endLine}) [${r.precision}]`).join(' + ')}`);
  }
  record('N6', '历史行号与章节锚点在当前结构中仍可追溯', traceProblems.length === 0,
    traceProblems.length ? traceProblems : traceDetail);

  /* N7 已批准合同的修改可追溯 */
  const trace = traceabilityProblems(anchor, target, cur);
  record('N7', '已批准合同的修改可经变更记录与 Git Diff 追溯', trace.problems.length === 0,
    trace.problems.length ? trace.problems : trace.detail);

  /* N8 待审合同不得冒充已批准 */
  const pendingProblems = [];
  const candidates = review.filter(f => !f.endsWith('/README.md'));
  for (const f of candidates) {
    const meta = cur.byFile.get(f).meta;
    const status = meta['状态'] || '';
    if (!/PENDING/.test(status)) pendingProblems.push(`  待审文件的状态必须含 PENDING，实际「${status}」: ${f}`);
    if (!/NOT_AUTHORIZED/.test(meta['Implementation'] || '')) {
      pendingProblems.push(`  待审文件必须声明 Implementation: NOT_AUTHORIZED: ${f}`);
    }
    if (!/NOT_ISSUED/.test(meta['Design PASS'] || '')) {
      pendingProblems.push(`  待审文件必须声明 Design PASS: NOT_ISSUED: ${f}`);
    }
    for (const key of ['Owner', '权威来源', '来源 SHA', '来源章节']) {
      if (!meta[key]) pendingProblems.push(`  待审文件缺少元数据「${key}」: ${f}`);
    }
    if (/ACTIVE|APPROVED/.test(status)) pendingProblems.push(`  待审文件不得声明 ACTIVE/APPROVED: ${f}`);
  }
  record('N8', '待审候选不得冒充已批准合同', pendingProblems.length === 0,
    pendingProblems.length ? pendingProblems : [`待审候选 ${candidates.length} 个（目录索引 ${review.length - candidates.length} 个由 N5 管辖）：均声明 PENDING / NOT_AUTHORIZED / NOT_ISSUED，并写明 Owner、权威来源、来源 SHA 与来源章节`]);

  /* N9 G0 历史迁移证明可独立复跑 */
  const before = failures;
  const beforeCount = results.length;
  runMigrationChecks(DEFAULT_BASELINE, anchor);
  const proofResults = results.slice(beforeCount);
  results.length = beforeCount;
  const proofFailures = failures - before;
  failures = before;
  record('N9', 'G0 历史迁移证明仍可独立复跑', proofFailures === 0,
    proofFailures === 0
      ? [`现场重跑 ${DEFAULT_BASELINE.slice(0, 12)} → ${anchor.slice(0, 12)} 的 C1–C6：全部通过`]
      : proofResults.filter(r => !r.ok).map(r => `  ${r.id} ${r.title} FAIL`));
}

/**
 * N7：对每个受治理文件，比较验收锚点版本与目标版本的自有正文，
 * 找出被修改 / 新增 / 删除的章节编号，并要求能在 Git 历史中找到
 * 提到该章节编号或该文件的提交（即「变更记录 + Git Diff」可追溯）。
 *
 * WORKTREE 具有额外语义：任何未提交或未跟踪的受治理文件变化都必须
 * 明确失败，不能借用 HEAD 中已有的提交记录冒充可追溯。
 */
function traceabilityProblems(anchor, target, cur) {
  const problems = [];
  const detail = [];
  const scope = [...GOVERNED_FILES, ...activeContractFiles(cur), ...reviewFiles(cur)]
    .filter((v, i, a) => a.indexOf(v) === i);
  const historyTarget = target === 'WORKTREE' ? 'HEAD' : target;
  const worktreeChanges = target === 'WORKTREE' ? worktreeChangedFiles() : new Set();

  for (const f of scope) {
    const oldText = fileText(REPO_ROOT, anchor, f);
    const newText = fileText(REPO_ROOT, target, f);
    if (newText === null) continue;
    const isNew = oldText === null;
    const d = isNew ? { changed: [], added: [], removed: [] } : diffOwnBodies(oldText, newText);

    if (worktreeChanges.has(f)) {
      problems.push(`  WORKTREE 含未提交或未跟踪的受治理文件变化，不能以 Git Commit 追溯: ${f}`);
      continue;
    }

    if (!isNew && !d.changed.length && !d.added.length && !d.removed.length) continue;

    const commits = gitCommits(anchor, historyTarget, f);
    if (!commits.length) {
      problems.push(`  受治理文件在验收锚点之后发生变化，但在 ${anchor.slice(0, 12)}..${historyTarget} 找不到任何提交: ${f}`);
      continue;
    }
    if (isNew) {
      if (!commits.some(c => c.message.includes(f))) {
        problems.push(`  新增受治理文件缺少提到它的提交记录: ${f}（提交信息需出现该文件路径「${f}」）`);
      } else {
        detail.push(`  ${f}: 新增文件，提交信息已引用其路径`);
      }
      continue;
    }
    const base = f.split('/').pop();
    const touched = [...d.changed, ...d.added, ...d.removed];
    for (const id of touched) {
      const token = new RegExp(`(^|[^0-9.])${id.replace(/\./g, '\\.')}([^0-9.]|$)`);
      if (!commits.some(c => token.test(c.message) || c.message.includes(f) || c.message.includes(base))) {
        problems.push(`  章节 §${id} 的修改无法追溯到提交（提交信息需提及 §${id} 或「${base}」）: ${f}`);
      }
    }
    if (!problems.some(p => p.includes(f))) {
      detail.push(`  ${f}: ${touched.length} 个章节变更均可追溯`);
    }
  }
  return { problems, detail };
}

/** 一次性收集 WORKTREE 中未提交（含 staged）与未跟踪路径。 */
function worktreeChangedFiles() {
  const changed = new Set();
  const commands = [
    ['-c', 'core.quotePath=false', 'diff', '--name-only'],
    ['-c', 'core.quotePath=false', 'diff', '--cached', '--name-only'],
    ['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard'],
  ];
  for (const args of commands) {
    for (const file of git(REPO_ROOT, args).split('\n').filter(Boolean)) changed.add(file);
  }
  return changed;
}

/** 列出 anchor..target 之间改动某文件的提交及其完整提交信息。 */
function gitCommits(anchor, target, file) {
  const out = git(REPO_ROOT, ['log', '--format=%H%x1f%B%x1e', `${anchor}..${target}`, '--', file]);
  return out.split('\x1e').map(s => s.trim()).filter(Boolean).map(chunk => {
    const [hash, ...rest] = chunk.split('\x1f');
    return { hash, message: rest.join('\x1f').trim() };
  });
}

/* ================= 主流程 ================= */

function main() {
  const { mode, baseline, target, anchor, only } = parseArgs(process.argv.slice(2));
  const resolvedTarget = target || 'WORKTREE';

  if (mode === 'migration') {
    const migTarget = target || anchor;
    process.stdout.write(
      'ERP 文档一致性检查 —— migration 模式（历史迁移验证）\n' +
      `  迁移基线: ${baseline}\n` +
      `  验收目标: ${migTarget}\n\n`);
    runMigrationChecks(baseline, migTarget);
  } else if (mode === 'current') {
    process.stdout.write(
      'ERP 文档一致性检查 —— current 模式（当前文档完整性）\n' +
      `  校验目标: ${resolvedTarget}\n` +
      `  G0 验收锚点: ${anchor}\n\n`);
    runCurrentChecks(resolvedTarget, anchor, only);
  } else {
    process.stderr.write(`未知模式: ${mode}（可用: migration | current）\n`);
    process.exit(2);
  }

  process.stdout.write(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  for (const r of results) {
    process.stdout.write(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id} ${r.title}\n`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  process.stderr.write(`检查器异常: ${err && err.stack ? err.stack : err}\n`);
  process.exit(2);
});
