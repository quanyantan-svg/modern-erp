# M1-Core 首期包级 Acceptance 候签记录（2026-11-07）

> 用途：向业务所有者提交 M1-Core **首期包**的正式包级 Acceptance 决策材料，汇总并**逐项列明**须由
> 业务所有者一次性正式接受的**全部跨 Gate 残余风险**，并给出建议决定与建议范围。
> 本文**不是**包级 Acceptance 本身；**包级 PASS 须由业务所有者按 AGENTS.md §4.5 亲自确认**，
> 不得由实施代理自评替代。
>
> Owner：业务所有者（最终 Acceptance 决定与残余风险接受）；Platform / Database Safety / QA（证据维护）。
>
> 状态：`PENDING_APPROVAL` —— **候签记录，等待业务所有者最终确认**。本文**不**签发包级 Acceptance、
> **不**签发 Capability Freeze、Domain Acceptance、Manual Closure、Release Readiness、Tag、Release 或 Deploy。
>
> 权威来源：Active Requirement `docs/requirements/procurement-outsourcing.md` §31.13.5；Active Design
> `docs/design/procurement-outsourcing-m1-core.md` §13.1、§13.1.2、§13.1.3、§13.2；唯一项目状态登记表
> [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)；七 Gate 正式 Owner Acceptance 与 WP-K / WP-K-R1
> 追加裁定（见 [`README.md`](./README.md) 索引）。
>
> 本文是候签证据，不取代 Requirement、Active Design 或唯一项目状态登记表。**本文件的生成本身不构成 Git 提交
> 或远端同步。**

---

## 1. 候签对象与建议决定

| 项 | 值 |
|---|---|
| 验收对象 | **M1-Core 首期包**（Procurement & Outsourcing，`M1C-G01`～`M1C-G07` 七个 Gate） |
| 建议决定 | **`ACCEPT_WITH_BOUNDED_RESIDUAL_RISK`** |
| 建议范围 | **仅** M1-Core 首期七 Gate 所界定的首期能力 |
| 当前七 Gate 状态 | **7 / 7 `PASS`**（各附公开有界残余风险） |
| 当前包级状态 | `M1_CORE_ACCEPTANCE_BLOCKED`（本记录不改变该状态） |
| 证据基线 | `dadca3de69ac5060046db388fb2a0504d42ab7c2`（B-1/B-2 落地提交；本记录为其后的独立复核落库） |

**建议理由**：本轮独立只读复核**未发现任何生产代码缺陷**；七 Gate 的已签发 PASS 全部成立并可继续引用；
唯一被扩大的证据缺口（G07 Oracle 测量强度）已被完整量化、如实披露并在 WP-K-R1 中以**有界残余风险**接受；
其余全部残余风险均已由各 Gate 的 Owner Acceptance 逐项接受。剩余动作仅为**业务所有者的一次最终确认**。

## 2. 已证明范围（可作为「已证明」引用）

| # | 事实 | 证据锚点 |
|---|---|---|
| P1 | 竞态胜负与精确错误码：CR-01～CR-09 每条恰一成功 + 恰一指定错误码失败 | G07 Run `b29c3f1f` @ `054ebb67`，11/11 |
| P2 | 拒绝审计恰好 1 条且与失败码/实体关联 | 同上（真实计算，非常量） |
| P3 | 幂等：胜者恰 1 条 `SUCCEEDED`、败者键无新增记录 | 同上 |
| P4 | 胜方新增业务行的计数/数量/金额与来源匹配 | 同上 |
| P5 | 16 张指定表 Schema Parity 全部 MATCHED | 同上 |
| P6 | Cleanup 一次完成、Postflight PROVEN、五类 Schema 对象归零 `0/0/0/0/0`、端口释放、ACK-4 一次性消费 | 同上 |
| P7 | G01 采购通知/转换/容量/重放/拒绝码 | SQLite L1 生产 HTTP 26/26 |
| P8 | G03 四事件 Mutation Log/Key/身份/八条物理腿/重放与拒绝零副作用 | SQLite L1 + L2；G07 CR-04/05/06 |
| P9 | G04 增量倒冲、canonical 位置成本、成品唯一 Writer、Movement+Balance 双写、409 防御 | SQLite L1 + 受控 L3；G07 CR-03/07/08 |
| P10 | G02 委外收货明细/IQC/待检-生效分离/SOD；G06 来源级危险写入拒绝与零副作用 | SQLite L1 生产 HTTP |
| P11 | G05 两工作面四宽度（320/390/430/680）交互与服务端 RBAC，**非空洞** | Browser 24/24 @ `8559c03` |
| P12 | 当前 HEAD 回归 | FULL `3344/3344`、FAST `576/576`、Build PASS、Docs current / migration 全通过（实测于 `83e13e00`） |

## 3. 须由业务所有者一次性正式接受的**全部跨 Gate 残余风险**

