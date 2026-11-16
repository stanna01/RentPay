import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, type Me, type Role } from '@/api';

import { clearTokens, loadTokens, saveTokens } from './token-store';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  me: Me | null;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Where each role lands after signing in. */
export function homeFor(role: Role) {
  if (role === 'STUDENT') return '/student' as const;
  if (role === 'SPONSOR') return '/sponsor' as const;
  return '/landlord' as const;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ status: Status; me: Me | null }>({ status: 'loading', me: null });

  // Restore a saved session when the app starts.
  useEffect(() => {
    api.onTokensChanged((tokens) => {
      if (tokens) {
        saveTokens(tokens);
      } else {
        clearTokens();
        setState({ status: 'signedOut', me: null });
      }
    });
    (async () => {
      const tokens = await loadTokens();
      if (!tokens) return setState({ status: 'signedOut', me: null });
      api.setSession(tokens);
      try {
        setState({ status: 'signedIn', me: await api.me() });
      } catch {
        await clearTokens();
        api.setSession(null);
        setState({ status: 'signedOut', me: null });
      }
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { tokens, me } = await api.signIn(email, password);
    await saveTokens(tokens);
    api.setSession(tokens);
    setState({ status: 'signedIn', me });
  }, []);

  const signOut = useCallback(async () => {
    await api.signOut().catch(() => {});
    await clearTokens();
    api.setSession(null);
    queryClient.clear(); // never show one person's data to the next
    setState({ status: 'signedOut', me: null });
  }, [queryClient]);

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
