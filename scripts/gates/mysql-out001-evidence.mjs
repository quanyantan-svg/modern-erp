// OUT-001 真实 MySQL 8 Gate 的证据持久化层。
//
// 合同：Gate 的每一个子进程都必须把**完整**的 stdout 与 stderr 落盘，落盘
// 路径绑定 RunId，并且落盘完成之后才允许对「文件完整」下结论。
//
// 关键约束：
//
//   1. stdout 与 stderr 都必须**完整**保存，不接受「只保存 stderr 尾部」；
//   2. TAP 不得只在内存中收集：输出边产生边写入文件；
//   3. 必须等待 Child 退出**且**两路输出流结束、文件 fd 关闭之后，才计算
//      字节数与 SHA-256；
//   4. 成功路径与失败路径（含超时、非零退出、流异常）都必须留下证据；
//   5. TAP 解析失败时不得把 testsPassed 判为 true（fail closed）；
//   6. 证据里不得出现数据库密码、DPAPI 解密内容、Capability 明文或
//      approval 明文；出现即以固定标记替换并记录替换次数。
//
// Requirement : document.md §31.14.2
// Design      : docs/design/procurement-outsourcing.md §26.34.15、§26.34.15.3

import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';

export const OUT_001_EVIDENCE_VERSION = 1;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REDACTION_MARK = '[REDACTED]';
const MIN_SECRET_LENGTH = 4;

/** 证据根目录：%LOCALAPPDATA%\ModernERP\mysql-gate\evidence\<RunId>\suites\<label>\ */
export function out001EvidenceRoot(runId, { localAppData = process.env.LOCALAPPDATA } = {}) {
  if (!RUN_ID.test(String(runId || ''))) throw new Error('OUT_001_EVIDENCE_RUN_ID_INVALID');
  const base = String(localAppData || '').trim();
  if (!base) throw new Error('OUT_001_EVIDENCE_LOCALAPPDATA_MISSING');
  return resolve(base, 'ModernERP', 'mysql-gate', 'evidence', String(runId));
}

export function out001SuiteEvidencePaths(runId, label, options = {}) {
  if (!LABEL.test(String(label || ''))) throw new Error('OUT_001_EVIDENCE_LABEL_INVALID');
  const root = out001EvidenceRoot(runId, options);
  const dir = join(root, 'suites', String(label));
  return Object.freeze({
    root,
    dir,
    stdout: join(dir, 'stdout.tap'),
    stderr: join(dir, 'stderr.log'),
    result: join(dir, 'result.json'),
  });
}

function replaceAllBytes(haystack, needle, replacement) {
  let index = haystack.indexOf(needle);
  if (index === -1) return { buffer: haystack, count: 0 };
  const parts = [];
  let cursor = 0;
  let count = 0;
  while (index !== -1) {
    parts.push(haystack.subarray(cursor, index), replacement);
    cursor = index + needle.length;
    count += 1;
    index = haystack.indexOf(needle, cursor);
  }
  parts.push(haystack.subarray(cursor));
  return { buffer: Buffer.concat(parts), count };
}

export function redactOut001EvidenceBytes(input, secrets = []) {
  let buffer = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(String(input), 'utf8');
  let count = 0;
  const rawSecrets = secrets.map((value) => String(value ?? ''));
  const unique = [...new Set(rawSecrets.flatMap((value) => [value, JSON.stringify(value).slice(1, -1)]))]
    .filter((value) => value.length >= MIN_SECRET_LENGTH)
    .map((value) => Buffer.from(value, 'utf8'))
    .sort((a, b) => b.length - a.length);
  for (const needle of unique) {
    const result = replaceAllBytes(buffer, needle, Buffer.from(REDACTION_MARK, 'utf8'));
    buffer = result.buffer;
    count += result.count;
  }
  return Object.freeze({ buffer, count });
}

/**
 * 把密钥从输出流里替换掉。
 *
 * 替换在 **字节** 层完成，因此不会破坏被截断的多字节字符。流末尾保留一段
 * 可能属于某个密钥前缀的字节：跨 chunk 边界的密钥因此不会被拆开后漏掉，
 * 而「刚好被 chunk 边界切开」的完整密钥也必须整体留在待处理区里，直到它
 * 完整出现或流结束时才被替换 —— 任何情况下密钥都不会先落盘再被替换。
 */
