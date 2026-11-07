// M1-Core G03 / G04 只读证据辅助。
//
// 本模块**不含任何业务逻辑**：它只提供「按表采集完整行并做逐字段比较」的
// 能力，以及 G03 / G04 合同所涉业务事实表集的唯一定义。它不写库、不改业务
// 合同、不触碰 Oracle 与 Gate 合同。
//
// 「完整行逐字段比较」与「只比对数量」是两种不同的证据强度，本模块只提供
// 前者：调用方拿到的是每张表按全部列排序后的完整行数组，任意一列的原地
// 改写都会被比较出来。

// Active Design §13.1 的 G03 零副作用列：「业务单据 / 库存 / 跟踪 / 估值 /
// 身份层逐字段零变化」。下表是这五个域在真实 schema 中的**全部**表，
// 外加 L1 发料路径自身写入的 canonical mutation log。
export const G03_BUSINESS_FACT_TABLES = Object.freeze([
  // 业务单据（委外订单是发料/补料/退料所作用的单据本体）
  'outsourcing_orders', 'outsourcing_issues', 'outsourcing_supplements', 'outsourcing_returns',
  'outsourcing_material_list',
  // 库存（含 canonical mutation log：L1 发料路径自身写入的幂等账本）
  'inventory', 'inventory_transactions', 'inventory_mutation_log',
  // 跟踪（跟踪腿、身份分配、批次维度当前投影）
  'tracked_inventory_movements', 'tracked_source_allocations', 'inventory_lot_balances',
  // 估值（估值流水与估值余额）
  'inventory_valuation_movements', 'inventory_valuation_balances',
  // 身份层（身份余额、身份效果、身份效果分配）
  'outsourcing_wip_identity_balances', 'outsourcing_wip_identity_effects',
  'outsourcing_wip_identity_effect_allocations',
  // 幂等账本（拒绝路径的幂等记录写在事务内，随事务回滚，故拒绝后必须零新增）
  'idempotency_records',
  // 货品估值激活标记（`products.valuation_activated_at` 由估值写入者落库，
  // 属估值域的附带事实；拒绝路径不得写入）
  'products',
]);

// G03 业务事实表集的**真实**规模与存在性：由 schema 实际统计。
//
// 用途：让「G03 零副作用覆盖多少张表」这一数字始终可核对 —— 证据文档里的表数
// 必须等于本报告的 `declared`，不得硬编码未经核对的数字。表集本身一旦增删，
// 本报告随之变化，文档与断言都必须同步更新。
export function g03BusinessFactTableReport(db) {
  const missing = [];
  for (const table of G03_BUSINESS_FACT_TABLES) {
    const row = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (Number(row?.n || 0) !== 1) missing.push(table);
  }
  return Object.freeze({
    declared: G03_BUSINESS_FACT_TABLES.length,
    present: G03_BUSINESS_FACT_TABLES.length - missing.length,
    missing: Object.freeze(missing),
    tables: G03_BUSINESS_FACT_TABLES,
  });
}

// L2 canonical inventory primitive 的「无部分写入」范围：物理腿、跟踪腿、
// 估值流水、估值余额与 canonical mutation log。
export const G03_L2_MUTATION_FACT_TABLES = Object.freeze([
  'inventory', 'inventory_transactions', 'tracked_inventory_movements',
  'inventory_valuation_movements', 'inventory_valuation_balances', 'inventory_mutation_log',
]);

// 委外 canonical 变更键的五字段合同模板。
//
// 生产构造点：`server/modules/outsourcing-inventory.js` 的 `mutationKey`。
// 五个字段依次是：sourceType、eventId（业务事件 id）、material.id、
// 物理腿种类、身份键。L2 证据必须用**同一形状**的键构造，否则它证明的不是
// 生产真正使用的键。
export const OUTSOURCING_MUTATION_KEY_TEMPLATE =
  '${sourceType}:${eventId}:${material.id}:MOVE:${identity.identityKey}';

function safeIdentifier(value) {
  const name = String(value || '');
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`M1C_EVIDENCE_UNSAFE_IDENTIFIER:${name}`);
  return name;
}

function canonical(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

// 采集一张表的完整行，并按**全部列**排序，使快照与插入顺序无关。
export function orderedRows(db, table) {
  const name = safeIdentifier(table);
  const columns = db.prepare(`PRAGMA table_info(${name})`).all().map((row) => row.name);
  if (!columns.length) throw new Error(`M1C_EVIDENCE_TABLE_NOT_FOUND:${name}`);
  const order = columns.map((column) => safeIdentifier(column)).join(', ');
  return canonical(db.prepare(`SELECT * FROM ${name} ORDER BY ${order}`).all());
}

// 一组表的完整快照。
export function snapshotTables(db, tables) {
  return Object.fromEntries(tables.map((table) => [table, orderedRows(db, table)]));
}

// 两份快照之间发生变化的表。空数组即「逐字段零变化」。
export function changedTables(before, after) {
  return Object.keys(before).filter((table) => JSON.stringify(before[table]) !== JSON.stringify(after[table]));
}

// 快照的可读差异描述：逐表给出变化前行数与变化后行数。
export function describeSnapshotChanges(before, after) {
  return changedTables(before, after).map((table) => `${table}:${before[table].length}->${after[table].length}`);
}
