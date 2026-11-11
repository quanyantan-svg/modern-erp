# 采购与委外域级验收证据（2026-11-11）

> **用途**：本目录保存采购与委外域级 Acceptance（2026-11-11）的**原始证据**文件。
> **Owner**：Procurement & Outsourcing Domain Owner（验收决定）；Platform / QA（证据维护）。
> **权威来源**：验收与冻结记录 [`docs/acceptance/procurement-outsourcing-domain-acceptance-20261111.md`](../../acceptance/procurement-outsourcing-domain-acceptance-20261111.md)；项目状态以 [`docs/status/PROJECT_STATUS.md`](../../status/PROJECT_STATUS.md) §51 为准。
> **边界**：本目录是**证据**，不是合同、需求或状态的权威来源。

## 目录

| 文件 | 内容 |
|---|---|
| `g07-outsourcing-wip-identity-effects-catalogue-capture.json` | `outsourcing_wip_identity_effects` 的**真实 MySQL 目录 CHECK 条款**只读观测结果 |

## 观测来源

| 项 | 值 |
|---|---|
| 观测方式 | 受保护 disposable MySQL 上对 `information_schema.CHECK_CONSTRAINTS` 的**只读** `SELECT` |
| 关联 Gate | M1C-G07 真实 MySQL Gate，run `b9023437-4030-46f2-b469-0a08396bd7f6` |
| 关联 commit | `9a4ccbb` |
| 目标 | `mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test` |
| 服务端版本 | MySQL 8.0.37（server uuid `256c7a4e-d275-11f1-885b-b025aa71d167`） |
| 观测时间 | 2026-11-11T11:02:23.775Z |

该观测用于更新 G07 离线对等回放使用的**目录条款捕获值**：期初委外使
`outsourcing_wip_identity_effects.event_type` 的 CHECK 增加 `'OPENING'`，原捕获值
（2026-11-07 的真实运行）随之失效。捕获值**只**来自真实 MySQL 8 运行，不得由推测或
手写得到；断言与检查器均未因此被削弱或改写。

该文件不含口令、令牌或其他机密。
