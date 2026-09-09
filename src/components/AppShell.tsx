import { useState, type ReactNode } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { useAction } from 'convex/react';
import { NavLink, useLocation } from 'react-router-dom';
import { LogOut, Menu, X, MessageCircle, Disc3, Radar } from 'lucide-react';
import { api } from '../../convex/_generated/api';
import { ConversationList } from '../chat/ConversationList';
import { Brand } from './Brand';
import { SlowOperation } from './Recovery';

const links = [
  { to: '/chat', label: 'Chat', icon: MessageCircle },
  { to: '/taste-profile', label: 'Taste Profile', icon: Disc3 },
  { to: '/radar', label: 'Radar', icon: Radar },
];

export function AppShell({
  name,
  children,
}: {
  name?: string;
  children: ReactNode;
}) {
  const isChat = useLocation().pathname.startsWith('/chat');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const { signOut } = useAuthActions();
  const revokeSession = useAction(api.auth.signOut);
  async function logout() {
    setPending(true);
    setError('');
    try {
      // Convex Auth's client suppresses network errors. Confirm server revocation
      // first, then let the library clear its own stored session and token state.
      await revokeSession({});
      await signOut();
    } catch {
      setError('Couldn’t sign out. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div
      className={
        isChat
          ? 'flex h-dvh flex-col overflow-hidden md:flex-row'
          : 'min-h-dvh md:flex'
      }
    >
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3"
        href="#main"
      >
        Skip to content
      </a>
      <aside className="z-20 shrink-0 border-b border-line bg-white md:fixed md:inset-y-0 md:w-64 md:border-r md:border-b-0">
        <div className="flex items-center justify-between p-6 md:px-7 md:py-9">
          <Brand />
          <button
            className="rounded-lg p-2 md:hidden"
            aria-label={open ? 'Close navigation' : 'Open navigation'}
            aria-expanded={open}
            aria-controls="app-navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
        <div
          id="app-navigation"
          className={`${open ? 'flex' : 'hidden'} max-h-[calc(100dvh-100px)] flex-col overflow-y-auto px-4 pb-5 md:flex md:h-[calc(100dvh-108px)]`}
        >
          <nav aria-label="Main navigation" className="space-y-2">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-4 py-3.5 font-medium transition ${isActive ? 'bg-ink text-white' : 'text-muted hover:bg-paper hover:text-ink'}`
                }
              >
                <Icon size={20} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
          {isChat && <ConversationList onSelect={() => setOpen(false)} />}
          <div className="mt-8 shrink-0 border-t border-line px-3 pt-5 md:mt-auto">
            <p className="truncate font-semibold">{name || 'Your space'}</p>
            <button
              disabled={pending}
              onClick={() => void logout()}
              className="mt-4 flex items-center gap-2 rounded-lg py-2 text-sm font-medium text-muted hover:text-ink disabled:opacity-50"
            >
              <LogOut size={17} aria-hidden="true" />
              {pending ? 'Signing out…' : 'Log out'}
            </button>
            {pending && <SlowOperation />}
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>
        </div>
      </aside>
      <main
        id="main"
        tabIndex={-1}
        className={
          isChat
            ? 'min-h-0 min-w-0 flex-1 md:ml-64'
            : 'min-w-0 flex-1 px-6 py-9 sm:px-10 md:ml-64 lg:px-16 lg:py-12'
        }
      >
        {children}
      </main>
    </div>
  );
}
