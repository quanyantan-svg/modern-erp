import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const quote = (name) => `\`${String(name).replaceAll('`', '``')}\``;

// MySQL physical realization for the Wave-6 LOT frontier index. The logical
// dimensions and their order remain identical to SQLite / solution.md §30.31.5.
// Only the two bounded discriminator/time columns use prefixes: all identity
// columns and the final row id remain full-width. With utf8mb4 this is at most
// (4 * 128 + 16 + 64 + 128) * 4 = 2880 bytes, below InnoDB's 3072-byte limit.
const MYSQL_INDEX_PREFIX_LENGTHS = Object.freeze({
  'inventory_valuation_movements.idx_valuation_movements_identity_status_created': Object.freeze({
    status: 16,
    created_at: 64,
  }),
});

function isValidColumnName(value) {
  return typeof value === 'string' && value.length > 0;
}

// SQLite's PRAGMA index_info returns `name = null` for any index column that
// is actually an expression (e.g. Wave 7 `COALESCE(sales_order_item_id,'')`).
// MySQL 8 has no equivalent column reference for that position, so expression-
// bearing indexes MUST be generated via `generatedPartialIndex`. Detect this
// from the snapshot up front so callers can route to the digest path.
export function hasExpressionColumns(index) {
  if (!index || !Array.isArray(index.columns)) return false;
  const expressions = Array.isArray(index.expressions) ? index.expressions : [];
  for (let i = 0; i < index.columns.length; i += 1) {
    const column = index.columns[i];
    const expr = expressions[i];
    if (!isValidColumnName(column)) return true;
    if (typeof expr === 'string' && expr.length > 0 && expr !== column) return true;
  }
  return false;
}

export function mysqlIndexColumnList(tableName, index) {
  if (!index || !Array.isArray(index.columns)) {
    throw new Error(`MySQL index ${tableName}.${index?.name ?? '<unnamed>'} is missing its column list`);
  }
  const prefixes = MYSQL_INDEX_PREFIX_LENGTHS[`${tableName}.${index.name}`] || {};
  return index.columns.map((column, position) => {
    if (!isValidColumnName(column)) {
      throw new Error(
        `MySQL index column at position ${position} of ${tableName}.${index.name} `
        + `is not a valid column reference (value=${JSON.stringify(column)}). `
        + `Expression-column indexes must be generated via generatedPartialIndex so the digest path is used.`,
      );
    }
    const prefixLength = prefixes[column];
    return `${quote(column)}${prefixLength ? `(${prefixLength})` : ''}`;
  }).join(',');
}

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
  if (name === 'evidence_schema_version') return 'TINYINT UNSIGNED';
  if (declared.includes('INT')) return 'BIGINT';
  if (declared.includes('REAL') || declared.includes('FLOA') || declared.includes('DOUB') || declared.includes('NUM')) return 'DECIMAL(24,6)';
  if (declared.includes('BLOB')) return 'LONGBLOB';
  if (name === 'from_position_identity_json' || name === 'to_position_identity_json') return 'LONGTEXT';
  if (name === 'from_position_key' || name === 'to_position_key') return 'CHAR(64)';
  if (name === 'request_fingerprint') return 'CHAR(67)';
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

