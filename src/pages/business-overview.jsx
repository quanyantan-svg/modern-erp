import { useAppNavigation, AppLink } from '../navigation/AppNavigationContext.jsx';

export const BUSINESS_FLOWS = [
  {
    key: 'sales',
    title: '销售链',
    description: '从客户需求、订单审批到出货、应收和回款。',
    nodes: [
      ['客户', 'customers'], ['销售订单', 'orders'], ['审批', 'approvals'],
      ['销售出货', 'sales-deliveries'], ['应收账款', 'accounts-receivable'],
      ['收款单', 'payment-collections'], ['销售统计', 'decision-reports'],
    ],
  },
  {
    key: 'purchase',
    title: '采购链',
    description: '从供应商与采购订单到入库、应付和付款。',
    nodes: [
      ['供应商', 'suppliers'], ['采购订单', 'purchase-orders'], ['审批', 'approvals'],
      ['采购入库', 'purchase-receipts'], ['应付账款', 'accounts-payable'],
      ['付款单', 'payment-disbursements'], ['采购统计', 'decision-reports'],
    ],
  },
  {
    key: 'inventory',
    title: '库存链',
    description: '查询现存量，执行调拨、盘点与调整，并追溯每次库存异动。',
    nodes: [
      ['库存查询', 'inventory'], ['库存调拨', 'inventory'], ['库存盘点', 'inventory'],
      ['库存调整', 'inventory'], ['库存异动', 'inventory-transactions'],
    ],
  },
  {
    key: 'production',
    title: '生产链',
    description: 'BOM 定义用料，制令单串联领料、成品入库与完工。',
    nodes: [
      ['BOM', 'boms'], ['制令单', 'production-orders'], ['开工', 'production-orders'],
      ['用料出库', 'material-issues'], ['生产入库', 'production-receipts'], ['完工', 'production-orders'],
    ],
  },
  {
    key: 'finance',
    title: '财务结算链',
    description: '业务确认形成往来账，结算后生成凭证并进入管理报表。',
    nodes: [
      ['销售出货', 'sales-deliveries'], ['采购入库', 'purchase-receipts'],
      ['应收', 'accounts-receivable'], ['应付', 'accounts-payable'],
      ['收款', 'payment-collections'], ['付款', 'payment-disbursements'],
      ['会计凭证', 'accounting'], ['决策报表', 'decision-reports'],
    ],
  },
];

function FlowNode({ label, page }) {
  const navigation = useAppNavigation();
  const authorized = navigation.canNavigate(page);
  const content = <><strong>{label}</strong><small>{authorized ? '打开应用' : '流程说明'}</small></>;
  return authorized
    ? <AppLink page={page} className="business-flow__node is-active">{content}</AppLink>
    : <span className="business-flow__node is-readonly" aria-disabled="true">{content}</span>;
}

export default function BusinessOverview() {
  return <section className="business-overview" aria-labelledby="business-overview-title">
    <div className="business-overview__intro">
      <div><span className="pill">Modern ERP 业务地图</span><h2 id="business-overview-title">业务总览</h2><p>用真实已实现的单据串起销售、采购、库存、生产与财务。可访问节点可以直接打开；无权限节点仅用于理解流程。</p></div>
      <div className="business-overview__legend"><span><i className="is-active"/>可访问</span><span><i className="is-readonly"/>流程说明</span></div>
    </div>
    <div className="business-overview__grid">
      {BUSINESS_FLOWS.map((flow) => <article className={`business-flow business-flow--${flow.key}`} key={flow.key}>
        <header><div><span>{flow.title}</span><p>{flow.description}</p></div></header>
        <div className="business-flow__track">
          {flow.nodes.map(([label, page], index) => <div className="business-flow__step" key={`${label}-${index}`}>
            <FlowNode label={label} page={page}/>{index < flow.nodes.length - 1 && <span className="business-flow__arrow" aria-hidden="true">→</span>}
          </div>)}
        </div>
      </article>)}
    </div>
    <p className="business-overview__note">本页只展示课程系统中已经可用的业务能力；计划预测、MRP 执行、请购、库存报废、库存月结及销售／采购折让未作为可操作节点展示。</p>
  </section>;
}
