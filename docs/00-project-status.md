# 项目状态快照

> 自动生成：2026-08-31

## 阶段与分支

- 阶段：Cloud Refactor Phase 2
- 分支：refactor/cloud-deployment
- 基准提交：a2e1f7e (docs: establish cloud refactor documentation)

## 已完成的核心工作流

| 模块 | 状态 | 提交 | 验证 |
|------|------|------|------|
| Authentication | ✅ | acdaad2 | 11 tests |
| Production Order Core Workflow | ✅ | 5809edb | 8 tests |
| Voucher Approval Workflow | ✅ | 9e8aab4 | 15 tests |
| Accounting Period Integrity / Period Closing Core | ✅ | ee3168b | 13 tests |
| Income Statement | ✅ | 28c2f51 | 21 tests |
| Balance Sheet | ✅ | fc088f3 | 28 tests |
| Financial Reporting Consistency | ✅ | f6a2521 | 15 tests |
| Production Safety (Phase 2A) | ✅ | 023f34b | 11 tests |
| Backup / Restore (Phase 2B) | ✅ | 43a0386 | 18 tests |
| First Admin Bootstrap (Phase 2C-1) | ✅ | a880d89 | 17 tests |
| systemd Service + Backup Timer (Phase 2C-2A) | ✅ | 90dcd49 | 4 tests |
| Nginx Reverse Proxy (Phase 2C-2B) | ✅ | 本提交 | 4 tests |

## 当前测试状态

- 测试文件：server/app.test.js + server/voucher.test.js + server/period.test.js + server/income-statement.test.js + server/balance-sheet.test.js + server/financial-summary.test.js + server/production-safety.test.js + server/backup-restore.test.js + server/setup-admin.test.js + server/systemd.test.js + server/nginx.test.js
- 186 tests / 60 suites
- **全部通过**

## 分值汇总

- 完整：42 / 88 (48%)
- 部分：23 / 88 (26%)
- 缺失：22 / 88 (25%)
- NOT_VERIFIED：1 / 88 (1%)

## 当前 P0 问题

- 无已知 P0 + BROKEN

## 当前 P1 问题

- 期间管理（已升级为完整：会计期间保护、Period Closing Core、Period Reopen）
- 月结/年结（Month Closing 已完整；Year-End Carry Forward 未实现）
- 凭证字 + 编号规则（部分）
- 凭证模板（缺失）
- 试算平衡表（已升级为完整：REPORT_VIEW；UI 补齐）
- 经营汇总（已升级为完整：与利润表共享计算；保留 AR/AP；无 UI）
- 利润表（已升级为完整：单月期间；REVENUE/EXPENSE；POSTED only）
- 资产负债表（已升级为完整：as-of 期间末累计；未结转损益虚拟行；equationValid 整数比较）
- 现金流量表（缺失）
- 往来对账（基础）
- 银行对账（基础）
- 资产变动/清理（基础）
- 人工记录/工序（基础）
- IQC/OQC/检验标准（部分）
- 联系人/跟进/活动（基础）
- 项目/任务/工时（基础）
- OA 请假/报销/审批流（基础）
- 预警规则/记录/处理（基础）
- 数据导入/导出（缺失）
- 文件上传/附件（缺失）

## 下一步候选

按优先级和依赖关系筛选，见本文档末尾候选列表。

## 候选列表

| # | 模块 | 功能 | 当前 | 优先级 | 依赖 | 备注 |
|---|------|------|------|--------|------|------|
| 1 | 报表 | 利润表 | 完整 | P1 | 凭证审核 ✅ + 期间结账 ✅ | 已完成 |
| 2 | 报表 | 资产负债表 | 完整 | P1 | 凭证审核 ✅ + 期间结账 ✅ | 本次实现 |
| 3 | 报表 | 现金流量表 | 缺失 | P2 | 凭证审核 ✅ + 期间结账 ✅ | 新增 |
| 4 | 财务 | 凭证字 + 编号规则 | 部分 | P1 | — | 已有表，编号规则未完善 |
| 5 | 财务 | Year-End / 年结 | NOT_VERIFIED | P1 | 期间结账 ✅ | 完整年结逻辑未实现 |

## Year-End 状态

- 期间结账（Month Closing）已实现并验证
- Year-End Carry Forward / 完整年结逻辑 NOT_VERIFIED，未在本阶段实现
- 后续重构任务应单独评估年结流程，不应与月结混淆
