// Procurement & Outsourcing — 期初委外订单 / 期初委外 WIP schema (OUT-23)。
//
// Contract source:
//   - Requirement §31.3.3 OUT-23（`docs/requirements/procurement-outsourcing.md`）：
//     必须覆盖 … opening outsourcing order / opening outsourcing WIP …
//   - Active Design §26.20「Period / WIP / Opening / Reports (OUT-23)」：
//     `opening: opening records 标记 OPENING，不得虚构历史 voucher`。
//
// 本文件只做**加法**（additive）：
//   1. `outsourcing_orders.is_opening` —— 期初委外订单的显式标记。
//      `source_type` 的既有 CHECK 只允许 ('PLANNING','MANUAL')，**不改**它：
//      期初单据仍然是一张 MANUAL 来源的委外订单，只是被显式标记为期初。
//   2. `outsourcing_wip_identity_effects.event_type` 增加 `'OPENING'` ——
//      期初 WIP 必须**进同一本身份账**（§26.34.15.2 的唯一账本口径），
//      不得另建第二套 WIP 账本。SQLite 不能 ALTER CHECK，因此按仓库既有
//      模式重建表；重建是幂等的，且**逐行原样搬运**历史数据。
//   3. `outsourcing_opening_material_lines` —— 期初委外订单的物料行头
//      （物料 / 数量 / 来源仓 / 供应商 WIP 位置 / 期初业务日期 / 身份策略）。
//      行级身份余额仍落在 `outsourcing_wip_identity_balances`，
//      因此 WIP 余额读模型**不需要第二套 SQL**。
//
// **不虚构历史凭证**：本迁移不产生任何会计凭证、应付或库存流水。
// 期初 WIP 的物理库存事实由业务写入路径（`server/modules/outsourcing.js`）
// 在**明确的库存位置**上建立，并由既有 inventory period close 读模型消费。
//
// 幂等：全部 DDL 可重放；表已存在则跳过重建。

function tableExists(db, name) {
  if (db.dialect === 'mysql') {
    return Boolean(db.prepare(`SELECT 1 FROM information_schema.tables
      WHERE table_schema=DATABASE() AND table_name=? LIMIT 1`).get(name));
  }
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return Boolean(row);
}

function tableSql(db, name) {
  if (db.dialect === 'mysql') {
    return db.prepare(`SELECT table_collation AS sql FROM information_schema.tables
      WHERE table_schema=DATABASE() AND table_name=? LIMIT 1`).get(name)?.sql || '';
  }
  return db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)?.sql || '';
}

function tableColumns(db, name) {
  if (db.dialect === 'mysql') {
    return db.prepare(`SELECT column_name FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name=?`).all(name)
      .map((row) => String(row.column_name || row.COLUMN_NAME || '').toLowerCase());
  }
  return db.prepare(`PRAGMA table_info(${name})`).all().map((row) => String(row.name).toLowerCase());
}

function safeAddColumn(db, table, column, ddl) {
  if (!tableExists(db, table)) return false;
  if (tableColumns(db, table).includes(column.toLowerCase())) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  return true;
}

function safeIndex(db, sql) {
  try { db.exec(sql); } catch (_error) { /* already exists */ }
}

/**
 * `event_type` 的 CHECK 是否已经包含 `'OPENING'`。
 *
 * SQLite 可以直接读表 DDL；MySQL 的 DDL 不在 `information_schema` 里，
 * 因此改为**探测**：尝试插入一条 `event_type='OPENING'` 的探针行，
 * 立刻回滚。CHECK 存在时插入失败；不存在时插入成功。
 *
 * 探针行使用一个不可能与真实业务冲突的 `material_list_id`
 * （CHECK / FK 均在真实数据上生效，FK 失败也算「无法证明 OPENING 可用」，
 * 但那会让探测误判 —— 因此探针只在**不违反 FK** 的前提下进行：
 * 先在事务内插入，失败即回滚）。
 */
