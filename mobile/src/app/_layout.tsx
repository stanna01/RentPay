import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { colors } from '@/theme';

// React Native has no "window focus": refetch stale data when the app returns
// to the foreground instead.
function useRefetchOnForeground() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
    return () => sub.remove();
  }, []);
}

/**
 * Each part of the app only exists while its guard is true. Signing out (or
 * switching account) removes the previous person's screens entirely, and a
 * student can never open sponsor or landlord screens, even by a link. (The
 * server enforces the same rules on every request.)
 */
function RootNavigator() {
  const { status, me } = useAuth();
  const role = me?.role;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerTintColor: colors.brand,
        headerTitleStyle: { color: colors.ink, fontWeight: '700' },
        contentStyle: { backgroundColor: colors.surface },
      }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'STUDENT'}>
        <Stack.Screen name="student" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'SPONSOR'}>
        <Stack.Screen name="sponsor" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'LANDLORD'}>
        <Stack.Screen name="landlord" />
      </Stack.Protected>
      <Stack.Protected guard={role === 'STUDENT' || role === 'SPONSOR'}>
        <Stack.Screen name="pay" options={{ presentation: 'modal', headerShown: true, title: 'Pay' }} />
      </Stack.Protected>
      <Stack.Protected guard={!!me}>
        <Stack.Screen name="payment/[id]" options={{ headerShown: true, title: 'Payment' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } })
  );
  useRefetchOnForeground();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
}
