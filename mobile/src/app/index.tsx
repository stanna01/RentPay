import { Redirect } from 'expo-router';

import { homeFor, useAuth } from '@/auth/AuthProvider';
import { Loading } from '@/components/ui';

/** Sends people to sign-in, or to their role's home screen. */
export default function Index() {
  const { status, me } = useAuth();
  if (status === 'loading') return <Loading />;
  if (!me) return <Redirect href="/sign-in" />;
  return <Redirect href={homeFor(me.role)} />;
}
