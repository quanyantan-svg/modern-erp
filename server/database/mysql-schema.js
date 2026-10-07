import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const quote = (name) => `\`${String(name).replaceAll('`', '``')}\``;

function extractChecks(sql) {
  const checks = [];
  const upper = sql.toUpperCase();
  let cursor = 0;
  while ((cursor = upper.indexOf('CHECK', cursor)) >= 0) {
    let start = cursor + 5;
    while (/\s/.test(sql[start] || '')) start += 1;
    if (sql[start] !== '(') { cursor = start; continue; }
    let depth = 0;
    let quoteChar = '';
    for (let i = start; i < sql.length; i += 1) {
      const char = sql[i];
      if (quoteChar) {
        if (char === quoteChar && sql[i + 1] === quoteChar) i += 1;
        else if (char === quoteChar) quoteChar = '';
      } else if (char === "'" || char === '"') quoteChar = char;
      else if (char === '(') depth += 1;
      else if (char === ')' && --depth === 0) {
        checks.push(sql.slice(start + 1, i));
        cursor = i + 1;
        break;
      }
    }
  }
  return checks;
}

function mysqlType(column, indexed) {
  const declared = String(column.type || '').toUpperCase();
  const name = String(column.name).toLowerCase();
  if (declared.includes('INT')) return 'BIGINT';
  if (declared.includes('REAL') || declared.includes('FLOA') || declared.includes('DOUB') || declared.includes('NUM')) return 'DECIMAL(24,6)';
  if (declared.includes('BLOB')) return 'LONGBLOB';
  if (name.endsWith('_json') || name === 'json_payload') return 'JSON';
  // 128 keeps UUIDs/document keys lossless while allowing the V1.3 compound
  // unique keys to remain below InnoDB's 3072-byte utf8mb4 key limit.
  if (indexed || column.pk || name === 'id' || name.endsWith('_id')) return 'VARCHAR(128)';
  return 'LONGTEXT';
}

function mysqlDefault(value, type) {
  if (value === null || value === undefined) return '';
  let expression = String(value).trim();
  expression = expression.replace(/^datetime\s*\(\s*'now'\s*\)$/i, 'CURRENT_TIMESTAMP');
  expression = expression.replace(/^date\s*\(\s*'now'\s*\)$/i, 'CURRENT_DATE');
  if ((type === 'LONGTEXT' || type === 'JSON') && expression !== 'NULL' && !/^\(.+\)$/.test(expression)) {
    expression = `(${expression})`;
  }
  return ` DEFAULT ${expression}`;
}

function generatedPartialIndex(tableName, index) {
  const suffix = Buffer.from(index.name).toString('hex').slice(-16);
  const generated = `__partial_${suffix}`;
  const parts = index.columns.map((column, position) => {
    const expression = column ? quote(column) : (index.expressions?.[position] || 'NULL');
    return `COALESCE(CAST(${expression} AS CHAR),CHAR(30))`;
  }).join(',');
  const predicate = index.where.replace(/\bIS\s+NOT\s+NULL\b/gi, 'IS NOT NULL');
  return [
    `ALTER TABLE ${quote(tableName)} ADD COLUMN ${quote(generated)} CHAR(64) GENERATED ALWAYS AS (CASE WHEN ${predicate} THEN SHA2(CONCAT_WS(CHAR(31),${parts}),256) ELSE NULL END) STORED`,
    `CREATE UNIQUE INDEX ${quote(index.name)} ON ${quote(tableName)} (${quote(generated)})`,
  ];
}

function indexExpressions(sql) {
  const open = sql.indexOf('(', sql.toUpperCase().indexOf(' ON '));
  if (open < 0) return [];
  const values = [];
  let depth = 0;
  let start = open + 1;
  let quoteChar = '';
  for (let i = open + 1; i < sql.length; i += 1) {
    const char = sql[i];
    if (quoteChar) {
      if (char === quoteChar && sql[i + 1] === quoteChar) i += 1;
      else if (char === quoteChar) quoteChar = '';
    } else if (char === "'" || char === '"' || char === '`') quoteChar = char;
    else if (char === '(') depth += 1;
    else if (char === ')' && depth === 0) { values.push(sql.slice(start, i).trim()); break; }
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) { values.push(sql.slice(start, i).trim()); start = i + 1; }
  }
  return values;
}

