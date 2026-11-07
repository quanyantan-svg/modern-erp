# M1-Core G03 正式 Owner Acceptance（2026-11-07）

> 用途：登记 Procurement & Outsourcing Domain Owner 对 `M1C-G03` 的正式 Acceptance 决定及其有界残余风险。
> Owner：Procurement & Outsourcing Domain Owner（正式验收决定）；Platform / Database Safety / QA（证据维护）。
> 状态：`APPROVED` —— Domain Owner 已于 2026-11-07 明确签发 `M1C-G03 PASS`。
> 权威来源：正式 Requirement `docs/requirements/procurement-outsourcing.md` §31.13.5、Active Design
> `docs/design/procurement-outsourcing-m1-core.md` §9、§13.1、§13.1.1–13.1.2，及候审矩阵
> [`m1-core-g03-g04-offline-closure-20261107.md`](./m1-core-g03-g04-offline-closure-20261107.md)。
> 本文是验收证据；不替代 Requirement、Design 或唯一项目状态登记 `docs/status/PROJECT_STATUS.md`。

## 1. Owner 决定

Procurement & Outsourcing Domain Owner 于 **2026-11-07** 明确接受本记录 §3 的有界残余风险，并正式签发：

```text
M1C-G03 PASS
```

本决定仅覆盖 G03，不宣称缺失证据已经完成，不豁免其他 Gate 或历史 Migration，也不批准 M1-Core 包级验收、
Capability Freeze、Domain Acceptance、Release 或 Deploy。

## 2. 已接受的证据范围

| 范围 | 证据锚点 | 证据层级／边界 |
|---|---|---|
| 四个发料事件、LOT/NONE/SERIAL-1/SERIAL-2、独立 Mutation Log/Key、八条物理腿及跟踪/估值/身份对账 | `server/m1c-wp7a-g03-multi-material.test.js`，G03-M1/M2/M3/M4/M5/M7 | SQLite 生产 HTTP L1；断言灵敏度负控为内存克隆，不是生产 SQL 变异 |
| 外部幂等同内容重放、异内容 409、业务事实零变化、拒绝审计恰一 | D-G03-001 `server/m1c-wp7a-g03-idempotency-conflict.test.js` | SQLite L1；生产源码修复已独立审查 |
| 五字段内部 Mutation Key 同指纹重放、异指纹严格拒绝且无部分写入 | `server/m1c-wp7a-g03-l2-mutation-key.test.js` | SQLite L2；不冒充外部 HTTP 可构造碰撞 |
| ISSUE/SUPPLEMENT/RETURN 的真实 MySQL 竞争子集 | G07 Run `b29c3f1f-8175-42ed-9e9c-2f0faff16798`，执行 SHA `054ebb67eb7ea5b1a82b0d51a70d54e76aaceb68` 的 CR-04/05/06 | 历史真实 MySQL 子集事实，不是本 SHA 四事件完整重演 |
| SQLite/MySQL Schema Parity | G07 16/16 MATCHED | 仅限既有 16 表清单；`inventory_mutation_log` 不在清单内 |

证据提交链为：
`1de469217ce0ebf83b8c5a2df69c2d6df63a1718` →
`c33aaa4876e91ef5288ae1aa67c07bb0dccd0fe5` →
`4d0281e4975c3836be80ea1d85d159193d5de8d8` →
`46002020a19e221224cec07f8730ed5c16a2f76c`。

## 3. Owner 明确接受的有界残余风险

1. 真实 MySQL 尚未在同一测试中完整重演四个事件的 `inventory_mutation_log`、完整 Key、
   LOT/NONE/SERIAL-1/SERIAL-2 身份及八条对应物理／跟踪／估值腿。
2. G07 的 16 表 Schema Parity 清单不包含 `inventory_mutation_log`，不能据其推导该表自身结构、索引或四事件
   行为的完整 MySQL 对等。
3. G07 已签发 PASS 保持，但不自动证明败方已有业务行逐字段零变化已经闭合；G03 PASS 不覆盖该证据偏差。
4. 历史 M-15 数据迁移不在本次验收范围；本决定不批准历史记录推断、identity 回填、Migration 或历史库清理。
5. 本次风险接受不豁免 `MC-REQ-13`、Active Design §13.1.2 的其余 SQLite/MySQL 兼容及 fail-closed 义务；
   后续真实 MySQL 证据出现反例时，应重新评估 Gate。

## 4. 状态迁移与未签发事项

```text
Before: G03 = INCONCLUSIVE
After : G03 = PASS
```

- 当前七 Gate：G02/G03/G05/G06/G07=`PASS`；G01/G04=`INCONCLUSIVE`。
- `M1_CORE_ACCEPTANCE_BLOCKED` 保持。
- 未签发 G01/G04、M1-Core 包级 Acceptance、Capability Freeze、Domain Acceptance、Release Readiness。
- 未授权或执行新的 MySQL、ACK-4、Migration、Push、Merge、Tag、Release 或 Deploy。
