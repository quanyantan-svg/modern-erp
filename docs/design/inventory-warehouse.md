# Inventory & Warehouse — Technical Design

> 状态：`ACTIVE`
> Owner：Inventory & Warehouse
> 权威来源：`solution.md` §27
> 来源：`solution.md` §27（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）
> 2026-11-14：业务所有者批准 Requirement §32.12 与新增 §27.56（Design `APPROVED`）并授权实施；
> 既有域级 Acceptance / Freeze 仅作有界解冻。

## 27. Inventory & Warehouse Domain Technical Design

> 本节固化 Inventory & Warehouse Domain Closure 的 Design 阶段成果。Requirement 见 `document.md §32`；Audit 见本次会话的 `INVENTORY & WAREHOUSE DOMAIN FINAL AUDIT REPORT`（`PASS`）。Manual Evidence Baseline 来自上游已批准的 `B3104 库存管理` + `B3105 条码管理`（Inventory/Warehouse 所属能力）。
>
> 本节不进入 Implementation / Migration / API / UI / Test；仅按 §27.1–§27.28 形成可实施技术方案，等待用户 `DESIGN PASS`。

### 27.1 Architecture / Ownership

`server/app.js` 仍承担 HTTP route + auth + thin dispatch。Inventory & Warehouse Domain 的业务逻辑按 canonical identity / mutation contract / source-target identity / transaction ownership / testability 拆分到以下模块：

```text
server/lib/inventory-position.js       (NEW, Wave A)
  canonical physical position identity;
  position_key deterministic hash;
  legacy warehouse+product read compatibility;

server/lib/inventory-mutation.js       (NEW, Wave B)
  single authoritative mutation service contract;
  applyInventoryMutation(...) dispatcher;
  atomic transaction with full validation;

server/lib/inventory-availability.js   (NEW, Wave B)
  ON_HAND / LOCKED / RESERVED / AVAILABLE projection;
  position-level + planning-level;
  reads canonical positions + active locks + active reservations;

server/modules/inventory-parameters.js       (NEW, Wave A)
server/modules/warehouse-master.js           (NEW, Wave A; EXTEND existing warehouse CRUD)
server/modules/warehouse-bin.js              (NEW, Wave A)
server/modules/stock-status.js               (NEW, Wave A)
server/modules/owner-dimension.js            (NEW, Wave A; UNBLOCKS VMI/Outsourcing)
server/modules/inventory-transfer.js         (NEW, Wave B; EXTEND existing transfer)
server/modules/inventory-step-transfer.js    (NEW, Wave B)
server/modules/inventory-lock.js             (NEW, Wave B)
server/modules/inventory-availability.js     (NEW, Wave B; thin wrapper)
server/modules/inventory-opening.js          (NEW, Wave C)
server/modules/inventory-native-document.js (NEW, Wave C; OTHER_RECEIPT/OTHER_ISSUE)
server/modules/inventory-stock-status-mutation.js (NEW, Wave C)
server/modules/inventory-lot-adjustment.js  (NEW, Wave C)
server/modules/inventory-form-conversion.js  (NEW, Wave C)
server/modules/inventory-assembly-disassembly.js (NEW, Wave C; consumes Engineering BOM)
server/modules/inventory-adjustment-scrap.js     (NEW, Wave C; convergence of existing)
server/modules/inventory-stocktake.js        (NEW, Wave C; EXTEND existing inventory_checks)
server/modules/inventory-barcode.js          (NEW, Wave D)
server/modules/inventory-scan-adapter.js     (NEW, Wave D)
server/modules/inventory-container.js        (NEW, Wave D)
server/modules/inventory-reports.js          (NEW, Wave D; aggregates + ledger + aging + alerts)
server/modules/inventory-period-close.js     (EXTEND, Wave D)
```

保留既有（**不得重写**，仅 EXTEND / INTEGRATE）：

- `server/lib/stock.js::adjustInventory` — 在 §27.43.1 Atomic Legacy Cutover 之前，**不得**作为通用 inventory writer；activation gate 之后必须替换为 `applyInventoryMutation` 或降级为 compatibility adapter（仅 ENTERPRISE owner + AVAILABLE + NULL bin + no tracking）；
- `inventory_mutation.js::applyInventoryMutation` — 唯一 canonical inventory writer（§27.6 / §27.8 / §27.43.1）；
- `server/db.js::PERMISSIONS` — additive 扩展 `INVENTORY_*` family（不重命名既有权限）；
- `server/db.js::PERMISSIONS` — additive 扩展 `INVENTORY_*` family（不重命名既有权限）；
- `server/lib/audit.js` — 复用；
- `server/lib/http.js` — 复用；
- `server/lib/payment-terms.js` — 与本 Domain 无关，保留；
- `server/modules/financial-inventory.js::receiveValue / issueValue / allocateProportionalCents / createSystemVoucher / inventoryAccountRole / assertFinancialPeriodsOpen` — 复用为 Finance/Inventory Costing canonical valuation evidence；
- `server/modules/inventory-extensions.js`（Inventory Scrap） — 收敛到 mutation contract；
- `server/modules/inventory-period-close.js` — EXTEND；
- `server/modules/traceability-quality.js` — LOT/SERIAL canonical 不重写；
- `server/modules/procurement-vmi.js` — 删除 `assertInventoryOwnerDimension` 阻断；VMI 物理层改经 `owner-dimension.js`；
- `server/modules/outsourcing-materials.js` — Issue/Supplement/Return/Backflush 改经 `inventory-mutation.js`，保持 canonical Outsourcing Order semantics；
- `server/modules/planning-domain.js` — Reservation 不变；Inventory 通过 `inventory-availability.js` 读 reservation 形成 projection，不复制 reservation engine；
- `server/modules/engineering-bom.js` / `engineering-configurable-bom.js` — INV-17 Assembly/Disassembly 消费 Engineering resolver；
- `server/modules/quality-gates.js` / `authoritative-quality.js` — 触发 stock-status mutation 但不复制 Quality inspection decision。

### 27.43.2 Runtime Writer Convergence (2026-10-10 closing pass)

`server/lib/stock.js::adjustInventory` is the strict-canonical compatibility adapter
for legacy physical writers. It is now:

- bound to the frozen default identity (owner=ENTERPRISE, owner_id=NULL,
  stock_status=AVAILABLE, bin=NULL, lot=NULL, serial=NULL);
- executed as `ON CONFLICT(position_key) DO UPDATE` (never
  `ON CONFLICT(warehouse_id, product_id)`);
- refusing to operate on bin-enabled warehouses or LOT/SERIAL-tracked
  products, returning a clear 400 error instructing the caller to migrate
  to `applyInventoryMutation`.

A sibling `setInventoryQuantity(...)` is the strict-absolute writer for
inventory check approval, lifecycle cleanup, opening batch, and return
reversal — it writes at the same canonical default position and refuses
non-default identities.

All five direct `UPDATE inventory` / `INSERT INTO inventory` writers in
production code are converged:

- `server/app.js:3621` confirmInventoryCheck          → setInventoryQuantity
- `server/modules/financial-controls.js:331-32` reverseSalesOrPurchaseReturn → setInventoryQuantity + SUM read
- `server/modules/lifecycle-engine.js:805` applyInventoryCleanup → setInventoryQuantity
- `server/modules/outsourcing-finance.js:130/274` outsourcing receipt / return → adjustInventory
- `server/modules/commercial-golive.js:269` postOpening → setInventoryQuantity

Read paths in the reversal logic (`server/app.js:3890`) and the outsourcing
finance writes now `SELECT COALESCE(SUM(quantity),0) ... AND active=1` so
that a future bin/lot split cannot silently lose stock.

`server/lib/inventory-mutation.js::applyInventoryMutation` now detects
whether an outer `transaction()` is already open and skips its own
`transaction(...)` wrapper. This unblocks the Wave E owner-dimension flows
(VMI receipt / consumption / ownership transfer) which are routed through
the dispatcher from inside an outer `transaction(...)`.

The single canonical test fixture writer is
`server/test-support/inventory-canonical-fixture.js::upsertCanonicalInventory`.
It writes with `ON CONFLICT(position_key) DO UPDATE` and accepts an
optional `rowId` for tests that query by id. All 11 test files that
inserted inventory rows with raw SQL are migrated to this helper.

The demo seed in `server/db.js::seedDemoData` now writes explicit `id`
values for inventory rows. The `position_key` migration backfill still
populates `position_key` for these rows at first createDatabase run;
the explicit id is required so that subsequent position-key aware
updates can find the row by id (TEXT PRIMARY KEY has no auto-increment).

### 27.2 Canonical Inventory Identity

最终 physical inventory position identity 由以下维度构成：

```text
product_id        (NOT NULL, FK products.id)
warehouse_id      (NOT NULL, FK warehouses.id)
bin_id            (NULLABLE, FK warehouse_bins.id; 仅 bin-enabled warehouse)
owner_type        (NOT NULL, CHECK IN ('ENTERPRISE','SUPPLIER','CUSTOMER'))
owner_id          (NULLABLE if ENTERPRISE singleton; else FK polymorphic)
stock_status      (NOT NULL, FK inventory_stock_statuses.code)
lot_id            (NULLABLE, FK inventory_lots.id; 仅 LOT tracking)
serial_id         (NULLABLE, FK inventory_serials.id; 仅 SERIAL tracking)
```

每维定义：

| 维度 | nullable? | required? | canonical owner | validation source |
|---|---|---|---|---|
| product_id | NO | YES | Master Data | products.active=1 |
| warehouse_id | NO | YES | Inventory (warehouse master) | warehouses.active=1 |
| bin_id | YES | 仅当 `warehouse.bin_enabled=1` | Inventory (warehouse_bin) | warehouse_bins.active=1 AND warehouse_id match |
| owner_type | NO | YES | Inventory (owner_dimension) | enum check |
| owner_id | YES | ENTERPRISE = NULL；SUPPLIER / CUSTOMER = required | Inventory (polymorphic) | suppliers.active=1 / customers.active=1 |
| stock_status | NO | YES，默认 `AVAILABLE` | Inventory (stock_status) | inventory_stock_statuses.active=1 |
| lot_id | YES | 仅当 `product.tracking_policy='LOT'` 或 `'SERIAL'` | Tracking (inventory_lots) | inventory_lots.product_id match |
| serial_id | YES | 仅当 `product.tracking_policy='SERIAL'` | Tracking (inventory_serials) | inventory_serials.product_id match |

Enterprise singleton：owner_type='ENTERPRISE' 时 owner_id 必须为 NULL（不得伪装为 ENTERPRISE+某 id）。

必须支持的 4 种 owner × warehouse 组合：

```text
Enterprise-owned @ Enterprise warehouse
Enterprise-owned @ Supplier-WIP warehouse   (warehouses.is_supplier_wip=1)
Supplier-owned   @ Enterprise warehouse     (VMI)
Customer-owned   @ Enterprise warehouse     (entrusted material)
```

### 27.3 position_key — Portable Unique Identity

不依赖 `UNIQUE(nullable_col_1, nullable_col_2 ...)`。SQLite / MySQL 的 NULL uniqueness 行为不可移植。

采用规范化 position_key：

```text
position_key = SHA-256(
  normalize(product_id)              + '|'
  + normalize(warehouse_id)          + '|'
  + 'BIN:'     + (bin_id     ?? 'NULL') + '|'
  + 'OWNER:'   + owner_type   + ':' + (owner_id ?? 'NULL') + '|'
  + 'STATUS:'  + stock_status + '|'
  + 'LOT:'     + (lot_id     ?? 'NULL') + '|'
  + 'SERIAL:'  + (serial_id  ?? 'NULL')
)
```

规范化：

- 全部维度先 trim、ASCII 小写、长度限制（id ≤ 128 字符）；
- nullable 维度用 sentinel `'NULL'` 替换；
- 所有字符 `|` 不允许出现在 id 内部（canonical id 输入校验）；
- SHA-256 十六进制 64 字符。

约束：

```text
SQLite / MySQL deterministic (同一 tuple → 同一 hash)
collision checked (inventory.position_key UNIQUE)
index length safe (CHAR(64) 上索引；avoid TEXT PRIMARY KEY for hash)
no partial unique-index dependency
```

物理 schema mapping（index-safe）：

```text
SQLite:  position_key TEXT NOT NULL UNIQUE
         (length / lowercase-hex validation in application code)
MySQL:   position_key CHAR(64) NOT NULL UNIQUE
         (不允许 TEXT UNIQUE；CHAR(64) 提供 fixed-length index)
```

实现：`server/lib/inventory-position.js::computePositionKey(productId, warehouseId, binId, ownerType, ownerId, stockStatus, lotId, serialId)` 唯一公开函数。

Owner 输入 application-level referential validation（mutation contract 入口）：

```text
ENTERPRISE  → owner_id MUST be NULL
SUPPLIER    → owner_id MUST reference active supplier (suppliers.active=1)
CUSTOMER    → owner_id MUST reference active customer (customers.active=1)
```

违反任一 → `mutation contract` 入口 reject，不得写 inventory。

### 27.4 Canonical Physical Balance

唯一 canonical physical balance 仍由现有 `inventory` 表承载。演进方案：

- 新增 additive 列：
  ```text
  inventory.position_key       TEXT NOT NULL        (UNIQUE; MySQL CHAR(64))
  inventory.bin_id             TEXT                  (NULLABLE)
  inventory.owner_type         TEXT NOT NULL DEFAULT 'ENTERPRISE'
  inventory.owner_id           TEXT                  (NULLABLE)
  inventory.stock_status       TEXT NOT NULL DEFAULT 'AVAILABLE'
  inventory.lot_id             TEXT                  (NULLABLE)
  inventory.serial_id          TEXT                  (NULLABLE)
  inventory.active             INTEGER NOT NULL DEFAULT 1
  ```
- `inventory` 表**只**保存 physical quantity + dimensions；**不**保存 lock state；
- Lock 唯一 truth = `inventory_locks`（§27.15），与 inventory.position_key 通过 application-level aggregate 关联；
- 既有 `UNIQUE(warehouse_id, product_id)` 演进为 `UNIQUE(position_key)`；
- 既有数据 migration：见 §27.5 Legacy Migration Rules。

不建立第二套 inventory balance 表。`inventory` 仍是唯一 authoritative physical balance。

### 27.5 Legacy Migration Rules

#### NONE tracking 旧库存

```text
warehouse_id + product_id + qty
```

迁移为：

```text
owner_type   = 'ENTERPRISE'
owner_id     = NULL
stock_status = 'AVAILABLE'
bin_id       = NULL  (legacy default)
lot_id       = NULL
serial_id    = NULL
position_key = SHA-256(...)
```

新增 `(warehouse_id, product_id, position_key)` 索引保留 query compatibility。

#### LOT tracking 旧库存

```text
SUM(inventory_lot_balances.quantity)
    WHERE warehouse_id=? AND product_id=?
=
legacy inventory.quantity
```

不一致 → `FAIL CLOSED`，不得自动修平。

#### SERIAL tracking 旧库存

基于当前 `inventory_serials.current_warehouse_id` 派生 position。一条 active serial = 一个 physical unit。

`SUM(serial count)` 与 `inventory.quantity` 不一致 → `FAIL CLOSED`。

#### 历史 records

旧 `inventory_transactions` 若无 `bin / owner / status / lot / serial` 列：

