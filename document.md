# Modern ERP 当前功能与业务需求

## 1. 范围、版本与术语

本文档是 Modern ERP 唯一当前功能和业务需求来源，回答“系统必须做什么、允许什么、禁止什么”。运行入口见 README.md，技术实现见 solution.md。docs/ 下的阶段文档、审计和验收记录是支持性或历史证据，不得覆盖本文档。

当前 release context 为 Git tag v1.3.0。Git release tag 是项目版本的权威来源；本文档不维护独立语义版本。package.json 的 2.4.0 属于包元数据历史漂移，不代表当前项目发布版本。

术语：

- 产品：通用主数据；在 BOM、MRP 和生产上下文中也称物料。
- 业务日期：决定履行、计价和会计期间的日期，不得用创建时间代替。
- 来源快照：单据创建或过账时冻结的往来单位、产品、价格、UOM、税、BOM、工艺或条款信息。
- canonical：当前被系统承认为唯一权威的业务来源或账本。
- CHECK-only：只报告差异，不自动修复或覆盖历史。

## 2. 产品目标与支持边界

Modern ERP 以单组织业务为边界，支持从主数据、销售、采购、计划、生产、质量和库存，到应收应付、结算、存货价值和总账的可追溯闭环。核心目标是：

- 业务单据具有明确来源、状态和责任人；
- 授权审批、实物移动与会计确认是不同事件；
- 库存、账款和总账影响在事务内保持一致；
- 关键经济事件不可通过普通编辑或硬删除改写；
- SQLite 与 MySQL 8 路径保持相同业务合同；
- 通过测试、审计日志和 System Health 提供可重复验证。

当前支持 SQLite 本地/测试兼容运行和 MySQL 8 一等运行后端。项目不声称已经取得任意生产负载下的企业级容量认证。

## 3. 角色、权限与职责分离

系统正常角色固定为五个：

| 角色 | 主要职责 | 明确限制 |
|---|---|---|
| ADMIN | 系统配置、主数据、计划与制造管理、异常管理；当前五角色模型中的手工凭证审批 | 仍受创建人不得审批自己单据约束 |
| SALES | 客户/供应商、CRM、销售订单、采购订单和请购单的创建、编辑、提交 | 不执行库存、质量、制造库存或会计动作；不审批 |
| REVIEWER | 独立审核销售订单、采购订单、请购单和库存盘点 | 不创建普通交易，不审批自己创建的单据 |
| WAREHOUSE | 收货、出货、退货、IQC/OQC、盘点提交、调拨、调整、报废、生产领退料和生产入库/冲销 | 不执行 MRP、商业计价、结算或会计；不审批自己的盘点 |
| ACCOUNTING | AR/AP、收付款、折让/贷项、退款、核销、手工凭证创建和提交、财务报表 | 不执行库存或制造；不能审批自己创建的凭证 |

前端菜单隐藏只改善体验；每个 API 必须在后端独立授权。VIEW 权限不得隐式授予 CREATE、MANAGE、APPROVE、POST 或 REVERSE。

审批中心只包含五类授权事件：

- SALES_ORDER
- PURCHASE_ORDER
- PURCHASE_REQUISITION
- INVENTORY_CHECK
- ACCOUNTING_VOUCHER

IQC/OQC、出入库确认、退货、结算、折让、生产领料/入库、HOLD/RELEASE 和期间动作是各自领域事件，不得为了复用界面而变成新的通用审批族。

## 4. 通用业务不变量

### 4.1 金额、数量与日期

- UI 以元录入和展示；API 和数据库使用安全整数分。
- 不允许 NaN、无穷值、小数分或静默默认金额进入过账边界。
- 借贷必须以整数分严格相等，不存在一分容差。
- 数量必须满足业务允许的正数/非负数和 UOM 换算规则；SERIAL 基本单位数量必须为整数。
- 合同日期、要求交期、预计到货日、物流日期和会计日期必须显式保存；创建/提交/审核时间不得代替业务日期。

