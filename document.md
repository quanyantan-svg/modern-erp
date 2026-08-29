# 功能需求文档 (document.md)

本文档记录项目的功能需求，每次需求变更和迭代时必须修改。

## 版本信息

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2026-08-29 | 初始版本，包含登录、销售订单基础流程 |
| 1.1.0 | 2026-08-29 | 新增供应商资料模块（采购模块基础） |
| 1.2.0 | 2026-08-29 | 新增采购订单模块 |
| 1.3.0 | 2026-08-29 | 新增仓库与库存模块 |

---

## 一、基础资料模块

### 1.1 客户资料 (Customers)
#### 功能说明
客户资料是销售订单的基础，用于维护企业客户档案。

#### 字段定义
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | TEXT | 自动 | UUID主键 |
| code | TEXT | 是 | 客户编码，唯一 |
| name | TEXT | 是 | 客户名称 |
| contact | TEXT | 否 | 联系人 |
| phone | TEXT | 否 | 联系电话 |
| address | TEXT | 否 | 联系地址 |
| active | INTEGER | 否 | 启用状态，1启用，0停用 |
| created_at | TEXT | 自动 | 创建时间 ISO8601 |
| updated_at | TEXT | 自动 | 更新时间 ISO8601 |

#### API接口
- GET /api/customers - 列表查询
- POST /api/customers - 新增客户
- PATCH /api/customers/:id - 更新客户

#### 权限控制
- 查看：CUSTOMERS_VIEW 或 CUSTOMERS_MANAGE
- 管理：CUSTOMERS_MANAGE

---

### 1.2 供应商资料 (Suppliers)
#### 功能说明
供应商资料是采购模块的基础，用于维护企业供应商档案。

#### 字段定义
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | TEXT | 自动 | UUID主键 |
| code | TEXT | 是 | 供应商编码，唯一 |
| name | TEXT | 是 | 供应商名称 |
| contact | TEXT | 否 | 联系人 |
| phone | TEXT | 否 | 联系电话 |
| address | TEXT | 否 | 联系地址 |
| email | TEXT | 否 | 电子邮箱 |
| active | INTEGER | 否 | 启用状态 |
| created_at | TEXT | 自动 | 创建时间 |
| updated_at | TEXT | 自动 | 更新时间 |

#### API接口
- GET /api/suppliers - 列表查询
- POST /api/suppliers - 新增供应商
- PATCH /api/suppliers/:id - 更新供应商

#### 权限控制
- 查看：SUPPLIERS_VIEW 或 SUPPLIERS_MANAGE
- 管理：SUPPLIERS_MANAGE

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
| active | INTEGER | 否 | 启用状态 |
| created_at | TEXT | 自动 | 创建时间 |
| updated_at | TEXT | 自动 | 更新时间 |

---

### 1.4 仓库资料 (Warehouses)
#### 功能说明
仓库资料是库存管理的基础，用于维护企业仓库档案。

#### 字段定义
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | TEXT | 自动 | UUID主键 |
| code | TEXT | 是 | 仓库编码，唯一 |
| name | TEXT | 是 | 仓库名称 |
| address | TEXT | 否 | 仓库地址 |
| manager | TEXT | 否 | 仓库管理员 |
| active | INTEGER | 否 | 启用状态，1启用，0停用 |
| created_at | TEXT | 自动 | 创建时间 |
| updated_at | TEXT | 自动 | 更新时间 |

#### API接口
- GET /api/warehouses - 列表查询
- POST /api/warehouses - 新增仓库
- PATCH /api/warehouses/:id - 更新仓库

#### 权限控制
- 查看：WAREHOUSES_VIEW 或 WAREHOUSES_MANAGE
- 管理：WAREHOUSES_MANAGE

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

---

## 三、采购模块

### 3.1 采购订单 (Purchase Orders)
#### 功能说明
采购订单是向供应商采购货品的业务单据。

#### 状态机
与销售订单相同。

#### 权限控制
- 创建/修改：PURCHASE_ORDERS_CREATE
- 提交：PURCHASE_ORDERS_SUBMIT
- 审核/驳回：PURCHASE_ORDERS_APPROVE
- 查看：PURCHASE_ORDERS_VIEW

---

## 四、库存模块

### 4.1 库存查询 (Inventory)
#### 功能说明
查询各仓库的货品库存情况，支持按仓库和货品筛选。

#### 字段定义
| 字段 | 类型 | 说明 |
|------|------|------|
| warehouse_id | TEXT | 仓库ID |
| product_id | TEXT | 货品ID |
| quantity | REAL | 当前库存数量 |
| updated_at | TEXT | 更新时间 |

#### API接口
- GET /api/inventory - 库存查询，支持 ?warehouse= 和 ?product= 筛选

#### 权限控制
- 查看：INVENTORY_VIEW

---

### 4.2 库存盘点 (Inventory Check)
#### 功能说明
对仓库库存进行盘点，调整实际库存数量。