- 展示时显示 `historical dimension unavailable`；
- 不允许 retroactive fabricate dimensions；
- 新 movement 必须保存完整 dimension snapshot（见 §27.6）。

### 27.6 Canonical Inventory Mutation Contract

唯一 mutation dispatcher：

```text
server/lib/inventory-mutation.js::applyInventoryMutation(input)
```

`input` 至少含：

```text
sourceType       TEXT      -- 'PURCHASE_RECEIPT' / 'PRODUCTION_RECEIPT' / 'OUTSOURCING_RECEIPT'
                              / 'SALES_DELIVERY' / 'OTHER_RECEIPT' / 'OTHER_ISSUE'
                              / 'INVENTORY_TRANSFER' / 'INVENTORY_STEP_TRANSFER_IN'
                              / 'INVENTORY_STOCK_STATUS_CHANGE' / 'INVENTORY_LOT_ADJUSTMENT'
                              / 'INVENTORY_FORM_CONVERSION' / 'INVENTORY_ASSEMBLY'
                              / 'INVENTORY_DISASSEMBLY' / 'INVENTORY_ADJUSTMENT'
                              / 'INVENTORY_SCRAP' / 'INVENTORY_STOCKTAKE_DIFF'
                              / 'VMI_RECEIPT' / 'VMI_CONSUMPTION' / 'VMI_OWNERSHIP_TRANSFER'
                              / 'OUTSOURCING_ISSUE' / 'OUTSOURCING_RETURN' / 'OUTSOURCING_RECEIPT'
                              / 'ENTRUSTED_RECEIPT' / 'ENTRUSTED_ISSUE'
                              / 'BARCODE_SCAN_CONFIRM'
sourceId         TEXT
sourceItemId     TEXT
businessDate     TEXT
actor            OBJECT
movementGroup    TEXT       -- correlation id
movementKind     TEXT       -- IN / OUT / MOVE / OWNER_CHANGE / STATUS_CHANGE / LOT_RECLASS / BIN_MOVE / ADJUSTMENT
quantity         REAL
fromPosition     OBJECT     -- {product_id, warehouse_id, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id}
toPosition       OBJECT     -- 同结构；多 destination 时数组形式
tracking         OBJECT     -- {lotAllocations:[], serialAllocations:[]}
idempotencyKey   TEXT       -- UNIQUE
```

返回：

```text
movementId        TEXT
movementGroupId   TEXT
balanceAfter      OBJECT     -- 每个 position_key 的新 on_hand
inventoryTransactions[]  -- 写入的 inventory_transactions rows
trackedMovements[]       -- 写入的 tracked_inventory_movements rows
audit             OBJECT
```

Movement kinds 与对应实现：

| Movement | Source types | 语义 |
|---|---|---|
| IN | PURCHASE_RECEIPT / PRODUCTION_RECEIPT / OUTSOURCING_RECEIPT / OTHER_RECEIPT / VMI_RECEIPT / ENTRUSTED_RECEIPT | toPosition.quantity ↑ |
| OUT | SALES_DELIVERY / PRODUCTION_ISSUE / OUTSOURCING_ISSUE / OTHER_ISSUE / VMI_CONSUMPTION / ENTRUSTED_ISSUE / INVENTORY_SCRAP | fromPosition.quantity ↓ |
| MOVE | INVENTORY_TRANSFER / INVENTORY_STEP_TRANSFER_IN | fromPosition ↓ + toPosition ↑；tracking identity 守恒 |
| OWNER_CHANGE | VMI_OWNERSHIP_TRANSFER / OUTSOURCING_RECEIPT_FG_OWNER | fromPosition ↓ + toPosition ↑；location 不变 |
| STATUS_CHANGE | INVENTORY_STOCK_STATUS_CHANGE | fromPosition ↓ + toPosition ↑；quantity / location / owner 守恒 |
| LOT_RECLASS | INVENTORY_LOT_ADJUSTMENT | fromPosition ↓ + toPosition ↑；total quantity 守恒 |
| BIN_MOVE | INVENTORY_BIN_MOVE | fromPosition ↓ + toPosition ↑；owner / status / lot / serial 守恒 |
| ADJUSTMENT | INVENTORY_ADJUSTMENT / INVENTORY_STOCKTAKE_DIFF | fromPosition 或 newPosition 单边；记录 diff 原因 |

Movement evidence 物理方向强制不变（与既有 `inventory_transactions` / `tracked_inventory_movements.direction` 兼容）：

```text
tracked_inventory_movements.direction    = 'IN'  | 'OUT'    (NOT 'MOVE')

业务 mutation 类型通过：
  tracked_inventory_movements.movement_kind     = IN | OUT | MOVE | OWNER_CHANGE
                                                | STATUS_CHANGE | LOT_RECLASS
                                                | BIN_MOVE | ADJUSTMENT
  tracked_inventory_movements.movement_group_id = G_uuid
```

对 paired mutation（MOVE / BIN_MOVE / OWNER_CHANGE / STATUS_CHANGE / LOT_RECLASS）：

```text
source position row:      direction = OUT   movement_kind = <业务类>   movement_group_id = G_new
destination position row: direction = IN    movement_kind = <业务类>   movement_group_id = G_new
```

同一 transaction 内提交；quantity 守恒；position_key 来自 toPosition / fromPosition。


### 27.7 Mutation Atomicity

一次 mutation transaction 内顺序：

```text
1. assertFinancialPeriodsOpen(businessDate)             -- §27.16
2. validate master dimensions
   - product / warehouse / bin / owner / status / lot / serial 全部存在且 active
3. validate owner reference
   - SUPPLIER → suppliers.active=1
   - CUSTOMER → customers.active=1
   - ENTERPRISE → owner_id must be NULL
4. validate tracking
   - LOT product 必须传 lotAllocations
   - SERIAL product 必须传 serialAllocations
   - NONE product 不得传 tracking
5. lock source position via SELECT ... FOR UPDATE (MySQL) / BEGIN IMMEDIATE (SQLite)
   - 锁顺序见 §27.17
6. validate available physical quantity
   - read current on_hand at fromPosition
   - for OUT / MOVE / OWNER_CHANGE: fromPosition.quantity ≥ requested
   - for IN / status change into new status: toPosition must be valid
   - for OWNER_CHANGE: 必须先 read 当前 owner，确认 requested transition 合法
7. apply canonical inventory
   - per fromPosition: UPDATE inventory SET quantity = quantity - x WHERE position_key = ?
   - per toPosition: UPSERT position_key SET quantity = quantity + x
   - LOT/SERIAL: post tracked_inventory_movements + tracked_source_allocations
   - in-transit: write inventory_step_transfer_in_transit 表
8. write inventory_transactions row(s)
   - business_date / source_type / source_id / source_item_id / direction / balance_after / quantity_change / position_key
9. invoke existing valuation integration
   - financial-inventory.js::receiveValue / issueValue (cents, INTEGER safe)
10. audit
    - audit(actor, 'INVENTORY_MUTATION', sourceType/sourceId, payload)
11. commit
```

任一失败 → `zero side effects`（事务整体 rollback）。

并发安全：

- 同一 `(sourceType, sourceId, sourceItemId, idempotencyKey)` 二次提交 → 返回已有 movementId，不重复写（**portable**：直接 plain UNIQUE on idempotency_key）；
- tracked movement 是 mutation subordinate evidence：
  - 不使用 MySQL-incompatible partial unique index（`WHERE reversed=0`）；
  - 使用普通 composite UNIQUE：`UNIQUE(movement_id, allocation_identity)` 或 `UNIQUE(source_type, source_id, source_item_id, lot_id, serial_id, direction)`（无 `WHERE` 子句）；
  - reversal 通过显式 `reversal_of_movement_id` 关系 + 新的 reversal movement 表达，**不**依赖 partial unique index；
- 同一 position 多次 mutation 由 row-lock 串行化。

### 27.8 No Direct Inventory Writes

Implementation closure 后，新业务代码不得直接 `UPDATE inventory SET quantity = ?`。

只有以下调用方允许写 inventory：

```text
server/lib/inventory-mutation.js::applyInventoryMutation   (唯一入口)
server/lib/stock.js::adjustInventory                        (binary compatible wrapper, 由 migration period 收敛)
server/lib/stock.js 仅作为短时兼容 wrapper 保留，内部调 applyInventoryMutation
```

既有冻结域（Procurement / Sales / Manufacturing / Outsourcing / Planning / Quality）通过 adapter 接入：

```text
Procurement Receipt       → applyInventoryMutation(IN)
Production Receipt        → applyInventoryMutation(IN)
Sales Delivery            → applyInventoryMutation(OUT)
Production Material Issue → applyInventoryMutation(OUT)
Outsourcing Material Issue → applyInventoryMutation(OUT, owner ENTERPRISE, location supplier-WIP)
Outsourcing Receipt       → applyInventoryMutation(IN, owner ENTERPRISE, location enterprise warehouse)
VMI Receipt               → applyInventoryMutation(IN, owner SUPPLIER, location enterprise warehouse)
VMI Consumption           → applyInventoryMutation(OUT, owner SUPPLIER, location enterprise warehouse)
VMI Ownership Transfer    → applyInventoryMutation(OWNER_CHANGE)
Entrusted Receipt         → applyInventoryMutation(IN, owner CUSTOMER, location enterprise warehouse)
Entrusted Issue           → applyInventoryMutation(OUT, owner CUSTOMER)
Inventory Scrap           → applyInventoryMutation(OUT, ADJUSTMENT-like)
Inventory Adjustment      → applyInventoryMutation(ADJUSTMENT)
Stocktake Difference      → applyInventoryMutation(ADJUSTMENT, INVENTORY_STOCKTAKE_DIFF)
Direct Transfer           → applyInventoryMutation(MOVE)
Step Transfer Out         → applyInventoryMutation(OUT, intoStepTransferInTransit=true)
Step Transfer In          → applyInventoryMutation(IN, fromStepTransferInTransit)
Status Change             → applyInventoryMutation(STATUS_CHANGE)
Lot Adjustment            → applyInventoryMutation(LOT_RECLASS)
Bin Move                  → applyInventoryMutation(BIN_MOVE)
Form Conversion           → applyInventoryMutation(MOVE / ADJUSTMENT, by conversion type)
Assembly / Disassembly    → applyInventoryMutation(MOVE) consumed components + produced parent
```

不重写既有的 Procurement / Sales / Production / Outsourcing / Planning / Quality business document。Adapter 只在 mutation contract 接入点替换。

### 27.9 Warehouse / Bin

```text
warehouses 表 EXTEND：
  bin_enabled              INTEGER NOT NULL DEFAULT 0
  is_supplier_wip          INTEGER NOT NULL DEFAULT 0   -- 标识供应商 WIP 仓
  negative_stock_policy    TEXT    NOT NULL DEFAULT 'BLOCK'  -- BLOCK / ALLOW / WARNING
  mrp_participation        INTEGER NOT NULL DEFAULT 1
  inventory_lock_enabled   INTEGER NOT NULL DEFAULT 1

warehouse_bins 表 (NEW)：
  id TEXT PRIMARY KEY
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id)
  code TEXT NOT NULL
  name TEXT NOT NULL
  active INTEGER NOT NULL DEFAULT 1
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
  UNIQUE(warehouse_id, code)
```

规则：

```text
bin_enabled=0 warehouse → bin_id 必须 NULL；mutation 接受 NULL bin
bin_enabled=1 warehouse → bin_id 必须 reference active bin 同 warehouse
```

Warehouse deactivation 检查：

```text
SUM(on_hand) > 0                 → reject
open movement (DRAFT / SUBMITTED / APPROVED) → reject
open stocktake (DRAFT / SUBMITTED / APPROVED) → reject
active bin dependencies         → reject
```

### 27.10 Owner Dimension

枚举：

```text
ENTERPRISE    -- owner_id 必须 NULL；本企业所有
SUPPLIER      -- owner_id reference suppliers.active=1
CUSTOMER      -- owner_id reference customers.active=1
```

不复制 Supplier / Customer master。`owner_id` 是 polymorphic FK，application-level referential validation 在 mutation contract 入口做。

VMI SUPPLIER-owned @ Enterprise warehouse 与 Enterprise-owned @ Supplier-WIP warehouse 在位置上是同一个 warehouse 但 owner 不同，必须由 position_key 区分。

`INVENTORY_OWNER_DIMENSION_UNAVAILABLE` 必须替换为真实 mutation。`assertInventoryOwnerDimension` 必须删除。

### 27.11 Stock Status

canonical 表 `inventory_stock_statuses`：

```text
code TEXT PRIMARY KEY     -- 'AVAILABLE' / 'HOLD' / 'BLOCKED' / 'INSPECTION' / 'QUARANTINE' ...
name TEXT NOT NULL
active INTEGER NOT NULL DEFAULT 1
```

至少包含：

```text
AVAILABLE         -- 可预订 / 可发料 / 可发货 / 可调拨
INSPECTION        -- 待检；Quality inspection decision pending
QUARANTINE        -- 隔离；不得 issue / ship / transfer
HOLD              -- 锁定业务用途
BLOCKED           -- 物理禁用
```

每状态必须明确 4 个 flag：

```text
reservable      INTEGER NOT NULL DEFAULT 0   -- AVAILABLE=1，其余 0
issuable        INTEGER NOT NULL DEFAULT 0   -- AVAILABLE=1，其余 0
shippable       INTEGER NOT NULL DEFAULT 0   -- AVAILABLE=1，其余 0
transferable    INTEGER NOT NULL DEFAULT 0   -- AVAILABLE / HOLD 之外需 1，按业务定义
```

默认 seed：

```text
AVAILABLE       reservable=1 issuable=1 shippable=1 transferable=1
INSPECTION      reservable=0 issuable=0 shippable=0 transferable=0
QUARANTINE      reservable=0 issuable=0 shippable=0 transferable=0
HOLD            reservable=0 issuable=0 shippable=0 transferable=1
BLOCKED         reservable=0 issuable=0 shippable=0 transferable=0
```

Quality inspection decision 触发 status change：

```text
PASS → AVAILABLE
FAIL → QUARANTINE
WAIVED → AVAILABLE
PENDING → INSPECTION (default)
```

Inventory 是 stock status canonical owner；Quality 是 inspection decision owner。

### 27.12 LOT / SERIAL Convergence

`inventory_lots.status` (`AVAILABLE / HOLD / CONSUMED / DELIVERED / SCRAPPED`) 与 `inventory_serials.lifecycle_state` (同枚举) 已存在。

不得引入第二个 stock status truth。

明确分层：

```text
canonical stock status        = inventory_stock_statuses.code
  -- 影响 availability / issue / shipment / transfer / reservation
  -- INV-04 / INV-19

tracking identity lifecycle   = inventory_lots.status / inventory_serials.lifecycle_state
  -- 表示该 LOT / SERIAL identity 自身是否还存在
  -- 由 canonical tracking lifecycle rules 推导（不是仅由 balance 归零）
```

禁止将 `inventory_lots.status` 与 `inventory_stock_statuses.code` 合并为同一字段。两者语义不同。

#### Position 归零 ≠ identity 终结

LOT 可能跨多个 warehouse / position 存在，因此某一 position 归零**不代表**整个 LOT identity 已结束。

SERIAL 的业务 disposition 也必须根据真实 movement / source 判断，而不是统一写 `DELIVERED`。

明确规则：

