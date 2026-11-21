import type { AuthUser, LoginRequest, Permission } from '@ai-preneur/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { onUnauthorized } from '../../services/api-client';
import * as authService from '../../services/auth.service';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';

/**
 * Holds the current user. The session itself lives in an HttpOnly cookie the
 * frontend cannot read; on load we ask the API who we are (`GET /auth/me`).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUserState] = useState<AuthUser | null>(null);

  const setUser = useCallback((next: AuthUser) => {
    setUserState(next);
    setStatus('authenticated');
  }, []);

  const clear = useCallback(() => {
    setUserState(null);
    setStatus('unauthenticated');
  }, []);

  useEffect(() => {
    onUnauthorized(clear);
    return () => onUnauthorized(undefined);
  }, [clear]);

  useEffect(() => {
    const controller = new AbortController();
    authService
      .fetchCurrentUser(controller.signal)
      .then(setUser)
      .catch(() => {
        if (!controller.signal.aborted) clear();
      });
    return () => controller.abort();
  }, [setUser, clear]);

  const login = useCallback(
    async (input: LoginRequest) => {
      const loggedIn = await authService.login(input);
      setUser(loggedIn);
      return loggedIn;
    },
    [setUser],
  );

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      clear();
    }
  }, [clear]);

  const can = useCallback(
    (permission: Permission) => user?.permissions.includes(permission) ?? false,
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout, setUser, can }),
    [status, user, login, logout, setUser, can],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
