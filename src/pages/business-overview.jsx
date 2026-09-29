import { BusinessPageShell, BusinessPageHeader, HelpDisclosure } from '../components/design-system.jsx';
import { useAppNavigation, AppLink } from '../navigation/AppNavigationContext.jsx';
import { presentationForRoute } from '../navigation/presentationMetadata.js';

const step = (key, label, page, target) => ({ key, label, page, target, presentation: presentationForRoute(page) });

export const BUSINESS_FLOWS = [
  { key: 'sales', accent: 'blue', title: '销售履约', steps: [
    step('sales-order', '销售订单', 'orders'),
    step('sales-delivery', '销售出货 / 退货', 'sales-deliveries'),
    step('sales-ar', '应收结算', 'accounts-receivable'),
  ] },
  { key: 'production', accent: 'green', title: '生产执行', steps: [
    step('production-mrp', 'MRP', 'mrp-runs'),
    step('production-instruction', '生产指令', 'production-instructions'),
    step('production-order', '制令单', 'production-orders'),
    step('material-issue', '用料出库', 'material-issues'),
    step('production-receipt', '生产入库', 'production-receipts'),
  ] },
  { key: 'purchase', accent: 'amber', title: '采购履约', steps: [
    step('purchase-mrp', 'MRP', 'mrp-runs'),
    step('purchase-instruction', '采购指令', 'purchase-instructions'),
    step('requisition', '请购单', 'purchase-requisitions'),
    step('purchase-order', '采购订单', 'purchase-orders'),
    step('purchase-receipt', '采购入库', 'purchase-receipts'),
    step('purchase-ap', '应付结算', 'accounts-payable'),
  ] },
];

export const BUSINESS_OVERVIEW_GROUPS = BUSINESS_FLOWS;

const SUPPORTING_GROUPS = [
  { key: 'master', label: '基础资料', items: [step('products', '货品', 'products'), step('customers', '客户', 'customers'), step('suppliers', '供应商', 'suppliers'), step('warehouses', '仓库', 'warehouses')] },
  { key: 'inventory', label: '库存作业', items: [step('inventory', '库存', 'inventory'), step('scraps', '报废', 'inventory-scraps'), step('month-end', '月结', 'inventory-month-end')] },
  { key: 'analytics', label: '经营分析', items: [step('reports', '决策报表', 'decision-reports'), step('movements', '库存异动', 'inventory-transactions'), step('manufacturing', '生产分析', 'manufacturing-analytics')] },
];

function FlowStep({ item, index }) {
  const navigation = useAppNavigation();
  const authorized = Boolean(item.page && navigation.canNavigate(item.page));
  const nodeLabel = authorized ? `进入${item.label}` : `${item.label}，无权限`;
  const body = <>
    <span className="flow-step__index">{String(index + 1).padStart(2, '0')}</span>
    <span className="flow-step__title">{item.label}</span>
  </>;
  if (!authorized) return <div className="flow-step is-readonly" aria-label={nodeLabel}>{body}</div>;
  return <AppLink page={item.page} target={item.target} className="flow-step" aria-label={nodeLabel}>{body}</AppLink>;
}

function SupportingLink({ item }) {
  const navigation = useAppNavigation();
  return navigation.canNavigate(item.page)
    ? <AppLink page={item.page} className="flow-support-link">{item.label}<span aria-hidden="true">→</span></AppLink>
    : <span className="flow-support-link is-readonly">{item.label}</span>;
}

export default function BusinessOverview() {
  return <BusinessPageShell className="flow-overview" width="rail">
    <BusinessPageHeader title="业务总览" meta={<span>3 条主流程</span>} help={<HelpDisclosure summary="流程说明"><p>箭头表示通常的业务先后关系，不等于审批、实物执行与财务过账会自动合并；审批 ≠ 履约，物流 ≠ 结算，结算 ≠ 凭证。</p></HelpDisclosure>}/>
    <div className="flow-lanes">
      {BUSINESS_FLOWS.map((flow) => <section className={`flow-lane flow-lane--${flow.accent}`} key={flow.key}>
        <header><h2>{flow.title}</h2></header>
        <ol>{flow.steps.map((item, index) => <li key={item.key}>
          <FlowStep item={item} index={index}/>
          {index < flow.steps.length - 1 && <span className="flow-lane__connector" aria-hidden="true"/>}
        </li>)}</ol>
      </section>)}
    </div>
    <section className="flow-supporting" aria-labelledby="flow-supporting-title">
      <header><h2 id="flow-supporting-title">支撑业务</h2></header>
      <div>{SUPPORTING_GROUPS.map((group) => <section key={group.key}><h3>{group.label}</h3>{group.items.map((item) => <SupportingLink key={item.key} item={item}/>)}</section>)}</div>
    </section>
  </BusinessPageShell>;
}