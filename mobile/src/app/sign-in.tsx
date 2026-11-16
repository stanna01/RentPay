import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { API_MODE } from '@/api';
import { DEMO_ACCOUNTS } from '@/api/demo';
import { homeFor, useAuth } from '@/auth/AuthProvider';
import { Button, Card, Field } from '@/components/ui';
import { colors, spacing } from '@/theme';

const ROLE_LABEL = { STUDENT: 'Student', SPONSOR: 'Sponsor', LANDLORD: 'Landlord' } as const;

export default function SignIn() {
  const { me, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (me) return <Redirect href={homeFor(me.role)} />;

  const submit = async () => {
    if (!email.trim() || !password) return setError('Please enter your email and password.');
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={styles.root}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>R</Text>
            </View>
            <Text style={styles.appName}>RentReceipt</Text>
            <Text style={styles.tagline}>Rent, receipts and sponsors in one place</Text>
          </View>

          <Card>
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              placeholder="you@example.com"
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              onSubmitEditing={submit}
            />
            <View style={{ height: spacing.xs }} />
            <Button title="Sign in" onPress={submit} loading={busy} />
            <Text style={styles.help}>Forgot your password? Use “Forgot password?” on the RentReceipt website.</Text>
          </Card>

          {API_MODE === 'demo' ? (
            <Card>
              <Text style={styles.demoTitle}>Try a demo account</Text>
              <Text style={styles.help}>Sample data only — no real money moves.</Text>
              <View style={styles.demoRow}>
                {DEMO_ACCOUNTS.map((a) => (
                  <Pressable
                    key={a.email}
                    accessibilityRole="button"
                    style={styles.demoChip}
                    onPress={() => {
                      setEmail(a.email);
                      setPassword(a.password);
                      setError('');
                    }}>
                    <Text style={styles.demoChipText}>{ROLE_LABEL[a.role]}</Text>
                  </Pressable>
                ))}
              </View>
            </Card>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand },
  content: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  brand: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: colors.white, fontSize: 30, fontWeight: '800' },
  appName: { color: colors.white, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { color: colors.brandLight, fontSize: 15 },
  error: {
    color: colors.due.text,
    backgroundColor: colors.due.bg,
    borderColor: colors.due.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
    fontWeight: '600',
  },
  help: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  demoTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  demoRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', flexWrap: 'wrap' },
  demoChip: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.brand,
    justifyContent: 'center',
  },
  demoChipText: { color: colors.brand, fontWeight: '700', fontSize: 14.5 },
});
