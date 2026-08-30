# Modern ERP：现代企业管理信息系统

这是基于方天云端 ERP B9V27 业务模型重新设计的现代化 ERP。项目以完整覆盖原系统可识别的核心业务、权限、单据流转和数据关系为目标，并为后续数据迁移与持续扩展保留清晰边界。

## 技术栈

- 前端：React 19、Vite 7，原生 CSS
- 后端：Node.js 原生 HTTP API
- 数据库：Node.js 内置 SQLite
- 认证：随机 Bearer Token；数据库只保存 Token 哈希
- 密码：scrypt 加盐哈希

## 模块化架构

```text
src/
  App.jsx                 应用壳、导航与页面装配
  components/             通用界面组件
  pages/                  按业务域拆分的前端页面
server/
  app.js                  API 入口与路由装配
  lib/                    HTTP、鉴权辅助与审计基础设施
  modules/                按业务域拆分的后端处理器
  db.js                   数据库入口、迁移与种子数据
```

模块之间通过明确的导入导出协作；前端页面不直接访问数据库，后端权限校验不依赖前端菜单状态。

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
| warehouse | warehouse123 | 仓库管理员 | 管理仓库和库存 |
| accounting | accounting123 | 财务专员 | 全部财务功能 |

## 开发阶段

### 第一阶段：财务闭环 ✓ (2-3周)
- [x] 总账系统 + 凭证管理
- [x] 辅助核算（部门/项目/客户/供应商）
- [x] 凭证字与凭证模板
- [x] 出纳管理增强
- [x] 月结/年结
- [x] 银行对账
- [x] 会计报表

### 第二阶段：制造深化 ✓ (2-3周)
- [x] MRP物料需求计划
- [x] 工作中心管理
- [x] 工序管理（工艺路线）
- [x] 生产人工记录
- [x] 成本核算增强

### 第三阶段：质量供应链 ✓ (2周)
- [x] IQC来料检验
- [x] OQC出货检验
- [x] 供应商评估

### 第四阶段：管理扩展 ✓ (3-4周)
- [x] CRM客户关系管理
- [x] OA办公审批
- [x] 预警系统
- [x] 报表中心

## 模块清单

### 财务会计模块
| 模块 | API | 说明 |
|------|-----|------|
| 会计科目 | /api/accounting-subjects | 科目体系、辅助核算属性 |
| 会计凭证 | /api/accounting-vouchers | 凭证管理 |
| 凭证字 | /api/voucher-words | 凭证字号管理 |
| 凭证模板 | /api/voucher-templates | 凭证模板 |
| 部门核算 | /api/departments | 部门辅助核算 |
| 项目核算 | /api/aux-projects | 项目辅助核算 |
| 币种管理 | /api/currencies | 多币种汇率 |
| 期间管理 | /api/period-closures | 月结/年结 |
| 银行对账 | /api/bank-reconciliations | 银行对账 |

### 制造模块
| 模块 | API | 说明 |
|------|-----|------|
| MRP计划 | /api/mrp-plans | 物料需求计划 |
| 工作中心 | /api/work-centers | 工作中心 |
| 工序管理 | /api/routing-operations | 工艺路线 |
| 人工记录 | /api/labor-records | 生产人工 |

### 质量模块
| 模块 | API | 说明 |
|------|-----|------|
| IQC检验 | /api/iqc | 来料检验 |
| OQC检验 | /api/oqc | 出货检验 |
| 供应商评估 | /api/supplier-evaluations | 供应商评分 |

### 管理模块
| 模块 | API | 说明 |
|------|-----|------|
| 请假申请 | /api/leave-requests | OA请假 |
| 费用报销 | /api/expense-claims | OA报销 |
| 预警规则 | /api/alert-rules | 预警设置 |
| 预警记录 | /api/alerts | 预警消息 |

### 报表模块
| 模块 | API | 说明 |
|------|-----|------|
| 试算平衡表 | /api/reports/trial-balance | 科目余额表 |
| 明细账 | /api/reports/subject-ledger | 明细分类账 |
| 财务报表 | /api/reports/financial-summary | 经营汇总 |
| 库存状态 | /api/reports/inventory-status | 库存分析 |
| 销售分析 | /api/reports/sales-analysis | 销售分析 |

### 基础模块
| 模块 | API | 说明 |
|------|-----|------|
| 登录认证 | /api/auth/* | 用户认证 |
| 工作台 | /api/dashboard | 业务概览 |
| 客户管理 | /api/customers | 客户档案 |
| 供应商管理 | /api/suppliers | 供应商档案 |
| 货品管理 | /api/products | 产品档案 |
| 销售订单 | /api/orders | 订单管理 |
| 采购订单 | /api/purchase-orders | 采购管理 |
| 仓库管理 | /api/warehouses | 仓库设置 |
| 库存管理 | /api/inventory | 库存查询 |
| 入库出库 | /api/purchase-receipts | 收发货 |
| 应收应付 | /api/accounts-receivable | 账款管理 |
| 出纳管理 | /api/cash-journals | 现金银行 |
| 固定资产 | /api/fixed-assets | 资产管理 |

---

## 重构记录

| 日期 | 阶段 | 模块 | 说明 |
|------|------|------|------|
| 2026-08-29 | - | 基础框架 | 登录、销售订单基础流程 |
| 2026-08-29 | - | 供应链 | 供应商、采购、仓库、库存 |
| 2026-08-29 | - | 财务 | 会计凭证、入库出库、应收应付 |
| 2026-08-29 | - | 生产 | BOM、生产工单 |
| 2026-08-30 | - | 扩展 | 出纳、固定资产、成本、质检、CRM |
| **2026-08-30** | **第一阶段** | **财务闭环** | **辅助核算、月结年结、银行对账、报表** |
| **2026-08-30** | **第二阶段** | **制造深化** | **MRP、工作中心、工序、人工记录** |
| **2026-08-30** | **第三阶段** | **质量供应链** | **IQC/OQC检验、供应商评估** |
| **2026-08-30** | **第四阶段** | **管理扩展** | **OA审批、预警系统、经营报表** |
