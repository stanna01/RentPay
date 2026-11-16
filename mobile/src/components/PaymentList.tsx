import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';

import { api } from '@/api';

import { PaymentRow } from './rows';
import { EmptyState, ErrorState, Loading, Screen } from './ui';

/** The signed-in payer's payments (students and sponsors); tap one for its receipt. */
export function PaymentList() {
  const payments = useQuery({ queryKey: ['payments'], queryFn: api.payments });

  if (payments.isPending) return <Loading />;
  if (payments.isError) return <ErrorState message={payments.error.message} onRetry={payments.refetch} />;
  if (!payments.data.length) {
    return <EmptyState icon="receipt-outline" title="No payments yet" message="Your payments and receipts will appear here." />;
  }

  return (
    <Screen refreshing={payments.isRefetching} onRefresh={payments.refetch}>
      {payments.data.map((p) => (
        <PaymentRow key={p.id} payment={p} onPress={() => router.push(`/payment/${p.id}`)} />
      ))}
    </Screen>
  );
}
