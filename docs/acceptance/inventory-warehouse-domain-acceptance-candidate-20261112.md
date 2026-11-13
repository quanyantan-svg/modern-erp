# Inventory & Warehouse 库存与仓储域级 Acceptance 候签材料（2026-11-12）

> **用途**：登记业务所有者对 Inventory & Warehouse 域**整域 Acceptance** 与 **Capability Freeze** 的候签材料、证据、冻结边界与未关闭事项。
>
> **Owner**：Inventory & Warehouse Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`SUPERSEDED` —— 整改轮与取证完成后，业务所有者于 2026-11-13 指示「解决未解决矛盾 然后签发域级 acceptance」。本候签材料所列的两个待裁定项（`INV-DEC-01` / `INV-DEC-02`）已在收尾轮解决，正式签发记录见 [`inventory-warehouse-domain-acceptance-20261113.md`](./inventory-warehouse-domain-acceptance-20261113.md)。本文件保留为决定过程的证据。
>
> **权威来源**：Requirement [`docs/requirements/inventory-warehouse.md`](../requirements/inventory-warehouse.md) §32.1～§32.10；Design [`docs/design/inventory-warehouse.md`](../design/inventory-warehouse.md) §27.52 / §27.54；逐项判定 [`docs/audits/inventory-warehouse-capability-audit-20261112.md`](../audits/inventory-warehouse-capability-audit-20261112.md)；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件是验收证据候选，不取代 Requirement、Design 或唯一项目状态登记表；其存在不等于 Git 提交、远端同步、发布或部署。

## 1. 待裁定事项

| 项 | 候签建议 |
|---|---|
| 域级 Acceptance | 建议**通过**（`INVENTORY_WAREHOUSE_DOMAIN_ACCEPTANCE_PASS`） |
| Capability Freeze | 建议**冻结 42 项 `COVERED` 能力**（`INVENTORY_WAREHOUSE_CAPABILITY_FREEZE`） |
| 能力判定 | INV-01～INV-44 共 **44 项**：`COVERED` **42**、`PARTIAL` **2**（INV-07、INV-25）、`OUT_OF_SCOPE` **0**、`MISSING` **0** |
| `INV-DEC-01`（INV-21 的确认路径未进入 canonical 变更合同） | 建议**不解决**，作为显式残余随冻结接受：库存调整与报废确认仍走 legacy tuple 写入 `adjustInventory`，不产生 canonical mutation log、不校验库存锁；其余九类物理变更已全部走 `applyInventoryMutation` |
| `INV-DEC-02`（INV-25 的可选辅助属性） | 建议**不解决**：Design §27.52 明确 `inventory.aux_*` 为 optional；canonical 身份维度（bin / owner / status / lot / serial）已全部实现并强制 |
| 冻结不包含 | Manual Closure（B3104 / B3105 手册级关闭）、Release Readiness、发布、部署、真实环境 migration、业务数据库写入、远端 Git 操作，以及其他 Domain 的 Acceptance |

## 2. 验收证据

| Gate | 已登记结果 |
|---|---|
| `pnpm test:fast` | **632/632 PASS** |
| `pnpm test`（FULL） | **3766/3766 PASS**，0 失败（整改轮后的稳定基线；补齐前端工作面后复跑结果见 §2.2） |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` / `git diff --check` | PASS |
| 域级合同套件 `server/inventory-domain-closure.test.js`（本轮新增） | **10/10 PASS**（单写入口不变式、canonical 变更合同、盘点生命周期、乐观复核、扫码、调拨） |
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
| `INV-RES-01` | INV-21 的库存调整与报废确认未进入 canonical 变更合同（见 `INV-DEC-01`） |
| `INV-RES-02` | 已解决：Requirement §32.9 F 的 11 个 operator workflow 已全部具备前端入口 |
| `INV-RES-03` | `inventory.aux_*` 可选辅助属性未实现（见 `INV-DEC-02`） |
| `INV-RES-04` | 逐列 schema parity 未单独取证；按 `MYSQL-EV-01` 口径由本域专属 campaign 的全量 bootstrap 覆盖 schema 等价 |
| `INV-RES-05` | 既有库存行（`position_key` 为空）只在下一次启动的 backfill 后才对 canonical 身份可见 |
| `INV-RES-06` | N7 文档追溯债务（既有历史提交，与本域能力无关） |
| `INV-RES-07` | 底部导航「不遮挡内容」依赖全站级 `mobile-shell` 的 `padding-bottom` 预留契约，本域只登记证据口径 |

## 3. 未发生事项

- 未签发任何域级 Acceptance / Capability Freeze token（本文件为候签材料，签字权在业务所有者）。
- 未执行真实环境 migration、业务数据库写入、push / merge / tag / 发布 / 部署。
- 未撤销或改写任何已签发的验收记录或 token。
