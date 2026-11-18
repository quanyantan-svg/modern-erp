# Inventory & Warehouse — Requirement

> 状态：`ACTIVE`
> Owner：Inventory & Warehouse
> 权威来源：`document.md` §32
> 来源：`document.md` §32（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）
>
> **2026-11-14 有界解冻授权**：业务所有者授权解冻 INV-32 及受统一期间守卫影响的合同并进入
> Requirement。§32.12 已由业务所有者于 2026-11-14 批准为 `APPROVED`；Design 已授权，
> Implementation 未授权；既有域级 Acceptance / Freeze 继续作为历史时点记录保留。

## 32. Inventory & Warehouse Domain Closure Requirement

> 本节固化 Inventory & Warehouse Domain Closure 的 Requirement 阶段成果。
>
> **Manual Evidence Baseline：**
> Primary = `B3104 库存管理`；Secondary = `B3105 条码管理`（仅取 Inventory/Warehouse 所属能力）。
> Boundary 手册 = `B3101` Procurement / `B3102` Sales / `B3106` Inventory Costing / `B3119` Manufacturing / `B3120` Planning / `B3121` Outsourcing，仅用于确定接口；不得重新打开冻结业务域。
>
> **本节 Coverage 以 Inventory & Warehouse Audit PASS 为准：**
> Audit = `PASS`；Requirement capability set = 44；Owner accounting = 40 Domain-Owned + 4 Integration-Backed。
>
> **2026-11-12 状态更正（域级 Acceptance 整改轮）**：本节的能力基线与 owner accounting 不变；Design 已展开为 `solution.md §27`，Implementation 已完成并进入域级验收阶段。逐项复核结论、真实缺陷与残余登记在 [`docs/audits/inventory-warehouse-capability-audit-20261112.md`](../audits/inventory-warehouse-capability-audit-20261112.md)。本节正文条款本身未被改写。
>
> 已知 Domain Authority：
> - Inventory & Warehouse = **Physical Inventory Truth Owner**；
> - 不得建立第二套库存余额；
> - `warehouse / location != owner`；
> - 所有业务域最终使用同一 physical inventory truth。

### 32.1 范围与 ownership

#### 32.1.1 Inventory & Warehouse 拥有

Inventory & Warehouse 是以下能力的唯一 canonical owner：

- 库存参数（inventory parameters：update policy / negative-stock policy / tracking policy / warehouse control defaults）；
- Warehouse Master 与 Warehouse Attributes（bin-enabled / negative-stock policy / MRP participation / inventory-lock permission / active-inactive）；
- Warehouse Bin / Location（仓库内仓位）；
- Stock Status Master（AVAILABLE / HOLD-BLOCKED / INSPECTION-QUARANTINE 至少三类，具体最终枚举由 Design 决定）；
- Owner Dimension（ENTERPRISE / SUPPLIER / CUSTOMER 至少三类）；
- Canonical Physical Inventory Balance（足以表达 product + warehouse + bin + owner + stock status + lot + serial + expiry 的唯一库存身份）；
- Canonical Inventory Mutation Contract（所有 physical mutation 经统一语义：receipt / issue / return / transfer / adjustment / stocktake / scrap / VMI / outsourcing supplier-WIP）；
- Inventory Enable Date / Opening Inventory / Initialization Close；
- Entrusted Material Receipt（physical location = enterprise warehouse，owner = CUSTOMER）；
- Other Inventory Receipt / Other Inventory Issue（库存原生单据，不伪装成 Purchase Receipt / Sales Delivery / Production Issue）；
- Direct Transfer / Step Transfer (In-Transit)；
- Lot Adjustment（split / merge / identity adjustment，quantity 守恒）；
- Stock Status Adjustment（status 变化，quantity / owner / location 守恒）；
- Inventory Form / Attribute Conversion；
- Inventory Adjustment & Scrap；
- Lot / Expiry / Shelf-Life Control / Serial Control / Auxiliary Inventory Attributes；
- ABC Classification；
- Instant Inventory Query（按 product / warehouse / bin / owner / stock status / lot / serial）；
- Inventory Lock / Unlock（locked quantity 不得作为 available，audit + 防止超锁）；
- Regular Stocktake / Cycle Stocktake / Stocktake Difference & Gain-Loss；
- Inventory Period Close / Reopen（precheck / close / snapshot / closed-period mutation block / controlled reopen / audit）；
- Receipt / Issue Summary & Detail / Inventory Ledger / Inventory Aging / Slow-Moving Inventory；
- Inventory Alerts & Anomaly Analysis（minimum / maximum / safety / reorder point / expiry / negative-balance anomaly）；
- ABC & Serial Analysis；
- Barcode Rules / Parsing / Master（bounded barcode foundation）；
- Stocktake Scan / Instant Inventory Scan Query；
- Packing / Container Core（container / pack / unpack / whole-container transfer / partial-container transfer / container content inquiry；container 不得成为第二库存余额）。

#### 32.1.2 Inventory & Warehouse 不拥有

- AP / AR（Finance Operations Domain）；
- 最终财务 costing / GL / Voucher / Period Close（Finance Operations / Accounting & Analytics Domain）；
- MRP / Demand calculation / Reservation intent / Reservation document（Planning Domain）；
- 业务单据语义：Purchase Receipt / Purchase Return / Production Issue-Receipt / Outsourcing Issue-Receipt / Sales Delivery / Planning documents（各自业务域）；
- BOM / Substitute / Routing master（Master & Engineering Domain）；
- Production Order execution / Inspection / Operation Transfer（Manufacturing & Quality Domain）；
- Quality inspection decision（Quality 域所有，但 Quality 可触发 Stock Status 变化，Inventory 是状态 owner）；
- IQC / OQC 内部语义；
- 最终成本估值 / 差异 / voucher（Finance / Inventory Costing）；
- Multi-Organization / Multi-Currency（OUT_OF_SCOPE_PRODUCT_BASELINE）；
- 完整 B3105 PDA / camera SDK / label printing 平台 / 设备地址管理；
- Generic Workflow / Smart Accounting / Management Accounting / Generic no-code scan-config designer / 完整 WMS wave engine（OUT_OF_SCOPE）。

#### 32.1.3 Physical Inventory Identity

最终物理库存身份必须能够表达：

```text
Product
+ Warehouse
+ Bin / Location
+ Owner
+ Stock Status
+ Lot / Serial
+ Expiry
→ Physical Quantity
```

Inventory owns `where / how much / whose / what stock status / what lot/serial / what physical availability / how physical stock moves`。

### 32.2 Manual Evidence Baseline（摘要）

完整证据来自上游已批准的 B3104 + B3105。下表为关键 contract：

| 关键 contract | 含义 |
|---|---|
| One Physical Stock Truth | 全部业务域最终使用同一 physical inventory truth；禁止第二库存账 |
| `Location ≠ Ownership` | warehouse / location 与 owner 解耦；至少支持 enterprise-owned @ enterprise warehouse、enterprise-owned @ supplier-WIP warehouse、supplier-owned @ enterprise warehouse（VMI）、customer-owned @ enterprise warehouse（entrusted material） |
| Business Document ≠ Inventory Mutation | 采购 / 销售 / 生产 / 委外拥有业务单据；Inventory 提供唯一 physical mutation contract |
| `On-hand ≠ Reserved ≠ Available` | on_hand / reserved / available 必须分明；Planning owns reservation intent；Inventory owns physical availability projection |
| LOT / SERIAL Canonical | LOT、SERIAL、expiry 不得由各业务域重复维护 |
| Stock Status First-Class | 库存状态影响 availability / issue / shipment / transfer / reservation eligibility |
| Business Date / Period Authoritative | 库存动作服从业务日期与库存期间 |
| Quantity Truth ≠ Final Cost Truth | Inventory owns physical quantity；Finance owns final financial costing / accounting |
| Initialization Closure | 库存初始化必须有结束状态；结束后期初库存不可按普通草稿任意重写 |
| Stocktake Difference | 盘盈 / 盘亏必须通过 canonical physical mutation 生效；不得直接覆盖库存余额而无 movement evidence |
| Period Close | precheck → close → snapshot → closed-period mutation block → controlled reopen → audit |
| Negative Stock Policy | 按 inventory parameter 控制；不绕过物理约束 |
| VMI | supplier-owned @ enterprise warehouse，physical at enterprise site |
| Standard Outsourcing | enterprise-owned @ supplier-WIP warehouse，owner 不变 |
| Entrusted Material | customer-owned @ enterprise warehouse，受托料不得记成企业自有库存 |

### 32.3 Capability Audit Matrix（已审计）

44 capability IDs 按以下分类组织。后续 Design / Implementation 不得新增 ID：

#### 32.3.1 Foundation & Physical Stock

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-01 | Inventory Parameters | `MISSING → NEW` | Domain-Owned；库存参数至少覆盖 inventory update policy、negative-stock policy、tracking / expiry policy references、warehouse control defaults；不得与 Planning / Finance 参数混为一套 |
| INV-02 | Warehouse Master & Warehouse Attributes | `PARTIAL → ENHANCE` | Domain-Owned；既有仓库 CRUD 必须保留；扩展 bin / location enabled、negative-stock policy、MRP participation、inventory-lock permission、active / inactive |
| INV-03 | Warehouse Bin / Location | `MISSING → NEW` | Domain-Owned；支持仓库内仓位 / location；库存、查询、扫描及移动均可使用仓位维度 |
| INV-04 | Stock Status Master | `PARTIAL → NEW` | Domain-Owned；建立 canonical stock-status dimension（至少表达 AVAILABLE / HOLD-BLOCKED / INSPECTION-QUARANTINE）；具体最终枚举由 Design 决定；Quality 可以触发状态变化，Inventory 是状态 owner |
| INV-05 | Owner Dimension | `MISSING → NEW` | Domain-Owned；至少支持 ENTERPRISE / SUPPLIER / CUSTOMER；owner identity 不得由 warehouse 隐式推导；本能力解除 Domain 4 当前 `INVENTORY_OWNER_DIMENSION_UNAVAILABLE` 依赖 |
| INV-06 | Canonical Physical Inventory Balance | `PARTIAL → CONVERGE` | Domain-Owned；余额从 `warehouse + product` 升级为足够表达完整库存身份的 canonical physical balance；不得产生第二库存账 |
| INV-07 | Canonical Inventory Mutation Contract | `PARTIAL → CONVERGE` | Domain-Owned；所有 receipt / issue / return / transfer / adjustment / stocktake / scrap / VMI / outsourcing supplier-WIP 最终统一通过 authoritative inventory mutation semantics 改变物理库存；业务域不能直接维护另一套 physical balance |
| INV-08 | Available Stock / Reservation Projection | `PARTIAL → ENHANCE` | **Integration-Backed — Planning**；Inventory 提供 on_hand / reserved / available；Planning 继续拥有 reservation intent 与 reservation documents；不得复制 Planning reservation engine |

