import { usePaginatedQuery } from 'convex/react';
import { Link, NavLink } from 'react-router-dom';
import { Plus, MessageCircle } from 'lucide-react';
import { api } from '../../convex/_generated/api';

export function ConversationList({ onSelect }: { onSelect: () => void }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.chat.listThreads,
    {},
    { initialNumItems: 20 },
  );
  return (
    <section
      className="mt-7 flex min-h-0 flex-1 flex-col"
      aria-label="Conversations"
    >
      <Link
        to="/chat"
        onClick={onSelect}
        className="flex shrink-0 items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 py-3 text-sm font-semibold hover:bg-paper"
      >
        <Plus size={17} />
        New chat
      </Link>
      <h2 className="px-3 pt-6 pb-3 text-xs font-semibold tracking-widest text-muted uppercase">
        Conversations
      </h2>
      <div className="min-h-0 overflow-y-auto pb-3">
        {status === 'LoadingFirstPage' && (
          <p role="status" className="px-3 text-sm text-muted">
            Loading conversations…
          </p>
        )}
        {status !== 'LoadingFirstPage' && results.length === 0 && (
          <p className="px-3 text-sm leading-relaxed text-muted">
            A good conversation starts with a song.
          </p>
        )}
        {results.map((thread) => (
          <NavLink
            key={thread._id}
            to={`/chat/${thread._id}`}
            onClick={onSelect}
            className={({ isActive }) =>
              `my-1 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${isActive ? 'bg-paper font-semibold text-ink' : 'text-muted hover:bg-paper'}`
            }
          >
            <MessageCircle size={15} className="shrink-0" />
            <span className="truncate">{thread.title || 'Conversation'}</span>
          </NavLink>
        ))}
        {(status === 'CanLoadMore' || status === 'LoadingMore') && (
          <button
            onClick={() => loadMore(20)}
            disabled={status === 'LoadingMore'}
            className="px-3 py-2 text-sm text-muted underline underline-offset-4"
          >
            {status === 'LoadingMore' ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </section>
  );
}
