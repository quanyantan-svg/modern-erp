// 生产前提播种（Requirement §36.21 `PL-SEED-01..05`；Design §32.21）。
//
// 背景：两项「缺该配置事实即按合同 fail closed」的业务前提只存在于客户测试
// 实例的数据库里，**仓库不播种** —— 换环境（drop 库重建）必然复发：
//   * `sales_parameters` 的 SYSTEM 行：缺失则销售订单按
//     `SALES_PARAMETER_UNAVAILABLE` 全量拒绝；
//   * 默认质检点 `QCP-IN-GLOBAL` / `QCP-OUT-GLOBAL`：v13 的条件插入绑定
//     「存在 demo 用户 `user-admin`」，生产模式下永不成立，于是
//     `quality_control_points` 为空、OQC 门禁退化为 fail-safe `BLOCKED`。
//
// 播种口径（全部来自已批准的 Requirement / Design）：
//   * `PL-SEED-05` 幂等 + 不覆盖运维取值 —— 只写**缺失**的行，存在即跳过；
//   * `PL-SEED-04` 不伪造归属 —— `created_by` 必须指向真实存在的用户；库里
//     一个用户都没有时**延后**到管理员创建之后，由 `setup-admin` 用同一份
//     实现补齐（此时播种不写任何行，也**不算失败**）；
//   * `PL-SEED-03` 不放宽门禁 —— 播种的是仓库**已经发布**、却被错误条件抑制
//     的默认质检点，`inspection_required=1`；缺检验仍然拒绝；
//   * 单一定义 —— SQLite 与 MySQL 两条路径调用**同一个**导出函数。

import { runMigrationStep } from './migration-runner.js';

const MIGRATION_ID = 'v25-platform-prerequisite-seeds';

// `PL-SEED-02` 批准取值（= 客户测试实例实测值）。这些开关是业务政策，不是
// 技术默认值，因此取值由业务所有者批准并登记，实现不得自行选定。
const SALES_PARAMETER_SEED = Object.freeze({
  sellableControlEnabled: 1,
  customerMaterialXrefEnabled: 1,
  salesGroupDataScopeEnabled: 1,
  deliveryScheduleEnabled: 1,
  deliveryQuantityControlEnabled: 1,
  orderChangeMode: 'BOTH',
  reservationBehavior: 'DISABLED',
  active: 1,
});

// `PL-SEED-03`：字段值逐字沿用仓库已发布的默认行
// （server/migrations/v13-phase6b-traceability-quality.js:216-222），
// 只把「插入条件依赖 demo 用户」改为「无条件」。
const DEFAULT_QUALITY_CONTROL_POINTS = Object.freeze([
  Object.freeze({
    id: 'qcp-global-incoming-v1',
    code: 'QCP-IN-GLOBAL',
    name: '来料检验默认规则',
    operationType: 'PURCHASE_RECEIPT',
    remarks: 'Phase 3 安全默认：必须检验',
  }),
  Object.freeze({
    id: 'qcp-global-outgoing-v1',
    code: 'QCP-OUT-GLOBAL',
    name: '出货检验默认规则',
    operationType: 'SALES_DELIVERY',
    remarks: 'Phase 3 安全默认：必须检验',
  }),
]);

/**
 * 播种的归属用户：库内最早的管理员用户；没有管理员则取最早的用户。
 * 一个用户都没有时返回 null —— 播种延后，绝不伪造归属。
 */
export function resolveSeedActor(db) {
  const admin = db.prepare(`
    SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id
     WHERE r.id='role-admin' OR r.code='ADMIN'
     ORDER BY u.created_at, u.id LIMIT 1`).get();
  if (admin) return admin.id;
  const earliest = db.prepare('SELECT id FROM users ORDER BY created_at, id LIMIT 1').get();
  return earliest ? earliest.id : null;
}

/** 当前播种状态（读回，不靠写入返回值推断）。 */
export function readSeedState(db) {
  const actorId = resolveSeedActor(db);
  const salesParameters = Boolean(db.prepare("SELECT 1 FROM sales_parameters WHERE scope_key='SYSTEM'").get());
  const qualityControlPoints = Number(db.prepare(`
    SELECT COUNT(*) n FROM quality_control_points
     WHERE code IN ('QCP-IN-GLOBAL','QCP-OUT-GLOBAL') AND version=1`).get().n);
  return {
    actorId,
    salesParameters,
    qualityControlPoints,
    // 没有真实用户可归属时，播种延后到管理员创建之后（PL-SEED-04）。
    deferred: !actorId,
    complete: salesParameters && qualityControlPoints === DEFAULT_QUALITY_CONTROL_POINTS.length,
  };
}

function applySeed(db) {
  const state = readSeedState(db);
  // PL-SEED-04：库里一个用户都没有 → 不写任何行（延后），不算失败。
  if (!state.actorId) return;
  const at = new Date().toISOString();
  if (!state.salesParameters) {
    const seed = SALES_PARAMETER_SEED;
    db.prepare(`
      INSERT OR IGNORE INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,
        customer_material_xref_enabled,sales_group_data_scope_enabled,delivery_schedule_enabled,
        delivery_quantity_control_enabled,order_change_mode,reservation_behavior,active,
        created_at,updated_at,created_by,updated_by)
      VALUES('SYSTEM','SYSTEM',NULL,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      seed.sellableControlEnabled, seed.customerMaterialXrefEnabled, seed.salesGroupDataScopeEnabled,
      seed.deliveryScheduleEnabled, seed.deliveryQuantityControlEnabled, seed.orderChangeMode,
      seed.reservationBehavior, seed.active, at, at, state.actorId, state.actorId,
    );
  }
  for (const point of DEFAULT_QUALITY_CONTROL_POINTS) {
    const present = db.prepare('SELECT id FROM quality_control_points WHERE code=? AND version=1').get(point.code);
    if (present) continue;
    db.prepare(`
      INSERT OR IGNORE INTO quality_control_points(id,code,name,operation_type,scope,product_id,
        inspection_required,sampling_mode,sampling_value,active,effective_from,effective_to,version,
        remarks,created_by,created_at)
      VALUES(?,?,?,?,'GLOBAL',NULL,1,'FULL',NULL,1,'2000-01-01',NULL,1,?,?,?)`).run(
      point.id, point.code, point.name, point.operationType, point.remarks, state.actorId, at,
    );
  }
}

/**
 * 幂等播种生产前提。SQLite 与 MySQL 调用**同一个**实现。
 * 运维已经配置过的取值**不被覆盖**（只写缺失的行）。
 */
export function seedPlatformPrerequisites(db) {
  const result = runMigrationStep(db, {
    id: MIGRATION_ID,
    inspect: (database) => readSeedState(database).complete,
    apply: (database) => applySeed(database),
    verify: (database) => {
      const state = readSeedState(database);
      // 延后（没有可归属的真实用户）不是失败；否则必须达成完整状态。
      return state.deferred || state.complete;
    },
  });
  const state = readSeedState(db);
  // `deferred` 为真时 apply 什么都没写（库内还没有可归属的真实用户），
  // 此时 `status` 仍然是 'applied'，因此延后状态必须单独读出来。
  return { ...result, state, deferred: state.deferred, complete: state.complete };
}
