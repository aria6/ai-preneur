import type { Permission } from '@ai-preneur/shared';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useAuth } from '../../hooks/use-auth';
import { homePathFor, safeRedirectPath } from '../../lib/navigation';
import { ForbiddenPage } from '../../pages/ForbiddenPage';
import { FullPageSpinner } from '../ui/Spinner';

/**
 * Route guards. They only shape the UI — every API endpoint enforces the same
 * rules server-side, so bypassing them in the browser grants nothing.
 */

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}

export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { status, can } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') {
    const from = (location.state as { from?: unknown } | null)?.from;
    return <Navigate to={safeRedirectPath(from) ?? homePathFor(can)} replace />;
  }
  return children;
}

export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can } = useAuth();
  return can(permission) ? children : <ForbiddenPage />;
}

export function HomeRedirect() {
  const { can } = useAuth();
  return <Navigate to={homePathFor(can)} replace />;
}
