// SQLite → MySQL 运行时 DDL 翻译（Requirement §36.20 PL-DDL-01）。
//
// 为什么需要它：`server/modules/` 与 `server/lib/` 下的模块会在运行时用
// `db.exec('CREATE TABLE IF NOT EXISTS …')` 自建表（库存条码规则、ABC 分类、
// 组装拆卸、容器…）。这些 DDL 是按 **SQLite 方言** 写的，直接发给 MySQL 8 会被拒：
//
//   * `TEXT PRIMARY KEY`            → ER_BLOB_CANT_HAVE_DEFAULT 的近亲
//                                     「BLOB/TEXT column used in key specification
//                                     without a key length」
//   * `TEXT NOT NULL DEFAULT '{}'`  → ER_BLOB_CANT_HAVE_DEFAULT
//
// 快照 bootstrap 路径早就有 canonical 的列类型 / 默认值解析器
// （`server/database/mysql-schema.js` 的 `resolveMySqlColumnType` 与 `mysqlDefault`），
// 但**运行时 DDL 走的是另一条路**：`translateSqliteSql()` 只翻译语句形态
// （PRAGMA / INSERT OR IGNORE / ON CONFLICT / datetime('now')…），
// 不翻译 DDL 形状，于是同一份 schema 在两条路径上物化出不同的物理结构。
//
// 本模块把**同一套 canonical 规则**用到运行时 DDL 上：
//   * `TEXT` → `VARCHAR(128)`（参与键：PRIMARY KEY / 内联 UNIQUE / `id` / `*_id`）
//              否则 `LONGTEXT`；
//   * `LONGTEXT` 列上的字符串默认值 → `DEFAULT ('…')`（MySQL 8.0.13+ 的表达式默认值，
//              与 `mysqlDefault()` 的既有规则一致）。
//
// 只影响 MySQL 适配器；SQLite 路径不走这里。

const VARCHAR_TYPE = 'VARCHAR(128)';
const LONGTEXT_TYPE = 'LONGTEXT';

/** 按顶层逗号切分建表体（括号内的逗号不切）。 */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  let quote = null;
  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; current += char; continue; }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** 表级约束（PRIMARY KEY(...)、UNIQUE(...)、FOREIGN KEY(...)、CHECK(...)、CONSTRAINT ...）不是列。 */
function isTableConstraint(definition) {
  return /^\s*(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)\b/i.test(definition);
}

/** 该列是否参与键（决定用 VARCHAR 还是 LONGTEXT）。 */
function participatesInKey(definition, columnName) {
  if (/\bPRIMARY\s+KEY\b/i.test(definition)) return true;
  if (/\bUNIQUE\b/i.test(definition)) return true;
  if (columnName === 'id' || /_id$/i.test(columnName)) return true;
  return false;
}

/** `LONGTEXT` / `JSON` 列上的字符串默认值必须写成表达式形式 `DEFAULT ('…')`。 */
function wrapTextDefault(definition, type) {
  if (type !== LONGTEXT_TYPE) return definition;
  return definition.replace(
    /\bDEFAULT\s+('(?:''|[^'])*'|"(?:[^"]|"")*")/i,
    (match, literal) => `DEFAULT (${literal})`,
  );
}

/**
 * 翻译一条 `CREATE TABLE` 语句的列定义。
 * 非 `CREATE TABLE` 或无法安全解析时**原样返回** —— 翻译层必须宁可不动也不改错。
 */
export function translateCreateTable(sql) {
  const text = String(sql);
  const match = /^(\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)([^\s(]+)\s*\(([\s\S]*)\)(\s*[^;]*;?)\s*$/i.exec(text);
  if (!match) return text;
  const [, prefix, tableName, body, suffix] = match;
  const definitions = splitTopLevel(body);
  let changed = false;
  const translated = definitions.map((definition) => {
    if (isTableConstraint(definition)) return definition;
    const columnMatch = /^\s*(`[^`]+`|[A-Za-z_][\w$]*)\s+(.*)$/s.exec(definition);
    if (!columnMatch) return definition;
    const columnName = columnMatch[1].replace(/`/g, '').toLowerCase();
    const rest = columnMatch[2];
    if (!/\bTEXT\b/i.test(rest)) return definition;
    const type = participatesInKey(rest, columnName) ? VARCHAR_TYPE : LONGTEXT_TYPE;
    const replaced = rest.replace(/\bTEXT\b/i, type);
    const withDefault = wrapTextDefault(replaced, type);
    if (withDefault !== definition) changed = true;
    return definition.replace(rest, withDefault);
  });
  if (!changed) return text;
  return `${prefix}${tableName} (${translated.join(',')})${suffix}`;
}

/**
 * `translateSqliteSql()` 的入口钩子：只对 `CREATE TABLE` 做形状翻译，
 * 其余语句仍由既有的语句级翻译处理。
 */
export function translateSqliteDdl(sql) {
  return translateCreateTable(sql);
}