function tableDefinition(table) {
  const indexed = new Set([
    ...table.indexes.flatMap((index) => index.columns),
    ...table.foreignKeys.map((foreignKey) => foreignKey.from),
  ]);
  const autoIncrement = /AUTOINCREMENT/i.test(table.sql);
  const primary = table.columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk);
  const definitions = table.columns.map((column) => columnDefinition(table, column, indexed, primary, autoIncrement));
  if (primary.length) definitions.push(`PRIMARY KEY (${primary.map((column) => quote(column.name)).join(',')})`);
  for (const index of table.indexes.filter((candidate) => candidate.origin === 'u' && candidate.columns.length && candidate.columns.length <= 4)) {
    definitions.push(`UNIQUE (${index.columns.map(quote).join(',')})`);
  }
  for (const fk of table.foreignKeys) {
    definitions.push(`FOREIGN KEY (${quote(fk.from)}) REFERENCES ${quote(fk.table)} (${quote(fk.to)}) ON UPDATE ${fk.on_update || 'NO ACTION'} ON DELETE ${fk.on_delete || 'NO ACTION'}`);
  }
  for (const check of extractChecks(table.sql)) definitions.push(`CHECK (${check})`);
  return `CREATE TABLE IF NOT EXISTS ${quote(table.name)} (\n  ${definitions.join(',\n  ')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;
}

function columnDefinition(table, column, indexed = null, primary = null, autoIncrement = null) {
  const indexedColumns = indexed || new Set([
    ...table.indexes.flatMap((index) => index.columns),
    ...table.foreignKeys.map((foreignKey) => foreignKey.from),
  ]);
  const primaryColumns = primary || table.columns.filter((item) => item.pk).sort((a, b) => a.pk - b.pk);
  const hasAutoIncrement = autoIncrement ?? /AUTOINCREMENT/i.test(table.sql);
  const type = mysqlType(column, indexedColumns.has(column.name));
  const inlinePrimary = primaryColumns.length === 1 && primaryColumns[0].name === column.name;
  return `${quote(column.name)} ${type}${column.notnull || inlinePrimary ? ' NOT NULL' : ''}${mysqlDefault(column.dflt_value, type)}${hasAutoIncrement && inlinePrimary ? ' AUTO_INCREMENT' : ''}`;
}

export function planMySqlAdditiveReconciliation(snapshot, current) {
  const statements = [];
  for (const table of snapshot.tables) {
    if (!current.tables.has(table.name)) {
      statements.push(tableDefinition(table));
      continue;
    }
    const columns = current.columns.get(table.name) || new Set();
    for (const column of table.columns) {
      if (!columns.has(column.name)) statements.push(`ALTER TABLE ${quote(table.name)} ADD COLUMN ${columnDefinition(table, column)}`);
    }
  }
  return statements;
}

export function planMySqlIndexReconciliation(snapshot, currentIndexes) {
  const statements = [];
  for (const table of snapshot.tables) {
    const indexes = currentIndexes.get(table.name) || new Set();
    for (const index of table.indexes) {
      if (index.origin === 'u' || !index.columns.length || index.where || indexes.has(index.name)) continue;
      statements.push(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quote(index.name)} ON ${quote(table.name)} (${index.columns.map(quote).join(',')})`);
    }
  }
  return statements;
}

export function captureSqliteSnapshot(createSqliteSnapshot, seedDemo) {
  const path = join(tmpdir(), `modern-erp-mysql-schema-${randomUUID()}.db`);
  const priorNodeEnv = process.env.NODE_ENV;
  const priorSeed = process.env.ERP_SEED_DEMO;
  process.env.NODE_ENV = seedDemo ? 'development' : 'production';
  process.env.ERP_SEED_DEMO = seedDemo ? 'true' : 'false';
  let sqlite;
  try {
    sqlite = createSqliteSnapshot(path);
    const tables = sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name, sql }) => {
      const columns = sqlite.prepare(`PRAGMA table_info(${quote(name)})`).all();
      const foreignKeys = sqlite.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all();
      const indexes = sqlite.prepare(`PRAGMA index_list(${quote(name)})`).all()
        .filter((index) => index.origin !== 'pk')
        .map((index) => {
          const source = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(index.name)?.sql || '';
          const where = source.match(/\bWHERE\s+(.+)$/is)?.[1]?.trim().replace(/;$/, '') || '';
          return {
            name: index.name,
            unique: Boolean(index.unique),
            origin: index.origin,
            columns: sqlite.prepare(`PRAGMA index_info(${quote(index.name)})`).all().sort((a, b) => a.seqno - b.seqno).map((row) => row.name),
            expressions: indexExpressions(source),
            where,
          };
        });
      return { name, sql, columns, foreignKeys, indexes, rows: sqlite.prepare(`SELECT * FROM ${quote(name)}`).all() };
    });
    return { tables };
  } finally {
    try { sqlite?.close(); } catch {}
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(candidate)) try { rmSync(candidate, { force: true }); } catch {}
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNodeEnv;
    if (priorSeed === undefined) delete process.env.ERP_SEED_DEMO; else process.env.ERP_SEED_DEMO = priorSeed;
  }
}

