import Google from '@auth/core/providers/google';
import { convexAuth } from '@convex-dev/auth/server';

function siteUrl() {
  const url = process.env.SITE_URL ?? process.env.CONVEX_SITE_URL;
  if (!url) throw new Error('SITE_URL or CONVEX_SITE_URL must be set.');
  return url.replace(/\/$/, '');
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
  callbacks: {
    async redirect({ redirectTo }) {
      const baseUrl = siteUrl();
      if (redirectTo.startsWith('?') || redirectTo.startsWith('/')) {
        return `${baseUrl}${redirectTo}`;
      }
      const destination = new URL(redirectTo);
      if (destination.origin === new URL(baseUrl).origin) return redirectTo;
      throw new Error(`Invalid redirect destination: ${destination.origin}`);
    },
  },
});
