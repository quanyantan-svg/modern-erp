# 开放业务政策与设计决策登记

> 状态：`ACTIVE`
> Owner：业务所有者（业务政策裁定）/ 各 Domain Owner（设计决策）
> 权威来源：**规范正文在对应的 Requirement / Design 中**；本表是决策状态索引，不复制规范正文。
> 当前项目状态：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)

## 1. Procurement & Outsourcing —— M1 集中业务决策登记

规范来源：[`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.12.8
「集中业务决策登记（不重复要求确认已获批规则）」。

> 该 Requirement 明确列出**不再重新征询**的已获批事实：`STANDARD_PURCHASE` / `OUTSOURCE_PROCESSING` 区分、
> 是否支持多 PO 收料、委外材料企业所有权、WIP 是地点而非物权、GL Owner 属 Accounting、
> 采用 Canonical Supplier Bill 等。本表不重复这些条目。

| ID | 归属 | 待定内容（摘要） | 当前约束 | 停止点 | 状态 |
|---|---|---|---|---|---|
| A-P01 | A | 完成通知表 `§26.12` 独立表 vs `§26.20` 复用表，及历史行级来源迁移 | 单一可追溯的通知→收货来源；不得预先强制重复建表 | Procurement Design 前需提供兼容论证 | `PENDING` |
| A-P02 | A | 完成通知部分转换、拒收/退回重开、剩余量与批号继承边界的 Canonical 细节 | 不改变已获批 multi-PO 与质量门禁；保持行级容量守恒 | 具体规则不可证实时暂停该子项 | `PENDING` |
| B-P01 | B | 跨订单/跨期 Supplier WIP 价值携带（源账面价值、价格差异、转移时点、期间锁） | 数量+成本必须守恒；不创造余额或历史凭证；暂不指定计价方法 | 成本变动前需业务裁定 | `PENDING` |
| B-P02 | B | 倒冲差异生成单据后的审核人、退补单撤销/冲销状态 | 手册方向与审核要求已明确；只待权限/状态细节 | Outsourcing + RBAC Owner，Design 需补充 | `PENDING` |
| C-P01 | C | 委外加工费在收货、暂估、正式过账各时点的金额确认；是否产生及何时冲回 GRNI | 不直接照搬普通采购账务分录 | Finance + Accounting Owner，GL Implementation HARD STOP | `PENDING` |
| C-P02 | C | 加工费会计科目/资本化、价差与税务（进项税适用性） | 不预设 `NO_TAX` 永久正确；不允许伪造凭证模板 | Finance + Accounting Owner，GL Implementation HARD STOP | `PENDING` |
| C-P03 | C | 过账后红冲/贷项与历史无原始凭证数据的处理 | 禁止自动补记不明来源的历史总账 | Finance + Accounting Owner，历史处理 HARD STOP | `PENDING` |
| C-P04 | C | Accounting Domain 未 Domain Closure 时，委外 Source→Canonical Voucher 的有界接入边界 | GL Owner 固定为 Accounting；不创建委外专用第二 GL | 跨域需求批准后设计 | `PENDING` |
| D-P01 | D | VMI 结算窗口（周期/自定义）、消耗与物权转移的前后顺序、可结算数量口径 | 企业仓供应商所有权 + 数量守恒已批准；触发策略未批准 | Procurement/VMI + Finance Owner，结算 Implementation HARD STOP | `PENDING` |
| D-P02 | D | VMI 物权释放数量的协议价格、税与账单日期以及部分结算规则 | 必须产生 Canonical Supplier Bill，不得仅保存客户端传入 ID | Procurement/VMI + Finance Owner，账单 Implementation HARD STOP | `PENDING` |

**影响**：C 组与 D 组政策未裁定时，委外与 VMI 的 GL / 结算实现必须 fail closed；
不得以"先实现再补政策"的方式推进。

## 2. Sales & Customer —— 开放设计决策

规范来源：[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §35.9（Release Blockers 表）。

| ID | 待定内容 | 阻塞范围 | 状态 |
|---|---|---|---|
| D-2 | 信用评估基础（W11-B）的设计决策 | W11-B | `PENDING` |
| D-3 | 多评分 / 评级应用（W11-C）的设计决策 | W11-C | `PENDING` |
| D-4 | 信用对账与重算（W11-D）的设计决策 | W11-D | `PENDING` |
| D-5 | 信用对账与重算（W11-D）的设计决策 | W11-D | `PENDING` |

## 3. 待业务所有者追认 / 待独立决定

| ID | 事项 | 状态 | 说明 |
|---|---|---|---|
| `W11_A_ACCEPTANCE_PASS` | W11-A 整包 Acceptance | 未签发 | 标识保留给完整 W11-A 包；签发是业务所有者的**独立**决定，不是既有单元冻结的自动汇总。另有两项需先处理：W11-A OVERDUE 冻结记录未记载 Git SHA；所有单元冻结记录都把 "W11-A Package" 列入排除项。见 `PROJECT_STATUS.md` §35.6 / §35.11.4。 |
| G-5 | UAT-14 旧 Test Oracle 与当前 V21 Contract 冲突 | `PENDING` | **修 test 还是修 contract 属业务决定**，不得由文档或实现自行决定。见 `PROJECT_STATUS.md` §35.8。 |

## 4. 不在本表范围

- 已获批业务政策不重复登记（见 §31.12.8 的「不再重新征询」清单）；
- 已冻结能力的历史裁定保留在 [`docs/acceptance/`](../acceptance/)；
- Domain 级进度不在本表，见 `PROJECT_STATUS.md` §35.3。