```text
physical depletion (某 position 数量归零)
  → balance quantity changes
  → tracked_inventory_movements / inventory_transactions 记录

tracking identity lifecycle 变化
  → 仅通过 canonical tracking lifecycle rules 触发
  → 必须基于真实 movement / source 推导
  → 不能因为某个 position 的 quantity 归零而自动设 DELIVERED / CONSUMED / SCRAPPED

LOT 全部消耗
  → 仅当 inventory_lot_balances 中该 lot_id 在所有 warehouse × product 维度下 sum 为 0
     且最近一次 movement 是真实 consumption / scrap
     才能由 tracking lifecycle rules 推进到 DELIVERED / CONSUMED / SCRAPPED

SERIAL 终结
  → 仅当 inventory_serials.lifecycle_state 由真实 consumption / scrap / ownership-transfer movement 推导
  → 不能简单因为 current_warehouse_id 清空 或 quantity 归零 而设 DELIVERED
```

#### Domain 5 不重写 Domain 2 冻结的 tracking lifecycle

Domain 5（Inventory & Warehouse）必须**不**重新定义 Domain 2（Manufacturing & Quality）已冻结的 `inventory_lots.status` / `inventory_serials.lifecycle_state` 状态机：

- `inventory_lots.status` 状态机 / transition 规则 / event 由 Master & Engineering 或 Manufacturing & Quality Domain 拥有；
- `inventory_serials.lifecycle_state` 同上；
- Inventory 仅**消费**已发布的 tracking identity 状态作 availability / issue / shipment 校验；
- 任何 Inventory mutation 触发的 lifecycle transition 必须走既有 tracking rules（Master & Engineering / Manufacturing & Quality 暴露的 helper 或 transition），不得绕过。

Domain 2 现有 consumer 仍读 `inventory_lots.status` 用于 LOT 主数据查询；新增 availability / issue / shipment 检查从 `inventory_stock_statuses.code`。

### 27.13 Availability Model

#### Position-level

```text
position_eligible_on_hand   = SUM(inventory.quantity)
                              WHERE position_key = ? AND active=1
                              AND stock_status='AVAILABLE'
                              AND (expiry_date IS NULL OR expiry_date > today)

active_locks                = SUM(inventory_locks.remaining_qty)
                              WHERE position_key = ? AND status='ACTIVE'

position_free_physical      = position_eligible_on_hand - active_locks
```

`position_free_physical` 是该 position 当前真实可用的 physical quantity（不包含 lock 占用的部分）。

#### Planning-level（与 Planning frozen reservation types 一致）

Planning reservation 三种 frozen types：

```text
STRONG   -- frozen by Planning；MRP/人工建立；firm supply 不能覆盖
WEAK     -- frozen by Planning；MRP 建立；可按 Planning policy 释放
MANUAL   -- frozen by Planning；人工建立；无现存 supply 时指定 expected supply + release date
```

基于这三类，规划层 availability 显式拆为三个聚合量：

```text
active_reserved_total   = SUM(planning_reservations.quantity)
                          WHERE status='ACTIVE'
                          AND reservation_type IN ('STRONG','WEAK','MANUAL')

hard_reserved           = SUM(planning_reservations.quantity)
                          WHERE status='ACTIVE'
                          AND reservation_type IN ('STRONG','MANUAL')

soft_reserved           = SUM(planning_reservations.quantity)
                          WHERE status='ACTIVE'
                          AND reservation_type = 'WEAK'
```

进一步得到：

```text
warehouse/product eligible physical stock
  = SUM(position_free_physical)
    WHERE product_id = ? AND warehouse_id IN (scheme.warehouses)
    AND owner_type IN ('ENTERPRISE', scheme-eligible SUPPLIER)

physical_free                       = warehouse/product eligible physical stock

available_for_new_reservation       = physical_free - active_reserved_total
                                    -- 新建 reservation 时可用预算

available_for_unrelated_execution   = physical_free - hard_reserved
                                    -- 不属于该 reservation 的业务 execution
                                    -- (e.g. Sales Delivery / Production Issue) 可用预算
                                    -- WEAK reservation 不会阻塞 unrelated execution
```

不制造 LOT 级虚拟 reservation。Planning reservation 不强行分摊到 LOT / Bin / Serial。

WEAK reservation 可按 frozen Planning policy 在新 run preparation 时释放；STRONG 不被该策略释放；MANUAL 在 release_date 到期时显式 RELEASED。

### 27.14 Reservation Boundary

`planning_reservations.status` 取值：

```text
ACTIVE          -- 计入 reserved quantity (active_reserved_total / hard_reserved / soft_reserved)
CANCELLED       -- 不计入
EXPIRED         -- 不计入
CONSUMED        -- 不计入（已由实际出库 consume）
RELEASED        -- 不计入
```

Inventory 只读 ACTIVE reservation 形成 availability projection。

Inventory 不创建 / 不修改 planning_reservations。Planning domain 仍为 reservation document 的 canonical owner；STRONG / WEAK / MANUAL 三类 lifecycle 完全由 Planning 拥有。

Inventory availability projection 严格只读上述三个聚合量（active_reserved_total / hard_reserved / soft_reserved），不复制 Planning reservation engine；不参与 reservation state 转换。

### 27.15 Lock / Unlock

Lock 唯一 truth：

```text
inventory_locks 表（canonical）：
  id TEXT PRIMARY KEY
  product_id TEXT NOT NULL
  warehouse_id TEXT NOT NULL
  position_key TEXT                  -- 可选；若 NULL 表示 product/warehouse-level lock
  quantity REAL NOT NULL CHECK(quantity > 0)
  reason TEXT NOT NULL
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','RELEASED'))
  locked_by TEXT NOT NULL REFERENCES users(id)
  locked_at TEXT NOT NULL
  released_by TEXT REFERENCES users(id)
  released_at TEXT
  source_type TEXT NOT NULL           -- 'INVENTORY_LOCK' / 'OUTSOURCING_HOLD' / 'STOCKTAKE_HOLD'
  source_id TEXT NOT NULL
```

`inventory` balance 不保存 lock state；**MUST NOT** 拥有 `is_locked` Boolean。lock 唯一来源 = `inventory_locks`。

派生：

```text
active_locked_qty    = SUM(inventory_locks.quantity)
                      WHERE position_key = ? AND status='ACTIVE'

free_physical_qty    = position_eligible_on_hand - active_locked_qty
```

规则：

```text
lock_qty             ≤ current lockable_on_hand at position
locked stock not available (subtracted from available projection)
unlock_qty           ≤ ACTIVE remaining lock_qty (cannot over-release)
audit required (INVENTORY_LOCK_CREATE / INVENTORY_LOCK_RELEASE)
Lock 不直接 mutate `inventory.quantity` —— Lock 是独立账本
Lock 显式 ACTIVE / RELEASED 两态
```

不直接 mutate `inventory.quantity`。Lock 单独账本，独立于 inventory balance。

### 27.16 Inventory Period

复用既有 `inventory_period_closures` 表（CLOSED / REOPENED）。所有实际 mutation 入口先 `assertFinancialPeriodsOpen(businessDate)`。

Closed inventory period：拒绝 mutation。`step-transfer destination receipt` 使用其目标业务日期。

`financial-inventory.js::assertFinancialPeriodsOpen` 已覆盖：inventory cutoff + accounting cutoff 双重校验。

### 27.17 SQLite / MySQL Concurrency

#### SQLite

```text
BEGIN IMMEDIATE
transaction(db, work)        -- 既有 helper
```

#### MySQL

```text
START TRANSACTION
SELECT ... FOR UPDATE          -- row lock on inventory by position_key
deterministic lock order        -- §27.18
retry existing deadlock/lock-timeout policy
```

锁对象至少覆盖：

```text
inventory position (by position_key)
document source item
inventory_locks aggregate
inventory_lot_balances (per warehouse + lot)
inventory_serials (current_warehouse_id + serial_number)
inventory_step_transfer_in_transit aggregate
```

### 27.18 Lock Ordering

为避免 deadlock，所有 mutation 必须遵循唯一 canonical lock order：

```text
1. 收集本次 transaction 涉及的全部 inventory position_key
   - fromPosition.position_key
   - toPosition.position_key (single destination 或 paired destinations)
   - paired mutation 上下文中所有 destinations
   - in-transit execution rows 的相关 position_key
   - deduplicate
2. 将 position_key 集合按字典序 ascending 排序
3. 严格按排序结果依次加锁

禁止：

- always-from-first（两个相反方向 transfer 会死锁）
- always-to-first（同上）
- 部分 sorted（半序加锁同样存在反向 deadlock 风险）
```

完整 mutation lock sequence：

```text
1. business / source document rows              (按 source_type, source_id 字典序)
2. product / reference rows                     (product_id 字典序)
3. inventory positions                          (position_key 字典序 ascending, deduplicated)
4. LOT / SERIAL identities                      (warehouse_id + lot_id / product_id + serial_number 字典序)
5. lock / reservation aggregate rows            (position_key 字典序)
6. transfer execution rows                      (source_transfer_id + product_id 字典序)
7. financial evidence rows                      (balance_key 字典序)
```

具体顺序可微调（同一类型内再排字典序），但只允许一个 canonical order；position 阶段是唯一 inventory 加锁面。

SQLite: `BEGIN IMMEDIATE` 即取得 reserved lock + 序列化写。

MySQL: `SELECT ... FOR UPDATE` 按上述排序结果加锁；retry 既有 deadlock / lock-timeout 策略（次数上限由 `server/database/mysql-adapter.js` 既有 helper 决定）。

### 27.19 Direct Transfer

收敛到 mutation contract：

```text
source position.quantity ↓
destination position.quantity ↑
owner_type / owner_id 不变
stock_status 不变（除非显式 STATUS_CHANGE）
lot_id / serial_id 不变（同 identity 移动，不重写）
```

LOT/SERIAL transfer：

```text
inventory_lots.id 与 inventory_serials.id 保持
inventory_lot_balances(warehouse_id) 切换
inventory_serials.current_warehouse_id 切换
```

不重建 LOT/SERIAL identity。Direct Transfer 在 movement evidence 上表达为：

```text
movement_group_id  = G_new (per group)
movement_kind      = MOVE

source position row:      direction = OUT   movement_kind = MOVE   movement_group_id = G_new
destination position row: direction = IN    movement_kind = MOVE   movement_group_id = G_new
```

`tracked_inventory_movements.direction` 物理方向仅保留 `IN / OUT`；业务 mutation 类型由 `movement_kind` + `movement_group_id` 表达。同理：

- `BIN_MOVE`         → paired OUT + IN，movement_kind=BIN_MOVE，movement_group_id 相同
- `OWNER_CHANGE`     → paired OUT + IN，movement_kind=OWNER_CHANGE，movement_group_id 相同
- `STATUS_CHANGE`    → paired OUT + IN，movement_kind=STATUS_CHANGE，movement_group_id 相同
- `LOT_RECLASS`      → paired OUT + IN，movement_kind=LOT_RECLASS，movement_group_id 相同
- `MOVE`             → paired OUT + IN，movement_kind=MOVE，movement_group_id 相同
- `IN`               → single IN，movement_kind=IN
- `OUT`              → single OUT，movement_kind=OUT
- `ADJUSTMENT`       → single IN 或 OUT，movement_kind=ADJUSTMENT

paired mutation 在同一 transaction 内提交；quantity 守恒；position_key 来自 toPosition / fromPosition。

### 27.20 Step Transfer / In-Transit

不建立第二库存余额。In-transit 仅由 step-transfer execution facts 派生。

`inventory_step_transfer_in_transit` 表**只**保存 execution facts：

```text
inventory_step_transfer_in_transit 表：
  id TEXT PRIMARY KEY
  source_transfer_id TEXT NOT NULL          -- inventory_transfers.id
  product_id TEXT NOT NULL
  warehouse_id_source TEXT NOT NULL
  warehouse_id_destination TEXT NOT NULL
  issued_qty REAL NOT NULL                  -- 累计已 Transfer Out 数量
  received_qty REAL NOT NULL DEFAULT 0      -- 累计已 Transfer In 数量
  returned_qty REAL NOT NULL DEFAULT 0      -- 累计 return to source 数量
  cancelled_qty REAL NOT NULL DEFAULT 0     -- 累计 cancel remaining 数量
  status TEXT NOT NULL CHECK(status IN ('IN_TRANSIT','CLOSED','CANCELLED'))
  created_at TEXT NOT NULL
  closed_at TEXT
```

Canonical derivation（**唯一** in-transit 计算路径）：

```text
in_transit_qty = issued_qty
               - received_qty
               - returned_qty
               - cancelled_qty
```

in_transit_qty 由 execution facts 计算，**不是** inventory 第二库存余额。

语义：

```text
Transfer Out    → applyInventoryMutation(OUT, intoStepTransferInTransit=true)
                 → 增加 inventory_step_transfer_in_transit.issued_qty
                 → 不写入任何 inventory.position_key
Transfer In     → applyInventoryMutation(IN, fromStepTransferInTransit=true)
                 → 增加 received_qty
                 → 增加 destination position.quantity
partial receipt → received_qty 累加；剩余 in_transit_qty 继续 in-transit
cancel remaining → 关闭 step transfer，cancelled_qty 累加
return to source → applyInventoryMutation(MOVE) from in-transit 到 source warehouse；returned_qty 累加
```

In-transit quantity：

- **不得** 成为 source warehouse 的 on_hand；
- **不得** 成为 destination warehouse 的 on_hand；
- **只能** 从 execution facts reconciliation 得出。

任何 report / availability / lot trace 必须从 execution facts 派生 in_transit_qty，不得通过 SELECT ... FROM inventory 查询任何 in-transit "balance"。

### 27.21 Ownership Transfer

必须与 warehouse transfer 分开。

```text
OWNER_CHANGE mutation:
  fromPosition.owner_type  → toPosition.owner_type
  fromPosition.warehouse_id == toPosition.warehouse_id
  fromPosition.product_id  == toPosition.product_id
  fromPosition.stock_status == toPosition.stock_status
  fromPosition.lot_id      == toPosition.lot_id
  fromPosition.serial_id   == toPosition.serial_id
  quantity 守恒
```

VMI ownership transfer：

```text
before:  position_key(SUPPLIER, supplier_id, ...)  @ WH-A
after:   position_key(ENTERPRISE, NULL, ...)       @ WH-A
```

解除 Domain 4 当前 `INVENTORY_OWNER_DIMENSION_UNAVAILABLE`。删除 `procurement-vmi.js::assertInventoryOwnerDimension`。VMI business document 触发 mutation OWNER_CHANGE。

Finance effect：Inventory 只生成 physical ownership fact；Finance adapter 决定 valuation / accounting consequence。

### 27.22 Outsourcing Supplier-WIP

Enterprise-owned @ Supplier-WIP warehouse 保持。

```text
Outsourcing Issue
  fromPosition: enterprise warehouse (owner=ENTERPRISE)
  toPosition:   supplier-WIP warehouse (owner=ENTERPRISE)
  quantity 守恒
```

```text
Outsourcing Return
  reverse direction
```

Supplier WIP remaining 由 `inventory_step_transfer_in_transit` 风格表或 `inventory.quantity` 在 supplier-WIP warehouse 位置直接聚合得出。

不改 Outsourcing Order / Issue / Supplement / Return / Backflush business semantics；仅替换物理 mutation 入点。

### 27.23 Entrusted Material

INV-12 / INV-25：

