import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);
const PROPERTY_KEY = 'rr.propertyId';

// localStorage can throw (private mode, blocked storage) — never let that break the app.
function readStoredProperty() {
  try {
    return Number(localStorage.getItem(PROPERTY_KEY)) || null;
  } catch {
    return null;
  }
}
function storeProperty(id) {
  try {
    localStorage.setItem(PROPERTY_KEY, String(id));
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(readStoredProperty);

  const refresh = useCallback(
    () =>
      api
        .get('/auth/me')
        .then((data) => setUser(data))
        .catch(() => setUser(null)),
    []
  );

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Server says the session ended or a new password is needed → re-check.
  useEffect(() => {
    const onExpired = () => setUser(null);
    const onPwd = () => setUser((u) => (u ? { ...u, mustChangePassword: true } : u));
    window.addEventListener('rr:session-expired', onExpired);
    window.addEventListener('rr:password-change-required', onPwd);
    return () => {
      window.removeEventListener('rr:session-expired', onExpired);
      window.removeEventListener('rr:password-change-required', onPwd);
    };
  }, []);

  const login = async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setUser(data);
    return data;
  };

  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
  };

  const logoutEverywhere = async () => {
    await api.post('/auth/logout-all');
    setUser(null);
  };

  // The property everything is currently showing (falls back to the first one).
  const properties = user?.properties || [];
  const property = properties.find((p) => p.id === selectedId) || properties[0] || null;
  const selectProperty = useCallback((id) => {
    setSelectedId(Number(id));
    storeProperty(id);
  }, []);

  const value = useMemo(
    () => ({
      user,
      setUser,
      loading,
      login,
      logout,
      logoutEverywhere,
      refresh,
      // The super admin runs the platform; a landlord owns one business.
      isSuperAdmin: user?.role === 'SUPER_ADMIN',
      isOwner: user?.role === 'LANDLORD',
      properties,
      property,
      propertyId: property?.id ?? null,
      selectProperty,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, loading, property, selectProperty, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
