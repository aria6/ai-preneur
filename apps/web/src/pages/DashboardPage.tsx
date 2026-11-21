import { EmptyState, PageHeader } from '../components/ui/feedback';
import { useAuth } from '../hooks/use-auth';

export function DashboardPage() {
  const { user } = useAuth();

  return (
    <>
      <PageHeader title="Dashboard" description={user ? `Selamat datang, ${user.name}.` : undefined} />
      <EmptyState
        icon="dashboard"
        title="Dashboard masih kosong"
        description="Ringkasan dan widget akan muncul di sini setelah fitur-fitur bisnis ditambahkan."
      />
    </>
  );
}
