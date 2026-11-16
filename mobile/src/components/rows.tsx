// List rows for bills (charge shares) and payments.

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { payableOf, type ChargeShare, type Payment, type PaymentMethod } from '@/api';
import { formatDate, formatK } from '@/format';
import { colors, radius, spacing } from '@/theme';

import { Checkbox, StatusBadge } from './ui';

/**
 * One charge share. When `onToggle` is given and something is still owed, the
 * row works as a checkbox so the payer can choose what to pay for.
 */
export function ShareRow({
  share,
  selected = false,
  onToggle,
  showStudent = false,
}: {
  share: ChargeShare;
  selected?: boolean;
  onToggle?: () => void;
  showStudent?: boolean;
}) {
  const selectable = !!onToggle && payableOf(share) > 0;
  return (
    <Pressable
      disabled={!selectable}
      onPress={onToggle}
      accessibilityRole={selectable ? 'checkbox' : undefined}
      accessibilityState={selectable ? { checked: selected } : undefined}
      style={[styles.row, selected && styles.rowSelected]}>
      {selectable ? <Checkbox checked={selected} /> : null}
      <View style={styles.main}>
        <Text style={styles.title}>{showStudent ? share.studentName : share.description}</Text>
        <Text style={styles.sub}>
          {showStudent ? `${share.description} · ` : ''}
          {share.period} · due {formatDate(share.dueDate)}
        </Text>
        {share.paid > 0 && share.balance > 0 ? (
          <Text style={styles.sub}>
            Paid {formatK(share.paid)} of {formatK(share.amount)}
          </Text>
        ) : null}
        {share.pending > 0 ? <Text style={styles.pending}>{formatK(share.pending)} on its way — waiting for confirmation</Text> : null}
      </View>
      <View style={styles.side}>
        <Text style={styles.amount}>{formatK(share.balance > 0 ? share.balance : share.amount)}</Text>
        <StatusBadge status={share.status} />
      </View>
    </Pressable>
  );
}

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  MOBILE_MONEY: 'Mobile money',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  CASH: 'Cash',
};

export function PaymentRow({ payment, onPress }: { payment: Payment; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} style={styles.row}>
      <View style={styles.main}>
        <Text style={styles.title}>{payment.description}</Text>
        <Text style={styles.sub}>
          {formatDate(payment.createdAt)} · {METHOD_LABEL[payment.method]}
          {payment.receiptNumber ? ` · ${payment.receiptNumber}` : ''}
        </Text>
      </View>
      <View style={styles.side}>
        <Text style={[styles.amount, (payment.status === 'FAILED' || payment.status === 'REVERSED') && styles.struck]}>
          {formatK(payment.amount)}
        </Text>
        <StatusBadge status={payment.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    minHeight: 64,
  },
  rowSelected: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  main: { flex: 1, gap: 2 },
  side: { alignItems: 'flex-end', gap: 6 },
  title: { fontSize: 15, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 12.5, color: colors.muted },
  pending: { fontSize: 12.5, fontWeight: '600', color: colors.partial.text },
  amount: { fontSize: 15, fontWeight: '700', color: colors.ink },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
});
