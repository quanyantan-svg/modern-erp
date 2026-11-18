// F-03 · 委外收货成品的计划身份（Procurement & Outsourcing）。
//
// 委外收货明细此前只能携带**已存在**的批次 / 序列号身份 ID，现场人员无法为本次
// 交付的成品登记新身份，序列号成品因此建不出带身份的收货明细。
//
// 本迁移给 `outsourcing_receipt_items` 增加两个 additive 列，记录收货建单时登记的
// **计划身份**（批次号 / 序列号）。身份主档本身由成品 Writer 在**收货生效**时登记
// （`receiveOutsourcingFinishedGoods`），因此「成品来源字面量只允许出现在成品
// Writer 内」的唯一 Writer 合同保持不变。
//
// 既有行不回填：既有收货明细没有计划身份，保持空值，语义不变。

export function migrateV27OutsourcingReceiptPlannedIdentity(db) {
  addColumn(db, 'outsourcing_receipt_items', 'planned_lot_code', 'planned_lot_code TEXT');
  addColumn(db, 'outsourcing_receipt_items', 'planned_serial_number', 'planned_serial_number TEXT');
}

function addColumn(db, table, column, ddl) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((row) => String(row.name).toLowerCase() === column.toLowerCase())) return false;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    return true;
  } catch {
    // 表不存在（尚未建表）或列已存在：保持幂等，不阻断启动。
    return false;
  }
}