> 本节即 `docs/status/PROJECT_STATUS.md` §37.52 所要求的「须另行审查并正式接受全部跨 Gate 残余风险」。
> 以下每一条均为**未充分证明**或**已知限制**，**不得**在任何后续材料中表述为已证明。

### 3.1 已由各 Gate Owner Acceptance 逐项接受者

| # | 残余风险 | 接受依据 |
|---|---|---|
| R-01 | G01 完整 HTTP + SQLite/MySQL **双引擎等价未证明**（多 PO 分配、部分转换、分域容量、交期绑定与回滚、取消后源容量不可恢复、直接 PO 路径、历史 NULL 防伪等流程未在真实 MySQL 逐项重演） | G01 Acceptance §4.1 |
| R-02 | G01 真实 MySQL 中拒绝路径的**全字段零业务变化未充分证明** | G01 Acceptance §4.2 |
| R-03 | G01 MySQL **事务交错覆盖有限**（仅 CR-01/CR-02 两类争用） | G01 Acceptance §4.3 |
| R-04 | G01 **历史真实数据**的不可证明来源与交期未在历史库上作 Migration/现场核验 | G01 Acceptance §4.4 |
| R-05 | **Schema Parity ≠ 行为 Parity**（16/16 通过不等于 G01 全路径跨引擎行为对等） | G01 Acceptance §4.5 |
| R-06 | G02 / G06 **尚无单独真实 MySQL 验证**；该接受**不豁免** G01/G03/G04/G07 的真实 MySQL 与并发验证要求 | G02/G06 Acceptance §2 |
| R-07 | G03 真实 MySQL **尚未在同一测试中完整重演**四事件的 `inventory_mutation_log`、完整 Key、LOT/NONE/SERIAL-1/SERIAL-2 身份及八条对应物理/跟踪/估值腿 | G03 Acceptance §3.1 |
| R-08 | G03 G07 的 **16 表 Schema Parity 清单不含 `inventory_mutation_log`**，不能据其推导该表自身结构、索引或四事件行为的完整 MySQL 对等 | G03 Acceptance §3.2 |
| R-09 | G03 PASS **不覆盖** G07「败方既有业务行逐字段零变化」这一证据偏差 | G03 Acceptance §3.3 |
| R-10 | G03 **历史 M-15 数据迁移不在范围**；不批准历史记录推断、identity 回填、Migration 或历史库清理 | G03 Acceptance §3.4 |
| R-11 | G04 **MySQL 败方完整零副作用未充分证明** | G04 Acceptance §4.1 |
| R-12 | G04 **并发覆盖有限**（仅 CR-03/CR-07/08）；MySQL 成品/估值完整逐腿重演未新增验证 | G04 Acceptance §4.2 |
| R-13 | G04 异常负增量**仅防御性证明**；「合法 HTTP 未发现负增量构造路径」仅在既定不变量成立时为前提，非数学普遍不可达性证明 | G04 Acceptance §4.3 |
| R-14 | G04 **历史库与浮点边界未穷尽** | G04 Acceptance §4.4 |
| R-15 | G04 **暂估成本不是 AP/GL 完结**；正式加工费过账、最终差异分摊及延期政策未获放行 | G04 Acceptance §4.5 |
| R-16 | G07 **逐项 TAP PASS 原文未持久化**（11/11 由套件 + child exit 0 + Root `testsPassed=true` + 启动器条件支持） | G07 Acceptance §3 |
| R-17 | G07 最小权限下 `information_schema.INNODB_TRX` **不可直接读取**；「无残留活动事务」由 `data_lock_waits=0` / `data_locks=0` / `PROCESSLIST=1` 间接证明，风险保留 | G07 Acceptance §3 |

### 3.2 已由 WP-K 接受者

| # | 残余风险 | 接受依据 | 范围 |
|---|---|---|---|
| R-18 | G07 Oracle **测量强度差距**：败方对既有业务行零原地改写未被检出；`winnerBusinessRowDelta` / `loserBusinessRowDelta` 为常量；7 个 CR 的 `identityDelta` 未重算；守恒方程为恒等式；`expectedSnapshot` 分支从未启用 | WP-K 裁定 §3–§4 | 仅 M1-Core 内部首期包级验收评估；不豁免真实业务缺陷；WP-J 维持 `DEFERRED_NOT_AUTHORIZED` |

### 3.3 本轮新增、由 WP-K-R1 接受者

| # | 残余风险 | 接受依据 | 范围 |
|---|---|---|---|
| R-19 | G07 Oracle **扩大披露**：54 个断言槽位中 **29 个从未重算**（原 WP-K 已披露 25 + 本轮新增 4：`CR-01.amountDeltaCents`、`CR-02/CR-03/CR-07.documentDelta`）；**35 个 (CR, 表) 组合**在对应真实 MySQL G07 Oracle 中缺少业务不变量校验 | WP-K-R1 裁定 §4、§6 | 同 R-18；**仅**处置测量强度差距，**不**豁免真实业务缺陷 |
| R-20 | 上述 35 个组合涉及的 9 张表在 **SQLite 层存在补偿证据，但属不同层级**：**不能**证明这些真实 MySQL 场景逐字段无异常，**不**构成跨引擎等价证明；**完全没有任何测试覆盖的组合为 0 个** | WP-K-R1 裁定 §4.3 口径纪律 | 引用时不得混同作用域（整表 / 整表全列 / 按实体作用域） |

