# Inventory & Warehouse 库存与仓储域级 Acceptance 与 Capability Freeze 记录（2026-11-13）

> **用途**：登记业务所有者对 Inventory & Warehouse 域**整域 Acceptance** 与 **Capability Freeze** 的最终决定、证据、冻结边界与未关闭事项。
>
> **Owner**：Inventory & Warehouse Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`FROZEN` —— 域级 Acceptance 已签发；**44 项 `COVERED` 能力已冻结**。**Manual Closure、Release Readiness、发布与部署不在本记录范围内。**
>
> **权威来源**：Requirement [`docs/requirements/inventory-warehouse.md`](../requirements/inventory-warehouse.md) §32.1～§32.10；Design [`docs/design/inventory-warehouse.md`](../design/inventory-warehouse.md) §27.52 / §27.54；逐项判定 [`docs/audits/inventory-warehouse-capability-audit-20261112.md`](../audits/inventory-warehouse-capability-audit-20261112.md)；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件是验收与冻结证据，不取代 Requirement、Design 或唯一项目状态登记表；其生成不等于 Git 提交、远端同步、发布或部署。

```text
INVENTORY_WAREHOUSE_DOMAIN_ACCEPTANCE_PASS
INVENTORY_WAREHOUSE_CAPABILITY_FREEZE
```

## 1. Owner 决定与冻结边界

业务所有者在本轮对话中指示「现在完成剩下几个业务域的收尾工作」「最终目标是该 mobile erp 系统各业务域的 acceptance 完成整个项目验收」，并就真实 MySQL 证据口径裁定「逐域新建专属 campaign」；在呈报三类真实缺陷后追加裁定**「收敛到 canonical 模块」+「单一 canonical 工作面」**；在实现完成后指示**「解决未解决矛盾 然后签发域级 acceptance」**。据此：

| 项 | 决定 |
|---|---|
| 域级 Acceptance | **通过**（`INVENTORY_WAREHOUSE_DOMAIN_ACCEPTANCE_PASS`） |
| Capability Freeze | **冻结 44 项 `COVERED` 能力**（`INVENTORY_WAREHOUSE_CAPABILITY_FREEZE`） |
| 能力判定 | INV-01～INV-44 共 **44 项**：`COVERED` **44**、`PARTIAL` **0**、`OUT_OF_SCOPE` **0**、`MISSING` **0**（整改前为 29 / 15） |
| `INV-DEC-01`（INV-21 的确认路径未进入 canonical 变更合同） | **已解决**：库存调整（`INVENTORY_ADJUSTMENT`）与库存报废（`INVENTORY_SCRAP`）的确认路径改写 canonical 位置身份并经 `applyInventoryMutation` 生效，负库存策略、库存锁定、期间闸门与 `inventory_mutation_log` 同时适用；估值流水与 `INVENTORY_ADJUSTMENT` / `INVENTORY_SCRAP` 系统凭证语义保持不变。域级合同用例新增三条（调整生效且留痕、调整不得消耗被锁库存、报废生效且留痕） |
| `INV-DEC-02`（INV-25 的可选辅助属性） | **已解决（契约对齐）**：库存辅助属性由 canonical 身份维度（仓位 / 所有权 / 库存状态 / 批号 / 序列号）承载，Requirement §32.3 对该能力的表述已满足；Design §27.52 的 `inventory.aux_*`（optional）列族作为实现载体退役并在设计表中更正 |
| `INV-RES-08`（库存冲销路径未进入 canonical 变更合同） | **随冻结接受的显式残余**：冲销不在 Requirement §32.3 对 INV-07 的枚举内，且它写的是同一张 canonical 余额表、未产生第二套物理账；把它收敛到 canonical 合同需要给 `inventory_transactions` 增加位置键并回填历史，属独立于本轮的结构变更 |
| 实现锚点 | `9b205a7` 写入口收敛与审计基线；`3eece1b` 竞态 worker 修正（campaign 通过的提交）；`9e17757` operator 工作面补齐与浏览器证据去空洞；收尾轮（INV-21 收敛 + 契约对齐）见 §2.4 |

决定来源是当前对话中所有者的明确指令；不存在虚构的手写签名、电子签章、外部审批单或未发生的真实 MySQL 运行记录。

**冻结范围**：整改轮与收尾轮后的本域 Active Contract（Requirement §32 / Design §27）及其 44 项 `COVERED` 能力的实现、schema、测试与证据。

**冻结不包含**：Manual Closure（B3104 / B3105 手册级关闭）、Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作，以及其他 Domain 的 Acceptance。

## 2. 验收证据

