import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import MobileShell, { MOBILE_TABS } from './components/MobileShell.jsx';
import MobilePage from './components/MobilePage.jsx';
import MobileLauncher from './components/MobileLauncher.jsx';
import RouteScreen from './components/RouteScreen.jsx';
import V16RouteSurface from './components/V16RouteSurface.jsx';
import { buildMobileApplicationGroups } from './navigation/applicationMetadata.js';
import { AppNavigationProvider } from './navigation/AppNavigationContext.jsx';
import {
  ACTIVE_APPLICATION_ROUTES, applicationRouteFor, userCanAccessLauncherEntry,
  userCanAccessRoute,
} from './navigation/applicationRegistry.js';
import { buildNavigationGroups } from './navigation/presentationMetadata.js';
import { normalizeRouteLocation, parseRouteLocation, serializeRouteLocation } from './navigation/routeLocation.js';
import { Icon as ProductIcon } from './components/icons.jsx';
import { roleDisplayName } from './lib/copy.js';

const MOBILE_TAB_KEYS = new Set(MOBILE_TABS.filter((tab) => tab.enabled).map((tab) => tab.key));
const launcherIconNames = [
  'overview','dashboard','orders','approvals','purchaseOrders','suppliers','customers','products','warehouses','inventory',
  'purchaseReceipts','salesDeliveries','returns','inventoryTransactions','reports','accountsReceivable','accountsPayable',
  'paymentCollections','paymentDisbursements','accounting','cashJournals','bankAccounts','bills','fixedAssets','costAccounting',
  'iqc','oqc','contacts','followups','activities','projects','tasks','timesheets','notifications','boms','routings','forecasts',
  'mrpRuns','materialPlan','mrp','planningDocuments','productionOrders','inventoryScrap','inventoryPeriod','salesDiscount',
  'purchaseDiscount','users','cleanup','traceability',
];
const ic = Object.fromEntries(launcherIconNames.map((name) => [name, <ProductIcon key={name} name={name} size={24}/>]));

// Compatibility projection for downstream consumers. It contains no route definitions.
export const navGroups = buildNavigationGroups(ic);

