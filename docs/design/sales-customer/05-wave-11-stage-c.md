# Sales & Customer — Wave 11 Stage C Design Closure

> 状态：`ACTIVE`
> Owner：Sales & Customer
> 权威来源：`docs/design/sales-customer/README.md`
> 来源：`solution.md` §37.54（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## 37.54 Wave 11 — Sales & Customer Credit Evaluation / Reconciliation / Query — Stage C Design Closure (2026-10-27)

### 37.54.1 Authorization, scope, authority and what this design is not

- Authorization: `WAVE11_STAGE_C_DESIGN_ONLY`（AGENTS.md §4.3 DESIGN）。
- 前置：`WAVE11_STAGE_B_REQUIREMENT_READY`（本日 `document.md` `Wave 11 — … — Stage B Requirement Closure (2026-10-27)`），已由用户确认 PASS。
- 本节是 **Design**，不是 Implementation。本节**未**创建任何代码、Schema、Migration、测试、Runner 或 UI 资产；**未**执行任何 Migration、测试门禁或 MySQL 连接；**未**执行任何 Git 写操作。
- 本节**未**修改 `document.md`、`README.md`、`AGENTS.md`、`CLAUDE.md`、`APPLY_GUIDE.md`、`package.json` 或任何生产源文件、测试、Fixture、Manifest / Runner。
- 本节**未**新增、删除或重编号任何 SC ID、UAT ID、Race ID 或 Invariant ID；**未**修改已批准的 D1 / D2 / D3。
- 本节以**现行 `document.md` Requirement 为权威**。凡既有 Design 与之不一致者，按 §37.54.4 逐条处置；对 Wave 11 尚未实施的设计作**有界新版本声明**，**不修改历史冻结证据**。
- 物理表名、模块文件名与 API 形态是 **Design 产物**，在 Stage B 属未锁定项；本节首次锁定它们，但不改变任何业务语义。

### 37.54.2 Baseline verification and pre-existing worktree

| 项 | 值 | 核对方式 |
|---|---|---|
| Branch | `work/sales-waves6-13-recovery-20261025` | `git rev-parse --abbrev-ref HEAD` |
| 当前开发 HEAD | `510974a4f55995c51d276d6f0e6f9e042b84f276` | `git rev-parse HEAD` |
| `package.json` version | `1.6.2` | `package.json` |
| Git release tag | `v1.6.2` → `229169bb555ec122197604de64b3b1ebfee59ced` | `git rev-list -n1 v1.6.2`；`git tag --points-at HEAD` 为空 |
| Remotes | `github` → GitHub；`origin` → Gitee | `git remote -v` |
| 进入本阶段前工作树 | `M document.md`（Stage B，666 insertions / 0 deletions）、`M log/2026-10-27.md`（Stage A 217 + Stage B 364 insertions，0 deletions） | `git status --porcelain`、`git diff --stat` |
| Wave 10 | `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED` | `document.md:11193`、`:11540` |
| Package B | `PACKAGE_B_TEST_ISOLATION_ACCEPTANCE_PASS` | `document.md:11556` |

**无未知代码变更、无基线漂移。** 上述两个 dirty 文件正是 Stage A / Stage B 的未提交成果，本节**完整保留**，不覆盖、不改写。`v1.6.2` **不指向**当前开发 HEAD（落后 147 个 commit）；本节及此后记录均不得声称相反。

### 37.54.3 Requirement conformance basis and design-to-requirement map

| Requirement（Stage B） | 本节设计位置 | 结论 |
|---|---|---|
| R99-1..R99-6 | §37.54.11（W11-D）、§37.54.7.4 | 逐条实现，零权威写入 |
| R100-1..R100-7 | §37.54.11、§37.54.6.4、§37.54.12.6 | 逐条实现；R-SAL-23 结构/行为证明分离 |
| R101-1..R101-7 | §37.54.9（W11-A） | 逐条实现；只读路径复用 canonical 计算 |
| R102-1..R102-5 | §37.54.9 | 逐条实现；例外历史为 DERIVED，无第二事实表 |
| R103-1..R103-3 | §37.54.10.2（W11-B 表 1） | 逐条实现；指标生效日期化 + 引用后不可就地改写 |
| R104-1..R104-3 | §37.54.10.3 | 逐条实现；方案生效日期化 + 等级边界无重叠无空洞 |
| R105-1..R105-7 | §37.54.10.4–§37.54.10.6 | 逐条实现；权重为整数毫权重、评分全整数查表 |
| R106-1..R106-5 | §37.54.12 | 逐条实现；单表多评人 + 单聚合 |
| R107-1..R107-9 | §37.54.12.5–§37.54.12.9 | 逐条实现；唯一评级写者 + write-class authority |
| R-D2-1..R-D2-6 | §37.54.8（W11-SEC-01） | 逐条实现；复用 `credit-scope.js`，不建第二 resolver |
| R-D3-1..R-D3-5 | §37.54.12.6、§37.54.15.3 | 逐条实现；权限类别分离，不引入人员级分离 |
| UAT-S-34-A1..A8 | §37.54.14.1 | 逐条映射到测试与 MySQL 证据 |
| UAT-S-35-A1..A7 | §37.54.14.2 | 同上 |
| UAT-S-36-A1..A9 | §37.54.14.3 | 同上 |
| A-D2-1..A-D2-8 | §37.54.8.5 | 同上 |
| A-D3-1..A-D3-5 | §37.54.14.4 | 同上 |

**无 REQUIREMENT_REOPEN 触发项**：本节未改变任何已批准业务语义。§37.54.17 列出的待确认项均为 **Design 决策**，不触及 Requirement 文本。

### 37.54.4 Design governance — existing-Design conflicts and their disposition

| # | 旧 Design 精确位置 | 新 Requirement 精确位置 | 处置 | 兼容性 / 历史证据影响 |
|---|---|---|---|---|
| G-1 | `solution.md:12607`（`credit_recalculation_history.kind ∈ ('CHECK_ONLY','DETERMINISTIC_REBUILD')`）、`:12616`、`:19698` | `document.md` Stage B R100-1、R100-5、R100-6；D1 | **有界新版本声明**（§37.54.6）。`DETERMINISTIC_REBUILD` 被**退役**（retired），不是被重新定义；新 kind 为 `DETERMINISTIC_RECALCULATION` | 旧名称**从未物理落地**（§37.54.6.1），无数据、无字段、无历史行受影响；历史设计文本**保持原样不改写**，由 supersession map 使其可解释 |
| G-2 | `solution.md:19700-19710`（§36.7.5 "DETERMINISTIC_REBUILD remains defined but unexercised"） | 同上 | 同 G-1；本节声明其在 Wave 11 范围内的**有界取代** | 同上 |
| G-3 | `solution.md:19822-19823`（`GET /api/credit/exposure` / `GET /api/credit/exceptions`） | R101、R102 | **一致**，本节细化其响应结构、分页与 Scope 语义 | 无冲突 |
| G-4 | `solution.md:19824-19829`（`/api/credit/evaluation/*`、`/api/credit/reconciliation/run`） | R103–R107、R99–R100 | **一致**，本节细化端点集合与错误合同 | 无冲突 |
| G-5 | `solution.md:19641-19651`（§36.7.1 评级写入唯一 owner） | R107-4 | **一致**，本节以**单一共享写入函数**落实（§37.54.12.7） | 需对 Wave 9 `createCreditProfile` 做**行为保持**重构，Wave 9 回归套件必须原样通过 |
| G-6 | `solution.md:19694`（§36.7.4 多评人条目存于 `sheet_data_json`） | R105-5、R106-1 | **一致**，本节不引入独立评分明细表（§37.54.10.5） | 无冲突；避免第二套评分事实 |
| G-7 | `solution.md:19692`（`credit_evaluation_result` 为唯一聚合，带 `evaluator_count`） | R106-3、R107-1 | **一致** | 无冲突 |
| G-8 | `solution.md:19423-19437`（§36.5.3 Wave 11 建表顺序） | §37.54.12.3 | **一致**，本节按 registry 的 (wave, id) 排序落实同一依赖顺序（§37.54.12.2） | 无冲突 |
| G-9 | `solution.md:19456-19460`（§36.5.5，`FOREIGN_KEY_CHECKS=0` 使 DDL 成功不构成 RI 证据） | §37.54.12.10 | **一致并加强**：命名 FK 存在性、目标候选键、数据级 RI 三项独立验证 | 无冲突 |
| G-10 | `solution.md:19671-19672`（`applied_to_profile_id` 绑定版本而非 anchor） | R107-2 | **一致**，本节补足并发保护（FOR UPDATE + 单次写入断言） | 无冲突 |
| G-11 | `solution.md:8910`（`credit_evaluation_scoring_sheet` 候选列含 `profile_snapshot_identity`） | R105-4 | **细化**：改为显式 `credit_profile_id`（版本）+ `business_date`，并规定 apply 时重新校验版本未变 | 列名不同属 Stage B 未锁定的物理设计；语义更严格，无冲突 |
| G-12 | `solution.md:8912`（`credit_recalculation_history` 候选列含 `result_summary`） | R99-6、R100-6 | **CORRECTION-2 已修订**：列名调整为 `result_snapshot_json`，承载**不可修改、非权威**的执行期结果快照（`contractVersion` + `authoritative:false` + `consumedByCreditCalculation:false`）；顶层**无**金额列，无任何 Credit writer 读取该表（§37.54.6.5 G-1..G-6、§37.54.11.4） | 既有 Wave 10 先例 `credit_check_results.component_breakdown_json` 即同型逐决策不可变快照，非新规范；Requirement 的“结果摘要”要求由此满足，且不构成第二套台账 |

### 37.54.5 Shared design foundations

#### 37.54.5.1 Canonical module ownership (Wave 11)

```text
server/modules/credit-scope.js            EXTENDED (canonical read-scope decision + predicate projection)
server/modules/credit-check.js            EXTENDED (W11-A: 追加两个既有符号的命名导出；W11-D: 返回值追加 factDigest；均为纯附加，无行为变更)
server/modules/credit-policy.js           EXTENDED (pure fingerprint computation split from persistence)
server/modules/credit-profile.js          REFACTORED (single shared rating-writer helper; behaviour preserving)
server/modules/credit-query.js            NEW (SC101/SC102 DERIVED read layer — no tables)
server/modules/credit-evaluation.js       NEW (SC103–SC107 indicators/schemes/models/sheets/results + rating application)
server/modules/credit-reconciliation.js   NEW (SC99/SC100 CHECK-only + deterministic recalculation)
```

`server/app.js` 保持 HTTP lifecycle + auth + thin dispatch（AGENTS.md §8）。不新增 mixed-owner 文件。

#### 37.54.5.2 Canonical read-only computation reuse — and the explicit non-reuse of the check path

| 用途 | 复用对象 | 是否写入 |
|---|---|---|
| W11-A exposure 查询 | `computeCreditExposure()`（`credit-check.js:385`）+ `resolveEffectiveCreditProfile()`（`credit-profile.js:44`）+ 新的纯函数 `computePolicySnapshotFingerprint()` | **零写入** |
| W11-D SC99 / SC100 | 同上（同一函数，无第二套算法） | 仅写 `credit_recalculation_history` 审计行 + `audit_logs` |

**明确禁止**：不得把 `evaluateCredit()` 或 `POST /api/credit/check` 用作 GET 查询的实现路径。`evaluateCredit()` 会取写锁、解析并写入 `credit_policy_snapshots`、写入 `credit_check_results`、写入 `audit_logs`，并可能消费特别审批（`credit-check.js:895-906`）——它是**业务决策**而非查询。

**不得复制第二套信用算法。** `computeCreditExposure()` 是唯一的敞口派生实现（阶段转换、AR 来源链、销售员归属、模糊归属计数）。本节只为其**返回值增加** `factDigest`（纯附加，不改变任何既有返回字段或既有调用方行为），以支持 R100-2 的可验证确定性。

**`factDigest` 的执行归属**：该字段由 **W11-D** 实施（R100-2 属 SC100，见 §37.54.11.2 与 §37.54.15.6）。**W11-A 不新增该字段**，W11-A 只复用 `computeCreditExposure()` 既有的敞口组件与金额口径（见 §37.54.15.9.1）。

**读路径的快照指纹必须可只读计算。** `ensureCreditPolicySnapshot()`（`credit-policy.js:192`）**会 INSERT**。因此本节要求把纯计算与持久化拆分：

```text
NEW  credit-policy.js
  computePolicySnapshotFingerprint({parameterSetHash, ruleSetHash, profileEffectiveStateHash})
      -> 'CSP1:<sha256 hex>'      (pure; no db access)

  ensureCreditPolicySnapshot(input)   (UNCHANGED public behaviour)
      -> now delegates the fingerprint computation to computePolicySnapshotFingerprint()
```

`buildScopeHashes()`（`credit-check.js:540`）当前为模块私有且纯函数（只读参数、规则与档案状态并做 SHA-256）。本节要求将其**导出**并复用，读路径据此计算指纹而**不**持久化任何 snapshot 行。

#### 37.54.5.3 Scope predicate model — one resolver, several projections

**设计原则：授权决策只有一个来源，SQL 形状按表投影。** 不新建第二个 Scope Resolver。

```text
credit-scope.js
  NEW  resolveCreditReadMode(db, actor)
          -> { mode, selfSalespersonId, authorizationDate }   (canonical AUTHORIZATION DECISION)
          -> authorizationDate is SERVER-CONTROLLED and is NEVER taken from the request

  KEEP resolveCreditProfileReadScope(db, actor, { businessDate })
          -> public signature unchanged;
             the businessDate argument is retained ONLY as a historical DATA FILTER
             and MUST NOT be forwarded into self-scope eligibility evaluation
             (see the CORRECTION-1 finding below)

  NEW  creditScopePredicate(mode, { aggregateExpr, selfExpr, selfValue })
          -> { sql, args }                      (pure PROJECTION; cannot decide a mode)
```

**CORRECTION-1 (2026-10-27) — 授权日期与查询日期必须分离，且现有代码存在可利用的越权读取。**

Stage C 初稿把 `businessDate` 透传进 `resolveCreditReadMode`，这与 Stage B R-D2-1（“读取资格必须依据**当前有效**授权判定；历史上曾属于某销售组不得成为永久读取权”）**冲突**。经复核真实代码，该冲突不是纸面问题，而是**现存可利用缺口**：

```text
credit-scope.js:39-50  resolveSelfSalespersonId(db, actor, businessDate)
  date = businessDate || today()
  SELECT 1 FROM salesperson_group_memberships m JOIN sales_groups g ...
    WHERE m.salesperson_id=? AND m.active=1 AND g.active=1
      AND m.effective_from<=? AND (m.effective_to IS NULL OR m.effective_to>=?)   <-- ? = 调用方传入的 businessDate

salesperson_group_memberships 同时具备 active 与 effective_from/effective_to
(sales-customer-wave1-foundation.js:61-66)，且写入侧同时更新这两组字段
(sales-foundation.js:183)。

可达路径：GET /api/credit/profiles?businessDate=<过去日期>
  -> credit-profile.js:56-58 把用户提供的 businessDate 传入 resolveCreditProfileReadScope
  -> credit-profile.js:69-72 用该 scope 谓词过滤
  => 一条"已按日期终止（effective_to 已设、active 仍为 1）"的历史成员关系，
     在过去的 businessDate 上重新命中，用户重新获得 AGGREGATE_PLUS_SELF 自额度可见性。
```

**修正后的三类日期合同**（三者互不替代）：

| # | 日期 | 来源 | 用途 | 禁止 |
|---|---|---|---|---|
| 1 | **Server-controlled authorization date** | 服务端时钟，经 `currentBusinessDate()` 取得 | 判定**读者当前**的自额度资格（销售员档案 active、销售组 active、成员关系当前有效） | **禁止**取自任何请求参数 |
| 2 | **User-requested historical business date** | 请求参数（`businessDate`） | 仅作为**数据过滤器**，决定返回哪些历史记录 / 哪些生效版本 | **禁止**参与授权判定 |
| 3 | **Historical fact's original business date** | 事实行自身携带（如 `credit_check_results.business_date`、`credit_profile.effective_from`） | 决定该事实归属的业务期间 | **禁止**被改写或被用作授权依据 |

**规范业务日期与时区**：本仓库的业务日期是**无时区的日历日**（`YYYY-MM-DD`），由 `normalizeBusinessDate()`（`server/lib/http.js:127-143`）以 UTC 日历探针校验合法性；仓库的"今天"约定为**服务端当前 UTC 日历日** `new Date().toISOString().slice(0,10)`（`server/` 内 112 处一致使用；`previousDate()` 亦以 UTC 计算，`sales-foundation-common.js:33-37`）。本修正**沿用该既有约定**，不引入新的时区概念，也不新建第二套日期语义。

```text
NEW  credit-scope.js
  currentBusinessDate()                       -> server UTC calendar date (canonical)
  resolveCreditReadMode(db, actor)            -> 用 currentBusinessDate() 判定自额度资格
  resolveSelfSalespersonId(db, actor)         -> 签名去除 businessDate 参数；
                                                成员关系判定固定使用 currentBusinessDate()
```

**历史成员关系不得重新授予当前已失去的权限**：成员关系若已按当前日期终止（`effective_to` 已过或 `active=0`），无论请求携带哪个历史 `businessDate`，都**不得**恢复 `AGGREGATE_PLUS_SELF`。`AGGREGATE_ONLY` 与 `CROSS_GROUP` 的既有 Aggregate Read Policy **不受影响**（见 §37.54.7.3 与 §37.54.14.4 的负向用例）。

**边界**：`server/modules/sales-scope.js:16` 的 `assertGroupScope()` 是**单据销售组范围**判定，其 `businessDate` 语义属于上表第 3 类（历史事实自身的业务日期），**不在本修正范围内，不得改动**。本修正只针对 **Credit 授权**读取路径。

**行为等价性的修订**：原 Stage C 要求的"`resolveCreditProfileReadScope` 行为等价"**不再适用于自额度资格分支** —— 该分支必须按上述修正收紧（这正是 W11-SEC-01 的越权读取整改）。行为等价性义务保留于**其余分支**（模式判定顺序、ADMIN / DENY / CROSS_GROUP / AGGREGATE_ONLY 行为、`assertBindableSelfId` 结构护栏），并由既有 `server/sales-customer-wave9-credit-foundation.test.js` 与新增负向用例共同证明；**不得**为迁就旧断言而保留越权读取。

模式 → 谓词映射（`credit_check_results` 形状）：

| Mode | 谓词 |
|---|---|
| `ALL` / `CROSS_GROUP` | `1=1` |
| `DENY` | 请求在授权阶段即 403，不产生查询 |
| `AGGREGATE_ONLY` | `(scope_type='CUSTOMER_AGGREGATE')` |
| `AGGREGATE_PLUS_SELF` | `(scope_type='CUSTOMER_AGGREGATE' OR (scope_type='SALESPERSON_SUB_LIMIT' AND credit_profile_id IN (SELECT id FROM credit_profile WHERE salesperson_scope_key=?)))` |

模式 → 谓词映射（`credit_special_approval` 形状）：

| Mode | 谓词 |
|---|---|
| `ALL` / `CROSS_GROUP` | `1=1` |
| `AGGREGATE_ONLY` | `(scope_type='CUSTOMER_AGGREGATE')` |
| `AGGREGATE_PLUS_SELF` | `(scope_type='CUSTOMER_AGGREGATE' OR (scope_type='SALESPERSON_SUB_LIMIT' AND source_credit_check_result_id IN (SELECT id FROM credit_check_results WHERE credit_profile_id IN (SELECT id FROM credit_profile WHERE salesperson_scope_key=?))))` |

**设计要点**：

1. 特别审批的可见性**锚定其来源 Credit Check**（`source_credit_check_result_id`），不是锚定自身字段 —— 这就是"审批记录与来源 Credit Check 之间的可信 scope 关联"。
2. `credit_check_results.credit_profile_id` 可为 NULL。此类行在 `AGGREGATE_ONLY` / `AGGREGATE_PLUS_SELF` 下**一律排除**（fail closed：无法归属的行不得因可见性规则而被降级为 aggregate）；在 `ALL` / `CROSS_GROUP` 下保留。
3. `scope_type` 的取值来自 Wave 10 已冻结的 `CHECK(scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT'))`，本节**不改写**该 CHECK，只复用其取值域。
4. `salesperson_scope_key` 的语义来自 Wave 9：`'*'` = Customer Aggregate，= 销售员 id = Salesperson Sub-Limit（`credit-profile.js:104`、`:162`）。本节**不改写**该语义。
5. **CORRECTION-1**：模式判定所用的日期一律为服务端当前有效日期（§37.54.5.3 的三类日期合同）；请求携带的历史 `businessDate` 只作为数据过滤器，**不进入**模式判定。五级模式语义不变，**不新建权限模型**。

#### 37.54.5.4 Identity model — the five Credit identities in Wave 11

| 身份 | 物理载体 | Wave 11 中的读写角色 |
|---|---|---|
| Stable Credit Object / Lock Identity | `credit_lock_anchors.anchor_key` | **只读**（W11-A/D 解析 scope 与锁序；W11-C 评级应用取 `FOR UPDATE`） |
| Effective Credit Profile Version | `credit_profile` 生效期版本行 | **只读**（W11-A/D 解析额度）；W11-C **写**（仅评级内联投影） |
| Immutable Policy Snapshot | `credit_policy_snapshots` | **只读**；读路径**只计算**指纹，不新增行 |
| Credit Evaluation Result | `credit_evaluation_result`（W11-C 新建） | W11-C **唯一写者** |
| Applied Rating History | `credit_profile_ratings` | W11-C 追加 `EVALUATED` 行；**不改写**既有行的不可变字段 |

四者不得因实现便利合并（Stage B R-D3-3、`document.md:6843-6851`）。

#### 37.54.5.5 Error code registry (Wave 11 new codes)

```text
CREDIT_SCOPE_DENIED                  403  (existing, credit-scope.js:66)
CREDIT_READ_SCOPE_NOT_APPLICABLE     403  (DENY mode on a Credit read surface)
CREDIT_PROFILE_MISSING               409  (existing semantics; no profile configured != zero limit)
CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS   409  (existing, credit-profile.js:51)
CREDIT_EXPOSURE_SOURCE_INCONSISTENT  409  (existing, credit-check.js:251)
CREDIT_EVALUATE_DENIED               403  (existing, credit-scope.js:92)
CREDIT_MANAGEMENT_DENIED             403  (existing, credit-scope.js:80)
CREDIT_QUERY_INVALID_INPUT           400
CREDIT_QUERY_INVALID_PAGINATION      400
CREDIT_EVALUATION_INDICATOR_INVALID  400
CREDIT_EVALUATION_SCHEME_INVALID     400
CREDIT_EVALUATION_MODEL_INVALID      400
CREDIT_EVALUATION_WEIGHT_INVALID     400
CREDIT_EVALUATION_INPUT_OUT_OF_RANGE 400
CREDIT_EVALUATION_MISSING_INDICATOR  400
CREDIT_EVALUATION_DUPLICATE_INDICATOR 400
CREDIT_SHEET_STATE_INVALID           409
CREDIT_SHEET_NOT_FINALIZED           409
CREDIT_SHEET_NOT_ALLOWED_SCORER      403
CREDIT_SHEET_ALREADY_FINALIZED       409
CREDIT_EVALUATION_RESULT_NOT_FOUND   404
CREDIT_EVALUATION_RESULT_ALREADY_APPLIED 409
CREDIT_RATING_TARGET_PROFILE_CHANGED 409
CREDIT_RATING_NOT_ALLOWED            403
CREDIT_RECONCILIATION_INVALID_INPUT  400
CREDIT_RECONCILIATION_NOT_APPLICABLE 409
```

所有新增错误码遵循既有 `HttpError(message, {code})` 形态（`server/lib/http.js`）。越权对象与不存在对象**共用**同一 404 码与同一 message（§37.54.8.4）。

### 37.54.6 C-2 / C-3 — DETERMINISTIC_REBUILD conflict closure

#### 37.54.6.1 A — physical existence audit

对 `DETERMINISTIC_REBUILD` 与 `credit_recalculation_history` 的物理落地核查结果：

| 核查项 | 方法 | 结果 |
|---|---|---|
| `credit_recalculation_history` 表 | `server/` 全量 `CREATE TABLE` 检索 | **0 命中** |
| 该表出现在 migration registry | `server/migrations/sales-customer-domain.js:23-42` | **否**（registry 止于 `wave-10-credit-check`） |
| 该表出现在 Wave 9 / Wave 10 DDL | `sales-customer-wave9-credit-foundation.js`、`sales-customer-wave10-credit-check.js` | **否** |
| `kind` 列 / CHECK 枚举 | 上述两个 migration 的 `CONTRACTS` | **否** |
| 任何持久化的 `DETERMINISTIC_REBUILD` 行 | 全仓检索 | **0 命中** |
| 历史数据依赖 | — | **无** |

**结论：`DETERMINISTIC_REBUILD` 只存在于未来设计文本（`solution.md:12607`、`:12616`、`:19698`），从未有任何物理枚举、字段、表、持久化记录或历史数据。** 因此不存在兼容性依赖、不存在需要保留可解释性的历史行、不存在需要迁移的枚举值。

#### 37.54.6.2 B — bounded supersession of the cache-rebuild meaning

**处置：退役（retire），不重新定义。**

```text
OLD (design text only, never implemented)
  kind = 'DETERMINISTIC_REBUILD'
  meaning: 重建一个持久化派生缓存（cache rebuild）

NEW (Wave 11)
  kind = 'DETERMINISTIC_RECALCULATION'
  meaning: 从权威事实做确定性重算，不产生任何持久化 mutable exposure cache
```

**为什么必须换名而不是重定义**：旧名称的语义内核是"重建缓存"。若把同一名称赋予"无缓存重算"，则任何读到旧设计文本或旧 kind 的读者无法区分"缓存重建"与"确定性重算" —— 这在 S05（已批准历史执行不得被静默改写）语境下构成**审计可追溯性风险**：一个未来维护者可能据旧名推断存在缓存并据以设计重建逻辑。换名使两者在字面上不可混淆，且由本 supersession map 记录退役原因与日期。

**旧名退役的副作用必须为零**：因旧名从未落地，退役不影响任何列、任何 CHECK、任何索引、任何行、任何 API 响应、任何已执行的验收证据。

#### 37.54.6.3 C — historical record interpretability without rewriting history

- `solution.md:12607`、`:12616`、`:19698` **保持原样**，不改写、不删除。它们继续作为历史设计证据存在。
- 本 supersession map（§37.54.6.5）提供从旧语义到新语义的**可追溯映射**，使旧文本在 Wave 11 语境下仍可解释。
- 因为**不存在任何物理或数据依赖**，"不伪造数据、不重写历史"在本项上**天然成立**：无需迁移、无需 backfill、无需任何历史行的重解释。
- 冻结的 Wave 9 / Wave 10 验收证据与 `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED` 不受本取代影响。

#### 37.54.6.4 D — SC99 / SC100 independent contracts

| | **SC99 CHECK-only Reconciliation** | **SC100 Deterministic Recalculation** |
|---|---|---|
| 端点 | `POST /api/credit/reconciliation/check` | `POST /api/credit/reconciliation/recalculate` |
| HTTP 语义 | POST（产生一次执行审计记录） | POST（产生一次执行审计记录） |
| 授权 | `CREDIT_EVALUATE` | `CREDIT_EVALUATE` |
| 输入 | `customerId`、`businessDate`、可选 `salespersonId`、`creditObjectType`/`creditObjectId`、可选 `referenceCheckGroupId` | `customerId`、可选 `salespersonId`、`businessDate`、`creditObjectType`/`creditObjectId` |
| 核心动作 | 读取权威事实 → 计算当前敞口 → **与参考决策比对** + **独立评估构成自身一致性** | 读取权威事实 → 计算当前敞口 → **输出重算结果与确定性证据** |
| 输出 | per-scope `{creditLimitCents, usedCents, remainingCents, components[], consistency, discrepancyCodes[], referenceComparison}` | per-scope `{creditLimitCents, usedCents, remainingCents, components[], factDigest, policySnapshotFingerprint, profileEffectiveStateHash, creditProfileId}` |
| 是否产生 Credit Check Decision | **否**（不写 `credit_check_results`，不产生 decision） | **否** |
| 是否写权威事实 | **否** | **否** |
| 审计 | 1 行 `credit_recalculation_history`（`kind='CHECK_ONLY'`）+ 1 行 `audit_logs` | 1 行 `credit_recalculation_history`（`kind='DETERMINISTIC_RECALCULATION'`）+ 1 行 `audit_logs` |
| 幂等 | 幂等键 + 执行身份（见 §37.54.13.4） | 同左 |
| 失败模式 | 事实不一致 → 409 fail closed（`CREDIT_EXPOSURE_SOURCE_INCONSISTENT`）；无档案 → 409 `CREDIT_PROFILE_MISSING` | 同左 |

**输出差异的语义边界**：SC99 回答"记录在案的结论与当前事实是否一致，构成本身是否自洽"；SC100 回答"在指定对象/范围/业务日期上，权威事实推导出的敞口与额度结果是什么，且可复现"。两者都返回 limit / used / remaining / component breakdown（R99-4、R101-1、R100-1），但 SC99 **额外**携带一致性与差异判定，SC100 **额外**携带确定性证据（`factDigest`）与快照身份。

#### 37.54.6.5 E — `credit_recalculation_history` physical decision

**需要物理存储**，理由：R99-6 / R100-6 要求记录审计与执行证据；无物理记录则"只读执行"不可证明。

**但它必须结构上不可能成为敞口余额权威数据源。设计保证：**

```text
G-1  该表不含任何**顶层金额列**。
     没有 credit_limit / exposure / used / remaining / amount / balance / cents
     之类的可聚合数值列。执行期金额只存在于唯一一个不可变结果快照 JSON 中
     （result_snapshot_json），因此不存在任何可被索引 / 聚合 / 求和的金额列。
G-2  该表没有任何外键指向 credit_profile_ratings / credit_check_results /
     credit_special_approval，因此不可能被反查当作决策证据的一部分。
G-3  没有任何信用计算路径读取该表。
     computeCreditExposure / evaluateCredit / 任何 Query 端点均不引用它。
G-4  它与余额的区别是结构性的：余额必须可累加（read + write），
     该表是只追加的、只含判定与身份与执行期结果快照的记录，
     没有任何"更新余额"的写路径。
G-5  Migration contract assertion（§37.54.12.9）显式断言该表列集合中
     不存在顶层金额型列；任何未来向该表添加金额列的改动都会使断言失败。
G-6  该表只有一个写入者（credit-reconciliation.js），且写入即终态；
     任何 UPDATE / DELETE 路径的存在即为违约。
```

**CORRECTION-2 (2026-10-27) — 撤销“digest 可恢复历史金额”的错误论断，并改为不可修改的执行期结果快照。**

Stage C 初稿在此处声称“需要历史金额时，由 `factDigest` 确定性地重算得到”。**该论断不成立**：密码学摘要**不可逆**，仅凭 `factDigest` 无法恢复任何历史 canonical fact 或历史金额；只有在底层事实**至今未变**且能够被重新读取时，重算才可能得到同一结果，而一旦事实变化，历史金额**不可得**。初稿因此给出了一个无法兑现的审计承诺。

**核对 Requirement 后的正确结论**：R99-6 / R100-6 明确要求执行证据包含“**结果摘要**”，R99-4 要求 reconciliation result 含 limit / used / remaining / component breakdown。**只存身份与元数据、完全不含结果金额，会使执行记录在源事实变化后无法自证** —— 这既不满足 Requirement，也削弱了审计价值。因此在允许的设计空间内采用**不可修改、非权威的执行期结果快照**：

```text
result_snapshot_json（唯一金额承载列，不可变，非权威）
{
  "contractVersion": "CREDIT_RECONCILIATION_RESULT_SNAPSHOT_WAVE11_V1",
  "authoritative": false,
  "consumedByCreditCalculation": false,
  "scopes": [
    { "scopeType": "CUSTOMER_AGGREGATE",
      "creditLimitCents": <int>, "usedCents": <int>, "remainingCents": <int>,
      "overLimitCents": <int>,
      "components": { ... },
      "consistency": "CONSISTENT|INCONSISTENT|UNRESOLVED",
      "discrepancyCodes": [ ... ] }
  ],
  "factCounts": { "orders": n, "deliveries": n, "receivables": n },
  "referenceComparison": "MATCHED|MISMATCHED|NOT_APPLICABLE"
}
```

**它不是余额，理由是结构性的而非仅靠约定**：

1. 它是**执行期快照**，不是当前余额 —— 每次执行追加一行，从不 UPDATE，语义是“这次执行得出了什么”，不是“现在有多少”。
2. 它**不被任何 Credit Exposure / Credit Check writer 读取**（G-3）—— 无任何路径把它当作余额输入。
3. 它带 `authoritative:false` 与 `consumedByCreditCalculation:false` 的显式标记与独立的 `contractVersion`。
4. 顶层**无金额列**（G-1 / G-5），因此不存在可被聚合的余额面。
5. **既有先例**：Wave 10 已冻结的 `credit_check_results.component_breakdown_json`（`CREDIT_EXPOSURE_BREAKDOWN_WAVE10_V1`）正是同一种"逐决策不可变敞口分解快照"，且 Wave 9 / Wave 10 的冻结设计已明确它**不是**第二套台账。Wave 11 沿用同一已被验收的模式，**不引入新的规范**。

**由此产生的直接推论（修正版）**：SC99 / SC100 的**响应**与**持久化执行证据**携带执行期金额；`factDigest` 的作用是**识别**该次执行所依据的事实集合并使确定性可验证，**不是**恢复历史金额的手段。审计员读该快照即知当时结论；若需复算，必须在**同一事实集合**（digest 相同）且**同一算法契约版本**下重算，并按 §37.54.11.3 的三态语义比较。

#### 37.54.6.6 F — R-SAL-23 structural proof vs behavioural proof

R-SAL-23 保持 `CONDITIONAL`（`document.md:5062`、`:5067`、`:5076`）。在 PURE_DERIVED 下，其验收由两类**互相独立**的证明承担：

```text
STRUCTURAL (W11-R4)  —— 证明"不存在可被覆盖的在途缓存"
  S-1  负向表名断言：schema 中不存在任何匹配敞口/占用余额语义 denylist 的表
       (credit_exposure / credit_occupancy / credit_balance /
        credit_exposure_cache / credit_occupancy_ledger)
  S-2  列级断言：credit_recalculation_history 的列集合不含金额型列
  S-3  允许清单断言：credit_* 体系中携带敞口语义金额的表仅
       credit_check_results（逐决策不可变证据）与
       credit_profile.credit_limit_cents（配置上限，非余额）
  S-4  源码静态合同断言：server/modules/credit-*.js 的全部 INSERT/UPDATE
       目标均落在允许清单内；不存在任何"更新敞口余额"的写路径

BEHAVIOURAL (W11-R3) —— 证明"重算不覆盖在途决策"
  B-1  重算与并发信用消费事务（SO 提交 / 审批 / 出库确认）并发
  B-2  断言：无 canonical Sales / Inventory / Finance / Accounting 行被修改
  B-3  断言：无 credit_check_results 行被修改或新增
  B-4  断言：无 credit_policy_snapshots 行被修改或新增
  B-5  断言：重算仅新增 credit_recalculation_history 审计行
  B-6  断言：并发 Credit Check 仍只产生一条 decision，且不被重算影响
```

结构性证明证明"没有可被覆盖的状态"，行为性证明证明"重算确实不覆盖在途决策"。两者缺一不可，**不得互相替代**。

#### 37.54.6.7 Supersession map (bounded, Wave 11 scope only)

```text
frozen clause                                  -> Wave 11 replacement
solution.md:12607  kind 'DETERMINISTIC_REBUILD'  -> kind 'DETERMINISTIC_RECALCULATION' (§37.54.6.2)
solution.md:12616  'deterministic rebuild NOT exercised
                     against any materialized cache in this baseline'
                                               -> superseded in Wave 11 scope:
                                                  deterministic recalculation IS exercised,
                                                  with no materialized cache (§37.54.6.4)
solution.md:19698  'DETERMINISTIC_REBUILD remains defined but unexercised'
                                               -> superseded in Wave 11 scope (same)
```

取代范围**仅限 Wave 11 尚未实施的设计**。历史文本不改写；取代记录本身即为可追溯证据。

### 37.54.7 W11-SEC-01 — Security Read Scope Remediation（独立有界工作包）

#### 37.54.7.1 定位与边界

W11-SEC-01 **不是** W11-A 的附带修改，而是**独立、安全优先、有界**的工作包。

| 项 | 内容 |
|---|---|
| 性质 | 修复 Wave 10 冻结读取路径上的既有数据权限缺陷（Stage A 发现，Stage B 立项） |
| 影响入口 | `listCreditCheckResults()`（`credit-check.js:1043`）、`listCreditSpecialApprovals()`（`credit-special-approval.js:299`）、`getCreditSpecialApproval()`（`:314`），以及审计确认的同类读取入口 |
| 不得变更 | Wave 10 的信用**决策**语义、**敞口计算**、**特别审批申请/决策**语义；不得静默放宽 `CREDIT_VIEW`；不得新增角色或权限码 |
| 授权 | 本次仅批准 **Design**。**Implementation 需用户另行批准跨冻结边界的有界修复授权** |
| 交付顺序 | **必须先于** W11-A 开放新的历史查询面 |

#### 37.54.7.2 复用与不新建 resolver

复用 `server/modules/credit-scope.js`（§37.54.5.3）。**唯一改动**是把"模式判定"与"谓词投影"分离：

```text
resolveCreditReadMode(db, actor, {businessDate})   NEW canonical decision
resolveCreditProfileReadScope(...)                KEEP, now delegating (behaviour identical)
creditScopePredicate(mode, {aggregateExpr, selfExpr, selfValue})   NEW pure projection
```

**不新建**第二个 Credit Scope Resolver。任何 Scope 判定都必须来自 `resolveCreditReadMode`。

#### 37.54.7.3 五级模式在该工作包中的语义

| Mode | 生效条件 | 对 check results / approvals 的效果 |
|---|---|---|
| `ALL` | `actor.roleCode === 'ADMIN'` | 全部可见 |
| `DENY` | 无 `CREDIT_VIEW`（且非 ADMIN） | **403 `CREDIT_SCOPE_DENIED`**，不产生查询 |
| `CROSS_GROUP` | 有 `CREDIT_VIEW` 且有 `SALES_CROSS_GROUP` | 全部可见（跨组数据范围） |
| `AGGREGATE_ONLY` | 有 `CREDIT_VIEW`，无 `SALES_CROSS_GROUP`，**无有效销售员身份或无有效成员关系** | 只见 Customer Aggregate 范围 |
| `AGGREGATE_PLUS_SELF` | 有 `CREDIT_VIEW`，无 `SALES_CROSS_GROUP`，有**当前有效**销售员身份与成员关系 | 见 Customer Aggregate + **本人** Salesperson Sub-Limit |

**当前有效**判定沿用 `resolveSelfSalespersonId()`（`credit-scope.js:39-50`）：活动销售员档案 + 活动销售组 + **服务端当前有效日期**下的成员关系。

**CORRECTION-1 修订**：该函数的 `businessDate` 参数**被移除**，成员关系判定固定使用 `currentBusinessDate()`（服务端当前 UTC 日历日）。原实现把调用方传入的 `businessDate` 用于成员关系的日期窗口判定，使"已按日期终止的历史成员关系"在过去的 `businessDate` 上重新命中，从而重新授予 `AGGREGATE_PLUS_SELF` —— 违反 R-D2-1。**历史上曾属于某销售组不构成永久读取权**；成员关系若已按当前日期终止，无论请求携带哪个历史 `businessDate` 都不得恢复自额度资格。

**不受影响**：既有 Aggregate Read Policy 完全保留 —— `CREDIT_VIEW` 持有者对 Customer Aggregate 的读取能力不变（§14 AP2），`SALES_CROSS_GROUP` 的跨组范围不变（AP4），`DENY` 与 `ADMIN` 行为不变（AP5）。本修正**只收紧**自额度（他人子限额）的可见性，**不新建权限模型**，五级 `CREDIT_READ_MODE` 保持不变。

#### 37.54.7.4 List 与 Detail 的同一边界

| 面 | 修复前 | 修复后 |
|---|---|---|
| `listCreditCheckResults` | 仅 `CREDIT_VIEW` | `resolveCreditReadMode` + check-results 谓词 |
| `listCreditSpecialApprovals` | 仅 `CREDIT_VIEW` | `resolveCreditReadMode` + approvals 谓词 |
| `getCreditSpecialApproval` | 仅 `CREDIT_VIEW` | `resolveCreditReadMode` + **单行同谓词**查询 |
| `getCreditProfile`（已有） | 已施加谓词 | **不变** |
| `listCreditProfiles`（已有） | 已施加谓词 | **不变** |

Detail 与 List **必须使用同一谓词构造器**，不允许 Detail 使用更宽的路径（§8 要求 A-D2-4）。

#### 37.54.7.5 单点绕过封闭

以下入口**不得**绕过 Scope：

| 绕过向量 | 封闭方式 |
|---|---|
| `sourceType=SALES_ORDER` + `sourceId` | 过滤条件与 Scope 谓词 **AND** 组合，不是替代 |
| `checkGroupId` | 同上 |
| `salesOrderId` | 同上 |
| `decision` / `scopeType` / `stage` 等业务筛选 | 同上；筛选不得**放宽** Scope |
| `limit` / `offset` | 分页在 Scope 谓词**之内**计算 |
| Detail 的 `approvalId` | 单行查询同样带 Scope 谓词 |

#### 37.54.7.6 分页 / 总数 / 排序的等价性

```text
limit   default 50, max 200, integer > 0        (越界 -> 400 CREDIT_QUERY_INVALID_PAGINATION)
offset  default 0, integer >= 0
total   COUNT(*) over the SAME predicate (same scope, same filters)

ordering (check results)
  ORDER BY business_date DESC, evaluated_at DESC, id DESC
  id 为唯一键 -> 跨引擎确定性全序

ordering (special approvals)
  ORDER BY CASE WHEN decided_at IS NULL THEN 0 ELSE 1 END ASC,
           decided_at DESC, id DESC
  显式 CASE 而非 `decided_at IS NULL DESC`：
  两引擎对 NULL 排序默认行为的差异被显式消除，PENDING 恒在前
```

**不泄漏**：`total` 必须在 Scope 谓词之内计算 —— 不得先统计全量再裁剪；不得返回"其他范围还有 N 条"之类的元信息。

#### 37.54.7.7 不可枚举性

Scope 外对象的响应与不存在对象**完全一致**：同一 status code、同一 message、同一 code（`404` + 既有形态）。不引入 403 与 404 的差异，不引入时间侧信道差异（同一查询形状、同一次返回）。

#### 37.54.7.8 审批与来源 Credit Check 的可信 scope 关联

```text
数据合同（migration 期断言，不做静默修复）：
  对每一条 credit_special_approval：
     approval.scope_type MUST equal
     (SELECT scope_type FROM credit_check_results
       WHERE id = approval.source_credit_check_result_id)
  违反 -> fail closed（迁移中止并报告），不得 UPDATE 修正

运行时合同：
  审批的可见范围由其来源 check result 推导（谓词见 §37.54.5.3）
```

#### 37.54.7.9 当前授权变动不改写历史业务事实

本工作包**只收紧可见范围**。不 UPDATE 任何 `credit_check_results` / `credit_special_approval` 行；不因授权变化删除或遮蔽历史事实。历史事实仍按其原 Business Date 与原上下文存在，只是不再对当前无权者可见。

#### 37.54.7.10 权限矩阵（正反测试须全覆盖）

| Actor | ALL | DENY | CROSS_GROUP | AGGREGATE_ONLY | AGGREGATE_PLUS_SELF |
|---|---|---|---|---|---|
| ADMIN | ✔ 全部 | ✘ | ✔ 全部 | ✘ | ✘ |
| `CREDIT_VIEW` + `SALES_CROSS_GROUP` | ✘ | ✘ | ✔ 全部 | ✘ | ✘ |
| `CREDIT_VIEW` + 有效销售员身份 | ✘ | ✘ | ✘ | ✘ | ✔ 汇总 + 本人子限额 |
| `CREDIT_VIEW` + 无有效销售员身份 | ✘ | ✘ | ✘ | ✔ 仅汇总 | ✘ |
| `CREDIT_MANAGE` only（无 `CREDIT_VIEW`） | ✘ | ✔ 403 | ✘ | ✘ | ✘ |
| `SALES_CROSS_GROUP` only | ✘ | ✔ 403 | ✘ | ✘ | ✘ |
| 无任何 Credit 权限 | ✘ | ✔ 403 | ✘ | ✘ | ✘ |

**CORRECTION-1 负向测试设计（历史成员关系不得重新授予权限）**

固定夹具：销售员 `S` 拥有 `CREDIT_VIEW`，无 `SALES_CROSS_GROUP`；其成员关系 `M` 为 `active=1` 且 `effective_to = D_end`（`D_end` 早于服务端当前日期），即**已按日期退出**；`S` 的 `salesperson_profiles` 仍 `active=1`；`S` 另有一张客户 `C` 的 Customer Aggregate 档案与一张他人销售员 `T` 的 Salesperson Sub-Limit 档案。

| # | 场景 | 请求 | 期望 | 证明的合同 |
|---|---|---|---|---|
| N-1 | 已退出成员关系 + 当前日期查询 | `GET /api/credit/check-results`（无 `businessDate`） | 模式 = `AGGREGATE_ONLY`；**不得**出现 `T` 的子限额行 | CORRECTION-1 / R-D2-1 |
| N-2 | 已退出成员关系 + **过去**的 `businessDate` | `GET /api/credit/check-results?businessDate=D_in`（`D_in` 落在 `M` 的有效期内） | 模式**仍**为 `AGGREGATE_ONLY`；**不得**出现 `T` 的子限额行 | 历史成员关系不得恢复自额度 |
| N-3 | 同上 + 直接指定 `checkGroupId` | `GET /api/credit/check-results?checkGroupId=<属于 T 子限额的组>` | 返回**空集**（不是 403，且不泄漏该组存在性） | 单点绕过封闭 |
| N-4 | 同上 + 直接指定 `approvalId` | `GET /api/credit/special-approvals/<T 子限额的审批 id>` | **404**，与"不存在"完全不可区分 | 不可枚举性 |
| N-5 | 已退出成员关系 + 篡改 `businessDate` 为未来 | `?businessDate=<未来日期>` | 模式仍为 `AGGREGATE_ONLY`；不得出现 `T` 的子限额行 | 未来日期不得授予权限 |
| N-6 | 既有 Aggregate Read Policy 未被收紧 | 同 N-1 | `C` 的 Customer Aggregate 行**仍然可见** | Aggregate Read Policy 保持（§14 AP2） |
| N-7 | 当前**有效**成员关系不受影响 | 另设销售员 `S2`，成员关系 `M2` 当前有效 | 模式 = `AGGREGATE_PLUS_SELF`；可见 `C` 汇总 + `S2` 本人子限额；**不可见** `T` 子限额 | 收紧只针对已失去的资格 |
| N-8 | 分页不得泄漏范围外计数 | `?limit=1&offset=0` | `total` 只统计 Scope 内行 | 分页在 Scope 谓词之内计算 |

**负向用例同时施加于** `listCreditCheckResults`、`listCreditSpecialApprovals`、`getCreditSpecialApproval`，并按 §37.54.7.11 在 SQLite 与 MySQL 上比对返回 id 集合与顺序。

#### 37.54.7.11 SQLite / MySQL 等价性

- 谓词只使用 ANSI 可移植构造（`IN (SELECT ...)`、`=`, `OR`, `CASE`），不依赖方言。
- 排序使用显式 `CASE`，消除 NULL 排序差异。
- 断言脚本对两引擎跑同一组 fixture，比对**返回的 id 集合与顺序**（而非 SQL 文本）。

#### 37.54.7.12 实施期技术同步（2026-10-27/28，W11-SEC-01 Implementation）

本节**只记录实施时对 §37.54.5.3 / §37.54.7 的技术落地决议**，不改写已批准设计文本，不新增业务语义。授权：`WAVE11_PACKAGE_W11_SEC_IMPLEMENTATION_ONLY`。

| # | 议题 | 决议 | 依据 |
|---|---|---|---|
| I-1 | 授权日期 | `resolveCreditReadMode(db, actor)` 内部取 `currentBusinessDate()`（服务端 UTC 日历日），**只读一次**并同时用于成员关系判定与返回的 `authorizationDate` | §37.54.5.3 三类日期合同第 1 行；CORRECTION-1 |
| I-2 | `resolveCreditProfileReadScope` 的 `businessDate` | 签名保留；`businessDate` **不转发**给 resolver，仅由 `listCreditProfiles` 用作数据过滤器 | §37.54.5.3「businessDate MUST NOT be forwarded into self-scope eligibility evaluation」 |
| I-3 | 审批可见性的锚点 | 审批的**两个分支都锚定来源 Credit Check**（`source_credit_check_result_id IN (SELECT ... )`），不锚定自身 `scope_type`；来源结果的 `scope_type` 必须与审批一致，否则 fail closed | §37.54.7.8 运行时合同「审批的可见范围由其来源 check result 推导」；§37.54.5.3 设计要点 1 |
| I-4 | 不可归属的行 | `credit_check_results.credit_profile_id IS NOT NULL` 计入**两个受限模式**的谓词；`NULL` 行不被降级为 aggregate | §37.54.5.3 设计要点 2（fail closed） |
| I-5 | 分页 / 总数 | 冻结的 Wave 10 两个列表**不新增** `limit` / `offset` / `total` 参数与字段（响应体形状不变）；既有 `LIMIT 500` 与 `ORDER BY` 在**同一条带 Scope 谓词的语句**内计算，因此计数与排序天然落在授权范围内 | §37.54.7.6 的 `limit`/`offset`/`total` 规格属于 §37.54.8 的新查询面；本次不得改动冻结响应合同（授权 §5 禁止新增 API / 改变冻结行为） |
| I-6 | 排序 | 特别审批列表改用显式 `CASE WHEN decided_at IS NULL THEN 0 ELSE 1 END ASC, decided_at DESC, id DESC`（PENDING 恒在前，与原 `decided_at IS NULL DESC` 结果等价）；信用检查结果列表保持 `evaluated_at DESC, id DESC`（`id` 为唯一键，已是跨引擎确定性全序） | §37.54.7.6「显式 CASE 而非 `decided_at IS NULL DESC`」；§37.54.7.11 |
| I-7 | ADMIN 的判定 | 三个 Wave 10 读取面由 `actorHas` 判定，ADMIN 恒为 `ALL`（与 §37.54.5.3 的 `actorHas` 语义及 §37.54.7.10 权限矩阵一致）。此前这三个面用 `allow()`，对**权限数组未显式含 `CREDIT_VIEW` 的 ADMIN** 会返回 403；本次统一为仓库既有的 ADMIN 语义，非 ADMIN 行为不变 | §37.54.7.10 权限矩阵第一行 |
| I-8 | 拒绝语义 | 三个 Wave 10 读取面在 `DENY` 模式下于**查询之前**抛 403 `CREDIT_SCOPE_DENIED`（message `没有查看信用数据的权限`）；`resolveCreditProfileReadScope` 的既有 message `没有查看信用档案的权限` 与 code 保持不变 | §37.54.7.3 DENY 行；§37.54.5.5 错误码登记表 |

**未发生事项**：本节不改变 `credit_check_results` / `credit_special_approval` 的结构、写入语义、决策语义、敞口算法、审批状态机、余额、额度或评级；不新增权限码或角色；不改写任何历史业务事实。

#### 37.54.7.13 统一本机 MySQL 测试目标与 Gate Launcher（2026-10-28 实施期技术同步）

本节**只记录实施期新增的测试基础设施设计**，不改写 §37.54.7.11 的等价性合同、§37.54.14.4 的权限矩阵或任何已批准的业务 Requirement。授权：用户 2026-10-28 指令「实现一个统一的本地 MySQL Gate Launcher」并在其后执行 W11-SEC 真实 MySQL Gate。

##### 37.54.7.13.1 目标收敛：一个实例、一个 Schema、一个最小权限账号

| 项 | 值 |
|---|---|
| Host / Port | `127.0.0.1` / `3306` |
| Database | `modern_erp_domain_test` |
| User | `modern_erp_test` |
| Disposable target | `mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test` |
| 目标 Schema 权限 | `SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, REFERENCES, INDEX, ALTER, CREATE VIEW, TRIGGER`（11 项） |
| Performance Schema 读取 | `DATA_LOCKS` / `DATA_LOCK_WAITS` / `THREADS` 三张表的 `SELECT` |
| 全局权限 | 仅 `USAGE`；无角色、无 `WITH GRANT OPTION`、无 GRANT OPTION 委派 |

**唯一权威合同仍是仓库既有实现**：`assertExactLeastPrivilegeGrants`（`server/test-utils/mysql-wave10-campaign-target.js`）。目标合同文件**不复制**该权限清单——复制会产生第二份可能漂移的权限合同。

##### 37.54.7.13.2 模块职责

| 文件 | 职责 |
|---|---|
| `scripts/gates/mysql-local-target-contract.mjs` | 唯一 canonical 的目标身份（host/port/database/user）与 disposable target 字符串。**不含任何 secret** |
| `scripts/gates/mysql-local-preflight.mjs` | **只读**核验：连接身份、五类对象计数、最小权限合同比对、与固定基线的漂移比对。**从不调用 `createDatabase()`**，因此从不建表 |
| `scripts/gates/mysql-local-baseline.mjs` | 建立固定身份基线（server UUID / CURRENT_USER / grants SHA-256）。**只读**；不建 Schema、不建账号、不发 GRANT |
| `scripts/gates/setup-mysql-local-gate.ps1` | 一次性本地设置：掩码提示输入测试账号口令 → DPAPI 加密保存 → 建立固定基线 |
| `scripts/gates/run-mysql-local-gate.ps1` | 统一 launcher：读凭据 → 读基线 → 只读 preflight → 机器级互斥锁 → 运行受保护 Gate → 独立清理复核 |
| `scripts/gates/mysql-sales-wave11-sec-gate.mjs` | W11-SEC 专属 Gate 入口，**未改动**：复用既有 `runProtectedMySqlCampaign`，只跑 W11-SEC 一个 suite |

##### 37.54.7.13.3 凭据处理合同

```text
- 口令只存在于两处：DPAPI blob（当前 Windows 用户范围）与运行 Gate 子进程的进程环境。
- 不得写入 Git、仓库配置、日志、命令行参数或任何进程参数列表。
- 首次设置通过 PowerShell 掩码提示（Read-Host -AsSecureString）获取，之后由 DPAPI 读取。
- DPAPI 使用 DataProtectionScope.CurrentUser；Windows PowerShell 5.1 不预加载该程序集，
  因此脚本必须先 Add-Type -AssemblyName System.Security（PowerShell 7 下该调用为无害 no-op）。
- launcher 在结束前清除自身进程内的敏感环境变量。
```

##### 37.54.7.13.4 固定身份基线与漂移防护

```text
- 基线由 setup 脚本**显式**建立，不是每次运行重新生成。
- launcher 的 EXPECTED 值一律从基线文件读取，与实时结果**比较**，绝不替换。
- preflight 检测到 database / currentUser / serverUuid / grants 指纹任一漂移即拒绝启动 Gate。
- 重新建立基线是**显式动作**（setup 脚本的 -ForceBaseline），且必须先报告漂移字段。
- 禁止「每次运行重新生成 EXPECTED 值」这种绕过身份漂移防护的做法。
```

##### 37.54.7.13.5 串行化与清理验证

```text
- 任何会清理 Schema 的 Gate 必须在同一台机器上串行执行。
- 统一 launcher 在运行 Gate 期间持有机器级命名互斥体
  （Global\ModernERP.MySqlGate.<database>）；拿不到锁即拒绝启动。
- 命名互斥体在进程异常退出时由操作系统释放，不会留下死锁。
- 既有受保护 runner 另有进程内 lease（activeCampaignLeases），按目标身份拒绝第二个 campaign。
- Gate 结束后，launcher **移除破坏性授权变量**后用**新会话**重新统计五类对象，
  清理结论因此不依赖 Gate 自己的报告。
```

##### 37.54.7.13.6 TAP 形状合同（I-9）

受保护 runner 用 `assertWave10TapTranscriptStrict` 严格解析子进程 transcript，其合同要求**恰好一个顶层 plan**，且 `summary.tests === summary.pass === plan`。`describe(...)` 包裹会把 plan 下沉一层，产生嵌套 TAP 而被严格解析器拒绝。

因此 W11-SEC 集成文件采用**扁平顶层 `test()`**（与同一 runner 解析的 `server/mysql-sales-customer-wave10.integration.js` 同形），共享的 setup / teardown 由顶层 `before` / `after` hook 承担。该改动**只涉及测试文件结构**，不改变任何断言、fixture、Schema、API 或业务行为。

##### 37.54.7.13.7 环境前置条件（I-10）

MySQL 8 在 `log_bin=1` 且 `log_bin_trust_function_creators=0` 时，要求 `SUPER` 或 `SET_USER_ID` 才能 `CREATE TRIGGER`。本机实例二进制日志开启，而本轮 Schema bootstrap 必须创建触发器（`inventory_mutation_log` 3 个 + Wave 2 价格 3 个）。

最小权限账号按设计**不**持有 `SUPER`（扩大账号权限被明确禁止），因此本机 MySQL 必须开启 `log_bin_trust_function_creators=1`。这是**服务器级开关**，不是账号权限：

```text
- 它不放宽账号的授权集合；grants 指纹不变，固定基线继续有效。
- 它只解除「二进制日志开启时 TRIGGER 权限不足以建触发器」这一服务器侧限制。
- 该开关为运行时生效，不重启服务、不迁移数据目录；MySQL 重启后会回到默认值。
- 禁止以「给测试账号加 SUPER / SET_USER_ID」或「改 Schema 跳过触发器」替代该开关：
  前者扩大账号权限，后者删除业务控制，二者都被禁止。
```

##### 37.54.7.13.8 未发生事项

本节不改变任何业务语义、Schema、Migration、API、UI、权限码、角色、审计、状态机、敞口算法或已冻结的 Wave 9 / Wave 10 行为；不新增第二套数据库测试架构（受保护 runner 与其严格 TAP 解析器**未修改**）；不新增 `*.test.js`（`scripts/testing/test-suites.js` 本轮**未改动**）；不修改 `document.md` 的已批准 Requirement。

##### 37.54.7.13.9 当前本机数据库清单与目标绑定（2026-10-28 用户清理后）

用户已清理旧 ERP 数据库，并以 `root` 执行 `SHOW DATABASES` 核验。本节记录清理后的**当前环境事实**，
供后续任何 Gate 重跑绑定目标时使用。

| Schema | 状态 | 用途 |
|---|---|---|
| `modern_erp_domain_test` | 存在，**空库** | 统一受保护测试目标（§37.54.7.13.1） |
| `calculator_db` | 存在，但 `calculation_history` 的 `.ibd` 文件缺失（Missing Tablespace，**未恢复正常**） | 历史遗留；本项目不使用，受保护 Gate 不触碰 |

已删除的历史 ERP Schema：`modern_erp_e2_test`、`modern_erp_phase7c_test`、
`modern_erp_phase7c_test_disposable`、`modern_erp_v161_disposable_test`、
`modern_erp_wave10_disposable_test`。

**对既有章节的读法约定**：本节之前的 Wave 10 / Wave 11 历史设计小节（如 §37.51.11 第 3 项）
所记的 disposable 目标 `modern_erp_wave10_disposable_test` 与账号 `wave10_acceptance`，
是**当时 campaign 的历史目标与历史证据来源**，其正文**不改写**；但该目标**现已不存在**，
任何未来的 Gate B / Wave 10 重跑必须绑定 §37.54.7.13.1 的统一目标，不得再指向已删除的 Schema。

### 37.54.8 W11-A — Credit Query / Exception History（SC101–SC102）

#### 37.54.8.1 API

```text
GET /api/credit/exposure
    ?customerId=            required
    &salespersonId=         optional (absent -> both scopes reported)
    &businessDate=          optional (default = today)
    &creditObjectType=      optional (default 'CUSTOMER')
    &creditObjectId=        optional (default = customerId)
    -> 200 { exposure: { customerId, businessDate, scopes: [ ... ], policySnapshot } }
    -> 409 CREDIT_PROFILE_MISSING | CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS
    -> 409 CREDIT_EXPOSURE_SOURCE_INCONSISTENT

GET /api/credit/exceptions
    ?customerId=            optional
    &scopeType=             optional (CUSTOMER_AGGREGATE | SALESPERSON_SUB_LIMIT)
    &decision=              optional (PASS|WARNING|BLOCK|SPECIAL_APPROVAL_REQUIRED)
    &stage=                 optional
    &hasApproval=           optional (true|false)
    &businessDateFrom=      optional
    &businessDateTo=        optional
    &limit= &offset=        optional
    -> 200 { exceptions: [ ... ], total, limit, offset }
    -> 400 CREDIT_QUERY_INVALID_INPUT | CREDIT_QUERY_INVALID_PAGINATION

GET /api/credit/exceptions/:checkResultId
    -> 200 { exception: { ... , approval: {...}|null , sourceOrder: {...}|null , sourceDelivery: {...}|null } }
    -> 404 (scope 外与不存在不可区分)
```

**不新增**写端点。**不新增**物理表。

#### 37.54.8.2 Response 结构 — limit / used / remaining / component breakdown

```json
{
  "exposure": {
    "customerId": "...",
    "businessDate": "2026-10-27",
    "scopes": [
      {
        "scopeType": "CUSTOMER_AGGREGATE",
        "creditProfileId": "...",
        "creditLimitCents": 10000000,
        "usedCents": 4200000,
        "remainingCents": 5800000,
        "unlimited": false,
        "overLimitCents": 0,
        "components": {
          "approvedSoCommitmentCents": 1000000,
          "deliveredNotSettledCents": 500000,
          "arOpenCents": 2700000,
          "eligiblePrepaymentCents": 0,
          "ambiguousAttributionCents": 0
        },
        "hasAmbiguousAttribution": false,
        "factCounts": { "orders": 3, "deliveries": 2, "receivables": 5 }
      }
    ],
    "policySnapshot": {
      "fingerprint": "CSP1:<64 hex>",
      "persisted": true,
      "creditPolicySnapshotId": "...",
      "profileEffectiveStateHash": "<64 hex>"
    }
  }
}
```

**口径一致性（R101-1）**：`usedCents` = `computeCreditExposure` 的 `exposureCents`；`remainingCents` = `creditLimitCents − usedCents`（可为负 → `overLimitCents > 0`）。`credit_limit_cents IS NULL`（不设上限）→ `unlimited: true` 且 `remainingCents: null`。**空档案绝不表示零额度** —— 无档案时返回 409 `CREDIT_PROFILE_MISSING`（§37.54.12.4 的空状态要求）。

#### 37.54.8.3 Component breakdown 与历史快照区分

- `components` 来自**当前事实的实时派生**（`computeCreditExposure`），不是历史快照。
- **历史**决策的 breakdown 来自 `credit_check_results.component_breakdown_json`（Wave 10 冻结载荷 `CREDIT_EXPOSURE_BREAKDOWN_WAVE10_V1`），只在例外历史中出现。二者在响应中**分属不同字段**，绝不混用。
- `policySnapshot.fingerprint` 由**只读**计算得出；若已存在对应 `credit_policy_snapshots` 行则一并返回其 id（`persisted: true`），否则 `persisted: false`。**查询路径不创建 snapshot 行**。

#### 37.54.8.4 Exception history 结构与来源

```text
权威来源 = credit_check_results
           LEFT JOIN credit_special_approval ON source_credit_check_result_id = check_result_id
           LEFT JOIN source SO / SD（sales_orders / sales_deliveries 的展示字段）
```

| 字段 | 来源 |
|---|---|
| `checkResultId` / `checkGroupId` | `credit_check_results` |
| `scopeType` | `credit_check_results.scope_type` |
| `stage` / `businessDate` | `credit_check_results` |
| `decision` | `credit_check_results.decision` |
| `reasonCodes` | `credit_check_results.reason_codes_json` |
| `recordedBreakdown` | `credit_check_results.component_breakdown_json`（历史快照） |
| `policySnapshotFingerprint` / `profileEffectiveStateHash` | `credit_check_results` |
| `sourceOrderId` / `sourceDeliveryId` | `credit_check_results` |
| `approval` | `credit_special_approval`（含 `decision`、`scopeMode`、`approvedCeilingCents`、`approvedExpiryBusinessDate`、`approverId`、`decidedAt`） |
| `sourceOrder` / `sourceDelivery` | 展示用身份字段（id / 单号 / 状态），**不**复制商业金额 |

**例外分类不重新派生**：分类完全来自已持久化的 `decision` + `reason_codes_json` + 审批 `decision`。绝不通过重算敞口来"重新判定"历史例外 —— 那将引入第二套判定逻辑并可能改写历史含义。

#### 37.54.8.5 零副作用保证

1. **静态合同**：`credit-query.js` 内**不得**出现 `INSERT` / `UPDATE` / `DELETE` / `CREATE`。以源码合同断言固化。
2. **运行时合同**：端点只在 `GET` 注册；**不开启事务**（`transaction(db, ...)` 不得被调用）；不得调用 `ensureCreditPolicySnapshot`、`ensureCreditLockAnchor`、`saveIdempotency` 或任何写函数。
3. **只读复用**：`computeCreditExposure`（纯 SELECT）、`resolveEffectiveCreditProfile`（纯 SELECT）、`buildScopeHashes`（纯 SELECT + 哈希）、`computePolicySnapshotFingerprint`（纯函数）。
4. **回归断言**：对同一请求连续调用两次，数据库**全部表的行数与内容摘要**必须完全一致（SQLite 与 MySQL 各证）。

#### 37.54.8.6 移动端 / 界面设计

- 新增 **contextual** route `credit-query`（`src/navigation/applicationRegistry.js`），**不新增 launcher 顶层入口**（§36.9.5 "Credit adds no primary top-level entry in Waves 9-11"）。
- 页面归属 `src/pages/credit-query.jsx`；路由权限 `any: ['CREDIT_VIEW']`。
- 形态：`LIST（例外历史） → DETAIL（敞口 + 例外详情）`。**无 EDITOR**（纯只读面）。
- 复用既有 Credit 工作面视觉与既有 Sales 导航；不改变既有 `credit-foundation` / `credit-check` / `credit-special-approvals` 三条路由。
- 移动优先约束（AGENTS.md §7）：主基线 390 CSS px；同时验证 320 / 430 / 680；触摸目标 ≥ 44 CSS px；核心任务不依赖永久横向滚动；状态、业务身份与 primary action 优先。
- 空状态必须明示"未配置信用档案"，不得暗示零额度。
- FAIL-CLOSED 与 PASS 必须视觉可区分（§36.9.5）。

### 37.54.9 W11-B — Credit Evaluation Foundation（SC103–SC105）

#### 37.54.9.1 业务身份与状态机

```text
credit_evaluation_indicator      定义（生效日期化）
credit_evaluation_scheme         等级方案（生效日期化）
credit_evaluation_model          模型（绑定 scheme + 权重，生效日期化）
credit_evaluation_scoring_sheet  评分表（DRAFT -> SUBMITTED -> FINALIZED -> APPLIED）
credit_evaluation_result         聚合结果（W11-C 拥有，UNIQUE(sheet_id)）
```

**版本策略复核结论**：

| 问题 | 结论 | 理由 |
|---|---|---|
| 是否需要独立 Model Version 表 | **不需要** | 沿用 Wave 9 已冻结的生效日期版本化形态：`UNIQUE(code, effective_from)`（同 `credit_parameters`、`credit_profile`）。模型权重变更 = 新模型行 |
| 是否需要独立 Scheme Version 表 | **不需要** | 同上；`UNIQUE(code, effective_from)`。等级边界随行不可变 |
| 是否需要独立评分明细表 | **不需要** | §36.7.4 已冻结"per-evaluator entries live in `sheet_data_json`"。独立明细表将构成第二套评分事实来源，违反 R-D3-3 / S05 |
| 指标是否需要版本表 | **不需要** | 同生效日期版本化；被模型引用后不得就地改写（R103-3），由 `effective_from` 承载 |

**兼容性**：以上形态与 Wave 9 已落地的 `credit_parameters` / `credit_profile` 版本化模式**同构**，不引入新的版本语义。

**CORRECTION-3 (2026-10-27) — 生效日期版本化合同补全。**

初稿仅以 `UNIQUE(code, effective_from)` 作为版本化依据，并称“模型权重变更 = 新模型行”。**该唯一键不阻止生效区间重叠**：`code='E1'` 的 `effective_from=2026-01-01` 与 `effective_from=2026-06-01` 两行可同时存在且区间重叠，导致同一业务身份在重叠期出现**两个生效版本**。补全合同如下（不新增版本表，保留已批准的定点整数评分设计）：

```text
(1) 生效区间唯一性
    同一 (kind, code) 下，任一 business date 至多命中一个生效版本。
    UNIQUE(code, effective_from) 只保证"同一生效日不重复"，
    区间重叠必须由应用层显式检测并拒绝（见 (2)(3)）。
    区间约定：effective_to 为 NULL 表示开区间至 9999-12-31。

(2) 共享锁身份（并发版本创建）
    锁身份 = 该配置的业务身份 (kind, code)，跨会话唯一。
    实现：MySQL 使用仓库既有的确定性命名锁
          SELECT GET_LOCK('erp-credit-cfg-<sha256(kind|code).slice(0,48)>', 10)
          —— 与 financial-controls.js:32-41 的幂等命名锁同一机制、
             同一受控释放合同 releaseMySqlIdempotencyLocks（db.js:1955）、
             同一 48 字符长度约定
          SQLite：无需额外锁（写事务本身串行化）
    锁必须覆盖"检测重叠 -> 关闭前驱 -> 插入新版本"的完整检查-写入区间。

(3) 前驱终止与后继切换规则
    沿用 credit-profile.js:124-136 closePredecessorAndAssertNoOverlap 的既有语义：
      - 新版本 effective_from 与某既有版本相同 -> 409（版本已存在）
      - 存在前驱且其 effective_to 覆盖新版本起始 -> 把前驱 effective_to
        收紧为 previousDate(新 effective_from)（仓库既有 previousDate 语义）
      - 新版本区间与任何既有版本区间重叠 -> 409（区间重叠）
      - 与任一版本重叠的检查覆盖整个时间线，而非只看前驱

(4) 被引用后不可变
    指标 / 方案 / 模型行一经被引用即不可就地改写（R103-3）：
      - indicator 被任一 model 的 indicator_weights_json 引用 -> 不可 UPDATE
      - scheme 被任一 model 引用 -> 不可 UPDATE
      - model 被任一 scoring_sheet 引用 -> 不可 UPDATE
    变更只能通过新建版本（新的 effective_from）实现；
    旧行保留，不被删除、不被覆盖。
    唯一允许的 UPDATE 是 status: ACTIVE -> RETIRED（单向）。

(5) 已生成评分表的可追溯性
    模型以**指标行 id**（而非 code）引用指标：
      indicator_weights_json = { "<indicator row id>": <weightMilli>, ... }
    因此追溯链为：scoring_sheet.model_id -> model.indicator_weights_json
                  -> 指标行 id -> 该不可变指标行
    由于指标 / 方案 / 模型行均不可变，该链**精确**指向评分表当时使用的
    指标版本、方案版本与权重，无需额外的快照列。
    结果行另存 model_id 与 scheme_id（既有 DDL），使结果同样可追溯。
    必须有断言：一张已 FINALIZED 的评分表所引用的模型，其指标集合与权重
    在任何时点解析结果不变（防止"事后改指标导致历史评分含义漂移"）。

(6) SQLite / MySQL 等价的冲突检测
    两引擎使用**同一套检测逻辑与同一组错误码**：
      - 409 版本已存在
      - 409 区间重叠
      - 409 引用后不可变
    差异只在序列化原语（MySQL 命名锁 + FOR UPDATE 行锁；SQLite 写事务串行化），
    **判定结果与错误码必须逐一致**。
    既有先例：credit-profile.js:125 使用 `FOR UPDATE` 锁定时间线行；
    Wave 11 在其之上补命名锁，以覆盖"时间线为空"的首次创建竞争。
```

**与既有冻结设计的兼容**：本补全不改变 Wave 9 的 `credit_parameters` / `credit_profile` 版本化语义，只是把**同一套语义**（唯一生效版本、前驱收紧、区间不重叠、引用后不可变）显式施加到 Wave 11 新增的三类配置对象上，并补上 Wave 9 用"锚点行 FOR UPDATE"实现的**空时间线竞争**缺口（以命名锁覆盖）。**不新增版本表，不新增业务语义。**

#### 37.54.9.2 评分确定性规则（整数，零浮点）

```text
单位：milli-point（1 point = 1000 milli-points）
权重：milli-weight（10000 milli-weight = 100%）

indicator.max_score_milli  : 正整数
model weight per indicator  : 整数 milli-weight，模型内合计必须 == 10000

indicator 得分（achieved）：
  QUALITATIVE -> 枚举查表：input_spec_json.options 中与输入值**恰好一条**匹配
                  -> 该 option 的 scoreMilli
  QUANTITATIVE -> 区间查表：input_spec_json.bands 中与输入值**恰好一条**匹配
                  -> 该 band 的 scoreMilli

加权贡献（contribution）：
  contribution_milli = round_half_up( achieved_milli * weight_milli / 10000 )
  即 floor( (achieved_milli * weight_milli + 5000) / 10000 )
  —— 纯整数运算，无浮点，跨引擎逐位一致

模型总分：
  total_score_milli = sum(contribution_milli over all indicators of the model)
  —— 逐项先舍入再求和，舍入点唯一

模型满分：
  max_total_milli = sum( round_half_up(max_score_milli * weight_milli / 10000) )

等级判定：
  grade = 唯一满足 band.minScoreMilli <= total_score_milli <= band.maxScoreMilli 的 grade
  方案等级区间必须连续覆盖 [0, max_total_milli]，无重叠、无空洞
```

**禁止插值、禁止浮点、禁止引擎相关舍入。** 这使 R105-2 / R105-6 与 R106-3（合成确定性）在两引擎上可逐位复现。

#### 37.54.9.3 输入合同与异常处理

| 情形 | 行为 |
|---|---|
| 定性输入不在枚举内 | 400 `CREDIT_EVALUATION_INPUT_OUT_OF_RANGE` |
| 定量输入不在任何 band 内（含越界） | 400 `CREDIT_EVALUATION_INPUT_OUT_OF_RANGE`（**不夹取**、不静默截断） |
| 模型引用的指标在评分时已失效 | 400 `CREDIT_EVALUATION_INDICATOR_INVALID` |
| 评分表缺少模型中的某个指标 | 400 `CREDIT_EVALUATION_MISSING_INDICATOR`（**不得按 0 分计入**） |
| 同一指标被重复提交 | 400 `CREDIT_EVALUATION_DUPLICATE_INDICATOR` |
| 模型权重合计 ≠ 10000 | 400 `CREDIT_EVALUATION_WEIGHT_INVALID` |
| 方案等级区间有重叠 / 空洞 / 不覆盖满分 | 400 `CREDIT_EVALUATION_SCHEME_INVALID` |
| 指标已生效且被模型引用后再改写 | 409 `CREDIT_EVALUATION_INDICATOR_INVALID`（只允许新建版本） |

#### 37.54.9.4 Scoring Sheet 生命周期与绑定

```text
DRAFT      创建；仅 sheet 作者与被列入 allowed scorer 的评分人可编辑
SUBMITTED  评分人提交自己的条目；不可再改
FINALIZED  聚合完成，生成 credit_evaluation_result；不可再改
APPLIED    评级已应用到某个 Credit Profile version（由 W11-C 写入）

绑定（创建时固定）：
  credit_object_type / credit_object_id
  customer_id
  profile_scope_key          '*' = Customer Aggregate，= 销售员 id
  business_date
  credit_profile_id          解析出的、在 business_date 生效的 profile 版本
  model_id                   模型版本（其 scheme_id 随之固定）
  allowed_evaluator_ids_json  有界评分人集合（R106-2）
```

**R105-4 的绑定纪律**：评分表绑定**版本**而非 anchor。创建时解析并固定 `credit_profile_id`；**apply 时必须重新解析**在 business_date 生效的 profile 版本并与固定值比对；不一致 → 409 `CREDIT_RATING_TARGET_PROFILE_CHANGED`（fail closed，要求重新评分），**不得静默改绑**。

**载荷规范化**：`sheet_data_json` 在写入前必须规范化为**确定性排序**的 JSON（评分人按 id 升序，条目按指标 code 升序，键名固定顺序），使 `sha256(canonicalJson(sheet_data_json))` 成为可复现的确定性摘要。

#### 37.54.9.5 API

```text
GET    /api/credit/evaluation/indicators        list (CREDIT_VIEW)
POST   /api/credit/evaluation/indicators        create version (CREDIT_MANAGE + scope)
GET    /api/credit/evaluation/schemes           list (CREDIT_VIEW)
POST   /api/credit/evaluation/schemes           create version (CREDIT_MANAGE + scope)
GET    /api/credit/evaluation/models            list (CREDIT_VIEW)
POST   /api/credit/evaluation/models            create version (CREDIT_MANAGE + scope)
GET    /api/credit/evaluation/sheets            list (CREDIT_VIEW + scope)
POST   /api/credit/evaluation/sheets            create sheet (CREDIT_EVALUATE)
GET    /api/credit/evaluation/sheets/:id        detail (CREDIT_VIEW + scope)
POST   /api/credit/evaluation/sheets/:id/score  submit own entries (CREDIT_EVALUATE + allowed scorer)
POST   /api/credit/evaluation/sheets/:id/finalize  finalize -> result (CREDIT_EVALUATE)
POST   /api/credit/evaluation/results/:id/apply apply rating to profile version (CREDIT_MANAGE + scope)  [W11-C]
```

配置类写入（indicator / scheme / model）使用既有 `requireCreditManagementAuthority`（= ADMIN 或 `CREDIT_MANAGE` + `SALES_CROSS_GROUP`，§14 AP4.1）。评分类写入使用 `requireCreditEvaluationAuthority`（`CREDIT_EVALUATE`）。**不新增权限码。**

#### 37.54.9.6 权限 / 审计 / 幂等 / 不可变历史

| 动作 | 权限 | 审计实体 / action | 幂等键作用域 | 不可变性 |
|---|---|---|---|---|
| create indicator/scheme/model version | `CREDIT_MANAGE` + scope | `CREDIT_EVALUATION_INDICATOR` / `CREDIT_EVALUATION_SCHEME` / `CREDIT_EVALUATION_MODEL`，action `CREATE_VERSION` | `code` + `effectiveFrom` | 行创建后**不得 UPDATE**（除状态迁移到 `RETIRED`，且仅允许 `ACTIVE -> RETIRED`） |
| create sheet | `CREDIT_EVALUATE` | `CREDIT_EVALUATION_SCORING_SHEET` / `CREATE` | `documentId` = 目标 scope + business_date + model_id | DRAFT 可编辑；SUBMITTED 后载荷冻结 |
| score | `CREDIT_EVALUATE` + allowed scorer | `CREDIT_EVALUATION_SCORING_SHEET` / `SCORE` | sheet_id + evaluator_id | 评分人只能写自己的条目；已提交条目不得覆盖（重复提交 → 409） |
| finalize | `CREDIT_EVALUATE` | `CREDIT_EVALUATION_RESULT` / `FINALIZE` | sheet_id | 结果行不可变（`applied_*` 除外，见 W11-C） |

幂等沿用既有 `idempotencyReplay` / `requestFingerprint` / `saveIdempotency`（`server/modules/financial-controls.js`，`credit-profile.js:149` 已是同款用法）。每次写操作在**单一事务**内完成并写 `audit_logs`（§34.7 P5）。

#### 37.54.9.7 界面

- 新增 contextual route `credit-evaluation`（`src/pages/credit-evaluation.jsx`），**不新增 launcher 顶层入口**。
- 形态：`LIST（评分表 / 模型） → DETAIL（评分表） → EDITOR（评分）`。
- 评分面为移动优先：逐指标输入、当前得分/满分/权重即时显示、提交后只读。
- 空状态、FAIL-CLOSED 与 PASS 视觉可区分。
- 配置类界面（indicator / scheme / model）为受控管理面，沿用既有 ADVANCED_CONFIGURATION 形态。

### 37.54.10 W11-C — Multi-Scorer & Rating Application（SC106–SC107）

#### 37.54.10.1 Bounded multi-scorer（SC106）

```text
范围：仅限单个 scoring sheet
聚合：每个 sheet 恰好一个 credit_evaluation_result（UNIQUE(sheet_id)）
评人数：credit_evaluation_result.evaluator_count
合成：确定性 —— total_score_milli = Σ contribution_milli
并发：finalize 对 sheet 行 FOR UPDATE -> 两个并发 finalize 只产生一个聚合结果
跨 sheet 聚合：禁止
企业级开放评人池：禁止
```

#### 37.54.10.2 Scorer 授权范围

- 评分人必须在 `allowed_evaluator_ids_json` 内 → 否则 403 `CREDIT_SHEET_NOT_ALLOWED_SCORER`。
- 评分人必须具备 `CREDIT_EVALUATE`（`requireCreditEvaluationAuthority`）。
- 评分人**不得**对其他客户或其他销售员子额度评分：sheet 在创建时固定 `customer_id` 与 `profile_scope_key`，评分端点**不接受**任何目标参数（不接受 customerId / salespersonId），因此评分人无法越界改靶（R106-5）。
- 评分端点不接受 `credit_object` / `customer` 参数 —— 目标在 sheet 上，不在请求上。

#### 37.54.10.3 评分提交与并发

```text
提交（score）事务：
  1  SELECT ... FROM credit_evaluation_scoring_sheet WHERE id=? FOR UPDATE
  2  校验 status = 'DRAFT'（SUBMITTED/FINALIZED/APPLIED -> 409 CREDIT_SHEET_STATE_INVALID）
  3  校验 actor ∈ allowed_evaluator_ids
  4  校验该 evaluator 尚无条目（重复提交 -> 409 CREDIT_SHEET_STATE_INVALID）
  5  校验条目：指标存在且有效、无重复、取值在范围内
  6  规范化 sheet_data_json（确定性排序）
  7  UPDATE sheet SET sheet_data_json=?, evaluator_count=?, updated_at=?, updated_by=?
  8  COMMIT
```

Sheet 行锁保证并发评分**不丢更新**（读-改-写整体在锁内）。多评人上限由 `allowed_evaluator_ids_json` 的长度约束（R106-1 的"有界"）。

#### 37.54.10.4 Finalize 状态机

```text
DRAFT -> SUBMITTED -> FINALIZED -> APPLIED
```

- `SUBMITTED`：所有 allowed scorer 均已提交（或显式放弃）时方可进入。设计选择：**不自动推进** —— 显式 `finalize` 要求所有 allowed scorer 均已提交，否则 409 `CREDIT_SHEET_NOT_FINALIZED`。这避免了"部分评分被静默当作完整评分"的语义歧义。
- `FINALIZED`：在同一事务内

```text
  1  SELECT ... FROM credit_evaluation_scoring_sheet WHERE id=? FOR UPDATE
  2  校验 status = 'SUBMITTED' 且所有 allowed scorer 已提交
  3  重算每条目得分与加权贡献（纯整数）
  4  校验模型指标集合完整（无缺失、无重复）
  5  判定 grade（方案等级区间唯一命中）
  6  INSERT INTO credit_evaluation_result(...)  -- UNIQUE(sheet_id) 保证唯一聚合
  7  UPDATE sheet SET status='FINALIZED', finalized_at=?, finalized_by=?
  8  audit + COMMIT
```

#### 37.54.10.5 独立 Credit Evaluation Result 身份（R107-1）

```text
credit_evaluation_result 具备自身 id、来源 sheet、model/scheme 版本、
profile 目标、total_score_milli、rating_grade、evaluator_count。
它不是 Credit Profile version，不是 Policy Snapshot，不是 Applied Rating History。
四者各自独立存储、互不替代（§37.54.5.4）。
```

`credit_evaluation_result` 同时记录评分时的身份锚点：`credit_profile_id`（评分绑定的版本）、`profile_effective_state_hash`、`policy_snapshot_fingerprint`（评分时的策略状态），使评分结论可复现。

#### 37.54.10.6 Rating Result Application → Credit Profile Version（R107-2、R107-3、R107-5、R107-6）

**唯一评级写者**（R107-4 / §36.7.1 的落实）：

```text
NEW  credit-profile.js
  applyCreditRating(db, {
    creditProfileId, ratingGrade, ratingEffectiveFrom, ratingEffectiveTo,
    businessSource,        // 'INITIAL_ASSIGNED' | 'EVALUATION_APPLIED'
    ratingSourceKey,       // INITIAL: 'INITIAL_ASSIGNED'；EVALUATION: evaluation_result_id
    evaluationResultId,    // INITIAL: null；EVALUATION: <result id>（非空）
    actorId, appliedAt,
    supersedePrevious      // INITIAL: false（无前驱）；EVALUATION: true
  })
    -> 在单一事务内：
       a) 若 supersedePrevious：把该 profile 当前未 superseded 的评级行
          superseded_at = applied_at
          （仅 superseded_at 迁移；rating_grade / applied_at / applied_by /
            evaluation_result_id 永不改写）
       b) INSERT INTO credit_profile_ratings(...)
       c) UPDATE credit_profile SET rating_grade=?, rating_effective_from=?,
          rating_effective_to=? WHERE id=?
```

**CORRECTION-4 (2026-10-27) — 双业务来源、单一写者的精确边界。**

```text
两种业务来源（同一 writer，不同来源身份）
  INITIAL_ASSIGNED
    物理 rating_source_type = 'INITIAL_ASSIGNED'   （Wave 9 既有 CHECK 取值，不改写）
    物理 rating_source_key  = 'INITIAL_ASSIGNED'
    物理 evaluation_result_id = NULL
    **不要求存在任何评分表 / 评估对象** —— INITIAL 路径不依赖 W11-B/C 的任何对象
    触发场景：Credit Profile Version 创建（Wave 9 行为）

  EVALUATION_APPLIED（业务来源名）
    物理 rating_source_type = 'EVALUATED'           （Wave 9 既有 CHECK 取值，不改写）
    物理 rating_source_key  = <evaluation_result_id>
    物理 evaluation_result_id = <evaluation_result_id>（非空，与 source_key 相等）
    要求存在已 FINALIZED 的 credit_evaluation_result（W11-C 拥有）
    触发场景：SC107 Rating Result Application

  命名说明：Wave 9 已冻结的 CHECK 仅允许 'INITIAL_ASSIGNED' 与 'EVALUATED'
  两个物理取值（wave9 migration SQLite :125 / MySQL :207）。因此本设计使用
  业务来源名 EVALUATION_APPLIED，并**显式映射**到冻结物理取值 'EVALUATED'；
  该 CHECK **不被修改、不被放宽、不被新增取值**。
```

**INITIAL 路径与 Evaluation 路径的职责分离**：

| | INITIAL_ASSIGNED | EVALUATION_APPLIED |
|---|---|---|
| 是否需要评分表 | **否** | 是（FINALIZED） |
| 是否需要 evaluation result | **否** | 是（非空 FK） |
| 授权 | 既有 `requireCreditManagementAuthority`（AP4.1） | write-class `CREDIT_MANAGE`（AP4.1）；**`CREDIT_EVALUATE` 单独不足以授权** |
| 幂等合同 | 既有 profile 创建幂等（`CREDIT_PROFILE_CREATE`） | **独立**幂等合同：结果 id + 行锁 + `applied_to_profile_id IS NULL` + `uq_credit_profile_ratings_application` |
| 审计身份 | `CREDIT_PROFILE_RATING` / `INITIAL_ASSIGNED`（既有） | `CREDIT_EVALUATION_RESULT` / `APPLY`（与 SCORE / FINALIZE 可区分） |
| 并发 | 既有档案版本锁 | §36.3.4 统一锁序 + 结果行锁 |

**唯一写者的强化（可机器验证）**：`credit_profile.rating_grade` / `rating_effective_from` / `rating_effective_to` 在 Wave 9 DDL 中**可为 NULL**（`sales-customer-wave9-credit-foundation.js:88-90`），因此 `createCreditProfile` **不再**在档案 INSERT 中提供这三个值，而是：

```text
createCreditProfile（行为保持重构）
  1  INSERT INTO credit_profile(... 不含 rating_* 三列 ...)   -- FK 顺序：档案行须先存在
  2  applyCreditRating({ businessSource:'INITIAL_ASSIGNED',
                         ratingSourceKey:'INITIAL_ASSIGNED',
                         evaluationResultId:null, supersedePrevious:false, ... })
       -> INSERT credit_profile_ratings('INITIAL_ASSIGNED','INITIAL_ASSIGNED',NULL,...)
       -> UPDATE credit_profile SET rating_grade=?, rating_effective_from=?,
                                  rating_effective_to=? WHERE id=?
  3  后置不变量断言：credit_profile.rating_grade ==
     (SELECT rating_grade FROM credit_profile_ratings
       WHERE credit_profile_id=? AND superseded_at IS NULL)
```

事务内的中间态（档案行已存在而 rating_* 尚为 NULL）**对外不可见**（未提交），事务结束时的最终行与 Wave 9 现状**逐字段一致**。

**静态合同断言**：`rating_grade` / `rating_effective_from` / `rating_effective_to` 三个列名，在 `server/modules/credit-*.js` 全部 INSERT / UPDATE 语句中**只出现在 `applyCreditRating` 之内**（一条 UPDATE）。由此"唯一写者"由**源码合同**而非仅由约定保证。

**冻结兼容性与既有评级历史**：

```text
- Wave 9 初始化行为不变：档案创建仍产出 INITIAL_ASSIGNED 评级行，
  rating_source_key='INITIAL_ASSIGNED'，evaluation_result_id IS NULL，
  且同一事务内写入档案与评级 —— 由既有
  server/sales-customer-wave9-credit-foundation.test.js **原样通过**证明；
  若该测试需要修改才能通过，说明行为已变 -> 立即停止。
- 既有评级历史**不迁移、不伪造、不清空**：既有行的 rating_grade /
  applied_at / applied_by / evaluation_result_id 永不改写；
  仅 superseded_at 可按 §36.7.2 的既定语义迁移。
- `credit_profile_ratings` 的新增外键属于**对既有冻结表的兼容性 Schema 扩展**：
  新增一条命名 FK 约束，列集合、既有 CHECK、既有唯一索引与全部既有行
  保持等价；SQLite 侧以行保全重建实现（§37.54.12.3）。
  **不得**表述为"完全没有修改旧表"。
- 不产生第二个评级正式写入路径：INITIAL 与 EVALUATION 两个来源共用
  同一个 writer 函数、同一组物理列、同一套后置不变量断言。
```

**`createCreditProfile` 必须改为调用同一 `applyCreditRating`**，从而字面上只有一个写者函数。`createCreditProfile` 当前的 INSERT 路径已把初始评级与档案创建放在同一事务内；重构后语义等价，必须由既有 `server/sales-customer-wave9-credit-foundation.test.js` **原样通过**证明（行为保持回归门）。

**Apply 事务与锁序**（承接 §36.3.4 与 §36.7.3）：

```text
1  RBAC: requireCreditManagementAuthority(actor)
       (ADMIN 或 CREDIT_MANAGE + SALES_CROSS_GROUP —— §14 AP4.1 既有语义)
       CREDIT_EVALUATE 单独不足以授权本步（R-D3-1 / A-D3-1）
2  幂等检查（idempotencyReplay）
3  锁序（§36.13 / §36.14 统一顺序）：
     3a  POLICY_SCOPE anchor   FOR SHARE
     3b  CREDIT_OBJECT anchor  FOR UPDATE   （目标 profile 的 aggregate / salesperson scope）
     3c  credit_profile 行     FOR UPDATE
4  SELECT ... FROM credit_evaluation_result WHERE id=? FOR UPDATE
     校验 applied_to_profile_id IS NULL
       -> 否则 409 CREDIT_EVALUATION_RESULT_ALREADY_APPLIED
5  重新解析在 business_date 生效的 profile 版本
     与 result.credit_profile_id 比对
       -> 不一致 409 CREDIT_RATING_TARGET_PROFILE_CHANGED（不静默改绑）
6  校验 target profile 的 customer_id / profile_scope_key 与 result 一致
     （防止跨客户 / 跨子额度应用，R107-5）
7  applyCreditRating(...)   —— 单一写者，同一事务
8  UPDATE credit_evaluation_result
       SET applied_to_profile_id=?, applied_at=?, applied_by=?
9  audit（action = 'APPLY'，与 'SCORE' / 'FINALIZE' 可区分，R-D3-2 / A-D3-3）
10 COMMIT
```

**并发保护**：`credit_evaluation_result` 行锁 + `applied_to_profile_id IS NULL` 断言，使"同一结果被应用两次"在并发下也不可能（第二个事务等待后看到非空 → 409）。`credit_profile_ratings` 的 `uq_credit_profile_ratings_application` UNIQUE(credit_profile_id, rating_source_key) 提供第二道 DB 级保证。

**不产生第二个 Credit Profile writer**：`credit_profile` 的 `rating_*` 三列**只**在 `applyCreditRating` 内被更新，且必须与同事务插入的 `credit_profile_ratings` 行取值一致 —— 由 `applyCreditRating` 单点保证，不存在第二条路径。

#### 37.54.10.7 已有 EVALUATED CHECK 约束的启用

Wave 9 已落地：

```sql
CHECK((rating_source_type='INITIAL_ASSIGNED' AND rating_source_key='INITIAL_ASSIGNED'
       AND evaluation_result_id IS NULL)
   OR (rating_source_type='EVALUATED' AND evaluation_result_id IS NOT NULL
       AND rating_source_key=evaluation_result_id))
```

W11-C 创建 `credit_evaluation_result` 后，`EVALUATED` 分支由**构造**满足：apply 写入时 `evaluation_result_id` 非空且等于 `rating_source_key`。**该 CHECK 不被修改、不被放宽。**

#### 37.54.10.8 Deferred FK 的启用

```sql
-- SQLite：建新表 -> 复制 -> 删旧 -> 重命名（行保全，参照 inventory-position-schema.js:286-318）
-- MySQL：ALTER TABLE credit_profile_ratings
--   ADD CONSTRAINT fk_credit_profile_ratings_evaluation_result
--   FOREIGN KEY (evaluation_result_id) REFERENCES credit_evaluation_result(id)
```

**加 FK 前置断言**：`SELECT COUNT(*) FROM credit_profile_ratings WHERE evaluation_result_id IS NOT NULL` 必须为 **0**（Wave 9/10 从未写入 `EVALUATED`）。不为 0 则**中止并报告**，绝不迁移、不伪造、不清空。

**加 FK 后置断言**：`credit_profile_ratings` 中每条 `evaluation_result_id IS NOT NULL` 的行，其目标必须存在于 `credit_evaluation_result`（数据级 RI）。

#### 37.54.10.9 与 Credit Check 的并发一致性（R-SAL-24 / W11-R1）

评级应用改变 `credit_profile.rating_grade` / `rating_effective_*` → 改变 `profile_effective_state_hash` → 改变 policy snapshot 指纹。因评级路径与 Credit Check 取**同一** aggregate anchor `FOR UPDATE` 与**同一** profile 行锁，两者串行化：

```text
W11-R1 断言：
  - 一次 Credit Check 只使用一个 coherent 的 effective policy / profile 版本
    （不得混合评级前后的 rating 状态）
  - 序列化结果只能是 OLD 或 NEW，不得混合
  - 评级应用与检查的 audit 行各自存在
  - 无部分应用状态
```

既有 §36.6.2 的 race-corollary invariant（特别审批必须追溯到产生它的确切 Check 与 snapshot）在 W11-C 下**不变**：评级应用**不得**改写任何 `credit_check_results` / `credit_special_approval` 行。

#### 37.54.10.10 SOD 边界

本阶段**只**实施**授权类别分离**（`CREDIT_EVALUATE` vs write-class `CREDIT_MANAGE`）。**不**强制"评分人 ≠ 应用人"（Stage B L-1 已记录：若业务后续要求人员级分离，**必须返回 Requirement 层重开**）。**不**新增角色、审批流程或权限码。

### 37.54.11 W11-D — Reconciliation & Recalculation（SC99–SC100）

#### 37.54.11.1 两个可执行操作的分离

| | SC99 CHECK-only | SC100 Deterministic Recalculation |
|---|---|---|
| 端点 | `POST /api/credit/reconciliation/check` | `POST /api/credit/reconciliation/recalculate` |
| 是否比对参考决策 | **是**（可选 `referenceCheckGroupId`） | 否 |
| 是否输出一致性判定 | **是** | 否 |
| 是否输出确定性证据 | 否 | **是**（`factDigest`） |
| 写入 | 仅 `credit_recalculation_history` + `audit_logs` | 同左 |
| 产生 Credit Check Decision | **否** | **否** |

#### 37.54.11.2 信用计算复用点

两者**共用**同一实现：`computeCreditExposure()`（`credit-check.js:385`）+ `resolveEffectiveCreditProfile()`（`credit-profile.js:44`）+ `buildScopeHashes()`（本节导出）+ `computePolicySnapshotFingerprint()`。

**不新建第二套信用算法。** 本节对 `computeCreditExposure` 的唯一改动是**返回值追加** `factDigest` 字段（纯附加；既有调用方 `credit-check.js` 与其测试不受影响）。

`factDigest` 计算：对本次读取到的权威事实集合做规范化 SHA-256：

```text
factDigest = sha256(canonicalJson({
  orders:      [{id, total_cents, salesperson_id, commercial_close_state, reviewed_at}...],
  deliveries:  [{id, sales_order_id, total_cents}...],
  receivables: [{id, source_type, source_id, amount_cents, open_amount_cents,
                 recognition_mode, item_kind, item_class, due_date}...],
}))
```

规范化输入集合的固定规则：按 `id` 升序；字段名固定顺序；只包含**参与派生计算**的字段（不含 `created_at` 等审计时间戳）；数值一律按 `Number(...)` 归一为整数；字符串一律原样（不 trim、不改大小写）。因此 `factDigest` 相同 ⇒ 事实集合逐字段相同 ⇒ 按 R100-2 派生结果必然相同。这使确定性**可验证**而非仅被声明。

**CORRECTION-2 补充 —— digest 的能力边界与绑定关系：**

```text
factDigest 的能力边界（必须如实表述）
  - 摘要不可逆：仅凭 factDigest 无法恢复任何历史 canonical fact 或历史金额
  - factDigest 相同 => 事实集合逐字段相同 => 派生结果必然相同（正向成立）
  - factDigest 不同 => 事实集合不同（但无法仅凭摘要说明"哪里不同"，
    差异需由 §37.54.11.3 的重算比对给出）
  - 因此 digest 是"同一性标识"，不是"恢复手段"

绑定关系（三者必须同时绑定才能断言可复现）
  businessDate            —— 参与派生的时间口径；不同 businessDate 不是同一次执行
  contractVersion         —— 算法/载荷契约版本；不同版本之间不构成 replay
  factDigest              —— 事实集合同一性

  executionIdentity = sha256(canonicalJson({
    kind, contractVersion, businessDate, scopeFilter, factDigest }))

replay 等价性判定（三态，不得二值化）
  EQUIVALENT     contractVersion 相同 AND businessDate 相同 AND scope 相同
                 AND factDigest 相同  -> 重算结果与历史快照必然相同
  DRIFTED        contractVersion 相同 AND businessDate 相同 AND scope 相同
                 AND factDigest 不同  -> 源事实已变化；给出差异项，不得声称等价
  NOT_COMPARABLE contractVersion 不同（或 businessDate / scope 不同）
                 -> 该 replay 不具业务意义，必须显式声明，不得静默比较
```

**读快照一致性（CORRECTION-2 修订）**：初稿称“计算本身在事务外完成（纯读取），不取任何写锁”。该说法在**一致性**上不成立 —— 在 MySQL 的 READ COMMITTED 下，多语句读取**不保证**跨语句的同一快照。本节改为使用仓库既有的 canonical 一致性读机制：

```text
server/db.js:2169  readTransaction(db, work)
  MySQL  : BEGIN + 对 mysql_transaction_gates 的共享锁 (LOCK IN SHARE MODE)
           —— 与每个写者持有的排他锁互斥（db.js:2125 FOR UPDATE），
              因此 resolver 看到**一个连贯状态**，且不改变全局隔离级别、
              不产生持久化写入（该语义已由 db.js:2190-2193 固化）
  SQLite : 延迟 BEGIN 提供一致读快照
```

SC99 / SC100 的**事实读取必须整体运行在 `readTransaction` 之内**，从而保证 orders / deliveries / receivables 来自同一快照；`factDigest` 正是在该快照内计算，与 `result_snapshot_json` 同源。既有的一致性断言（AR 来源链守恒、转换 ≤ 已交付、归属歧义分类）在同一快照内评估，异常一律 fail closed。

**失败零权威数据副作用**：任何失败（事实不一致、无档案、写入冲突）都**不写** `credit_recalculation_history`、**不写** `audit_logs`、**不修改**任何 canonical 事实。历史行只在成功提交时追加。

**确定性重放的必要前提**：重放一次历史执行，必须同时满足 ① 相同 `businessDate`；② 相同 scope；③ 相同 `contractVersion`；④ 源事实未被修改（`factDigest` 相同）。四条中任一不满足，按上面的三态语义报告，**不得**输出"一致"的结论。

#### 37.54.11.3 只读数据流与快照一致性

```text
读路径：canonical facts（Sales + Finance，只读）
      -> computeCreditExposure（纯）
      -> resolveEffectiveCreditProfile（纯）
      -> buildScopeHashes（纯）+ computePolicySnapshotFingerprint（纯）
      -> 只读查询既有 credit_policy_snapshots（若存在对应指纹则返回其 id）
      -> 响应
```

**绝不**调用 `ensureCreditPolicySnapshot`（会 INSERT）。响应中的 `policySnapshot.persisted` 如实反映是否已有对应快照行。

**CORRECTION-2 修订**：本数据流必须整体运行在 `readTransaction` 之内（`server/db.js:2169`），以保证 orders / deliveries / receivables / 参数 / 规则 / 档案状态来自**同一快照**；见 §37.54.11.5 的两阶段划分与 §37.54.11.2 的 digest 绑定。

#### 37.54.11.4 `credit_recalculation_history` 写入边界

```text
写入者：只有 credit-reconciliation.js
写入内容：kind, credit_object_type/id, customer_id, salesperson_scope_key,
          business_date, fact_digest, policy_snapshot_fingerprint,
          profile_effective_state_hash, scope_filter_json,
          result_snapshot_json, discrepancy_count, drift_detected,
          duration_ms, triggered_by, triggered_at
禁止内容：任何**顶层**金额列；金额只允许存在于唯一的不可变
          result_snapshot_json 中（CORRECTION-2，§37.54.6.5）
禁止读取者：任何信用计算路径（computeCreditExposure / evaluateCredit / 查询端点）
禁止变更：写入即终态；该表不得存在 UPDATE / DELETE 路径
```

`result_snapshot_json` 结构（CORRECTION-2；执行期结果快照，不可变、非权威）：

```json
{
  "contractVersion": "CREDIT_RECONCILIATION_RESULT_SNAPSHOT_WAVE11_V1",
  "authoritative": false,
  "consumedByCreditCalculation": false,
  "scopes": [
    { "scopeType": "CUSTOMER_AGGREGATE",
      "creditLimitCents": 10000000,
      "usedCents": 4200000,
      "remainingCents": 5800000,
      "overLimitCents": 0,
      "components": { "approvedSoCommitmentCents": 1000000,
                      "deliveredNotSettledCents": 500000,
                      "arOpenCents": 2700000,
                      "eligiblePrepaymentCents": 0,
                      "ambiguousAttributionCents": 0 },
      "consistency": "CONSISTENT",
      "discrepancyCodes": [] }
  ],
  "factCounts": { "orders": 3, "deliveries": 2, "receivables": 5 },
  "referenceComparison": "MATCHED"
}
```

该快照与 `factDigest` **同源**：二者都在 `readTransaction` 的同一快照内产生，因此快照中的金额与 digest 所标识的事实集合严格对应。

#### 37.54.11.5 事务与并发

- SC99 / SC100 是 **POST 执行**。
- **CORRECTION-2 修订**：初稿称“计算本身在事务外完成（纯读取），不取任何写锁”。该说法在**一致性**上不成立 —— MySQL 的 READ COMMITTED 下多语句读取不保证跨语句同一快照。修正为：

```text
1  事实读取整体运行在 readTransaction(db, work) 之内（server/db.js:2169）
   —— MySQL: BEGIN + 共享锁 mysql_transaction_gates (LOCK IN SHARE MODE)
      与每个写者的排他锁互斥，resolver 看到**一个连贯状态**，
      不改变全局隔离级别、不产生持久化写入（db.js:2190-2193 已固化该语义）
   —— SQLite: 延迟 BEGIN 提供一致读快照
   在该快照内同时完成：computeCreditExposure、buildScopeHashes、
   computePolicySnapshotFingerprint、factDigest 计算、result_snapshot_json 生成
2  若在快照内发现事实不一致（computeCreditExposure 抛 409）
   -> readTransaction 回滚，不写任何行，错误直接返回（fail closed）
3  快照读完成后，另起一个写事务追加 1 行 credit_recalculation_history
   + 1 行 audit_logs，然后提交
```

- 两阶段的原因：读快照与写历史**必须**分离，否则历史行会与"写入时的最新事实"产生**时间错配**（历史行声称的依据是快照，行却写在更晚的时刻）。因此历史行必须携带 `factDigest` 与 `policy_snapshot_fingerprint`，明确它绑定的是**哪个快照**。
- 读阶段**不与在途 Credit Check 竞争**：它取的是共享读边界，不取任何业务行写锁；写阶段只写 `credit_recalculation_history` 与 `audit_logs` 两张审计型表。
- **失败零权威数据副作用**：任何失败路径都**不**写历史行、**不**写 audit 行、**不**修改任何 canonical 事实。

#### 37.54.11.6 幂等与重试

```text
幂等键：请求 Idempotency-Key
执行身份（idempotency documentId）：
  kind + credit_object_type + credit_object_id + customer_id +
  salesperson_scope_key + business_date + referenceCheckGroupId(可选)

重放语义：
  - 命中同一执行身份 -> 重算并返回当前结果，不新增历史行
  - 由于 R100-2 确定性，同一事实快照下重算结果与首次完全一致
  - 因此幂等存储只保存执行身份，不保存金额（与 §37.54.6.5 一致）
```

#### 37.54.11.7 历史数据异常时的 fail-closed 行为

| 异常 | 行为 |
|---|---|
| AR 来源链不一致（`CREDIT_EXPOSURE_SOURCE_INCONSISTENT`） | 409，**不修复**，不写历史行，不静默忽略 |
| 归属模糊（`ATTRIBUTION_AMBIGUOUS`） | **不失败** —— 金额全额计入 aggregate 且在 sub-limit 下不可归属（Wave 10 已冻结语义）；响应显式携带 `hasAmbiguousAttribution` 与 `ambiguousAttributionCents` |
| 转换超过已交付义务（`TRANSITION_EXCEEDS_DELIVERED_OBLIGATION`） | 409 fail closed |
| 无生效档案 | 409 `CREDIT_PROFILE_MISSING`（**不**暗示零额度） |
| 档案生效版本不唯一 | 409 `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` |

**不静默修复历史数据**（R99-5）：任何异常都显式报告或失败，绝不写回 canonical 事实。

#### 37.54.11.8 `drift_detected` 的定义

`drift_detected = 1` 当且仅当 SC99 的参考比对发现记录决策与当前事实**不一致**（`referenceComparison = 'MISMATCHED'`）。SC100 不产出 drift（它没有参考比对），其 `drift_detected` 恒为 0。

### 37.54.12 最终 Schema / Migration / SQLite / MySQL 设计

#### 37.54.12.1 最终表清单

| # | 表 | 所属包 | 新增 | 说明 |
|---|---|---|---|---|
| 1 | `credit_evaluation_indicator` | W11-B | 新表 | 指标定义（生效日期化） |
| 2 | `credit_evaluation_scheme` | W11-B | 新表 | 等级方案（生效日期化） |
| 3 | `credit_evaluation_model` | W11-B | 新表 | 模型（scheme + 权重） |
| 4 | `credit_evaluation_scoring_sheet` | W11-B | 新表 | 评分表 |
| 5 | `credit_evaluation_result` | W11-C | 新表 | 唯一聚合结果 + 应用目标 |
| 6 | `credit_recalculation_history` | W11-D | 新表 | 审计型执行元数据 + 唯一不可变执行期结果快照（`result_snapshot_json`）；**无顶层金额列**，无任何 Credit writer 读取（CORRECTION-2） |
| 7 | `credit_profile_ratings.evaluation_result_id` → `credit_evaluation_result(id)` | W11-C | **deferred FK** | 启用 Wave 9 已预留的列 |

#### 37.54.12.2 Migration ordering 与 registry 条目

Registry 排序规则为 `(wave, id)`（`sales-customer-domain.js:44-49`），wave 合法区间 0..13。本节选用**三步** wave-11 条目，其 id 在同一 wave 内的字典序**恰好等于依赖序**：

| Registry id | wave | 内容 | 依赖 |
|---|---|---|---|
| `wave-11-credit-evaluation-foundation` | 11 | indicator → scheme → model → scoring_sheet | Wave 9 / 10 |
| `wave-11-credit-evaluation-result-application` | 11 | credit_evaluation_result + deferred FK on `credit_profile_ratings` | foundation |
| `wave-11-credit-reconciliation` | 11 | credit_recalculation_history | 无（仅依赖 Wave 9 / 10） |

字典序校验：`...-evaluation-foundation` < `...-evaluation-result-application`（`f` < `r`）< `...-reconciliation`（`e` < `r`）。**符合 §36.5.3 的 target-first 顺序**（scheme → model → scoring_sheet → result → deferred FK → credit_recalculation_history）。

#### 37.54.12.3 SQLite DDL

```sql
-- W11-B
CREATE TABLE IF NOT EXISTS credit_evaluation_indicator (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  indicator_kind TEXT NOT NULL CHECK(indicator_kind IN ('QUALITATIVE','QUANTITATIVE')),
  description TEXT NOT NULL,
  max_score_milli INTEGER NOT NULL CHECK(max_score_milli > 0),
  input_spec_json TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','RETIRED')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  CONSTRAINT uq_credit_evaluation_indicator_version UNIQUE (code, effective_from),
  CONSTRAINT ck_credit_evaluation_indicator_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS credit_evaluation_scheme (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  grade_boundaries_json TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','RETIRED')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  CONSTRAINT uq_credit_evaluation_scheme_version UNIQUE (code, effective_from),
  CONSTRAINT ck_credit_evaluation_scheme_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS credit_evaluation_model (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  scheme_id TEXT NOT NULL REFERENCES credit_evaluation_scheme(id),
  indicator_weights_json TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','RETIRED')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  CONSTRAINT uq_credit_evaluation_model_version UNIQUE (code, effective_from),
  CONSTRAINT ck_credit_evaluation_model_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS credit_evaluation_scoring_sheet (
  id TEXT PRIMARY KEY NOT NULL,
  sheet_no TEXT NOT NULL,
  model_id TEXT NOT NULL REFERENCES credit_evaluation_model(id),
  credit_object_type TEXT NOT NULL,
  credit_object_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  profile_scope_key TEXT NOT NULL,
  credit_profile_id TEXT NOT NULL REFERENCES credit_profile(id),
  business_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','SUBMITTED','FINALIZED','APPLIED')),
  allowed_evaluator_ids_json TEXT NOT NULL,
  sheet_data_json TEXT NOT NULL,
  evaluator_count INTEGER NOT NULL DEFAULT 0 CHECK(evaluator_count >= 0),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NULL,
  updated_by TEXT NULL REFERENCES users(id),
  submitted_at TEXT NULL,
  finalized_at TEXT NULL,
  finalized_by TEXT NULL REFERENCES users(id),
  applied_at TEXT NULL,
  CONSTRAINT uq_credit_evaluation_scoring_sheet_no UNIQUE (sheet_no),
  CONSTRAINT ck_credit_evaluation_scoring_sheet_dates CHECK (applied_at IS NULL OR applied_at >= created_at)
);

-- W11-C
CREATE TABLE IF NOT EXISTS credit_evaluation_result (
  id TEXT PRIMARY KEY NOT NULL,
  sheet_id TEXT NOT NULL REFERENCES credit_evaluation_scoring_sheet(id),
  model_id TEXT NOT NULL REFERENCES credit_evaluation_model(id),
  scheme_id TEXT NOT NULL REFERENCES credit_evaluation_scheme(id),
  credit_profile_id TEXT NOT NULL REFERENCES credit_profile(id),
  profile_effective_state_hash TEXT NOT NULL,
  policy_snapshot_fingerprint TEXT NOT NULL,
  business_date TEXT NOT NULL,
  total_score_milli INTEGER NOT NULL CHECK(total_score_milli >= 0),
  max_score_milli INTEGER NOT NULL CHECK(max_score_milli >= 0),
  rating_grade TEXT NOT NULL,
  evaluator_count INTEGER NOT NULL CHECK(evaluator_count > 0),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  applied_to_profile_id TEXT NULL REFERENCES credit_profile(id),
  applied_at TEXT NULL,
  applied_by TEXT NULL REFERENCES users(id),
  CONSTRAINT uq_credit_evaluation_result_sheet UNIQUE (sheet_id),
  CONSTRAINT ck_credit_evaluation_result_application CHECK (
    (applied_to_profile_id IS NULL AND applied_at IS NULL AND applied_by IS NULL)
    OR (applied_to_profile_id IS NOT NULL AND applied_at IS NOT NULL AND applied_by IS NOT NULL)
  ),
  CONSTRAINT ck_credit_evaluation_result_target CHECK (applied_to_profile_id IS NULL OR applied_to_profile_id = credit_profile_id)
);

-- W11-D
CREATE TABLE IF NOT EXISTS credit_recalculation_history (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('CHECK_ONLY','DETERMINISTIC_RECALCULATION')),
  credit_object_type TEXT NOT NULL,
  credit_object_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  salesperson_scope_key TEXT NOT NULL,
  business_date TEXT NOT NULL,
  fact_digest TEXT NOT NULL,
  policy_snapshot_fingerprint TEXT NOT NULL,
  profile_effective_state_hash TEXT NOT NULL,
  scope_filter_json TEXT NOT NULL,
  result_snapshot_json TEXT NOT NULL,
  discrepancy_count INTEGER NOT NULL DEFAULT 0 CHECK(discrepancy_count >= 0),
  drift_detected INTEGER NOT NULL DEFAULT 0 CHECK(drift_detected IN (0,1)),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK(duration_ms >= 0),
  triggered_by TEXT NOT NULL REFERENCES users(id),
  triggered_at TEXT NOT NULL
);
```

**deferred FK（SQLite）**：`credit_profile_ratings` 无 `ALTER TABLE ADD CONSTRAINT`，按 `inventory-position-schema.js:286-318` 的既有形态重建：

```sql
-- 1) 建新表（列、CHECK、FK 与既有完全一致，仅新增一条 FK）
CREATE TABLE credit_profile_ratings_new ( ... ,
  CONSTRAINT fk_credit_profile_ratings_evaluation_result
    FOREIGN KEY (evaluation_result_id) REFERENCES credit_evaluation_result(id));
-- 2) 行保全复制
INSERT INTO credit_profile_ratings_new SELECT ... FROM credit_profile_ratings;
-- 3) 换名
DROP TABLE credit_profile_ratings;
ALTER TABLE credit_profile_ratings_new RENAME TO credit_profile_ratings;
-- 4) 重建既有唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_profile_ratings_application
  ON credit_profile_ratings(credit_profile_id, rating_source_key);
```

#### 37.54.12.4 MySQL 8 DDL

MySQL 侧与 SQLite **同构**，差异仅为类型映射：

```text
TEXT     -> LONGTEXT
INTEGER  -> BIGINT
BOOLEAN-ish CHECK(0/1) -> INTEGER（MySQL CHECK 表达式原生支持）
JSON 载荷 -> JSON
id / 外键列 -> VARCHAR(128)
```

每张表的 MySQL DDL 显式写出（参照 `sales-customer-wave10-credit-check.js:98-145` 的既有形态），并在 `server/database/mysql-schema.js` 的类型映射中登记对应的 JSON 列，使**新建 MySQL 库**（由 SQLite 快照 bootstrap）与**存量 MySQL 库**（live upgrade）产出**同构**结果。

关键差异点：

- MySQL 8 支持 CHECK 约束（8.0.16+），与 SQLite 的 CHECK 语义对齐；`CHECK(drift_detected IN (0,1))` 在两引擎均为真值约束。
- MySQL 不支持 `ALTER TABLE ... ADD CONSTRAINT` 之外的表重建语义，deferred FK 走 `ALTER TABLE credit_profile_ratings ADD CONSTRAINT fk_credit_profile_ratings_evaluation_result FOREIGN KEY (evaluation_result_id) REFERENCES credit_evaluation_result(id)`（既有先例：`mysql-schema.js:239`）。
- SQLite 的 `INTEGER` 与 MySQL 的 `BIGINT` 对 `max_score_milli` 等分值均足够；**全部评分数值使用整数**，无 FLOAT/DOUBLE 列。
- 字符集与排序规则沿用既有 Credit 表：`utf8mb4 / utf8mb4_0900_ai_ci`。

#### 37.54.12.5 Fresh install / Upgrade / Idempotent replay

| 路径 | 义务 |
|---|---|
| Fresh SQLite init | registry 重放 wave 1..11，创建 14 张 Credit 表（Wave 9 六张 + Wave 10 两张 + Wave 11 六张） |
| Wave 8 → 9 → 10 → 11 upgrade | 每个 wave 只新增自己的表；既有表与行不被触碰（`credit_profile_ratings` 因 FK 而被**重建**，但列、CHECK、唯一索引与**全部行**保持等价） |
| Fresh MySQL init | SQLite 快照 → MySQL → registry 重放，得到相同 PK/UNIQUE/FK/CHECK 形状 |
| Live MySQL sequential upgrade | 逐 wave 增量应用于 live adapter |
| Repeated replay | 每一步 probe-then-act；第二次完整重放为已验证 no-op |

**Idempotency 形态**（沿用既有）：`CREATE TABLE IF NOT EXISTS` + 索引存在性探测（`information_schema.STATISTICS` / `PRAGMA index_list`）+ FK 添加前的存在性探测。deferred FK 的重复添加必须被探测跳过。

**注意**：`credit_profile_ratings` 的 SQLite 重建在重复重放时必须被探测跳过（探测"新 FK 已存在"），否则会重建两次。

#### 37.54.12.6 历史行保全与未知历史数据处理

- 六张新表**无历史行**，无需 backfill。
- `credit_profile_ratings` 的既有行**全部保留**，`evaluation_result_id` 全部为 NULL（Wave 9/10 从未写 `EVALUATED`）。
- **加 FK 前置断言**：`COUNT(*) WHERE evaluation_result_id IS NOT NULL` 必须为 0；否则**中止并报告**，**不**迁移、**不**伪造、**不**清空。
- 未知的既有历史行（若未来出现脏数据）**不做猜测式修复** —— migration fail closed 并报告，由人工处置。
- `LEGACY_DATA_EVIDENCE_PENDING` 适用于既有 legacy 兼容路径，**不**适用于本节的六张新表或 deferred FK。

#### 37.54.12.7 与 Wave 9 / 10 既有字段及约束的冲突检查

| 检查项 | 结论 |
|---|---|
| 新表列名是否与 Wave 9/10 冲突 | 无 —— 六张表均为新表名 |
| `credit_evaluation_result.applied_to_profile_id` → `credit_profile(id)` | 目标存在；`credit_profile.id` 是 PK ✓ |
| `credit_evaluation_result.sheet_id` → `credit_evaluation_scoring_sheet(id)` | 目标存在；PK ✓ |
| `credit_evaluation_scoring_sheet.credit_profile_id` → `credit_profile(id)` | 目标存在；PK ✓ |
| `credit_evaluation_scoring_sheet.customer_id` → `customers(id)` | 目标存在 ✓ |
| `credit_evaluation_model.scheme_id` → `credit_evaluation_scheme(id)` | 新表，PK ✓ |
| `credit_profile_ratings` 既有 CHECK 是否被改动 | **否** —— 只增加一条外键，CHECK 原样保留 |
| `credit_profile_ratings` 的变更性质（CORRECTION-4 明确） | 这是**对既有冻结 Wave 9 表的兼容性 Schema 扩展**：新增一条命名 FK 约束；列集合与顺序、既有 3 条 CHECK、既有唯一索引 `uq_credit_profile_ratings_application` 与**全部既有行**保持等价；SQLite 侧以行保全重建实现。**不得**表述为"完全没有修改旧表" |
| `uq_credit_profile_ratings_application` 是否被改动 | **否** —— 重建后按原定义重建 |
| `credit_check_results` / `credit_special_approval` 是否被改动 | **否** —— W11 不触碰这两张表的结构（W11-SEC 只改读取路径的**查询**，不改表） |
| Wave 9 / Wave 10 迁移文件是否被改动 | **否** —— Wave 11 为独立的 registry 条目 |

#### 37.54.12.8 索引设计

```text
credit_evaluation_indicator      uq_credit_evaluation_indicator_version (code, effective_from) UNIQUE
                                 ix_credit_evaluation_indicator_lookup (code, status, effective_from)
credit_evaluation_scheme         uq_credit_evaluation_scheme_version (code, effective_from) UNIQUE
credit_evaluation_model          uq_credit_evaluation_model_version (code, effective_from) UNIQUE
                                 ix_credit_evaluation_model_scheme (scheme_id, effective_from)
credit_evaluation_scoring_sheet  uq_credit_evaluation_scoring_sheet_no (sheet_no) UNIQUE
                                 ix_credit_evaluation_scoring_sheet_scope (customer_id, profile_scope_key, business_date)
                                 ix_credit_evaluation_scoring_sheet_status (status)
credit_evaluation_result         uq_credit_evaluation_result_sheet (sheet_id) UNIQUE
                                 ix_credit_evaluation_result_profile (credit_profile_id)
                                 ix_credit_evaluation_result_applied (applied_to_profile_id)
credit_recalculation_history     ix_credit_recalculation_history_scope (customer_id, business_date)
                                 ix_credit_recalculation_history_kind (kind, triggered_at)
```

`credit_recalculation_history` **不建**金额列，故不存在金额索引。

#### 37.54.12.9 Contract assertions

沿用 Wave 8 / 9 / 10 形态（`sales-customer-wave8-service-consignment.js:389-497` 的 `information_schema` 断言 + `PRAGMA` 断言）：

每张新表断言：列集合与顺序、NULLability、默认值、PK 列顺序、**命名 FK 集合与目标**、命名 UNIQUE 组与列顺序、CHECK 数量、索引形状。**必须在建表后无条件断言**，使 `CREATE TABLE IF NOT EXISTS` 无法静默采纳漂移的既有结构。任一不符 → fail closed，**不做修复性 DDL**。

#### 37.54.12.10 MySQL 物理元数据对等 + FK 实际存在与数据级 RI 的独立验证

**`server/database/mysql-schema.js:410` 设 `SET FOREIGN_KEY_CHECKS=0`，至 `:472` 才恢复。** 因此 DDL 成功**不能**替代引用完整性证据。§36.5.5 已规定，本节具体化为三项**独立**验证：

```text
I-1  命名 FK 存在性
     每条声明的 FK 必须出现在 information_schema.KEY_COLUMN_USAGE，
     且 CONSTRAINT_NAME / COLUMN_NAME / REFERENCED_TABLE / REFERENCED_COLUMN 全部匹配

I-2  被引用候选键
     每个 FK 目标列必须是目标表 PRIMARY KEY 或命名 UNIQUE 的最左前缀

I-3  数据级引用完整性
     对每条 FK 逐行验证：子表非空外键值必须在父表存在
     （含 credit_profile_ratings.evaluation_result_id ->
      credit_evaluation_result.id）

附加  I-4  跨引擎形状对等
      SQLite 与 MySQL 的列名/顺序/NULLability/PK/FK 目标/UNIQUE/CHECK 数量
      通过同一份 CONTRACTS 常量断言，两引擎跑同一断言逻辑
```

#### 37.54.12.13 Rollback / compatibility

```text
新增对象：6 张新表 + 1 条 deferred FK
既有对象形状变更：仅 credit_profile_ratings 增加一条 FK 约束
既有数据变更：无（无 backfill、无 UPDATE、无 DELETE）

Rollback：
  MySQL  : ALTER TABLE credit_profile_ratings DROP FOREIGN KEY fk_credit_profile_ratings_evaluation_result;
           DROP TABLE credit_evaluation_result; ... ; DROP TABLE credit_evaluation_indicator;
  SQLite : 重建 credit_profile_ratings 去掉该 FK；DROP TABLE ...（按依赖逆序）

兼容性：
  - 新表对 Wave 9/10 代码零影响（无既有代码引用）
  - credit_profile_ratings 的 EVALUATED 分支在 Wave 11 前不可达，加 FK 不改变可达性
  - 加 FK 前后，INITIAL_ASSIGNED 分支行为完全不变
  - 既有 Wave 9 / Wave 10 迁移文件不被改动
```

### 37.54.13 Transaction / Lock Order / Idempotency / Audit

#### 37.54.13.1 授权矩阵（Wave 11 全操作）

| 操作 | 权限 | Scope 约束 | SOD |
|---|---|---|---|
| 读取 exposure / exceptions | `CREDIT_VIEW` | 五级 `CREDIT_READ_MODE` | — |
| 读取 check results / approvals（修复后） | `CREDIT_VIEW` | 五级 `CREDIT_READ_MODE` | — |
| 读取 indicator / scheme / model / sheet / result | `CREDIT_VIEW` | sheet 施加 scope 谓词 | — |
| 创建 indicator / scheme / model 版本 | `CREDIT_MANAGE` | `requireCreditManagementAuthority`（ADMIN 或 `CREDIT_MANAGE` + `SALES_CROSS_GROUP`） | — |
| 创建 / 评分 / 终评 scoring sheet | `CREDIT_EVALUATE` | 目标由 sheet 固定；评分人须在 allowed 集合内 | 评分 ≠ 应用（**不强制**） |
| 读取 indicator / scheme / model 配置 | `CREDIT_VIEW` | 全局（AP5 读合同） | — |
| **应用评级结果到 profile version** | **write-class：`CREDIT_MANAGE`（+ 既有后端管理 scope 限制）** | 目标 profile 的 customer / scope 必须与 result 一致 | 评分 ≠ 应用（**不强制**） |
| 申请特别审批 | `CREDIT_SPECIAL_APPROVE` | 既有 | 请求人 ≠ 审批人（既有 Wave 10 合同，**不变**） |
| 决策特别审批 | `CREDIT_MANAGE` | 既有 | 同上 |
| SC99 / SC100 执行 | `CREDIT_EVALUATE` | 目标 customer 必须在可读范围 | — |

**`CREDIT_EVALUATE` 不自动授予评级应用写权限**；**`CREDIT_VIEW` 仅授权读取，不授予跨 Scope 查看**；**不新增任何权限码**。

#### 37.54.13.2 锁序与锁身份

Wave 11 全部写路径**复用 §36.13 / §36.14 的统一顺序**，不自建顺序：

```text
1  POLICY_SCOPE anchor   FOR SHARE
2  CREDIT_OBJECT anchor  FOR UPDATE
3  credit_profile 行     FOR UPDATE
4  业务行（sheet / result）
```

理由：评级应用必须与并发 Credit Check 串行化（§37.54.10.9）。若评级应用采用不同顺序，会与 Credit Check 形成新环。**Wave 11 不得引入新的锁序层，也不得引入新的 anchor 类型。**

#### 37.54.13.3 零失败副作用

| 场景 | 行为 |
|---|---|
| 授权失败 | 在任何写入前 403 |
| 输入校验失败 | 在任何写入前 400 |
| 幂等重放 | 返回已存结果，**不产生第二次效果** |
| 唯一约束冲突 | 回滚，翻译为业务错误（沿用 `translateConstraintError`） |
| 事实不一致 | 回滚，409 fail closed |
| 重复应用同一 result | 409（行锁 + `applied_to_profile_id IS NULL` 断言 + UNIQUE 三重保证） |
| 并发 finalize | 第二个事务等待后被拒（UNIQUE(sheet_id)） |

#### 37.54.13.4 幂等

| 操作 | 幂等作用域 | 机制 |
|---|---|---|
| 创建 indicator / scheme / model | `code` + `effectiveFrom` | `idempotencyReplay` + 业务 UNIQUE |
| 创建 sheet | 目标 scope + business_date + model_id | `idempotencyReplay` |
| 评分提交 | sheet_id + evaluator_id | 状态机 + sheet 行锁（重复提交 409） |
| finalize | sheet_id | 状态机 + UNIQUE(sheet_id) |
| **应用评级** | result_id | 行锁 + `applied_to_profile_id IS NULL` + `uq_credit_profile_ratings_application` |
| SC99 / SC100 | 执行身份（kind + object + scope + business_date [+ reference]） | 幂等存储只存执行身份，**不存金额**；重放时重算 |

#### 37.54.13.5 Audit

所有 Wave 11 写操作写 `audit_logs`，且**审计身份可区分**（R-D3-2 / A-D3-3）：

```text
CREDIT_EVALUATION_INDICATOR   / CREATE_VERSION
CREDIT_EVALUATION_SCHEME      / CREATE_VERSION
CREDIT_EVALUATION_MODEL       / CREATE_VERSION
CREDIT_EVALUATION_SCORING_SHEET / CREATE | SCORE | FINALIZE
CREDIT_EVALUATION_RESULT      / FINALIZE | APPLY
CREDIT_RECALCULATION          / CHECK_ONLY | DETERMINISTIC_RECALCULATION
```

审计载荷必须包含：actor、business_date、目标身份、policy snapshot 指纹、profile effective state hash（适用时）、结果标识。审计行**不得**成为任何计算输入。

#### 37.54.13.6 SQLite / MySQL 事务语义

- SQLite：`BEGIN IMMEDIATE` 串行化写者；行锁语义由 SQLite 自身保证。
- MySQL：READ COMMITTED（§37.17，2026-10-25 修正后的口径）；显式 `FOR UPDATE` / `FOR SHARE`。
- 两引擎**使用同一套锁序与同一套状态机**，不依赖任一引擎的隐式行为。
- **不得**因为 MySQL 的全局事务门串行化了写操作，就宣称业务对象层面的并发设计已被证明 —— 业务并发证明必须来自 §37.54.14 的独立会话 fixture。

### 37.54.14 Acceptance architecture

#### 37.54.14.1 SC99 / SC100 — UAT-S-34

| UAT 子断言 | API / UI | Schema | Writer / Reader | 测试类型 | MySQL 证据 |
|---|---|---|---|---|---|
| A1 CHECK-only 返回 per-scope limit/used/remaining/breakdown 与一致性 | `POST /api/credit/reconciliation/check` | `credit_recalculation_history`（写） | Writer: reconciliation；Reader: — | SQLite 行为 | Fresh + Upgrade |
| A2 双限额分别报告，无未归属合并数字 | 同上 | 同上 | 同上 | SQLite 行为 | 同上 |
| A3 显式 business_date 生效 | 同上 | 同上 | 同上 | SQLite 行为 | 同上 |
| A4 零写入（Sales/Finance/Inventory/Accounting 逐字段一致） | 同上 | 全库摘要比对 | — | SQLite 行为 | 同上 |
| A5 确定性：同事实快照重复执行结果一致 | 同上 | `fact_digest` | — | SQLite 行为 | 同上 |
| A6 不覆盖在途/历史 Credit Check | 同上 | `credit_check_results` / `credit_policy_snapshots` 摘要比对 | — | SQLite 行为 | **独立会话并发** |
| A7 无持久化 mutable exposure cache（结构性） | — | 负向 schema 断言 + 源码静态合同 | — | 静态合同 | `information_schema` 断言 |
| A8 审计证据存在且非权威 | 同上 | `credit_recalculation_history` | Reader: 无计算路径引用 | 静态合同 + 行为 | 同上 |

#### 37.54.14.2 SC101 / SC102 — UAT-S-35

| UAT 子断言 | API / UI | Schema | Writer / Reader | 测试类型 | MySQL 证据 |
|---|---|---|---|---|---|
| A1 limit/used/remaining 与 Check 口径一致 | `GET /api/credit/exposure` | 无新增 | Reader: profile + facts | SQLite 行为 | 同查询在 MySQL 等价 |
| A2 component breakdown 含来源身份 | 同上 | 无新增 | 同上 | 同上 | 同上 |
| A3 例外历史覆盖各类例外与 reason codes，可分别过滤 | `GET /api/credit/exceptions` | 无新增 | Reader: `credit_check_results` + `credit_special_approval` | 同上 | 同上 |
| A4 零副作用 | 同上 | 全库摘要比对 | — | 静态 + 行为 | 同上 |
| A5 历史结论可链接 snapshot 指纹与 profile 状态 | `GET /api/credit/exceptions/:id` | 无新增 | Reader: `credit_check_results` | 同上 | 同上 |
| A6 稳定排序 + 分页 + Scope 内总数 | 列表端点 | 无新增 | — | SQLite 行为 | 两引擎返回 id 序列一致 |
| A7 后端谓词级数据范围 | 全部读取面 | 无新增 | — | 权限负向矩阵 | 两引擎等价 |

#### 37.54.14.3 SC103 — SC107 — UAT-S-36

| UAT 子断言 | API / UI | Schema | Writer / Reader | 测试类型 | MySQL 证据 |
|---|---|---|---|---|---|
| A1 指标类型/有效期/最大分值可定义并校验 | `POST /api/credit/evaluation/indicators` | `credit_evaluation_indicator` | Writer: evaluation | SQLite 行为 + 迁移 | Fresh + Upgrade + Parity |
| A2 方案等级边界无重叠无空洞 | `POST .../schemes` | `credit_evaluation_scheme` | 同上 | 同上 | 同上 |
| A3 模型权重可校验，非法权重被拒 | `POST .../models` | `credit_evaluation_model` | 同上 | 同上 | 同上 |
| A4 评分表生命周期受控；缺失指标不按 0 分计入 | `POST .../sheets` + `/score` + `/finalize` | `credit_evaluation_scoring_sheet` | 同上 | 同上 | 同上 |
| A5 多评人限于单表；单聚合；合成确定性 | `/finalize` | `credit_evaluation_result` | 同上 | SQLite 行为 | **W11-R2 独立会话并发** |
| A6 评级结果独立身份 | `GET .../results/:id` | `credit_evaluation_result` | 同上 | 静态 + 行为 | FK 存在性 + RI |
| A7 绑定 profile version；重复应用被拒且无第二次效果 | `POST .../results/:id/apply` | `credit_profile_ratings` + `credit_evaluation_result` | Writer: evaluation（唯一） | SQLite 行为 | **W11-R1 独立会话并发** |
| A8 write-class authority 强制 | 同上 | — | — | 权限负向 | 同上 |
| A9 无第二个 profile 写者；历史 check/approval 未被改写 | 全 Wave 11 | 全库摘要比对 | 静态合同（唯一 writer 断言） | 静态 + 行为 | 同上 |

#### 37.54.14.4 W11-SEC-01 权限负向矩阵

| 面 | 正向 | 负向 | 类型 |
|---|---|---|---|
| `listCreditCheckResults` | ADMIN / CROSS_GROUP 可见全部；AGGREGATE_ONLY 只见汇总；AGGREGATE_PLUS_SELF 见汇总 + 本人 | DENY 403；AGGREGATE_ONLY 不得见他人子限额行；AGGREGATE_PLUS_SELF 不得见他人子限额行 | SQLite 行为 + 权限负向 | 两引擎返回 id 集合等价 |
| `listCreditSpecialApprovals` | 同上 | 同上 | 同上 | 同上 |
| `getCreditSpecialApproval` | 可见范围与 List 一致 | Scope 外 → 404（与不存在不可区分） | 同上 | 同上 |
| 单点绕过 | `sourceId` / `checkGroupId` / `approvalId` / 分页 均不越界 | 逐一负向用例 | 同上 | 同上 |
| 历史不改写 | 授权变更后历史行**逐字段不变** | — | 静态 + 行为 | 同上 |

#### 37.54.14.5 Race / 并发证据矩阵

| Fixture | 竞争事务 | 锁 | 期望 | 证据级别 |
|---|---|---|---|---|
| W11-R1 | 评级应用 vs Credit Check | AGGREGATE anchor + profile 行 | 串行化；一次检查不混合评级前后状态 | **真实 MySQL 独立会话** |
| W11-R2 | 两次并发 finalize | sheet 行 FOR UPDATE | 恰好一个聚合结果；`evaluator_count` 正确 | **真实 MySQL 独立会话** |
| W11-R3 | 重算 vs 并发信用消费事务 | 只读 canonical 扫描 | 无 canonical Sales/Inventory/Finance/Accounting 行被修改 | **真实 MySQL 独立会话** |
| W11-R4 | n/a（静态） | n/a | 不存在持久化 exposure cache；断言成立 | 静态合同 + `information_schema` |

所有 race fixture 必须遵循 §36.8.1 的**容量前置断言**（先证明 `available`，再断言"恰好一个失败"），使用独立连接、显式事务、READ COMMITTED。**不得**以 intra-session 模拟宣称 PASS。

#### 37.54.14.6 证据分级（不得混淆）

```text
E1 静态源码合同         —— 唯一写者、无顶层金额列、无 INSERT/UPDATE 于查询模块、负向 schema 断言
E2 SQLite 行为证据     —— 功能、权限负向、状态机、幂等、零副作用、迁移与重放
E3 真实 MySQL 证据     —— Fresh / Upgrade / Replay / FK 存在性 / 数据级 RI / 形状对等 / 独立会话并发
E4 浏览器 / 移动端证据 —— 320 / 390 / 430 / 680 CSS px，direct/refresh/back/forward
E5 门禁证据            —— Build / FAST / FULL / HEAVY
```

**不得预先宣布任何测试 PASS。** 本节只定义应取得哪一级证据。

**证据状态规则（CORRECTION-5 明确）**：

```text
- E2 PASS 不等于 E3 PASS。SQLite 行为证据不得被当作真实 MySQL 证据引用，
  也不得由静态合同、既有 Wave 10 证据或设计文档代替。
- 未实际执行的项目，证据状态一律记为 NOT_RUN；不得以 PASS、预期通过或
  "与既有行为一致"等措辞代替。
- 每个包的 Acceptance 标识必须与其实际取得的最高证据等级一同签发；
  证据等级不足时只能签发带 `_SQLITE_PASS_MYSQL_NOT_RUN` 之类的限定标识。
```

#### 37.54.14.7 浏览器 / 移动端验收

新增界面：`credit-query`（W11-A）、`credit-evaluation`（W11-B / W11-C）。

```text
脚本：scripts/acceptance/sales-customer-wave11-credit-responsive.mjs
既有先例：scripts/acceptance/sales-customer-wave9-credit-responsive.mjs
宽度：320 / 390 / 430 / 680 CSS px（390 为主基线）
检查项：直接 URL / 刷新 / 返回 / 前进；空状态；FAIL-CLOSED 与 PASS 可区分；
        触摸目标 >= 44 CSS px；核心任务无永久横向滚动；无新增 launcher 顶层入口
```

#### 37.54.14.8 门禁

```text
日常有界：pnpm test:fast && pnpm build && git diff --check
跨域 / canonical metadata：pnpm test && pnpm build && git diff --check
schema / migration / MySQL：追加 pnpm test:heavy
MySQL（需受保护 disposable 环境 + 独立授权）：pnpm test:mysql（及既有 wave10 专用 runner 不重跑）
```

测试 suite 登记于 `scripts/testing/test-suites.js`（既有 credit 条目在 `:104-105`）。

### 37.54.15 Package contracts and dependency DAG

#### 37.54.15.1 依赖 DAG

```text
        [W11-SEC]  Security Read Scope Remediation
              |
              v
        [W11-A]    Credit Query / Exception History      SC101-SC102

        [W11-B]    Evaluation Foundation                  SC103-SC105
              |
              v
        [W11-C]    Multi-Scorer / Rating Application      SC106-SC107

        [W11-D]    Reconciliation / Recalculation         SC99-SC100
              ^
              |  (仅依赖 W11-SEC 的 Scope 合同)
        [W11-SEC]
```

**CORRECTION-5 (2026-10-27) — 依赖边修正。** 初稿的 DAG 把 `W11-A → W11-D` 画成硬依赖，属**未经 Requirement 依据**的过度约束，已撤销。

```text
硬依赖（成立，且有 Requirement / Stage B 依据）
  W11-A  -> W11-SEC   （Stage B §11："W11-SEC 必须先于开放新的历史查询入口完成"）
  W11-C  -> W11-B    （SC106 的评分表与 SC107 的评估结果对象由 W11-B 提供）
  W11-D  -> W11-SEC  （W11-D 的对外读取必须满足 W11-SEC 的 Scope 合同）

非依赖（明确不构成阻塞）
  W11-B  !-> W11-A
  W11-D  !-> W11-A   （撤销）
  W11-A  !-> W11-B / W11-C
  W11-D  !-> W11-B / W11-C
```

`W11-D` 与 `W11-A` 之间只允许**可选复用**：若 `W11-A` 已落地，`W11-D` **可以**复用其读取构造器（`creditScopePredicate`、分页与排序构造），但 `W11-D` 的实施**不因此被阻塞**，也**不得**因此新增硬依赖。若 `W11-A` 未落地，`W11-D` 自行实现等价的 Scope 谓词投影即可 —— 二者共用 `credit-scope.js` 的**同一个**授权判定（`resolveCreditReadMode`），因此不会出现两套互相冲突的 Scope 语义。

#### 37.54.15.2 W11-SEC — Security Read Scope Remediation

| 项 | 内容 |
|---|---|
| 功能范围 | `credit-scope.js` 拆分（`resolveCreditReadMode` + `creditScopePredicate`）；`listCreditCheckResults` / `listCreditSpecialApprovals` / `getCreditSpecialApproval` 施加 Scope 谓词；分页 / 总数 / 稳定排序；不可枚举响应 |
| 文件影响 | `server/modules/credit-scope.js`（重构）、`server/modules/credit-check.js`、`server/modules/credit-special-approval.js`（读取路径）、`server/app.js`（仅在需要新参数时）、新增 `server/sales-customer-wave11-sec-scope.test.js`、测试 suite 登记 |
| 复用点 | `resolveCreditProfileReadScope`（保留并委托）、`resolveSelfSalespersonId`、`sales-scope.js` 的 `actorHas` / `activeSalespersonForActor` |
| 新增表 / API / UI | **无表**；**无新 API**；**无新 UI** |
| 事务 / RBAC | 只读查询，无事务；五级 `CREDIT_READ_MODE` |
| 测试范围 | 权限负向矩阵（§37.54.14.4）、分页等价性、不可枚举性、Wave 9/10 回归不受影响 |
| MySQL Gate | 两引擎返回 id 集合与顺序等价；`listCreditCheckResults` / `listCreditSpecialApprovals` / `getCreditSpecialApproval` 的 scope 断言 |
| 停止条件 | 任何既有 Wave 10 行为（决策、敞口、审批语义、响应字段语义）发生变化 → 立即停止 |
| Acceptance 标识 | `W11_SEC_01_ACCEPTANCE_PASS` |
| 授权边界 | **需用户另行批准的跨冻结边界有界修复授权**；不得夹带进其它包 |
| 后续授权边界 | 完成后方可授权 W11-A |

**W11-SEC-01 Freeze Boundary（CORRECTION-5 明确）**

```text
允许（且仅允许）收紧已批准的越权读取行为
  - 对 Wave 10 读取路径施加 canonical Credit Read Scope 谓词
  - 收紧密钥可见性（他人子限额的历史行不再可见）
  - 分页、总数与稳定排序的收敛
  - 越权对象与不存在对象的可区分性收敛为不可区分

禁止（任何一项被触碰即为越界，立即停止）
  - 改变 Wave 10 信用检查与审批的决策语义
  - 改变 Credit Exposure Algorithm（computeCreditExposure 的任何派生逻辑）
  - 改变 Credit Check Historical Snapshots（credit_check_results 的写入、
    内容、指纹与不可变性）
  - 改变 Special Approval State Machine（申请 / 决策 / 权限上限 / 失效期 /
    幂等 / 审计）
  - 改变正常授权主体（ADMIN / CROSS_GROUP / AGGREGATE_ONLY 以及当前有效的
    AGGREGATE_PLUS_SELF 主体）的既有业务合同与可见范围
  - 任何表结构 / Migration / 新 API / 新 UI / 新权限码

兼容性判定的关键约定
  **一次"原本越权的读取被拒绝"不构成 Wave 10 不兼容失败。**
  这正是本整改的目的：把已被明确判定为越权的读取行为收紧到授权合同之内。
  Wave 10 的不兼容判据是"正常授权主体的既有业务合同被改变"，
  而不是"越权读取不再被允许"。
  由此，CORRECTION-1 引入的自额度资格收紧（历史成员关系不得恢复权限）
  属于**预期内的收紧**，不是回归。
```

**W11-SEC-01 证据状态规则（CORRECTION-5 明确）**

```text
- 本次仅授权 Design Correction，**不执行任何 MySQL 验收**。
- W11-SEC 的 **SQLite 测试 PASS 不代表 MySQL Acceptance PASS**。
  SQLite 行为证据（E2）与真实 MySQL 证据（E3）是两个独立等级（§37.54.14.6）。
- 真实 MySQL 测试需要**独立授权**；在取得该授权并实际执行之前，
  W11-SEC 的 MySQL 证据状态必须记为 **NOT_RUN**，
  不得以 SQLite 结果、静态合同或既有 Wave 10 证据代替。
- 相应地，W11-SEC 的 Acceptance 标识 `W11_SEC_01_ACCEPTANCE_PASS`
  只能在 SQLite 与 MySQL 两级证据均实际取得后方可签发；
  仅 SQLite PASS 时只能签发 `W11_SEC_01_SQLITE_PASS_MYSQL_NOT_RUN`。
```

#### 37.54.15.3 W11-A — Credit Query / Exception History

| 项 | 内容 |
|---|---|
| 功能范围 | `GET /api/credit/exposure`、`GET /api/credit/exceptions`、`GET /api/credit/exceptions/:id`；`credit-query.js`；`credit-query.jsx` 界面 |
| 文件影响 | `server/modules/credit-query.js`（新）、`server/modules/credit-check.js`（**仅追加**两个既有符号的命名导出 `buildScopeHashes` / `CREDIT_CHECK_RESULT_SCOPE`，见 §37.54.5.2 与 §37.54.15.9.2；**不**新增 `factDigest` —— 该字段属 W11-D）、`server/modules/credit-policy.js`（拆分纯指纹函数 `computePolicySnapshotFingerprint`，内联算法不变）、`server/app.js`（登记 3 个 GET）、`src/pages/credit-query.jsx`（新）、`src/navigation/applicationRegistry.js`（contextual 路由）、新增测试与 acceptance 脚本。**`server/modules/credit-scope.js` 零改动**（§37.54.15.9.5） |
| 复用点 | `computeCreditExposure`、`resolveEffectiveCreditProfile`、`buildScopeHashes`、`computePolicySnapshotFingerprint`、`resolveCreditReadMode` / `creditScopePredicate`、`CREDIT_CHECK_RESULT_SCOPE` —— 全部按 §37.54.5.2 从**既有模块直接导入**；不得在新模块复制算法或 Scope SQL |
| 新增表 / API / UI | **无表**；3 个 GET 端点；1 个 contextual 路由 |
| 事务 / RBAC | 零事务、零写入；`CREDIT_VIEW` + 五级 Scope |
| 测试范围 | UAT-S-35-A1..A7；零副作用；分页；权限负向；SQLite + MySQL 等价 |
| MySQL Gate | Fresh / Upgrade / Replay / 两引擎 id 序列等价 / 零副作用摘要比对 |
| 停止条件 | 查询路径出现任何写入；或出现第二套敞口算法；或出现第二套 Credit Read Mode Resolver；或为取得复用点而在新模块复制既有算法 / Scope SQL；或改动 `credit-scope.js` |
| 冻结载荷治理 | W11-A U1 / U2 对 W11-SEC-01 冻结载荷（14 项）的增量变更，按 §37.54.15.9.4 的**有界例外治理**执行；原 14 项冻结指纹**永久保留**，不得被重算或覆盖 |
| Acceptance 标识 | `W11_A_ACCEPTANCE_PASS` |
| 依赖 | **W11-SEC 必须先通过** |
| 后续授权边界 | 完成后方可授权 W11-D |

#### 37.54.15.4 W11-B — Credit Evaluation Foundation

| 项 | 内容 |
|---|---|
| 功能范围 | indicator / scheme / model / scoring sheet 的定义、版本、生命周期、评分、finalize 的**基础部分**（结果与 apply 属 W11-C） |
| 文件影响 | `server/modules/credit-evaluation.js`（新）、`server/migrations/sales-customer-wave11-credit-evaluation.js`（新）、`server/migrations/sales-customer-domain.js`（registry 增 1 条）、`server/database/mysql-schema.js`（类型映射）、`server/app.js`（路由）、`src/pages/credit-evaluation.jsx`（新）、`src/navigation/applicationRegistry.js`（路由）、新增测试 |
| 复用点 | `credit-scope.js` 的授权助手、`financial-controls.js` 的幂等助手、`audit`、`normalizeBusinessDate` / `assertDateRange`、`translateConstraintError` |
| 新增表 / API / UI | 4 张表；7 个端点（3 GET + 3 POST 配置 + sheet 创建/评分/finalize 属本包）；1 个 contextual 路由 |
| 事务 / RBAC | 配置写 = `CREDIT_MANAGE` + scope；评分写 = `CREDIT_EVALUATE`；全部单事务 + audit + 幂等 |
| 测试范围 | UAT-S-36-A1..A4；权重 / 区间 / 缺失 / 重复 / 越界输入负向；状态机；幂等；迁移与重放 |
| MySQL Gate | Fresh / Upgrade / Replay / 形状对等 / FK 存在性 / 数据级 RI |
| 停止条件 | 评分出现浮点运算；或缺失指标被按 0 分计入；或配置行可被就地改写 |
| Acceptance 标识 | `W11_B_ACCEPTANCE_PASS` |
| 依赖 | 无（可与 W11-A 并行） |
| 后续授权边界 | 完成后方可授权 W11-C |

#### 37.54.15.5 W11-C — Multi-Scorer / Rating Application

| 项 | 内容 |
|---|---|
| 功能范围 | 多评人评分聚合（SC106）；`credit_evaluation_result`；评级应用到 profile version（SC107）；deferred FK 启用；`applyCreditRating` 单一写者 |
| 文件影响 | `server/modules/credit-evaluation.js`（扩展）、`server/modules/credit-profile.js`（**行为保持重构**：改用 `applyCreditRating`）、`server/migrations/sales-customer-wave11-credit-evaluation-result.js`（新，含 deferred FK）、`server/migrations/sales-customer-domain.js`（registry 增 1 条）、`server/database/mysql-schema.js`（类型映射）、`server/app.js`（路由）、`src/pages/credit-evaluation.jsx`（扩展）、新增测试与 MySQL 并发 fixture |
| 复用点 | W11-B 的对象与身份；`credit-profile.js` 的版本解析；`credit-scope.js` 的授权助手；`financial-controls.js` 的幂等助手 |
| 新增表 / API / UI | 1 张表 + 1 条 deferred FK；2 个端点（`GET results/:id`、`POST results/:id/apply`）；`credit-evaluation` 路由扩展 |
| 事务 / RBAC | apply = write-class `CREDIT_MANAGE` + 既有后端管理 scope；锁序 §37.54.13.2；单事务 + audit + 三重幂等 |
| 测试范围 | UAT-S-36-A5..A9；W11-R1 / W11-R2 独立会话并发；Wave 9 评级回归原样通过；唯一写者静态断言 |
| MySQL Gate | Fresh / Upgrade / Replay / FK 存在性 / 数据级 RI / **W11-R1 / W11-R2 真实并发** |
| 停止条件 | `credit_profile` 出现第二个写者；或 Wave 9 既有评级测试需要被修改才能通过 |
| Acceptance 标识 | `W11_C_ACCEPTANCE_PASS` |
| 依赖 | **W11-B 必须先通过** |
| 后续授权边界 | 完成后方可授权 W11-D（若 W11-D 复用其构造器） |

#### 37.54.15.6 W11-D — Reconciliation & Recalculation

| 项 | 内容 |
|---|---|
| 功能范围 | SC99 CHECK-only reconciliation；SC100 deterministic recalculation；`credit_recalculation_history` |
| 文件影响 | `server/modules/credit-reconciliation.js`（新）、`server/migrations/sales-customer-wave11-credit-reconciliation.js`（新）、`server/migrations/sales-customer-domain.js`（registry 增 1 条）、`server/modules/credit-check.js`（`computeCreditExposure` 返回值追加 `factDigest` —— 纯附加）、`server/modules/credit-policy.js`（纯指纹函数）、`server/app.js`（路由）、新增测试 |
| 复用点 | `computeCreditExposure`、`resolveEffectiveCreditProfile`、`buildScopeHashes`、`computePolicySnapshotFingerprint` |
| 新增表 / API / UI | 1 张表（**无金额列**）；2 个 POST 端点；无新 UI（结果可在 `credit-query` 面呈现） |
| 事务 / RBAC | `CREDIT_EVALUATE`；单事务写 1 行历史 + 1 行 audit；计算只读；幂等只存执行身份 |
| 测试范围 | UAT-S-34-A1..A8；W11-R3 / W11-R4；零副作用；确定性复算；fail-closed |
| MySQL Gate | Fresh / Upgrade / Replay / 形状对等 / **W11-R3 真实并发** / 无金额列断言 |
| 停止条件 | 历史表出现任何金额列；或出现第二套敞口算法；或 R-SAL-23 的结构性断言被弱化 |
| Acceptance 标识 | `W11_D_ACCEPTANCE_PASS` |
| 依赖 | **W11-SEC 必须先通过**（唯一硬依赖）。**不依赖 W11-A** —— 若 W11-A 已落地可**可选复用**其读取构造器，但未落地不构成阻塞（CORRECTION-5） |
| 后续授权边界 | 完成后进入 Wave 11 整体验收评估 |

#### 37.54.15.7 禁止事项

- **不得**把 `W11-SEC` 的跨冻结 Implementation 静默并入 `W11-A`。
- **不得**将 A / B / C / D 合成一个大型、不可分验收的提交。
- 每个包**独立**取得 Implementation 授权、独立取证、独立 Acceptance 标识。
- 不要求一次性实施全部五包。

#### 37.54.15.8 W11-SEC-01 Freeze Status（2026-10-28）

用户在 2026-10-28 批准 **W11-SEC-01 Technical Acceptance PASS** 并授权 **W11-SEC-01 Capability Freeze**。本节签发该状态，**不重定义** §37.54.15.2 已由 CORRECTION-5 固定的 Freeze Boundary。

```text
Acceptance 标识      W11_SEC_01_ACCEPTANCE_PASS
Freeze 状态          W11_SEC_01_ACCEPTANCE_PASS — FROZEN — GIT_CLOSURE_PENDING
证据前置条件        §37.54.15.2 的证据状态规则已满足 —— SQLite 与真实 MySQL 两级证据均已实际取得
冻结范围            仅 Credit Read Scope 只读权限整改（W11-SEC-01），及其 SQLite/MySQL
                    验收证据、统一 MySQL Gate 运行配置、对应测试与文档
不冻结              其它任何业务域；Wave 11 整体；Wave 10 的 Release Block
依赖状态            §37.54.15.3 的「W11-SEC 必须先通过」前置条件就此满足，
                    但 W11-A / W11-B / W11-C / W11-D 的 Implementation 均未启动、仍需各自授权
保留                WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED；W10_INV_RISK_01_BLOCKS_RELEASE_ONLY；
                    LEGACY_DATA_EVIDENCE_PENDING；CREDENTIAL_EXPOSURE_OPEN（USER_ACCEPTED / DEFERRED）
本轮未发生          任何 Git 写操作；版本号变更；Release Tag 变更；Release；Deploy；
                    任何大型测试或 MySQL Gate 重跑；任何数据库 / 口令 / Grants / GLOBAL 变量变更；
                    身份基线重建
```

Requirement 侧记录：`document.md` → `## W11-SEC-01 — Credit Read Scope Final Acceptance and Capability Freeze Record (2026-10-28)`；当日 append-only 记录：`log/2026-10-28.md`。

#### 37.54.15.9 W11-A Bounded Design Correction（2026-10-28）

授权：`W11_A_BOUNDED_DESIGN_CORRECTION_ONLY`（AGENTS.md §4.3 DESIGN）。本轮**仅** Design Correction：**未**进入 Implementation，**未**修改任何代码、测试、Gate、Schema、Migration 或 API，**未**执行 FAST / FULL / Build / MySQL Gate，**未**连接任何数据库，**未**执行任何 Git 写操作。

本节**就地修正** W11-A 的包合同（§37.54.15.3）与共享基础（§37.54.5.1 / §37.54.5.2），并新增 W11-SEC-01 冻结载荷的**有界例外治理**。本节**不重定义** §37.54.15.2 已固定的 W11-SEC-01 Freeze Boundary，也**不追溯覆盖** W11-SEC-01 已冻结的任何基线、指纹或 Git 证据。

##### 37.54.15.9.1 修正一 —— `factDigest` 归属

| 项 | 修正前（§37.54.15.3） | 修正后 |
|---|---|---|
| 归属 | W11-A 文件影响含「`credit-check.js`（导出 `computeCreditExposure` 的 `factDigest`）」 | **`factDigest` 属 W11-D**（R100-2 属 SC100；§37.54.11.2 与 §37.54.15.6 已如此归属） |
| W11-A 职责 | —— | **只复用**既有 `computeCreditExposure()` 返回的敞口组件与金额口径，**不**新增该字段 |
| 后果 | W11-A 会对已冻结的 `credit-check.js` 产生一次无业务必要的改动 | W11-A 对 `credit-check.js` 的唯一改动收敛为**两个既有符号的命名导出**（见 §37.54.15.9.2） |

**不得**因此提前改变任何 Wave 10 敞口算法、结果格式或决策语义。

##### 37.54.15.9.2 修正二 —— 三个复用点的唯一获取方案（Q1 = 方案 A）

**裁决**：**方案 A** —— 在 `credit-check.js` 中**追加**命名导出；**禁止**在新模块复制既有算法或 Scope SQL。

| 复用点 | 现状 | 唯一获取方案 | 禁止 |
|---|---|---|---|
| `buildScopeHashes` | `credit-check.js:540` 模块私有纯函数（只读参数 / 规则 / 档案状态并做 SHA-256） | 在 `credit-check.js` **保留现有实现**，追加 `export { buildScopeHashes, CREDIT_CHECK_RESULT_SCOPE };` | 不得改函数体、不得改 SQL、不得改字段、不得改哈希顺序、不得改序列化、不得改返回结构、不得改任何既有调用位置、不得新增第二套 hash builder |
| `CREDIT_CHECK_RESULT_SCOPE` | `credit-check.js:1048` 模块私有冻结常量 | 同上，随同一次追加导出 | **禁止**在 `credit-query.js` 中复制其 `aggregateExpr` / `selfExpr` SQL 字符串 |
| `computePolicySnapshotFingerprint` | **尚不存在**；指纹逻辑内联于 `ensureCreditPolicySnapshot`（`credit-policy.js:192-196`） | 按 §37.54.5.2 从 `credit-policy.js` 提取**纯函数**，并让 `ensureCreditPolicySnapshot` 委托调用 | 不得改变三个 Hash 的输入次序、Hash 校验规则、长度前缀 canonical 编码、SHA-256 生成方式、`CSP1:` 前缀、Snapshot 持久化行为、唯一性、幂等与历史记录 |

新模块必须继续调用 `resolveCreditReadMode` / `requireCreditReadScope` / `creditScopePredicate`，**禁止创建第二套 Credit Read Mode Resolver**。新增查询的业务过滤必须与 Scope Predicate 组合在**同一条 SQL 的 WHERE** 中，确保分页、总数与排序均在授权范围内执行。

##### 37.54.15.9.3 指纹函数提取的等价性合同

`computePolicySnapshotFingerprint` 的提取必须**逐字节等价**。测试矩阵（有效 / 无效 / 边界）：

| # | 输入类别 | 断言 |
|---|---|---|
| 1 | 有效：三 Hash 均为 64 位小写十六进制 | 输出等于**提取前** `ensureCreditPolicySnapshot` 内联算法对同一输入的输出，逐字节相同 |
| 2 | 无效：任一 Hash 非 64 位小写十六进制 | 与提取前**同样**抛 400（`HASH` 规则不变），错误类型与消息不变 |
| 3 | 边界：含前导零 / 全零 / 空字符串 / 非 ASCII | 与提取前逐字节相同（长度前缀编码对长度敏感） |
| 4 | 次序敏感：交换三个 Hash 的位置 | 输出**不同**，证明输入次序被保留 |
| 5 | 持久化不变：以同一输入调用 `ensureCreditPolicySnapshot` | 写入行、唯一性、幂等与历史记录与提取前完全一致 |

该函数**不得**执行任何数据库写入（纯函数，无 `db` 参数）。

##### 37.54.15.9.4 W11-SEC-01 冻结载荷的有界例外治理

W11-SEC-01 已于 2026-10-28 正式冻结，其 14 项冻结载荷指纹与 Git 归档证据**永久保留、不得重新定义**。本节**不是**对 W11-SEC-01 冻结基线的追溯覆盖，而是**面向未来的、版本化的、有界**的变更授权记录。

```text
例外身份            W11_A_FROZEN_PAYLOAD_BOUNDED_AMENDMENT（新增，仅 W11-A 适用）
适用范围            W11-A U1（仅限下列两项）与 W11-A U2（仅限下列两项）
不适用              W11-SEC-01 既有证据本身；任何其它包；任何 Wave 9 / Wave 10 冻结文件

U1 允许（仅限 credit-check.js）
  - 追加 `export { buildScopeHashes, CREDIT_CHECK_RESULT_SCOPE };`
  - 不允许修改原函数体、常量内容、既有导出、既有调用位置、业务 SQL 或权限判断
  - 不允许改变任何 Wave 10 / W11-SEC 的业务行为
  - 不允许修改 credit-scope.js

U2 允许（仅限两个冻结载荷文件，且仅为**追加登记**）
  - package.json：追加一条 W11-A Gate 脚本（沿用既有 test:mysql:wave11-sec / test:mysql:local 形态）
  - scripts/testing/test-suites.js：追加登记 W11-A 的 SQLite 套件
  - 不允许修改 package.json 的 version；不允许登记任何 MySQL 集成文件；不允许改动既有登记

必须记录
  - credit-check.js 修改前 / 修改后的 SHA-256
  - 两者差异**仅为**上述约定的追加导出（逐行可核对）
  - package.json / test-suites.js 修改前 / 修改后的 SHA-256 与增量说明
  - 原 W11-SEC-01 的 14 项冻结 SHA-256 **原样保留**，不得被新值覆盖或替换

禁止
  - 以任何形式重算、覆盖、替换或作废 W11-SEC-01 已冻结的 14 项指纹
  - 以「基线已漂移」为由重新建立 W11-SEC-01 的身份基线
  - 将本例外扩大为对冻结文件的任意修改授权
  - 未经独立授权即实施 U1 / U2
```

**语义定位**：这是**版本化有界变更记录**（versioned bounded change record），**不是**追溯覆盖 W11-SEC-01 的原有冻结基线。W11-SEC-01 的冻结基线在其签发时点的事实与指纹**永久有效**；本例外只声明**其后**允许发生、且仅允许发生的那几处追加变更。

##### 37.54.15.9.5 W11-A 的 `credit-scope.js` 不修改结论

§37.54.15.3 原「文件影响」列有 `server/modules/credit-scope.js`（谓词投影）。经核验，W11-SEC-01 已交付**通用**谓词投影 `creditScopePredicate(mode, { aggregateExpr, selfExpr, selfValue })`（`credit-scope.js:108`，纯投影、不判定模式），已满足 §37.54.5.3「授权决策只有一个来源，SQL 形状按表投影」的要求。故 **W11-A 不需要修改 `credit-scope.js`**；该文件属 W11-SEC-01 冻结载荷，**保持零改动**。

##### 37.54.15.9.6 本节未发生事项

```text
未修改任何业务代码、测试、Gate、Migration、Schema 或 API
未运行 FAST / FULL / Build / MySQL Gate
未访问或修改任何数据库、账号、口令、DPAPI 凭据、Grants 或 GLOBAL 参数
未修改 W11-SEC-01 既有冻结证据、指纹或 Git 归档
未修改 package.json version，未创建 / 移动 / 删除任何 Release Tag
未执行任何 Git 写操作（add / commit / push / merge / rebase / reset / restore / stash / clean）
未启动 U1 / U2 / U3 Implementation；未启动 W11-B / W11-C / W11-D
未新增任何业务决策、Schema、跨域写入、权限码或角色
```

##### 37.54.15.9.7 U1 实施记录（2026-10-28）

本节记录 W11-A U1（Read Primitives）的实际实施结果。U1 属于已批准的 `W11_A_FROZEN_PAYLOAD_BOUNDED_AMENDMENT`（§37.54.15.9.4）；本节**不重定义** W11-SEC-01 的冻结基线，**未**追溯覆盖其任何指纹或 Git 证据。

```text
实施范围（与 §37.54.15.9.2 完全一致，无扩张）
  server/modules/credit-check.js    追加 export { buildScopeHashes, CREDIT_CHECK_RESULT_SCOPE };
                                    +13 / -0（纯附加）。函数体、常量内容、既有导出、
                                    既有调用位置、业务 SQL 与权限判断均未改动
  server/modules/credit-policy.js   提取 computePolicySnapshotFingerprint 纯函数，
                                    ensureCreditPolicySnapshot 委托调用；+19 / -2
                                    （被替换的两行即原内联指纹赋值与被改写的函数首行）
                                    credit-policy.js 不在 W11-SEC-01 的 14 项冻结载荷内

未改动  credit-scope.js（零改动）；任何 Schema / Migration / API / 权限码 / 角色；
        package.json；scripts/testing/test-suites.js；任何既有测试文件
```

**冻结载荷增量变更证据**（§37.54.15.9.4 要求的记录）：

| 文件 | 修改前 | 修改后 |
|---|---|---|
| `server/modules/credit-check.js` | `3bf4eb5190f3c8f59c0d7446fe07cd0264992126cffaa8616c1ccbecd7e272f0`（W11-SEC-01 冻结指纹） | `eceb2f775476caa008769c9040077aaea87a3191e3eb886175cddef67f9e8384`（U1） |
| `server/modules/credit-policy.js` | `94f2df0a267722ba4d343315668dd82c2c3e5e723dde2363c785a5ecff6aa98b` | `9088a222e58d85e24539500a65a9e2b97a347fb89b0e20544e0c4fc34924fea8`（非冻结载荷） |
| `scripts/testing/test-suites.js` | 未改动 | 未改动 |
| `package.json` | 未改动 | 未改动 |

**差异证明**：把 `credit-check.js` 中追加的 `export` 块移除后重新计算 SHA-256，结果**逐字节等于**修改前的冻结指纹 `3bf4eb51…72f0`。该性质由 `scripts/sales-customer-wave11-a-primitives.test.js` 的 T5 断言**永久固化**为可机器复验的合同。W11-SEC-01 原 14 项冻结指纹**原样保留**，未重算、未覆盖、未作废。

**等价性证据**：Golden Vectors 于 U1-B 修改**之前**从**原实现**采集（驱动 `ensureCreditPolicySnapshot` 于一次性 SQLite fixture），含 7 个有效向量与 10 个无效向量，golden 文件 SHA-256 `5f5212c4aa31e40d50e983c9f4655d14cb1e0025b567f0d839bd133b0e778c18`。修改后以同一脚本重新采集，结果与 golden **逐字节相同**，唯一差异是快照行 id（`randomUUID()`，本就非确定）；7 个指纹、10 组错误语义、行数与幂等指纹全部一致。

**测试证据** —— `scripts/sales-customer-wave11-a-primitives.test.js`（5 / 5 PASS）：

| 用例 | 内容 |
|---|---|
| T1 | 提取后的纯函数逐字节复现**原实现采集**的 golden vectors（不与自身包装函数比较） |
| T2 | 无效输入的错误类别 / 状态码 / 消息 / 业务码不回归 |
| T3 | 边界、Hash 次序敏感、重复调用确定性、长度前缀 canonical 编码、`CSP1:` 前缀 |
| T4 | 快照持久化行为不变：首次创建、幂等、唯一性、历史不改写、非法输入零写入 |
| T5 | 追加导出无感：移除追加块复现冻结指纹、Scope 常量内容不变、hash builder 合同不变、仓库内仅一个 resolver / predicate / hash builder / 指纹算法 |

**分类债务（本轮有意未登记）**：`scripts/sales-customer-wave11-a-primitives.test.js` 位于 `scripts/`，**不在** `scripts/testing/test-suites.js` 的任何 suite 中 —— 登记它必须修改该清单，而 U1 授权明确禁止该修改。治理不变式「`server/` 与 `src/lib/` 下的每个 `*.test.js` 必须被分类」因此**字面成立**，治理自检继续通过。该文件**必须**在下一个获授权轮次登记进 FULL；在此之前它被显式执行，结果记入当日日志。

##### 37.54.15.9.8 U1 测试登记完成与测试治理收口（2026-10-28）

本节记录 W11-A U1 等价性测试被正式纳入 **FULL** 的治理收口。它关闭 §37.54.15.9.7 末段声明的**分类债务**。本节**不重定义** W11-SEC-01 的冻结基线。

**登记变更（唯一允许的测试配置变更）**

```text
文件        scripts/testing/test-suites.js
性质        仅追加 —— 一条 FULL 登记路径 + 其必要说明注释；+11 / -0，0 删除
登记内容    'scripts/sales-customer-wave11-a-primitives.test.js'
未改动      FAST 清单；HEAVY 清单；既有 FULL 条目；validate()；Runner；package.json；
            任何真实 MySQL 集成测试；未移动任何测试文件
选择 FULL   U1 测试含隔离 SQLite Fixture 与快照持久化验证，不符合纯数据库无关的
            FAST 分类准则，故按 §37.54.15.9.7 的登记纪律归入 FULL
```

**冻结载荷增量变更（同一有界例外治理）**

| 文件 | 修改前 | 修改后 |
|---|---|---|
| `scripts/testing/test-suites.js` | `6e75875ac6a4fd697221fa1523f8c25a513b27ced3efc7e88ea78ecfc42cca88`（W11-SEC-01 冻结指纹） | `b982808f0d74b5d0b3b2207f343c50e4c4a30bb10f005f9e599b2e4a4ce9e01d` |
| `server/modules/credit-check.js` | `3bf4eb5190f3c8f59c0d7446fe07cd0264992126cffaa8616c1ccbecd7e272f0`（W11-SEC-01 冻结指纹） | `eceb2f775476caa008769c9040077aaea87a3191e3eb886175cddef67f9e8384`（U1 追加导出，自 U1 实施后未再变动） |

其余 **12 项** W11-SEC-01 冻结载荷逐项复算**未变**。W11-SEC-01 原 14 项冻结指纹**永久保留**，未重算、未覆盖、未作废；本轮**未**执行任何 W11-SEC Re-Freeze。

**测试治理合同验证**

| 合同 | 结果 |
|---|---|
| 治理自检 `server/test-suite-governance.test.js` | **20 / 20 PASS** |
| 清单校验 `suite manifest passes validation` | PASS |
| `FAST ⊆ FULL` | PASS |
| `FULL ∩ HEAVY = ∅` | PASS |
| 无重复登记 | PASS |
| 登记文件均存在于磁盘 | PASS |
| 每个磁盘上的 `*.test.js` 已被分类 | PASS |
| `ALL = FULL ∪ HEAVY` | PASS |
| HEAVY 理由记录齐备 | PASS |
| 计数 | `FAST=23 FULL=195 HEAVY=7 ALL=202 onDisk=198`（U1 文件仅出现在 FULL） |

**FULL 回归**：**2954 / 2954 PASS**，359 suites，0 fail，254 s。原始证据不止于总计数增加 —— 仓库自有的 `run-tests.js full --list` 清单输出中，`scripts/sales-customer-wave11-a-primitives.test.js` 明确出现在 FULL 清单第 27 行（紧接 W11-SEC 条目），且该次 FULL 的 TAP transcript 内含该文件的 T1..T5 五个用例（`ok 55` … `ok 59`）。

**U1 测试的未来兼容性（只读结论，T5 断言未修改、未削弱）**

T5 的冻结指纹断言把 `credit-check.js` 的 `[0, U1 导出标记)` 前缀重算为 SHA-256，并要求其等于 W11-SEC-01 冻结指纹 `3bf4eb51…72f0`。实测：`computeCreditExposure` 的返回块位于 **byte 22943**，U1 导出标记位于 **byte 52594**，即 W11-D 计划的 `factDigest` 追加（§37.54.11.2、§37.54.15.6）落在该前缀**之内**。

结论：**一旦 W11-D 合法落地其有界追加，T5 的指纹断言将失败** —— 失败原因是基线推进，不是缺陷。其余 T5 断言不受影响：W11-D 的 `factDigest` 复用既有 `sha256` / `canonicalJson`（§37.54.11.2），故「唯一 resolver / 唯一 predicate / 唯一 hash builder / 唯一 canonicalJson / 唯一指纹算法」五项计数仍为 1；`CREDIT_CHECK_RESULT_SCOPE` 内容与 `buildScopeHashes` 合同亦不受影响。

未来维护要求：W11-D 必须以**自身的版本化有界例外**取得授权，并**单独记录**其对 `credit-check.js` 的修改前 / 修改后指纹；届时 T5 的指纹基线必须**重指向**该新授权基线（可泛化为一条已记录的指纹链），而 W11-SEC-01 的原指纹 `3bf4eb51…72f0` **必须永久保留**于日志与测试常量史中。**不得**以放宽比较、删除断言或跳过用例的方式消除该失败。

##### 37.54.15.9.9 U1 正式 Acceptance 与限定范围 Capability Freeze（2026-10-28）

授权：用户 2026-10-28 指令 —— 批准 **W11-A U1 Technical Acceptance PASS** 并授权完成 U1 的限定范围 Capability Freeze 与正式验收记录（AGENTS.md §4.5）。本轮**仅**文档与状态记录：未修改任何业务代码、测试断言、测试清单、`package.json`、API / 路由 / UI、Migration 或 Schema；未连接或修改真实 MySQL；未修改账号 / 口令 / DPAPI / Grants / GLOBAL 参数；未重跑 FAST / FULL / Build / HEAVY / MySQL Gate；未启动 U2 / U3；未执行任何 Git 写操作；未 Release / Deploy / Version Bump。

**签发的状态标识**

```text
Acceptance 标识   W11_A_U1_ACCEPTANCE_PASS
Freeze 状态       W11_A_U1_ACCEPTANCE_PASS — FROZEN — GIT_CLOSURE_PENDING
```

**为何是子单元标识**：§37.54.15.3 的 `W11_A_ACCEPTANCE_PASS` 保留给**完整的 W11-A 包**（3 个 GET 端点 + `credit-query.js` + `credit-query.jsx` + FULL 覆盖 = U1 + U2 + U3）。U2 / U3 **未启动**，因此现在签发该标识会**过度声称**包级完成。U1 采用与 Wave 11 安全包同构的子单元命名（`W11_SEC_01_ACCEPTANCE_PASS` 的形态），签发 `W11_A_U1_ACCEPTANCE_PASS`。`— FROZEN — GIT_CLOSURE_PENDING` 后缀与 W11-SEC-01 冻结在其 Git Journal 收尾之前所用状态完全一致。

**U1 冻结的五项内容**（与 `document.md` → `## W11-A U1 — Read Primitives Final Acceptance and Bounded Freeze Record (2026-10-28)` §3 逐项对应）：

```text
F1  credit-check.js 中 buildScopeHashes / CREDIT_CHECK_RESULT_SCOPE 两个既有符号的追加导出
F2  credit-policy.js 中唯一的纯函数 computePolicySnapshotFingerprint 及其委托
F3  Snapshot Writer 持久化行为（首次创建 / 幂等 / 唯一性 / 历史不改写 / 非法输入零写入）
F4  U1 专项测试套件及其 FULL 登记
F5  增量冻结指纹、技术说明与验收证据
```

**增量冻结载荷清单**（原指纹永久保留，未重算、未覆盖、未作废；**未**执行 W11-SEC Re-Freeze）：

| 文件 | 原指纹 | U1 后指纹 | 差异性质 |
|---|---|---|---|
| `server/modules/credit-check.js` | `3bf4eb5190f3c8f59c0d7446fe07cd0264992126cffaa8616c1ccbecd7e272f0`（W11-SEC-01 冻结） | `eceb2f775476caa008769c9040077aaea87a3191e3eb886175cddef67f9e8384` | **仅授权的追加导出及说明注释** |
| `scripts/testing/test-suites.js` | `6e75875ac6a4fd697221fa1523f8c25a513b27ced3efc7e88ea78ecfc42cca88`（W11-SEC-01 冻结） | `b982808f0d74b5d0b3b2207f343c50e4c4a30bb10f005f9e599b2e4a4ce9e01d` | **仅一项 FULL 登记及说明注释** |
| `server/modules/credit-policy.js` | 非 W11-SEC-01 冻结载荷 | `94f2df0a…98b` → `9088a222…fea8` | 纯指纹提取 |
| `scripts/sales-customer-wave11-a-primitives.test.js` | — | `37074ad129ca89cdb34e3ac40a95eb03073c2f6912ec65fee0043f269b5f8767` | U1 专项套件 |

其余 **12 项** W11-SEC-01 冻结载荷逐项未变。

**T5 前向维护义务**：T5 的冻结指纹断言**当前有效**并随 F1 一并冻结。W11-D 计划的 `factDigest` 追加落在 T5 重算前缀之内（`computeCreditExposure` 返回块 byte 22943，U1 导出标记 byte 52594），故合法的 W11-D 有界变更将使该比较失败 —— 那是**基线推进，不是缺陷**。W11-D 必须以**自身的**版本化有界例外取得授权并**单独记录**其修改前 / 修改后指纹；届时 T5 的基线必须**重指向**该新授权基线（可泛化为已记录的指纹链），而 W11-SEC-01 原指纹 `3bf4eb51…72f0` **必须永久保留**。**不得**以删除、跳过或放宽断言的方式提前规避。本轮**未修改 T5**。

**本节不改变的边界**：`W11_A_ACCEPTANCE_PASS` 仍保留给完整 W11-A 包；U2 / U3 未启动；W11-B / W11-C / W11-D 未启动；D-2..D-5 仍阻塞 W11-B / W11-C；`WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED`、`W10-INV-RISK_01`、`LEGACY_DATA_EVIDENCE_PENDING`、`CREDENTIAL_EXPOSURE_OPEN`（USER_ACCEPTED / DEFERRED）全部保留；生产发布仍未获授权。HEAVY、真实 MySQL Gate、Build、浏览器验收本轮**未运行**，一律 NOT_RUN，**不得**标记为 PASS。

**状态演进证据**：W11-SEC-01 的冻结记录仍显示其签发时的 `GIT_CLOSURE_PENDING`，**未被改写**；其后续 Git Journal 收尾记录在 `log/2026-10-28.md`。本节同样**不**通过改写旧记录来陈述状态演进。

##### 37.54.15.10 W11-A U2-1 实施记录（2026-10-28）

授权：用户 2026-10-28 指令 —— **W11-A U2-1 — SC101 Credit Query / SC102 Credit Exception History Backend Implementation**。本轮**仅**实施 U2-1：未实施 U3；未新增 Credit Query 之外的 API、权限码、业务表或 Migration；未执行真实 MySQL Gate；未签发 U2 Acceptance / Freeze；未执行任何 Git 写操作。

**实施范围**

| 文件 | 性质 | 说明 |
|---|---|---|
| `server/modules/credit-query.js` | **新建** | 三个 GET 处理函数；纯只读 |
| `server/app.js` | **修改（+5/-0）** | 一行 import + 三个 `ownedRouteTable.register`，owner 统一为 `server/modules/credit-query.js`；既有 Credit 路由**零改动** |
| `server/sales-customer-wave11-a-credit-query.test.js` | **新建** | U2-1 SQLite 验收套件，29 个用例 |
| `scripts/testing/test-suites.js` | **修改（+14/-0）** | FULL 追加登记 U2-1 套件；FAST / HEAVY / `validate()` / Runner **零改动** |

**canonical 复用证据**：模块只调用 `computeCreditExposure`、`resolveEffectiveCreditProfile` 的生效版本形态、`buildScopeHashes`、`computePolicySnapshotFingerprint`、`resolveCreditReadMode`、`requireCreditReadScope`、`creditScopePredicate`、`resolveCreditProfileReadScope`、`resolveCustomerCreditObject` 与**导入的** `CREDIT_CHECK_RESULT_SCOPE`。本模块**不含**任何自己的敞口算法、指纹算法或 Scope SQL；`creditScopePredicate` 的两段投影由既有常量提供，模块只提供 credit_profile 表的投影（取自 `resolveCreditProfileReadScope`，不另写 Scope SQL）。

**三处实施判读（对已批准设计的落地说明，不是 Requirement 变更）**

1. **"?salespersonId= absent → both scopes reported"**：查询报告**聚合档位**加上 canonical 谓词准入的**全部销售员子限额档位**；请求显式指定某个销售员时只报告该档位。准入判定完全来自 `resolveCreditProfileReadScope`，任何不被准入的档位**不出现**于响应（既不报空、也不报禁止）。
2. **规则集 stage**：canonical hash builder 从首个 scope 读取 `scopes[0].stage`，而查询 API 无 stage 参数。本实现从数据推导该 stage：优先取所报档位档案所绑定规则（`credit_profile.rule_id`）的 `business_stage`；否则取该业务日期上第一个存在生效规则的 stage；当客户**没有任何生效规则**时规则集为空，stage 不可能改变 hash，取 canonical stage 列表首项。该 stage 选择不影响已批准的任何语义。
3. **例外列表的授权行选取**：canonical Scope 谓词使用 `credit_check_results` 的**裸列名**。为避免与 `credit_special_approval` 的同名列产生歧义，授权行先在**仅含 credit_check_results 的派生表**中选出，展示用的 approval / 源单 JOIN 在其外层进行。JOIN 永远不会扩大授权集合。

**例外列表的筛选参数**严格取 §37.54.8.1 已批准的七个（`customerId`、`scopeType`、`decision`、`stage`、`hasApproval`、`businessDateFrom`、`businessDateTo`）加 `limit` / `offset`；**未**新增未批准的参数。Check Group 与来源单据的**越权构造**由「详情与列表共用同一 Scope 谓词」这一合同挡住，并由非枚举用例逐项证明。

**零副作用三层证明**

| 层 | 证据 |
|---|---|
| E1 静态 | `credit-query.js` 代码行中不存在 `INSERT / UPDATE / DELETE / CREATE / ALTER / DROP`、`transaction(`、`ensureCreditPolicySnapshot(`、`ensureCreditLockAnchor(`、`evaluateCredit(`、`saveIdempotency(`、`audit(`；5 条 `db.prepare` 全部为 SELECT |
| E2 运行时 | 被测请求前后**全库逐表行数与内容摘要**完全一致；`credit_check_results` / `credit_policy_snapshots` / `credit_profile` / `audit_logs` 行数不变；同请求两次调用返回完全相同的结果且库内容不变 |
| — 归因分离 | 测试 fixture 的初始化写入（含生产 writer 产生的 check result 与 approval）与被测 GET 的业务写入**分别记录**，不混为一谈 |

**验收结果**

```text
U2-1 专项测试            29 / 29 PASS
W11-SEC 原 14 项          14 / 14 PASS   （断言未改）
U1 原 5 项                 5 /  5 PASS
Wave 9 credit foundation  21 / 21 PASS
Wave 10 credit check      51 / 51 PASS
Wave 10 acceptance ctr.   11 / 11 PASS
测试治理自检               20 / 20 PASS
FAST                     500 / 500 PASS
FULL                    2983 / 2983 PASS（359 suites，0 fail）
Build                    PASS
真实 MySQL Gate            NOT_RUN（本轮不授权）
```

**冻结载荷增量**：`scripts/testing/test-suites.js` 由 `b982808f…e01d` 变为 `a86d25a2…2db`，差异**仅为**一项 FULL 登记及说明注释（+14/-0，0 删除）。`credit-check.js`、`credit-policy.js`、U1 套件与其余 12 项 W11-SEC 冻结载荷**逐项未变**；W11-SEC-01 原 14 项指纹原样保留，未重算、未覆盖、未作废，未执行任何 Re-Freeze。

**真实 MySQL E3 预备计划（下一轮独立授权后实施）**

```text
入口            新增 scripts/gates/mysql-sales-wave11-a-gate.mjs，复用既有
                scripts/gates/mysql-wave10-runner-support.mjs 的 runProtectedMySqlCampaign，
                **不新建第二套受保护 runner**；经统一 launcher
                scripts/gates/run-mysql-local-gate.ps1 运行，目标仍是
                modern_erp_domain_test / modern_erp_test
等价性          与 SQLite 使用**同一业务 fixture**（复用 U2-1 套件的 fixture 与生产 writer），
                比较两引擎的例外历史 id 序列、Scope 可见集合、聚合与子限额金额逐值相等
五级权限        在 MySQL 上复跑同一权限负向矩阵，比较两引擎的可见集合与 total
零写入          运行前后 information_schema 五类对象计数与逐表摘要比对，
                并由受保护 runner 的 final reset 与 launcher 的新会话复核双重确认归零
最小权限        复用仓库既有 assertExactLeastPrivilegeGrants 合同，不复制第二份权限清单
对象归零        运行前后 tables/views/triggers/routines/events 均为 0
Trigger 前置    MySQL80 重启后 log_bin_trust_function_creators 回到 0，
                最小权限账号无法 CREATE TRIGGER ⇒ E3 运行前必须先经**单独授权的**
                管理员操作恢复该运行时前置；本轮不连接 MySQL、不读取 DPAPI、不修改任何凭据
```

**状态**：`W11_A_U2_E2_IMPLEMENTED_READY_FOR_E3` —— SQLite E2 行为证据已取得，**不构成完整 U2 Acceptance PASS**。

### 37.54.16 Compatibility, forbidden changes and preserved contracts

**必须继承且不得破坏**：Wave 9 Credit Profile / Rule / Parameter；Wave 10 Credit Exposure / Check / Special Approval；Dual-Limit Control（§13 P1–P13）；PURE_DERIVED Exposure；S05 / S14 / S15 / S16 / S17 / S19；五个 Credit 业务身份；Finance canonical AR / Settlement；Credit Policy Snapshot 指纹；既有 39/39 Wave 10 MySQL 验收证据。

**禁止**：

```text
不得创建第二套 Credit Exposure Ledger 或持久化 mutable exposure cache
不得写 Finance / Inventory / Accounting 权威事实
不得改写历史 Check / Approval Snapshot
不得产生第二个 Credit Profile 评级写者
不得新增未经 Requirement 批准的权限码或角色
不得发明权限蕴含（permission registry 是扁平的）
不得放宽 CREDIT_VIEW，不得弱化已收紧的 Scope
不得就地改写已生效且被引用的 indicator / scheme / model
不得在评分中使用浮点
不得让缺失指标按 0 分计入
不得把 query 实现为 write
不得在查询路径调用 ensureCreditPolicySnapshot / ensureCreditLockAnchor / saveIdempotency
不得重跑或重开 Wave 10 验收
不得解除 W10-INV-RISK-01 / CREDENTIAL_EXPOSURE_OPEN / LEGACY_DATA_EVIDENCE_PENDING
```

**Wave 9 行为保持义务**：`credit-profile.js` 的 `applyCreditRating` 重构是**行为保持**的；`server/sales-customer-wave9-credit-foundation.test.js` 必须**原样通过**（不得修改该测试以适配重构）。若该测试需要修改才能通过，说明重构改变了行为 → 停止。

### 37.54.17 Open Design items and REQUIREMENT_REOPEN candidates

| ID | 事项 | 性质 | 是否阻塞 | 处置 |
|---|---|---|---|---|
| D-1 | ~~`result_summary_json` 不含任何金额~~ → **CORRECTION-2 已解决**：改为唯一的不可变执行期结果快照 `result_snapshot_json`（含执行期金额，带 `authoritative:false` 与 `contractVersion`），顶层**无**金额列，无任何 Credit writer 读取该表 | Design 决策（**已闭合**，不改 Requirement） | **不阻塞** | 无需用户裁决。R99-6 / R100-6 要求记录“结果摘要”，本设计据此保留可自证的结果快照，并撤销“digest 可恢复历史金额”的错误论断 |
| D-2 | 评分数值一律整数 milli-point、权重整数 milli-weight、**禁止插值与浮点** | Design 决策 | 阻塞 W11-B | 请用户确认 |
| D-3 | 模型 / 方案 / 指标**不设独立版本表**，采用生效日期版本化（沿用 Wave 9 形态） | Design 决策 | 阻塞 W11-B | 请用户确认 |
| D-4 | 评分表创建时**固定** profile 版本；apply 时版本变化则 fail closed 要求重新评分 | Design 决策 | 阻塞 W11-C | 请用户确认 |
| D-5 | `credit_evaluation_result` 对 sheet 唯一；重新评价必须新建评分表 | Design 决策 | 阻塞 W11-C | 请用户确认 |
| D-6 | W11-SEC-01 的跨冻结边界 Implementation 授权 | 授权事项（Stage B 已记录） | 阻塞 W11-SEC | 需用户另行批准 |
| D-7 | 评分人 ≠ 应用人的**人员级**分离 | **未决业务决策**（Stage B L-1） | **不阻塞** | 明确**不强制**；若未来需要，必须返回 Requirement 层重开 |

**无 REQUIREMENT_REOPEN 触发项。** D-1..D-5 均为 Requirement 允许范围内的 Design 决策，且**均不阻塞 W11-SEC** —— W11-SEC 不涉及任何新表、任何评分语义、任何金额口径。

### 37.54.18 Stage C boundary and status

**本节不启动任何 Implementation。** 未执行 Migration、未执行测试、未连接 MySQL、未执行 Git 写操作、未 release、未 deploy。

**未实施的后续阶段**：W11-SEC / W11-A / W11-B / W11-C / W11-D 的 Implementation，各自需要独立授权；W11-SEC 另需跨冻结边界的专门授权。

**Design status: `WAVE11_STAGE_C_DESIGN_READY`.**

- `DESIGN_ONLY_NO_IMPLEMENTATION_NO_MIGRATION_NO_MYSQL`;
- `REQUIREMENT_CONFORMANCE_R99_TO_R107_D1_D2_D3_MAPPED`;
- `C2_C3_CONFLICT_CLOSURE_MATRIX_COMPLETE_DETERMINISTIC_REBUILD_RETIRED_NOT_REDEFINED`;
- `NO_PHYSICAL_ARTIFACT_OF_DETERMINISTIC_REBUILD_EVER_EXISTED_ZERO_COMPATIBILITY_IMPACT`;
- `CREDIT_RECALCULATION_HISTORY_HAS_ZERO_MONETARY_COLUMNS`;
- `R_SAL_23_CONDITIONAL_PRESERVED_STRUCTURAL_AND_BEHAVIOURAL_PROOFS_SEPARATED`;
- `ONE_SCOPE_RESOLVER_CREDIT_SCOPE_JS_EXTENDED_NO_SECOND_RESOLVER`;
- `SINGLE_RATING_WRITER_APPLY_CREDIT_RATING`;
- `NO_NEW_PERMISSION_CODE_NO_NEW_ROLE`;
- `FIVE_INDEPENDENT_IMPLEMENTATION_PACKAGES_WITH_DEPENDENCY_DAG`;
- `NO_SOLUTION_MD_HISTORY_REWRITTEN_ONLY_BOUNDED_SUPERSESSION_DECLARED`;
- `NO_DOCUMENT_MD_MODIFIED`; `NO_README_MD_MODIFIED`; `NO_CODE_SCHEMA_MIGRATION_TEST_RUNNER_MODIFIED`;
- `NO_MYSQL_CONNECTED`; `NO_GIT_WRITE`; `NO_RELEASE`; `NO_DEPLOY`;
- `W10_INV_RISK_01_BLOCKS_RELEASE_ONLY_PRESERVED`;
- `CREDENTIAL_EXPOSURE_OPEN_REQUIRES_OWNER_DECISION_PRESERVED`;
- `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED_PRESERVED`;
- `HARD_STOP_AFTER_STAGE_C_DESIGN`.

### 37.54.19 Bounded Design Correction index（2026-10-27）

本节是**勘误索引**，不是第二套规范。每一项的对应正文**已就地修正**；本节只记录"改了什么、在哪里、依据是什么、是否触发 Requirement 重开"。若本节与正文表述不一致，**以就地修正后的正文为准**。

授权：`WAVE11_STAGE_C_BOUNDED_DESIGN_CORRECTION_ONLY`。本轮仅 Design Correction，未进入 Implementation，未执行 Migration / 测试 / MySQL，未执行任何 Git 写操作。

| Correction | 问题 | 就地修正位置 | 修正要点 | Requirement 影响 |
|---|---|---|---|---|
| **C1** | 自额度资格用**请求提供的历史 businessDate** 判定 → 已按日期退出的历史成员关系可重新获得 `AGGREGATE_PLUS_SELF` | §37.54.5.3、§37.54.5.3 设计要点 5、§37.54.7.3、§37.54.7.10（N-1..N-8）、§37.54.14.4 | 三类日期分离（server-controlled authorization date / user-requested historical business date / historical fact's original business date）；`resolveCreditReadMode(db, actor)` 不再接受 businessDate；`resolveSelfSalespersonId` 去除该参数；沿用仓库既有 UTC 日历日约定（`toISOString().slice(0,10)`，112 处一致）；`sales-scope.js` 的单据组范围**不改** | **无重开**。修正的是对 R-D2-1 的实现偏离，收紧至已批准的 Requirement 语义 |
| **C2** | "digest 可确定性恢复历史金额" —— 密码学摘要不可逆，该论断不成立 | §37.54.6.5（G-1..G-6 + CORRECTION-2）、§37.54.11.2、§37.54.11.3、§37.54.11.4、§37.54.11.5、§37.54.12.1、§37.54.12.3、§37.54.4 G-12、§37.54.17 D-1 | 撤销恢复论断；改为唯一不可变执行期结果快照 `result_snapshot_json`（含执行期金额，`authoritative:false` + `contractVersion`），顶层无金额列，无任何 Credit writer 读取；digest 规范化输入集合固定；`businessDate` + `contractVersion` + `factDigest` 三重绑定；replay 三态（EQUIVALENT / DRIFTED / NOT_COMPARABLE）；事实读取改用既有 `readTransaction`（`db.js:2169`）取得一致快照；失败零权威副作用 | **无重开**。R99-6 / R100-6 要求记录“结果摘要”，本设计据此选择可自证的快照形态 |
| **C3** | 仅以 `UNIQUE(code, effective_from)` 作为版本化依据，**未阻止生效区间重叠**，且缺并发锁身份与可追溯性保证 | §37.54.9.1（CORRECTION-3 (1)..(6)） | 补齐区间唯一性检测、共享锁身份（MySQL 既有确定性命名锁 + 受控释放合同 + SQLite 写事务串行化）、前驱终止与后继切换（沿用 `closePredecessorAndAssertNoOverlap` 语义）、被引用后不可变、模型以**指标行 id** 引用保证评分表可精确追溯、两引擎等价冲突检测与同一组错误码 | **无重开**。不新增版本表，不改已批准的定点整数评分设计 |
| **C4** | 唯一评级写者未区分 INITIAL 与 EVALUATION 两种业务来源；INITIAL 路径被隐含地绑定到评估对象；FK 变更的兼容性表述不准确 | §37.54.10.6（CORRECTION-4）、§37.54.12.7 | 双业务来源（`INITIAL_ASSIGNED` / `EVALUATION_APPLIED`，后者**显式映射**到冻结物理取值 `'EVALUATED'`，既有 CHECK 不改）；INITIAL 路径**不要求**评分表或 evaluation result；两来源的授权 / 幂等 / 审计身份分离；`createCreditProfile` 行为保持重构为调用同一 writer；`rating_*` 三列在源码合同中只出现于该 writer；既有评级历史不迁移 / 不伪造 / 不清空；FK 明确为**对既有冻结表的兼容性 Schema 扩展** | **无重开**。R107-4 与 §36.7.1 的唯一写者要求据此被可机器验证地落实 |
| **C5** | DAG 含未经 Requirement 依据的 `W11-A → W11-D` 硬依赖；W11-SEC 冻结边界与证据状态未明确 | §37.54.15.1（CORRECTION-5）、§37.54.15.2（Freeze Boundary + 证据状态规则）、§37.54.15.6、§37.54.14.6 | 撤销 `W11-A → W11-D` 硬边，改为可选复用；W11-SEC Freeze Boundary 明确“允许收紧已批准的越权读取行为”与五项禁止；明确“**一次原本越权的读取被拒绝不构成 Wave 10 不兼容失败**”；证据分级规则：SQLite PASS ≠ MySQL Acceptance PASS，未执行项一律 `NOT_RUN`，受限签发标识 | **无重开** |

| **C6** | W11-A 包合同把 `factDigest` 归给 W11-A；三个复用点（`buildScopeHashes` / `CREDIT_CHECK_RESULT_SCOPE` / `computePolicySnapshotFingerprint`）在包合同层未落实其可获得性 | §37.54.5.1、§37.54.5.2、§37.54.15.3、§37.54.15.9 | `factDigest` 归 **W11-D**（R100-2 属 SC100）；W11-A 对 `credit-check.js` 只**追加**两个既有符号的命名导出（Q1 = 方案 A），禁止复制算法或 Scope SQL；`computePolicySnapshotFingerprint` 按 §37.54.5.2 从 `credit-policy.js` 提取为纯函数并由 `ensureCreditPolicySnapshot` 委托，等价性由 §37.54.15.9.3 的有效 / 无效 / 边界矩阵证明；`credit-scope.js` **零改动**；新增 §37.54.15.9.4 的 W11-SEC-01 冻结载荷**有界例外治理**（版本化、前向、不得追溯覆盖原冻结指纹） | **无重开**。修正的是包合同与共享基础的归属一致性，未新增任何业务语义、Schema、权限码或角色 |

**净结论**：六项修正**均未触发 REQUIREMENT_REOPEN**。C1 修正的是实现对 R-D2-1 的偏离；C2 在 R99-6 / R100-6 的允许空间内收敛；C3、C4 在已批准语义内补全；C5 撤销一条过度约束并明确边界；C6 收敛 W11-A 包合同与共享基础的归属一致性，并把冻结载荷的增量变更纳入有界例外治理。

**本节不新增任何业务政策、不新增权限码、不新增角色、不新增 SC / UAT / Race ID、不改写历史冻结设计文本。** 历史文本 `solution.md:12607`、`:12616`、`:19698` 及 Wave 9 / Wave 10 冻结合同均未被改写。

**Design status: `WAVE11_STAGE_C_BOUNDED_CORRECTION_READY`.**

---

### 37.54.20 W11-A U2 Pre-E3 Bounded Requirement & Design Correction（2026-10-28）

#### 37.54.20.1 Authorization, chronology and supersession boundary

Authorization: after the U2-1 implementation and the bounded Pre-E3 semantic parity verification,
the user approved `D-U2-1` and `D-U2-2` and explicitly authorized the consecutive
Requirement → Design Correction recorded in `document.md` →
`W11-A U2 — Bounded Requirement Correction after Pre-E3 Semantic Parity Verification`.

This section is a **forward bounded correction**, not a rewrite of history:

- §37.54.8 remains evidence of the originally approved U2 design;
- §37.54.15.10 remains the truthful U2-1 implementation/test record at the time it was produced;
- this section supersedes only §37.54.8.1–§37.54.8.3 and the stage interpretation in
  §37.54.15.10 where they conflict with D-U2-1 / D-U2-2;
- the former shared top-level `policySnapshot` response and all implicit stage fallback are retired;
- the original 29/29, FAST 500/500, FULL 2983/2983 and Build PASS records are preserved but do not
  constitute evidence for the corrected cases;
- U2 E3 is blocked until corrected Implementation and corrected SQLite E2 pass.

No Wave 9 / Wave 10 business writer, U1 fingerprint algorithm, W11-SEC read-scope contract, frozen
digest or historical Snapshot is changed by this Design Correction.

#### 37.54.20.2 Corrected API request and error contract

```text
GET /api/credit/exposure
    ?customerId=            required
    &stage=                 required; one of CREDIT_CHECK_STAGES
    &salespersonId=         optional
    &businessDate=          optional (default = server current business date)
    &creditObjectType=      optional (default CUSTOMER)
    &creditObjectId=        optional (default customerId)

CREDIT_CHECK_STAGES (reuse; no second constant)
    SO_SUBMIT | SO_APPROVE | SALES_DELIVERY_CONFIRM

stage missing / empty / invalid
    -> HTTP 400
    -> code CREDIT_QUERY_INVALID_INPUT
```

The handler imports and validates against the existing `CREDIT_CHECK_STAGES`. Stage is parsed only
after canonical Credit read authorization has passed and is used only as a rule-set context. It is
never forwarded to `resolveCreditReadMode`, never changes `authorizationDate`, and never implies that
`evaluateCredit()` or a real Sales mutation is running.

Delete the U2-1 `resolveRuleStage()` interpretation. The corrected implementation contains no query
that chooses `business_stage`, no Profile-bound stage substitution, no `ORDER BY business_stage
LIMIT 1`, no lexical first stage and no `CREDIT_CHECK_STAGES[0]` default.

`GET /api/credit/exceptions` and `GET /api/credit/exceptions/:checkResultId` retain their existing
request/error contracts. Their optional `stage` is a filter over **historical persisted results** and
is not the SC101 dynamic-computation stage input.

#### 37.54.20.3 Corrected response — Per-Scope Computed Policy Identity

The corrected response has no shared top-level `policySnapshot`. Each returned `scopes[]` entry owns
one computed identity:

```json
{
  "exposure": {
    "customerId": "cus-1",
    "businessDate": "2026-10-28",
    "stage": "SO_APPROVE",
    "scopes": [
      {
        "scopeType": "CUSTOMER_AGGREGATE",
        "creditProfileId": "cp-aggregate",
        "creditLimitCents": 100000,
        "usedCents": 260000,
        "remainingCents": -160000,
        "unlimited": false,
        "overLimitCents": 160000,
        "components": {
          "approvedSoCommitmentCents": 300000,
          "deliveredNotSettledCents": 0,
          "arOpenCents": 0,
          "eligiblePrepaymentCents": 40000,
          "ambiguousAttributionCents": 0
        },
        "computedPolicyIdentity": {
          "customerId": "cus-1",
          "businessDate": "2026-10-28",
          "stage": "SO_APPROVE",
          "scopeType": "CUSTOMER_AGGREGATE",
          "creditProfileId": "cp-aggregate",
          "creditLockAnchorId": "anchor-aggregate",
          "parameterSetHash": "<64 lowercase hex>",
          "ruleSetHash": "<64 lowercase hex>",
          "profileEffectiveStateHash": "<64 lowercase hex>",
          "fingerprint": "CSP1:<64 lowercase hex>",
          "persisted": false,
          "creditPolicySnapshotId": null
        }
      }
    ]
  }
}
```

`creditLockAnchorId` is read from the effective Profile's already-provisioned `anchor_id`; the query
must not call `ensureCreditLockAnchor`. If a Profile is visible and effective but its canonical anchor
cannot be read, the existing invariant error is returned fail closed; no anchor is provisioned by GET.

The name `computedPolicyIdentity` deliberately differs from SC102's historical Snapshot fields. A
`CSP1:` fingerprint does not itself encode stage or business date, so callers must treat the complete
object—not the fingerprint string alone—as the business identity.

#### 37.54.20.4 Per-scope hash and viewer-independence algorithm

For each already-authorized returned scope independently:

```text
hashScope = {
  scopeType,
  profile: thisScopeEffectiveProfile,
  stage: explicitRequestStage
}

hashes = buildScopeHashes(db, {
  scopes: [hashScope],        // exactly one scope; never all viewer-visible Profiles
  businessDate
})

fingerprint = computePolicySnapshotFingerprint({
  parameterSetHash: hashes.parameterSetHash,
  ruleSetHash: hashes.ruleSetHash,
  profileEffectiveStateHash: hashes.profileEffectiveStateHash
})
```

Consequences:

- `ruleSetHash` is the effective rule set for the explicit stage only;
- `profileEffectiveStateHash` contains only this scope's effective Profile state;
- the hash input cannot include another visible or hidden Profile;
- ADMIN and Self get identical hashes/fingerprint for the same authorized scope and context;
- different scope Profiles may legitimately produce different profile-state hashes/fingerprints;
- no second hash builder, canonical JSON encoder or CSP1 implementation is introduced.

The U1 algorithm remains byte-for-byte frozen. Per-scope isolation changes only which already-approved
input set is supplied to `buildScopeHashes`; it does not change hash serialization, input field order,
SHA-256 or the `CSP1:` computation.

#### 37.54.20.5 D-U2-1 amount/data flow and Finance adapter contract

```text
resolveCreditReadMode(actor) + requireCreditReadScope
  -> validate request including explicit stage
  -> resolve customer credit object
  -> resolve effective Profiles under the canonical SQL scope predicate
  -> for each admitted scope:
       computeCreditExposure(customerId, salespersonId-or-null, businessDate)
       if CUSTOMER_AGGREGATE:
         resolveEligiblePrepaymentForSalesGate({
           customerId,
           businessDate,
           gateStage: 'CREDIT_CHECK',
           salesOrderId: null,
           remainingRequiredCents: 0,
           lockMode: 'NONE'
         })
         copy eligibleAmountCents only into this response's aggregate components
       if SALESPERSON_SUB_LIMIT:
         eligiblePrepaymentCents = 0
       calculate used / remaining / over-limit with frozen integer-cent arithmetic
       calculate this scope's computedPolicyIdentity
  -> send response
```

Why `gateStage: 'CREDIT_CHECK'`: the frozen adapter requires a non-empty diagnostic gate-stage value;
its balance selection depends on customer and business date, not on this label or `salesOrderId`.
SC101 is reusing the Credit Check's eligible-prepayment semantics, not creating a new Finance query
contract. `salesOrderId:null` is intentional because SC101 is a current exposure query, not a source
document decision.

Static adapter audit confirms `lockMode='NONE'`:

- performs only SELECTs over `settlement_unapplied_balances`, `balance_applications`,
  `financial_refunds`, `settlement_reversal_items` and `settlement_reversals`;
- skips `lockParentBalances()` and therefore emits no `FOR UPDATE`;
- opens no transaction, writes no row, provisions no lock/anchor and calls no audit writer;
- preserves the existing Finance remaining-eligible formula, including its existing per-balance
  lower bound; W11-A adds no new `MAX(0)` or rounding rule;
- returns source identities internally, but SC101 projects only `eligibleAmountCents` and must not
  expose those Finance identities.

The adapter is invoked only after read authorization and visible Profile resolution. At most one
aggregate eligible-prepayment read is needed per request; the result is never applied to a Sub-Limit.

Corrected arithmetic:

```text
Aggregate used = approved SO + delivered-not-settled + AR open - eligible prepayment
Sub-Limit used = approved SO + delivered-not-settled + attributable AR open
remaining      = credit limit - used                 // may be negative
over-limit     = max(0, used - credit limit)         // existing presentation rule
```

No proposed delta participates in SC101 `usedCents`.

#### 37.54.20.6 Persisted lookup and historical compatibility

For a computed scope identity, the optional read-only persistence lookup is exact:

```text
credit_policy_snapshots
WHERE business_date = computed.businessDate
  AND snapshot_fingerprint = computed.fingerprint
  AND scope_type = computed.scopeType
  AND credit_profile_id = computed.creditProfileId
ORDER BY captured_at DESC, id DESC
LIMIT 1
```

The former `credit_profile_id=? OR credit_profile_id IS NULL` broad match is not part of the corrected
identity contract. `persisted:true` means only that the exact computed per-scope identity already has
a persisted row; it does **not** claim that the row came from the current GET or that the GET replayed
a historical decision. GET never inserts that row.

SC102 remains unchanged:

```text
credit_check_results.credit_policy_snapshot_id
credit_check_results.policy_snapshot_fingerprint
credit_check_results.profile_effective_state_hash
credit_check_results.stage / business_date / decision / check_group_id
  -> original persisted historical Credit Check identity
```

Exception list/detail must continue to return those stored fields verbatim. They never substitute a
new SC101 computed identity and never recompute history. No Snapshot migration, backfill or rewrite is
introduced.

#### 37.54.20.7 RBAC, transaction, side-effect and error design

| Concern | Corrected contract |
|---|---|
| RBAC / data scope | `resolveCreditReadMode` and `requireCreditReadScope` execute first; effective Profile resolution combines date and canonical SQL scope predicate in one statement |
| Stage | required request business context; validated against imported `CREDIT_CHECK_STAGES`; never an authorization input |
| Transaction | none; SC101 remains an ordinary read-only GET and does not call `transaction()` or `readTransaction()` |
| Locks | none; Finance adapter uses `lockMode='NONE'`; no Credit anchor/profile/rule locks |
| Writers | no `evaluateCredit`, `ensureCreditPolicySnapshot`, `ensureCreditLockAnchor`, idempotency or audit writer |
| Finance privacy | only aggregate eligible amount enters response components; no balance/source identity is projected |
| Missing/invalid stage | 400 `CREDIT_QUERY_INVALID_INPUT` |
| Missing/ambiguous Profile | existing 409 `CREDIT_PROFILE_MISSING` / `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` |
| Source inconsistency | existing 409 `CREDIT_EXPOSURE_SOURCE_INCONSISTENT` |
| Missing anchor invariant | fail closed; no GET-time repair/provisioning |
| Historical endpoints | response and error contracts unchanged |

Static and runtime zero-write assertions continue to cover all three GET endpoints. Runtime evidence
must compare complete table contents, not only selected row counts.

#### 37.54.20.8 Compatibility and consumer audit

Repository consumer audit found no UI/API client for `/api/credit/exposure`: current consumers are the
route registration and the uncommitted U2-1 test suite only. U3 has not started. Therefore the safest
correction is to **replace**, not deprecate alongside, the unaccepted shared top-level
`exposure.policySnapshot` with `scopes[].computedPolicyIdentity` and add required request `stage`.

There must not be two simultaneously active fields with conflicting semantics. The old U2-1 tests
that asserted the former field or omitted stage are retained as test cases but, in the separately
authorized Implementation Correction, must be updated with an explicit correction record rather than
deleted or weakened. Tests unrelated to the corrected contract remain byte-for-byte unchanged.

U3 must consume the corrected shape, explicitly choose/receive a stage and render computed identity
as current query context—not as a historical Check Snapshot.

#### 37.54.20.9 Minimum future Implementation Correction scope

Only a separately authorized Implementation round may change:

```text
server/modules/credit-query.js
  - import Finance eligible-prepayment adapter
  - remove resolveRuleStage and every implicit fallback
  - require/validate stage
  - apply aggregate-only prepayment
  - compute one identity per scope
  - replace shared policySnapshot response with computedPolicyIdentity per scope
  - exact persisted lookup

server/sales-customer-wave11-a-credit-query.test.js
  - retain the existing 29 test intentions
  - record and correct only assertions invalidated by the approved contract
  - add nonzero-prepayment, explicit-stage, multi-stage, viewer-independence,
    historical-compatibility and zero-write cases

solution.md / log/YYYY-MM-DD.md
  - append actual implementation and evidence records after authorization
```

No change is designed for `credit-check.js`, `credit-policy.js`, `credit-scope.js`, the Finance
adapter, `server/app.js`, `scripts/testing/test-suites.js`, `package.json`, Schema or Migration. The
existing test filename remains registered, so no suite-manifest change is needed. If implementation
proves any additional file necessary, it must stop and return to Design rather than expand scope.

#### 37.54.20.10 Corrected SQLite E2 and MySQL E3 gates

Corrected SQLite E2, before any MySQL authorization:

1. production Writer creates zero/nonzero/effective-date/historical-date prepayment fixtures;
2. Aggregate and Sub-Limit exact used/remaining/component values match the Wave 10 check amount with
   `proposedDeltaCents` excluded;
3. same-day SO_SUBMIT and SO_APPROVE rules produce different rule hashes selected only by request stage;
4. missing/empty/invalid stage returns 400 `CREDIT_QUERY_INVALID_INPUT`;
5. source contract contains no fallback query/default;
6. ADMIN and Self receive equal identity for the same authorized Profile; unauthorized Profiles are
   absent from every value/hash/count;
7. every scope identity states customer/date/stage/scope/Profile and is deterministic;
8. SC101 computed identities and SC102 historical persisted identities remain distinct and accurate;
9. repeated GETs leave a complete whole-database digest unchanged and create no Snapshot;
10. original 29 tests remain present; corrected assertions are traceably recorded, not removed;
11. focused Wave 9/10/W11-SEC/U1 regression, FAST, FULL, Build and `git diff --check` pass.

Only then may status return to `READY_FOR_E3`. Real MySQL E3 remains a separate authorization and must:

- reuse the corrected business fixture and production Writer;
- compare SQLite/MySQL amounts, per-scope hash fields, fingerprints, historical IDs and authorized
  visible sets exactly;
- rerun the missing/invalid stage and multi-stage matrix;
- prove viewer-independent identity and no unauthorized leakage;
- prove all GETs zero-write through before/after table contents plus protected campaign cleanup;
- reuse the existing protected runner, least-privilege contract and unified disposable target;
- leave five object classes at zero after cleanup.

No SQLite result is a substitute for E3, and no E3 result automatically signs U2 Acceptance/Freeze.

#### 37.54.20.11 Rollback and freeze boundary

This Design adds no Schema and therefore needs no database rollback. Future implementation rollback,
if authorized and required before Acceptance, consists only of reverting the bounded unaccepted U2
query/test correction while preserving all historical documentation; destructive Git operations are
not implied or authorized.

Preserved without modification:

```text
W11_SEC_01_ACCEPTANCE_PASS — FROZEN — GIT_JOURNAL_CLOSED
W11_A_U1_ACCEPTANCE_PASS — FROZEN — GIT_JOURNAL_CLOSED
U1 CSP1 algorithm and digest chain
Wave 10 Credit Check / eligible-prepayment / historical Snapshot writers
WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED
W10_INV_RISK_01 / LEGACY_DATA_EVIDENCE_PENDING / CREDENTIAL_EXPOSURE_OPEN
```

Not authorized: production code/test changes, MySQL, U3, W11-B/C/D, Acceptance/Freeze, Git Commit/Push,
Release or Deploy.

#### 37.54.20.12 Design status

**Status: `W11_A_U2_BOUNDED_CORRECTION_DESIGN_READY`.**

- `D_U2_1_FINAL_AGGREGATE_USED_DESIGNED`;
- `FINANCE_ADAPTER_LOCKMODE_NONE_READ_ONLY_VERIFIED`;
- `SUB_LIMIT_PREPAYMENT_ZERO_PRESERVED`;
- `D_U2_2_EXPLICIT_STAGE_REQUIRED_NO_FALLBACK`;
- `PER_SCOPE_COMPUTED_POLICY_IDENTITY_DESIGNED`;
- `VIEWER_DEPENDENT_SHARED_IDENTITY_RETIRED`;
- `DYNAMIC_COMPUTED_VS_HISTORICAL_PERSISTED_NAMES_AND_FLOWS_SEPARATED`;
- `NO_SECOND_EXPOSURE_FINANCE_HASH_OR_FINGERPRINT_ALGORITHM`;
- `MINIMUM_FUTURE_FILES_CLOSED`;
- `CORRECTED_SQLITE_E2_REQUIRED_BEFORE_MYSQL_E3`;
- `OLD_U2_1_HISTORY_PRESERVED_NOT_OVERCLAIMED`;
- `W11_SEC_U1_WAVE10_FREEZE_BOUNDARIES_PRESERVED`;
- `NO_IMPLEMENTATION_TEST_SCHEMA_MIGRATION_MYSQL_GIT_WRITE`;
- `HARD_STOP_AFTER_DESIGN_CORRECTION`.

#### 37.54.20.13 Bounded Implementation Correction（2026-10-28）

本节记录用户在 `W11_A_U2_BOUNDED_CORRECTION_DESIGN_READY` 后单独授权的有界实施结果。实际生产
修改仅发生在 `server/modules/credit-query.js`，测试修正仅发生在
`server/sales-customer-wave11-a-credit-query.test.js`；未修改 `credit-check.js`、
`credit-policy.js`、`credit-scope.js`、Finance adapter、`server/app.js`、测试登记、Schema 或
Migration。

SC101 的 Aggregate 金额先继续复用 `computeCreditExposure()` 取得原始组件，再以
`resolveEligiblePrepaymentForSalesGate()`、`gateStage='CREDIT_CHECK'`、`salesOrderId=null`、
`remainingRequiredCents=0`、`lockMode='NONE'` 取得 canonical eligible amount，并且只把
`eligibleAmountCents` 投影到 Aggregate 组件。Salesperson Sub-Limit 仍使用原始组件中的 0；没有
复制 Finance 扣减算法、没有截断负数 remaining、没有返回 Finance 余额来源身份。

`GET /api/credit/exposure` 在 Credit Read Mode / Scope fail-closed 后要求显式 `stage`，并以导入的
`CREDIT_CHECK_STAGES` 验证；缺失、空值和非法值统一返回 400 `CREDIT_QUERY_INVALID_INPUT`。已删除
Profile 绑定规则、规则表首行和默认常量的所有 stage 回退。请求 stage 只进入规则 Hash 上下文，
不改变授权日期或 Credit Read Mode；Finance adapter 的 gateStage 仍保持既有 `CREDIT_CHECK` 合同。

每个已授权档位分别以 `{ scopeType, profile: thisProfile, stage }` 调用一次
`buildScopeHashes()`，再调用冻结的 `computePolicySnapshotFingerprint()`；结果作为
`scopes[].computedPolicyIdentity` 返回，显式携带 customer/date/stage/scope/Profile/Anchor、三项
Hash 与 fingerprint。旧的 viewer-dependent 顶层 `exposure.policySnapshot` 已被替换，不保留第二个
冲突字段。持久化匹配严格使用 businessDate + fingerprint + scopeType + profileId + anchorId；0 条
返回 `persisted=false`，1 条返回精确 ID，多条 fail closed，且不接受 `credit_profile_id IS NULL`。
SC102 仍逐字投影原 `credit_check_results` 及特别审批中的历史 Snapshot 身份，不使用动态身份覆盖或
重算历史。

#### 37.54.20.14 Corrected SQLite E2 evidence

U2 专项测试由原 29 项扩展为 36 项，原 29 项测试意图全部保留。所有既有 exposure 请求按 D-U2-2
补入显式 stage；原测试
`UAT-S-35-A5 the policy snapshot identity is computed and linked, never persisted` 修正为
`UAT-S-35-A5 every scope has a computed policy identity and the read never persists it`：旧断言验证共享
顶层身份，新断言验证每档独立、可重算且不持久化的身份。权限负向、分页、零写入及历史身份保护
测试未删除、未 skip、未弱化。

新增 7 项覆盖：

1. 生产 Finance Writer 创建 40,000 分有效预收款；同一 fixture 下 Credit Check 与 SC101 Aggregate
   `usedCents=260000`，`eligiblePrepaymentCents=40000`，`remainingCents=-160000`；Sub-Limit
   `usedCents=300000`、eligible=0；`proposedDeltaCents` 不进入 used；
2. 预收款 businessDate 生效边界；
3. 同日 SO_SUBMIT / SO_APPROVE 不同规则产生各自且不同的 ruleSetHash；
4. stage 缺失、空、非法均为 400，并验证 DENY 在敏感读取前 403；
5. 源码无隐式 stage fallback；
6. ADMIN 与 Self 对相同档位的完整 computed identity 相等，Self 不得获知额外档位；
7. 动态身份与历史身份分离、精确 persisted lookup、既有历史准确且 GET 不创建 Snapshot。

E1 静态证据同时确认 Finance adapter 使用 `lockMode='NONE'`，adapter 的 `FOR UPDATE` 只在
`lockMode === 'FOR_UPDATE'` 分支出现，SC101 不投影 source balance identities。E2 在 fixture Writer
阶段结束后才测量 GET，重复请求前后比较全库内容摘要；摘要不变，Snapshot 数不增加，无 Audit /
Snapshot Writer / Lock Provision。

实际门禁结果：

```text
Corrected U2 SQLite                         36/36 PASS
W11-SEC frozen scope                       14/14 PASS
W11-A U1 frozen primitives                  5/5 PASS
Wave 9 focused                             21/21 PASS
Wave 10 acceptance contract + credit       62/62 PASS (11 + 51)
Test Suite Governance                      20/20 PASS
FAST                                      500/500 PASS
FULL                                    2990/2990 PASS, 359 suites
Build                                      PASS (1965 modules)
git diff --check                           PASS
Real MySQL E3                              NOT_RUN
```

#### 37.54.20.15 Corrected implementation status and E3 boundary

**Status: `W11_A_U2_E2_CORRECTED_READY_FOR_E3`.**

- `D_U2_1_AGGREGATE_PREPAYMENT_PARITY_CORRECTED`;
- `D_U2_2_EXPLICIT_STAGE_NO_FALLBACK_CORRECTED`;
- `PER_SCOPE_VIEWER_INDEPENDENT_COMPUTED_IDENTITY_CORRECTED`;
- `EXACT_PERSISTED_LOOKUP_AND_HISTORICAL_SEPARATION_PROVEN`;
- `CORRECTED_U2_36_OF_36`;
- `FOCUSED_FAST_FULL_GOVERNANCE_BUILD_DIFF_CHECK_PASS`;
- `ZERO_WRITE_SQLITE_E1_E2_PROVEN`;
- `W11_SEC_U1_WAVE10_FREEZE_BOUNDARIES_PRESERVED`;
- `REAL_MYSQL_E3_NOT_RUN_REQUIRES_SEPARATE_AUTHORIZATION`;
- `NO_U2_ACCEPTANCE_OR_FREEZE_NO_U3_NO_GIT_WRITE`;
- `HARD_STOP_AFTER_CORRECTED_E2`.

#### 37.54.20.16 Real MySQL E3 implementation attempt（2026-10-28）

用户在 `W11_A_U2_E2_CORRECTED_READY_FOR_E3` 后单独授权真实 MySQL E3。本轮已建立独立 Gate
`scripts/gates/mysql-sales-wave11-a-gate.mjs`，其唯一 suite 为
`server/mysql-sales-customer-wave11-a-credit-query.integration.js`，并继续复用未修改的
`runProtectedMySqlCampaign`。`package.json` 只追加 `test:mysql:wave11-a`，既有本地默认入口、
W11-SEC Gate 和其他 scripts 不变。

新增共享 fixture `server/test-utils/wave11-a-credit-query-fixture.js`，把原 U2 SQLite 测试中的
Credit Query 准备方法提取为 SQLite/MySQL 共用代码；原 36 项断言未改变，重构后实跑 36/36 PASS。
E3 suite 采用十项单层 TAP，覆盖金额、40,000 分预收款、日期边界、显式三 stage、per-scope
identity、viewer independence、动态/历史分离、五级 Scope、分页、404 等价及全库零写入摘要。
跨引擎只把生产 Writer 生成的随机 Profile/Anchor 物理 ID 映射为稳定业务键；金额、stage、scope、
规则 Hash、排序、授权集合和错误合同不做归一化。

真实运行前的首次沙箱内只读 preflight 在建立数据库连接之前因 Windows DPAPI 当前用户上下文不匹配
失败（`Key not valid for use in specified state`）。随后请求在当前 Windows 用户上下文执行同一只读
preflight，但执行环境安全审查拒绝该提升请求。未读取明文密码、未连接 MySQL、未启动 Protected
Gate、未执行 Reset/Cleanup，也未查询到实时 `log_bin_trust_function_creators`。禁止使用手工密码、
旁路 Launcher 或降低身份检查，因此本轮不能形成真实 MySQL E3 证据。

**Status: `W11_A_U2_E3_ENVIRONMENT_BLOCKED`.**

- `E3_GATE_AND_SUITE_IMPLEMENTED_NOT_EXECUTED`;
- `SQLITE_SHARED_FIXTURE_36_OF_36_PASS`;
- `DPAPI_USER_CONTEXT_UNAVAILABLE_IN_SANDBOX`;
- `ELEVATED_READ_ONLY_PREFLIGHT_REJECTED`;
- `MYSQL_CONNECTION_RESET_GATE_POSTFLIGHT_NOT_RUN`;
- `NO_E3_PASS_NO_U2_ACCEPTANCE_OR_FREEZE`;
- `HARD_STOP`.

#### 37.54.20.17 E3 M2/M4/M9 exact failure triage（2026-10-29）

本节依据完整真实 MySQL transcript
`w11-a-u2-e3-20261029-074456.tap.log` 记录第二次 E3 的精确结果：MySQL 8.0.37，M1/M3/M5/
M6/M7/M8/M10 PASS，M2/M4/M9 FAIL，Gate exit 1，Protected Cleanup confirmed，fresh-session
tables/views/triggers/routines/events 均为 0。三个失败均为独立 `testCodeFailure`；before/after 已完成，
不是共享 Hook 连锁失败。

M2 的 `0 !== 300000` 来自测试误选：collector 先按 `profileKey` 排序三个 ADMIN scope，再只把
`amount` 投影到 `adminAmounts`，丢失 Profile 身份；断言用
`find(scopeType === 'SALESPERSON_SUB_LIMIT')`，因此命中按字典序位于 `sp-self` 前的 `sp-other`。
该隐藏 Profile 没有本客户的销售占用，真实 used=0；目标 `sp-self` 仍为 300000。问题在测试证据选择，
不是 SC101 金额实现，也不是 MySQL 专属差异。最小未来修正是保留 amount 对应的稳定 `profileKey`，
明确选择 `cus-w11-self:sp-self:*`，并独立断言 `sp-other` 为 0；不得把期望改成 0。

M9 的 `true !== false` 是 pagination evidence key 碰撞，不是数据库重复页或越权。共享 fixture 先在
HISTORICAL 执行一次生产 Credit Check，Preparation B 又在 TODAY 执行同订单/同 scope 的 Credit
Check；两行具有不同真实 `checkResultId`，但 `normalizeHistory()` 把两者都压缩为
`sourceOrderId:scopeType`。SQLite 一次性复现显示 page 0/page 2 的真实 ID 不同，而压缩 key 分别相同。
最小未来修正应使用各引擎真实 `checkResultId` 验证本引擎跨页无重叠，同时继续用稳定业务投影比较
SQLite/MySQL 页内容；不得用 Set 去重或放松非枚举断言。

M4 是已证明的生产跨引擎 ruleSetHash 合同冲突，不能按本轮测试白名单修正。冻结
`buildScopeHashes()` 把原始 `result_payload_json` 字符串直接纳入 canonical input。SQLite 物理列为
TEXT，生产 Writer 保存 `{"identity":"SO_APPROVE"}`；MySQL 物理列为 JSON，读取为
`{"identity": "SO_APPROVE"}`。其余输入（稳定 rule id、code、stage、scenario、timing、strength、
credit item、mode、effective dates）一致。使用冻结 `canonicalJson/sha256` 独立复算：

```text
SQLite compact JSON -> 3f2c670a3b45da049efcfd24cceb7d2214007d89bda0b8eded979838f5d1f60c
MySQL JSON rendering -> 5c54471880d334b95fad0373338a928f0d102d76d8c02abc4942e24a96ab2bcd
```

两值逐字命中 transcript 的 expected/actual；parameterSetHash 与 normalizedProfileHash 已相等，故
normalizedFingerprint 仅随 ruleSetHash 分叉。这不是随机 Fixture ID、排序或规则选择问题，而是冻结
算法对后端 JSON 文本表示敏感的真实生产语义缺陷。

修复 M4 需要独立 Requirement/Design 裁决：定义跨引擎 JSON semantic canonicalization、Hash 合同
版本及既有 Snapshot/历史引用兼容策略，然后才可授权修改冻结 `buildScopeHashes()`。将 fixture payload
改成 `{}`、忽略 ruleSetHash、强制比较归一值或改写历史 Snapshot 都会隐藏真实缺陷，未执行。

因此本轮未修改 Integration Suite、共享 Fixture或任何生产文件；M2/M9 的已证实测试修正也按“发现
生产 Hash 冲突即停止自动修复”的授权边界保留为后续同一有界实施项。真实 MySQL 未重跑。

**Status: `W11_A_U2_E3_PRODUCTION_CORRECTION_REQUIRED`.**

- `E3_SECOND_RUN_7_OF_10_PASS_M2_M4_M9_FAIL`;
- `M2_TEST_PROFILE_SELECTION_DEFECT_PROVEN`;
- `M9_TEST_EVIDENCE_KEY_COLLISION_PROVEN`;
- `M4_CROSS_ENGINE_JSON_RENDERING_HASH_CONFLICT_PROVEN`;
- `FROZEN_HASH_AND_HISTORY_NOT_MODIFIED`;
- `PRODUCTION_REQUIREMENT_DESIGN_CORRECTION_REQUIRED_BEFORE_RERUN`;
- `CLEANUP_CONFIRMED_FINAL_INVENTORY_ZERO`;
- `NO_MYSQL_RERUN_NO_GIT_WRITE_NO_ACCEPTANCE_FREEZE_OR_U3`;
- `HARD_STOP`.

#### 37.54.20.18 E3 GET zero-write measurement boundary correction（2026-10-29）

本节记录用户在 `W11_A_U2_E3_TEST_FAILED — CLEANUP_CONFIRMED` 后批准的有界测试修正。该修正只
处理代码审查已确认的 measurement-boundary 缺陷，不声称已经证明此前真实 MySQL 运行的第一个原始
错误。生产信用实现、共享 Fixture、Gate、Protected Runner、Launcher、Preflight、Schema 与 Migration
均未修改。

`collectEngineEvidence()` 现在显式分为三个阶段：

1. Fixture Preparation A：共享 `seedWorld`、订单准备、stage rule、额外 Profile Writer；随后单独对
   zero-prepayment SC101 GET 做一次 before/after 全库摘要观测；
2. Fixture Preparation B：Finance 40,000 分预收款 Writer 与 `evaluateCredit()` Credit Check Writer；
   后者可能 provision Anchor/Snapshot，因此其金额证据先保存，再建立最终 baseline；同时预先解析
   Profile/Anchor 稳定业务键及范围外历史 ID；
3. Final GET-only Observation：baseline 后仅调用生产 `getCreditExposure`、`listCreditExceptions`、
   `getCreditException`；身份规范化只读取准备阶段内存 Map，不再直接查询数据库。最后通过 observer
   取得 after snapshot。

最终证明继续比较完整数据库每张表的 count + content digest，并额外逐项锁定
`credit_policy_snapshots`、`credit_check_results`、`audit_logs`、`payment_collections`、
`settlement_unapplied_balances`、`balance_applications`、`financial_refunds`、
`settlement_reversal_items`。这些关键表必须实际存在，且 before/after 摘要完全相等；Snapshot 行数、
全库摘要以及重复 GET 结果断言没有删除或放宽。

原 10 项顶层 TAP `W11-A-E3-M1` 至 `M10` 全部保留，名称、业务范围和断言强度未降低。静态语法检查
PASS；共享 Fixture 静态检查 PASS；受影响的 SQLite U2 suite 36/36 PASS；`git diff --check` PASS。
本轮未连接 MySQL、未运行 Gate/Reset/Cleanup，上一轮真实失败不能被本轮静态/SQLite 结果替代。

下一次真实 Gate 必须由用户在 Windows PowerShell 外层捕获完整 stdout/stderr 到当前用户私有目录：

```powershell
$evidenceDir = Join-Path $env:LOCALAPPDATA 'ModernERP\mysql-gate\evidence'
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$tapLog = Join-Path $evidenceDir "w11-a-u2-e3-$stamp.tap.log"
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/run-mysql-local-gate.ps1 `
  -Script test:mysql:wave11-a 2>&1 | Tee-Object -FilePath $tapLog
$gateExit = $LASTEXITCODE
"GATE_EXIT_CODE=$gateExit" | Tee-Object -FilePath $tapLog -Append
Write-Host "TAP evidence: $tapLog"
exit $gateExit
```

该日志只保存在 LocalAppData，不得提交 Git；现有 Launcher 不打印明文密码。必须保留完整首个
`not ok`、YAML diagnostic、stack、退出码、Runner cleanup 和 fresh-session 五类对象结果，禁止只保存
尾部外层异常。

**Status: `W11_A_U2_E3_TEST_CORRECTION_READY_FOR_RERUN`.**

- `CONFIRMED_MEASUREMENT_BOUNDARY_DEFECT_CORRECTED`;
- `CREDIT_CHECK_WRITER_BEFORE_FINAL_BASELINE`;
- `FINAL_WINDOW_PRODUCTION_GET_HANDLERS_ONLY`;
- `FULL_DATABASE_AND_CRITICAL_TABLE_ZERO_WRITE_ASSERTIONS_PRESERVED`;
- `MYSQL_TOP_LEVEL_TAP_10_OF_10_DECLARATIONS_PRESERVED`;
- `SQLITE_U2_36_OF_36_PASS`;
- `REAL_MYSQL_RERUN_NOT_RUN`;
- `PRIOR_FIRST_ORIGINAL_ERROR_STILL_UNPROVEN`;
- `NO_E3_PASS_NO_ACCEPTANCE_FREEZE_OR_U3`;
- `HARD_STOP`.

#### 37.54.20.19 Cross-Engine Hash Contract Bounded Design Correction（2026-10-29）

##### 37.54.20.19.1 Authorization, evidence and supersession boundary

用户在 `W11_A_U2_E3_PRODUCTION_CORRECTION_REQUIRED` 后连续授权 Requirement → Design
Correction。对应 Requirement 已追加于 `document.md` → `W11-A U2 E3 — Cross-Engine Credit
Policy Hash Contract Requirement Correction`，状态为
`W11_A_U2_E3_HASH_CORRECTION_REQUIREMENT_READY`。

本节只向前修正 M4 的 Hash 合同，并记录 M2/M9 的测试修正设计。§37.54.20.13–§37.54.20.18
仍是其发生时的真实实现、E2、E3 和排查记录；不回写、不覆盖。当前真实 MySQL E3 仍是 7/10，
Cleanup confirmed，不能被本 Design 改写为 PASS。

确认的 M4 输入与冻结 V1 输出为：

```text
SQLite TEXT  {"identity":"SO_APPROVE"}
  -> 3f2c670a3b45da049efcfd24cceb7d2214007d89bda0b8eded979838f5d1f60c
MySQL JSON   {"identity": "SO_APPROVE"}
  -> 5c54471880d334b95fad0373338a928f0d102d76d8c02abc4942e24a96ab2bcd
```

`parameterSetHash`、normalized Profile state、规则业务字段与稳定规则 ID 相同，故根因唯一落在
`result_payload_json` 的物理字符串。`canonicalJson()` 会递归排序传入对象，但 V1 把 payload 当成
字符串属性，所以不会进入字符串内部。

##### 37.54.20.19.2 Dependency graph and persisted identities

```text
createCreditRule(resultPayload object)
  -> JSON.stringify
  -> credit_check_rules.result_payload_json
       SQLite TEXT / MySQL native JSON rendering
  -> buildScopeHashes
       parameterSetHash
       ruleSetHash  <--- M4 physical-rendering dependency
       profileEffectiveStateHash
  -> computePolicySnapshotFingerprint
  -> credit_policy_snapshots(id, fingerprint, three hashes)
  -> evaluateCredit
       checkGroupId
       credit_check_results(snapshot id/fingerprint/profile hash)
       audit_logs
  -> credit_special_approval
       exact source result + snapshot id + fingerprint binding

SC101 -> buildScopeHashes + pure fingerprint -> per-scope computed identity
SC102 -> stored check/snapshot/approval fields verbatim
```

实际持久化关系确认：Snapshot 存三项 Hash 与 fingerprint；Check Result 存 Snapshot FK、fingerprint、
Profile Hash 与 Check Group；特别审批复制来源 Result、Snapshot ID、fingerprint 与 Profile Hash；消费查询
同时匹配 Snapshot ID 与 fingerprint。SC101 只动态计算并只读查找；SC102 不计算历史身份。

##### 37.54.20.19.3 JSON semantic canonicalization contract

新增一个**有界 payload 解析/验证原语**，不新增第二套 Hash builder，也不引入通用 JSON 库：

```text
parseCreditRulePayload(rawDatabaseValue)
  1. SQL NULL/undefined -> CREDIT_RULE_PAYLOAD_MISSING
  2. validate strict JSON lexical form and reject observable duplicate object keys
  3. JSON.parse
  4. require top-level plain object
  5. recursively validate values and number domain
  6. return semantic object; do not hash and do not write
```

该原语可位于独立、窄职责的 `server/modules/credit-rule-payload.js`，由 Rule Writer 与
`credit-check.js` 共同使用。它只负责 strict JSON/object/duplicate/number 边界；唯一的递归排序与
序列化仍使用 `credit-check.js` 既有 `canonicalJson()`，唯一 Scope Hash 入口仍是
`buildScopeHashes()`。

规范化规则：

| JSON value | V2 contract |
|---|---|
| object | member name 按既有 `canonicalJson()` 的确定顺序递归排序 |
| array | 顺序、重复元素与长度原样保留；元素递归规范化 |
| string/key | JSON escape spelling 被解析；Unicode code points 不做额外 NFC/NFD 转换 |
| finite fractional number | 采用 `JSON.parse` 后 ECMAScript Number，再由 `JSON.stringify` 确定表示 |
| integer | 必须 `Number.isSafeInteger`；超范围 fail closed，禁止舍入碰撞 |
| `-0` / `0` | 同一数值语义，规范表示为 `0` |
| boolean / nested `null` | 分别保留为 `true/false/null` |
| top-level `{}` | 合法 |
| top-level `[]` / scalar / JSON `null` | `CREDIT_RULE_PAYLOAD_TYPE_INVALID` |
| malformed JSON | `CREDIT_RULE_PAYLOAD_INVALID_JSON` |
| SQL NULL | `CREDIT_RULE_PAYLOAD_MISSING`，与 JSON null 明确区分 |
| duplicate object key | 如在应用边界可见则 `CREDIT_RULE_PAYLOAD_DUPLICATE_KEY` |

生产 Writer 的 request body 已是 JS object，天然不存在 raw-text 重复 Key；Implementation 必须把
显式 array/scalar/null 从当前静默 `{}` 改为 fail closed，缺省/未提供仍按既有 `{}`。SQLite TEXT 无
JSON CHECK；MySQL JSON 会验证并物理规范化，且原始重复 Key 可能不可恢复。因此 raw SQL 写入不属于
业务合同；MySQL 已吞并的非法重复 Key 不可伪装成可证明的跨引擎输入。无需 Schema/Migration，读取
边界对仍可观测的非法值 fail closed。

V2 规则集输入把 `resultPayloadJson: rawString` 替换为
`resultPayload: parseCreditRulePayload(rawString)`，随后由既有 outer `canonicalJson()` 统一序列化；
规则排序与其余字段保持不变。V2 `ruleSetHash` 使用域分隔：

```text
SHA256("CREDIT_RULE_SET_V2\0" + canonicalJson(v2RuleProjection))
```

参数 Hash 和 Profile Hash 的现有算法不变；返回 identity 同时携带
`hashContractVersion='CREDIT_POLICY_HASH_V2'`，避免把裸 64 hex 脱离版本解释。

##### 37.54.20.19.4 Alternatives and selected decision

| 路线 | 跨引擎 | 历史/Freeze | Replay/审批 | 结论 |
|---|---|---|---|---|
| A. 原地改变 `buildScopeHashes`，仍称 CSP1 | 新计算可一致 | 同一 `CSP1:` 名称出现两种语义；旧 Golden、旧 Snapshot 身份与 T5 失真 | 新旧 Check Group/审批无法可靠分层 | **拒绝** |
| B. 保留 V1，新增显式 V2 identity | 一致且可测试 | V1 原值永久保留；V2 单独 Golden/指纹链 | 可用 CSP2/CCHK2 隔离并显式处理 legacy replay | **选择** |
| C. 只在读取边界规范化 JSON，再另定兼容规则 | 是 | 若无版本仍等同 A；若有版本实质是 B 的实现方式 | 单独使用不能关闭历史身份问题 | **作为 B 的实现机制，不单独成案** |

唯一推荐方案：**B + C(boundary mechanism)**。生产中仍只有一个 `buildScopeHashes()` 和一个
`computePolicySnapshotFingerprint()`，二者由显式 `hashContractVersion` 选择 V1/V2；不得建立 U2
专用 builder。V1 branch 必须逐字节保留旧投影、旧 digest 与旧 prefix，仅用于 Golden、历史验证和
legacy replay。所有新动态查询和新 Credit Check 明确请求 V2。

V2 Snapshot fingerprint：

```text
canonical = lengthPrefix("CREDIT_POLICY_SNAPSHOT_V2")
          + lengthPrefix(parameterSetHash)
          + lengthPrefix(ruleSetHash)
          + lengthPrefix(profileEffectiveStateHash)
fingerprint = "CSP2:" + SHA256(canonical)
```

V1 继续是原三个 Hash 的 length-prefix 串与 `CSP1:`，不插入 version，不重算。V2 的 domain
string 进入 digest，不只是换 prefix。

##### 37.54.20.19.5 Snapshot and SC101/SC102 compatibility

无需 Schema/Migration：

- `credit_policy_snapshots.snapshot_fingerprint VARCHAR(128)/TEXT` 可容纳 `CSP2:`；
- `credit_check_results.check_group_id VARCHAR(128)/TEXT` 可容纳 `CCHK2:`；
- Snapshot 三 Hash 列继续存 64 lowercase hex；其版本由 fingerprint prefix 权威确定；
- 新 Snapshot 的 `notes_json.contractVersion='CREDIT_POLICY_SNAPSHOT_V2'` 仅作诊断，不是身份权威；
- `CSP1:` / `CCHK1:` 行不 UPDATE、不 backfill、不重写。

`ensureCreditPolicySnapshot()` 接受显式 contract version。纯
`computePolicySnapshotFingerprint()` 保留 V1 默认/显式路径以维持 U1 Golden，并增加显式 V2 路径；
生产 Snapshot Writer 必须显式传 V2，禁止因遗漏参数继续写 V1。

SC101 每档 `computedPolicyIdentity` 增加：

```json
{
  "hashContractVersion": "CREDIT_POLICY_HASH_V2",
  "fingerprintVersion": "CSP2",
  "fingerprint": "CSP2:<64 lowercase hex>"
}
```

其它 customer/date/stage/scope/Profile/Anchor/三 Hash 字段保留。persisted lookup 仍精确匹配
businessDate + fingerprint + scope + Profile + Anchor；`persisted=false` 只表示没有 exact CSP2 row，
不否定 CSP1 历史。GET 不调用 Writer。

SC102 继续逐字段返回数据库已存的 Snapshot ID、fingerprint、rule hash、Profile hash、Check Group 与
approval binding。可由 `CSP1/CSP2`、`CCHK1/CCHK2` 前缀识别版本，但不得用当前规则重算历史；未知或
畸形 prefix fail closed。旧 Snapshot 与新 Snapshot 即使业务上下文相同，也因 prefix 与 digest domain
不同而可区分。

##### 37.54.20.19.6 Replay, Check Group and Special Approval

新决策的 Group identity 使用：

```text
CCHK2:SHA256(
  "CREDIT_CHECK_GROUP_V2\0" |
  source | stage | businessDate | authorizationContext |
  V2 parameter/rule/profile hashes | exposureDigest
)
```

V1 CCHK1 公式完全保留。为防止版本切换把同一事实静默写成第二个决定，Writer 在任何 V2 Snapshot、
Result、approval-consumption audit 之前执行 replay gate：

1. 计算当前业务输入的原 V1 candidate（包括当前 `authorizationContext`、V1 hashes 与 exposure
   digest），按 exact `CCHK1:` 查找；
2. 若存在，验证 group 行数/Scope 集、source、stage、businessDate、recognitionMode、proposed delta、
   component breakdown、Profile/Anchor、Snapshot FK 与 Snapshot 三 Hash 全部相符；只有全部相符才走
   原 V1 replay/approval 语义，不创建 CSP2/CCHK2；
3. exact candidate 不存在时，按同一 source + stage + businessDate 查询 legacy contextual rows；若其
   存储的业务投影与当前事实相同或无法区分，但 CCHK1 不能精确证明（例如跨引擎物理 JSON 或缺失的
   authorizationContext 证据），抛 409 `CREDIT_CHECK_LEGACY_REPLAY_AMBIGUOUS`，事务零新增写入；
4. 只有不存在 legacy candidate，或存储的 exposure/proposed delta/Profile/parameter/recognition 等
   可证明业务事实已经变化时，才进入 V2 Snapshot 与 CCHK2 写入；单凭 rule hash 不同不能证明变化，
   因为它正是 M4 的分叉字段。

这一定义不尝试从 Hash prefix 猜测授权上下文，也不自动把 V1 转为 V2。跨引擎搬迁后若无法证明 exact
legacy replay，明确拒绝是设计结果，不是生成第二个决定。

特别审批兼容：

- legacy exact replay 只使用其原 Check Result 的 Snapshot ID + CSP1 fingerprint，继续遵守既有
  expiry、scope mode、source order、authority ceiling、SOD 与 one-time audit 规则；
- V2 只查找 exact CSP2 Snapshot ID + fingerprint；CSP1 approval 永不释放 CCHK2；
- 新 V2 approval 正常复制 V2 来源身份；不迁移、不复制、不提前消费旧 approval；
- ambiguous legacy replay 在 approval lookup/consume 之前拒绝，保证零误消费、零重复消费。

##### 37.54.20.19.7 Freeze exception and U1 T5 evidence chain

永久保留：W11-SEC 原 14 项 SHA-256、U1 四项增量指纹、U1 原 7 valid + 10 invalid CSP1 Golden、
原 Wave 10 行为证据。它们描述各自签发时点，不用新值覆盖。

未来 Implementation 需要精确冻结例外：

```text
server/modules/credit-check.js
  仅允许：version constants；单一 buildScopeHashes 的显式 V1/V2 branch；V2 rule payload
  semantic input；CCHK2；legacy replay gate。禁止改变 V1 projection/digest/output。

server/modules/credit-policy.js
  仅允许：纯 fingerprint 函数的显式 V2 branch；Snapshot Writer 显式 version dispatch；
  Rule Writer 对 payload 合法域 fail closed。禁止改变 CSP1 branch 与旧行查询/写入结果。
```

U1 T5 不得再以“当前正文仍逐字节等于 W11-SEC”代表 V2 完整性。后续获批时应有界演进为版本化证据链：

1. 原 W11-SEC digest 与 U1 pre/post digest 常量原样保留并继续断言其历史来源；
2. 原 CSP1 Golden、V1 builder Golden、Scope constant 与唯一 owner 断言继续执行；
3. 为本次授权的两个 frozen files 记录 implementation-before / implementation-after SHA-256；
4. 新增独立、预先固定来源的 V2 Golden Vectors；
5. T5 对当前文件验证新授权后的完整 digest，并以 V1 Golden 证明旧算法兼容，不删除、skip 或放宽
   原保护目的。

这是新的 versioned bounded amendment，不是 W11-SEC/U1 Re-Freeze。Implementation 前必须再次核对
旧指纹；Implementation 后单独记录新基线。

##### 37.54.20.19.8 M2/M9 test-only corrections

M2：collector 的 amount evidence 必须保留 `profileKey`，断言显式取
`cus-w11-self:sp-self`（完整 fixture key 为 `cus-w11-self:sp-self:2026-08-28`），验证 used=300000；
Aggregate 仍为 eligible=40000、used=260000；另独立断言 `sp-other` used=0。不得再按首个
`SALESPERSON_SUB_LIMIT` 选择，也不得把 expected 改为 0。

M9：每个引擎内部页间重叠直接比较真实 `checkResultId`。跨引擎内容比较使用至少
sourceOrderId + scopeType + stage + businessDate + stable Profile key + proposedDelta + decision 的稳定投影；
在比较前逐项/成对断言投影在该结果集内唯一，输出条数必须等于输入条数。`Set` 只能用于显式
uniqueness assertion，不能产出去重后的比较数据。范围外详情与不存在仍保持相同 404。

##### 37.54.20.19.9 Transaction, errors, audit, compatibility and rollback

| Concern | Design |
|---|---|
| transaction | `evaluateCredit()` 继续由调用方事务包裹；payload/hash/replay 验证在所有新写入之前；错误随事务回滚 |
| GET | SC101/SC102 只读，无 transaction/lock/writer/audit；invalid persisted prefix fail closed |
| error | payload 使用 R-HASH-01 的四类明确错误；legacy ambiguity 使用 409 `CREDIT_CHECK_LEGACY_REPLAY_AMBIGUOUS` |
| audit | 新 CCHK2 非 replay 仍写既有 EVALUATE audit；V1 exact replay 与 approval consume 保持原语义；拒绝路径零 audit |
| RBAC/SOD | 无权限码、角色、read scope、approval authority 或 SOD 变化 |
| state | 不修改 approval state machine；只强化版本匹配 |
| compatibility | V1 rows/read APIs immutable；new writes V2；unknown version rejected |
| schema | none；prefix 存入既有字段，notes 仅诊断 |
| rollback | 在任何生产 V2 写入前可回退有界代码；一旦生产存在 CSP2/CCHK2，旧二进制不认识 V2，禁止直接降级，须另行授权 forward-compatible rollback plan |

本轮不部署、不产生生产 V2 行，因此没有数据 rollback 动作。

##### 37.54.20.19.10 Future Implementation whitelist

后续必须单独授权，且只允许：

```text
server/modules/credit-rule-payload.js                         NEW, bounded parser/validator only
server/modules/credit-check.js                               V1/V2 hash + replay gate
server/modules/credit-policy.js                              CSP2 + writer validation/version dispatch
server/modules/credit-query.js                               SC101 V2 metadata/exact persisted lookup
scripts/sales-customer-wave11-a-primitives.test.js           V1 preservation/T5 chain/V2 vectors
server/sales-customer-wave10-credit-check.test.js            V2/replay/approval/error regressions
server/sales-customer-wave11-a-credit-query.test.js          SC101/SC102 V2 + zero-write regressions
server/mysql-sales-customer-wave11-a-credit-query.integration.js  M2/M9 + M4 E3 evidence
solution.md
log/YYYY-MM-DD.md
```

`server/modules/credit-special-approval.js` 无需修改：现有 exact Snapshot ID + fingerprint 匹配已满足
版本隔离。共享 fixture 原则上无需修改；若 Implementation 证明必须为 JSON nested/invalid vectors 扩展
fixture，必须先返回 Design，不得自行扩大。禁止修改 Schema/Migration、`server/app.js`、Finance
adapter、`credit-scope.js`、package scripts、test manifest、Gate/Runner/Launcher/Preflight。

##### 37.54.20.19.11 Acceptance matrix and recovery conditions

Future SQLite E2：

1. V1 7/10 Golden、V1 builder output、CSP1 prefix/ordering 全部原样 PASS；
2. V2 fixed Golden 独立保存，重复调用确定；
3. whitespace、object key order、nested object 在 V2 等价；array reorder 不等价；
4. strings/escape、finite fraction、safe integer、`-0` 合同成立；unsafe integer/non-finite 拒绝；
5. SQL NULL、JSON null、empty array、malformed JSON、observable duplicate key 分类型 fail closed 且零写；
6. `{}` 合法，`{}` 与有效非空对象 Hash 不同；
7. old Snapshot/Result/approval 字段逐字不变；CSP1/CSP2、CCHK1/CCHK2 可区分；
8. exact V1 replay 返回旧 group；ambiguous replay 409 且全库摘要不变；changed fact 可写 CCHK2；
9. CSP1 approval 不能释放 CCHK2；exact V1 approval replay 保持既有规则；
10. SC101 每 scope V2、viewer independent、GET 零写；SC102 verbatim history；
11. M2 精确 Profile 与 sp-other 两个断言；M9 raw ID 无重叠及 collision-free projection；
12. Wave 9/10、W11-SEC 14、U1、U2 focused，FAST、FULL、Build、`git diff --check` PASS；
13. frozen before/after digest chain 与 V2 Golden 来源完整记录。

Future real MySQL E3（另行授权）必须在同一生产 Writer/fixture 上证明上述合法 JSON vectors 与 SQLite
得到完全相同的 V2 ruleSetHash、CSP2 identity 和 CCHK2；M1..M10 顶层 TAP 10/10，无 skip/todo；M2、
M4、M9 均按新合同通过；完整数据库 + 关键表 GET before/after 摘要相同；Protected Cleanup confirmed，
fresh-session tables/views/triggers/routines/events 全为 0。不得忽略 ruleSetHash、替换比较结果或用空
payload 绕过 M4。

只有 E2 与真实 E3 全部恢复后，状态才可进入 U2 Acceptance review；本 Design 本身不签发 Acceptance。

##### 37.54.20.19.12 Remaining risks and Design status

已闭合的关键选择：V2 语义域、版本格式、无 Migration、旧行不可变、legacy replay fail-closed、审批
隔离、SC101/SC102、T5 指纹链、M2/M9 与实现白名单。

保留风险但不阻塞 Design：MySQL native JSON 已吞并的 raw-SQL duplicate-key 原始形态不可恢复；该输入
明确不属于生产 Writer 合同。跨引擎迁移后的 V1 exact replay 若缺少可证明 authorizationContext 将按
设计 409 拒绝，不会静默产生 V2 决策。生产部署/降级需要未来独立授权；本轮不涉及。

**Status: `W11_A_U2_E3_HASH_CORRECTION_DESIGN_READY`.**

- `V1_IMMUTABLE_V2_EXPLICIT_SELECTED`;
- `SEMANTIC_JSON_CANONICALIZATION_DESIGNED`;
- `SINGLE_HASH_AND_FINGERPRINT_OWNERS_PRESERVED`;
- `CSP2_CCHK2_DOMAIN_SEPARATED`;
- `NO_SCHEMA_MIGRATION_HISTORY_REWRITE_OR_APPROVAL_MIGRATION`;
- `LEGACY_REPLAY_EXACT_OR_AMBIGUOUS_FAIL_CLOSED`;
- `SC101_V2_SC102_VERBATIM_HISTORY`;
- `W11_SEC_U1_GOLDEN_AND_DIGEST_CHAIN_PRESERVED`;
- `M2_M9_TEST_ONLY_CORRECTIONS_DESIGNED`;
- `IMPLEMENTATION_REQUIRES_SEPARATE_AUTHORIZATION`;
- `NO_MYSQL_GIT_WRITE_ACCEPTANCE_FREEZE_OR_U3`;
- `HARD_STOP_AFTER_DESIGN`.

#### 37.54.20.20 Versioned Hash Implementation Correction（2026-10-29）

本节记录用户在 `W11_A_U2_E3_HASH_CORRECTION_DESIGN_READY` 后单独批准的 Implementation；不覆盖
§37.54.20.19 的 Requirement/Design，也不改写两次真实 MySQL E3 的历史结果。

实现保持单一 `buildScopeHashes()` 与单一 `computePolicySnapshotFingerprint()` owner。新增窄职责
`credit-rule-payload.js`，生产 Rule Writer 对显式 null/array/scalar、非有限数及不安全整数 fail closed；缺省
payload 仍为 `{}`。V1 继续以原始 `result_payload_json` 字符串生成原 rule hash/CSP1/CCHK1；V2 将持久化值解析为
语义对象后复用原 `canonicalJson()`，使用 `CREDIT_RULE_SET_V2`、`CREDIT_POLICY_SNAPSHOT_V2` 与
`CREDIT_CHECK_GROUP_V2` 三个 digest domain，分别生成 V2 rule hash、CSP2 与 CCHK2。未知 hash version 在读取或
解析规则 payload 前拒绝。

`evaluateCredit()` 现在显式要求调用方已进入事务。它在任何 CSP2/CCHK2、Result、Approval Consumption 或 Audit
写入前计算并核对 CCHK1 候选：Source、日期、Stage、授权上下文（由原 CCHK1 组成证明）、Scope、Profile、Anchor、
金额组件、决策、三项 V1 hash、Snapshot 与 Result 链全部一致才沿用原 CCHK1/CSP1；同来源/Stage/日期存在业务投影
相同但身份无法证明的 V1 候选时返回 409 `CREDIT_CHECK_LEGACY_REPLAY_AMBIGUOUS`。调用方事务使此前必要的
Finance/Policy lock 与 Anchor provision 一并回滚；未新增抢先 Result lock，Finance → Credit 锁序不变。原 Special
Approval writer 未改，消费侧仍按 Snapshot ID + fingerprint 精确匹配，故 CSP1 approval 不能释放 CCHK2。

SC101 显式请求 V2，并返回 `hashContractVersion=CREDIT_POLICY_HASH_V2`、`fingerprintVersion=CSP2`；完整 V2
identity 的 persisted lookup 仍只读。SC102 不重算历史值，逐字返回合法 CSP1/CSP2 与 CCHK1/CCHK2；未知或畸形
prefix 返回 `CREDIT_POLICY_IDENTITY_VERSION_INVALID`，且不修复、不回填。M2 保留并按完整 Profile key 精确选择
`sp-self`，另证 `sp-other=0`；M9 在单引擎内用真实 Result ID 证明页间无重叠，跨引擎比较前先证明稳定业务投影唯一，
不使用 Set 去重。

验证结果：V1/V2 primitives 9/9；Wave 10 + U2 focused 93/93；W11-SEC/U1/Wave 9/Governance focused
64/64；FAST 500/500；FULL 3000/3000（359 suites）；Build PASS；MySQL E3 NOT_RUN。Integration Suite 静态
检查 PASS，M1–M10 十个顶层 TAP、原断言强度与完整 GET 全库零写窗口保留。真实 MySQL 跨引擎结论仍必须由用户
后续独立授权的 protected rerun 给出。

**Implementation status: `W11_A_U2_E3_V2_IMPLEMENTED_READY_FOR_MYSQL_RERUN`.**

#### 37.54.20.21 Versioned Hash Implementation 续轮实测修正（2026-10-29）

本节记录 Implementation 续轮的实测修正，只覆盖 §37.54.20.19.8 的 M2/M9 测试实现与 §37.54.20.19.7
的 T5 证据链实现，不改变任何生产 Hash / Replay / Approval 语义，也不改写 §37.54.20.19 的
Requirement / Design。

**M2 — Profile key 必须由 Fixture 常量派生，不得硬编码日历日。** §37.54.20.19.8 给出的
`cus-w11-self:sp-self:2026-08-28` 是 Design 撰写当日的字面量。共享 Fixture 的 `PROFILE_FROM`
是相对当前日历日推导的（`HISTORICAL=TODAY-30d`，`PROFILE_FROM=HISTORICAL-30d`），Fixture 自身
要求"日期从当前日历日推导，永不静默过期"。因此该字面量每天失效，M2 的 scope 选择会返回
`undefined`。实现改为从 Fixture 导出的 `PROFILE_FROM` 派生精确完整 key：

```text
SELF_SUB_LIMIT_PROFILE_KEY  = `${SELF_CUSTOMER}:${SELF_SALESPERSON}:${PROFILE_FROM}`
OTHER_SUB_LIMIT_PROFILE_KEY = `${SELF_CUSTOMER}:${OTHER_SALESPERSON}:${PROFILE_FROM}`
```

选择语义不变：仍是按完整 Profile key 精确匹配，绝不回退为"第一条 SALESPERSON_SUB_LIMIT"，并对
两个 scope 各保留一条"必须存在"断言。collector 的 amount evidence 在 `adminAmounts`、`zero` 与
`historical` 三个投影上一律保留 `profileKey`。

**M9 — 稳定投影必须使用 §37.54.20.19.8 规定的完整维度集。** 实现的历史投影键补齐为：

```text
sourceOrderId | scopeType | stage | businessDate | stableProfileKey | proposedDeltaCents | decision
```

- `stableProfileKey` 取 `credit_profile` 的稳定业务键 `customer_id:salesperson_scope_key:effective_from`；
  per-engine 的 `credit_profile_id` 是 UUID，不能跨引擎识别，不得进入投影。
- `proposedDeltaCents` 由持久化 `recordedBreakdown` 的 `proposedTotalCents - exposureCents` 推导，
  不新增 API 字段、不改变 SC102 响应结构。
- 单引擎页间重叠仍直接比较真实 `checkResultId`；`Set` 只用于显式唯一性断言，不产出去重后的比较
  数据；输出条数必须等于输入条数。

**T5 — 冻结摘要必须对行尾稳定，历史链节点必须两两不同。** `core.autocrlf=true` 在 checkout 时把
工作树改写为 CRLF 而 Git 以 LF 存 blob，因此冻结摘要改为对 **LF 归一化**字节计算；该常量等于将要
提交的 blob 摘要，证据链可对仓库对象复核。历史链的六个节点（W11-SEC 的 credit-check / credit-policy、
U1 的 credit-check / credit-policy、V2 的 credit-check / credit-policy）断言两两不同，落实"历史证明
与新版证明不得混为同一个 SHA"。

**新增 T10 — M4 跨引擎修复的无 MySQL 可执行证明。** 同一 Writer 输出在 SQLite 为紧凑 JSON TEXT、在
MySQL native JSON 为带空格规范渲染。用例断言 V1 rule hash 与 V1 CSP1 **必须不同**（复现 M4 分叉），
V2 rule hash、CSP2 fingerprint 与 CCHK2 group identity **必须完全相同**。该用例在无 MySQL 连接的
条件下成立，真实 MySQL 逐值一致仍由 E3 rerun 给出。

**未决矛盾（未自行修改）。** ONE_TIME 特别审批在 replay 路径上可被重复"消费"：连续两次 exact replay
都返回 `PASS` 且 `consumedSpecialApprovalId` 相同，而 CONSUME 审计行数为 0。实测确认 legacy 路径与
当前路径行为完全一致，且 `findConsumableApproval()` 与 `if (!isReplay)` 审计守卫均未被本轮修改，
因此这是 Wave 10 既有行为而非本轮回归。§37.54.20.19.6 要求的是"继续遵守既有 one-time audit 规则"
与"ambiguous replay 在 approval lookup/consume 之前拒绝"，后者已实现并由零副作用用例证明；改变审批
消费/审计语义属新的业务规则，按 `AGENTS.md §4.4` 必须返回 Requirement/Design 层另行授权。

### 37.54.22 W11-A U2 ONE_TIME 特别审批消费与 Replay 语义更正 Design（2026-10-29）

#### 37.54.22.1 授权、证据基线与取代边界

授权：`W11_A_U2_ONE_TIME_REPLAY_CORRECTION_REQUIREMENT_DESIGN_ONLY`（AGENTS.md §4.3 DESIGN，并按 §4.0
连续阶段授权与 §4.2 Requirement 连续执行）。Requirement 侧见 `document.md`
`## W11-A U2 — ONE_TIME 特别审批消费与 Replay 语义更正 Requirement（2026-10-29）`。

本轮**仅** Requirement / Design：**未**进入 Implementation，**未**修改任何生产代码、测试、Schema、
Migration、Gate、Runner、Launcher、Preflight、`package.json`、`AGENTS.md` 或冻结历史记录；**未**执行
FAST / FULL / Heavy / Build / MySQL Gate；**未**连接任何数据库；**未**执行任何 Git 写操作。

基线：Branch `work/sales-waves6-13-recovery-20261025`；HEAD `d9e5d50a9103612a17070f806312b822281eb6c6`；
Version `1.6.2`；工作树保持未提交状态。

**取代与被取代关系（明确）**

| 对象 | 关系 |
|---|---|
| §37.54.20.21 末段登记的"未决矛盾（未自行修改）" | **被本节正式关闭**。该登记继续原样保留作为历史证据；本节不删除、不改写它 |
| §36.6.3 step 2「Replay returns the stored result」 | **保留并补充**。原句继续有效；本节补充"释放结论的读回语义"（§37.54.22.5） |
| §36.6.6 Special Approval 合同 | **保留并补充**。原 Scope / Ceiling / SOD / Expiry / Snapshot 绑定条款逐条不变；本节补充消费语义（§37.54.22.3 / §37.54.22.4） |
| §37.54.20.19.6 的「继续遵守既有 one-time audit 规则」 | **被本节重新定义**。既有 Wave 10 实现并不存在可被"遵守"的 one-time audit 规则（见 §37.54.22.2）；本节给出该规则的完整定义 |
| `document.md` R-HASH-05 `SPECIAL_APPROVAL_EXACT_BINDING_PRESERVED` | **不变**。CSP1 审批不释放 CCHK2 的规则不变 |
| W11-SEC-01 的 14 项冻结指纹、U1 的增量指纹 | **不变**，不得重算或覆盖 |

#### 37.54.22.2 根因：释放键与写审计键不是同一个键

现有实现在同一段代码里使用了**两个互不相干的键**：

```text
findConsumableApproval()   键 = 该审批是否已有 CONSUME 审计行   → 决定"这张审批还能不能用"
消费段 if (!isReplay)      键 = 该 Check Group 是否是 replay      → 决定"要不要写 CONSUME 审计行"
决定翻转 result.decision='PASS'                                  → 无论 isReplay 与否都会发生
```

当"该审批已有 CONSUME 审计行"为假且"该 Group 是 replay"为真时，两者同时成立，结果是：

```text
决定 = PASS，consumedSpecialApprovalId = <审批>，CONSUME 审计行数 = 0
```

即 **C-1 虚构消费**。因为"已消费"的唯一判据是那张不存在的审计行，该审批**永远**被判为未消费，
于是 **C-2 跨动作重复消费**随之成立。

**反向缺陷 C-3**：当首次消费落在**非 replay**（新建 Group）路径时，落盘 Result 行为 `PASS`；此后同一
Group 的合法幂等 replay 会重新执行"已消费"判定并把决定退回 `SPECIAL_APPROVAL_REQUIRED`（CCHK2 路径），
或在 CCHK1 路径因落盘决定 `PASS` 与重算的 `SPECIAL_APPROVAL_REQUIRED` 不等而直接 409
`CREDIT_CHECK_LEGACY_REPLAY_AMBIGUOUS`。**同一根因同时产生"放行两次"与"合法重放被拒"两个方向的错误。**

**附带缺陷 C-4**：`consumedSpecialApprovalId` 是 Scope 循环外的单一变量。当范围 A 被释放而范围 B 未被
释放时，B 的落盘明细会残留 A 的审批 ID，使"哪张审批释放了本范围"成为假命题。

**结论**：现有实现中不存在"one-time audit 规则"这一可被遵守的规则；它只有一个被 `isReplay` 错误
门控的副作用。因此本节不是"修改一条既有规则"，而是**首次定义**该规则并补齐其证据结构。

#### 37.54.22.3 消费身份模型

**消费身份 = `(approval_id, check_group_id, scope_type)`。**

该身份**不是新发明的**：既有 CONSUME 审计的 detail 已经持久化 `checkGroupId` 与 `scopeType`
（`credit-check.js` 消费段）。本节把这条既有的隐含身份**提升为显式的、被持久化且被唯一约束保护的
一等事实**。

**为什么不能用 Snapshot 或来源单据作为消费身份**

`findConsumableApproval()` 按 `(scope_type, source_credit_policy_snapshot_id,
source_policy_snapshot_fingerprint, source_sales_order_id)` 匹配。Snapshot 的身份是
`(credit_lock_anchor_id, business_date, snapshot_fingerprint)`，而 Check Group 的身份额外包含
`source_id`、`stage`、`authorization_context` 与 `exposure_digest`。因此**同一 Snapshot + 同一来源单据
可以对应多个不同的 Check Group**：

| 情形 | Check Group | Snapshot | 是否同一业务动作 |
|---|---|---|---|
| 同一订单、同一阶段、同一授权上下文、同一敞口 | 相同 | 相同 | 是（幂等重放） |
| 同一订单、同一阶段、**授权上下文不同**（不同操作者） | 不同 | 相同 | **否** |
| 同一订单、同一阶段、**敞口事实变化** | 不同 | 相同 | **否** |
| 两个不同出库单、同一客户、同一业务日、同一阶段规则 | 不同 | 相同 | **否** |
| 出库范围审批（`source_sales_order_id IS NULL`） | 任意 | 相同 | 任意出库单均可命中 |

最后一行是 C-2 的最强路径：`source_sales_order_id IS NULL` 时，`findConsumableApproval()` 的
`(source_sales_order_id IS NULL OR source_sales_order_id=?)` 对**任意**同范围同快照的检查都成立。
因此"不得因采用相同 Snapshot 或来源而绕过限制"必须由**消费身份**保证，而不能由查找谓词保证。

**Check Group 与业务动作的关系**：Check Group 身份已包含 `source_ref`、`stage` 与 `business_date`，
即它已经就是"某一个业务动作在某组事实下的一次信用评估"。因此
`(approval_id, check_group_id, scope_type)` 恰好表达了"这张审批被用在了哪一个业务动作的哪一个范围上"。
**事实变化导致的新 Check Group 视为新的业务动作**（与既有 §37.35.4 B-11「事实变化产生新决定而不是
重放陈旧结果」一致），已消费的 ONE_TIME 审批不得被它复用；需要继续放行时必须针对新的 Check Result
申请**新的**审批，原审批保持只读历史。

#### 37.54.22.4 消费证据的持久化结构

##### 37.54.22.4.1 选定的结构：新增消费账本表

```sql
CREATE TABLE IF NOT EXISTS credit_special_approval_consumption (
  id                TEXT NOT NULL PRIMARY KEY,
  approval_id       TEXT NOT NULL REFERENCES credit_special_approval(id),
  scope_mode        TEXT NOT NULL CHECK(scope_mode IN ('ONE_TIME','TIME_BOUNDED','OBJECT_BOUNDED')),
  consumption_key   TEXT NOT NULL,
  check_group_id    TEXT NOT NULL,
  scope_type        TEXT NOT NULL CHECK(scope_type IN ('CUSTOMER_AGGREGATE','SALESPERSON_SUB_LIMIT')),
  business_date     TEXT NOT NULL,
  consumed_at       TEXT NOT NULL,
  consumed_by       TEXT NULL REFERENCES users(id),
  audit_id          TEXT NULL,
  CONSTRAINT uq_credit_special_approval_consumption UNIQUE (approval_id, consumption_key),
  CONSTRAINT ck_credit_special_approval_consumption_one_time
    CHECK (scope_mode <> 'ONE_TIME' OR consumption_key = 'SINGLE')
);
CREATE INDEX IF NOT EXISTS ix_credit_special_approval_consumption_group
  ON credit_special_approval_consumption(check_group_id);
```

`consumption_key` 的派生规则（**由代码单一实现，不在 SQL 中拼接**，以保证 SQLite 与 MySQL 一致）：

| scope_mode | consumption_key | 唯一约束的效果 |
|---|---|---|
| `ONE_TIME` | 字面量 `'SINGLE'` | `(approval_id,'SINGLE')` 全局唯一 ⇒ **一张 ONE_TIME 审批至多一条消费记录** |
| `TIME_BOUNDED` / `OBJECT_BOUNDED` | `` `${check_group_id}#${scope_type}` `` | 每个 `(审批, 业务动作, 范围)` 至多一条；同一审批可被不同动作重复消费 |

**为什么用 `consumption_key` 而不是一个可空的 `one_time_key` 列**：可空列方案依赖"两引擎的 UNIQUE 索引
都把多个 NULL 视为互不相同"这一行为。该行为在本轮**无法在真实 MySQL 上验证**（本轮不连接 MySQL），
因此设计**不依赖任何未验证的引擎行为**。`consumption_key` 方案只依赖"NOT NULL 列上的普通 UNIQUE"，
这是两引擎共同支持的最基本约束。

**为什么是新增表而不是给 `credit_special_approval` 加列**

| 维度 | 新增账本表（选定） | `credit_special_approval` 加列 |
|---|---|---|
| 旧审批行 | **完全不动**，零迁移 | 需 `ALTER TABLE`，且旧审批的消费状态要么迁移、要么运行时另找来源 |
| 可重复消费模式 | 天然支持多次消费（每动作一条） | 单行只能存一次，与 TIME_BOUNDED / OBJECT_BOUNDED 语义冲突 |
| 唯一性约束 | 库层直接判定"至多一次" | 只能靠条件 UPDATE 的影响行数，语义较弱 |
| 追加性 | 纯追加，不可改写 | 原地更新既有行，与"历史证据只能追加"相悖 |
| 第二套权威风险 | 无——单表单读路径 | 列 + 审计两处状态，需额外对账 |

选定新增表的核心理由：**它使"不迁移旧 Approval"在构造上成立**——旧审批行一个字节都不改，旧消费由其
既有不可变 CONSUME 审计证据证明（§37.54.22.6.2）。

##### 37.54.22.4.2 迁移合同

- 新文件 `server/migrations/sales-customer-wave11-a-credit-consumption.js`，形态对齐
  `server/migrations/sales-customer-wave10-credit-check.js`：SQLite 与 MySQL 两套 DDL、导出的表名与
  约束名清单、以及 MySQL 列类型清单。
- 在 `server/migrations/sales-customer-domain.js` 的迁移清单中以
  `Object.freeze({ id: 'wave-11-a-credit-consumption', wave: 11, migrate: ... })` 登记。
- **纯 additive**：`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`。**无** backfill、
  **无** `UPDATE`、**无** `DROP`、**无** 历史行改写。既有 `credit_check_results`、
  `credit_special_approval`、`credit_policy_snapshots`、`audit_logs` 的 DDL 一律不动。
- 迁移是**幂等**的：重复执行不产生第二次效果。
- 迁移**不得**在启动路径上被无条件执行到生产既有库而跳过对账：MySQL 侧沿用 Wave 10 的既有做法
  （bootstrap 走 SQLite 规范快照，live upgrade 走本迁移的 MySQL DDL）。

##### 37.54.22.4.3 消费账本与既有审计的关系

- **CONSUME 审计**保留并继续写入：它是面向人的审计证据（P5），也是 SC102 之外的独立可核验渠道。
- **消费账本**是机器可判定的权威：它持有唯一约束，使"至多一次"在库层可判定。
- 二者在**同一事务**内一并写入，因此不可能互相矛盾。
- `credit_special_approval_consumption.audit_id` 指向该次消费写入的 CONSUME 审计行 ID，形成双向可追。

##### 37.54.22.4.4 历史 CONSUME 审计的读取（不迁移、不猜测）

账本表在更正生效时为空。更正生效**之前**已发生的消费只存在于 CONSUME 审计行中。因此消费状态读取
必须是**两个来源的并集**，且必须由**同一个函数**产出：

```text
readApprovalConsumptionState(db, approvalId) ->
  { consumed: bool, checkGroupId: string|null, scopeType: string|null, source: 'LEDGER'|'LEGACY_AUDIT'|'UNKNOWN' }
```

- **账本优先**：若账本存在该审批的记录，以账本为准（`check_group_id` 与 `scope_type` 是列，不是 JSON）。
- **历史审计回退**：账本无记录时，读取该审批的既有 CONSUME 审计行，**解析**其 `detail` JSON，取
  `checkGroupId` 与 `scopeType`。
- **跨引擎解析纪律**：`audit_logs.detail` 在 SQLite 是 TEXT、在 MySQL 是 native JSON，两者**渲染不同**
  （这正是 M4 的根因）。因此**必须 `JSON.parse` 后取字段**，**禁止**对 detail 做字符串比较或前缀比较。
- **fail closed**：若历史 CONSUME 审计行存在但 `detail` 不可解析、或缺少 `checkGroupId` / `scopeType`，
  则返回 `{ consumed: true, checkGroupId: null, scopeType: null, source: 'UNKNOWN' }`。
  该状态**不等于**任何当前 `(check_group_id, scope_type)`，因此落入 `CONSUMED_BY_OTHER_ACTION`，
  拒绝释放。**不得猜测**其归属（R-ONE-04-e）。
- **不写回**：历史消费**不得**被回填进账本（那是"迁移旧审批"的变体）。账本只记录更正生效后的消费。

#### 37.54.22.5 决策算法

##### 37.54.22.5.1 作用域内的求值顺序（不变的部分）

`evaluateCredit()` 的既有顺序**全部保留**：step 1 开关 → step 3 规则与范围 → L1 Finance 父锁 → L2
POLICY_SCOPE 锚点 → L3/L4 CREDIT_OBJECT 锚点 → L5 档案行 → step 6 敞口与评估 → step 7 规则行
`FOR UPDATE` → step 2 检查组身份解析 → Scope 循环 → 写 Result 行 → 写 EVALUATE 审计。

**不改变**：决策规则、金额口径、reason code 的既有构成（除新增一个拒绝用 reason code）、快照与检查组
身份公式、锁序、事务归属。

##### 37.54.22.5.2 消费判定表（每个 `releasable` 范围）

判定输入：`approval`（候选审批）、`state`（该审批的消费状态）、`checkGroupId`（当前检查组）、
`scopeType`（当前范围）、`consumeApprovals`（调用方是否请求消费）。

| # | `state.consumed` | `state` 与当前动作匹配 | scope_mode | 结论 | 释放？ | 写入 |
|---|---|---|---|---|---|---|
| 1 | 否 | — | 任意 | `RELEASED_FIRST_CONSUMPTION` | 是 | **账本 1 行 + CONSUME 审计 1 行** |
| 2 | 是 | 是（同一 `check_group_id` + `scope_type`） | 任意 | `RELEASED_REPLAY` | 是 | **无** |
| 3 | 是 | 否 | `ONE_TIME` | `REFUSED_ALREADY_CONSUMED` | **否** | **无** |
| 4 | 是 | 否 | `TIME_BOUNDED` / `OBJECT_BOUNDED` | `RELEASED_FIRST_CONSUMPTION` | 是 | **账本 1 行 + CONSUME 审计 1 行** |

第 4 行说明：可重复消费模式的既有语义（可在有效期内 / 对象内重复使用）**不变**；变的只是它的每一次
消费现在都可被证明，且同一动作的重放不再重复计入。

第 3 行：被别的业务动作消费过的 ONE_TIME 审批**不得**释放。Scope 决定维持
`SPECIAL_APPROVAL_REQUIRED`，并追加 reason code `SPECIAL_APPROVAL_ALREADY_CONSUMED`。
对外仍是既有的 409 `CREDIT_SPECIAL_APPROVAL_REQUIRED`（**不新增 HTTP 错误码**，以免破坏既有错误合同），
差异由 reason code 显式表达。

##### 37.54.22.5.3 候选审批的选取（查找谓词不变，判定外移）

`findConsumableApproval()` 的**匹配谓词逐字不变**（scope_type / snapshot id / snapshot fingerprint /
source sales order / 已批准 / 未过期 / `ORDER BY decided_at, id`）。改变的只有一件事：

- **删除**该函数内部的"已消费即跳过"分支；
- 消费判定**外移**到 §37.54.22.5.2 的判定表；
- 候选循环遇到"第 3 行"情形的 ONE_TIME 审批时**继续**尝试下一个候选（保持既有"跳过已消费项后取下一个"
  的行为），但必须把"存在一张被别的动作消费掉的匹配审批"这一事实带回调用方，用于产生
  `SPECIAL_APPROVAL_ALREADY_CONSUMED` reason code。

##### 37.54.22.5.4 释放后的 Scope 结论与响应

- 释放后的决定：`PASS`。
- 释放后的 reason codes：`preRelease.reasonCodes` 去掉 `OVER_LIMIT` 与 `SPECIAL_APPROVAL_REQUIRED`，
  再追加 `SPECIAL_APPROVAL_CONSUMED`。该结果**在首次消费与合法重放之间完全一致**（幂等结论一致性）。
- `consumedSpecialApprovalId`：**当且仅当**当前 `(check_group_id, scope_type)` 存在消费记录时非空
  （第 1 行与第 2 行）。因此"返回了审批 ID 却没有任何消费记录"这一 C-1 现象不再可能；
  "已有消费记录却不返回审批 ID"也不可能（R-ONE-02-d）。
- `replayed` 语义不变（描述检查组是否 replay），与消费是否在本次调用发生**正交**。
- `approvalAvailable`：**当且仅当**存在一张匹配审批、其释放条件成立、且它不是"被别的动作消费掉的
  ONE_TIME"。只读路径（`consumeApprovals=false`）下同样按此口径给出。

##### 37.54.22.5.5 首次消费与业务动作的原子提交

- 账本行与 CONSUME 审计在**调用方事务内**写入，紧随释放决定。
- 调用方事务由三个生产调用方持有：`server/modules/sales-orders.js` 的 SO_SUBMIT 路径、SO_APPROVE 路径，
  以及 `server/app.js` 的 SALES_DELIVERY_CONFIRM 路径；三者均在 `transaction(db, ...)` 内调用
  `assertCreditAllowsBusinessAction`。因此"业务动作失败 ⇒ 消费证据一并回滚"由既有事务归属合同保证，
  **无需新增事务边界**。
- 拒绝路径（`CREDIT_SPECIAL_APPROVAL_REQUIRED` / `CREDIT_CHECK_BLOCKED` / 409 身份不可重放）
  **零写入**：账本、CONSUME 审计、Result 行、审批行均不变。

##### 37.54.22.5.6 C-4 修正：明细按 Scope 归位

`consumedSpecialApprovalId` 必须**每个 Scope 各自持有**：在某 Scope 的循环内先清零，只有该 Scope 真正
被释放时才赋值。未被释放的 Scope 行，其 `component_breakdown_json.consumedSpecialApprovalId` 必须为
`null`，不得残留其它 Scope 的审批 ID。

##### 37.54.22.5.7 C-3 修正：重放比对接受"落盘为释放后结论"

CCHK1 路径的 `legacyGroupMatchesCurrent(..., requireDecision: true)` 会比较落盘决定与重算的**释放前**
决定。当该 Group 是在消费发生时创建的（落盘决定为 `PASS`、reason codes 为
`['SPECIAL_APPROVAL_CONSUMED']`、明细含 `consumedSpecialApprovalId`）时，比较必然失败并抛 409。

修正方式（**不推迟比较、不改变比较位置**）：落盘行**自身携带的释放标记**即构成"落盘结论 = 释放后结论"
的证明。判定式：

```text
storedDecisionMatches :=
    stored.decision === preRelease.decision
 OR (stored.decision === 'PASS'
     AND preRelease.decision === 'SPECIAL_APPROVAL_REQUIRED'
     AND storedRowProvesRelease(stored))

storedRowProvesRelease(row) :=
    row.reason_codes_json 含 'SPECIAL_APPROVAL_CONSUMED'
 AND row.component_breakdown_json.consumedSpecialApprovalId 是非空字符串

storedReasonCodesMatch :=
    canonical(stored.reasonCodes) === canonical(preRelease.reasonCodes)
 OR (storedRowProvesRelease(stored)
     AND canonical(stored.reasonCodes) === canonical(postRelease.reasonCodes))
```

`postRelease.reasonCodes` 是 `preRelease.reasonCodes` 的**纯函数**（§37.54.22.5.4 的过滤 + 追加），
因此不需要把比较推迟到 Scope 循环之后，也不需要在循环中缓冲写入。**身份/事实比对**
（source、stage、businessDate、recognitionMode、proposed delta、breakdown、Profile/Anchor、Snapshot FK
与三 Hash）**逐条不变**，仍然先于任何写入执行并仍然在失败时以 409 零写入结束。

##### 37.54.22.5.8 只读路径（`consumeApprovals=false`）

`POST /api/credit/check` 的只读评估路径**不消费**、**不写账本**、**不写 CONSUME 审计**、**不锁审批行**。
它按 §37.54.22.5.4 的口径报告 `approvalAvailable`，但**不翻转决定**（维持
`SPECIAL_APPROVAL_REQUIRED`），与既有行为一致。该路径同样**不得**产生任何消费副作用。

#### 37.54.22.6 历史兼容

##### 37.54.22.6.1 V1 / V2 身份隔离

- 审批查找仍要求 **snapshot id + fingerprint 精确相等**，因此 **CSP1 审批永不释放 CCHK2 决定**，
  **CSP2 审批只绑定 CSP2**。该规则由 §37.54.20.19.6 与 `document.md` R-HASH-05 固定，本节不放松。
- 账本记录 `check_group_id`（自带 `CCHK1:` / `CCHK2:` 前缀），因此消费证据天然可按版本区分，
  且不需要新增任何版本字段。
- CCHK1 exact replay 继续使用其原 Check Result 的 CSP1 快照与既有 expiry / scope mode / source order /
  authority ceiling / SOD 规则；本节只改变**消费证据的写入与读回**，不改变 V1 的身份选择。

##### 37.54.22.6.2 旧审批、旧快照、旧 Result 一律不动

| 对象 | 更正后的处置 |
|---|---|
| 旧 `credit_special_approval` 行 | **不改、不迁、不复制、不追加列**。其历史消费由既有 CONSUME 审计证明 |
| 旧 `credit_check_results` 行 | **不改**。落盘决定仍可能是 `SPECIAL_APPROVAL_REQUIRED`（释放发生在其后），释放事实由账本 + CONSUME 审计证明 |
| 旧 `credit_policy_snapshots` 行 | **不改**。CSP1 与 CSP2 并存继续有效 |
| 旧 `audit_logs` 行 | **不改、不删**。仅被读取（`JSON.parse` 后取 `checkGroupId` / `scopeType`） |
| CCHK1 / CSP1 身份 | **不重写** |
| 新账本行 | **纯追加**，不可原位改写 |

**重要且明确的取舍**：当释放发生在一个已存在的 Check Group 上时，其 Result 行**保持** `SPECIAL_APPROVAL_REQUIRED`。
这是"不重写旧 Check Result"的直接推论，也是 §36.6.3 step 2「Replay returns the stored result」在释放语义
下的正确解释——**检查组的行记录的是该组被评估时的结论，释放事实记录在消费账本与 CONSUME 审计中**。
读者通过"该 Result 绑定的审批 + 该审批的消费记录 + CONSUME 审计"三者即可复原完整事实链。
由此产生一项**已知的后续项**（本轮不实施）：SC102 未来可选择暴露"该例外是否已被审批释放"，但本轮
**不改** SC101/SC102 的响应结构。

##### 37.54.22.6.3 SC101 / SC102 不回归

- `server/modules/credit-query.js` **零改动**。它只读 `credit_check_results` 与
  `credit_special_approval`，账本表不参与其查询，因此其可见性谓词、分页、身份版本校验
  （`/^CCHK[12]:[0-9a-f]{64}$/`、`/^CSP[12]:[0-9a-f]{64}$/`）与零写入 GET 合同全部原样保持。
- 唯一需要复核的是 C-4 修正对 `recordedBreakdown.consumedSpecialApprovalId` 的影响：修正后未释放的
  Scope 行该字段为 `null`，这**更**符合 SC102 的"不复制商业金额、只呈现已持久化事实"合同。
- W11-SEC-01 的 14 项冻结指纹、U1 的增量指纹与 §37.54.15.9.4 的有界例外治理**不受本节影响**。

#### 37.54.22.7 事务归属、锁序与并发

##### 37.54.22.7.1 事务归属

`evaluateCredit()` 既有合同"调用方必须已拥有事务"**不变**（`db.isTransaction` 断言保留）。三个生产调用方
（`sales-orders.js` SO_SUBMIT、`sales-orders.js` SO_APPROVE、`app.js` SALES_DELIVERY_CONFIRM）均已在
`transaction(db, ...)` 内调用，**前置条件已被全部生产调用方满足**。本节**不新增**事务边界。

##### 37.54.22.7.2 锁序：新增一类锁，且严格排在既有位置之后

| 层 | 锁对象 | 既有/新增 | 相对位置 |
|---|---|---|---|
| L1 | Finance PREPAYMENT 父余额 `FOR UPDATE` | 既有 | **始终第一**（Finance → Credit 合同不变） |
| L2 | POLICY_SCOPE 锚点 `FOR SHARE` | 既有 | 不变 |
| L3/L4 | CREDIT_OBJECT 锚点 | 既有 | 不变（aggregate 先于 salesperson） |
| L5 | `credit_profile` 行 `FOR UPDATE` | 既有 | 不变 |
| L6 | `credit_check_rules` 行 `FOR UPDATE` | 既有 | 不变 |
| **L7** | **`credit_special_approval` 候选行 `FOR UPDATE`（按 `decided_at, id` 升序）** | **新增** | **在 L6 之后、调用方的 L8 业务行之前** |
| L8 | 调用方业务行（如 `sales_orders`） | 既有（调用方所有） | 不变，仍为最后 |

- L7 位于 L6 之后，符合 §29.44 锁矩阵既有"approval FOR UPDATE → snapshot FOR UPDATE → SO FOR UPDATE"
  的相对次序。
- **不得**在消费路径上新增对 `credit_check_results` 的行锁：§37.54.20.20 已确立"未新增抢先 Result lock"，
  本节保持该结论。审批申请路径锁 Result 行、审批决策路径只锁审批行，二者都不进入 Credit 锁链，
  因此不与 L7 形成等待环。
- 候选审批**按 `decided_at, id` 升序一次性加锁**（MySQL：`ORDER BY decided_at, id FOR UPDATE`；
  SQLite：无锁后缀，写事务本身已串行化），因此所有事务的加锁顺序一致，无死锁面。

##### 37.54.22.7.3 并发单次消费：三层保证

**第一层（结构性证据）**：本仓库的 MySQL 事务在 `transaction()` 起始处即取全局事务闸门
`SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE`，并持有至 COMMIT/ROLLBACK；
SQLite 使用 `BEGIN IMMEDIATE`（写事务串行化）。因此**在当前部署形态下，两个事务不会交错执行**
消费读—写序列。

**第二层（局部不变量）**：本设计**不依赖**上述全局串行化。局部保证由两项构成：

1. **L7 审批行 `FOR UPDATE`**：所有对同一审批的消费尝试被串行化。
2. **账本 UNIQUE 约束 `UNIQUE (approval_id, consumption_key)`**：即使串行化被移除（例如未来放宽事务闸门、
   换用真正并发的后端、或把信用检查移入并行路径），库层约束仍然判定"至多一次"。

**第三层（可见性）**：消费结论的读回必须能看见并发事务已提交的写入。MySQL 默认 REPEATABLE READ 下，
**普通 `SELECT` 读的是事务快照，可能看不见并发已提交的消费行**。因此：

- 账本读取必须是**当前读**（MySQL 用 `FOR UPDATE` 的锁定读），不是普通一致性读；
- 审批行本身通过 L7 的 `FOR UPDATE` 读取，其 `consumed` 状态同样来自当前读；
- 历史 CONSUME 审计的读取只用于识别**更正生效之前**的历史消费，该状态是静止的，不存在并发写入窗口；
  即使它读不到某个并发新写入的 CONSUME 行，对应的新消费**必然同时写入了账本行**，而账本读取是当前读，
  因此结论仍然正确。

**第四层（冲突表达）**：若竞态仍然穿透（唯一约束被触发），必须以**显式冲突**结束：捕获唯一约束冲突并
翻译为既有的 `translateConstraintError` 模式（例如 `CREDIT_SPECIAL_APPROVAL_ALREADY_CONSUMED`，409），
事务整体回滚，失败方**零写入**。**不得**出现两个赢家，**不得**静默成功。

##### 37.54.22.7.4 锁序不变性核对

本节**不改变**以下既有结论：Finance PREPAYMENT 父锁仍是 Credit Check 自取的第一把锁；Policy Scope 锚点
仍在 Finance 之后；Anchor 供给仍在调用方事务内、失败时随事务回滚；Wave 10 的 L1–L8 入口矩阵不变。

#### 37.54.22.8 替代方案比较与选定

| 方案 | 描述 | 结论 | 理由 |
|---|---|---|---|
| **A** | **仅用现有 audit_logs**：把"已消费"继续建立在 CONSUME 审计行上，只把 `if (!isReplay)` 改成"若该审批尚未被消费则写" | **否决** | 库层无 `(entity_type, entity_id, action)` 唯一约束，"至多一次"只能靠先查后写；在 MySQL REPEATABLE READ 下普通读可能看不见并发提交的行，双消费**不可证明**；R-ONE-01-b / R-ONE-05-c 不满足 |
| **B** | **给 `credit_special_approval` 加消费状态列** | **否决** | 需 `ALTER TABLE`；单行无法承载可重复消费模式的多次消费；只存"第一次消费"与只读路径的历史回退形成两套状态；与"历史证据只能追加"相悖 |
| **C** | **新增消费账本表 + UNIQUE 约束 + 审批行串行化 + 历史审计回退** | **选定** | 唯一性在库层可判定；旧审批零改动（不迁移）；纯追加；单表单读路径，无第二套权威；支持三种 scope_mode；与 Wave 10 决策、权限、金额、Finance 锁序全部无关且不变 |
| **D** | **replay 一律不得消费**（发现已消费即直接拒绝） | **否决** | 审批获批后的**首次**业务动作经常落在既有检查组上（因为审批必须绑定一个已存在的 Result）；方案 D 会使"审批获批后仍无法下单"，直接破坏业务可用性 |
| **E** | **把审批消费状态编进 Check Group 身份** | **否决** | 会改写 V1 的身份公式，违反 CCHK1 历史不可变与 V1/V2 身份隔离；并使"消费"反过来决定"检查组身份"，形成循环依赖 |
| **F** | **把 ONE_TIME 语义改为"同一 Check Group 内一次性"** | **否决** | 不能阻止跨动作复用（C-2）；把审批的有效性绑定到评估身份，而不是绑定到"这张审批只能用一次"这一业务承诺 |

**选定方案 C**，且 C 与既有合同的相容性已逐条核对：Wave 10 决策规则不变、权限模型不变、金额口径不变、
Finance → Credit 锁序不变、V1/V2 身份隔离不变、历史不可变不变、SC101/SC102 不变。

#### 37.54.22.9 精确 Implementation 文件白名单（未来轮次，需独立授权）

**本节是授权申请，不是授权本身。** 实施前必须获得对下列文件的**精确**授权，并按 §37.54.15.9.4 的
有界例外治理登记新的例外身份（建议：`W11_A_ONE_TIME_REPLAY_CORRECTION_BOUNDED_AMENDMENT`），
因为 `server/modules/credit-check.js` 属 W11-SEC-01 冻结载荷（其 U1 增量指纹为 `3bf4eb51…72f0` 基线上的
追加导出），既有例外只授权"追加两个具名导出"，**不覆盖**本节所述的行为性修改。

| # | 文件 | 允许的修改 | 性质 |
|---|---|---|---|
| 1 | `server/modules/credit-check.js` | 仅限：消费判定函数、候选审批选取的判定外移、账本读写、`consumedSpecialApprovalId` 按 Scope 归位、replay 比对的释放标记放宽。**不得**触碰：敞口计算、决策规则、锁序、身份公式、快照写入、SC101/SC102 查询 | **冻结载荷 · 行为性修改 · 需新例外** |
| 2 | `server/migrations/sales-customer-wave11-a-credit-consumption.js`（**新建**） | 仅限新增 `credit_special_approval_consumption` 表与其索引、导出表名/约束名/列类型清单 | 新增 additive 迁移 |
| 3 | `server/migrations/sales-customer-domain.js` | **仅**追加一条迁移登记项 | 迁移登记 |
| 4 | `server/sales-customer-wave10-credit-check.test.js` | **仅追加**新用例；**不得**修改、删除或弱化任何既有断言（含 "V2 approval isolation" 用例） | 既有 Golden 追加 |
| 5 | `server/sales-customer-wave11-a-credit-query.test.js` | **仅追加**回归用例，证明 SC101/SC102 不回归 | 回归追加 |
| 6 | `server/mysql-sales-customer-wave11-a-credit-query.integration.js` | **仅追加**E3 并发与一次性消费用例 | E3 追加 |
| 7 | `scripts/gates/mysql-sales-wave11-a-gate.mjs` | **仅追加**E3 用例登记 | Gate 追加 |
| 8 | `scripts/testing/test-suites.js` | **仅追加**登记项；不得改动既有登记 | 测试登记 |
| 9 | `server/modules/credit-query.js` | **零改动** | — |
| 10 | `server/modules/credit-special-approval.js` | **零改动** | — |
| 11 | `server/modules/credit-policy.js`、`credit-scope.js`、`credit-anchor.js`、`credit-profile.js`、`credit-rule-payload.js` | **零改动** | — |

**必须记录**：文件 1 修改前 / 修改后的 SHA-256；两者差异**仅为**上表允许的范围（逐行可核对）；
文件 2 / 3 为纯新增；W11-SEC-01 原 14 项冻结指纹**原样保留**，不得被重算、覆盖或作废；不得据此
执行任何 W11-SEC Re-Freeze。

**明确禁止**：修改 `package.json` 的 `version`；改动 `AGENTS.md`；改动任何冻结历史记录；改动 Wave 10
既有迁移文件；扩大本白名单到任何未列出的文件。

#### 37.54.22.10 测试合同

##### 37.54.22.10.1 必须覆盖的用例（对应 `document.md` R-ONE-07）

| # | 用例 | 期望 | 证据级别 |
|---|---|---|---|
| T-01 | ONE_TIME 首次合法消费（新建 Group） | 决定 `PASS`；账本 1 行；CONSUME 审计 1 行；`consumedSpecialApprovalId` 非空 | SQLite E2 |
| T-02 | 同一动作合法幂等 Replay | 决定 `PASS`；`consumedSpecialApprovalId` 与 T-01 相同；账本仍 1 行；CONSUME 审计仍 1 行 | SQLite E2 |
| T-03 | 连续两次 Replay | 不得虚构第二次消费；账本 1 行；CONSUME 审计 1 行 | SQLite E2 |
| T-04 | 不同动作复用同一 ONE_TIME | 决定维持 `SPECIAL_APPROVAL_REQUIRED`；reason code 含 `SPECIAL_APPROVAL_ALREADY_CONSUMED`；账本仍 1 行；CONSUME 审计仍 1 行；零写入 | SQLite E2 |
| T-05 | 未消费 vs 已消费严格区分 | 未消费者可被首次消费；已被他动作消费者不可被释放 | SQLite E2 |
| T-06 | 原历史 Result 不变 | 消费前后既有 `credit_check_results` 行**逐字段**不变 | SQLite E2 |
| T-07 | 首次消费与业务动作原子提交 | 业务动作回滚后账本 0 行、CONSUME 审计 0 行 | SQLite E2 |
| T-08 | 事务失败零消费审计 | 消费写入后强制抛错，整体回滚，零痕迹 | SQLite E2 |
| T-09 | 释放与消费在 CCHK2 路径同样成立 | T-01..T-03 在 V2 路径重做一遍 | SQLite E2 |
| T-10 | V1 Approval 不得释放 CCHK2；CSP2 Approval 必须绑定 CSP2 | 既有断言保持 + 明确用例 | SQLite E2 |
| T-11 | C-3 修正：落盘为释放后结论的 Group 可被重放 | 重放返回 `PASS` 与同一审批 ID，不再 409 | SQLite E2 |
| T-12 | C-4 修正：未释放 Scope 的明细不含他人审批 ID | `consumedSpecialApprovalId` 为 `null` | SQLite E2 |
| T-13 | 历史 CONSUME 审计回退 | 预置一条历史 CONSUME 审计（无账本行）→ 视为已消费；释放被拒 | SQLite E2 |
| T-14 | 历史 CONSUME 审计明细不可解析 | fail closed：视为已被未知动作消费，拒绝释放 | SQLite E2 |
| T-15 | 库层唯一约束直接生效 | 同一 `(approval_id,'SINGLE')` 第二次插入被库拒绝 | SQLite E2（**方言中立断言**） |
| T-16 | SC101/SC102 不回归 | 零写入 GET；内容与跨引擎等价 | SQLite E2 |
| T-17 | 真实 MySQL 一次性消费并发 | 两个独立竞争者只产生一次消费；失败方零写入；显式冲突 | **真实 MySQL E3** |
| T-18 | 真实 MySQL T-15 的方言复核 | 唯一约束在 MySQL 上同样拒绝第二次写入 | **真实 MySQL E3** |

T-15 与 T-18 成对存在的原因：本设计刻意**不依赖**"两引擎对 NULL 的 UNIQUE 处理"这一未在本轮验证的
行为；T-18 是对真实引擎行为的直接取证。

##### 37.54.22.10.2 不得弱化的既有回归

既有 V1/V2 Golden、M2 / M4 / M9、U1（含 T5 冻结摘要断言）、W11-SEC-01 14 项冻结指纹、W10-R1..R12、
M-BIZ-01..M-BIZ-0x、GATE-B M-B01..M-B07、并发集成用例、以及 `scripts/testing/test-suites.js` 的既有登记，
**一律不得删除、不得 skip、不得降级分类、不得修改断言以迁就新实现**。

其中既有断言 `"V2 approval isolation — CSP1 approval releases only exact V1 replay and never a changed
CCHK2"` 在新语义下**仍然成立**（exact V1 replay 仍返回 `PASS` 与同一 `consumedSpecialApprovalId`，
changed CCHK2 仍返回 `SPECIAL_APPROVAL_REQUIRED`），因此该 Golden **不需要修改**——本设计刻意选择
"重放返回与首次消费一致的结论"，正是为了不破坏它。区别只在于：现在该重放**同时**留下了一条消费记录
与一条 CONSUME 审计，而旧实现一条都不留。

##### 37.54.22.10.3 SQLite / MySQL 验收矩阵

| 维度 | SQLite | MySQL 8 | 一致性要求 |
|---|---|---|---|
| 消费三态判定 | T-01..T-14 | T-17 对应用例 | 逐值相同 |
| 账本唯一约束 | T-15 | T-18 | 同为"拒绝第二次写入"，**不比较错误文案** |
| 审批行串行化 | 写事务天然串行（`BEGIN IMMEDIATE`） | `FOR UPDATE` + 全局事务闸门 | 判定结果相同 |
| 消费记录内容 | 列值 | 列值 | 逐列相同（`check_group_id`、`scope_type`、`approval_id`） |
| 历史审计回退解析 | `JSON.parse` | `JSON.parse`（native JSON 渲染不同但解析结果相同） | 解析后字段相同 |
| 拒绝路径写入量 | 0 | 0 | 相同 |
| 并发结果 | 不适用（单写者） | 恰好一个赢家 | — |

#### 37.54.22.11 回滚、冻结边界与剩余风险

**回滚**：本更正的持久化结构是**纯新增表**，不含任何对既有表的 ALTER。回滚时只需停止使用该表即可，
既有数据不受影响；不得在回滚路径上 `DROP` 既有表或删除既有审计行。若实施后发现必须回滚**代码**，
新增的表可以保留为空而不产生任何业务影响（无消费者）。

**冻结边界**：本节**不**签发 U2 Acceptance，**不**冻结任何 Capability，**不**启动 U3，**不**构成
W11-SEC-01 的 Re-Freeze。

**剩余风险与阻塞**

| # | 风险 | 处置 |
|---|---|---|
| L-1 | `server/modules/credit-check.js` 是 W11-SEC-01 冻结载荷，其行为性修改超出 §37.54.15.9.4 既有例外 | **阻塞项**：实施前必须取得新的有界例外授权并登记修改前后 SHA-256 |
| L-2 | 真实 MySQL 上的行为（唯一约束、`FOR UPDATE` 当前读、全局事务闸门下的并发结果）本轮**未取证** | 由 T-17 / T-18 在获授权的 E3 轮取证；在此之前不得签发 U2 Acceptance |
| L-3 | 账本为空的过渡期：更正生效后、首次消费发生前，旧审批的历史消费靠 CONSUME 审计回退识别 | 已由 §37.54.22.4.4 覆盖并有 T-13 / T-14 取证 |
| L-4 | SC102 目前不暴露"该例外是否已被审批释放"，读者需自行关联审批与账本 | 本轮**不改** SC102 响应结构；登记为后续开放项 |
| L-5 | TIME_BOUNDED / OBJECT_BOUNDED 的多次消费现在会产生多条账本行，其"对象边界"语义在出库范围（`source_sales_order_id IS NULL`）下依然较宽 | 本轮**不改**其既有语义；登记为后续开放项 |
| L-6 | `credit_check_results` 无 `special_approval_id` 列，释放关联仍只存在于 `component_breakdown_json` | 与 §29.25.1 A-54 的设计描述存在实现差异；本轮**不**改表结构，登记为后续开放项 |
| L-7 | 本轮未做任何 Git 写操作，工作树保持未提交 | 由用户决定提交时机与内容 |

#### 37.54.22.12 Design 状态

**Status: `W11_A_U2_ONE_TIME_REPLAY_CORRECTION_DESIGN_READY`.**

设计在现有业务合同下**闭合**：Wave 10 的决策、权限、金额与 Finance 锁序全部保持不变；V1/V2 身份隔离
保持不变；历史不可变保持不变；SC101/SC102 保持不变。选定方案以**新增纯附加消费账本 + 审批行串行化 +
历史 CONSUME 审计回退**实现"ONE_TIME 至多消费一次"，并以 `(approval_id, check_group_id, scope_type)`
把"首次消费"与"合法幂等重放"区分开。

- `ONE_TIME_CONSUMPTION_IDENTITY_APPROVAL_GROUP_SCOPE`;
- `CONSUMPTION_LEDGER_ADDITIVE_ONLY`;
- `FIRST_CONSUMPTION_WRITES_EVIDENCE_REPLAY_DOES_NOT`;
- `CROSS_ACTION_REUSE_REFUSED_FAIL_CLOSED`;
- `LEGACY_CONSUME_AUDIT_FALLBACK_NO_MIGRATION`;
- `HISTORY_IMMUTABLE_NO_APPROVAL_MIGRATION_NO_RESULT_REWRITE`;
- `FINANCE_CREDIT_LOCK_ORDER_UNCHANGED`;
- `CONCURRENCY_SINGLE_CONSUMPTION_DB_CONSTRAINT_BACKSTOP`;
- `WAVE10_DECISION_PERMISSION_AMOUNT_CONTRACTS_UNCHANGED`;
- `DESIGN_COMPLETE_HARD_STOP_NO_IMPLEMENTATION_NO_MYSQL_NO_GIT_NO_ACCEPTANCE_NO_U3`.

**HARD STOP**：本节完成后停止，等待用户对 Design 的明确确认。在获得确认前**不得**实施、**不得**连接
MySQL、**不得**执行任何 Git 写操作、**不得**签发 U2 Acceptance、**不得**启动 U3。

#### 37.54.22.13 Implementation Evidence（2026-10-29）

##### 37.54.22.13.1 授权、Amendment Identity 与基线

授权：`W11_A_U2_ONE_TIME_REPLAY_CORRECTION_REQUIREMENT_DESIGN_ONLY` 之后的
**W11-A U2 — ONE_TIME Special Approval Consumption Bounded Implementation**（用户本轮正式授权）。
本节记录**实际实施结果**。本轮**未**连接 MySQL、**未**执行任何 Git 写操作、**未**签发 U2
Acceptance / Freeze、**未**启动 U3。

基线：Branch `work/sales-waves6-13-recovery-20261025`；HEAD `d9e5d50a9103612a17070f806312b822281eb6c6`；
Version `1.6.2`；工作树保持未提交状态。

**新的 Amendment Identity**：`W11_A_ONE_TIME_REPLAY_CORRECTION_BOUNDED_AMENDMENT`。它**不重定义**
W11-SEC-01 的冻结基线，也**不**追溯覆盖 U1 与 V2 的证据链；它只声明本轮获批的那几处变更，并按
§37.54.15.9.4 的治理要求把 T5 基线**重指向**本轮的新授权基线。

##### 37.54.22.13.2 冻结版本化指纹链（LF 归一化，对将要提交的 blob 计算）

| 载荷 | W11-SEC 冻结 | U1 增量 | V2 | **本轮 ONE_TIME 修正** |
|---|---|---|---|---|
| `server/modules/credit-check.js` | `3bf4eb51…72f0` | `eceb2f77…8384` | `5c5a5a71…792b` | **`1f11fbee91d9526b4604b5af9a16ecb38d5856dc77c3184d1ab1e478603029cc`** |
| `server/modules/credit-policy.js` | `94f2df0a…98b` | `9088a222…fea8` | `5fc76f39…f96e7` | **未变** `5fc76f39…f96e7` |
| `server/modules/credit-scope.js` | `f31033bd…1a3bc` | — | `f31033bd…1a3bc` | **未变** `f31033bd75520643c50202c18f640440aacbcde892595efad7d4e0ba2041a3bc` |
| `server/modules/credit-special-approval.js` | `04594b3d…89c4` | — | `04594b3d…89c4` | **未变** `04594b3dc01240c5b3addddf50897fbeab54802daf9fbd7d49c5e36cccf289c4` |

`server/modules/credit-check.js` 的修改**仅为** §37.54.22.5 批准的 ONE_TIME 消费状态机、L7 锁与证据
写入，以及 §37.54.22.5.6/§37.54.22.5.7 的 Scope 级身份修正与重放结论放宽。**未**改变 CSP1/CSP2、
CCHK1/CCHK2 的任何算法，**未**改变信用占用金额计算，**未**改变审批的金额上限、有效期、权限与 SOD，
**未**改变 Finance → Credit 锁序。

本轮新增/变更载荷的摘要：

```text
1f11fbee91d9526b4604b5af9a16ecb38d5856dc77c3184d1ab1e478603029cc  server/modules/credit-check.js
8348456384e1d5bef8962e1078f792d710ecd9cc587734eff84034b63b5c94a5  server/migrations/sales-customer-wave11-a-credit-consumption.js
f82c31fb5b1a6cc5d69550f8f45a1f31ca2e33edb9064d38cea7064742176f37  server/migrations/sales-customer-domain.js
b280cb6c758a49b02f60a2fec81c8ea1ec6ff61e641dc96ff571225f42c304af  server/sales-customer-wave10-credit-check.test.js
ab6b23e26152b52171adb7f5b28bcdb4ac28572d3bf38af83eed8f9251c45f8c  server/sales-customer-wave11-a-credit-query.test.js
768c24578552f017a35efc1afb84d8adc127d9da9e9770f93be5d2979451fb77  server/mysql-sales-customer-wave11-a-credit-query.integration.js
a0929892e7d849b3706ab31217a40e67e55b64a1d26b666dc60a97bb3b51db3e  server/sales-customer-wave0-migration-runner.test.js
c68d4707eaed7501d9f81e35a928755564ed5b2c97f5430fd708b67d7f73036b  scripts/sales-customer-wave11-a-primitives.test.js
```

T5 的指纹链因此**扩为七个互不相同**的链接（原六项全部保留，无一被重算、覆盖或作废）：
`3bf4eb51…` / `eceb2f77…` / `5c5a5a71…` / `1f11fbee…`（credit-check）与
`94f2df0a…` / `9088a222…` / `5fc76f39…`（credit-policy）。

##### 37.54.22.13.3 实施范围与白名单核对

| # | §37.54.22.9 白名单文件 | 本轮状态 | 摘要 / 变更 |
|---|---|---|---|
| 1 | `server/modules/credit-check.js` | **已修改** | +425 / -71（消费状态机、L7 锁、Scope 级身份、重放结论放宽） |
| 2 | `server/migrations/sales-customer-wave11-a-credit-consumption.js` | **已新建** | 新增 `credit_special_approval_consumption`（additive DDL） |
| 3 | `server/migrations/sales-customer-domain.js` | **已修改** | +6 / -0（仅一条迁移登记） |
| 4 | `server/sales-customer-wave10-credit-check.test.js` | **已修改** | +630 / -2（**仅追加** T-01..T-16 用例） |
| 5 | `server/sales-customer-wave11-a-credit-query.test.js` | **已修改** | 追加 1 个 SC101/SC102 回归用例 |
| 6 | `server/mysql-sales-customer-wave11-a-credit-query.integration.js` | **已修改** | 追加 T-17 / T-18（真实 MySQL 专属） |
| 7 | `scripts/gates/mysql-sales-wave11-a-gate.mjs` | **未修改** | T-17/T-18 与既有 M1..M10 同一集成文件，既有 Gate 登记已覆盖 |
| 8 | `scripts/testing/test-suites.js` | **未修改** | 本轮**未新增** `*.test.js` 文件，无需登记 |
| 9 | `server/modules/credit-query.js` | **未修改** | 零改动 |
| 10 | `server/modules/credit-special-approval.js` | **未修改** | 零改动 |
| 11 | `credit-policy.js` / `credit-scope.js` / `credit-anchor.js` / `credit-profile.js` / `credit-rule-payload.js` | **未修改** | 零改动 |

**白名单外的两处治理记账变更（已获用户"继续"授权，且为被授权变更的强制记账）**

| 文件 | 变更 | 依据 |
|---|---|---|
| `server/sales-customer-wave0-migration-runner.test.js` | 3 行 / 3 行：注册表步数 10 → 11、步 id 列表追加 `wave-11-a-credit-consumption`、测试标题改为 "Wave 1 through Wave 11" | 登记迁移**必须**同步该治理断言；Wave 6/7/8/9/10 每一轮都做过同一件事（Wave 10：commit `4f0022d`，`length 9 → 10` + id 列表追加）。断言意图（"注册表恰含已批准的步"）**未**被削弱 |
| `scripts/sales-customer-wave11-a-primitives.test.js` | T5 指纹链扩为七项；"当前源码 == 授权基线"由 `V2_CREDIT_CHECK_SHA256` 重指向新增的 `ONE_TIME_CONSUMPTION_CREDIT_CHECK_SHA256` | `log/2026-10-28.md:1733` 的既有维护规则："T5 的指纹基线必须**重指向**该新授权基线，而 W11-SEC-01 原指纹必须永久保留……**不得**以放宽比较、删除断言或跳过用例消除该失败"。比较**未**放宽、断言**未**删除、用例**未**跳过 |

##### 37.54.22.13.4 Migration：fresh / upgrade / idempotency / 约束

| 验证项 | 结果 |
|---|---|
| SQLite 新库 bootstrap | 表、列序、可空性、3 个 CHECK、2 个 FK、`UNIQUE(approval_id, consumption_key)`、组索引全部成立 |
| 已存在数据库 upgrade | 重新打开同一文件后新增**恰好一张**表；既有 `credit_check_results` / `credit_special_approval` / `audit_logs` 行数**逐项不变**；升级后的表集合与全新 bootstrap **完全一致** |
| 重复执行幂等 | 连续三次执行后表仍为 1 张、行数不变 |
| 唯一约束 | 第二次 `(approval_id,'SINGLE')` 插入被库拒绝 |
| ONE_TIME 键约束 | `scope_mode='ONE_TIME'` 且 `consumption_key<>'SINGLE'` 被 CHECK 拒绝 |
| 可重复模式 | `TIME_BOUNDED` 可持有第二条（动作键不同）消费行 |
| 外键 | 指向不存在的审批被拒绝 |
| 无 backfill | 升级后账本为空；历史消费**未**被迁移 |

**物理类型合同**：MySQL 的列类型与通用 snapshot bootstrap 对该表的解析结果**逐列相同**
（`id`/`approval_id`/`scope_mode`/`consumption_key`/`check_group_id`/`consumed_by`/`audit_id` 为
`VARCHAR(128)`；`scope_type`/`business_date`/`consumed_at` 为 `LONGTEXT`），因此
**fresh bootstrap 路径与 live upgrade 路径产出同一物理 schema**，且**无需**修改
`server/database/mysql-schema.js`。`CHECK` 覆盖 `LONGTEXT` 列是 Wave 9 已验证的形状
（`credit_check_rules.scenario`）。

##### 37.54.22.13.5 消费状态机实施结果

| 状态 | 实现 | 证据 |
|---|---|---|
| `UNCONSUMED` | 写入 1 条账本行 + 1 条 CONSUME 审计 | T-01 |
| `CONSUMED_BY_THIS_ACTION` | 复用原消费结论；**不**新增账本、**不**新增审计 | T-02 / T-03 / T-09 |
| `CONSUMED_BY_OTHER_ACTION` | 拒绝释放；维持 `SPECIAL_APPROVAL_REQUIRED` + reason code `SPECIAL_APPROVAL_ALREADY_CONSUMED`；**零写入** | T-04 / T-05 |

- 消费写入**不再**由 `isReplay` 决定；决定它的是审批的消费状态。
- 账本行**先写**、CONSUME 审计**后写**：唯一约束冲突发生时，审计行根本不会产生。
- 唯一约束冲突被翻译为显式 409 `CREDIT_SPECIAL_APPROVAL_ALREADY_CONSUMED`，事务整体回滚。
- `consumedSpecialApprovalId` **当且仅当**当前 `(check_group_id, scope_type)` 存在消费记录时非空；
  Scope 级字段已加入响应与 EVALUATE 审计明细。
- Scope 级身份修正（C-4）：未被释放的 Scope 行，其明细 `consumedSpecialApprovalId` 为 `null`，
  **不**再残留其它 Scope 的审批 ID（T-12）。
- 重放结论修正（C-3）：落盘行自带释放标记即构成"落盘结论 = 释放后结论"的证明，落盘决定为 `PASS`
  的组**不再**被判为身份不可重放（T-11 / T-11b）。
- 历史兼容：既有 CONSUME 审计行经 `JSON.parse` 解析后**被承认**为消费权威；明细损坏时**fail closed**
  （T-13 / T-13b / T-14）；历史消费**未**被迁入账本。
- L7 锁：候选审批行按 `decided_at, id` 稳定顺序 `FOR UPDATE` 取得，排在既有 L1–L6 之后、调用方业务行
  之前；**未**新增 Check Result 行锁；Finance → Credit 锁序不变。
- 只读路径（`consumeApprovals=false`）**不**写账本、**不**写审计、**不**翻转决定（T-16b）。

##### 37.54.22.13.6 本轮实际执行的验证（全部来自本轮运行）

| 序列项 | 命令 / 范围 | 结果 |
|---|---|---|
| Migration fresh / upgrade / idempotency / 约束 | 一次性 SQLite 夹具 | PASS（见 §37.54.22.13.4） |
| T-01..T-16 | `node --test server/sales-customer-wave10-credit-check.test.js` | **75 / 75 PASS**（原 56 + 新 19） |
| V1/V2 Golden | 同上（既有 golden 未删未改） | PASS |
| Wave 10 Credit Focused | 同上 | PASS |
| W11-SEC 冻结回归 | `node --test server/sales-customer-wave0-migration-runner.test.js server/sales-customer-wave10-acceptance-contract.test.js server/sales-customer-wave11-sec-scope.test.js` | **32 / 32 PASS** |
| W11-A U1 证据链 | `node --test scripts/sales-customer-wave11-a-primitives.test.js` | **10 / 10 PASS** |
| W11-A U2 回归 | `node --test server/sales-customer-wave11-a-credit-query.test.js` | **38 / 38 PASS**（原 37 + 新 1） |
| MySQL 集成套件静态检查 | `node --check` + 具名导出解析 | PASS（语法通过，**全部具名导入可解析**） |
| Test Governance | 随 FULL 执行 | PASS |
| FAST | `pnpm test:fast` | **500 / 500 PASS** |
| FULL | `pnpm test` | **3021 / 3021 PASS**（359 suites；原 3001 + 新 20） |
| Build | `pnpm build` | PASS |
| `git diff --check` | — | PASS（无空白错误） |
| 冻结指纹链 | LF 归一化 SHA-256 | PASS（七链互不相同） |

**NOT_RUN — MANUAL MYSQL GATE REQUIRED**

| 项 | 状态 |
|---|---|
| T-17 真实 MySQL 跨会话一次性消费唯一性 | **NOT_RUN** —— 本轮禁止连接 MySQL |
| T-18 真实 MySQL 唯一约束与物理类型目录取证 | **NOT_RUN** —— 同上 |
| Real MySQL E3 M1..M10 复跑 | **NOT_RUN** —— 同上 |
| Protected MySQL Gate / Reset / Cleanup | **NOT_RUN** —— 同上 |

**T-17 能证明什么、不能证明什么**：它证明**独立 MySQL 会话**之间的一次性消费——第二个会话读回第一个
会话已提交的消费并被显式拒绝。它**不能**证明真正的同时交错，因为本仓库的 MySQL 应用事务由全局事务
闸门串行化（§37.54.22.7.3 第一层）；库层唯一约束是与该串行化无关的引擎中立兜底。

##### 37.54.22.13.7 实施状态

**Status: `W11_A_U2_ONE_TIME_IMPLEMENTED_READY_FOR_MYSQL_GATE`.**

本地实施与回归全部通过；真实 MySQL 尚未运行。**本状态不是 U2 Acceptance，也不是 Capability Freeze。**
下一步：由用户在当前 Windows 用户上下文中运行既有受保护 Launcher，完成 E3 M1..M10 与 T-17 / T-18 的
取证。本轮**未**执行任何 Git 写操作，工作树保持未提交。

---

### 37.54.23 W11-A U2 — 白名单例外 Amendment Record 与 T-17 断言更正（2026-10-29）

#### 37.54.23.1 授权与基线

- 授权：**W11-A U2 — ONE_TIME Final Whitelist Exception & T-17 Correction**（用户本轮明确批准）。
  批准内容仅限：① §37.54.22.9 白名单外两份**测试**文件的既有必要增量；② 对
  `server/mysql-sales-customer-wave11-a-credit-query.integration.js` 的**一次最小测试修正**。
  该批准**不**构成对任何其它越界修改的授权。
- 前置只读复核结论：`W11_A_U2_ONE_TIME_WHITELIST_EXCEPTION_REVIEW_READY`。
- 基线：Branch `work/sales-waves6-13-recovery-20261025`；HEAD
  `d9e5d50a9103612a17070f806312b822281eb6c6`；Version `1.6.2`；工作树保持未提交，全部 U2 实施成果保留。
- 本轮**未**连接 MySQL、**未**运行任何 MySQL Gate、**未**执行任何 Git 写操作、**未**修改生产代码、
  Schema、Migration、Protected Runner / Launcher / Preflight、`package.json`、Test Suite Manifest
  或任何冻结历史记录。

#### 37.54.23.2 白名单例外 Amendment Record

新增例外身份 **`W11_A_ONE_TIME_WHITELIST_EXCEPTION_AMENDMENT`**。它**不重定义** W11-SEC-01 的冻结基线，
**不**追溯覆盖 U1 与 V2 的证据链，只记录本轮获批的两处白名单外增量。

| # | 文件 | 实际变更 | 批准范围 | 判定 |
|---|---|---|---|---|
| X1 | `server/sales-customer-wave0-migration-runner.test.js` | **+3 / −3** | 仅三处治理记账 | 已批准 |
| X2 | `scripts/sales-customer-wave11-a-primitives.test.js` | **+227 / −13** | 仅 T5 基线重指向与新增 T6..T10 | 已批准 |

**X1 — Wave 0 Registry Test（三处 bookkeeping，无其它变化）**

| 位置 | 变更 | 事实核对 |
|---|---|---|
| 测试标题 | `Wave 1 through Wave 10` → `Wave 1 through Wave 11` | 与注册表实际步数一致 |
| `SALES_CUSTOMER_MIGRATIONS.length` | `10` → `11` | 注册表**确实**含 11 条（`server/migrations/sales-customer-domain.js:43-46`）；runner 接受 `wave: 11`（同文件 `:83`，合法区间 `0..13`） |
| 批准步 id 列表 | 追加 `'wave-11-a-credit-consumption'` | 与注册表 id **逐字相同**，追加在末尾，顺序不变 |

其余断言**逐字节未改**：`BATCH_A_COLUMNS` 计数 27、`Object.isFrozen`、`wave-1` / `wave-2` id、
`WAVE8_BOUNDED_STEPS.length` / `.at(-1)` / `wave >= 9` 三项、`WAVE11_SALES_TABLES` 不得存在。
无 skip / todo / only；无断言被删除或放宽；未把预期值改成错误实现的结果。
`WAVE8_BOUNDED_STEPS.some((step) => step.wave >= 9) === false` 仍然成立，因为该夹具按 `wave <= 8` 过滤，
新增的 `wave: 11` 步骤落在夹具之外。

**X2 — U1 Primitives（T1–T4 原断言保留，T5 当前版本完整性继续执行）**

- **T1–T4 的函数体逐字节未改**：`git diff -U0` 的第一个正文 hunk 落在 T5 内部，T1–T4 区间无任何 hunk。
  Golden 向量与全部断言保持原样。
- **T5 的断言强度未被削弱**：5b（`CREDIT_CHECK_RESULT_SCOPE` 内容）、5c（hash builder 合同与确定性）、
  5d（唯一 resolver / predicate / hash builder / canonicalJson / 指纹算法）与"具名导出块仍原样存在"
  全部保留；T5 的断言**数量增加**、**无一条被删除**、**无用例被跳过**。
- **唯一无法保留其旧形式的断言**：`sha256(导出标记之前的源码) === 3bf4eb51…`。它现在是**结构性不可满足**的：
  当前文件剥离导出块后的 LF 归一化摘要为 `b4dff887…`，既不等于 `3bf4eb51…`（W11-SEC）也不等于
  `eceb2f77…`（U1），因为本轮获批的 ONE_TIME 行为性修改落在函数体内部（导出标记位于 byte 70635 / 71225）。
  该断言的替换依据仓库**既有**维护规则 `log/2026-10-28.md:1733`：T5 基线必须**重指向**新的授权基线，
  原指纹必须永久保留，**不得**以放宽比较、删除断言或跳过用例消除失败。
  实际执行结果：**比较未放宽**（仍为 64 位小写十六进制的严格相等）、**断言未删除**、**用例未跳过**。
- **EOL 规范化**：`contentDigest` 只做 `CRLF → LF` 折叠，不触及任何其它字节，不改变语义载荷；
  冻结常量本就以 LF 归一化字节（= 将要提交的 Git blob）计算，与 `log/2026-10-29.md` 的记录口径一致。
  相对旧的裸字节摘要，该归一化**更贴近**被冻结的内容，而非放松比较。

#### 37.54.23.3 冻结证据链的独立核验事实

本轮对 T5 指纹链的**每一项**独立复算，不以"七个摘要互不相同"充当完整性证明。

| 常量 | 独立核验方式 | 结论 |
|---|---|---|
| `W11_SEC_FROZEN_CREDIT_CHECK_SHA256` `3bf4eb51…` | `git show 177a8ea:server/modules/credit-check.js` | **MATCH**（存在独立 Git blob） |
| `W11_SEC_FROZEN_CREDIT_POLICY_SHA256` `94f2df0a…` | `git show 177a8ea:server/modules/credit-policy.js` | **MATCH**（存在独立 Git blob） |
| `U1_PRE_V2_CREDIT_CHECK_SHA256` `eceb2f77…` | `git show ca9811a:server/modules/credit-check.js` | **MATCH**（存在独立 Git blob） |
| `U1_PRE_V2_CREDIT_POLICY_SHA256` `9088a222…` | `git show ca9811a:server/modules/credit-policy.js` | **MATCH**（存在独立 Git blob） |
| `ONE_TIME_CONSUMPTION_CREDIT_CHECK_SHA256` `1f11fbee…` | 当前工作树文件的 LF 归一化摘要 | **MATCH** |
| `V2_CREDIT_POLICY_SHA256` `5fc76f39…` | 当前工作树文件的 LF 归一化摘要 | **MATCH** |
| `V2_CREDIT_CHECK_SHA256` `5c5a5a71…` | **无 Git 对象可比对** | **documentary only** |

**如实标记**：未提交的 V2 中间版本 `5c5a5a71…` 只在 `log/2026-10-29.md` 与本节留下文档记录，
**没有**对应的 Git blob，因此**不宣称七个 SHA 全部具备独立 Git blob**。
七个摘要互不相同这一事实**只**作为"复制粘贴串号"防护使用，**不**充当完整性证明。

**新增版本期望 SHA 的来源**：两个当前基线常量均为测试文件中的**硬编码字面量**，
测试以 `contentDigest(当前源码) === 字面量` 比较，**不在测试运行时由当前源码动态生成**；
本轮另行独立复算当前文件摘要，两者一致。

**历史链接在可执行测试中的当前地位（如实记录）**：四个历史摘要现在只参与"互不相同"检查，
**不再**有任何可执行断言把它们绑定到各自的载荷内容。原先"剥离导出块可复现 W11-SEC 指纹"的
**字节包含性证明**因获批的行为性修改而不可能继续存在，这是该修改的**直接且不可避免**的后果，
不是本次越界增量造成的。历史完整性现由：测试常量 + 本节 + `log/2026-10-29.md` 摘要链 +
Git 对象（`177a8ea` / `ca9811a`）共同承担。

#### 37.54.23.4 T-17 静态复核结论：生产语义与 Design **无冲突**

**被复核的错误断言及其根因**

Session B 使用不同的 `authorizationContext` ⇒ 产生不同的 Check Group（CCHK2 前像含
`authorizationContext`，`server/modules/credit-check.js:1178-1183`）。
ONE_TIME 账本已记录其它动作的消费 ⇒ `readApprovalConsumptionState` 返回
`{ consumed: true, matchesThisAction: false }`（`credit-check.js:661-670`）⇒
`findConsumableApproval` 置 `consumedByAnotherAction` 并 `continue`（`credit-check.js:727-736`），
返回 `approval: null` ⇒ `evaluateCredit` 走 `credit-check.js:1204-1215`，**返回**业务拒绝结论，
**不抛异常**。唯一的 409 抛出点 `writeApprovalConsumption`（`credit-check.js:764`）在 `approval` 为 null 时
**不可达**；`legacyContextGroups` 只匹配 `CCHK1:%`（`credit-check.js:861-872`），故 CCHK2 路径也不会抛
`CREDIT_CHECK_LEGACY_REPLAY_AMBIGUOUS`。`transaction()`（`server/db.js:2093`）正常提交。

**三种持久化形态的区分（本路径的实际归属）**

| 形态 | 内容 | 本路径是否适用 |
|---|---|---|
| **A** | 只读拒绝、无新增持久化事实 | **否** |
| **B** | 直接调用返回拒绝结果，并保留该**新 Check Group 自身**的评估事实 | **是** —— T-17 的 session B |
| **C** | 生产业务调用方在拒绝后抛异常，使整笔事务回滚 | **是** —— 生产路径 |

形态 C 的证据：`assertCreditAllowsBusinessAction`（`credit-check.js:1346-1360`）在
`decision` 非 PASS / WARNING 时抛 409 `CREDIT_SPECIAL_APPROVAL_REQUIRED`；三个生产调用方都把该调用
放在自己的 `transaction(db, ...)` 内（`server/modules/sales-orders.js:707` / `:816`、
`server/app.js:5799`），因此该次评估写入的 Result 行、Snapshot、Anchor 与 EVALUATE 审计
**一并回滚** ⇒ 提交态**零写入**。

**形态 B 与已批准合同的一致性**

- `document.md` **R-ONE-03-c**：拒绝路径零写入——不写消费记录、不写 CONSUME 审计、**不改 Check Result**、
  不改审批。B 与 C 均满足：拒绝分支只追加 reason code（`credit-check.js:1213-1215`），
  不写账本、不写 CONSUME 审计、不 UPDATE 任何既有 Result 行、不 UPDATE 审批行
  （`credit-check.js` 内**不存在**对 `credit_special_approval` 的 UPDATE / DELETE）。
- `document.md` **R-ONE-03-d**：业务事实变化导致的新 Check Group（含新的授权上下文）视为**新的业务动作**。
  新业务动作产出新的评估事实是被批准的语义。
- **R-ONE-02-d**：响应中的 `consumedSpecialApprovalId` 当且仅当当前 `(check_group_id, scope_type)`
  确实存在消费记录时非空。拒绝分支的 Scope 与组级字段均为 `null`（`credit-check.js:1245` / `:1277`）。
- **已通过**的 SQLite **T-04 / T-05** 已经采用形态 B：其 `runCheck` 助手
  （`server/sales-customer-wave10-credit-check.test.js:300-304`）**直接**调用 `evaluateCredit` 并提交事务；
  **T-05** 更进一步读取**被拒组自己的** Result 行
  （`:1646` `scopeRow(handle.db, refused.checkGroupId, 'CUSTOMER_AGGREGATE')`）去申请第二张审批——
  若拒绝路径不写 Result 行，T-05 无法通过。
- `solution.md` §37.54.22.5.5 的"拒绝路径零写入：账本、CONSUME 审计、Result 行、审批行均不变"
  位于**生产事务归属**段落内，其零写入由调用方回滚保证（形态 C）。

**结论：被复核的拒绝路径的持久化结果与已批准的 Requirement / Design 一致，不存在生产语义冲突。**
本轮**不**签发 `W11_A_U2_T17_PRODUCTION_SEMANTIC_BLOCKER`，**不**修改任何生产模块或 Schema，
**不**以调整生产 `evaluateCredit()` 去迎合错误测试。

#### 37.54.23.5 T-17 断言更正（最小测试修正）

唯一修改文件：`server/mysql-sales-customer-wave11-a-credit-query.integration.js`（白名单第 6 项内的更正）。

| 原断言 | 更正后 | 依据 |
|---|---|---|
| `sessionBOutcome === null` | `sessionBOutcome` 非空，且 `decision === 'SPECIAL_APPROVAL_REQUIRED'` | R-ONE-03-b；形态 B |
| `sessionBError` 为真、`status === 409` | `sessionBError === null`（拒绝是业务结论，抛异常反而是**合同偏离**，故断言其**不存在**） | R-ONE-03-b；`credit-check.js:1204-1215` |
| `sessionBError.code === 'SPECIAL_APPROVAL_REQUIRED'` | 该项**整体删除**（`SPECIAL_APPROVAL_REQUIRED` 是*决定*不是错误码；真正的抛出码是 `SPECIAL_APPROVAL_ALREADY_CONSUMED`） | `credit-check.js:764` / `:1352` |
| —（新增） | 被拒 Scope 携带 `SPECIAL_APPROVAL_ALREADY_CONSUMED`，且**恰好一个** Scope 携带；其 `scopeType` 等于审批的 `scope_type` | R-ONE-03-b |
| —（新增） | 被拒 Scope 与组级的 `consumedSpecialApprovalId` 均为 `null`；`approvalAvailable === false` | R-ONE-02-d |
| —（新增） | 拒绝前后**审批行逐字段相等**、**既有 Check Result 行逐字段相等**（`deepEqual` 前后快照） | R-ONE-03-c「不改 Check Result / 不改审批」 |
| —（新增） | Session A 的合法 Replay 仍返回 `PASS`、同一 `consumedSpecialApprovalId`、同一 `checkGroupId`，账本仍 1 行、CONSUME 审计仍 1 行 | R-ONE-02-a |

**保留不动**：账本唯一消费行（`consumption_key === 'SINGLE'`、`check_group_id` 绑定 Session A）、
CONSUME 审计计数为 1、Session A 的首次消费结论、T-18 的全部断言、M1–M10 的全部顶层测试。

**本轮未借机扩大范围**：两份已批准的白名单例外文件**未再改动一行**；生产模块、Schema、Migration、
Protected Runner / Launcher / Preflight、`package.json`、Test Suite Manifest **均未改动**。

#### 37.54.23.6 本轮实际执行的验证

全部在剥离 MySQL 指向环境变量的隔离子进程中执行（`ERP_DB_BACKEND=sqlite`，
`ERP_MYSQL_TEST_ALLOW_RESET` / `ERP_DB_HOST` / `ERP_DB_PATH` 等均已证实不存在）。

| 序列项 | 命令 / 范围 | 结果 |
|---|---|---|
| Integration Suite 语法 | `node --check server/mysql-sales-customer-wave11-a-credit-query.integration.js` | **PASS** |
| ONE_TIME Focused | `node --test server/sales-customer-wave10-credit-check.test.js` | **75 / 75 PASS** |
| SQLite 跨动作决策与副作用回归（T-17 的 SQLite 对照） | `node --test --test-name-pattern="T-04\|T-05\|T-13\|T-02\|T-03" …` | **6 / 6 PASS**（T-02 / T-03 / T-04 / T-05 / T-13 / T-13b） |
| U1 Primitives / T5 证据链 | `node --test scripts/sales-customer-wave11-a-primitives.test.js` | **10 / 10 PASS** |
| Wave 0 Migration Registry | `node --test server/sales-customer-wave0-migration-runner.test.js` | **7 / 7 PASS** |
| W11-A U2 回归（SC101 / SC102） | `node --test server/sales-customer-wave11-a-credit-query.test.js` | **38 / 38 PASS** |
| `git diff --check` | — | **PASS**（无空白错误） |

**NOT_RUN — MANUAL MYSQL GATE REQUIRED**（本轮禁止连接 MySQL）

| 项 | 状态 |
|---|---|
| T-17 真实 MySQL 跨会话一次性消费唯一性 | **NOT_RUN** |
| T-18 真实 MySQL 唯一约束与物理类型目录取证 | **NOT_RUN** |
| Real MySQL E3 M1..M10 复跑 | **NOT_RUN** |
| Protected MySQL Gate / Reset / Cleanup | **NOT_RUN** |

**SQLite 结果不得替代真实 MySQL 实证**：T-17 / T-18 仍必须在受保护 Launcher 下取证。

#### 37.54.23.7 未发生事项与状态

- 未修改任何生产业务模块、Schema / Migration、Protected Runner / Launcher / Preflight、
  `package.json`、Test Suite Manifest、冻结历史记录或两份已批准的白名单例外文件。
- 未连接 MySQL；未创建 / Reset / 清理任何数据库；未触碰 DPAPI 凭据、账号、Grants 或 GLOBAL 参数。
- 未执行 Git Commit / Push / Merge / Rebase / Reset / Restore / Clean / Stash；未 Version Bump / Tag /
  Release / Deploy；未执行 W11-SEC Re-Freeze。
- 未签发 U2 Acceptance / Freeze；未启动 U3 / W11-B / W11-C / W11-D。
- 未改动 M1–M10、T-17 / T-18 的既有覆盖范围；未 skip、未 todo、未弱化任何既有测试。

**Status: `W11_A_U2_E3_FINAL_RERUN_READY`.**

T-17 的断言已更正为**已批准的返回式拒绝合同**，且被复核的跨动作拒绝副作用与 §37.54.22 的
Requirement / Design 一致。本状态**不是** U2 Acceptance，也不是 Capability Freeze。
下一步：用户在受保护 Launcher 下运行真实 MySQL E3（M1..M10 + T-17 / T-18）取证。

---

### 37.54.24 W11-A U2 — E3 T-17 测试数据根因诊断与 Fixture 有界修正（2026-10-29）

#### 37.54.24.1 授权、基线与本轮范围

- 授权：**W11-A U2 — E3 T-17 Fixture Ambiguity & T-18 Isolation Correction**（用户本轮明确批准）。
- 基线：Branch `work/sales-waves6-13-recovery-20261025`，HEAD `d9e5d50a9103612a17070f806312b822281eb6c6`，
  `package.json` version `1.6.2`。
- 触发事实：受保护 MySQL Gate 已执行，`w11-a-u2-e3-20261029-152933.tap.log` 记录 M1–M10 **10/10 PASS**、
  T-17 **FAIL**、T-18 **FAIL（依赖 T-17 失败）**、Total 10/12、`GATE_EXIT_CODE=1`、`CLEANUP_CONFIRMED`。
- 本轮范围：**只**诊断并修正 T-17 的测试数据问题与 T-18 的测试依赖问题。
  **不授权**修改生产业务代码、Schema、Migration 或 MySQL 环境。
- 白名单：`server/mysql-sales-customer-wave11-a-credit-query.integration.js`（优先）、
  `server/test-utils/wave11-a-credit-query-fixture.js`（有界）、`solution.md`、`log/YYYY-MM-DD.md`。
- M2、M4、M9 已在真实 MySQL 验收通过，本轮**不重新打开**。

#### 37.54.24.2 根因：两个**独立**的 Fixture 碰撞（生产语义正确，测试数据错误）

真实 MySQL 的失败点是 `CREDIT_EFFECTIVE_VERSION_AMBIGUOUS`。本轮用**隔离 SQLite 复现**证明：
E3 套件把**两个各自正确但互相独立**的 Fixture 世界放进**同一个** MySQL 数据库，
而两个生产解析器把这些事实当作**全局**事实：

| # | 事实 | 共享世界（M1–M10） | T-17 的 Wave-10 世界 | 生产解析器 | 后果 |
|---|---|---|---|---|---|
| C-1 | `credit_parameters` 的 `CREDIT_MANAGEMENT_ENABLED` | `param-CREDIT_MANAGEMENT_ENABLED`（ACTIVE，`effective_from=PROFILE_FROM`，`effective_to=NULL`，值 1） | `w10-race-enabled`（ACTIVE，`effective_from=2026-01-01`，`effective_to=NULL`，值 1） | `readEffectiveParameter`（`credit-check.js:90-95`）：同一 Code 在业务日期上出现 **>1** 个有效 ACTIVE 版本即拒绝 | `CREDIT_EFFECTIVE_VERSION_AMBIGUOUS`（**本轮报告的失败**） |
| C-2 | `credit_check_rules` 在**阶段**上的有效规则集 | `W11_A_SO_APPROVE`（SO_APPROVE，scenario `BLOCK`，strength `BLOCK`，自 `PROFILE_FROM` 起有效） | `W10_RACE_RULE`（SO_APPROVE，scenario `OVERRIDE_REQUEST`，strength `WARNING`，自 `2026-01-01` 起有效） | `effectiveRuleRows`（`credit-check.js:509-512`）收集该阶段**全部**有效规则，`strongestOutcome` 取最强 | 阶段结论变成 **BLOCK**（rank 3）而非可释放的 `SPECIAL_APPROVAL_REQUIRED`（rank 1）——**修复 C-1 之后 T-17 仍会失败** |

隔离 SQLite 复现（同一数据库内合成两个世界）的实测输出：

```
effective CREDIT_MANAGEMENT_ENABLED versions at 2026-10-29: 2
=== 4. T-17 first evaluation, AS SHIPPED (stage SO_APPROVE) ===
THROWN code=CREDIT_EFFECTIVE_VERSION_AMBIGUOUS message=信用参数生效版本不唯一
=== 6. T-17 first evaluation at stage SO_APPROVE (parameter ambiguity fixed) ===
decision=BLOCK scopes=CUSTOMER_AGGREGATE:BLOCK
effective rules at SO_APPROVE=[W10_RACE_RULE(OVERRIDE_REQUEST/WARNING), W11_A_SO_APPROVE(BLOCK/BLOCK)]
=== 7. T-17 first evaluation at stage SO_SUBMIT ===
decision=SPECIAL_APPROVAL_REQUIRED scopes=CUSTOMER_AGGREGATE:SPECIAL_APPROVAL_REQUIRED
```

**结论**：生产代码**无缺陷**。`readEffectiveParameter` 拒绝在两个重叠 ACTIVE 版本之间猜测是正确的保护，
`effectiveRuleRows` 取最强结论也是已批准语义。缺陷在**测试数据**：两个 Fixture 世界被合成到同一个数据库，
却没有合成出**唯一**的参数版本与**可释放**的阶段规则集。

#### 37.54.24.3 随后的两个潜伏 Fixture 缺陷（同一根因链：T-17 从未真正跑通过）

C-1 在进入账本验证之前就抛出，因此 T-17 的后续代码**从未被执行**。隔离复现继续暴露两个更靠后的缺陷：

| # | 缺陷 | 证据 | 修正 |
|---|---|---|---|
| C-3 | T-17 用 `SELECT * FROM credit_check_results WHERE decision='SPECIAL_APPROVAL_REQUIRED' ORDER BY id LIMIT 1` 取来源行。共享世界**本身就有 8 条** `SPECIAL_APPROVAL_REQUIRED` 结果（4 客户 × 2 范围），因此该查询会取到**共享世界的行**，从而把审批绑到错误的快照上 | `seedWorld` 的 `runCheck`（limit 100000 / delta 200000）必然超限 | 来源行改为**按本用例自己的 check group** 定位：`WHERE check_group_id=? AND decision='SPECIAL_APPROVAL_REQUIRED'` |
| C-4 | T-17 用**同一个 actor**（`ADMIN`）申请并审批特别审批 | 生产 SOD（`credit-special-approval.js:255-261`，§36.6.6）拒绝申请人＝审批人，抛 `CREDIT_SPECIAL_APPROVAL_SOD` | 申请用 `ADMIN`、审批用共享 Fixture 的独立审批人 `DECIDER`，与共享世界决定自身审批的做法完全一致 |

C-3、C-4 与 C-1/C-2 属同一条链：**T-17 在真实 MySQL 上从未真正进入过消费路径**。

#### 37.54.24.4 Fixture 修正（只改测试数据，不改生产）

**修正 1 —— 参数版本收敛为一条版本链（消除 C-1）**

`reconcileParameterVersions`（`server/test-utils/wave11-a-credit-query-fixture.js`）执行**生产写入器自己执行的**
版本转换 `closePredecessorAndAssertRange`（`credit-policy.js:32-46`）：前序版本的生效窗口在**后继版本生效日的
前一天**关闭，并在前序版本上写下 `superseded_by_id` 链接。

- 收敛前：`w10-race-enabled` [2026-01-01, ∞) ∥ `param-CREDIT_MANAGEMENT_ENABLED` [2026-08-29, ∞) → 重叠。
- 收敛后：`w10-race-enabled` [2026-01-01, 2026-08-28] → `param-CREDIT_MANAGEMENT_ENABLED` [2026-08-29, ∞)。
- 两个版本的 `value_bool` **相同**（均为 1），因此关闭窗口**不改变任何日期上参数所陈述的事实**：
  Credit Management 在**每个**日期上都保持**开启**，T-17 的“信用管理开启”前提原样保留。
- **不删除**任何参数行，**不修改**生产 Resolver，**不改变** T-17 的业务日期。
- fail-closed：若同一 Code 的各 ACTIVE 版本取值不一致（收敛会改变业务事实），直接拒绝；
  收敛后若业务日期上仍不是**恰好一个**有效版本，直接拒绝。

**修正 2 —— ONE_TIME 阶段选择可释放的阶段（消除 C-2）**

`ONE_TIME_STAGE = 'SO_SUBMIT'`：这是**规范 SQLite 对照**（T-01..T-14，`prepareApprovalScenario`）使用的阶段，
也是合成后的 E3 数据库中**唯一**有效规则集可释放的阶段——共享世界在 SO_SUBMIT 的 `W11_SEC_SO_OVERRIDE`
与 T-17 自己的 `W10_RACE_RULE` 同为 `OVERRIDE_REQUEST` / `WARNING`；而共享世界在 SO_APPROVE 的
`W11_A_SO_APPROVE` 是强制 `BLOCK`。

- **不修改**生产规则解析器；**不删除**共享世界的任何规则。
- 不改变 Profile / Rule / Snapshot / Sales Order / 金额的批准合同：T-17 仍是
  “聚合额度 50000 分 + 提议增量 100000 分 → 超限 → 申请覆盖 50000 分 / 上限 100000 分 → 可释放的
  `SPECIAL_APPROVAL_REQUIRED`”。
- `ensureWave10OneTimeWorld` 在运行前 fail-closed 复核：该阶段必须有有效规则，且每条有效规则的
  `scenario` 必须是 `OVERRIDE_REQUEST` 且 `control_strength` 不得为 `BLOCK`——否则立即拒绝，
  而不是让结论以难以理解的方式不匹配。

**修正 3 —— T-17 / T-18 共享一个幂等的世界准备**

`ensureWave10OneTimeWorld` 每个数据库只准备一次，且是幂等的：T-17 与 T-18 各自调用它，谁先到谁准备，
后到者复用。**两个用例互不依赖，也不依赖对方已经 PASS。**

#### 37.54.24.5 T-18 独立性证明

| 要求 | 实现 | 证据 |
|---|---|---|
| 不依赖 T-17 已经 PASS | T-18 不再读取任何 T-17 证据（原 `oneTimeConsumptionEvidence` 已删除）；它自己调用幂等的 `ensureWave10OneTimeWorld`，世界不存在时由它自己准备 | 静态检查：`oneTimeConsumptionEvidence` / “T-17 must have produced” 在集成文件中**零命中** |
| 不通过执行顺序取得隐式成功前提 | T-18 有自己的订单 `w11a-t18-order`、自己的 Check Group、自己的审批 | T-18 的审批 id ≠ T-17 的审批 id（隔离复现实测） |
| 消费事实来自合法生产 Writer | 申请与审批走 `requestCreditSpecialApproval` / `decideCreditSpecialApproval`（生产 handler），消费走生产 `evaluateCredit` 路径 | T-18 断言 `consumed.decision === 'PASS'`、`consumed.consumedSpecialApprovalId === approvalId`、账本恰好 1 行 |
| 独立验证 MySQL 原生 UNIQUE 拒绝 | T-18 对**自己**的审批做第二次 `(approval_id,'SINGLE')` 原始 INSERT，断言被拒绝 | 该断言与 T-17 的审批无关：唯一约束是 `(approval_id, consumption_key)` |
| 重复 INSERT 未制造第二份记录 | 断言该审批的消费行数仍为 1 | — |
| information_schema 真实物理列合同 | 原断言**原样保留**（列名序列、`varchar` / `longtext` 族） | — |
| 不得为独立性复制整套 Credit 业务实现 | 只复用既有最小 Fixture Helper（`seedWave10AcceptanceBase` / `seedSubmittedOrder` / `creditInput` / 生产审批 handler），**未新增**任何 Credit 业务实现 | — |

#### 37.54.24.6 未改动的既有合同

M1–M10 的**采集路径完全未变**：`collectEngineEvidence` 仍在 `before()` 中、在任何 ONE_TIME 事实写入**之前**
完成，故 M2 金额、M4 V2 Rule Hash / CSP2 / CCHK2 跨引擎相等、M9 分页唯一性、M10 GET 零写入的
事实与断言一字未动。ONE_TIME 世界在 T-17/T-18 内部准备，不进入 M1–M10 的测量窗口，
共享世界的结果行与阶段规则保持原样。T-17 的既有断言（账本唯一消费行、`consumption_key='SINGLE'`、
`check_group_id` 绑定 Session A、CONSUME 审计计数为 1、审批行与既有 Result 行逐字段不变、
Session A 合法 Replay）**全部保留**；T-18 的既有断言（原生 UNIQUE 拒绝、消费行数、information_schema 物理列）
**全部保留**。

#### 37.54.24.7 本轮实际执行的验证（全部来自本轮运行，**未连接 MySQL**）

| 序列项 | 命令 / 范围 | 结果 |
|---|---|---|
| 隔离 SQLite 复现（合成两个世界） | 一次性脚本（仓库外临时目录） | **复现 C-1（`CREDIT_EFFECTIVE_VERSION_AMBIGUOUS`）与 C-2（`decision=BLOCK`）**，并证明 SO_SUBMIT 得出 `SPECIAL_APPROVAL_REQUIRED` |
| 隔离 SQLite 修正验证 | 同一脚本 + **真实的** `ensureWave10OneTimeWorld` | T-17 全流程 PASS；T-18 独立流程 PASS；参数链与账本形态如 §37.54.24.4 |
| Integration Suite 语法 | `node --check server/mysql-sales-customer-wave11-a-credit-query.integration.js` | **PASS** |
| Fixture 模块语法 | `node --check server/test-utils/wave11-a-credit-query-fixture.js` | **PASS** |
| 顶层用例数量 | `grep -c '^test('` | **12**（M1–M10 + T-17 + T-18） |
| skip / todo / only | 静态扫描 | **零命中** |
| T-18 独立性静态检查 | 静态扫描 | **零命中**（无 T-17 证据依赖） |
| ONE_TIME Focused | `node --test server/sales-customer-wave10-credit-check.test.js` | **75 / 75 PASS** |
| W11-A U2 回归 + U1 Primitives + Wave 0 Registry | `node --test server/sales-customer-wave11-a-credit-query.test.js scripts/sales-customer-wave11-a-primitives.test.js server/sales-customer-wave0-migration-runner.test.js` | **55 / 55 PASS**（38 + 10 + 7） |
| W11-SEC 冻结回归 | `node --test server/sales-customer-wave11-sec-scope.test.js` | **14 / 14 PASS** |
| FAST | `pnpm test:fast`（剥离 MySQL 指向变量） | **500 / 500 PASS** |
| `git diff --check` | — | **PASS**（无空白错误） |
| 冻结载荷指纹 | LF 归一化 SHA-256 | `credit-check.js` = `1f11fbee91d9526b4604b5af9a16ecb38d5856dc77c3184d1ab1e478603029cc`（**未变**）；`credit-policy.js` = `5fc76f39b3b82358593d5ea443faeedb6e828610b185be1a9ea235c15cbf96e7`（**未变**） |

**NOT_RUN — MANUAL MYSQL GATE REQUIRED**

| 项 | 状态 |
|---|---|
| T-17 真实 MySQL 跨会话一次性消费唯一性 | **NOT_RUN** —— 本轮禁止连接 MySQL |
| T-18 真实 MySQL 唯一约束与物理类型目录取证 | **NOT_RUN** —— 同上 |
| Real MySQL E3 M1..M10 复跑 | **NOT_RUN** —— 同上 |
| Protected MySQL Gate / Reset / Cleanup | **NOT_RUN** —— 同上 |

**SQLite 结果不得替代真实 MySQL 实证**：T-17 / T-18 仍必须在受保护 Launcher 下取证。

#### 37.54.24.8 未发生事项与状态

- 未修改任何生产业务模块、Schema / Migration、Protected Runner / Launcher / Preflight、
  `package.json`、Test Suite Manifest 或冻结历史记录。
- 未连接 MySQL；未创建 / Reset / 清理任何数据库；未触碰 DPAPI 凭据、账号、Grants 或 GLOBAL 参数。
- 未执行 Git Commit / Push / Merge / Rebase / Reset / Restore / Clean / Stash；未 Version Bump / Tag /
  Release / Deploy；未执行 W11-SEC Re-Freeze。
- 未签发 U2 Acceptance / Freeze；未启动 U3 / W11-B / W11-C / W11-D。
- 未改动 M1–M10 的覆盖范围与断言；未 skip、未 todo、未弱化任何既有测试。

**Status: `W11_A_U2_E3_T17_T18_FIX_READY_FOR_RERUN`.**

T-17 / T-18 的失败已定位为**测试 Fixture 缺陷**并有界修正：两个 Fixture 世界合成到同一个数据库时，
参数版本收敛为唯一版本链，ONE_TIME 阶段改用可释放的 `SO_SUBMIT`，来源行按本用例自己的 Check Group 定位，
审批人与申请人按生产 SOD 分离；T-18 改为自备消费事实、不再依赖 T-17。本状态**不是** U2 Acceptance，
也不是 Capability Freeze。下一步：用户在受保护 Launcher 下复跑 E3 M1..M10 与 T-17 / T-18 取证。

---

### 37.54.25 W11-A U2 — 冻结实施与证据摘要（2026-10-29）

#### 37.54.25.1 授权与阶段边界

用户审阅 `W11_A_U2_FINAL_ACCEPTANCE_REVIEW_PASS` 后，在 AGENTS.md §4.5 下正式批准：

1. `W11-A U2` 技术验收 PASS；
2. `W11-A U2` Capability Freeze 与本冻结记录。

授权范围**严格限定**为：SC101 Credit Exposure Query 后端、SC102 Credit Exception History 后端、
V2 Cross-Engine Hash Contract（Rule Hash / CSP2 / CCHK2）、V1 历史身份与 Replay 兼容、
ONE_TIME Special Approval Consumption Correction，以及相关 Schema / Migration / 测试 / 验收证据。

**不**包含 U3 移动端；**不**代表整个 W11-A Package 已完成；**不**签发 `W11_A_ACCEPTANCE_PASS`；
**不**解除 Wave 10 发布保持；**不**授权 Release / Deploy / Version / Tag；Git Commit / Push
仍需独立授权且本轮**未**执行。

本节**不重写**任何既有记录：`§37.54.15.10`（U2-1 实施记录）、`§37.54.22`（ONE_TIME Design）、
`§37.54.23`（白名单例外 Amendment）、`§37.54.24`（E3 T-17/T-18 Fixture 修正）、
W11-SEC-01 Freeze Record 与 W11-A U1 Freeze Record 全部原样保留。凡既有记录陈述已不完整之处，
**准确现状在本节与 `document.md` 的 U2 Freeze Record 中给出**，既有记录不被改写。

#### 37.54.25.2 冻结实施清单与已验证文件指纹

`LF` = LF 归一化字节的 SHA-256，等于提交本工作树后将写入的 Git blob 摘要；`raw` = 当前工作树
字节的 SHA-256。全部数值均为本轮**从源文件重算**，未从日志转抄。

| SHA-256 (LF) | SHA-256 (raw) | EOL | 文件 | 角色 |
|---|---|---|---|---|
| `10a10e079818cb0edc406758514f5d7a16bfcd536e50e0e888a5152de988b684` | 同左 | LF | `server/modules/credit-query.js` | SC101 / SC102 只读后端（新建） |
| `195b627ce17d2b5ab44ad3cd10264c5f960ecb3a932bb2d8fd7b1cc704f79020` | 同左 | LF | `server/modules/credit-rule-payload.js` | V2 语义化 Rule Payload（新建） |
| `1f11fbee91d9526b4604b5af9a16ecb38d5856dc77c3184d1ab1e478603029cc` | 同左 | LF | `server/modules/credit-check.js` | ONE_TIME 消费状态机（V2 + ONE_TIME 有界修订） |
| `5fc76f39b3b82358593d5ea443faeedb6e828610b185be1a9ea235c15cbf96e7` | 同左 | LF | `server/modules/credit-policy.js` | V2 CSP1 / CSP2 指纹（有界修订） |
| `f31033bd75520643c50202c18f640440aacbcde892595efad7d4e0ba2041a3bc` | 同左 | LF | `server/modules/credit-scope.js` | 冻结载荷，**逐字节未变** |
| `04594b3dc01240c5b3addddf50897fbeab54802daf9fbd7d49c5e36cccf289c4` | 同左 | LF | `server/modules/credit-special-approval.js` | 冻结载荷，**逐字节未变** |
| `8348456384e1d5bef8962e1078f792d710ecd9cc587734eff84034b63b5c94a5` | 同左 | LF | `server/migrations/sales-customer-wave11-a-credit-consumption.js` | 消费账本 Migration（新建） |
| `f82c31fb5b1a6cc5d69550f8f45a1f31ca2e33edb9064d38cea7064742176f37` | `8bd01b0ec8f71623efa6943789ff8c5ada9d51c854bbcf6bb961d5a8408595db` | CRLF | `server/migrations/sales-customer-domain.js` | Migration 注册表（+1 wave-11 步） |
| `8188be82cd92f79f01e18e8bb156e9e4f274534777c6198e63b58c8a41344204` | `5b35e91f2d3cf579d3787ef7c52839d85028c946c4edfe88fcd08b0b53f6f896` | CRLF | `server/app.js` | 3 条 GET 路由登记 |
| `ab6b23e26152b52171adb7f5b28bcdb4ac28572d3bf38af83eed8f9251c45f8c` | 同左 | LF | `server/sales-customer-wave11-a-credit-query.test.js` | U2 SQLite 验收套件（新建） |
| `d38c4f0028ccd522a1ac7b5c303e54d5602ca64afbda9d36518d70f424096a9f` | 同左 | LF | `server/mysql-sales-customer-wave11-a-credit-query.integration.js` | 真实 MySQL E3 套件（新建） |
| `e836163df10c54448a70650d85a8b4653c48e9e5dbe17691c5e666933acc8aa5` | 同左 | LF | `server/test-utils/wave11-a-credit-query-fixture.js` | 共享生产 Writer Fixture（新建） |
| `b280cb6c758a49b02f60a2fec81c8ea1ec6ff61e641dc96ff571225f42c304af` | 同左 | LF | `server/sales-customer-wave10-credit-check.test.js` | T-01..T-16 ONE_TIME 用例 |
| `a0929892e7d849b3706ab31217a40e67e55b64a1d26b666dc60a97bb3b51db3e` | `c3228663801f5df18e0bd5563d04d14f22e83046d4bd79c820116e3d504a448f` | CRLF | `server/sales-customer-wave0-migration-runner.test.js` | 注册表步数与 id 列表 |
| `c68d4707eaed7501d9f81e35a928755564ed5b2c97f5430fd708b67d7f73036b` | `79f541579f24fde497f5a661d2132eaac07d26e2112f4d93bcb74c3d2ef73d27` | CRLF | `scripts/sales-customer-wave11-a-primitives.test.js` | T5 七链证据链 + T6..T10 |
| `c3b9b7c6025774d9421d85246fdfb442e115b3c46aca43d6382ec04e67d867e2` | 同左 | LF | `scripts/gates/mysql-sales-wave11-a-gate.mjs` | 受保护 E3 Gate（新建） |
| `e9ad0b45c4d673e8bf19ab5dd8a8745e1c5aa3bc4b84bac9d6545ae8e93e9ca1` | `a86d25a2df40c49b19e1623174b4f3f19ceb17162450179ef852ab2d74edb2db` | CRLF | `scripts/testing/test-suites.js` | U2 套件 FULL 登记 |
| `22bb3103e51198592b5d4209f73f7dff22992f6d59e937f214dfd1e7ab5cc5e5` | `0f292be3a2504a29865065bfeb64be557a0d8a47502addd940327036b8d021c5` | CRLF | `package.json` | `test:mysql:wave11-a` 脚本项（+1/-0） |

#### 37.54.25.3 冻结证据链与独立校验

每条历史链接都**从 Git 对象重新计算**，并标注可复现该值的换行约定，因此每条链接都可对仓库对象
复核，而不是只对某一次 checkout 复核。

| 链接 | SHA-256 | 换行约定 | 独立校验 |
|---|---|---|---|
| W11-SEC-01 `credit-check.js` | `3bf4eb5190f3c8f59c0d7446fe07cd0264992126cffaa8616c1ccbecd7e272f0` | LF blob | `git show 177a8ea:…` MATCH |
| W11-SEC-01 `credit-policy.js` | `94f2df0a267722ba4d343315668dd82c2c3e5e723dde2363c785a5ecff6aa98b` | LF blob | `git show 177a8ea:…` MATCH |
| W11-SEC-01 `credit-scope.js` | `f31033bd75520643c50202c18f640440aacbcde892595efad7d4e0ba2041a3bc` | LF blob | `git show 177a8ea:…` MATCH |
| W11-SEC-01 `credit-special-approval.js` | `04594b3dc01240c5b3addddf50897fbeab54802daf9fbd7d49c5e36cccf289c4` | LF blob | `git show 177a8ea:…` MATCH |
| W11-SEC-01 `test-suites.js` | `6e75875ac6a4fd697221fa1523f8c25a513b27ced3efc7e88ea78ecfc42cca88` | blob 的 CRLF 渲染 | `git show 177a8ea:…` MATCH |
| U1 `credit-check.js` | `eceb2f775476caa008769c9040077aaea87a3191e3eb886175cddef67f9e8384` | LF blob | `git show ca9811a:…` MATCH |
| U1 `credit-policy.js` | `9088a222e58d85e24539500a65a9e2b97a347fb89b0e20544e0c4fc34924fea8` | LF blob | `git show ca9811a:…` MATCH |
| U1 `test-suites.js` | `b982808f0d74b5d0b3b2207f343c50e4c4a30bb10f005f9e599b2e4a4ce9e01d` | blob 的 CRLF 渲染 | `git show ca9811a:…` MATCH |
| U1 `sales-customer-wave11-a-primitives.test.js` | `37074ad129ca89cdb34e3ac40a95eb03073c2f6912ec65fee0043f269b5f8767` | blob 的 CRLF 渲染 | `git show ca9811a:…` MATCH |
| U1 `sales-customer-wave11-sec-scope.test.js` | `fb12c9e1c715438ff2ff5808109123b32ea902518e1ad16c652f23f7b6e1ba4c` | LF blob | `git show ca9811a:…` MATCH |
| V2 `credit-check.js` | `5c5a5a71aabaae01dc06d60305ca1886b608da0ad524f162a4447f22170e792b` | LF | **无 Git blob —— 仅文档记录** |
| V2 `credit-policy.js` | `5fc76f39b3b82358593d5ea443faeedb6e828610b185be1a9ea235c15cbf96e7` | LF | 当前工作树 MATCH |
| ONE_TIME `credit-check.js` | `1f11fbee91d9526b4604b5af9a16ecb38d5856dc77c3184d1ab1e478603029cc` | LF | 当前工作树 MATCH |

W11-SEC-01 原 14 项冻结载荷的**准确现状**：**11 项仍与原冻结版本逐字节相同**；3 项被后续获批的有界修订
取代（`credit-check.js` — U1 追加导出 → V2 版本化 Hash → ONE_TIME 消费；`test-suites.js` — U1 一项
FULL 登记 → U2-1 一项 FULL 登记；`package.json` — U2-1 一项 Gate 脚本项，`version` 字段未变）。
原 14 项指纹**永久保留**，未被重算、覆盖或作废；**未**执行 W11-SEC-01 Re-Freeze，**未**执行 U1 Re-Freeze。

**如实披露（B-9）**：`§37.54.15.10` 与 `log/2026-10-28.md` §7 的"其余 12 项 W11-SEC 冻结载荷逐项未变"
对 `package.json` **不准确**——该轮确实改动了一行（`test:mysql:wave11-a` 脚本项）。该改动本身已被
计划并授权（`log/2026-10-28.md` §1425），最小、纯追加、对版本号中性，但未列入该轮的冻结载荷增量块。
准确现状（11 / 14）以本节与 `document.md` 的 U2 Freeze Record 为准；既有记录**不被改写**。

#### 37.54.25.4 真实 MySQL E3 证据

```text
证据文件   %LOCALAPPDATA%\ModernERP\mysql-gate\evidence\w11-a-u2-e3-20261029-161412.tap.log
字节数     9492
SHA-256    52c18b1c02eccfaee447f8e7ed24e6b32eea52f36cbdcec65086f7af8c4a3ac7
目标实例   mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test
服务端     MySQL 8.0.37  uuid=256c7a4e-d275-11f1-885b-b025aa71d167
Grants     bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e（与固定基线一致）
结果       # tests 12 / # pass 12 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0
           GATE_EXIT_CODE=0   CLEANUP=CONFIRMED
           FINAL ZERO OBJECTS = {tables:0, views:0, triggers:0, routines:0, events:0}
```

TAP 保存在仓库之外，**不提交 Git**。此前失败的 Gate 历史**保留且未被覆盖**：

```text
w11-a-u2-e3-20261029-074456.tap.log  29198 B  3954a77b01ddacf6421aeaf54a30191c78c1d42738a844c1c75c612f004a580e  7/10（M2/M4/M9 FAIL）
w11-a-u2-e3-20261029-152933.tap.log  15304 B  4a8aeb9b5dc69538497939e8c4a0205e9f07aeece5f25689d420d2ccbf2a077f  10/12（T-17/T-18 FAIL）
w11-a-u2-e3-20261029-161412.tap.log   9492 B  52c18b1c02eccfaee447f8e7ed24e6b32eea52f36cbdcec65086f7af8c4a3ac7  12/12 PASS
```

**NOT_RUN 明示**：HEAVY 套件、浏览器 / 移动端验收、其它 MySQL Gate、独立的破坏性 MySQL migration
campaign、本轮**未**重跑 E3。以上一律不产生任何 PASS 声明。

#### 37.54.25.5 白名单例外收口

| 文件 | 变更 | 判定 |
|---|---|---|
| `server/sales-customer-wave0-migration-runner.test.js` | +3 / −3 | **收口**：注册表步数 10 → 11、step id 列表追加 `wave-11-a-credit-consumption`、标题更新。断言意图**增强**（新步必须存在）。 |
| `scripts/sales-customer-wave11-a-primitives.test.js` | +227 / −13 | **收口**：T5 基线重指向新授权的 ONE_TIME 基线，新增 T6..T10；T1..T4 逐字节未改；未弱化断言、未跳过用例。 |

两条例外身份 `W11_A_ONE_TIME_REPLAY_CORRECTION_BOUNDED_AMENDMENT` 与
`W11_A_ONE_TIME_WHITELIST_EXCEPTION_AMENDMENT` **均不重定义** W11-SEC-01 冻结基线。未发现其它
越界改动：新 Migration 已在 `SALES_CUSTOMER_MIGRATIONS` 正式登记；U2 套件仅登记于 **FULL**，
FAST / HEAVY / `validate()` / Runner 未变；历史文件未被覆盖；受保护 Runner / Launcher / Preflight /
Setup **未**被修改，新 Gate 复用既有唯一 `runProtectedMySqlCampaign` 属主。

#### 37.54.25.6 剩余风险与下一阶段边界

**A. U2 验收阻塞项：无。**

**B. 已披露的非阻塞限制**（B-1..B-9，完整表述见 `document.md` U2 Freeze Record §9）：T-17 只证明
**独立 MySQL 会话**之间的一次性消费，不等于任意并发交错（应用事务由全局事务闸门串行化，库层 UNIQUE
是与该串行化无关的引擎中立兜底）；V2 中间版本 `5c5a5a71…` 无 Git blob（已扫描仓库全部 blob 确认），
仅文档记录；SC102 不暴露"该例外是否已被审批释放"（设计 L-4）；`credit_check_results` 无
`special_approval_id` 列（设计 L-6）；TIME_BOUNDED / OBJECT_BOUNDED 既有语义未扩展（L-5）；
W11-A Credit Query **UI 不存在**且属 **U3** 范围；HEAVY / 浏览器 / 其它 MySQL Gate **NOT_RUN**；
T5 历史链接为硬编码常量、由审计对 Git blob 复核；U2-1 轮对 `package.json` 的单行改动未列入其冻结载荷
增量块（准确现状为 11 / 14）。

**C. 项目级发布阻塞（保持不变，非 U2 Capability Gate 失败，本轮不予解除）**：`W10-INV-RISK-01`
（`BLOCKS_RELEASE_ONLY`）、`CREDENTIAL_EXPOSURE_OPEN`（`USER_ACCEPTED / DEFERRED`）、
`LEGACY_DATA_EVIDENCE_PENDING`、`WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED`、D-2..D-5 继续阻塞
W11-B / W11-C。生产发布仍未获授权。

**冻结边界与下一阶段**：本节**签发** U2 Acceptance 与 U2 Capability Freeze，**不**签发
`W11_A_ACCEPTANCE_PASS`，**不**冻结 W11-A Package，**不**启动 U3 / W11-B / W11-C / W11-D，
**不**执行 Git 写操作、Release、Deploy、Version 或 Tag 变更。后续顺序为：① 独立执行 Git Closure；
② 核对全部 U2 文件与历史 U1 归属；③ 在用户明确批准后再执行 Git Commit / Push；④ Git Closure 完成后再
启动 W11-A U3 的独立授权流程。

**Status: `W11_A_U2_FINAL_ACCEPTANCE_PASS — FROZEN`.**

---

### 37.54.26 W11-A OVERDUE Evidence Foundation — Bounded Design (2026-10-29)

#### 37.54.26.1 Phase identity and constraints

This design implements the approved Requirement identity
`W11_A_OVERDUE_EVIDENCE_FOUNDATION` and closes the design portion of
`W11_A_U3_0_POST_FREEZE_SC102_CONTRACT_GAP`. It is a forward-only amendment proposal, not an
implementation and not a U2 re-freeze.

Preserved without semantic change:

- W11-SEC, W11-A U1 and W11-A U2 historical records and Git objects;
- CSP1/CSP2, CCHK1/CCHK2 inputs and digests;
- Credit decisions, limits, exposure amounts, policy/profile snapshot identity;
- Special Approval and ONE_TIME consumption;
- Finance AR writers, effect tables, balance equation and reversal behavior;
- five-level Credit Read Mode and non-enumerable detail 404.

No new AR table, Exception ledger, permission, route, decision or Finance lock order is introduced.

#### 37.54.26.2 Canonical fact read and observation boundary

`computeCreditExposure()` remains the sole Credit projection owner. Its existing
`readOpenReceivables()` statement already reads the authoritative fields needed by the evidence:

```text
id, customer_id, source_type, source_id, amount_cents, open_amount_cents,
recognition_mode, item_kind, item_class, due_date, business_date,
conversion_state (in the WHERE predicate)
```

The implementation extends the internal projection result; it must not issue a second AR query for
overdue classification. While the existing receivable loop derives `arOpenCents` and salesperson
attribution, it also constructs a deterministic, `id ASC` list of evidence inputs from those exact row
objects and the exact attribution result.

The read statement is the observation boundary. `observedAt` is generated once immediately before the
canonical exposure read and is reused as every new scope Result's `evaluated_at` and evidence
`capturedAt`. A concurrent Finance mutation committed after that SELECT does not rewrite the observed
fact; a later Check reads a new projection. This amendment takes no new Finance lock and does not claim
an arbitrary historical transaction snapshot.

The evidence basis is named `CANONICAL_AR_OBSERVED_AT_CHECK`. It means:

```text
classification date = requested Credit businessDate
balance              = canonical current open_amount_cents observed by that Check
capture time         = observedAt
historical claim     = only the immutable observation, never reconstructed as-of Finance state
```

#### 37.54.26.3 Evidence calculation

Add one pure internal builder, conceptually:

```text
buildOverdueEvidence({
  scopeType, profile, businessDate, observedAt, salespersonId,
  receivableEvidenceInputs
}) -> overdueEvidence
```

It performs no SQL and no write. Calendar-day arithmetic uses UTC date-only values. Invalid dates,
unsafe cents or unprovable attribution produce UNKNOWN facts; they are never coerced.

Grace resolution:

```text
CUSTOMER_AGGREGATE:
  graceDays = 0
  policySource = DUE_DATE_CONTRACT

SALESPERSON_SUB_LIMIT:
  first valid non-negative safe integer from:
    1. effective profile.overdue_day_policy
    2. effective CREDIT_SUB_LIMIT_OVERDUE_DAYS parameter
  otherwise policySource = UNDEFINED and negative proof is UNKNOWN
```

Per source:

```text
daysPastDue = max(0, UTC-day-difference(businessDate, dueDate))
OVERDUE     = relevantOpenCents > 0 AND daysPastDue > graceDays
NOT_DUE     = relevantOpenCents > 0 AND daysPastDue <= graceDays
UNKNOWN     = missing/invalid due date, unsafe amount, undefined required grace,
              or unprovable Sub-Limit attribution
```

Aggregate `relevantOpenCents` is the row's observed open amount. Sub-Limit uses the existing
`PROVABLY_ATTRIBUTABLE` amount or the existing conserved `PROVABLY_ALLOCATED` amount for that
salesperson. No proportional remainder allocation is added. Ambiguous positive AR is recorded as an
unknown source for the Sub-Limit and remains governed by the existing `UNPROVEN_ATTRIBUTION` decision
branch.

Overall evidence status:

```text
if overdueOpenAmountCents > 0                       -> PROVEN_OVERDUE
else if every relevant positive source is provable -> PROVEN_NOT_OVERDUE
else                                                -> UNKNOWN
```

`completeness` is `COMPLETE` only when every relevant positive source is provable; otherwise
`PARTIAL`. Thus `PROVEN_OVERDUE + PARTIAL` is valid: existence is proven but the amount is a lower
bound and the UI must label it as incomplete.

#### 37.54.26.4 Immutable payload design; no Schema migration

Use the existing immutable `credit_check_results.component_breakdown_json`. Keep its base
`contractVersion: CREDIT_EXPOSURE_BREAKDOWN_WAVE10_V1` and append one sibling property:

```json
{
  "overdueEvidence": {
    "evidenceVersion": "CREDIT_OVERDUE_EVIDENCE_V1",
    "basis": "CANONICAL_AR_OBSERVED_AT_CHECK",
    "classificationBusinessDate": "YYYY-MM-DD",
    "capturedAt": "ISO-8601",
    "scopeType": "CUSTOMER_AGGREGATE | SALESPERSON_SUB_LIMIT",
    "status": "PROVEN_OVERDUE | PROVEN_NOT_OVERDUE | UNKNOWN",
    "completeness": "COMPLETE | PARTIAL",
    "gracePolicy": {
      "source": "DUE_DATE_CONTRACT | CREDIT_PROFILE | CREDIT_PARAMETER | UNDEFINED",
      "days": 0,
      "profileId": "nullable",
      "parameterCode": "nullable"
    },
    "observedOpenAmountCents": 0,
    "overdueOpenAmountCents": 0,
    "sourceCount": 0,
    "overdueSourceCount": 0,
    "unknownSourceCount": 0,
    "sourceFacts": [
      {
        "openItemId": "...",
        "dueDate": "YYYY-MM-DD|null",
        "observedOpenAmountCents": 0,
        "relevantOpenAmountCents": 0,
        "attribution": "AGGREGATE|PROVABLY_ATTRIBUTABLE|PROVABLY_ALLOCATED|UNKNOWN",
        "daysPastDue": "integer|null",
        "classification": "OVERDUE|NOT_OVERDUE|UNKNOWN"
      }
    ],
    "evidenceDigest": "sha256-lower-hex"
  }
}
```

`sourceFacts` is sorted by `openItemId`, then attribution identity. It contains only canonical Finance
identities and observed amounts; no customer name, order number or guessed identity is stored.
`evidenceDigest` is SHA-256 of the canonical object excluding the digest field. It is payload-integrity
evidence only and is deliberately excluded from CSP2, CCHK2, `exposureDigest`, decision and replay
identity.

No new physical column or migration is required. Old payloads have no `overdueEvidence` path and are
presented as `UNKNOWN`. This is the minimum additive storage design and avoids duplicating the same
fact into a new column or table.

#### 37.54.26.5 Transaction, replay and atomicity

The builder executes inside the existing caller-owned Credit Check transaction. The evidence object is
serialized in the same `INSERT credit_check_results` statement as the decision and existing breakdown.
Insert failure rolls back the complete business transaction; there is no evidence-only row or partial
write.

Exact replay behavior:

- an existing Result is returned unchanged; its stored evidence is never recomputed or patched;
- a pre-amendment Result remains UNKNOWN;
- `storedBreakdownMatches()` continues comparing the frozen Wave 10 decision/exposure members and
  ignores the additive evidence sibling;
- no evidence member enters CCHK1/CCHK2, CSP1/CSP2, rule/profile hashes or ONE_TIME identity;
- a new fact set that changes open exposure already changes the existing `exposureDigest` and follows
  the existing new-Check path.

The production code has no ordinary writer that mutates `account_receivables.due_date`. If a future
authorized Finance design permits such mutation, it must separately decide whether due-date identity
enters Credit replay identity; this amendment does not silently add that behavior.

#### 37.54.26.6 Five-category predicate model

Add optional single-valued `category` to the existing `GET /api/credit/exceptions`. Accepted values:

```text
OVER_LIMIT | OVERDUE | WARNING | BLOCK | SPECIAL_APPROVAL
```

Validation is case-normalized and fail-closed; any other non-empty value returns HTTP 400
`CREDIT_QUERY_INVALID_INPUT`.

The category expression is appended to `buildExceptionQuery()` after the canonical Credit scope
predicate and before the shared `{ where, args }` is returned. Existing COUNT and LIST therefore use
the identical authorized predicate before pagination.

Exact SQLite predicates:

```sql
-- OVER_LIMIT
EXISTS (
  SELECT 1 FROM json_each(r.reason_codes_json) rc
  WHERE rc.value = 'OVER_LIMIT'
)

-- OVERDUE
json_extract(r.component_breakdown_json,'$.overdueEvidence.evidenceVersion')
  = 'CREDIT_OVERDUE_EVIDENCE_V1'
AND json_extract(r.component_breakdown_json,'$.overdueEvidence.status')
  = 'PROVEN_OVERDUE'
AND CAST(json_extract(
  r.component_breakdown_json,'$.overdueEvidence.overdueOpenAmountCents'
) AS INTEGER) > 0

-- WARNING / BLOCK
r.decision = 'WARNING'
r.decision = 'BLOCK'

-- SPECIAL_APPROVAL
(r.decision = 'SPECIAL_APPROVAL_REQUIRED'
 OR EXISTS (
   SELECT 1 FROM credit_special_approval ca
   WHERE ca.source_credit_check_result_id = r.id
 ))
```

Exact MySQL predicates:

```sql
-- OVER_LIMIT
JSON_CONTAINS(r.reason_codes_json, JSON_QUOTE('OVER_LIMIT'), '$') = 1

-- OVERDUE
JSON_UNQUOTE(JSON_EXTRACT(
  r.component_breakdown_json,'$.overdueEvidence.evidenceVersion'
)) = 'CREDIT_OVERDUE_EVIDENCE_V1'
AND JSON_UNQUOTE(JSON_EXTRACT(
  r.component_breakdown_json,'$.overdueEvidence.status'
)) = 'PROVEN_OVERDUE'
AND CAST(JSON_UNQUOTE(JSON_EXTRACT(
  r.component_breakdown_json,'$.overdueEvidence.overdueOpenAmountCents'
)) AS SIGNED) > 0

-- WARNING / BLOCK / SPECIAL_APPROVAL
-- identical relational predicates to SQLite
```

Values must be bound parameters in implementation; literals above specify semantics. No `LIKE`, raw
substring or client-side post-pagination filter is allowed. Missing JSON paths evaluate non-matching,
which gives old UNKNOWN rows correct prospective compatibility.

#### 37.54.26.7 DTO and U3 consumer contract

`exceptionItem()` adds:

```text
categories: exact persisted categories in stable order
overdueEvidence: parsed evidence or {
  evidenceVersion: null,
  status: 'UNKNOWN',
  completeness: 'PARTIAL',
  reason: 'EVIDENCE_NOT_CAPTURED'
}
specialApprovalRequiredAtCheck: decision === SPECIAL_APPROVAL_REQUIRED
hasApprovalAssociation: approval != null
```

The stable category order is `OVER_LIMIT, OVERDUE, WARNING, BLOCK, SPECIAL_APPROVAL`. DTO derivation
uses the same exact facts as the SQL predicates. A malformed recognized evidence version fails closed
with `CREDIT_OVERDUE_EVIDENCE_INVALID`; it is not silently interpreted as not overdue.

U3 may display and filter these stored historical categories. It must label the evidence as captured
historical Check evidence and must not display newly computed `/api/credit/exposure` as the historical
snapshot. UNKNOWN remains visible on detail and never becomes FALSE.

#### 37.54.26.8 Permission and privacy

The existing `creditScopePredicate()` remains the first predicate over `credit_check_results`.
Category clauses only narrow that set. The category COUNT cannot enumerate invisible rows. The Detail
handler first resolves the same authorized Result; only then may its stored Finance identities be
serialized. No `FINANCE_AR_VIEW` permission is added: the evidence is part of an already authorized
Credit Result, contains only minimum identities/amounts, and exposes no broader live Finance query.

#### 37.54.26.9 Amendment identity and frozen-file protection

Future implementation identity:

`W11_A_OVERDUE_EVIDENCE_FORWARD_ONLY_AMENDMENT`

Protected Before SHA-256 values at this Design baseline:

| File | Before SHA-256 | Planned disposition |
|---|---|---|
| `server/modules/credit-check.js` | `1f11fbee91d9526b4604b5af9a16ecb38d5856dc77c3184d1ab1e478603029cc` | bounded amendment |
| `server/modules/credit-query.js` | `10a10e079818cb0edc406758514f5d7a16bfcd536e50e0e888a5152de988b684` | bounded amendment |
| `server/test-utils/wave11-a-credit-query-fixture.js` | `e836163df10c54448a70650d85a8b4653c48e9e5dbe17691c5e666933acc8aa5` | bounded fixture extension |
| `server/mysql-sales-customer-wave11-a-credit-query.integration.js` | `d38c4f0028ccd522a1ac7b5c303e54d5602ca64afbda9d36518d70f424096a9f` | bounded MySQL evidence extension |
| `scripts/testing/test-suites.js` | `a86d25a2df40c49b19e1623174b4f3f19ceb17162450179ef852ab2d74edb2db` | register one new FULL test only if required |

The following frozen regressions are not planned for editing and must remain byte-identical:

| File | Frozen comparison SHA-256 |
|---|---|
| `server/sales-customer-wave10-credit-check.test.js` | `b280cb6c758a49b02f60a2fec81c8ea1ec6ff61e641dc96ff571225f42c304af` |
| `server/sales-customer-wave11-a-credit-query.test.js` | `ab6b23e26152b52171adb7f5b28bcdb4ac28572d3bf38af83eed8f9251c45f8c` |

Implementation Closure must record every After SHA-256. A changed frozen comparison file is an
unauthorized scope breach unless the user separately approves it. Historical Freeze SHA values remain
historical and are never overwritten by the new After values.

#### 37.54.26.10 Exact implementation whitelist

The future U3-0 amendment is limited to:

```text
M server/modules/credit-check.js
M server/modules/credit-query.js
M server/test-utils/wave11-a-credit-query-fixture.js
A server/sales-customer-wave11-a-overdue-evidence.test.js
M server/mysql-sales-customer-wave11-a-credit-query.integration.js
M scripts/testing/test-suites.js              only to classify the new test in FULL
M document.md                                 implementation/acceptance append only
M solution.md                                 implementation/acceptance append only
M log/<implementation-date>.md                append only
```

Explicitly excluded:

- `server/app.js` (the endpoint already exists);
- every migration and schema file;
- Finance production modules and Finance effect/due-schedule tables;
- `package.json`, version, tag and release files;
- U3 route/page/UI files;
- the two frozen comparison test files above.

If implementation proves that a migration, Finance writer change, CCHK/CSP identity change or a file
outside this list is necessary, it must HARD STOP and return to Requirement/Design.

#### 37.54.26.11 Test and acceptance matrix

Future tests are not currently executed and carry no PASS claim.

| Area | Required evidence | Planned owner |
|---|---|---|
| Not due / boundary / overdue | due future, equal date, one day past, grace boundary + one | new SQLite foundation test |
| Missing due / invalid amount / undefined grace | UNKNOWN; never false/overdue | new SQLite foundation test |
| Zero / partial / full settlement | evidence uses observed canonical open cents | new SQLite test + existing Finance writers |
| Reversal | later Check sees reopened canonical amount; old Result unchanged | new SQLite test |
| Multiple AR | exact sum, stable identities/digest, no duplicate | new SQLite test |
| Aggregate/Sub-Limit | aggregate all; sub-limit exact attribution; ambiguity UNKNOWN | new SQLite + MySQL cases |
| Five categories | exact predicates and legal overlap | SQLite + protected MySQL extension |
| Old rows | missing evidence path -> UNKNOWN; not returned by OVERDUE filter | SQLite + MySQL |
| Pagination | filtered total/list identical, stable order, no client filtering | SQLite + MySQL |
| Five read modes / 404 | no scope widening or enumeration | reuse U2 suite + new category cases |
| GET zero-write | repeated list/detail category calls preserve DB digest | reuse U2 snapshot helper |
| Atomic failure | failed Check creates no Result/evidence/audit residue | new SQLite test |
| Replay | same Check reuses immutable evidence; CCHK2/CSP2 unchanged | new test + frozen Wave 10 suite |
| ONE_TIME | consumption and replay unchanged | frozen U2 regression + protected MySQL E3 when authorized |
| Cross-engine JSON | identical category membership and DTO | SQLite/MySQL parity assertions |
| Browser/U3 | UI consumes real Backend filter; mock is supplemental only | later U3-5, not this amendment |

Required gates after a separately authorized implementation:

```text
focused new SQLite suite
existing Wave 10 Credit Check suite
existing W11-A U2 Credit Query suite
pnpm test
pnpm build
git diff --check
protected disposable MySQL W11-A gate with added parity cases
```

Heavy, other MySQL campaigns and browser evidence run only when their later stage is separately
authorized. None is claimed by this Design.

#### 37.54.26.12 Risks and explicit non-decisions

- JSON category predicates are exact and portable through dialect-specific builders but are not
  indexed. Correctness closes in this amendment; performance at very large history volume remains an
  observable risk. An indexed/generated column requires separate evidence and authorization, not an
  implicit migration.
- The existing Credit exposure read does not lock AR rows. Evidence therefore proves the same
  statement-observed fact used by the decision, not a new cross-domain serialization guarantee.
- Header `due_date` is the current Credit/Finance fact. Mutable multi-date due schedules are excluded;
  adopting schedule-level aging would be a separate Finance Requirement.
- This amendment does not make overdue a decision input. Any future request to block/warn based on
  overdue facts is a separate Credit policy change.
- U3 route, selector, navigation and mobile page remain blocked until this Backend amendment receives
  its own Implementation, Acceptance and Freeze authorization.

#### 37.54.26.13 Design conclusion

The forward-only evidence path is technically closed without Finance economic-write changes, Schema
migration, historical backfill, CCHK/CSP changes or a second ledger. Requirement and Design evidence
remain separate; this section records Design only.

**Design status: `W11_A_OVERDUE_FOUNDATION_DESIGN_READY`.**

HARD STOP. Implementation, tests, database operations, Git writes, U3 UI, Release and Deploy remain
unauthorized.

### 37.54.27 OVERDUE Foundation Implementation and T5 forward-chain exception record (2026-10-29)

#### 37.54.27.1 Authorization and exact scope

The owner separately authorized the bounded implementation and then, after the original T5 hard stop,
authorized `W11_A_OVERDUE_T5_FORWARD_CHAIN_WHITELIST_AMENDMENT`. The latter adds exactly
`scripts/sales-customer-wave11-a-primitives.test.js` to the prior nine-path implementation whitelist.
No Schema, Migration, Finance production writer, UI, version, tag, release or deployment surface is
included. The previous hard stop was caused by T5 still requiring the current `credit-check.js` to equal
the U2 ONE_TIME digest after the approved prospective OVERDUE implementation had extended that same
canonical owner.

#### 37.54.27.2 Forward evidence chain

T5 keeps all seven historical values and identities, and appends one static eighth value:

1. W11-SEC credit-check: `3bf4eb5190f3c8f59c0d7446fe07cd0264992126cffaa8616c1ccbecd7e272f0`;
2. W11-SEC credit-policy: `94f2df0a267722ba4d343315668dd82c2c3e5e723dde2363c785a5ecff6aa98b`;
3. U1 credit-check: `eceb2f775476caa008769c9040077aaea87a3191e3eb886175cddef67f9e8384`;
4. U1 credit-policy: `9088a222e58d85e24539500a65a9e2b97a347fb89b0e20544e0c4fc34924fea8`;
5. V2 credit-check: `5c5a5a71aabaae01dc06d60305ca1886b608da0ad524f162a4447f22170e792b`;
6. V2 credit-policy: `5fc76f39b3b82358593d5ea443faeedb6e828610b185be1a9ea235c15cbf96e7`;
7. ONE_TIME credit-check: `1f11fbee91d9526b4604b5af9a16ecb38d5856dc77c3184d1ab1e478603029cc`;
8. OVERDUE forward credit-check: `6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1`.

The current source assertion compares LF-normalized content with the static
`OVERDUE_EVIDENCE_FORWARD_CREDIT_CHECK_SHA256`; the V2 policy assertion and the distinct-link,
Scope, hash-builder, fingerprint and single-resolver assertions remain active. T1-T4 and T6-T10 were
not weakened, skipped or converted to dynamic expected values. The LF-normalized primitives test file
changed from `c68d4707eaed7501d9f81e35a928755564ed5b2c97f5430fd708b67d7f73036b` to
`d047f087cf365e41c61badf72cbdfd87cd53a8adedeb94bbbb7a368c24787488`.

Independent `git show` reproduction confirmed the W11-SEC pair at `177a8ea`, the U1 pair at
`ca9811a`, and the U2 ONE_TIME/policy pair at
`e281f458836ad5c6b4a2900063ffb90141e8c6c1`. This is a forward amendment, not a rewrite or U2
re-freeze.

#### 37.54.27.3 Implemented E0 contract

The implementation reuses the exact AR observation made by `computeCreditExposure()` and writes
`CREDIT_OVERDUE_EVIDENCE_V1` into the same immutable Result payload. Evidence remains outside the
Credit decision, CSP/CCHK and exposure digest. Exact replay returns the persisted payload; historical
rows without evidence remain UNKNOWN; malformed recognized evidence fails closed; no backfill, second
AR truth source or historical Result rewrite exists. Aggregate and Sub-Limit grace/attribution remain
separate. The UTC date proof gate allows proof only when `classificationBusinessDate` equals the UTC
date of `capturedAt`; backdated and future-date observations degrade to UNKNOWN. Invalid negative and
out-of-safe-range cents are explicitly UNKNOWN. Cents are projected as decimal text per dialect before
classification so SQLite cannot throw before that approved boundary is applied. Internal `sourceFacts`
are removed from both public evidence and `recordedBreakdown`.

SC102 implements the five exact, overlapping server categories through dialect-specific JSON
predicates. COUNT and LIST share the same authorized predicate, UNKNOWN never matches OVERDUE, and all
GET paths remain zero-write and preserve 404 non-enumeration.

#### 37.54.27.4 Verification evidence and remaining boundary

- syntax checks: PASS;
- T5 plus OVERDUE focused run: 19/19 PASS (T1-T10 and E-01-E-09);
- frozen combined U1/U2/W11-SEC/Wave10/OVERDUE run: 146/146 PASS;
- FAST: 500/500 PASS, 37 suites;
- FULL: 3030/3030 PASS, 359 suites, zero fail/skip/todo;
- frontend build: PASS, 1965 modules transformed;
- `git diff --check`: PASS;
- M11/M12: present as enabled top-level protected-gate cases and syntax/static contract checked only.

No real MySQL command was run: `MYSQL_OVERDUE_GATE_NOT_RUN`. Therefore engine parity, native MySQL JSON
execution and protected cleanup remain the next separately authorized evidence boundary. No Acceptance,
Freeze, Git write, U3 implementation or release is claimed here.

**Implementation status: `W11_A_OVERDUE_FOUNDATION_IMPLEMENTED_READY_FOR_MYSQL`.**

### 37.54.28 OVERDUE E3 M8/M9 bounded cross-engine comparison amendment (2026-10-29)

#### 37.54.28.1 Authorization, evidence boundary and root cause

The owner authorized only the M8/M9 comparison amendment in
`server/mysql-sales-customer-wave11-a-credit-query.integration.js`, with optional shared-Fixture use
only if necessary, plus append-only Design/Journal evidence. Production Credit modules, Schema,
Migration, Gate/Runner, package, UI, frozen regression tests, real MySQL execution and Git writes were
not authorized. The shared Fixture was not changed by this amendment.

The user-supplied failed artifact is retained under identity
`W11_A_OVERDUE_E3_1_FAIL_M8_M9`: `w11-a-overdue-e3-20261029-212733.tap.log`, 14 tests, 12 PASS,
M8/M9 FAIL, M11/M12/T17/T18 PASS, no skip/cancel/todo, exit code 1 and final five-class cleanup zero.
The raw TAP file was not accessible in the repository, the available Codex attachments or the searched
project paths, so no unavailable diagnostic line is reconstructed or quoted.

An independent two-SQLite reproduction used the production migration chain, the shared fixture and the
original M8 full-field projection. Across 10 history rows it found 25 value differences whose distinct
field suffixes were exactly:

1. `overdueEvidence.capturedAt` — legitimate capture-time difference;
2. `overdueEvidence.gracePolicy.profileId` — legitimate independent-database UUID difference;
3. `overdueEvidence.evidenceDigest` — legitimate consequence because the canonical digest binds the
   preceding engine-local facts.

No Credit decision, reason code, amount, evidence classification, business date, scope, authorization,
COUNT, order or pagination field differed. Any fourth field would have failed the reproduction instead
of entering the amendment path.

#### 37.54.28.2 Correct comparison contract

`normalizeOverdueEvidence()` now proves each engine's evidence before producing a stable cross-engine
projection. It reads the raw persisted Result payload, independently recomputes
`contentDigest(unsignedEvidence)`, requires exact digest equality, and proves a protected overdue-amount
mutation cannot satisfy that digest. The public DTO and `recordedBreakdown` must both equal the persisted
payload with only private `sourceFacts` removed.

`capturedAt` must be canonical ISO UTC, lie inside that engine's fixture capture window and remain the
exact persisted/read value. The referenced Result Profile and grace Profile must exist in that engine,
match the Customer, credit object and Aggregate/Sub-Limit scope, be ACTIVE/effective where applicable,
and the grace Profile must be the Result's effective Profile. Only after these assertions pass are the
three engine-local values projected to stable proof tokens/business keys. Every other business field is
still deeply compared by M8/M9. M11's byte-for-byte replay assertion continues to prove that replay does
not replace the timestamp, Profile identity or digest.

M8 continues to compare ALL, DENY, CROSS_GROUP, AGGREGATE_ONLY and AGGREGATE_PLUS_SELF histories,
including full business sequences and invisibility of unauthorized rows. M9 continues to compare full
page items and authorized totals, prove no overlap/stable order, and require out-of-scope Detail to be
indistinguishable from absent Detail. No status-only, total-only or length-only substitute was added.

#### 37.54.28.3 Verification and frozen-chain preservation

- syntax/import: PASS;
- OVERDUE SQLite E-01–E-09: 9/9 PASS;
- U1 T1–T10: 10/10 PASS;
- U2 SQLite regression: 38/38 PASS;
- combined U1/U2/W11-SEC/Wave10/OVERDUE regression: 146/146 PASS, no fail/skip/todo;
- `git diff --check`: PASS;
- M1–M12 and T17/T18 remain enabled top-level tests; no skip/todo/only marker exists;
- FAST 500/500, FULL 3030/3030 and Build PASS are retained from the immediately preceding Foundation
  verification on the same ten-path implementation worktree, before this MySQL-test-only amendment;
  they were not falsely reported as rerun here.

LF-normalized SHA verification: `credit-check.js` remains
`6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1`; primitives remains
`d047f087cf365e41c61badf72cbdfd87cd53a8adedeb94bbbb7a368c24787488`; frozen Wave 10 and U2
comparison tests remain respectively `b280cb6c758a49b02f60a2fec81c8ea1ec6ff61e641dc96ff571225f42c304af`
and `ab6b23e26152b52171adb7f5b28bcdb4ac28572d3bf38af83eed8f9251c45f8c`. The current amended
integration test is `c0bf832a83169560c3dfa8d2ed04618ac890f37d1efbc853f6770e25352426ea`.

No real MySQL command was run. The amendment therefore ends at `MYSQL_RERUN_PENDING`; it does not claim
that M8/M9 now pass on MySQL and does not erase the retained failed E3 artifact.

**Status: `W11_A_OVERDUE_E3_M8_M9_AMENDMENT_READY_FOR_RERUN`.**

### 37.54.29 OVERDUE E3-2 M12 deterministic legacy-row correction (2026-10-29)

#### 37.54.29.1 E3-2 evidence and exact engine direction

The owner supplied the second protected E3 result under identity
`W11_A_OVERDUE_E3_2_FAILED_M12_OVERDUE_TOTAL_PARITY`: artifact
`w11-a-overdue-e3-rerun-20261029-215236.tap.log`, raw SHA-256
`65d08307bc9edcf8f017bdd34821c1fbf6ee9a369f14a1d41f66cbbfee9d6e48`, 14 tests / 13 PASS /
M12 FAIL, no skip/todo, exit code 1 and confirmed five-class cleanup. Node's strict-equality diagnostic reports
the first argument as actual and the second as expected; M12 calls `assert.equal(mysql.total,
sqlite.total)`. Therefore `actual=1` is MySQL and `expected=2` is SQLite.

#### 37.54.29.2 Root cause and pollution boundary

M8/M9 do not mutate the shared database. Their added helper performs SELECTs, parses detached JSON,
constructs a new tampered in-memory object for digest rejection, and asserts DTO/persistence/Profile
relationships. The measured GET phase is also guarded by complete before/after database digests. M11
intentionally adds the same dedicated receivable and two Result scopes to each engine, then proves exact
replay does not rewrite them.

The mutation was inside M12 itself:

```sql
SELECT id,component_breakdown_json FROM credit_check_results ORDER BY id LIMIT 1
```

`id` begins with CCHK2, whose Profile inputs contain independent engine-local UUIDs. Ordering by that
physical digest does not identify the same logical row across engines. M12 then deleted
`overdueEvidence` from whichever unrelated row happened to sort first. A 20-run isolated SQLite audit
reproduced both branches: selecting a non-OVERDUE row preserved total 2, while selecting the M11 group
reduced total 2 to 1. In the latter branch the selected row was exactly
`so-cus-w11-self / CUSTOMER_AGGREGATE / SO_SUBMIT / 2026-10-29`, with
`CREDIT_OVERDUE_EVIDENCE_V1 / PROVEN_OVERDUE`; its sibling Sub-Limit row remained, hence total 1.

This is test-fixture state coupling through a randomized physical identity, not a production Category
SQL defect and not an M8/M9 write leak.

#### 37.54.29.3 Bounded correction

M12 now selects exactly one stable old-payload conversion target by the approved business identity:

`so-cus-w11-other + SALESPERSON_SUB_LIMIT + cus-w11-other + sp-other`.

It requires one candidate, proves the candidate initially carries prospective evidence, proves it is
not an OVERDUE member, compares its complete stable logical identity/evidence classification across
engines, removes evidence from that exact row, and rereads persistence to prove the old payload shape.
Thus the compatibility fixture cannot alter the genuine M11 OVERDUE set.

M12 also changed each category read from a one-row page to a complete bounded 200-row result and now
requires LIST length = authorized COUNT and compares stable logical business row sets, not merely totals.
The comparison retains source identity, scope, stable Profile business key, stage, business date,
decision, reasons, approval association and all deterministic evidence/classification amounts and
counts. Engine-local timestamp/digest/UUID fields remain excluded only under the already-proven M8/M9
integrity contract.

#### 37.54.29.4 Production predicate and proof-gate conclusion

No production change is necessary. The MySQL predicate requires JSON-unquoted V1 version,
`PROVEN_OVERDUE` and signed numeric amount greater than zero; SQLite requires the same three facts via
`json_extract` and integer cast. Both COUNT and LIST use the same authorized WHERE and parameter list.
The E3-2 direction is fully explained by M12 deleting one MySQL evidence member before the query, while
the other four category comparisons passed.

The M11 pair uses the same `TODAY` classification date in each engine and real runtime `capturedAt`;
the prospective proof gate remains unchanged. UNKNOWN is not counted as OVERDUE, replay remains
immutable, and no historical Result outside the disposable test mutation is rewritten.

#### 37.54.29.5 Verification and hashes

- syntax/import: PASS;
- combined U1/U2/W11-SEC/Wave10/OVERDUE regression: 146/146 PASS, zero fail/skip/todo;
- `git diff --check`: PASS;
- M1–M12/T17/T18: 14 unique enabled top-level tests; no skip/todo/only;
- FAST 500/500, FULL 3030/3030 and Build PASS remain the preceding Foundation evidence and were not
  represented as rerun after this integration-test-only correction.

LF-normalized integration SHA changed from
`c0bf832a83169560c3dfa8d2ed04618ac890f37d1efbc853f6770e25352426ea` to
`51c07397e2deee9d8c84676d09af4504dc9bfb77982dc372472d9b00bd295892`. Production
`credit-query.js` remains `24889d82a602cd2cd1187dd11807bbfa163f584b7fb6c13f55f62cdb0d04133b` and the
shared Fixture remains `80a251a2cd05f58746490280683b905414b8d6b05f6eb91535e6d818ffbb9eab`.
The frozen credit-check, primitives, Wave10 and U2 comparison SHAs remain unchanged.

No real MySQL rerun occurred. The next state is `MYSQL_RERUN_PENDING`.

**Status: `W11_A_OVERDUE_E3_M12_CORRECTION_READY_FOR_RERUN`.**

### 37.54.30 OVERDUE Foundation Final Acceptance and Freeze evidence summary (2026-10-29)

#### 37.54.30.1 Authorization and frozen object

After reviewing the complete evidence report, the user explicitly approved Final Acceptance PASS /
FROZEN for exactly `W11_A_OVERDUE_EVIDENCE_FORWARD_ONLY_AMENDMENT`. The formal Requirement-side
record is `document.md` → “W11-A OVERDUE Evidence Foundation Final Acceptance and Capability Freeze
Record (2026-10-29)”. This summary does not expand that scope and does not freeze W11-A Package or U3.

#### 37.54.30.2 Technical acceptance evidence

The accepted design and implementation preserve one canonical Finance AR observation, prospective-only
versioned evidence in the immutable Check Result, historical UNKNOWN, UTC proof, Aggregate/Sub-Limit
grace and attribution, independent digest verification, exact Replay, privacy projection, five exact
categories, authorization-scoped COUNT/list/detail, zero-write GET and SQLite/MySQL parity. Evidence
remains outside Credit Decision, exposure digest, CSP/CCHK and ONE_TIME identity.

Local evidence is E-01–E-09 9/9, U1 T1–T10 10/10, Combined 146/146, FAST 500/500, FULL 3030/3030,
Build PASS and diff-check PASS, with execution rounds accurately separated. The final protected MySQL
artifact `w11-a-overdue-e3-3-20261029-220531.tap.log` is 10528 raw bytes, UTF-16 LE with BOM, SHA-256
`69aeda58e704c85cbbf0a49d247b5b6d8867152f082530bb225dbdf53a7c71ce`; MySQL 8.0.37 passed
M1–M12 and T17/T18, 14/14, exit 0, no skip/cancel/todo and confirmed five-class cleanup. E3-1
`ab953837…b01d` (M8/M9) and E3-2 `65d08307…6e48` (M12) remain preserved failure evidence.

#### 37.54.30.3 Frozen payload and historical compatibility

The seven canonical LF SHA-256 values are:

```text
6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1  server/modules/credit-check.js
24889d82a602cd2cd1187dd11807bbfa163f584b7fb6c13f55f62cdb0d04133b  server/modules/credit-query.js
80a251a2cd05f58746490280683b905414b8d6b05f6eb91535e6d818ffbb9eab  server/test-utils/wave11-a-credit-query-fixture.js
d9be1fe267afbf94913984c69d24dd1b581721167a99f14e61be1b4abb06dc55  server/sales-customer-wave11-a-overdue-evidence.test.js
51c07397e2deee9d8c84676d09af4504dc9bfb77982dc372472d9b00bd295892  server/mysql-sales-customer-wave11-a-credit-query.integration.js
d047f087cf365e41c61badf72cbdfd87cd53a8adedeb94bbbb7a368c24787488  scripts/sales-customer-wave11-a-primitives.test.js
9b94aa98230d984b97eabe7631127cf0c307022d272153ffc6093f5efbce040d  scripts/testing/test-suites.js
```

The primitives and suite-manifest raw CRLF hashes are respectively `2c314438…7561` and
`26865ec9…d03`; all other raw hashes equal LF. W11-SEC/U1/U2/V2/ONE_TIME history is preserved and the
OVERDUE SHA is a new forward link. The already disclosed V2 intermediate credit-check digest has no
standalone reachable Git blob and is not claimed otherwise.

#### 37.54.30.4 Boundaries and status

U3, routes/navigation, W11-A Package, W11-B/C/D, release blockers, Tag, Release and Deploy remain
outside this Freeze. No Git write or new test/MySQL run was authorized in the Freeze-record round.

**Status: `W11_A_OVERDUE_FOUNDATION_ACCEPTANCE_PASS_FROZEN`.**

### 37.54.31 W11-A U3-0 Credit Query Mobile UI — Bounded Design (2026-10-29)

#### 37.54.31.1 Design authority, inputs and frozen boundary

This Design follows the consecutively authorized Requirement in `document.md` → “W11-A U3-0 Credit
Query Mobile UI — Bounded Requirement Amendment”. It reuses the targeted U3 Audit and the accepted
U2/OVERDUE implementation. It neither edits nor supersedes the frozen meanings of SC101, SC102,
CSP1/CSP2, CCHK1/CCHK2, ONE_TIME, overdue evidence, canonical exposure or Credit Read Mode.

The design identity is `W11_A_U3_CREDIT_QUERY_UI_CONTRACT`. It introduces one bounded read projection
and one UI surface. No Schema/Migration, writer, transaction, audit record, version bump or release
change is designed.

#### 37.54.31.2 A — Route and screen ownership

`src/navigation/applicationRegistry.js` remains the only route authority. Future implementation adds:

```text
route key       credit-query
screen          src/pages/credit-query.jsx (default export CreditQueryPage)
access          any: ['CREDIT_VIEW']
domain/group    sales-customer / Sales & Customer
classification contextual
parentRoute     null
mobile          Sales & Customer launcher tile
desktop         normal visible navigation projection
detail target   documentId interpreted only as checkResultId
```

`parentRoute:null` is intentional: a CREDIT_VIEW-only actor does not require access to `customers`.
The launcher addition is a tile inside the existing Sales & Customer group, not a ninth domain or a
new navigation layer. `credit-query` is added to the registry's contextual set, screen loader switch,
screen definition, launcher group and detail-target set. The same canonical hash route supports:

```text
#credit-query
#credit-query/<encoded-checkResultId>
```

`routeLocation.js`, `App.jsx`, `AppNavigationContext`, `RouteScreen`, `MobileShell` and `api.js` are
reused unchanged unless implementation evidence proves a contract defect. Permission is checked by
the shell before screen mount; every API independently enforces backend authorization.

This is a bounded forward clarification of §37.54.8.6: “no launcher top-level entry” continues to mean
no new top-level domain or navigation system. The authorized U3 Requirement now requires one nested
domain tile so CREDIT_VIEW-only users can reach the otherwise contextual screen.

#### 37.54.31.3 B — UI component responsibility

All U3-specific components initially live in `src/pages/credit-query.jsx`; no second shared component
library is created before reuse is proven.

| Component | Responsibility |
|---|---|
| `CreditQueryPage` | owns tabs, canonical query context, URL detail target, request cancellation/stale-response guards and state resets |
| `CreditQueryContext` | customer/Credit Object option, business date and explicit stage; does not accept free-form ids as authorization |
| `CreditExposureSummary` | separate Aggregate/Sub-Limit sections, amount/components/fact counts and per-scope computed identity |
| `CreditExceptionFilters` | category/decision/scope/stage/date/customer/approval filters; sheet on narrow widths; applied-filter summary and clear |
| `CreditExceptionList` | dense server-paged rows, total, stable next/previous controls and selection |
| `CreditExceptionDetail` | immutable Check facts, approval/source/policy identity and overdue evidence tri-state |
| `HistoricalToCurrentExposureAction` | resolves the authorized Profile identity, then seeds a new current-query context without copying history amounts |
| `CreditQueryState` | loading skeleton, empty, denied, validation, network/server error and retry presentations |

Reuse `MobilePage`/existing application rail, shared buttons/inputs/status treatments, `api()` and
`useAppNavigation`. Do not reuse the existing report-only `BusinessEntitySelector`: its REPORT_* gate
and inactive-history contract are intentionally different. Do not reuse legacy Profile management
cards as the U3 layout.

#### 37.54.31.4 C — API contract mapping

| UI need | Endpoint | Mapping |
|---|---|---|
| authorized query options | new `GET /api/credit/query-options` | minimal customer/object selector projection |
| SC101 exposure | frozen `GET /api/credit/exposure` | current query date/stage; `scopes[]` displayed without arithmetic changes |
| SC102 history | frozen `GET /api/credit/exceptions` | server filters, authorized total and offset pagination |
| SC102 detail | frozen `GET /api/credit/exceptions/:checkResultId` | immutable history and 404 non-enumeration |
| historical identity resolution | existing `GET /api/credit/profiles/:creditProfileId` | customer/object/scope/salesperson identity under current authorization |

No UI call uses `/api/customers`; no U3 function requires CUSTOMERS_VIEW or CREDIT_MANAGE. The API
client remains `src/api.js`. `ApiError.status/code` selects state copy; text matching is forbidden.

#### 37.54.31.5 D — Exception → Exposure context flow

```text
route/documentId
  → GET exception detail (current Credit scope, non-enumerating 404)
  → read immutable creditProfileId + historical date/stage/check ids
  → GET profile detail by creditProfileId (same current Credit scope, non-enumerating 404)
  → build context {customerId, creditObjectType, creditObjectId,
                   historicalScopeType, salespersonId|null}
  → render historical section unchanged
  → user activates “查询当前额度”
  → current query date defaults to server-aligned today and stage is explicitly selected/confirmed
  → GET exposure with the resolved business identity
  → render current-query section separately
```

The screen never sends a salesperson id from a hidden scope and never treats a URL id as authority.
For an Aggregate historical result, no salesperson is sent. For an authorized Sub-Limit, its
salesperson may seed the optional filter; if membership was revoked, profile detail returns the same
404 as absence and no current call is made. An expired Profile may explain authorized history, but the
exposure endpoint independently resolves the Profile effective on the new date and may return
`CREDIT_PROFILE_MISSING`. No fallback to today's or another Profile is allowed.

Race protection: every selector/context change invalidates previous request tokens, clears exposure,
detail-derived current context and history offset, and ignores late responses. Browser Back/Forward
re-parses the canonical detail target; it does not resurrect stale in-memory authorization results.

#### 37.54.31.6 E — CREDIT_VIEW-only selector source

The new owner is `server/modules/credit-query-options.js`; it does not modify the frozen Query/Profile
owners. `server/app.js` registers only:

```text
GET /api/credit/query-options
  ?businessDate=YYYY-MM-DD       optional; default server current date
  &q=...                         optional bounded search
  &customerId=...                optional exact authorized hydration/filter
  &creditObjectType=...          optional only with the full exact identity
  &creditObjectId=...            optional only with the full exact identity
  &limit=1..100                  optional; default 30
  &offset=non-negative integer   optional; default 0

200 {
  options: [{
    customerId, customerCode, customerName, customerActive,
    creditObjectType, creditObjectId,
    availableScopeTypes: ['CUSTOMER_AGGREGATE'|'SALESPERSON_SUB_LIMIT', ...]
  }],
  total, limit, offset, businessDate
}
```

Validation returns 400 with a new selector-specific input/pagination code. Exact identity parameters
are all-or-none. Unknown and out-of-scope exact identities both return an empty authorized set; the
endpoint does not provide an existence oracle.

Data flow:

1. call `resolveCreditProfileReadScope(db, actor)`; DENY throws before query;
2. select only Profile rows effective on `businessDate`, with its canonical `predicateSql/Args` in the
   same inner authorized relation;
3. detect more than one effective row for the same stable business key + `salesperson_scope_key` and
   fail with existing `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` semantics;
4. join `customers` only after authorization and project only id/code/name/active;
5. apply exact filter/search to the authorized relation, group by customer/object business key, derive
   `availableScopeTypes`, and calculate COUNT and page from the same grouped conditions;
6. order by customer code, customer id, object type and object id for a deterministic total order.

The requested business date is data selection only; it is never passed to or used by the read-mode
decision. Query text is bounded and escaped through prepared parameters. SQLite/MySQL use equivalent
portable grouped queries (or dialect-specific syntax only when tests prove identical logical rows).
The module contains no write verb/function, transaction, audit or idempotency call. Customer contact,
phone, address, terms and Profile limit/rating/rule/creator fields never enter the DTO.

#### 37.54.31.7 F — Five-level permission matrix

| Mode/account | Route | Selector / Exposure / History / Detail |
|---|---|---|
| ADMIN (`ALL`) | visible | all authorized Credit rows/scopes |
| `CROSS_GROUP` | visible | same cross-group Credit projection; no Customers permission inferred |
| `AGGREGATE_PLUS_SELF` | visible | Aggregate + current actor's eligible self Sub-Limit only |
| `AGGREGATE_ONLY` | visible | Aggregate only; no hint/count/id for hidden Sub-Limits |
| `DENY` / no CREDIT_VIEW | shell denies mount | backend returns canonical 403 if called directly |

Current authorization date always controls the mode. Historical business date cannot restore a
revoked self scope. Frontend visibility is convenience only; the selector, Profile detail, exposure,
history and detail each fail closed on the server.

#### 37.54.31.8 G — Historical versus current presentation

The detail uses two visually and semantically separate regions:

```text
历史信用检查
  historical businessDate / stage / checkGroupId / checkResultId
  stored decision / reasons / recordedBreakdown / policy/profile hashes / approval

当前额度查询
  explicitly selected current query businessDate / stage
  current customer/object identity
  live derived scopes / components / computedPolicyIdentity
```

Labels use “历史记录” and “当前查询”; neither relies on color. No amount, policy identity or overdue
state crosses regions. The current region is absent until an authorized query succeeds. Long ids use
break-anywhere plus explicit copy affordances; monetary values use tabular numerals and cents-to-display
formatting with no floating-point business arithmetic.

OVERDUE presentation maps exact persisted status:

| Status | UI copy |
|---|---|
| `PROVEN_OVERDUE` + COMPLETE | 已证实逾期 |
| `PROVEN_OVERDUE` + PARTIAL | 已证实逾期（证据不完整，金额可能非全部） |
| `PROVEN_NOT_OVERDUE` | 已证实未逾期 |
| `UNKNOWN` / missing V1 | 未知（未取得完整历史证据） |

#### 37.54.31.9 H — Category, filters and pagination

Exposure and Exceptions are two task tabs under one page. Exceptions opens as the default when a
detail target exists; otherwise the user's current tab may remain in session state only.

On 320–430 px, category is a compact segmented/selection control and remaining filters live in one
bottom sheet/full-width filter surface. Applied filters are summarized outside the sheet with a count
and one clear action. On 680 px, the filter region may remain inline. Every filter change resets offset
to zero and cancels the prior request.

The list requests one backend page and renders backend `total/limit/offset`; it never paginates a
client-filtered superset. Previous/next are disabled at exact bounds. Rows show customer/object context
when already selected, historical date/stage, scope, decision, category indicators and approval status;
low-value hashes remain in detail. Category overlap renders multiple semantic labels on one row.

#### 37.54.31.10 I — Error, loading and empty states

| Condition | Presentation / action |
|---|---|
| initial selector loading | selector-shaped skeleton; no stale options |
| no authorized options | “当前权限范围内没有可查询的信用对象”; no Customers link requirement |
| exposure not yet requested | prompt for context/date/stage |
| `CREDIT_PROFILE_MISSING` | “所选日期没有有效的可见信用档案”; never zero limit |
| empty exception page at offset 0 | filter-aware empty state + clear filters |
| empty page at nonzero offset | reset to last valid page once; no automatic wider query |
| 403 | permission-denied state; clear cached rows/details |
| detail 404 | one neutral “记录不存在或无权查看” state |
| 400 validation | field/filter-local error using structured code |
| network/5xx | retain query inputs, clear protected results, explicit retry |
| route/screen load failure | existing `RouteErrorBoundary` |

Skeletons approximate final rows. Errors are associated with controls and announced. Retry repeats the
same bounded request; it does not alter filters, permissions or scope.

#### 37.54.31.11 J — Mobile responsive layout

Design baseline follows the repository ERP Mobile Taste: `DESIGN_VARIANCE 3`, `MOTION_INTENSITY 2`,
`VISUAL_DENSITY 8`.

| Width | Layout decision |
|---|---|
| 320 | 16 px gutter; single column; selector/filter surfaces full width; list replaces detail on drill-in; no page horizontal scroll |
| 390 | primary intentional layout; compact context header, one dominant title, 44 px controls, dense divider rows |
| 430 | same hierarchy with longer facts kept inline where readable; no extra card grid |
| 680 | existing single rail; optional list/detail split for Exceptions and inline filters; same route and DOM semantics |

Order is context → status/critical warning → amounts/key facts → components/identity. Use continuous list
surfaces and dividers, not one floating card per row. No hero, gradient, glass, decorative animation,
new bottom navigation or dependency is added. Sticky actions, if used for “查询”, include safe-area
padding and never cover validation/errors. Motion is limited to short sheet/detail transitions and
respects reduced motion.

#### 37.54.31.12 K — Browser acceptance

Browser Acceptance uses a real local backend fixture and authenticated accounts, not static mocks.
For each authorized account, verify launcher visibility, direct hash URL, deep-linked detail, refresh,
Back/Forward, tab/detail state, filter reset and stale-response protection. Exercise keyboard focus,
Escape/close, screen-reader names, error announcements and touch targets.

At 320/390/430/680 capture viewport evidence for: selector open/results, SC101 both scopes, missing
Profile, exception list with category overlap, filter surface, detail with long ids, UNKNOWN/PARTIAL
overdue evidence, denied/404, loading/empty/network error. Assert no page-level horizontal overflow and
no fixed/sticky overlap. Browser calls must be inspected to prove only authorized endpoints/parameters
are sent and that no `/api/customers` request occurs for CREDIT_VIEW-only.

#### 37.54.31.13 L — Backend contract amendment necessity

One backend amendment is necessary: the selector projection in §37.54.31.6. Reusing
`GET /api/credit/profiles` would transmit full Profile management fields, provide no customer label and
leave grouping/pagination undefined; using `/api/customers` or the REPORT selector would add unrelated
permission requirements or leak a wider customer set.

No amendment is necessary for Exception → Exposure. Existing Exception `creditProfileId`, protected
Profile Detail and frozen Exposure parameters form a complete authorized chain. Therefore:

```text
credit-query.js        zero production change
credit-profile.js      zero production change
credit-scope.js        zero production change
credit-check.js        zero production change
SC101/SC102 DTOs       zero change
Schema/Migration       zero change
```

#### 37.54.31.14 M — Exact future Implementation whitelist

Only a separately authorized Implementation may modify/create:

```text
server/modules/credit-query-options.js                         NEW selector owner
server/app.js                                                  one GET route/import
src/navigation/applicationRegistry.js                         route/screen/target/launcher
src/pages/credit-query.jsx                                    NEW U3 screen
src/styles.css                                                 bounded U3 responsive styles
server/sales-customer-wave11-a-credit-query-ui.test.js         NEW selector/UI contract suite
scripts/testing/test-suites.js                                 register the new suite
document.md                                                    append implementation/acceptance record only
solution.md                                                    append implementation evidence only
log/2026-10-29.md                                              append-only journal
```

The whitelist excludes all frozen Credit modules/tests, `src/api.js`, shared shell/navigation runtime,
BusinessEntitySelector, Schema/Migration, package version and release files. If implementation proves
any excluded production file necessary, it must HARD STOP and return to Requirement/Design rather
than expand scope.

#### 37.54.31.15 N — Test suite and acceptance plan

The new Node/Vite suite covers:

1. selector input/pagination validation, stable grouping/order and exact minimal DTO;
2. CREDIT_VIEW-only without CUSTOMERS_VIEW/CREDIT_MANAGE; all five read modes;
3. current versus historical `businessDate`, expired versions, duplicate effective ambiguity,
   inactive customer label and current-date authorization independence;
4. exact identity hydration, unknown/unauthorized equality, no contact/management-field leakage;
5. SQLite/MySQL logical parity and complete database-digest zero-write proof;
6. registry route/screen/access/launcher/detail-target integrity and CREDIT_VIEW-only reachability;
7. UI source contracts for frozen endpoint mapping, structured errors, state reset, overdue tri-state,
   no `/api/customers`, and no mutation calls;
8. responsive CSS contracts at 320/390/430/680 plus no permanent page overflow;
9. real browser matrix from §37.54.31.12;
10. focused U3 + existing Wave 9 Profile, Wave 10 Credit, U2 Query, OVERDUE and W11-SEC regressions,
    then FULL, Build and `git diff --check` under AGENTS.md §10.2.

Real MySQL is required only for the new selector parity/zero-write gate when separately authorized.
The frozen U2/OVERDUE E3 evidence is not rerun merely to design U3 and is not replaced by frontend tests.

#### 37.54.31.16 O — Freeze compatibility

The design consumes existing frozen contracts without changing bytes or meanings. New selector rows are
derived from effective Profile/customer identity under the existing predicate and are not Credit facts,
snapshots or history. They create no row and cannot affect decision, exposure, overdue evidence,
special approval or consumption.

Acceptance must re-hash the protected `credit-check.js` and `credit-query.js` values, run frozen
regressions, prove no Schema/version/tag change and record any new selector module as a forward U3
payload only. U3 cannot claim W11-A Package Freeze until its own user-approved Acceptance completes.

#### 37.54.31.17 P — Stage boundaries and implementation units

Future authorized implementation is divided without implied continuation:

```text
U3-A  read-only selector contract
      new owner + route + SQLite/MySQL parity + zero-write/security tests

U3-B  canonical route and mobile SC101/SC102 UI
      registry + screen + bounded styles + frontend contract tests

U3-C  browser/responsive/security acceptance
      real backend/account matrix + frozen regressions + evidence review
```

U3-A is required before U3-B can claim a usable CREDIT_VIEW-only selector. U3-B must not implement
Credit writers. U3-C is Acceptance evidence, not permission to Freeze, Commit, Push, release or start
W11-B/C/D. Each later stage requires the authorization appropriate under AGENTS.md.

#### 37.54.31.18 Design conclusion

The three U3 gaps are design-closed without a business-contract conflict. One minimal forward selector
API is necessary; no frozen DTO, Credit truth, permission model or database structure changes. The
route and responsive screen reuse the existing shell, registry, API client and 680 rail.

**Status: `W11_A_U3_CONTRACT_DESIGN_READY`.**

HARD STOP after Design. Implementation, tests, MySQL, Git writes, Acceptance/Freeze, Release/Deploy and
W11-B/C/D remain unauthorized.

### 37.54.32 W11-A U3-A Implementation Checkpoint / U3-B Whitelist Block (2026-10-29)

#### 37.54.32.1 U3-A actual implementation

The authorized implementation added `server/modules/credit-query-options.js`, registered one GET in
`server/app.js`, added the shared U3 test suite and registered that suite. The production query uses
one authorized effective-Profile relation for ambiguity detection, logical COUNT and paged LIST.
Prepared parameters bind date, exact identity, search and pagination. The DTO is the exact minimum
projection from §37.54.31.6; Customer management and Profile management fields are absent.

P0-A was resolved without amendment: Selector and frozen SC101 both select by business key,
`effective_from/effective_to` and canonical scope, do not filter Profile status, and fail on multiple
effective versions of one scope. P0-C was resolved without amendment: the seeded/production ADMIN role
contains `CREDIT_VIEW`, so frontend access requires no global permission exception.

Focused U3-A was 9/9 PASS. Related Wave 9/U2 Credit regression was 59/59 PASS. Syntax/import and
diff-check passed. The first focused execution was 7/9 because two new test fixtures reused an Anchor
at the same effective date and hit the existing unique constraint; only the new test fixture was
corrected to use valid distinct Anchors/overlapping version dates, after which all assertions passed.
No production semantic or expected result was weakened.

#### 37.54.32.2 U3-B blocking dependency proof

P0-B confirmed that a real `#credit-query/<checkResultId>` implementation requires all four canonical
changes: active route definition, screen loader/map, detail-target membership and launcher entry. This
necessarily increases the active route/presentation inventory from 72 to 73 and adds one contextual
route.

Repository audit found literal 72-route assertions in at least these existing files:

```text
server/v14-e8-product-consistency.test.js
server/v15-d0-shared-ux-foundations.test.js
server/v15-d10-final-ux-acceptance.test.js
server/v15-d9-extension-system-ux.test.js
server/v16-p2-sales-deliveries.test.js
server/v16-p2-sales-order-list.test.js
server/v16-p3-1-micro-polish.test.js
server/v16-p3-sales-order-document.test.js
server/v16-p4-purchase-receipts.test.js
server/v16-p8-flow-consistency.test.js
server/v16-sitewide-rollout.test.js
server/v17-domain-alignment.test.js
server/v17-p0-frontend-application-architecture.test.js
```

The final file also asserts the exact contextual inventory. These paths are outside
§37.54.31.14. Updating only the new U3 suite cannot make FULL pass; changing the canonical route shape
to evade inventory is not permitted. Under the user's explicit hard-stop rule, U3-B therefore stopped
before any Registry/UI/CSS edit.

#### 37.54.32.3 Required next authorization

The smallest safe continuation is a whitelist-only Design amendment naming the affected existing
route inventory tests and limiting changes to mechanical active-count/presentation-count totals,
combined-total arithmetic and addition of `credit-query` to the expected contextual set. All unrelated
assertions, disabled-route counts and behavior tests remain protected.

**Status: `W11_A_U3_B_IMPLEMENTATION_BLOCKED`.**

#### 37.54.33.5 Bounded two-failure correction and local gate closure

The user explicitly authorized a minimal forward amendment for the two reproducible FULL failures:
`src/styles.css` and one additional test path,
`server/v16-p1-mobile-enterprise-foundation.test.js`. No other implementation or test path was
reopened.

F1 removed only the U3-owned `@media (min-width: 681px)` wrapper and its bounded filter-sheet width
declaration. The U3 base rail remains `max-width: 680px`, the 430/340 maximum-width adaptations remain
intact, and no new desktop branch, hidden content or global token/shell change was introduced. The CSS
SHA-256 changed from `b903a53074460395c5661a5546112b869e98d32389e8d4ee8f767ea79beb7b0b`
to `d7cce0b54f8b799d90be1433f9b749f5f7685506b7f43c95e06621092957dd85`.

F2 preserved the exact `assert.deepEqual` launcher inventory and its original five members, appending
only `credit-query` in the actual Registry order. OQC remains absent and every other launcher assertion
is unchanged. The fourteenth test SHA-256 changed from
`9298ada290682f83039dfa8d2e46eacac4326ce90cea3269e92528d999c9f1d4` to
`d4a33320ce414a46264debc667dcf3806958799ab3e55344dfb9e23b57332fca`.

Stage A passed 418/418 tests across the two corrected contracts, U3-A/U3-B, thirteen route-inventory
tests and related frozen Credit regression, with 0 fail/skip/todo. `git diff --check` passed after
removing one patch-created EOF blank line, and both frozen owner hashes remained exact. Stage B passed
FAST 500/500, FULL 3045/3045 (359 suites) and Vite Build (1966 modules). The prior two FULL failures
remain recorded above and were not overwritten.

No browser acceptance, real MySQL, Git write, Freeze, release/deploy or later-wave work occurred.
U3-C browser/security acceptance and user Acceptance/Freeze remain separate future gates.

**Status: `W11_A_U3_AB_IMPLEMENTED_READY_FOR_ACCEPTANCE_GATES`.**

### 37.54.33 W11-A U3-B Route Inventory Test Whitelist Forward Amendment (2026-10-30)

#### 37.54.33.1 Authority and bounded purpose

The user explicitly authorized the 2026-10-30 log-path correction, the previously audited route
inventory whitelist amendment, the mechanical correction of exactly thirteen existing tests, and
resumption of the already approved U3-B implementation. This amendment changes implementation file
scope only. It does not change the approved U3 Requirement, backend contracts, Credit permissions,
SC101/SC102 DTOs, OVERDUE semantics, Schema/Migration or any frozen Credit implementation.

`log/2026-10-30.md` is added as a new append-only path. `log/2026-10-29.md` remains read-only from
this point and retains the original U3-A checkpoint and U3-B hard-stop evidence.

#### 37.54.33.2 Exact mechanical test whitelist

Only the following existing files and assertions are added to §37.54.31.14:

| Path | Before SHA-256 | Exact permitted correction |
|---|---|---|
| `server/v14-e8-product-consistency.test.js` | `18846f3c2caa8e42b2fd43cdd1d866132d53c9e31a5997ef3c46b86b99461917` | complete active presentation set `72 -> 73` |
| `server/v15-d0-shared-ux-foundations.test.js` | `d94def094934d1b379a3f8978d4a1b791dfca745a8e683ae646e4a30446dffc7` | presentation length/uniqueness and active set `72 -> 73` |
| `server/v15-d10-final-ux-acceptance.test.js` | `09f1043ad3a6a847d597cbc530d1a1624f2b5effc13b7c1d7c8648753021d81d` | active/presentation/dynamic manifest counts and matching labels `72 -> 73` |
| `server/v15-d9-extension-system-ux.test.js` | `31238c41887f0bbc54df03afdd5ea3fd86c83b6747b6b4f48cd8f09226706572` | complete presentation count `72 -> 73` |
| `server/v16-p2-sales-deliveries.test.js` | `35d4a924f3409703f8a66918ee011cc88fa24344f2f8e270ca771a32f4adcb9a` | complete presentation count `72 -> 73` |
| `server/v16-p2-sales-order-list.test.js` | `77b030456bd65c6b9428fd7959df2ba91268d82d38a835c11bf6424bcc4a60a8` | complete presentation count `72 -> 73` |
| `server/v16-p3-1-micro-polish.test.js` | `d00bfbc9314a5bf6d62512f0928194205ed15bc59dfdd2c97f6ff869cbd6e35a` | complete presentation count `72 -> 73` |
| `server/v16-p3-sales-order-document.test.js` | `5aa6000c45f94d72b1f921f331edecbbbcf75fba7b1ffa654cb92cb198d083fb` | complete presentation count `72 -> 73` |
| `server/v16-p4-purchase-receipts.test.js` | `ea3f7a01e1e8d9edea29df56ca15202b359a8dad4893eb2801452a04274ca883` | complete presentation count `72 -> 73` |
| `server/v16-p8-flow-consistency.test.js` | `bfee2abb54959f0a2c1d7533e14c0ae23c251f8344b933d4fdc00b3580a947cc` | active `72 -> 73`, combined `77 -> 78`, contextual-parent `22 -> 23`, and matching labels |
| `server/v16-sitewide-rollout.test.js` | `1e06c46f46204424f71f4b888b0cd3be62ecf4e53de10d356f0ec4cabbb39681` | complete enabled-key count `72 -> 73`; add only `credit-query` to the explicit post-V1.6 route and contextual-parent matrix whitelists |
| `server/v17-domain-alignment.test.js` | `c34c9870a9e6ebafc5fbd841c5d514cd0de3c120bd6a1bbf61b76f9f01983425` | active count and matching test title `72 -> 73` |
| `server/v17-p0-frontend-application-architecture.test.js` | `1ce8bd63421bdd0aaff9bf2cb1d1b2087fd091a4073f7175b57561106a41b84e` | active/presentation `72 -> 73`; add only `credit-query` to the exact contextual set; matching title |

All thirteen paths resolve uniquely. None belongs to the W11-A protected Credit SHA manifest. Their
existing route uniqueness, permission, loader, URL-security, disabled-route, parent, domain and
business assertions remain intact. No assertion may be skipped, weakened or replaced with a dynamic
expectation.

#### 37.54.33.3 Derived count proof and continuation boundary

The new canonical route is one enabled presentation and therefore changes the active/presentation
inventory from 72 to 73 and the P8 combined enabled-plus-disabled count from 77 to 78. It is explicitly
classified `CONTEXTUAL` and has `parentRoute: 'customers'`, so the P8 contextual route-with-parent
count changes from 22 to 23 and the V17 exact contextual set gains only `credit-query`.

After recording this whitelist, implementation may resume only within §37.54.31.14, the thirteen
paths above, `document.md`, `solution.md`, and `log/2026-10-30.md`. Real MySQL, U3-C Acceptance/Freeze,
Git writes, version/tag changes, release/deploy and later waves remain prohibited.

No MySQL, U3-C, Acceptance/Freeze, Git write, Release/Deploy or W11-B/C/D was performed.

#### 37.54.33.4 FULL regression blocker discovered after implementation

The authorized focused route/UI run passed 231/231 and FAST passed 500/500. The first FULL run then
reported 3043/3045 PASS with exactly two failures and no skip/todo; a diagnostic FULL rerun reproduced
the same two failures:

1. `server/v12-core-pages-ui.test.js` rejects any `@media (min-width: ...)` rule after the canonical
   core-page CSS marker. The bounded U3 CSS can satisfy this without changing that test, by removing
   the U3 desktop-only media branch.
2. `server/v16-p1-mobile-enterprise-foundation.test.js` freezes the Sales & Customer launcher pages
   to exactly `customers`, `quotations`, `orders`, `sales-deliveries`, and `returns`. The approved
   §37.54.31 route contract requires `credit-query` to be an additional tile in that same existing
   group. Passing both contracts therefore requires a mechanical forward amendment to this fourteenth
   test file.

The current user authorization explicitly forbids automatically expanding the thirteen-test whitelist
to a fourteenth test. Removing or hiding the launcher tile would violate the approved Requirement and
Design and would make CREDIT_VIEW-only mobile access incomplete. No production-side workaround or
assertion weakening is acceptable. Implementation therefore stops with the working tree preserved;
the CSS correction is also intentionally not applied after the whitelist blocker was confirmed.

**Status: `W11_A_U3_B_IMPLEMENTATION_BLOCKED`.**

### 37.54.34 W11-A U3-C real-browser acceptance hard stop (2026-10-30)

The user authorized U3-C1 real Microsoft Edge acceptance and an independent U3-C2 protected-MySQL
Selector Gate readiness audit. U3-C1 used the real Vite production build, `playwright-core` with the
installed Edge executable, the real application router and HTTP server, a disposable SQLite database,
production Credit writers, and two dedicated browser identities: exactly `CREDIT_VIEW`, and no Credit
permission. No production source or frozen backend contract was changed.

The browser harness passed B01 through B05 before the first required detail navigation found a real
HTTP integration defect in B06. The SC102 list returned an authorized persisted Result whose identity
contains `:`. `src/pages/credit-query.jsx` correctly protects the path segment with
`encodeURIComponent(id)`, but `server/lib/route-table.js` returns regular-expression captures without
URL-decoding them. The `/api/credit/exceptions/:id` adapter therefore queried the percent-encoded text
instead of the persisted Result identity and returned `404 CREDIT_EXCEPTION_NOT_FOUND` for the same
row that the list had just exposed. The UI consequently cannot open normal SC102 detail/deep links for
these canonical Result identities.

The reproducible evidence is outside the repository at
`C:\Users\Administrator\AppData\Local\Temp\modern-erp-w11a-u3-browser-2026-10-30T01-03-23-028Z`.
`browser-acceptance-failure.json` SHA-256 is
`9bcf4ccc52fc5e57e29cf74a0e6f46405ca5286615b18755c463e13148a39a67`; `failure-state.png`
SHA-256 is `4b1b80e33905386aaaebb0c43bbb872c98d1942b3b311c900a9ddf633a9519b0`.
B06 is FAIL. B07-B09 and the 320/390/430/680 responsive matrix are NOT_RUN. U3-C2 is also NOT_RUN
because the user required an immediate hard stop when real-browser acceptance finds a product defect.
No MySQL connection, reset, runner or gate was executed.

**Status: `W11_A_U3_C_BROWSER_ACCEPTANCE_BLOCKED`.**

### 37.54.35 W11-A U3-C B06 bounded URL-encoding correction and browser acceptance (2026-10-30)

#### 37.54.35.1 Root cause

The B06 failure was a real HTTP integration defect, not an authorization outcome. The persisted SC102
Result identity is built by the Credit Check writer as
`rowId = ${checkGroupId}:${scopeType}` (`server/modules/credit-check.js:1471`), where `checkGroupId` is
`CCHK1:<sha256>` or `CCHK2:<sha256>` and `scopeType` is `CUSTOMER_AGGREGATE` or `SALESPERSON_SUB_LIMIT`.
The canonical identity therefore contains `:` characters. `src/pages/credit-query.jsx` correctly protects
the path segment with `encodeURIComponent(id)`, but `server/lib/route-table.js` returns the regular
expression capture of the request path without URL-decoding it. The adapter handed the percent-encoded
text to `getCreditException`, which then queried a non-existent row and returned
`404 CREDIT_EXCEPTION_NOT_FOUND` for a row the authorized list had just exposed.

The correction belongs to the HTTP parameter adaptation boundary of that one route. The route table, the
frozen `credit-query.js` owner, the frozen `credit-check.js` writer, the Credit Scope Resolver, the schema
and every other route stay untouched. The frontend keeps its normal `encodeURIComponent` protection.

#### 37.54.35.2 Correction

`server/app.js` registers a dedicated adapter for `GET /api/credit/exceptions/:checkResultId`:

- the raw regular-expression capture is read exactly as the route table produced it;
- `decodeURIComponent` is applied exactly once; a malformed percent sequence is caught and produces the
  empty identity instead of an exception, so a wrong encoding can never become HTTP 500;
- the decoded value must match the canonical identity grammar
  `/^CCHK[12]:[0-9a-f]{64}:(?:CUSTOMER_AGGREGATE|SALESPERSON_SUB_LIMIT)$/` before it is used;
- an identity that does not match becomes the empty string, which the frozen owner resolves through its
  existing authorization predicate and its existing non-enumerating 404 contract.

The grammar is not invented: it is the writer's own identity composition read from
`server/modules/credit-check.js`, cross-checked against the persisted facts. The strict grammar is also
what makes a second decoding impossible. `decodeURIComponent('%253A')` yields `%3A`, which cannot match
the grammar, so a double-encoded URL is rejected instead of being promoted into a legal identity.

`server/app.js` SHA-256 moved from
`f11ac044ee2b4f0d2631491338968805fed35d2ca63646a37ea24e1c1a90abe7` to
`c3e908f836d2aedcfc054a2d904e97de3c3ec542674c6f78a93becd2a2878e63`.

#### 37.54.35.3 Encoding and security contract

| Input | Contract |
| --- | --- |
| `%3A` and `%3a` | decoded once, canonical identity restored, HTTP 200 for an authorized row |
| already unencoded `:`, `CCHK1` and `CCHK2` | unchanged path, HTTP 200 for an authorized row |
| `CUSTOMER_AGGREGATE` and `SALESPERSON_SUB_LIMIT` | both identities accepted, both scope types proven |
| malformed percent sequence (`%`, `%2`, `%zz`) | no exception, neutral 404, never HTTP 500 |
| `%25`, `%2F`, `%5C`, `..%2Fsecret` | neutral 404, no traversal, no other row matched |
| double encoding | rejected, never promoted to a legal identity |
| unknown identity | neutral 404 `CREDIT_EXCEPTION_NOT_FOUND` |
| unauthorized identity | the same neutral 404 `CREDIT_EXCEPTION_NOT_FOUND`, no existence signal |
| identity without the Credit Read Scope | HTTP 403 `CREDIT_SCOPE_DENIED`, the existing scope semantics |

The unknown identity and the unauthorized identity are byte-identical in status, code and message, so the
response cannot be used to probe for the existence of a record.

#### 37.54.35.4 Focused regression

`server/sales-customer-wave11-a-credit-query-ui.test.js` adds one bounded HTTP case,
`U3-C B06 HTTP adapter decodes one canonical identity layer and preserves scope-safe failures`. It drives
the real HTTP route table over a real SQLite database and proves list-to-detail identity equality,
DTO equality with the list row without recomputing history, the persisted `CCHK1` legacy grammar, both
scope types, the non-enumerating 404 pair, the malformed and traversal inputs, the double encoding, the
scope-refused 403 and the zero-write digest equality around every measured GET.

Related Credit regression 157/157, FAST 500/500 and FULL 3046/3046 passed. FULL grew by exactly one test
against the previous 3045/3045: the new B06 HTTP case. No existing assertion was removed, skipped or
downgraded, and there was no fail, skip or todo.

#### 37.54.35.5 Real-browser acceptance

The acceptance harness is `scripts/acceptance/sales-customer-wave11-a-u3-browser-uat.mjs`. It uses the
real Vite production build, `playwright-core` with the installed Microsoft Edge executable, the real
application router and HTTP server, a disposable SQLite database, the production Credit writers and two
dedicated identities: exactly `CREDIT_VIEW`, and no Credit permission. The original B06 failure evidence
directory is preserved unchanged.

B01 through B09 all pass:

- B01 — the `CREDIT_VIEW`-only launcher tile and the query-options read, with no `/api/customers` request;
- B02 — the denied identity sees no launcher tile, the direct URL renders `permission_denied` and the API
  answers 403;
- B03 — the SC101 query returns both scope cards and the amount facts;
- B04 — all five server categories are present and the OVERDUE filter narrows the list;
- B05 — 38 authorized rows paginate over two pages with no overlap;
- B06 — the authorized detail opens from the list, a direct hash link resolves in a fresh document, refresh
  keeps the detail, Back returns to the list, Forward returns to the detail, and the unknown, unauthorized
  and tampered identities all stay on the neutral 404 surface. The real browser request is
  `GET /api/credit/exceptions/CCHK2%3A...%3ASALESPERSON_SUB_LIMIT` and answers 200;
- B07 — the historical detail and the current exposure stay separated, the current read uses today's date;
- B08 — the four overdue evidence states are present. The UNKNOWN row renders the warning tone with the
  title `未知` and never the affirmative not-overdue or zero-risk labels; the PROVEN_OVERDUE/COMPLETE row
  renders `已证实逾期`;
- B09 — a held superseded selector read shows the loading state, the newest context survives the release of
  the stale read, a real network abort exposes the retry affordance and the retry recovers, an invalid
  query answers 400 and an empty result renders the empty state.

The accepted evidence directory is
`C:\Users\Administrator\AppData\Local\Temp\modern-erp-w11a-u3-browser-2026-10-30-b06-fixed-r5`.
`browser-acceptance-results.json` SHA-256 is
`060e3aa9290cfc0809453bbb5fc1347134fe6810a498f92d41cb64ee504e23f6` and `manifest.json` SHA-256 is
`5036f36e7da3b98014a66ca3c800cc6e8c7099def07f6347eea4899ec16e7e6c`. The manifest carries the SHA-256 of
every screenshot.

#### 37.54.35.6 Four-viewport responsive matrix

Measured in the real Edge viewport at 320, 390, 430 and 680 by 844 CSS pixels, for SC101, the SC102 list,
the filter sheet, the SC102 detail, the historical-to-current separation, the long identity, the money
and the date values.

| Width | clientWidth | scrollWidth | Main bounds | Smallest target | Overflowing elements | Focus stops | Distinct focus stops |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 320 | 320 | 320 | 28 - 292 | 44 px | 0 | 14 | 6 |
| 390 | 390 | 390 | 32 - 358 | 44 px | 0 | 14 | 6 |
| 430 | 430 | 430 | 32 - 398 | 44 px | 0 | 14 | 6 |
| 680 | 680 | 680 | 32 - 648 | 44 px | 0 | 14 | 6 |

There is no horizontal overflow at any width, no element leaves the viewport, the smallest interactive
target is 44 px tall and every focused element stays inside the viewport. The 92-character canonical
Check Result ID renders without overflowing its own column, and the evaluated date and the money values
render in the same column without overflow. The deep link is opened with the keyboard only, so the
keyboard operability of the identity navigation is proven at every width.

#### 37.54.35.7 U3-C2 MySQL Selector Gate readiness audit (read-only)

This audit is read-only. No MySQL connection, reset, runner or gate was executed.

**A. Independent Selector integration suite path.**
`server/mysql-sales-customer-wave11-a-credit-query-options.integration.js`. It follows the proven pattern
of the frozen W11-A E3 suite: `createTempDb({ label: 'w11-a-u3-selector-mysql-e3', production: true })`
against `ERP_TEST_DB_BACKEND=mysql`, an assertion that `db.dialect === 'mysql'`, the production fixture
`seedCreditQueryWorld` on the MySQL adapter, the same engine evidence on a disposable SQLite side, and
`databaseDigest` before and after every measured GET. The file must not be registered in
`scripts/testing/test-suites.js`; MySQL integration files are never part of FAST or FULL.

**B. Protected gate runner path.**
`scripts/gates/mysql-sales-wave11-a-selector-gate.mjs`, a new gate entry that calls the existing
`runProtectedMySqlCampaign` from `scripts/gates/mysql-wave10-runner-support.mjs` with its own campaign
label `W11-A U3 SELECTOR MYSQL E3 ACCEPTANCE` and its own suite list. The frozen
`scripts/gates/mysql-sales-wave11-a-gate.mjs` is not modified.

**C. Exact next-stage whitelist.**

| Path | Action |
| --- | --- |
| `server/mysql-sales-customer-wave11-a-credit-query-options.integration.js` | new |
| `scripts/gates/mysql-sales-wave11-a-selector-gate.mjs` | new |
| `package.json` | one new script `test:mysql:wave11-a:selector` |
| `document.md` | the Requirement section for the Selector MySQL gate |
| `solution.md` | this Design section and its acceptance record |
| `log/<date>.md` | append-only evidence |

No production file, no frozen Credit owner, no shared MySQL fixture and no existing gate runner is in the
whitelist. The existing `server/test-utils/wave11-a-credit-query-fixture.js` and
`server/test-utils/wave11-sec-scope-fixture.js` are sufficient and must stay unmodified.

**D. Test IDs.**

| ID | Contract |
| --- | --- |
| `W11-A-U3-E3-S01` | the suite runs on a real MySQL adapter and one shared production fixture |
| `W11-A-U3-E3-S02` | the five-level Credit Read Mode projects the same logical options on both engines |
| `W11-A-U3-E3-S03` | the logical COUNT and the list share one authorized set and paginate without overlap |
| `W11-A-U3-E3-S04` | the customer and Credit Object search matches identically on both engines |
| `W11-A-U3-E3-S05` | the exact identity filter and the invalid input contract are identical |
| `W11-A-U3-E3-S06` | the effective-date window and the revoked-membership rule match SC101 |
| `W11-A-U3-E3-S07` | an ambiguous effective Profile answers 409 on both engines |
| `W11-A-U3-E3-S08` | an unknown exact identity returns an empty non-enumerating page |
| `W11-A-U3-E3-S09` | every measured GET is repeatable and leaves the database unchanged |
| `W11-A-U3-E3-S10` | the ordering contract is collation-stable for the fixture identities |

**E. SQLite / MySQL parity matrix.** The MySQL column facts below were read from the emitted bootstrap
DDL with a recording mock adapter, without a MySQL server.

| Behaviour | SQLite | MySQL 8 | Parity risk | Mitigation |
| --- | --- | --- | --- | --- |
| `customers.code` collation | `TEXT`, binary comparison | `VARCHAR(128) COLLATE utf8mb4_0900_ai_ci` | the MySQL order and search are case- and accent-insensitive | the fixture identities are uppercase ASCII; the parity assertion is set equality plus one explicit collation-stable order |
| `customers.name` | `TEXT` | `LONGTEXT`, `ai_ci` | the same insensitivity | the fixture names are ASCII |
| `customers.active` | `INTEGER` | `BIGINT` | none | `Boolean(row.customer_active)` is correct on both |
| `credit_profile.effective_from` / `effective_to` | `TEXT` | `VARCHAR(128)` / `LONGTEXT` | both compare lexicographically | the values are `YYYY-MM-DD`, which is chronologically ordered |
| `credit_profile.credit_object_type` grouping | `TEXT` | `LONGTEXT` | the MySQL group key is truncated at `max_sort_length` | the values are short codes |
| `LIMIT ? OFFSET ?` | bound parameters | client-side interpolation by the adapter | the value becomes a literal | the pagination input is validated as a decimal integer before the query |
| derived table `COUNT` | accepted | needs an alias | none | the alias `authorized_options` is present |
| `LIKE` wildcards in `q` | `%` and `_` are wildcards | the same | the same input matches the same rows | an explicit parity case with `%` and `_` |
| `LOWER()` folding | ASCII only | `utf8mb4` | non-ASCII folding differs | the fixture identities are ASCII |
| `JOIN customers` | inner join | inner join | none | none |

**F. Preflight, reset and cleanup constraints.** The new gate runs only through the existing protected
launcher `scripts/gates/run-mysql-local-gate.ps1 -Script test:mysql:wave11-a:selector`. The launcher
reads the DPAPI credential and the pinned identity baseline, withholds the destructive variables from the
read-only preflight, proves the live identity and the empty schema, takes the machine-wide named mutex,
sets `ERP_MYSQL_TEST_ALLOW_RESET=true`, `ERP_MYSQL_TEST_DISPOSABLE_TARGET` and
`ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS`, pins the expected server UUID, current user, grants digest,
version policy and the `EMPTY_ONLY` initial inventory, runs the gate, verifies the five object categories
again on a fresh session and clears the sensitive variables. The campaign resets the schema before the
suite, asserts the zero-object inventory, passes the campaign id and the encoded lease to the child,
parses the TAP transcript strictly, resets again at the end and releases the lease. The suite child
refuses to run without the five `ERP_DB_*` variables and `ERP_MYSQL_TEST_ALLOW_RESET=true`, and
`assertAuthorizedDisposableMySqlTarget` still refuses a target whose name lacks the disposable hint or
whose identity does not match the approved one.

**G. Isolation from the existing E3 suite.** The new runner is a separate file with a separate campaign
label, so the campaign id and the lease differ from the frozen W11-A U2 E3 campaign. The machine-wide
mutex still serializes both gates against the same target, so they can never clean the same schema
concurrently. The new integration file has its own basename and is not registered in the SQLite test
registry, so FAST and FULL never reach MySQL. The shared fixtures are imported read-only and are not
modified by either suite.

**H. Independent MySQL execution authorization.** Running the new gate against the local disposable MySQL
target requires a separate explicit user authorization. This audit neither requests nor performs it. No
MySQL connection, reset, runner or gate was executed in this stage.

**Status: `W11_A_U3_BROWSER_ACCEPTANCE_PASS_MYSQL_GATE_READY`.**

### 37.54.36 W11-A U3 Selector Protected MySQL Gate — Design Amendment (2026-10-30)

#### 37.54.36.1 Authorization, baseline and reuse boundary

The user authorized one consecutive sequence: review the existing U3-C2 readiness audit, confirm or
amend the Requirement, confirm or amend the Design, review implementation and execution readiness, and
hard stop. The MySQL gate implementation, any MySQL connection or reset, a new integration suite or
runner, a `package.json` or test-registry change, production code, the real MySQL gate, Git writes,
Final Acceptance/Freeze and Release/Deploy were not authorized and did not happen.

The baseline is branch `work/sales-waves6-13-recovery-20261025`, HEAD
`8c716f64dbeb8d650c3dd87a43661ed205fdcfdd`, version `1.6.2`, an empty index and the 26 existing U3
authorized worktree paths.

This Design confirms §37.54.35.7 as the design basis and amends it. It does not restate the audit and it
does not create a parallel contract. The Requirement layer is `document.md`
"W11-A U3 Selector Protected MySQL Gate — Bounded Requirement Amendment (2026-10-30)", sections R-U3-GATE-01
through R-U3-GATE-06.

The amendments to §37.54.35.7 are exactly four:

1. §37.54.35.7 A–H are confirmed unchanged except for the addition of a dedicated selector gate fixture
   helper and a read-only MySQL collation probe, both registered in the whitelist of §37.54.36.8;
2. the S01–S10 identities are kept and are given their exact ten-field acceptance content in
   §37.54.36.4;
3. §37.54.35.7 E gains the resolved collation and grouping analysis of §37.54.36.5;
4. §37.54.35.7 H gains the explicit rule that the open case/accent business decision is measured and
   reported by the gate and never asserted as cross-engine equality.

#### 37.54.36.2 The subject and the single surface under test

The gate exercises exactly one production surface, `GET /api/credit/query-options`, owned by
`server/modules/credit-query-options.js`. It drives the production handler through the shared
`read(handler, db, actor, params)` helper of `server/test-utils/wave11-sec-scope-fixture.js`, which
returns `{ statusCode, body, code, message }` and never lets a denied read escape the handler. The gate
never calls the HTTP route table, because the selector has no per-record route and its contract is the
authorization projection, not a path adaptation.

#### 37.54.36.3 The fixture and its identities

The gate uses a dedicated fixture helper, `server/test-utils/wave11-a-selector-gate-fixture.js`, which
imports the shared `seedWorld` read-only and extends it. The shared fixture files are not modified, so
the frozen W11-A U2 E3 suite keeps its exact data.

The shared world contributes the five-level read mode, the effective-date boundaries and the membership
boundaries:

| Fact | Shared value |
| --- | --- |
| customers | `cus-w11-self`, `cus-w11-other`, `cus-w11-expired`, `cus-w11-future`, code `id.toUpperCase()`, name `id` |
| Credit Object per customer | `creditObjectType = 'SALES_ORDER'`, `creditObjectId = 'CREDIT-' + id.toUpperCase()` |
| Profile versions per customer | one aggregate (`salesperson_scope_key = '*'`) and one sub-limit (`salesperson_scope_key = sp-x`), both `status = 'ACTIVE'`, `effective_from = PROFILE_FROM`, `effective_to = NULL` |
| memberships | `sp-self` and `sp-other` valid, `sp-expired` ended, `sp-future` not started |
| actors | `ADMIN` (ALL), `CROSS_READER` (CROSS_GROUP), `SELF_ACTOR` (AGGREGATE_PLUS_SELF), `OTHER_ACTOR` (AGGREGATE_PLUS_SELF, own sub-limit), `UNMAPPED_ACTOR` / `EXPIRED_ACTOR` / `FUTURE_ACTOR` (AGGREGATE_ONLY), `NO_CREDIT` (DENY) |

The helper adds exactly the identities the shared world does not contain, and it adds them with the
production writers wherever a production writer exists:

| Added identity | Purpose | Production writer |
| --- | --- | --- |
| customer `cus-w11-case`, code `Cus-W11-Case`, name `Müller GmbH`, one aggregate Profile | the case and accent probe | `createCreditProfile` for the Profile, a direct customer insert like the shared `seedCustomer` |
| customer `cus-w11-multi`, two Credit Objects `CREDIT-CUS-W11-MULTI-A` and `-B`, one aggregate Profile each | multiple Credit Objects | `createCreditProfile` twice |
| customers `cus-w11-dup-a` and `cus-w11-dup-b`, both named `Shared Display Name`, distinct codes, one aggregate Profile each | the same display name on different logical customers | `createCreditProfile` |
| a second aggregate Profile version of `cus-w11-self` with a different `effective_from` | the ambiguous effective version | the same direct insert the U3-A SQLite case uses, with a fixed technical id |

Every added identity is visible to `ADMIN` and, through its aggregate scope, to every `CREDIT_VIEW` holder,
so the search, grouping, count and pagination assertions can observe it.

The SQLite side and the MySQL side of the gate are created by the identical helper, so the two engines
receive byte-identical business facts. The technical Profile ids are generated per database and are
therefore never compared; only the stable business key
`customerId + creditObjectType + creditObjectId` is compared.

#### 37.54.36.4 S01–S10 exact acceptance matrix

The S01–S10 identities of §37.54.35.7 D are kept. Each field is now fixed.

**S01 — `W11-A-U3-E3-S01`: a real MySQL adapter and one shared production fixture**

- A. Test ID: `W11-A-U3-E3-S01`.
- B. Requirement reference: R-U3-GATE-01 subject; R-U3-GATE-03 class "test environment difference".
- C. Real SQLite fixture: `createTempDb({ label: 'w11-a-u3-selector-sqlite', production: true })`, asserted
  `db.dialect === 'sqlite'`, seeded by the shared gate fixture helper.
- D. Real MySQL fixture: `createTempDb({ label: 'w11-a-u3-selector-mysql-e3', production: true })` under
  `ERP_TEST_DB_BACKEND=mysql`, asserted `db.dialect === 'mysql'`, seeded by the same helper.
- E. Expected business result: both dialects are created from the identical business facts and produce the
  identical logical option set for the base identities.
- F. Unauthorized result: no customer identity may reach a denied actor on either engine.
- G. COUNT/List assertion: the logical `total` equals the number of distinct logical option keys on both
  engines.
- H. Zero-write assertion: `databaseDigest` before and after is identical on both engines.
- I. Database-specific behaviour: the MySQL side must never fall back to SQLite; the dialect assertion is
  the proof, and it is the same pattern the frozen E3 suite uses.
- J. Failure criteria: a wrong dialect, a differing fixture, or a differing base logical option set fails
  the test.

**S02 — `W11-A-U3-E3-S02`: the five-level Credit Read Mode**

- B. R-U3-GATE-01 items 1, 2 and 3.
- C./D. The shared world, on both engines.
- E. Expected business result: the exact expected option set per mode — `ADMIN` sees four logical options
  with both scope types; `CROSS_READER` sees the same four; `SELF_ACTOR` sees four options where only
  `cus-w11-self` carries `SALESPERSON_SUB_LIMIT`; `OTHER_ACTOR` sees four options where only `cus-w11-other`
  carries it; `UNMAPPED_ACTOR`, `EXPIRED_ACTOR` and `FUTURE_ACTOR` see four options with
  `CUSTOMER_AGGREGATE` only; `NO_CREDIT` is denied.
- F. Unauthorized result: `NO_CREDIT` receives HTTP 403 `CREDIT_SCOPE_DENIED` and zero rows; the
  `AGGREGATE_ONLY` actors never receive a `SALESPERSON_SUB_LIMIT` scope type; the sub-limit of another
  salesperson never appears.
- G. COUNT/List assertion: `total` equals the row count in every mode, and the mode sets are strictly
  nested `DENY ⊂ AGGREGATE_ONLY ⊂ AGGREGATE_PLUS_SELF ⊂ CROSS_GROUP = ALL` on the shared identities.
- H. Zero-write assertion: `databaseDigest` before and after every mode read.
- I. Database-specific behaviour: the scope predicate is part of the SQL relation, so the grouping, the
  count and the pagination all see the same authorized set; the gate asserts the count and the rows agree
  so that a post-filter would be detected.
- J. Failure criteria: any mode sees an unauthorized row, any mode's set differs between the engines, or
  the count disagrees with the row count.

**S03 — `W11-A-U3-E3-S03`: the logical COUNT, the list and the grouping**

- B. R-U3-GATE-01 items 4, 5, 9 and 10.
- E. Expected business result: `cus-w11-self` appears once with both scope types although two Profile
  versions exist; `cus-w11-multi` appears twice, once per Credit Object; `cus-w11-dup-a` and `cus-w11-dup-b`
  appear as two separate options despite the identical display name. Every returned row carries exactly the
  approved field set `customerId, customerCode, customerName, customerActive, creditObjectType,
  creditObjectId, availableScopeTypes` and no customer contact, phone, address, payment terms, creator,
  rule, rating or limit field.
- F. Unauthorized result: the field whitelist is asserted for every authorized actor too, so a scope leak
  through the projection is a failure, and the DTO of a denied actor is never produced.
- G. COUNT/List assertion: `total` equals the number of distinct logical option keys; the sum of the page
  row counts equals `total`; no page overlaps another; the reassembled page union equals the unpaginated
  option key set.
- H. Zero-write assertion: `databaseDigest` before and after the whole pagination walk.
- I. Database-specific behaviour: the COUNT uses a derived table over the same relation as the list; the
  gate asserts that the derived-table count equals the row count of the union of the pages, which is the
  form of the parity that survives a collation difference in the display columns.
- J. Failure criteria: a differing count, a differing option key set, an overlapping page, a missing or
  extra DTO field, or a differing field set between the engines.

**S04 — `W11-A-U3-E3-S04`: the customer and Credit Object search**

- B. R-U3-GATE-01 item 8; R-U3-GATE-04.
- E. Expected business result: a prefix query on the customer code, a contains query on the customer name
  and a query on the Credit Object identity each return exactly the expected option key set, on both
  engines, for the ASCII business identities.
- F. Unauthorized result: a query that matches an unauthorized customer returns nothing; the search runs
  inside the authorized relation, so a match can never widen the scope.
- G. COUNT/List assertion: the filtered `total` equals the filtered row count and the filtered set is a
  subset of the unfiltered authorized set.
- H. Zero-write assertion: `databaseDigest` before and after every query.
- I. Database-specific behaviour: this is the measured dimension. The gate runs the case probe
  (`q = 'cus-w11-case'` and `q = 'CUS-W11-CASE'`), the accent probe (`q = 'muller'` and `q = 'müller'`
  against `Müller GmbH`) and a wildcard probe (`q = '%'` and `q = '_'`), records the four result sets of
  both engines, and asserts only what the business contract defines: the ASCII case-insensitive match, the
  authorized-subset invariant, the count agreement and the zero-write guarantee. The accent outcome is
  recorded as a typed finding and is never asserted as cross-engine equality.
- J. Failure criteria: a differing ASCII case-insensitive result, an unauthorized customer in a result
  set, a count that disagrees with the rows, or a zero-write violation. A recorded accent divergence is a
  finding, not a failure.

**S05 — `W11-A-U3-E3-S05`: the exact identity filter and the invalid input contract**

- B. R-U3-GATE-01, R-U3-2 of the existing Requirement.
- E. Expected business result: a complete identity triple returns exactly the matching option, and an
  incomplete identity is refused with HTTP 400 `CREDIT_QUERY_OPTIONS_INVALID_INPUT`; the same holds for an
  out-of-range `limit`, a negative `offset`, a malformed business date and an over-long query text.
- F. Unauthorized result: an identity that names an unauthorized customer returns an empty page with
  `total = 0`, which is indistinguishable from an unknown identity.
- G. COUNT/List assertion: the exact-identity page has `total` equal to zero or one and the row count equal
  to the same value.
- H. Zero-write assertion: `databaseDigest` before and after the refused and accepted reads.
- I. Database-specific behaviour: the exact filter is an equality on the business key and is therefore
  collation-independent, so it must be identical on both engines without any normalization.
- J. Failure criteria: a differing status, a differing error code, a differing total, or a non-empty page
  for an unknown or unauthorized identity.

**S06 — `W11-A-U3-E3-S06`: the effective-date window and the revoked membership**

- B. R-U3-GATE-01 items 6 and 7.
- E. Expected business result: a historical business date returns the Profile versions effective on that
  date while the authorization decision still uses the server's current date; a historical date never
  restores a revoked self membership, and the `sp-expired` and `sp-future` memberships stay invisible.
- F. Unauthorized result: the expired and future sub-limit scope types never appear for any business date.
- G. COUNT/List assertion: the count for a historical date equals the number of logical options effective
  on that date and the row set equals the effective set.
- H. Zero-write assertion: `databaseDigest` before and after the dated reads.
- I. Database-specific behaviour: the date comparison is a lexicographic comparison of `YYYY-MM-DD` strings
  on both engines; the gate asserts the effective sets agree on both engines for the shared boundaries
  `HISTORICAL`, `YESTERDAY`, `TODAY` and `FUTURE_DATE`.
- J. Failure criteria: a differing effective set, a restored revoked membership, or a count that disagrees
  with the rows.

**S07 — `W11-A-U3-E3-S07`: the ambiguous effective Profile**

- B. R-U3-GATE-01 item 12.
- E. Expected business result: two effective versions of the same effective scope answer HTTP 409
  `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` on both engines and never a silently collapsed option.
- F. Unauthorized result: the 409 does not disclose the version count, the version identities or the
  version dates.
- G. COUNT/List assertion: the ambiguous read returns no options and no total, because it is refused before
  the projection.
- H. Zero-write assertion: `databaseDigest` before and after the refused read.
- I. Database-specific behaviour: the ambiguity check groups by
  `customer_id, credit_object_type, credit_object_id, salesperson_scope_key` with `HAVING COUNT(*) > 1`;
  the gate asserts the same 409 on both engines for the same fact.
- J. Failure criteria: a missing, a different or a non-disclosing 409, or a collapsed option instead of a
  refusal.

**S08 — `W11-A-U3-E3-S08`: the unknown exact identity**

- B. R-U3-GATE-01, the non-enumeration clause of R-U3-2.
- E. Expected business result: an unknown identity returns an empty page with `total = 0` and HTTP 200.
- F. Unauthorized result: the unknown identity and an unauthorized identity produce byte-identical
  responses, so the response cannot be used to probe for the existence of a customer.
- G. COUNT/List assertion: `total = 0` and the row count is zero in both cases.
- H. Zero-write assertion: `databaseDigest` before and after both reads.
- I. Database-specific behaviour: no existence probe is possible through the projection, because the count
  is computed over the authorized relation on both engines.
- J. Failure criteria: a differing status, body or total between the unknown and the unauthorized case, or
  any row in either result.

**S09 — `W11-A-U3-E3-S09`: the repeatable, zero-write measurement**

- B. R-U3-GATE-01 item 14.
- E. Expected business result: two identical reads of the same query return byte-identical option sets,
  totals, orderings and scope types on both engines.
- F. Unauthorized result: a denied read is repeatable in the same way and never returns a row.
- G. COUNT/List assertion: the repeated reads agree on `total`, on the option key sequence and on the order.
- H. Zero-write assertion: `databaseDigest` is identical before and after the whole measurement block on
  both engines; this is the strongest zero-write proof because the digest covers every table.
- I. Database-specific behaviour: the digest enumerates the base tables through
  `information_schema.tables` on MySQL and through `sqlite_master` on SQLite, which is the proven
  cross-engine helper of the shared fixture.
- J. Failure criteria: any digest difference, any non-repeating read, or a differing order between the
  engines.

**S10 — `W11-A-U3-E3-S10`: the ordering, the collation and the grouping review**

- B. R-U3-GATE-01 items 11 and 13; R-U3-GATE-03 and R-U3-GATE-04.
- E. Expected business result: the option order is stable across two reads and across the page boundary on
  both engines, and the order of the collation-unambiguous ASCII fixture identities is identical on both
  engines.
- F. Unauthorized result: the order never places an unauthorized option into the page, and the total never
  exceeds the authorized count.
- G. COUNT/List assertion: the ordered key sequence of the unpaginated read equals the concatenation of the
  ordered key sequences of the pages.
- H. Zero-write assertion: `databaseDigest` before and after the ordering probe.
- I. Database-specific behaviour: the read-only probe of §37.54.36.5 runs first, and the case, accent,
  duplicate-display-name and wildcard probes are measured and recorded. The collation-dependent outcome is
  recorded as a finding and is never asserted as equality.
- J. Failure criteria: an unstable order, a differing order on the collation-unambiguous identities, a
  page overlap, or a zero-write violation. A recorded collation divergence is a finding, not a failure.

#### 37.54.36.5 Collation and grouping analysis

The following facts were established without a MySQL server, by driving `bootstrapMySql` with a recording
mock adapter and by reading the production writers.

**The emitted MySQL DDL.**

```text
CREATE TABLE IF NOT EXISTS `customers` (
  `id` VARCHAR(128) NOT NULL,
  `code` VARCHAR(128) NOT NULL,
  `name` LONGTEXT NOT NULL,
  `active` BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

CREATE TABLE IF NOT EXISTS `credit_profile` (
  `customer_id` VARCHAR(128) NOT NULL,
  `salesperson_scope_key` VARCHAR(128) NOT NULL,
  `credit_object_type` LONGTEXT NOT NULL,
  `credit_object_id` VARCHAR(128) NOT NULL,
  `effective_from` VARCHAR(128) NOT NULL,
  `effective_to` LONGTEXT,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ...
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
```

**PAD_ATTRIBUTE.** `utf8mb4_0900_ai_ci` is a `NO PAD` collation, so a `VARCHAR` comparison does not ignore
trailing spaces the way the `utf8mb4_bin` family does. The gate does not assume this. It reads
`information_schema.collations` for `PAD_ATTRIBUTE` and `IS_COMPILED` of the live collation and records
the value, together with `@@collation_server`, `@@collation_connection` and `@@max_sort_length`, in the
S10 evidence. The probe is read-only and uses the same `information_schema.columns` pattern that
`server/database/mysql-schema.js` and `server/migrations/sales-customer-wave8-service-consignment.js`
already use for the column metadata.

**The LONGTEXT grouping question, answered.** The `LONGTEXT` type alone does not prove a truncation
collision, and the current fixture being short does not prove the supported range. The decisive fact is the
production write contract:

- `credit_object_type` is written through `requiredCode`, which is `requiredText(value, label, 50)`
  followed by `/^[A-Za-z0-9_-]+$/` and `toUpperCase()`. The field is therefore at most 50 characters,
  ASCII only, and stored uppercase.
- The truncation boundary of a MySQL group or sort key on a `TEXT` column is `max_sort_length`, 1024 bytes
  by default. 50 characters can never reach it, and an ASCII-only, uppercase-normalized value cannot
  collide by case either.
- The `GROUP BY` of the selector is
  `cp.customer_id, c.code, c.name, c.active, cp.credit_object_type, cp.credit_object_id`.
  `c.name` is also a `LONGTEXT` group key, but `cp.customer_id` is in the same group key and determines
  `c.code`, `c.name` and `c.active` functionally, so the name can neither merge nor split a group.

Conclusion: for the currently supported business range, no MySQL grouping truncation or collation
collision is reachable, and this is a property of the production writer contract rather than of the
current fixture. The gate therefore does not need a truncation probe. It still records the read-only
column metadata, the live `PAD_ATTRIBUTE` and `@@max_sort_length`, and the observed maximum byte length of
`credit_object_type` in the fixture, so the boundary is re-proved on the live target instead of assumed.
The gate must not modify the schema, the collation or any database configuration.

**The case and accent question, resolved as a risk rather than a rule.** The comparison that is affected
is the search relation:

```sql
(LOWER(c.code) LIKE LOWER(?) OR LOWER(c.name) LIKE LOWER(?)
  OR LOWER(cp.credit_object_type) LIKE LOWER(?) OR LOWER(cp.credit_object_id) LIKE LOWER(?))
```

`LOWER` folds ASCII only on SQLite, while on MySQL the same columns are compared under
`utf8mb4_0900_ai_ci`, which folds case and accents. The consequences are exact and bounded:

- for `credit_object_type`, no divergence is possible, because the writer restricts it to ASCII uppercase;
- for `customers.code` and `credit_profile.credit_object_id`, no divergence is possible for ASCII input,
  because ASCII case folding is identical on both engines;
- for `customers.name`, which is free text, a Latin accent makes the two engines differ: `q = 'müller'`
  matches on MySQL and does not match on SQLite, and `q = 'muller'` matches on MySQL because the collation
  is accent-insensitive and does not match on SQLite;
- the `UNIQUE (code)` key and the `PRIMARY KEY (id)` are themselves under the accent- and
  case-insensitive collation, so two business identities that differ only by case or accent cannot be
  stored on MySQL at all, while SQLite accepts them. This is a storage-level environment difference, not a
  business result, and the fixture must not seed such identities.

The business contract does not define the case and accent semantics, so the gate must not freeze one. The
Requirement registers this as an open decision, R-U3-GATE-04. The gate measures it, asserts only the
defined invariants, records the divergence as a typed finding and leaves the decision to the Requirement
layer and the business owner. The U3 Freeze stays blocked while that decision is open.

#### 37.54.36.6 Independent suite design

`server/mysql-sales-customer-wave11-a-credit-query-options.integration.js`.

- It is a MySQL integration suite. The repository convention is that a `*.integration.js` file is executed
  only by a protected MySQL campaign. No such file is registered in `scripts/testing/test-suites.js`, and
  this one must not be registered either: it requires a live disposable target and the protected reset
  authorization, which is outside the FAST criterion of a bounded, database-free regression and outside the
  FULL criterion of an engine-neutral regression. Registering it would make the ordinary regression reach
  MySQL, which is prohibited.
- It is flat top-level TAP only: exactly ten top-level `test()` calls, no `describe`, no nested plan, one
  test name per line.
- It runs with `--test-concurrency=1`, which the protected campaign already passes, so the ten tests share
  the database sequentially.
- It never writes a line that the strict TAP parser could read as a record. Every diagnostic is emitted as
  a TAP diagnostic whose first word is not one of `tests`, `suites`, `pass`, `fail`, `cancelled`,
  `skipped` or `todo`, and the evidence JSON is written to a file outside the repository, never to stdout.
- The evidence file is written to `U3_SELECTOR_EVIDENCE_DIR` when it is set and to a fresh directory under
  the operating system temporary directory otherwise. It never writes inside the working tree, so a gate
  run cannot pollute the repository.
- The engine facts are collected per engine and compared only through the stable business key
  `customerId + creditObjectType + creditObjectId`. A raw Profile id, an anchor id, a request id or a
  timestamp is never compared between the engines.
- Each engine first satisfies the complete contract on its own. Only then is a comparison made, and the
  comparison is made per requirement item rather than per total.

#### 37.54.36.7 Independent runner design

`scripts/gates/mysql-sales-wave11-a-selector-gate.mjs`.

- It follows the frozen runner `scripts/gates/mysql-sales-wave11-a-gate.mjs` exactly and reuses
  `runProtectedMySqlCampaign` from `scripts/gates/mysql-wave10-runner-support.mjs`. The frozen runner and
  the frozen W11-A U2 E3 integration suite are not modified, and the U3 Selector cases are never added to
  the old E3 suite.
- Its campaign label is `W11-A U3 SELECTOR MYSQL E3 ACCEPTANCE`, its suite label is
  `W11-A-U3-SELECTOR-OPTIONS` and its suite file is the new integration suite.
- The new `package.json` script name is `test:mysql:wave11-a:selector`. The name is free: the existing
  MySQL scripts are `test:mysql`, `test:mysql:legacy`, `test:mysql:concurrency`, `test:mysql:gate-a`,
  `test:mysql:wave10`, `test:mysql:gate-b`, `test:mysql:wave11-sec`,
  `test:mysql:wave11-a`, `test:mysql:local`, `test:mysql:local:setup`, `test:mysql:performance` and
  `test:mysql:finance-concurrency`, and `test:mysql:wave11-a:selector` is not among them. The existing
  `test:mysql:wave11-a` keeps pointing at the frozen U2 E3 gate.
- The gate is executed only through `scripts/gates/run-mysql-local-gate.ps1 -Script
  test:mysql:wave11-a:selector`, which is the protected launcher and which already accepts any script name.

#### 37.54.36.8 Exact implementation whitelist

The complete file set that a future Implementation stage may touch. No other path may be touched, and a
later Implementation stage must not expand this list without a new authorization.

| Path | Action | Reason |
| --- | --- | --- |
| `server/mysql-sales-customer-wave11-a-credit-query-options.integration.js` | new | the independent MySQL integration suite |
| `server/test-utils/wave11-a-selector-gate-fixture.js` | new | the dedicated selector gate fixture helper |
| `scripts/gates/mysql-sales-wave11-a-selector-gate.mjs` | new | the independent protected gate runner |
| `package.json` | modify | exactly one new script `test:mysql:wave11-a:selector` |
| `document.md` | modify | the Requirement record and, after a real run, the acceptance evidence record |
| `solution.md` | modify | this Design record and, after a real run, the execution record |
| `log/<date>.md` | append | the stage log |

Explicitly **not** in the whitelist: `scripts/testing/test-suites.js`, because a MySQL integration suite is
never registered in the SQLite regression registry; `server/modules/credit-query-options.js`,
`server/modules/credit-query.js`, `server/modules/credit-check.js`, `server/modules/credit-scope.js`,
`server/lib/route-table.js`, `server/app.js`, `src/`, every migration and every schema file; the shared
fixtures `server/test-utils/wave11-sec-scope-fixture.js` and
`server/test-utils/wave11-a-credit-query-fixture.js`; the frozen runner
`scripts/gates/mysql-sales-wave11-a-gate.mjs`; the frozen E3 suite
`server/mysql-sales-customer-wave11-a-credit-query.integration.js`; and the shared runner support module
`scripts/gates/mysql-wave10-runner-support.mjs`.

#### 37.54.36.9 Protected target contract review

The review confirms that the protected contract of §37.54.35.7 F is complete and that no new gate-specific
requirement is missing. The identity preflight proves the server UUID, the current account and the grants
fingerprint against the pinned baseline; the MySQL 8 version policy is enforced; the initial inventory must
be `EMPTY_ONLY`; the reset authorization and the destructive operation set must be the approved ones; the
machine-wide named mutex serializes every schema-clearing gate for the target; the TAP transcript is
validated strictly; the cleanup is deterministic; and the five object categories are re-counted on a fresh
session after the run, so the cleanup conclusion does not depend on the gate's own report. A drifted
identity, a non-empty initial inventory or a failed cleanup fails or blocks the gate. Re-pinning the reset
authorization fingerprint, creating a new test database, changing the MySQL instance or relaxing any check
is forbidden.

The strict TAP acceptance is exact: one `TAP version 13` header, exactly one top-level plan, the planned
count equal to the parsed top-level record count, contiguous and unique test ids, every record a plain
`ok`, every summary field present exactly once, `tests = pass = planned`, and `fail`, `cancelled`,
`skipped` and `todo` all zero. A `Bail out!`, a malformed record, a nested plan, a truncated transcript or
any skip or todo marker fails the campaign.

#### 37.54.36.10 Prevention of the previous E3 failure patterns

| Previous failure pattern | The design control |
| --- | --- |
| random UUIDs causing a cross-engine order difference | only the stable business key is compared; the order is asserted on the business key sequence, never on the technical id |
| selecting a destructive fixture by physical id | the fixture identities are named business identities created by the production writers; the ambiguous-version case is the one fixed technical id, created identically on both engines |
| comparing raw capture timestamps byte for byte | no timestamp is compared across engines; the effective-date boundaries are the named business dates `HISTORICAL`, `YESTERDAY`, `TODAY` and `FUTURE_DATE` |
| cross-engine fixture pollution | the SQLite and the MySQL side are two separate databases created by the identical helper; no state is shared and no side writes to the other |
| an unverified COUNT/List equivalence | the COUNT is compared with the union of the pages and with the unpaginated set, per mode and per filter, in S03 |
| over-normalization hiding a real field difference | the DTO field set is compared exactly, field by field, with no normalization, in S03 |
| comparing only the final total | the logical option key sets are compared, not only the totals, in S03, S04, S05, S06 and S09 |
| resolving a failure with a skip, a todo or a weakened assertion | the strict TAP acceptance rejects any skip, todo, not-ok, bail-out or missing record; the design forbids lowering a classification |

The normalization rule is explicit: a value may be normalized only after each engine has independently
satisfied the complete contract, and only a technical identity may ever be normalized. A business identity,
a permission outcome, an amount, a classification, a grouping result and a pagination partition are never
normalized.

#### 37.54.36.11 Freeze preservation and documentation integrity

The frozen identities stay untouched: `server/modules/credit-check.js` is
`6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1` and `server/modules/credit-query.js` is
`24889d82a602cd2cd11807dd11807bbfa163f584b7fb6c13f55f62cdb0d04133b`. The W11-SEC, U1, U2, the OVERDUE
evidence foundation, the CSP/CCHK identity and the ONE_TIME approval semantics keep their freeze
identities. The version stays `1.6.2` and no annotated tag is created, moved or deleted.

The existing evidence keeps its exact identity: the U3-C browser acceptance PASS and its evidence
directory, the original B06 FAIL with its preserved screenshot and failure JSON and their SHA-256 values,
the B06 fix evidence, the FAST 500/500 result, the FULL 3046/3046 result and the 1966-module build. None
of them may be restated as a real MySQL result. `document.md` and `solution.md` were amended
append-only, and `log/2026-10-30.md` is append-only.

#### 37.54.36.12 Implementation and execution readiness

The Implementation stage is ready to start against the whitelist of §37.54.36.8 and is expected to produce,
without any further design change:

1. the new integration suite with exactly ten flat top-level TAP tests;
2. the new dedicated fixture helper;
3. the new protected runner and the single `package.json` script;
4. the focused local run of the new suite on SQLite only, as a dry proof that the ten tests are sound
   before any MySQL execution;
5. a real MySQL execution through `scripts/gates/run-mysql-local-gate.ps1 -Script
   test:mysql:wave11-a:selector`, which needs its own explicit user authorization.

The real MySQL execution remains unauthorized in this stage. No MySQL connection, schema reset, runner or
gate was executed here.

#### 37.54.36.13 Open decision and residual risks

1. The case and accent semantics of the free-text customer name search remain an open business decision,
   registered in `document.md` R-U3-GATE-04. The gate measures and reports it; it does not decide it, and
   the U3 Freeze stays blocked until the business owner decides.
2. The MySQL server facts `PAD_ATTRIBUTE`, `@@max_sort_length` and the live collation are read on the
   target at run time and recorded. The analysis of §37.54.36.5 relies on the emitted bootstrap DDL and on
   the production writer contracts, both of which are repository facts; the run-time probe is the proof
   that the live target matches them.
3. The gate proves the Selector surface only. It does not extend the MySQL coverage of SC101, SC102, the
   OVERDUE evidence, the CSP/CCHK identity or the ONE_TIME approval semantics, which keep the evidence
   that their own frozen E3 campaign already produced.
4. The real MySQL result is an evidence milestone, not an acceptance of the U3 capability and not a Freeze.

**Design status: `W11_A_U3_MYSQL_SELECTOR_GATE_DESIGN_READY`.**

### 37.54.37 W11-A U3 Selector Protected MySQL Gate — Implementation Record (2026-10-30)

#### 37.54.37.1 Authorization and boundary

The user authorized the Implementation only: the S01 to S10 integration suite, the independent runner,
the dedicated fixture, the package script and the local non-MySQL verification. A real MySQL
connection, a MySQL reset, the real gate execution, a production Selector change, a new business
semantic, the Final Acceptance/Freeze and every Git write were not authorized and did not happen.

This record is the as-built description of the seven authorized paths. It does not claim a real MySQL
result.

#### 37.54.37.2 The three new artifacts

| Path | SHA-256 | Role |
| --- | --- | --- |
| `server/mysql-sales-customer-wave11-a-credit-query-options.integration.js` | `a65aa2d01bccb98923b6a6e217dd72e122d0ce646ba3dd4d999c9a69755dd69f` | the protected MySQL integration suite, ten flat top-level TAP tests |
| `server/test-utils/wave11-a-selector-gate-fixture.js` | `64d394b15842035fa4d59460e2a5ff2eb28895e2f97da5df2595dd9ad705d575` | the dedicated selector gate fixture and the read-only MySQL metadata probe |
| `scripts/gates/mysql-sales-wave11-a-selector-gate.mjs` | `e1cbf47190b991b4174e173929f73e70bc51ddaab7600ed3c434735c591fa779` | the independent protected gate runner |
| `package.json` | `43d6ec696d2a54896c6968bc163710341a8a85431bad9efa29cdd44169047dee` | one new script `test:mysql:wave11-a:selector` |

The package script count for `test:mysql*` is now 13. The existing `test:mysql:wave11-a` still points
at the frozen U2 E3 gate. The version stays `1.6.2`.

#### 37.54.37.3 The fixture identities and their determinism proof

The dedicated fixture reuses the shared W11-SEC world read-only and extends it with the business
identities the world does not contain. Every Credit Profile is created through the production writer
`createCreditProfile`; the single direct insert is the ambiguous effective version, which the
production writer deliberately refuses to create because it forbids an overlapping version.

| Identity | Code | Name | Profiles | Purpose |
| --- | --- | --- | --- | --- |
| `cus-w11-case` | `Cus-W11-Case` | `Müller GmbH` | one aggregate | the mixed-case code and the accented name |
| `cus-w11-unicode` | `CUS-W11-UNICODE` | `Ångström AB` | one aggregate | the non-ASCII capital letter |
| `cus-w11-multi` | `CUS-W11-MULTI` | `Multi Object Customer` | two aggregates, two Credit Objects | multiple Credit Objects |
| `cus-w11-dup-a`, `cus-w11-dup-b` | `CUS-W11-DUP-A`, `CUS-W11-DUP-B` | both `Shared Display Name` | one aggregate each | the same display name on two logical customers |
| `cus-w11-window` | `CUS-W11-WINDOW` | `Date Window Customer` | one aggregate, one sub-limit of `sp-self` that ends on the historical date | the effective-date window |
| `cus-w11-subonly` | `CUS-W11-SUBONLY` | `Sub Limit Only Customer` | one sub-limit of `sp-other` | a customer that only owns a sub-limit scope |
| `cus-w11-ambig` | `CUS-W11-AMBIG` | `Ambiguous Version Customer` | one aggregate | the ambiguous effective version |

Determinism proof. Every business identity is named, never generated. The only generated values are the
Profile ids, the anchor ids, the rating ids and the idempotency keys, and none of them is compared
across engines. The comparison key is always the stable business key
`customerId + creditObjectType + creditObjectId`. The fixture writes one fixed technical id for the
ambiguous version, `u3-selector-ambiguous`, on both engines, and removes it again in the same test.

The measured logical option counts on the reference engine are: `ADMIN` 13, `CROSS_READER` 13,
`SELF_ACTOR` 12, `OTHER_ACTOR` 13, and 12 for each of the three aggregate-only readers. The difference
is real and is the point of the fixture: `sp-other` owns the sub-limit of `cus-w11-other` and of
`cus-w11-subonly`, so only that reader sees the sub-limit-only customer, and `sp-self` owns the
sub-limit of `cus-w11-self` and of the window customer.

#### 37.54.37.4 The suite structure

The suite drives `listCreditQueryOptions` through the shared `read` helper of the W11-SEC fixture, so a
refused read never leaves the handler. It creates the MySQL target with `createTempDb` under the
protected disposable target guard, exactly like the frozen E3 suite, and it creates the SQLite
reference with `createDatabase` on a temporary directory, because `createTempDb` would resolve to MySQL
inside the protected campaign.

| Case | Identity | Assertion content |
| --- | --- | --- |
| S01 | `W11-A-U3-E3-S01` | the dialect of each side, the identical option sets, the identical totals and the zero-write digests |
| S02 | `W11-A-U3-E3-S02` | the exact option set, scope types and count of seven readers, the denied reader, and the `CREDIT_VIEW`-only permission set |
| S03 | `W11-A-U3-E3-S03` | the seven-field DTO, the grouping of two Profile versions, the two Credit Objects, the two same-named customers, and the non-overlapping pagination that rebuilds the set |
| S04 | `W11-A-U3-E3-S04` | the six defined search probes on both engines and the wildcard parity with the authorized-subset invariant |
| S05 | `W11-A-U3-E3-S05` | the exact identity, a different Credit Object, a different Credit Object type and six refused inputs with identical codes on both engines |
| S06 | `W11-A-U3-E3-S06` | the historical and the current effective version of the window customer, and the revoked membership that a historical date does not restore |
| S07 | `W11-A-U3-E3-S07` | the HTTP 409 `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` on both engines and the restored read after the temporary version is removed |
| S08 | `W11-A-U3-E3-S08` | the byte-identical response of an unknown and an unauthorized identity, and the scope predicate applied before the projection |
| S09 | `W11-A-U3-E3-S09` | two identical reads and the unchanged database digest |
| S10 | `W11-A-U3-E3-S10` | the read-only MySQL collation metadata, the truncation-boundary proof, the stable order of the collation-unambiguous identities, the stable pagination and the full measurement matrix |

#### 37.54.37.5 The runner wiring and the safety controls

The runner is a six-line gate entry. It imports `runProtectedMySqlCampaign` from
`scripts/gates/mysql-wave10-runner-support.mjs`, declares its own suite label
`W11-A-U3-SELECTOR-OPTIONS`, its own file and its own campaign label
`W11-A U3 SELECTOR MYSQL E3 ACCEPTANCE`. It contains no reset, no identity check, no cleanup and no
TAP parser, and it does not reference the frozen U2 E3 gate.

The suite itself refuses to start without the five `ERP_DB_*` variables and without
`ERP_MYSQL_TEST_ALLOW_RESET=true`. `createTempDb` adds the disposable-target guard, which refuses a
target whose name lacks the disposable hint or whose identity does not match the approved one. The
protected launcher remains the only entry point, so the machine-wide mutex, the identity pins, the
`EMPTY_ONLY` initial inventory, the destructive operation set, the strict TAP validation and the
five-category zero inventory are unchanged and owned by the existing machinery.

#### 37.54.37.6 The strict TAP compatibility

The suite is flat top-level TAP only: exactly ten `test()` calls, no `describe`, no `it`, no nested
plan helper, no skip, no todo and no only. The ten names map one to one onto S01 to S10 and each one
is a single line whose first character is not a space, so every name renders as a plain `ok N - name`
record. The suite writes no TAP record and no TAP summary line to stdout. Its only stdout output is
one diagnostic that starts with `# W11-A-U3-E3 EVIDENCE`, whose first word is not one of the reserved
summary names. The evidence JSON is written to a file outside the repository, to `U3_SELECTOR_EVIDENCE_DIR`
when it is set and to a fresh temporary directory otherwise.

#### 37.54.37.7 The open semantic decision inside the gate

`CUSTOMER_NAME_SEARCH_SEMANTICS_OPEN` is the exact marker carried by the suite, by the evidence file
and by the campaign output.

The measurement matrix of S10 covers the ASCII case, the Unicode case, the accent, the customer name
search, the group-by behaviour, the order and the stable pagination. Every measured probe records the
SQLite result, the MySQL result and whether they diverge. The gate asserts only what the business
contract defines for each probe: the HTTP status, that the result never leaves the authorized set,
that the count agrees with the number of rows, and, for the defined probes, the exact expected set.

The reference SQLite results of the probes are known and are recorded here as the reference, not as an
engine authority:

| Probe | SQLite reference | Expected MySQL behaviour |
| --- | --- | --- |
| `cus-w11-case` | the case customer | the same |
| `CUS-W11-CASE` | the case customer | the same |
| `muller` | no row | the case customer, because the MySQL collation folds the accent |
| `müller` | the case customer | the same |
| `Müller` | the case customer | the same |
| `MÜLLER` | no row | the case customer, because the MySQL folding is Unicode aware |
| `ångström` | no row | the unicode customer, because the MySQL folding is Unicode aware |
| `Ångström` | the unicode customer | the same |
| `cus-w11-sel\f` | no row | the self customer, because the MySQL `LIKE` treats the backslash as an escape character and the SQLite `LIKE` does not |
| `%` and `_` | the whole authorized set | the same, and the parity is asserted |

The last row of that table is a genuine cross-engine result difference that is not only a case or
accent question: the backslash is an escape character in a MySQL `LIKE` pattern and it is not in
SQLite, so the same query text selects a different row. It is recorded under the same open decision
and it is measured, never asserted away.

#### 37.54.37.8 The truncation-boundary proof

S10 reads the live MySQL facts with a read-only probe: `@@max_sort_length`, `@@collation_server`,
`@@collation_connection`, `@@sql_mode`, `@@version`, the `PAD_ATTRIBUTE` and the compile flag of
`utf8mb4_0900_ai_ci` from `information_schema.collations`, the column metadata of the five grouped
`credit_profile` columns from `information_schema.columns`, and the observed maximum byte length of
`credit_object_type`.

The probe asserts only what is a property of the production contract and of the data: the observed
maximum byte length of `credit_object_type` is at most 50 characters, which is the bound of the
production writer, and it is below the group-key truncation boundary `@@max_sort_length`, which
therefore cannot be reached for the supported range. Every other fact, including the `PAD_ATTRIBUTE`
and the live collation, is recorded in the evidence file rather than asserted, so the analysis of
§37.54.36.5 is re-proved on the live target instead of assumed. The probe never writes, never changes
a session variable and never changes a schema or a collation.

#### 37.54.37.9 The local non-MySQL verification

No MySQL connection was made. The local verification consisted of:

- the syntax check of the three new files and of the package JSON;
- a static inspection that proved exactly ten top-level tests, the S01 to S10 identity mapping, the
  TAP record shape of every name, the absence of `describe`, `it`, `skip`, `todo`, `only` and a nested
  plan helper in the executable code, the runner wiring, the absence of a second reset, identity,
  cleanup or TAP parser, the absence of a direct MySQL driver, the safety of the stdout diagnostics,
  the reuse of the shared world and the production writer in the fixture, and the package script
  registration without a name conflict;
- a fixture contract review that ran the production selector against a disposable SQLite database in a
  scratch script outside the repository. It measured every expected logical option set, the five read
  modes, the DTO field set, the order, the search probes, the effective-date window, the revoked
  membership, the exact identity, the refused inputs, the ambiguity, the pagination and the zero-write
  digest. This is the source of the reference values in §37.54.37.7 and of the counts in
  §37.54.37.3;
- the existing non-MySQL regression: the four focused Credit suites 77/77, the governance suite 20/20
  and FAST 500/500, all executed through the isolation wrapper that strips every MySQL-pointing
  variable and keeps `ERP_DB_PATH` absent.

#### 37.54.37.10 The future protected execution procedure

The gate is executed only through the existing protected launcher:

```text
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/run-mysql-local-gate.ps1 -Script test:mysql:wave11-a:selector
```

The launcher proves the identity and the empty schema before the gate, takes the machine-wide mutex,
binds the destructive authorization to the pinned target, runs the campaign, re-counts the five object
categories on a fresh session and clears the sensitive variables. The campaign resets the schema before
the suite, spawns the suite with the campaign id and the encoded lease, validates the TAP transcript
strictly, resets the schema again and releases the lease. The suite writes its evidence JSON to
`U3_SELECTOR_EVIDENCE_DIR` when that variable is set.

This execution needs its own explicit user authorization and did not happen in this stage.

**Implementation status: `W11_A_U3_MYSQL_SELECTOR_GATE_IMPLEMENTED_READY_FOR_PROTECTED_EXECUTION`.**

### 37.54.38 W11-A U3 Selector Protected MySQL E3 Execution Record (2026-10-30)

#### 37.54.38.1 Authorization and boundary

The user authorized one single protected real-MySQL execution of the W11-A U3 Selector E3 gate, on the
existing disposable MySQL test database only. The authorization included the reset, recreate and cleanup
that the existing protected launcher performs on the approved disposable test schema after every safety
check has passed. It authorized no destructive operation on any other database, instance or business
data.

Not authorized and not performed: a modification of any test or production code, a modification of a
schema definition or a migration, a change of the MySQL service configuration, a reset of the
credentials or of the grants baseline, a second automatic gate run, the Final Acceptance/Freeze, any Git
write, and Merge/Tag/Release/Deploy. The gate was executed exactly once.

#### 37.54.38.2 Execution baseline and artifact manifest

Branch `work/sales-waves6-13-recovery-20261025`, HEAD
`8c716f64dbeb8d650c3dd87a43661ed205fdcfdd`, version `1.6.2`, an empty index and exactly the 30
authorized worktree paths, unchanged before and after the execution.

| Artifact | SHA-256 | Verified |
| --- | --- | --- |
| `server/mysql-sales-customer-wave11-a-credit-query-options.integration.js` | `a65aa2d01bccb98923b6a6e217dd72e122d0ce646ba3dd4d999c9a69755dd69f` | exact |
| `server/test-utils/wave11-a-selector-gate-fixture.js` | `64d394b15842035fa4d59460e2a5ff2eb28895e2f97da5df2595dd9ad705d575` | exact |
| `scripts/gates/mysql-sales-wave11-a-selector-gate.mjs` | `e1cbf47190b991b4174e173929f73e70bc51ddaab7600ed3c434735c591fa779` | exact |
| `package.json` | `43d6ec696d2a54896c6968bc163710341a8a85431bad9efa29cdd44169047dee` | exact |

The protected launcher `scripts/gates/run-mysql-local-gate.ps1`, the shared runner support
`scripts/gates/mysql-wave10-runner-support.mjs`, the frozen U2 E3 gate
`scripts/gates/mysql-sales-wave11-a-gate.mjs` and the frozen U2 E3 integration suite are unmodified
against the repository HEAD. The new integration file is not registered in the SQLite suite registry, so
it is in neither FAST nor FULL.

#### 37.54.38.3 The protected target preflight

The launcher proved the target before the campaign started, from the pinned local identity baseline and
the DPAPI-encrypted credential:

| Fact | Live value | Baseline | Match |
| --- | --- | --- | --- |
| server version | `8.0.37` | MySQL 8 policy | yes |
| server UUID | `256c7a4e-d275-11f1-885b-b025aa71d167` | identical | yes |
| current user | `modern_erp_test@127.0.0.1` | identical | yes |
| grants fingerprint | `bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e` | identical | yes |
| database identity | `modern_erp_domain_test` on `127.0.0.1:3306` | identical | yes |
| initial object inventory | tables 0, views 0, triggers 0, routines 0, events 0 | `EMPTY_ONLY` | yes |
| disposable target authorization | valid | `mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test` | yes |
| machine-wide lock | acquired | `ModernERP.MySqlGate.modern_erp_domain_test` | yes |

The setup script was not executed, the grants fingerprint was not re-pinned, the account and the
password were not changed, no test schema was created, no other MySQL instance was selected and no
object was deleted to make the preflight green. No credential, token or secret was written into the
evidence.

#### 37.54.38.4 The command and the process exit code

```text
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/run-mysql-local-gate.ps1 -Script test:mysql:wave11-a:selector
```

The real process exit code was `0`. The campaign was started once, by the launcher, and no retry loop
was used. The suite was never executed directly and the gate runner was never invoked directly.

#### 37.54.38.5 The strict TAP acceptance

The captured raw bytes were parsed independently with the repository's own strict parser
`scripts/gates/mysql-wave10-tap-transcript.mjs`:

| Condition | Result |
| --- | --- |
| TAP version | exactly one `TAP version 13` |
| top-level plan | exactly one `1..10` |
| top-level results | 10, ids 1 to 10 contiguous and unique |
| every result | plain `ok` |
| skip / todo | none |
| bail out | none |
| malformed records | none |
| summary | `tests 10`, `pass 10`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0` |
| process exit code | 0 |

#### 37.54.38.6 S01 to S10

| ID | Result | SQLite business result | MySQL business result | Assertions |
| --- | --- | --- | --- | --- |
| S01 | PASS | 13 logical options | 13 logical options | identical option sets and totals on the identical business fixture, both engines zero-write |
| S02 | PASS | admin 13, cross 13, self 12, other 13, unmapped 12, expired 12, future 12, denied 403 | the same counts, the same scope types, the same denial | the exact option set, the exact scope types and the exact count of seven readers, `CREDIT_SCOPE_DENIED` for the denied reader, and the `CREDIT_VIEW`-only permission set |
| S03 | PASS | 13 options, 7-field DTO, one option for two Profile versions, two options for two Credit Objects, two options for the same display name | identical | the approved field set only, the grouping, the count equal to the logical option count, non-overlapping pages that rebuild the set |
| S04 | PASS | the six defined probes return the expected sets, the wildcards return the 12 authorized options | identical | the defined ASCII probes, the Credit Object identity probe, the unauthorized target probe, the wildcard parity and the authorized-subset invariant |
| S05 | PASS | the exact identity returns one option, the other Credit Object returns its own, a different Credit Object type returns nothing, six inputs are refused | identical, with identical refusal codes | the exact identity, a different Credit Object, a different Credit Object type and six refused inputs with the same code on both engines |
| S06 | PASS | the historical date selects the sub-limit version and the current date does not, the revoked membership is not restored | identical | the effective-date window and the revoked self membership |
| S07 | PASS | HTTP 409 `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS`, restored afterwards to 200 with one option | identical | the existing 409 semantic, never a collapsed option, and the version count is not disclosed |
| S08 | PASS | the unknown and the unauthorized identity return byte-identical bodies | identical | non-enumeration and the scope predicate applied before the projection |
| S09 | PASS | two identical reads, unchanged digest | two identical reads, unchanged digest | repeatability and the zero-write guarantee over the complete database digest |
| S10 | PASS | the reference order and the reference search results | the live metadata, the reference order and the measured search results | the read-only MySQL metadata, the truncation-boundary proof, the stable order of the collation-unambiguous identities, the stable pagination and the full measurement matrix |

#### 37.54.38.7 The live MySQL metadata

| Fact | Live value |
| --- | --- |
| server version | `8.0.37` |
| `@@sql_mode` | `IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` |
| `@@max_sort_length` | `1024` |
| `@@collation_server` | `utf8mb4_0900_ai_ci` |
| `@@collation_connection` | `utf8mb4_general_ci` |
| `utf8mb4_0900_ai_ci` | `PAD_ATTRIBUTE = NO PAD`, `IS_COMPILED = Yes` |
| `credit_object_type` | `longtext`, `utf8mb4_0900_ai_ci` |
| `credit_object_id` | `varchar(128)`, `utf8mb4_0900_ai_ci` |
| `customer_id` | `varchar(128)`, `utf8mb4_0900_ai_ci` |
| `salesperson_scope_key` | `varchar(128)`, `utf8mb4_0900_ai_ci` |
| `effective_from` | `varchar(128)`, `utf8mb4_0900_ai_ci` |
| `effective_to` | `longtext`, `utf8mb4_0900_ai_ci` |
| observed maximum `credit_object_type` length | 11 bytes over 18 rows |

The truncation boundary of a MySQL group or sort key on a `TEXT` column is `max_sort_length`, 1024 bytes
here. The production writer bounds `credit_object_type` to 50 ASCII uppercase characters, and the
observed maximum is 11 bytes. The boundary is therefore unreachable for the supported range and no
grouping truncation is possible. The live `PAD_ATTRIBUTE` is `NO PAD`, as the design predicted.

#### 37.54.38.8 The measured differences and their attribution

Seven probes are identical on both engines: `ascii-case-lower`, `ascii-case-upper`,
`unicode-case-exact`, `accent-exact-lower`, `accent-exact-capital`, `wildcard-percent` and
`wildcard-underscore`.

Four probes differ. They belong to two different undefined dimensions, and they do not belong to the
same one.

**Open Decision A — `CUSTOMER_NAME_SEARCH_SEMANTICS_OPEN`.**

| Probe | Query | SQLite | MySQL | Affected field |
| --- | --- | --- | --- | --- |
| `accent-folded` | `muller` | no row | the case customer | customer name `Müller GmbH` |
| `accent-upper-case` | `MÜLLER` | no row | the case customer | customer name `Müller GmbH` |
| `unicode-case-lower` | `ångström` | no row | the unicode customer | customer name `Ångström AB` |

The cause is the folding: the SQLite `LOWER` folds ASCII only, while the MySQL comparison runs under a
case- and accent-insensitive collation and folds Unicode letters. The exact-case forms of the same
text match on both engines, so only the case and accent variants differ.

**Open Decision B — `SEARCH_LIKE_ESCAPE_SEMANTICS_OPEN`.**

| Probe | Query | SQLite | MySQL | Affected field |
| --- | --- | --- | --- | --- |
| `backslash-escape` | `cus-w11-sel\f` | no row | the self customer | customer code `CUS-W11-SELF` |

The cause is the escape semantics, not the folding: `NO_BACKSLASH_ESCAPES` is absent from the live
`sql_mode`, so the backslash escapes the following character in a MySQL `LIKE` pattern, while the SQLite
`LIKE` treats it as a literal character. The same pattern is applied by the production selector to the
customer code, the customer name, the Credit Object type and the Credit Object identity, so the escape
semantics reaches all four searchable fields; the measured instance is a customer code search and it is
therefore not attributable to the customer-name case and accent question.

**No defined contract is violated.** The six defined search probes of S04 return identical results on
both engines. No unauthorized customer appears in any measured result, and every measured result stays
inside the authorized set of the reader. The logical count, the grouping, the pagination partition, the
stable order of the collation-unambiguous identities, the DTO field set, the refusal codes and the
zero-write guarantee are identical on both engines. The order of the full list differs only in the
position of the mixed-case customer, whose relative order against the collation-unambiguous identities is
unchanged.

#### 37.54.38.9 The cleanup

The campaign performed its final reset and reported the zero-object inventory, and the launcher then
re-counted the five object categories on a fresh session after the campaign's own report:

```text
FINAL ZERO OBJECTS = {"tables":0,"views":0,"triggers":0,"routines":0,"events":0}
CLEANUP = CONFIRMED (tables=0 views=0 triggers=0 routines=0 events=0)
```

The lease was released, the sensitive environment variables were cleared and the test account was kept
for the next run. There was no child timeout and no unconfirmed termination.

#### 37.54.38.10 The evidence

The controlled evidence directory outside the repository is
`C:\Users\Administrator\AppData\Local\Temp\modern-erp-w11a-u3-selector-e3-2026-10-30`.

| File | Role | SHA-256 |
| --- | --- | --- |
| `gate-run-raw.log` | the raw merged output of the single authorized execution | `f73933fc92fdf3627617b516821056ca535766236311bea9c1354c07c12b5822` |
| `gate-exit-code.txt` | the real process exit code | `075f2953c5c5005351548921c2d3d7e086c59430f396541919b2c9f1204b5be8` |
| `selector-mysql-e3-evidence.json` | the evidence JSON written by the suite | `0d2916621caa08c32464a1e4e5d8d201ca98612c1658d80e956ca554d58f63da` |
| `derived-strict-tap-verification.txt` | the independent strict TAP parse of the raw bytes | `0c61a239bfbb6a3bfd8412f56c125913fc154247511e591927e60a6af37e5925` |
| `derived-s01-s10-matrix.txt` | the derived per-case and divergence matrix | `6fa2de85dee29184390009cbf000b056d06eb7681c88d3b3141125b909592417` |

The first three files are the authoritative raw bytes; the last two are derived read-only views of them
and are labelled as such. No credential, token or secret is present in any file.

#### 37.54.38.11 Two evidence defects recorded without repair

1. The evidence summary `cases.S10.divergentProbes` lists four `null` entries. The probe records in
   `findings.collation.probes` carry the label as the object key and not as a field, so the summary
   could not project the labels. The four divergent probes are `unicode-case-lower`, `accent-folded`,
   `accent-upper-case` and `backslash-escape`, and they are recoverable from the probe object keys.
   This is a presentation defect in the evidence summary only. It affects no assertion and no verdict.
2. The evidence JSON records explicit per-case business evidence for S01, S02, S04 and S10. S03, S05,
   S06, S07, S08 and S09 are proven by their assertions, which the TAP transcript reports as plain `ok`
   results and which the frozen suite SHA fixes.

Neither defect was repaired in this round, because the round forbids any modification of the test or
production code. Both are registered for a future authorized stage.

#### 37.54.38.12 Status

The protected execution passed on every defined contract: ten of ten, a strict TAP transcript, a
process exit code of zero and a confirmed cleanup with a zero inventory in all five object categories.

The customer-name case and accent semantics and the `LIKE` escape semantics remain undecided business
rules. A gate PASS does not decide them, and the U3 Final Freeze stays blocked.

**Execution status: `W11_A_U3_MYSQL_SELECTOR_E3_EXECUTION_PASS`.**
**Freeze status: `W11_A_U3_FINAL_FREEZE_BLOCKED_BY_OPEN_SEARCH_SEMANTICS`.**

### 37.54.39 W11-A U3 Search Semantics Closure — Design Amendment (2026-10-30)

#### 37.54.39.1 Authorization, baseline and reuse

The user adjudicated POLICY-01 and POLICY-02 and authorized one consecutive sequence: a targeted
semantic audit, a bounded Requirement amendment, a bounded Design amendment and an acceptance-impact
and test plan, ending in a hard stop. No production code, test, fixture, runner, schema or migration was
modified. No MySQL was executed. The protected gate was not re-run.

The baseline is branch `work/sales-waves6-13-recovery-20261025`, HEAD
`8c716f64dbeb8d650c3dd87a43661ed205fdcfdd`, version `1.6.2`, an empty index and exactly the 30
authorized U3 worktree paths.

The Requirement layer is `document.md` "W11-A U3 Search Semantics Closure — Bounded Requirement
Amendment (2026-10-30)", R-U3-SEARCH-01 through R-U3-SEARCH-06. The reuse basis is `document.md`
R-U3-GATE-01 to R-U3-GATE-06, `solution.md` §37.54.35.7 and §37.54.36, the real MySQL E3 execution and
its S10 findings. The complete U3 audit was not repeated. The four measured divergences are the input:
`accent-folded`, `accent-upper-case`, `unicode-case-lower` and `backslash-escape`.

#### 37.54.39.2 The targeted semantic audit

**The search parameter.** `q` is read from the query string, trimmed, and rejected with HTTP 400
`CREDIT_QUERY_OPTIONS_INVALID_INPUT` when it is longer than 100 characters. It is a data filter, never
an authorization input.

**The pattern.** The module builds two patterns from `q`: a prefix pattern `q + '%'` and a containment
pattern `'%' + q + '%'`. The prefix pattern is applied to the customer code and to the Credit Object
type; the containment pattern is applied to the customer name and to the Credit Object identity. The
current relation is:

```sql
(LOWER(c.code) LIKE LOWER(?) OR LOWER(c.name) LIKE LOWER(?)
  OR LOWER(cp.credit_object_type) LIKE LOWER(?) OR LOWER(cp.credit_object_id) LIKE LOWER(?))
```

**The four search fields.** The customer code and the customer name come from the `customers` table
through an inner join; the Credit Object type and the Credit Object identity come from the
`credit_profile` table. All four are reachable only through a row that already passed the canonical
Credit Read Scope predicate.

**The escape character.** There is none today. No `ESCAPE` clause exists, so the MySQL `LIKE` uses its
default backslash escape while the SQLite `LIKE` has no default escape. This is the whole cause of the
`backslash-escape` divergence, and it is independent of the folding.

**The parameter binding.** The MySQL adapter sends the statement through `conn.query(sql, values)`,
which escapes the values client-side and interpolates them; the SQLite handle binds the values
exactly. The pattern bytes that reach the engine are therefore identical on both engines. Only the
interpretation of those bytes by `LIKE` differs, which is why the divergence is a semantic difference
and not a binding difference.

**The boundary classification.**

| Concern | Today | Under the two policies |
| --- | --- | --- |
| Search matching | `LOWER(...) LIKE LOWER(...)`, engine-dependent folding, engine-dependent escape | folded, byte-exact, literal |
| Identity exact match | `cp.customer_id=? AND cp.credit_object_type=? AND cp.credit_object_id=?` | unchanged, still an equality comparison |
| Database collation | the column collation decides the comparison: `utf8mb4_0900_ai_ci` on MySQL, binary on SQLite | irrelevant, the comparison becomes byte exact on a dedicated key column |
| Frontend input | the ordinary search box of the selector, a 180 ms debounce, a 100 character limit, no client-side filtering | unchanged |
| Authorization scope | the canonical Credit Read Scope predicate inside the same relation, applied before the grouping, the count and the pagination | unchanged |

**The count, the grouping, the order and the pagination.** The count is a derived table over the same
relation and groups by the logical key. The list groups by
`cp.customer_id, c.code, c.name, c.active, cp.credit_object_type, cp.credit_object_id` and orders by
`c.code, cp.customer_id, cp.credit_object_type, cp.credit_object_id`. The pagination applies `LIMIT` and
`OFFSET` over that order. All of it is inside the authorized relation.

**The audit conclusions.**

1. The accent and Unicode divergences are caused by the folding, not by the binding and not by the
   collation of the parameter.
2. The backslash divergence is caused by the missing escape contract, not by the folding. The two
   dimensions are independent and need independent fixes.
3. The exact identity filter is an equality comparison that runs under the column collation, so it is
   case-insensitive on MySQL and case-sensitive on SQLite. The bytes that the selector itself hands to
   it always come from the DTO of the same row, so the reachable states agree, but the difference is
   real and it belongs to the identity domain. It is disclosed here and is explicitly not changed by
   this amendment.
4. The grouping is effectively engine consistent for the reachable states, because the customer
   identity is itself case- and accent-insensitive on MySQL, so two identities that differ only by case
   or accent cannot both exist there.
5. The ordering and therefore the page partition are engine dependent while a case-varied customer
   code exists. The measured order places the mixed-case customer last on SQLite and second on MySQL.
   The defined contract, a stable order with non-overlapping pages, holds on each engine, but the page
   boundary cuts differently. This is a display-order matter, it is outside the two policies, and this
   amendment does not change the ordering rule.

#### 37.54.39.3 The option comparison

**Option A — the database collation and plain SQL.** A1: make SQLite use the MySQL collation. The
Node SQLite handle exposes no custom collation API, so this is impossible. A2: use a MySQL-only
function or collation: the two engines would diverge again. A3: keep the `LOWER` comparison: the ASCII
case folding already agrees on both engines, but the accent and Unicode folding never will, so
POLICY-01 cannot be met. A4: add the `ESCAPE` clause and escape the pattern: this meets POLICY-02
completely and needs no schema change. **A is adopted for POLICY-02 and rejected for POLICY-01.**

**Option B — a deterministic Unicode normalization applied by the application.** B1: fold in the
application and filter in JavaScript after the SQL authorization. This moves the filter, the count and
the pagination out of SQL, fetches the whole authorized set, and leaves the engine-dependent order in
place. It is rejected. B2: fold in the application and materialize the folded value in the database,
then compare byte-exactly in SQL. This meets both policies, keeps the authorization, the count, the
grouping, the order and the pagination in SQL, and keeps the SQL engine-neutral. B3: register a custom
SQL function. The Node SQLite handle supports a scalar function, but MySQL would need a stored
function, which needs a schema object, DDL privileges and a binary-log setting; the asymmetry makes it
unusable. **B2 is selected.**

**Option C — a search key or index.** The materialized key of B2 is exactly the search key of C. An index
on the key is useless, because a containment match with a leading wildcard cannot use an index, so no
index is added. The one requirement of C is the collation of the key column: it must be byte exact on
both engines, because the folded value is already normalized and any further folding by the collation
would reintroduce the very difference the policies remove. The repository already owns this exact
pattern in `server/migrations/sales-customer-wave8-service-consignment.js`, where `lot_code_key` is
`TEXT COLLATE BINARY` on SQLite and `VARCHAR(128) COLLATE utf8mb4_0900_bin` on MySQL, precisely so
that the identity never folds under a case-insensitive or trailing-space comparison. The search key
follows the same rule.

#### 37.54.39.4 The selected design

**The fold.** One pure, deterministic, locale-independent function, shared by the write paths, the
selector and the migration:

```text
fold(text) = NFKD(text) with every Unicode non-spacing mark (category Mn) removed, then uppercased
```

The verified behaviour on the texts that matter is: `Müller GmbH`, `muller` and `MÜLLER` all fold to
`MULLER` and `MULLER GMBH`; `Ångström AB`, `ångström` and `Ångström` all fold to `ANGSTROM` and
`ANGSTROM AB`; Chinese and other non-Latin text is returned unchanged; the German sharp S folds to
`SS`, so `straße` and `STRASSE` are equal; the Turkish dotted and dotless I both fold to `I`, so the
folding is locale independent; and the fold is stable across the Unicode normalization forms, so the
same text stored in the composed or the decomposed form folds to the same key.

The supported range and the boundaries are those of R-U3-SEARCH-05: the runtime Unicode version is
shared by both engines, so the two engines always agree; only the non-spacing marks are removed, so
the spacing marks of the Indic and Thai scripts survive; the compatibility-only characters are folded
as far as the runtime allows; and no language-specific equivalence beyond these rules is claimed.

**The literal pattern.** The pattern is escaped and the comparison carries an explicit `ESCAPE`
clause. The escape character is `!`, which is chosen because it is not special in either engine and
because the pattern can escape it. The rules are: `!` becomes `!!`, `%` becomes `!%`, `_` becomes `!_`,
and the backslash is left as an ordinary character because it is no longer the escape character once
the `ESCAPE` clause names `!`. The pattern that reaches the engine is therefore identical on both
engines, and the `LIKE` interpretation of it is identical as well, because the escape clause is
explicit and the key column is byte exact.

**The materialized search key.** The folded value of each of the four searchable fields is materialized
in its own column, so that the per-field pattern position of today, a prefix for the customer code and
the Credit Object type and a containment for the customer name and the Credit Object identity, is
preserved exactly.

| Column | Content | Pattern position |
| --- | --- | --- |
| `customers.code_search_key` | `fold(code)` | prefix |
| `customers.name_search_key` | `fold(name)` | containment |
| `credit_profile.credit_object_type_search_key` | `fold(credit_object_type)` | prefix |
| `credit_profile.credit_object_id_search_key` | `fold(credit_object_id)` | containment |

The columns are derived matching artifacts. They are never an identity, never a uniqueness constraint
and never a source of truth for a business value.

**The declared Schema and Migration Amendment.** The realization of the two policies inside the
current code and schema boundary is not possible without it, and it is declared here and not
implemented. The amendment is additive and bounded:

1. a new migration module that adds the four columns, gives them a byte-exact collation, and backfills
   the existing rows;
2. the SQLite registration of that migration in the migration chain of `server/db.js`;
3. the invocation of the same migration against the live MySQL adapter after the bootstrap, following
   the `migrateV14E2BusinessDate` precedent, so that an existing MySQL deployment gains the columns
   and the backfill and not only a fresh bootstrap.

The MySQL column definition is `LONGTEXT COLLATE utf8mb4_0900_bin`, the SQLite definition is
`TEXT COLLATE BINARY`, and both are nullable. The columns are nullable on purpose: a row without a key
is simply not findable by a search, and the backfill plus the write paths guarantee that every business
row has one. A leading-wildcard containment match cannot use an index, so no index is added.

The backfill recomputes the key from the source columns and is therefore idempotent. It runs in
batches, so a large customer table does not hold one long transaction.

**The write paths.** The customer keys are set by the customer create and update handlers and by the
customer bulk import; the profile keys are set by the Profile creation handler. The Profile handler
that only closes a predecessor version does not touch the searchable fields and therefore does not
recompute the keys. The shared W11-SEC fixture is frozen and is not touched; it inserts customers
directly, so the rows it creates carry no key and are not findable by a search. No frozen test searches
the selector, so no frozen assertion changes. The revisable U3-A suite and the new Selector gate
fixture create their own search customers with the keys present.

**The selector predicate.** The relation keeps its authorization predicate, its grouping, its count,
its order and its pagination, and only the four search comparisons change, from the raw column to the
key column, with the folded and escaped pattern and the explicit `ESCAPE` clause. The exact identity
filter, the seven-field DTO and every other clause of the relation are unchanged.

#### 37.54.39.5 The invariants the implementation must preserve

1. The canonical Credit Read Scope predicate stays the only authorization source. No second scope
   resolver is introduced and the search never widens the authorized set.
2. The logical count stays a derived table over the same relation, so the count and the list always
   describe the same authorized set.
3. The grouping, the order and the pagination stay in SQL and stay unchanged in rule.
4. The exact identity filter stays an equality comparison over the customer, the Credit Object type and
   the Credit Object identity.
5. The seven-field DTO and its meaning are unchanged.
6. Every measured search GET stays zero-write.
7. The refused-input contract, the unknown and unauthorized indistinguishability and the
   `CREDIT_SCOPE_DENIED` refusal are unchanged.

#### 37.54.39.6 The exact future implementation whitelist

| Path | Action | Reason |
| --- | --- | --- |
| `server/lib/search-fold.js` | new | the shared, pure, deterministic fold and the pattern escaping |
| `server/migrations/sales-customer-wave11-a-selector-search-key.js` | new | the additive migration, the byte-exact collation and the backfill |
| `server/db.js` | modify | register the migration in the SQLite chain |
| `server/database/mysql-adapter.js` | modify | run the migration against the live MySQL adapter after the bootstrap |
| `server/modules/customers.js` | modify | set the two customer keys on create and update |
| `server/modules/commercial-golive.js` | modify | set the two customer keys in the customer bulk import |
| `server/modules/credit-profile.js` | modify | set the two Profile keys on creation |
| `server/modules/credit-query-options.js` | modify | the folded, escaped, literal search predicate |
| `server/sales-customer-wave11-a-credit-query-ui.test.js` | modify | the search case uses a customer with a key; the new literal and fold cases |
| `server/sales-customer-wave11-a-search-semantics.test.js` | new | the dedicated SQLite search matrix |
| `server/test-utils/wave11-a-selector-gate-fixture.js` | modify | the search customers carry their keys |
| `server/mysql-sales-customer-wave11-a-credit-query-options.integration.js` | modify | the S10 measurement becomes an assertion; the per-case evidence records; the label defect |
| `scripts/testing/test-suites.js` | modify | one new FULL registration of the new SQLite suite, additive, following the frozen-file amendment precedent |
| `scripts/acceptance/sales-customer-wave11-a-u3-browser-uat.mjs` | modify | the browser search regression cases |
| `document.md`, `solution.md`, `log/<date>.md` | append | the implementation record |

No frozen file is modified, with two additive exceptions that follow the established precedent:
`scripts/testing/test-suites.js` receives one new FULL registration and `package.json` would receive
no change at all, because the gate script of the Selector already exists. The frozen migration
registry `server/migrations/sales-customer-domain.js` is deliberately not used, because the new
migration is registered in `server/db.js` instead.

#### 37.54.39.7 The SQLite test plan

A new suite `server/sales-customer-wave11-a-search-semantics.test.js`, registered in FULL and not in
FAST, because every case migrates a fresh database and drives the production writers.

| ID | Case |
| --- | --- |
| `SE-01` | `Müller GmbH` is found by `muller`, `Müller`, `MÜLLER` and `MULLER` |
| `SE-02` | `Ångström AB` is found by `ångström`, `Ångström` and `ANGSTROM` |
| `SE-03` | an ASCII mixed-case customer code is found by its lower and its upper form |
| `SE-04` | a Unicode case variant is found |
| `SE-05` | a literal `%` selects only a customer whose text contains a `%` |
| `SE-06` | a literal `_` selects only a customer whose text contains a `_` |
| `SE-07` | a literal `\` selects only a customer whose text contains a `\` |
| `SE-08` | a multi-character containment works and the prefix position of the customer code is preserved |
| `SE-09` | the five read modes keep their authorized sets when the query matches an unauthorized customer |
| `SE-10` | the count, the pages and the rebuilt set agree under a filtered set |
| `SE-11` | the ordering is stable and the collation-unambiguous identities keep their relative order |
| `SE-12` | every measured search GET is zero-write |
| `SE-13` | the refused-input contract is unchanged |
| `SE-14` | the exact identity filter stays an equality comparison and stays engine neutral for the bytes the DTO returns |

The four cases that the last real MySQL execution measured as divergent, `accent-folded`,
`accent-upper-case`, `unicode-case-lower` and `backslash-escape`, become equality assertions. They are
not weakened; they are reversed from a measurement into a contract.

#### 37.54.39.8 The MySQL retest plan

1. The protected gate is re-executed once through the existing launcher, with its own campaign, its
   own evidence directory and its own archive. The previous execution evidence keeps its SHA-256 and
   is never overwritten.
2. The S10 measurement of the Selector gate becomes an equality assertion for the folded and the literal
   probes, so a reappearing divergence fails the gate instead of being recorded.
3. The literal probes join the defined probes of S04.
4. The S10 metadata probe re-confirms the live `PAD_ATTRIBUTE`, the live collation and the live
   `@@max_sort_length`, and it must additionally confirm that the four key columns carry the byte-exact
   collation on the live target, which is the fact the design now depends on.
5. The migration runs against the live MySQL target inside the campaign, so the retest also proves the
   additive migration path, the byte-exact collation enforcement and the backfill on a real MySQL
   database, and the final zero-object inventory proves that the cleanup still holds.
6. The gate proves that a customer whose key was backfilled is found by the folded pattern, and that a
   customer created during the run through the production writer is found as well.

#### 37.54.39.9 The browser regression plan

The browser acceptance harness gains the search scenarios of the ordinary search box: a mixed-case
query, an accent-folded query, a literal `%`, a literal `_` and a literal `\`, each with the loading
state, the result count, the empty state for a query that matches nothing authorized, the reset of a
stale context when the query changes, the navigation into a detail from a search result and the deep
link back into that result. The four viewport widths are re-measured for the search result list, because
a longer or a CJK result text changes the layout of the list.

#### 37.54.39.10 The evidence quality improvement plan

Both defects are presentation defects of the evidence, and they are corrected in the same future
implementation as the search semantics. The correction never weakens an assertion and never rewrites a
historical run.

1. The `divergentProbes` summary: every probe record carries its own label, so the summary projects the
   real labels. After the implementation the summary reports an empty divergence list, because the four
   measured divergences are gone. The historical run keeps its four entries and its four `null` labels,
   because that file is evidence and is never modified.
2. The per-case structured evidence: every one of the ten cases writes its own record into the evidence
   file, with the business facts it proved on both engines, so the evidence is self-describing instead
   of being carried by the TAP records alone.
3. The original raw artifacts keep their SHA-256. The new run writes into a new directory. The derived
   views are labelled as derived. No historical run data is fabricated, and the corrected evidence is
   never presented as the evidence of the earlier run.

#### 37.54.39.11 The freeze compatibility

The frozen W11-SEC payloads, including `server/test-utils/wave11-sec-scope-fixture.js`,
`server/modules/credit-scope.js`, `server/modules/credit-check.js`,
`server/modules/credit-special-approval.js` and the protected launcher family, are not modified. The
frozen U2 E3 suite and the frozen W11-SEC MySQL suite keep their assertions. The additive schema
change does alter their database environment, because they gain four derived columns and the backfill
runs on their schema; their business facts and their assertions are unaffected, and the effect is
declared here so that the freeze owner can acknowledge it. The frozen `credit-query.js` and
`credit-check.js` identities, the CSP and CCHK identities, the ONE_TIME semantics, the OVERDUE evidence
foundation and the existing browser acceptance evidence are unchanged.

#### 37.54.39.12 The remaining risks and the open items

1. The additive schema change and the live MySQL migration path are the largest part of the
   implementation. They are bounded and additive, but they are a schema change and they are declared,
   not implemented.
2. The ordering and the page partition stay engine dependent while a case-varied customer code exists.
   Ordering by the folded key would remove that difference, because the key is materialized anyway, but
   it would change the visible order of such customers and is therefore outside the two policies and
   outside this amendment. It stays an open item for the business owner.
3. The exact identity filter stays collation dependent, which is an identity-domain matter and is
   explicitly out of the scope of this amendment.
4. The customers that the frozen shared fixture inserts directly carry no search key and are therefore
   not findable by a search. This affects no frozen assertion, but a future writer of that fixture must
   know it.
5. The Unicode repertoire of the folding follows the runtime, so an upgrade of the runtime can change a
   folded key. Both engines move together, so the cross-engine consistency is unaffected; the stored
   keys would have to be recomputed by a future migration.
6. The two evidence presentation defects remain open until the implementation that corrects them.

**Design status: `W11_A_U3_SEARCH_SEMANTICS_DESIGN_READY`.**

### 37.54.40 W11-A U3 Search Semantics — Final Bounded Design Correction (2026-10-30)

#### 37.54.40.1 Authorization, baseline and reuse

The user approved the deterministic logical ordering policy for the U3 Selector and authorized one final
bounded correction: the ordering requirement, the folding safety, the search key migration and writer
completeness, and the final whitelist verification. Only the Requirement and the Design are authorized.
No production code, schema, migration, test, MySQL execution, Git write, Acceptance, Freeze, Release or
Deploy happened.

The baseline is branch `work/sales-waves6-13-recovery-20261025`, HEAD
`8c716f64dbeb8d650c3dd87a43661ed205fdcfdd`, version `1.6.2`, an empty index and exactly the 30
authorized U3 worktree paths.

The Requirement layer is `document.md` "W11-A U3 Search Semantics — Final Bounded Design Correction,
Requirement Amendment (2026-10-30)", R-U3-SEARCH-07 to R-U3-SEARCH-12. The reuse basis is
R-U3-SEARCH-01 to R-U3-SEARCH-05, §37.54.39, the real MySQL E3 execution and its S10 findings, the
frozen inventory of the U2 freeze record and the W11-SEC-01 delivery commit. The whole U3 audit was not
redone.

This correction closes four gaps of §37.54.39: the ordering was left engine dependent, the folding
removed every non-spacing mark, the literal contract was stated but not bound to a concrete syntax, and
the writer completeness was asserted by file name rather than proved.

#### 37.54.40.2 D1 — The deterministic ordering design

**The order.** The Selector's order becomes an explicit, fully pinned logical order. Every field and its
comparison collation are named:

| # | Order field | Meaning | Collation |
| --- | --- | --- | --- |
| 1 | `c.code_search_key` | the Search Fold Key of the customer code, the primary key | byte exact, pinned explicitly |
| 2 | `c.code` | the original customer code bytes, the tie-break of a colliding fold key | byte exact, pinned explicitly |
| 3 | `cp.customer_id` | the original customer identity bytes | byte exact, pinned explicitly |
| 4 | `cp.credit_object_type_search_key` | the normalized Credit Object type | byte exact, pinned explicitly |
| 5 | `cp.credit_object_id_search_key` | the normalized Credit Object identity | byte exact, pinned explicitly |
| 6 | `cp.credit_object_id` | the original Credit Object identity bytes, the final tie-break | byte exact, pinned explicitly |

The byte-exact collation is `BINARY` on SQLite and `utf8mb4_0900_bin` on MySQL, both no-pad. The two
collations are chosen because the repository already uses exactly this pair for the derived key column
`lot_code_key`, precisely so that an identity never folds under a case-insensitive or a trailing-space
comparison. The comparison is pinned per field with an explicit `COLLATE` clause rather than inherited
from the column or from the connection, so the order never depends on a default. The two engines
therefore agree byte for byte.

**The total order.** The logical option is the group
`customer_id + credit_object_type + credit_object_id`, and the order ends with the original Credit Object
identity bytes, so the six fields form a total order over the logical options. No two distinct logical
options can compare equal, and no generated technical identity and no insertion order enters the order.

**The grouping consequence.** The order references the three search key columns, and the live MySQL runs
with `ONLY_FULL_GROUP_BY`, which rejects an order expression that is not in the group key and is not
provably functionally dependent on it. The three search key columns are therefore added to the group key.
The grouping partition is unchanged, because each added column is a deterministic function of a column
that is already grouped, so the groups and their contents are exactly the same as before. The logical
grouping contract of R-U3-SEARCH-03 is preserved; only the group key expression grows.

**The collision cases.**

| Case | Behaviour |
| --- | --- |
| Two customer codes with the same fold key, different original bytes | ordered by the original code bytes, field 2. On MySQL the customer code is unique under a case- and accent-insensitive collation, so two such customers cannot coexist there; the difference belongs to the environment class of R-U3-GATE-03 and not to a business result. |
| Two customer codes that differ only in their original case | the same rule: the fold key collides and the original bytes decide. The customer CSV import can create such a code on SQLite and is refused by the unique key on MySQL, which is an existing environment difference and is not introduced here. |
| Two customers that share a display name | the display name is not an order field, so the order is decided by the customer code fold key and then by the original bytes. Two same-named customers are two distinct logical options and keep a stable relative order. |
| One customer with several Credit Objects | ordered by the normalized type, the normalized identity and the original identity bytes. The type is written by the production writer as an ASCII upper-case code, so its normalized form equals its original form and the three fields are consistent. |
| The page boundary | the total order plus the identical authorized set and the identical filtered set give identical page slices on both engines, and a page is reproducible by repeating the same offset. |

**The scope.** Only the presentation order of the Selector changes. The customer identity, the Credit
Object identity, the authorization predicate, the logical grouping and the authorized result set are
unchanged, and the seven-field DTO is unchanged.

#### 37.54.40.3 D2 — The folding safety design

**The algorithm.** One pure, deterministic, locale-independent function, shared by the write paths, the
selector, the migration and the verification:

```text
fold(text):
  1. decompose with Unicode NFKD
  2. scan the decomposed code points, tracking the last base character
  3. drop a non-spacing mark only when that base is a Latin-script letter
  4. uppercase the result with the locale-independent Unicode uppercase mapping
```

The step 3 condition is the whole correction. The previous design removed every non-spacing mark, which
destroyed the meaning of the marks of the Devanagari, the Thai, the Hebrew, the Arabic, the Greek and
the Cyrillic scripts, and that loss was not harmless. The corrected algorithm folds a mark only where it
is a diacritic of a Latin letter.

**The verified behaviour.** Every case required by R-U3-SEARCH-08 was executed against the algorithm on
this runtime:

| Input | Folded | Note |
| --- | --- | --- |
| `Müller GmbH` | `MULLER GMBH` | the Latin diaeresis is folded |
| `muller` | `MULLER` | contained in `MULLER GMBH`, so the query finds the row |
| `MÜLLER` | `MULLER` | the Unicode uppercase of `Ü` is applied first |
| `Ångström AB` | `ANGSTROM AB` | the ring above and the diaeresis are folded |
| `ångström` | `ANGSTROM` | contained in `ANGSTROM AB` |
| `Ångström` | `ANGSTROM` | the composed and the decomposed form agree |
| `straße` | `STRASSE` | the sharp S maps to `SS`, so it equals `STRASSE` |
| `İstanbul` | `ISTANBUL` | the dot above the capital I is a Latin diacritic and is folded |
| `ıstanbul` | `ISTANBUL` | the dotless I maps to `I`, so all three agree and the result is locale independent |
| `中文客户` | `中文客户` | unchanged, still searchable |
| `हिन्दी` | `हिन्दी` | the Devanagari virama is preserved |
| `नँ` | `नँ` | the Devanagari chandrabindu is preserved |
| `ม้า` | `ม้า` | the Thai tone mark is preserved |
| `ที่` | `ที่` | the Thai vowel sign is preserved |
| `שָׁלוֹם` | `שָׁלוֹם` | the Hebrew niqqud is preserved |
| `مَرْحَبًا` | `مَرْحَبًا` | the Arabic harakat are preserved |
| `ά` | `Ά` | the Greek tonos is preserved, so `ά` and `α` stay different |
| `й` | `Й` | the Cyrillic breve is preserved, so `й` and `и` stay different |
| `Müller 中文 GmbH` | `MULLER 中文 GMBH` | a mixed string folds each part under its own rule |

**The supported accent forms.** The supported set is the combining marks of the Latin script, including
the precomposed Latin-1 and Latin Extended-A letters: the acute, the grave, the circumflex, the
diaeresis, the tilde, the macron, the breve, the caron, the cedilla, the ring, the ogonek and the
double acute. The supported set is stated as an explicit list so that the folding is a bounded,
documented range and not an open-ended claim.

**The disclosed loss.** Two names that differ only by a Latin diacritic are folded together. That
includes the Vietnamese syllables that differ only by their tone, because the Vietnamese tone marks are
the very same combining marks as the European accents and cannot be told apart by the mark. This loss is
disclosed, it is a consequence of the approved accent-insensitive policy, and it is confined to the
derived search key: no stored business text, no customer identity and no business value is changed by
it. The reverse direction is disclosed as well: a Hebrew, an Arabic, a Greek, a Cyrillic, a Devanagari
or a Thai name that differs only by one of its semantic marks is not folded together, so a query that
omits the mark does not find the name.

**The algorithm version and the recomputation strategy.** The fold module exports an explicit algorithm
version constant, `SEARCH_FOLD_VERSION`, which names the algorithm, the normalization form and the
mark rule. The stored key columns are bound to that version. A change of the algorithm, or a Node or
Unicode runtime upgrade that changes the repertoire or the mappings, invalidates the stored keys; the
recomputation is the same idempotent backfill, re-run as an explicit operator-triggered migration, which
recomputes every key from its source columns and therefore needs no separate repair path and no lazy
write on a read path. The Selector never repairs a key at read time; the zero-write invariant holds
absolutely.

#### 37.54.40.4 D3 — The literal LIKE contract

**The pattern construction.** The search text is folded first, then escaped, and the escape character is
`!`:

| Input character | In the pattern |
| --- | --- |
| `!` | `!!` |
| `%` | `!%` |
| `_` | `!_` |
| `\` | unchanged, because `!` is the escape character and the backslash is no longer special |
| everything else | unchanged |

**The statement.** The comparison carries an explicit escape clause, so the pattern interpretation is
defined by the statement and not by the engine:

```sql
c.code_search_key LIKE ? ESCAPE '!'
```

**The binding.** The four patterns are bound as ordinary parameters. On SQLite the parameters are bound
exactly; on MySQL the adapter escapes the values client-side and interpolates them. The pattern bytes
that reach the engine are therefore identical on both engines, and with the explicit escape clause and
the byte-exact key column the interpretation of those bytes is identical as well.

**The SQL mode.** The live MySQL runs with `sql_mode` that does not contain `NO_BACKSLASH_ESCAPES`, which
is why the backslash escaped in the previous design. With an explicit `ESCAPE '!'` clause the backslash
is no longer the escape character, so the mode cannot change the result. This is a claim that the live
retest must prove rather than a claim that is assumed here: the retest asserts the literal behavior on
the live target and records the live `sql_mode` next to it.

**The field positions.** The prefix position of the customer code and of the Credit Object type and the
containment position of the customer name and of the Credit Object identity are unchanged. The exact
identity filter remains an equality comparison and is not affected.

#### 37.54.40.5 D4 — The search key migration and the writer completeness

**The column definition.**

| Table | Column | SQLite | MySQL | Nullable |
| --- | --- | --- | --- | --- |
| `customers` | `code_search_key` | `TEXT COLLATE BINARY` | `LONGTEXT COLLATE utf8mb4_0900_bin` | yes |
| `customers` | `name_search_key` | `TEXT COLLATE BINARY` | `LONGTEXT COLLATE utf8mb4_0900_bin` | yes |
| `credit_profile` | `credit_object_type_search_key` | `TEXT COLLATE BINARY` | `LONGTEXT COLLATE utf8mb4_0900_bin` | yes |
| `credit_profile` | `credit_object_id_search_key` | `TEXT COLLATE BINARY` | `LONGTEXT COLLATE utf8mb4_0900_bin` | yes |

No index is added: a containment match with a leading wildcard cannot use an index. The columns are
derived matching artifacts, never an identity, never a uniqueness constraint and never a source of truth.

**The complete writer inventory.** The audit was executed over the actual statements of the whole
repository, not over the file names. Every write entry point that creates or changes a searchable
business value is listed:

| Write entry point | File and statement | Search key maintenance |
| --- | --- | --- |
| API customer create | `server/modules/customers.js`, `INSERT INTO customers` | both customer keys are written in the same statement |
| API customer update | `server/modules/customers.js`, `UPDATE customers SET code=?, name=?` | both customer keys are recomputed in the same statement |
| Customer CSV import commit | `server/modules/commercial-golive.js`, `INSERT INTO customers` inside `commitImport` | both customer keys are written in the same statement |
| Demo seed | `server/db.js`, `INSERT OR IGNORE INTO customers` inside `seedDemoData` | both customer keys are written in the same statement |
| Credit Profile creation | `server/modules/credit-profile.js`, `INSERT INTO credit_profile` | both Profile keys are written in the same statement |
| Credit Profile predecessor close | `server/modules/credit-profile.js`, `UPDATE credit_profile SET effective_to=?` | no key maintenance: the searchable fields are not touched |
| Frozen W11-SEC fixture | `server/test-utils/wave11-sec-scope-fixture.js`, `INSERT INTO customers` | not modified, the file is frozen. Its rows carry no key and are therefore not findable by a search. No frozen test searches the Selector, so no frozen assertion changes. |
| Frozen W10 acceptance fixture | `server/test-utils/wave10-mysql-acceptance-fixture.js`, `INSERT INTO credit_profile` | not modified. It is used by the frozen U2 E3 suite, which exercises SC101 and SC102 and never the Selector. |
| Selector gate fixture | `server/test-utils/wave11-a-selector-gate-fixture.js` | modified: its search customers carry their keys |
| U3-A suite | `server/sales-customer-wave11-a-credit-query-ui.test.js` | modified: its search case uses a customer that carries a key |
| Other test and integration files | about fifty files with direct inserts of disposable facts | out of scope. They create facts that no search has to find. The completeness proof is below. |

**The completeness proof.** Only seven source files reference the Selector at all: the owner module, the
route registration in `server/app.js`, the page, the browser harness, the gate runner, the gate suite and
the U3-A suite. Of those, exactly one both exercises the Selector and writes a searchable fact: the
U3-A suite, which is already in the implementation whitelist. The gate suite and the browser harness use
the dedicated gate fixture, which is also in the whitelist. The route registration and the page need no
change, because the literal and the folding rules are server side and the page only sends the query
text. No other test file can be affected by the search keys, because no other test file searches the
Selector.

**The twelve lifecycle points.**

| Point | How it is satisfied |
| --- | --- |
| 1. Fresh SQLite initialization | the migration runs at the end of the migration chain of `server/db.js`, after the customer and the Credit Profile tables exist |
| 2. Existing SQLite additive migration | the same migration, idempotent: the columns are added when missing and the backfill recomputes every key |
| 3. Fresh MySQL bootstrap | the SQLite snapshot already carries the migrated columns, so the bootstrap emits them, and the live MySQL migration then enforces the byte-exact collation, which the snapshot path does not carry |
| 4. Existing MySQL live migration | the migration runs against the live MySQL adapter after the bootstrap, following the `migrateV14E2BusinessDate` precedent, and adds the columns, enforces the collation and backfills |
| 5. Demo seed | the seed writes the keys in the same insert |
| 6. API customer create and update | the keys are written in the same statement |
| 7. Customer CSV import | the keys are written in the same insert; the import is idempotent on the batch status, so a replay does not write twice |
| 8. Credit Profile create and versioning | the keys are written at creation; the predecessor close does not touch the searchable fields |
| 9. Idempotency replay | the customer create replays the stored response and never re-inserts, so the key of the original insert stands; the profile create behaves the same way |
| 10. Interrupted migration or retry | the migration is idempotent and restartable: the column addition is conditional, the backfill recomputes from the source columns, and the verification pass recomputes and compares, so a retry converges |
| 11. Missing or stale key detection | the migration verification pass recomputes every stored key and compares it, and it counts the rows that carry no key. The count is reported, and the Selector never repairs a key at read time |
| 12. Backfill completeness before the search is available | the migration chain completes before any route serves, and the live MySQL migration runs before the adapter is handed to the application, so the search is reachable only after the backfill has completed |

**The backfill, the idempotency and the failure boundary.** The backfill reads the source rows in
batches, computes the key with the shared fold and writes it back. It is idempotent, because it always
recomputes from the source, and it is restartable after an interruption. The migration never swallows an
error: a failed batch aborts the migration with a non-zero result and the operator sees it. The failure
boundary is the migration itself: the columns may exist and the keys may be partially written, but the
application never starts against a half-migrated schema, because the migration runs inside the
initialization chain and a failure prevents the chain from completing. The verification pass after the
backfill fails the migration when a stored key differs from the recomputed key.

**The upgrade ordering and the version compatibility.** The new migration is registered at the end of
the SQLite chain, after the sales and the customer domain migrations, and it is invoked against the live
MySQL adapter after the bootstrap. The stored keys are bound to `SEARCH_FOLD_VERSION`. A change of the
algorithm or of the runtime repertoire requires an explicit operator-triggered recomputation migration,
which is the same idempotent backfill. No other deployment step is required.

**The zero-write invariant.** The Selector never writes. It never repairs a missing key, it never
caches a fold and it never materializes a key on a read. The only writes of a key are the write paths and
the migration.

#### 37.54.40.6 D5 — The frozen contract impact

| Category | Impact |
| --- | --- |
| A. The schema of the new derived search columns | Four additive, nullable, unindexed columns on `customers` and `credit_profile`, with a byte-exact collation on both engines, plus one migration module and its registration. No existing column changes, no constraint changes, no data of a business column is modified. |
| B. The frozen Credit Profile business fields and the permission behaviour | `credit-scope.js`, `credit-check.js`, `credit-query.js` and `credit-special-approval.js` are not modified. The scope predicate, the read modes, the check decision, the exposure DTO and the approval semantics are untouched. The search key is not part of any authorization predicate. |
| C. The existing frozen W11-SEC, U2 and OVERDUE tests | Their assertions are unchanged. Their database gains four derived columns and their fixtures gain keyless rows, which no frozen assertion observes, because no frozen test searches the Selector. The frozen shared fixtures are not modified. |
| D. The MySQL bootstrap and the migration impact | The bootstrap path gains the four columns through the SQLite snapshot, and the live MySQL migration enforces the byte-exact collation and the backfill on both a fresh and an existing database. The final zero-object inventory of the protected campaign is unaffected, because the migration creates no persistent object outside the two tables. |
| E. The new business behaviour of the Selector | The search becomes case-insensitive, accent-insensitive for the Latin diacritics, Unicode-aware and engine consistent, and literal for the three special characters. The order becomes deterministic across the engines. The authorized set, the DTO, the grouping, the count contract, the pagination contract and the zero-write property are unchanged. |

#### 37.54.40.7 D6 — The acceptance matrix

| Area | Coverage |
| --- | --- |
| The SQLite search suite | the fourteen `SE-01` to `SE-14` cases of §37.54.39.7, extended with the script-aware folding cases, the Devanagari, the Thai, the Hebrew, the Arabic, the Greek, the Cyrillic, the mixed string and the normalization form cases |
| The gate suite | S01 to S10 under the new semantics, with the four previously divergent probes turned into equality assertions and the literal probes joined to the defined probes of S04 |
| Fresh and upgraded SQLite | a fresh database and a database migrated from the previous schema, both proving the key completeness and the search results |
| Fresh and upgraded MySQL | the same two shapes on the live target, proving the migration path, the collation enforcement and the backfill |
| Unicode and literal search | the folding equivalences and the literal treatment of the three special characters, including the escape character escaping itself |
| The search key backfill | the completeness, the idempotency, the restartability and the verification pass |
| All writer paths | the API create and update, the CSV import, the demo seed and the Credit Profile creation, each asserting that the key is present and that a search finds the row |
| The search ordering | the colliding fold keys, the original case difference, the same display name, several Credit Objects and the total order |
| The exact pagination slices | the page slices of the ordered set, identical between the engines and reproducible by the same offset |
| The five Credit Read Modes | the mode matrix under a query that matches an unauthorized customer |
| The unauthorized customer exclusion | the authorized-subset invariant for every probe |
| The GET zero-write | the complete database digest around every measured search |
| The browser | the search box with the mixed-case, the accent-folded and the three literal characters, at 320, 390, 430 and 680 |
| The frozen regression | FAST, FULL, the build and the frozen suites, with the frozen SHA manifest re-verified |
| The protected MySQL cleanup | the final zero-object inventory in all five categories |

The existing real MySQL E3 PASS evidence is preserved. The retest uses a new evidence directory, the
real protected launcher and its own independent execution authorization.

#### 37.54.40.8 The final implementation whitelist

The fifteen registered paths of §37.54.39.6 are confirmed complete by the writer audit of
§37.54.40.5: every production write entry point is already covered, and the completeness proof shows
that no other test file can be affected. No path is added and no path is removed.

| Path | Action |
| --- | --- |
| `server/lib/search-fold.js` | new: the versioned fold and the pattern escaping |
| `server/migrations/sales-customer-wave11-a-selector-search-key.js` | new: the additive migration, the byte-exact collation, the batched idempotent backfill and the verification pass |
| `server/db.js` | modify: register the migration and set the keys in the demo seed |
| `server/database/mysql-adapter.js` | modify: run the migration against the live MySQL adapter after the bootstrap |
| `server/modules/customers.js` | modify: maintain the keys on create and update |
| `server/modules/commercial-golive.js` | modify: maintain the keys in the customer CSV import |
| `server/modules/credit-profile.js` | modify: maintain the keys on Profile creation |
| `server/modules/credit-query-options.js` | modify: the folded, escaped, literal search predicate and the deterministic order |
| `server/sales-customer-wave11-a-credit-query-ui.test.js` | modify: the search case and the new cases |
| `server/sales-customer-wave11-a-search-semantics.test.js` | new: the dedicated SQLite search matrix |
| `server/test-utils/wave11-a-selector-gate-fixture.js` | modify: the search customers carry their keys |
| `server/mysql-sales-customer-wave11-a-credit-query-options.integration.js` | modify: the assertions, the per-case evidence and the label defect |
| `scripts/testing/test-suites.js` | modify: one new FULL registration, additive |
| `scripts/acceptance/sales-customer-wave11-a-u3-browser-uat.mjs` | modify: the browser search regression cases |
| `document.md`, `solution.md`, `log/<date>.md` | append |

No frozen file is modified. The frozen migration registry is deliberately not used, because the new
migration is registered in `server/db.js`. `package.json` needs no change, because the Selector gate
script already exists. The page and the route registration need no change, because the rules are
server side.

#### 37.54.40.9 The remaining risks

1. The additive schema change and the live MySQL migration path remain the largest part of the
   implementation. They are declared, bounded and additive.
2. The folding merges the Vietnamese syllables that differ only by a tone. The loss is disclosed and is
   confined to the derived search key, but it is a real consequence of the approved policy.
3. The folding preserves the semantic marks of the non-Latin scripts, so a query that omits a Hebrew
   niqqud or an Arabic harakat does not find the name. This is the intended direction of the correction
   and it is disclosed.
4. The exact identity filter stays collation dependent. It is an identity-domain matter and is
   explicitly outside this amendment.
5. The customers that the frozen shared fixtures insert directly carry no key and are not findable by a
   search. No frozen assertion is affected, and the two new search suites create their search customers
   with a key.
6. A Node or Unicode runtime upgrade can change a fold and therefore invalidate the stored keys. The
   recomputation is the idempotent backfill, re-run as an explicit operator-triggered migration.
7. The two evidence presentation defects remain open until the implementation that corrects them.

**Design status: `W11_A_U3_SEARCH_SEMANTICS_DESIGN_READY_FINAL`.**

### 37.54.41 W11-A U3 Search Semantics — Implementation Gate Finding (2026-10-30)

#### 37.54.41.1 Authorization and implementation completed before the gate

The implementation authorization corrected the whitelist arithmetic to seventeen exact paths: three
new source/test paths, eleven modified code/test paths and three append-only canonical documents. It
authorized the additive SQLite migration in isolated disposable databases, but no real MySQL, protected
gate, Git write, Acceptance/Freeze, release or deployment.

Within that boundary the implementation established `SEARCH_FOLD_VERSION = W11-A-SEARCH-FOLD-V1`,
script-aware NFKD folding, explicit `ESCAPE '!'` literal patterns, four nullable byte-exact derived
columns, batched reconciliation and verification, all four production writers, SQL-side authorized
COUNT/LIST search and the Requirement order with the stable customer identity immediately after the
original customer code. The live MySQL adapter invokes the same fail-closed migration after bootstrap;
that path was implemented but not connected to a real MySQL server.

The dedicated Search/U3 focused command passed 45/45. It covers the three fold cases, SE-01 through
SE-14, eight migration cases, four writer cases and the existing sixteen U3-A/U3-B/U3-C cases. No case
was skipped, marked todo or restricted with only.

#### 37.54.41.2 Stage B incompatibility and hard stop

The Stage B command executed 103 tests: 97 passed and 6 failed. Five failures have the same root cause:
the canonical runner replays Wave 9 after the new columns exist, and
`server/migrations/sales-customer-wave9-credit-foundation.js` rejects the additive
`credit_profile` columns as `column identity/order drifted`. The sixth failure is the test cleanup of a
database handle left open after that migration exception and is not independent evidence of a second
business defect.

The approved Design assumed that the frozen Wave 9 migration would remain idempotent after the additive
columns, but the real guard proves that assumption false. None of the seventeen authorized paths owns
that guard. The prompt explicitly requires a HARD STOP when local regression reveals a whitelist-outside
dependency, and AGENTS.md requires returning to Requirement/Design when a new migration compatibility
rule is discovered.

No workaround is selected here. Candidate designs such as teaching the frozen guard to accept an exact
approved additive suffix, changing the canonical runner lifecycle, or introducing a different schema
compatibility mechanism have different freeze and upgrade consequences and require explicit business
and technical approval before implementation.

#### 37.54.41.3 Verification boundary

- Focused Search/U3: 45/45 PASS.
- Stage B: 97/103 PASS, 6 FAIL, blocked by the Wave 9 additive-column guard.
- `git diff --check`: PASS.
- Frozen SHA: `credit-check.js` remains
  `6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1`; `credit-query.js` remains
  `24889d82a602cd2cd11807bbfa163f584b7fb6c13f55f62cdb0d04133b`.
- FAST, FULL, build and browser preliminary verification: NOT_RUN after the mandatory Stage B stop.
- Real MySQL and the protected MySQL gate: NOT_RUN and not authorized.
- Git add/commit/push and Final Acceptance/Freeze: NOT_RUN and not authorized.

**Implementation status: `W11_A_U3_SEARCH_SEMANTICS_IMPLEMENTATION_BLOCKED`.**


### 37.54.42 W11-A U3 / Wave 9 Exact Additive Schema Compatibility — Design (2026-10-30)

#### 37.54.42.1 Authorization, inputs and stage boundary

The user authorized this Design consecutively with the approved Requirement in `document.md`,
R-U3-W9-COMPAT-01 through R-U3-W9-COMPAT-07. The input evidence is the real Wave 9 migration, the
canonical migration runner, both database initialization paths, the U3 Search migration and suites,
the five U1 `withFixture()` failures and the masked reopen failure. This stage changes only
`solution.md` and the real-date append-only log. It does not modify or execute code, migrations or
tests. Implementation is not authorized and this Design ends in a hard stop.

The pre-exception Wave 9 migration identity is
`87d4a6628b68645cc7ce743aaa7bf5e4244b6c9c0a3a91df1f33796ec1de4f32`. The exception name is
`WAVE9_ADDITIVE_SCHEMA_COMPATIBILITY_EXCEPTION`.

#### 37.54.42.2 Exact call-path finding

SQLite startup runs the canonical Sales & Customer registry first and the U3 Search Key migration
second. A first startup therefore creates Wave 9 V0 and then reaches V2. A reopen enters Wave 9 while
V2 already exists and currently fails before the U3 migration can reconcile it. The five U1 failures
make the same replay explicitly after `createDatabase()` has returned V2. The sixth test's `EBUSY` is
cleanup masking: the second `createDatabase()` throws before returning its SQLite handle, so the outer
directory removal observes the still-open file.

Fresh MySQL bootstrap receives a SQLite snapshot that already contains V2. The live adapter then runs
the U3 migration, and the outer database factory subsequently replays the canonical Sales registry.
An existing MySQL deployment follows the same live sequence. Therefore the Wave 9 validator must
accept exact V0/V1/V2 regardless of which side of the U3 migration it observes, while only U3 can
declare the physical columns and backfill complete.

#### 37.54.42.3 Option comparison

| Option | Mechanism | Correctness and cost | Decision |
| --- | --- | --- | --- |
| A — narrow Wave 9 validator amendment | Amend only the `credit_profile` column-identity predicate so the original nineteen columns plus the exact zero/one/two-column approved suffix pass; retain every other guard | Smallest change; keeps one canonical migration runner; supports SQLite reopen and MySQL non-transactional V1 recovery; no Search or Credit semantic change | **Selected** |
| B — external compatibility validation | Add a later layer without changing Wave 9 | Cannot make a later layer run before the existing Wave 9 throw without reordering/bypassing the frozen registry. Hiding columns or faking metadata is prohibited, and a pre-Wave-9 layer would duplicate/replace the canonical validator | Rejected |
| C — Search Key sidecar table | Move Profile keys to a new table and join it into Selector COUNT/LIST | Avoids the two Profile columns, but changes the approved U3 schema, migration, four-writer atomicity, backfill, query joins, grouping, cleanup and MySQL parity surface. It is much broader and introduces an additional owner | Rejected |

Option A is the only design that preserves the approved U3 business behavior and changes the exact
guard that rejects it. It is not a general superset rule.

#### 37.54.42.4 Wave 9 validator algorithm and function scope

`server/migrations/sales-customer-wave9-credit-foundation.js` gains one frozen constant and one private
predicate; no DDL, table contract, index, anchor or exported business API changes:

```text
WAVE9_CREDIT_PROFILE_APPROVED_SUFFIX =
  [credit_object_type_search_key, credit_object_id_search_key]

matchesWave9ColumnIdentity(table, actual, base):
  if table is not credit_profile:
    return exact(actual, base)
  reject when actual length is below base length or above base length + 2
  require exact(actual[0..18], base[0..18])
  suffix = actual after index 18
  require exact(suffix, approvedSuffix[0..suffix.length-1])
```

Both `assertSqlite()` and `assertMySql()` call this same predicate in place of only their current
complete-array comparison. The bounded length and exact suffix-prefix comparison are inseparable. The
algorithm therefore allows only V0, V1 and V2 and rejects a second-only suffix, reversed suffix,
unknown third column, unknown one-column suffix and every original-column deletion, insertion,
replacement or reorder. It is not `includes`, a set comparison, an unbounded `startsWith`, or an
arbitrary superset allowance.

All existing PK, FK, CHECK, index, MySQL physical-type/nullability probes, six-table and GLOBAL Anchor
checks remain byte-for-byte in responsibility and execution order. The other five table column arrays
still use exact equality. Wave 9 creates neither Search Key column and never validates their Search
Fold values.

#### 37.54.42.5 U3 physical-definition verification

The audit also found that the present U3 migration recognizes an existing column by name; its SQLite
path does not prove type/collation, and its MySQL path can miss an illegal type when the collation is
already binary. M12 therefore requires a bounded addition in
`server/migrations/sales-customer-wave11-a-selector-search-key.js`.

After column reconciliation and before any backfill, a private definition verifier checks:

- SQLite: declared type `TEXT`, nullable, and the exact declared `COLLATE BINARY` clause for each of the
  four Search Key columns, using `PRAGMA table_info` plus the canonical `sqlite_master.sql` declaration;
- MySQL: `DATA_TYPE=longtext`, `IS_NULLABLE=YES`, and `COLLATION_NAME=utf8mb4_0900_bin` from
  `information_schema.COLUMNS`;
- no Search Key index is introduced.

The already-approved MySQL collation reconciliation remains allowed: an otherwise legal LONGTEXT
nullable column with a wrong collation is changed to the approved binary collation and then verified.
An existing wrong type or nullability fails before backfill rather than being accepted as an identity
match. SQLite illegal physical definitions fail because rebuilding a populated table is outside this
bounded amendment. Missing columns are still added with the canonical definition.

The U3 migration then performs the versioned fold backfill and missing/stale verification. Only a final
V2 definition plus a clean verification permits the adapter/database factory to return. A Wave 9 V1
PASS is explicitly not service readiness.

#### 37.54.42.6 Interrupted migration, transaction and error behavior

SQLite V0 proceeds through Wave 9, U3 adds both columns and verifies V2. SQLite V1 passes Wave 9 on a
retry, U3 adds the second column and reconciles all keys. SQLite V2 passes Wave 9 and U3 re-verifies it.

MySQL DDL may commit per statement. A failure after adding the first column can therefore leave V1;
a failure after adding both columns can leave V2 with incomplete keys. The retry accepts the exact
base identity, resumes missing DDL/backfill and blocks adapter return until U3 physical and value
verification succeeds. `createMySqlDatabase()` closes the adapter and rethrows on failure. No schema
conflict, definition error or backfill error is caught and ignored.

No transaction is claimed across MySQL DDL. Retryability and the explicit V0/V1/V2 state machine are
the rollback strategy. Before database deployment the code revision can be reverted. After V1/V2 is
durable, rollback is forward completion or a separately authorized destructive database rollback; a
code-only rollback to the old Wave 9 SHA is not compatible with that database.

#### 37.54.42.7 Migration replay matrix

| Case | Fixture and assertion | Expected owner/result |
| --- | --- | --- |
| M01 | Original nineteen-column Profile | Wave 9 base PASS; U3 may advance it |
| M02 | Original nineteen plus both approved columns | Wave 9 base PASS; U3 definition/backfill verification still required |
| M03 | Original nineteen plus only the first approved column | Wave 9 base PASS; U3 adds the second column, backfills and reaches V2 |
| M04 | Second approved column exists without the first | Wave 9 FAIL before U3 |
| M05 | Approved columns exist in reverse order | Wave 9 FAIL |
| M06 | Unknown suffix column or a third column | Wave 9 FAIL |
| M07 | Original column missing, replaced, inserted or reordered | Wave 9 FAIL |
| M08 | Original PK/FK/CHECK/index drift | Existing Wave 9 guards FAIL unchanged |
| M09 | SQLite first start, second start and repeated canonical replay | PASS and one GLOBAL Anchor |
| M10 | Fresh MySQL bootstrap and existing live replay at V0/V1/V2 | Wave 9 + U3 PASS; adapter returned only after V2 verification |
| M11 | Backfill interruption with V1 or V2 durable | Retry converges; missing/stale count becomes zero |
| M12 | Existing Search Key wrong type/nullability/collation or unverifiable definition | U3 repairs only the approved MySQL collation case; otherwise FAIL/BLOCKED |

M01–M09, M11 and the illegal-shape portions of M12 are added to the existing FULL-only U3 Search
Semantics suite with disposable SQLite databases. They drive the real Wave 9 and U3 migration entry
points; source scanning is not acceptance. The unchanged original Wave 9 suite is rerun and must pass.

M10 and the MySQL portions of M03/M11/M12 are added to the existing W11-A Selector MySQL integration
suite and run only through the separately authorized protected disposable gate. The historical E3
directory and artifacts remain immutable; a new run uses a new evidence directory and ends with the
existing five-category cleanup confirmation.

#### 37.54.42.8 Exact future Implementation whitelist

The future bounded Implementation is exactly these seven paths:

1. `server/migrations/sales-customer-wave9-credit-foundation.js` — the narrow shared V0/V1/V2 column
   identity predicate only;
2. `server/migrations/sales-customer-wave11-a-selector-search-key.js` — exact physical-definition
   verification required by M12;
3. `server/sales-customer-wave11-a-search-semantics.test.js` — SQLite M01–M09/M11/M12 and the six
   failure-path regression;
4. `server/mysql-sales-customer-wave11-a-credit-query-options.integration.js` — prepared real MySQL
   M10 and V1/backfill/definition evidence, executed only under separate authorization;
5. `document.md` — append-only Implementation result/status;
6. `solution.md` — append-only Implementation evidence and new forward SHA manifest;
7. `log/<actual-date>.md` — append-only real-date implementation log.

No new file is required. `server/sales-customer-wave9-credit-foundation.test.js` remains unchanged and
is rerun as the original regression. `scripts/testing/test-suites.js` remains unchanged because the U3
Search suite is already FULL-only. `server/migrations/sales-customer-domain.js`, `server/db.js`,
`server/database/mysql-adapter.js`, all Wave 9 business writers, Credit Scope/Check/Query/Special
Approval owners, protected launchers, shared runner support and the U2 E3 suite remain outside the
whitelist. A newly discovered need for any eighth path requires a new Requirement/Design decision.

#### 37.54.42.9 Verification sequence and acceptance boundary

Future Implementation verification is ordered:

1. focused M01–M12 local portions, original Wave 9 migration suite, U1 primitives, U3 Search and U3-A;
2. exact re-execution of the six Stage B failures and then the complete prior Stage B selection;
3. FAST, FULL, build and `git diff --check`;
4. SHA manifest: old Wave 9 SHA retained as historical, new Wave 9 SHA recorded as the exception
   revision, frozen Credit Core SHAs re-verified;
5. under separate authorization only, the protected real MySQL Selector gate with fresh/upgrade/V1
   recovery, collation, parity, zero-write and cleanup evidence;
6. browser preliminary verification only if separately required by the U3 gate sequence.

Passing Wave 9 alone never authorizes service; local Implementation PASS does not replace real MySQL
revalidation; neither replaces user Acceptance/Freeze. No historical evidence is overwritten.

#### 37.54.42.10 Remaining risks and rollback

1. SQLite exposes declared collation only through the canonical table DDL text, so the implementation
   must use a bounded identifier/declaration check and negative tests rather than a loose substring.
2. MySQL DDL interruption can persist V1 or V2 independently of the process result; the protected gate
   must actually exercise V1 recovery and verify the final definition and data.
3. The Wave 9 source SHA necessarily changes. Any manifest that still calls the old SHA current after
   Implementation is invalid; the old identity remains historical evidence only.
4. A code-only rollback after schema deployment is unsafe. Operational rollback remains a separately
   authorized database operation; forward completion is the default recovery.

All Requirement/Design conflicts are closed without changing business identity, Credit primitives,
other Wave 9 table schemas or the frozen migration registry.

**Design status: `W11_A_U3_WAVE9_ADDITIVE_COMPAT_DESIGN_READY`.**

#### 37.54.43 Wave 9 additive compatibility implementation evidence (2026-10-30)

The approved narrow validator amendment was implemented without changing Wave 9 DDL or Credit business
semantics. `matchesWave9ColumnIdentity()` keeps exact equality for every table except `credit_profile`;
there it requires the original nineteen-column prefix plus exactly the zero-, one- or two-column prefix
of the approved ordered suffix. This closes V0/V1/V2 replay while continuing to reject second-only,
reverse, unknown, overlong and original-column drift.

The U3 Search Key migration now verifies physical definitions before backfill. SQLite requires nullable
`TEXT` and a bounded canonical `COLLATE BINARY` declaration. MySQL requires nullable `LONGTEXT` and the
approved binary collation; only a collation mismatch on that otherwise legal shape is reconciled. Type,
nullability or unverifiable-definition drift fails closed. Backfill, missing/stale verification and
adapter-return boundaries remain unchanged.

Implementation SHA-256 manifest:

- historical pre-exception Wave 9 migration:
  `87d4a6628b68645cc7ce743aaa7bf5e4244b6c9c0a3a91df1f33796ec1de4f32`;
- current compatibility revision:
  `5b7a6df8bcdb2f57373c00fc64a1955522dbf1f1fa8cb3c47a653993175d869b`;
- U3 Search Key migration:
  `cf687aeb3e629ed2ea81e21d0761c58bdb547edf7fe15d9718ddf67a7e3d2965`;
- U3 Search Semantics suite:
  `b69bbd24f42d5e4e3bb298885c9c846c3e9a860b248518b60bfd8257f1a511ee`;
- MySQL Selector integration suite:
  `79038823c1efc5ec9b4af187eaf3512482e5b1b069414b4b7dfca74300f01a23`;
- frozen `server/modules/credit-check.js` remains
  `6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1`;
- frozen `server/modules/credit-query.js` remains
  `24889d82a602cd2cd1187dd11807bbfa163f584b7fb6c13f55f62cdb0d04133b`.

Verification evidence: local M01–M09/M11/M12 11/11 PASS; exact six prior failures 6/6 PASS; complete
Stage B 103/103 PASS; focused Wave 9 plus U3 Search/UI 77/77 PASS. FAST stopped the sequence at 499/500
because the run emitted `WebSocket server error: Port 24678 is already in use`. A post-run read-only
inspection found no remaining port owner, but the failed gate remains authoritative. Consequently FULL,
build, final `git diff --check`, browser preliminary verification and the protected real MySQL gate were
not run. M10 therefore remains `NOT_RUN_MYSQL`.

No eighth path was used. The index remained empty; no commit, push, tag, merge, release, deploy,
Acceptance or Freeze occurred.

**Implementation status: `W11_A_U3_SEARCH_SEMANTICS_IMPLEMENTATION_BLOCKED`.**

#### 37.54.44 FAST port 24678 read-only diagnosis (2026-10-30)

The prior FAST tool record was recovered from the local Codex session. It proves exit code 1 with 500
tests, 37 suites, 499 pass, 1 fail, 0 cancelled, 0 skipped and 0 todo, and contains the diagnostic
`WebSocket server error: Port 24678 is already in use`. The retained output was truncated in its middle,
so its exact `not ok` test file/name is not recoverable. Vite's dedicated `EADDRINUSE` logger emits only
that one line, so there is no port-error stack in the original output. The failure is not assigned to an
invented test identity.

The current read-only Windows check found no connection/listener on 24678 and no IPv4/IPv6 excluded-port
range containing it. Process command-line inspection through CIM was denied by the current security
context; because there is no listener, there is no current owning PID to terminate or attribute.

The repository call chain nevertheless proves an internal competition condition. `pnpm test:fast` runs
`scripts/testing/run-tests.js fast`, which starts one `node --test` child over 23 FAST files with no
`NODE_TEST_FLAGS` override. Independent test files may execute in concurrent child processes.
`server/mobile-shell.test.js:39-44` and `server/teacher-acceptance-matrix.test.js:775,1045` each create a
middleware-mode Vite server without `hmr: false`. Vite 7's `createWebSocketServer()` selects
`hmr.port || 24678`, creates a separate WebSocket HTTP server in this middleware configuration and calls
`listen(port, host)`. Thus at least two independent FAST file processes can bind the same fixed port.
The inspected SPA, approval and launcher suites disable HMR; the launcher setting is present in its
multi-line configuration.

This is `TEST-INTERNAL`, not `TRANSIENT-CLEARED`. The authorized one-time FAST retry condition is not
met, so FAST was not rerun and FULL, build, final `git diff --check`, frozen-gate continuation and Edge
browser preliminary verification were not executed. The minimal future repair is to disable HMR on the
middleware-only SSR test servers that do not test HMR, at minimum the `mobile-shell` call and both
`teacher-acceptance-matrix` calls. That change was not authorized and was not made.

The Wave 9 exception identities remain historical
`87d4a6628b68645cc7ce743aaa7bf5e4244b6c9c0a3a91df1f33796ec1de4f32` and forward
`5b7a6df8bcdb2f57373c00fc64a1955522dbf1f1fa8cb3c47a653993175d869b`. Protected hashes remain:

- `credit-check.js`: `6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1`;
- `credit-query.js`: `24889d82a602cd2cd1187dd11807bbfa163f584b7fb6c13f55f62cdb0d04133b`;
- `credit-scope.js`: `f31033bd75520643c50202c18f640440aacbcde892595efad7d4e0ba2041a3bc`;
- `credit-special-approval.js`: `04594b3dc01240c5b3addddf50897fbeab54802daf9fbd7d49c5e36cccf289c4`;
- frozen U2 gate: `c3b9b7c6025774d9421d85246fdfb442e115b3c46aca43d6382ec04e67d867e2`;
- frozen U2 E3 suite: `51c07397e2deee9d8c84676d09af4504dc9bfb77982dc372472d9b00bd295892`;
- protected local launcher: `209527dce8ef7cd4a05a6951e041892256c3b06736cbdde12be86bef0e00bd65`;
- shared runner support: `f48b76f8a223af59ac2b703c495f70303fea0adb8318eb1c5f1a1855a6bf2b03`;
- Selector launcher: `e1cbf47190b991b4174e173929f73e70bc51ddaab7600ed3c434735c591fa779`.

The controlled evidence is outside the repository at
`C:\Users\Administrator\AppData\Local\Temp\modern-erp-w11a-u3-fast-port-diagnosis-20261030\diagnosis.md`.
No code, test, port configuration or `document.md` change was made; no process was stopped; no MySQL,
Git write, Acceptance/Freeze, release or deployment occurred.

**Diagnosis status: `W11_A_U3_FAST_PORT_TEST_BLOCKED`.**

#### 37.54.45 Bounded Vite HMR correction result (2026-10-30)

The installed version is Vite `7.3.6`, not merely the `package.json` semver range. Its
`createWebSocketServer()` recognizes `server.ws === false` and immediately returns a no-listener
transport. By contrast, `hmr: false` alone is insufficient in this version: the normalized hot channel's
`listen()` still delegates to the underlying WebSocket channel, whose default port is 24678.

Within the exact correction whitelist, the `server/mobile-shell.test.js` instance and both
`server/teacher-acceptance-matrix.test.js` instances now use
`{ middlewareMode: true, hmr: false, ws: false }`. No assertion, hook, production code, global Vite
configuration, dependency, runner or port was changed. SHA-256 changed as follows:

- `mobile-shell.test.js`: `dfca1d115b12edbd9b15cd31cb721b2ac2cd8f988a842bf5e715ea3f70fcaaf6`
  -> `535127e266b3244fd88e5a3d70cfbaa578d2b176a9c2809ae5bd7d9f39b38644`;
- `teacher-acceptance-matrix.test.js`:
  `6a4313abff2fac3450cc598c26da67a7ef40043f13df3d31482f1c84f75bbbb4`
  -> `aa80a456001620c0ddc9ab86c583b59b28999efe2dc380cd29b6b4ea8ff95489`.

Both files passed `node --check`. Their required parallel run passed with exit 0: 86 tests, 20 suites,
86 pass, 0 fail/cancelled/skipped/todo; SSR module loading, React rendering and Vite closure completed,
with zero 24678 connections before and after and no port diagnostic in the focused TAP.

The authorized one-time FAST run then exited 1: 500 tests, 37 suites, 499 pass, 1 fail, 0
cancelled/skipped/todo. Its complete output still contains two `Port 24678 is already in use`
diagnostics. Static follow-up identifies three other FAST middleware Vite calls with `hmr: false` but no
`ws: false`: `spa-navigation-hotfix.test.js:27`, `mobile-approval-center.test.js:126` and
`mobile-application-launcher.test.js:30`. In Vite 7.3.6 they remain port binders, but all three paths are
outside the exact correction whitelist.

FAST also exposed one exact assertion failure outside the whitelist:
`mobile-approval-center.test.js:195`, `inventory check approve uses the transactional stock adjustment`,
expected 22 and actual 20; its enclosing `M3R actions reuse existing state machines` suite failed. No
second FAST run or out-of-scope repair was attempted. Because FAST failed and the port collision remains,
FULL, build, final `git diff --check`, frozen-gate continuation and Edge preliminary verification were not
run.

Wave 9 remains historical
`87d4a6628b68645cc7ce743aaa7bf5e4244b6c9c0a3a91df1f33796ec1de4f32` and forward
`5b7a6df8bcdb2f57373c00fc64a1955522dbf1f1fa8cb3c47a653993175d869b`. Frozen `credit-check.js`,
`credit-query.js`, `credit-scope.js` and `credit-special-approval.js` remain respectively
`6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1`,
`24889d82a602cd2cd1187dd11807bbfa163f584b7fb6c13f55f62cdb0d04133b`,
`f31033bd75520643c50202c18f640440aacbcde892595efad7d4e0ba2041a3bc` and
`04594b3dc01240c5b3addddf50897fbeab54802daf9fbd7d49c5e36cccf289c4`.

The index remains empty, HEAD/version remain unchanged and the worktree moved from 39 to the expected 41
paths. Complete raw focused and FAST outputs are preserved outside the repository under
`C:\Users\Administrator\AppData\Local\Temp\modern-erp-w11a-u3-vite-hmr-correction-20261030`.

**Correction status: `W11_A_U3_FAST_PORT_TEST_BLOCKED`.**

### 37.54.43 W11-A U3 FAST Dual-Blocker Closure — Design Amendment (2026-10-30)

#### 1. Authorization, inputs and stage boundary

This section is the bounded Design amendment authorized together with the Requirement amendment
`document.md` "W11-A U3 FAST Dual-Blocker Closure — Bounded Requirement Amendment (2026-10-30)" under
AGENTS.md §4.0. The Requirement stage modified only `document.md`; this Design stage modifies only
`solution.md` and the real-date append-only log.

Baseline: branch `review/w11a-u3-fast-blocked-20261030`, HEAD
`60f3fbd169d7b43bbae3824b10b538edef4aeec1`, version `1.6.2`, empty index, clean working tree. No
production code, test, fixture, runner, schema or migration was modified by this stage. No SQLite or
MySQL database was written outside the disposable diagnostic fixtures described in §2.6. FAST, FULL, build,
browser and the protected MySQL gate were not run. No Git write, no Acceptance/Freeze, no release or
deploy occurred.

Inputs: `R-U3-INV-01`..`R-U3-INV-08` and `R-U3-VITE-01`..`R-U3-VITE-05`; the audited root cause in the
Requirement §2; the frozen inventory domain primitives; the installed Vite 7.3.6 source; the complete
repository-wide Vite call-site inventory; and the disposable-SQLite diagnostic evidence recorded in
§2.7.

#### 2. The inventory correction design

##### 2.1 Module and function responsibility

The correction lives entirely in `server/db.js`, in the existing `seedDemoData(db)` function. No new
module, no new export surface for the write path, no new migration module and no new production
endpoint is introduced.

`server/db.js` gains exactly one import: `computePositionKey` from the existing canonical primitive
`server/lib/inventory-position.js`. The frozen primitive, `server/lib/stock.js`,
`server/migrations/inventory-position-schema.js` and the approval handler in `server/app.js` are not
modified. The canonical primitive remains the only position-key algorithm in the repository.

`server/db.js` also gains one exported read-only function,
`detectAbnormalInventoryPositions(db)`, described in §2.5.

##### 2.2 The exact seed write

The demo inventory block at `server/db.js:1843`-`1854` currently writes
`id, warehouse_id, product_id, quantity, updated_at` and leaves every dimension and the position key
unset. The corrected block writes the canonical default dimension tuple explicitly and writes the
`position_key` that the canonical primitive computes from that same tuple:

```sql
INSERT OR IGNORE INTO inventory(
  id, warehouse_id, product_id, quantity, updated_at,
  position_key, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, active
) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)
```

with the bound values, per demo row:

| Column | Value | Reason |
| --- | --- | --- |
| `position_key` | `computePositionKey({ productId, warehouseId })` | the canonical default identity of the row |
| `bin_id` | `NULL` | the canonical default dimension |
| `owner_type` | `'ENTERPRISE'` | the canonical default owner |
| `owner_id` | `NULL` | the canonical owner is the enterprise itself |
| `stock_status` | `'AVAILABLE'` | the canonical default status |
| `lot_id` | `NULL` | the canonical default dimension |
| `serial_id` | `NULL` | the canonical default dimension |
| `active` | `1` | the seeded row is an active stock fact |

The dimension columns are written explicitly, and not left to the column defaults, for one reason: the
row's stored dimensions must be the literal tuple that was hashed. `computePositionKey()` applies its
own defaults internally, so a call that omits the dimensions still hashes the default tuple — but if a
future migration ever changed a column default, a seed that relied on the default would silently write
dimensions that no longer match the key it stored. Writing them explicitly makes the invariant
structural instead of incidental.

`computePositionKey()` is called with only `productId` and `warehouseId`; the remaining six dimensions
are the primitive's own documented defaults, which are exactly the values written into the row. The key
therefore equals the canonical identity of the row's own dimensions by construction, which is the
property `R-U3-INV-01` and `R-U3-INV-02` require and the property the `uq_inventory_position_key`
unique index enforces.

`INSERT OR IGNORE` is retained. It is what makes the seed idempotent under `R-U3-INV-04`: the primary
key already matches an existing seeded row, and the unique position-key index already matches an
existing canonical row under any other physical identity. In both cases the insert is skipped, no row
is added and no quantity is written. The seed therefore never overwrites a real business quantity.

The seed is explicitly **not** performed through `adjustInventory`, `adjustInventoryAtPosition` or
`applyInventoryMutation`. Those writers accumulate a quantity and would break idempotency, and they
write an `inventory_mutation_log` row and a valuation movement, which a demo initialization must not
produce.

##### 2.3 Data flow per scenario

**Fresh initialization.** `createSqliteDatabase` runs the migration block; `migrateInventoryPositionSchema`
at `server/db.js:516` creates the position columns, backfills the rows that exist at that moment (none)
and creates `uq_inventory_position_key`. The Demo Seed at `server/db.js:551` then inserts the six demo
inventory rows, each carrying its canonical `position_key` and the canonical dimension tuple. The
result is six active rows, zero NULL keys, zero duplicate logical positions. The approval writer
`setInventoryQuantity` now resolves the canonical default position, finds the seeded row by
`position_key`, and updates it in place. The `(warehouse_id, product_id)` read observes `22`. The
enclosing assertion at `server/mobile-approval-center.test.js:195` passes with its original
expectation.

**Reopen of an existing database.** The migration block runs first and its backfill assigns the
canonical key to every pre-existing row whose key is NULL, exactly as it already does today. The Demo
Seed then runs and every seeded row is skipped by `INSERT OR IGNORE`, because the primary key matches
and, after the backfill, the position key matches as well. A quantity that an approved adjustment
changed is preserved. The reopen converges to the same physical state as the fresh path.

**Repeated initialization in one process.** Identical to the reopen: the rows already exist, the
inserts are skipped, the quantities and the keys are untouched.

**Approval.** Unchanged. `approveInventoryCheck` still runs inside its transaction, still re-reads the
authoritative inventory row, still rejects a drifted `system_quantity`, still writes the tracked
movement, the inventory transaction, the valuation movement, the system voucher and the audit record,
and still calls `setInventoryQuantity` for the absolute quantity. The correction changes only which
row that call finds: it now finds the seeded row instead of missing it. No state machine, no
permission, no business rule and no accounting fact changes.

**Abnormal pre-existing inventory.** A database that already holds the defect keeps its abnormal rows.
The migration backfill assigns the canonical key to a NULL-keyed row whenever the canonical key is
free; when the canonical key is already held by another row, the migration's own documented fallback
writes a synthetic `<canonical key>:fallback<rowid>` value. Neither path is changed by this
correction, and neither path is a merge, a delete or a quantity change. The abnormal state is detected
and reported by §2.5 and is never silently repaired by the correction.

##### 2.4 Why no new migration is required

A new migration module is **not** introduced, and this is a deliberate decision, not an omission.

The pre-existing repair path already exists and already behaves correctly for the case that matters: the
migration backfill computes the canonical key with the same canonical primitive, from the row's own
dimensions, and applies it to every NULL-keyed row on every open. After the seed correction, a database
that was initialized by the defective build converges to the canonical state on its next open, with no
new migration, no new column and no new constraint. The only residual case is a database that already
holds a genuine duplicate, and that case is explicitly out of scope for automatic repair under
`R-U3-INV-07`; it is detected and reported instead.

Adding a migration would therefore either duplicate an existing writer of `position_key` — a violation of
the single-canonical-primitive rule — or silently merge and delete abnormal rows, which
`R-U3-INV-07` prohibits.

##### 2.5 The read-only abnormal inventory detection

`server/db.js` exports:

```text
detectAbnormalInventoryPositions(db) -> {
  scanned:              <number of active inventory rows inspected>,
  nullPositionKey:      <array of row descriptors>,
  nonCanonicalKey:      <array of { id, stored, expected } row descriptors>,
  duplicateCanonical:   <array of { positionKey, rowIds }>,
  abnormalRows:         <total number of abnormal rows>,
  healthy:              <boolean>
}
```

Behaviour:

- it is **read-only**. It issues `SELECT` statements only. It never issues an `UPDATE`, a `DELETE` or an
  `INSERT`. It therefore satisfies `R-U3-INV-06` and `R-U3-INV-07` mechanically, not by convention;
- it classifies exactly the three observable classes of `R-U3-INV-07`: a NULL or empty `position_key`; a
  stored key that differs from the canonical identity computed by the canonical primitive for the row's
  own dimensions — which is what detects the synthetic `:fallback<rowid>` identity; and two or more
  active rows whose canonical identities coincide;
- the canonical identity of a row is computed with the **same** `computePositionKey()` primitive, from
  the row's own `product_id`, `warehouse_id`, `bin_id`, `owner_type`, `owner_id`, `stock_status`,
  `lot_id` and `serial_id`. It is never a re-implementation and never a second algorithm;
- the samples are bounded so that a heavily damaged database cannot produce an unbounded report;
- it is **not** reachable from any HTTP read route and it is not invoked by a read path.

Invocation: the detection runs inside `createSqliteDatabase` immediately after the Demo Seed, so it
runs on every open of a database in the demo path, which is the path that creates the defect, and it
covers a database that was first opened by the defective build. When the report is not healthy, a
structured diagnostic is emitted. The function remains exported so that an operator can run the scan
against any database on demand.

Cost disclosure: the scan is a full read of the active inventory rows and therefore runs on every open
in the demo path only. `shouldSeedDemoData()` is false in production, so no production startup pays this
cost, and a production database is not scanned at startup. The intended path for a production database
is an operator-triggered call of the exported function. This trade-off is stated here rather than
hidden, because the alternative — scanning every production startup — would add an unbounded startup
cost to a hot path in exchange for a diagnostic that the domain's own migration already reports in its
fallback path.

##### 2.6 Schema, transaction, RBAC, state transition, error behaviour and audit

- **Schema.** No new column, no new table, no new constraint and no new index. The correction uses the
  existing `inventory.position_key` column and the existing `uq_inventory_position_key` unique index.
- **Migration.** No new migration module and no migration registration change. See §2.4.
- **Transaction.** The seed write is not transactional and does not need to be: it is a single
  `INSERT OR IGNORE` statement per row, it is idempotent, and it is re-runnable. The approval path's
  transaction is untouched.
- **RBAC / SOD.** The seed is an initialization writer that runs before any actor exists and it is
  gated by `shouldSeedDemoData()`, which is false unless the environment explicitly opts in or is not
  production. No permission, no role and no separation-of-duty rule changes. The exported detection
  function is not an HTTP surface and therefore carries no permission contract; it is a diagnostic
  entry point in the same sense as `createDatabase` itself.
- **State transition.** None. The correction does not add, remove or alter any state machine. The
  inventory-check state machine (`DRAFT` → `SUBMITTED` → `APPROVED`) and its guards are untouched.
- **Error behaviour.** The seed insert keeps `INSERT OR IGNORE`, so a canonical-key collision is a skip
  and not a failure. A genuine SQL error still propagates and aborts the initialization, consistent with
  the existing behaviour of the other seed writers. The detection never throws for an abnormal
  database: an abnormal database is reported, not failed.
- **Audit.** The seed writes no audit row, exactly as it does today, because a demo initialization is
  not a business action. The approval path's audit row is unchanged. The detection writes no audit row,
  because it writes nothing at all.

##### 2.7 The compatibility and the frozen contract

- The inventory business identity is unchanged: the canonical position tuple, the owner validation, the
  stock-status validation, the bin validation and the valuation semantics are untouched
  (`R-U3-INV-08`).
- The frozen Domain 5 contract in `server/lib/inventory-position.js`,
  `server/lib/stock.js` and `server/migrations/inventory-position-schema.js` is untouched. Their SHA-256
  identities are recorded in §7 and are re-verified by acceptance item `P`.
- The U3 Selector Search Key contract is untouched: the demo seed keeps its post-migration position, so
  the demo customers keep writing their derived search keys in the insert, and the demo seed is not
  moved back to its pre-U3 position.
- The pre-existing repair path for a database created by the defective build is the existing migration
  backfill and is unchanged.

##### 2.8 MySQL parity

The demo seed correction reaches MySQL without a MySQL-specific change, because the MySQL bootstrap
derives its data from the SQLite snapshot. `createMySqlDatabase` builds that snapshot through
`createSqliteSnapshot: (filename) => createSqliteDatabase(filename)`, so the snapshot's inventory rows
carry the canonical key, and `bootstrapMySql` copies every snapshot column — including `position_key` —
with `INSERT IGNORE INTO <table> (<all snapshot columns>)`.

The physical MySQL contract was read with a recording mock adapter driving `bootstrapMySql`, without a
MySQL connection and without a repository change. The emitted MySQL `inventory` DDL is:

```text
`position_key` VARCHAR(128),        -- nullable
`bin_id`      VARCHAR(128),
`owner_type`  VARCHAR(128) NOT NULL DEFAULT 'ENTERPRISE',
`owner_id`    VARCHAR(128),
`stock_status` VARCHAR(128) NOT NULL DEFAULT 'AVAILABLE',
`lot_id`      VARCHAR(128),
`serial_id`   VARCHAR(128),
`active`      BIGINT NOT NULL DEFAULT 1,
```

with `UNIQUE (position_key)`. The canonical key is a 64-character lowercase hex digest, so it fits the
`VARCHAR(128)` column without truncation. Because the column is nullable and a MySQL unique index admits
several NULL values, the defective build did not break the MySQL bootstrap — it silently loaded the same
non-canonical demo rows there. The correction removes that divergence as well, because both engines
receive the same snapshot rows.

The `server/migrations/inventory-position-schema.js` header comment states that MySQL stores
`position_key` as `CHAR(64) NOT NULL UNIQUE`. The physical MySQL schema is `VARCHAR(128) NULL`. That
divergence is **pre-existing**, is not introduced by U3, is not introduced by this correction and is not
in scope here. It is disclosed because the correction writes a canonical key into that column and a
reader of the module header would otherwise form a wrong expectation about its physical type.

##### 2.9 The measured evidence behind this design

All evidence was produced on disposable SQLite databases outside the repository, through the production
`createDatabase` entry point and the production `setInventoryQuantity` writer. No repository file was
modified and no MySQL was contacted.

| Observation | Measured result |
| --- | --- |
| Fresh seeded inventory rows | 6 active rows, all with `position_key = NULL` |
| Canonical key vs stored key | differs in all 6 rows |
| Approval writer behaviour | inserts a second active row for the same logical position |
| Logical position after approval | 2 active rows for `(warehouse-001, product-001)` |
| The failing assertion | `before = 20`, `after = 20`, expected `22` |
| Focused test reproduction | 77 pass, 1 fail, `expected: 22, actual: 20` |
| Fresh, then reopen, no approval | backfill assigns the 6 correct canonical keys |
| Fresh, then approval, then reopen | the stale seeded row receives `<canonical>:fallback<rowid>` |
| Simulated fix, fresh | 6 rows, 0 NULL, 0 non-canonical, 0 duplicates |
| Simulated fix, approval | `before = 20`, `after = 22`, exactly 1 active row for the logical position |
| Simulated fix, repeated seed | quantity `22` preserved, 6 rows |
| Simulated fix, reopen | quantity `22` preserved, 6 rows, 0 NULL, 0 non-canonical, 0 duplicates |

The simulated fix reproduces the corrected seed block outside the repository, over the same production
`createDatabase` entry point, and it demonstrates every target property before any production change is
made.

#### 3. The Vite regression correction design

##### 3.1 The mechanism, read from the installed source

The installed Vite is `7.3.6`. The middleware WebSocket factory is
`node_modules/vite/dist/node/chunks/config.js`:

- `config.js:25456` — in middleware mode the resolved HTTP server is `null`, and `config.js:25457`
  passes that `null` into `createWebSocketServer` as its `server` argument;
- `config.js:20430` — `if (config.server.ws === false) return { … }` returns a no-op WebSocket server
  whose `listen` is a no-op. This is the **only** path that creates no listener;
- `config.js:20448`-`20451` — with `hmr: false`, `hmr` is not an object, so `hmrPort` is falsy and
  `wsServer` evaluates to `(!hmrPort || …) && server`, which is `true && null`, i.e. falsy;
- `config.js:20486`-`20498` — because `wsServer` is falsy, the factory takes the fallback branch and
  creates a **real** HTTP server for the WebSocket transport;
- `config.js:20455` — `const port = hmrPort || 24678`, the fixed default HMR port;
- `config.js:20584` — `wsHttpServer?.listen(port, host)`, which binds 24678;
- `config.js:20507`-`20508` — the `EADDRINUSE` handler that prints
  `WebSocket server error: Port 24678 is already in use`.

The conclusion is exact and mechanical: **`hmr: false` alone does not prevent the port bind.** The
listener is suppressed only by `server.ws: false`. This confirms the earlier stage's empirical finding
and it is the reason the correction is `ws: false` and not something else. Because the port is a fixed
constant rather than a configured one, every affected instance competes for the same port, and the
`node --test` runner executes test files as independent concurrent processes.

##### 3.2 The complete call-site audit

The audit covers every Vite server creation in the repository test graph. The enumeration was produced
from the actual `createViteServer` call sites, and the suite membership was read from
`scripts/testing/test-suites.js`.

| # | File | Line | Suite | Before | After | Action |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `server/spa-navigation-hotfix.test.js` | 27 | FAST + FULL | `{ middlewareMode: true, hmr: false }` | `{ middlewareMode: true, hmr: false, ws: false }` | correct |
| 2 | `server/mobile-approval-center.test.js` | 126 | FAST + FULL | `{ middlewareMode: true, hmr: false }` | `{ middlewareMode: true, hmr: false, ws: false }` | correct |
| 3 | `server/mobile-application-launcher.test.js` | 30 | FAST + FULL | `{ middlewareMode: true, hmr: false }` | `{ middlewareMode: true, hmr: false, ws: false }` | correct |
| 4 | `server/cost-stabilization.test.js` | 74 | FULL only | `{ middlewareMode: true }` | `{ middlewareMode: true, hmr: false, ws: false }` | correct |
| 5 | `server/m9-final-polish.test.js` | 24 | FULL only | `{ middlewareMode: true, hmr: false }` | `{ middlewareMode: true, hmr: false, ws: false }` | correct |
| 6 | `server/v14-e7-two-level-business-overview.test.js` | 22 | FULL only | `{ middlewareMode: true, hmr: false }` | `{ middlewareMode: true, hmr: false, ws: false }` | correct |
| 7 | `server/v16-p1-mobile-enterprise-foundation.test.js` | 44 | FULL only | `{ middlewareMode: true, hmr: false }` | `{ middlewareMode: true, hmr: false, ws: false }` | correct |
| 8 | `server/v16-p11-mobile-enterprise-visual-refinement.test.js` | 23 | FULL only | `{ middlewareMode: true, hmr: false }` | `{ middlewareMode: true, hmr: false, ws: false }` | correct |
| 9 | `server/mobile-shell.test.js` | 41 | FAST + FULL | `{ middlewareMode: true, hmr: false, ws: false }` | unchanged | already correct |
| 10 | `server/teacher-acceptance-matrix.test.js` | 775 | FAST + FULL | `{ middlewareMode: true, hmr: false, ws: false }` | unchanged | already correct |
| 11 | `server/teacher-acceptance-matrix.test.js` | 1045 | FAST + FULL | `{ middlewareMode: true, hmr: false, ws: false }` | unchanged | already correct |

The audit result, stated plainly:

- the repository contains **11** middleware-mode Vite instances in **10** test files;
- **5** of them live in FAST-registered files; of those, **2** are already correct and **3** require the
  correction — exactly the three files named in the review instruction;
- **6** of them live in FULL-only files and **all 6 still bind port 24678**. They are not in FAST, so
  they did not contribute to the recorded FAST failure, but the FULL gate executes the same independent
  test-file processes against the same fixed port, so they reproduce the identical collision in the FULL
  gate. Leaving them uncorrected would trade a FAST failure for a FULL failure.

This is the reason the future whitelist in §4 is wider than the three files named in the review
instruction, and the reason is proven rather than precautionary: acceptance item `M` is the FULL gate,
and FULL contains all five of these files.

##### 3.3 The exact target configuration

Every instance that requires the correction receives `server: { middlewareMode: true, hmr: false,
ws: false }`. The existing `appType` and `logLevel` options are preserved verbatim. Instances 9 to 11
are already in the target state and are not touched.

##### 3.4 What is explicitly not done

No Vite upgrade and no dependency change; no change to `vite.config.js`; no port assignment, no port
range and no `hmr.port`; no change to the test concurrency, the runner flags or the suite manifest
beyond the single registration entry required in §4; no change to any assertion, no skipped and no
downgraded test; no change to any production source file; no process termination and no port kill.

#### 4. The exact future implementation whitelist

The review instruction limits the future implementation preferentially to `server/db.js`, the three
Vite test files, the approved documents and the real-date log, and requires that any addition be proven
necessary in this Design. The additions are proven below.

| # | Path | Action | Necessity proof |
| --- | --- | --- | --- |
| 1 | `server/db.js` | modify | the only writer of the demo inventory rows; carries `R-U3-INV-01`..`04` and `07` |
| 2 | `server/spa-navigation-hotfix.test.js` | modify | audit row 1; FAST port binder |
| 3 | `server/mobile-approval-center.test.js` | modify | audit row 2; FAST port binder; also owns the `C` acceptance assertion |
| 4 | `server/mobile-application-launcher.test.js` | modify | audit row 3; FAST port binder |
| 5 | `server/cost-stabilization.test.js` | modify | audit row 4; FULL port binder; the only instance with neither `hmr: false` nor `ws: false` |
| 6 | `server/m9-final-polish.test.js` | modify | audit row 5; FULL port binder |
| 7 | `server/v14-e7-two-level-business-overview.test.js` | modify | audit row 6; FULL port binder |
| 8 | `server/v16-p1-mobile-enterprise-foundation.test.js` | modify | audit row 7; FULL port binder |
| 9 | `server/v16-p11-mobile-enterprise-visual-refinement.test.js` | modify | audit row 8; FULL port binder |
| 10 | `server/inventory-demo-seed-position-identity.test.js` | **new** | the `A`–`H` inventory acceptance matrix has no existing owner. `server/phase-e-inventory-approve.test.js` and `server/phase-e-inventory-migration.test.js` deliberately set `NODE_ENV=production` and therefore never observe the Demo Seed, and `server/mobile-approval-center.test.js` owns the mobile approval centre, not the inventory seed identity. Placing the matrix in the mobile approval file would misattribute the inventory seed contract and would leave `A`, `B`, `D`, `E`, `G` and `H` unowned. |
| 11 | `scripts/testing/test-suites.js` | modify | **mandatory.** `server/test-suite-governance.test.js` asserts `every on-disk *.test.js is classified into a suite`, and that file is registered in FAST. A new `*.test.js` under `server/` that is not listed in `FAST`, `FULL` or `HEAVY` fails that assertion, so the new file from row 10 cannot exist without this single registry entry. The new file is registered in **FULL only**, because it creates disposable SQLite databases and therefore does not meet the FAST criterion of a bounded, database-free regression. This is the same classification the earlier U3 Search Semantics suite received. |
| 12 | `document.md` | append | the Requirement amendment |
| 13 | `solution.md` | append | this Design amendment |
| 14 | `log/2026-10-30.md` | append | the append-only evidence record |

Explicitly **not** modified by the future implementation:

`server/lib/inventory-position.js`, `server/lib/stock.js`,
`server/migrations/inventory-position-schema.js`, `server/app.js`, `server/modules/**`,
`server/migrations/**` other than none, `server/database/**`, `vite.config.js`, `package.json`,
`scripts/gates/**`, `scripts/acceptance/**` except the browser harness only if the browser plan in §5
requires it, `src/**`, the frozen Credit owners, the frozen W11-A U2 E3 suite, the protected MySQL
launcher and campaign runner, and every file outside rows 1 to 14 above.

Two files are excluded from the whitelist on purpose. `server/migrations/inventory-position-schema.js`
is excluded because §2.4 proves no new migration is required and because the module's own header is
frozen. `server/lib/inventory-position.js` is excluded because the canonical primitive is frozen and
because duplicating its algorithm is explicitly prohibited.

#### 5. The complete implementation and regression plan

The plan is the seventeen-item acceptance matrix. Every item names the artifact that must exist after
the implementation and the exact pass condition. The matrix is the definition of done for the future
implementation stage.

| Item | Subject | Artifact | Pass condition |
| --- | --- | --- | --- |
| **A** | Fresh SQLite seed physical integrity | disposable SQLite created through the production `createDatabase` | exactly the 6 demo inventory rows exist, all `active = 1`, all carry a non-empty `position_key`, 0 rows have a NULL or empty `position_key` |
| **B** | Default position key equality | the same database | for every seeded row, the stored `position_key` is byte-identical to `computePositionKey()` computed from **that row's own** `product_id`, `warehouse_id`, `bin_id`, `owner_type`, `owner_id`, `stock_status`, `lot_id` and `serial_id`, and the six stored dimension tuples are exactly the canonical default tuple |
| **C** | Inventory 20 → 22 approval | the real HTTP approval endpoint against the disposable database | the observed quantity is `22`; the observed row count for the logical position is `1`; the physical row identity is the seeded row, not a new row; the existing assertion at `server/mobile-approval-center.test.js:195` passes with its unchanged expectation |
| **D** | Exactly one canonical active position | the same database after the approval | exactly one active row carries the canonical key of the logical position, and the `(warehouse_id, product_id)` tuple has exactly one active row |
| **E** | No NULL position key after seed | fresh database and reopened database | 0 active rows with a NULL or empty `position_key` in both |
| **F** | Inventory transaction, audit and valuation | the same database after the approval | an `inventory_transactions` row exists for the check, an `audit_logs` row exists for the approval, the valuation movement and the system voucher exist, and the voucher amount agrees with the absolute difference |
| **G** | Repeat bootstrap and reopen | the same database file, reopened | the row count is unchanged, the quantity is unchanged at `22`, the position keys are unchanged, and 0 rows are NULL or non-canonical |
| **H** | No unauthorized stock mutation | the same database | the seed and the correction write no `inventory_mutation_log` row and no valuation movement; the demo seed is not performed through an accumulating stock writer |
| **I** | Three Vite middleware fixes | the three FAST files | each contains `ws: false` beside `middlewareMode: true` and `hmr: false` |
| **J** | Complete Vite call-site audit | a machine-checked scan of the repository test graph | every middleware-mode Vite instance in every FAST-registered file and in every FULL-only file either already satisfies the target or has been corrected; the scan reports 11 instances in 10 files, 8 corrected and 3 already correct, and 0 remaining binders |
| **K** | Focused concurrent test | the FAST Vite files executed concurrently | no `Port 24678 is already in use` diagnostic; no listener on 24678 before, during or after the run; all tests pass |
| **L** | FAST gate | `pnpm test:fast` | 500 tests, 37 suites, 0 fail, 0 cancelled, 0 skipped, 0 todo, exit code 0 |
| **M** | FULL gate | `pnpm test` | every test passes, 0 fail, 0 cancelled, 0 skipped, 0 todo, exit code 0, and no port diagnostic |
| **N** | Build | `pnpm build` | the Vite production build succeeds; the module count is unchanged |
| **O** | Edge browser preliminary | the existing U3 browser harness | the U3 surfaces still render and behave; no regression is observed. This item is preliminary and is not an acceptance of the U3 capability |
| **P** | Frozen SHA preservation | the frozen file identities | every frozen identity recorded in §7 is byte-identical, including `server/modules/credit-check.js`, `server/modules/credit-query.js`, `server/lib/inventory-position.js`, `server/lib/stock.js` and `server/migrations/inventory-position-schema.js` |
| **Q** | Worktree and Git governance | the repository state | the index stays empty; the branch and HEAD are unchanged; the changed-path set is exactly the whitelist rows 1 to 14; `git diff --check` passes; no commit, push, tag, merge, release or deploy occurred |

Two binding rules apply to the whole matrix:

- a failing test may **not** be repaired by changing the expected value `22` to `20`, by weakening the
  assertion, by skipping it or by downgrading it (`R-U3-VITE-05`);
- the fix may **not** be limited to making the test read select the canonical row while a non-canonical
  inventory row remains in the database (`R-U3-VITE-05`).

The execution order is: implement rows 1 to 11 → focused inventory suite → the three FAST Vite files
focused → the concurrent Vite check `K` → `git diff --check` → FAST `L` → FULL `M` → build `N` →
browser `O` → frozen SHA `P` → governance `Q`. Each gate that fails stops the sequence at that gate and
is reported as a failure; it is not repaired inside the same round and no second run of the same gate is
performed without a new authorization.

#### 6. The rollback

The correction is confined to the demo seed statement and to the Vite middleware options, so the
rollback is a plain revert of the affected files with no schema change and no data migration to undo.
Reverting the seed correction restores the defect for **freshly initialized** databases only: a
database that was initialized while the correction was in place already holds canonical keys, and the
existing migration backfill keeps it correct. No rollback step may delete, merge or rewrite an
abnormal inventory row, because that would violate `R-U3-INV-07`; an abnormal database is left as it
is and is reported.

#### 7. The frozen identities that the future implementation must preserve

| Path | SHA-256 |
| --- | --- |
| `server/modules/credit-check.js` | `6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1` |
| `server/modules/credit-query.js` | `24889d82a602cd2cd11807dd11807bbfa163f584b7fb6c13f55f62cdb0d04133b` |
| `server/modules/credit-scope.js` | `f31033bd75520643c50202c18f640440aacbcde892595efad7d4e0ba2041a3bc` |
| `server/modules/credit-special-approval.js` | `04594b3dc01240c5b3addddf50897fbeab54802daf9fbd7d49c5e36cccf289c4` |

The frozen inventory primitives `server/lib/inventory-position.js`, `server/lib/stock.js` and
`server/migrations/inventory-position-schema.js` are additionally captured by their current SHA-256 at
the moment of the future implementation and re-verified by acceptance item `P`, because they are the
prohibited-scope boundary of §4.

#### 8. What did not happen and the pause point

- No production code, test, fixture, runner, schema or migration was modified. No new file was created
  in the repository. The working tree remains clean.
- No SQLite or MySQL database was written outside the disposable diagnostic fixtures in §2.9, which
  were created in the operating-system temporary directory and deleted afterwards.
- No MySQL connection, schema operation, runner or gate execution, and no re-run of any protected gate.
- The protected launcher, the campaign runner, the frozen W11-A U2 E3 suite and the frozen Credit owners
  are unmodified.
- No FAST, FULL, HEAVY, build or browser execution. No Git write. No Acceptance and no Freeze.

HARD STOP after this Design. The next stage is the Implementation of the fourteen registered paths, and
the real MySQL verification, which needs its own explicit authorization and is not part of this Design.

**Design status: `W11_A_U3_FAST_DUAL_BLOCKER_DESIGN_READY`.**

### 37.54.44 W11-A U3 FAST Dual-Blocker Closure — Implementation Record (2026-10-30)

#### 1. Authorization, baseline and stage boundary

This section records the bounded Implementation authorized under AGENTS.md §4.0 against the approved
Requirement `document.md` "W11-A U3 FAST Dual-Blocker Closure — Bounded Requirement Amendment
(2026-10-30)" and the approved Design §37.54.43.

Baseline: branch `review/w11a-u3-fast-blocked-20261030`, HEAD
`60f3fbd169d7b43bbae3824b10b538edef4aeec1`, version `1.6.2`, empty index, three append-only
documentation paths in the working tree.

Real MySQL, a Git write, Acceptance/Freeze, Release and Deploy were not authorized and did not happen.
The WIP commit `60f3fbd169d7b43bbae3824b10b538edef4aeec1` remains the traceable parent baseline and
was not amended.

#### 2. The exact implementation boundary

The whitelist was extracted item by item from §37.54.43 §4 and executed exactly. The changed-path set is
an exact match against the approved fourteen paths; no fifteenth path was created or modified. The
verification is a set comparison of the approved list against the working-tree change set, and it
returns an exact match of 14 of 14.

#### 3. The Demo Seed canonical position correction

`server/db.js` gains one import, `computePositionKey` from `server/lib/inventory-position.js`. The
frozen primitive is not modified and remains the only position-key algorithm in the repository.

The demo inventory block now writes the canonical position identity in the insert itself:

```sql
INSERT OR IGNORE INTO inventory(
  id, warehouse_id, product_id, quantity, updated_at,
  position_key, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, active
) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
```

with `position_key` computed by `computePositionKey({ productId, warehouseId })` and the six dimension
columns bound explicitly to `null`, `'ENTERPRISE'`, `null`, `'AVAILABLE'`, `null`, `null`. The six
dimension columns are written explicitly rather than inherited from the column defaults, so the row's
stored dimensions are the literal tuple that was hashed. The six seeded row identities and the six
seeded quantities are unchanged from the previous baseline.

`INSERT OR IGNORE` is retained, which is what makes the seed idempotent: the primary key matches an
existing seeded row, and the unique position-key index matches an existing canonical row under any
other physical identity, so the insert is skipped in both cases and no quantity is written. The seed
is not performed through `adjustInventory`, `adjustInventoryAtPosition` or
`applyInventoryMutation`, so it writes no inventory mutation log, no inventory transaction and no
valuation movement, and it never accumulates a quantity.

The Demo Seed keeps its post-migration position. It was not moved back before the additive Selector
Search Key migration, so the demo customers keep writing their derived search keys in the insert and
the four production search writers are untouched.

#### 4. The independent seed verification and the fail-closed boundary

`INSERT OR IGNORE` suppresses every constraint violation, so a suppressed conflict must never be
reported as a successful seed. `verifyDemoSeedPositions(db)` reads the physical state after the seed's
own write and, for each of the six demo positions, proves that a row carrying the canonical position
key exists **and** that the row's own dimensions describe that same position. A row that merely
carries the key while describing a different logical position establishes nothing.

When a demo position cannot be established the function throws
`Demo seed failed to establish canonical inventory positions: <warehouse>/<product>`, the database
handle is closed so the file is not left locked, and the error propagates out of
`createSqliteDatabase`. The initialization therefore fails closed rather than reporting success.

The verification is read-only. It never mutates, never merges, never deletes and never rewrites a
quantity. A genuine SQL error still propagates and aborts the initialization, consistent with the
other seed writers.

#### 5. The read-only abnormal inventory detection

`server/db.js` exports `detectAbnormalInventoryPositions(db)`. It reads the active inventory rows and
classifies three observable classes:

| Class | Detection | Meaning |
| --- | --- | --- |
| `nullPositionKey` | the stored key is NULL or empty | the row carries no position identity |
| `nonCanonicalKey` | the stored key differs from the canonical identity computed for the row's own dimensions | this is what detects the synthetic `<canonical>:fallback<rowid>` identity, which no canonical writer can ever match |
| `duplicateCanonical` | two or more active rows resolve to the same canonical identity | the same logical position holds more than one active inventory fact |

The canonical identity of a row is computed with the same `computePositionKey()` primitive, from the
row's own dimensions. A row whose dimensions are not a legal canonical tuple is classified as
non-canonical rather than crashing the scan. The sample arrays are bounded at fifty entries while the
counts and the abnormal row total stay exact.

The function issues `SELECT` statements only. It is never reachable from an HTTP read route and it is
never invoked by a read path, which satisfies the read-never-repairs rule mechanically rather than by
convention.

`reportAbnormalInventoryPositions(db)` runs it immediately after the Demo Seed inside
`createSqliteDatabase`, so it runs on every open of a database in the demo path — the path that
creates the defect — and it covers a database that was first opened by the defective build. When the
report is not healthy a structured diagnostic is emitted under the stable prefix
`[modern-erp] abnormal inventory positions detected:`. The abnormal rows are preserved as evidence.

The cost boundary is unchanged from §37.54.43 §2.5: the scan runs in the demo path only.
`shouldSeedDemoData()` is false in production, so no production startup pays this cost and a
production database is not scanned at startup; the exported function is the operator-triggered path.

#### 6. The eight remaining Vite middleware corrections

Each corrected instance now carries `server: { middlewareMode: true, hmr: false, ws: false }`. The
single-line call sites keep their single-line form; the multi-line call sites keep their existing
multi-line object and only the `server` line changes. The existing `appType` and `logLevel` options
are preserved. No assertion, no lifecycle hook, no SSR loading behaviour, no React render behaviour
and no production source file changed.

`server/cost-stabilization.test.js` additionally received `hmr: false`, because it was the only
instance that carried neither `hmr: false` nor `ws: false`.

#### 7. A newly discovered twelfth Vite middleware instance

The implementation is required to statically re-check all Vite middleware instances. The re-check found
**twelve** instances in **eleven** files, not the eleven in ten files that §37.54.43 §3.2 enumerated.

The additional instance is `server/decision-reports.test.js:831`:

```js
const vite = await (await import('vite')).createServer({ root: repoRoot, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
```

It creates its server through a dynamic `import('vite')` and the `.createServer(...)` method rather
than through the static `createServer as createViteServer` alias, and the §37.54.43 enumeration was
built from that alias. The instance is registered in FULL only, so it never contributed to the
recorded FAST failure.

It was **not modified**. It is outside the approved fourteen-path whitelist; the authorization
forbids adding a fifteenth path, forbids modifying unauthorized files, and explicitly forbids
repairing a WebSocket problem in an unauthorized file when FULL raises one.

The measured consequence is benign in the current state: with the other eleven corrected, this
instance is the sole holder of port 24678, and the concurrent eleven-file Vite run, the FAST gate and
the FULL gate each recorded zero port 24678 diagnostics. The residual risk is registered: the
instance remains a port binder, so any future middleware-mode Vite test file that omits `ws: false`
would collide with it. Closing it needs a bounded Requirement and Design amendment that adds exactly
one path to the whitelist. It is not a product defect.

#### 8. A previously failing FULL-only regression

`server/inventory-position-integration.test.js` was already failing before this implementation. Its
case `inventory additive columns present + position_key backfilled` asserts that no inventory row
carries a NULL or empty position key, and the demo seed created six such rows. The file is registered
in FULL only, which is why the FAST gate never surfaced it and why the last completed FULL run
predates the U3 reorder. The correction restores the frozen Domain 5 contract and the case now passes.

#### 9. The new regression suite and the registry entry

`server/inventory-demo-seed-position-identity.test.js` is registered in **FULL only**. It creates
disposable SQLite databases and drives the real writers and the real approval HTTP surface, so it does
not meet the FAST criterion of a bounded, database-free regression. The registry entry was mandatory:
`server/test-suite-governance.test.js` asserts that every on-disk `*.test.js` is classified into a
suite, and that file is registered in FAST, so an unlisted new test file would fail the FAST gate. The
classification preserves FAST ⊆ FULL, FULL ∩ HEAVY = ∅, every on-disk test classified and no duplicate
registration.

The sixteen cases map onto the acceptance matrix as follows:

| Case | Acceptance item | Substance |
| --- | --- | --- |
| A | A | the fresh seed creates exactly six rows with the exact seeded identities, quantities, active status and a 64-character lowercase hex key |
| B | B | every stored key equals the canonical computation of the row's own dimensions, and the six dimensions are exactly the canonical default tuple |
| C | C | zero active rows carry a NULL or empty key, and the detection reports the database healthy |
| D | D | the real HTTP approval moves the canonical position from 20 to 22, read by position key, and updates the seeded row in place |
| E | D | exactly one active row carries the canonical key, exactly one active row describes the logical position, one physical row in total, no additional row created |
| F | F | one inventory transaction with the counted difference and the resulting balance, one audit record, one valuation movement with a real integer-cent amount, one system voucher with balanced entries, the approved business status, and no canonical inventory mutation log entry |
| G | G | a repeated bootstrap and two reopens preserve the real quantity, the row count and the canonical identities, and produce no keyless position |
| H | H | the legacy NULL, the recoverable NULL, the duplicated canonical position and the synthetic fallback key are each detected and reported, the detection is strictly read-only, a duplicate is never merged, deleted, summed or backdated, and the seed fails closed when it cannot establish a canonical position |

The approval case reads the canonical position by its position key and asserts the original business
expectation of `22` in addition to the unqualified read. It never manufactures the quantity, never
changes the expectation to `20` and never weakens an existing assertion.

The fail-closed case constructs the incomplete state by occupying the seeded row identity with a row
whose own dimensions describe a different logical position, which makes the seed's own insert
suppressed and proves that only the independent verification can stop the initialization from
reporting success.

#### 10. Gate evidence

Every gate ran through the isolated child environment, with every MySQL-pointing variable stripped
and `ERP_DB_PATH` absent, and with `ERP_DB_BACKEND=sqlite` pinned. The complete raw output of each
gate is preserved outside the repository under
`C:\Users\Administrator\AppData\Local\Temp\modern-erp-w11a-u3-dual-blocker-implementation-20261030`.

| Gate | Command | Exit | Result | Evidence SHA-256 |
| --- | --- | --- | --- | --- |
| F1 inventory, 13 files | `node --test <13 inventory files>` | 0 | 223 tests, 25 suites, 223 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo | `97708a8b0dc99be76e9771cc1d3d345aeb3c1504e1d1b46fadda7470b72838fa` |
| F2 Vite, 11 files, concurrent | `node --test <11 Vite files>` | 0 | 389 tests, 55 suites, 389 pass, 0 fail; zero port 24678 diagnostics; port free before and after | `80f2a306f6a64ab5e3a8df13a8b6bcc7172c301cac7a78daf4a8095551ab3141` |
| F3 U3 preservation, 15 files | `node --test <15 wave files>` | 0 | 322 tests, 322 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo | `f0e0fc22c22f158db575925076ed479001ecfd312ee1767b9f4c051b7d737960` |
| FAST | `pnpm test:fast` | 0 | 500 tests, 37 suites, 500 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo; zero port diagnostics; 23 files | `37206d28756b252f64e8cb7c5a46016cfeb2a1f21508130de09e9b68e9644ecc` |
| FULL | `pnpm test` | 0 | 3102 tests, 363 suites, 3102 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo; zero port diagnostics; 200 files | `bee55198e8e57f360b7e1ebe9d48f4a5d3f2fea206caeac61b95e6a33de146c3` |
| Build | `pnpm build` | 0 | Vite production build succeeded | `efbb111c7b8081e3c15534bc647fe4ee7399780914c0dd60e139c43def5f7d84` |
| Edge browser preliminary | `node scripts/acceptance/sales-customer-wave11-a-u3-browser-uat.mjs` | 0 | B01 through B09 all PASS, 32 responsive entries, 71 requests | `58c3b64f25124898d2379f0b7f7429914865160a76a294130917904b767811c3` |

The browser evidence directory holds `browser-acceptance-results.json`
`9b1adababa0912546e2d3b2c9c7dc51f742e6a4084ab9860bd63f9a6bbebd1c7` and `manifest.json`
`1492a537f0fed153a03fd691e452a916250d7cf0238e19a16aa3f2acf769d2c6`, the latter carrying the SHA-256 of
every screenshot.

`git diff --check` passes with no whitespace error. The new test file carries no trailing whitespace
and no conflict marker. The index stays empty, so the new file remains untracked and unstaged.

The FAST count of 500 is the original baseline count. No concurrency was reduced, no file was
reclassified and no expectation was weakened to reach it.

#### 11. The changed-file identities

| Path | SHA-256 after the implementation |
| --- | --- |
| `server/db.js` | `dae13650dfc31e718c7d0781ab6f7f4aec2a98fdd470c0104257c78fa8540185` |
| `server/spa-navigation-hotfix.test.js` | `492051797a06a904965efe13baccfa8bfacf06ce39eb4596b4b236508f4473d1` |
| `server/mobile-approval-center.test.js` | `709c260c1b9d71eb30ac4d9d62232367fefd9cdd06d31295c8f8398e67c14999` |
| `server/mobile-application-launcher.test.js` | `506273e5ab5ce8c6e1c8cf8d0c8099121ffdf7e41434a314826f5a7f7d1b51cc` |
| `server/cost-stabilization.test.js` | `87e6504b7497efd98911e961933b64aea06b424f62821dc4cc70214da8260971` |
| `server/m9-final-polish.test.js` | `cdf13075e6befd82d1128a595fbe3a185665ac2a52b90ec13de611034c96183b` |
| `server/v14-e7-two-level-business-overview.test.js` | `41b972d626acac977b35c1aca27a74ca87314974a6dd9baf8c59ffa2309dead7` |
| `server/v16-p1-mobile-enterprise-foundation.test.js` | `01bf97c5bbb1188a6de73e196d9045eab132806ca8b989ce59fed93b286153e4` |
| `server/v16-p11-mobile-enterprise-visual-refinement.test.js` | `14fd33ba437c9a991c8c81b8b9d89c812092c6fc50958d6e130204adb51b2099` |
| `server/inventory-demo-seed-position-identity.test.js` | `f7a8730229c6d99634fe506c6fbcaf16b7f1bd9f686a6f9e3238d3e2025ed20c` |
| `scripts/testing/test-suites.js` | `9a4dde32ffdfd0f7ce545d2ad41657e483b8b7e39f71a2435cebea405606115c` |

#### 12. The frozen identities

| Path | SHA-256, unchanged |
| --- | --- |
| `server/modules/credit-check.js` | `6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1` |
| `server/modules/credit-query.js` | `24889d82a602cd2cd11807dd11807bbfa163f584b7fb6c13f55f62cdb0d04133b` |
| `server/modules/credit-scope.js` | `f31033bd75520643c50202c18f640440aacbcde892595efad7d4e0ba2041a3bc` |
| `server/modules/credit-special-approval.js` | `04594b3dc01240c5b3addddf50897fbeab54802daf9fbd7d49c5e36cccf289c4` |
| `server/lib/inventory-position.js` | `970a21e0deeedd2ecba447b15068ecf6392a7a2e097b1ca887954ab40fce0a37` |
| `server/lib/stock.js` | `9c35beae6e57ebba4e16961ec559e1cd0d113b6ed0684b05749cb6fce8e8d098` |
| `server/migrations/inventory-position-schema.js` | `478520f8f3a327b526dc3687eccd0f0753831aa729a98ff7baee1eef588ee224` |
| `server/lib/search-fold.js` | `54369981e8f9353efea1a7804279d6d1b332818f0a0e4249ff2512fcf28d5143` |
| `server/migrations/sales-customer-wave11-a-selector-search-key.js` | `cf687aeb3e629ed2ea81e21d0761c58bdb547edf7fe15d9718ddf67a7e3d2965` |

No frozen inventory domain primitive was modified. The Wave 9 forward amendment, the Credit Scope,
Credit Check, Credit Query, Credit Special Approval, the U2 E3 suite, the protected MySQL launcher, the
shared runner support, the CSP/CCHK identities, the ONE_TIME identity and the OVERDUE evidence are all
unchanged.

#### 13. The remaining MySQL boundary

No real MySQL was contacted, no gate was executed and no schema was reset, modified or cleaned. The
six risk classes of the authorization remain open:

| Class | Design coverage | Real MySQL status |
| --- | --- | --- |
| Fresh snapshot and demo seed | the demo seed writes the canonical key, and the MySQL bootstrap copies it through `INSERT IGNORE` from the SQLite snapshot | NOT VERIFIED on real MySQL |
| Existing legacy NULL position | the existing approved migration backfills it; the SQLite proof shows one physical fact, never two | NOT VERIFIED on real MySQL |
| Existing duplicate position | detected and reported, never merged, deleted or summed | NOT VERIFIED on real MySQL |
| Synthetic fallback position | detected and reported as a non-canonical identity | NOT VERIFIED on real MySQL |
| U3 search key collation and backfill | unchanged by this implementation | NOT VERIFIED on real MySQL |
| Wave 9 replay compatibility | unchanged by this implementation | NOT VERIFIED on real MySQL |

The physical MySQL `inventory.position_key` is `VARCHAR(128) NULL` with `UNIQUE (position_key)`, read
from the emitted DDL with a recording mock adapter and without a MySQL connection. The canonical
64-character lowercase hex digest fits that column without truncation, and the column is nullable, so
the defective build loaded the same non-canonical demo rows on MySQL instead of failing loudly. The
correction removes that divergence, because both engines receive the same snapshot rows. The
`server/migrations/inventory-position-schema.js` header comment states `CHAR(64) NOT NULL` for MySQL;
that divergence from the actual `VARCHAR(128) NULL` is pre-existing, is not introduced by this
correction and is not changed here.

A local SQLite pass is not a MySQL pass. The real MySQL verification remains separately authorized.

#### 14. What did not happen and the pause point

- No production code outside `server/db.js` was modified, and no frozen primitive was touched.
- No real MySQL connection, schema operation, runner or gate execution.
- No Git add, commit, push, tag, merge, release or deploy; the index stays empty and the HEAD and the
  branch are unchanged.
- `server/decision-reports.test.js` was deliberately not modified; it is recorded as a newly
  discovered residual port binder requiring its own bounded amendment.
- The browser harness was executed unmodified; the three search-semantics browser scenarios remain
  uncovered because their production implementation was never completed and the harness path is
  outside the authorized whitelist.
- No Acceptance and no Freeze. The U3 Final Freeze stays blocked by the open customer-name case and
  accent semantics, the literal search escape semantics and the residual identity-domain collation
  difference.

HARD STOP after this Implementation. The next stage is the separately authorized real MySQL
verification, which needs its own explicit authorization and a new evidence directory.

**Implementation status: `W11_A_U3_SEARCH_SEMANTICS_IMPLEMENTED_READY_FOR_MYSQL_REVALIDATION`.**

### 37.54.44 W11-A U3 Final Acceptance Evidence Hardening and Protected MySQL Revalidation (2026-10-30)

#### 1. Authorization, baseline and stage boundary

The user authorized one bounded Acceptance Evidence Hardening stage and, after every local gate passed,
one protected real-MySQL Selector E3 revalidation. Exactly five paths were authorized: the three code
and test paths below and the append-only `solution.md` and `log/2026-10-30.md`. No sixth path was
created or modified.

Baseline: branch `review/w11a-u3-fast-blocked-20261030`, HEAD
`60f3fbd169d7b43bbae3824b10b538edef4aeec1`, version `1.6.2`, empty index, the fourteen authorized
paths of the previous Implementation preserved. Real MySQL was authorized for exactly one protected
execution. A Git write, Acceptance/Freeze, Merge, Tag, Release and Deploy were not authorized and did
not happen.

#### 2. The three bounded revisions

**2.1 The last Vite middleware listener.** `server/decision-reports.test.js:831` creates its server
through a dynamic `(await import('vite')).createServer(...)` call. Its server options are now
`{ middlewareMode: true, hmr: false, ws: false }`. No other initialization parameter, no assertion, no
lifecycle and no test classification changed.

The repository-wide sweep is now exhaustive and by option, not by import alias:

| # | File | Line | Suite | Configuration |
| --- | --- | --- | --- | --- |
| 1 | `server/cost-stabilization.test.js` | 74 | FULL | `middlewareMode: true, hmr: false, ws: false` |
| 2 | `server/decision-reports.test.js` | 831 | FULL | `middlewareMode: true, hmr: false, ws: false` |
| 3 | `server/m9-final-polish.test.js` | 24 | FULL | `middlewareMode: true, hmr: false, ws: false` |
| 4 | `server/mobile-application-launcher.test.js` | 30 | FAST + FULL | `middlewareMode: true, hmr: false, ws: false` |
| 5 | `server/mobile-approval-center.test.js` | 126 | FAST + FULL | `middlewareMode: true, hmr: false, ws: false` |
| 6 | `server/mobile-shell.test.js` | 41 | FAST + FULL | `middlewareMode: true, hmr: false, ws: false` |
| 7 | `server/spa-navigation-hotfix.test.js` | 27 | FAST + FULL | `middlewareMode: true, hmr: false, ws: false` |
| 8 | `server/teacher-acceptance-matrix.test.js` | 775 | FAST + FULL | `middlewareMode: true, hmr: false, ws: false` |
| 9 | `server/teacher-acceptance-matrix.test.js` | 1045 | FAST + FULL | `middlewareMode: true, hmr: false, ws: false` |
| 10 | `server/v14-e7-two-level-business-overview.test.js` | 22 | FULL | `middlewareMode: true, hmr: false, ws: false` |
| 11 | `server/v16-p1-mobile-enterprise-foundation.test.js` | 44 | FULL | `middlewareMode: true, hmr: false, ws: false` |
| 12 | `server/v16-p11-mobile-enterprise-visual-refinement.test.js` | 23 | FULL | `middlewareMode: true, hmr: false, ws: false` |

Twelve instances in eleven files, all conforming, and no other direct or dynamic Vite server factory
call exists in `server/`, `scripts/` or `src/`. The global Vite configuration, the Node test runner, the
concurrency and every port number are untouched.

**2.2 The strict S10 semantic contract.** The stale open decision
`CUSTOMER_NAME_SEARCH_SEMANTICS_OPEN` is retired. The gate now carries the approved decision token
`CUSTOMER_NAME_SEARCH_SEMANTICS_APPROVED` and asserts the approved contract of R-U3-SEARCH-01,
R-U3-SEARCH-02, R-U3-SEARCH-07, R-U3-SEARCH-08 and R-U3-SEARCH-09:

- **A — the full ordered set.** `mysqlOrder` must strictly equal `sqliteOrder` over the complete
  authorized set, not over a subset. The comparison additionally proves that the compared order really
  contains the hard identities: the fold collision, the original mixed case, the two customers that
  share one display name and the customer that owns two Credit Objects.
- **B — the exact pagination.** For the page sizes 1, 2, 3, 5, 7 and 13 the option identity sequence
  of every slice is identical on both engines, every page reports the same authorized total, no option
  repeats, no option is omitted, and the concatenation of the pages rebuilds the full ordered sequence.
- **C — the search probe parity.** Every approved Unicode and literal probe is asserted three ways: the
  SQLite result equals the approved expectation, the MySQL result equals the approved expectation, and
  the MySQL result equals the SQLite result. A divergence on an approved dimension is an acceptance
  failure and is asserted as an empty divergence list. The strict S04 assertions are preserved
  unchanged.
- **D — the evidence.** The evidence keeps the SQLite and the MySQL results, the probe labels, the SQL
  mode, the MySQL collation, the full ordering of both engines, the pagination slices and the physical
  definition of the four derived search key columns on both engines.
- **E — the structure.** S01 to S10 are preserved as ten flat top-level TAP tests with no nested plan,
  no skip, no todo and no only. The frozen U2 E3 suite, the protected runner and the shared fixtures are
  not modified.

The one dimension outside the approved search semantics is the exact identity filter of the selector,
which compares under the collation of the identity column: case-insensitive on MySQL and case-sensitive
on SQLite. R-U3-SEARCH-03 keeps that filter an equality comparison, so the difference is measured and
recorded under `RESIDUAL_EXACT_IDENTITY_COLLATION_RISK`, it is never asserted to be equal, and the
business identity equality policy is not widened.

**2.3 The browser search semantics evidence.** `scripts/acceptance/sales-customer-wave11-a-u3-browser-uat.mjs`
keeps B01 to B09 unchanged and adds B10, B11 and B12. The fixture customers are created through the
**production** write path — the real `POST /api/customers` and the real `POST /api/credit/profiles`
with a real administrator session — so the derived search keys are written by the production writers and
are never fabricated, and the shared fixture files are not modified.

- **B10 — the Unicode search.** Six probes typed into the real search field: `muller`, `müller`,
  `Müller`, `MÜLLER`, `ångström` and `Ångström`. Each must select exactly one customer, the rendered
  option must carry the expected customer code and the original display name, the count must be one and
  the empty state must not appear. A customer that only another salesperson may see must never be found,
  the empty state must appear, and the administrator must still see it, so the exclusion is proven to
  be a scope decision and not missing data.
- **B11 — the literal characters.** `%`, `_` and `\` are typed into the real search field. Each must
  select exactly one customer out of the 33 authorized options, so a literal character can never select
  the whole table. A literal character without a match must report zero and must render the empty state.
- **B12 — the deterministic ordering.** The rendered order must equal the server order, the same query
  must keep the same order, the pagination boundary must be real: the first page disables the previous
  button, the last page disables the next button, the pages neither overlap nor omit, the second page
  equals the server slice, and the previous page restores the first page exactly. The option identity
  must be the canonical three-part identity, and a refresh and a back-and-forward navigation must both
  keep the deterministic order and a continuous URL.

The 320, 390, 430 and 680 responsive matrix and the before/after lifecycle are unchanged. The
canonical empty state class is shared with the exposure workspace, so the selector empty state is
identified by its own title instead of by the class.

#### 3. The local gates

Every gate ran through the isolated child environment with the MySQL-pointing variables stripped and
`ERP_DB_PATH` absent. The complete raw output is preserved outside the repository under
`C:\Users\Administrator\AppData\Local\Temp\modern-erp-w11a-u3-acceptance-hardening-20261030`.

| Gate | Exit | Result | Evidence SHA-256 |
| --- | --- | --- | --- |
| Targeted Vite concurrent, 11 files | 0 | 389 tests, 55 suites, 389 pass, 0 fail; zero port 24678 diagnostics; the port free before and after | `f5c4d2a596ce4a666a4033ea95e075a1620378b39fb2c6ceaa027ddcb1b92d98` |
| MySQL suite static contract, before the run | 0 | 21 of 21 checks pass | `8e12bddee38ccf67573dd99ae54fdf43f115c67d41db689d914b6c8b14a9d910` |
| MySQL suite static contract, after the run | 0 | 7 of 7 checks pass, including the new guard that no boolean is compared with a number | `ab8840341d905a3d0eaa1eba21891b3bf0720bab05cc38f563f2d383a023434a` |
| Browser B01 to B12 | 0 | 12 of 12 PASS, 32 responsive entries, 23 screenshots | `f81fb632ce36930634f23208c6d81fed3e82be9bb06c7fc36c8d0184cb11c060` |
| Search semantics and U3 SQLite | 0 | 145 tests, 145 pass, 0 fail | `7decb25cf5288b7f398c1d3848f28af8c2f4f13a24119dd8a446cdc975e6b0b0` |
| FAST | 0 | 500 tests, 37 suites, 500 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo; zero port diagnostics | `6820b8b599b279ceabdd24c3cec0657e7861a499c3bcf36473fc9c1cce680928` |
| FULL | 0 | 3102 tests, 363 suites, 3102 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo; zero port diagnostics | `4e2416e23f604f52064594f40ce93e53cd746a8f198a6ede26c8bba44b1e254e` |
| Build | 0 | the Vite production build succeeded | `ea115d9c4de23b991e4670cf6beba9a5b9b92ecd2cac986428ade9ef36775e9b` |
| `git diff --check` | 0 | no whitespace error | — |

The FAST count of 500 and the FULL count of 3102 are unchanged from the previous stage. No test was
skipped, downgraded or reclassified, no concurrency was reduced and no port was reassigned.

#### 4. The protected MySQL Selector E3 execution

The authorized launcher was used exactly once, with no manual MySQL script and no hand-picked schema:

```text
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/run-mysql-local-gate.ps1 -Script test:mysql:wave11-a:selector
```

The launcher's own preflight proved the target before the campaign started: the target
`modern_erp_domain_test` as `modern_erp_test@127.0.0.1`, server `8.0.37` with the pinned UUID
`256c7a4e-d275-11f1-885b-b025aa71d167`, the pinned grants SHA-256
`bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e`, and the initial inventory
`tables=0 views=0 triggers=0 routines=0 events=0`. The runtime prerequisite
`log_bin_trust_function_creators` was verified read-only before the run and was `ON` with
`VARIABLE_SOURCE = DYNAMIC`, so the instance had not been restarted since the flag was set.

**The campaign result was FAIL: 9 of 10 tests passed, S10 failed.** The raw transcript is
`24c2ce8ce8af35b9d48bfbc0158e4fcccdc11d715b6fe9d72de1bdd0fe657694` and the evidence JSON is
`e3d848fe54a4a75b67071a5cd67b81184d5f982c82044a17a59239c5bc789531`.

What the passing tests already prove on real MySQL:

- S01: the SQLite and the MySQL option sets are identical at 16 options, and the additive compatibility
  M03 (V1 to V2), M10 (fresh bootstrap and live Wave 9 replay) and M12 (an illegal column type is
  refused and V2 is restored) all pass. The final `credit_profile` search key columns are `longtext`,
  nullable, `utf8mb4_0900_bin`.
- S02: all seven Credit Read Modes project the same logical options on both engines, and the denied
  reader is refused with `CREDIT_SCOPE_DENIED` and no customer identity.
- S03: the count, the list and the grouping share one authorized set, and the pagination rebuilds the
  unpaginated set on both engines.
- S04: **the strict literal and Unicode probe assertions pass on real MySQL.** The `%`, `_` and `\`
  literals and the five Unicode probes select exactly the approved expectation on both engines, which
  is the direct cross-engine proof of the approved search semantics on the probe dimension.
- S05 to S09: the exact identity filter, the invalid input contract, the effective-date window, the
  revoked membership, the 409 on an ambiguous effective Profile, the indistinguishable unknown and
  unauthorized identities, and the repeatable zero-write GET all hold on both engines.

**The root cause of the S10 failure is a TEST ORACLE DEFECT, not a product defect.** The failing
assertion was the pre-existing metadata guard

```js
assert.ok(Number.isSafeInteger(Number(mysqlFacts.session.max_sort_length)) >= 1024, 'the MySQL group-key boundary must be readable');
```

`Number.isSafeInteger(...)` returns a boolean, and a boolean compared with 1024 is always false, so the
assertion could never pass for any safe integer. It was introduced into this file by the search
semantics Implementation and had never been executed against real MySQL, because the last successful
MySQL run used an earlier version of the file. The live server value is 1024 and was proven twice
read-only: through a direct catalogue query and through the repository's own MySQL adapter, both
returning the number 1024 with `character_set_server = utf8mb4` and
`collation_server = utf8mb4_0900_ai_ci`.

The correction applied to the authorized file is the one line that expresses the stated intent of the
assertion, and it is the exact form the adjacent assertion already uses:

```js
assert.ok(Number(mysqlFacts.session.max_sort_length) >= 1024, 'the MySQL group-key boundary must be readable');
```

**The gate was not re-run.** The authorization covered one protected execution and it has been used.

**The consequence is stated precisely.** Because S10 aborted at its first metadata guard, the new
strict assertions of §37.54.44 §2.2 — the full ordered set equality and the exact pagination parity —
were **not exercised on real MySQL**. The approved search probe parity **was** exercised and passed, on
both engines, in S04. The ordering and pagination parity remain unverified on the live target.

**The cleanup contract is satisfied.** The campaign reported
`FINAL ZERO OBJECTS = {"tables":0,"views":0,"triggers":0,"routines":0,"events":0}` and the launcher
confirmed `CLEANUP = tables=0 views=0 triggers=0 routines=0 events=0` on a fresh session.

#### 5. The remaining MySQL risks

The six risk classes of the authorization remain open. The Demo Seed inventory position identity is
still NOT verified on real MySQL, because the protected gate covers the Credit Selector surface and not
the inventory seed; it is registered here as an independent remaining risk and is not claimed as
accepted:

| Class | Design coverage | Real MySQL status |
| --- | --- | --- |
| Fresh snapshot and Demo Seed, including the demo inventory position identity | the demo seed writes the canonical key and the six canonical dimensions; the MySQL bootstrap copies them through the SQLite snapshot | NOT VERIFIED on real MySQL — the protected gate does not exercise the inventory seed |
| Existing legacy NULL position | the existing approved migration backfills it; the SQLite proof shows exactly one physical fact | NOT VERIFIED on real MySQL |
| Existing duplicate position | detected and reported, never merged, deleted or summed | NOT VERIFIED on real MySQL |
| Synthetic fallback position | detected and reported as a non-canonical identity | NOT VERIFIED on real MySQL |
| U3 search key collation and backfill | the collation is pinned and the backfill verified on both engines in S01 | the `credit_profile` columns are proven `utf8mb4_0900_bin`; the `customers` columns are read in S10 and were not reached |
| Wave 9 replay compatibility | M03 and M10 pass on the live target | VERIFIED on real MySQL in S01 |

A local SQLite pass is not a MySQL pass, and this stage declares no MySQL acceptance.

#### 6. The frozen identities

Every frozen identity is byte-identical to the previous stage: `server/modules/credit-check.js`
`6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1`,
`server/modules/credit-query.js`
`24889d82a602cd2cd11807dd11807bbfa163f584b7fb6c13f55f62cdb0d04133b`,
`server/modules/credit-scope.js`
`f31033bd75520643c50202c18f640440aacbcde892595efad7d4e0ba2041a3bc`,
`server/modules/credit-special-approval.js`
`04594b3dc01240c5b3addddf50897fbeab54802daf9fbd7d49c5e36cccf289c4`,
`server/lib/inventory-position.js`
`970a21e0deeedd2ecba447b15068ecf6392a7a2e097b1ca887954ab40fce0a37`,
`server/lib/stock.js` `9c35beae6e57ebba4e16961ec559e1cd0d113b6ed0684b05749cb6fce8e8d098`,
`server/migrations/inventory-position-schema.js`
`478520f8f3a327b526dc3687eccd0f0753831aa729a98ff7baee1eef588ee224`,
`server/lib/search-fold.js` `54369981e8f9353efea1a7804279d6d1b332818f0a0e4249ff2512fcf28d5143`,
`server/migrations/sales-customer-wave11-a-selector-search-key.js`
`cf687aeb3e629ed2ea81e21d0761c58bdb547edf7fe15d9718ddf67a7e3d2965`,
`server/modules/credit-query-options.js`
`dd46f1d049c1c44a3c3168a3c29f65b3110e071eedf7ed6ade81c22acb1e3cbf`,
`server/app.js` `c3e908f836d2aedcfc054a2d904e97de3c3ec542674c6f78a93becd2a2878e63`,
`server/test-utils/wave11-a-selector-gate-fixture.js`
`4bce5e411c41d6868d973f002ed7c3c99dfd4b724a56bd3a3c484616c6c5fff3`,
`server/test-utils/wave11-a-credit-query-fixture.js`
`80a251a2cd05f58746490280683b905414b8d6b05f6eb91535e6d818ffbb9eab`,
`server/test-utils/wave11-sec-scope-fixture.js`
`142aa30a2fc909b80c157520b42a1948cbdd15d6fed16a2da81a36d900e094aa`,
`scripts/gates/mysql-sales-wave11-a-selector-gate.mjs`
`e1cbf47190b991b4174e173929f73e70bc51ddaab7600ed3c434735c591fa779`,
`scripts/gates/run-mysql-local-gate.ps1`
`209527dce8ef7cd4a05a6951e041892256c3b06736cbdde12be86bef0e00bd65` and `package.json`
`43d6ec696d2a54896c6968bc163710341a8a85431bad9efa29cdd44169047dee`.

The only changed code identity of this stage is the gate suite itself,
`server/mysql-sales-customer-wave11-a-credit-query-options.integration.js`, which moved from
`79038823c1efc5ec9b4af187eaf3512482e5b1b069414b4b7dfca74300f01a23` to
`38680723fd309e5564f8b50a7795c3661023e2695ae6560dc139882f5c78f4fd`.

#### 7. What did not happen and the pause point

- No production code, schema, migration, frozen Credit core or inventory primitive was modified. The
  two production-adjacent paths in the whitelist carry test and harness code only.
- No protected launcher, runner, campaign machinery, credential store or identity baseline was modified.
- The protected gate was executed exactly once and was not re-run.
- No Git add, commit, push, tag, merge, release or deploy; the index stays empty, the branch and HEAD
  are unchanged and the version stays `1.6.2`.
- The historical evidence of the original U3 E3 run, the original search divergence evidence, the B06
  failure evidence, the original B01 to B09 pass, the previous FAST 499 of 500 failure and the latest
  FAST and FULL passes are all preserved and were not rewritten.
- No Acceptance and no Freeze.

HARD STOP. The bounded follow-up is one more protected execution of the same gate with the corrected
assertion, which needs its own explicit authorization. The W11-A U3 Final Freeze stays blocked by that
open verification and by the open customer-name case and accent semantics, the literal search escape
semantics and the residual identity-domain collation difference.

**Stage status: `W11_A_U3_MYSQL_REVALIDATION_FAILED`.**

### 37.54.45 W11-A U3 Protected MySQL S10 Bounded Revalidation (2026-10-30)

#### 1. Authorization and boundary

The user authorized exactly one complete protected W11-A U3 Selector MySQL E3 gate execution on the
corrected S10 `max_sort_length` assertion. No new production code change, no new test logic change, no
schema or migration change, no manual database reset, no change to the protected launcher, no change
to the MySQL permissions or credentials, no Git write, no Acceptance/Freeze, no Merge, Tag, Release or
Deploy was authorized, and none occurred.

Baseline: branch `review/w11a-u3-fast-blocked-20261030`, HEAD
`60f3fbd169d7b43bbae3824b10b538edef4aeec1`, version `1.6.2`, empty index, the seventeen authorized
changed paths preserved. No reset, restore, clean, checkout, rebase or merge was performed.

#### 2. The exact S10 assertion correction

The reported correction is the single assertion

```js
assert.ok(
  Number.isSafeInteger(Number(mysqlFacts.session.max_sort_length))
    && Number(mysqlFacts.session.max_sort_length) >= 1024,
  'the MySQL group-key boundary must be readable',
);
```

The verification confirmed every point of the authorization:

1. the integer-validity check is retained inside the corrected assertion;
2. the `>= 1024` lower bound is retained;
3. the assertion is active — it is not commented out, deleted or bypassed, and the pre-existing
   `max_sort_length must be readable` assertion above it is untouched;
4. no other S10 assertion changed, and S01 to S09 are unchanged;
5. the test count and the TAP structure are unchanged: ten flat top-level tests, ids S01 to S10
   contiguous, no nested plan, no skip, no todo and no only;
6. the strict S10 contract still executes to its last assertion: the full ordered-set equality, the
   cross-engine pagination parity, the three-way search probe equality, the zero divergence assertion,
   the no-duplicate and no-omitted option identity assertions and the MySQL physical collation
   evidence.

The old open search policy is not restored. The evidence carries
`semanticDecision = CUSTOMER_NAME_SEARCH_SEMANTICS_APPROVED`, and the residual exact identity
collation risk stays measured, disclosed and never asserted equal.

**The difference that this stage corrected.** The previous stage had left the corrected assertion as
the single condition `Number(...) >= 1024`, which relied on the adjacent untouched readability
assertion for the integer check. The authorized target is the conjunction, so the corrected assertion
now carries both conditions itself. The change is provably confined to that one assertion: the
previous-stage file was reconstructed by reverting exactly that assertion and its SHA-256 was
recomputed, and it reproduced the recorded previous-stage identity
`38680723fd309e5564f8b50a7795c3661023e2695ae6560dc139882f5c78f4fd` exactly. No other byte of the file
differs. The new identity is
`39a34ee86ee3c6ed2981fef5243a53a38aa5dd2b402b83e9058dc6df70c72e3d`.

#### 3. The minimal static verification

| Command | Exit | Result |
| --- | --- | --- |
| `node --check server/mysql-sales-customer-wave11-a-credit-query-options.integration.js` | 0 | no syntax error |
| `git diff --check` | 0 | no whitespace error |
| `git status --short` | 0 | the seventeen authorized paths, unchanged set |

The nineteen-point static verification of the S10 correction passed 19 of 19.

FAST, FULL and the build were not re-executed in this round, because the only change is an assertion
inside the protected MySQL integration suite, which is not registered in the ordinary FAST or FULL
scope. The previous local PASS evidence therefore remains valid evidence for the previous state and is
**not** claimed as a post-correction re-run.

#### 4. The protected target preflight

The runtime prerequisite was verified read-only before the execution, using the same DPAPI credential
store as the launcher and printing no password: `log_bin_trust_function_creators` was `ON` with
`VARIABLE_SOURCE = DYNAMIC`, so the instance had not been restarted since the flag was set, and the live
`max_sort_length` was `1024`.

The launcher's own preflight then proved the protected target before the campaign started: the target
`modern_erp_domain_test` as `modern_erp_test@127.0.0.1`, server `8.0.37` with the pinned UUID
`256c7a4e-d275-11f1-885b-b025aa71d167`, the pinned grants SHA-256
`bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e`, and the initial inventory
`tables=0 views=0 triggers=0 routines=0 events=0`. The machine-wide gate lock was taken, the protected
reset and cleanup were performed by the existing machinery, and neither the target identity, the
credentials, the authorization baseline nor the launcher was modified.

#### 5. The S01 to S10 results

| Id | Result | Substance |
| --- | --- | --- |
| S01 | PASS | the real MySQL adapter and the shared production fixture; the SQLite and the MySQL option sets are identical at 16; the additive compatibility M03 `V1_TO_V2_PASS`, M10 `FRESH_BOOTSTRAP_AND_LIVE_REPLAY_PASS` and M12 `ILLEGAL_TYPE_REFUSED_AND_V2_RESTORED` |
| S02 | PASS | the seven Credit Read Modes project the same logical options on both engines — admin 16, cross 16, self 15, other 16, unmapped 15, expired 15, future 15 — and the denied reader is refused with `CREDIT_SCOPE_DENIED` and no customer identity |
| S03 | PASS | the count, the list and the grouping share one authorized set and the pagination rebuilds the unpaginated set on both engines |
| S04 | PASS | the defined, literal and Unicode probes match the authorized set on both engines |
| S05 | PASS | the exact identity filter and the invalid input contract are identical |
| S06 | PASS | the effective-date window and the revoked membership match SC101 |
| S07 | PASS | an ambiguous effective Profile answers 409 on both engines |
| S08 | PASS | an unknown exact identity is indistinguishable from an unauthorized one |
| S09 | PASS | every measured GET is repeatable and leaves the database unchanged |
| S10 | PASS | the ordering, the pagination and the search probes are identical on both engines |

The process exit code was `0`. The strict TAP contract, independently re-verified with the
repository's own `scripts/gates/mysql-wave10-tap-transcript.mjs`, holds exactly: one `TAP version 13`
header, one plan `1..10`, ten records with contiguous ids 1 to 10, every record a plain `ok`, zero
skip, zero todo, zero bail out, zero malformed record, and every summary field exactly once — `tests
10`, `pass 10`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`.

#### 6. S04 — the Unicode and literal search

The strict S04 assertions passed on the live target. The probe sets are:

- defined: `ascii-code-lower`, `ascii-code-upper`, `ascii-code-mixed`, `ascii-other-code`,
  `credit-object-identity`, `unauthorized-target`;
- literal: `literal-percent`, `literal-underscore`, `literal-backslash`, `literal-escaped-backslash`;
- Unicode: `accent-folded`, `accent-exact-lower`, `accent-upper-case`, `unicode-case-lower`,
  `unicode-case-exact`.

The case-insensitive search, the Latin accent fold, the Unicode case fold and the literal treatment of
`%`, `_` and `\` therefore select the authorized set identically on SQLite and on MySQL, and the
unauthorized target selects nothing on either engine.

#### 7. S10 — the strict parity, executed to its last assertion

- **`max_sort_length` — the real value: 1024.** The integer-validity check holds and the `>= 1024`
  lower bound holds, so the previously failing guard now passes on its own terms.
- **The full SQLite ordered set: 16 identities**, and **the full MySQL ordered set: 16 identities**.
- **Exact ordered-set equality: `fullOrderIdentical = true`.** The two complete sequences are
  byte-identical, including the four shared customers whose `code_search_key` is NULL and therefore
  sort first on both engines, the mixed-case customer, the two customers that share one display name
  and the customer that owns two Credit Objects.
- **Six pagination page sizes: 1, 2, 3, 5, 7 and 13.** For each size the page slices are identical
  on both engines, every page reports the same authorized total, no option repeats, no option is
  omitted, and the concatenation of the pages rebuilds the full ordered sequence.
- **Search probe three-way equality:** for all eleven approved probes the SQLite result equals the
  approved expectation, the MySQL result equals the approved expectation and the MySQL result equals
  the SQLite result.
- **Divergent probe count: 0.** The assertion `no approved search probe may diverge between the two
  engines` holds with an empty divergence list.
- **MySQL physical collation evidence:** `sql_mode` is
  `IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`,
  `collation_server` is `utf8mb4_0900_ai_ci`, `collation_connection` is `utf8mb4_general_ci`, the
  `utf8mb4_0900_ai_ci` `PAD_ATTRIBUTE` is `NO PAD` and `IS_COMPILED` is `Yes`, and the observed maximum
  `credit_object_type` length is 11 bytes, which stays below the 1024-byte boundary. The four derived
  search key columns are `text`, nullable, `BINARY` on SQLite and `longtext`, nullable,
  `utf8mb4_0900_bin` on MySQL — including the two `customers` columns that the previous failed run
  never reached.

**The residual exact identity collation risk remains open and is measured, not asserted.** The
case-variant exact identity resolves to no row on SQLite and to one row on MySQL, so
`enginesAgree = false`. It is recorded under `RESIDUAL_EXACT_IDENTITY_COLLATION_RISK` with the status
`DISCLOSED_MEASURED_NOT_ASSERTED_EQUAL`, it is not part of the approved probe set, and this gate never
widens the business identity equality policy.

#### 8. The cleanup

The campaign reported
`FINAL ZERO OBJECTS = {"tables":0,"views":0,"triggers":0,"routines":0,"events":0}` and the launcher
confirmed `CLEANUP = CONFIRMED (tables=0 views=0 triggers=0 routines=0 events=0)` on a fresh session,
after the campaign's own report. All five object categories are zero, so the cleanup contract is
satisfied and the gate result stands as a PASS. No manual cleanup was performed.

#### 9. The evidence

The new evidence is in an independent directory and does not overwrite any historical artifact:
`C:\Users\Administrator\AppData\Local\Temp\modern-erp-w11a-u3-revalidation-20261030`.

| Artifact | SHA-256 |
| --- | --- |
| `mysql-e3/gate-run-raw.log` | `548ce83ed6953561ad2bfc03f6802a597ed112bf89440a93eba2944f7362d615` |
| `mysql-e3/evidence/selector-mysql-e3-evidence.json` | `e389756d80fbb662b94fc3acdc0481e651497337180fc89aea8e79ec7f4b6700` |
| `s10-correction-verification.log` | `26f8442a06efcf04590645708b3867d47c07c511bab8cef0e3fdfbf3ff406276` |
| `static-node-check.log` | `15652721cf2751810d7b9d25a6b268da99483b6254cb356debc6a4a60f236773` |
| `static-git-diff-check.log` | `b4b801cf2d5f57e385b33b9bed2aff711a08779ab39da0ee86d9e88a2df2ff12` |
| `static-git-status.log` | `8c5304fdb98db802521afd218779acc8c270637a1d02170188486c3074233b7a` |
| `strict-tap-verification.log` | `2b8e2a448745253d028f82162494df35a56721427adf9cc3992a094e26a4f30c` |

The historical evidence is preserved byte-identically: the first revalidation failure transcript is
still `24c2ce8ce8af35b9d48bfbc0158e4fcccdc11d715b6fe9d72de1bdd0fe657694` and its evidence JSON is
still `e3d848fe54a4a75b67071a5cd67b81184d5f982c82044a17a59239c5bc789531`, together with the original
E3 10 of 10 pass, the original search divergence evidence, the B06 historical failure, the original
B01 to B09 pass, the previous FAST 499 of 500 failure, the FAST 500 of 500 pass, the FULL 3102 of 3102
pass and the browser B01 to B12 pass.

#### 10. The frozen identities and the final worktree

Every frozen identity is byte-identical: `server/modules/credit-check.js`
`6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1`,
`server/modules/credit-query.js`
`24889d82a602cd2cd11807dd11807bbfa163f584b7fb6c13f55f62cdb0d04133b`,
`server/modules/credit-scope.js`
`f31033bd75520643c50202c18f640440aacbcde892595efad7d4e0ba2041a3bc`,
`server/modules/credit-special-approval.js`
`04594b3dc01240c5b3addddf50897fbeab54802daf9fbd7d49c5e36cccf289c4`,
`server/lib/inventory-position.js`
`970a21e0deeedd2ecba447b15068ecf6392a7a2e097b1ca887954ab40fce0a37`,
`server/lib/stock.js` `9c35beae6e57ebba4e16961ec559e1cd0d113b6ed0684b05749cb6fce8e8d098`,
`server/migrations/inventory-position-schema.js`
`478520f8f3a327b526dc3687eccd0f0753831aa729a98ff7baee1eef588ee224`,
`server/lib/search-fold.js` `54369981e8f9353efea1a7804279d6d1b332818f0a0e4249ff2512fcf28d5143`,
`server/migrations/sales-customer-wave11-a-selector-search-key.js`
`cf687aeb3e629ed2ea81e21d0761c58bdb547edf7fe15d9718ddf67a7e3d2965`,
`server/modules/credit-query-options.js`
`dd46f1d049c1c44a3c3168a3c29f65b3110e071eedf7ed6ade81c22acb1e3cbf`,
`server/app.js` `c3e908f836d2aedcfc054a2d904e97de3c3ec542674c6f78a93becd2a2878e63`,
`server/test-utils/wave11-a-selector-gate-fixture.js`
`4bce5e411c41d6868d973f002ed7c3c99dfd4b724a56bd3a3c484616c6c5fff3`,
`server/test-utils/wave11-a-credit-query-fixture.js`
`80a251a2cd05f58746490280683b905414b8d6b05f6eb91535e6d818ffbb9eab`,
`server/test-utils/wave11-sec-scope-fixture.js`
`142aa30a2fc909b80c157520b42a1948cbdd15d6fed16a2da81a36d900e094aa`,
`scripts/gates/mysql-sales-wave11-a-selector-gate.mjs`
`e1cbf47190b991b4174e173929f73e70bc51ddaab7600ed3c434735c591fa779`,
`scripts/gates/run-mysql-local-gate.ps1`
`209527dce8ef7cd4a05a6951e041892256c3b06736cbdde12be86bef0e00bd65` and `package.json`
`43d6ec696d2a54896c6968bc163710341a8a85431bad9efa29cdd44169047dee`.

The only changed code identity is the gate suite itself. The final worktree carries exactly the
seventeen authorized changed paths, the index is empty, the branch and HEAD are unchanged, the version
stays `1.6.2` and the annotated tags `v1.6.0`, `v1.6.1` and `v1.6.2` are unchanged.

#### 11. The remaining MySQL inventory risks

A Selector Gate PASS is not an inventory-domain MySQL acceptance and is not a whole-W11-A MySQL
acceptance. The following stay registered and outside this verification:

1. the Fresh MySQL Demo Inventory canonical position identity — the protected gate covers the Credit
   Selector surface and never exercises the inventory seed;
2. the legacy NULL inventory positions;
3. the duplicate canonical inventory positions;
4. the synthetic fallback positions;
5. the MySQL historical inventory data repair strategy;
6. the business confirmation of the residual exact identity collation.

**Stage status: `W11_A_U3_MYSQL_SELECTOR_E3_REVALIDATION_PASS_PENDING_FINAL_ACCEPTANCE`.**

### 37.54.46 W11-A U3 Final Acceptance Readiness Audit and Bounded Residual Risk Design (2026-10-30)

#### 1. Authorization, inputs and boundary

This section is the bounded Design amendment authorized together with the Requirement amendment
"document.md — W11-A U3 Final Acceptance Readiness — Bounded Residual Risk Requirement Amendment
(2026-10-30)". It records the Final Acceptance Readiness Audit, the Risk A audit conclusion and the
bounded Design for the one confirmed gap.

No Implementation, no real MySQL, no Git write and no Final Acceptance or Freeze occurred. The
completed gate evidence is preserved unchanged and is not reclassified.

#### 2. Risk A — the Exact Identity Collation audit

##### 2.1 The production path that was read

- the exact identity input parsing: `server/modules/credit-query-options.js` `readInput` — the
  customer identity and the Credit Object identity pass through `requiredText` and are not normalized,
  while the Credit Object type passes through `requiredCode` and is therefore upper-cased;
- the identity predicate: `buildAuthorizedRelation` adds `cp.customer_id=?`, `cp.credit_object_type=?`
  and `cp.credit_object_id=?` to the same where clause as the read scope;
- the free-text search: the same function matches the four derived search key columns with
  `LIKE ? ESCAPE '!'` over byte-exact keys, which is why the search dimension is engine-consistent;
- the read scope resolver: `server/modules/credit-scope.js` `resolveCreditProfileReadScope` and
  `resolveCreditReadMode`, with the scope predicate
  `(cp.salesperson_scope_key = '*' OR cp.salesperson_scope_key = ?)`;
- the anchor shape guard: `server/modules/credit-anchor.js` `ensureCreditLockAnchor` and `sameShape`;
- the MySQL physical collations, read from the emitted DDL with a recording mock adapter, without a
  MySQL connection.

##### 2.2 The physical MySQL contract of the identity columns

| Column | Physical type | Collation |
| --- | --- | --- |
| `customers.id` | `VARCHAR(128) NOT NULL`, `PRIMARY KEY (id)` | `utf8mb4_0900_ai_ci` — case-insensitive |
| `customers.code` | `VARCHAR(128) NOT NULL`, `UNIQUE (code)` | `utf8mb4_0900_ai_ci` — case-insensitive |
| `credit_profile.customer_id` | `VARCHAR(128) NOT NULL` | `utf8mb4_0900_ai_ci` — case-insensitive |
| `credit_profile.credit_object_type` | `LONGTEXT NOT NULL` | `utf8mb4_0900_ai_ci` — case-insensitive |
| `credit_profile.credit_object_id` | `VARCHAR(128) NOT NULL` | `utf8mb4_0900_ai_ci` — case-insensitive |
| `credit_profile.salesperson_scope_key` | `VARCHAR(128) NOT NULL` | `utf8mb4_0900_ai_ci` — case-insensitive |
| `credit_lock_anchors.anchor_key` | `VARCHAR(512) NOT NULL`, `UNIQUE (anchor_key)` | `utf8mb4_0900_ai_ci` — case-insensitive |

The SQLite side declares no explicit collation on these columns and therefore uses the default `BINARY`
comparison.

##### 2.3 The seven answers

1. **The divergence occurs in the exact identity filter, not in the ordinary `q` search.** The `q` search
   compares the derived search key columns, which the U3 migration pins to `BINARY` on SQLite and to
   `utf8mb4_0900_bin` on MySQL, with an explicit escape clause. S04 and S10 prove it with **zero**
   divergent probes over the eleven approved probes.
2. **The comparison that produces the difference** is the equality on the customer identity and on the
   Credit Object identity under the identity column collation. The Credit Object type cannot contribute,
   because the production input contract upper-cases it before the comparison and the writer stores the
   upper-cased code.
3. **A wrong business identity cannot be returned.** On MySQL the customer identity primary key, the
   customer code unique key and the Credit lock anchor key unique key are all case-insensitive, so two
   business identities differing only by case cannot coexist. The anchor shape guard compares the stored
   anchor shape with the requested shape using byte equality, so a case-variant identity is refused on
   write with `CREDIT_ANCHOR_SHAPE_CONFLICT`; on SQLite the reference lookup is byte-sensitive and
   refuses it with `404 客户不存在`. Each engine therefore resolves a case-variant identity inside an
   unambiguous identity space, and the resolved identity is the canonical one.
4. **The authorization boundary is unaffected.** The scope predicate is conjoined in the same where
   clause and gates every candidate row before the projection. Its bound value is derived by
   `resolveSelfSalespersonId` from the server's own `salesperson_profiles.id` record, and
   `credit_profile.salesperson_scope_key` is written from that same value, so no user-supplied case
   variant ever reaches the scope comparison. The denied mode refuses with `CREDIT_SCOPE_DENIED` before
   any query runs, and the measured case-variant resolution returned `cus-w11-self`, which is inside the
   reader's authorized set of fifteen.
5. **There is no unauthorized disclosure.** The identity predicate can only narrow the already
   authorized relation; it can never add a row that the scope predicate excluded. The neutral response
   for an unknown identity and for an unauthorized identity stays byte-identical on both engines, which
   S08 proves.
6. **The current Requirement does not state an identity case policy.** R-U3-SEARCH-03 defines the exact
   identity filter only as an equality comparison and does not define a case policy. The R-U3-GATE-04
   open decision covered the customer-name **search** and was resolved by R-U3-SEARCH-01; it never
   covered the identity filter. The approved parity strictness taxonomy of R-U3-GATE-03 does, however,
   classify exactly this case twice: as a test environment difference, because two business identities
   that differ only by case cannot be stored under a case-insensitive unique key, and as an acceptable
   database implementation difference, because a collation behaviour that the business contract does not
   define is measured on both engines, reported, and must never widen the authorized set.
7. **It is an acceptable, documented known limitation and not a business semantic inconsistency that
   must be corrected.** The disposition the Requirement already prescribes is satisfied: the difference
   is measured on both engines and reported as a typed finding, the authorized set is never widened, and
   no engine is selected as the business authority. Correcting it would require either declaring one
   engine authoritative or changing the approved Search Fold or the literal search contract, both of
   which are prohibited.

The consequence is a disposition rather than a correction: the risk is classified as an accepted
residual and requires an explicit business risk acceptance from the business owner, which is recorded
as an open decision in §9.

#### 3. Risk A — why no second Requirement was created

The Requirement already provides the classification and the disposition, and the condition the taxonomy
attaches — that the difference must never widen the authorized set — is proven by the production code
analysis of §2.3 and by the S02, S04, S08 and S10 results. Creating a second Requirement would
duplicate an approved rule and would risk freezing an engine as the business authority. The audit
conclusion is therefore recorded in R-U3-INV-06 and no further Requirement is created.

#### 4. Risk B — the Fresh MySQL Demo Inventory audit

##### 4.1 The path that was read

| Element | Finding |
| --- | --- |
| `server/db.js` Demo Seed | writes the canonical `position_key` from the single primitive `computePositionKey()` and writes the six canonical dimension columns explicitly, then calls `verifyDemoSeedPositions`, which fails closed when a demo position cannot be established |
| `computePositionKey` | the single primitive in `server/lib/inventory-position.js`; the default tuple is `owner_type = ENTERPRISE`, `owner_id = NULL`, `stock_status = AVAILABLE`, `bin_id = NULL`, `lot_id = NULL`, `serial_id = NULL` |
| MySQL snapshot capture | `captureSqliteSnapshot` builds the snapshot through `createSqliteDatabase`, so the snapshot carries the migrated schema **and** the seeded rows, including their canonical keys |
| Snapshot row copy | `bootstrapMySql` copies with `INSERT IGNORE INTO <table> (<every snapshot column>)`, so `position_key` and the dimension columns are copied verbatim |
| Physical position key type | MySQL `inventory.position_key` is `VARCHAR(128)` and nullable; the canonical key is a 64-character lowercase hex digest, so it fits without truncation |
| Unique constraints | MySQL emits `CREATE UNIQUE INDEX uq_inventory_position_key ON inventory (position_key)`, and the canonical default tuple is preserved by the column defaults `owner_type DEFAULT 'ENTERPRISE'`, `stock_status DEFAULT 'AVAILABLE'`, `active DEFAULT 1` and the nullable `owner_id`, `bin_id`, `lot_id` and `serial_id` |
| MySQL bootstrap ordering | the tables are created from the snapshot, and the live adapter then runs the additive Search Key migration, which pins the collation and verifies the backfill before the adapter is returned |
| Protected gate infrastructure | the existing launcher, the DPAPI credential, the fixed target identity, the machine-wide lock, the strict TAP parser and the five-class zero cleanup are reusable unchanged |

The snapshot as the MySQL bootstrap sees it was read directly: all six demo rows carry their canonical
key, the canonical owner and status, `active = 1` and the seeded quantities 20, 100, 30, 16, 80 and 22.

The design expectation is therefore met at the snapshot level. What is unverified is the **live** MySQL
behaviour: that the copy lands, that the unique index holds, that the approval updates the seeded row in
place, that the transaction, audit, valuation and voucher are written, that a reopen is idempotent, and
that the cleanup is zero.

##### 4.2 The historical abnormal states

The legacy NULL position, the duplicate canonical position and the synthetic fallback position remain
registered risks. The read-only detection exists and is proven on SQLite; the automatic repair is
prohibited and the frozen Inventory Position migration is not modified. The remediation strategy for
existing abnormal data is a separate Requirement of its own and is out of this scope.

#### 5. The independent protected MySQL Inventory Gate

##### 5.1 The suite

`server/mysql-inventory-demo-seed-position.integration.js` is a new protected MySQL integration suite,
modelled on the closed Selector suite. Its role is to prove the canonical Demo Inventory position
identity on the live target. It is flat top-level TAP only, with exactly eight top-level cases
`M-INV-01` to `M-INV-08`, no `describe`, no `it`, no skip, no todo and no only, so that the protected
strict TAP parser accepts it.

It is **not** registered in FAST, FULL or HEAVY. It runs only through its own protected gate, exactly
like `server/mysql-sales-customer-wave11-a-credit-query-options.integration.js`, which is registered in no
suite. `scripts/testing/test-suites.js` is therefore **not** modified, and the suite governance
invariant that every on-disk `*.test.js` is classified into a suite is unaffected because the protected
MySQL integration suites are not on-disk-discovered.

##### 5.2 The gate entry

`scripts/gates/mysql-inventory-demo-seed-gate.mjs` is a new gate entry modelled on
`scripts/gates/mysql-sales-wave11-a-selector-gate.mjs`. It calls the existing
`runProtectedMySqlCampaign` with its own campaign label
`W11-A U3 INVENTORY DEMO SEED MYSQL E3 ACCEPTANCE` and its own suite label
`W11-A-U3-INVENTORY-DEMO-SEED`. It adds no reset, no identity check, no cleanup, no TAP parser, no MySQL
driver and no lease logic of its own. It never modifies the protected runner, the protected launcher,
the credential store or the identity baseline.

##### 5.3 The package script

`package.json` gains exactly one script, `test:mysql:inventory-demo-seed`, pointing at the new gate
entry. The existing `test:mysql:wave11-a:selector` keeps pointing at the closed Selector gate and no
existing script changes.

##### 5.4 The isolation boundary from the closed Selector E3 gate

- a distinct campaign label and a distinct suite label, so the two gates never share a campaign id or
  a lease;
- a distinct evidence directory, `U3_INVENTORY_EVIDENCE_DIR`, so the Selector evidence is never
  overwritten;
- the closed Selector suite `server/mysql-sales-customer-wave11-a-credit-query-options.integration.js`
  is not modified, so the S01 to S10 identities and their recorded results stay exactly as they are;
- the machine-wide gate lock serialises the new gate against every other gate on the same target, so the
  two campaigns can never run concurrently;
- the new gate performs its own reset and its own five-class cleanup through the protected runner, so
  the Selector gate's cleanup contract is unaffected.

##### 5.5 The execution method

```text
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/run-mysql-local-gate.ps1 -Script test:mysql:inventory-demo-seed
```

The launcher remains the only entry point. It proves the identity and the empty schema, takes the
machine-wide lock, binds the destructive authorization to the pinned target, runs the campaign, validates
the TAP transcript strictly, resets the schema again and releases the lease. The execution needs its own
explicit authorization and its own new evidence directory.

##### 5.6 The environment mechanics the implementation must honour

Two facts of the protected machinery decide how the suite must be written, and both are read from the
real code rather than assumed:

- the protected campaign runner sets `NODE_ENV = 'test'` and `ERP_SEED_DEMO = 'false'` in the child
  environment. `createTempDb({ production: true })` would additionally force
  `NODE_ENV = 'production'` and `ERP_SEED_DEMO = 'false'` while the database is created, which
  suppresses the Demo Seed. The inventory suite therefore calls `createTempDb` **without** the
  `production` option, so that `shouldSeedDemoData()` returns true and the Demo Seed actually runs on
  the live target. The `createTempDb` factory also performs the disposable-target authorization, so the
  suite inherits the protected guard.
- `approveInventoryCheck` is a private function of `server/app.js` and is not exported, and
  `server/app.js` is frozen. The approval therefore cannot be invoked as a module function and must be
  driven through the **real HTTP surface**: the suite starts the real application over the MySQL adapter
  on an ephemeral port, authenticates through the real login route and drives the real inventory-check
  state machine through the real create, submit and approve endpoints. The demo seed provides the two
  identities the contract needs, because the approval handler refuses a self-approval: the warehouse user
  creates and submits the check and the administrator approves it.

One further fixture fact is required and is stated here so that it is not a surprise in the
implementation: the demo product carries no standard manufacturing cost, so the valuation of an approved
adjustment would be the legacy unvalued movement with a zero amount, and `createSystemVoucher` skips an
entry set whose amounts are all zero, so no voucher would be written. To exercise the complete money
path that M-INV-06 requires, the suite applies exactly one explicit fixture fact before the approval,
the demo product's standard manufacturing cost, exactly as the local SQLite suite does. The fresh
position facts are asserted before that fact is applied, so M-INV-01 to M-INV-04 observe the untouched
fresh bootstrap.

##### 5.7 The eight cases

| Case | Fixture and assertion |
| --- | --- |
| M-INV-01 | the fresh target holds exactly six demo inventory rows, and each carries a 64-character lowercase hex canonical key |
| M-INV-02 | for every demo row, the key recomputed by `computePositionKey` from the row's own database dimension tuple is byte-identical to the persisted key, and the dimension tuple is exactly the canonical default tuple |
| M-INV-03 | no active row carries a NULL, an empty or a synthetic `<canonical>:fallback<rowid>` key |
| M-INV-04 | no logical inventory position, that is the canonical identity, holds more than one active row |
| M-INV-05 | the approved check moves the seeded canonical position from 20 to 22, the row identity is unchanged, the row count is unchanged, and the canonical position holds exactly one active row |
| M-INV-06 | one inventory transaction with the counted difference and the resulting balance, one audit record, one valuation movement with a real integer-cent amount, one system voucher with balanced entries whose amount agrees with the valuation amount, and the approved business status with its reviewer |
| M-INV-07 | a reopen and a repeated initialization preserve the quantity 22, the row count and the canonical identities, and add no row |
| M-INV-08 | the five object categories are zero after the campaign, reported by the campaign and confirmed by the launcher on a fresh session |

#### 6. The exact future implementation whitelist

Six paths, and no seventh:

| # | Path | Action | Purpose |
| --- | --- | --- | --- |
| 1 | `server/mysql-inventory-demo-seed-position.integration.js` | new | the protected MySQL inventory suite, eight flat top-level cases, not registered in any suite |
| 2 | `scripts/gates/mysql-inventory-demo-seed-gate.mjs` | new | the protected gate entry, its own campaign and suite identity |
| 3 | `package.json` | modify | exactly one new script `test:mysql:inventory-demo-seed` |
| 4 | `document.md` | append | the Requirement amendment of this stage |
| 5 | `solution.md` | append | this Design amendment |
| 6 | `log/2026-10-30.md` | append | the append-only stage record |

Explicitly **not** modified: `scripts/gates/mysql-wave10-runner-support.mjs`, the protected runner and
its frozen contract; `scripts/gates/run-mysql-local-gate.ps1`, the protected launcher;
`scripts/gates/mysql-sales-wave11-a-selector-gate.mjs`; the closed Selector suite
`server/mysql-sales-customer-wave11-a-credit-query-options.integration.js`;
`scripts/testing/test-suites.js`; `server/app.js`; every production module, migration and schema; and
every frozen Credit core and inventory primitive.

#### 7. The future acceptance matrix

| Item | Subject | Pass condition |
| --- | --- | --- |
| N1 | the suite contract | exactly eight flat top-level cases `M-INV-01` to `M-INV-08`, no nested plan, no skip, no todo, no only |
| N2 | the static contract | the suite imports no MySQL driver, adds no reset, no identity check, no cleanup and no TAP parser of its own |
| N3 | the gate entry contract | the gate entry calls only the existing `runProtectedMySqlCampaign`, with its own campaign and suite labels, and never references the Selector suite |
| N4 | the registry | `scripts/testing/test-suites.js` is unchanged and the new suite is registered in no suite |
| N5 | the protected execution | the launcher runs the gate once, the campaign reports the five-class zero inventory, the launcher confirms the cleanup, and the strict TAP transcript validates 8 of 8 |
| N6 | the isolation | the Selector evidence, the Selector suite file and the Selector gate entry are byte-identical before and after |
| N7 | the frozen SHA | every frozen identity in §8 is byte-identical after the implementation |
| N8 | the worktree | the changed-path set is exactly the six paths of §6 plus the paths already authorized, the index stays empty, the branch, the HEAD and the version are unchanged |

#### 8. The rollback

The implementation is confined to two new files and one package script, so the rollback is the removal of
those two files and the removal of that one script entry. No schema, no migration and no data change is
involved, and the disposable target is reset by the protected runner itself. Nothing in the rollback may
touch a real inventory row.

#### 9. The required user decisions

Two decisions are outside this stage and are recorded as open:

1. the explicit business risk acceptance for the Exact Identity Collation residual of §2 and §3, which
   the approved taxonomy classifies and disposes of but which the business owner must accept;
2. the authorization for the single protected execution of the independent Demo Inventory gate of §5,
   and the decision on whether the historical inventory remediation strategy gets its own Requirement.

#### 10. What did not happen and the pause point

- No production code, test, migration, launcher, package script or suite registry was modified in this
  stage. Only the two authorized documentation paths were appended.
- No real MySQL was contacted and no gate was executed.
- No Git write, no Acceptance and no Freeze.
- The completed FAST, FULL, build, browser and Selector MySQL evidence is preserved and unchanged.

HARD STOP after this Design. The next stage is the Implementation of the six registered paths, and
separately the authorized protected execution of the new gate.

**Stage status: `W11_A_U3_RESIDUAL_RISK_DESIGN_READY`.**

### 37.54.47 W11-A U3 Demo Seed Inventory MySQL Gate — Implementation Record and Protected Execution (2026-10-31)

#### 1. Authorization, inputs and boundary

This section records the Implementation of the six registered paths of §37.54.46.6 and the single authorized
protected execution of the independent Demo Inventory gate of §37.54.46.5.

The Requirement layer is `document.md` "W11-A U3 Demo Seed Inventory MySQL Gate — Implementation Result, Residual
Acceptance and Historical Disposition (2026-10-31)" under R-U3-INV-09 and R-U3-INV-10.

No Git write, no Acceptance and no Freeze were authorized, and none occurred. The completed FAST, FULL, build,
browser and Selector MySQL evidence is preserved and is not reclassified.

#### 2. The implementation

##### 2.1 The suite — `server/mysql-inventory-demo-seed-position.integration.js`

A new protected MySQL integration suite, flat top-level TAP only, with exactly eight top-level cases
`M-INV-01` to `M-INV-08`, no `describe`, no `it`, no `skip`, no `todo` and no `only`.

It runs against the real disposable MySQL 8 target through the existing `MySqlSyncAdapter`, the existing
protected campaign lease (`createWave10MysqlLifecycle`), the production database initialization path and the
real HTTP surface (`createApp` over an ephemeral loopback port, the real login route and the real inventory-check
state machine). It never falls back to SQLite: the fixture asserts `db.dialect === 'mysql'`.

The suite adds no MySQL driver, no reset, no identity check, no object inventory of its own and no TAP parser of
its own. The protected runner remains the single owner of target identity, reset, TAP validation and final
cleanup.

##### 2.2 The gate entry — `scripts/gates/mysql-inventory-demo-seed-gate.mjs`

It imports exactly one module, the shared `runProtectedMySqlCampaign`, and calls it with the independent
campaign label `W11-A U3 INVENTORY DEMO SEED MYSQL E3 ACCEPTANCE` and the independent suite label
`W11-A-U3-INVENTORY-DEMO-SEED`. It never references the closed Selector suite. The closed Selector suite
`server/mysql-sales-customer-wave11-a-credit-query-options.integration.js` and the closed Selector gate entry
`scripts/gates/mysql-sales-wave11-a-selector-gate.mjs` were not modified, so the S01 to S10 identities and their
recorded results stay exactly as they are, and the two campaigns never share a campaign id or a lease.

##### 2.3 The Demo Seed environment boundary

The protected campaign runner hands the suite child `NODE_ENV=test` and `ERP_SEED_DEMO=false`.
`shouldSeedDemoData()` treats only `NODE_ENV=production` as a suppression, so under that child environment the
decision is `true` and the Demo Seed really runs on the live target. The suite therefore calls `createTempDb`
**without** the `production` option; it never uses `createTempDb({production:true})` and never suppresses the
seed to obtain a pass on an empty schema.

This was proven twice before the campaign:

1. statically, `shouldSeedDemoData()` evaluated under `NODE_ENV=test` and `ERP_SEED_DEMO=false` returns `true`;
2. dynamically, `captureSqliteSnapshot(createSqliteSnapshot, true)` — the exact snapshot construction the MySQL
   bootstrap consumes — produces exactly six inventory rows, and every one of them carries the canonical
   `position_key` computed by `computePositionKey` from its own stored dimensions.

The suite additionally captures that same snapshot inside its own `before` hook and compares it with the live
MySQL rows, so the "complete row copy" obligation is asserted against the real bootstrap source rather than
against a re-implementation of it.

##### 2.4 The eight cases

| Case | Implementation |
| --- | --- |
| M-INV-01 | the fresh MySQL bootstrap holds exactly six demo inventory rows with the canonical row identities, the canonical quantities and a 64-character lowercase hex key, and the live rows are deep-equal to the SQLite snapshot rows |
| M-INV-02 | for every row, `computePositionKey` recomputed from the row's own stored dimensions is byte-identical to the stored key, the stored tuple is exactly the canonical default tuple, and the physical column is a character column that holds 64 characters |
| M-INV-03 | no active row carries a NULL, an empty or a synthetic `<canonical>:fallback<rowid>` key; the unique index is recorded as supporting evidence only, the data is the contract |
| M-INV-04 | no canonical identity holds two active rows, and the source identity, product, warehouse, quantity and business position of the approved position are recorded |
| M-INV-05 | the real HTTP approval: a create without the permission is refused with 403, the creator cannot approve its own submitted check and is refused with 409 `盘点单创建人不能审批自己的单据`, the warehouse actor creates and submits, the administrator approves, and the seeded canonical row is updated in place from 20 to 22 with the row count unchanged and exactly one active row for the logical position |
| M-INV-06 | exactly one inventory transaction, one audit record, one valuation movement with a real integer-cent amount, one balanced system voucher whose amount agrees with the valuation, and zero duplicate side effects; the amounts are derived from the counted difference and the frozen standard cost read back from the business rows, never from a hardcoded expectation |
| M-INV-07 | the original connection is released and a new one is opened against the same schema through `createDatabase({backend:'mysql'})`, the production initialization path; the quantity stays 22, the row count stays 6, the canonical identities are stable, no row is added and no second inventory transaction, valuation movement or voucher appears. The database is never destroyed and rebuilt, so a destroy-and-recreate can never masquerade as a reopen |
| M-INV-08 | the HTTP server and the MySQL adapter are released, the evidence file is written with a recorded SHA-256 that is verified against its own content, all eight case records are present and no session token or credential is in the evidence. The five-class zero is **not** claimed by the suite: the acceptance data is still present when the suite ends, so the outer cleanup has real work to do |

##### 2.5 The one explicit fixture fact

The demo product carries no standard manufacturing cost, so an approved adjustment would be the legacy unvalued
movement with a zero amount and `createSystemVoucher` would skip an empty entry set. The suite therefore applies
exactly one fixture fact, the demo product's standard manufacturing cost of 259900 cents, and it applies it only
after M-INV-01 to M-INV-04 have observed the untouched fresh bootstrap, exactly as the local SQLite suite does.
The valuation amount is then derived from the counted difference and the cost read back from the product row.

#### 3. The local validation

| Gate | Result |
| --- | --- |
| A `node --check` on both new files | exit 0 |
| B `package.json` JSON parse | version `1.6.2`, the new script present |
| C the exact package.json diff | exactly one added script line, nothing else |
| D the static suite contract | exactly eight flat top-level cases `M-INV-01` to `M-INV-08`, no nested plan, no `describe`, no `it`, no `skip`, no `todo`, no `only`, no MySQL driver, no reset, no identity check, no object inventory, no TAP parser of its own |
| E the gate entry contract | one import, only `runProtectedMySqlCampaign`, independent campaign and suite labels, never the Selector suite |
| F the environment and lease contract | `shouldSeedDemoData()` is `true` under the runner child environment; the snapshot carries six canonical rows; the lifecycle decodes and re-verifies the runner-issued lease; the disposable target acknowledgement is exact |
| G `pnpm test:fast` | 500 of 500 |
| H `pnpm test` | 3102 of 3102 |
| I `pnpm build` | built |
| J `git diff --check` | clean |
| K the frozen SHA set | 15 of 16 byte-identical, the single exception being the approved `package.json` amendment |
| L the changed-path whitelist | exactly the twenty paths: the seventeen pre-authorized ones plus the three of this stage; the index is empty and the branch, HEAD and version are unchanged |

Before the campaign the suite was additionally dry-run against a disposable SQLite database through a generated
probe outside the tracked tree, to prove the real HTTP flow, the real SQL assertions, the exact guard message, the
valuation and voucher assertions, the reopen semantics and the strict TAP shape before the single authorized
MySQL execution was spent. The probe was removed afterwards.

#### 4. The protected execution

The execution entry point was the protected launcher, exactly as designed:

```text
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gates/run-mysql-local-gate.ps1 -Script test:mysql:inventory-demo-seed
```

The gate ran exactly once. No failure was repaired and no rerun was attempted.

The launcher proved the target from the pinned local identity baseline and the DPAPI-encrypted credential before
the campaign started:

- MySQL `8.0.37`, matching the MySQL 8 version policy;
- server UUID `256c7a4e-d275-11f1-885b-b025aa71d167`, exactly the pinned value;
- current user `modern_erp_test@127.0.0.1`, exactly the pinned value;
- grants fingerprint `bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e`, exactly the pinned value;
- database identity `modern_erp_domain_test` on `127.0.0.1:3306`, exactly the pinned value;
- initial object inventory tables 0, views 0, triggers 0, routines 0, events 0, matching `EMPTY_ONLY`;
- the machine-wide lock `ModernERP.MySqlGate.modern_erp_domain_test` acquired.

The campaign reported `W11-A-U3-INVENTORY-DEMO-SEED = PASS (8/8; skipped=0; cancelled=0; todo=0)`.

#### 5. The five-class cleanup

The cleanup is confirmed three times, independently:

1. the protected runner, after its own final reset, reported
   `FINAL ZERO OBJECTS = {"tables":0,"views":0,"triggers":0,"routines":0,"events":0}`;
2. the protected launcher, on a fresh session with the destructive authorization variables removed, reported
   `CLEANUP = CONFIRMED (tables=0 views=0 triggers=0 routines=0 events=0)`;
3. a separate read-only preflight on a fresh session, with the destructive variables explicitly absent, returned
   `"ok":true` with the same five zero counts and an empty drift list.

The suite itself never claimed the five-class zero. It recorded the object inventory before the outer cleanup
(tables 325, views 1, triggers 5, routines 0, events 0) so that the outer cleanup is a real operation.

#### 6. The `package.json` bounded forward exception

The frozen file `package.json` carried the SHA-256
`43d6ec696d2a54896c6968bc163710341a8a85431bad9efa29cdd44169047dee` before this stage and carries
`5ac498f0ef715007a14bb0c0c20d0bf479b94b4f46194edd8b9807136e18a8b1` after it. The exact JSON diff is one added
script entry:

```diff
     "test:mysql:wave11-a:selector": "node scripts/gates/mysql-sales-wave11-a-selector-gate.mjs",
+    "test:mysql:inventory-demo-seed": "node scripts/gates/mysql-inventory-demo-seed-gate.mjs",
```

The version stays `1.6.2`. No other script, dependency, engine or package metadata changed. The reason for the
amendment is the one new protected gate entry, which needs one package command. This exception does not extend
to any other frozen file, and the claim that the `package.json` file SHA is unchanged is withdrawn for this
stage.

#### 7. The frozen identities

Every frozen identity of §37.54.46.10 is byte-identical after the implementation: `server/modules/credit-check.js`,
`server/modules/credit-query.js`, `server/modules/credit-scope.js`,
`server/modules/credit-special-approval.js`, `server/lib/inventory-position.js`, `server/lib/stock.js`,
`server/migrations/inventory-position-schema.js`, `server/lib/search-fold.js`,
`server/migrations/sales-customer-wave11-a-selector-search-key.js`,
`server/modules/credit-query-options.js`, `server/app.js`,
`server/test-utils/wave11-a-selector-gate-fixture.js`,
`server/test-utils/wave11-a-credit-query-fixture.js`, `server/test-utils/wave11-sec-scope-fixture.js`,
`scripts/gates/mysql-sales-wave11-a-selector-gate.mjs` and `scripts/gates/run-mysql-local-gate.ps1`. The single
exception is the explicitly approved `package.json` amendment of §6.

The closed Selector suite keeps its identity
`39a34ee86ee3c6ed2981fef5243a53a38aa5dd2b402b83e9058dc6df70c72e3d`, and `scripts/testing/test-suites.js` is
unchanged: the new suite is `*.integration.js`, it is registered in no suite, and the on-disk `*.test.js`
classification invariant is unaffected.

#### 8. What did not happen and the pause point

- No production code, schema, migration, launcher, runner, campaign machinery, credential store or identity
  baseline was modified.
- No production identity comparison code was modified to record the residual acceptance.
- No historical inventory repair SQL, migration, compensating movement or accounting adjustment was added.
- The gate was executed exactly once and was not re-run.
- No Git add, commit, push, tag, merge, release or deploy; the index stays empty, the branch and HEAD are
  unchanged and the version stays `1.6.2`.
- No Acceptance and no Freeze.

HARD STOP. The next stage is the Final Acceptance of the W11-A U3 package, which needs its own explicit
authorization.

**Stage status: `W11_A_U3_RESIDUAL_RISK_MYSQL_INVENTORY_GATE_PASS_PENDING_FINAL_ACCEPTANCE`.**

### 37.54.48 W11-A U3 Acceptance Record, Project-Wide Audit Errata and Current Technical Design Status Index (2026-10-31)

#### 1. Authorization, inputs and boundary

This section is the Design-layer counterpart of `document.md §35` "当前项目状态快照（2026-10-31）".
It records three things:

1. the **Acceptance and Freeze** of the W11-A U3 unit, which the design layer did not previously carry;
2. the **errata** that correct the 2026-10-31 project-wide audit
   《ERP Project-Wide Progress Baseline & Next Milestone Audit》;
3. a **current technical design status index**, so that "which design is authoritative today" is
   answerable without re-reading the whole 40,000-line tail.

No production code, test, schema, migration, launcher, runner, suite registry or package script was
modified. No MySQL was contacted and no gate was executed. No Git write, no Acceptance and no Freeze
occurred in this stage. The only changed paths are `README.md`, `document.md`, `solution.md` and
`log/2026-10-31.md`.

#### 2. The W11-A U3 Acceptance and Freeze record (design layer)

The design-layer record of the state that `document.md` "W11-A U3 Freeze Registration (2026-10-31)"
already carries as the Requirement-layer record:

| Item | Value |
| --- | --- |
| Acceptance | `W11_A_U3_ACCEPTANCE_PASS` — granted by the business owner on 2026-10-31 |
| Freeze | `FROZEN` |
| Frozen Implementation Commit | `ec618eb81684d645707c70a8b69ff9379682fbaa` |
| Frozen Tree SHA | `908c10310cd92a509374ada2bd31b5882be580f2` |
| Parent | `60f3fbd169d7b43bbae3824b10b538edef4aeec1` |
| Closure HEAD (freeze journal) | `ebe3363fe88d64222a6aa619a932bfe9a4fa3578` |
| Version | `1.6.2`, unchanged |
| Frozen scope | W11-A U3 Credit Query Selector / Search Semantics and its directly related approved regression fixes only |

The preceding section `§37.54.47` ends on the **pre-acceptance** token
`W11_A_U3_RESIDUAL_RISK_MYSQL_INVENTORY_GATE_PASS_PENDING_FINAL_ACCEPTANCE`. That token remains the
accurate statement **for the state at the end of §37.54.47** and is not rewritten; this section
supersedes it as the current design status, exactly as `document.md:15338` supersedes it on the
Requirement layer. The Acceptance evidence itself is recorded in `log/2026-10-31.md` and is not
duplicated here.

#### 3. The audit errata

The project-wide audit of 2026-10-31 is superseded on the following five points. Each erratum names
the design authority that settles it.

##### 3.1 E-1 / E-2 — the W11 dependency DAG

**Erratum.** The audit concluded that the W11-A package-level Acceptance had to wait for W11-B / W11-C /
W11-D, and that W11-D had to wait for W11-B / W11-C. **Both conclusions are withdrawn.**

**Authority.** `solution.md §37.54.15.1` "依赖 DAG", including **CORRECTION-5 (2026-10-27)**, which
itself revoked an earlier unsourced `W11-A → W11-D` edge:

```text
硬依赖（成立，且有 Requirement / Stage B 依据）
  W11-A  -> W11-SEC   （Stage B §11："W11-SEC 必须先于开放新的历史查询入口完成"）
  W11-C  -> W11-B    （SC106 的评分表与 SC107 的评估结果对象由 W11-B 提供）
  W11-D  -> W11-SEC  （W11-D 的对外读取必须满足 W11-SEC 的 Scope 合同）

非依赖（明确不构成阻塞）
  W11-B  !-> W11-A
  W11-D  !-> W11-A   （撤销）
  W11-A  !-> W11-B / W11-C
  W11-D  !-> W11-B / W11-C
```

`W11-D ↔ W11-A` is **optional reuse only**: W11-D *may* reuse the W11-A read constructors when W11-A
has landed, but its implementation is **not blocked** by that and **must not** gain a hard dependency
because of it. Both packages resolve the **same** authorization decision through
`credit-scope.js` `resolveCreditReadMode`, so two conflicting Scope semantics cannot arise.

**Consequence.** `solution.md §37.54.15.3` defines the W11-A package contract and names exactly one
dependency — "**W11-SEC 必须先通过**". W11-SEC-01 was accepted and frozen on 2026-10-28
(`document.md:12228`), and every unit inside the W11-A contract (U1, U2, OVERDUE, U3) is accepted and
frozen with a Git anchor. The W11-A package therefore **satisfies its own contract's package-level
Acceptance condition**.

**This section does not issue `W11_A_ACCEPTANCE_PASS`.** The token remains reserved for the complete
W11-A package (`document.md:12401, 12506, 13216, 13380, 13394`; `solution.md:32565, 32844, 35103`),
and issuing it is the business owner's decision. Two record facts remain to be closed before a
package-level freeze can cite a complete anchor set:

1. the W11-A OVERDUE Foundation freeze record carries **no Git SHA** of its own — its accepted
   worktree was deliberately left unstaged and uncommitted (`document.md:13708-13710`);
2. every W11-A unit freeze record explicitly lists "W11-A Package" among its exclusions, so a
   package freeze needs an **independent** whole-package Acceptance decision and cannot be an
   automatic roll-up of the unit freezes.

##### 3.2 E-3 — freeze terminology

**Erratum.** The audit treated the absence of a particular machine token as evidence that a historical
acceptance was invalid. **That inference is withdrawn.** A missing token of one kind is not evidence
that a different kind of acceptance did not happen, and the absence of a recorded user approval must
**never** be repaired by fabricating one.

**Authority.** `AGENTS.md §4.5` and the seven-level vocabulary that the repository itself uses:

| Level | Meaning | Repository example |
| --- | --- | --- |
| Requirement Complete | the Requirement-stage artifact is finished | `document.md:1487`, `:1723`, `:1858`, `:2252`, `:2855`, `:4269` |
| Implementation Complete | the implementation exists | domain implementation records |
| Stage Acceptance | a bounded stage passed | `WAVE6_FINAL_ACCEPTANCE_PASS` |
| Capability Freeze | a bounded capability is frozen | `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED` |
| Domain-Level Acceptance | the whole domain was accepted by the user | `log/2026-10-08.md:288` (Planning) |
| Manual Capability Closure | a manual's capability set is closed | §31 / §32 / §33 / §34 matrices |
| Release Readiness | the product may be released | **none of the nine domains holds it** |

The five domain closures use prose status strings rather than machine tokens, and the 2026-10-14
evidence audit explicitly declined to fabricate the missing original approvals
(`docs/operations/global-implementation-status-audit-2026-10-14.md:103`). That position is preserved
here unchanged.

##### 3.3 E-4 — the Planned Order → Production Order trace

**Erratum.** The audit classified this chain link as **BROKEN** because `production_orders` has no
`planned_order_id` column. **That classification is withdrawn.** An indirect relation that is
complete and FK-backed is not a broken link.

**Authority.** The trace is a complete two-hop chain:

```text
planned_orders.id
  -> production_instruction_items.planned_order_id   (FK to planned_orders(id))
  -> production_instruction_items.id
  -> production_orders.production_instruction_item_id (indexed FK to the instruction item)
```

Evidence: the column is added in `server/migrations/planning-domain-schema.js:287` and written in
`server/modules/planning-domain.js:491, 494`; `production_orders` carries
`production_instruction_id` and `production_instruction_item_id`
(`server/migrations/manufacturing-quality-schema.js:52`;
`server/migrations/v13-phase4-production-integrity.js:10` with the index at `:27`), written from the
instruction item in `server/modules/manufacturing-orders.js:148` and driven from
`server/modules/planning-documents.js:365`; and the **reverse** direction is already used by
production code to compute the converted quantity
(`server/modules/planning-documents.js:231, 348`).

**Residual characteristic (not a defect).** The `production_instructions` **header** does not carry
`planned_order_id`; the instruction **item** does. A trace from a planned order to its production
orders therefore resolves through the item. This is a header-level convenience difference, and it is
recorded here as a design characteristic rather than a broken link.

##### 3.4 E-5 — the Procurement / Outsourcing defects that are retained

The audit's source-supported findings are **retained** and are registered as defects or risks to be
governed. **No production behaviour is changed by this stage.** The full table, with evidence, is
`document.md §35.8` under G-1 … G-5.

The most consequential is **G-1**: `outsourcing_receipt_items` has **no production writer** —
`createOutsourcingReceipt` (`server/modules/outsourcing.js:344-359`) inserts the header row only and
accepts no items — while `loadQualitySource` (`server/modules/quality-gates.js:162-163`) and
`createProcessingFeeBill` (`server/modules/outsourcing-finance.js:166, 178-179`) both require the
item rows. The outsourcing IQC, processing-fee AP and FINAL-basis variance steps are therefore not
reachable through the API. The previously recorded OUT-21 acceptance evidence was taken against a
state that only test fixtures can create.

**G-5 is a business decision, not a defect to be silently fixed**: the UAT-14 harness expectation and
the current V21 owner-dimension contract contradict each other, and which side is authoritative is the
business owner's call.

#### 4. The current technical design status index

| Design subject | Authoritative design | Implementation state | Design gap |
| --- | --- | --- | --- |
| Core scope / domain alignment | `solution.md` §26–§27 | Complete | — |
| Master & Engineering | §28 | Complete | retained Multi-Org / Mold / APS gaps |
| Manufacturing & Quality | §29 | Complete | Dispatch / Operation Transfer / NC disposition |
| Planning | §30 | Complete | Multi-Org, full outsourcing execution |
| Procurement & Outsourcing | §31 | Complete | Acceptance `NOT READY`; G-1..G-5 |
| Inventory & Warehouse | §32 | Partial Complete | barcode generate, PDA execution, stocktake scan, assembly; bin/status/owner/stocktake CRUD not routed |
| Finance Operations | §33 | Complete | FO13 reversal half; GRNI reversal by design |
| Sales & Customer | §34 | Complete (Wave 0–10 + W11) | Waves 1–2 unaccepted; whole domain not frozen |
| Accounting & Analytics | **none** | Partial | Smart Accounting rule platform, Cash Flow, Report Designer, Management Accounting |
| Platform | **none** | Partial | no generic workflow execution engine |
| W11-A U3 | §37.54.36 – §37.54.48 | Complete, frozen | package-level token reserved |

**Two structural defects of the design document itself**, recorded here rather than silently repaired:

1. `solution.md:1166` carries a second `## 21. 当前设计状态` heading that collides with
   `## 21. Core Scope Cleanup Implementation Design` at `:1178`, and the 2026-10-06 content at `:1166`
   states "Domain Alignment 尚未实施", which is factually wrong. **Renumbering it would edit a frozen
   historical section**, so it is listed as a required user decision instead.
2. The four inventory dimension master-data modules — `server/modules/warehouse-bin.js`,
   `server/modules/stock-status.js`, `server/modules/owner-dimension.js` and
   `server/modules/inventory-stocktake.js` — are **not imported by `server/app.js`**, so their CRUD
   surfaces are unreachable over HTTP even though their data model is canonical and used by
   `server/lib/inventory-position.js` and `server/modules/consignment.js`. This is recorded as a design
   coverage observation; registering routes would be a Design change and is not made here.

#### 5. The documentation change set

| Path | Action |
| --- | --- |
| `README.md` | new "当前项目状态快照（2026-10-31）" entry point; the stale "Wave 10 未验收 / Wave 11 未开始" statements restated with their historical framing preserved; the gap lists corrected against the current source; the release-blocker table added; three missing package scripts and two missing `docs/` directories added |
| `document.md` | new `§35 当前项目状态快照（2026-10-31）` inserted at the end of the numbered block, before the dated history tail; §22 and every dated section left byte-unchanged |
| `solution.md` | this section, appended |
| `log/2026-10-31.md` | the append-only stage record |

No historical Requirement, Design, Acceptance, Freeze, audit or log record was deleted, rewritten,
re-dated or fabricated. Where a historical statement is superseded, it is marked as superseded by a
**dated** pointer; the original wording and its historical meaning are preserved.

#### 6. What did not happen and the pause point

- No production code, test, schema, migration, launcher, runner, suite registry or package script was
  modified. The four changed paths are documentation only.
- No MySQL, no FAST, no FULL, no HEAVY, no build and no browser execution.
- No Git add, commit, push, merge, rebase, tag, release or deploy. The index stays empty.
- No Acceptance and no Freeze. `W11_A_ACCEPTANCE_PASS` is **not** issued.
- No business contract was changed. G-1 … G-5 are registered, not fixed.

HARD STOP. The next stage requires its own explicit authorization and is not started by this section.

**Stage status: `ERP_PROJECT_BASELINE_RECONCILED_PENDING_ACCEPTANCE`.**

---

### 37.54.49 M0 Project Baseline Acceptance Record and Design Status Index Update (2026-10-31)

#### 1. Authorization, inputs and boundary

The business owner formally confirmed `M0_BASELINE_ACCEPTANCE_PASS` on 2026-10-31 for the
**M0 Project Baseline Reconciliation & Audit Errata** stage recorded in `§37.54.48`.

This section is the **design-layer counterpart** of the Requirement-layer registration in
`document.md §35.11`. It records the acceptance on the design layer and updates the
**current technical design status index** that `§37.54.48 §4` opened.

The authorization covers the **documentation-level acceptance registration only**:

- `document.md` — `§35.11` acceptance registration plus the internal-consistency amendments to
  `§35.1`, `§35.5`, `§35.7` and `§35.10`;
- `README.md` — the M0 status entry point and the correction of the stale VMI owner-dimension
  statement;
- `solution.md` — this section;
- `log/2026-10-31.md` — the append-only record of this stage.

Not authorized and not performed: no production code, test, schema, migration, launcher, runner,
suite registry or package script change; no MySQL and no test gate; no Git commit, push, merge,
rebase, tag, release or deploy; no Domain-Level Acceptance; no Freeze.

#### 2. The acceptance record (design layer)

| Item | Value |
| --- | --- |
| Acceptance | `M0_BASELINE_ACCEPTANCE_PASS` — granted by the business owner on 2026-10-31 |
| Accepted object | the M0 Project Baseline Reconciliation & Audit Errata stage (`§37.54.48`) |
| Acceptance anchor commit | `3e70c380eec7d34dd938a29d23dbf07227656ef1` |
| Anchor subject | `docs(erp): 收口M0全局项目基线审计勘误与状态快照` |
| Anchor changed paths | `README.md`, `document.md`, `solution.md`, `log/2026-10-31.md` — 4 paths, documentation only |
| Version | `1.6.2`, unchanged |
| Release tags | `v1.6.0`, `v1.6.1`, `v1.6.2`, unchanged |
| Accepted scope | the documentation baseline reconciliation and the audit errata of E-1 … E-5 only |

#### 3. The stage status transition, by dated supersession

```text
Before : ERP_PROJECT_BASELINE_RECONCILED_PENDING_ACCEPTANCE
         (§37.54.48 结尾，以及 log/2026-10-31.md 的 M0 阶段记录)
After  : M0_BASELINE_ACCEPTANCE_PASS
         (业务所有者 2026-10-31 的显式决定)
```

The `§37.54.48` stage-status token is **not deleted, not rewritten and not re-dated**. It remains
the accurate statement of the state at the end of the M0 stage, exactly as `§37.54.48 §2` did
for the `§37.54.47` token. This section supersedes it as the **current** design status only.
The historical Requirement, Design, Acceptance and Freeze records are untouched.

#### 4. The updated current technical design status index

This table supersedes `§37.54.48 §4` as the current index. The `§37.54.48 §4` table is preserved
unchanged as the historical index of the M0 stage.

| Design subject | Authoritative design | Implementation state | Design gap |
| --- | --- | --- | --- |
| Core scope / domain alignment | `solution.md` §26–§27 | Complete | — |
| Master & Engineering | §28 | Complete | retained Multi-Org / Mold / APS gaps |
| Manufacturing & Quality | §29 | Complete | Dispatch / Operation Transfer / NC disposition |
| Planning | §30 | Complete | Multi-Org, full outsourcing execution |
| Procurement & Outsourcing | §31 | Complete | Acceptance `NOT READY`; G-1..G-5 |
| Inventory & Warehouse | §32 | Partial Complete | barcode generate, PDA execution, stocktake scan, assembly; bin/status/owner/stocktake CRUD not routed |
| Finance Operations | §33 | Complete | FO13 reversal half; GRNI reversal by design |
| Sales & Customer | §34 | Complete (Wave 0–10 + W11) | Waves 1–2 unaccepted; whole domain not frozen |
| Accounting & Analytics | **none** | Partial | Smart Accounting rule platform, Cash Flow, Report Designer, Management Accounting |
| Platform | **none** | Partial | no generic workflow execution engine |
| W11-A U3 | §37.54.36 – §37.54.48 | Complete, frozen | package-level token reserved |
| **M0 project baseline reconciliation** | §37.54.48 | **Complete, accepted 2026-10-31** (`M0_BASELINE_ACCEPTANCE_PASS`, anchor `3e70c380eec7d34dd938a29d23dbf07227656ef1`) | none of its own; it closes **no** business gap |

#### 5. The stale VMI owner-dimension statement, corrected against the source

The README carried a statement that the VMI owner-dimension physical actions were "明确 fail closed".
That statement was **stale** and has been corrected. The source evidence:

- `server/modules/procurement-vmi.js:14-20` — under V21 the legacy fail-closed helper
  `assertInventoryOwnerDimension` was **removed** and is now a **no-op**, with the comment
  "Owner dimension is now available through Inventory domain";
- `server/modules/procurement-vmi.js:96,116,191-219` — the VMI receipt, the consumption and the
  ownership transfer all route through `applyInventoryMutation`, the ownership transfer using
  `movementKind: 'OWNER_CHANGE'`;
- `server/lib/inventory-mutation.js:43,248,311` — `OWNER_CHANGE` is a first-class paired movement
  kind in the canonical inventory mutation dispatcher, and the owner identity is validated through
  `validateOwner`;
- `server/procurement-vmi.test.js:5,37-40` — the focused suite asserts the **positive** canonical
  path ("VMI business layer with owner-dimension canonical path"): the receipt creates a
  SUPPLIER-owned position distinct from ENTERPRISE stock, the consumption reduces supplier stock,
  and the ownership transfer moves quantity from SUPPLIER to ENTERPRISE.

What genuinely remains open is **not** a production fail-closed behaviour. It is the **legacy
acceptance oracle** in `scripts/acceptance/procurement-outsourcing-functional-uat.mjs:235-240`
(UAT-14), which still hard-codes the 409 `INVENTORY_OWNER_DIMENSION_UNAVAILABLE` expectation.
That is exactly the registered **G-5** of `document.md §35.8`: whether the **test** is corrected or
the **contract** is corrected is a business decision and was **not** decided here.

This correction changed **no** production behaviour, **no** API, **no** schema and **no** test. It
corrects a documentation statement that no longer described the source, and it therefore does
**not** constitute a Procurement & Outsourcing Domain-Level Acceptance, which remains `NOT READY`
(`document.md §31.11`).

#### 6. What this acceptance does not close

- **W11-A package-level Acceptance** — still an independent business decision;
  `W11_A_ACCEPTANCE_PASS` remains **not issued**. `§37.54.48 §3.1` is unchanged in that respect.
- **G-1 … G-5** — registered, **not fixed**.
- **D-2 / D-3 / D-4 / D-5** — open design decisions, still blocking W11-B and W11-C.
- **The historical inventory integrity** — `R-U3-INV-10 = DEFERRED_OUT_OF_SCOPE`, governed by its own
  independent Requirement, **not closed**.
- **The existing Release Blockers** — every entry of `document.md §35.9` keeps its state;
  `CREDENTIAL_EXPOSURE_OPEN` stays `USER_ACCEPTED / DEFERRED`, which is **not** risk elimination.
- **Procurement & Outsourcing Domain-Level Acceptance** — still `NOT READY`.
- **Release Readiness** — no Domain holds it; production release remains unauthorized.

#### 7. What did not happen and the pause point

- No production code, test, schema, migration, launcher, runner, suite registry or package script
  was modified. The changed paths are documentation only.
- No MySQL, no FAST, no FULL, no HEAVY, no build and no browser execution.
- No Git add, commit, push, merge, rebase, tag, release or deploy. The index stays empty.
- No Domain-Level Acceptance and no Freeze. `W11_A_ACCEPTANCE_PASS` is **not** issued.
- No business contract was changed. G-1 … G-5 and D-2 … D-5 are registered, not fixed.

HARD STOP. The M0 acceptance registration is a documentation-only change whose own commit and
dual-remote push require a separate explicit authorization.

**Stage status: `M0_BASELINE_ACCEPTANCE_REGISTERED — AWAITING_GIT_COMMIT_AUTHORIZATION`.**