### 4.2 状态与不可变性

- 状态转换必须同时校验当前状态、权限、来源和业务不变量。
- DRAFT 且没有下游或经济效果的记录可按政策编辑、取消或删除。
- 已确认、已过账和已完成记录不可普通编辑或硬删除；纠错必须使用显式反向单据或冲销。
- 关闭期间的历史不得被回写；允许的纠错必须在当前开放期间保留原始来源和反向证据。

### 4.3 来源、事务、幂等与审计

- 新的正常商业单据必须引用权威上游头和行；旧版无来源记录只能以 LEGACY/不可重新确认方式读取。
- 来源往来单位、产品、价格、UOM/税和关键快照创建后不得被普通草稿编辑替换。
- 确认或过账必须在同一事务内重新读取状态、来源、累计量、库存/未结余额和期间状态。
- 任一步失败必须回滚库存、价值、账款、凭证、审计和幂等结果。
- 支持幂等键的操作：相同键和相同语义返回原结果；相同键和不同语义返回冲突。
- 关键新增、变更、状态转换、确认、冲销、HOLD/RELEASE 和管理动作必须写审计日志。

## 5. 主数据

系统支持客户、供应商、产品、仓库、会计科目、部门、辅助项目、银行账户、税码、UOM、BOM、工艺路线和工作中心等主数据。

- 编码及适用自然键必须唯一。
- 有历史引用的主数据不得硬删除；应停用并保留历史显示。
- 停用记录不进入新单选择器，但历史单据仍可读取其名称和快照。
- 产品库存真相来自 inventory，不得从 products.stock_quantity 接受业务写入。
- 一个产品可有多个 BOM/路线版本，但只有符合约束的当前有效版本参与新业务。
- 跟踪策略为 NONE、LOT 或 SERIAL；产生跟踪流水后不得任意切换或关闭。

## 6. Order-to-Cash

权威链路：

    Customer → Sales Order → Approval → Sales Delivery
      → OQC gate → Inventory/COGS → Sales Invoice
      → AR/Revenue/Output Tax → Collection/Credit/Refund/Write-off

要求：

- 销售订单冻结客户、订单日期、要求交期、收货联系人/电话/地址、付款条件和行级价格。
- 要求交期不得早于订单日期；每行数量和价格必须为正。
- DRAFT 可编辑，SALES 提交后由 REVIEWER 独立批准或驳回。
- 批次出货只能来自 APPROVED 订单行，累计确认出货不得超过订单行数量。
- WAREHOUSE 可修改执行数量、仓库、业务日期和备注，不能修改商业价格。
- 需要质检的销售出货必须具有当前来源快照一致的 OQC PASS 或明确的有效免检快照。
- SEPARATE 模式下，销售出货只处理库存与 COGS；Sales Invoice 过账才确认 AR、收入和销项税。
- DIRECT_BILL/AUTO_BILL 也必须创建权威 Sales Invoice，不得恢复无发票来源的平行新流程。
- 销售退货恢复原出货价值并冲减 COGS；商业金额通过销售贷项处理，保持物理与商业事件分离。

## 7. Procure-to-Pay

权威链路：

    MRP/Purchase Instruction → Purchase Requisition → Approval
      → Purchase Order → Approval → Purchase Receipt
      → IQC gate → Inventory/GRNI → Supplier Bill
      → AP/Input Tax/PPV → Payment/Credit/Refund/Write-off

要求：

- 请购包含请购日期、要求到货日、产品、数量和可选参考估价。
- 无估价请购可生成零价 PO 草稿，但 PO 提交前必须有正的最终价格。
- PO 冻结供应商、订单/预计到货日期、联系人/地址、付款条款和成交价格。
- 收货只能来自 APPROVED PO 行；供应商、产品和价格由来源决定，累计收货不得超订单量。
- 需要质检的收货必须有有效 IQC PASS 或明确免检快照。
- SEPARATE 模式下，收货确认 Dr 存货 / Cr GRNI；Supplier Bill 完成三单匹配并过账后确认 AP、进项税和价差。
- 同一供应商的外部发票号必须唯一；未完成匹配的账单可以 WAITING_MATCH，但不能过账。
- 采购退货移除原账面价值；商业金额和税通过供应商贷项处理。

