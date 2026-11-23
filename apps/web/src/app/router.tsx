import { PERMISSIONS } from '@ai-preneur/shared';
import { createBrowserRouter } from 'react-router';

import {
  HomeRedirect,
  RedirectIfAuthenticated,
  RequireAuth,
  RequirePermission,
} from '../components/auth/guards';
import { AppLayout } from '../components/layout/AppLayout';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { ProfilePage } from '../pages/ProfilePage';
import { RolesPage } from '../pages/roles/RolesPage';
import { BatchDetailPage } from '../pages/social/BatchDetailPage';
import { PublisherListPage } from '../pages/social/PublisherListPage';
import { SocialSettingsPage } from '../pages/social/SocialSettingsPage';
import { UsersPage } from '../pages/users/UsersPage';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <RedirectIfAuthenticated>
        <LoginPage />
      </RedirectIfAuthenticated>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      {
        path: 'dashboard',
        element: (
          <RequirePermission permission={PERMISSIONS.DASHBOARD_VIEW}>
            <DashboardPage />
          </RequirePermission>
        ),
      },
      { path: 'profile', element: <ProfilePage /> },
      {
        path: 'social/publisher',
        element: (
          <RequirePermission permission={PERMISSIONS.SOCIAL_PUBLISHER_VIEW}>
            <PublisherListPage />
          </RequirePermission>
        ),
      },
      {
        path: 'social/publisher/:id',
        element: (
          <RequirePermission permission={PERMISSIONS.SOCIAL_PUBLISHER_VIEW}>
            <BatchDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: 'social/settings',
        element: (
          <RequirePermission permission={PERMISSIONS.SOCIAL_SETTINGS_MANAGE}>
            <SocialSettingsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'users',
        element: (
          <RequirePermission permission={PERMISSIONS.USERS_VIEW}>
            <UsersPage />
          </RequirePermission>
        ),
      },
      {
        path: 'roles',
        element: (
          <RequirePermission permission={PERMISSIONS.ROLES_VIEW}>
            <RolesPage />
          </RequirePermission>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
