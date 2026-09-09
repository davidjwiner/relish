import { useEffect, useRef, useState } from 'react';
import { useMutation, usePaginatedQuery } from 'convex/react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Plus, MessageCircle, Trash2, LoaderCircle } from 'lucide-react';
import { api } from '../../convex/_generated/api';
import { useChatDrafts } from './ChatDrafts';

export function ConversationList({ onSelect }: { onSelect: () => void }) {
  const deleteThread = useMutation(api.chat.deleteThread);
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = useRef(location.pathname);
  useEffect(() => {
    currentPath.current = location.pathname;
  }, [location.pathname]);
  const drafts = useChatDrafts();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  async function remove(threadId: string, title: string) {
    if (
      deleting ||
      !window.confirm(
        `Delete “${title}”? This will permanently delete its messages.`,
      )
    )
      return;
    setDeleting(threadId);
    setError('');
    try {
      await deleteThread({ threadId });
      drafts.delete(threadId);
      if (currentPath.current === `/chat/${threadId}`) {
        navigate('/chat', { replace: true });
        onSelect();
      }
    } catch {
      setError('Couldn’t delete the conversation. Please try again.');
    } finally {
      setDeleting(null);
    }
  }
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
        {error && (
          <p role="alert" className="px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
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
          <div key={thread._id} className="my-1 flex items-center gap-1">
            <NavLink
              to={`/chat/${thread._id}`}
              onClick={onSelect}
              className={({ isActive }) =>
                `flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${isActive ? 'bg-paper font-semibold text-ink' : 'text-muted hover:bg-paper'}`
              }
            >
              <MessageCircle size={15} className="shrink-0" />
              <span className="truncate">{thread.title || 'Conversation'}</span>
            </NavLink>
            <button
              type="button"
              aria-label={`Delete ${thread.title || 'Conversation'}`}
              title="Delete conversation"
              disabled={deleting !== null}
              onClick={() =>
                void remove(thread._id, thread.title || 'Conversation')
              }
              className="shrink-0 rounded-lg p-2.5 text-muted hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
            >
              {deleting === thread._id ? (
                <LoaderCircle
                  size={16}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Trash2 size={16} aria-hidden="true" />
              )}
            </button>
          </div>
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
