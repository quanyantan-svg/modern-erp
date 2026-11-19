/**
 * MySQL 灾备公共原语（PL-RI-01）。
 *
 * 边界（Requirement §36.16.2、Design §32.16.3）：
 *   - **无 shell 子进程**：`mysqldump` / `mysql` 一律以参数数组直接 spawn，
 *     密码只进子进程环境，绝不进入 argv、日志、manifest 或证据；
 *   - **配置只来自环境变量**：endpoint / bucket / region / 凭据不写入仓库、
 *     日志或验收附件；本模块只**打印变量名与脱敏 endpoint**；
 *   - **状态机固定**：备份与恢复各自有明确的状态序列，非零退出即失败；
 *   - **本模块不决定生产恢复授权** —— 授权判断在 `mysql-restore.mjs`，
 *     且必须有显式的目标身份与窗口标识。
 */

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';

/** 备份状态机。 */
export const BACKUP_STATES = Object.freeze([
  'CONFIG_VALIDATED',
  'SNAPSHOT_RUNNING',
  'LOCAL_VERIFIED',
  'UPLOADED',
  'REMOTE_VERIFIED',
  'RETENTION_APPLIED',
  'COMPLETE',
]);

/** 恢复状态机。 */
export const RESTORE_STATES = Object.freeze([
  'SOURCE_VERIFIED',
  'TARGET_AUTHORIZED',
  'EMPTY_TARGET_VERIFIED',
  'RESTORE_RUNNING',
  'DATA_VERIFIED',
  'APP_VERIFIED',
  'COMPLETE',
]);

/** 恢复目标的授权类别。 */
export const RESTORE_TARGET_CLASSES = Object.freeze(['DISPOSABLE', 'APPROVED_PRODUCTION']);

/** 必填环境变量（只登记名称，值只从环境读取，不写入任何输出）。 */
export const REQUIRED_BACKUP_ENV = Object.freeze([
  'ERP_DB_BACKEND',
  'ERP_DB_HOST',
  'ERP_DB_PORT',
  'ERP_DB_NAME',
  'ERP_DB_USER',
  'ERP_DB_PASSWORD',
]);

export const REQUIRED_OBJECT_STORE_ENV = Object.freeze([
  'ERP_DR_S3_ENDPOINT',
  'ERP_DR_S3_BUCKET',
  'ERP_DR_S3_REGION',
  'ERP_DR_S3_ACCESS_KEY_ID',
  'ERP_DR_S3_SECRET_ACCESS_KEY',
]);

const IDENTIFIER_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** 脱敏：移除可能出现在日志或错误文本里的凭据。 */
export function redactSecrets(text) {
  return String(text ?? '')
    .replace(/(\b(?:password|passwd|pwd|secret|secret_access_key|access_key_id)\s*[=:]\s*)('[^']*'|"[^"]*"|\S+)/gi, '$1***')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:/\s]+:)[^@\s]+@/gi, '$1***@')
    .replace(/(MYSQL_PWD=)\S+/gi, '$1***');
}

/**
 * 校验并归一化备份配置。
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ok: true, config: object}|{ok: false, problems: string[]}}
 */
export function validateBackupConfig(env = process.env) {
  const problems = [];
  if (String(env.ERP_DB_BACKEND || '').toLowerCase() !== 'mysql') {
    problems.push('ERP_DB_BACKEND 必须是 mysql：SQLite 工具与 MySQL 工具不得互相替代');
  }
  for (const name of REQUIRED_BACKUP_ENV) {
    if (!env[name]) problems.push(`缺少必需环境变量 ${name}`);
  }
  if (env.ERP_DB_NAME && !IDENTIFIER_RE.test(String(env.ERP_DB_NAME))) {
    problems.push('ERP_DB_NAME 必须是单一合法标识符');
  }
  for (const name of REQUIRED_OBJECT_STORE_ENV) {
    if (!env[name]) problems.push(`缺少必需环境变量 ${name}`);
  }
  const endpoint = String(env.ERP_DR_S3_ENDPOINT || '');
  if (endpoint) {
    let parsed = null;
    try { parsed = new URL(endpoint); } catch { parsed = null; }
    if (!parsed) problems.push('ERP_DR_S3_ENDPOINT 必须是合法 URL');
    else if (parsed.protocol !== 'https:' && !/^https?:\/\/127\.0\.0\.1|^https?:\/\/localhost/.test(endpoint)) {
      problems.push('ERP_DR_S3_ENDPOINT 必须使用 HTTPS（本地测试对象存储可用显式 sentinel）');
    }
  }
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    config: {
      database: {
        host: env.ERP_DB_HOST,
        port: Number(env.ERP_DB_PORT || 3306),
        name: env.ERP_DB_NAME,
        user: env.ERP_DB_USER,
      },
      objectStore: {
        endpoint: env.ERP_DR_S3_ENDPOINT,
        bucket: env.ERP_DR_S3_BUCKET,
        region: env.ERP_DR_S3_REGION,
        accessKeyId: env.ERP_DR_S3_ACCESS_KEY_ID,
        secretAccessKey: env.ERP_DR_S3_SECRET_ACCESS_KEY,
        prefix: env.ERP_DR_S3_PREFIX || 'modern-erp/dr/',
      },
      // 脱敏后的可报告形态：绝不含凭据。
      reportable: {
        endpoint: redactEndpoint(env.ERP_DR_S3_ENDPOINT),
        bucket: env.ERP_DR_S3_BUCKET,
        region: env.ERP_DR_S3_REGION,
        database: `${env.ERP_DB_HOST}:${env.ERP_DB_PORT || 3306}/${env.ERP_DB_NAME}`,
      },
    },
  };
}

