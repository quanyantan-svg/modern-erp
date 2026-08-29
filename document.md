# 功能需求文档 (document.md)

本文档记录项目的功能需求，每次需求变更和迭代时必须修改。

## 版本信息

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2026-08-29 | 初始版本，包含登录、销售订单基础流程 |
| 1.1.0 | 2026-08-29 | 新增供应商资料模块（采购模块基础） |

---

## 一、基础资料模块

### 1.1 客户资料 (Customers)

#### 功能说明
客户资料是销售订单的基础，用于维护企业客户档案。

#### 字段定义
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | TEXT | 自动 | UUID主键 |
| code | TEXT | 是 | 客户编码，唯一，不区分大小写 |
| name | TEXT | 是 | 客户名称 |
| contact | TEXT | 否 | 联系人 |
| phone | TEXT | 否 | 联系电话 |
| address | TEXT | 否 | 联系地址 |
| active | INTEGER | 否 | 启用状态，1启用，0停用 |
| created_at | TEXT | 自动 | 创建时间 ISO8601 |
| updated_at | TEXT | 自动 | 更新时间 ISO8601 |

#### API接口
- GET /api/customers - 列表查询，支持 ?search= 模糊搜索
- POST /api/customers - 新增客户
- PATCH /api/customers/:id - 更新客户

#### 权限控制
- 查看：CUSTOMERS_VIEW 或 CUSTOMERS_MANAGE
- 管理：CUSTOMERS_MANAGE

#### 业务规则
- 编码唯一，不能与已有编码重复
- 停用客户不能在销售订单中引用

---

### 1.2 供应商资料 (Suppliers)

#### 功能说明
供应商资料是采购模块的基础，用于维护企业供应商档案，与客户资料平行设计。

#### 字段定义
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | TEXT | 自动 | UUID主键 |
| code | TEXT | 是 | 供应商编码，唯一，不区分大小写 |
| name | TEXT | 是 | 供应商名称 |
| contact | TEXT | 否 | 联系人 |
| phone | TEXT | 否 | 联系电话 |
| address | TEXT | 否 | 联系地址 |
| email | TEXT | 否 | 电子邮箱 |
| active | INTEGER | 否 | 启用状态，1启用，0停用 |
| created_at | TEXT | 自动 | 创建时间 ISO8601 |
| updated_at | TEXT | 自动 | 更新时间 ISO8601 |

#### API接口
- GET /api/suppliers - 列表查询，支持 ?search= 模糊搜索
- POST /api/suppliers - 新增供应商
- PATCH /api/suppliers/:id - 更新供应商

#### 权限控制
- 查看：SUPPLIERS_VIEW 或 SUPPLIERS_MANAGE
- 管理：SUPPLIERS_MANAGE

#### 业务规则
- 编码唯一，不能与已有编码重复
- 停用供应商不能在采购订单中引用

---

### 1.3 货品资料 (Products)

#### 功能说明
货品资料是销售订单和采购订单的核心，定义企业销售的商品或采购的物料。

#### 字段定义
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | TEXT | 自动 | UUID主键 |
| code | TEXT | 是 | 货品编码，唯一 |
| name | TEXT | 是 | 货品名称 |
| unit | TEXT | 是 | 计量单位 |
| price_cents | INTEGER | 是 | 参考售价（分） |
| stock_quantity | REAL | 否 | 演示库存数量 |
| active | INTEGER | 否 | 启用状态 |
| created_at | TEXT | 自动 | 创建时间 |
| updated_at | TEXT | 自动 | 更新时间 |

#### 权限控制
- 查看：PRODUCTS_VIEW 或 PRODUCTS_MANAGE
- 管理：PRODUCTS_MANAGE

---

## 二、销售模块

### 2.1 销售订单 (Sales Orders)

#### 功能说明
销售订单是客户需求的载体，经过制单、提交、审核三个阶段。

#### 状态机
```
DRAFT（草稿） → SUBMITTED（待审核） → APPROVED（已审核）
                    ↑
                    ↓
              REJECTED（已驳回） → DRAFT（草稿）
```

#### 权限控制
- 创建/修改：ORDERS_CREATE
- 提交：ORDERS_SUBMIT
- 审核/驳回：ORDERS_APPROVE
- 查看：ORDERS_VIEW

#### 业务规则
- 订单至少包含一条明细
- 金额以后端重新计算为准
- 只有草稿或已驳回订单可以修改
- 制单人不能审核自己的订单

---

## 三、权限体系

### 权限清单
| 权限码 | 名称 | 说明 |
|--------|------|------|
| DASHBOARD_VIEW | 查看工作台 | 工作台统计数字 |
| USERS_MANAGE | 管理用户 | 创建/编辑/停用用户 |
| ROLES_MANAGE | 管理角色 | 创建/编辑角色权限 |
| CUSTOMERS_VIEW | 查看客户 | 客户列表查看 |
| CUSTOMERS_MANAGE | 管理客户 | 客户增删改 |
| SUPPLIERS_VIEW | 查看供应商 | 供应商列表查看 |
| SUPPLIERS_MANAGE | 管理供应商 | 供应商增删改 |
| PRODUCTS_VIEW | 查看货品 | 货品列表查看 |
| PRODUCTS_MANAGE | 管理货品 | 货品增删改 |
| ORDERS_VIEW | 查看订单 | 订单列表查看 |
| ORDERS_CREATE | 创建订单 | 新建/修改订单 |
| ORDERS_SUBMIT | 提交订单 | 提交订单待审核 |
| ORDERS_APPROVE | 审核订单 | 审核/驳回订单 |

### 角色权限分配
| 角色 | 权限 |
|------|------|
| 系统管理员 | 全部权限 |
| 销售专员 | DASHBOARD_VIEW, CUSTOMERS_VIEW, CUSTOMERS_MANAGE, PRODUCTS_VIEW, ORDERS_VIEW, ORDERS_CREATE, ORDERS_SUBMIT, SUPPLIERS_VIEW, SUPPLIERS_MANAGE |
| 销售主管 | DASHBOARD_VIEW, CUSTOMERS_VIEW, PRODUCTS_VIEW, ORDERS_VIEW, ORDERS_APPROVE |

---

## 四、采购模块（下一迭代）

### 4.1 采购订单 (Purchase Orders)

#### 功能说明
采购订单是供应商供货需求的载体，与销售订单平行设计。

#### 字段设计（待实现）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | UUID主键 |
| order_no | TEXT | 采购订单号 |
| supplier_id | TEXT | 供应商ID，外键 |
| status | TEXT | DRAFT/SUBMITTED/APPROVED/REJECTED |
| total_cents | INTEGER | 订单总额（分） |
| remark | TEXT | 备注 |
| creator_id | TEXT | 制单人ID |
| reviewer_id | TEXT | 审核人ID |
| submitted_at | TEXT | 提交时间 |
| reviewed_at | TEXT | 审核时间 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

#### 关联关系
- 供应商（suppliers）：每个采购订单必须关联一个供应商
- 货品（products）：采购订单明细引用货品表

---

## 五、变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-08-29 | 1.0.0 | 初始版本 |
| 2026-08-29 | 1.1.0 | 新增供应商资料模块 |
