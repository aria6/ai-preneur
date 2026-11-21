import { useApiHealth } from '../hooks/use-api-health';

function ApiStatus() {
  const health = useApiHealth();

  if (health.status === 'loading') {
    return <span className="text-slate-500">checking…</span>;
  }
  if (health.status === 'error') {
    return <span className="text-red-600">unreachable — {health.message}</span>;
  }
  return (
    <span className={health.data.status === 'ok' ? 'text-emerald-600' : 'text-amber-600'}>
      {health.data.status} (database: {health.data.checks.database})
    </span>
  );
}

export function HomePage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Project foundation is running</h1>
      <p className="text-slate-600">
        This is a placeholder page. Product features have not been implemented yet.
      </p>
      <p className="text-sm">
        API status: <ApiStatus />
      </p>
    </section>
  );
}