```text
Entrusted Receipt
  owner_type = CUSTOMER
  owner_id   = customers.active=1
  warehouse  = enterprise warehouse
  stock_status = AVAILABLE (或 HOLD by 业务选择)

Entrusted Issue
  same owner_type / owner_id
  反向 movement
```

不得进入 enterprise-owned available stock。`planning_available` 仅取 owner_type='ENTERPRISE' 或 scheme-eligible SUPPLIER；CUSTOMER 不进入 planning-available。

消费 / 退回时保持 customer ownership，除非有显式 OWNER_CHANGE business event（不属于 INV-12）。

### 27.24 Opening Inventory

新表：

```text
inventory_initialization 表：
  id TEXT PRIMARY KEY
  status TEXT NOT NULL CHECK(status IN ('NOT_STARTED','OPEN','CLOSED'))
  enabled_at TEXT            -- inventory enable date
  opened_by TEXT REFERENCES users(id)
  opened_at TEXT
  closed_by TEXT REFERENCES users(id)
  closed_at TEXT
  notes TEXT NOT NULL DEFAULT ''
  reopen_count INTEGER NOT NULL DEFAULT 0

opening_inventory_documents 表：
  id TEXT PRIMARY KEY
  initialization_id TEXT NOT NULL REFERENCES inventory_initialization(id)
  doc_no TEXT NOT NULL UNIQUE
  business_date TEXT NOT NULL
  status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED'))
  creator_id TEXT NOT NULL REFERENCES users(id)
  confirmed_by TEXT REFERENCES users(id)
  created_at TEXT NOT NULL
  confirmed_at TEXT
  notes TEXT NOT NULL DEFAULT ''

opening_inventory_items 表：
  id TEXT PRIMARY KEY
  document_id TEXT NOT NULL REFERENCES opening_inventory_documents(id)
  product_id TEXT NOT NULL REFERENCES products(id)
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id)
  bin_id TEXT                 -- nullable
  owner_type TEXT NOT NULL DEFAULT 'ENTERPRISE'
  owner_id TEXT
  stock_status TEXT NOT NULL DEFAULT 'AVAILABLE'
  lot_id TEXT                 -- nullable
  serial_id TEXT              -- nullable
  quantity REAL NOT NULL CHECK(quantity > 0)
  position_key TEXT NOT NULL
  UNIQUE(position_key)
```

Lifecycle：

```text
NOT_STARTED
  -- 库存未启用
  -- 全部 mutation reject (除 initialization CRUD)

OPEN
  -- 允许 opening_inventory_documents CONFIRM
  -- 允许普通 inventory mutation

CLOSED
  -- 普通编辑 opening document reject
  -- 只允许 governed correction / reopen
  -- 不允许 retroactive fabricate 历史凭证
```

Controlled reopen：

```text
CLOSED → OPEN
  -- 必须 inventory_initialization.reopen_count++
  -- 必须 audit
  -- 必须 support reason
```

启用日期 = `enabled_at`，由 initialization OPEN 一次性写入。Closed inventory period 拒绝后期 mutation。

### 27.25 Other Receipt / Other Issue

库存原生 document family：

```text
inventory_native_documents 表：
  id TEXT PRIMARY KEY
  doc_no TEXT NOT NULL UNIQUE
  doc_kind TEXT NOT NULL CHECK(doc_kind IN ('OTHER_RECEIPT','OTHER_ISSUE'))
  business_date TEXT NOT NULL
  status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED'))
  reason TEXT NOT NULL DEFAULT ''
  creator_id TEXT NOT NULL REFERENCES users(id)
  confirmed_by TEXT REFERENCES users(id)
  created_at TEXT NOT NULL
  confirmed_at TEXT
  notes TEXT NOT NULL DEFAULT ''
```

Lifecycle：

```text
DRAFT → CONFIRMED       (产生 inventory mutation)
DRAFT → CANCELLED
```

CONFIRMED 后：

```text
OTHER_RECEIPT → applyInventoryMutation(IN, inventory_native_documents row)
OTHER_ISSUE   → applyInventoryMutation(OUT, inventory_native_documents row)
```

不得伪装成 PURCHASE_RECEIPT / SALES_DELIVERY / PRODUCTION_RECEIPT / OUTSOURCING_RECEIPT。`source_type` 必须是 `OTHER_RECEIPT` / `OTHER_ISSUE`。

### 27.26 Stock Status Adjustment / Lot Adjustment / Form Conversion / Bin Move

#### Stock Status Adjustment

```text
same product_id, warehouse_id, bin_id, owner_type, owner_id, lot_id, serial_id
quantity 守恒
stock_status: A → B
movement_kind: STATUS_CHANGE
```

#### Lot Adjustment

```text
split  → 1 fromPosition.quantity - x → 2 toPosition（不同 lot_id）
merge  → N fromPosition → 1 toPosition
rename → identity_id 不变，lot_code 变更（受 governance）
quantity 守恒；tracking identity trace 不丢
禁止用于 SERIAL
```

#### Form Conversion

```text
产品形态 / 包装 / 辅助属性改变
quantity 守恒
master data owner：Master Data (辅助属性) / Engineering (变更正本)
Inventory 不复制 BOM / auxiliary attribute truth
```

#### Bin Move

```text
fromPosition.bin_id → toPosition.bin_id
其它维度全部守恒
movement_kind: BIN_MOVE
```

### 27.27 Assembly / Disassembly

INV-17 (Integration-Backed — Engineering BOM)：

```text
Assembly:
  1. 取 canonical Engineering BOM resolver 输出 components
     resolveEffectiveBomForCaller('INVENTORY_ASSEMBLY', productId, businessDate)
  2. applyInventoryMutation(MOVE) for each component
     fromPosition: component bin/lot 减少
     toPosition:   intermediate warehouse bin 减少（or 直接）
  3. applyInventoryMutation(IN) for parent
     toPosition: parent warehouse bin 增加
  4. snapshot BOM version + qty base + scrap factor
  6. valuation movement via financial-inventory.js
  7. audit

Disassembly:
  reverse
```

Engineering / BOM 是结构来源；Inventory owns physical consume / produce movement。

不创建第二 BOM engine。最终成本分摊仍归 Finance / Inventory Costing。

### 27.28 Inventory Adjustment & Scrap

保留既有 `inventory_adjustments` / `inventory_scraps`，收敛到 mutation contract：

```text
INVENTORY_ADJUSTMENT   → applyInventoryMutation(ADJUSTMENT, signed qty)
INVENTORY_SCRAP        → applyInventoryMutation(ADJUSTMENT, OUT with source 'INVENTORY_SCRAP')
```

不重写 lifecycle。仅 mutation 入点替换。

### 27.29 Stocktake

```text
inventory_checks           (DRAFT / SUBMITTED / APPROVED)  -- 既有
inventory_check_items      -- 既有
```

扩展为 canonical stocktake：

```text
inventory_checks 表 EXTEND：
  check_kind TEXT NOT NULL DEFAULT 'REGULAR' CHECK(check_kind IN ('REGULAR','CYCLE'))
  scope_strategy TEXT NOT NULL DEFAULT 'ALL'  -- 'ALL' / 'BY_ABC' / 'BY_PRODUCT' / 'BY_LOCATION'
  abc_classification TEXT                      -- 'A' / 'B' / 'C' (when scope_strategy='BY_ABC')
  cycle_period_key TEXT                          -- 'YYYY-MM' (when check_kind='CYCLE')
  snapshot_at TEXT NOT NULL                      -- 快照时间

inventory_check_items EXTEND：
  position_key TEXT NOT NULL
  bin_id TEXT
  owner_type TEXT NOT NULL
  owner_id TEXT
  stock_status TEXT NOT NULL
  lot_id TEXT
  serial_id TEXT
  book_quantity REAL NOT NULL
  physical_quantity REAL NOT NULL
  diff_quantity REAL NOT NULL
  snapshot_book_quantity REAL NOT NULL           -- 快照时刻的账存
```

Snapshot 语义：

```text
snapshot_at = timestamp captured at SUBMIT
snapshot_book_quantity = quantity at position_key at snapshot_at
后续 movement 不影响 snapshot_book_quantity
physical_quantity = 实际盘点时录入
diff_quantity = physical_quantity - snapshot_book_quantity
```

Confirm 策略：

```text
CONFIRM APPROVED → applyInventoryMutation(ADJUSTMENT, signed diff)
  sourceType = 'INVENTORY_STOCKTAKE_DIFF'
  quantity = diff_quantity
  reason = inventory_check.check_no
```

不得在 confirm 时偷偷重新取 current balance，必须使用 snapshot_book_quantity。

### 27.30 Stocktake vs Mutation Conflict Reconciliation

```text
snapshot_at 前 movement 已写
snapshot_at 后 movement 又写
physical_quantity 录入时基于 snapshot_at 的账存
diff_quantity = physical_quantity - snapshot_book_quantity
confirm 时按 diff_quantity apply mutation
期间 mutation 不阻断 confirm（账实差异是合法结果）
```

新增 conflict guard：confirm 时如果 `now - snapshot_at > stocktake_window_days` (parameter, default 30)，要求 controlled reopen / re-snapshot。

### 27.31 ABC Classification

canonical 表：

```text
inventory_abc_classifications 表：
  id TEXT PRIMARY KEY
  product_id TEXT NOT NULL REFERENCES products(id)
  abc_class TEXT NOT NULL CHECK(abc_class IN ('A','B','C'))
  effective_from TEXT NOT NULL
  effective_to TEXT
  basis TEXT NOT NULL DEFAULT 'VALUE'  -- 'VALUE' / 'USAGE'
  finance_valuation_snapshot_id TEXT   -- basis 引用
  created_by TEXT NOT NULL REFERENCES users(id)
  created_at TEXT NOT NULL
  UNIQUE(product_id, effective_from)
```

ABC 只生成 classification / stocktake strategy。basis='VALUE' 必须引用 Finance valuation snapshot。Inventory 不复制 valuation engine。

Cycle stocktake scope：`scope_strategy='BY_ABC'` 时按当前 ABC class 选 product。

### 27.32 Reports (INV-27 / 33-38)

```text
inventory_reports.js

读 canonical：
    inventory + inventory_transactions + tracked_inventory_movements
    inventory_lots / inventory_serials / inventory_lot_balances
    inventory_locks
    planning_reservations (read-only for availability)
    inventory_valuation_balances (read-only Finance evidence)

输出：
    Instant Inventory       -- by product / warehouse / bin / owner / stock_status / lot / serial
    Receipt/Issue Summary   -- by product / period / source_type
    Receipt/Issue Detail    -- by product / period / source_type / source_id
    Inventory Ledger        -- opening + receipts - issues = closing
    Inventory Aging         -- by receipt_date / expiry_date buckets
    Slow-Moving             -- no movement > N days; receipt-only-no-issue
    Inventory Alerts        -- min / max / safety / reorder / expiry / negative anomaly
    ABC Analysis            -- current ABC class per product
    Serial Master / Current State / Trace Lookup
```

Report 不允许拥有独立 quantity truth。必须从 canonical inventory + movements 派生。

### 27.33 Inventory Ledger

```text
opening_quantity  = SUM(inventory.quantity) AT initialization
                    OR inventory_period_snapshots.closing_quantity (历史区间)
receipts         = SUM(inventory_transactions.quantity_change)
                    WHERE direction='IN' AND business_date IN period
issues           = SUM(inventory_transactions.quantity_change)
                    WHERE direction='OUT' AND business_date IN period
closing_quantity = opening_quantity + receipts - issues
```

来自 canonical inventory_transactions + canonical inventory。不是第二套 ledger。

INV-34 read model 必须从 canonical balances + movements 派生。

### 27.34 Alerts

```text
INVENTORY_ALERT_THRESHOLDS 表 (NEW, 参数化):
  product_id TEXT NOT NULL
  warehouse_id TEXT NOT NULL
  min_stock REAL
  max_stock REAL
  safety_stock REAL
  reorder_point REAL
  expiry_warn_days INTEGER NOT NULL DEFAULT 30
  PRIMARY KEY(product_id, warehouse_id)

触发：
  available_quantity < min_stock           → MIN_STOCK_ALERT
  available_quantity > max_stock           → MAX_STOCK_ALERT
  available_quantity < safety_stock        → SAFETY_STOCK_ALERT
  available_quantity < reorder_point       → REORDER_ALERT
  expiry_date < today + warn_days          → EXPIRY_ALERT
  current_quantity < 0 (fallback)         → NEGATIVE_BALANCE_ANOMALY
```

不得使用 stale `products.stock_quantity` 作为事实。必须从 `inventory_reports.js::readAvailableQuantity()` 派生。

### 27.35 Barcode Foundation (INV-39)

Bounded barcode foundation：

```text
inventory_barcode_rules 表：
  id TEXT PRIMARY KEY
  code TEXT NOT NULL UNIQUE
  pattern TEXT NOT NULL              -- regex / template
  fields JSON                        -- parsed fields map
  active INTEGER NOT NULL DEFAULT 1

inventory_barcode_bindings 表：
  id TEXT PRIMARY KEY
  rule_id TEXT NOT NULL REFERENCES inventory_barcode_rules(id)
  entity_type TEXT NOT NULL          -- 'PRODUCT' / 'WAREHOUSE' / 'BIN' / 'LOT' / 'SERIAL' / 'CONTAINER'
  entity_id TEXT NOT NULL
  barcode TEXT NOT NULL
  UNIQUE(rule_id, entity_type, entity_id)

inventory_barcode_resolution_log 表：
  id TEXT PRIMARY KEY
  barcode TEXT NOT NULL
  resolution_json TEXT
  resolved_at TEXT NOT NULL
  resolved_by TEXT REFERENCES users(id)
  source TEXT NOT NULL               -- 'STOCK_QUERY' / 'STOCKTAKE' / 'SCAN_VALIDATE' / 'SCAN_ADAPTER'
```

Parser 输出：

```text
product_id        (nullable)
warehouse_id      (nullable)
bin_id            (nullable)
lot_id            (nullable)
serial_id         (nullable)
quantity          (default 1)
container_id      (nullable)
```

不设计打印平台 / 设备地址管理。

### 27.36 Scan Adapter (INV-40 / INV-41)

Scan engine：

```text
server/modules/inventory-scan-adapter.js::resolveScan(barcode, actor)

input:  barcode TEXT, context { sourceType?, sourceId?, operationType? }
output: {
  barcodeRuleId, resolvedFields { product_id, warehouse_id, bin_id, lot_id, serial_id, quantity, container_id },
  validation: { inventoryEligible, stockStatusOk, lotSerialMatch, expiryOk, qtyNonNegative, ... },
  draftDocument: { targetBusinessDocument?, fieldsForTargetDocument? },
  duplicate: boolean,
  replayProtectionKey: TEXT
}
```

按业务 context：

```text
'PURCHASE_RECEIPT'  context     → 解析 → 校验 PO source item → 返回 Purchase Receipt draft payload
                                          → Business Domain (Procurement) 决定 confirm
'SALES_DELIV'       context     → 解析 → 校验 SO/Delivery → 返回 outbound validation
'OTHER_RECEIPT'     context     → 解析 → 直接产生 inventory-native document draft
'INVENTORY_STOCKTAKE' context   → 解析 → 返回 stocktake line
'INVENTORY_INSTANT_QUERY'        → 解析 → 返回 instant query

NOT supply business document creation
```

不得让 scan engine 直接创建 Purchase Receipt / Sales Delivery / Production Order。target business document 由对应 Domain 决定。

