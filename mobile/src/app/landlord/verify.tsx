import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api, type TransferToVerify } from '@/api';
import { Button, Card, EmptyState, ErrorState, Field, Loading, Screen, textStyles } from '@/components/ui';
import { formatDate, formatK } from '@/format';
import { colors, spacing } from '@/theme';

/** Bank-transfer payments waiting for the landlord to compare with the bank statement. */
export default function VerifyTransfers() {
  const list = useQuery({ queryKey: ['landlord', 'transfers'], queryFn: api.transfersToVerify });

  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState message={list.error.message} onRetry={list.refetch} />;
  if (!list.data.length) {
    return <EmptyState icon="checkmark-done-outline" title="No slips to check" message="New bank-transfer slips from students and sponsors appear here." />;
  }

  return (
    <Screen refreshing={list.isRefetching} onRefresh={list.refetch}>
      <Text style={textStyles.muted}>
        Approve a slip only after the money shows on your bank statement. Approving issues the receipt.
      </Text>
      {list.data.map((t) => (
        <TransferCard key={t.paymentId} transfer={t} />
      ))}
    </Screen>
  );
}

function TransferCard({ transfer }: { transfer: TransferToVerify }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const review = useMutation({
    mutationFn: (approve: boolean) => api.reviewTransfer(transfer.paymentId, approve, approve ? undefined : reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['landlord'] }),
  });

  return (
    <Card>
      <View style={styles.top}>
        <Text style={styles.payer}>{transfer.payerName}</Text>
        <Text style={styles.amount}>{formatK(transfer.amount)}</Text>
      </View>
      <Text style={textStyles.muted}>
        Reference {transfer.reference} · sent {formatDate(transfer.submittedAt)}
      </Text>
      <Text style={textStyles.muted}>Slip: {transfer.proofName}</Text>
      {review.isError ? <Text style={styles.error}>{review.error.message}</Text> : null}

      {rejecting ? (
        <View style={{ gap: spacing.sm }}>
          <Field label="Why are you rejecting it?" value={reason} onChangeText={setReason} placeholder="e.g. Not on our bank statement" />
          <Button title="Reject slip" variant="danger" loading={review.isPending} disabled={!reason.trim()} onPress={() => review.mutate(false)} />
          <Button title="Cancel" variant="secondary" onPress={() => setRejecting(false)} />
        </View>
      ) : (
        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button title="Reject" variant="secondary" disabled={review.isPending} onPress={() => setRejecting(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Approve" loading={review.isPending} onPress={() => review.mutate(true)} />
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  payer: { fontSize: 16, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  amount: { fontSize: 17, fontWeight: '700', color: colors.ink },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  error: { color: colors.due.text, fontWeight: '600' },
});
