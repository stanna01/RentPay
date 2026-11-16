import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api, payableOf, type SponsoredStudent } from '@/api';
import { Button, Card, Checkbox, DemoBanner, EmptyState, ErrorState, Loading, Screen, SectionTitle, StatusBadge, textStyles } from '@/components/ui';
import { formatK } from '@/format';
import { colors, radius, spacing } from '@/theme';

/** The sponsor's share still payable for a student (due minus money already on its way). */
const payableNow = (s: SponsoredStudent) => payableOf({ balance: s.due, pending: s.pending });

/**
 * The sponsor's students, grouped by boarding house. Payments go straight to
 * each landlord's own account, so one payment covers one boarding house:
 * ticking a student in a different house starts a new selection.
 */
export default function SponsorStudents() {
  const students = useQuery({ queryKey: ['sponsor', 'students'], queryFn: api.sponsoredStudents });
  const [house, setHouse] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  if (students.isPending) return <Loading />;
  if (students.isError) return <ErrorState message={students.error.message} onRetry={students.refetch} />;
  if (!students.data.length) {
    return <EmptyState icon="people-outline" title="No students yet" message="Students appear here once they accept your sponsorship." />;
  }

  const list = students.data;
  // Only what is still payable: a slip being checked or a payment in progress isn't paid twice.
  const selected = picked.filter((id) => list.some((s) => s.residentId === id && payableNow(s) > 0));
  const total = list.filter((s) => selected.includes(s.residentId)).reduce((sum, s) => sum + payableNow(s), 0);
  const houses = [...new Set(list.map((s) => s.propertyName))];
  const allDue = list.reduce((sum, s) => sum + s.due, 0);
  const allOverdue = list.reduce((sum, s) => sum + s.overdue, 0);
  const allPending = list.reduce((sum, s) => sum + s.pending, 0);

  const toggle = (s: SponsoredStudent) => {
    if (house !== s.propertyName) {
      setHouse(s.propertyName);
      setPicked([s.residentId]);
      return;
    }
    setPicked((p) => (p.includes(s.residentId) ? p.filter((x) => x !== s.residentId) : [...p, s.residentId]));
  };
  const selectAllIn = (propertyName: string) => {
    setHouse(propertyName);
    setPicked(list.filter((s) => s.propertyName === propertyName && payableNow(s) > 0).map((s) => s.residentId));
  };

  return (
    <Screen
      refreshing={students.isRefetching}
      onRefresh={students.refetch}
      footer={
        selected.length ? (
          <>
            <Button
              title={`Pay ${formatK(total)} for ${selected.length} student${selected.length === 1 ? '' : 's'}`}
              onPress={() => router.push({ pathname: '/pay', params: { residentIds: selected.join(',') } })}
            />
            <Text style={styles.footNote}>Paying {house} · one boarding house per payment</Text>
          </>
        ) : null
      }>
      <DemoBanner />
      <Card>
        <Text style={styles.label}>Your share still to pay</Text>
        <Text style={[textStyles.big, { color: allDue ? colors.due.text : colors.paid.text }]}>{formatK(allDue)}</Text>
        <Text style={textStyles.muted}>
          {list.length} students · {allOverdue ? `${formatK(allOverdue)} overdue` : 'nothing overdue'}
        </Text>
        {allPending > 0 ? <Text style={styles.pending}>{formatK(allPending)} of it is on its way — waiting for confirmation</Text> : null}
      </Card>

      {houses.map((propertyName) => {
        const inHouse = list.filter((s) => s.propertyName === propertyName);
        const anyDue = inHouse.some((s) => payableNow(s) > 0);
        return (
          <View key={propertyName} style={{ gap: spacing.sm }}>
            <View style={styles.head}>
              <SectionTitle>{propertyName}</SectionTitle>
              {anyDue ? (
                <Pressable accessibilityRole="button" hitSlop={12} onPress={() => selectAllIn(propertyName)}>
                  <Text style={styles.link}>Select all due</Text>
                </Pressable>
              ) : null}
            </View>
            {inHouse.map((s) => (
              <StudentRow key={s.residentId} student={s} selected={selected.includes(s.residentId)} onToggle={() => toggle(s)} />
            ))}
          </View>
        );
      })}
    </Screen>
  );
}

function StudentRow({ student, selected, onToggle }: { student: SponsoredStudent; selected: boolean; onToggle: () => void }) {
  const payable = payableNow(student) > 0;
  return (
    <Pressable
      disabled={!payable}
      onPress={onToggle}
      accessibilityRole={payable ? 'checkbox' : undefined}
      accessibilityState={payable ? { checked: selected } : undefined}
      style={[styles.row, selected && styles.rowSelected]}>
      {payable ? <Checkbox checked={selected} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name}>{student.name}</Text>
        <Text style={styles.sub}>
          Room {student.roomLabel}
          {student.cohort ? ` · ${student.cohort}` : ''}
        </Text>
        <Text style={styles.sub}>You cover {student.coverage}</Text>
        {student.pending > 0 ? <Text style={styles.pending}>{formatK(student.pending)} on its way — waiting for confirmation</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={styles.amount}>{student.due > 0 ? formatK(student.due) : '—'}</Text>
        <StatusBadge status={student.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  link: { color: colors.brand, fontWeight: '700', fontSize: 14 },
  footNote: { fontSize: 12.5, color: colors.muted, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
  },
  rowSelected: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 12.5, color: colors.muted },
  pending: { fontSize: 12.5, fontWeight: '600', color: colors.partial.text },
  amount: { fontSize: 15, fontWeight: '700', color: colors.ink },
});