INV-40 / INV-41 Integration-Backed，明确 adapter contract。

### 27.37 Duplicate Scan / Idempotency

```text
allowed quantity accumulation   -- OTHER_RECEIPT / OTHER_ISSUE 多 scan 累加
                                 通过 inventory_native_documents 同 doc_id 多次 confirm
duplicate serial forbidden    -- SERIAL scan 二次进入同 source → reject
network replay idempotency    -- (source_type, source_id, source_item_id, idempotency_key) UNIQUE
                                 existing inventory_native_documents.idempotency_key /
                                 inventory_barcode_resolution_log.replayProtectionKey
```

实现：

```text
serial duplicate check:
  SELECT 1 FROM inventory_barcode_resolution_log
   WHERE barcode=? AND resolved_at > now - idempotency_window
     AND resolution_json LIKE '%serial_id%' AND source='SCAN_VALIDATE'
  → if exists: 409 'duplicate serial scan'

qty accumulation:
  inventory_native_documents.idempotency_key 可包含多 barcode resolution
  confirm 时累加 quantity 但每 (source, serial) 仍唯一
```

### 27.38 Stocktake Scan / Instant Query (INV-42 / INV-43)

```text
INVENTORY_STOCKTAKE context scan
  → inventory-check-items insert (DRAFT)
  → 不创建独立 scan inventory tables

INVENTORY_INSTANT_QUERY context scan
  → 读 canonical inventory by (product_id, warehouse_id, bin_id?, lot_id?, serial_id?)
  → 返回 instant query result
```

### 27.39 Packing / Container (INV-44)

```text
inventory_containers 表：
  id TEXT PRIMARY KEY
  container_no TEXT NOT NULL UNIQUE
  container_type TEXT NOT NULL       -- 'PALLET' / 'CASE' / 'BOX' / 'BAG' / ...
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id)
  status TEXT NOT NULL CHECK(status IN ('OPEN','SEALED','DISPATCHED','DESTROYED'))
  parent_container_id TEXT          -- 支持 nested
  created_by TEXT NOT NULL REFERENCES users(id)
  created_at TEXT NOT NULL

inventory_container_items 表：
  id TEXT PRIMARY KEY
  container_id TEXT NOT NULL REFERENCES inventory_containers(id)
  product_id TEXT NOT NULL REFERENCES products(id)
  lot_id TEXT
  serial_id TEXT
  quantity REAL NOT NULL CHECK(quantity > 0)
  bin_id TEXT
  position_key TEXT                 -- 引用 inventory.position_key（不是 quantity truth）

UNIQUE(container_id, product_id, lot_id, serial_id, bin_id)
```

不得取代 inventory mutation。

```text
pack      → inventory_container_items insert；不写 inventory.quantity
unpack    → inventory_container_items delete；不写 inventory.quantity
whole-container transfer
  → applyInventoryMutation(MOVE) by container 内 (product, lot, serial, bin) 全部 sum
     then seal status='DISPATCHED' / unpack at destination
partial-container transfer
  → applyInventoryMutation(MOVE) by 选定 partial subset；
     remaining container_items 不动；
     container.status='OPEN'
container content inquiry
  → 读 inventory_container_items JOIN inventory
```

Container 不成为第二库存余额。真实库存仍以 canonical inventory identity (position_key) 为准。

### 27.40 Valuation Boundary

`financial-inventory.js` 继续作为 Finance/Inventory Costing canonical valuation evidence。`inventory_valuation_balances` / `inventory_valuation_movements` 不重写。

| mutation | 是否影响 value |
|---|---|
| BIN_MOVE | NO（bin 改变 total value conserved） |
| STOCK_STATUS_CHANGE | NO（status 改变 total value conserved） |
| Direct Transfer (MOVE) | NO（location 改变 total value conserved） |
| LOT_RECLASS | NO（lot identity 改变 total value conserved） |
| OWNER_CHANGE | 可能（Inventory 只生成 physical ownership fact；Finance adapter 决定 valuation consequence） |
| IN / OUT / ADJUSTMENT | YES（quantity delta → financial-inventory.js::receiveValue / issueValue） |
| Assembly / Disassembly | YES（consume carrying value + produce carrying value） |

Inventory 不写新 costing engine。所有 IN / OUT / ADJUSTMENT 在 mutation contract 内调用既有 `financial-inventory.js::receiveValue / issueValue` (cents-based INTEGER safe)。

### 27.41 Closed Period

实际 physical mutation 入口先 `assertFinancialPeriodsOpen(businessDate)`。

Closed inventory period：reject mutation。

Step-transfer destination receipt 使用其目标业务日期（destination date），确保不会被 source 期间关闭阻断。

### 27.42 Mandatory Domain Race Matrix (14)

Implementation 期间必须真实覆盖：

```text
RACE-01  two outbound mutations against same position         (同一 position 两个 OUT)
RACE-02  direct transfer vs outbound                          (MOVE vs OUT 同一 position)
RACE-03  step-transfer receive twice                          (Transfer In 二次)
RACE-04  stocktake confirm vs outbound                        (Stocktake diff apply vs OUT)
RACE-05  lock vs outbound                                     (Lock create vs OUT)
RACE-06  Planning reservation vs availability-consuming mutation
                                                           (reservation vs OUT)
RACE-07  VMI owner transfer twice                             (OWNER_CHANGE 二次)
RACE-08  stock-status adjustment vs outbound                  (STATUS_CHANGE vs OUT)
RACE-09  lot split/merge vs lot outbound                      (LOT_RECLASS vs OUT 同一 lot)
RACE-10  same SERIAL consumed twice                           (SERIAL 二维扫描 / 二次 issue)
RACE-11  bin move vs outbound                                 (BIN_MOVE vs OUT 同一 position)
RACE-12  period close vs stock mutation                       (assertFinancialPeriodsOpen 并发)
RACE-13  opening initialization close vs opening write        (CLOSED 状态并发)
RACE-14  duplicate barcode serial scan / confirm              (SERIAL 重复 scan)
```

Implementation 结束后不允许再补 race list。最终 MySQL concurrency 必须真实覆盖全部 14。

### 27.43 Migration Safety

```text
inventory 表 additive：
  - 既有 UNIQUE(warehouse_id, product_id) 保留作 legacy compatibility（仅 read）
  - 新增 position_key 列 (CHAR(64) NOT NULL for MySQL; TEXT for SQLite)
  - additive migration 在 transaction 内完成

bin / owner / status / lot / serial 既有数据：
  - NONE → ENTERPRISE owner + AVAILABLE status + NULL others
  - LOT/SERIAL 已存在 inventory_lots / inventory_serials 中
  - 派生 SUM 校验 fail-closed

历史 inventory_transactions：
  - 既有列保留
  - 新 mutation 写 position_key 与 bin/owner/status/lot/serial snapshot
  - 旧 movement display 'historical dimension unavailable'

constraints / indexes：
  - UNIQUE(position_key) additive
  - INDEX(position_key), INDEX(product_id, warehouse_id, stock_status), INDEX(owner_type, owner_id)
  - data-preserving constraint / index reconstruction

idempotent migration
SQLite / MySQL parity (per server/database/mysql-schema.js 既有 alias strategy)
no production reset
no history deletion
before / after row reconciliation
quantity reconciliation
tracked identity reconciliation
fail-closed on mismatch

rollback strategy：
  - 停止新代码路径
  - 应用代码回退
  - additive 列保留（旧 schema 仍能读）
  - 不 destructive down-migrate
```

### 27.43.1 Atomic Legacy Cutover（activation gate）

现有 legacy primitive `adjustInventory(warehouseId, productId, quantityChange)` 依赖 `UNIQUE(warehouse_id, product_id)`，并隐式假设 `ENTERPRISE owner + AVAILABLE status + NULL bin + NULL lot/serial`。

一旦 canonical inventory 允许：

```text
same warehouse + same product
+ different owner / bin / status / lot / serial
```

旧 helper **不能**继续作为通用 inventory writer。Design 锁定如下 cutover contract：

#### A. 所有 physical inventory WRITE paths 必须完成 convergence

Activation gate 之前（下列每一项满足前，非-default dimensions 不得 writable）：

```text
1. 全部 physical mutation callers 已迁移到 applyInventoryMutation 入口
2. 无任何业务代码继续直接 `UPDATE inventory SET quantity = ?`
3. 旧 helper `adjustInventory` 已替换或降级为 compatibility adapter
```

#### B. Legacy Reads

旧接口若只要求 `warehouse + product quantity`，必须经 compatibility read adapter：

```text
inventory_compatibility_view (read-only):
  SELECT
    legacy.warehouse_id, legacy.product_id,
    SUM(legacy.quantity)                                  AS total_quantity,
    SUM(CASE WHEN legacy.stock_status='AVAILABLE' THEN legacy.quantity ELSE 0 END)
                                                           AS available_quantity,
    SUM(CASE WHEN legacy.owner_type='ENTERPRISE' THEN legacy.quantity ELSE 0 END)
                                                           AS enterprise_owned_quantity
  FROM inventory legacy
  WHERE legacy.active=1
  GROUP BY legacy.warehouse_id, legacy.product_id
```

**禁止**：

```text
SELECT one arbitrary inventory row WHERE warehouse_id=? AND product_id=?
```

#### C. Legacy Writes — adjustInventory() 处理

`adjustInventory()` 最终只能：

- **C-1**：被替换为 canonical mutation primitive（首选）；
- **C-2**：或明确降级为 compatibility adapter，仅允许：

```text
ENTERPRISE owner
AVAILABLE status
NULL / default bin
no LOT / SERIAL special identity
```

owner-aware / status-aware / bin-aware / tracking-aware 路径 **禁止** 调用 `adjustInventory()`。

#### D. Activation Gate

在下列 non-default dimensions 正式可写之前：

```text
SUPPLIER owner
CUSTOMER owner
non-default bin
non-AVAILABLE stock status
```

必须证明：

```text
全部 physical mutation callers 已经完成 convergence（§27.43.1 A）
adjustInventory() 已替换或降级（§27.43.1 C）
legacy read path 走 compatibility view（§27.43.1 B）
```

不得依赖"以后逐步迁移"。Activation gate 是 Domain 5 Implementation 阶段 mandatory check。

### 27.44 Compatibility Read Contract

既有 frozen domains 仍可能按 `inventory(warehouse_id, product_id)` 读取。Design 提供 compatibility read：

```text
inventory_compatibility_view (read-only):
  SELECT
    legacy.warehouse_id, legacy.product_id,
    SUM(legacy.quantity)                                  AS total_quantity,
    SUM(CASE WHEN legacy.stock_status='AVAILABLE' THEN legacy.quantity ELSE 0 END)
                                                         AS available_quantity,
    SUM(CASE WHEN legacy.owner_type='ENTERPRISE' THEN legacy.quantity ELSE 0 END)
                                                         AS enterprise_owned_quantity
  FROM inventory legacy
  WHERE legacy.active=1
  GROUP BY legacy.warehouse_id, legacy.product_id
```

不得要求前四域一次全部重写 UI / API。但所有新的 physical writes 必须走 canonical mutation contract（§27.8）。

**禁止** legacy code 直接 `SELECT one arbitrary inventory row WHERE warehouse_id=? AND product_id=?`。所有 read 必须 aggregate 全部 canonical positions。

### 27.45 RBAC / Permission

新增最小 permission family：

```text
INVENTORY_PARAMETERS_VIEW / MANAGE
WAREHOUSE_VIEW / MANAGE
WAREHOUSE_BIN_VIEW / MANAGE
STOCK_STATUS_VIEW / MANAGE
OWNER_DIMENSION_VIEW
INVENTORY_TRANSFER_VIEW / MANAGE
INVENTORY_STEP_TRANSFER_VIEW / MANAGE
INVENTORY_LOCK_VIEW / MANAGE
INVENTORY_OPENING_VIEW / MANAGE
INVENTORY_NATIVE_DOCUMENT_VIEW / MANAGE
INVENTORY_STOCKTAKE_VIEW / MANAGE
INVENTORY_ADJUSTMENT_VIEW / MANAGE
INVENTORY_SCRAP_VIEW / MANAGE          -- 既有 KEEP
INVENTORY_LOT_ADJUSTMENT_VIEW / MANAGE
INVENTORY_FORM_CONVERSION_VIEW / MANAGE
INVENTORY_ASSEMBLY_VIEW / MANAGE
INVENTORY_BARCODE_RULE_VIEW / MANAGE
INVENTORY_CONTAINER_VIEW / MANAGE
INVENTORY_REPORT_VIEW
```

既有 `INVENTORY_SCRAP_*` / `INVENTORY_CHECK_*` / `INVENTORY_TRANSFER_*` / `INVENTORY_ADJUSTMENT_*` 保留，不重命名。

最小新增数 ≈ 32；最终 PERMISSIONS 数量由 Implementation 实际登记决定。

### 27.46 Audit / Transaction / State machine

- 所有 mutation 必须 backend fail closed；
- Frontend hidden 不等于 authorization；
- audit 写入关键 mutation：IN / OUT / MOVE / OWNER_CHANGE / STATUS_CHANGE / LOT_RECLASS / BIN_MOVE / ADJUSTMENT / SCRAP / VMI_* / OUTSOURCING_* / ENTRUSTED_* / LOCK / UNLOCK / PERIOD CLOSE / REOPEN / OPENING CLOSE；
- 既有 `audit(actor, action, entity, id, payload)` 复用；
- 既有的 5 个 role seed 保留；
- 既有的 `INVENTORY_SCRAP_*` / `INVENTORY_CHECK_*` / `INVENTORY_TRANSFER_*` / `INVENTORY_ADJUSTMENT_*` permission 不破坏；
- 不绕过 mutation contract；
- 不引入 second ledger / second mutation engine。

### 27.47 UI Information Architecture

Mobile Inventory & Warehouse 至少规划：

```text
1. Inventory Overview / Instant Stock      (hub)
2. Warehouses & Bins                      (master + bin mgmt)
3. Transfers                              (direct + step + in-transit)
4. Native Receipt / Issue                 (other receipt / issue)
5. Stocktake                              (regular + cycle)
6. Adjustment / Scrap / Status            (adjustment / scrap / status)
7. Tracking / Owner / Locks               (LOT / SERIAL / expiry / owner / lock)
8. Barcode / Scan                         (barcode rules + scan adapter)
9. Reports                                (instant / ledger / aging / alerts)
10. Period Close                          (period close / reopen)
```

合并为较少 route / hub。建议：

```text
inventory-overview       (1 + 9 部分入口)
inventory-transfer       (3)
inventory-stocktake      (5)
inventory-adjustment     (6)
inventory-tracking       (7)
inventory-barcode        (8)
inventory-period         (10)
inventory-master         (2 + 4)
```

实际 route 数 ≤ 8；launcher 数 ≤ 6（Hub + Transfers + Stocktake + Adjustment + Tracking + Barcode）。

Mobile-first：390 CSS px primary；同时验证 320 / 430 / 680。

LIST → DETAIL → EDITOR / WORKFLOW。

仅 UI 任务显式加载 `.claude/skills/erp-mobile-taste/SKILL.md`。

不得修改业务术语、API、permission、state machine、source / downstream、inventory / accounting facts。

### 27.48 Final Functional UAT Contract (28)