/** 脱敏 endpoint：去掉 userinfo 与路径中的敏感段。 */
export function redactEndpoint(endpoint) {
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return redactSecrets(endpoint);
  }
}

/**
 * 对象存储寻址方式。
 *
 * 腾讯云 COS **拒绝 path-style**：桶必须以 virtual-hosted style 寻址，
 * 否则返回 `PathStyleDomainForbidden`
 *（"The bucket you are attempting to access must be addressed using COS
 * virtual-styled domain"）。因此远端对象存储一律用 virtual-hosted style
 * （`https://<bucket>.cos.<region>.myqcloud.com/<key>`）。
 *
 * 只有**本地** sentinel（127.0.0.1 / localhost / ::1）用 path-style：
 * 本地 S3 兼容测试服务默认按 path-style 暴露桶。
 */
export function objectStoreAddressing(endpoint) {
  let host = '';
  try { host = new URL(String(endpoint || '')).hostname; } catch { host = ''; }
  const isLocal = /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/i.test(host);
  return { forcePathStyle: isLocal, addressing: isLocal ? 'PATH' : 'VIRTUAL_HOSTED' };
}

/**
 * 构造对象存储客户端（延迟加载 SDK：无对象存储场景不强制依赖）。
 *
 * 寻址方式由 endpoint 决定，见 {@link objectStoreAddressing}。
 */
export async function createObjectStoreClient(objectStore) {
  const { S3Client } = await import('@aws-sdk/client-s3');
  const { forcePathStyle } = objectStoreAddressing(objectStore.endpoint);
  return new S3Client({
    region: objectStore.region,
    endpoint: objectStore.endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId: objectStore.accessKeyId,
      secretAccessKey: objectStore.secretAccessKey,
    },
  });
}

/**
 * 恢复目标授权判定。
 *
 * 默认 fail closed：必须显式声明目标类别；生产恢复还必须同时提供
 * **独立的窗口标识**与**审批标识**，并给出精确的目标身份。
 *
 * @returns {{ok: true, target: object}|{ok: false, reason: string}}
 */
export function authorizeRestoreTarget(input = {}) {
  const targetClass = String(input.targetClass || '').toUpperCase();
  if (!RESTORE_TARGET_CLASSES.includes(targetClass)) {
    return {
      ok: false,
      reason: `恢复目标类别必须显式声明为 ${RESTORE_TARGET_CLASSES.join(' 或 ')}，不得使用默认目标`,
    };
  }
  const identity = {
    host: String(input.host || ''),
    port: Number(input.port || 0),
    database: String(input.database || ''),
  };
  if (!identity.host || !identity.port || !IDENTIFIER_RE.test(identity.database)) {
    return { ok: false, reason: '恢复目标身份不完整或非法（需要 host / port / 单一合法 database 名）' };
  }
  if (targetClass === 'APPROVED_PRODUCTION') {
    if (!input.windowId || !input.approvalId) {
      return {
        ok: false,
        reason: '生产恢复必须同时提供独立的恢复窗口标识与审批标识，缺一即拒绝',
      };
    }
    if (String(input.expectedHost || '') !== identity.host
      || Number(input.expectedPort || 0) !== identity.port
      || String(input.expectedDatabase || '') !== identity.database) {
      return { ok: false, reason: '生产恢复的目标身份必须与事先声明的精确目标身份逐项相等' };
    }
    return {
      ok: true,
      target: {
        targetClass,
        identity,
        windowId: String(input.windowId),
        approvalId: String(input.approvalId),
      },
    };
  }
  return { ok: true, target: { targetClass, identity } };
}

/**
 * 计算保留策略下的候选删除对象。
 *
 * 规则：至少保留最近 `dailyKeep` 个每日副本 + `quarterlyKeep` 个演练源副本；
 * 候选必须是**已过保留期**且**存在已验证异机副本**的对象。
 *
 * @param {Array<{key: string, uploadedAt: string, kind: string, verified: boolean}>} objects
 */
