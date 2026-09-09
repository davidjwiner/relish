import { Link } from 'react-router-dom';
export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6">
      <p className="text-sm text-muted">404</p>
      <h1 className="text-3xl font-semibold">This page isn’t here.</h1>
      <Link to="/" className="rounded-xl bg-ink px-5 py-3 text-white">
        Back to Relish
      </Link>
    </main>
  );
}