#### 32.3.2 Initialization & Native Inventory Documents

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-09 | Inventory Enable Date | `MISSING → NEW` | Domain-Owned；正式库存启用日期；启用前 / 后的业务行为必须可确定 |
| INV-10 | Opening Inventory | `MISSING → NEW` | Domain-Owned；支持初始库存录入，含 warehouse / bin / owner / status / lot / serial / quantity；不得伪造历史采购 / 销售业务 |
| INV-11 | Initialization Close | `MISSING → NEW` | Domain-Owned；库存初始化必须有结束状态；结束后期初库存不可按普通草稿任意重写 |
| INV-12 | Entrusted Material Receipt | `MISSING → NEW` | Domain-Owned；物理 location = enterprise warehouse；owner = CUSTOMER；不得把受托料记成企业自有库存 |
| INV-13 | Other Inventory Receipt | `MISSING → NEW` | Domain-Owned；提供库存原生"其他入库"；不得伪装成 Purchase Receipt |
| INV-14 | Other Inventory Issue | `MISSING → NEW` | Domain-Owned；提供库存原生"其他出库"；不得伪装成 Sales Delivery / Production Issue |

#### 32.3.3 Inventory Movement & Conversion

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-15 | Direct Transfer | `COVERED → KEEP` | Domain-Owned；既有 transfer 必须保留；强化：owner 不变、stock identity 守恒、source decrease 与 destination increase 必须 single-effect；包含合法调拨退回 |
| INV-16 | Step Transfer / In-Transit | `MISSING → NEW` | Domain-Owned；支持 Transfer Out → IN_TRANSIT → Transfer In；适用于源仓与目标仓不能同时完成移动的业务；必须显式表示在途量 |
| INV-17 | Assembly & Disassembly | `MISSING → NEW` | **Integration-Backed — Engineering BOM**；支持库存层组装 / 拆卸；Engineering / BOM 是结构来源；Inventory owns physical consume / produce movement；不得创建第二 BOM truth；最终成本分摊仍归 Finance / Inventory Costing |
| INV-18 | Lot Adjustment | `PARTIAL → ENHANCE` | Domain-Owned；支持 lot split / lot merge / lot identity adjustment；数量守恒；不得借批号调整制造或销毁库存 |
| INV-19 | Stock Status Adjustment | `MISSING → NEW` | Domain-Owned；支持同一物理库存 status A → status B；数量、owner、location 必须守恒 |
| INV-20 | Inventory Form / Attribute Conversion | `MISSING → NEW` | Domain-Owned；支持手册中的形态转换语义；库存数量必须守恒；辅助属性 / BOM 版本 / 计划跟踪号等 metadata 的 canonical owner 不得被复制 |
| INV-21 | Inventory Adjustment & Scrap | `COVERED → KEEP` | Domain-Owned；保留并收敛已有 Inventory Adjustment / Inventory Scrap；必须使用 canonical inventory identity、tracking、period、valuation integration |

#### 32.3.4 Tracking & Inventory Control

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-22 | Lot Control | `COVERED → KEEP` | Domain-Owned；保留现有 LOT canonical capability；支持 lot master / lot balance / source provenance / movement trace / availability control |
| INV-23 | Expiry / Shelf-Life Control | `COVERED → KEEP` | Domain-Owned；支持 manufacture date / expiry date / expired identification / outbound eligibility / warning；不得由 Barcode 再建第二套 expiry truth |
| INV-24 | Serial Control | `COVERED → KEEP` | Domain-Owned；保留 canonical SERIAL identity；支持 unique identity / current physical position / lifecycle state / movement trace |
| INV-25 | Auxiliary Inventory Attributes | `MISSING → NEW` | Domain-Owned；库存身份允许使用必要的辅助属性；Master Data 可拥有属性定义；Inventory owns these attributes as physical-stock dimensions where required |
| INV-26 | ABC Classification | `MISSING → NEW` | Domain-Owned；支持物料 ABC 分类，并能作为周期盘点策略输入；涉及金额 / 成本的分类基础只读取 Finance canonical evidence |
| INV-27 | Instant Inventory Query | `PARTIAL → ENHANCE` | Domain-Owned；即时库存必须支持汇总 / 明细查询；至少可按 product / warehouse / bin / owner / stock status / lot / serial 查询 |
| INV-28 | Inventory Lock / Unlock | `PARTIAL → ENHANCE` | Domain-Owned；支持锁库 / 解锁；locked quantity 不得继续作为普通 available stock 使用；必须可审计并防止超锁 |

#### 32.3.5 Stocktake & Period Control

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-29 | Regular Stocktake | `COVERED → KEEP` | Domain-Owned；支持定期盘点计划 / 作业；实际盘点数与账存数必须分离保存 |
| INV-30 | Cycle Stocktake | `MISSING → NEW` | Domain-Owned；支持周期盘点；可使用 ABC 分类 / 周期策略决定盘点范围 |
| INV-31 | Stocktake Difference & Gain/Loss | `PARTIAL → ENHANCE` | Domain-Owned；盘盈 / 盘亏必须通过 canonical physical mutation 生效；不得直接覆盖库存余额而无 movement evidence |
| INV-32 | Inventory Period Close / Reopen | `COVERED → KEEP` | Domain-Owned；保留现有库存期间能力；要求 precheck / close / snapshot / closed-period mutation block / controlled reopen / audit |

#### 32.3.6 Inventory Reports & Alerts

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-33 | Receipt / Issue Summary & Detail | `PARTIAL → ENHANCE` | Domain-Owned；覆盖物料收发汇总 / 物料收发明细 / 业务分类统计；数量来自 canonical inventory movements |
| INV-34 | Inventory Ledger | `COVERED → KEEP` | Domain-Owned；支持 opening / receipt / issue / closing；按业务日期形成可追溯库存台账 |
| INV-35 | Inventory Aging | `MISSING → NEW` | Domain-Owned；按现存库存形成账龄分析；不得使用虚构库存数量；成本金额如展示，读取 Finance canonical valuation |
| INV-36 | Slow-Moving Inventory | `MISSING → NEW` | Domain-Owned；支持基于真实收发历史识别 long-time no movement / receipt-only-no-issue 等呆滞库存 |
| INV-37 | Inventory Alerts & Anomaly Analysis | `MISSING → NEW` | Domain-Owned；必须覆盖 minimum stock / maximum stock / safety stock / reorder point / expiry / negative-balance anomaly；不得以 stale `products.stock_quantity` 为库存事实 |
| INV-38 | ABC & Serial Analysis | `MISSING → NEW` | Domain-Owned；提供 ABC analysis / serial master / current state / trace lookup；复用 canonical ABC / SERIAL data |

#### 32.3.7 Barcode / Warehouse Scan Core

| ID | Capability | Audit Coverage | Implementation Decision |
|---|---|---|---|
| INV-39 | Barcode Rules / Parsing / Master | `MISSING → NEW` | Domain-Owned；支持 bounded barcode foundation：master lookup / dynamic parse / material identity / quantity / lot / serial / warehouse / bin identity；不要求复刻完整打印平台 |
| INV-40 | Scan-to-Document Adapter | `MISSING → NEW` | **Integration-Backed — Business Domains**；支持条码扫描 source document → target document draft / no-source inventory-native document draft；目标单据仍由对应 Domain 拥有（如 PO → Purchase Receipt、SO / Delivery → outbound validation、inventory-native Other Receipt）；不得用 Barcode 模块复制业务单据 |
| INV-41 | Inbound / Outbound Scan Validation | `MISSING → NEW` | **Integration-Backed — Business Domains**；扫描验证 document / product / quantity / warehouse / bin / lot / serial / expiry / stock eligibility；Barcode / Inventory 执行 physical validation；目标业务状态仍由原业务 Domain 决定 |
| INV-42 | Stocktake Scan | `MISSING → NEW` | Domain-Owned；支持 scan product / warehouse / bin / lot / serial / quantity → canonical Stocktake；不创建第二盘点系统 |
| INV-43 | Instant Inventory Scan Query | `MISSING → NEW` | Domain-Owned；支持扫描 product barcode / warehouse / bin barcode / lot / serial 查询即时库存 |
| INV-44 | Packing / Container Core | `MISSING → NEW` | Domain-Owned；只实现 bounded warehouse packing relation：container / package identity / pack / unpack / whole-container transfer / partial-container transfer / container content inquiry；container 不能成为第二库存余额；真实库存仍以 canonical inventory identity 为准 |

### 32.4 Owner Accounting — FROZEN

```text
Domain-Owned       40
Integration-Backed 4:
  INV-08 Planning Reservation
  INV-17 Engineering BOM
  INV-40 Business Document Scan Adapter
  INV-41 Business Document Validation

TOTAL              44
```

后续 Design / Implementation 不得增加新 ID；不得把 Integration-Backed capability 升级为 Domain-Owned（除非后续 Domain Closure 重新授权）；不得把 Domain-Owned capability 降级为 Integration-Backed。

Integration-Backed capability 的语义：

