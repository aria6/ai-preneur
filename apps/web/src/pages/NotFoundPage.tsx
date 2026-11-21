import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <Link to="/" className="text-sm text-slate-600 underline underline-offset-4">
        Back to home
      </Link>
    </section>
  );
}
