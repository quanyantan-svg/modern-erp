# 功能需求文档 (document.md)

本文档记录项目的功能需求，每次需求变更和迭代时必须修改。

## 版本信息

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2026-08-29 | 初始版本，包含登录、销售订单基础流程 |
| 1.1.0 | 2026-08-29 | 新增供应商资料模块（采购模块基础） |
| 1.2.0 | 2026-08-29 | 新增采购订单模块 |
| 1.3.0 | 2026-08-29 | 新增仓库与库存模块 |
| 1.4.0 | 2026-08-29 | 新增财务凭证模块 |
| 1.5.0 | 2026-08-29 | 新增入库/出库模块（采购入库、销售出库、退货管理、库存流水） |
| 1.6.0 | 2026-08-29 | 新增应收/应付账款模块（应收账款、应付账款、收款单、付款单） |
| 1.7.0 | 2026-08-29 | 新增BOM+生产工单模块（BOM清单、生产工单） |
| 1.8.0 | 2026-08-30 | 新增出纳管理+固定资产模块 |

---

## 一、基础资料模块

### 1.1 ~ 1.4 （同前版本）

---

## 二、财务模块

### 2.1 会计科目 (Accounting Subjects)

#### 功能说明
维护企业会计科目体系，采用标准科目结构。

#### 科目分类
- **资产类**：库存现金、银行存款、应收账款、其他应收款、库存商品
- **负债类**：应付账款、应付票据
- **所有者权益类**：实收资本、利润分配
- **损益类**：主营业务收入、主营业务成本

#### 字段定义
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | UUID主键 |
| code | TEXT | 科目编码，唯一 |
| name | TEXT | 科目名称 |
| type | TEXT | 科目类型：ASSET/ LIABILITY/ EQUITY/ REVENUE/ EXPENSE |
| direction | TEXT | 余额方向：DEBIT/CREDIT |
| parent_id | TEXT | 父级科目ID |
| active | INTEGER | 启用状态 |

#### API接口
- GET /api/accounting-subjects - 列表查询

#### 权限控制
- 查看：ACCOUNTING_VIEW

---

### 2.2 会计凭证 (Accounting Vouchers)

#### 功能说明
记录业务单据生成的会计凭证，每张凭证包含多个分录。

#### 字段定义
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | UUID主键 |
| voucher_no | TEXT | 凭证号，唯一，格式 VCH-YYYYMMDD-XXXXXX |
| source_type | TEXT | 来源类型：SALES_ORDER/PURCHASE_ORDER/INVENTORY_TRANSFER |
| source_id | TEXT | 来源单据ID |
| voucher_date | TEXT | 凭证日期 |
| remark | TEXT | 备注 |
| creator_id | TEXT | 制单人ID |
| created_at | TEXT | 创建时间 |

#### 凭证分录 (accounting_entries)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | UUID主键 |
| voucher_id | TEXT | 凭证ID |
| subject_id | TEXT | 科目ID |
| direction | TEXT | 方向：DEBIT/CREDIT |
| amount_cents | INTEGER | 金额（分） |
| summary | TEXT | 摘要 |

#### API接口
- GET /api/accounting-vouchers - 凭证列表
- GET /api/accounting-vouchers/:id - 凭证详情（含分录）

#### 权限控制
- 查看：ACCOUNTING_VIEW

---

### 2.3 凭证自动生成规则

#### 销售订单审核通过
- 借方：应收账款（按客户） - 金额 = 订单总额
- 贷方：主营业务收入 - 金额 = 订单总额

#### 采购订单审核通过
- 借方：库存商品 - 金额 = 订单总额
- 贷方：应付账款（按供应商） - 金额 = 订单总额

#### 库存调拨确认
- 借方：库存商品（目标仓库）
- 贷方：库存商品（源仓库）
- 金额 = 调拨货品金额

---

## 三、权限体系

### 新增权限
| 权限码 | 名称 | 说明 |
|--------|------|------|
| ACCOUNTING_VIEW | 查看财务凭证 | 查看会计科目和凭证 |

### 角色权限分配
| 角色 | 新增权限 |
|------|----------|
| 系统管理员 | ACCOUNTING_VIEW |
| 财务专员 | ACCOUNTING_VIEW |
| 销售主管 | ACCOUNTING_VIEW |
| 仓库管理员 | - |

---

## 四、变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-08-29 | 1.0.0 | 初始版本 |
| 2026-08-29 | 1.1.0 | 新增供应商资料模块 |
| 2026-08-29 | 1.2.0 | 新增采购订单模块 |
| 2026-08-29 | 1.3.0 | 新增仓库与库存模块 |
| 2026-08-29 | 1.4.0 | 新增财务凭证模块 |

---

## 五、出纳管理模块

### 5.1 现金日记账 (Cash Journals)

#### 功能说明
记录企业现金和银行存款的收付款业务，支持按日期范围和账户类型筛选。

