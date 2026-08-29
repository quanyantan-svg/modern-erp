# 实现方法文档 (solution.md)

本文档记录功能实现方法，包括代码中各函数的含义及它们之间的关系。每次新增代码时必须修改。

---

## 一、后端实现

### 1.1 数据库层 (db.js)

#### 表结构

**purchase_orders 表**
```sql
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  total_cents INTEGER NOT NULL DEFAULT 0,
  remark TEXT NOT NULL DEFAULT '',
  rejection_reason TEXT NOT NULL DEFAULT '',
  creator_id TEXT NOT NULL,
  reviewer_id TEXT,
  submitted_at TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (creator_id) REFERENCES users(id),
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
);
```

**purchase_order_items 表**
```sql
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
  line_no INTEGER NOT NULL,
  FOREIGN KEY (order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  UNIQUE(order_id, line_no)
);
```

#### 核心函数

| 函数名 | 参数 | 返回值 | 说明 |
|--------|------|--------|------|
| hashPassword(password, salt?) | 密码字符串，可选盐值 | {salt, hash} | 使用scrypt加盐哈希 |
| verifyPassword(password, salt, hash) | 密码、盐值、期望哈希 | boolean | 验证密码是否正确 |
| createDatabase(filename) | SQLite文件路径 | DatabaseSync | 创建数据库连接，执行迁移和种子数据 |
| transaction(db, work) | 数据库连接，工作函数 | work()返回值 | 包装事务，自动提交或回滚 |
| id() | 无 | string | 生成UUID |

---

### 1.2 API路由层 (app.js)

#### 权限装饰器

| 函数名 | 参数 | 作用 |
|--------|------|------|
| allow(actor, permission) | 演员对象，权限码 | 验证是否有指定权限，无则抛403 |
| allowAny(actor, permissions) | 演员对象，权限码数组 | 验证是否有任一权限 |

#### 采购订单相关路由

| 方法 | 路径 | 处理函数 | 权限 | 说明 |
|------|------|----------|------|------|
| GET | /api/purchase-orders | listPurchaseOrders | PURCHASE_ORDERS_VIEW | 列表查询 |
| POST | /api/purchase-orders | createPurchaseOrder | PURCHASE_ORDERS_CREATE | 新增 |
| GET | /api/purchase-orders/:id | getPurchaseOrder | PURCHASE_ORDERS_VIEW | 详情 |
| PUT | /api/purchase-orders/:id | updatePurchaseOrder | PURCHASE_ORDERS_CREATE | 更新 |
| POST | /api/purchase-orders/:id/submit | changePurchaseOrderState(submit) | PURCHASE_ORDERS_SUBMIT | 提交 |
| POST | /api/purchase-orders/:id/approve | changePurchaseOrderState(approve) | PURCHASE_ORDERS_APPROVE | 审核 |
| POST | /api/purchase-orders/:id/reject | changePurchaseOrderState(reject) | PURCHASE_ORDERS_APPROVE | 驳回 |

#### 核心函数解析

**listPurchaseOrders(db, res, actor, url)**
- 功能：查询采购订单列表
- 参数：db数据库连接，res响应对象，actor当前用户，url请求URL
- 返回：采购订单列表（包含供应商名称、明细行数）
- 支持按状态和关键词搜索

**createPurchaseOrder(db, req, res, actor)**
- 功能：创建新采购订单
- 验证：供应商必须存在且启用、至少一条明细
- 金额：以后端计算为准，前端传入仅供参考

**updatePurchaseOrder(db, req, res, actor, orderId)**
- 功能：更新采购订单
- 限制：只有草稿或已驳回订单可修改
- 限制：制单人不能审核自己的订单

**changePurchaseOrderState(db, req, res, actor, orderId, action)**
- 功能：采购订单状态流转
- submit：提交订单
- approve：审核通过
- reject：驳回（需要reason）

**purchaseOrderInput(db, body)**
- 功能：验证并规范化采购订单输入
- 验证规则：
  - supplierId：必填，供应商必须存在且启用
  - items：必填，至少一条明细

---

### 1.3 认证与会话

**login(db, req, res)**
- 验证用户名密码
- 生成32字节随机Token，保存SHA256哈希
- 会话有效期12小时
- 登录失败写入审计日志

**authenticate(db, req)**
- 从Authorization头提取Bearer Token
- 验证Token哈希是否存在且未过期
- 返回当前用户信息（含权限列表）

**actorFromRow(db, row)**
- 从用户行数据构建演员对象
- 查询角色权限关联表构建权限数组

---

## 二、前端实现

### 2.1 API调用层 (api.js)

采购订单相关API调用：
- GET /api/purchase-orders - 列表查询
- POST /api/purchase-orders - 新增采购订单
- GET /api/purchase-orders/:id - 采购订单详情
- PUT /api/purchase-orders/:id - 更新采购订单
- POST /api/purchase-orders/:id/submit - 提交
- POST /api/purchase-orders/:id/approve - 审核
- POST /api/purchase-orders/:id/reject - 驳回

### 2.2 组件结构 (App.jsx)

#### PurchaseOrders 组件
- 采购订单列表页面
- 状态筛选：全部/草稿/待审核/已审核/已驳回
- 关键词搜索
- 操作：查看、编辑、提交、审核

#### PurchaseOrderEditor 组件
- 新建/编辑采购订单
- 选择供应商（下拉选择启用的供应商）
- 订单明细：选择货品、填写数量和单价
- 自动计算金额

#### PurchaseOrderDetail 组件
- 查看采购订单详情
- 显示订单信息、明细、操作历史

### 2.3 权限检查

- can(user, permission): 检查用户是否有指定权限
- 导航项：key=purchase-orders, label=采购订单, icon=▦, any=[PURCHASE_ORDERS_VIEW, ...]

---

## 三、数据流向

### 采购订单创建流程

用户选择供应商 -> 添加明细行（货品、数量、单价）-> 保存 -> 
POST /api/purchase-orders -> 后端认证 -> 权限校验 -> 
purchaseOrderInput验证 -> INSERT -> 审计日志 -> 返回结果 -> 前端刷新

### 采购订单审核流程

用户点击审核 -> POST /api/purchase-orders/:id/approve -> 
后端认证 -> 权限校验 -> 状态更新 -> 审计日志 -> 返回结果 -> 前端刷新

---

## 四、函数关系图

```
请求进入 -> handleApi() 路由分发 -> authenticate() 认证 ->
  - listPurchaseOrders() -> purchaseOrderRows()
  - createPurchaseOrder() -> purchaseOrderInput() -> audit()
  - updatePurchaseOrder() -> purchaseOrderInput() -> audit()
  - changePurchaseOrderState() -> audit()
      -> transaction()
      -> db.prepare()
```

---

## 五、安全考量

1. 密码存储：使用scrypt，1000次迭代，64字节输出
2. Token存储：只存储SHA256哈希，不存储明文
3. SQL注入：使用参数化查询，不拼接SQL
4. 权限校验：后端每个API都有权限验证
5. 输入验证：所有输入都有长度和格式限制
6. 敏感操作审计：创建、修改、删除都有日志

---

## 六、变更记录

| 日期 | 变更内容 |
|------|----------|
| 2026-08-29 | 新增供应商资料模块完整实现 |
| 2026-08-29 | 补充采购订单关联设计文档 |
| 2026-08-29 | 新增采购订单模块完整实现 |
