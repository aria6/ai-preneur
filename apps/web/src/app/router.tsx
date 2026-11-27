import { PERMISSIONS } from '@ai-preneur/shared';
import { createBrowserRouter, Navigate } from 'react-router';

import {
  HomeRedirect,
  RedirectIfAuthenticated,
  RequireAuth,
  RequirePermission,
} from '../components/auth/guards';
import { AppLayout } from '../components/layout/AppLayout';
import { BankIdeaCreatePage } from '../pages/bank-idea/BankIdeaCreatePage';
import { BankIdeaDetailPage } from '../pages/bank-idea/BankIdeaDetailPage';
import { BankIdeaListPage } from '../pages/bank-idea/BankIdeaListPage';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { ProfilePage } from '../pages/ProfilePage';
import { RolesPage } from '../pages/roles/RolesPage';
import { AudienceInsightPage } from '../pages/social/analysis/AudienceInsightPage';
import { DataCollectionDetailPage } from '../pages/social/analysis/DataCollectionDetailPage';
import { DataCollectionListPage } from '../pages/social/analysis/DataCollectionListPage';
import { BatchDetailPage } from '../pages/social/BatchDetailPage';
import { PerformanceDetailPage } from '../pages/social/performance/PerformanceDetailPage';
import { PerformanceListPage } from '../pages/social/performance/PerformanceListPage';
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
        path: 'bank-idea',
        element: (
          <RequirePermission permission={PERMISSIONS.BANK_IDEA_VIEW}>
            <BankIdeaListPage />
          </RequirePermission>
        ),
      },
      {
        path: 'bank-idea/baru',
        element: (
          <RequirePermission permission={PERMISSIONS.BANK_IDEA_MANAGE}>
            <BankIdeaCreatePage />
          </RequirePermission>
        ),
      },
      {
        path: 'bank-idea/:id',
        element: (
          <RequirePermission permission={PERMISSIONS.BANK_IDEA_VIEW}>
            <BankIdeaDetailPage />
          </RequirePermission>
        ),
      },
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
        path: 'social/performance',
        element: (
          <RequirePermission permission={PERMISSIONS.SOCIAL_PERFORMANCE_VIEW}>
            <PerformanceListPage />
          </RequirePermission>
        ),
      },
      {
        path: 'social/performance/:id',
        element: (
          <RequirePermission permission={PERMISSIONS.SOCIAL_PERFORMANCE_VIEW}>
            <PerformanceDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: 'social/analysis',
        element: <Navigate to="/social/analysis/collection" replace />,
      },
      {
        path: 'social/analysis/collection',
        element: (
          <RequirePermission permission={PERMISSIONS.SOCIAL_ANALYSIS_VIEW}>
            <DataCollectionListPage />
          </RequirePermission>
        ),
      },
      {
        path: 'social/analysis/collection/:id',
        element: (
          <RequirePermission permission={PERMISSIONS.SOCIAL_ANALYSIS_VIEW}>
            <DataCollectionDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: 'social/analysis/insight',
        element: (
          <RequirePermission permission={PERMISSIONS.SOCIAL_ANALYSIS_VIEW}>
            <AudienceInsightPage />
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