## 8. Planning、MRP 与请购

- 需求预测使用 DRAFT、ACTIVE、CANCELLED；MRP 只读取 ACTIVE 预测。
- MRP Run 是不可变计算快照；重复执行先清理该 run 的派生结果，不影响库存、会计或业务单据。
- 销售与预测消费采用 MAX(sales demand, forecast demand)，不得重复计算。
- BOM 展开使用 net-before-explosion：父项先扣可用库存、有效在途采购和生产供应，再以净 MAKE 数量展开组件。
- 可用库存排除 HOLD 和已过期的 LOT/SERIAL 身份。
- MRP 结果给出 MAKE/BUY、建议数量、需求日期、来源追溯和警告，但不会自动创建单据。
- 生产/采购指令可以分批占用建议量，累计不得超过建议。
- RELEASED 生产指令生成制令单；RELEASED 采购指令生成请购，APPROVED 请购生成采购订单。
- 计划与指令本身不产生库存、AR/AP 或总账效果。

## 9. 制造执行

权威链路：

    MRP → Production Instruction → Production Order
      → BOM/Routing/Cost snapshots → Material Issue/Return
      → Operation Report → Production Receipt/Reversal → Completion

- 制令单状态为 PENDING → IN_PROGRESS → COMPLETED，允许无经济影响状态进入 CANCELLED。
- 开工冻结 BOM 物料、路线、工作中心、标准时间和标准成本；主数据后续变化不改写在制单。
- 领料、退料、生产入库和入库冲销由 WAREHOUSE 执行，并产生明确来源的数量、身份、价值和 WIP 记录。
- 净领料不得超过需求；缺料时整单回滚。
- 入库不得超过计划量或末工序净良品，并必须满足组件覆盖。
- 工序报工保留良品、报废、人工/设备时间；已确认报工只能显式冲销。
- 完工要求无活动执行草稿、所有工序满足状态、净成品与良品/报废及物料覆盖对账一致。
- 制造成本区分标准基线、权威/部分/暂估材料证据、人工和制造费用；证据缺失不得伪装为零。

## 10. 库存、LOT、SERIAL 与追溯

- inventory 是仓库+产品数量真相；inventory_transactions 是不可变数量流水。
- NONE 使用汇总数量；LOT 使用批次余额；SERIAL 每一基本单位具有唯一身份。
- LOT/SERIAL 的身份移动必须与 canonical inventory 在同一事务中更新。
- ON HAND 包含 HOLD；AVAILABLE 排除 HOLD、过期、已消耗、已交付和已报废身份。
- 调拨移动相同身份和价值，公司总数量/价值不变。
- 调整、盘点和报废必须明确产品、仓库和需要时的身份；库存盘点只有 REVIEWER 批准时影响库存。
- 生产谱系以结构化来源连接组件身份、领料、工单、成品身份和客户交付，不得按 BOM 比例虚构精确谱系。
- 正向/反向追溯只报告已有权威证据；无历史身份的数据必须显示未跟踪或证据不足。

## 11. IQC、OQC 与质量控制

- IQC/OQC 是物流确认前的质量门禁，不是库存或会计事件。
- 新检验必须引用对应物流草稿和全部来源行，冻结产品、数量、仓库及 LOT/SERIAL 集合。
- 状态为 DRAFT → COMPLETED(PASS/FAIL) 或 CANCELLED；完成后不可普通修改。
- PASS 要求所有必检标准通过；FAIL 必须记录缺陷和处置。
- 物流来源或身份集合变化使既有 PASS 变为 STALE，必须复检。
- 质量控制点支持 PURCHASE_RECEIPT/SALES_DELIVERY、GLOBAL/PRODUCT、版本化标准、FULL/FIXED_QUANTITY/PERCENTAGE 抽样和显式免检。
- 缺失或异常规则默认 fail-safe 为 REQUIRED + FULL。
- 失败检验不得产生库存、AR/AP 或凭证，也不得自动伪造退货/报废。

