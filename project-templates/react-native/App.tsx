import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { Navigation } from './src/navigation/RootNavigator';

export default function App({ initialMetrics }: { initialMetrics?: any }) {
  return (
    <SafeAreaProvider initialMetrics={initialMetrics ?? initialWindowMetrics}>
      <Navigation />
    </SafeAreaProvider>
  );
}
