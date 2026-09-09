import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ConvexAuthProvider, useAuthActions } from '@convex-dev/auth/react';
import { ConvexReactClient } from 'convex/react';
import { LoadingScreen } from '../components/Recovery';
import { LoginView } from '../auth/LoginPage';
import { safeReturnTo } from '../auth/routes';

const url = import.meta.env.VITE_CONVEX_URL;
const client = url ? new ConvexReactClient(url) : null;
export function Providers({ children }: { children: ReactNode }) {
  if (!client) return <LoginView />;
  return (
    <ConvexAuthProvider client={client} shouldHandleCode={false}>
      <OAuthCallback>{children}</OAuthCallback>
    </ConvexAuthProvider>
  );
}
// Handle code redemption explicitly so a rejected callback has a recoverable UI.
// Session storage and refresh remain entirely owned by Convex Auth.
function OAuthCallback({ children }: { children: ReactNode }) {
  const { signIn } = useAuthActions();
  const [code] = useState(() =>
    new URLSearchParams(window.location.search).get('code'),
  );
  const [status, setStatus] = useState<'pending' | 'done' | 'error'>(
    code ? 'pending' : 'done',
  );
  const started = useRef(false);
  useEffect(() => {
    if (!code || started.current) return;
    started.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    window.history.replaceState(null, '', url.pathname + url.search);
    void signIn('google', { code })
      .then((result) => setStatus(result.signingIn ? 'done' : 'error'))
      .catch(() => setStatus('error'));
  }, [code, signIn]);
  if (status === 'pending') return <LoadingScreen label="Finishing sign-in…" />;
  if (status === 'error')
    return (
      <LoginView
        error="Sign-in didn’t finish. Please try again."
        buttonLabel="Try sign-in again"
        onSignIn={() => {
          const to = safeReturnTo(
            new URLSearchParams(window.location.search).get('returnTo'),
          );
          window.location.assign(`/login?returnTo=${encodeURIComponent(to)}`);
        }}
      />
    );
  return children;
}