export function computeRetentionCandidates(objects, { dailyKeep = 30, quarterlyKeep = 4 } = {}) {
  const sorted = [...objects].sort((a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)));
  const daily = sorted.filter((object) => object.kind !== 'drill');
  const drills = sorted.filter((object) => object.kind === 'drill');
  const keepDaily = new Set(daily.slice(Math.max(0, daily.length - dailyKeep)).map((object) => object.key));
  const keepDrill = new Set(drills.slice(Math.max(0, drills.length - quarterlyKeep)).map((object) => object.key));
  return sorted.filter((object) => !keepDaily.has(object.key) && !keepDrill.has(object.key))
    .filter((object) => object.verified === true);
}

/** 计算 RPO / RTO 计时结论。 */
export function evaluateRecoveryTiming({ lastBackupAt, drillStartedAt, drillFinishedAt, rpoHours = 24, rtoHours = 4 }) {
  const hours = (from, to) => (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
  const rpoActual = lastBackupAt ? hours(lastBackupAt, drillStartedAt) : null;
  const rtoActual = hours(drillStartedAt, drillFinishedAt);
  return {
    rpo: { limitHours: rpoHours, actualHours: rpoActual, ok: rpoActual !== null && rpoActual <= rpoHours },
    rto: { limitHours: rtoHours, actualHours: rtoActual, ok: rtoActual <= rtoHours },
    ok: (rpoActual !== null && rpoActual <= rpoHours) && rtoActual <= rtoHours,
  };
}

/** 流式 SHA-256 + 字节数。 */
export async function hashFile(filePath) {
  const hash = createHash('sha256');
  let bytes = 0;
  await pipeline(createReadStream(filePath), hash);
  // pipeline 已消费流，这里重新统计字节数。
  bytes = statSync(filePath).size;
  return { sha256: hash.digest('hex'), bytes };
}

/** 流式写入并同时计算 SHA-256。 */
export async function writeFileWithHash(destination, readable) {
  const hash = createHash('sha256');
  let bytes = 0;
  const counter = new (await import('node:stream')).Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  mkdirSync(dirname(destination), { recursive: true });
  await pipeline(readable, counter, createWriteStream(destination, { mode: 0o600 }));
  return { sha256: hash.digest('hex'), bytes };
}

/**
 * 把「子进程退出」与「输出流落盘」两个独立事件合成一个确定的结果。
 *
 * 只盯输出流的 'close' 是不够的：stdout 的 end 可能早于子进程退出事件被处理，
 * 此时 `child.exitCode` 仍是 `null`，一次**成功**的备份会被误报成失败
 * （表现为「退出码 null」）。两个事件都到齐再判定，结论与到达顺序无关。
 */
export function createDumpCompletion({ resolve, reject }) {
  let exit = null;
  let streamClosed = false;
  const settle = () => {
    if (!exit || !streamClosed) return;
    const { code, signal, stderrText } = exit;
    if (code === 0) {
      resolve({ ok: true, stderr: redactSecrets(stderrText) });
      return;
    }
    reject(new Error(`mysqldump 失败: ${redactSecrets(stderrText.trim()
      || (signal ? `被信号 ${signal} 终止` : `退出码 ${code}`))}`));
  };
  return {
    /** 子进程 'close'：(code, signal)。 */
    onChildClose(code, signal, stderrText = '') {
      exit = { code, signal, stderrText };
      settle();
    },
    /** 输出流 'close'：文件已落盘。 */
    onStreamClose() {
      streamClosed = true;
      settle();
    },
  };
}

/**
 * 以**无 shell** 的方式执行 mysqldump。
 *
 * 密码只进子进程环境（MYSQL_PWD），绝不进入 argv。
 */
export function runMysqlDump({ database, user, password, outputPath, mysqldumpPath = 'mysqldump' }) {
  return new Promise((resolve, reject) => {
    const args = [
      `--host=${database.host}`,
      `--port=${database.port}`,
      `--user=${user}`,
      '--single-transaction',
      '--routines',
      '--events',
      '--triggers',
      '--hex-blob',
      '--set-gtid-purged=OFF',
      '--no-tablespaces',
      database.name,
    ];
    const child = spawn(mysqldumpPath, args, {
      env: { ...process.env, MYSQL_PWD: String(password) },
      shell: false,
      windowsHide: true,
    });
    const out = createWriteStream(outputPath, { mode: 0o600 });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdout.pipe(out);
    const completion = createDumpCompletion({ resolve, reject });
    child.on('error', (error) => { try { out.destroy(); } catch { /* 已销毁 */ } reject(error); });
    out.on('error', reject);
    child.on('close', (code, signal) => completion.onChildClose(code, signal, stderr));
    out.on('close', () => completion.onStreamClose());
  });
}

/**
 * 剥掉 dump 里的 `DEFINER=<user>@<host>` 子句。
 *
 * 为什么要剥：DEFINER 里的账号来自**源主机**。MySQL 8 要求导入方具备
 * SET_USER_ID（全局动态权限）才能把对象归属设成别的账号；即使授予，
 * 该账号在目标库上通常**没有**任何权限——触发器以它的权限执行，
 * 在隔离的演练库上直接失效。因此恢复后的对象归**恢复账号**所有。
 *
 * 两种出现形态都被安全处理：
 *   - 触发器：`/*!50017 DEFINER=...` 整段是一个版本注释，剥后是空版本注释，语法合法；
 *   - 视图：`/*!50013 DEFINER=... SQL SECURITY DEFINER` 剥后仍是合法视图属性。
 *
 * 存储的备份对象**保持原样**（哈希与上传内容逐字节一致），只在导入流上做变换。
 */
export function stripDefinerClauses() {
  // 只在 mysqldump 的版本注释里剥离：`/*!50017 DEFINER=...` 与
  // `/*!50013 DEFINER=... SQL SECURITY DEFINER`。这样正文里作为字符串字面量出现的
  // "DEFINER=..." 不会被误伤。
  const DEFINER_RE = /(\/\*!\d+\s+)DEFINER=(?:`[^`]*`|'[^']*'|[^\s@]+)@(?:`[^`]*`|'[^']*'|[^\s@]+)(?=\s*\*\/|\s+SQL SECURITY)/g;
  const decoder = new StringDecoder('utf8');
  let carry = '';
  return new Transform({
    transform(chunk, _encoding, callback) {
      const text = carry + decoder.write(chunk);
      // 保留尾部一小段，避免跨块切断的 DEFINER 子句被漏掉
      const safeLength = Math.max(0, text.length - 128);
      const safe = text.slice(0, safeLength);
      carry = text.slice(safeLength);
      callback(null, safe.replace(DEFINER_RE, '$1'));
    },
    flush(callback) {
      const rest = carry + decoder.end();
      callback(null, rest.replace(DEFINER_RE, '$1'));
    },
  });
}

/**
 * 以**无 shell** 的方式把 dump 导入目标库。
 */
export function runMysqlImport({ database, user, password, dumpPath, mysqlPath = 'mysql' }) {
  return new Promise((resolve, reject) => {
    const args = [
      `--host=${database.host}`,
      `--port=${database.port}`,
      `--user=${user}`,
      database.name,
    ];
    const child = spawn(mysqlPath, args, {
      env: { ...process.env, MYSQL_PWD: String(password) },
      shell: false,
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdin.on('error', () => { /* 导入中断时以退出码为准 */ });
    const source = createReadStream(dumpPath);
    const stripper = stripDefinerClauses();
    source.pipe(stripper).pipe(child.stdin);
    child.on('error', (error) => { try { source.destroy(); } catch { /* 已销毁 */ } reject(error); });
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, stderr: redactSecrets(stderr) });
      else reject(new Error(`mysql 导入失败: ${redactSecrets(stderr.trim() || `退出码 ${code}`)}`));
    });
  });
}

