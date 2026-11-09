# OUT-001 有界验收与真实 MySQL 8 Gate 证据（2026-11-09）

> 用途：固定 OUT-001 委外 WIP 数量归属转移的本次真实 MySQL Gate、回归、清理和有界验收结论，供后续开发以精确 SHA 追溯。
>
> Owner：业务所有者（本轮委托授权与有界验收范围）；Platform（证据维护）。
>
> 状态：`ACCEPTED` —— `OUT001_MYSQL_GATE_PASS`、`AUD-OUT-001_ACCEPTED`，仅覆盖下述 OUT-001 工作包。
>
> 权威来源：Active Requirement [`procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.14.2；Active Design [`procurement-outsourcing.md`](../design/procurement-outsourcing.md) §26.34.14.3、§26.34.15～§26.34.16.5；当前项目状态以 [`PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §45.31 为准。本文是验收证据，不取代业务合同或项目状态登记表。

## 1. 授权与精确候选

业务所有者在本轮对话明确要求修复前置报告 R-1～R-7、运行全部 OUT-001 真实 MySQL Gate、遇错自行修复并完成 Acceptance，且明确不因历史 hard stop 中断。本记录依据该委托授权和下面的原始可复核证据形成；不声称存在另行手写签名或用户在 Gate 后逐项人工复核。

| 项 | 实测值 |
|---|---|
| 冻结执行候选 | 本地 `candidate/out001-3d0aacf` = `3d0aacf2793b3fd24373545dd1856829bc723d5e`，Gate 与最终回归期间工作树干净 |
| 固定 Manifest | `OUT_001_MYSQL_V1`：RESET → BOOTSTRAP → RUN_OUT001_HTTP_FIXTURES → CLEANUP |
| 一次性 ACK-4 / RunId | `3e6041a4-3167-4434-aeea-13c331aa50a3`，绑定上述完整 SHA 与专用目标，已消费，终态 `FINISHED` |
| MySQL 目标 | `127.0.0.1:3306/modern_erp_domain_test`，`modern_erp_test@127.0.0.1`，MySQL `8.0.37`，Server UUID `256c7a4e-d275-11f1-885b-b025aa71d167` |
| Grants SHA-256 | `bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e`；最小权限及身份预检通过 |
| 软件版本 | `package.json` `1.6.2`，未变更；既有 release tags 未移动 |

## 2. Gate 与独立证据

原始证据目录：`%LOCALAPPDATA%\ModernERP\mysql-gate\evidence\3e6041a4-3167-4434-aeea-13c331aa50a3\`。Root 与 Launcher 的独立校验器都返回 `valid=true`：

| 证据 | 结果 |
|---|---|
| Root report | `FINISHED`、`testsPassed=true`、`cleanupProven=true`、`childrenExited=true`、`cleanupAttempts=1`、五个子进程退出；`root-report.json` 6744 bytes，SHA-256 `4b7bf3e338f14e301e0dc771906210332ca852075759376230ad7f8b1465ea95` |
| Launcher result | `PASS`、Gate exit `0`、Root evidence valid；`launcher-result.json` 412 bytes，SHA-256 `83aacafb8969785273bc74c63cc2cd69acb6e8e38ecced8b46266add210a436d` |
| HTTP suite | TAP **34/34 PASS**、0 fail、0 skip、0 cancelled；固定文件 `server/mysql-out001.integration.js` |
| M1 / M1b | 命名锁获取、事务后释放；请求期间持锁，业务拒绝后释放，拒绝审计与零副作用成立 |
| M2 | 两个独立应用进程、不同幂等键的同源并发竞争不超额、不双写；败方 409 与零副作用 |
| M3 | 真实服务端 COMMIT OK 被代理暂存，victim 从 `PROCESSLIST` 消失；原 Adapter `TERMINATION_CONFIRMED`、`sessionLost=true`、`classification=COMMIT`；服务端释放命名锁，R3 身份/会话条件、R4 单笔转移、R5 同 ID/单号幂等重放均有 TAP 标记，代理关闭后 `liveSessions=0` |
| M4 / M5 | MySQL CHECK / UNIQUE / FK 与 SQLite Schema Parity；`transfer_no` 唯一冲突稳定映射为 409 |
| 后代与目标清理 | M1b 一个、M2 两个、M3 victim 一个，共四个 HTTP 后代登记并证明退出；CLEANUP exit `0`，独立 Postflight exit `0`。Gate 后再次以新只读会话预检：tables/views/triggers/routines/events 全为 `0`，目标身份与授权指纹未漂移；quarantine marker 数 `0` |

## 3. 前置残余与失败链

前置报告 [`out001-gate-ready-preflight-20261109.md`](./out001-gate-ready-preflight-20261109.md) §6 的 R-1～R-7 已在本候选中修复：操作系统进程创建时间绑定、Cleanup 顺序守卫、独立恢复入口、RESET Lease 与 DROP 分离、Launcher 独立 Manifest、只读进程环境隔离、Postflight 进程登记。相关离线 focused 90/90、四后代修复 focused 72/72、M3 协议修复 focused 24/24；最终真实 Gate 验证了组合路径。

历史失败证据保留且**不计作**本次 PASS：首轮 `3cd3409c-0af7-438c-bf50-dd21883d3f75` 为 33/34、`CLEANUP_UNVERIFIED`；独立恢复 `6f043b64-decf-4255-b027-51d6dff7e985` 证明旧进程退出、清理和空库，终态 `FINISHED`。第二轮 `2e0ebab7-24ce-48f1-b3b4-4d97ea0fd6a9` 和诊断轮 `7aa8d4f0-e33c-4363-b61a-8b3727029de1` 均为 33/34、`FAILED`，但清理与 Postflight 已证明；诊断明确定位 MySQL 8 `CLIENT_QUERY_ATTRIBUTES` 的零属性前缀，代理协议解析修复后才取得上述最终 PASS。全部 RunId 和 ACK-4 均独立，不复用已消费能力。

## 4. 最终回归与验收边界

固定候选上：FAST **631/631 PASS**，FULL 最终完整重跑 **3446/3446 PASS**，HEAVY **67/67 PASS**，Build PASS，`git diff --check` PASS。FULL 的第一次运行曾为 3445/3446，原始失败输出未完整保留，因此原因不作推断；同一 SHA 的完整重跑为 3446/3446，0 skip。该波动已披露，不把第一次运行写成 PASS。

验收决定：`GATE_READY`、本次 `GATE_AUTHORIZED`、`GATE_EXECUTED`、`GATE_ACCEPTED` 均已凭本轮证据闭合；`AUD-OUT-001` 在 §31.14.2 的有界范围内从 `TESTED / PENDING_OWNER_APPROVAL` 迁移为 `ACCEPTED`。后续开发可引用 `candidate/out001-3d0aacf` 的完整 SHA 和本报告开展下一阶段工作。

本结论只接受 OUT-001 的合法 Supplier WIP **数量归属**转移、身份/历史/并发防线与无物理库存和成本携带的合同；不签发 `B-P01/B-P02` 成本携带、VMI、PRC-06、B3101/B3121 Manual Closure、Procurement & Outsourcing Domain Acceptance、Release 或 Deploy。本轮没有 Push、Merge、Tag、发布或部署。
