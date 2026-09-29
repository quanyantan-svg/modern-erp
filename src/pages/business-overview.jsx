import { BusinessPageHeader, BusinessPageShell, HelpDisclosure } from '../components/design-system.jsx';
import { useAppNavigation, AppLink } from '../navigation/AppNavigationContext.jsx';
import { presentationForRoute } from '../navigation/presentationMetadata.js';

const step = (key, label, page, target) => ({ key, label, page, target, presentation: presentationForRoute(page) });

export const BUSINESS_FLOWS = [
  { key: 'sales', code: 'SALES', title: '销售履约', accent: 'blue', steps: [
    step('sales-order', '销售订单', 'orders'), step('sales-delivery', '出货 / 退货', 'sales-deliveries'), step('sales-ar', '应收结算', 'accounts-receivable'),
  ] },
  { key: 'production', code: 'PRODUCTION', title: '生产执行', accent: 'green', steps: [
    step('production-mrp', 'MRP', 'mrp-runs'), step('production-instruction', '生产指令', 'production-instructions'), step('production-order', '制令单', 'production-orders'), step('material-issue', '用料出库', 'material-issues'), step('production-receipt', '生产入库', 'production-receipts'),
  ] },
  { key: 'purchase', code: 'PURCHASE', title: '采购履约', accent: 'amber', steps: [
    step('purchase-mrp', 'MRP', 'mrp-runs'), step('purchase-instruction', '采购指令', 'purchase-instructions'), step('requisition', '请购单', 'purchase-requisitions'), step('purchase-order', '采购订单', 'purchase-orders'), step('purchase-receipt', '采购入库', 'purchase-receipts'), step('purchase-ap', '应付结算', 'accounts-payable'),
  ] },
];

export const BUSINESS_OVERVIEW_GROUPS = BUSINESS_FLOWS;

const SUPPORTING_GROUPS = [
  { key: 'master', label: '基础资料', items: [step('products', '货品', 'products'), step('customers', '客户', 'customers'), step('suppliers', '供应商', 'suppliers'), step('warehouses', '仓库', 'warehouses')] },
  { key: 'inventory', label: '库存作业', items: [step('inventory', '库存', 'inventory'), step('scraps', '报废', 'inventory-scraps'), step('month-end', '月结', 'inventory-month-end')] },
  { key: 'analytics', label: '经营分析', items: [step('reports', '决策报表', 'decision-reports'), step('movements', '库存异动', 'inventory-transactions'), step('manufacturing', '生产分析', 'manufacturing-analytics')] },
];

function FlowNode({ item, index }) {
  const navigation = useAppNavigation();
  const authorized = Boolean(item.page && navigation.canNavigate(item.page));
  const content = <><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.label}</strong><small>{authorized ? '进入应用' : '无权限'}</small></>;
  return authorized
    ? <AppLink page={item.page} target={item.target} className="flow-node is-active" aria-label={`进入${item.label}`}>{content}</AppLink>
    : <div className="flow-node is-readonly" aria-label={`${item.label}，无权限`}>{content}</div>;
}

function SupportingLink({ item }) {
  const navigation = useAppNavigation();
  return navigation.canNavigate(item.page)
    ? <AppLink page={item.page} className="flow-support-link">{item.label}<span aria-hidden="true">→</span></AppLink>
    : <span className="flow-support-link is-readonly">{item.label}<small>无权限</small></span>;
}

export default function BusinessOverview() {
  return <BusinessPageShell className="flow-overview" width="rail">
    <BusinessPageHeader title="业务总览" meta={<span>3 条主流程</span>} help={<HelpDisclosure summary="流程说明"><p>箭头表示通常的业务先后关系，不代表审批、实物执行与财务过账会自动合并。</p></HelpDisclosure>}/>
    <div className="flow-overview__legend"><span><i/>可进入</span><span><i className="is-readonly"/>无权限，仅显示流程位置</span><b>审批 ≠ 履约 · 物流 ≠ 结算 · 结算 ≠ 凭证</b></div>
    <div className="flow-lanes">
      {BUSINESS_FLOWS.map((flow) => <section className={`flow-lane flow-lane--${flow.accent}`} key={flow.key}>
        <header><span>{flow.code}</span><h2>{flow.title}</h2></header>
        <ol>{flow.steps.map((item, index) => <li key={item.key}><FlowNode item={item} index={index}/>{index < flow.steps.length - 1 && <span className="flow-lane__arrow" aria-hidden="true">→</span>}</li>)}</ol>
      </section>)}
    </div>
    <section className="flow-supporting" aria-labelledby="flow-supporting-title">
      <header><span>SUPPORTING</span><h2 id="flow-supporting-title">支撑业务</h2></header>
      <div>{SUPPORTING_GROUPS.map((group) => <section key={group.key}><h3>{group.label}</h3>{group.items.map((item) => <SupportingLink key={item.key} item={item}/>)}</section>)}</div>
    </section>
  </BusinessPageShell>;
}
