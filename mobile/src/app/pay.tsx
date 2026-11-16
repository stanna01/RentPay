import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { api, ApiError, payableOf, type MobileNetwork, type StartPaymentInput } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { ShareRow } from '@/components/rows';
import { Button, Card, ErrorState, Field, Loading, Screen, SectionTitle, textStyles } from '@/components/ui';
import { formatK, normaliseZambianMsisdn, toNgwee } from '@/format';
import { colors, radius, spacing } from '@/theme';

type Method = StartPaymentInput['method'];

const METHODS: { id: Method; title: string; detail: string; icon: 'phone-portrait-outline' | 'card-outline' | 'business-outline' }[] = [
  { id: 'MOBILE_MONEY', title: 'Mobile money', detail: 'MTN, Airtel or Zamtel — approve with your PIN', icon: 'phone-portrait-outline' },
  { id: 'CARD', title: 'Bank card', detail: "Visa or Mastercard on the provider's secure page", icon: 'card-outline' },
  { id: 'BANK_TRANSFER', title: 'Bank transfer', detail: 'Pay at the bank, then upload the slip', icon: 'business-outline' },
];
const NETWORKS: MobileNetwork[] = ['MTN', 'AIRTEL', 'ZAMTEL'];
const MAX_SLIP_BYTES = 5 * 1024 * 1024;

/**
 * Pay for charge shares. Students arrive with ?shareIds=…, sponsors with
 * ?residentIds=… (everything their share still owes for those students).
 * The server works out and checks the amount — the app never decides it.
 */
