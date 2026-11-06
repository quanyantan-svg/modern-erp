# M1-Core G07 正式 Owner Acceptance（2026-11-07）

> 用途：登记业务所有者对 `M1C-G07` 的正式 Acceptance 决定，签发 `M1C-G07 PASS`。
> Owner：Procurement & Outsourcing Domain Owner（正式验收决定）；Platform / Database Safety / QA（技术证据维护）。
> 状态：`APPROVED` —— 业务所有者已在本轮明确批准，`M1C-G07 PASS` 已签发。
> 权威来源：Requirement `docs/requirements/procurement-outsourcing.md` §31.13.5、Active Design
> `docs/design/procurement-outsourcing-m1-core.md` §13.1、单次真实 MySQL 执行与候审证据
> [`m1-core-g07-parity-r4-review-20261106.md`](./m1-core-g07-parity-r4-review-20261106.md)、
> [`m1-core-g07-final-fix-review-20261106.md`](./m1-core-g07-final-fix-review-20261106.md)。
> 本文是验收证据，不替代 Requirement、Design 或 `docs/status/PROJECT_STATUS.md`。

## 1. Owner 决定

业务所有者于 **2026-11-07** 在本轮对话中明确批准：

```text
M1C-G07 PASS
```

### 1.1 执行锚点

| 项 | 值 |
|---|---|
| 验收对象 | `M1C-G07`（真实 MySQL 8 并发与对等：Schema Parity、CR-01～CR-09、Supplemental Oracle） |
| Acceptance 标识 | `M1C-G07 PASS` |
| 决定性质 | **业务所有者 Owner Acceptance**（基于实际项目对话授权，不伪造手写签名、外部审批编号或电子签章） |
| Commit SHA | `054ebb67eb7ea5b1a82b0d51a70d54e76aaceb68` |
| Run ID | `b29c3f1f-8175-42ed-9e9c-2f0faff16798` |
| Manifest | `M1_CORE_G07_V1` |
| Fixture digest | `9816affb5a94108723929cf8844ea1a640a71a210c604cea6cdd73fdb0d71091` |
| 目标数据库 | `modern_erp_domain_test`（`modern_erp_test@127.0.0.1:3306`） |
| ACK-4 | 已消费，**不可复用** |

### 1.2 身份与权限（执行时实测，八字段完全匹配）

| 字段 | 值 |
|---|---|
| host / port | `127.0.0.1` / `3306` |
| database / selectedDatabase | `modern_erp_domain_test` |
| user / currentUser | `modern_erp_test` / `modern_erp_test@127.0.0.1` |
| serverUuid | `256c7a4e-d275-11f1-885b-b025aa71d167` |
| grantsSha256 | `bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e` |
| serverVersion | `8.0.37`（`log_bin=1`，`log_bin_trust_function_creators=1`） |

## 2. 验收证据

1. 注册测试套件 `server/mysql-m1-core-g07.integration.js` 共 **11 项，执行报告 11/11 PASS**，Suite child
   exit 0。套件构成：Schema Parity 1 项 + CR-01～CR-09 九项 authoritative full-snapshot oracle +
   Supplemental Oracle 1 项。
2. **Schema Parity 覆盖 16 张表，报告全部 MATCHED**（零差异）。Parity 断言对 `M1_CORE_PARITY_TABLES`
   全表逐一比对（列序、类型族、NULL、DEFAULT、索引、外键、CHECK、生成列），任一差异即抛
   `M1_SCHEMA_PARITY_MISMATCH`；测试通过即 16/16 无差异。
3. **CR-01～CR-09 全部通过真实生产 Handler 与 MySQL 并发 Oracle**（`createReceiptNotice`、
   `confirmPurchaseReceiptCore`、`confirmOutsourcingReceipt`、`executeOutsourcingMaterialAction`
   的 ISSUE/SUPPLEMENT/RETURN、distinct-receipts、receipt-vs-return、
   `createOutsourcingProcessingPurchaseOrder`）。
4. **Supplemental Oracle PASS**（stable PO item、injection、PO Change、UAT-14、G03 L1/L2、safe integer）。
5. **Root `FINISHED`**，`testsPassed=true`、`cleanupProven=true`、`childrenExited=true`；
   四操作 `RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_M1_HTTP_FIXTURES` →
   `CLEANUP_SCHEMA_POST_RUN` 严格按序执行，6 个 child lease 全部消费，无越权操作。
6. **Cleanup 一次完成，Postflight PROVEN**：Root 自带的独立只读 postflight 重证目标身份并计数五类
   Schema 对象，结果 clean；执行后另起的独立只读复验同样得到五类全零。
7. **五类 Schema 对象全部归零**（tables / views / triggers / routines / events = `0/0/0/0/0`）、
   **Quarantine NONE**、端口 33101 / 33102 已释放、**ACK-4 一次性消费完成**
   （签发 `2026-11-06T16:17:55.905Z`，消费 `2026-11-06T16:18:06.940Z`，14 分钟窗口内，
   issued 文件已随消费原子消失，`ack4/issued/` 无遗留）。

## 3. 证据边界（Owner 明确接受）

- **未持久化逐项 TAP PASS 原文**：诊断写入器在子进程通过时不落盘证据文件，启动器亦在解析根报告后
  删除临时 stdout。11/11 结论由「已注册套件 + Suite child exit 0 + Root `testsPassed=true` +
  启动器 PASS 条件」共同支持；本决定**不**声称逐行 TAP 文本已归档。
- **最小权限下无法直接读取 `information_schema.INNODB_TRX`**：该读取需要 `PROCESS` 权限，最小权限合同
  不授予。「无残留活动事务」由 `performance_schema.data_lock_waits = 0`、`data_locks = 0`、
  `PROCESSLIST = 1`（仅本次会话）间接证明；相关风险保留。
- **历史失败 Run 与诊断记录完整保留**：Run `94e2e0c7`、`a4c97802`、`c5ce2158`、`dcfbf040`、
  `df0202b6`、`a78b0d3e` 的原始结果与脱敏证据文件均不覆盖、不改写。

## 4. 验收范围（明确不包含）

- 本决定**仅签发 `M1C-G07 PASS`**。**不**自动签发 `M1C-G01` / `M1C-G03` / `M1C-G04`、
  **不**签发 M1-Core **包级** Acceptance、**不**签发 Capability Freeze、**不**签发 Domain Acceptance、
  **不**签发 Release Readiness。
- 本次执行**不授予**任何新 Run ID、ACK-4、数据库写操作或自动重跑权限。
- `M1_CORE_ACCEPTANCE_BLOCKED` 保持不变：G01/G03/G04 仍为 `INCONCLUSIVE`，包级 Acceptance 未签发。
- 未修改 Requirement / Design / 业务代码 / Fixture / DDL / Oracle；未重启 MySQL、未改变数据库权限、
  未修改目标身份。

## 5. 状态迁移

```text
Before : M1C-G07 = FAIL（历史 Run a78b0d3e 的唯一失败断言为 Schema Parity）
After  : M1C-G07 = PASS（Run b29c3f1f / SHA 054ebb67 的单次真实 MySQL 执行 + Owner Acceptance 决定）
```

迁移采用**日期化 supersession**：历史 Run 的 `FAIL` 记录是对其各自执行时点的真实事实，保留不删；
其「当前状态」含义被本节取代。

七 Gate 当前状态：G02/G05/G06/G07 = `PASS`；G01/G03/G04 = `INCONCLUSIVE`。