- **INV-08** Available Stock / Reservation Projection：Planning owns reservation intent 与 reservation documents；Inventory 提供 on_hand / reserved / available 三层投影，并保证 reservation 不会让 physical availability 越过真实 on_hand；不复制 Planning reservation engine。
- **INV-17** Assembly & Disassembly：Engineering / BOM 是结构与 component 关系的 canonical owner；Inventory 拥有物理 consume / produce movement；最终成本分摊归 Finance / Inventory Costing。
- **INV-40** Scan-to-Document Adapter：Business Domains 拥有目标单据；Inventory / Barcode 提供 bounded scan source-document resolution 与 draft payload 生成；不得复制业务单据语义。
- **INV-41** Inbound / Outbound Scan Validation：Inventory 执行 physical validation（eligibility / identity / quantity / location / lot / serial / expiry）；Business Domains 决定业务状态与单据 lifecycle。

### 32.5 Frozen Core Invariants

Requirement 必须保持以下 invariant，Design / Implementation 不得破坏：

#### I1 — One Physical Stock Truth

所有业务域最终使用同一 physical inventory truth。禁止第二库存账。

#### I2 — Location ≠ Ownership

```text
warehouse / location
!=
owner
```

必须支持至少：

```text
Enterprise-owned @ enterprise warehouse
Enterprise-owned @ supplier-WIP warehouse
Supplier-owned @ enterprise warehouse         // VMI
Customer-owned @ enterprise warehouse         // entrusted material
```

#### I3 — Business Document ≠ Inventory Mutation

采购 / 销售 / 生产 / 委外拥有自己的业务单据；Inventory 提供唯一 physical mutation contract。

#### I4 — On-hand ≠ Reserved ≠ Available

```text
on_hand
reserved
available
```

Planning owns reservation intent；Inventory owns physical availability projection。

#### I5 — LOT / SERIAL Is Canonical

LOT、SERIAL、expiry 不得由各业务域重复维护。

#### I6 — Stock Status Is First-Class

库存状态影响 availability / issue / shipment / transfer / reservation eligibility。

#### I7 — Business Date / Period Is Authoritative

库存动作必须服从业务日期与库存期间。

#### I8 — Quantity Truth ≠ Final Cost Truth

Inventory owns physical quantity；Finance owns final financial costing / accounting。

### 32.6 Existing Capabilities Must Be Preserved

Requirement 明确现有成熟能力属于 convergence，不得重写：

- warehouse CRUD；
- direct inventory；
- inventory transactions；
- inventory transfer；
- stocktake；
- inventory adjustment；
- inventory scrap；
- LOT；
- SERIAL；
- expiry；
- HOLD；
- traceability；
- inventory valuation integration；
- inventory period close / reopen；
- business-date protection。

目标是增强 canonical dimensions，不是另造一套库存模块。

### 32.7 Explicit Cross-Domain Boundaries

#### 32.7.1 Planning

Planning owns：

```text
reservation intent
MRP
planning supply / demand
```

Inventory owns：

```text
physical on-hand
physical eligibility
available projection
```

INV-08 是唯一授权的 Planning ↔ Inventory 接口面；不得引入第二套 reservation / availability engine。

#### 32.7.2 Procurement / Sales / Manufacturing / Outsourcing

这些域拥有业务单据。Inventory 只拥有最终 physical mutation。

不得重新设计已经冻结的：

```text
Purchase Receipt
Purchase Return
Production Issue / Receipt
Outsourcing Issue / Receipt
Planning documents
```

VMI 的 business layer 由 Procurement 完成；Inventory 仅负责 owner-dimensional physical mutation；VMI-02 / VMI-03 / VMI-05 的 physical 部分属于 INV-05 / INV-06 / INV-07。

#### 32.7.3 Quality

Quality owns：

```text
inspection decision
```

Inventory owns：

```text
physical stock status
availability consequence
```

INV-04 / INV-19 由 Quality 触发但 Inventory 是 canonical owner。

#### 32.7.4 Engineering

Engineering owns BOM / Substitute / Routing master。INV-17（Assembly / Disassembly）消费 Engineering BOM resolver，不创建第二 BOM truth。

#### 32.7.5 Finance / Inventory Costing

Finance owns：

```text
valuation policy
final cost
variance
voucher
GL
```

Inventory 可以调用 canonical valuation evidence，但不得建立第二套 costing engine。

### 32.8 Explicit Out of Scope

以下 B3105 内容不进入 Domain 5 Core Requirement：

- printer / device address management；
- 完整 barcode label-printing 平台；
- fixed-asset barcode stocktake；
- manufacturing operation reporting scan（Manufacturing & Quality 已 `COVERED`）；
- operation-transfer scan；
- independent Quality barcode workflow；
- generic no-code scan-config designer；
- advanced multi-user scan orchestration；
- automatic scan-task assignment engine；
- full merged-picking / WMS wave engine；
- three-level packaging printing。

未来可以作为 WMS / Barcode enhancement。本次不得因为手册存在就扩展进去。

其它 Out of Scope：

- Multi-Organization / Multi-Currency（`OUT_OF_SCOPE_PRODUCT_BASELINE`）；
- Finance engine rewrite / Generic Workflow redesign；
- 禁止建立、替换或并行维护第二套 Physical Inventory Ledger。
  - INV-34 Inventory Ledger 仍属于 Domain 5 Core Requirement；
  - 其 opening / receipt / issue / closing read model 必须从 canonical inventory balances + movements 派生；
  - 不得成为第二库存余额；
- retroactive rewrite 历史库存 / 收货 / 凭证；
- 第二库存账 / 第二 Inventory mutation engine / 第二 costing engine / 第二 UOM engine / 第二 expiry truth；
- Complete WMS / Advanced Logistics / Complete APS / Complete MES / HMI。

Schema Migration 行为明确（避免误解为禁止正常 schema migration）：

```text
禁止：
- 删除业务历史
- reset production / business data
- destructive rewrite with semantic data loss
- 为重构方便清空历史库存

允许：
- additive migration
- idempotent migration
- transactional table rebuild where SQLite requires it
- data-preserving constraint / index reconstruction

前提：
- existing business facts preserved
- before / after reconciliation
- rollback / fail-closed on mismatch
- SQLite / MySQL parity
```

### 32.9 Acceptance Criteria

#### A. Functional

INV-01~13 inventory parameters 全部启用且 effective；warehouse attributes 全部支持；stock-status dimension 至少 AVAILABLE / HOLD-BLOCKED / INSPECTION-QUARANTINE 三类最终生效；owner dimension 至少 ENTERPRISE / SUPPLIER / CUSTOMER 三类最终生效；canonical physical inventory balance 在全部 mutation / query / report 路径上唯一。

INV-15~17 三类 transfer 行为正确：direct transfer（owner 不变、stock identity 守恒）、step transfer（source → IN_TRANSIT → destination 在途量显式）、assembly / disassembly（消费 Engineering BOM resolver）；INV-18 / INV-19 / INV-20 / INV-21 数量、owner、location、status 守恒。

INV-22~26 LOT / expiry / serial / auxiliary / ABC 全部支持；INV-27 即时库存查询至少按 product / warehouse / bin / owner / stock status / lot / serial 路径返回；INV-28 lock 数量不进入 available。

INV-29~32 定期盘点 / 周期盘点 / 盘盈盘亏 / 期间关闭 reopen 全部覆盖；盘盈盘亏必须经 INV-07 canonical mutation。

INV-33~38 报表 / 库存台账 / 库龄 / 呆滞 / 预警 / ABC / 序列号追溯 / anomaly 全部产出真实数据；不得使用 stale `products.stock_quantity` 作为库存事实。

INV-39~44 Barcode / 扫描适配 / 校验 / 盘点扫码 / 即时库存扫码 / 包装容器 全部 bounded 完成；INV-40 / INV-41 不得复制业务单据；INV-44 container 不得成为第二库存余额。

INV-08 必须提供 on_hand / reserved / available 三层投影；reservation 不会越过真实 on_hand；不得复制 Planning reservation engine；INV-17 必须消费 Engineering BOM resolver。

#### A.1 Acceptance-Level Business Invariants

```text
VMI:
  Supplier-owned @ Enterprise warehouse
  must become representable

Outsourcing:
  Enterprise-owned @ Supplier-WIP warehouse
  must remain representable

Entrusted Material:
  Customer-owned @ Enterprise warehouse
  must become representable
```

以及：

```text
warehouse transfer:
  location changes
  owner does not

ownership transfer:
  owner changes
  location may not

stock-status adjustment:
  status changes
  quantity / location / owner do not

lot adjustment:
  lot identity changes
  total quantity does not

step transfer:
  source → in-transit → destination
  quantity conserved
```

#### B. Data / Schema

- 新增表 / column 全部 additive；既有表 / 字段无破坏；既有 LOT / SERIAL / 库存事务 / 库存台账 schema 完整保留；
- INV-04 stock-status、INV-05 owner、INV-03 bin、INV-09 enable date、INV-10/11 opening 与 initialization close、INV-16 in-transit、INV-28 lock、INV-30 cycle stocktake、INV-35 aging、INV-36 slow-moving、INV-37 alert、INV-39 barcode master、INV-44 container 等新增结构必须使用 structured rows；snapshot / log payload 可使用 bounded JSON；不得用 generic JSON 替代 core identity；
- SQLite / MySQL 8 schema parity；migration idempotent；既有 release tag `v1.6.2` 不破坏；
- Inventory Opening 期间 `OPENING` 标记；不虚构历史采购 / 销售凭证；
- 历史库存表 / 库存事务 / 库存台账不破坏；不得 DROP historical inventory table；不 retroactive rewrite 历史库存余额。

#### C. Security

- 所有 inventory mutation 必须 backend fail closed；
- Frontend hidden 不等于 authorization；
- INV-28 锁库必须 backend permission + audit；防止超锁；
- Audit 写入关键 inventory mutation（receipt / issue / return / transfer / adjustment / stocktake / scrap / VMI / outsourcing supplier-WIP / lock / unlock / period close / period reopen）；
- INV-04 stock-status 变更必须 audit；
- INV-05 owner 变更必须 audit。

#### D. Test

