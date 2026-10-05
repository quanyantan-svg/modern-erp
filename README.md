# Modern ERP

Modern ERP 是一套基于 React + Node + SQLite/MySQL 技术体系、采用 mobile-first 产品形态构建的现代 ERP 系统。当前已发布产品基线为 **v1.6.2**，其内部代号为 **V1.6 Mobile Enterprise**，包含 53 个启用的 canonical 路由与 5 个明确禁用路由；最终发布身份由 Git release tag 确认。

当前应用版本仍为 `1.6.2`；最新既有 release tag 仍为 `v1.6.2`，不得移动、删除或重建。`master` 是持续开发分支，可以包含尚未打 tag 的发布准备变更；精确检出状态由 Git SHA 或 `git describe` 标识，HEAD 不应被描述为已经发布的版本。

后续开发的产品主线是：

> 以《金蝶云星空标准版操作手册》B3101–B3122 共 22 份手册作为**模块级功能对标来源**，吸收成熟 ERP 的业务功能、术语、流程、控制机制与模块边界。

Modern ERP 不是金蝶产品的复刻、UI 像素复制或代码复制，也不宣称与金蝶产品等同；它继续在自己的技术栈与 mobile-first 形态下实现由上述对标产生的具体模块能力。Wave / Stage / V2 / V1.6 等历史工程路线不再决定产品开发顺序，仅作为模块内部工程约束或历史迁移记录存在。

当前 V1.6 P0–P8、53 启用 routes、5 disabled routes 等已经形成的产品事实，是历史完成状态 / 已有产品基线，不构成未来模块对标的替代路线。

## 当前支持

- 五角色 RBAC、独立审核与操作审计；
- 客户、供应商、产品、仓库、BOM、工艺路线等主数据；
- 销售、采购、收发货、退货、应收应付与结算；
- Forecast、MRP、生产/采购指令、请购和生产执行；
- IQC/OQC、批次/序列号、库存追溯与生产谱系；
- 存货估值、WIP、总账、税、商业开票和期间关闭；
- 期初批次、CSV 导入和 canonical export；System Health / 核对与受控 Go-Live 用户前端不在最终可见 ERP 范围内，后端 reconciliation、期初与 Go-Live / import 能力保留；
- SQLite 本地/测试路径与 MySQL 8 运行路径。

完整业务合同见 [document.md](./document.md)，技术设计见 [solution.md](./solution.md)。

## 明确限制

- 当前只支持单组织、单本位币业务模型。
- 不包含多公司、多币种、政府电子发票、APS、完整 MES/OEE、完整 QMS/CAPA、年结结转或里程碑开票。
- MySQL 兼容和并发正确性已有专门实现与 gate，但真实生产容量、百万级数据性能和所有旧列表分页尚未完成环境化认证。
- server/app.js 和部分前端页面仍较大，后续重构不得改变既有业务合同。

## 实际技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 19、Vite 7 |
| 后端 | Node.js 22.23.2 原生 HTTP |
| 数据库 | SQLite（本地/测试兼容）与 MySQL 8（一等运行后端） |
| 数据库驱动 | Node node:sqlite、mysql2 worker adapter |
| 反向代理 | Nginx |
| 进程管理 | systemd |
| 包管理 | pnpm |

项目不使用 Express、Koa 或 PM2。

## 快速开始

要求 Node.js 22.23.2 和 pnpm。

    pnpm install
    pnpm dev

- 前端开发入口：http://127.0.0.1:5173
- API 默认入口：http://127.0.0.1:3001

生产式本地启动：

    pnpm build
    pnpm start

Windows 可在完成构建后使用 start-local.ps1。

## 环境与数据库后端

复制并检查 .env.example。应用不依赖 dotenv；变量必须由 shell、进程管理器或 systemd EnvironmentFile 注入。

SQLite 默认配置：

    ERP_DB_BACKEND=sqlite
    ERP_DB_PATH=./data/erp.db

MySQL 8 需要：

    ERP_DB_BACKEND=mysql
    ERP_DB_HOST=127.0.0.1
    ERP_DB_PORT=3306
    ERP_DB_NAME=modern_erp
    ERP_DB_USER=modern_erp
    ERP_DB_PASSWORD=<provided-securely>

