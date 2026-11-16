import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api, payableOf } from '@/api';
import { ShareRow } from '@/components/rows';
import { Button, EmptyState, ErrorState, Loading, Screen, SectionTitle } from '@/components/ui';
import { formatK } from '@/format';
import { colors, spacing } from '@/theme';

/** Every charge the student is responsible for; tick the ones to pay. */
export default function Bills() {
  const charges = useQuery({ queryKey: ['student', 'charges'], queryFn: api.myCharges });
  const [picked, setPicked] = useState<string[]>([]);

  if (charges.isPending) return <Loading />;
  if (charges.isError) return <ErrorState message={charges.error.message} onRetry={charges.refetch} />;

  const unpaid = charges.data.filter((s) => s.balance > 0);
  const settled = charges.data.filter((s) => s.balance === 0);
  const payable = unpaid.filter((s) => payableOf(s) > 0);
  // Ignore anything paid (or already being paid) since it was ticked.
  const selected = picked.filter((id) => payable.some((s) => s.id === id));
  const total = payable.filter((s) => selected.includes(s.id)).reduce((sum, s) => sum + payableOf(s), 0);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  if (!charges.data.length) return <EmptyState icon="document-text-outline" title="No bills yet" />;

  return (
    <Screen
      refreshing={charges.isRefetching}
      onRefresh={charges.refetch}
      footer={
        selected.length ? (
          <Button
            title={`Pay ${formatK(total)} for ${selected.length} item${selected.length === 1 ? '' : 's'}`}
            onPress={() => router.push({ pathname: '/pay', params: { shareIds: selected.join(',') } })}
          />
        ) : null
      }>
      {unpaid.length ? (
        <>
          <View style={styles.head}>
            <SectionTitle>To pay</SectionTitle>
            <Pressable accessibilityRole="button" onPress={() => setPicked(payable.map((s) => s.id))} hitSlop={12}>
              <Text style={styles.link}>Select all</Text>
            </Pressable>
          </View>
          {unpaid.map((s) => (
            <ShareRow key={s.id} share={s} selected={selected.includes(s.id)} onToggle={() => toggle(s.id)} />
          ))}
        </>
      ) : (
        <EmptyState icon="checkmark-circle-outline" title="You're all paid up" />
      )}
      {settled.length ? (
        <>
          <SectionTitle>Paid</SectionTitle>
          {settled.map((s) => (
            <ShareRow key={s.id} share={s} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  link: { color: colors.brand, fontWeight: '700', fontSize: 14 },
});
