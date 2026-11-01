# Inventory & Warehouse — Requirement

> 状态：`ACTIVE`
> Owner：Inventory & Warehouse
> 权威来源：`document.md` §32
> 来源：`document.md` §32（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## 32. Inventory & Warehouse Domain Closure Requirement

> 本节固化 Inventory & Warehouse Domain Closure 的 Requirement 阶段成果。
>
> **Manual Evidence Baseline：**
> Primary = `B3104 库存管理`；Secondary = `B3105 条码管理`（仅取 Inventory/Warehouse 所属能力）。
> Boundary 手册 = `B3101` Procurement / `B3102` Sales / `B3106` Inventory Costing / `B3119` Manufacturing / `B3120` Planning / `B3121` Outsourcing，仅用于确定接口；不得重新打开冻结业务域。
>
> **本节 Coverage 以 Inventory & Warehouse Audit PASS 为准：**
> Audit = `PASS`；Requirement capability set = 44；Owner accounting = 40 Domain-Owned + 4 Integration-Backed；Requirement Only；Design 未开始；Implementation 未开始。
>
> Design 见 `solution.md §27`（待用户 PASS 后展开）；本阶段不进入 Design / Implementation / Migration / API / UI / Test 任一阶段。
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