- INV-01~02 inventory parameters + warehouse attributes focused；
- INV-03~05 bin / stock-status / owner dimension focused；
- INV-06~07 canonical physical balance + mutation contract focused；
- INV-08 reservation / available projection focused（与 Planning 协作）；
- INV-09~11 initialization + opening + close focused；
- INV-12~14 entrusted / other receipt / other issue focused；
- INV-15~16 direct + step transfer focused；
- INV-17 assembly / disassembly focused（消费 Engineering BOM resolver）；
- INV-18~21 lot / status / form conversion / adjustment / scrap focused；
- INV-22~28 lot / expiry / serial / auxiliary / ABC / instant query / lock focused；
- INV-29~32 stocktake + period focused；
- INV-33~38 reports + alerts focused；
- INV-39~44 barcode + scan + packing focused；
- 全部 focused tests 纳入 `scripts/testing/test-suites.js`；
- canonical gate：`pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- 若变更触及 MySQL 敏感路径且具备受保护 disposable MySQL 环境，运行 `pnpm test:mysql` + `pnpm test:mysql:concurrency` + `pnpm test:mysql:performance`。

#### E. Concurrency critical sections

以下区域必须为 critical section（Design 决定具体 SQL / lock strategy；本阶段不设计 SQL）：

- inventory mutation（含 receipt / issue / return / transfer / adjustment / scrap）；
- inventory direct transfer / step transfer in-transit handoff；
- inventory owner mutation（VMI receipt / VMI consumption / VMI ownership transfer / outsourcing supplier-WIP position movement / entrusted material receipt）；
- inventory stock-status mutation（含 Quality 触发）；
- inventory lot adjustment（split / merge / identity）；
- inventory lock / unlock（防超锁）；
- inventory stocktake difference mutation；
- inventory period close / reopen；
- inventory assembly / disassembly（消费 BOM resolver，库存 consume / produce）；
- planning reservation vs inventory availability（INV-08）。

#### F. UI / Mobile

- 实际 operator workflow（user task；Design 决定 UI 结构）：
  - 即时库存查询（按 product / warehouse / bin / owner / stock status / lot / serial）；
  - 入库 / 出库 / 调拨（direct + step + IN_TRANSIT）；
  - 库存状态调整（HOLD / RELEASE / 待检）；
  - 库存锁定 / 解锁；
  - 盘点（定期 / 周期）；
  - 库存初始化 + opening + close；
  - 受托料登记 / 其他入库 / 其他出库；
  - 形态转换 / 批号调整 / 库存调整 / 报废；
  - 库龄 / 呆滞 / 预警 / ABC / 序列号追溯；
  - Barcode / 扫码查询 / 盘点扫码 / 收发货扫码；
  - 包装 / 拆包 / 容器转移 / 容器内容查询。
- Mobile-first：390 CSS px 为主；同时验证 320 / 430 / 680；
- LIST → DETAIL → EDITOR / WORKFLOW；
- 仅 UI 任务显式加载 `.claude/skills/erp-mobile-taste/SKILL.md`；
- 不得修改业务术语、API、权限、状态机、Approval / Confirm / Post / Reverse、source / downstream、inventory / accounting facts。

#### G. Documentation / Log

- `document.md §22.4 / §22.5 / §32` 同步更新；
- `solution.md §27` 同步更新（Design；本阶段未开始）；
- `log/2026-10-10.md` 追加本 Domain Closure Requirement 完整记录；
- `README.md` 仓库地图与新增 page route / server module / 测试在 Design / Implementation 完成后同步更新；
- `APPLY_GUIDE.md` 不动。

### 32.10 Hard Stop Conditions

遇下列情况停止对应 sub-capability（不影响其它 sub-capability 推进）：

1. Multi-Organization / Multi-Currency 需求出现；
2. 需要重写 Procurement / Sales / Quality / Production / Planning / Engineering canonical owner；
3. 需要 DROP historical inventory table 或 destructive schema rewrite；
4. 需要把 INV-04 stock-status 与 Quality inspection decision 合并；
5. 需要把 INV-05 owner 由 warehouse 隐式推导；
6. 需要 retroactive rewrite 历史库存余额 / 库存台账；
7. 需要把 Standard Outsourcing 复用 VMI ownership semantics；
8. 需要把受托料记成企业自有库存；
9. source semantics 不足导致 inventory aging algorithm / slow-moving algorithm / ABC classification algorithm 不得不猜测；
11. MySQL migration 无法保证 parity；
12. 需要通过 raw UPDATE inventory balance（绕过 canonical inventory transfer）；
13. 既有的 INV-15 transfer / INV-22 LOT / INV-24 SERIAL / INV-32 period close canonical owner 必须被破坏；
14. INV-44 container 必须成为第二库存余额；
15. INV-40 / INV-41 必须复制业务单据语义；
16. INV-08 必须复制 Planning reservation engine。

### 32.11 最终接受状态

本节 Requirement 包含 44 项 Capability / Owner accounting = 40 Domain-Owned + 4 Integration-Backed（INV-08 Planning / INV-17 Engineering BOM / INV-40 Business Document Scan Adapter / INV-41 Business Document Validation）。

本节 Requirement 完成；下游 Design 见 `solution.md §27`（本阶段未开始）。等待用户 PASS。

---

**INVENTORY & WAREHOUSE DOMAIN CLOSURE REQUIREMENT — COMPLETE / READY FOR USER REVIEW**

---

### 32.12 INV-32 期间控制一致性修订（`APPROVED`，2026-11-14）

#### 32.12.1 权威与范围

- Inventory & Warehouse 继续是 `INVENTORY` 期间轴唯一业务 owner；库存期间与法定会计期间不得合并。
- INV-32 的连续月结、precheck、快照、最新期间反结账、重结与审计语义继续有效。
- 库存关闭历史和快照是证据；当前关闭状态必须来自单一权威状态，不得由多个守卫分别推导。

#### 32.12.2 Mutation 保护

- 所有改变库存数量、仓位、owner、stock status、LOT/SERIAL、库存价值或产生库存相关凭证的动作，
  必须通过 Platform §36.15 的 canonical 守卫并声明 `INVENTORY + LEGAL_ACCOUNTING`。
- 现有库存专用重复闸门必须退出生产判定；任何调用方不得只检查库存关闭而忽略法定会计期间，也不得
  只检查法定会计期间而忽略库存关闭。
- 权威业务日期必须来自事务内重读的业务单据／mutation 输入合同；不得用 `created_at`、客户端缓存状态
  或当前日期替代既有单据的权威日期。
- 关闭期间内的确认、冲销、反向移动、委外 WIP 逻辑移动、估值调整和生命周期清理，只要会改变受保护
  库存事实，均须受同一守卫约束；合法例外必须在 Requirement 中逐项列明，不得静默 best effort。

#### 32.12.3 关闭并发与顺序

- 库存月结与库存 mutation 必须锁定同一稳定权威状态。真实 MySQL 并发时，只允许：mutation 先提交且
  被月结检查／快照纳入，或月结先提交且 mutation 被拒绝；不得出现月结完成后更早业务日期写入。
- 库存月结继续严格按连续月份执行，反结账继续仅允许最新已关闭期间；重结必须复用同一期间身份并重建
  可验证快照。
- 法定会计期间已关闭时不得反开对应库存期间；法定会计关账前必须证明库存已关闭至期间末。

#### 32.12.4 验收增量

- 同一业务日期经所有库存入口得到一致结果；无效日期、状态缺失、关闭链损坏全部 fail closed。
- 覆盖普通出入库、转移、调整、盘点、报废、LOT/SERIAL、委外逻辑移动、估值与冲销的关闭期间负例，
  并断言数量、身份、估值、凭证、审计业务副作用为零。
- 真实 MySQL race 必须调用真实月结 handler 和真实 inventory mutation handler；直接插入关闭行、只检查
  最终数量落在两个值之一、或允许双方成功但不证明快照包含 mutation，均不构成合格证据。
- SQLite / MySQL 双路径必须保持相同关闭结果、错误语义、事务回滚和重开恢复行为。

### 32.13 route exposure 与页面自身 API 权限一致性有界增补（`APPROVED`，2026-11-15）

#### 32.13.1 身份、授权与生效边界

| 项 | 内容 |
|---|---|
| 用途 | 消除 `inventory` route 的 **exposure 权限集合未覆盖该页面自身依赖的 API 权限集合**所造成的「预期外 403」：同一后端主体被前端判定为可进入该 route，又被后端判定为无权调用该 route 加载时必调的 API |
| Owner | Inventory & Warehouse（`inventory` 单一 canonical 工作面与库存参照的 owner） |
| 状态 | `APPROVED`（业务所有者于 2026-11-15 批准本节）；Design §27.58 同日 `APPROVED`；Implementation **已授权**（2026-11-15），范围仅限 §32.13.4 验收门禁所列的仓库内代码与测试变更 |
| 权威来源 | `document.md` §32；本文件 §32.5 Frozen Core Invariants、§32.9 Acceptance Criteria、§32.10 Hard Stop Conditions；平台合同 [`docs/requirements/platform.md` §36.18](../requirements/platform.md)（`PL-EXPOSURE-01..07`）；`docs/status/PROJECT_STATUS.md` §67.6 第 1 条与 §67.6 第 5 条 |
| 显式有界解冻 | 业务所有者于 2026-11-15 的「修复存在的阻塞、达到可发布状态」指令，**显式有界解冻**本域中与 `inventory` 这**一条** route 合同相关的冻结部分（即该 route 的 exposure 口径与页面参照加载口径）。**解冻范围仅限这一条 route**：本域其余 route、页签、权限码、能力集合与 2026-11-13 的域级 Acceptance / Capability Freeze 记录**保持冻结不变**；本节**不改写**冻结记录，冻结历史仍然成立 |
| 前置条件 | 本域整域已冻结（`INVENTORY_WAREHOUSE_DOMAIN_ACCEPTANCE_PASS` / `INVENTORY_WAREHOUSE_CAPABILITY_FREEZE`，2026-11-13，44 项能力）。本节触碰**权限与 route exposure 合同**，因此实施前必须由业务所有者**显式解冻**并单独授权 Implementation —— **该解冻与实施授权已于 2026-11-15 由业务所有者给出** |
| Supersession | 本节只**增补** §32.5 与 §32.9，**不改写** §32 已冻结结论，也**不改写** 2026-11-13 的冻结记录；本节记录的是**冻结之后**发现的有界缺陷 |

本节只覆盖 `inventory` 一条 canonical route。本文件 §32 的其它 route、页签、状态机、
权限码与能力集合**均不变**。

#### 32.13.2 事实基线（2026-11-15 在 HEAD `6272337` 上实测）

`inventory` route 的 exposure 为 `any:['INVENTORY_VIEW']`（`src/navigation/applicationRegistry.js:43`）。
页面 hub 的 `useInventoryReferences`（`src/pages/inventory-work.jsx:172`–`:183`）**无条件**加载 4 个参照端点：

| 参照 | API | 后端要求的权限 | 事实来源 | `role-reviewer` 是否持有 |
|---|---|---|---|---|
| 仓库 | `GET /api/warehouses` | `WAREHOUSES_VIEW` / `WAREHOUSES_MANAGE` | `server/modules/warehouses.js:30` | 是（`WAREHOUSES_VIEW`） |
| 货品 | `GET /api/products` | `PRODUCTS_VIEW` / `PRODUCTS_MANAGE` | `server/modules/products.js:56` | 是（`PRODUCTS_VIEW`） |
| 库存状态 | `GET /api/inventory-stock-statuses` | `STOCK_STATUS_VIEW` / `STOCK_STATUS_MANAGE` | `server/modules/stock-status.js:28` | **否** |
| 仓位 | `GET /api/warehouse-bins` | `WAREHOUSE_BIN_VIEW` / `WAREHOUSE_BIN_MANAGE` | `server/modules/warehouse-bin.js:25` | **否** |

触发事实：`role-reviewer` 持有 `INVENTORY_VIEW`（`server/db.js:2046`）因此**可进入** `inventory` route，
但不持有 `STOCK_STATUS_*` 与 `WAREHOUSE_BIN_*`，因此被后端拒绝。

**穷尽性**：93 条 canonical route × 5 类 canonical 角色、每个 (角色, route) 隔离 reload 的穷尽枚举中，
`inventory` × `role-reviewer` 是**唯一**的首屏 403 组合（平台合同 §36.18.2）。
`role-warehouse` 持有 `WAREHOUSE_BIN_*` 与 `STOCK_STATUS_*`（`server/db.js:2050`），因此同一 route 对其**可用**——
说明这不是「route 暴露给了不该暴露的角色」，而是**页面按角色加载参照**的缺失。

#### 32.13.3 合同项 `IW-EXPOSURE-01..05`

- **`IW-EXPOSURE-01`（参照必须登记）**：本 route 的 4 个参照数据源、其端点与读取权限，
  必须在代码中以**单一事实来源**登记；页面不得自行维护第二份端点清单。
  登记口径以 §32.13.2 的表为准，并与平台合同 `PL-EXPOSURE-01` / `PL-EXPOSURE-02` 一致。
- **`IW-EXPOSURE-02`（无权的数据源一次请求都不发）**：actor 无权读取的参照数据源，
  首屏**不得**发起任何请求；不得「先请求、后被拒绝」。
- **`IW-EXPOSURE-03`（无权态与空态必须可区分）**：无权读取参照时，页面必须呈现**明确的无权态**，
  **不得**把它渲染成「没有可选仓位 / 库存状态」。
- **`IW-EXPOSURE-04`（后端语义与权限目录不变）**：后端 API 守卫语义**不变**；
  **不得**新增权限码、**不得**修改 `role_permissions`、**不得**放宽任何 API 守卫、
  **不得**改动任何角色的权限集合、`inventory` route 的 exposure **不变**。
  前端隐藏**不构成**授权：后端必须继续 fail closed。
- **`IW-EXPOSURE-05`（页签不得暴露无权能力）**：本工作面的页签若其自身依赖的读取权限
  actor 不具备，该页签**不得**以「可点击但必然报错」的形式呈现；
  不得让测试者在页签内遇到预期外 403。

#### 32.13.4 验收、兼容与禁止事项

**验收门禁**：

1. 穷尽枚举：93 route × 5 canonical 角色的首屏非预期 4xx/5xx 组合数 = 0，控制台错误数 = 0；
2. canonical 浏览器门禁 `node scripts/acceptance/release-browser-readiness.mjs` 退出码 0，三类失败均为 0；
3. focused 合同测试：登记与后端实际守卫逐项一致；逐角色断言首屏请求集合 ⊆ 该角色权限；
   无权时零请求；无权态与空态可区分；页面不得自带第二份端点清单；
4. 变异实验：① 取消按权限过滤 → 必须转红；② 篡改登记的权限码 → 必须转红；
   ③ 恢复无条件加载 → 必须转红；
5. `pnpm test:fast`、`pnpm test`、`pnpm test:heavy`、`pnpm build`、`git diff --check`、
   两种文档一致性模式。

**兼容要求**：不改变任何角色的权限集合与 `role_permissions`；不改变 route 数量与 route key；
不改变 `inventory` route 的 exposure；不改变任何 API 的请求 / 响应合同与权限判定；
不改变 21 个页签的**集合**（只改变**可见性**与参照加载）；不改变库存数量、状态机、估值与
会计口径；不改变既有 release tag。

**禁止事项**：不得以 allowlist / 白名单方式把 403 放进 canonical 门禁的豁免项；不得放宽后端 API 守卫；
不得新增权限码或修改 role 种子；不得以「收紧 exposure」回避本节不一致
（该方向仍是 `docs/decisions/OPEN-BUSINESS-DECISIONS.md` 登记的开放业务决定）；
不得删除页签或以「删页签」回避 §32.13.2 的不一致；不得把前端隐藏当作授权实现
（后端必须继续 fail closed）；不得把尚未取得的真实浏览器证据写成已通过。

**Requirement 状态：`APPROVED`（2026-11-15，业务所有者批准）。Design §27.58：`APPROVED`（同日批准）。
Implementation：已授权（2026-11-15），范围仅限本节验收门禁所列的仓库内代码与测试变更；
真实 MySQL 连接、数据库操作、Acceptance / Freeze 签发、发布与部署**未授权`。**

