// 运行时自建索引的方言感知 ensure（Requirement §36.20 PL-DDL-01）。
//
// `CREATE INDEX IF NOT EXISTS` 是 **SQLite 专有**语法；MySQL 不支持，翻译层无法
// 在单条语句里表达「不存在才创建」的语义。因此索引的幂等创建必须显式做存在性检查。
//
// 同一份 schema 在两条路径上必须物化出同一物理结构：SQLite 走 IF NOT EXISTS，
// MySQL 走 information_schema 检查后再建。

export function ensureIndex(db, name, table, columns, { unique = false } = {}) {
  if (db.dialect === 'mysql') {
    const existing = db.prepare(
      'SELECT COUNT(*) n FROM information_schema.statistics '
      + 'WHERE table_schema=DATABASE() AND table_name=? AND index_name=?',
    ).get(table, name);
    if (Number(existing?.n || 0) > 0) return;
    db.exec(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${table}(${columns})`);
    return;
  }
  db.exec(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${name} ON ${table}(${columns})`);
}
