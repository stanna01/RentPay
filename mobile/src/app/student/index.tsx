import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { api, payableOf } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, DemoBanner, ErrorState, Loading, Screen, SectionTitle, textStyles } from '@/components/ui';
import { formatDate, formatK } from '@/format';
import { colors } from '@/theme';

export default function StudentHome() {
  const { me } = useAuth();
  const home = useQuery({ queryKey: ['student', 'home'], queryFn: api.studentHome });
  const charges = useQuery({ queryKey: ['student', 'charges'], queryFn: api.myCharges });

  if (home.isPending) return <Loading />;
  if (home.isError) return <ErrorState message={home.error.message} onRetry={home.refetch} />;

  const h = home.data;
  const payable = (charges.data ?? []).filter((s) => payableOf(s) > 0);
  const payableIds = payable.map((s) => s.id);
  const payableTotal = payable.reduce((sum, s) => sum + payableOf(s), 0);
  const owes = h.balance > 0;

  return (
    <Screen
      refreshing={home.isRefetching}
      onRefresh={() => {
        home.refetch();
        charges.refetch();
      }}>
      <DemoBanner />
      <Text style={textStyles.title}>Hi {me?.name.split(' ')[0]}</Text>
      <Text style={textStyles.muted}>
        {h.propertyName} · Room {h.roomLabel}
      </Text>

      <Card style={owes ? styles.owe : styles.clear}>
        <Text style={styles.label}>{owes ? 'You owe' : 'All paid'}</Text>
        <Text style={[textStyles.big, { color: owes ? colors.due.text : colors.paid.text }]}>{formatK(h.balance)}</Text>
        {h.nextDue ? (
          <Text style={textStyles.muted}>
            Next: {h.nextDue.description} · {formatK(h.nextDue.balance)} due {formatDate(h.nextDue.dueDate)}
          </Text>
        ) : (
          <Text style={textStyles.muted}>Nothing is due right now. Thank you!</Text>
        )}
        {h.pending > 0 ? (
          <Text style={styles.pending}>{formatK(h.pending)} is on its way — this updates once it&apos;s confirmed.</Text>
        ) : null}
      </Card>

      {payableTotal > 0 ? (
        <Button
          title={`Pay ${formatK(payableTotal)}`}
          onPress={() => router.push({ pathname: '/pay', params: { shareIds: payableIds.join(',') } })}
        />
      ) : null}
      {payableTotal > 0 ? (
        <Button title="Choose what to pay" variant="secondary" onPress={() => router.push('/student/bills')} />
      ) : null}

      {h.sponsors.length > 0 ? (
        <>
          <SectionTitle>Your sponsors</SectionTitle>
          {h.sponsors.map((s) => (
            <Card key={s.name}>
              <Text style={styles.sponsor}>{s.name}</Text>
              <Text style={textStyles.muted}>Covers {s.coverage}. You pay the rest.</Text>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  owe: { borderColor: colors.due.border, backgroundColor: colors.due.bg },
  clear: { borderColor: colors.paid.border, backgroundColor: colors.paid.bg },
  label: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  sponsor: { fontSize: 16, fontWeight: '700', color: colors.ink },
  pending: { fontSize: 13.5, fontWeight: '600', color: colors.partial.text },
});