### 32.14 批次 / 序列号跟踪列表端点与跟踪维度投影一致性修订（D4，`APPROVED`，2026-11-17）

> **有界解冻授权（2026-11-17）**：业务所有者指令「补 D4 —— 批次/序列号跟踪是制造业客户常用功能，
> 这四个界面现在打开是空的。下一轮直接做完」并追加裁定「全做：4+1 端点 + 投影根因 + 形态转换」。
> 本节因此**有界解冻** §32.13 登记的页签读取口径与本域的跟踪读模型，
> 仅覆盖本节合同项列出的范围；既有域级 Acceptance / Freeze（2026-11-13，44/44）继续作为历史时点记录保留。

#### 32.14.1 事实基础（客户测试环境实测，2026-11-17）

| # | 事实 | 证据 |
|---|---|---|
| F1 | 批号调整 / 形态转换 / 容器只有写端点与 `/:id` 端点，**没有列表端点** | `server/app.js:3757-3768`、`:3771-3782`、`:3818-3853`；实测 `GET /api/inventory-lot-adjustments` → 404 |
| F2 | 三个页签的列表**只由自己的新建动作本地塞入**，刷新后不可寻回 | `src/pages/inventory-work.jsx` 的 `InventoryLotAdjustment` / `InventoryFormConversion` / `InventoryContainers`：`useState([])` 且无列表读取 |
| F3 | 批次 / 序列号主档**没有列表端点**；既有 `GET /api/tracking/identities` 是**身份 + 移动证据**投影（限 100 行），不是主档列表 | `server/modules/traceability-quality.js:569-587` |
| F4 | canonical 位移写入器**不维护**跟踪维度投影 `inventory_lot_balances`，只有寄售 / 委外严格路径的 `postCanonicalTrackedLeg` 维护 | `server/lib/inventory-mutation.js:397-410`（自记 tracked movement 时只写 `tracked_inventory_movements`）；`server/modules/traceability-quality.js:254-299` |
| F5 | 客户实例上 canonical 库存 = **650**，投影 = **0**；平台自带健康检查 `TRACKED_DIMENSION_VS_CANONICAL` 差 650 | 实例只读实测：`inventory`（LOT 货品 UAT-RM02，active）合计 650；`inventory_lot_balances` 空；`server/modules/financial-inventory.js:316-330` |
| F6 | 因投影为空，`listTrackingIdentities` 与 `trackedAvailability` 对**每一个**批次返回数量 0 / 无当前仓库 / 可用量 0 | `server/modules/traceability-quality.js:573-580`、`:592-596` |

**根因归并**：F6 不是「少几个端点」，而是 F4 —— 维度投影由**部分**写入路径维护，
于是投影与 canonical 仓位长期背离。**只补列表端点会得到「有行但全 0」的假修复**，
因此本节把投影一致性（`IW-TRACE-04`）与列表端点（`IW-TRACE-01/02`）放在同一轮闭合。

#### 32.14.2 合同项

- **`IW-TRACE-01`（跟踪身份主档列表端点）**：必须提供 `GET /api/inventory-lots` 与
  `GET /api/inventory-serials`，返回批次 / 序列号主档的 canonical 读模型：
  身份标识、所属货品、状态、有效期、来源类型、**当前数量与所在仓库**。
  当前数量必须来自与 `listTrackingIdentities` / `trackedAvailability` **同一份**维度事实
  （不得出现第二份数量算法）；守卫为既有权限码 `INVENTORY_VIEW`。
- **`IW-TRACE-02`（单据列表端点与页签加载）**：批号调整 / 形态转换 / 容器必须各有一个列表端点
  （`GET /api/inventory-lot-adjustments`、`GET /api/inventory-form-conversions`、
  `GET /api/inventory-containers`），且库存作业工作面的对应页签必须在打开时读取该列表。
  草稿单刷新后必须可寻回；无权 actor 不得触发该读取（承 `IW-EXPOSURE-02`）。
