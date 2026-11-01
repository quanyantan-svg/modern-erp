# Sales & Customer — 验收与冻结证据索引

> 状态：`HISTORICAL_EVIDENCE`
> Owner：Sales & Customer
> 权威来源：**无** —— 能力合同的权威来源是
> [`docs/requirements/sales-customer/`](../../requirements/sales-customer/) 与
> [`docs/design/sales-customer/`](../../design/sales-customer/)；
> 当前进度与阻塞项是 [`docs/status/PROJECT_STATUS.md`](../../status/PROJECT_STATUS.md)。

## 目录

| 文件 | 原章节 | 类型 | 关键标识 |
|---|---|---|---|
| `wave-8-user-decision-approval.md` | Wave 8 Stage B — User Decision Approval Record | Acceptance / Freeze | Wave 8 用户业务决策批准 |
| `wave-8-stage-d-coverage-record.md` | Wave 8 Stage D — Implemented Capability Coverage Record | Acceptance / Freeze | Wave 8 覆盖登记 |
| `wave-8-stage-d-implementation-evidence.md` | §35.20 | 实施证据 | Wave 8 Stage D 实施 |
| `wave-8-stage-d-verification-and-p1-remediation.md` | §35.25、§35.26 | 实施证据 | Stage D 验证与 P1 整改 |
| `wave-8-final-acceptance-and-freeze.md` | Wave 8 Final Acceptance and Freeze Record | Acceptance / Freeze | `WAVE8_FINAL_ACCEPTANCE_PASS` |
| `wave-9-final-acceptance-and-freeze.md` | Wave 9 Final Acceptance and Freeze Record | Acceptance / Freeze | `SALES CREDIT WAVE 9 — FINAL_ACCEPTANCE_PASS / FROZEN` |
| `gate-a-acceptance-and-freeze.md` | Gate A Final Acceptance and Freeze Record（Requirement 侧）、§37.33（Design 侧） | Acceptance / Freeze | `GATE_A_MYSQL_CAMPAIGN_PASS` |
| `wave-10-capability-freeze.md` | Wave 10 Capability Freeze（Requirement 侧）、§37.52（Design 侧） | Acceptance / Freeze | `WAVE10_FULL_ACCEPTANCE_PASS` / `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED` |
| `wave-10-implementation-records.md` | §37.35、§37.37、§37.38、§37.40、§37.42 | 实施证据 | Wave 10 实施记录（含 §37.40.8 canonical-writer 合同） |
| `package-b-final-acceptance.md` | Package B — Local Test Backend Isolation Final Acceptance and Capability Closure | Acceptance / Freeze | Package B 测试隔离闭合 |
| `w11-sec-01-acceptance-and-freeze.md` | W11-SEC-01 Final Acceptance and Capability Freeze Record | Acceptance / Freeze | `W11-SEC-01` 能力冻结 |
| `w11-a-u1-acceptance-and-freeze.md` | W11-A U1 Final Acceptance and Bounded Freeze Record | Acceptance / Freeze | W11-A U1 限定范围冻结 |
| `w11-a-u2-acceptance-and-freeze.md` | W11-A U2 Credit Query / Exception History Final Acceptance and Capability Freeze Record | Acceptance / Freeze | W11-A U2 冻结 |
| `w11-a-overdue-acceptance-and-freeze.md` | W11-A OVERDUE Evidence Foundation Final Acceptance and Capability Freeze Record | Acceptance / Freeze | OVERDUE 基础冻结 |
| `w11-a-u3-a-checkpoint.md` | W11-A U3-A Query Options — Implementation Checkpoint and U3-B Whitelist Block | 实施证据 | U3-A 检查点与白名单阻塞 |
| `w11-a-u3-implementation-evidence.md` | §W11-A U3 Selector Gate / Search Semantics Gate Finding / Schema Compatibility Implementation Result / FAST Dual-Blocker Implementation Evidence | 实施证据 | U3 实施证据集 |
| `w11-a-u3-demo-seed-gate-result.md` | W11-A U3 Demo Seed Inventory MySQL Gate — Implementation Result, Residual Acceptance and Historical Disposition | 实施证据 | Demo Seed 门禁结果 |
| `w11-a-u3-freeze-registration.md` | W11-A U3 Freeze Registration | Acceptance / Freeze | U3 冻结登记 |
| `wave-0-2-implementation-records.md` | §31、§32、§33 | 实施证据 | Wave 0/1/2 实施记录 |
| `batch-a-implementation-mapping.md` | §34 | 实施证据 | Batch A（Waves 3–5）实施映射 |
| `f2-implementation-status-clarification.md` | §37.32 | 实施证据 | F2 实施状态事实更正 |
| `wave-capability-and-gate-evidence.md` | `README.md` 的 Wave 8 / Gate A / Wave 10 章节 | 实施证据 | 能力实现面、API、测试入口与 MySQL 门禁操作性说明 |

## 尚未冻结的项

- **W11-A 整包 Acceptance**（`W11_A_ACCEPTANCE_PASS`）**仍未签发** —— 签发是业务所有者的独立决定；
  见 `PROJECT_STATUS.md` §35.6 与 §35.11.4。
- **W11-B / W11-C / W11-D** 尚未实现；`D-2`…`D-5` 仍是开放设计决策。
- **Procurement & Outsourcing** Domain Acceptance 仍为 `NOT READY`；M1 的 13 个 Gate 全部 `NOT_RUN`。