export function generatedPartialIndex(tableName, index) {
  const suffix = Buffer.from(index.name).toString('hex').slice(-16);
  const generated = `__partial_${suffix}`;
  const parts = index.columns.map((column, position) => {
    if (isValidColumnName(column)) {
      return `COALESCE(CAST(${quote(column)} AS CHAR),CHAR(30))`;
    }
    const expr = index.expressions?.[position];
    if (typeof expr !== 'string' || expr.length === 0) {
      throw new Error(
        `MySQL index digest at position ${position} of ${tableName}.${index.name} `
        + `is missing both a column reference and an expression (value=${JSON.stringify(column)}).`,
      );
    }
    return `COALESCE(CAST(${expr} AS CHAR),CHAR(30))`;
  }).join(',');
  const where = typeof index.where === 'string' && index.where.length > 0 ? index.where : '1=1';
  const predicate = where.replace(/\bIS\s+NOT\s+NULL\b/gi, 'IS NOT NULL');
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
    ...table.indexes.flatMap((index) => index.columns.filter(isValidColumnName)),
    ...table.foreignKeys.map((foreignKey) => foreignKey.from),
  ]);
  const autoIncrement = /AUTOINCREMENT/i.test(table.sql);
  const primary = table.columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk);
  const definitions = table.columns.map((column) => columnDefinition(table, column, indexed, primary, autoIncrement));
  if (primary.length) definitions.push(`PRIMARY KEY (${primary.map((column) => quote(column.name)).join(',')})`);
  for (const index of table.indexes.filter((candidate) => candidate.origin === 'u' && candidate.columns.length && candidate.columns.length <= 4)) {
    if (hasExpressionColumns(index)) {
      throw new Error(
        `MySQL inline UNIQUE on ${table.name}.${index.name} has expression-bearing columns `
        + `(${JSON.stringify(index.columns)}). MySQL has no inline expression UNIQUE; the index must be created via generatedPartialIndex.`,
      );
    }
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
  const name = String(column.name).toLowerCase();
  const charset = ['from_position_key', 'to_position_key', 'request_fingerprint'].includes(name)
    ? ' CHARACTER SET ascii COLLATE ascii_bin'
    : ['from_position_identity_json', 'to_position_identity_json'].includes(name)
      ? ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'
      // Byte-identity business key. NO PAD matches SQLite `COLLATE BINARY`; utf8mb4_bin
      // is PAD SPACE and would wrongly treat trailing spaces as equal.
      : name === 'lot_code_key'
        ? ' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin'
        : '';
  const inlinePrimary = primaryColumns.length === 1 && primaryColumns[0].name === column.name;
  return `${quote(column.name)} ${type}${charset}${column.notnull || inlinePrimary ? ' NOT NULL' : ''}${mysqlDefault(column.dflt_value, type)}${hasAutoIncrement && inlinePrimary ? ' AUTO_INCREMENT' : ''}`;
}

function ensureInventoryEvidenceMySql(adapter) {
  const foreignKeyStatement = adapter.prepare(`SELECT CONSTRAINT_NAME constraint_name
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_mutation_log'
      AND COLUMN_NAME=? AND REFERENCED_TABLE_NAME='inventory_transactions'`);
  for (const [column, name] of [
    ['out_inventory_transaction_id', 'fk_inventory_mutation_log_out_tx'],
    ['in_inventory_transaction_id', 'fk_inventory_mutation_log_in_tx'],
  ]) {
    if (!foreignKeyStatement.all(column).length) adapter.exec(`ALTER TABLE inventory_mutation_log ADD CONSTRAINT ${quote(name)} FOREIGN KEY (${quote(column)}) REFERENCES inventory_transactions(id)`);
  }
  const triggerNames = new Set(adapter.prepare(`SELECT TRIGGER_NAME trigger_name FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='inventory_mutation_log'`).all().map((row) => row.trigger_name));
  if (!triggerNames.has('trg_inventory_mutation_log_consignment_insert')) adapter.exec(`
    CREATE TRIGGER trg_inventory_mutation_log_consignment_insert BEFORE INSERT ON inventory_mutation_log FOR EACH ROW
    BEGIN
      IF NEW.source_type IN ('CONSIGNMENT_HANDOFF','CONSIGNMENT_SETTLEMENT','CONSIGNMENT_RETURN') AND (
        NEW.quantity<=0 OR NEW.source_item_id IS NULL OR NEW.source_item_id='' OR NEW.request_fingerprint IS NULL
        OR NEW.request_fingerprint NOT REGEXP '^V1:[0-9a-f]{64}$' OR NEW.evidence_schema_version<>1
        OR (NEW.movement_kind='MOVE' AND (NEW.from_position_key IS NULL OR NEW.to_position_key IS NULL OR NEW.from_position_identity_json IS NULL OR NEW.to_position_identity_json IS NULL OR NEW.out_inventory_transaction_id IS NULL OR NEW.in_inventory_transaction_id IS NULL))
        OR (NEW.movement_kind='OUT' AND (NEW.from_position_key IS NULL OR NEW.from_position_identity_json IS NULL OR NEW.out_inventory_transaction_id IS NULL OR NEW.to_position_key IS NOT NULL OR NEW.to_position_identity_json IS NOT NULL OR NEW.in_inventory_transaction_id IS NOT NULL))
        OR (NEW.from_position_identity_json IS NOT NULL AND (JSON_VALID(NEW.from_position_identity_json)=0 OR JSON_UNQUOTE(JSON_EXTRACT(NEW.from_position_identity_json,'$.positionKey'))<>NEW.from_position_key))
        OR (NEW.to_position_identity_json IS NOT NULL AND (JSON_VALID(NEW.to_position_identity_json)=0 OR JSON_UNQUOTE(JSON_EXTRACT(NEW.to_position_identity_json,'$.positionKey'))<>NEW.to_position_key))
      ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CONSIGNMENT_MUTATION_EVIDENCE_INCOMPLETE'; END IF;
    END`);
  if (!triggerNames.has('trg_inventory_mutation_log_consignment_update')) adapter.exec(`
    CREATE TRIGGER trg_inventory_mutation_log_consignment_update BEFORE UPDATE ON inventory_mutation_log FOR EACH ROW
    BEGIN IF OLD.source_type IN ('CONSIGNMENT_HANDOFF','CONSIGNMENT_SETTLEMENT','CONSIGNMENT_RETURN') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CONSIGNMENT_MUTATION_EVIDENCE_IMMUTABLE'; END IF; END`);
  if (!triggerNames.has('trg_inventory_mutation_log_consignment_delete')) adapter.exec(`
    CREATE TRIGGER trg_inventory_mutation_log_consignment_delete BEFORE DELETE ON inventory_mutation_log FOR EACH ROW
    BEGIN IF OLD.source_type IN ('CONSIGNMENT_HANDOFF','CONSIGNMENT_SETTLEMENT','CONSIGNMENT_RETURN') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CONSIGNMENT_MUTATION_EVIDENCE_IMMUTABLE'; END IF; END`);
}

