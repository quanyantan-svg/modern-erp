# 实现方法文档 (solution.md)

本文档记录功能实现方法，包括代码中各函数的含义及它们之间的关系。每次新增代码时必须修改。

---

## 一、后端实现

### 1.1 数据库层 (db.js)

#### 表结构

**warehouses 表**
```sql
CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  manager TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**inventory 表（实时库存）**
```sql
CREATE TABLE IF NOT EXISTS inventory (
  warehouse_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (warehouse_id, product_id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
```

**inventory_checks 表（盘点单）**
```sql
CREATE TABLE IF NOT EXISTS inventory_checks (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  system_quantity REAL NOT NULL,
  actual_quantity REAL NOT NULL,
  difference REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  creator_id TEXT NOT NULL,
  reviewer_id TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (creator_id) REFERENCES users(id),
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
);
```

**inventory_transfers 表（调拨单）**
```sql
CREATE TABLE IF NOT EXISTS inventory_transfers (
  id TEXT PRIMARY KEY,
  transfer_no TEXT NOT NULL UNIQUE,
  from_warehouse_id TEXT NOT NULL,
  to_warehouse_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','TRANSFERRED','CANCELLED')),
  remark TEXT NOT NULL DEFAULT '',
  creator_id TEXT NOT NULL,
  reviewer_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id),
  FOREIGN KEY (creator_id) REFERENCES users(id),
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
);
```

**inventory_transfer_items 表（调拨明细）**
```sql
CREATE TABLE IF NOT EXISTS inventory_transfer_items (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  FOREIGN KEY (transfer_id) REFERENCES inventory_transfers(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);
```

---

### 1.2 API路由层 (app.js)

#### 仓库相关路由

| 方法 | 路径 | 处理函数 | 权限 | 说明 |
|------|------|----------|------|------|
| GET | /api/warehouses | listWarehouses | WAREHOUSES_VIEW/MANAGE | 列表查询 |
| POST | /api/warehouses | createWarehouse | WAREHOUSES_MANAGE | 新增 |
| PATCH | /api/warehouses/:id | updateWarehouse | WAREHOUSES_MANAGE | 更新 |

#### 库存相关路由

| 方法 | 路径 | 处理函数 | 权限 | 说明 |
|------|------|----------|------|------|
| GET | /api/inventory | listInventory | INVENTORY_VIEW | 库存查询 |
| GET | /api/inventory-checks | listInventoryChecks | INVENTORY_VIEW | 盘点记录 |
| POST | /api/inventory-checks | createInventoryCheck | INVENTORY_CHECK_CREATE | 新增盘点单 |
| PATCH | /api/inventory-checks/:id | approveInventoryCheck | INVENTORY_CHECK_APPROVE | 审核盘点单 |
| GET | /api/inventory-transfers | listInventoryTransfers | INVENTORY_VIEW | 调拨单列表 |
| POST | /api/inventory-transfers | createInventoryTransfer | INVENTORY_TRANSFER_CREATE | 新增调拨单 |
| GET | /api/inventory-transfers/:id | getInventoryTransfer | INVENTORY_VIEW | 调拨单详情 |
| POST | /api/inventory-transfers/:id/transfer | transferInventory | INVENTORY_TRANSFER_APPROVE | 确认调拨 |
| POST | /api/inventory-transfers/:id/cancel | cancelInventoryTransfer | INVENTORY_TRANSFER_APPROVE | 取消调拨 |

#### 核心函数解析

**listInventory(db, res, actor, url)**
- 功能：查询库存，支持按仓库和货品筛选
- 参数：db数据库连接，res响应对象，actor当前用户，url请求URL
- 返回：库存列表（包含仓库名称、货品名称）
- SQL：JOIN warehouses 和 products 表

**createInventoryCheck(db, req, res, actor)**
- 功能：创建盘点单
- 验证：仓库和货品必须存在且启用
- 计算：difference = actual_quantity - system_quantity
- 状态：PENDING，等待审核

**approveInventoryCheck(db, req, res, actor, checkId)**
- 功能：审核盘点单
- 操作：更新库存数量为实际盘点数量
- 状态：APPROVED

**createInventoryTransfer(db, req, res, actor)**
- 功能：创建调拨单
- 验证：源仓库和目标仓库不能相同
- 验证：每个货品在源仓库有足够库存

**transferInventory(db, req, res, actor, transferId)**
- 功能：确认调拨
- 操作：
  1. 源仓库库存减少
  2. 目标仓库库存增加
- 状态：TRANSFERRED

---

### 1.3 认证与会话

（同上版本）

---

## 二、前端实现

### 2.1 组件结构 (App.jsx)

#### Warehouses 组件
- 仓库列表页面
- 新增/编辑仓库

#### Inventory 组件
- 库存查询页面
- 支持按仓库和货品筛选

#### InventoryChecks 组件
- 盘点记录列表
- 新建盘点单
- 审核盘点单

#### InventoryTransfers 组件
- 调拨单列表
- 新建调拨单
- 确认调拨/取消调拨

### 2.2 权限检查

导航项：
- key=warehouses, label=仓库资料, icon=⬚, any=[WAREHOUSES_VIEW, WAREHOUSES_MANAGE]
- key=inventory, label=库存管理, icon=⬢, any=[INVENTORY_VIEW, INVENTORY_CHECK_CREATE, INVENTORY_TRANSFER_CREATE]

---

## 三、数据流向

### 库存盘点流程

创建盘点单 -> 填写实际数量 -> 保存PENDING ->
审核通过 -> 更新inventory表 -> 状态改为APPROVED

### 库存调拨流程

创建调拨单 -> 添加明细（货品、数量）-> 保存DRAFT ->
审核通过 -> 源仓库减少库存 -> 目标仓库增加库存 -> 状态改为TRANSFERRED

---

## 四、函数关系图

```
请求进入 -> handleApi() 路由分发 -> authenticate() 认证 ->
  - listInventory() -> inventoryRows()
  - createInventoryCheck() -> inventoryCheckInput() -> audit()
  - approveInventoryCheck() -> updateInventory()
  - createInventoryTransfer() -> transferInput() -> audit()
  - transferInventory() -> updateInventory()
```

---

## 五、安全考量

1. 权限校验：每个API都有权限验证
2. 数据验证：仓库、货品必须存在且启用
3. 库存检查：调拨时验证源仓库库存充足
4. 事务处理：盘点审核、调拨确认使用事务

---

## 六、变更记录

| 日期 | 变更内容 |
|------|----------|
| 2026-08-29 | 新增供应商资料模块完整实现 |
| 2026-08-29 | 补充采购订单关联设计文档 |
| 2026-08-29 | 新增采购订单模块完整实现 |
| 2026-08-29 | 新增仓库与库存模块完整实现 |
