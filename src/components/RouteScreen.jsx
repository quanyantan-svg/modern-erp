import { Component, Suspense, lazy } from 'react';

const screens = new Map();
function lazyScreen(route) {
  if (!screens.has(route.key)) screens.set(route.key, lazy(route.screen.loader));
  return screens.get(route.key);
}

export class RouteErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) return (
      <div className="v16-empty" role="alert" data-testid="route-screen-error">
        <strong>应用暂时无法打开</strong><div>请返回应用列表后重试。</div>
      </div>
    );
    return this.props.children;
  }
}

export default function RouteScreen({ route, locationKey = '', ...screenProps }) {
  const Screen = lazyScreen(route);
  return (
    <RouteErrorBoundary resetKey={`${route.key}:${locationKey}`}>
      <Suspense fallback={<div className="v16-empty" data-testid="route-screen-loading">正在载入应用…</div>}>
        <Screen {...screenProps} />
      </Suspense>
    </RouteErrorBoundary>
  );
}
