// V17 Master & Engineering Domain Closure — Wave A: Engineering Reference Foundation.
// Adds Shift / Shift Pattern / Calendar Template / Work Calendar / Basic Activity /
// Workshop Formula (safe grammar only) / Resource / Equipment / Operation /
// Control Code / Work Center additive fields.
//
// All changes are additive. Existing tables/columns are untouched. The new
// columns are nullable or carry safe defaults so legacy data continues to
// load and existing snapshots remain valid.

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function safeAddColumn(db, table, column, ddl) {
  const pragma = db.prepare(`PRAGMA table_info(${table})`).all();
  if (pragma.some((row) => row.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  return true;
}

export function migrateEngineeringReferenceSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS engineering_shifts (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      start_minute INTEGER NOT NULL CHECK(start_minute >= 0 AND start_minute < 1440),
      end_minute INTEGER NOT NULL CHECK(end_minute > 0 AND end_minute <= 1440),
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS engineering_shift_patterns (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      shift_ids TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS engineering_calendar_templates (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      work_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
      shift_pattern_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (shift_pattern_id) REFERENCES engineering_shift_patterns(id)
    );

    CREATE TABLE IF NOT EXISTS engineering_work_calendars (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      template_id TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (template_id) REFERENCES engineering_calendar_templates(id)
    );

    CREATE TABLE IF NOT EXISTS engineering_basic_activities (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'PROCESS' CHECK(stage IN ('PREPARE','PROCESS','DISASSEMBLE')),
      unit TEXT NOT NULL DEFAULT '',
      default_quantity REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS engineering_workshop_formulas (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      formula TEXT NOT NULL,
      formula_version INTEGER NOT NULL DEFAULT 1,
      variables TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS engineering_resources (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'MACHINE' CHECK(category IN ('MACHINE','TOOL','PERSON','MATERIAL','OTHER')),
      quantity REAL NOT NULL DEFAULT 1 CHECK(quantity > 0),
      unit TEXT NOT NULL DEFAULT '',
      work_center_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (work_center_id) REFERENCES work_centers(id)
    );

    CREATE TABLE IF NOT EXISTS engineering_equipment (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      serial TEXT NOT NULL DEFAULT '',
      work_center_id TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','SCRAPPED')),
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (work_center_id) REFERENCES work_centers(id)
    );

    CREATE TABLE IF NOT EXISTS engineering_operations (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      standard_minutes REAL NOT NULL DEFAULT 0 CHECK(standard_minutes >= 0),
      activity_id TEXT,
      work_center_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (activity_id) REFERENCES engineering_basic_activities(id),
      FOREIGN KEY (work_center_id) REFERENCES work_centers(id)
    );

    CREATE TABLE IF NOT EXISTS engineering_control_codes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'PROCESSING' CHECK(category IN ('SCHEDULING','PROCESSING','REPORT','INSPECTION','OUTSOURCE','QUALITY')),
      policy TEXT NOT NULL DEFAULT 'STANDARD',
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  if (tableExists(db, 'work_centers')) {
    safeAddColumn(db, 'work_centers', 'calendar_id', 'calendar_id TEXT');
    safeAddColumn(db, 'work_centers', 'default_efficiency_pct', 'default_efficiency_pct REAL NOT NULL DEFAULT 100');
    safeAddColumn(db, 'work_centers', 'is_outsource', 'is_outsource INTEGER NOT NULL DEFAULT 0');
    safeAddColumn(db, 'work_centers', 'notes', 'notes TEXT NOT NULL DEFAULT ""');
    safeAddColumn(db, 'work_centers', 'updated_at', 'updated_at TEXT');
  }
}