'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthResponse, PublicUser } from '@webcatt/shared';
import { ApiError, apiFetch } from '@/lib/api';

const TOKEN_STORAGE_KEY = 'wc_token';

export interface AuthContextValue {
  user: PublicUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<PublicUser>;
  register: (input: {
    email: string;
    password: string;
    confirmPassword: string;
    captchaId: string;
    captchaAnswer: string;
  }) => Promise<PublicUser>;
  /** Thay token sau khi đổi mật khẩu — token cũ đã bị máy chủ vô hiệu hóa. */
  replaceToken: (accessToken: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }
    setToken(stored);
    let active = true;
    apiFetch<PublicUser>('/auth/me', { token: stored })
      .then((me) => {
        if (active) setUser(me);
      })
      .catch((err: unknown) => {
        if (!active) return;
        // Only drop the session when the token is actually rejected —
        // a network hiccup (status 0) should not log the user out.
        if (err instanceof ApiError && err.status !== 0) {
          window.localStorage.removeItem(TOKEN_STORAGE_KEY);
          setToken(null);
        }
        setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const applyAuth = useCallback((response: AuthResponse): PublicUser => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, response.accessToken);
    setToken(response.accessToken);
    setUser(response.user);
    return response.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<PublicUser> => {
      const response = await apiFetch<AuthResponse>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      return applyAuth(response);
    },
    [applyAuth],
  );

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      confirmPassword: string;
      captchaId: string;
      captchaAnswer: string;
    }): Promise<PublicUser> => {
      const response = await apiFetch<AuthResponse>('/auth/register', {
        method: 'POST',
        body: input,
      });
      return applyAuth(response);
    },
    [applyAuth],
  );

  const replaceToken = useCallback((accessToken: string) => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
    setToken(accessToken);
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, login, register, replaceToken, logout }),
    [user, token, loading, login, register, replaceToken, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth phải được dùng bên trong <AuthProvider>.');
  }
  return context;
}
