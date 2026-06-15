import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { fetchMe, logout as logoutApi, login as loginApi, register as registerApi, User } from '../services/auth';
import { loadToken, clearToken } from '../services/storage';
import { setAuthToken } from '../services/api';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string; password: string; user_type: 'consumer' | 'investor';
    home_city?: string; search_radius_km?: number;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    try {
      const token = await loadToken();
      if (token) {
        setAuthToken(token);
        const me = await fetchMe();
        setUser(me);
      }
    } catch {
      // Token zły / wygasł → clear
      await clearToken();
      setAuthToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const login = useCallback(async (email: string, password: string) => {
    const u = await loginApi(email, password);
    setUser(u);
  }, []);

  const register = useCallback(async (input: Parameters<AuthContextValue['register']>[0]) => {
    const u = await registerApi(input);
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await logoutApi();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      setUser(me);
    } catch {
      // ignore
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