- **`IW-TRACE-03`（守卫只许收紧、不得新增权限码）**：单据列表端点必须使用**既有**权限码
  （`INVENTORY_LOT_ADJUSTMENT_VIEW` / `INVENTORY_FORM_CONVERSION_VIEW` / `INVENTORY_CONTAINER_VIEW`，
  与既有写端点的 `..._MANAGE` 成对）；不得新增权限码、不得修改 `role_permissions`、
  不得改动任何角色的权限集合、不得改变 `inventory` route 的 exposure、
  不得改变 21 个页签的**集合**（只改变可见性与参照加载，承 §32.13.4）。
- **`IW-TRACE-04`（跟踪维度投影必须由 canonical 位移写入器维护）**：批次维度的当前投影
  `inventory_lot_balances` 与序列号的当前位置 / 生命周期，必须由**唯一 canonical 位移写入器**
  （`server/lib/inventory-mutation.js`）在同一次事务内维护；不得由各调用方各自补写，
  不得出现第二条投影写入路径。维护不得**新增**业务拒绝语义：批次可用量的既有守恒检查
  与过期 / 冻结守卫的既有归属不变。平台健康检查 `TRACKED_DIMENSION_VS_CANONICAL`
  与 `GET /api/tracking/reconcile` 的差异必须为 0。
- **`IW-TRACE-05`（既有差额必须按 canonical 仓位回填，不得造库存）**：既有环境里投影与
  canonical 仓位的差额必须由一条**幂等**迁移按 canonical 仓位回填；回填只写投影，
  不得新增或修改任何 canonical 仓位、库存数量、状态机、估值或会计事实，
  不得改写历史移动证据。
- **`IW-TRACE-06`（单一口径）**：批次 / 序列号的数量、所在仓库、生命周期在
  主档列表、追溯视图、可用量、核对接口与健康检查五处必须来自同一份维度事实；
  任何一处出现「有行但数量恒为 0」即视为未闭合。

#### 32.14.3 验收门禁

1. 五个列表端点返回 2xx；无权 actor 被后端拒绝（403），前端不得先行发起无权读取。
2. 页签读取登记（`src/lib/inventoryWorkTabs.js`）与后端实际守卫逐项一致；
   21 个页签集合不变，可见性按登记的读取权限收敛。
3. 有货场景下批次 / 序列号列表返回**真实数量与所在仓库**（不得恒为 0）；
   `GET /api/tracking/reconcile` 返回 `ok=true`；`TRACKED_DIMENSION_VS_CANONICAL` 差异 = 0。
4. 对齐迁移幂等：重复执行后投影与 canonical 仓位差额仍为 0，且 canonical 仓位逐行未变。
5. `pnpm test:fast`、`pnpm test`、`pnpm build`、`git diff --check`、两种文档一致性模式。

**Requirement 状态：`APPROVED`（2026-11-17，业务所有者批准）。Design §27.59：`APPROVED`（同日）。
Implementation：已实施（2026-11-17），范围仅限本节验收门禁所列的仓库内代码、迁移、前端与测试变更；
真实 MySQL 连接、数据库写操作、Acceptance / Freeze 签发、发布与部署**未授权**。**

---

### 32.15 期初库存计价与权威结账可行性（F-02，`APPROVED` → `IMPLEMENTED`，2026-11-18）

> **用途 / Owner / 状态 / 权威关系**：本节把 2026-11-18 客户测试环境清库 + 全业务验收发现的
> F-02 BLOCKING 缺陷固化为可验收合同。Owner = Inventory & Warehouse（期初单据与物理库存）
> 与 Accounting & Analytics（估值与结账口径）共同承担；本节是 `document.md` §32 的当前增补，
> 不取代 §32.1～§32.14 的任何正文。
>
> **授权来源与范围**：业务所有者 2026-11-18 指令「现在请修复四项阻塞 直接修」，授权对
> F-01 / F-02 / F-03 / F-04 四项 BLOCKING 直接进入 Requirement → Design → Implementation
> 的连续授权执行（AGENTS.md §4.0）。本节据此登记；**不含**授权：真实 MySQL 连接与数据库
> 写操作、Acceptance / Freeze 签发、push / tag / merge / release / deploy。
>
> **缺陷事实（客户测试环境实测）**：期初库存单没有成本字段，确认只写数量不写估值，于是每条
> 期初移动停在 `LEGACY_UNVALUED`，`LEGACY_UNVALUED_MOVEMENTS` 与
> `INVENTORY_QUANTITY_VS_VALUATION` 两项 BLOCKING 永久失败；带批次的期初没有身份级估值池，
> 委外发料被 409 `OUTSOURCING_VALUATION_UNVERIFIED` 挡住。

#### 32.15.1 合同项

- **`IW-OPEN-01`（期初必须计价）**：期初库存单的每一行必须携带**成本单价**（安全整数分，
  必须大于 0）。没有可证明的成本不得凭空估价：建单与确认都固定拒绝，错误信息指向具体行。
  期初行金额 = 成本单价 × 数量，按 `HALF_UP` 取整到安全整数分。
- **`IW-OPEN-02`（期初必须形成权威估值）**：期初确认必须写入权威估值流水
  （`inventory_valuation_movements`）并把对应 `inventory_transactions.valuation_status`
  置为 `VALUED`。带批次 / 序列号的期初必须建立**身份级估值池**
  （`LOT:<仓>:<货品>:<批次>` / `SERIAL:<序列号>`），使下游（委外发料、盘点、调整）能按
  同一身份证明成本。估值口径 `OPENING_COST`，与采购入库的 `APPROVED_PO_PRICE`、
  生产的 `FROZEN_STANDARD_MANUFACTURING_COST` 并列，属同一本权威估值流水。
- **`IW-OPEN-03`（期初价值必须有总账对方科目）**：期初存货价值必须在总账成立对方分录
  （`OPENING_EQUITY` 期初权益），借贷必须平衡。平台此前没有期初权益科目，期初价值无处记账，
  会让 `INVENTORY_VALUE_TO_GL` 因「有估值无总账」而失配。期初权益科目是**期初余额**的
  权益锚点，不改变既有科目余额，也不替代任何既有收入 / 成本科目。
- **`IW-OPEN-04`（跟踪期初必须带已存在身份）**：跟踪物料的期初行必须携带**已存在且属于该货品**
  的批次 / 序列号身份；序列号物料每次只能期初 1 件；非跟踪物料不得携带身份。身份与
  canonical 跟踪维度投影（§32.14 `IW-TRACE-04`）是同一份事实。
- **`IW-OPEN-05`（不得回填历史成本）**：本节**不**为既有期初行回填成本。历史期初行没有可证明的
  成本，按 §32.5「canonical facts 必须可重算」保持无成本状态，并在确认时明确拒绝；
  既有环境的处理由 Inventory 域的**有界迁移**另行授权，不得借本节自动估价。
- **`IW-OPEN-06`（与结账检查的关系）**：本节只保证「期初走规范期初单路径」时该路径可完成
  权威结账。`LEGACY_UNVALUED_MOVEMENTS` / `INVENTORY_QUANTITY_VS_VALUATION` 的判定口径
  （Accounting & Analytics `AA-W6.15` 关闭异常清单）**不变**，不得为通过检查而弱化。

#### 32.15.2 验收门禁

1. 期初行带成本 → 确认后 `inventory_transactions.valuation_status='VALUED'`、权威估值流水成立、
   带批次的期初存在身份级估值池（数量与金额逐分相等）。
2. 期初确认生成总账凭证：存货科目借方 = 期初权益贷方 = 期初金额合计，借贷平衡。
3. `LEGACY_UNVALUED_MOVEMENTS`、`INVENTORY_QUANTITY_VS_VALUATION`、`INVENTORY_VALUE_TO_GL`
   在期初确认后差异均为 0。
4. 缺成本、缺身份、身份不属于该货品的期初行固定拒绝，且不留下任何库存 / 估值 / 凭证事实。
5. `pnpm test`、`pnpm build`、`git diff --check` 与两种文档一致性模式全部通过。

**Requirement 状态：`APPROVED`（2026-11-18，业务所有者「直接修」授权）。Design §27.60：`APPROVED`（同日）。
Implementation：已实施（2026-11-18）；真实 MySQL 连接、数据库写操作、Acceptance / Freeze 签发、
发布与部署**未授权**。**

---

### 32.16 期初跟踪身份的登记入口（F-05，`APPROVED` → `IMPLEMENTED`，2026-11-18）

#### 32.16.1 身份与边界

- 用途：让**跟踪物料的期初在界面上可录**。Owner = Inventory & Warehouse（期初单据与跟踪身份主档）；
  Platform 拥有权限码目录与 route exposure。
- 授权来源与范围：业务所有者 2026-11-18 指令（选项「修 F-05 界面缺口」，
  Requirement → Design → Implementation 连续授权，承 AGENTS.md §4.0）。
  **未授权**：真实 MySQL 连接与数据库写操作、Acceptance / Freeze 签发、
  push / tag / merge / release / deploy。
- 缺陷事实（2026-11-18 客户测试环境清库全业务验收的复验发现）：§32.15 `IW-OPEN-04` 要求跟踪物料的
  期初行携带**已存在**的批次 / 序列号身份，但期初恰恰是这些身份在系统里的**第一次事实** ——
  此前没有任何业务单据能带出它。期初编辑器没有身份字段，界面上也没有任何身份登记入口，
  于是跟踪物料的期初**只有 API 能做**（验收脚本即如此），界面路径断链。
- 本节**只**补齐期初流程的身份登记入口；不改变 `IW-OPEN-04`（期初行仍必须引用已存在身份）、
  不改变 §32.14 的跟踪身份合同、不新增权限码、不改任何角色的权限集合、不改变
  `inventory` route 的 exposure。

#### 32.16.2 合同项

- **`IW-OPEN-07`（期初流程拥有身份登记入口）**：必须提供一个由**期初流程自己**拥有的身份登记
  端点，守卫是期初的**既有**权限码 `INVENTORY_OPENING_MANAGE`。不得新增权限码、不得修改
  `role_permissions`、不得让任何角色集合发生变化。
