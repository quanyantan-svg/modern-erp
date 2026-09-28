import { useState } from 'react';
import { BusinessPageHeader } from '../components/design-system.jsx';
import { useAppNavigation, AppLink } from '../navigation/AppNavigationContext.jsx';

const node = (key, label, page, description, target) => ({ key, label, page, description, target });

export const BUSINESS_OVERVIEW_GROUPS = [
  {
    key: 'master-data', title: '基础资料', eyebrow: '先建立业务共同语言', relationship: 'collection',
    description: '维护原始项目要求的六类主数据；这些资料彼此关联，但不是强制顺序。',
    level1: [node('product', '货品资料', 'products'), node('bom', 'BOM', 'boms'), node('customer', '客户资料', 'customers'), node('supplier', '供应商资料', 'suppliers'), node('warehouse', '仓库资料', 'warehouses'), node('routing', '制品工序标准', 'product-routings')],
    level2: [
      node('product-detail', '产品与追踪策略', 'products', '维护产品、单位及 NONE / LOT / SERIAL 追踪策略。'),
      node('bom-detail', 'BOM 用料结构', 'boms', '为 MRP 与制令冻结提供用料来源。'),
      node('routing-detail', '工艺路线与工序', 'product-routings', '定义制品加工顺序与工作中心标准。'),
      node('customer-detail', '客户资料', 'customers', '建立销售使用的客户资料。'),
      node('supplier-detail', '供应商资料', 'suppliers', '建立采购使用的供应商资料。'),
      node('warehouse-detail', '仓库资料', 'warehouses', '建立库存、收发货和调拨使用的地点。'),
    ],
  },
  {
    key: 'sales', title: '销售', eyebrow: '订单到回款',
    description: '销售订单 → 仓库出货（退货分支）→ 应收结账。',
    boundary: '审批只授权后续执行；出货后仍需销售发票过账才形成应收。',
    level1: [node('sales-order', '销售订单', 'orders'), node('sales-delivery', '仓库出货', 'sales-deliveries'), node('sales-ar', '应收结账', 'accounts-receivable')],
    level2: [
      node('sales-order-detail', '销售订单', 'orders', '草稿提交后进入独立授权审批。'),
      node('sales-approval', '审批', 'approvals', '审批通过只代表可以履行，不代表已经出货。'),
      node('sales-oqc', 'OQC 出货检验', 'oqc', '需要质检时，OQC 是出货确认前的质量门禁。'),
      node('sales-delivery-detail', '确认出货', 'sales-deliveries', '仓库确认实物出库与库存 / COGS；不会直接结清应收。'),
      node('sales-return', '销售退货（条件分支）', 'returns', '反向物流与商业分支，不自动重开原订单履约义务。'),
      node('sales-invoice', '销售发票', 'sales-invoices', '商业发票过账后建立 AR、收入和销项税。'),
      node('sales-receivable', '应收账款', 'accounts-receivable', '应收是商业过账结果，不等同于出货。'),
      node('sales-settlement', '收款 / 贷项 / 退款 / 核销', 'payment-collections', '按未结项目执行结算，保留独立状态与审计。'),
      node('sales-accounting', '会计凭证', 'accounting', '库存、商业与结算事件分别形成权威会计处理。'),
    ],
  },
  {
    key: 'planning', title: '计划 / MRP', eyebrow: '需求到建议',
    description: '销售需求 → 计划预测 → MRP → 生产 / 采购指令。',
    boundary: 'MRP 只生成可追溯建议；指令下达前不移动库存、不形成应收应付。',
    level1: [node('planning-sales', '销售需求', 'orders'), node('forecast', '计划预测', 'forecasts'), node('mrp', 'MRP', 'mrp-runs'), node('instructions', '生产 / 采购指令', 'material-requirements-plan')],
    level2: [
      node('forecast-detail', '需求预测', 'forecasts', '只有已生效预测进入 MRP。'),
      node('mrp-run', 'MRP 运算', 'mrp-runs', '合并销售与预测需求，计算 MAKE / BUY 建议。'),
      node('material-plan', '物料需求计划', 'material-requirements-plan', '查看建议数量、需求日期、来源与警告。'),
      node('production-instruction', '生产指令', 'production-instructions', '将 MAKE 建议受控下达，再生成制令单。'),
      node('purchase-instruction', '采购指令', 'purchase-instructions', '将 BUY 建议受控下达，再生成请购单。'),
    ],
  },
  {
    key: 'production', title: '生产', eyebrow: '指令到完工入库',
    description: '生产指令 → 制令单 → 用料出库 → 生产入库。',
    boundary: '制令状态、物料执行和成品入库是独立事件；开工或完工状态本身不移动库存。',
    level1: [node('production-instruction-l1', '生产指令', 'production-instructions'), node('production-order', '制令单', 'production-orders'), node('material-issue', '用料出库', 'material-issues'), node('production-receipt', '生产入库', 'production-receipts')],
    level2: [
      node('production-state', '制令状态', 'production-orders', '待开工、生产中与已完工描述制令生命周期。'),
      node('material-issue-detail', '确认领料', 'material-issues', '仓库按冻结 BOM 领料并形成 WIP。'),
      node('material-return', '生产退料', 'material-issues', '退料是领料的明确反向执行。'),
      node('operation-report', '报工 / 质量摘要', 'production-orders', '记录工序良品、报废与工时，不替代库存入库。'),
      node('production-receipt-detail', '确认生产入库', 'production-receipts', '成品入库与 WIP 结转在独立确认事件中完成。'),
      node('production-reversal', '入库冲销', 'production-receipts', '错误入库通过显式冲销恢复，不改写历史。'),
    ],
  },
  {
    key: 'purchase', title: '采购', eyebrow: '需求到付款',
    description: 'MRP → 采购指令 → 请购 → 采购订单 → 仓库验收 → 应付结账。',
    boundary: '订单审批不等于收货；入库先形成库存 / GRNI，供应商账单过账后才形成应付。',
    level1: [node('purchase-mrp', 'MRP', 'mrp-runs'), node('purchase-instruction-l1', '采购指令', 'purchase-instructions'), node('requisition', '请购单', 'purchase-requisitions'), node('purchase-order', '采购订单', 'purchase-orders'), node('purchase-receipt', '仓库验收', 'purchase-receipts'), node('purchase-ap', '应付结账', 'accounts-payable')],
    level2: [
      node('purchase-demand', 'MRP 采购需求', 'material-requirements-plan', 'BUY 建议保留需求来源，不直接创建库存或应付。'),
      node('purchase-instruction-detail', '采购指令', 'purchase-instructions', '释放后生成带来源的请购单。'),
      node('purchase-requisition-detail', '请购单', 'purchase-requisitions', '请购提交后由独立审核人员审批。'),
      node('purchase-approval', '请购 / 订单审批', 'approvals', '授权采购，不代表货物已经入库。'),
      node('purchase-order-detail', '采购订单', 'purchase-orders', '冻结供应商、交期、条款、产品和成交价格。'),
      node('purchase-iqc', 'IQC 来料检验', 'iqc', '需要质检时，IQC 是入库确认前的质量门禁。'),
      node('purchase-receipt-detail', '确认入库', 'purchase-receipts', '确认数量、身份、价值与 GRNI；不会直接结清应付。'),
      node('purchase-return', '采购退货（条件分支）', 'returns', '反向物流与商业分支，不自动重开原订单义务。'),
      node('supplier-bill', '供应商账单', 'supplier-bills', '三单匹配并过账后建立 AP、进项税与价差。'),
      node('purchase-payable', '应付账款', 'accounts-payable', '应付是供应商账单过账结果，不等同于收货。'),
      node('purchase-settlement', '付款 / 贷项 / 退款 / 核销', 'payment-disbursements', '按未结项目执行付款与后续结算。'),
      node('purchase-accounting', '会计凭证', 'accounting', '物流、商业与结算事件保持独立会计来源。'),
    ],
  },
  {
    key: 'inventory', title: '库存', eyebrow: '实物执行与期间控制', relationship: 'collection',
    description: '存货调整、调拨、报废、盘点与存货月结。',
    boundary: '调拨是仓库确认执行，不进入审批中心；存货月结进入专用期间工作流。',
    level1: [node('adjustment', '存货调整', 'inventory'), node('transfer', '存货调拨', 'inventory'), node('scrap', '存货报废', 'inventory-scraps'), node('stocktake', '存货盘点', 'inventory'), node('month-end', '存货月结', 'inventory-month-end')],
    level2: [
      node('inventory-on-hand', '库存现存量', 'inventory', '查询仓库、产品、批次或序列号现存量。'),
      node('inventory-adjustment', '调整', 'inventory', '对有依据的库存差异执行受控调整。'),
      node('inventory-transfer', '调拨确认', 'inventory', 'WAREHOUSE 确认两仓实物、身份与价值移动；不是审批。'),
      node('inventory-stocktake', '盘点审批', 'inventory', '盘点是五类 canonical 审批之一，审批后才影响库存。'),
      node('inventory-scrap', '报废', 'inventory-scraps', '以明确来源、业务日期与身份执行库存减少。'),
      node('inventory-close-check', '月结前置检查', 'inventory-month-end', '列出负库存、开放单据、盘点与一致性阻断。'),
      node('inventory-close', '存货期间结账', 'inventory-month-end', '关闭已结束月份并保护截止日以前的库存业务。'),
      node('inventory-movement', '库存异动明细', 'inventory-transactions', '查看按权威业务日期记录的不可变数量流水。'),
    ],
  },
  {
    key: 'finance', title: '财务衔接', eyebrow: '物流、商业、结算、会计分层',
    description: '物流执行 → 商业单据 → AR / AP → 收付款结算 → 会计处理。',
    boundary: '物流执行 ≠ 商业结算单 ≠ 会计凭证；各阶段保留独立来源、状态与权限。',
    level1: [node('finance-logistics', '物流执行', 'inventory-transactions'), node('commercial-document', '商业单据', 'sales-invoices'), node('subledger', '应收 / 应付', 'accounts-receivable'), node('settlement', '收款 / 付款结算', 'payment-collections'), node('voucher', '会计凭证', 'accounting')],
    level2: [
      node('sales-commercial', '销售发票', 'sales-invoices', '从已出货来源建立商业销售单据。'),
      node('purchase-commercial', '供应商账单', 'supplier-bills', '从采购订单与入库来源完成三单匹配。'),
      node('ar', '应收 AR', 'accounts-receivable', '销售发票过账后建立正向应收。'),
      node('ap', '应付 AP', 'accounts-payable', '供应商账单过账后建立正向应付。'),
      node('collection', '收款与核销', 'payment-collections', '收款按应收未结项目分配和核销。'),
      node('payment', '付款与核销', 'payment-disbursements', '付款按应付未结项目分配和核销。'),
      node('credit', '折让 / 贷项 / 退款', 'sales-discounts', '商业调整使用独立贷项与退款流程，不改写物流事实。'),
      node('accounting-detail', '总账凭证', 'accounting', '系统凭证按权威业务来源唯一生成；手工凭证独立审批。'),
    ],
  },
  {
    key: 'reports', title: '经营报表', eyebrow: '原始项目五类经营分析', relationship: 'collection',
    description: '直接进入 E5 / E6 已实现的五类权威报表，不在总览重复计算。',
    level1: [
      node('purchase-summary', '采购统计分析表', 'decision-reports', '', { reportKey: 'purchase-summary' }),
      node('purchase-outstanding', '采购未交货反应表', 'decision-reports', '', { reportKey: 'purchase-outstanding' }),
      node('sales-summary', '销售统计分析表', 'decision-reports', '', { reportKey: 'sales-summary' }),
      node('sales-outstanding', '销售未出货反应表', 'decision-reports', '', { reportKey: 'sales-outstanding' }),
      node('inventory-movements', '存货异动明细表', 'decision-reports', '', { reportKey: 'inventory-movements' }),
    ],
    level2: [
      node('report-sales-summary', '销售统计', 'decision-reports', '订单、出货与退货按各自权威业务日期统计。', { reportKey: 'sales-summary' }),
      node('report-sales-outstanding', '销售未交', 'decision-reports', '按订单行展示订货、已执行、剩余、交期与逾期。', { reportKey: 'sales-outstanding' }),
      node('report-purchase-summary', '采购统计', 'decision-reports', '订单、入库与退货按各自权威业务日期统计。', { reportKey: 'purchase-summary' }),
      node('report-purchase-outstanding', '采购未收', 'decision-reports', '按订单行展示订货、已入库、剩余、到货日与逾期。', { reportKey: 'purchase-outstanding' }),
      node('report-inventory-movements', '库存异动明细', 'decision-reports', '按库存流水业务日期查看数量变动与来源。', { reportKey: 'inventory-movements' }),
    ],
  },
];

