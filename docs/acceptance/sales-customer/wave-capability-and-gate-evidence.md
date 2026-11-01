# Sales & Customer — 历史能力与门禁证据说明

> 状态：`HISTORICAL_EVIDENCE`
> Owner：Sales & Customer
> 权威来源：无 —— 能力冻结结论的规范来源是 `docs/requirements/sales-customer/README.md` 与
> `docs/design/sales-customer/README.md`；本文件保留 README 中关于实现文件、API 面、测试入口与
> MySQL 门禁的**操作性说明**，这些细节不在 Requirement/Design 正文中重复。
> 来源：`README.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移）

---

## Wave 8 销售履约扩展（已验收并冻结）

当前工作树已实现 Service Fulfillment 与 Consignment 的上下文工作面，并保留全局 Launcher 不新增主入口：

- 销售订单可进入 Service Fulfillment，执行 `PENDING / CONFIRMED / CANCELLED` 流程；
- Consignment 支持商业地点、指令、Handoff、Settlement、Return 与三层查询；
- Consignment 的物理库存变化仍由 Inventory V21 canonical writer 负责，Finance 暴露仍由既有 Finance writer 负责；
- `inventory_mutation_log` 仅增加经批准的九个 nullable 历史位置证据字段，没有第五张 Wave 8 业务表或影子库存/AR；
- SQLite 与 MySQL 8 迁移均走 canonical migration lifecycle，旧行保持可读且不做猜测式 backfill；
- Wave 8 四张业务表在 MySQL 上由共享 snapshot reconciliation 先行创建；migration 追加只读的 `information_schema` 物理合同断言（列/默认值/NULL/CHECK/FK/UNIQUE/index 顺序/collation），结构不兼容时 fail closed 且不做修复性 DDL；`lot_code_key` 已按最终设计收敛为 MySQL binary collation，并保留升级前歧义检测。
- `SALES_VIEW` 是本轮新增权限且有 §35.18.8 批准依据，不是 HEAD 既有权限；Wave 8 读取判定为 `SALES_MANAGE OR SALES_VIEW` 再叠加对应窄权限，写入判定为 `SALES_MANAGE` + 窄权限。

Wave 8 测试入口：

- `server/sales-customer-wave8-functional.test.js`：Stage D 功能与证据回归；
- `server/sales-customer-wave8-remediation.test.js`：P0/P1 反例复现与闭环（P0-1 零金额、P0-2 SO 商业权威、partition entitlement、handoff 仓库、三层报告、RBAC、C1 锁序证据）；
- `server/sales-customer-wave8-mysql-metadata.test.js`：四表 MySQL 既有结构 fail-closed 证明；
- `server/sales-customer-wave8-mixed-delivery.test.js`：混合/纯服务 Delivery 与 RBAC 负向矩阵（真实 HTTP 面）；
- `server/mysql-sales-customer-wave8-concurrency.integration.js`：真实 MySQL 独立会话 R-SAL-20/21/22 与 A3 竞态。
- 浏览器响应式与 direct/refresh/back/forward 入口为 `node scripts/acceptance/sales-customer-wave8-acceptance.mjs`（本机 Edge，320/390/430/680 CSS px）。

用户已于 2026-10-21 明确确认 `WAVE8_FINAL_ACCEPTANCE_PASS`。上述 Wave 8 批准范围现作为冻结基线；冻结仅适用于 Wave 8，不冻结整个 ERP 项目，也不授权 Wave 9–13、发布、部署或版本变更。

## Gate A 销售 Wave 7 MySQL 门禁（已验收并冻结）

`pnpm test:mysql` 与 `pnpm test:mysql:gate-a` 指向同一个受保护的 bounded Gate A runner，只运行
A-PARITY / A-PROD / A-RAW / A-TXLIFE 四个套件。旧通用 MySQL gate 保留在独立的
`pnpm test:mysql:legacy` 与 `pnpm test:mysql:concurrency`，不属于 Gate A。

用户已于 2026-10-24 明确接受 `GATE_A_MYSQL_CAMPAIGN_PASS`。一次授权的真实 MySQL 执行
（`mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test`，MySQL 8.0.37）四套件全部 PASS：

| 套件 | 用例文件 | 结果 |
|---|---|---|
| A-PARITY | `server/mysql-sales-customer-wave7.integration.js` | 4 / 4 PASS |
| A-PROD | `server/mysql-sales-customer-wave7-concurrency.integration.js` | 6 / 6 PASS |
| A-RAW | `server/mysql-sales-customer-wave7-raw-locks.integration.js` | 4 / 4 PASS |
| A-TXLIFE | `server/mysql-transaction-start-safety.integration.js` | 8 / 8 PASS |

- 冻结仅适用于 Gate A 验收边界，不冻结整个 ERP 项目；
- **历史状态（2026-10-24 记录时）**：Gate B 保持 `BLOCKED_BY_WAVE10`，Wave 10 已实现但尚未验收，
  Wave 11 未启动。**该状态已被后续记录取代**：Wave 10 已于 2026-10-27 完成验收并冻结
  （`WAVE10_FULL_ACCEPTANCE_PASS` / `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED`），
  Wave 11 已推进至 W11-SEC-01 与 W11-A U1/U2/OVERDUE/U3。Gate B 与 Wave 10 的**发布**仍阻塞，
  详见「当前项目状态快照」的 Release Blockers；
- 该冻结不是 Git commit、tag、发布、部署、migration 或版本变更。

## Wave 10 信用检查与特别审批（已验收并冻结）

Wave 10 在 Wave 9 信用基础上实现首个可执行信用运行时：

| 交付物 | 文件 |
|---|---|
| 两张新表与双数据库迁移 | `server/migrations/sales-customer-wave10-credit-check.js` |
| 信用检查引擎 | `server/modules/credit-check.js` |
| 信用特别审批工作流 | `server/modules/credit-special-approval.js` |
| 销售订单提交 / 审批与销售出库确认集成 | `server/modules/sales-orders.js`、`server/app.js` |
| 信用检查评估与信用特别审批页面 | `src/pages/credit-check.jsx` |
| 集中测试 | `server/sales-customer-wave10-credit-check.test.js` |

API：`POST /api/credit/check`、`GET /api/credit/check-results`、`POST /api/credit/special-approvals`、
`GET /api/credit/special-approvals`、`GET /api/credit/special-approvals/:id`、
`POST /api/credit/special-approvals/:id/decide`。

- 信用敞口完全由销售与财务权威事实派生，不存在第二套信用余额或物理敞口缓存；
- 信用检查在销售订单提交、销售订单审批、销售出库确认三个阶段执行，缺失强制档案时后端 fail closed；
- 信用管理默认关闭（`CREDIT_MANAGEMENT_ENABLED` 缺省 false），未启用时既有业务流程行为完全不变；
- 特别审批只对产生该结论的一个信用范围有效，受权限上限、失效业务日期与申请审批分离约束；
- **Wave 10 已于 2026-10-27 验收并冻结**（`WAVE10_FULL_ACCEPTANCE_PASS`）；能力冻结但**发布仍阻塞**
  （`WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED`）。Wave 11 已推进至 W11-A U3（2026-10-31 验收冻结）。
  冻结记录：`document.md` "Wave 10 Capability Freeze (2026-10-27)"。

### Wave 10 MySQL readiness

- The live MySQL initialization path now recreates the canonical
  `finance_open_item_effects` derived View after its dependency tables are bootstrapped, matching
  SQLite fresh, repeated and upgrade initialization behavior.
- The protected Wave 10 Guard requires the exact dedicated-account contract: the eleven approved
  target-schema privileges, three table-scoped Performance Schema reads, global `USAGE` only, no
  roles and no grant delegation. The trusted normalized grant SHA-256 remains an explicit
  preflight input.
- The prepared account is `modern_erp_wave10@127.0.0.1`; its credential is intentionally not
  stored in this repository. Real Wave 10 MySQL Acceptance remains separately authorized.