#### 字段定义
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | UUID主键 |
| journal_no | TEXT | 单据号，唯一 |
| journal_type | TEXT | 业务类型：RECEIPT/PAYMENT/TRANSFER |
| account_type | TEXT | 账户类型：CASH/BANK |
| bank_id | TEXT | 银行账户ID |
| amount_cents | INTEGER | 金额（分） |
| direction | TEXT | 方向：IN/OUT |
| counterparty_type | TEXT | 对方类型：CUSTOMER/SUPPLIER |
| counterparty_id | TEXT | 对方ID |
| counterparty_name | TEXT | 对方名称 |
| summary | TEXT | 摘要 |
| journal_date | TEXT | 业务日期 |
| operator_id | TEXT | 操作员ID |

#### API接口
- GET /api/cash-journals - 列表查询（支持搜索、日期筛选）
- POST /api/cash-journals - 新增记录

#### 权限控制
- 查看：CASH_JOURNALS_VIEW
- 管理：CASH_JOURNALS_MANAGE

---

### 5.2 银行账户 (Bank Accounts)

#### 功能说明
管理企业银行账户信息，记录各账户余额。

#### 字段定义
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | UUID主键 |
| bank_name | TEXT | 开户银行 |
| account_no | TEXT | 账号 |
| account_name | TEXT | 户名 |
| balance_cents | INTEGER | 当前余额（分） |
| initial_balance_cents | INTEGER | 期初余额（分） |
| active | INTEGER | 启用状态 |

#### API接口
- GET /api/bank-accounts - 列表
- POST /api/bank-accounts - 新增
- PATCH /api/bank-accounts/:id - 编辑

#### 权限控制
- 查看：BANK_ACCOUNTS_VIEW
- 管理：BANK_ACCOUNTS_MANAGE

---

### 5.3 票据管理 (Bills)

#### 功能说明
管理企业应收/应付票据，跟踪票据状态变化。

#### 字段定义
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | UUID主键 |
| bill_type | TEXT | 票据类型：RECEivable/PAYable |
| bill_no | TEXT | 票据号 |
| counterparty_type | TEXT | 对方类型：CUSTOMER/SUPPLIER |
| counterparty_id | TEXT | 对方ID |
| face_amount_cents | INTEGER | 票面金额（分） |
| issue_date | TEXT | 出票日期 |
| due_date | TEXT | 到期日期 |
| status | TEXT | 状态：PENDING/ACCEPTED/DISCOUNTED/PAID/CANCELLED |

#### API接口
- GET /api/bills - 列表（支持类型和状态筛选）
- POST /api/bills - 新增
- PATCH /api/bills/:id - 编辑

#### 权限控制
- 查看：BILLS_VIEW
- 管理：BILLS_MANAGE

---

## 六、固定资产模块

### 6.1 固定资产 (Fixed Assets)

#### 功能说明
管理企业固定资产，记录资产信息及折旧计提。

#### 字段定义
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT | UUID主键 |
| asset_code | TEXT | 资产编号 |
| asset_name | TEXT | 资产名称 |
| category | TEXT | 资产类别 |
| purchase_date | TEXT | 购置日期 |
| purchase_amount_cents | INTEGER | 原值（分） |
| useful_life_months | INTEGER | 使用期限（月） |
| salvage_value_cents | INTEGER | 残值（分） |
| depreciation_method | TEXT | 折旧方法：STRAIGHT_LINE/NONE |
| monthly_depreciation_cents | INTEGER | 月折旧额（分） |
| net_value_cents | INTEGER | 净值（分） |
| status | TEXT | 状态：IN_USE/MAINTENANCE/SCRAPPED/SOLD |

#### API接口
- GET /api/fixed-assets - 列表
- POST /api/fixed-assets - 新增
- PATCH /api/fixed-assets/:id - 编辑
- POST /api/fixed-assets/depreciation - 计提折旧
- GET /api/fixed-assets/:id/depreciations - 折旧记录

#### 权限控制
- 查看：FIXED_ASSETS_VIEW
- 管理：FIXED_ASSETS_MANAGE

---

## 七、新增权限清单

| 权限码 | 名称 | 说明 |
|--------|------|------|
| CASH_JOURNALS_VIEW | 查看现金日记账 | 查看现金和银行存款记录 |
| CASH_JOURNALS_MANAGE | 管理现金日记账 | 新增/编辑日记账记录 |
| BANK_ACCOUNTS_VIEW | 查看银行账户 | 查看银行账户信息 |
| BANK_ACCOUNTS_MANAGE | 管理银行账户 | 新增/编辑银行账户 |
| BILLS_VIEW | 查看票据 | 查看应收/应付票据 |
| BILLS_MANAGE | 管理票据 | 新增/编辑票据 |
| FIXED_ASSETS_VIEW | 查看固定资产 | 查看固定资产信息 |
| FIXED_ASSETS_MANAGE | 管理固定资产 | 新增/编辑资产、计提折旧 |