```text
UAT-01  warehouse / bin maintenance
UAT-02  enterprise-owned stock query
UAT-03  supplier-owned VMI stock
UAT-04  customer-owned entrusted stock
UAT-05  direct transfer
UAT-06  step transfer out / in-transit / in
UAT-07  inventory lock / unlock
UAT-08  stock-status change
UAT-09  LOT movement
UAT-10  SERIAL movement
UAT-11  expiry block
UAT-12  other receipt
UAT-13  other issue
UAT-14  opening inventory + close initialization
UAT-15  regular stocktake
UAT-16  cycle stocktake
UAT-17  stocktake gain / loss
UAT-18  adjustment
UAT-19  scrap
UAT-20  VMI ownership transfer
UAT-21  outsourcing supplier-WIP position
UAT-22  barcode stock query
UAT-23  barcode stocktake
UAT-24  scan validation
UAT-25  container pack / unpack
UAT-26  inventory reports
UAT-27  inventory period close / reopen
UAT-28  available = physical - locks - reservations
```

最终目标：`28 / 28 PASS`。

### 27.49 Responsive Contract

```text
Widths:  320 / 390 / 430 / 680
Checks:  no document overflow
         no clipped action
         touch target >= 44px
         no inaccessible sheet / dialog
         no console / pageerror
```

### 27.50 Final Automated Gates

Implementation 最终必须一次提供：

```text
pnpm test:fast
pnpm test
pnpm test:heavy
pnpm test:mysql
pnpm test:mysql:concurrency
pnpm test:mysql:performance
pnpm build
git diff --check
Functional UAT  28 / 28 PASS
Responsive UAT  (per §27.49)
```

不允许 Implementation Report 再写：`MySQL later` / `Browser UAT later` / `Concurrency later`。

### 27.51 Implementation Waves — 5 Waves

```text
Wave A
  Canonical Identity / Owner / Bin / Status / Migration
  - inventory-position.js (position_key)
  - inventory-parameters.js
  - warehouse-master.js (EXTEND)
  - warehouse-bin.js
  - stock-status.js
  - owner-dimension.js
  - inventory schema migration (additive)
  - inventory-extensions.js convergence (initial)

Wave B
  Mutation Contract / Availability / Lock / Transfer / VMI convergence
  - inventory-mutation.js (applyInventoryMutation dispatcher)
  - inventory-availability.js (ON_HAND/LOCKED/RESERVED/AVAILABLE)
  - inventory-lock.js
  - inventory-transfer.js (EXTEND)
  - inventory-step-transfer.js
  - 删除 procurement-vmi.js::assertInventoryOwnerDimension
  - VMI 物理 OWNER_CHANGE / IN(SUPPLIER) / OUT(SUPPLIER) 真实接入
  - Outsourcing Issue/Return/Backflush 物理 mutation 接入
  - Entrusted Receipt/Issue 真实接入

Wave C
  Opening / Native Documents / Stocktake / Conversion
  - inventory-opening.js (initialization / opening docs / close / reopen)
  - inventory-native-document.js (OTHER_RECEIPT / OTHER_ISSUE)
  - inventory-stock-status-mutation.js
  - inventory-lot-adjustment.js
  - inventory-form-conversion.js
  - inventory-assembly-disassembly.js (consume Engineering BOM)
  - inventory-adjustment-scrap.js convergence
  - inventory-stocktake.js (REGULAR / CYCLE / snapshot / diff)
  - inventory-abc-classifications.js
  - 14 个 race focused tests

Wave D
  Barcode / Container / Reports / Alerts
  - inventory-barcode.js (rule / binding / parse / resolution log)
  - inventory-scan-adapter.js (resolveScan + idempotency + duplicate)
  - inventory-container.js (container / pack / unpack / transfer / inquiry)
  - inventory-reports.js (instant / ledger / aging / slow-moving / alerts / ABC / serial)
  - inventory-period-close.js EXTEND (close / reopen / snapshot / mutation block)
  - 5 个 UAT batch 集成测试

Wave E
  Mobile UI / Cross-domain convergence / Acceptance
  - src/pages/inventory-overview / inventory-transfer / inventory-stocktake
    / inventory-adjustment / inventory-tracking / inventory-barcode
  - applicationRegistry 新 routes / launcher
  - 28 Functional UAT + Responsive UAT
  - final canonical gates
```

后续不得再膨胀成 A-J。Wave 数固定 5。

### 27.52 Capability Trace (44 / 44)

```text
INV-01..INV-08     Foundation & Physical Stock        (8)
INV-09..INV-14     Initialization & Native Documents (6)
INV-15..INV-21     Movement & Conversion             (7)
INV-22..INV-28     Tracking & Inventory Control      (7)
INV-29..INV-32     Stocktake & Period Control        (4)
INV-33..INV-38     Reports & Alerts                  (6)
INV-39..INV-44     Barcode / Warehouse Scan Core     (6)

TOTAL = 44

Domain-Owned      = 40
Integration-Backed = 4
  INV-08  Planning Reservation
  INV-17  Engineering BOM
  INV-40  Business Document Scan Adapter
  INV-41  Business Document Validation
```

每项 Requirement ID → Design owner / schema / service / integration / acceptance evidence（Design 仅做映射，不复制 Requirement 文本）：

| ID | Design owner module / service | schema / integration | acceptance evidence (placeholder for Implementation) |
|---|---|---|---|
| INV-01 | `inventory-parameters.js` | `inventory_parameters` | focused + UAT-14 |
| INV-02 | `warehouses.js` | `warehouses` EXTEND | focused + UAT-01 |
| INV-03 | `warehouse-bin.js` | `warehouse_bins` NEW | focused + UAT-01 |
| INV-04 | `stock-status.js` | `inventory_stock_statuses` NEW | focused + UAT-08 |
| INV-05 | `owner-dimension.js` | `inventory.owner_type / owner_id` | focused + UAT-03 / UAT-04 / UAT-20 |
| INV-06 | `inventory-position.js` | `inventory.position_key` UNIQUE | focused + UAT-02 / UAT-21 |
| INV-07 | `inventory-mutation.js` | `inventory + inventory_transactions + tracked_inventory_movements` | focused + all UAT + 14 race |
| INV-08 | `inventory-availability.js` | reads `planning_reservations` | Integration-Backed — Planning; UAT-28 |
| INV-09 | `inventory-opening.js` | `inventory_initialization.enabled_at` | focused + UAT-14 |
| INV-10 | `inventory-opening.js` | `opening_inventory_documents / items` | focused + UAT-14 |
| INV-11 | `inventory-opening.js` | `inventory_initialization.status` lifecycle | focused + UAT-14 |
| INV-12 | `inventory-mutation.js` via Entrusted Receipt path | `inventory.owner_type='CUSTOMER'` | focused + UAT-04 |
| INV-13 | `inventory-native-document.js` | `inventory_native_documents` | focused + UAT-12 |
| INV-14 | `inventory-native-document.js` | `inventory_native_documents` | focused + UAT-13 |
| INV-15 | `inventory-transfer.js` | `inventory_transfers` EXTEND + `inventory` MOVE | focused + UAT-05 |
| INV-16 | `inventory-step-transfer.js` | `inventory_step_transfer_in_transit` NEW | focused + UAT-06 |
| INV-17 | `inventory-assembly-disassembly.js` | consumes `engineering-bom.js` resolver | Integration-Backed — Engineering BOM; focused |
| INV-18 | `inventory-lot-adjustment.js` | `inventory_lots` + `inventory_lot_balances` | focused + UAT-09 |
| INV-19 | `app.js` inline handler → `lib/inventory-mutation.js` (STATUS_CHANGE) | `inventory_stock_statuses` | focused + UAT-08 |
| INV-20 | `inventory-form-conversion.js` | consumes Master Data / Engineering | focused |
| INV-21 | `app.js` inline adjustment / scrap handlers | `inventory_adjustments` + `inventory_scraps` EXTEND | focused + UAT-18 / UAT-19 |
| INV-22 | `traceability-quality.js` EXTEND | `inventory_lots / inventory_lot_balances` | focused + UAT-09 |
| INV-23 | `traceability-quality.js` EXTEND | `inventory_lots.expiry_date / manufacture_date` | focused + UAT-11 |
| INV-24 | `traceability-quality.js` EXTEND | `inventory_serials` | focused + UAT-10 |
| INV-25 | `inventory-parameters.js` + product additive | canonical 位置维度（bin / owner / stock_status / lot / serial）；不另建 `aux_*` 列族 | focused |
| INV-26 | `inventory-abc-classifications.js` | `inventory_abc_classifications` NEW | focused + UAT-16 |
| INV-27 | `inventory-reports.js` | reads canonical | focused + UAT-26 |
| INV-28 | `inventory-lock.js` | `inventory_locks` NEW | focused + UAT-07 |
| INV-29 | `inventory-stocktake.js` | `inventory_checks` EXTEND (`check_kind='REGULAR'`) | focused + UAT-15 |
| INV-30 | `inventory-stocktake.js` | `inventory_checks` EXTEND (`check_kind='CYCLE'`) | focused + UAT-16 |
| INV-31 | `inventory-stocktake.js` confirm | applyInventoryMutation(ADJUSTMENT, diff) | focused + UAT-17 |
| INV-32 | `inventory-period-close.js` EXTEND | `inventory_period_closures / snapshots` | focused + UAT-27 |
| INV-33 | `inventory-reports.js` | reads canonical movements | focused + UAT-26 |
| INV-34 | `inventory-reports.js` | reads canonical balances + movements | focused + UAT-26 |
| INV-35 | `inventory-reports.js` | reads canonical balances + Finance valuation evidence | focused + UAT-26 |
| INV-36 | `inventory-reports.js` | reads canonical movements (movement age) | focused + UAT-26 |
| INV-37 | `inventory-reports.js` + `inventory_alert_thresholds` | reads canonical + threshold params | focused + UAT-26 |
| INV-38 | `inventory-reports.js` | reads ABC + SERIAL canonical | focused + UAT-26 |
| INV-39 | `inventory-barcode.js` + `inventory-barcode-generation.js` | `inventory_barcode_rules / bindings / resolution_log` | focused + UAT-22 |
| INV-40 | `inventory-scan-adapter.js` | adapter contract only | Integration-Backed — Business Domains; UAT-24 |
| INV-41 | `inventory-scan-adapter.js` | physical validation helper | Integration-Backed — Business Domains; UAT-24 |
| INV-42 | `inventory-scan-adapter.js` + `inventory-stocktake.js` | `inventory_check_items` insert | focused + UAT-23 |
| INV-43 | `inventory-reports.js` scan query | reads canonical inventory | focused + UAT-22 |
| INV-44 | `inventory-container.js` | `inventory_containers / items` | focused + UAT-25 |

```text
44 / 44 mapped
40 Domain-Owned
4 Integration-Backed
```

> **2026-11-12 修订（域级 Acceptance 整改轮）**：上表的 owner 列按实现事实更正。`warehouse-master.js`、`inventory-stock-status-mutation.js`、`inventory-adjustment-scrap.js` 三个模块**从未存在**；INV-02 的实际 owner 是 `warehouses.js`，INV-19 与 INV-21 分别是 `server/app.js` 的 inline handler。INV-15 的 owner `inventory-transfer.js` 与 INV-29～31 的 owner `inventory-stocktake.js` 已在本轮成为**唯一**写入口（legacy 的 tuple 写入口退役），INV-39 增加条码生成与标签渲染模块 `inventory-barcode-generation.js`。本修订只更正 owner 映射，不改变任何能力语义。
> **2026-11-13 修订（域级 Acceptance 收尾轮）**：INV-25 的辅助属性由 canonical 位置维度承载（仓位 / 所有权 / 库存状态 / 批号 / 序列号），上表原写的 `inventory.aux_*`（optional）列族**作为实现载体退役**——Requirement §32.3 对该能力的表述（「库存身份允许使用必要的辅助属性」「Inventory owns these attributes as physical-stock dimensions」）已由这些维度满足，另建列族既无实现也无使用方。本修订只更正实现载体，不改变该能力本身。

### 27.53 Rollback Strategy

- 应用代码回退到既有 mutation path（既有 `adjustInventory` 暂时兼容 wrapper）；
- additive 列保留（旧 schema 仍能读）；
- 不 destructive down-migrate；
- 既有 release tag `v1.6.2` 不破坏；
- MySQL migration 出现 mismatch 时 fail-closed，不自动 fix；
- 关闭 WAVE E 前的任何中间态都允许 rollback 至上一 Wave 完成态。

### 27.54 Final Acceptance

