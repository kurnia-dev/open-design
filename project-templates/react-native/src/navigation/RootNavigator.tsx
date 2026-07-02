import { createStaticNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import DetailsScreen from '../screens/DetailsScreen';

import type { RootStackParamList } from './types';

export const RootStack = createNativeStackNavigator<RootStackParamList>({
  screens: {
    Home: {
      screen: HomeScreen,
      options: { headerShown: false },
    },
    Details: {
      screen: DetailsScreen,
      options: { headerShown: false },
    },
  },
});

export const Navigation = createStaticNavigation(RootStack);