function eventTypeAllowsOpening(db) {
  if (db.dialect === 'mysql') {
    // MySQL 8: `information_schema.check_constraints` 记录 CHECK 表达式文本。
    const rows = db.prepare(`SELECT cc.check_clause AS clause FROM information_schema.check_constraints cc
      JOIN information_schema.table_constraints tc ON tc.constraint_schema=cc.constraint_schema AND tc.constraint_name=cc.constraint_name
      WHERE tc.constraint_schema=DATABASE() AND tc.table_name='outsourcing_wip_identity_effects'`).all();
    return rows.some((row) => /OPENING/.test(String(row.clause || '')));
  }
  return /OPENING/.test(tableSql(db, 'outsourcing_wip_identity_effects'));
}

export function migrateProcurementOutsourcingOpeningSchema(db) {
  const now = new Date().toISOString();

  // ── 1. 期初委外订单标记 ──
  //
  // `is_opening=1` 表示「这张委外订单是期初建账的历史事实」。
  // 它**不**伪造任何凭证、应付或历史流水；它只让既有读模型能够区分
  // 「期初单据」与「当期业务单据」，从而在期间关闭与报表中给出正确口径。
  safeAddColumn(db, 'outsourcing_orders', 'is_opening', 'is_opening INTEGER NOT NULL DEFAULT 0');
  safeAddColumn(db, 'outsourcing_orders', 'opening_business_date', 'opening_business_date TEXT');
  safeAddColumn(db, 'outsourcing_orders', 'opening_source_reference', 'opening_source_reference TEXT');
  safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_outsourcing_orders_opening ON outsourcing_orders(is_opening, business_date)');

  // ── 2. 期初委外物料行 ──
  //
  // 一行 = 一条期初用料事实：
  //   `product_id`                物料
  //   `quantity_num/den`         期初数量（有理数；分母恒为正）
  //   `source_warehouse_id`       物料**来源仓**（企业侧，已发料到供应商时的出库仓）
  //   `supplier_wip_warehouse_id` 供应商 WIP **位置**（不是所有权转移）
  //   `opening_business_date`     期初业务日期
  //   `identity_type`             身份策略：LOT / SERIAL / NONE
  //
  // 数量用有理数（分子/分母）存储，与仓库既有 `quantity_num/quantity_den`
  // 口径一致；数量比较一律走 `roundRational` / `HALF_UP`。
  db.exec(`
    CREATE TABLE IF NOT EXISTS outsourcing_opening_material_lines (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity_num INTEGER NOT NULL,
      quantity_den INTEGER NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT 'EA',
      source_warehouse_id TEXT,
      supplier_wip_warehouse_id TEXT,
      opening_business_date TEXT NOT NULL,
      identity_type TEXT NOT NULL DEFAULT 'NONE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES outsourcing_orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (source_warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (supplier_wip_warehouse_id) REFERENCES warehouses(id),
      CHECK(quantity_num > 0),
      CHECK(quantity_den > 0),
      CHECK(identity_type IN ('LOT','SERIAL','NONE'))
    );
    CREATE INDEX IF NOT EXISTS idx_outsourcing_opening_material_lines_order
      ON outsourcing_opening_material_lines(order_id, product_id);
  `);

  // ── 3. WIP 身份账增加 'OPENING' 事件类型 ──
  //
  // 期初 WIP 必须进**同一本**身份账：期初结余是一次「SUPPLY」事实，
  // 它可以被后续 RETURN / BACKFLUSH / TRANSFER_OUT 消费。把它写在
  // 账本之外就等于建了第二套 WIP 账本，违反 §26.34.15.2。
  //
  // SQLite 不能 ALTER CHECK，因此按仓库既有模式重建表；历史行**逐行原样**搬运，
  // 重建前后的行数与内容必须一致（迁移自身会校验行数）。
  if (tableExists(db, 'outsourcing_wip_identity_effects')
    && !eventTypeAllowsOpening(db)) {
    if (db.dialect === 'mysql') {
      // MySQL 8: 直接用 `MODIFY COLUMN` 改 CHECK 表达式，**不重建表**。
      // 重建表会破坏指向本表的自引用 FK（`source_effect_id`）与其他表的
      // 外键，并且 DDL 自动提交、无法回滚 —— 那不是可接受的迁移语义。
      db.exec(`ALTER TABLE outsourcing_wip_identity_effects
        MODIFY COLUMN event_type VARCHAR(64) NOT NULL
        CHECK(event_type IN ('ISSUE','SUPPLEMENT','TRANSFER_IN','RETURN','BACKFLUSH','TRANSFER_OUT','OPENING'))`);
      if (!eventTypeAllowsOpening(db)) {
        throw new Error('OUTSOURCING OPENING SCHEMA: WIP 身份账 event_type 未接受 OPENING');
      }
    } else {
      const before = db.prepare('SELECT COUNT(*) c FROM outsourcing_wip_identity_effects').get().c;
      db.exec(`
        CREATE TABLE outsourcing_wip_identity_effects_new (
          id TEXT PRIMARY KEY,
          material_list_id TEXT NOT NULL,
          identity_key TEXT NOT NULL,
          identity_type TEXT NOT NULL CHECK(identity_type IN ('LOT','SERIAL','NONE')),
          lot_id TEXT,
          serial_id TEXT,
          effect_direction TEXT NOT NULL CHECK(effect_direction IN ('SUPPLY','CONSUME')),
          signed_quantity REAL NOT NULL,
          event_type TEXT NOT NULL CHECK(event_type IN ('ISSUE','SUPPLEMENT','TRANSFER_IN','RETURN','BACKFLUSH','TRANSFER_OUT','OPENING')),
          business_event_id TEXT NOT NULL,
          business_event_item_id TEXT NOT NULL,
          source_effect_id TEXT,
          business_date TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          request_fingerprint TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (material_list_id) REFERENCES outsourcing_material_list(id),
          FOREIGN KEY (source_effect_id) REFERENCES outsourcing_wip_identity_effects(id),
          UNIQUE(event_type, business_event_id, business_event_item_id, identity_key),
          CHECK((identity_type='LOT' AND lot_id IS NOT NULL AND serial_id IS NULL)
             OR (identity_type='SERIAL' AND serial_id IS NOT NULL AND lot_id IS NULL)
             OR (identity_type='NONE' AND lot_id IS NULL AND serial_id IS NULL)),
          CHECK((effect_direction='SUPPLY' AND signed_quantity > 0)
             OR (effect_direction='CONSUME' AND signed_quantity < 0))
        );
      `);
      db.exec(`INSERT INTO outsourcing_wip_identity_effects_new(
        id,material_list_id,identity_key,identity_type,lot_id,serial_id,effect_direction,signed_quantity,
        event_type,business_event_id,business_event_item_id,source_effect_id,business_date,
        idempotency_key,request_fingerprint,created_at)
        SELECT id,material_list_id,identity_key,identity_type,lot_id,serial_id,effect_direction,signed_quantity,
        event_type,business_event_id,business_event_item_id,source_effect_id,business_date,
        idempotency_key,request_fingerprint,created_at FROM outsourcing_wip_identity_effects`);
      const after = db.prepare('SELECT COUNT(*) c FROM outsourcing_wip_identity_effects_new').get().c;
      if (Number(after) !== Number(before)) {
        throw new Error(`OUTSOURCING OPENING SCHEMA: WIP 身份账重建行数不一致 ${before} -> ${after}`);
      }
      db.exec('DROP TABLE outsourcing_wip_identity_effects');
      db.exec('ALTER TABLE outsourcing_wip_identity_effects_new RENAME TO outsourcing_wip_identity_effects');
      safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_outsourcing_wip_identity_effects_balance ON outsourcing_wip_identity_effects(material_list_id, identity_key, created_at, id)');
    }
  }

  // ── 4. 期初物料行 → `outsourcing_material_list` 的映射 ──
  //
  // 期初物料行必须在 `outsourcing_material_list` 里有**同名**行：
  // 否则供应商 WIP 余额读模型（`outsourcing_wip_identity_balances` 的
  // 外键指向 material_list_id）无法承载期初结余。写入路径负责同步，
  // 本列只是把「期初行 ↔ 常规物料行」的对应关系显式化，便于追溯。
  safeAddColumn(db, 'outsourcing_material_list', 'opening_line_id', 'opening_line_id TEXT');
  safeAddColumn(db, 'outsourcing_material_list', 'is_opening', 'is_opening INTEGER NOT NULL DEFAULT 0');
  safeIndex(db, 'CREATE INDEX IF NOT EXISTS idx_outsourcing_material_list_opening ON outsourcing_material_list(is_opening, order_id)');

  void now;
}
