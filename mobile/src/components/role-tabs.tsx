// Shared look for each role's tab bar. Which role may see which tabs is
// decided by the guards in src/app/_layout.tsx.

import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { colors } from '@/theme';

export const tabScreenOptions = {
  tabBarActiveTintColor: colors.brand,
  tabBarInactiveTintColor: colors.vacant.text,
  headerTitleStyle: { color: colors.ink, fontWeight: '700' as const },
  headerShadowVisible: false,
  sceneStyle: { backgroundColor: colors.surface },
};

export function tabIcon(name: ComponentProps<typeof Ionicons>['name']) {
  // The tab bar passes a React Native ColorValue; Ionicons takes strings or
  // platform colours, not processed numbers or null.
  const TabIcon = ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={typeof color === 'number' || color == null ? undefined : color} size={size} />
  );
  return TabIcon;
}
