# Modern ERP

Modern ERP 是基于方天云端 ERP B9V27 可识别业务模型重建的教学与业务原型系统。当前应用版本为 **1.6.2**，产品方向为 **V1.6 Mobile Enterprise**；最终发布身份仍由 Git release tag 确认。

V1.6 的 P0–P8 原型与产品一致性验收、以及全站 Mobile Enterprise 推广已经完成。当前最终用户产品包含 **53 个启用的 canonical 路由**：其中 10 个 V1.6 原型路由保持冻结，43 个路由已完成全站迁移；5 个明确禁用路由继续保留为非产品入口。发布后的操作员验证结果将单独记录，本 README 不预先声明本次 release-prep 后的测试结论。

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
| pnpm test | 运行完整 Node 测试套件 |
| pnpm test:mysql | 运行受保护的 MySQL 兼容 gate |
| pnpm test:mysql:concurrency | 运行真实 MySQL 并发 gate |
| pnpm test:mysql:performance | 运行受保护的 MySQL 性能测试 |
| pnpm backup-db | SQLite 备份 |
| pnpm restore-db -- &lt;file&gt; | SQLite 恢复 |
| pnpm setup-admin -- --username &lt;name&gt; --password &lt;secret&gt; | 显式创建首个管理员 |
| pnpm reset-data | 仅开发/测试环境重置 SQLite 数据 |

## 仓库地图

    src/                 React 前端、页面、导航和共享组件
    server/app.js        原生 HTTP 路由与部分核心 handler
    server/modules/      领域服务与业务工作流
    server/database/     MySQL adapter、worker、protocol 与 schema
    server/migrations/   增量 schema 迁移
    server/*.test.js     回归、合同与集成测试
    scripts/runtime/     开发运行入口
    scripts/admin/       备份、恢复、首个管理员与受保护的数据转换工具
    scripts/gates/       MySQL 功能/并发 gate 及其子进程 worker
    scripts/diagnostics/ 诊断、性能检查和历史调试工具
    scripts/acceptance/  手工/浏览器验收工具
    scripts/             不提供当前 V1.6 可直接执行的生产全量重置工具
    deploy/              Nginx 与 systemd 配置
    docs/operations/     当前专项运维与演示指南
    docs/archive/        历史审计、阶段与发布证据
    docs/archive/v1.2/   V1.2 审计与视觉验收历史证据
    log/                 append-only 开发日志

scripts/ 的物理路径按职责整理，但 package.json 提供的公共命令名保持稳定；日常仍使用 `pnpm dev`、`pnpm test:mysql:performance` 等命令，不应依赖内部脚本路径。

当前仓库不提供适用于 V1.6 的可直接执行生产全量数据重置工具。此类破坏性操作必须使用单独评审、与目标环境匹配并获得明确批准的流程；`pnpm reset-data` 只面向仓库外的一次性开发/测试 SQLite 数据库。

## 测试与质量门

通常按以下顺序验证：

    # 先运行与变更相关的 focused tests
    pnpm test
    pnpm build
    git diff --check

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

- 当前应用/package 版本为 1.6.2；本检出状态是 V1.6.1 UAT 修复候选，最终验证和发布动作仍由操作员控制。
- Git release tag 是已发布版本的权威来源；最新既有发布 tag 为 `v1.6.0`，本次工作不会移动、删除或重建该 tag。
- master 可以包含尚未打 tag 的发布准备变更；使用 Git SHA 或 `git describe` 标识精确检出状态，不应把未打 tag 的 HEAD 描述为已经发布。
- document.md 和 solution.md 描述当前检出仓库状态，不维护独立语义版本。

## 安全说明

- 不要提交 .env、数据库、备份、日志、令牌或真实密码。
- 仓库中的演示账号只适用于显式启用的本地演示数据；生产环境必须关闭 demo seed 并使用强密码初始化管理员。
- 破坏性数据库操作、生产访问、部署、push、tag 和 Git 历史重写都需要明确批准。

私有项目，禁止外传。