- **`IW-OPEN-08`（登记必须与货品的跟踪方式一致）**：登记批次身份只对 `tracking_policy='LOT'`
  的货品成立，登记序列号身份只对 `tracking_policy='SERIAL'` 的货品成立；不跟踪货品不得登记身份，
  跟踪方式与身份类型不一致时固定拒绝，**不得**凭空造身份。
- **`IW-OPEN-09`（登记必须幂等）**：同一货品的同一批号 / 序列号重复登记**必须复用同一条身份主档**，
  不得产生第二条身份（身份主档的唯一性由既有约束 `UNIQUE(product_id,lot_code)` /
  `UNIQUE(product_id,serial_number)` 承担）。
- **`IW-OPEN-10`（界面必须能完成这件事）**：期初录入界面必须同时提供「选择已有身份」与
  「登记新身份」两条路径，并按货品的跟踪方式呈现；无权读取身份主档时不得发起该读取
  （承 §32.13 `IW-EXPOSURE-02`）。界面上未登记身份而提交跟踪物料期初行时，必须在界面上给出
  明确提示，不得只依赖后端 400。

#### 32.16.3 验收增量

1. 登记端点：批次 / 序列号可登记（201）；同码重复登记返回同一条身份（200，`existing=true`），
   身份主档行数不增加。
2. 无权 actor 被后端 403 拒绝，且**不留下**任何身份主档。
3. 跟踪方式不匹配（不跟踪货品登记批次、批次货品登记序列号）与缺批号 / 序列号固定拒绝，
   零副作用。
4. 端到端：登记身份 → 期初单 → 确认 → 该身份成立身份级估值池（数量与金额逐分相等），
   期初移动为 `VALUED`。
5. 变异对照：去掉 `INVENTORY_OPENING_MANAGE` 守卫，「无权 403」断言必须转红。
6. `pnpm test`、`pnpm build`、`git diff --check` 与两种文档一致性模式全部通过。

**Requirement 状态：`APPROVED`（2026-11-18，业务所有者授权）。Design §27.61：`APPROVED`（同日）。
Implementation：已实施（2026-11-18）；真实 MySQL 连接、数据库写操作、Acceptance / Freeze 签发、
发布与部署**未授权**。**

---

### 32.17 异动腿的计值归属与权威结账可行性（F-06，`APPROVED` → `IMPLEMENTED`，2026-11-18）

#### 32.17.1 身份与边界

- 用途：让 §32.15 的期初计价合同在**真实环境**里真正成立 —— §32.15 验收门禁第 3 条要求
  `LEGACY_UNVALUED_MOVEMENTS` / `INVENTORY_QUANTITY_VS_VALUATION` / `INVENTORY_VALUE_TO_GL`
  三项 BLOCKING 检查差异均为 0，而期初本身已满足（期初的存货借方与期初权益贷方逐分相等），
  残余差异全部来自**其他流程的异动腿**。Owner = Inventory & Warehouse（异动与计值）；
  Accounting & Analytics 拥有估值流水与关账检查。
- 授权来源与范围：业务所有者 2026-11-18 指令「F-06 与 GRNI 口径立项走 Requirement → Design →
  Implementation 然后签发 Acceptance / Freeze」与「F-02 好像也还有矛盾 能否一并修好」
  （§4.0 连续阶段授权）。**未授权**：真实 MySQL 的**结构变更**、Acceptance / Freeze 签发以外的
  发布动作、push / tag / merge / release。
- 缺陷事实（客户测试环境实测，真实 MySQL 8）：
  - `LEGACY_UNVALUED_MOVEMENTS` = 2：调拨 IN 腿与库存状态变更 IN 腿的事务行仍是 `LEGACY_UNVALUED`。
  - `INVENTORY_QUANTITY_VS_VALUATION` = 1：状态变更的 IN 腿**没有任何估值流水**，
    在库数量比估值池多 1（实测库存 1029.6 / 估值池 1028.6）。
  - 根因一：canonical 位移写入器的 best-effort 计值分支把**每条** movement 都当「出库计值」，
    IN 腿在目标位找不到来源池即抛错，被 `catch` 静默吞掉 —— 价值离开来源池却不到目标池。
  - 根因二：调拨模块把 IN 腿的估值流水挂到 **OUT 腿**的事务 id 上，IN 腿的事务行因此永远
    停在 `LEGACY_UNVALUED`（价值本身是对的）。

#### 32.17.2 合同项

- **`IW-VAL-01`（每条异动腿都必须被计价标记）**：任何 `inventory_transactions` 行在其所属异动
  完成后必须是 `VALUED`；不得停留在 `LEGACY_UNVALUED`。例外有两种：调用方显式以
  `valuationMode: 'EXTERNAL'` 自持计值，且该腿的估值流水由调用方在同一事务内写入；
  或该货品**尚未进入估值口径**（`products.valuation_activated_at` 为空）—— 这类行沿用既有
  未估值行为，由关账异常清单（`LEGACY_UNVALUED_MOVEMENTS`）标记，不是「有值却不承接」。
- **`IW-VAL-02`（配对异动的入账腿必须承接出库腿的价值）**：同一异动内**同一货品 + 同一身份**的
  仓位间移动（库存状态变更 / 批号重分类 / 仓位移动 / 货主变更 / 形态转换 / 直接调拨），
  入账腿必须承接**同一异动出库腿发出的价值**（纯重分类价值中性）。承接后的入账腿与出账腿
  必须落在同一估值池口径上（`CARRYING_VALUE`）。
- **`IW-VAL-03`（计值失败不得静默吞掉）**：**已激活估值口径的货品**的配对异动，其计值失败必须让
  **整个异动失败**（外层事务回滚 → 零副作用），不得沿用「best-effort 吞异常」；错误必须带
  可定位的 `code` 与 `resolution`。未激活估值口径的货品不在本条范围内（见 `IW-VAL-01` 例外）。
- **`IW-VAL-04`（估值流水必须归属本腿的事务行）**：多腿异动（多批次 / 多序列号）中，每条腿的
  估值流水必须引用**该腿自己的** `inventory_transactions` id；不得把一条腿的流水挂到另一条腿上。
- **`IW-VAL-05`（单腿入库异动的残余清单）**：只有入库腿、没有出库腿的异动，其入库价值**不得**由
  写入器「出库计值」推导（那会从目标池扣掉价值），必须由调用方按权威成本自持计值。
  下列流程属该类，**本轮不实现**，登记为残余并逐项列出：
  组装拆卸的成品入库腿、步进调拨的入库腿、VMI 所有权转移的入库腿。
- **`IW-VAL-06`（配对异动后数量与价值必须守恒）**：配对异动完成后，该货品在该仓的
  `inventory` 数量与估值池数量必须相等，估值池价值不得因异动而减少。

#### 32.17.3 验收增量

1. 配对异动（以库存状态变更与直接调拨为样本）完成后：两条腿的事务行都是 `VALUED`，
   估值池数量与在库数量相等，价值守恒。
2. 配对异动的计值失败必须让异动整体失败，且**零副作用**（无库存 / 估值 / 事务 / 凭证新增）。
3. 多腿异动：每条腿的事务行都是 `VALUED`，且估值流水的归属逐腿正确。
4. 变异对照：把入账腿的承接去掉 → 「入账腿 `VALUED`」断言必须转红；
   把调拨的归属改回 OUT 腿 → 「调拨入账腿 `VALUED`」断言必须转红。
5. `pnpm test`、`pnpm build`、`git diff --check` 与两种文档一致性模式全部通过。

**Requirement 状态：`APPROVED`（2026-11-18，业务所有者授权）。Design §27.62：`APPROVED`（同日）。
Implementation：已实施（2026-11-18）；真实 MySQL 连接、数据库写操作、发布与部署**未授权**。**
### 32.18 单腿入库异动的入库价值（`APPROVED` → `IMPLEMENTED`，2026-11-18）

> **用途 / Owner / 状态 / 权威关系**：本节**有界解冻并修订** §32.17 `IW-VAL-05`（单腿入库异动的
> 残余清单），把「由调用方自持计值」从**登记**变成**已实施**，并把清单从 3 条扩到**穷尽枚举
> 得到的 5 条**。Owner 为 Inventory & Warehouse Domain Owner；组装 / 拆卸 / 步进调拨三域的
> 业务事实归各自主域，但**估值与自持计值的口径**由本域统一。生命周期状态 `IMPLEMENTED`
> （2026-11-18：合同已获批准并按已批准合同实施，**尚未验收**）。
> 对应 Design 见 `solution.md §27` → `docs/design/inventory-warehouse.md` §27.63。
> 本节**不取代** §32.1～§32.17 的任何正文；§32.17 的 `IW-VAL-01..04`、`IW-VAL-06` **未被修改**。
>
> **授权来源**：业务所有者 2026-11-18「将三项收口 然后将三项残余修复」（AGENTS.md §4.0
> 连续阶段授权），并就本节两项口径作出裁定：
> 1. VMI 收货入库腿的价值来源**复用** canonical 原语 `receivePositiveSourceValue`；
> 2. 穷尽枚举发现的另两条同缺陷类单腿入库腿（拆卸组件回收入库腿、步进调拨退回入库腿）
>    **一并纳入本轮**修复。

#### 32.18.1 事实基础（仓库代码穷尽枚举 + 客户测试环境实测，2026-11-18）

**穷尽枚举方法**：对 `server/modules/` 与 `server/lib/` 中**全部** `applyInventoryMutation` 的
`movementKind: 'IN'` 调用点逐一核对「该入库腿的估值由谁写入」，得到全量清单：

