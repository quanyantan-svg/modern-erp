# 目标架构

## 1. 架构概览

### 1.1 部署架构
\\\
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                              │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS (443)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Nginx (反向代理)                         │
│  - SSL终止                                                 │
│  - 静态资源 /dist/                                          │
│  - API代理到后端                                            │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP (localhost:3001)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Node.js (PM2进程管理)                       │
│  - Express/Koa框架                                          │
│  - REST API                                                │
│  - Bearer Token认证                                         │
│  - RBAC权限校验                                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     MySQL 8.0 (数据库)                        │
│  - 连接池                                                   │
│  - 事务支持                                                 │
└─────────────────────────────────────────────────────────────┘
\\\

### 1.2 技术选型
| 组件 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 前端框架 | React | 19.x | UI框架 |
| 构建工具 | Vite | 7.x | 打包构建 |
| 后端框架 | Express | 4.x | API框架 |
| 数据库 | MySQL | 8.0 | 主数据库 |
| 进程管理 | PM2 | - | 进程守护 |
| 反向代理 | Nginx | - | HTTPS/静态 |
| 缓存 | Redis | 7.x | 会话缓存(可选) |

---

## 2. 项目结构

### 2.1 目录结构
\\\
modern-erp/
├── src/                      # React前端源码
│   ├── api.js               # API请求封装
│   ├── App.jsx              # 应用入口
│   ├── components/          # 公共组件
│   │   └── ui.jsx          # UI组件库
│   └── pages/               # 业务页面
│       ├── master-data.jsx
│       ├── accounting.jsx
│       └── ...
├── server/                   # Node.js后端
│   ├── index.js             # 入口文件
│   ├── app.js               # Express应用
│   ├── db.js                # 数据库连接
│   ├── routes/              # 路由模块 (重构后)
│   │   ├── auth.js
│   │   ├── orders.js
│   │   └── ...
│   ├── modules/             # 业务逻辑
│   │   ├── business.js
│   │   └── extended.js
│   ├── middleware/          # 中间件
│   │   ├── auth.js
│   │   ├── error.js
│   │   └── validate.js
│   └── migrations/          # 数据库迁移
├── deploy/                   # 部署配置
│   ├── nginx.conf          # Nginx配置
│   ├── systemd.service      # Systemd服务
│   └── backup.sh            # 备份脚本
├── scripts/                  # 工具脚本
│   ├── migrate.js          # 数据库迁移
│   └── seed.js             # 种子数据
├── docs/                     # 项目文档
├── .env.example             # 环境变量模板
├── ecosystem.config.js      # PM2配置
└── package.json
\\\