## 12. AR/AP、结算、贷项、退款与核销

- 新商业流程中，Sales Invoice 创建正 AR，Supplier Bill 创建正 AP；来源组合必须唯一。
- 退货、折让和其他商业贷项通过不可变 credit adjustment 连接原正向 open item。
- 未结金额由原始金额、有效贷项、确认分配、冲销、余额应用和核销历史派生；缓存必须在同一事务刷新且不得人工编辑。
- 收款/付款确认必须重新验证往来单位、选中来源、当前未结和分配合计。
- 未分配差额只有在用户明确选择预收/预付时才允许；不得创建虚假 AR/AP。
- 预收、预付和未核销贷项只能显式应用于同一往来单位的未来项目，不做隐式 FIFO。
- 退款、结算冲销、贷项应用冲销和 write-off 必须保留原单、反向凭证、结算账户移动和审计。
- write-off 使用 DRAFT → SUBMITTED → CONFIRMED/REJECTED；创建人与确认人必须不同。
- 所有确认、退款和冲销受开放期间保护。

## 13. 存货估值、WIP 与会计

- NONE 使用仓库+产品移动加权平均；LOT 使用批次专属池；SERIAL 使用特定识别。
- inventory_valuation_movements 是不可变价值历史，余额表是事务维护缓存。
- 部分出库按池中数量/价值确定性分摊；全部耗尽必须同时耗尽剩余价值。
- 采购入库、销售出库/退货、调拨、调整、报废、生产领料/退料、生产入库/冲销都必须同步数量和价值。
- 生产领料 Dr WIP / Cr 存货；成品入库 Dr 存货 / Cr WIP；完工差异显式进入制造差异，COMPLETED 工单 WIP 必须为零。
- 系统凭证来源唯一且不可普通编辑；手工凭证必须借贷严格平衡并经过独立审批。
- 存货期间必须先于会计期间关闭；重新打开按相反顺序并保留原因和历史。
- 存在未解决的 LEGACY_UNVALUED 运动、数量/价值差异或阻断级 System Health 失败时不得权威关账。

## 14. 商业开票、税与 UOM

- Sales Delivery 与 Sales Invoice、Purchase Receipt 与 Supplier Bill 是不同事件。
- 税模式为 NO_TAX、EXCLUSIVE、INCLUSIVE；税率以精确分子/分母保存。
- 税额使用确定性的整数分 round-half-up，并以行税额之和形成单据税额。
- 过账时冻结税快照；后续税码修改不改写历史。
- 产品有基本 UOM，可维护生效日期和版本化的精确换算；业务行保存不可变换算快照。
- 库存、追踪和估值以基本数量工作；文档数量可使用业务 UOM。
- 本系统不宣称提供法定税务申报、政府电子发票或多币种会计。

## 15. 期初、导入导出与 Go-Live

- Opening Batch 状态为 DRAFT → VALIDATED → SUBMITTED → APPROVED → POSTED。
- 支持期初库存数量/价值、LOT/SERIAL、AR、AP、现金、银行和试算平衡；不支持期初 WIP 迁移。
- 审批和过账必须满足创建人与审批人分离、借贷平衡和 System Health 无阻断错误。
- 激活 Go-Live 后不得创建新的期初批次。
- CSV 导入使用 STAGE → VALIDATE → PREVIEW → COMMIT，保留行级错误并在一个事务中提交；幂等键防止重复。
- canonical export 支持库存、AR、AP、GL、税和 System Health。
- demo seed、reset-data 或产品 stock_quantity 不得替代受控期初流程。

