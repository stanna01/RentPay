import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { Card, DemoBanner, ErrorState, Loading, Screen, textStyles } from '@/components/ui';
import { formatK } from '@/format';
import { colors, spacing } from '@/theme';

export default function LandlordDashboard() {
  const { me } = useAuth();
  const dash = useQuery({ queryKey: ['landlord', 'dashboard'], queryFn: api.landlordDashboard });

  if (dash.isPending) return <Loading />;
  if (dash.isError) return <ErrorState message={dash.error.message} onRetry={dash.refetch} />;
  const d = dash.data;

  return (
    <Screen refreshing={dash.isRefetching} onRefresh={dash.refetch}>
      <DemoBanner />
      <Text style={textStyles.title}>{me?.organizationName}</Text>
      <Text style={textStyles.muted}>{d.periodLabel}</Text>

      <View style={styles.grid}>
        <Stat label="Collected" value={formatK(d.collected)} color={colors.brand} />
        <Stat label="Outstanding" value={formatK(d.outstanding)} color={colors.due.text} />
        <Stat label="Beds occupied" value={`${d.occupiedBeds} / ${d.totalBeds}`} color={colors.ink} />
        <Stat
          label="Bank slips to check ›"
          value={String(d.pendingTransfers)}
          color={d.pendingTransfers ? colors.partial.text : colors.ink}
          onPress={() => router.push('/landlord/verify')}
        />
      </View>

      <Card>
        <Text style={textStyles.body}>
          Rooms, students, billing, sponsors and reports are managed on the web portal. This app covers quick tasks on
          the go: the day&apos;s numbers and checking bank slips.
        </Text>
      </Card>
    </Screen>
  );
}

function Stat({ label, value, color, onPress }: { label: string; value: string; color: string; onPress?: () => void }) {
  const card = (
    <Card style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </Card>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" style={styles.cell} onPress={onPress}>
      {card}
    </Pressable>
  ) : (
    <View style={styles.cell}>{card}</View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: { flexBasis: '47%', flexGrow: 1 },
  stat: { padding: spacing.md, gap: 2 },
  statLabel: { fontSize: 12.5, fontWeight: '600', color: colors.muted },
  statValue: { fontSize: 20, fontWeight: '700' },
});
