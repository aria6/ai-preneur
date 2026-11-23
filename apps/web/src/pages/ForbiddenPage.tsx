import { Link } from 'react-router';

import { EmptyState } from '../components/ui/feedback';

export function ForbiddenPage() {
  return (
    <EmptyState
      icon="lock"
      title="Akses ditolak"
      description="Role Anda tidak memiliki hak akses ke halaman ini. Hubungi administrator jika Anda memerlukannya."
      action={
        <Link
          to="/"
          className="text-sm font-medium text-primary-700 underline underline-offset-4 hover:text-primary-800"
        >
          Kembali ke beranda
        </Link>
      }
    />
  );
}