export const BUSINESS_FLOWS = BUSINESS_OVERVIEW_GROUPS;

function ProcessNode({ item, compact = false }) {
  const navigation = useAppNavigation();
  const authorized = item.page && navigation.canNavigate(item.page);
  const content = <><strong>{item.label}</strong>{item.description && <span>{item.description}</span>}<small>{authorized ? '进入业务应用' : '流程说明 · 需要对应权限'}</small></>;
  const className = `business-process-node${compact ? ' is-compact' : ''}${authorized ? ' is-active' : ' is-readonly'}`;
  return authorized
    ? <AppLink page={item.page} target={item.target} className={className} aria-label={`进入${item.label}`}>{content}</AppLink>
    : <div className={className} aria-label={`${item.label}，流程说明，需要对应权限`}>{content}</div>;
}

function LevelOneTrack({ group }) {
  const sequential = group.relationship !== 'collection';
  return <div className={`business-level-one__track${sequential ? '' : ' is-collection'}`} aria-label={`${group.title}主要阶段`}>
    {group.level1.map((item, index) => <div className="business-level-one__step" key={item.key}>
      <ProcessNode item={item} compact/>
      {sequential && index < group.level1.length - 1 && <span className="business-level-one__arrow" aria-hidden="true">→</span>}
    </div>)}
  </div>;
}

