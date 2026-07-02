import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import App from './App';

const getInitialMetrics = () => {
  const _global = globalThis as any;
  if (Platform.OS !== 'web' || typeof _global.window === 'undefined') return undefined;
  const _window = _global.window;
  const params = new _window.URLSearchParams(_window.location.search);
  const top = parseInt(params.get('safeAreaInsetsTop') || '0', 10);
  const bottom = parseInt(params.get('safeAreaInsetsBottom') || '0', 10);
  const left = parseInt(params.get('safeAreaInsetsLeft') || '0', 10);
  const right = parseInt(params.get('safeAreaInsetsRight') || '0', 10);
  return {
    frame: { x: 0, y: 0, width: 0, height: 0 },
    insets: { top, bottom, left, right },
  };
};

function Root() {
  const initialMetrics = getInitialMetrics();
  return <App initialMetrics={initialMetrics} />;
}

registerRootComponent(Root);