export default function Pay() {
  const { me } = useAuth();
  const isSponsor = me?.role === 'SPONSOR';
  const params = useLocalSearchParams<{ shareIds?: string; residentIds?: string }>();
  const shareIds = useMemo(() => (params.shareIds ?? '').split(',').filter(Boolean), [params.shareIds]);
  const residentIds = useMemo(() => (params.residentIds ?? '').split(',').filter(Boolean), [params.residentIds]);

  const shares = useQuery({
    queryKey: isSponsor ? ['sponsor', 'due', residentIds] : ['student', 'charges'],
    queryFn: () => (isSponsor ? api.sponsorDueShares(residentIds) : api.myCharges()),
  });
  // Only what is still payable: money already on its way is never asked for twice.
  const chosen = useMemo(
    () => (shares.data ?? []).filter((s) => payableOf(s) > 0 && (isSponsor || shareIds.includes(s.id))),
    [shares.data, isSponsor, shareIds]
  );
  const total = chosen.reduce((sum, s) => sum + payableOf(s), 0);

  const [method, setMethod] = useState<Method>('MOBILE_MONEY');
  const [amountText, setAmountText] = useState('');
  const [network, setNetwork] = useState<MobileNetwork>('MTN');
  const [phone, setPhone] = useState('');
  const [reference, setReference] = useState('');
  const [slip, setSlip] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [problem, setProblem] = useState('');

  const transfer = useQuery({
    queryKey: ['transfer-details', chosen.map((s) => s.id)],
    queryFn: () => api.transferDetails(chosen.map((s) => s.id)),
    enabled: method === 'BANK_TRANSFER' && chosen.length > 0,
  });
  useEffect(() => {
    if (transfer.data && !reference) setReference(transfer.data.reference);
  }, [transfer.data, reference]);

  // One key per payment attempt: if the connection drops and the person taps
  // again, the server recognises the retry instead of charging twice.
  const attemptKey = useRef(Crypto.randomUUID());
  const start = useMutation({
    mutationFn: (input: StartPaymentInput) => api.startPayment(input, attemptKey.current),
    onSuccess: (payment) => router.replace(`/payment/${payment.id}`),
    onError: (e) => {
      // The server answered "no", so nothing was created: the next tap is a new attempt.
      // With no answer at all (status 0) the same key is kept for the retry.
      if (e instanceof ApiError && e.status > 0) attemptKey.current = Crypto.randomUUID();
    },
  });

  if (shares.isPending) return <Loading />;
  if (shares.isError) return <ErrorState message={shares.error.message} onRetry={shares.refetch} />;
  if (!chosen.length) {
    return <ErrorState message="Nothing here needs paying right now — it's either paid or a payment is already on its way." />;
  }

  const amount = !isSponsor && amountText.trim() ? toNgwee(amountText) : total;

  const pickSlip = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
    if (result.canceled) return;
    const file = result.assets[0];
    if (file.size && file.size > MAX_SLIP_BYTES) return setProblem('That file is larger than 5 MB. Please choose a smaller photo or PDF.');
    setProblem('');
    setSlip(file);
  };

  const submit = () => {
    setProblem('');
    if (amount === null || amount < 100) return setProblem('Please enter an amount of at least K 1.');
    if (amount > total) return setProblem(`You can pay at most ${formatK(total)} for these items.`);
    const input: StartPaymentInput = { shareIds: chosen.map((s) => s.id), method, amount: isSponsor ? undefined : amount };
    if (method === 'MOBILE_MONEY') {
      if (!normaliseZambianMsisdn(phone)) return setProblem('Please enter a Zambian mobile number, e.g. 097 123 4567.');
      Object.assign(input, { msisdn: phone, network });
    }
    if (method === 'BANK_TRANSFER') {
      if (!slip) return setProblem('Please attach a photo or PDF of your bank slip.');
      if (!reference.trim()) return setProblem('Please enter the reference you used on the transfer.');
      Object.assign(input, { transferReference: reference, proof: { uri: slip.uri, name: slip.name, mimeType: slip.mimeType } });
    }
    start.mutate(input);
  };

  return (
    <Screen
      footerSafeArea
      footer={
        <>
          {problem || start.error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {problem || start.error?.message}
            </Text>
          ) : null}
          <Button
            title={method === 'BANK_TRANSFER' ? `Send slip for ${formatK(amount ?? 0)}` : `Pay ${formatK(amount ?? 0)}`}
            loading={start.isPending}
            onPress={submit}
          />
          <Text style={styles.note}>Paid straight into the landlord&apos;s own account.</Text>
        </>
      }>
      <SectionTitle>Paying for</SectionTitle>
      {chosen.map((s) => (
        <ShareRow key={s.id} share={s} showStudent={isSponsor} />
      ))}
      <Card style={styles.total}>
        <Text style={textStyles.body}>To pay now</Text>
        <Text style={styles.totalValue}>{formatK(total)}</Text>
      </Card>

      {!isSponsor ? (
        <Field
          label="Amount to pay now (K)"
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          placeholder={String(total / 100)}
          hint="Leave empty to pay everything, or enter a smaller amount."
        />
      ) : null}

      <SectionTitle>How do you want to pay?</SectionTitle>
      {METHODS.map((m) => (
        <Pressable
          key={m.id}
          accessibilityRole="radio"
          accessibilityState={{ checked: method === m.id }}
          onPress={() => setMethod(m.id)}
          style={[styles.option, method === m.id && styles.optionOn]}>
          <Ionicons name={m.icon} size={24} color={method === m.id ? colors.brand : colors.muted} />
          <View style={{ flex: 1 }}>
            <Text style={styles.optionTitle}>{m.title}</Text>
            <Text style={textStyles.muted}>{m.detail}</Text>
          </View>
          <Ionicons name={method === m.id ? 'radio-button-on' : 'radio-button-off'} size={22} color={method === m.id ? colors.brand : colors.vacant.border} />
        </Pressable>
      ))}

      {method === 'MOBILE_MONEY' ? (
        <Card>
          <Text style={styles.fieldLabel}>Network</Text>
          <View style={styles.chips}>
            {NETWORKS.map((n) => (
              <Pressable
                key={n}
                accessibilityRole="radio"
                accessibilityState={{ checked: network === n }}
                onPress={() => setNetwork(n)}
                style={[styles.chip, network === n && styles.chipOn]}>
                <Text style={[styles.chipText, network === n && styles.chipTextOn]}>{n === 'AIRTEL' ? 'Airtel' : n === 'ZAMTEL' ? 'Zamtel' : 'MTN'}</Text>
              </Pressable>
            ))}
          </View>
          <Field
            label="Mobile money number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="097 123 4567"
            hint="You'll get a prompt on this phone to approve with your PIN."
          />
        </Card>
      ) : null}

      {method === 'CARD' ? (
        <Card>
          <Text style={textStyles.body}>
            The payment provider&apos;s secure page opens next. Your card number never touches this app or RentReceipt&apos;s
            servers.
          </Text>
        </Card>
      ) : null}

      {method === 'BANK_TRANSFER' ? (
        <Card>
          {transfer.isPending ? (
            <Loading />
          ) : transfer.data ? (
            <>
              <Text style={styles.fieldLabel}>Pay into</Text>
              <Text style={textStyles.body}>
                {transfer.data.accountName}
                {'\n'}
                {transfer.data.bankName} · {transfer.data.branch}
                {'\n'}
                Account {transfer.data.accountNumber}
              </Text>
            </>
          ) : (
            <Text style={styles.error}>Could not load the bank details. Pull down to try again.</Text>
          )}
          <Field label="Reference on your transfer" value={reference} onChangeText={setReference} autoCapitalize="characters" />
          <Button title={slip ? `Slip: ${slip.name}` : 'Attach bank slip (photo or PDF)'} variant="secondary" onPress={pickSlip} />
          <Text style={textStyles.muted}>The landlord checks the slip against their bank statement before the receipt is issued.</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalValue: { fontSize: 20, fontWeight: '700', color: colors.ink },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 64,
  },
  optionOn: { borderColor: colors.brand, backgroundColor: colors.brandLight },
  optionTitle: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: colors.ink },
  chips: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  chip: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brand },
  chipText: { fontWeight: '700', color: colors.ink },
  chipTextOn: { color: colors.white },
  error: { color: colors.due.text, fontWeight: '600', textAlign: 'center' },
  note: { fontSize: 12.5, color: colors.muted, textAlign: 'center' },
});
