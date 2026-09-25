# Modern ERP 演示业务流程

本文是课堂和验收用教程，不是第二份需求规格。当前业务合同以 [document.md](../../document.md) 为准，账号安全见 [demo-accounts.md](./demo-accounts.md)。所有步骤应在隔离演示环境执行。

## 1. 演示前准备

- 使用五个正常角色：`ADMIN`、`SALES`、`REVIEWER`、`WAREHOUSE`、`ACCOUNTING`。
- 确认演示期间开放、主数据有效、仓库库存和质量规则满足预期。
- 使用仓库外提供的临时强密码；不要在讲义、录屏或日志中展示凭据。
- 不运行生产重置、恢复、历史重写或未获授权的关账操作。

## 2. 销售到收款

    Customer → Sales Order → REVIEWER approval
      → Sales Delivery → OQC → Inventory/COGS
      → Sales Invoice → AR/Revenue/Output Tax
      → Collection/Credit/Refund/Write-off

建议演示：

1. `SALES` 创建并提交销售订单。
2. `REVIEWER` 审批；说明审批只授予业务执行权限，不移动库存、不确认收入。
3. `WAREHOUSE` 从已批准订单创建出货草稿，完成需要的 OQC 后确认出货。
4. 展示库存、身份/批次和 COGS 影响。
5. `ACCOUNTING` 创建并过账 Sales Invoice，展示 AR、收入和销项税。
6. 创建收款或贷项并展示未结余额、凭证和来源追溯。

在 `SEPARATE` 模式下，出货确认不创建 AR 或收入；商业确认发生在 Sales Invoice。`DIRECT_BILL`/`AUTO_BILL` 仍会建立权威发票记录。

## 3. 采购到付款

    Purchase Requisition → REVIEWER approval
      → Purchase Order → REVIEWER approval
      → Purchase Receipt → IQC → Inventory/GRNI
      → Supplier Bill → AP/Input Tax/PPV
      → Payment/Credit/Refund/Write-off

建议演示：

1. 从采购指令生成请购，或由 `SALES` 创建请购/采购订单并提交。
2. `REVIEWER` 以不同账号审核。
3. `WAREHOUSE` 从已批准采购订单创建收货，完成需要的 IQC 后确认。
4. 展示库存和 GRNI；说明收货本身不等于确认 AP。
5. `ACCOUNTING` 创建 Supplier Bill，完成匹配并过账，展示 AP、进项税和价差。
6. 创建付款或供应商贷项并展示核销结果。

## 4. 计划与制造

    Active Forecast + approved Sales Orders
      → MRP snapshot
      → MAKE/BUY suggestions
      → Production/Purchase Instructions
      → Production Order or Purchase Requisition

MRP 先净额计算再展开 BOM；结果是不可变建议，不自动移动库存或写凭证。用户显式下达指令后才创建下游单据。

制造链可演示：

    Production Order start
      → frozen BOM/Routing/Cost snapshots
      → Material Issue/Return
      → Operation Report
      → Production Receipt/Reversal
      → Completion and WIP/variance closure

库存执行由 `WAREHOUSE` 完成；完工状态本身不重复移动库存。制造证据不足时成本应显示为部分或暂估，不得伪装为零。

## 5. 库存、质量与追溯

- 演示盘点的 `DRAFT → SUBMITTED → REVIEWER approval`，只有批准时影响库存。
- 演示调拨、调整或报废时，任一行失败应使整单回滚。
- LOT/SERIAL 场景展示 on-hand 与 available 的区别；HOLD 身份仍在库但不可用。
- IQC/OQC 是物流确认门禁，不是通用审批族，也不直接产生库存或凭证。
- 使用正向/反向追溯查看已有权威证据，不按 BOM 比例虚构历史谱系。

## 6. 财务与期间控制

- `ACCOUNTING` 创建和提交手工凭证，`ADMIN` 在职责分离成立时审批。
- 财务报表只读取 `POSTED` 凭证。
- 存货期间先关闭，会计期间后关闭；存在阻断级 System Health 差异时不得关账。
- 关闭期间后尝试新的业务确认，应得到受控冲突且不产生部分库存、子账或凭证影响。

## 7. 10–15 分钟推荐路线

1. 销售订单创建、独立审批、OQC 与出货。
2. Sales Invoice、AR 和部分/全部收款。
3. 采购订单独立审批、IQC 与收货。
4. Supplier Bill、AP 和付款。
5. MRP 建议到生产/采购指令。
6. 制令开工、领料、报工、生产入库与完工。
7. LOT/SERIAL 追溯、库存价值、WIP 和 System Health。
8. 手工凭证的独立审批与期间关闭保护。

## 8. 明确边界

系统当前不宣称支持多公司、多币种、政府电子发票、APS、完整 MES/OEE、完整 QMS/CAPA、年结或期初 WIP。真实 MySQL 大规模容量也尚未形成生产认证。演示中不得把隐藏入口、历史文档或兼容 API 描述为已支持产品能力。
