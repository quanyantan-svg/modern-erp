# 实现方法文档 (solution.md)

本文档记录功能实现方法，包括代码中各函数的含义及它们之间的关系。每次新增代码时必须修改。

---

## 一、数据库层 (db.js)

### 新增表结构

#### 财务模块
- `departments` - 部门辅助核算
- `projects` - 项目辅助核算
- `currencies` - 币种管理
- `voucher_words` - 凭证字
- `voucher_templates` - 凭证模板
- `period_closures` - 期间结账
- `bank_statements` - 银行对账单
- `bank_reconciliations` - 银行对账记录
- `voucher_sequences` - 凭证序号
- `subject_aux_types` - 科目辅助核算属性

#### 制造模块
- `mrp_plans` - MRP计划主表
- `mrp_plan_items` - MRP计划明细
- `work_centers` - 工作中心
- `routing_operations` - 工序定义
- `production_labor_records` - 生产人工记录

#### 质量模块
- `iqc_inspections` - IQC检验单
- `iqc_inspection_items` - IQC检验明细
- `oqc_inspections` - OQC检验单
- `oqc_inspection_items` - OQC检验明细
- `supplier_evaluations` - 供应商评估

#### OA模块
- `leave_requests` - 请假申请
- `expense_claims` - 费用报销
- `expense_claim_items` - 报销明细

#### 预警模块
- `alert_rules` - 预警规则
- `alert_records` - 预警记录

### 种子数据

| 数据类型 | 内容 |
|---------|------|
| 凭证字 | 记账(JZ)、调整(TZ)、转账(ZD) |
| 部门 | 总经理室、销售部、采购部、财务部、仓储部、生产部 |
| 项目核算 | 智能家居研发项目、生产线改造项目 |
| 币种 | 人民币(CNY)、美元(USD)、欧元(EUR)、港币(HKD) |
| 工作中心 | 装配车间、机加工车间、检测车间 |

---

## 二、API路由层 (app.js)

### 财务模块路由

| 方法 | 路径 | 函数 | 说明 |
|------|------|------|------|
| GET | /api/departments | listDepartments | 部门列表 |
| POST | /api/departments | createDepartment | 新增部门 |
| GET | /api/aux-projects | listProjects | 项目列表 |
| POST | /api/aux-projects | createProject | 新增项目 |
| GET | /api/currencies | listCurrencies | 币种列表 |
| GET | /api/voucher-words | listVoucherWords | 凭证字列表 |
| GET | /api/voucher-templates | listVoucherTemplates | 模板列表 |
| GET | /api/period-closures | listPeriodClosures | 期间列表 |
| POST | /api/period-closures/:id/close | closePeriod | 结账 |
| GET | /api/bank-statements | listBankStatements | 对账单列表 |
| POST | /api/bank-statements | createBankStatement | 导入对账单 |
| GET | /api/bank-reconciliations | listBankReconciliations | 对账列表 |
| GET | /api/reports/trial-balance | getTrialBalance | 试算平衡表 |
| GET | /api/reports/subject-ledger | getSubjectLedger | 明细账 |

### 制造模块路由

| 方法 | 路径 | 函数 | 说明 |
|------|------|------|------|
| GET | /api/mrp-plans | listMrpPlans | MRP计划列表 |
| POST | /api/mrp-plans | createMrpPlan | 创建MRP计划 |
| POST | /api/mrp-plans/generate | generateMrp | 生成MRP建议 |
| POST | /api/mrp-plans/:id/execute | executeMrpPlan | 执行MRP计划 |
| GET | /api/work-centers | listWorkCenters | 工作中心列表 |
| POST | /api/work-centers | createWorkCenter | 创建工作中心 |
| GET | /api/routing-operations | listRoutingOperations | 工序列表 |
| POST | /api/routing-operations | createRoutingOperation | 创建工序 |
| GET | /api/labor-records | listLaborRecords | 人工记录列表 |
| POST | /api/labor-records | createLaborRecord | 记录人工 |

### 质量模块路由

