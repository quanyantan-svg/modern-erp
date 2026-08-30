# Modern ERP

Modern ERP 是基于方天云端 ERP B9V27 可识别业务模型重新设计的教学型 ERP 重构项目。项目采用 React、Node.js 和 SQLite，实现核心业务流程、角色权限、审计记录及可重复执行的数据库迁移。

当前版本为 **2.4.0**。它可以独立运行和演示，但不宣称已经与原系统实现 100% 功能及数据等价；完整重构的范围和验收口径见 [document.md](./document.md)。

## 已实现能力

- 基础资料：客户、供应商、货品、仓库、用户和角色；
- 销售采购：销售订单、采购订单、订单提交与审核；
- 仓储物流：采购入库、销售出库、退货、盘点、调拨和库存流水；
- 财务资金：会计科目、凭证、应收应付、收付款、现金日记账、银行账户、票据、固定资产和报表；
- 生产质量：BOM、生产工单、MRP、工作中心、工序、人工记录、IQC、OQC 和供应商评估；
- 管理扩展：CRM、项目任务、工时、通知、审批、OA、预警和经营分析；
- 系统能力：Bearer Token 认证、RBAC 权限、审计日志、数据库迁移和演示数据初始化。

## 技术栈

- 前端：React 19、Vite 7、原生 CSS；
- 后端：Node.js 原生 HTTP API；
- 数据库：Node.js 内置 SQLite；
- 密码：scrypt 加盐哈希；
- 会话：随机 Bearer Token，数据库仅保存 Token 哈希。

运行环境要求 Node.js 22.13 或更高版本，推荐使用 Node.js 24。

## 快速开始

```powershell
corepack enable
pnpm install
pnpm build
pnpm start
```

启动后访问 <http://127.0.0.1:3001>。

开发模式：

```powershell
pnpm dev
```

## 演示账号

| 账号 | 密码 | 角色 | 主要用途 |
| --- | --- | --- | --- |
| `admin` | `admin123` | 系统管理员 | 用户、角色和全部业务管理 |
| `sales` | `sales123` | 销售专员 | 客户资料和销售订单 |
| `reviewer` | `review123` | 销售主管 | 订单审核与驳回 |
| `warehouse` | `warehouse123` | 仓库管理员 | 仓库和库存业务 |
| `accounting` | `accounting123` | 财务专员 | 财务和资金业务 |

演示密码只适用于本地环境，不应直接用于正式部署。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 同时启动前端和后端开发服务 |
| `pnpm build` | 构建生产版前端 |
| `pnpm start` | 启动 API 并托管已构建的前端 |
| `pnpm test` | 执行 Node.js 自动化测试 |
| `pnpm reset-data` | 删除本地演示数据库，下次启动时重建 |

## 项目结构

```text
modern-erp/
├─ src/
│  ├─ App.jsx                  # 应用壳、导航和页面装配
│  ├─ components/             # 公共界面组件
│  └─ pages/                  # 按业务域拆分的页面
├─ server/
│  ├─ app.js                  # HTTP 应用与 API 路由装配
│  ├─ db.js                   # 数据库入口、基础迁移与种子数据
│  ├─ lib/                    # HTTP、权限辅助和审计
│  ├─ migrations/             # 扩展业务表迁移
│  └─ modules/                # 业务处理器模块
├─ document.md                # 功能需求、范围和验收标准
├─ solution.md                # 架构及技术实现说明
└─ docs/REFACTOR_DESIGN.md    # 原系统重构原则和新旧概念映射
```

## 文档分工

- [document.md](./document.md)：说明系统应当实现什么，以及如何验收；
- [solution.md](./solution.md)：说明系统如何实现、代码如何组织；
- [docs/REFACTOR_DESIGN.md](./docs/REFACTOR_DESIGN.md)：说明重构目标、边界和原系统概念映射。

README 只提供项目入口信息，不重复维护完整需求清单和 API 明细。

## 验证状态

当前自动化测试覆盖健康检查、静态入口、登录、工作台、越权访问和扩展模块在全新数据库上的迁移与查询。提交前应至少执行：

```powershell
pnpm build
pnpm test
```

完整的一比一重构仍需补充原系统功能覆盖矩阵、历史数据迁移、更多异常流程测试和用户验收。
