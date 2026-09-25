# 数据库设计

## 1. 数据库配置

### 1.1 连接参数
- host: process.env.DB_HOST || localhost
- port: process.env.DB_PORT || 3306
- database: process.env.DB_NAME || erp
- user: process.env.DB_USER
- password: process.env.DB_PASSWORD
- connectionLimit: 10

### 1.2 环境变量
- DB_HOST=localhost
- DB_PORT=3306
- DB_NAME=erp
- DB_USER=erp_user
- DB_PASSWORD=xxx

---

## 2. 核心表结构

### 2.1 用户与权限

#### users (用户表)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| username | VARCHAR(50) | 登录账号 |
| password_hash | VARCHAR(128) | scrypt哈希 |
| password_salt | VARCHAR(32) | 随机盐 |
| display_name | VARCHAR(100) | 显示名称 |
| role_id | VARCHAR(36) | 关联角色 |
| active | TINYINT(1) | 是否启用 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

#### roles (角色表)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| name | VARCHAR(50) | 角色名称 |
| description | VARCHAR(255) | 描述 |
| permissions | JSON | 权限数组 |

#### sessions (会话表)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| user_id | VARCHAR(36) | 关联用户 |
| token_hash | VARCHAR(64) | SHA-256哈希 |
| expires_at | DATETIME | 过期时间 |

#### audit_logs (审计日志)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| user_id | VARCHAR(36) | 操作用户 |
| action | VARCHAR(50) | 操作类型 |
| entity_type | VARCHAR(50) | 实体类型 |
| entity_id | VARCHAR(36) | 实体ID |
| detail | TEXT | 详情 |
| ip_address | VARCHAR(45) | IP地址 |
| created_at | DATETIME | 操作时间 |

---

### 2.2 基础资料

#### customers (客户表)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| code | VARCHAR(50) | 客户编码 |
| name | VARCHAR(200) | 客户名称 |
| contact | VARCHAR(100) | 联系人 |
| phone | VARCHAR(50) | 电话 |
| address | VARCHAR(500) | 地址 |
| credit_limit | DECIMAL(15,2) | 信用额度 |
| active | TINYINT(1) | 是否启用 |

#### suppliers (供应商表)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| code | VARCHAR(50) | 供应商编码 |
| name | VARCHAR(200) | 供应商名称 |
| contact | VARCHAR(100) | 联系人 |
| phone | VARCHAR(50) | 电话 |
| active | TINYINT(1) | 是否启用 |

#### products (货品表)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| code | VARCHAR(50) | 货品编码 |
| name | VARCHAR(200) | 货品名称 |
| category | VARCHAR(100) | 分类 |
| unit | VARCHAR(20) | 单位 |
| price_cents | INT | 售价(分) |
| cost_cents | INT | 成本(分) |
| stock_quantity | DECIMAL(15,3) | 库存数量 |
| active | TINYINT(1) | 是否启用 |

#### warehouses (仓库表)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| code | VARCHAR(50) | 仓库编码 |
| name | VARCHAR(100) | 仓库名称 |
| manager | VARCHAR(100) | 负责人 |
| active | TINYINT(1) | 是否启用 |

---

### 2.3 业务单据

#### sales_orders (销售订单)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| order_no | VARCHAR(50) | 订单编号 |
| customer_id | VARCHAR(36) | 关联客户 |
| status | ENUM | DRAFT/SUBMITTED/APPROVED/REJECTED |
| total_cents | INT | 订单总额(分) |
| creator_id | VARCHAR(36) | 制单人 |
| submitted_at | DATETIME | 提交时间 |
| approved_at | DATETIME | 审核时间 |
| created_at | DATETIME | 创建时间 |

#### sales_order_items (销售订单明细)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| order_id | VARCHAR(36) | 关联订单 |
| product_id | VARCHAR(36) | 关联货品 |
| quantity | DECIMAL(15,3) | 数量 |
| unit_price_cents | INT | 单价(分) |
| amount_cents | INT | 金额(分) |
| line_no | INT | 行号 |

