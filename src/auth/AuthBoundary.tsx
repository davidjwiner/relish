import { useConvexAuth, useQuery } from 'convex/react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { api } from '../../convex/_generated/api';
import { LoadingScreen } from '../components/Recovery';
import { AppShell } from '../components/AppShell';
import { loginPath } from './routes';
export function AuthBoundary() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const location = useLocation();
  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated)
    return <Navigate to={loginPath(location.pathname)} replace />;
  return <AuthenticatedShell />;
}
function AuthenticatedShell() {
  const user = useQuery(api.users.current);
  if (user === undefined) return <LoadingScreen label="Opening your space…" />;
  return (
    <AppShell name={user.name}>
      <Outlet />
    </AppShell>
  );
}