#### 字段定义
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | UUID主键 |
| warehouse_id | TEXT | 仓库ID |
| product_id | TEXT | 货品ID |
| system_quantity | REAL | 系统库存数量 |
| actual_quantity | REAL | 实际盘点数量 |
| difference | REAL | 差异数量（实际-系统） |
| reason | TEXT | 盘点原因 |
| creator_id | TEXT | 盘点人 |
| created_at | TEXT | 盘点时间 |

#### API接口
- GET /api/inventory-checks - 盘点记录列表
- POST /api/inventory-checks - 新增盘点单
- PATCH /api/inventory-checks/:id - 审核盘点单（确认调整）

#### 权限控制
- 查看：INVENTORY_VIEW
- 创建：INVENTORY_CHECK_CREATE
- 审核：INVENTORY_CHECK_APPROVE

#### 业务规则
- 盘点单需要主管审核后才能调整库存
- 审核通过后，系统库存 = 实际盘点数量

---

### 4.3 库存调拨 (Inventory Transfer)
#### 功能说明
在仓库之间调拨货品。

#### 字段定义
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | UUID主键 |
| transfer_no | TEXT | 调拨单号 |
| from_warehouse_id | TEXT | 源仓库ID |
| to_warehouse_id | TEXT | 目标仓库ID |
| status | TEXT | DRAFT/TRANSFERRED/CANCELLED |
| remark | TEXT | 备注 |
| creator_id | TEXT | 制单人 |
| reviewer_id | TEXT | 审核人 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

#### 调拨明细 (inventory_transfer_items)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | UUID主键 |
| transfer_id | TEXT | 调拨单ID |
| product_id | TEXT | 货品ID |
| quantity | REAL | 调拨数量 |

#### API接口
- GET /api/inventory-transfers - 调拨单列表
- POST /api/inventory-transfers - 新增调拨单
- GET /api/inventory-transfers/:id - 调拨单详情
- POST /api/inventory-transfers/:id/transfer - 确认调拨（审核）
- POST /api/inventory-transfers/:id/cancel - 取消调拨

#### 权限控制
- 查看：INVENTORY_VIEW
- 创建：INVENTORY_TRANSFER_CREATE
- 审核：INVENTORY_TRANSFER_APPROVE

#### 业务规则
- 调拨单需要主管审核
- 审核通过后：源仓库库存减少，目标仓库库存增加
- 只有草稿状态的调拨单可以取消

---

## 五、权限体系

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
| ORDERS_VIEW | 查看销售订单 | 销售订单列表查看 |
| ORDERS_CREATE | 创建销售订单 | 新建/修改销售订单 |
| ORDERS_SUBMIT | 提交销售订单 | 提交销售订单待审核 |
| ORDERS_APPROVE | 审核销售订单 | 审核/驳回销售订单 |
| PURCHASE_ORDERS_VIEW | 查看采购订单 | 采购订单列表查看 |
| PURCHASE_ORDERS_CREATE | 创建采购订单 | 新建/修改采购订单 |
| PURCHASE_ORDERS_SUBMIT | 提交采购订单 | 提交采购订单待审核 |
| PURCHASE_ORDERS_APPROVE | 审核采购订单 | 审核/驳回采购订单 |
| WAREHOUSES_VIEW | 查看仓库 | 仓库列表查看 |
| WAREHOUSES_MANAGE | 管理仓库 | 仓库增删改 |
| INVENTORY_VIEW | 查看库存 | 库存查询 |
| INVENTORY_CHECK_CREATE | 创建盘点单 | 新增盘点单 |
| INVENTORY_CHECK_APPROVE | 审核盘点单 | 审核盘点单 |
| INVENTORY_TRANSFER_CREATE | 创建调拨单 | 新增调拨单 |
| INVENTORY_TRANSFER_APPROVE | 审核调拨单 | 审核调拨单 |

### 角色权限分配
| 角色 | 权限 |
|------|------|
| 系统管理员 | 全部权限 |
| 仓库管理员 | WAREHOUSES_VIEW, WAREHOUSES_MANAGE, INVENTORY_VIEW, INVENTORY_CHECK_CREATE, INVENTORY_TRANSFER_CREATE |
| 销售专员 | DASHBOARD_VIEW, CUSTOMERS_VIEW, CUSTOMERS_MANAGE, PRODUCTS_VIEW, ORDERS_VIEW, ORDERS_CREATE, ORDERS_SUBMIT, SUPPLIERS_VIEW, SUPPLIERS_MANAGE, PURCHASE_ORDERS_VIEW, PURCHASE_ORDERS_CREATE, PURCHASE_ORDERS_SUBMIT |
| 销售主管 | DASHBOARD_VIEW, CUSTOMERS_VIEW, PRODUCTS_VIEW, ORDERS_VIEW, ORDERS_APPROVE, PURCHASE_ORDERS_VIEW, PURCHASE_ORDERS_APPROVE |

---

## 六、变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-08-29 | 1.0.0 | 初始版本 |
| 2026-08-29 | 1.1.0 | 新增供应商资料模块 |
| 2026-08-29 | 1.2.0 | 新增采购订单模块 |
| 2026-08-29 | 1.3.0 | 新增仓库与库存模块 |