/**
 * 生成对象存储的不可变 object key。
 *
 * 不可变 = 同一组输入必须得到同一个 key：重跑同一备份运行必须指向同一个对象。
 * 因此唯一性**不**来自时钟 —— 时间戳只是可读前缀；两次不同运行的区分来自 `runId`。
 * 生产调用方 `scripts/admin/mysql-backup.mjs` 每次运行都新建 `crypto.randomUUID()` 作为 `runId`，
 * 所以两次不同运行不会撞 key；`runId` 相同即同一逻辑运行，撞 key 是正确行为。
 *
 * `now` 可注入，使时间戳分量的断言不依赖真实时钟（毫秒级时钟无法用于确定性断言）。
 */
export function buildObjectKey({ prefix = 'modern-erp/dr/', commit = 'unknown', runId = randomUUID(), kind = 'daily', now = new Date() } = {}) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  return `${prefix}${kind}/${stamp}-${String(commit).slice(0, 12)}-${runId}.sql`;
}

/** 构造备份 manifest（不含任何凭据）。 */
export function buildManifest({ runId, key, sha256, bytes, commit, kind, reportable, startedAt, finishedAt }) {
  return {
    schemaVersion: 1,
    runId,
    kind,
    objectKey: key,
    sha256,
    bytes,
    commit,
    target: reportable,
    startedAt,
    finishedAt,
    status: 'LOCAL_VERIFIED',
  };
}

/** 删除本地临时文件（失败不抛 —— 清理不得掩盖原始错误）。 */
export function removeQuietly(filePath) {
  try { if (filePath && existsSync(filePath)) unlinkSync(filePath); } catch { /* 清理失败不影响主流程 */ }
}