不要把真实密码写入仓库、日志或命令示例。MySQL 测试只允许对名称明确标识为测试/disposable 且显式启用 reset guard 的数据库运行。

## 常用命令

| 命令 | 用途 |
|---|---|
| pnpm dev | 同时启动前端与 API 开发环境 |
| pnpm build | 构建前端至 dist/ |
| pnpm start | 启动生产式 Node 服务 |
| pnpm test:fast | 运行日常快速回归（前端 registry、helpers、suite governance self-test、小型确定性测试） |
| pnpm test | 运行 canonical 完整回归（default completion gate） |
| pnpm test:heavy | 运行 heavy / backup / systemd / nginx / production bootstrap；MySQL gate 保持独立 |
| pnpm test:all | 运行 full + heavy，用于 release candidate / 数据库 migration release（FAST 不会重复执行） |
| pnpm test:list | 仅列出 FULL suite 文件清单，不执行测试 |
| pnpm test:mysql | 运行受保护的 MySQL 兼容 gate |
| pnpm test:mysql:concurrency | 运行真实 MySQL 并发 gate |
| pnpm test:mysql:performance | 运行受保护的 MySQL 性能测试 |
| pnpm backup-db | SQLite 备份 |
| pnpm restore-db -- &lt;file&gt; | SQLite 恢复 |
| pnpm setup-admin -- --username &lt;name&gt; --password &lt;secret&gt; | 显式创建首个管理员 |
| pnpm reset-data | 仅开发/测试环境重置 SQLite 数据 |

