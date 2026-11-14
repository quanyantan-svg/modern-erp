/**
 * Migration 通用原语与 fail-closed 执行器（PL-RI-02）。
 *
 * 目的：把「预期幂等」与「未知错误」彻底分开。
 *
 *  - **预期幂等**（列已存在、索引已存在）一律通过 **schema inspection** 判定，
 *    不再依赖 catch 里的错误文本匹配，也不再吞掉任何未知错误；
 *  - **未知 DDL / DML 错误**一律向上传播，并附带 migration 标识与安全诊断。
 *
 * 硬性约束：
 *  - 禁止 `catch {}`、空 catch，或仅打印后继续；本模块不提供任何「吞错」出口；
 *  - 表名 / 列名 / 索引名必须是代码常量并通过标识符白名单校验，不接受外部输入；
 *  - 错误信息不得包含密码、连接串、token 或业务数据；
 *  - 表重建必须处于可回滚的原子边界，失败不得留下 `_new` 残留表或半复制数据。
 */

/** 标识符白名单：表名 / 列名 / 索引名只允许 ASCII 字母、数字与下划线。 */
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 允许出现在 migration 标识中的字符（用于 savepoint 名称）。 */
const SAVEPOINT_RE = /[^A-Za-z0-9_]/g;

/**
 * 校验标识符。
 * @param {string} name 标识符
 * @param {string} kind 标识符种类（用于错误信息）
 */
export function assertIdentifier(name, kind = '标识符') {
  const value = String(name ?? '');
  if (!IDENTIFIER_RE.test(value)) {
    throw new Error(`非法的${kind}: ${JSON.stringify(value)}`);
  }
  return value;
}

/** 表是否存在。SQLite 走 sqlite_master，MySQL 适配器会翻译成 information_schema。 */
export function tableExists(db, table) {
  assertIdentifier(table, '表名');
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  ).get(table));
}

/** 表的列名集合（小写）。 */
export function tableColumns(db, table) {
  assertIdentifier(table, '表名');
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all()
    .map((row) => String(row.name).toLowerCase()));
}

/** 列是否存在。 */
export function columnExists(db, table, column) {
  return tableColumns(db, table).has(String(column ?? '').toLowerCase());
}

/** 表的建表 DDL 原文（SQLite）。用于判定 CHECK 约束等目标形态。 */
export function tableSql(db, table) {
  assertIdentifier(table, '表名');
  return db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '';
}

/** 表的行数。 */
export function rowCount(db, table) {
  assertIdentifier(table, '表名');
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n || 0);
}

/** 索引是否存在。 */
export function indexExists(db, table, index) {
  assertIdentifier(table, '表名');
  assertIdentifier(index, '索引名');
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?",
  ).get(index));
}

/**
 * 幂等加列：列已存在则跳过，否则执行 ALTER。
 *
 * ALTER 失败**一定向上传播** —— 「表不存在」「列类型非法」「磁盘错误」都属于未知错误。
 *
 * @returns {boolean} 本次是否真正执行了 ALTER
 */
