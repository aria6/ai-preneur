import { Link } from 'react-router';

import { EmptyState } from '../components/ui/feedback';

export function NotFoundPage() {
  return (
    <EmptyState
      icon="search"
      title="Halaman tidak ditemukan"
      description="Alamat yang Anda buka tidak tersedia."
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
