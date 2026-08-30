# Modern ERP

Modern ERP 是基于方天云端ERP B9V27可识别业务模型重新设计的教学型ERP重构项目。

## 目标环境

| 项目 | 配置 |
|------|------|
| 云服务器 | 腾讯云轻量应用服务器 |
| 操作系统 | Ubuntu 22.04 LTS |
| 数据库 | MySQL 8.0 |
| 后端 | Node.js 22 LTS |
| 前端托管 | Nginx |
| 部署方式 | Git代码拉取 |

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React | 19.x |
| 构建工具 | Vite | 7.x |
| 后端运行时 | Node.js | 22.x |
| 后端框架 | Express | 4.x (计划中) |
| 数据库 | MySQL | 8.0 |
| 包管理 | pnpm | - |

## 快速开始

### 开发环境

\\\ash
# 安装依赖
pnpm install

# 开发模式 (前端 + 后端)
pnpm dev

# 访问 http://localhost:5173
\\\

### 生产环境

详见 [部署指南](docs/06-deployment.md)

\\\ash
# 配置环境变量
cp .env.example .env
nano .env

# 构建前端
pnpm build

# 启动服务
pnpm start

# 或使用PM2
pm2 start ecosystem.config.js
\\\

## 常用命令

| 命令 | 用途 |
|------|------|
| pnpm install | 安装依赖 |
| pnpm dev | 开发模式 |
| pnpm build | 构建前端 |
| pnpm start | 启动生产服务 |
| pnpm test | 运行测试 |
| pnpm reset-data | 重置演示数据 |

## 演示账号

| 账号 | 密码 | 角色 |
|------|------|------|
| admin | admin123 | 系统管理员 |
| sales | sales123 | 销售专员 |
| reviewer | review123 | 销售主管 |
| warehouse | warehouse123 | 仓库管理员 |
| accounting | accounting123 | 财务专员 |

**注意**: 演示密码仅用于本地开发，生产环境必须修改。

## 项目结构

\\\
modern-erp/
├── src/              # React前端源码
├── server/           # Node.js后端
├── docs/             # 项目文档
├── deploy/           # 部署配置
└── scripts/          # 工具脚本
\\\

## 文档导航

| 文档 | 说明 |
|------|------|
| [系统审计](docs/00-system-audit.md) | 当前技术栈和业务覆盖分析 |
| [需求规格](docs/01-requirements.md) | 功能需求和非功能需求 |
| [功能矩阵](docs/02-feature-matrix.md) | 功能完整性对照表 |
| [目标架构](docs/03-architecture.md) | 目标系统架构设计 |
| [重构计划](docs/04-refactor-plan.md) | 分阶段重构计划 |
| [数据库设计](docs/05-database.md) | MySQL表结构设计 |
| [部署指南](docs/06-deployment.md) | Ubuntu生产环境部署 |
| [Git工作流](docs/07-git-workflow.md) | 分支和提交规范 |
| [验收清单](docs/08-acceptance-checklist.md) | 功能验收标准 |

## 已实现功能

### 完整功能
- 认证与权限 (RBAC, 审计日志)
- 基础资料 (客户、供应商、货品、仓库)
- 销售管理 (订单、状态机)
- 采购管理 (订单、状态机)
- 仓储物流 (入库、出库、退货、盘点、调拨)
- 财务会计 (科目、凭证、分录)
- 应收应付 (账款、收款、付款)
- 资产管理 (固定资产、折旧)

### 部分功能
- 生产制造 (BOM、MRP、工单)
- 质量管理 (IQC、OQC)
- CRM (联系人、跟进)
- 项目管理 (项目、任务、工时)
- OA办公 (请假、报销)

### 缺失功能
- 多组织/多账套
- 多级审批流
- 数据导入/导出
- 文件上传/附件

## 参考文档

- [document.md](document.md) - 详细需求说明
- [solution.md](solution.md) - 技术实现说明
- [docs/REFACTOR_DESIGN.md](docs/REFACTOR_DESIGN.md) - 重构设计说明
- [docs/archive/old-refactor/](docs/archive/old-refactor/) - 第一次重构文档归档

## 许可证

私有项目，禁止外传。