### 3.4 明确**延期未授权**（不构成本包的接受项）

| # | 事项 | 状态 |
|---|---|---|
| D-01 | **WP-I** G01 完整真实 MySQL 行为验证 | `NOT_PROVEN / DEFERRED_NOT_AUTHORIZED` —— 公开残余风险，**未**因 G01 PASS 标记为 DONE |
| D-02 | **WP-J** G07 Oracle 强度补强（败方逐字段比较、删除常量 delta、7 CR 的 `identityDelta` 真实推导、跨表恒等式、固化期望终态快照以启用 `expectedSnapshot`） | `DEFERRED_NOT_AUTHORIZED` —— 未来须独立授权 + 新 Oracle + 新 Run ID + 新 ACK-4；历史 Run `b29c3f1f` **不可追认** |
| D-03 | **M-15** 历史 Migration | 属另一授权范围，本包**不**批准 |
| D-04 | 旧 13 Gate 的 6 项 `DEFERRED`（GB03 / GC01 / GC02 / GD01 / GD02 / GT02 拆分部分）与 9 项 RACE | 属 **M1 全域 Closure** 合同，**不得**视为本包已交付；**不得自动恢复为实施任务** |

## 4. 包级 Acceptance 的**范围限定**

若业务所有者确认本建议，包级 Acceptance 的范围**仅**为：

- **M1-Core 首期七 Gate**（`M1C-G01`～`M1C-G07`）所界定的 Procurement & Outsourcing 首期能力；
- 该范围内的成功断言、拒绝断言与「业务事实逐字段零变化 + 拒绝审计恰好 1 条」零副作用合同；
- §3 全部残余风险的**有界接受**（R-01～R-20）。

包级 Acceptance **不包含**：

| 不包含 | 说明 |
|---|---|
| 旧 13 Gate / M1 全域 Closure Acceptance | Active Design §13.2：两者**不得互相替代**；旧 13 Gate 继续作为 M1 全域 Closure 的验收合同 |
| 任何延期能力的正向交付 | D-01～D-04 |
| Capability Freeze | 需另行裁定；包级 Acceptance **不自动** Freeze |
| Domain Acceptance / Manual Closure | 需另行裁定与对应 Manual 的覆盖矩阵 |
| Release Readiness / Release / Deploy | **未授权**；Gate PASS ≠ 生产发布许可 |
| 生产发布许可 | 技术验收与上线准备是两个不同阶段 |
| 新增 Run ID、ACK-4、数据库写操作、Reset/Bootstrap/Cleanup/Migration 授权 | 均**未**授予 |
| 任何功能范围扩展 | 本包**不**扩展功能、权限或业务合同 |

## 5. 剩余动作

| # | 动作 | 责任方 | 状态 |
|---|---|---|---|
| 1 | 业务所有者按 AGENTS.md §4.5 对本记录作**最终确认**（签发包级 Acceptance 或退回） | 业务所有者 | ⬜ **待办** |
| 2 | 确认后按治理流程把包级结论登记入 `docs/status/PROJECT_STATUS.md`（追加日期化条目，**不得**改写 §37.48–§37.54） | 平台 | ⬜ 待步骤 1 |
| 3 | 本地提交同步到 `github/master`（Push） | 业务所有者 | ⬜ **本轮未授权** |
| 4 | Capability Freeze / Domain Acceptance / Manual Closure / Release Readiness | 业务所有者 | ⬜ 另行裁定，**不在本包** |

## 6. 本记录**不**主张

1. **不主张**包级 Acceptance 已签发 —— 决定权在业务所有者；
2. **不主张** §3 的任何残余风险已闭合 —— 全部为公开未闭合项；
3. **不主张**WP-I、WP-J、M-15 已完成或已授权；
4. **不主张**旧 13 Gate 已恢复为当前验收条件或实施任务；
5. **不主张**任何发布、部署、冻结或历史数据库修改已获授权；
6. **不主张**G07 的 11/11、16/16 或其他真实有效断言之外的内容已被证明。

## 7. 未发生

本记录**未**修改 Active Requirement / Design、生产代码、DDL、Fixture、G07 Oracle、G07 合同、测试或任何
已签发 Owner Acceptance；**未**连接真实 MySQL、**未**运行 G07、**未**签发或消费 ACK-4、**未**执行
Reset / Bootstrap / Cleanup / Migration；**未** Push / Merge / Tag / Release / Deploy。