export function bootstrapMySql(adapter, snapshot) {
  const existing = adapter.prepare('SHOW TABLES').all();
  const existingNames = new Set(existing.map((row) => Object.values(row)[0]));
  const complete = existingNames.has('mysql_backend_metadata');
  if (existing.length && !complete) {
    throw new Error('Refusing partial MySQL schema without mysql_backend_metadata completion marker. Use an empty disposable database or a complete V1.3 schema.');
  }
  const currentColumns = new Map();
  if (complete) {
    for (const table of snapshot.tables) {
      if (!existingNames.has(table.name)) continue;
      const rows = adapter.prepare('SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?').all(table.name);
      currentColumns.set(table.name, new Set(rows.map((row) => row.column_name)));
    }
  }

  adapter.exec('SET FOREIGN_KEY_CHECKS=0');
  try {
    const reconciliation = complete
      ? planMySqlAdditiveReconciliation(snapshot, { tables: existingNames, columns: currentColumns })
      : snapshot.tables.map(tableDefinition);
    for (const statement of reconciliation) adapter.exec(statement);
    if (complete) {
      const currentIndexes = new Map();
      for (const table of snapshot.tables) {
        const rows = adapter.prepare('SELECT DISTINCT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=?').all(table.name);
        currentIndexes.set(table.name, new Set(rows.map((row) => row.index_name)));
      }
      for (const statement of planMySqlIndexReconciliation(snapshot, currentIndexes)) adapter.exec(statement);
    }
    for (const table of snapshot.tables) {
      const primaryKeys = table.columns.filter((column) => column.pk).map((column) => column.name);
      for (const originalRow of table.rows) {
        const row = { ...originalRow };
        for (const primaryKey of primaryKeys) if (row[primaryKey] === null) row[primaryKey] = `${table.name}-${randomUUID()}`;
        const columns = Object.keys(row);
        if (!columns.length) continue;
        adapter.prepare(`INSERT IGNORE INTO ${quote(table.name)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map((column) => row[column]));
      }
    }
    if (!complete) {
      for (const table of snapshot.tables) {
        for (const index of table.indexes) {
          if (!index.columns.length) continue;
          if (index.name.startsWith('sqlite_autoindex_') && index.columns.length <= 4) continue;
          const useDigest = index.unique && (Boolean(index.where) || index.columns.length > 4);
          const statements = useDigest
            ? generatedPartialIndex(table.name, { ...index, where: index.where || '1=1' })
            : [`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quote(index.name)} ON ${quote(table.name)} (${index.columns.map(quote).join(',')})`];
          for (const sql of statements) adapter.exec(sql);
        }
      }
      adapter.exec("CREATE TABLE mysql_backend_metadata (version VARCHAR(32) PRIMARY KEY, completed_at VARCHAR(64) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
      adapter.prepare('INSERT INTO mysql_backend_metadata(version,completed_at) VALUES(?,?)').run('v1.3-phase7a', new Date().toISOString());
    } else {
      adapter.prepare('UPDATE mysql_backend_metadata SET version=?, completed_at=?').run('v1.7-engineering', new Date().toISOString());
    }
    // Phase 7B correctness gate. All application write transactions lock this
    // singleton row before touching business rows, so independent Node
    // processes cannot race an invariant that spans several tables. This is a
    // deliberately conservative baseline; narrower locks can replace it after
    // workload evidence without weakening correctness.
    adapter.exec(`CREATE TABLE IF NOT EXISTS mysql_transaction_gates (
      gate_id BIGINT NOT NULL,
      purpose VARCHAR(64) NOT NULL,
      updated_at VARCHAR(64) NOT NULL,
      PRIMARY KEY (gate_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    adapter.prepare('INSERT IGNORE INTO mysql_transaction_gates(gate_id,purpose,updated_at) VALUES(1,?,?)')
      .run('application-write', new Date().toISOString());
  } finally {
    adapter.exec('SET FOREIGN_KEY_CHECKS=1');
  }

  const missing = snapshot.tables.filter((table) => !adapter.prepare('SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?').get(table.name));
  if (missing.length) throw new Error(`MySQL bootstrap incomplete; missing tables: ${missing.map((table) => table.name).join(', ')}`);
}