| 方法 | 路径 | 函数 | 说明 |
|------|------|------|------|
| GET | /api/iqc | listIqcInspections | IQC列表 |
| POST | /api/iqc | createIqcInspection | 创建检验单 |
| GET | /api/iqc/:id | getIqcInspection | 检验单详情 |
| PATCH | /api/iqc/:id | updateIqcInspection | 更新检验单 |
| GET | /api/oqc | listOqcInspections | OQC列表 |
| POST | /api/oqc | createOqcInspection | 创建检验单 |
| GET | /api/oqc/:id | getOqcInspection | 检验单详情 |
| PATCH | /api/oqc/:id | updateOqcInspection | 更新检验单 |
| GET | /api/supplier-evaluations | listSupplierEvaluations | 评估列表 |
| POST | /api/supplier-evaluations | createSupplierEvaluation | 创建评估 |

### OA模块路由

| 方法 | 路径 | 函数 | 说明 |
|------|------|------|------|
| GET | /api/leave-requests | listLeaveRequests | 请假列表 |
| POST | /api/leave-requests | createLeaveRequest | 创建请假 |
| POST | /api/leave-requests/:id/approve | processLeaveRequest | 审批请假 |
| POST | /api/leave-requests/:id/reject | processLeaveRequest | 驳回请假 |
| GET | /api/expense-claims | listExpenseClaims | 报销列表 |
| POST | /api/expense-claims | createExpenseClaim | 创建报销 |
| POST | /api/expense-claims/:id/approve | processExpenseClaim | 审批报销 |
| POST | /api/expense-claims/:id/reject | processExpenseClaim | 驳回报销 |

### 预警模块路由

| 方法 | 路径 | 函数 | 说明 |
|------|------|------|------|
| GET | /api/alert-rules | listAlertRules | 规则列表 |
| POST | /api/alert-rules | createAlertRule | 创建规则 |
| PATCH | /api/alert-rules/:id | updateAlertRule | 更新规则 |
| GET | /api/alerts | listAlertRecords | 预警列表 |
| POST | /api/alerts/:id/resolve | resolveAlert | 处理预警 |

### 报表模块路由

| 方法 | 路径 | 函数 | 说明 |
|------|------|------|------|
| GET | /api/reports/financial-summary | getFinancialSummary | 经营汇总 |
| GET | /api/reports/inventory-status | getInventoryStatus | 库存状态 |
| GET | /api/reports/sales-analysis | getSalesAnalysis | 销售分析 |

---

## 三、核心函数说明

### MRP相关

**generateMrp**
- 功能：基于BOM和需求计算物料需求
- 计算逻辑：
  1. 获取毛需求（销售订单数量）
  2. 减去现有库存
  3. 减去在途采购
  4. 计算净需求
  5. 生成计划订单建议

**executeMrpPlan**
- 功能：将MRP建议转化为采购申请
- 处理逻辑：
  1. 遍历PENDING状态的计划明细
  2. 为每个物料创建采购订单
  3. 更新计划明细状态为CONVERTED

### 质检相关

**updateIqcInspection**
- 功能：完成IQC检验
- 处理逻辑：
  1. 更新检验单状态为COMPLETED
  2. 根据合格/不合格数量更新结果
  3. 如果有明细则插入检验明细

**createSupplierEvaluation**
- 功能：创建供应商评估
- 计算逻辑：
  - 综合评分 = 质量分×40% + 交期分×30% + 价格分×20% + 服务分×10%
  - 评级：A(≥90), B(≥80), C(≥70), D(<70)

### OA相关

**processLeaveRequest / processExpenseClaim**
- 功能：审批处理
- 处理逻辑：
  1. 更新申请单状态为APPROVED或REJECTED
  2. 记录审批人ID和审批时间
  3. 如果是批准，可能触发后续流程

---

## 四、变更记录

| 日期 | 版本 | 变更内容 |
|------|------|----------|
| 2026-08-29 | 1.0.0 | 初始版本 |
| 2026-08-29 | - | 供应商、采购、仓库、库存模块 |
| 2026-08-29 | - | 财务凭证、入库出库、应收应付 |
| 2026-08-30 | - | BOM、生产工单、出纳、固定资产 |
| **2026-08-30** | **2.0.0** | **第一阶段：财务闭环完成** |
| **2026-08-30** | **2.1.0** | **第二阶段：制造深化完成** |
| **2026-08-30** | **2.2.0** | **第三阶段：质量供应链完成** |
| **2026-08-30** | **2.3.0** | **第四阶段：管理扩展完成** |
