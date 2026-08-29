# 实现方法文档 (solution.md)

本文档记录功能实现方法，包括代码中各函数的含义及它们之间的关系。每次新增代码时必须修改。

---

## 一、后端实现

### 1.1 数据库层 (db.js)

#### 表结构

**suppliers 表**
```sql
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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

#### 种子数据

**suppliers 表种子数据：**
- SUP-001 - 深圳市鹏程电子有限公司，联系人王经理，13800002001
- SUP-002 - 东莞市鑫源物料有限公司，联系人李工，13800002002

---

### 1.2 API路由层 (app.js)

#### 权限装饰器

| 函数名 | 参数 | 作用 |
|--------|------|------|
| allow(actor, permission) | 演员对象，权限码 | 验证是否有指定权限，无则抛403 |
| allowAny(actor, permissions) | 演员对象，权限码数组 | 验证是否有任一权限 |

#### 供应商相关路由

| 方法 | 路径 | 处理函数 | 权限 | 说明 |
|------|------|----------|------|------|
| GET | /api/suppliers | listSuppliers | SUPPLIERS_VIEW/MANAGE | 列表查询 |
| POST | /api/suppliers | createSupplier | SUPPLIERS_MANAGE | 新增 |
| PATCH | /api/suppliers/:id | updateSupplier | SUPPLIERS_MANAGE | 更新 |

#### 核心函数解析

**listSuppliers(db, res, actor, url)**
- 功能：查询供应商列表，支持按编码、名称、联系人模糊搜索
- 参数：db数据库连接，res响应对象，actor当前用户，url请求URL
- 返回：供应商列表
- SQL：SELECT ... FROM suppliers WHERE code LIKE ? OR name LIKE ? OR contact LIKE ?

**createSupplier(db, req, res, actor)**
- 功能：创建新供应商
- 参数：同listSuppliers
- 权限：需要SUPPLIERS_MANAGE
- 验证：编码唯一性检查
- 审计：写入audit_logs

**updateSupplier(db, req, res, actor, supplierId)**
- 功能：更新供应商信息
- 特殊逻辑：系统管理员角色ADMIN的供应商SUP-001不能停用
- 停用供应商不能在采购订单中引用

**supplierInput(body)**
- 功能：验证并规范化供应商输入数据
- 验证规则：
  - code：必填，唯一编码格式（大写字母、数字、下划线、短横线）
  - name：必填，最大100字符
  - contact：可选，最大50字符
  - phone：可选，最大30字符
  - address：可选，最大200字符
  - email：可选，有效邮箱格式

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

供应商相关API调用：
- GET /api/suppliers - 列表查询
- POST /api/suppliers - 新增供应商
- PATCH /api/suppliers/:id - 更新供应商

### 2.2 组件结构 (App.jsx)

#### Suppliers 组件

```jsx
function Suppliers({ user, notify }) {
  // 状态管理
  const [items, setItems] = useState([])       // 供应商列表
  const [search, setSearch] = useState('')     // 搜索关键字
  const [editing, setEditing] = useState(null)  // 编辑中的供应商
  
  // 数据加载
  const load = () => api('/api/suppliers?search=...')
  
  // 渲染：Panel + Toolbar + table + SupplierModal
}
```

#### SupplierModal 组件

- value: 编辑的供应商对象，null表示新增
- 字段表单：code, name, contact, phone, address, email, active
- 保存时调用 api(method: value.id ? PATCH : POST)

### 2.3 权限检查

- can(user, permission): 检查用户是否有指定权限
- 导航项：key=suppliers, label=供应商资料, icon=○, any=[SUPPLIERS_VIEW, SUPPLIERS_MANAGE]

---

## 三、数据流向

### 供应商新增流程

用户填写表单 -> 前端验证 -> POST /api/suppliers -> 后端认证 -> 权限校验 -> supplierInput验证 -> INSERT -> 审计日志 -> 返回结果 -> 前端刷新

### 供应商查询流程

用户搜索 -> GET /api/suppliers?search=关键字 -> 后端认证 -> 权限校验 -> SQL查询 -> 返回列表 -> 前端渲染

---

## 四、函数关系图

```
请求进入 -> handleApi() 路由分发 -> authenticate() 认证 ->
  - listSuppliers() -> actorFromRow() -> rolePermissions()
  - createSupplier() -> supplierInput() -> audit()
  - updateSupplier() -> supplierInput() -> audit()
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

## 六、采购订单关联设计（待实现）

### 采购订单与供应商的关系

```
采购订单 (purchase_orders)
    │
    ├── supplier_id → 供应商 (suppliers)
    │                    ├── code: 供应商编码
    │                    ├── name: 供应商名称
    │                    └── active: 启用状态
    │
    └── 明细 (purchase_order_items)
          ├── product_id → 货品 (products)
          │                    ├── code: 货品编码
          │                    ├── name: 货品名称
          │                    └── active: 启用状态
          ├── quantity: 采购数量
          ├── unit_price: 采购单价
          └── amount: 金额小计
```

### 数据约束

- 采购订单引用 supplier_id 时，必须检查 suppliers.active = 1
- 采购订单明细引用 product_id 时，必须检查 products.active = 1
- 这与销售订单引用客户和货品的逻辑平行

---

## 七、变更记录

| 日期 | 变更内容 |
|------|----------|
| 2026-08-29 | 新增供应商资料模块完整实现 |
| 2026-08-29 | 补充采购订单关联设计文档 |