- focused tests：Wave A-E focused suites（每 Wave 5+ focused tests）；
- canonical：`pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- MySQL（受保护 disposable MySQL 8 环境）：`pnpm test:mysql` + `pnpm test:mysql:concurrency`（14 race）+ `pnpm test:mysql:performance` 全 PASS；
- Functional UAT 28 / 28 PASS；
- Responsive UAT 6 surfaces × 4 widths = 24 / 24 PASS；
- 兼容性 contract：既有 frozen domains 通过 compatibility view 仍可读 `(warehouse_id, product_id)` aggregate；
- 既有 5 role seed 不破坏；既有 `INVENTORY_*` / `INVENTORY_SCRAP_*` / `INVENTORY_CHECK_*` permission 不破坏；
- 最终用户 PASS 后方可 Freeze。

Final verdict（本节 Design）：`READY FOR USER REVIEW`。后续 Implementation 严禁扩张 5 Wave，不得补充 race list 之外的 concurrency case，不得修改 capability IDs 与 owner accounting。

### 27.55 Final MySQL Verification Technical Corrections（2026-10-10）

本节只记录 Final Verification 中确认的实现事实，不改变 44 capability、40 + 4 accounting、14 race、28 UAT 或 5 Waves。

- `financial-inventory.js::systemHealth` 的 LOT / SERIAL reconciliation 分别从 canonical `inventory` 聚合与 tracking 派生子查询取数，避免多维库存 join multiplication，并兼容 MySQL `ONLY_FULL_GROUP_BY`。
- legacy inventory transfer 在 LOT / SERIAL allocation 已解析时，按明确的 `lot_id / serial_id` canonical position 更新源与目标；NONE 路径仍使用受限 default-position compatibility adapter。调拨前后余额均按 active positions 聚合，不读取任意单行。
- `inventory_mutation_log` 与 `inventory_step_transfer_in_transit` 由 `migrateInventoryPositionSchema` 在启动/升级阶段创建。业务事务不再把这两张表的首次 DDL 当作正常写路径，避免 MySQL DDL implicit commit 破坏原子性。
- `applyInventoryMutation` 对涉及的 `position_key` 去重、按字典序 ASC 排序，并在 MySQL 使用 `FOR UPDATE`；idempotency evidence 在 MySQL 同样锁定后读取。
- `test:mysql:concurrency` 依次运行 Generic Phase 7B、Procurement/Outsourcing 与 Inventory/Warehouse 三套真实 MySQL suite。Inventory suite 使用独立进程/连接并在启动时 positive assert `db.dialect === 'mysql'`，覆盖冻结的 RACE-01..RACE-14，不以 SQLite race 替代 MySQL 证据。
- canonical test fixtures 使用 `UNIQUE(position_key)` 对应的 canonical helper；不恢复 `UNIQUE(warehouse_id, product_id)`，不削弱 owner/bin/status/lot/serial identity。

Final verification evidence：`pnpm test:mysql`、`pnpm test:mysql:concurrency`（Inventory 14 / 14 on MySQL）、`pnpm test:mysql:performance`（all writer levels errors=0）、`pnpm test:fast`、`pnpm test`（2309 / 2309；fail/cancelled/skipped/todo=0）、`pnpm test:heavy`、`pnpm build` 与 `git diff --check` 全部作为最终 acceptance gate 保存于当日开发日志；`.tmp/*.log` 仅为未提交诊断证据。

### 27.56 Inventory 统一期间控制接入设计（R-02）

> 状态：`APPROVED`（业务所有者 2026-11-14 批准）；上游合同：Requirement §32.12；公共 guard 合同：Platform Design §32.15；
> Implementation：已授权（2026-11-14 起实施）。本节只解冻期间控制接入，不改变 44 项能力、canonical position identity、
> valuation 或既有域级 Freeze 的其他结论。

#### 27.56.1 Owner、action 与调用流

`server/modules/inventory-period-close.js` 继续拥有 Inventory close/reopen 与连续 closed-through 语义；
`inventory_period_closures` 继续是业务状态权威。所有改变库存数量、位置身份、批序列状态、价值或估值结果的
mutation 以具名 `INVENTORY_MUTATION / INVENTORY_VALUATION` action 调用 Platform guard，固定要求
`INVENTORY + LEGAL_ACCOUNTING`。

`applyInventoryMutation` 在调用方事务中只调用一次组合 action；不得先后调用两个可漂移的旧 gate。
`assertInventoryPeriodOpen` 与 `financial-inventory.js::assertFinancialPeriodsOpen` 在迁移期只能委托 canonical
guard，zero-caller 后删除。系统凭证由 Accounting action 另行保护；Inventory mutation 的 axes 并集确保库存写
与其法定会计日期处在同一锁快照。

标准流：权限 → transaction → 重读 source document、businessDate、canonical position 与 idempotency evidence →
按 rank 锁 Inventory/Legal anchors → 重读两轴状态 → 库存/LOT-SERIAL/valuation invariants → inventory movement、
balance/value、下游证据与 success audit 原子写入 → commit。期间拒绝必须使以上副作用全部为零，并在 rollback
后写一次 rejection audit。

#### 27.56.2 Close / reopen 状态机与并发

Inventory close 只允许连续推进 closed-through，目标期间前不得有未关闭缺口；重复 close 幂等，倒序 close 或
断裂状态报 `PERIOD_SEQUENCE_INVALID / PERIOD_STATE_INVALID`。close 与 mutation 都先锁
`period_guard_anchors(INVENTORY, GLOBAL)`，故 close 的权威 snapshot 要么包含已提交 mutation，要么 mutation
观察到 closed 并被拒绝。

Inventory reopen 只允许最新 CLOSED 期间且 reason 必填；它先锁 Inventory、再锁 Legal，若对应 Legal period
仍关闭则拒绝。Legal close 则锁 Inventory 后重读其 closed-through，必须已覆盖会计期末才能继续。该协议落实
Inventory → Legal 的关闭顺序与 Legal → Inventory 的重开顺序，且不依赖前端操作次序。

#### 27.56.3 Schema、RBAC / SOD、错误与 UI

本域不新增第二业务期间表；Platform migration 只增加 Inventory stable anchor。既有历史关闭行不重写，缺失、
重复或断裂不由 GET/CHECK 修复。沿用 `INVENTORY_PERIOD_CLOSE_VIEW/MANAGE`，后端 fail closed；close/reopen 的
既有职责分离继续生效，ADMIN 无期间 bypass，reopen reason 必填。

保留 route、request schema 和 `INVENTORY_PERIOD_CLOSED`；依赖/顺序/状态错误使用 Platform §32.15 统一 409。
成功审计记录 period、before/after closed-through、reason、actor；拒绝审计记录 action、业务单据、日期和命中轴。
既有 Inventory period UI 已有 reason 输入，补充 Legal 依赖与 preflight 状态展示即可，不新建第二 screen，并复核
320 / 390 / 430 / 680。

#### 27.56.4 测试、兼容与回滚

focused tests 覆盖边界日、连续 close、latest-only reopen、Legal 依赖、所有 canonical mutation family、
LOT/SERIAL/valuation 零副作用、幂等与 rejection audit exactly once；更新 inventory period、financial inventory
与 mutation suites，并把新测试登记到 `scripts/testing/test-suites.js`。

真实 MySQL 必须以两个 HTTP handler/独立连接制造 close vs mutation 竞态，正向断言 dialect 为 MySQL。若两方均
成功，证据必须证明 mutation 先提交且 close 的 precheck snapshot 已纳入它；现有由 direct INSERT worker 构造、
允许双成功却无 snapshot 证明的 RACE-12 不再作为 R-02 验收证据。最终还需 FULL、HEAVY、build、diff check 与
经批准的专属 MySQL campaign。

兼容性保持现有 inventory tables、position identity、API 与 closed error code；行为仅收紧旧绕行路径。回滚必须
与 Platform/Finance/Accounting 作为单一逻辑单元，不 DROP anchor、不改历史、不单独恢复旧双 gate；整体回退后
R-02 重新阻塞发布。

本节 Design：`APPROVED`（2026-11-14）；Implementation：已授权，并于 2026-11-14 起实施。
**HARD STOP**：专属 ACK-4 campaign（handler-vs-handler 竞态）仍须业务所有者单独批准后方可运行。

---

# 28. Finance Operations Domain Closure Technical Design

> 本节为 **canonical technical design** for Finance Operations Domain Closure。
> 需求合同见 `document.md §33`（58 capability = 55 Domain-Owned + 3 Integration-Backed，14 invariant F1–F14，32 UAT，15 MySQL RACE，3 Canonical Recognition Models）。
> 早期 Finance technical 内容（§9.4 / §13）保留为 historical context；以本节为唯一权威。
> 本节实现后取代 `solution.md §13.1 / §13.2` 中关于 AR / AP / Invoice 的旧描述；`§13.3 / §13.4 / §13.5` 已由 `document.md §33.1.3` normalization 明确归属 Accounting & Analytics，本节不重复。
> Implementation 阶段严禁新增 capability ID、UAT、RACE；不得绕开 §28 引入第二 AR/AP ledger 或第二 Treasury movement engine。

## 27.58 route exposure 与页面自身 API 权限一致性有界增补设计（`APPROVED`，2026-11-15）

> 合同：Requirement [`docs/requirements/inventory-warehouse.md` §32.13](../requirements/inventory-warehouse.md)（`IW-EXPOSURE-01..05`）。
> 平台合同：Requirement [`docs/requirements/platform.md` §36.18](../requirements/platform.md)（`PL-EXPOSURE-01..07`）、
> Design [`docs/design/platform.md` §32.18](../design/platform.md)。
> 本节只描述实现过程，不粘贴实现代码。

### 27.58.1 边界

本节只改 `inventory` 一条 canonical route 的**页面参照加载口径**。本域其余 route、21 个页签的**集合**、
权限码、能力集合与 2026-11-13 的域级 Acceptance / Capability Freeze 记录**保持不变**。

后端 API 守卫**一字不改**；`inventory` route 的 exposure `any:['INVENTORY_VIEW']` **不变**；
不新增权限码、不修改 `role_permissions`。前端隐藏不构成授权：后端继续 fail closed。

方向固定为「页面按 actor 权限自适应」，**不是**「收紧 exposure」——后者改变权限结果，
是 `docs/decisions/OPEN-BUSINESS-DECISIONS.md` 登记的开放业务决定，本节不自行吸收。

### 27.58.2 模块与调用

| 文件 | 改动 |
|---|---|
| `src/lib/inventoryWorkReferences.js`（**新增**） | `inventory` 的 4 个参照数据源登记（端点 / 响应字段 / 读取权限）+ 按权限的加载策略与可读性判定；机制复用平台原语 `src/lib/routeApiAuthority.js` |
| `src/pages/inventory-work.jsx` | `useInventoryReferences` 由 `(notify)` 改为 `(user, notify)`，按 actor 权限发起请求；无权参照**一次请求都不发**；参照可读性随 `references` 下发，供页签判定无权态 |

参照登记（唯一事实来源）：

| 参照 key | 端点 | 读取权限（后端守卫口径） |
|---|---|---|
| `warehouses` | `GET /api/warehouses` | `WAREHOUSES_VIEW` / `WAREHOUSES_MANAGE`（择一） |
| `products` | `GET /api/products` | `PRODUCTS_VIEW` / `PRODUCTS_MANAGE`（择一） |
| `stockStatuses` | `GET /api/inventory-stock-statuses` | `STOCK_STATUS_VIEW` / `STOCK_STATUS_MANAGE`（择一） |
| `bins` | `GET /api/warehouse-bins` | `WAREHOUSE_BIN_VIEW` / `WAREHOUSE_BIN_MANAGE`（择一） |

### 27.58.3 页面行为

1. **首屏**：只请求 actor 有权读取的参照。`role-reviewer` 进入 `inventory` 时**不再**请求库存状态与仓位。
2. **无权态与空态**：无权读取的参照对应页签呈现明确的「无权限」状态；
   有权但无数据呈现「暂无记录」。二者不得共用同一个空态。
3. **页签不得暴露无权能力**：页签自身所需的读取权限 actor 不具备时，
   不得以「可点击但必然 403」的形式呈现（`IW-EXPOSURE-05`）。
4. **逐项失败不互相阻断**：单个参照加载失败不影响其它参照；失败被提示，不静默。

### 27.58.4 事务、审计、金额与错误行为

本节**只改读路径**：不新增写入口、不新增事务边界、不新增审计事件、不改变库存数量、
状态机、估值与会计口径。错误行为按 `IW-EXPOSURE-03` 处理：无权是**状态**不是**错误**，
失败才是错误。

### 27.58.5 回滚

新增模块与页面改动可整体回退。回退后 `inventory` route 对 `role-reviewer` 的首屏 403 会重新出现，
因此回退必须与平台守卫的同批改动同批进行，不得只回退其一。

### 27.58.6 验证与变异实验

focused 证据：登记与后端守卫逐项一致；逐 canonical 角色（真实种子库）断言首屏请求集合 ⊆ 该角色权限；
无权时零请求；无权态与空态可区分；页面不得自带第二份端点清单。
release 证据：穷尽枚举 93 route × 5 角色首屏非预期 4xx/5xx = 0；canonical 浏览器门禁退出码 0。

变异实验：① 参照加载改回无条件 → 包含性断言必须转红；② 篡改 `stockStatuses` 的权限登记 →
守卫一致性断言必须转红；③ 恢复页签的无权态渲染 → 无权态/空态断言必须转红。

### 27.58.7 Design 状态

Requirement §32.13：`APPROVED`（2026-11-15）；本节 Design：`APPROVED`（同日）；
Implementation：**已授权**（范围仅限本节所列仓库内代码与测试）。

**未授权**：真实 MySQL 连接、数据库破坏性操作、Acceptance / Freeze 签发、push / tag / merge / release / deploy。

### 27.59 D4 批次 / 序列号跟踪列表端点与跟踪维度投影一致性设计（`APPROVED`，2026-11-17）

#### 27.59.1 改动清单

| 文件 | 改动 |
|---|---|
| `server/modules/traceability-quality.js` | 新增 `listLots(db, filters)` / `listSerials(db, filters)`（主档读模型，数量取自既有维度事实）；新增 `maintainTrackedDimension(db, …)`（canonical 位移写入器的投影维护入口） |
| `server/modules/inventory-lot-adjustment.js` | 新增 `listLotAdjustments(db, filters)`（单据读模型） |
| `server/modules/inventory-form-conversion.js` | 新增 `listFormConversions(db, filters)`（单据读模型） |
| `server/modules/inventory-container.js` | 新增 `listContainers(db, filters)`（单据读模型） |
| `server/app.js` | `ownedRouteTable` 注册 5 个 `GET` 端点（各自 owner 模块） |
| `server/lib/inventory-mutation.js` | 自记 tracked movement 的分支同时维护跟踪维度投影 |
| `server/modules/inventory-native-document.js` | 删除其显式 `transitionSerialForInventoryMovement` 调用（改由 canonical 位移写入器维护，避免二次状态迁移） |
| `server/migrations/v25-tracked-dimension-alignment.js`（新增） | 幂等对齐：按 canonical 仓位回填 `inventory_lot_balances`，并清除无对应仓位的陈旧投影行 |
| `server/db.js` / `server/database/mysql-adapter.js` | 双路径接线该对齐迁移 |
| `src/lib/inventoryWorkTabs.js` | 登记三个页签的读取端点与既有权限码 |
| `src/pages/inventory-work.jsx` | 批号调整 / 形态转换 / 容器三个页签在打开时加载各自列表 |

#### 27.59.2 端点、守卫与 owner

| 端点 | owner 模块 | 守卫 | 读模型 |
|---|---|---|---|
| `GET /api/inventory-lots` | `server/modules/traceability-quality.js` | `INVENTORY_VIEW` | 批次主档：身份、货品、状态、有效期、来源、当前数量、所在仓库 |
| `GET /api/inventory-serials` | `server/modules/traceability-quality.js` | `INVENTORY_VIEW` | 序列号主档：身份、货品、生命周期状态、当前仓库、有效期 |
| `GET /api/inventory-lot-adjustments` | `server/modules/inventory-lot-adjustment.js` | `INVENTORY_LOT_ADJUSTMENT_VIEW` | 批号调整单：单号、类型、状态、货品、仓库、数量、原因、创建 / 确认人与时间 |
| `GET /api/inventory-form-conversions` | `server/modules/inventory-form-conversion.js` | `INVENTORY_FORM_CONVERSION_VIEW` | 形态转换单：单号、类型、状态、货品、仓库、数量、原因 |
| `GET /api/inventory-containers` | `server/modules/inventory-container.js` | `INVENTORY_CONTAINER_VIEW` | 容器：容器号、类型、状态、仓库、成员数、父容器 |

- 守卫**只用既有权限码**（`INVENTORY_VIEW` 与三个 `..._VIEW`），与既有写端点的
  `..._MANAGE` 成对；不新增权限码、不改 `role_permissions`、不改任何角色的权限集合。
- 批次 / 序列号主档的数量**必须**取自既有维度事实（`inventory_lot_balances` /
  `inventory_serials`），与 `listTrackingIdentities` / `trackedAvailability` /
  `traceIdentity` 同源；不得出现第二份数量算法（`IW-TRACE-06`）。
- 单据列表沿用既有单据读模型风格（`listNativeDocuments` 的形态）：
  可选过滤（状态 / 类型）、按创建时间倒序、限量返回、附创建 / 确认人显示名。

#### 27.59.3 跟踪维度投影的维护点

**不变量**：canonical 仓位（`inventory`）里带批次 / 序列号身份的数量，
必须与批次维度投影（`inventory_lot_balances`）和序列号当前位置 / 生命周期一致。

| 路径 | 跟踪移动证据 | 投影维护者（改后） |
|---|---|---|
| 寄售（`trackingMode=CONSIGNMENT_STRICT`） | `postCanonicalTrackedLeg` | `postCanonicalTrackedLeg`（不变） |
| 委外（`trackingMode=EXTERNAL`） | 委外模块调用 `postCanonicalTrackedLeg` | 同上（不变） |
| 一般路径（其余） | `applyInventoryMutation` 自记 `tracked_inventory_movements` | **`applyInventoryMutation`（本轮新增）** |

- 维护调用既有原语：`changeLotBalance`（批次余额，守恒 + 负数拒绝）与
  `transitionSerialForInventoryMovement`（序列号生命周期与当前位置）。
  **不新增业务拒绝语义**：一般路径下的 `changeLotBalance` 负数检查在投影与 canonical
  仓位一致时恒不触发（投影按 `(仓库, 批次)` 聚合，恒 ≥ 单仓位数量），
  其拒绝码与拒绝文案沿用既有实现。
- 序列号状态迁移只做一次：一般路径的 `inventory-native-document.js` 原有显式调用**删除**，
  避免同一次移动被迁移两次（出库方向会因状态已迁移而误拒）。
- 序列号生命周期取值仍由业务语义决定（`SALES_DELIVERY` → `DELIVERED`、
  含 `SCRAP` → `SCRAPPED`、其余 → `CONSUMED`），不在本轮改动。

#### 27.59.4 对齐迁移

- 只写投影，不动 canonical 仓位：按 `inventory`（`active=1`）的
  `(warehouse_id, product_id, lot_id)` 聚合回填 `inventory_lot_balances.quantity`，
  并删除无对应 canonical 仓位的陈旧投影行。
- 幂等：重复执行结果相同；不新增 / 修改任何 canonical 仓位、库存数量、状态机、
  估值或会计事实，不改写历史移动证据。
- 接线：`server/db.js`（SQLite 初始化路径）与 `server/database/mysql-adapter.js`
  （活体 MySQL 路径）调用**同一份**实现。

#### 27.59.5 前端页签登记与加载

- `src/lib/inventoryWorkTabs.js`：把「批号调整」「形态转换」「容器」三个页签的
  `reads` 从 `[]` 改为各自的读取端点与既有权限码（`kind: 'all'` +
  `..._VIEW` 码）。页签**集合**不变（21 个），只改变可见性与参照加载（承 §32.13.4）。
  可见性后果：`role-warehouse`（持三个 `..._VIEW`）三页签照常可见；
  只持 `INVENTORY_VIEW` 的角色（如 `role-reviewer`）不再看到这三个页签 ——
  这正是 `IW-EXPOSURE-05`「页签不得暴露无权能力」的要求。
- `src/pages/inventory-work.jsx`：三个页签组件在打开时读取自己的列表；
  保留既有 `InventoryWorkState` 的 loading / error / empty 三态；
  新建成功后的本地追加仍保留（与列表刷新不冲突）。

#### 27.59.6 事务、审计、错误行为

- 五个列表端点为**只读**，不写库、不写审计；无权时按既有 `allow` / `allowAny` 语义 403。
- 投影维护与对齐迁移都在既有事务边界内完成；失败即回滚，失败副作用为零。
- 端点错误一律显式抛出（不静默返回空集合）：未知过滤参数不改变语义，
  非法过滤值按既有单据读模型的形态处理。

#### 27.59.7 回滚

- 端点与前端登记可整体回退（删路由 + 回退页签登记与加载）。
- 投影维护回退后，投影将重新只由严格路径维护（回到本轮前的行为），
  对齐迁移留下的投影行**保留**（它们是 canonical 仓位的派生值，不是有害残留）。
- 播种（§32.21）与本节互不依赖，可分别回滚。

#### 27.59.8 验证与变异实验

1. 端点合同测试：5 个端点的 2xx / 403、读模型字段、过滤与限量。
2. 投影一致性测试：一般路径（原生其他入库 / 出库）写入带批次的货品后，
   `inventory_lot_balances` 与 `inventory` 聚合一致；
   `GET /api/tracking/reconcile` 返回 `ok=true`；
   `systemHealth` 的 `TRACKED_DIMENSION_VS_CANONICAL` 差异为 0。
3. 对齐迁移幂等测试：重复执行后差额仍为 0，canonical 仓位逐行未变。
4. 前端登记测试：页签 `reads` 与后端实际守卫逐项一致；三页签在有权角色下加载列表、
   在无权角色下不发请求。
5. 变异实验：① 去掉投影维护 → 一致性断言必须转红；② 把守卫放宽为 `INVENTORY_VIEW` →
   页签登记一致性断言必须转红；③ 把对齐迁移改成「造库存」→ canonical 仓位未变断言必须转红。

#### 27.59.9 Design 状态

Requirement §32.14：`APPROVED`（2026-11-17）；本节 Design：`APPROVED`（同日）。
Implementation：**已实施**（`IW-TRACE-01..06`）。

**未授权**：真实 MySQL 连接、数据库写操作、Acceptance / Freeze 签发、push / tag / merge / release / deploy。

---

## 27.60 期初库存计价设计（F-02，`APPROVED` → `IMPLEMENTED`，2026-11-18）

> **授权来源**：业务所有者 2026-11-18「现在请修复四项阻塞 直接修」→ Requirement §32.15 与本节
> Design 连续授权；Implementation 随之实施。**未授权**：真实 MySQL 连接与数据库写操作、
> Acceptance / Freeze 签发、push / tag / merge / release / deploy。
>
> **前置合同**：Requirement §32.15 `IW-OPEN-01..06`；估值与结账口径归 Accounting & Analytics
> （`AA-W6.15` 关闭异常清单、`INVENTORY_VALUE_TO_GL` 对账）。

### 27.60.1 模块与责任

| 模块 | 责任 |
|---|---|
| `server/migrations/v26-opening-inventory-cost.js` | additive 迁移：`opening_inventory_items.unit_cost_cents`（安全整数分）+ 期初权益科目 `4001 实收资本` 与角色映射 `OPENING_EQUITY` |
| `server/modules/inventory-opening.js` | 期初单据唯一 owner：建单校验（成本 / 身份）、确认写数量 + 权威估值 + 总账对方分录、列表读模型暴露成本 |
| `server/modules/financial-inventory.js` | 既有 canonical 估值与凭证原语（`receiveValue` / `createSystemVoucher` / `inventoryAccountRole`），**不新建第二套估值算法** |
| `server/lib/inventory-mutation.js` | 既有 canonical 物理库存写入器；期初以 `valuationMode='EXTERNAL'` 调用，**跳过**其 best-effort 估值分支（该分支对 IN 型移动按出库口径取值且吞异常） |
| `src/pages/inventory-work.jsx` | 期初录入界面：每行新增「期初成本单价（元）」，按精确十进制换算成整数分 |

### 27.60.2 数据流与调用

```text
POST /api/inventory/opening-documents
  → createOpeningDocument
      · 逐行校验 productId / warehouseId / quantity
      · 逐行校验 unitCostCents（安全整数分、> 0）        [IW-OPEN-01]
      · 逐行校验身份：跟踪物料必须带已存在且属于该货品的批次 / 序列号  [IW-OPEN-04]
      · INSERT opening_inventory_items(..., unit_cost_cents)

POST /api/inventory/opening-documents/:id/confirm
  → confirmOpeningDocument（单事务）
      · applyInventoryMutation(valuationMode='EXTERNAL')   → 数量 + 跟踪维度投影
      · receiveValue(quantity, valueCents, lotId/serialId, valuationBasis='OPENING_COST')
                                                          → 权威估值流水 + 身份级估值池 + VALUED
      · createSystemVoucher(存货角色 DEBIT | OPENING_EQUITY CREDIT)  → 总账同步
      · opening_inventory_documents.status = 'CONFIRMED'
```

### 27.60.3 Schema / Migration

- `opening_inventory_items.unit_cost_cents INTEGER NOT NULL DEFAULT 0`：
  **既有行不回填**（`IW-OPEN-05`）；缺成本的既有行在确认时被拒绝。
- 期初权益：科目 `4001 实收资本`（`EQUITY` / `CREDIT`）+ 角色 `OPENING_EQUITY`。
  科目表此前没有权益科目，期初价值无处记账；权益锚点不改变任何既有科目余额。
- 迁移幂等（列存在性检查 + `INSERT OR IGNORE`）；SQLite 与 MySQL 双路径共用
  （列类型用两库通用的 `INTEGER`，无 `CHECK`）。

### 27.60.4 事务、状态与错误行为

- 建单与确认均在既有 `transaction(db, …)` 内；确认失败（缺成本 / 缺身份 / 估值溢出 /
  凭证借贷不平衡）整体回滚，**零库存、零估值、零凭证副作用**。
- 状态机不变：`DRAFT → CONFIRMED`；只有 `DRAFT` 可确认，`OPEN` 初始化状态之外不可确认。
- 错误信息指向具体行与具体原因（成本缺失 / 身份缺失 / 身份不属于该货品）。
- 幂等：期初行以 `OPENING:<item_id>` 为幂等键，复用 canonical 写入器的重放证据。

### 27.60.5 RBAC / SOD / 审计

- 权限沿用既有 `INVENTORY_OPENING_MANAGE` / `INVENTORY_OPENING_VIEW`，**不新增权限码**。
- 审计沿用既有 `CREATE` / `CONFIRM` 两条 `OPENING_INVENTORY` 审计事件，不新增审计实体。
- 本节不引入新的职责分离要求：期初建单与确认仍是同一既有权限码下的两个动作。

### 27.60.6 兼容性与影响面

- 只影响期初单据路径；采购入库、生产入库、委外收发、盘点、调拨的估值路径**不变**。
- 既有期初单据（`unit_cost_cents=0`）在确认时被拒绝而不是被自动估价；这是刻意 fail closed。
- `INVENTORY_VALUE_TO_GL` 由「空转相等」变为「有值相等」：期初估值与总账同步写入，
  差额恒为 0；这是本节的正向结果，不得通过弱化该检查达成。

### 27.60.7 测试与变异实验

1. 合同测试（`server/inventory-opening-cost.test.js`）：带成本确认 → 移动 `VALUED`、
   身份级估值池数量与金额逐分相等、总账借贷平衡、三项健康检查差异为 0。
2. 负向对照：缺成本、缺身份、身份不属于该货品三种拒绝，且不留下任何事实。
3. 变异实验：① 去掉 `receiveValue` → 估值池与 `VALUED` 断言必须转红；
   ② 把成本校验放宽为 0 → 「缺成本固定拒绝」必须转红；
   ③ 去掉总账凭证 → `INVENTORY_VALUE_TO_GL` 断言必须转红。

### 27.60.8 Design 状态

Requirement §32.15：`APPROVED`（2026-11-18）；本节 Design：`APPROVED`（同日）；
Implementation：**已实施**（2026-11-18）。真实 MySQL 连接、数据库写操作、Acceptance / Freeze
签发、发布与部署**未授权**。

---

## 27.61 期初跟踪身份的登记入口设计（F-05，`APPROVED` → `IMPLEMENTED`，2026-11-18）

> 对应 Requirement §32.16（`IW-OPEN-07..10`）。授权来源：业务所有者 2026-11-18 指令
> （Requirement → Design → Implementation 连续授权，承 AGENTS.md §4.0）。

### 27.61.1 模块与职责

| 模块 | 职责 | 本节变化 |
|---|---|---|
| `server/modules/inventory-opening.js` | 期初初始化 / 期初单据（`IW-OPEN-01..06`） | 新增 `createOpeningIdentity`：登记期初流程自己的跟踪身份主档 |
| `server/app.js` | HTTP 生命周期与 dispatch | 注册 `POST /api/inventory/opening-identities`，owner = `server/modules/inventory-opening.js` |
| `src/pages/inventory-work.jsx` | 库存作业工作面 / 期初录入 | 期初行按货品跟踪方式呈现「已有身份」与「登记新身份」两条路径 |
| `server/modules/traceability-quality.js` | 跟踪身份主档列表（`IW-TRACE-01`） | **不变**：登记后的身份立即出现在既有主档列表里 |

### 27.61.2 端点与数据流

```text
POST /api/inventory/opening-identities
  body: { productId, kind: 'LOT'|'SERIAL', code, manufactureDate?, expiryDate? }
  → createOpeningIdentity(db, req, res, actor)
      → allow(actor, 'INVENTORY_OPENING_MANAGE')          // 既有权限码，fail closed
      → assertAllowedFields(只接受 5 个字段)
      → 货品跟踪方式校验（IW-OPEN-08）
      → 已存在？返回 200 { id, existing: true }（不产生第二条身份）
      → 否则 INSERT 身份主档 → 201 { id, existing: false } + audit
```

- **身份主档的来源标记**：`created_source_type='OPENING_INVENTORY'`（库存期初既有来源词表），
  `created_source_id` 指向身份自身（登记发生在期初单据建单之前，尚无单据可引用）。
- **身份主档的投影**（批次余额 / 序列号位置）仍由 canonical 位移写入器维护（§32.14 `IW-TRACE-04`）；
  本节**不新增**第二条投影写入路径，也不新建表、不做迁移。
- **幂等**：依赖既有唯一约束 `UNIQUE(product_id,lot_code)` / `UNIQUE(product_id,serial_number)`；
  登记前先查后写，同码返回既有身份。

### 27.61.3 界面

- 期初行的**货品**决定身份形态：普通料不出现身份控件；批次料出现「已有批号」选择与
  「登记新批号」；序列号料出现「已有序列号」选择与「登记新序列号」。
- 序列号物料的数量固定为 1（服务端既有合同：序列号物料每次只能期初 1 件），界面据此锁定输入。
- 「已有身份」列表按货品懒加载 `GET /api/inventory-lots` / `GET /api/inventory-serials`；
  **无权读取身份主档时一次请求都不发**（承 §32.13 `IW-EXPOSURE-02`）。
- 「登记」动作调用期初身份登记端点，成功后该行即携带已登记身份 id；提交时随期初单一起发送。
- 跟踪物料行未登记身份时，界面在提交前给出明确提示，不依赖后端 400 作为唯一提示。

### 27.61.4 权限、错误、审计、兼容

- **权限**：守卫是既有权限码 `INVENTORY_OPENING_MANAGE`；不新增权限码、不改 `role_permissions`、
  不改任何角色的权限集合、不改 `inventory` route 的 exposure（承 §32.13 `IW-EXPOSURE-04`）。
- **错误**：缺货品 / 缺批号 / 缺序列号 / 身份类型非法 → 400；货品不存在 → 404；
  跟踪方式不一致 → 409 `TRACKING_POLICY_MISMATCH`（带 `resolution`）；无权 → 403。
  错误语义沿用既有 `HttpError` 分类与载荷，不新增跨域错误码耦合。
- **审计**：登记写审计（`CREATE` / `INVENTORY_LOT` 或 `INVENTORY_SERIAL`）；重复登记不写新事实，
  只返回既有身份。
- **兼容**：`IW-OPEN-04` 不变（期初行仍必须引用**已存在**身份）；既有身份主档、投影、报表、
  结算清单全部不变；无数据迁移、无回填。

### 27.61.5 测试与状态

- **合同测试**（`server/inventory-opening-identity.test.js`，已登记 FULL）：登记成功、同码幂等、
  无权 403 且零副作用、跟踪方式不匹配与缺码固定拒绝、端到端（登记 → 期初 → 确认 →
  身份级估值池成立且移动为 `VALUED`）。
- **变异对照**：去掉 `allow(actor, 'INVENTORY_OPENING_MANAGE')` → 「无权 403」断言必须转红
  （已实测：4 项中 1 项转红）。
- **状态**：Requirement §32.16 `APPROVED`（2026-11-18）；本节 Design `APPROVED`（同日）；
  Implementation **已实施**（2026-11-18）。真实 MySQL 连接、数据库写操作、Acceptance / Freeze
  签发、发布与部署**未授权**。
