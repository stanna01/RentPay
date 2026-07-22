import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [landlord, setLandlord] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/auth/me')
      .then((data) => setLandlord(data))
      .catch(() => setLandlord(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    setLandlord(data);
    return data;
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setLandlord(null);
  };

  return (
    <AuthContext.Provider value={{ landlord, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