## 仓库地图

    src/main.jsx              React 启动入口
    src/App.jsx               应用壳、权限化导航和 Registry 驱动的 Screen orchestration
    src/navigation/           canonical applicationRegistry、RouteLocation、Launcher 与 navigation context
    src/lib/                  金额、状态、产品文案与共享 presentation 工具
    src/api.js                Bearer Token、请求封装和安全错误映射
    src/pages/                业务页面
    src/components/           通用与移动端组件
    src/styles/               共享与 V1.6 / V1.7 各 domain 样式
    server/index.js           配置数据库、创建 HTTP server、优雅关闭
    server/app.js             原生 HTTP 路由、认证分发及仍未拆出的核心 handler
    server/db.js              SQLite schema/seed、权限、共享 transaction 和数据库创建
    server/modules/           领域服务、工作流和 reconciliation
    server/database/          MySQL adapter、worker、protocol 与 schema bootstrap
    server/migrations/        按业务阶段组织的增量迁移
    server/lib/               HTTP 校验/响应、审计和结构化日志
    server/*.test.js          单元、合同、回归和集成测试
    scripts/runtime/          开发运行入口；package.json 保持稳定命令别名
    scripts/admin/            备份、恢复、首个管理员与受保护的数据转换工具
    scripts/gates/            MySQL 功能/并发 gate 与 JSON-lines 并发 worker
    scripts/diagnostics/      诊断、性能检查和历史调试工具
    scripts/acceptance/       隔离数据库、浏览器和发布验收工具
    scripts/testing/          跨平台 test runner、suite manifest 与 governance validate
    deploy/                   Nginx 与 systemd 配置
    docs/operations/          当前专项运维与演示指南（含 testing.md）
    docs/archive/             历史审计、阶段与发布证据
    docs/archive/v1.6/        V1.6 各阶段设计证据与验收记录
    log/                      append-only 开发日志（log/YYYY-MM-DD.md）

scripts/ 的物理路径按职责整理，但 package.json 提供的公共命令名保持稳定；日常仍使用 `pnpm dev`、`pnpm test:mysql:performance` 等命令，不应依赖内部脚本路径。当前仓库不提供适用于 V1.6 的可直接执行生产全量数据重置工具。

当前仓库不提供适用于 V1.6 的可直接执行生产全量数据重置工具。此类破坏性操作必须使用单独评审、与目标环境匹配并获得明确批准的流程；`pnpm reset-data` 只面向仓库外的一次性开发/测试 SQLite 数据库。

## 测试与质量门

日常开发（单域 / 单页面 / 小型 bugfix / 低风险重构）：

    pnpm test:fast
    pnpm build
    git diff --check

跨域 / 架构 / canonical metadata / release-candidate：

    pnpm test
    pnpm build
    git diff --check

数据库 / 备份 / 生产 / 迁移 / release 相关变更追加：

    pnpm test:heavy

完整 release candidate / 数据库 migration release / 生产认证：

    pnpm test:all

新增低成本 runner 选项：

    pnpm test:list                          # 列 FULL suite 文件清单，不执行测试
    node scripts/testing/run-tests.js <suite> --list
    node scripts/testing/run-tests.js <suite> --filter <substring>   # targeted smoke

测试分层的 contract、set 关系不变量（FAST ⊆ FULL、FULL ∩ HEAVY = ∅、ALL = FULL ∪ HEAVY）
与每条命令实际执行的清单见 [docs/operations/testing.md](./docs/operations/testing.md)。
当前 V1.7 P0 之后的具体测试矩阵也在该文件中。

`pnpm test` 当前覆盖 1914 个 Node `--test`，约 56 秒；`pnpm test:fast`
约 14 秒、344 个 Node `--test`，覆盖 frontend registry、helpers、
copy/status、轻量权限、suite governance self-test 与小型确定性回归。

MySQL gate 需要单独的 disposable MySQL 8 环境；缺少明确测试配置时会安全拒绝运行。

## 部署入口

- 环境变量模板：.env.example
- Nginx：deploy/nginx/modern-erp.conf
- 主服务：deploy/systemd/modern-erp.service
- 备份服务和 timer：deploy/systemd/modern-erp-backup.*
- 当前详细指南：[docs/operations/deployment.md](./docs/operations/deployment.md)

部署指南区分 MySQL 8 目标生产路径与 SQLite 本地/兼容路径；MySQL 生产备份、恢复和容量仍需目标环境单独验收。

## Canonical 文档

- [document.md](./document.md)：唯一当前功能/业务需求来源。
- [solution.md](./solution.md)：唯一当前技术设计/实现来源。
- [AGENTS.md](./AGENTS.md)：唯一当前开发与 AI 治理政策。
- log/YYYY-MM-DD.md：只追加的开发历史。
- [docs/](./docs/)：专项运维资料与历史证据索引，不是第二套当前规格。

## 版本语义

- 当前应用/package 版本为 `1.6.2`，最新既有 release tag 为 `v1.6.2`，HEAD 可以领先 tag 包含尚未发布的开发变更；最终发布身份由 Git release tag 确认。
- Git release tag 是已发布版本的权威来源；不得移动、删除或重建既有 release tag；不要把当前未打 tag 的 HEAD 描述为已经发布的版本。
- 精确开发状态由 Git SHA 或 `git describe` 标识；不要把 SHA 硬编码进 README 作为永久版本号。
- document.md 和 solution.md 描述当前检出仓库状态，不维护独立语义版本。
- 22 模块对标主线不是 `v2.0.0` release 声明；不因开始金蝶模块对标而自动创建或修改 release tag。

## 当前开发主线

产品开发主线以**金蝶业务模块**为顶层单位，遵循下列顺序：

`金蝶模块 → 当前实现审计 → Coverage Matrix → Gap → Requirement → Design → Implementation → Acceptance → Module Freeze`

默认按编号推进：B3101 → B3102 → …… → B3122。每个模块必须独立完成审计、设计、实现、验收，通过后方可进入下一个模块；不得以"重构完成"、"已有同名页面"等工程理由跳过 Acceptance。

详细规则与术语见 [document.md](./document.md)（§20 金蝶模块级功能对标开发主线）与 [solution.md](./solution.md)（§19 金蝶模块级功能对标实施设计与工程约束）。

## 安全说明

- 不要提交 .env、数据库、备份、日志、令牌或真实密码。
- 仓库中的演示账号只适用于显式启用的本地演示数据；生产环境必须关闭 demo seed 并使用强密码初始化管理员。
- 破坏性数据库操作、生产访问、部署、push、tag 和 Git 历史重写都需要明确批准。

私有项目，禁止外传。
