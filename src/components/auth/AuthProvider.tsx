'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AuthUser } from '@/app/soar/types';
import { LoginScreen } from './LoginScreen';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (opts?: { sessionOnly?: boolean }) => {
    const q = opts?.sessionOnly ? '?sessionOnly=1' : '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(`/api/auth/me${q}`, {
        credentials: 'include',
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else if (!opts?.sessionOnly) {
        const devRes = await fetch('/api/auth/me', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (devRes.ok) {
          setUser((await devRes.json()).user);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    let preferLogin = false;
    try {
      preferLogin = sessionStorage.getItem('soar:prefer_login') === '1';
    } catch {
      /* ignore */
    }
    const fallback = setTimeout(() => setLoading(false), 15_000);
    refresh(preferLogin ? { sessionOnly: true } : undefined).finally(() => {
      clearTimeout(fallback);
      setLoading(false);
    });
    return () => clearTimeout(fallback);
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    try {
      sessionStorage.setItem('soar:prefer_login', '1');
    } catch {
      /* ignore */
    }
  }, []);

  if (loading) {
    return (
      <div className="h-full min-h-screen flex items-center justify-center bg-background login-mesh">
        <div className="flex flex-col items-center gap-3 animate-fade-in">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-lg shadow-primary/20" />
          <p className="text-sm text-muted-foreground">Checking session…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onSuccess={async () => {
          try {
            sessionStorage.removeItem('soar:prefer_login');
          } catch {
            /* ignore */
          }
          await refresh();
        }}
      />
    );
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh }}>
      <div className="h-full min-h-0 flex flex-col">{children}</div>
    </AuthContext.Provider>
  );
}
