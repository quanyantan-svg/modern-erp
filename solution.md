# 实现方法文档 (solution.md)

本文档记录功能实现方法，包括代码中各函数的含义及它们之间的关系。每次新增代码时必须修改。

---

## 一、后端实现

### 1.1 数据库层 (db.js)

#### 表结构

**accounting_subjects 表**
```sql
CREATE TABLE IF NOT EXISTS accounting_subjects (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  direction TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')),
  parent_id TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
```

**accounting_vouchers 表**
```sql
CREATE TABLE IF NOT EXISTS accounting_vouchers (
  id TEXT PRIMARY KEY,
  voucher_no TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  voucher_date TEXT NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  creator_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (creator_id) REFERENCES users(id)
);
```

**accounting_entries 表**
```sql
CREATE TABLE IF NOT EXISTS accounting_entries (
  id TEXT PRIMARY KEY,
  voucher_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  summary TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (voucher_id) REFERENCES accounting_vouchers(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id) REFERENCES accounting_subjects(id)
);
```

#### 核心科目（种子数据）

| 编码 | 名称 | 类型 | 方向 |
|------|------|------|------|
| 1001 | 库存现金 | ASSET | DEBIT |
| 1002 | 银行存款 | ASSET | DEBIT |
| 1122 | 应收账款 | ASSET | DEBIT |
| 1405 | 库存商品 | ASSET | DEBIT |
| 2202 | 应付账款 | LIABILITY | CREDIT |
| 6001 | 主营业务收入 | REVENUE | CREDIT |
| 6401 | 主营业务成本 | EXPENSE | DEBIT |

---

### 1.2 API路由层 (app.js)

#### 凭证相关路由

| 方法 | 路径 | 处理函数 | 权限 | 说明 |
|------|------|----------|------|------|
| GET | /api/accounting-subjects | listAccountingSubjects | ACCOUNTING_VIEW | 科目列表 |
| GET | /api/accounting-vouchers | listAccountingVouchers | ACCOUNTING_VIEW | 凭证列表 |
| GET | /api/accounting-vouchers/:id | getAccountingVoucher | ACCOUNTING_VIEW | 凭证详情 |

#### 凭证生成函数

**generateVoucher(db, sourceType, sourceId, entries, actor)**
- 功能：根据业务单据生成会计凭证
- 参数：
  - sourceType: 业务类型（SALES_ORDER/PURCHASE_ORDER/INVENTORY_TRANSFER）
  - sourceId: 业务单据ID
  - entries: 分录数组 [{subjectId, direction, amountCents, summary}]
  - actor: 当前用户

#### 业务联动

**销售订单审核联动**
- 时机：changeOrderState 中 action=approve 时
- 生成凭证：
  - 借方：1122 应收账款（客户），金额=订单总额
  - 贷方：6001 主营业务收入，金额=订单总额

**采购订单审核联动**
- 时机：changePurchaseOrderState 中 action=approve 时
- 生成凭证：
  - 借方：1405 库存商品，金额=订单总额
  - 贷方：2202 应付账款（供应商），金额=订单总额

**库存调拨确认联动**
- 时机：changeInventoryTransferState 中 action=transfer 时
- 生成凭证：
  - 借方：1405 库存商品（目标仓）
  - 贷方：1405 库存商品（源仓）
  - 金额=调拨货品金额

---

## 二、前端实现

### 2.1 组件结构 (App.jsx)

#### Accounting 组件
- 会计科目列表
- 凭证列表
- 凭证详情弹窗

### 2.2 权限检查

导航项：
- key=accounting, label=财务凭证, icon=ⅿ, any=[ACCOUNTING_VIEW]

---

## 三、变更记录

| 日期 | 变更内容 |
|------|----------|
| 2026-08-29 | 新增供应商资料模块完整实现 |
| 2026-08-29 | 新增采购订单模块完整实现 |
| 2026-08-29 | 新增仓库与库存模块完整实现 |
| 2026-08-29 | 新增财务凭证模块完整实现 |
| 2026-08-29 | 新增入库/出库模块完整实现（采购入库、销售出库、退货管理、库存流水） |
| 2026-08-29 | 新增应收/应付账款模块完整实现（应收账款、应付账款、收款单、付款单） |
| 2026-08-29 | 新增BOM+生产工单模块完整实现（BOM清单、生产工单） |