| # | 单腿入库流程 | 位置 | 入库腿估值来源（实施前） | 处置 |
|---|---|---|---|---|
| 1 | 期初入库 | `inventory-opening.js:154` | `receiveValue`（`inventory-opening.js:175`） | 已闭合 |
| 2 | 采购入库 | `purchase-receipt-engine.js:291` | `receiveSourceValue`（`:304`） | 已闭合 |
| 3 | 生产完工入库 | `production-workflow.js:190` | `receiveSourceValue`（`:194`） | 已闭合 |
| 4 | 销售退货 | `sales-return-canonical-writer.js:422` | `receiveValue`（`:441`） | 已闭合 |
| 5 | 库存调整（正向） | `inventory-stocktake.js:391` | `receivePositiveSourceValue` | 已闭合 |
| 6 | 调拨（配对异动） | `inventory-transfer.js:219` | 承接出库腿价值 | 已闭合 |
| 7 | 寄售收货 | `consignment.js:222` | `receiveValue` | 已闭合 |
| 8 | 委外收货 | `outsourcing-inventory.js:402` | `receiveValue`（`:415`） | 已闭合 |
| 9 | 委外期初 | `outsourcing.js:1547` | **有意不估**（期初价值口径属会计政策） | 范围外 |
| 10 | 生产副产品入库 | `production-workflow.js:318` | legacy `adjustInventory`（11 处 legacy 写入点之一） | 范围外 |
| 11 | **组装成品入库腿** | `inventory-assembly-disassembly.js:439` | **无** | **本节修复** |
| 12 | **拆卸组件回收入库腿** | `inventory-assembly-disassembly.js:466` | **无** | **本节修复**（穷尽枚举新增） |
| 13 | **步进调拨入库腿** | `inventory-step-transfer.js:127` | **无** | **本节修复** |
| 14 | **步进调拨退回入库腿** | `inventory-step-transfer.js:183` | **无** | **本节修复**（穷尽枚举新增；该函数当前**无路由**，见 §32.18.4） |
| 15 | **VMI 收货入库腿** | `procurement-vmi.js:211` | **无** | **本节修复**（§32.17 原文写的是「VMI 所有权转移的入库腿」，该写入点在代码中**不存在**，见 §32.18.3） |

**症状**：这 5 条流程的入库腿在 canonical 写入器的单腿 IN 分支里**不写估值流水**（该分支只处理
出库腿），因此入库腿的 `inventory_transactions.valuation_status` 停在 `LEGACY_UNVALUED`，
估值池**数量与价值都不增加** → `INVENTORY_QUANTITY_VS_VALUATION` 与 `LEGACY_UNVALUED_MOVEMENTS`
两个 BLOCKING 检查失配，权威结账无法关闭。

#### 32.18.2 合同条款

| ID | 条款 |
|---|---|
| `IW-SLV-01` | 只有入库腿、没有出库腿的异动，其入库价值**必须**由调用方按**权威成本**自持计值；写入器**不得**以「出库计值」推导（那会从目标池扣掉价值）。 |
| `IW-SLV-02` | **组装成品入库腿**的价值**必须**等于本次**组件出库**的权威账面价值合计（`issueValue` 的实际出库价值），**不得**用标准成本或估算值替代。 |
| `IW-SLV-03` | **拆卸组件回收入库腿**的价值**必须**取**母件出库**的权威账面价值，按各组件的应耗数量分摊；分摊尾差**必须**由最后一行吸收，使各组件价值合计**精确等于**母件出库价值。 |
| `IW-SLV-04` | **步进调拨入库腿与退回入库腿**的价值**必须**取**调出腿**的权威账面价值（同一批货在途前的账面单价 × 本次数量）。 |
| `IW-SLV-05` | **VMI 收货入库腿**的价值**必须**复用 canonical 原语 `receivePositiveSourceValue`：优先取该仓位上产品的既有账面单价，无则取冻结标准制造成本，两者皆无则维持既有未估值行为。**边界**：本条只闭合**子账口径**（数量与估值）；VMI 收货的**总账对方腿**（对供应商应付的确认时点）属 D-P01 未决范围，本节**不得**自行解释，见 §32.18.5 开放项 3。 |
| `IW-SLV-06` | 自持计值**必须**写入**权威估值流水 + 身份级估值池**（`receiveValue`），使入库腿的 `valuation_status` 变为 `VALUED`，且**估值池数量变化 == 在库数量变化**。 |
| `IW-SLV-07` | 自持计值**必须**与对应的库存位移处于**同一事务**：计值失败时整段回滚，**不得**留下「值离开来源池却不到目标池」的半成品。 |
| `IW-SLV-08` | 权威价值为 0（该货品**未进入估值口径**）时**不得**写入 0 值估值流水：该腿维持 `LEGACY_UNVALUED`，由关账异常清单标记；**不得**伪造「已估值」的假象。 |
| `IW-SLV-09` | **不得**改变这 5 条流程的**数量、身份、状态机、权限码、幂等键与 API 契约**；本节**只**新增估值结果。 |
| `IW-SLV-10` | 自持计值的实现**必须**只有**一处**（单一 canonical 原语 `receiveSingleLegInboundValue`），各流程**不得**各自内联一份计值算法。 |

#### 32.18.3 与 §32.17 `IW-VAL-05` 的修订（显式解冻）

| 项 | §32.17 原文 | 修订后 |
|---|---|---|
| 清单范围 | 组装拆卸的成品入库腿、步进调拨的入库腿、**VMI 所有权转移的入库腿** | 组装成品入库腿、**拆卸组件回收入库腿**、步进调拨入库腿、**步进调拨退回入库腿**、**VMI 收货入库腿** |
| VMI 的目标 | 「VMI 所有权转移的入库腿」 | 该写入点在代码中**不存在**：`transferVmiOwnership`（`procurement-vmi.js:306-313`）无条件抛 409 `VMI_SETTLEMENT_POLICY_PENDING`（政策 `VMI-05`，D-P01 `PENDING`）。本节**按代码现状**把目标修正为**VMI 收货入库腿**（`VMI_RECEIPT`，进入 SUPPLIER 所有权位）。所有权转移**不在**本节范围：其结算价依赖 D-P01 裁定，继续固定拒绝。 |
| 状态 | 「登记为残余并逐项列出」，**本轮不实现** | **已实施**（2026-11-18）：5 条流程全部具备权威入库价值 |

#### 32.18.4 明确不在本节范围内的事项

1. **步进调拨退回入库腿的路由**：`returnToSource`（`inventory-step-transfer.js:188`）当前**没有任何
   HTTP 路由**（zero-caller）。本节对该函数的自持计值修复是**预防性**的：一旦该路径被接线，
   其入库腿立即具备权威价值。**本节不新增路由**（新增路由是业务能力，需单独裁定）。
2. **委外期初的无估值行为**：`outsourcing.js:1547` 明写「不带估值金额（期初价值口径属会计政策）」，
   属既有裁定的范围外事项。
3. **生产副产品入库**：仍走 legacy `adjustInventory`（11 处 legacy 物理写入点之一，
   已在采购委外域 §31.21.4 登记），不在本节范围。
4. **VMI 收货的跟踪身份**：VMI 收货**不登记** LOT / SERIAL 身份，因此跟踪口径的货品**无法**在收货时
   确定身份级价值；本节只对移动加权口径货品计值（`IW-SLV-05`），跟踪口径维持既有未估值行为
   （登记为开放项，见 §32.18.5）。
5. **其它域的估值口径**：不在本节范围。

#### 32.18.5 未解决矛盾（需业务所有者裁定，本节不自行决定）

1. **VMI 收货的跟踪身份**：VMI 收货不登记身份，跟踪口径货品的入库价值无法归属到具体批次 /
   序列号。是否补齐 VMI 的跟踪身份登记（并据此支持身份级估值），留待后续裁定。
2. **步进调拨退回入库腿无路由**：是否为其补齐路由（以及它与普通调拨的关系），留待后续裁定。
3. ~~**VMI 收货的总账对方腿缺失**~~：**已闭合**（2026-11-18 业务所有者裁定 A「物权在收货时转移」，
   并由 Procurement & Outsourcing 域 §31.23 `PRC-VGL-01..08` / Design §26.44 实施）：
   收货确认存货与应付（`Dr 存货 / Cr 应付账款`），消耗对称冲销（`Dr 应付账款 / Cr 存货`）。
   本节 `IW-SLV-05` 只闭合**子账口径**，其**总账对方腿**由 §31.23 承接；两者合起来，
   VMI 收货与消耗在收货后与消耗后 `AP_TO_GL` 与 `INVENTORY_VALUE_TO_GL` **均为 0**。
   `D-P01` 的其余子题（结算窗口、结算数量口径、结算账单与付款机制）**仍然开放**。

#### 32.18.6 可验收条件

| ID | 验收条件 |
|---|---|
| `IW-SLV-AC-01` | 组装：成品入库腿 `valuation_status='VALUED'`，其估值流水金额 = 本次组件出库的权威账面价值合计；成品仓位的估值池数量变化 == 在库数量变化。 |
| `IW-SLV-AC-02` | 拆卸：组件回收入库腿 `valuation_status='VALUED'`，其估值流水金额合计 = 母件出库的权威账面价值（按数量分摊，尾差由最后一行吸收）。 |
| `IW-SLV-AC-03` | 步进调拨入库：入库腿 `valuation_status='VALUED'`，其估值流水金额 = 调出腿的权威账面价值（按数量比例）；目标仓位的估值池数量变化 == 在库数量变化。 |
| `IW-SLV-AC-04` | VMI 收货：收货腿 `valuation_status='VALUED'`，其估值流水金额 > 0（既有账面单价或冻结标准成本）。**本条只证明子账口径闭合**；总账对方腿缺失另见 §32.18.5 开放项 3。 |
| `IW-SVL-AC-05` | 未进入估值口径的货品：入库腿**仍**为 `LEGACY_UNVALUED` 且**不**产生 0 值估值流水（`IW-SLV-08`）。 |
| `IW-SLV-AC-06` | 回归：组装 / 拆卸 / 步进调拨 / VMI 的既有测试全部保持通过；`IW-SLV-09` 所列各项行为**逐项不变**。 |

**Requirement 状态：`APPROVED`（2026-11-18，业务所有者授权）。Design §27.63：`APPROVED`（同日）。
Implementation：已实施（2026-11-18）；真实 MySQL 连接、数据库写操作、Acceptance / Freeze 签发、
发布与部署**未授权**。**