function SafeRouteState({ kind }) {
  const copy = {
    MALFORMED: ['地址无法识别', '请返回应用列表并重新打开。'],
    UNKNOWN: ['应用不存在', '该地址没有对应的业务应用。'],
    DISABLED: ['应用未开放', '该能力当前不在最终用户产品范围内。'],
    PERMISSION_DENIED: ['无权访问', '当前账号没有打开该应用的权限。'],
  }[kind] || ['应用不可用', '请返回应用列表。'];
  return <div className="v16-empty" role="status" data-testid={`route-state-${kind.toLowerCase()}`}><strong>{copy[0]}</strong><div>{copy[1]}</div></div>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));
  const [currentLocation, setCurrentLocation] = useState(() => parseRouteLocation(location.hash));
  const [toast, setToast] = useState(null);
  const [mobileTab, setMobileTab] = useState('apps');
  const [mobileApplication, setMobileApplication] = useState(null);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [documentBackAction, setDocumentBackAction] = useState(null);
  const modalBackActions = useRef(new Map());
  const [, setModalBackVersion] = useState(0);
  const currentRoute = applicationRouteFor(currentLocation.routeKey);

  const visibleNav = useMemo(() => user ? ACTIVE_APPLICATION_ROUTES
    .filter((route) => userCanAccessRoute(user, route))
    .map((route) => ({
      key: route.key, label: route.title, icon: ic[route.desktopNavigation.iconKey], iconKey: route.desktopNavigation.iconKey,
      ...route.access, presentation: route.presentation,
    })) : [], [user]);

  const canNavigate = useCallback((routeKey) => {
    const route = applicationRouteFor(normalizeRouteLocation({ routeKey }).routeKey);
    return Boolean(route && userCanAccessRoute(user, route));
  }, [user]);

  const hrefFor = useCallback((routeKey, target = null) => serializeRouteLocation({ routeKey, target }), []);

  const applyBrowserLocation = useCallback(() => {
    const parsed = parseRouteLocation(location.hash);
    const canonicalHash = serializeRouteLocation(parsed);
    if (!parsed.invalid && location.hash && canonicalHash !== location.hash) history.replaceState(null, '', canonicalHash);
    setCurrentLocation(parsed);
    const route = applicationRouteFor(parsed.routeKey);
    setMobileApplication(location.hash ? { page: parsed.routeKey, label: route?.title || '应用' } : null);
    if (location.hash) setMobileTab('apps');
  }, []);

  const navigate = useCallback((next, options = {}) => {
    const normalized = normalizeRouteLocation(typeof next === 'string' ? { routeKey: next } : next);
    const route = applicationRouteFor(normalized.routeKey);
    if (normalized.invalid || !route || !userCanAccessRoute(user, route)) {
      if (options.notifyDenied !== false) setToast({ message: '没有权限打开该应用', type: 'error' });
      return false;
    }
    const hash = serializeRouteLocation(normalized);
    if (options.replace) history.replaceState(null, '', hash);
    else if (location.hash !== hash) location.hash = hash;
    setCurrentLocation(normalized);
    setMobileApplication({ page: route.key, label: options.label || route.title });
    setMobileTab('apps');
    return true;
  }, [user]);

  const navigateToPage = useCallback((pageKey, target = null, options = {}) => navigate(
    { routeKey: pageKey, target },
    { ...options, replace: options.replace || options.writeHash === false },
  ), [navigate]);

  const setHeaderBackAction = (action) => setDocumentBackAction(() => action);
  const registerHeaderBackAction = useCallback((action) => {
    const key = Symbol('v16-full-page-surface');
    modalBackActions.current.set(key, action); setModalBackVersion((version) => version + 1);
    return () => { modalBackActions.current.delete(key); setModalBackVersion((version) => version + 1); };
  }, []);

  useEffect(() => {
    if (!getToken()) return setChecking(false);
    api('/api/auth/me').then(({ user: authenticatedUser }) => setUser(authenticatedUser)).finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    const unauthorized = () => setUser(null);
    addEventListener('erp:unauthorized', unauthorized); addEventListener('hashchange', applyBrowserLocation);
    if (user && location.hash) applyBrowserLocation();
    return () => { removeEventListener('erp:unauthorized', unauthorized); removeEventListener('hashchange', applyBrowserLocation); };
  }, [user, applyBrowserLocation]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 3200); return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!user) { setPendingApprovalCount(0); return undefined; }
    let current = true;
    api('/api/approvals?tab=pending&limit=1').then((data) => { if (current) setPendingApprovalCount(data.counts?.pending || 0); })
      .catch(() => { if (current) setPendingApprovalCount(0); });
    return () => { current = false; };
  }, [user]);

  const notify = (message, type = 'success') => setToast({ message, type });
  const mobileApplicationGroups = buildMobileApplicationGroups(visibleNav, {
    isItemVisible: (item) => userCanAccessLauncherEntry(user, item),
  });

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* Local logout remains authoritative. */ }
    setToken(''); setUser(null);
  }
  function handleMobileTabChange(key) {
    if (MOBILE_TAB_KEYS.has(key)) { setMobileApplication(null); setMobileTab(key); }
  }
  function handleMobileApplicationSelect(item) {
    navigate({ routeKey: item.page, target: item.reportKey ? { reportKey: item.reportKey } : item.target }, { label: item.label });
  }
  function returnToMobileApplications() { setMobileApplication(null); setMobileTab('apps'); }

  function renderApplicationRoute(route) {
    if (currentLocation.invalid) return <SafeRouteState kind="MALFORMED" />;
    if (!route) return <SafeRouteState kind="UNKNOWN" />;
    if (!route.enabled) return <SafeRouteState kind="DISABLED" />;
    if (!userCanAccessRoute(user, route)) return <SafeRouteState kind="PERMISSION_DENIED" />;
    return <V16RouteSurface route={route.key}><RouteScreen route={route} locationKey={serializeRouteLocation(currentLocation)} user={user} notify={notify} onPendingCountChange={setPendingApprovalCount} mobileWorkspace={route.key === 'dashboard'} /></V16RouteSurface>;
  }

  function renderMobileContent() {
    if (mobileTab === 'messages') return <RouteScreen route={applicationRouteFor('notifications')} user={user} notify={notify} />;
    if (mobileTab === 'approvals') return <RouteScreen route={applicationRouteFor('approvals')} notify={notify} onPendingCountChange={setPendingApprovalCount} />;
    if (mobileTab === 'workspace') return <RouteScreen route={applicationRouteFor('dashboard')} user={user} notify={notify} mobileWorkspace />;
    if (mobileTab === 'profile') return (
      <MobilePage title="我的" subtitle={`${user.displayName} · ${roleDisplayName(user)}`} actions={<button type="button" className="text-button" data-testid="mobile-profile-logout" onClick={logout}>退出</button>}>
        <div className="mobile-card" data-testid="mobile-profile-card"><div className="mobile-card__title">账户信息</div>
          <div className="mobile-card__row"><span className="mobile-card__row-label">姓名</span><span className="mobile-card__row-value">{user.displayName}</span></div>
          <div className="mobile-card__row"><span className="mobile-card__row-label">角色</span><span className="mobile-card__row-value">{roleDisplayName(user)}</span></div>
          <div className="mobile-card__row"><span className="mobile-card__row-label">登录账号</span><span className="mobile-card__row-value">{user.username || '—'}</span></div>
        </div>
      </MobilePage>
    );
    if (mobileApplication) return <section className="mobile-application-view" data-testid={`mobile-application-view-${mobileApplication.page}`} aria-label={mobileApplication.label}>{renderApplicationRoute(currentRoute)}</section>;
    return <MobileLauncher groups={mobileApplicationGroups} visibleNav={visibleNav} icons={ic} onItemSelect={handleMobileApplicationSelect} />;
  }

  if (checking) return <div className="boot"><div className="spinner"/><p>正在载入Modern ERP…</p></div>;
  if (!user) return <LazyLogin onLogin={setUser} notify={notify}/>;

  const compatibilityTarget = Object.keys(currentLocation.target).length ? { page: currentLocation.routeKey, ...currentLocation.target } : null;
  const tabLabel = MOBILE_TABS.find((tab) => tab.key === mobileTab)?.label || 'Modern ERP';
  const workspaceTitle = mobileApplication?.label || (mobileTab === 'apps' ? '应用' : tabLabel);
  const registeredBackAction = [...modalBackActions.current.values()].at(-1) || null;
  return (
    <AppNavigationProvider value={{
      currentLocation, currentRoute, currentPage: currentLocation.routeKey, target: compatibilityTarget,
      canNavigate, navigate, hrefFor, navigateToPage, setHeaderBackAction, registerHeaderBackAction,
    }}>
      <MobileShell brand="Modern ERP" pageTitle={workspaceTitle} activeTab={mobileTab} onTabChange={handleMobileTabChange}
        backAction={registeredBackAction || documentBackAction || (mobileApplication ? returnToMobileApplications : null)}
        tabBadges={{ approvals: pendingApprovalCount }}>
        {renderMobileContent()}
        {toast && <div className={`toast ${toast.type}`} role="status" data-testid="mobile-toast"><ProductIcon name={toast.type === 'success' ? 'check' : 'error'} size={18}/><span>{toast.message}</span></div>}
      </MobileShell>
    </AppNavigationProvider>
  );
}

// Authentication is outside the application route inventory but remains lazy.
const LoginScreen = lazy(() => import('./pages/master-data.jsx').then((module) => ({ default: module.Login })));
function LazyLogin(props) { return <Suspense fallback={<div className="boot"><div className="spinner"/></div>}><LoginScreen {...props}/></Suspense>; }