| Gate | 已登记结果 |
|---|---|
| `pnpm test:fast` | **632/632 PASS** |
| `pnpm test`（FULL） | **3766/3766 PASS**，0 失败 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` / `git diff --check` | PASS |
| 域级合同套件 `server/inventory-domain-closure.test.js`（本轮新增） | **13/13 PASS**（单写入口不变式、canonical 变更合同、盘点生命周期、乐观复核、扫码、调拨、INV-21 调整 / 报废 / 锁库互斥） |
| 域能力套件 `server/inventory-closure-abc-assembly-barcode.test.js`（本轮新增） | **13/13 PASS**（INV-17 组装拆卸、INV-26 ABC、INV-39 条码生成） |
| 功能 UAT `scripts/acceptance/inventory-warehouse-final-uat.mjs`（28 场景，真实后端） | **28/28 PASS** |
| 浏览器 · 响应式 + 逐页签走查 `scripts/acceptance/inventory-warehouse-responsive-uat.mjs` | **108/108 PASS**（6 界面 × 4 档宽度 = 24；canonical 工作面 21 页签 × 4 档宽度 = 84） |
| 文档一致性 | `current` 模式 N1、N3～N6、N8、N9 PASS、N2 `RETIRED`、**N7 FAIL**（既有历史提交的追溯债务，与本域无关）；`migration` 模式 C1～C6 全 PASS |

### 2.1 真实 MySQL 8.0.37 证据（本域专属 campaign）

| 项 | 值 |
|---|---|
| Manifest | `INVENTORY_WAREHOUSE_MYSQL_V1`（`RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_INVENTORY_WAREHOUSE_RACES` → `CLEANUP_SCHEMA_POST_RUN`） |
| 通过运行 | run `a52fe068-8508-483e-8c76-fd4ca8e88d16`、commit `3eece1b` |
| 结果 | `RESULT = PASS`；`ACK-4 STATE = FINISHED`（清理由 Root 的 `CLEANUP_SCHEMA_POST_RUN` 子进程独立 post-flight 证明） |
| 独立只读复核 | 目标 `modern_erp_domain_test@127.0.0.1:3306/modern_erp_domain_test` → `tables=0 views=0 triggers=0 routines=0 events=0`；serverUuid `256c7a4e-d275-11f1-885b-b025aa71d167`、grants sha256 `bef61617…807e`、MySQL 8.0.37 |
| 竞态套件 | **4/4 PASS**：INV-RACE-01 并发双确认调拨只移动一次；INV-RACE-02 并发双审批盘点只应用一次差异；INV-RACE-03 并发双提交盘点只冻结一次；INV-RACE-04 并发双锁库不超锁 |
| 失败运行（如实登记） | run `c3e4b44c-99e7-479e-8192-bb6f26af4b99`、commit `9b205a7`：`RESULT = FAIL`、`ACK-4 STATE = FAILED`，cleanup 经独立 post-flight 证明。失败原因是**测试装置缺陷**（竞态 worker 把 `mockRequest` 返回的 Promise 当作请求对象传入，报 `req is not async iterable`），被测生产代码未执行到；INV-RACE-01～03 在该次运行中已 PASS。修正见提交 `3eece1b` |

### 2.2 浏览器证据的去空洞过程

库存域的响应式验收脚本此前**从未真正加载目标屏**：脚本注入 token 后未重载，壳层停留在登录页，其绿色只测到登录表单。去空洞后暴露并修复：

| 事实 | 处置 |
|---|---|
| `GET /api/inventory/instant-query` 与 `GET /api/inventory/scan/query` **每次调用都 500**（`query.get is not a function`：过滤函数收到请求 `url` 而非 `url.searchParams`），canonical 工作面控制台错误 7066 条 | 传入 `url.searchParams`；错误降为 0，即时库存页签真实渲染 12 行 |
| 容器「装箱」路由引用未导入的 `pack` → `ReferenceError`；「拆包」写入不存在的 `updated_at` 列与不在 CHECK 词表内的 `UNPACKED` 状态 | 补回导入；拆包只释放装箱归属关系，不改状态、不写不存在的列 |
| 空态选择器（`.empty-state`）与真实 DOM（`.canonical-empty-state` / `.business-state`）不符；导航遮挡判定把**正确固定**到底部的导航误判为遮挡 | 选择器与判定按真实 DOM 修正 |

去空洞后的判定口径：**真实数据或显式空态**、**全部可点目标 ≥44px**、**无横向溢出**、**无控制台错误**、**底部导航固定且内容预留其高度**；并对 canonical 工作面的 21 个页签逐个走查。

### 2.3 随冻结接受的残余

| 编号 | 残余 |
|---|---|
| `INV-RES-01` | **已解决**（INV-21 的确认路径已收敛到 canonical 变更合同，见 `INV-DEC-01`） |
| `INV-RES-02` | **已解决**：Requirement §32.9 F 的 11 个 operator workflow 已全部具备前端入口 |
| `INV-RES-03` | **已解决**（契约对齐，见 `INV-DEC-02`） |
| `INV-RES-04` | 逐列 schema parity 未单独取证；按 `MYSQL-EV-01` 口径由本域专属 campaign 的全量 bootstrap 覆盖 schema 等价 |
| `INV-RES-05` | 既有库存行（`position_key` 为空）只在下一次启动的 backfill 后才对 canonical 身份可见 |
| `INV-RES-06` | N7 文档追溯债务（既有历史提交，与本域能力无关） |
| `INV-RES-07` | 底部导航「不遮挡内容」依赖全站级 `mobile-shell` 的 `padding-bottom` 预留契约，本域只登记证据口径 |
| `INV-RES-08` | 库存冲销路径按 (warehouse, product) 元组重建补偿异动，仍走 legacy tuple 写入；不在 INV-07 的枚举内，且未产生第二套物理账 |

### 2.4 冻结合同的 Supersession

本域收敛到单一 canonical 工作面后，五份既有冻结合同对**旧库存作业面**的界面断言被显式取代（P6 四页签原型、P8 路由与按钮类、V1.2 紧凑行、D6 壳层、E8 业务用语）：断言已迁移到 canonical 工作面，四页签基数与旧库存列表 / 详情 / 盘点编辑器断言按**显式 Supersession** 退役并写入审计台账，未静默删除任何断言。

## 3. 未发生事项

- 未签发 Manual Closure（B3104 / B3105）、Release Readiness、发布或部署的任何 token。
- 未执行真实环境 migration、业务数据库写入、push / merge / tag / 发布 / 部署。
- 未撤销或改写任何已签发的验收记录或 token。
