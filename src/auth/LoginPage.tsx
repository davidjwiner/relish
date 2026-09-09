import { useState } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth } from 'convex/react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { LoadingScreen, SlowOperation } from '../components/Recovery';
import { safeReturnTo } from './routes';

export function LoginPage() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [params] = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(
    params.has('error') ? 'Sign-in didn’t finish. Please try again.' : '',
  );
  const destination = safeReturnTo(params.get('returnTo'));
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to={destination} replace />;
  async function login() {
    setPending(true);
    setError('');
    try {
      await signIn('google', {
        redirectTo: `/login?returnTo=${encodeURIComponent(destination)}`,
      });
    } catch {
      setError(
        'We couldn’t start sign-in. Please check your connection and try again.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <LoginView pending={pending} error={error} onSignIn={() => void login()} />
  );
}

export function LoginView({
  pending = false,
  buttonLabel = 'Continue with Google',
  error,
  onSignIn,
}: {
  pending?: boolean;
  buttonLabel?: string;
  error?: string;
  onSignIn?: () => void;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <section aria-labelledby="sign-in-heading" className="w-full max-w-sm">
        <Brand />
        <h1
          id="sign-in-heading"
          className="mt-10 text-2xl font-semibold tracking-tight"
        >
          Sign in
        </h1>
        <button
          disabled={!onSignIn || pending}
          onClick={onSignIn}
          className="mt-6 w-full rounded-xl bg-ink px-5 py-4 font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? 'Opening Google…' : buttonLabel}
        </button>
        {pending && <SlowOperation />}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {!onSignIn && (
          <p
            role="status"
            className="mt-4 rounded-xl border border-line bg-white p-4 text-sm leading-relaxed text-muted"
          >
            Sign-in isn’t available yet. This installation still needs its
            backend connection configured.
          </p>
        )}
      </section>
    </main>
  );
}