function assertInventoryEvidenceMySql(adapter) {
  const expected = [
    ['source_item_id', 'varchar', 128, 'utf8mb4_0900_ai_ci'],
    ['from_position_key', 'char', 64, 'ascii_bin'],
    ['to_position_key', 'char', 64, 'ascii_bin'],
    ['from_position_identity_json', 'longtext', null, 'utf8mb4_bin'],
    ['to_position_identity_json', 'longtext', null, 'utf8mb4_bin'],
    ['out_inventory_transaction_id', 'varchar', 128, 'utf8mb4_0900_ai_ci'],
    ['in_inventory_transaction_id', 'varchar', 128, 'utf8mb4_0900_ai_ci'],
    ['request_fingerprint', 'char', 67, 'ascii_bin'],
    ['evidence_schema_version', 'tinyint', null, null],
  ];
  const rows = adapter.prepare(`SELECT COLUMN_NAME column_name,DATA_TYPE data_type,
      CHARACTER_MAXIMUM_LENGTH character_maximum_length,COLLATION_NAME collation_name,
      IS_NULLABLE is_nullable,ORDINAL_POSITION ordinal_position
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_mutation_log'
      AND COLUMN_NAME IN (?,?,?,?,?,?,?,?,?) ORDER BY ORDINAL_POSITION`).all(...expected.map(([name]) => name));
  if (rows.length !== expected.length) throw new Error('MySQL inventory mutation evidence columns are incomplete');
  expected.forEach(([name, type, length, collation], index) => {
    const row = rows[index];
    if (row.column_name !== name || String(row.data_type).toLowerCase() !== type || row.is_nullable !== 'YES'
        || (length !== null && Number(row.character_maximum_length) !== length)
        || (collation !== null && row.collation_name !== collation)) {
      throw new Error(`MySQL inventory mutation evidence column mismatch: ${name}`);
    }
  });
  const expectedIndexes = new Map([
    ['uq_inventory_mutation_log_out_tx', ['out_inventory_transaction_id']],
    ['uq_inventory_mutation_log_in_tx', ['in_inventory_transaction_id']],
    ['idx_inventory_mutation_log_group_item', ['movement_group_id','source_type','source_id','source_item_id','id']],
    ['idx_inventory_mutation_log_consumption', ['source_type','source_item_id','from_position_key','business_date','id']],
  ]);
  const indexes = adapter.prepare(`SELECT INDEX_NAME index_name,COLUMN_NAME column_name,SEQ_IN_INDEX seq_in_index,NON_UNIQUE non_unique
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_mutation_log'
    ORDER BY INDEX_NAME,SEQ_IN_INDEX`).all();
  for (const [name, columns] of expectedIndexes) {
    const actual = indexes.filter((row) => row.index_name === name);
    if (actual.length !== columns.length || actual.some((row, index) => row.column_name !== columns[index])
        || (name.startsWith('uq_') && actual.some((row) => Number(row.non_unique) !== 0))) throw new Error(`MySQL inventory mutation evidence index mismatch: ${name}`);
  }
  const triggers = new Set(adapter.prepare(`SELECT TRIGGER_NAME trigger_name FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='inventory_mutation_log'`).all().map((row) => row.trigger_name));
  for (const name of ['trg_inventory_mutation_log_consignment_insert','trg_inventory_mutation_log_consignment_update','trg_inventory_mutation_log_consignment_delete']) {
    if (!triggers.has(name)) throw new Error(`MySQL inventory mutation evidence trigger missing: ${name}`);
  }
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
      if (hasExpressionColumns(index)) {
        throw new Error(
          `MySQL index reconciliation refuses expression-column index ${table.name}.${index.name}. `
          + `Reconciliation is for additive plain-column indexes only; expression indexes must be declared by the canonical migration that owns them.`,
        );
      }
      statements.push(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quote(index.name)} ON ${quote(table.name)} (${mysqlIndexColumnList(table.name, index)})`);
    }
  }
  return statements;
}

export function readMySqlColumnNames(adapter, tableName) {
  const rows = adapter.prepare(`SELECT COLUMN_NAME AS column_name
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
    ORDER BY ORDINAL_POSITION`).all(tableName);
  return new Set(rows.map((row) => row.column_name));
}

export function readMySqlIndexNames(adapter, tableName) {
  const rows = adapter.prepare(`SELECT DISTINCT INDEX_NAME AS index_name
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`).all(tableName);
  return new Set(rows.map((row) => row.index_name));
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
      currentColumns.set(table.name, readMySqlColumnNames(adapter, table.name));
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
        currentIndexes.set(table.name, readMySqlIndexNames(adapter, table.name));
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
          // Expression-column indexes (SQLite PRAGMA index_info returns `name=null`
          // for any expression column, e.g. Wave 7 `COALESCE(sales_order_item_id,'')`)
          // must take the digest path because MySQL has no column reference for an
          // expression position. The plain CREATE INDEX path would otherwise emit
          // `` `null` `` as a literal column name and MySQL would reject it with
          // ER_KEY_COLUMN_DOES_NOT_EXITS.
          const useDigest = hasExpressionColumns(index) || (index.unique && (Boolean(index.where) || index.columns.length > 4));
          const statements = useDigest
            ? generatedPartialIndex(table.name, { ...index, where: index.where || '1=1' })
            : [`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quote(index.name)} ON ${quote(table.name)} (${mysqlIndexColumnList(table.name, index)})`];
          for (const sql of statements) adapter.exec(sql);
        }
      }
      adapter.exec("CREATE TABLE mysql_backend_metadata (version VARCHAR(32) PRIMARY KEY, completed_at VARCHAR(64) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
      adapter.prepare('INSERT INTO mysql_backend_metadata(version,completed_at) VALUES(?,?)').run('v1.3-phase7a', new Date().toISOString());
    } else {
      adapter.prepare('UPDATE mysql_backend_metadata SET version=?, completed_at=?').run('v1.7-engineering', new Date().toISOString());
    }
    ensureInventoryEvidenceMySql(adapter);
    assertInventoryEvidenceMySql(adapter);
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