## 16. 报表与 System Health

支持试算平衡表、利润表、资产负债表、经营/销售/采购分析、未履行、库存异动、AR/AP 对账、税、WIP、制造分析和追溯查询。

- 正式财务报表只纳入 POSTED 凭证。
- 利润表按期间；资产负债表按所选期间末累计，并以未结转损益虚拟行保持扩展会计恒等式。
- 库存报表使用 inventory 和 valuation，而不是 legacy products.stock_quantity。
- System Health 对数量、身份、价值、WIP、GRNI、AR、AP、税、COGS、现金银行、UOM、凭证唯一性、期间顺序和结算未结项执行 CHECK-only 对账。
- System Health 不在启动时自动修复业务历史。

## 17. 安全与非功能需求

- 使用随机 opaque Bearer Token；数据库只保存 SHA-256 digest，Token 有绝对有效期。
- 密码使用随机盐和 scrypt；不得记录明文密码或 Bearer Token。
- 登录失败按标准化用户名限流和锁定。
- 禁用用户、角色或密码变更必须使既有会话失效。
- JSON 请求有大小、Content-Type、对象形状和敏感字段白名单限制。
- API 返回 no-store、安全响应头和 X-Request-Id；生产错误只返回安全消息与请求 ID。
- 日志必须结构化并递归脱敏；慢 SQL 只记录安全标签、时长和指纹。
- 提供 liveness 和 database readiness；不得暴露环境变量、数据库名或连接串。
- 目标环境为 Ubuntu 22.04、Node 22.23.2、MySQL 8、Nginx 和 systemd。
- 当前全量 SQLite 回归和构建是基础 gate；真实 MySQL 性能仍需 disposable 环境完成，不得声称已认证无限并发或企业级容量。

## 18. 验收标准

完成一个行为变更至少必须证明：

1. 正常路径、非法状态、越权、重复提交和事务回滚均有 focused tests。
2. 五角色权限与五类审批边界没有非预期扩大。
3. 金额使用整数分，数量/UOM/税舍入符合合同。
4. 库存、身份、价值、AR/AP、GL、WIP 和审计副作用在失败时为零。
5. 来源、累计量、期间关闭、创建人/审批人分离和幂等合同成立。
6. 相关前端页面无未处理异常，后端不泄露 SQL 或秘密。
7. focused tests 通过后，pnpm test、pnpm build 和 git diff --check 通过。
8. MySQL 特定变更还必须在受保护 disposable MySQL 环境通过相应兼容/并发 gate。
9. 文档、日志和 README 按 AGENTS.md 的阶段规则同步。

## 19. 延后或明确不支持

- 多组织、多公司、多账套和复杂数据范围；
- 多币种及汇率重估；
- 年结、自动损益结转和 Year-End Carry Forward；
- 政府电子发票、法定税务申报；
- APS、完整 MES/OEE、完整 QMS/CAPA；
- 里程碑/进度开票；
- 期初 WIP 迁移；
- 面向外部客户/供应商的门户；
- 已隐藏的旧 Production Output、旧 MRP Calculator，以及尚未形成受支持 UI 的辅助生产成本/工时界面；
- 在真实大规模 MySQL 数据和目标硬件上的生产容量认证。

## 20. 聚焦变更历史

- V1.0–V1.1：建立核心五角色、订单/库存/会计、结算、计划、路由和产品化 UI。
- V1.2：完成移动生命周期与视觉重建，并暴露流程完整性缺口。
- V1.3：完成来源完整性、质量门禁、生产执行、结算与财务控制、批序列追溯、制造/WIP/估值、商业开票/税/UOM/Go-Live，以及 MySQL 兼容、并发和安全可观测性加固。
- 2026-09-26：恢复本文档为唯一当前功能/业务规范；历史阶段叙述保留在 docs/ 和 Git 历史中。
