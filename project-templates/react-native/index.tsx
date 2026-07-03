import { Platform } from 'react-native';

if (Platform.OS === 'web') {
  const _global = globalThis as any;
  const _window = _global.window;

  const getMockInsets = () => {
    if (typeof _window === 'undefined') return { top: 0, bottom: 0, left: 0, right: 0 };
    const params = new _window.URLSearchParams(_window.location.search);
    return {
      top: parseInt(params.get('safeAreaInsetsTop') || '0', 10),
      bottom: parseInt(params.get('safeAreaInsetsBottom') || '0', 10),
      left: parseInt(params.get('safeAreaInsetsLeft') || '0', 10),
      right: parseInt(params.get('safeAreaInsetsRight') || '0', 10),
    };
  };

  const getMockFrame = () => {
    if (typeof _window === 'undefined') return { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: 0,
      y: 0,
      width: _window.innerWidth,
      height: _window.innerHeight,
    };
  };

  try {
    const safeArea = require('react-native-safe-area-context');

    // Monkeypatch NativeSafeAreaProvider to bypass web element measurements
    // and dynamically feed safe area insets via query params & postMessage.
    safeArea.NativeSafeAreaProvider = function ({ children, style, onInsetsChange }: any) {
      const React = require('react');
      const { View } = require('react-native');

      const [insets, setInsets] = React.useState(getMockInsets());
      const frame = React.useMemo(() => getMockFrame(), []);

      React.useEffect(() => {
        if (onInsetsChange) {
          onInsetsChange({ nativeEvent: { insets, frame } });
        }
      }, [onInsetsChange, insets, frame]);

      React.useEffect(() => {
        if (typeof _window === 'undefined') return;

        const handleMessage = (event: any) => {
          if (event.data && event.data.type === 'od-safe-area-insets') {
            setInsets(event.data.insets);
          }
        };

        _window.addEventListener('message', handleMessage);
        return () => _window.removeEventListener('message', handleMessage);
      }, []);

      return <View style={style}>{children}</View>;
    };
  } catch (e) {
    console.error('Failed to mock react-native-safe-area-context', e);
  }
}

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