export class Out001SecretRedactor extends Transform {
  constructor(secrets = []) {
    super();
    const unique = new Map();
    for (const value of secrets) {
      const text = String(value ?? '');
      if (text.length < MIN_SECRET_LENGTH) continue;
      unique.set(text, Buffer.from(text, 'utf8'));
    }
    this.entries = [...unique.values()]
      .sort((a, b) => b.length - a.length)
      .map((needle) => ({ needle, replacement: Buffer.from(REDACTION_MARK, 'utf8') }));
    this.maxLength = this.entries.reduce((max, entry) => Math.max(max, entry.needle.length), 0);
    this.pending = Buffer.alloc(0);
    this.count = 0;
  }

  redact(buffer) {
    let out = buffer;
    for (const { needle, replacement } of this.entries) {
      const result = replaceAllBytes(out, needle, replacement);
      out = result.buffer;
      this.count += result.count;
    }
    return out;
  }

  /**
   * 计算本轮可以安全发出的字节数。
   *
   * 任何**完整**落在待处理区里的密钥都必须整体留在待处理区：否则它会被
   * 切成两半，一半已落盘、一半才被替换。因此边界要退回到最近一个跨越它
   * 的密钥起点。
   */
  safeCut(buffer) {
    if (this.maxLength <= 1) return buffer.length;
    let cut = Math.max(0, buffer.length - (this.maxLength - 1));
    let moved = true;
    while (moved) {
      moved = false;
      for (const { needle } of this.entries) {
        const index = buffer.lastIndexOf(needle, Math.max(0, cut - 1));
        if (index !== -1 && index + needle.length > cut) {
          cut = index;
          moved = true;
        }
      }
    }
    return cut;
  }

