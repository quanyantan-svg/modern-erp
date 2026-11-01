# G0 文档迁移映射表

> 状态：`ACTIVE`（G0 迁移证据）
> Owner：Platform
> 权威来源：本文是**迁移追溯索引**，不改变任何业务合同
> 来源：源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`（`master` 基线）

## 1. 处置类型

- `REQUIREMENT` — 当前有效 Requirement 正文（迁入 `docs/requirements/`）
- `ACCEPTANCE_FREEZE` — 验收 / 冻结证据（迁入 `docs/acceptance/`）
- `STATUS` — 当前项目状态（迁入 `docs/status/`）
- `IMPLEMENTATION_EVIDENCE` — 实施记录 / 证据（迁入 `docs/acceptance/`）
- `ARCHIVED_STALE_STATUS` — 过期状态快照（迁入 `docs/archive/status/`）
- `DESIGN` — 当前有效 Design 正文（迁入 `docs/design/`）
- `ARCHIVED_SUPERSEDED_DESIGN` — 被取代的历史设计（迁入 `docs/archive/design/`）
- `FROZEN_BASELINE` — 冻结技术基线声明（保留在 `docs/design/`，与正文同文件）

## 2. 逐章节映射

| 源文件 | 原章节 | 源行 | 源 SHA | 处置 | 目标文件 | 内容 SHA-256(前16) |
|---|---|---|---|---|---|---|
| `document.md` | 26. Core Scope Cleanup Implementation Acceptance Criteria | 1052-1199 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/core-scope-cleanup.md` | `f8b44117c71e82ed` |
| `document.md` | 27. Domain Alignment Requirement（8 Domains + Platform） | 1200-1283 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/domain-alignment.md` | `40d687faebfddf9f` |
| `document.md` | 28. Master & Engineering Domain Closure Requirement | 1284-1490 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/master-engineering.md` | `c15f02285608203a` |
| `document.md` | 29. Manufacturing & Quality Domain Closure Requirement | 1491-1726 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/manufacturing-quality.md` | `6bc330454da382a0` |
| `document.md` | 30. Planning Domain Closure Requirement | 1727-1861 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/planning.md` | `246aef16b6fb837a` |
| `document.md` | 31. Procurement & Outsourcing Domain Closure Requirement | 1862-2433 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/procurement-outsourcing.md` | `04336c4d943c806d` |
| `document.md` | 32. Inventory & Warehouse Domain Closure Requirement | 2434-3015 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/inventory-warehouse.md` | `c559b9046b011e45` |
| `document.md` | 33. Finance Operations Domain Closure Requirement | 3016-4429 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/finance-operations.md` | `96b8e00054d00918` |
| `document.md` | 34. Sales & Customer Domain Closure Requirement | 4430-6130 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/01-domain-closure.md` | `b7ced166169a5212` |
| `document.md` | Wave 8 Stage B — Bounded Business Decisions & Cross-Domain Contract Reopen | 6131-6291 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/02-wave-8-amendments.md` | `1ef98a7f2b655db9` |
| `document.md` | Wave 8 Stage B — User Decision Approval Record | 6292-6317 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/wave-8-user-decision-approval.md` | `d6d4f45d0581877e` |
| `document.md` | Wave 8 Stage B — V21 Historical Position Evidence Amendment | 6318-6433 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/02-wave-8-amendments.md` | `1304d5039f54d70e` |
| `document.md` | Wave 8 Stage D — Implemented Capability Coverage Record | 6434-6451 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/wave-8-stage-d-coverage-record.md` | `869eab6c9de31948` |
| `document.md` | Wave 8 Residual Requirement Amendment — R1/R2/R3 (2026-10-21) | 6452-6679 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/02-wave-8-amendments.md` | `a377a4d1fc4a919d` |
| `document.md` | Wave 8 Final Closure — SALES Warehouse/Bin Reference Access Requirement Amendment (2026-10-21) | 6680-6804 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/02-wave-8-amendments.md` | `8c69139a8fbd28c3` |
| `document.md` | Wave 8 Final Acceptance and Freeze Record (2026-10-21) | 6805-6860 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/wave-8-final-acceptance-and-freeze.md` | `d432e4b51f389521` |
| `document.md` | Stage B Requirement Applicability Closure — Sales Credit Waves 9–11 (2026-10-22) | 6861-7401 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/03-wave-9-amendments.md` | `7921bf0f654bf19a` |
| `document.md` | 35. 当前项目状态快照（2026-10-31） | 7402-7663 | `4cb8c477aa00` | `STATUS` | `docs/status/PROJECT_STATUS.md` | `1ba26cb0b50aebb6` |
| `document.md` | Stage B Requirement Amendment — Sales Credit Profile Authorization Policy (Wave 9) (2026-10-22) | 7664-8095 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/03-wave-9-amendments.md` | `130d0fe339b1f7eb` |
| `document.md` | Stage B Requirement Amendment — Global Credit Configuration Authority (Wave 9) (2026-10-22) | 8096-8455 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/03-wave-9-amendments.md` | `9b2dfe488f7b5473` |
| `document.md` | Wave 9 Final Acceptance and Freeze Record (2026-10-23) | 8456-8525 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/wave-9-final-acceptance-and-freeze.md` | `f2403661c8dd72fb` |
| `document.md` | Gate A Final Acceptance and Freeze Record (2026-10-24) | 8526-8623 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/gate-a-acceptance-and-freeze.md` | `1b83c6b93f98dfea` |
| `document.md` | Wave 10 Precondition Requirement Reconciliation (2026-10-24) | 8624-9134 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/04-wave-10-amendments.md` | `9f821b04e87ed495` |
| `document.md` | Wave 10 B-9 / B-10 / S14 Bounded Requirement Amendment (2026-10-24) | 9135-9240 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/04-wave-10-amendments.md` | `5c6c4f5a58730bc4` |
| `document.md` | Wave 10 MySQL Acceptance Infrastructure Remediation Requirement (2026-10-25) | 9241-9479 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/04-wave-10-amendments.md` | `49a2d9ec1e3c1574` |
| `document.md` | Wave 10 MySQL least-privilege readiness and Finance View parity requirement (2026-10-25) | 9480-9542 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/04-wave-10-amendments.md` | `68fa77b1d3fd408a` |
| `document.md` | Wave 10 Gate B OQC quality-policy fixture Requirement (2026-10-26) | 9543-9733 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/04-wave-10-amendments.md` | `8e7213714f0b4567` |
| `document.md` | Wave 10 M-R09 Credit capacity contract Requirement (2026-10-26) | 9734-9906 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/04-wave-10-amendments.md` | `e987afa0c69f71af` |
| `document.md` | Wave 10 CHECK clause parity normalization Requirement (2026-10-26) | 9907-10169 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/04-wave-10-amendments.md` | `7b08602f8175a346` |
| `document.md` | Wave 10 Full Acceptance blocker Requirement (2026-10-27) | 10170-10789 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/04-wave-10-amendments.md` | `c2320a2b3d0c6534` |
| `document.md` | Wave 10 Parity Oracle Requirement Addendum (2026-10-27) | 10790-11118 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/04-wave-10-amendments.md` | `dcecb9e60f90b477` |
| `document.md` | Wave 10 Inventory Fixture Requirement (2026-10-27) | 11119-11489 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/04-wave-10-amendments.md` | `9741e72e5cde293e` |
| `document.md` | Wave 10 Capability Freeze (2026-10-27) | 11490-11615 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/wave-10-capability-freeze.md` | `13a4e57353e58a86` |
| `document.md` | Package B — Local Test Backend Isolation Requirement (2026-10-27) | 11616-11859 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/04-wave-10-amendments.md` | `51542f530a408826` |
| `document.md` | Package B — Local Test Backend Isolation Final Acceptance and Capability Closure (2026-10-27) | 11860-11982 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/package-b-final-acceptance.md` | `435b01496fe01be5` |
| `document.md` | Wave 11 — Sales & Customer Credit Evaluation / Reconciliation / Query — Stage B Requirement Closure (2026-10-27) | 11983-12646 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/05-wave-11-amendments.md` | `54205a5dbbd6b46b` |
| `document.md` | W11-SEC-01 — Credit Read Scope Final Acceptance and Capability Freeze Record (2026-10-28) | 12647-12791 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/w11-sec-01-acceptance-and-freeze.md` | `12d68377c7838938` |
| `document.md` | W11-A U1 — Read Primitives Final Acceptance and Bounded Freeze Record (2026-10-28) | 12792-12938 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/w11-a-u1-acceptance-and-freeze.md` | `12868c485537e55c` |
| `document.md` | W11-A U2 — Bounded Requirement Correction after Pre-E3 Semantic Parity Verification (2026-10-28) | 12939-13140 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/05-wave-11-amendments.md` | `9b811ca6923f2bcf` |
| `document.md` | W11-A U2 E3 — Cross-Engine Credit Policy Hash Contract Requirement Correction (2026-10-29) | 13141-13300 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/05-wave-11-amendments.md` | `c2761bb72ccac674` |
| `document.md` | W11-A U2 — ONE_TIME 特别审批消费与 Replay 语义更正 Requirement（2026-10-29） | 13301-13454 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/05-wave-11-amendments.md` | `48b888810b68af27` |
| `document.md` | W11-A U2 — Credit Query / Exception History Final Acceptance and Capability Freeze Record (2026-10-29) | 13455-13833 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/w11-a-u2-acceptance-and-freeze.md` | `e997fdab7c94270f` |
| `document.md` | W11-A OVERDUE Evidence Foundation — Bounded Requirement Amendment (2026-10-29) | 13834-14015 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/05-wave-11-amendments.md` | `cc0aef28fd3e755a` |
| `document.md` | W11-A OVERDUE Evidence Foundation Final Acceptance and Capability Freeze Record (2026-10-29) | 14016-14134 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/w11-a-overdue-acceptance-and-freeze.md` | `454febba4c3fa0ed` |
| `document.md` | W11-A U3-0 Credit Query Mobile UI — Bounded Requirement Amendment (2026-10-29) | 14135-14320 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/05-wave-11-amendments.md` | `29b0db2838734b35` |
| `document.md` | W11-A U3-A Query Options — Implementation Checkpoint and U3-B Whitelist Block (2026-10-29) | 14321-14369 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/w11-a-u3-a-checkpoint.md` | `ed1a36199ff2f47e` |
| `document.md` | W11-A U3 Selector Protected MySQL Gate — Bounded Requirement Amendment (2026-10-30) | 14370-14522 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/05-wave-11-amendments.md` | `b869e887f998443c` |
| `document.md` | W11-A U3 Selector Protected MySQL Gate — Implementation Evidence (2026-10-30) | 14523-14622 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/w11-a-u3-implementation-evidence.md` | `1d6bbf0dcf2ca5da` |
| `document.md` | W11-A U3 Search Semantics Closure — Bounded Requirement Amendment (2026-10-30) | 14623-14760 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/05-wave-11-amendments.md` | `a1439240acac9256` |
| `document.md` | W11-A U3 Search Semantics — Final Bounded Design Correction, Requirement Amendment (2026-10-30) | 14761-14910 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/05-wave-11-amendments.md` | `879f58f4fb55bbff` |
| `document.md` | W11-A U3 Search Semantics — Implementation Gate Finding (2026-10-30) | 14911-14942 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/w11-a-u3-implementation-evidence.md` | `32c18793955fe08e` |
| `document.md` | W11-A U3 / Wave 9 Exact Additive Schema Compatibility — Requirement Amendment (2026-10-30) | 14943-15098 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/05-wave-11-amendments.md` | `8f2cb138cdc5ac86` |
| `document.md` | W11-A U3 / Wave 9 Exact Additive Schema Compatibility — Implementation Result (2026-10-30) | 15099-15132 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/w11-a-u3-implementation-evidence.md` | `9c6d3396e012cf9a` |
| `document.md` | W11-A U3 FAST Dual-Blocker Closure — Bounded Requirement Amendment (2026-10-30) | 15133-15349 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/05-wave-11-amendments.md` | `75652ceb253f2f07` |
| `document.md` | W11-A U3 FAST Dual-Blocker Closure — Implementation Evidence (2026-10-30) | 15350-15545 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/05-wave-11-amendments.md` | `16f904f6ca53644b` |
| `document.md` | W11-A U3 Final Acceptance Readiness — Bounded Residual Risk Requirement Amendment (2026-10-30) | 15546-15670 | `4cb8c477aa00` | `REQUIREMENT` | `docs/requirements/sales-customer/05-wave-11-amendments.md` | `7bb3c15327ae4987` |
| `document.md` | W11-A U3 Demo Seed Inventory MySQL Gate — Implementation Result, Residual Acceptance and Historical Disposition (2026-10-31) | 15671-15756 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/w11-a-u3-demo-seed-gate-result.md` | `6da762cf83add872` |
| `document.md` | W11-A U3 Freeze Registration (2026-10-31) | 15757-15837 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/w11-a-u3-freeze-registration.md` | `954c1899b3d2a7b8` |
| `solution.md` | 21. 当前设计状态 | 1166-1177 | `4cb8c477aa00` | `ARCHIVED_STALE_STATUS` | `docs/archive/status/solution-md-design-status-2026-10-06.md` | `936b5892db9c9e8d` |
| `solution.md` | 21. Core Scope Cleanup Implementation Design | 1178-1489 | `4cb8c477aa00` | `DESIGN` | `docs/design/core-scope-cleanup.md` | `79d68361c965b3eb` |
| `solution.md` | 22. Domain Alignment Design（8 Domains + Platform） | 1490-1628 | `4cb8c477aa00` | `DESIGN` | `docs/design/domain-alignment.md` | `27238a71c08c1318` |
| `solution.md` | 23. Master & Engineering Domain Technical Design | 1629-1998 | `4cb8c477aa00` | `DESIGN` | `docs/design/master-engineering.md` | `2ab2546f485ff591` |
| `solution.md` | 24. Manufacturing & Quality Domain Technical Design | 1999-2397 | `4cb8c477aa00` | `DESIGN` | `docs/design/manufacturing-quality.md` | `686790b5ab93ee3b` |
| `solution.md` | 25. Planning Domain Technical Design | 2398-2584 | `4cb8c477aa00` | `DESIGN` | `docs/design/planning.md` | `eddd420d69dabcbc` |
| `solution.md` | 26. Procurement & Outsourcing Domain Technical Design | 2585-3961 | `4cb8c477aa00` | `DESIGN` | `docs/design/procurement-outsourcing.md` | `a9f665369308eca2` |
| `solution.md` | 27. Inventory & Warehouse Domain Technical Design | 3962-5955 | `4cb8c477aa00` | `DESIGN` | `docs/design/inventory-warehouse.md` | `10102388f47b4d1e` |
| `solution.md` | 28.0 Scope of This Section | 5956-5983 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `0b4d9dd5771e7162` |
| `solution.md` | 28.1 Architecture & Ownership | 5984-6257 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `ffe18b0e19f462d8` |
| `solution.md` | 28.2 Recognition State Model | 6258-6338 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `0168c19f7ebbf02c` |
| `solution.md` | 28.3 Canonical AR / AP Open-Item Model (MODEL B — Canonical Source Facts) | 6339-6858 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `3c885ff6ee673595` |
| `solution.md` | 28.4 Due-Schedule Model (FO04) | 6859-6932 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `227978f6c5edb0d1` |
| `solution.md` | 28.5 Provisional Model (FO11 / FO12 / FO13) | 6933-6974 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `c21ce43980441e49` |
| `solution.md` | 28.6 Settlement / Allocation Model (FO16–FO22) | 6975-7027 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `b2962822edf5f9ae` |
| `solution.md` | 28.7 Unapplied Balance Model (FO23–FO26) | 7028-7072 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `3af8fc311b8af9f5` |
| `solution.md` | 28.8 Write-Off / Bad Debt (FO27 / FO28) | 7073-7116 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `0ad3340cdf1a14cf` |
| `solution.md` | 28.9 Counterparty Transfer (FO15) | 7117-7168 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `d3c057095725280d` |
| `solution.md` | 28.10 Invoice Model (FO29–FO36) | 7169-7364 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `cf37ab1c101eb541` |
| `solution.md` | 28.11 Treasury Movement Model (FO37–FO45) | 7365-7564 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `7b14dfecce397d02` |
| `solution.md` | 28.12 Bank Statement / Reconciliation (FO46–FO49) | 7565-7641 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `0e181774c0f59b52` |
| `solution.md` | 28.13 Business Close (FO51 / FO52 / FO53) | 7642-7765 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `1c0aff41a3051fbf` |
| `solution.md` | 28.14 Integration Adapters | 7766-7816 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `4039bdfebdc71746` |
| `solution.md` | 28.15 Permission Model | 7817-7899 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `f9f0051e524c09aa` |
| `solution.md` | 28.16 API / Route Architecture | 7900-7971 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `2ecf2bf09ca6f8ee` |
| `solution.md` | 28.17 Mobile Information Architecture | 7972-8007 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `91313e24da52cccb` |
| `solution.md` | 28.18 Migration / Convergence Strategy | 8008-8122 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `36c0d2fef4d166f6` |
| `solution.md` | 28.19 Transaction / Locking Model | 8123-8189 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `05b9b94d2a733aa0` |
| `solution.md` | 28.20 MySQL Race Design (15) | 8190-8223 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `bcac6ed79a77ca2f` |
| `solution.md` | 28.21 UAT Traceability (32) | 8224-8285 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `149adc99a688201b` |
| `solution.md` | 28.22 Capability Traceability (58) | 8286-8350 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `5ae7cd076215c52a` |
| `solution.md` | 28.23 Implementation Waves (5, fixed) | 8351-8543 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `c659d07f8cb969db` |
| `solution.md` | 28.24 Compatibility / Normalization vs Older Sections | 8544-8573 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `436b4b175f51470b` |
| `solution.md` | 28.25 Testing Strategy | 8574-8630 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `530b15b3a893ab2f` |
| `solution.md` | 28.26 Audit / Transaction / Error | 8631-8658 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `11d26d8b3f1066cc` |
| `solution.md` | 28.27 Rollback Strategy | 8659-8673 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `bcb77dcf590a301f` |
| `solution.md` | 28.28 Final Acceptance | 8674-8697 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `9086938a00ce42e7` |
| `solution.md` | 28.29 Cross-References | 8698-8731 | `4cb8c477aa00` | `DESIGN` | `docs/design/finance-operations.md` | `fd28acf01cdbb1c9` |
| `solution.md` | 29. Sales & Customer Domain Technical Design | 8732-13872 | `4cb8c477aa00` | `DESIGN` | `docs/design/sales-customer/01-domain-technical-design.md` | `e455427918e8728b` |
| `solution.md` | 30. Sales & Customer Domain Implementation Wave Plan | 13873-14592 | `4cb8c477aa00` | `DESIGN` | `docs/design/sales-customer/02-wave-plan.md` | `60109ee5aa101f4e` |
| `solution.md` | 30.26 Final Wave-Plan Summary | 14593-15112 | `4cb8c477aa00` | `DESIGN` | `docs/design/sales-customer/02-wave-plan.md` | `171ee95688f6461b` |
| `solution.md` | 31. Sales & Customer Domain Implementation — Wave 0 | 15113-15183 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/wave-0-2-implementation-records.md` | `a9c00aa88206b9e2` |
| `solution.md` | 32. Sales & Customer Domain Implementation — Wave 1 Commercial Foundation | 15184-15289 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/wave-0-2-implementation-records.md` | `f8b6fc550a640534` |
| `solution.md` | 33. Sales & Customer Domain Implementation — Wave 2 Pricing and Order-Time Discount | 15290-15343 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/wave-0-2-implementation-records.md` | `fbe249837c605913` |
| `solution.md` | 34. Sales & Customer Domain Implementation — Batch A (Waves 3–5) Mapping | 15344-15651 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/batch-a-implementation-mapping.md` | `4856562c63eb278e` |
| `solution.md` | 35. Sales & Customer Wave 8 — Stage C Design Closure (2026-10-19) | 15652-17275 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-8-stage-c-design-closure.md` | `c21132c9911efb7b` |
| `solution.md` | 35.20 Wave 8 Stage D — Actual Implementation Evidence | 17276-17419 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/wave-8-stage-d-implementation-evidence.md` | `ec7645c7bb514d4f` |
| `solution.md` | 35.22 Wave 8 Residual Stage C Technical Design (2026-10-21) | 17420-17771 | `4cb8c477aa00` | `DESIGN` | `docs/design/sales-customer/03-wave-8-baseline.md` | `53f02d47f4d5361f` |
| `solution.md` | 35.23 Wave 8 SALES Warehouse/Bin Reference Access — Bounded Stage C Design (2026-10-21) | 17772-18071 | `4cb8c477aa00` | `DESIGN` | `docs/design/sales-customer/03-wave-8-baseline.md` | `067d6f1155bf07cb` |
| `solution.md` | 35.24 Wave 8 B5 Return Reference Conflict — Bounded Stage C Correction (2026-10-21) | 18072-18250 | `4cb8c477aa00` | `DESIGN` | `docs/design/sales-customer/03-wave-8-baseline.md` | `4ff5ff7bffe7040a` |
| `solution.md` | 35.25 Wave 8 Final Bounded Stage D implementation verification record | 18251-18312 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/wave-8-stage-d-verification-and-p1-remediation.md` | `6b7ae56637a47cfb` |
| `solution.md` | 35.26 Wave 8 Two-P1 bounded remediation implementation record | 18313-18377 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/wave-8-stage-d-verification-and-p1-remediation.md` | `a9a3df74b3a9a926` |
| `solution.md` | 35.27 Wave 8 final accepted technical baseline and freeze | 18378-18445 | `4cb8c477aa00` | `FROZEN_BASELINE` | `docs/design/sales-customer/03-wave-8-baseline.md` | `58f1a7bfff692de1` |
| `solution.md` | 36. Sales & Customer Credit — Stage C Combined Design Reconciliation (Waves 9–11, 2026-10-22) | 18446-21562 | `4cb8c477aa00` | `DESIGN` | `docs/design/sales-customer/04-wave-9-credit-baseline.md` | `0b6120bba57da907` |
| `solution.md` | 36.16 Wave 9 final accepted technical baseline and freeze (2026-10-23) | 21563-21623 | `4cb8c477aa00` | `FROZEN_BASELINE` | `docs/design/sales-customer/04-wave-9-credit-baseline.md` | `4791d2c683600c31` |
| `solution.md` | 37. W7-C1 / W7-C2′ Bounded Design Amendment (2026-10-23) | 21624-22407 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `a19883d838d1765b` |
| `solution.md` | 37.15 Design Evidence Correction (2026-10-23) | 22408-22840 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `e523344b59d4ea03` |
| `solution.md` | 37.22 Design Precision Closure (2026-10-23) | 22841-23027 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `b7499d446737f750` |
| `solution.md` | 37.28 F1 Manual Gate retry-exhaustion API contract precision (2026-10-23) | 23028-23097 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `7f3294b55516753b` |
| `solution.md` | 37.29 F2 retry-admission budget Design Precision (2026-10-24) | 23098-23345 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `7b06e2c26accec4a` |
| `solution.md` | 37.30 Transaction-Start Named-Lock Safety Hotfix Design (2026-10-24) | 23346-23915 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `331033a8ca498495` |
| `solution.md` | 37.31 Transaction Lifecycle Safety Final Design Amendment (2026-10-24) | 23916-24830 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `74d2b7dbbc7b0e46` |
| `solution.md` | 37.32 F2 Implementation-Status Factual Clarification (2026-10-24) | 24831-24898 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/f2-implementation-status-clarification.md` | `0768137be1f4a316` |
| `solution.md` | 37.33 Gate A Final Acceptance and Freeze Record (2026-10-24) | 24899-24969 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/gate-a-acceptance-and-freeze.md` | `e488bcc8ae49ea3b` |
| `solution.md` | 37.34 Wave 10 Precondition, Gate B Downstream Contract and §1–#15 Design Status (2026-10-24) | 24970-25436 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `6ef7dce84953579f` |
| `solution.md` | 37.35 Wave 10 Implementation Record (2026-10-24) | 25437-25660 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/wave-10-implementation-records.md` | `d8e7be1dd9914fc4` |
| `solution.md` | 37.36 Wave 10 B-9 / B-10 / S14 Bounded Remediation Design (2026-10-24) | 25661-25872 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `eef3348486b8a7d2` |
| `solution.md` | 37.37 Wave 10 B-9 / B-10 / S14 Bounded Implementation Record (2026-10-24) | 25873-25960 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/wave-10-implementation-records.md` | `bfc5ab532cd015b7` |
| `solution.md` | 37.38 Wave 10 MySQL Acceptance Infrastructure Implementation Record (2026-10-25) | 25961-26048 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/wave-10-implementation-records.md` | `8f073ad45a61ea35` |
| `solution.md` | 37.39 Wave 10 MySQL Acceptance Infrastructure Remediation Design (2026-10-25) | 26049-26719 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `75108bd28f354144` |
| `solution.md` | 37.40 Wave 10 MySQL Acceptance Infrastructure Remediation Implementation Record (2026-10-25) | 26720-26856 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/wave-10-implementation-records.md` | `c2456f0005d4d3a3` |
| `solution.md` | 37.41 Wave 10 MySQL least-privilege readiness and Finance View parity design (2026-10-25) | 26857-26928 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `3ee698e6313a2127` |
| `solution.md` | 37.42 Wave 10 MySQL least-privilege readiness implementation record (2026-10-25) | 26929-27166 | `4cb8c477aa00` | `IMPLEMENTATION_EVIDENCE` | `docs/acceptance/sales-customer/wave-10-implementation-records.md` | `a54556fae703bcaf` |
| `solution.md` | 37.43 Wave 10 MySQL Acceptance blocker local remediation (2026-10-25) | 27167-27338 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `58967f678e7059c8` |
| `solution.md` | 37.44 Wave 10 independent review P1 correction (2026-10-25) | 27339-27503 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `c3e368b865814658` |
| `solution.md` | 37.45 Wave 10 independent review follow-up — bounded index contract correction (2026-10-25) | 27504-27645 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `f334a263afb45bb8` |
| `solution.md` | 37.46 Wave 10 Gate B OQC quality-policy fixture design (2026-10-26) | 27646-28082 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `20adef7f1095b548` |
| `solution.md` | 37.47 Wave 10 M-R09 credit-capacity contract design (2026-10-26) | 28083-28333 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `032c725349dd655d` |
| `solution.md` | 37.48 Wave 10 CHECK clause parity normalization design (2026-10-26) | 28334-28608 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `6cd8df1cb3ee5354` |
| `solution.md` | 37.49 Wave 10 Final Acceptance blocker consolidated design (2026-10-27) | 28609-29169 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `df48fbf4d26bea94` |
| `solution.md` | 37.50 Wave 10 Parity Oracle correctness design (2026-10-27) | 29170-29578 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `ae71e7a3e303cdc9` |
| `solution.md` | 37.51 Wave 10 Inventory Fixture canonical seeding design (2026-10-27) | 29579-30083 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `ac91bad5e26212b2` |
| `solution.md` | 37.52 Wave 10 Capability Freeze (2026-10-27) | 30084-30147 | `4cb8c477aa00` | `ACCEPTANCE_FREEZE` | `docs/acceptance/sales-customer/wave-10-capability-freeze.md` | `48f920a0922eba3e` |
| `solution.md` | 37.53 Package B — Local Test Backend Isolation Design (2026-10-27) | 30148-30561 | `4cb8c477aa00` | `ARCHIVED_SUPERSEDED_DESIGN` | `docs/archive/design/sales-customer/wave-10-and-boundary-design-amendments.md` | `3ac66642c94e2541` |
| `solution.md` | 37.54 Wave 11 — Sales & Customer Credit Evaluation / Reconciliation / Query — Stage C Design Closure (2026-10-27) | 30562-40716 | `4cb8c477aa00` | `DESIGN` | `docs/design/sales-customer/05-wave-11-stage-c.md` | `b6ed687647dc820c` |

## 3. 完整性规则

- 本表覆盖 `document.md` 与 `solution.md` 的**全部** H2 章节（除保留在原文件中的全局章节）。
- 每个被迁移章节的正文均**逐字保留**；迁移不删除、不改写、不合并任何业务合同文本。
- 原文字节级证据保留在 Git 历史 `4cb8c477aa00988bbfebef905764565cdfe62b71`（`git show 4cb8c477aa00988bbfebef905764565cdfe62b71:document.md` / `:solution.md`）。
- 章节编号在目标文件中原样保留，深引用（如 `§31.12`、`§37.54.48`）继续可定位。
