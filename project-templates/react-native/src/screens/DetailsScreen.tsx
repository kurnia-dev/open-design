import React from 'react';
import {
  Text,
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/types';
import { colors, fonts, fontSizes, spacing, radii } from '../tokens';

type DetailsScreenRouteProp = RouteProp<RootStackParamList, 'Details'>;
type DetailsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Details'>;

export default function DetailsScreen() {
  const navigation = useNavigation<DetailsScreenNavigationProp>();
  const route = useRoute<DetailsScreenRouteProp>();
  const info = route.params?.info ?? 'No details provided';
  const insets = useSafeAreaInsets();

  return (
    <View style={s.page}>
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          {
            paddingTop: insets.top + spacing[4],
            paddingBottom: insets.bottom + spacing[4],
          }
        ]}
      >
        <View style={s.header}>
          <Pressable style={s.btnBack} onPress={() => navigation.goBack()}>
            <Text style={s.btnBackText}>← Back</Text>
          </Pressable>
          <Text style={s.eyebrow}>Documentation</Text>
          <Text style={s.title}>System Details</Text>
          <Text style={s.lead}>
            Explore the architecture and specifications of this React Native workspace template.
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Route Parameters</Text>
          <Text style={s.cardLabel}>Passed Value:</Text>
          <View style={s.codeBlock}>
            <Text style={s.code}>{info}</Text>
          </View>
        </View>

        <View style={s.panel}>
          <View style={s.panelHead}>
            <Text style={s.panelTitle}>Design Tokens Reference</Text>
          </View>
          <View style={s.list}>
            <View style={s.listItem}>
              <Text style={s.listKey}>Accent Color</Text>
              <Text style={[s.listVal, { color: colors.accent, fontWeight: '700' }]}>{colors.accent}</Text>
            </View>
            <View style={s.listItem}>
              <Text style={s.listKey}>Background</Text>
              <Text style={s.listVal}>{colors.bg}</Text>
            </View>
            <View style={s.listItem}>
              <Text style={s.listKey}>Fonts (Display)</Text>
              <Text style={[s.listVal, { fontFamily: fonts.display }]}>{fonts.display}</Text>
            </View>
            <View style={s.listItem}>
              <Text style={s.listKey}>Fonts (Mono)</Text>
              <Text style={[s.listVal, { fontFamily: fonts.mono }]}>{fonts.mono}</Text>
            </View>
            <View style={[s.listItem, s.listLast]}>
              <Text style={s.listKey}>Border Radius (MD)</Text>
              <Text style={s.listVal}>{radii.md}px</Text>
            </View>
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
    paddingTop: spacing[8],
    paddingBottom: spacing[12],
  },
  header: {
    marginBottom: spacing[6],
  },
  btnBack: {
    alignSelf: 'flex-start',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceWarm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing[4],
  },
  btnBackText: {
    color: colors.fg,
    fontSize: fontSizes.sm,
    fontWeight: '600',
    fontFamily: fonts.body,
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
    color: colors.fg,
    marginTop: spacing[2],
  },
  lead: {
    fontSize: fontSizes.lg,
    lineHeight: 26,
    color: colors.fg2,
    marginTop: spacing[3],
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[5],
    marginBottom: spacing[6],
  },
  cardTitle: {
    fontFamily: fonts.display,
    fontSize: fontSizes.xl,
    color: colors.fg,
    marginBottom: spacing[2],
  },
  cardLabel: {
    fontSize: fontSizes.xs,
    fontFamily: fonts.mono,
    color: colors.meta,
    textTransform: 'uppercase',
    marginBottom: spacing[1],
  },
  codeBlock: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radii.sm,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  code: {
    fontFamily: fonts.mono,
    fontSize: fontSizes.sm,
    color: colors.fg,
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  panelHead: {
    padding: spacing[5],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  panelTitle: {
    fontFamily: fonts.display,
    fontSize: fontSizes.xl,
    color: colors.fg,
  },
  list: {
    paddingHorizontal: spacing[5],
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  listLast: {
    borderBottomWidth: 0,
  },
  listKey: {
    color: colors.fg2,
    fontSize: fontSizes.sm,
    fontFamily: fonts.body,
  },
  listVal: {
    color: colors.muted,
    fontSize: fontSizes.sm,
    fontFamily: fonts.body,
  },
});
