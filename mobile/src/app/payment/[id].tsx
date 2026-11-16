import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { api, API_MODE, type Payment } from '@/api';
import { METHOD_LABEL } from '@/components/rows';
import { Button, Card, ErrorState, Loading, Screen, StatusBadge, textStyles } from '@/components/ui';
import { formatDate, formatK } from '@/format';
import { colors, spacing } from '@/theme';

/**
 * Live status of one payment. While it is in progress the screen asks the
 * server every 2 seconds; the result is only ever taken from the server (which
 * hears it from the payment provider), never from the card page's redirect.
 */
export default function PaymentStatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const payment = useQuery({
    queryKey: ['payment', id],
    queryFn: () => api.getPayment(id),
    refetchInterval: (query) => (query.state.data?.status === 'PENDING' ? 2000 : false),
  });
  const status = payment.data?.status;

  // Once it has finished, refresh balances and lists everywhere.
  useEffect(() => {
    if (!status || status === 'PENDING') return;
    for (const key of ['student', 'sponsor', 'payments', 'landlord']) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  }, [status, queryClient]);

  // Card payments: open the provider's hosted checkout once.
  const openedCheckout = useRef(false);
  const next = payment.data?.nextAction;
  useEffect(() => {
    if (next?.type !== 'REDIRECT' || openedCheckout.current || API_MODE === 'demo') return;
    openedCheckout.current = true;
    WebBrowser.openAuthSessionAsync(next.url, Linking.createURL(`/payment/${id}`));
  }, [next, id]);

  if (payment.isPending) return <Loading />;
  if (payment.isError) return <ErrorState message={payment.error.message} onRetry={payment.refetch} />;

  // Return to wherever the payment was started from (home, bills, receipts…)
  // instead of stacking another copy of the home screen.
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <Screen
      footerSafeArea
      footer={
        payment.data.status === 'FAILED' ? (
          <Button title="Go back and try again" onPress={leave} />
        ) : (
          <Button title="Done" variant={payment.data.status === 'SUCCEEDED' ? 'primary' : 'secondary'} onPress={leave} />
        )
      }>
      <Outcome payment={payment.data} />
      <Card>
        <Row label="Amount" value={formatK(payment.data.amount)} />
        <Row label="For" value={payment.data.description} />
        <Row label="Method" value={METHOD_LABEL[payment.data.method]} />
        <Row label="Started" value={formatDate(payment.data.createdAt)} />
        {payment.data.receiptNumber ? <Row label="Receipt" value={payment.data.receiptNumber} /> : null}
        <View style={styles.row}>
          <Text style={textStyles.muted}>Status</Text>
          <StatusBadge status={payment.data.status} />
        </View>
      </Card>
      {payment.data.status === 'SUCCEEDED' ? <ReceiptButton paymentId={payment.data.id} /> : null}
    </Screen>
  );
}

function Outcome({ payment }: { payment: Payment }) {
  const next = payment.nextAction;
  let icon: ComponentProps<typeof Ionicons>['name'] = 'time-outline';
  let tint: string = colors.partial.text;
  let title = 'Payment in progress';
  let body = '';

  if (payment.status === 'SUCCEEDED') {
    icon = 'checkmark-circle';
    tint = colors.paid.text;
    title = 'Payment received';
    body = 'Thank you. Your receipt is ready and your balance has been updated.';
  } else if (payment.status === 'FAILED' || payment.status === 'CANCELLED') {
    icon = 'close-circle';
    tint = colors.due.text;
    title = payment.status === 'FAILED' ? 'Payment failed' : 'Payment cancelled';
    body = payment.failureReason ?? 'No money was taken.';
  } else if (payment.status === 'AWAITING_VERIFICATION') {
    icon = 'hourglass-outline';
    title = 'Slip received';
    body = next?.type === 'WAIT_FOR_VERIFICATION' ? next.message : 'The landlord will confirm it soon.';
  } else if (next?.type === 'APPROVE_ON_PHONE') {
    icon = 'phone-portrait-outline';
    title = 'Check your phone';
    body = next.message;
  } else if (next?.type === 'REDIRECT') {
    icon = 'card-outline';
    title = 'Finish on the secure card page';
    body =
      API_MODE === 'demo'
        ? 'In demo mode the card page is skipped; this payment completes by itself in a few seconds.'
        : 'Complete the payment on the page that opened. This screen updates by itself.';
  }

  return (
    <View style={styles.outcome}>
      <Ionicons name={icon} size={64} color={tint} />
      <Text style={[textStyles.title, { textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[textStyles.muted, styles.center]}>{body}</Text> : null}
      {payment.status === 'PENDING' ? (
        <View style={styles.waiting}>
          <ActivityIndicator color={colors.brand} />
          <Text style={textStyles.muted}>Waiting for confirmation…</Text>
        </View>
      ) : null}
      {payment.status === 'PENDING' && next?.type === 'REDIRECT' && API_MODE === 'live' ? (
        <Button title="Open the card page again" variant="secondary" onPress={() => WebBrowser.openBrowserAsync(next.url)} />
      ) : null}
    </View>
  );
}

function ReceiptButton({ paymentId }: { paymentId: string }) {
  const [message, setMessage] = useState('');
  const open = async () => {
    setMessage('');
    try {
      const url = await api.receiptUrl(paymentId);
      if (url) await WebBrowser.openBrowserAsync(url);
      else setMessage('Receipt PDFs open here once the app is connected to the RentReceipt server.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not open the receipt.');
    }
  };
  return (
    <View style={{ gap: spacing.sm }}>
      <Button title="View receipt (PDF)" variant="secondary" onPress={open} />
      {message ? <Text style={[textStyles.muted, styles.center]}>{message}</Text> : null}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={textStyles.muted}>{label}</Text>
      <Text style={[textStyles.body, styles.value]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  outcome: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  center: { textAlign: 'center', maxWidth: 320 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, minHeight: 28 },
  value: { flexShrink: 1, textAlign: 'right', fontWeight: '600' },
});
