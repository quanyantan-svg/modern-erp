// Platform SOD 接线 —— 测试用"第二位生产工单审批人"夹具。
//
// 背景：平台 SOD 层自 2026-11-13 起拒绝**创建者审批自己提交的生产工单**
// （PL-DEF-01，生产工单族此前是 6 个审批族中唯一没有自审批防护的）。
//
// 种子角色模型里 PRODUCTION_ORDERS_APPROVE 只授予 ADMIN，而 ADMIN 不能审批自己
// 建的工单 —— 因此凡是要走完"建单 → 审批"链路的测试，都必须显式准备**第二个
// 审批身份**。这与真实部署的要求一致：生产工单的建单人与审批人必须不同。
//
// 本夹具只在**测试自己的数据库**里授权，不改动产品的种子角色模型。

/**
 * 让 WAREHOUSE 角色在本测试库中持有生产工单审批权。
 *
 * 该权限自 2026-11-14 起由 `PL-DEC-04` **正式授予种子角色** `role-warehouse`
 * （它本��就持有 PRODUCTION_ORDERS_VIEW 与全部生产物料执行权限）。
 * 本函数保留为**幂等守卫**：若将来有人从种子角色里移除该权限，
 * 依赖"第二位审批人"的测试会立刻失败，而不是无声地退回自审批。
 *
 * @param {object} db 测试数据库句柄
 */
export function grantProductionApproverToWarehouse(db) {
  db.prepare(
    "INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES('role-warehouse','PRODUCTION_ORDERS_APPROVE')",
  ).run();
}
