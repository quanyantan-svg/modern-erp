# Modern ERP - 第二次重构项目

## 项目概述
本项目是基于方天云端ERP B9V27的业务原型，目标是在Ubuntu 22.04 + MySQL 8.0环境下实现生产级部署。

## 技术栈
- 前端：React 19 + Vite 7
- 后端：Node.js 22+ (原生HTTP API)
- 数据库：MySQL 8.0
- 前端托管：Nginx
- 进程管理：PM2

## 目录结构
\\\
modern-erp/
├── src/              # React前端源码
├── server/           # Node.js后端
│   ├── app.js        # 核心API (待拆分)
│   ├── db.js         # 数据库层
│   └── modules/       # 业务模块
├── docs/             # 项目文档
├── deploy/           # 部署配置
└── scripts/          # 工具脚本
\\\

## 开发规范

### 1. 代码组织
- 后端路由按业务域拆分到 server/routes/
- 前端按 src/pages/ 下的域组织
- 公共组件放在 src/components/

### 2. 数据库
- 统一使用MySQL，不再使用SQLite
- 所有表结构变更通过迁移脚本管理
- 金额使用整数(分)存储

### 3. API设计
- RESTful风格
- Bearer Token认证
- 所有输入由后端验证
- 关键操作写入审计日志

### 4. 环境配置
- 所有配置通过环境变量管理
- 参考 .env.example 创建 .env
- 禁止硬编码连接信息

### 5. Git提交
- 提交前运行 pnpm build && pnpm test
- 使用语义化提交信息
- 不提交：node_modules/, dist/, data/, *.db, .env

## 常用命令
| 命令 | 用途 |
|------|------|
| pnpm install | 安装依赖 |
| pnpm dev | 开发模式 |
| pnpm build | 构建前端 |
| pnpm start | 生产启动 |
| pnpm test | 运行测试 |
| pnpm db:migrate | 数据库迁移 |

## 参考文档
- docs/00-system-audit.md - 系统审计报告
- docs/01-requirements.md - 需求规格
- docs/04-refactor-plan.md - 重构计划
- docs/06-deployment.md - 部署指南

## 联系方式
项目负责人：[待定]
