import { Platform } from 'react-native';

export const colors = {
  bg: '#fbf6ee',
  surface: '#fffdf8',
  surfaceWarm: '#f1e3cf',
  fg: '#201914',
  fg2: '#4c4037',
  muted: '#7a6d63',
  meta: '#9b5b32',
  border: '#ded2c3',
  borderSoft: '#eee4d7',
  accent: '#9b5b32',
  accentOn: '#ffffff',
  accentHover: '#8a4f2b',
  accentActive: '#7b4524',
  success: '#4f8a4f',
  warn: '#c9822f',
  danger: '#b33a3a',
};

export const fonts = {
  display: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
  body: Platform.select({ ios: 'System', android: 'sans-serif', default: 'system-ui' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
};

export const fontSizes = {
  xs: 11,
  sm: 13,
  base: 15,
  lg: 17,
  xl: 22,
  '2xl': 30,
  '3xl': 36,
};

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  12: 48,
};

export const radii = {
  sm: 10,
  md: 14,
  lg: 20,
  pill: 9999,
};