  _transform(chunk, _encoding, callback) {
    const buffer = Buffer.concat([this.pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    const cut = this.safeCut(buffer);
    this.pending = Buffer.from(buffer.subarray(cut));
    this.push(this.redact(buffer.subarray(0, cut)));
    callback();
  }

  _flush(callback) {
    if (this.pending.length) this.push(this.redact(this.pending));
    this.pending = Buffer.alloc(0);
    callback();
  }
}

/**
 * 从 node:test 的 TAP 输出里读取汇总块。
 *
 * 只接受完整且自洽的汇总：`tests`、`pass`、`fail`、`skipped` 四项必须齐全，
 * 且 `pass + fail + cancelled + skipped + todo` 必须等于 `tests`。任何缺失、
 * 非法或不自洽都返回 null —— 调用方据此 fail closed，绝不把「解析不出来」
 * 当成「没有失败」。
 */
export function parseOut001TapSummary(text) {
  const source = String(text || '');
  const read = (key) => {
    const match = source.match(new RegExp(`^#\\s*${key}\\s+(\\d+)\\s*$`, 'm'));
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const tests = read('tests');
  const passed = read('pass');
  const failed = read('fail');
  const skipped = read('skipped');
  if (tests === null || passed === null || failed === null || skipped === null) return null;
  const cancelled = read('cancelled');
  const todo = read('todo');
  const accounted = passed + failed + (cancelled ?? 0) + skipped + (todo ?? 0);
  if (accounted !== tests) return null;
  return Object.freeze({
    tests,
    passed,
    failed,
    skipped,
    cancelled: cancelled ?? 0,
    todo: todo ?? 0,
  });
}

/**
 * suite 是否可以判为 PASS。
 *
 * 必须同时满足：子进程退出码为 0、TAP 解析成功、没有失败、没有取消、
 * 至少执行了一个测试。任一条件不成立都判为 FAIL。
 */
export function out001SuitePassed({ exitCode, tap } = {}) {
  if (exitCode !== 0) return false;
  if (!tap || typeof tap !== 'object') return false;
  if (!Number.isSafeInteger(tap.tests) || tap.tests <= 0) return false;
  if (tap.failed !== 0 || tap.cancelled !== 0) return false;
  return true;
}

function fileDigest(path) {
  const content = readFileSync(path);
  return {
    path,
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

function closePromise(stream, timeoutMs = 10_000) {
  return new Promise((resolveClose) => {
    if (stream.closed) { resolveClose(true); return; }
    const timer = setTimeout(() => resolveClose(false), timeoutMs);
    timer.unref?.();
    stream.once('close', () => { clearTimeout(timer); resolveClose(true); });
    stream.once('error', () => { clearTimeout(timer); resolveClose(false); });
  });
}

/** 等待一条可读流结束（正常 end 或异常 close 都算结束），带上限。 */
function endWithin(stream, timeoutMs = 10_000) {
  return new Promise((resolveEnd) => {
    if (!stream || stream.readableEnded || stream.destroyed) { resolveEnd(true); return; }
    const timer = setTimeout(() => resolveEnd(false), timeoutMs);
    timer.unref?.();
    const done = () => { clearTimeout(timer); resolveEnd(true); };
    stream.once('end', done);
    stream.once('close', done);
    stream.once('error', done);
  });
}

/**
 * 建立一个 suite 的证据写入器。
 *
 * `attach(child)` 之后，child 的两路输出被直接写入磁盘文件；TAP 不再只
 * 存在于内存里。`finalize()` 必须等到 Child 退出、两路输出流结束、文件
 * fd 关闭之后才计算字节数与 SHA-256。
 */
export function createOut001EvidenceWriter({ runId, label, secrets = [], operation = null, options = {} }) {
  const paths = out001SuiteEvidencePaths(runId, label, options);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const stdoutFile = createWriteStream(paths.stdout, { flags: 'w', mode: 0o600 });
  const stderrFile = createWriteStream(paths.stderr, { flags: 'w', mode: 0o600 });
  const stdoutRedactor = new Out001SecretRedactor(secrets);
  const stderrRedactor = new Out001SecretRedactor(secrets);
  const streamErrors = [];
  stdoutFile.on('error', (error) => { streamErrors.push(`stdout:${error.message}`); });
  stderrFile.on('error', (error) => { streamErrors.push(`stderr:${error.message}`); });
  let attached = false;
  let finalized = null;
  let child = null;

  return Object.freeze({
    paths,
    label: String(label),
    operation: operation ? String(operation) : null,
    attach(target) {
      if (attached) throw new Error('OUT_001_EVIDENCE_ALREADY_ATTACHED');
      attached = true;
      child = target;
      if (target?.stdout) target.stdout.pipe(stdoutRedactor).pipe(stdoutFile);
      if (target?.stderr) target.stderr.pipe(stderrRedactor).pipe(stderrFile);
    },
    async finalize({ exitCode = null, failure = null } = {}) {
      if (finalized) return finalized;
      // 先等子进程的两路输出流结束（带上限），再结束写入流：管道正常
      // 传播的 end 必须先发生，否则会丢掉最后一段输出。
      await Promise.all([
        child?.stdout ? endWithin(child.stdout) : Promise.resolve(true),
        child?.stderr ? endWithin(child.stderr) : Promise.resolve(true),
      ]);
      stdoutRedactor.end();
      stderrRedactor.end();
      stdoutFile.end();
      stderrFile.end();
      // 文件 fd 关闭后才认为「文件完整」：管道结束 → 替换器 flush → 文件
      // 写完 → fd 关闭。任何一步失败都记入 result.json，绝不静默忽略。
      const closed = await Promise.all([closePromise(stdoutFile), closePromise(stderrFile)]);
      if (!closed[0]) streamErrors.push('stdout:the evidence file did not close cleanly');
      if (!closed[1]) streamErrors.push('stderr:the evidence file did not close cleanly');
      const stdout = fileDigest(paths.stdout);
      const stderr = fileDigest(paths.stderr);
      const tap = parseOut001TapSummary(readFileSync(paths.stdout, 'utf8'));
      const result = {
        version: OUT_001_EVIDENCE_VERSION,
        runId: String(runId),
        suite: String(label),
        operation: operation ? String(operation) : null,
        exitCode: Number.isSafeInteger(exitCode) ? exitCode : null,
        completedAt: new Date().toISOString(),
        stdout,
        stderr,
        tap,
        tapParsed: tap !== null,
        redactions: {
          applied: stdoutRedactor.count + stderrRedactor.count,
          marker: REDACTION_MARK,
        },
        streamErrors,
        failure: failure
          ? { code: failure.code ? String(failure.code) : null, message: String(failure.message || failure) }
          : null,
      };
      writeFileSync(paths.result, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
      finalized = Object.freeze({
        suite: result.suite,
        operation: result.operation,
        exitCode: result.exitCode,
        stdoutPath: stdout.path,
        stderrPath: stderr.path,
        resultPath: paths.result,
        stdoutBytes: stdout.bytes,
        stderrBytes: stderr.bytes,
        stdoutSha256: stdout.sha256,
        stderrSha256: stderr.sha256,
        tap,
        tapParsed: result.tapParsed,
        redactions: result.redactions.applied,
        streamErrors: [...streamErrors],
        failure: result.failure,
      });
      return finalized;
    },
    /** 证据目录的磁盘占用，用于确认三份文件都已真正落盘。 */
    evidenceBytes() {
      return [paths.stdout, paths.stderr, paths.result].map((path) => {
        try { return statSync(path).size; } catch { return -1; }
      });
    },
  });
}