export function addColumnIfMissing(db, table, column, ddl) {
  assertIdentifier(table, '表名');
  assertIdentifier(column, '列名');
  if (columnExists(db, table, column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  return true;
}

/**
 * 解析 `ALTER TABLE <table> ADD COLUMN <column> ...` 语句。
 *
 * 解析失败必须抛错：**不得**猜测表名或列名。
 *
 * @returns {{table: string, column: string}}
 */
export function parseAddColumnStatement(sql) {
  const m = /^\s*ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+(?:COLUMN\s+)?([A-Za-z_][A-Za-z0-9_]*)/i
    .exec(String(sql ?? ''));
  if (!m) {
    throw new Error(`无法解析加列语句，拒绝猜测表名或列名: ${String(sql ?? '')}`);
  }
  return { table: m[1], column: m[2] };
}

/**
 * 幂等加列（语句形式）：从 `ALTER TABLE ... ADD COLUMN ...` 语句推导表名与列名。
 *
 * @returns {boolean} 本次是否真正执行了 ALTER
 */
export function addColumnFromStatement(db, sql) {
  const { table, column } = parseAddColumnStatement(sql);
  if (columnExists(db, table, column)) return false;
  db.exec(sql);
  return true;
}

/**
 * 幂等建索引：索引已存在则跳过，否则执行 CREATE INDEX。
 *
 * @param {string} sql CREATE INDEX 语句
 * @param {{table: string, index: string}} identity 索引身份（用于 inspection）
 * @returns {boolean} 本次是否真正执行了 CREATE INDEX
 */
export function createIndexIfMissing(db, sql, { table, index }) {
  if (indexExists(db, table, index)) return false;
  db.exec(sql);
  return true;
}

/** 脱敏：移除可能出现在错误文本里的凭据。 */
export function redactSecrets(text) {
  return String(text ?? '')
    .replace(/(\b(?:password|passwd|pwd)\s*[=:]\s*)('[^']*'|"[^"]*"|\S+)/gi, '$1***')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:/\s]+:)[^@\s]+@/gi, '$1***@')
    .replace(/\b(mysql2?|mariaDB)\b(\s*:\s*)/gi, '$1$2');
}

/**
 * 构造 migration 失败错误。
 *
 * 诊断信息只保留 migration 标识、阶段与脱敏后的原始消息；
 * 不携带密码、连接串、token 或业务数据。
 */
export function migrationFailure(id, error, phase = 'apply') {
  const original = error instanceof Error ? error : new Error(String(error));
  const safe = redactSecrets(original.message);
  const wrapped = new Error(`migration ${id} 在 ${phase} 阶段失败: ${safe}`);
  wrapped.name = 'MigrationError';
  wrapped.migrationId = id;
  wrapped.migrationPhase = phase;
  wrapped.cause = original;
  return wrapped;
}

/** 当前连接是否已经处于事务中。 */
export function isInTransaction(db) {
  return Boolean(db?.isTransaction);
}

/** SQLite 外键约束当前是否开启。 */
export function foreignKeysEnabled(db) {
  if (db?.dialect === 'mysql') return true;
  return Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys || 0) === 1;
}

/**
 * 与指定表相关的外键违规。
 *
 * 只报告 `parent` 指向该表的违规 —— 这正是表重建可能引入的那一类；
 * 与该表无关的历史遗留违规不在本检查范围内（不得据此让既有数据库无法启动）。
 */
export function foreignKeyViolationsFor(db, table) {
  assertIdentifier(table, '表名');
  return db.prepare('PRAGMA foreign_key_check').all()
    .filter((row) => String(row.parent) === table);
}

/**
 * fail-closed migration 步骤执行器。
 *
 * 合同（缺一不可）：
 *  1. `inspect` —— 通过 schema inspection 判断目标形态是否**已经满足**；
 *     只有确认已满足才可记为 replay 成功并跳过整段 apply；
 *  2. `apply` —— 在一个事务 / savepoint 内完成整段 migration；失败必须整体回滚；
 *  3. `verify` —— 提交前证明目标形态；验证失败与 DDL 失败等价，同样回滚；
 *  4. 任何未知错误都带上 migration 标识向上传播，调用方不得继续启动。
 *
 * `suspendForeignKeys` 只在**表重建**步骤使用：SQLite 官方的
 * 「create → copy → drop → rename」流程要求在事务之外临时关闭外键强制，
 * 否则 DROP 旧表时的隐式 DELETE 会被子表引用拒绝。步骤结束后立即恢复，
 * 并由 `verify` 证明重建没有留下指向该表的外键违规。
 *
 * @param {object} db 数据库连接
 * @param {{id: string, inspect?: (db) => boolean, apply: (db) => void, verify?: (db) => boolean, suspendForeignKeys?: boolean}} step
 * @returns {{id: string, status: 'replayed'|'applied'}}
 */
export function runMigrationStep(db, { id, inspect, apply, verify, suspendForeignKeys = false }) {
  if (!id) throw new Error('migration 步骤必须提供 id');
  if (typeof apply !== 'function') throw new Error(`migration ${id} 必须提供 apply`);

  if (typeof inspect === 'function') {
    let alreadyApplied = false;
    try {
      alreadyApplied = Boolean(inspect(db));
    } catch (error) {
      throw migrationFailure(id, error, 'inspect');
    }
    if (alreadyApplied) return { id, status: 'replayed' };
  }

  const ownsTransaction = !isInTransaction(db);
  const savepoint = `migration_${String(id).replace(SAVEPOINT_RE, '_')}`;
  const sqlite = db?.dialect !== 'mysql';
  let restoreForeignKeys = false;
  try {
    if (sqlite && suspendForeignKeys && ownsTransaction && foreignKeysEnabled(db)) {
      db.exec('PRAGMA foreign_keys = OFF;');
      restoreForeignKeys = true;
    }
    if (ownsTransaction) db.exec('BEGIN IMMEDIATE');
    else db.exec(`SAVEPOINT ${savepoint}`);
    apply(db);
    if (typeof verify === 'function') {
      const verified = Boolean(verify(db));
      if (!verified) {
        throw new Error(`提交前校验未通过：目标形态未达成`);
      }
    }
    if (ownsTransaction) db.exec('COMMIT');
    else db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return { id, status: 'applied' };
  } catch (error) {
    // 回滚是 best-effort：回滚自身失败**不得**吞掉原始异常，
    // 原始异常才是调用方需要定位的原因。
    try {
      if (ownsTransaction) {
        if (isInTransaction(db)) db.exec('ROLLBACK');
      } else {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      }
    } catch {
      /* 原始异常优先 */
    }
    throw migrationFailure(id, error);
  } finally {
    if (restoreForeignKeys) {
      try { db.exec('PRAGMA foreign_keys = ON;'); } catch { /* 连接即将失效时忽略 */ }
    }
  }
}
