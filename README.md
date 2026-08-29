# 启明 ERP：基础资料与销售订单最小重构版

这是从方天云端 ERP B9V27 中提炼出的独立练习项目，覆盖：

```
登录 → 用户/角色 → 客户/供应商 → 货品 → 销售订单 → 提交 → 审核/驳回 → 查看与追踪
```

它不会连接或修改原 ERP 数据库。第一次启动会自动创建本地 `data/erp.db`，并写入演示账号和基础资料。

## 技术栈

- 前端：React 19、Vite 7、原生 CSS
- 后端：Node.js 原生 HTTP API
- 数据库：Node.js 内置 SQLite
- 认证：随机 Bearer Token；数据库只保存 Token 哈希
- 密码：scrypt 加盐哈希
- 测试：Node.js 内置测试框架

需要 Node.js 22.13 或更高版本，推荐 Node.js 24。

## 快速运行

```powershell
corepack enable
pnpm install
pnpm build
pnpm start
```

打开 http://127.0.0.1:3001

## 演示账号

| 账号 | 密码 | 角色 | 用途 |
|------|------|------|------|
| sales | sales123 | 销售专员 | 维护客户、创建并提交订单 |
| reviewer | review123 | 销售主管 | 审核或驳回待审核订单 |
| admin | admin123 | 系统管理员 | 管理用户、角色和全部基础资料 |

## 目录结构

```
modern-erp/
├─ server/             后端 API、数据库结构和种子数据
│   ├─ index.js        服务入口，HTTP服务器创建
│   ├─ app.js          API路由、权限校验、业务规则
│   ├─ db.js           SQLite表结构、种子数据、工具函数
│   └─ reset-data.js   数据重置脚本
├─ src/                React前端
│   ├─ main.jsx        应用入口
│   ├─ App.jsx         主应用组件，包含所有业务页面
│   ├─ api.js          API调用封装
│   └─ styles.css      全局样式
├─ test/               端到端业务接口测试
├─ data/               运行时自动生成的SQLite数据库
├─ dist/               构建后的前端
├─ docs/               详细设计文档
├─ log/                开发日志，按天存放
├─ scripts/            开发启动脚本
└─ start-local.ps1     Windows本地启动脚本
```

## 模块清单

| 模块 | 页面 | API | 说明 |
|------|------|-----|------|
| 登录 | Login | /api/auth/* | 演示账号切换、认证 |
| 工作台 | Dashboard | /api/dashboard | 业务概览统计 |
| 客户资料 | Customers | /api/customers | 客户增删改查 |
| 供应商资料 | Suppliers | /api/suppliers | 供应商增删改查 |
| 货品资料 | Products | /api/products | 货品增删改查 |
| 销售订单 | Orders | /api/orders | 创建/编辑/提交 |
| 订单审核 | Approvals | /api/orders/*/approve/reject | 审批/驳回 |
| 采购订单 | PurchaseOrders | /api/purchase-orders | 采购订单管理 |
| 用户与角色 | UsersRoles | /api/users, /api/roles | 权限管理 |

## 练习版边界

当前版本故意不包含销售出货、库存扣减、应收账款、复杂多级审批、多组织、多币种和原数据库迁移。

---

## 重构记录

本项目从旧版 ERP 系统逐步重构而来，每次重构的功能模块会及时更新至此文档。

| 日期 | 模块 | 说明 |
|------|------|------|
| 2026-08-29 | 供应商资料 | 新增 suppliers 表、API路由、前端组件 |
| 2026-08-29 | 采购订单 | 新增 purchase_orders 表、API路由、前端组件 |
