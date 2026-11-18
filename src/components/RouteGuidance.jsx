// 页面使用提示（Requirement §36.22 PL-UX-05/06；Design §32.22.3）。
//
// 这一条只说明「我在哪个业务域、这一页要做什么、通常从哪里来、下一步去哪」。
// 它不解释业务动词的含义，也不改变 Confirm / Approve / Post / Reverse 的语义；
// 高风险页面额外说明前置条件与失败时的零副作用边界。

import { applicationRouteFor, userCanAccessRoute } from '../navigation/applicationRegistry.js';
import { AppLink } from '../navigation/AppNavigationContext.jsx';

export default function RouteGuidance({ route, user }) {
  const context = route?.taskContext || {};
  const parent = context.upstreamRoute ? applicationRouteFor(context.upstreamRoute) : null;
  const next = context.nextRoute ? applicationRouteFor(context.nextRoute) : null;
  // 无权的下一步不显示：提示本身不得泄露隐藏 route。
  const nextVisible = next && userCanAccessRoute(user, next);
  return <aside className="route-guidance" aria-label="页面使用提示">
    <div>
      <strong>{route?.desktopNavigation?.group}</strong>
      <span>{context.purpose}</span>
    </div>
    <div className="route-guidance__flow">
      <span>{parent ? `通常从“${context.upstreamLabel || parent.title}”进入本页` : '可直接在应用列表中打开'}</span>
      {nextVisible ? <AppLink className="route-guidance__next" page={next.key}>下一步：{context.nextLabel || next.title}</AppLink> : null}
    </div>
    {context.helpLevel === 'HIGH_RISK' ? <p className="route-guidance__risk">
      本页包含确认、审批、过账或反冲类动作。请先确认单据状态与前置条件；动作失败时不会留下部分结果，需要重新发起。
    </p> : null}
  </aside>;
}
