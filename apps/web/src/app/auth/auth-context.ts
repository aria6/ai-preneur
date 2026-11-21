import type { AuthUser, LoginRequest, Permission } from '@ai-preneur/shared';
import { createContext } from 'react';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login(input: LoginRequest): Promise<AuthUser>;
  logout(): Promise<void>;
  /** Replace the cached user, e.g. after a profile update. */
  setUser(user: AuthUser): void;
  /** UI convenience only — the API enforces every permission on its own. */
  can(permission: Permission): boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
