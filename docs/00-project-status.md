# 项目状态快照

> 自动生成：2026-09-02(最终生产验收收口)

## 阶段与分支

- 阶段：Cloud Refactor Phase 2(Final Acceptance 完成)
- 分支：refactor/cloud-deployment
- 基准提交：a2e1f7e (docs: establish cloud refactor documentation)

## 当前生产验收状态

- **当前已验收生产候选**: `v0.9.10`
- **对应 commit**: `3064442 fix(accounting): expose period closing workflow`
- **最终验收文档**: `docs/07-production-acceptance.md`(已扩展 Phase C / D / E / F 综合结论,A / B 历史 evidence-locked 段落保留)
- **Phase A** — Deployment: PASS
- **Phase B** — Authentication / Permission: PASS(evidence-locked;来自 `v0.9.2` 历史 record,未被重写)
- **Phase C** — Master Data: PASS
- **Phase D** — Core ERP: PASS
- **Phase E** — Accounting: PASS
- **Phase F** — Operations / Recovery: PASS
- **FINAL PRODUCTION ACCEPTANCE = PASS**
- **READY FOR v1.0.0 RELEASE = YES**(`v1.0.0` tag 仍未创建)

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
| Supplier Schema Migration (v0.9.1 hotfix) | ✅ | 70df697 | 9 tests |
| Production UI Refinement (iOS-inspired) | ✅ | 6168cdd | 11 tests |
| **Phase A Production Acceptance (v0.9.2)** | ✅ | d33147b | 13 记录项 |
| **Phase B Production Acceptance (v0.9.2)** | ✅ | b59de70 | 12 记录项 + 95 focused tests |
| **Phase B Evidence Lock (v0.9.2)** | ✅ | d6394d8 | 11 user-confirmed production manual checks + 1 retained automated-only |
| **Phase D Hotfix (project + production permissions)** | ✅ | 3d1a973 | 21 regression tests |
| **Phase D Hotfix — Badge component repair** | ✅ | b8556f4 | 12 regression tests |
| **Phase D Follow-up — ProductionOrderModal render loop fix** | ✅ | 本提交 | 9 regression tests |
| **Phase D Hotfix — Project manager selector population** | ✅ | 7d3a3aa | 26 regression tests |
| **Phase E Hotfix — Manual voucher workflow + role-accounting VOUCHER_SUBMIT** | ✅ | 314a11d | 27 regression tests |
| **Phase E Hotfix — Manual voucher amount unit (yuan ↔ cents)** | ✅ | 本提交 | 39 regression tests |
| **Phase E Hotfix — Trial Balance filter (subject include + canonical period range + period write)** | ✅ | 本提交 | 21 regression tests |
| **Phase E Hotfix — Trial Balance closing/opening direction classification** | ✅ | 本提交 | 14 regression tests |
| **Phase E Final Hotfix — Period closing workflow UI exposure** | ✅ | 3064442 | 31 regression tests |
| **Final Production Acceptance (v0.9.10)** | ✅ | 本提交 | DOCS-ONLY 收口,A–F 全部 PASS |

## 当前测试状态

- 测试文件:server/app.test.js + server/voucher.test.js + server/period.test.js + server/income-statement.test.js + server/balance-sheet.test.js + server/financial-summary.test.js + server/production-safety.test.js + server/backup-restore.test.js + server/setup-admin.test.js + server/systemd.test.js + server/nginx.test.js + server/supplier-schema.test.js + server/ui-source.test.js + server/phase-d-hfix.test.js + server/badge-defect.test.js + server/phase-d-renderloop.test.js + server/project-manager.test.js + server/phase-e-accounting.test.js + server/voucher-amount-units.test.js + server/trial-balance.test.js + server/period-ui.test.js
- **406 tests / 104 suites**(基线 375 / 99 + Final Hotfix 新增 31 / 5)
- **全部通过**

## Production Acceptance Status(更新)

- **Release**: `v0.9.10`
- **Commit**: `3064442`
- **Phase A — Deployment Baseline**: ✅ PASS(详见 `docs/07-production-acceptance.md`)
- **Phase B — Authentication & Permission**: ✅ **`PASS — EVIDENCE LOCKED`**(来自 `v0.9.2` 历史 record,未被重写)
- **Phase C — Master Data CRUD**: ✅ PASS
- **Phase D — Core ERP**: ✅ PASS
- **Phase E — Accounting**: ✅ PASS
- **Phase F — Operations / Recovery**: ✅ PASS
- **FINAL PRODUCTION ACCEPTANCE = PASS**
- **READY FOR v1.0.0 RELEASE = YES**(未创建 `v1.0.0` tag)

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