#### purchase_orders (采购订单)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| order_no | VARCHAR(50) | 订单编号 |
| supplier_id | VARCHAR(36) | 关联供应商 |
| status | ENUM | DRAFT/SUBMITTED/APPROVED/REJECTED |
| total_cents | INT | 订单总额(分) |

---

### 2.4 库存

#### inventory (库存表)
| 字段 | 类型 | 说明 |
|------|------|------|
| warehouse_id | VARCHAR(36) | 仓库ID (复合主键) |
| product_id | VARCHAR(36) | 货品ID (复合主键) |
| quantity | DECIMAL(15,3) | 库存数量 |
| updated_at | DATETIME | 更新时间 |

#### inventory_transactions (库存流水)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| warehouse_id | VARCHAR(36) | 仓库ID |
| product_id | VARCHAR(36) | 货品ID |
| quantity | DECIMAL(15,3) | 变动数量 |
| direction | ENUM | IN/OUT |
| source_type | VARCHAR(50) | 来源类型 |
| source_id | VARCHAR(36) | 来源ID |
| created_at | DATETIME | 操作时间 |

---

### 2.5 财务

#### accounting_subjects (会计科目)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| code | VARCHAR(50) | 科目编码 |
| name | VARCHAR(200) | 科目名称 |
| type | ENUM | ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE |
| direction | ENUM | DEBIT/CREDIT |
| parent_id | VARCHAR(36) | 上级科目 |
| active | TINYINT(1) | 是否启用 |

#### accounting_vouchers (会计凭证)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| voucher_no | VARCHAR(50) | 凭证号 |
| voucher_date | DATE | 凭证日期 |
| period | VARCHAR(7) | 会计期间 (YYYY-MM) |
| source_type | VARCHAR(50) | 来源类型 |
| source_id | VARCHAR(36) | 来源ID |
| status | ENUM | DRAFT/POSTED |
| creator_id | VARCHAR(36) | 制单人 |

#### accounting_entries (会计分录)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36) | UUID主键 |
| voucher_id | VARCHAR(36) | 关联凭证 |
| subject_id | VARCHAR(36) | 关联科目 |
| direction | ENUM | DEBIT/CREDIT |
| amount_cents | INT | 金额(分) |
| summary | VARCHAR(500) | 摘要 |
| department_id | VARCHAR(36) | 部门ID |
| project_id | VARCHAR(36) | 项目ID |

---

## 3. 索引设计

### 3.1 外键索引
| 表 | 字段 | 索引类型 |
|------|------|----------|
| sales_orders | customer_id | B-Tree |
| sales_order_items | order_id | B-Tree |
| sales_order_items | product_id | B-Tree |
| inventory | warehouse_id, product_id | 复合唯一 |
| inventory_transactions | warehouse_id | B-Tree |
| inventory_transactions | source_type, source_id | 复合 |

### 3.2 查询索引
| 表 | 字段 | 用途 |
|------|------|------|
| customers | code, name | 编码/名称查询 |
| suppliers | code | 编码查询 |
| products | code, category | 编码/分类查询 |
| accounting_vouchers | period | 期间查询 |
| audit_logs | user_id, created_at | 日志查询 |

---

## 4. 命名规范

### 4.1 表命名
- 使用复数名词
- 小写字母 + 下划线
- 示例: sales_orders, account_receivables

### 4.2 列命名
- 小写字母 + 下划线
- 示例: order_no, created_at

### 4.3 金额字段
- 使用 {name}_cents 后缀
- 示例: total_cents, amount_cents

### 4.4 时间字段
- 创建时间: {action}_at
- 示例: created_at, updated_at, submitted_at

---

## 5. 数据类型规范

### 5.1 主键
- 类型: VARCHAR(36)
- 格式: UUID

### 5.2 金额
- 类型: INT (存储分)
- 示例: 2599.00元 -> 259900

### 5.3 日期时间
- 日期: DATE
- 时间: DATETIME

### 5.4 布尔值
- 类型: TINYINT(1)
- 值: 0 (否) / 1 (是)

---

## 6. 参考文档
- docs/archive/audits/architecture-legacy.md - 历史目标架构
- docs/archive/audits/refactor-plan.md - 历史重构计划