export default function BusinessOverview() {
  const [expanded, setExpanded] = useState('sales');
  return <section className="business-overview" aria-label="业务总览">
    <BusinessPageHeader title="业务总览" context="第一层沿用原始项目业务流程；展开第二层可查看 Modern ERP 的审批、执行、质量、商业过账与结算边界。" meta={<span>8 个业务领域 · 2 层流程</span>}/>
    <div className="business-overview__legend" aria-label="节点图例">
      <span><i className="is-active"/>有权限，可进入应用</span><span><i className="is-readonly"/>只读流程说明</span>
      <span><b>边界原则</b> 审批 ≠ 履约 · 物流 ≠ 结算 · 结算 ≠ 会计凭证</span>
    </div>
    <div className="business-overview__grid">
      {BUSINESS_OVERVIEW_GROUPS.map((group, index) => {
        const isExpanded = expanded === group.key;
        const detailId = `business-detail-${group.key}`;
        return <article className={`business-area business-area--${group.key}${isExpanded ? ' is-expanded' : ''}`} key={group.key}>
          <header className="business-area__header">
            <div className="business-area__index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
            <div className="business-area__heading"><span>{group.eyebrow}</span><h2>{group.title}</h2><p>{group.description}</p></div>
            <button type="button" className="business-area__toggle" aria-expanded={isExpanded} aria-controls={detailId} onClick={() => setExpanded(isExpanded ? '' : group.key)}>
              {isExpanded ? '收起业务细节' : '展开业务细节'}<span aria-hidden="true">{isExpanded ? '−' : '+'}</span>
            </button>
          </header>
          <LevelOneTrack group={group}/>
          {group.boundary && <p className="business-area__boundary"><strong>流程边界</strong>{group.boundary}</p>}
          {isExpanded && <section className="business-level-two" id={detailId} aria-label={`${group.title}业务细节`}>
            <div className="business-level-two__intro"><span>Level 2</span><h3>实际操作链</h3><p>只提供当前角色有权限的应用入口；其他节点不读取数据、不提供动作。</p></div>
            <ol className="business-level-two__list">{group.level2.map((item, detailIndex) => <li key={item.key}><span className="business-level-two__number" aria-hidden="true">{detailIndex + 1}</span><ProcessNode item={item}/></li>)}</ol>
          </section>}
        </article>;
      })}
    </div>
    <p className="business-overview__note">总览只负责解释与导航，不读取业务记录或生成统计。销售 / 采购退货是条件分支，不自动重开原订单履约义务；库存调拨是执行确认，不是新的审批族。</p>
  </section>;
}
