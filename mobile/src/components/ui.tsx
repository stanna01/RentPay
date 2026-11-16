// Small building blocks shared by every screen: Screen, Card, Button, Field,
// StatusBadge, Checkbox, and the loading / error / empty states.

import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { API_MODE, type PaymentStatus, type ShareStatus } from '@/api';
import { colors, radius, spacing } from '@/theme';

// --- Screen -----------------------------------------------------------------

export function Screen({
  children,
  refreshing,
  onRefresh,
  footer,
  footerSafeArea = false,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Pinned under the scrolling content (e.g. the "Pay" button). */
  footer?: ReactNode;
  /** Pad the footer for the home indicator (screens without a tab bar). */
  footerSafeArea?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />
          ) : undefined
        }>
        {children}
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, footerSafeArea && { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>{footer}</View>
      ) : null}
    </View>
  );
}

// --- Card -------------------------------------------------------------------

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// --- Button -----------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [styles.button, buttonStyles[variant], inactive && styles.inactive, pressed && styles.pressed]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.white : colors.brand} />
      ) : (
        <Text style={[styles.buttonText, { color: variant === 'primary' ? colors.white : variant === 'danger' ? colors.due.text : colors.ink }]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const buttonStyles = StyleSheet.create({
  primary: { backgroundColor: colors.brand, borderColor: colors.brand },
  secondary: { backgroundColor: colors.white, borderColor: colors.line },
  danger: { backgroundColor: colors.white, borderColor: colors.due.border },
});

// --- Form field -------------------------------------------------------------

export function Field({ label, hint, ...input }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.vacant.text} style={styles.input} {...input} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

// --- Status badges ----------------------------------------------------------

const BADGES: Record<ShareStatus | PaymentStatus, { label: string; text: string; bg: string }> = {
  PAID: { label: 'Paid', text: colors.paid.text, bg: colors.paid.bg },
  PARTIAL: { label: 'Part paid', text: colors.partial.text, bg: colors.partial.bg },
  DUE: { label: 'Due', text: '#4A5A52', bg: '#EEF1EC' },
  OVERDUE: { label: 'Overdue', text: colors.due.text, bg: colors.due.bg },
  PENDING: { label: 'In progress', text: colors.partial.text, bg: colors.partial.bg },
  AWAITING_VERIFICATION: { label: 'Checking slip', text: colors.partial.text, bg: colors.partial.bg },
  SUCCEEDED: { label: 'Paid', text: colors.paid.text, bg: colors.paid.bg },
  FAILED: { label: 'Failed', text: colors.due.text, bg: colors.due.bg },
  CANCELLED: { label: 'Cancelled', text: colors.muted, bg: colors.vacant.bg },
  REVERSED: { label: 'Reversed', text: colors.muted, bg: colors.vacant.bg },
};

export function StatusBadge({ status }: { status: ShareStatus | PaymentStatus }) {
  const b = BADGES[status];
  return (
    <View style={[styles.badge, { backgroundColor: b.bg }]}>
      <Text style={[styles.badgeText, { color: b.text }]}>{b.label}</Text>
    </View>
  );
}

export function Checkbox({ checked }: { checked: boolean }) {
  return (
    <View style={[styles.checkbox, checked && styles.checkboxOn]}>
      {checked ? <Ionicons name="checkmark" size={16} color={colors.white} /> : null}
    </View>
  );
}

// --- Loading / error / empty ------------------------------------------------

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.brand} />
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={[styles.center, { gap: spacing.md }]}>
      <Ionicons name="cloud-offline-outline" size={40} color={colors.muted} />
      <Text style={styles.centerText}>{message}</Text>
      {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  message?: string;
}) {
  return (
    <View style={[styles.center, { gap: spacing.sm }]}>
      <Ionicons name={icon} size={40} color={colors.muted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.centerText}>{message}</Text> : null}
    </View>
  );
}

/** A reminder that nothing here is real money while in demo mode. */
export function DemoBanner() {
  if (API_MODE !== 'demo') return null;
  return (
    <View style={styles.demo}>
      <Ionicons name="flask-outline" size={16} color={colors.partial.text} />
      <Text style={styles.demoText}>Demo mode · sample data · no real money</Text>
    </View>
  );
}

export const textStyles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 },
  body: { fontSize: 15, color: colors.ink },
  muted: { fontSize: 13.5, color: colors.muted },
  big: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.sm },
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  inactive: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink },
  hint: { fontSize: 12.5, color: colors.muted },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#D6DCD4',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.ink,
  },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#C4CBC4',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  center: { flex: 1, minHeight: 240, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  centerText: { fontSize: 14.5, color: colors.muted, textAlign: 'center', maxWidth: 300 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  demo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'center',
    backgroundColor: colors.partial.bg,
    borderColor: colors.partial.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  demoText: { fontSize: 12.5, fontWeight: '600', color: colors.partial.text },
});
