// Keeps the sign-in tokens in the phone's secure storage (Keychain on iPhone,
// Keystore-backed storage on Android) — never in plain AsyncStorage.
// Secure storage doesn't exist on the web, so a web preview keeps them in
// memory only (signed out on reload).

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { AuthTokens } from '@/api';

const KEY = 'rentreceipt.session';
const isWeb = Platform.OS === 'web';
let memory: string | null = null;

export async function loadTokens(): Promise<AuthTokens | null> {
  try {
    const raw = isWeb ? memory : await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as AuthTokens) : null;
  } catch {
    return null;
  }
}

export async function saveTokens(tokens: AuthTokens): Promise<void> {
  const raw = JSON.stringify(tokens);
  if (isWeb) memory = raw;
  else await SecureStore.setItemAsync(KEY, raw);
}

export async function clearTokens(): Promise<void> {
  if (isWeb) memory = null;
  else await SecureStore.deleteItemAsync(KEY).catch(() => {});
}
