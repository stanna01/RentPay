import Constants from 'expo-constants';
import { StyleSheet, Text, View } from 'react-native';

import { API_MODE } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { colors, spacing } from '@/theme';

import { Button, Card, DemoBanner, Screen, SectionTitle } from './ui';

const ROLE_LABEL = { STUDENT: 'Student', SPONSOR: 'Sponsor', LANDLORD: 'Landlord' } as const;

/** Shared by every role's "Account" tab. */
export function AccountScreen() {
  const { me, signOut } = useAuth();
  if (!me) return null;
  return (
    <Screen>
      <DemoBanner />
      <Card>
        <Text style={styles.name}>{me.name}</Text>
        <Text style={styles.muted}>{me.email}</Text>
        <View style={styles.tags}>
          <Text style={styles.tag}>{ROLE_LABEL[me.role]}</Text>
          {me.organizationName ? <Text style={styles.tag}>{me.organizationName}</Text> : null}
          {me.sponsorName ? <Text style={styles.tag}>{me.sponsorName}</Text> : null}
        </View>
      </Card>

      <SectionTitle>Security</SectionTitle>
      <Card>
        <Text style={styles.body}>
          Password changes and the list of signed-in devices arrive with the new account system (platform plan §7).
          Until then, change your password on the web portal.
        </Text>
      </Card>

      <Button title="Sign out" variant="danger" onPress={signOut} />
      <Text style={styles.version}>
        Version {Constants.expoConfig?.version ?? '—'} · {API_MODE === 'demo' ? 'demo data' : 'live server'}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 19, fontWeight: '700', color: colors.ink },
  muted: { fontSize: 14, color: colors.muted },
  body: { fontSize: 14.5, color: colors.ink, lineHeight: 21 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  tag: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.paid.text,
    backgroundColor: colors.paid.bg,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  version: { textAlign: 'center', fontSize: 12.5, color: colors.muted },
});
