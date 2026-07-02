import React from 'react';
import {
  Text,
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/types';
import { colors, fonts, fontSizes, spacing, radii } from '../tokens';

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const insets = useSafeAreaInsets();

  return (
    <View style={s.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          {
            paddingTop: insets.top + spacing[4],
            paddingBottom: insets.bottom + spacing[4],
          }
        ]}
      >
        <View style={s.hero}>
          <Text style={s.eyebrow}>Open Design x Elegant</Text>
          <Text style={s.title}>{'{{projectName}}'}</Text>
          <Text style={s.lead}>
            This is a React Native + Expo project template using the Elegant
            design system. It is not a finished design — it is a starting point.
          </Text>
          <View style={s.heroActions}>
            <Pressable style={s.btnPrimary}>
              <Text style={s.btnPrimaryText}>Ask a design agent to begin</Text>
            </Pressable>
            <Pressable
              style={s.btnSecondary}
              onPress={() => navigation.navigate('Details', { info: 'Scaffold tokens configuration' })}
            >
              <Text style={s.btnSecondaryText}>View Design System Details →</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.panel}>
          <View style={s.panelHead}>
            <View>
              <Text style={s.eyebrow}>Template scaffold</Text>
              <Text style={s.panelTitle}>Whats included</Text>
            </View>
            <View style={s.status}>
              <View style={s.statusDot} />
              <Text style={s.statusText}>ready</Text>
            </View>
          </View>

          <View style={s.metricGrid}>
            <View style={s.metric}>
              <Text style={s.metricValue}>Expo 54</Text>
              <Text style={s.metricLabel}>Runtime</Text>
            </View>
            <View style={s.metric}>
              <Text style={s.metricValue}>RN 0.81</Text>
              <Text style={s.metricLabel}>Framework</Text>
            </View>
            <View style={[s.metric, s.metricLast]}>
              <Text style={s.metricValue}>TS 6</Text>
              <Text style={s.metricLabel}>Language</Text>
            </View>
          </View>

          <View style={s.cardRow}>
            <View style={s.miniCard}>
              <Text style={s.miniCardTitle}>Design tokens</Text>
              <Text style={s.miniCardText}>
                Elegant tokens as constants. Open{' '}
                <Text style={s.code}>src/tokens.ts</Text> to explore the
                palette.
              </Text>
              <View style={s.swatches}>
                <View
                  style={[s.swatch, { backgroundColor: colors.accent }]}
                />
                <View
                  style={[s.swatch, { backgroundColor: colors.surface }]}
                />
                <View
                  style={[s.swatch, { backgroundColor: colors.surfaceWarm }]}
                />
                <View style={[s.swatch, { backgroundColor: colors.fg }]} />
              </View>
            </View>
            <View style={s.miniCard}>
              <Text style={s.miniCardTitle}>Ready to design</Text>
              <Text style={s.miniCardText}>
                Bring your design agent here to replace this scaffold.
              </Text>
              <View style={s.field}>
                <Text style={s.label}>Example input</Text>
                <TextInput
                  style={s.input}
                  defaultValue="Start designing"
                  placeholderTextColor={colors.muted}
                />
              </View>
            </View>
          </View>
        </View>

        <View style={s.tileGrid}>
          <View style={s.tile}>
            <Text style={s.eyebrow}>Typography</Text>
            <Text style={s.tileTitle}>Display rhythm</Text>
            <Text style={s.tileText}>
              Serif display head, sans-serif body, monospace labels — the
              Elegant type scale is ready.
            </Text>
          </View>
          <View style={s.tile}>
            <Text style={s.eyebrow}>Palette</Text>
            <Text style={s.tileTitle}>Warm neutrals</Text>
            <Text style={s.tileText}>
              Accent-driven color system with surface, warm, border, and
              semantic token layers.
            </Text>
          </View>
          <View style={s.tile}>
            <Text style={s.eyebrow}>Interaction</Text>
            <Text style={s.tileTitle}>Motion and states</Text>
            <Text style={s.tileText}>
              Focus rings, hover lifts, input states — system-defined and ready
              to use.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    padding: spacing[4],
    paddingTop: spacing[1],
    paddingBottom: spacing[12],
  },
  eyebrow: {
    color: colors.meta,
    fontFamily: fonts.mono,
    fontSize: fontSizes.xs,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: fonts.display,
    fontSize: fontSizes['3xl'],
    lineHeight: Platform.OS === 'ios' ? 38 : 44,
    letterSpacing: -0.5,
    color: colors.fg,
    marginTop: spacing[2],
  },
  lead: {
    fontSize: fontSizes.lg,
    lineHeight: 26,
    color: colors.fg2,
    marginTop: spacing[3],
  },
  heroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    marginTop: spacing[5],
  },
  btnPrimary: {
    minHeight: 48,
    paddingHorizontal: spacing[6],
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnPrimaryText: {
    color: colors.accentOn,
    fontSize: fontSizes.sm,
    fontWeight: '700',
    fontFamily: fonts.body,
  },
  btnSecondary: {
    minHeight: 48,
    paddingHorizontal: spacing[6],
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceWarm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnSecondaryText: {
    color: colors.fg,
    fontSize: fontSizes.sm,
    fontWeight: '600',
    fontFamily: fonts.body,
  },
  hero: {
    marginBottom: spacing[6],
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing[6],
    ...Platform.select({
      ios: {
        shadowColor: colors.fg,
        shadowOffset: { width: 0, height: 20 },
        shadowOpacity: 0.08,
        shadowRadius: 40,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  panelHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[5],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  panelTitle: {
    fontFamily: fonts.display,
    fontSize: fontSizes.xl,
    lineHeight: 28,
    color: colors.fg,
    marginTop: spacing[1],
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.success,
  },
  statusText: {
    color: colors.meta,
    fontFamily: fonts.mono,
    fontSize: fontSizes.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  metricGrid: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  metric: {
    flex: 1,
    padding: spacing[4],
    borderRightWidth: 1,
    borderRightColor: colors.borderSoft,
  },
  metricLast: {
    borderRightWidth: 0,
  },
  metricValue: {
    fontFamily: fonts.display,
    fontSize: fontSizes['2xl'],
    lineHeight: Platform.OS === 'ios' ? 34 : 38,
    letterSpacing: -0.3,
    color: colors.fg,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: fontSizes.sm,
    marginTop: spacing[1],
  },
  cardRow: {
    padding: spacing[4],
    gap: spacing[4],
  },
  miniCard: {
    padding: spacing[5],
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surfaceWarm,
    marginBottom: spacing[4],
  },
  miniCardTitle: {
    fontFamily: fonts.display,
    fontSize: fontSizes.lg,
    lineHeight: 24,
    color: colors.fg,
  },
  miniCardText: {
    color: colors.muted,
    fontSize: fontSizes.sm,
    lineHeight: 20,
    marginTop: spacing[2],
  },
  code: {
    fontFamily: fonts.mono,
    fontSize: fontSizes.sm - 1,
    color: colors.meta,
  },
  swatches: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  field: {
    marginTop: spacing[4],
  },
  label: {
    color: colors.fg2,
    fontSize: fontSizes.sm,
    fontWeight: '700',
    marginBottom: spacing[2],
  },
  input: {
    width: '100%',
    minHeight: 46,
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    color: colors.fg,
    fontSize: fontSizes.base,
    fontFamily: fonts.body,
  },
  tileGrid: {
    gap: spacing[4],
  },
  tile: {
    padding: spacing[5],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  tileTitle: {
    fontFamily: fonts.display,
    fontSize: fontSizes.xl,
    lineHeight: 28,
    color: colors.fg,
    marginTop: spacing[1],
  },
  tileText: {
    color: colors.muted,
    fontSize: fontSizes.sm,
    lineHeight: 20,
    marginTop: spacing[2],
  },
});