### 2.2 前端结构
- **src/api.js**: Token管理、统一请求封装
- **src/App.jsx**: 路由、导航、权限菜单
- **src/components/ui.jsx**: 公共组件 (表格、弹窗、表单)
- **src/pages/**: 按业务域拆分的页面组件

### 2.3 后端结构 (重构后)
- **server/routes/**: 按资源拆分的路由
- **server/modules/**: 业务逻辑处理
- **server/middleware/**: 中间件 (认证、校验、错误处理)
- **server/migrations/**: 数据库迁移脚本

---

## 3. 数据库设计

### 3.1 目标数据库
- **引擎**: MySQL 8.0
- **字符集**: utf8mb4
- **排序规则**: utf8mb4_unicode_ci

### 3.2 核心表结构

#### 用户与权限
\\\sql
users (id, username, password_hash, password_salt, role_id, active, created_at)
roles (id, name, description, permissions)
sessions (id, user_id, token_hash, expires_at, created_at)
audit_logs (id, user_id, action, entity_type, entity_id, detail, ip, created_at)
\\\

#### 基础资料
\\\sql
customers (id, code, name, contact, phone, address, credit_limit, active, created_at)
suppliers (id, code, name, contact, phone, address, active, created_at)
products (id, code, name, category, unit, price_cents, cost_cents, stock_quantity, active, created_at)
warehouses (id, code, name, address, manager, active, created_at)
\\\

#### 业务单据
\\\sql
sales_orders (id, order_no, customer_id, status, total_cents, creator_id, submitted_at, created_at)
sales_order_items (id, order_id, product_id, quantity, unit_price_cents, amount_cents)
purchase_orders (id, order_no, supplier_id, status, total_cents, creator_id, created_at)
inventory (warehouse_id, product_id, quantity, updated_at)
inventory_transactions (id, warehouse_id, product_id, quantity, direction, source_type, source_id, created_at)
\\\

#### 财务
\\\sql
accounting_subjects (id, code, name, type, direction, parent_id, active)
accounting_vouchers (id, voucher_no, voucher_date, period, source_type, source_id, status, creator_id, created_at)
accounting_entries (id, voucher_id, subject_id, direction, amount_cents, summary, department_id, project_id)
account_receivables (id, customer_id, source_type, source_id, amount_cents, paid_cents, status, due_date)
account_payables (id, supplier_id, source_type, source_id, amount_cents, paid_cents, status, due_date)
\\\

### 3.3 命名规范
- 表名: 复数名词，下划线分隔 (如: sales_orders)
- 列名: 下划线分隔 (如: order_no)
- 主键: id (UUID)
- 外键: {table}_id (如: customer_id)
- 时间戳: {action}_at (如: created_at)
- 金额: {name}_cents (如: 	otal_cents)

---

## 4. API设计

### 4.1 RESTful规范
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/users | 列表 |
| GET | /api/users/:id | 详情 |
| POST | /api/users | 创建 |
| PATCH | /api/users/:id | 更新 |
| DELETE | /api/users/:id | 删除 |

### 4.2 认证
- Bearer Token在请求头中传递
- Token有效期: 12小时
- 刷新机制: 登录后获取新Token

### 4.3 响应格式
\\\json
// 成功
{ "ok": true, "data": {...} }

// 列表
{ "items": [...], "total": 100, "page": 1, "pageSize": 20 }

// 错误
{ "error": "错误信息", "code": "ERROR_CODE" }
\\\

### 4.4 主要API端点
- **认证**: /api/auth/login, /api/auth/logout, /api/auth/me
- **用户**: /api/users
- **基础资料**: /api/customers, /api/suppliers, /api/products, /api/warehouses
- **销售**: /api/orders
- **采购**: /api/purchase-orders
- **库存**: /api/inventory, /api/inventory-transfers
- **财务**: /api/accounting-vouchers, /api/cash-journals
- **报表**: /api/reports/financial-summary

---

## 5. 安全设计

### 5.1 认证与授权
- 密码: scrypt哈希 (64字节, 随机盐)
- 会话: Bearer Token (SHA-256哈希存储)
- 权限: RBAC (基于角色)
- API限流: 100次/分钟

### 5.2 输入验证
- 所有输入后端验证
- SQL参数化查询
- XSS过滤
- 请求大小限制 (1MB)

### 5.3 响应安全
- 安全响应头 (CSP, X-Frame-Options等)
- 错误信息不泄露敏感数据

---

## 6. 环境配置

### 6.1 环境变量
\\\ash
# 应用
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

# 数据库
DB_HOST=localhost
DB_PORT=3306
DB_NAME=erp
DB_USER=erp_user
DB_PASSWORD=xxx

# 安全
JWT_SECRET=xxx

# Redis (可选)
REDIS_URL=redis://localhost:6379
\\\

### 6.2 多环境支持
- .env - 生产环境 (不提交Git)
- .env.example - 环境变量模板
- .env.development - 开发环境

---

## 7. 部署架构

### 7.1 Nginx配置
- HTTPS (443) -> HTTP (80重定向)
- /api/* -> 后端Node.js
- /* -> 静态资源

### 7.2 PM2配置
- 实例数: 1 (单核) / 2+ (多核)
- 内存限制: 512MB
- 重启策略: 崩溃后自动重启

### 7.3 备份策略
- 每日数据库全量备份
- 备份保留: 7天
- 备份存储: 本地 + 远程

---

## 参考文档
- \docs/00-system-audit.md\ - 系统审计报告
- \docs/01-requirements.md\ - 需求规格
- \docs/05-database.md\ - 数据库设计
- \docs/06-deployment.md\ - 部署指南