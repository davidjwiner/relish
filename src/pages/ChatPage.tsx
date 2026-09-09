import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useConvexConnectionState } from 'convex/react';
import {
  useUIMessages,
  optimisticallySendMessage,
} from '@convex-dev/agent/react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { api } from '../../convex/_generated/api';
import { ChatThread } from '../chat/Thread';
import { useChatDrafts } from '../chat/ChatDrafts';
import { toChatMessage } from '../chat/messageAdapter';
import { SlowOperation } from '../components/Recovery';

export function ChatPage() {
  const { threadId } = useParams();
  return <Conversation key={threadId ?? 'new'} threadId={threadId} />;
}
function Conversation({ threadId }: { threadId?: string }) {
  const navigate = useNavigate();
  const drafts = useChatDrafts();
  const draftKey = threadId ?? 'new';
  const thread = useQuery(api.chat.getThread, threadId ? { threadId } : 'skip');
  const { results, status, loadMore } = useUIMessages(
    api.chat.listMessages,
    threadId && thread ? { threadId } : 'skip',
    { initialNumItems: 30, stream: true },
  );
  const send = useMutation(api.chat.send).withOptimisticUpdate(
    (store, args) => {
      if (args.threadId)
        optimisticallySendMessage(api.chat.listMessages)(store, {
          threadId: args.threadId,
          prompt: args.prompt,
        });
    },
  );
  const stop = useMutation(api.chat.stop);
  const retry = useMutation(api.chat.retry);
  const { isWebSocketConnected: connected } = useConvexConnectionState();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [draftLength, setDraftLength] = useState(
    () => (drafts.get(draftKey) ?? '').length,
  );
  const [newMessage, setNewMessage] = useState<ThreadMessageLike | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const sendIdentity = useRef<{ text: string; id: string } | null>(null);
  const retryIdentity = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const request = thread?.request;
  const running =
    pending ||
    ['queued', 'running', 'stopping'].includes(request?.status ?? '');
  const loading =
    !!threadId &&
    (thread === undefined ||
      (thread !== null && status === 'LoadingFirstPage'));
  const runtime = useExternalStoreRuntime({
    messages:
      newMessage && !threadId ? [newMessage] : results.map(toChatMessage),
    convertMessage: (message: ThreadMessageLike) => message,
    isRunning: running,
    isLoading: loading,
    isDisabled: pending || (!!threadId && thread === null),
    isSendDisabled: !connected || loading || draftLength > 8000 || running,
    onNew: async (message: AppendMessage) => {
      const prompt = message.content
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
        .trim();
      if (submitting.current) return;
      if (!prompt || prompt.length > 8000 || !connected || running) {
        runtime.thread.composer.setText(prompt);
        return;
      }
      submitting.current = true;
      setPending(true);
      setError('');
      if (sendIdentity.current?.text !== prompt)
        sendIdentity.current = { text: prompt, id: crypto.randomUUID() };
      if (!threadId)
        setNewMessage({
          id: sendIdentity.current.id,
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        });
      try {
        const result = await send({
          threadId,
          prompt,
          clientRequestId: sendIdentity.current.id,
        });
        drafts.delete(draftKey);
        sendIdentity.current = null;
        if (mounted.current) {
          if (!threadId)
            navigate(`/chat/${result.threadId}`, { replace: true });
          document.getElementById('chat-input')?.focus();
        }
      } catch {
        if (mounted.current) {
          setError(
            'Couldn’t send your message. Check your connection and send again.',
          );
          setNewMessage(null);
          runtime.thread.composer.setText(prompt);
          drafts.set(draftKey, prompt);
          setDraftLength(prompt.length);
        }
      } finally {
        submitting.current = false;
        if (mounted.current) setPending(false);
      }
    },
    onCancel: async () => {
      if (!threadId || pending) return;
      try {
        await stop({ threadId });
        setError('');
      } catch {
        setError('Couldn’t stop the response. Please try again.');
      }
    },
  });
  useEffect(() => {
    runtime.thread.composer.setText(drafts.get(draftKey) ?? '');
    return runtime.thread.composer.subscribe(() => {
      const text = runtime.thread.composer.getState().text;
      drafts.set(draftKey, text);
      setDraftLength(text.length);
    });
  }, [runtime, drafts, draftKey]);
  if (threadId && thread === null)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold">Conversation unavailable</h1>
        <p className="text-sm text-muted">
          This conversation may no longer exist or belong to this account.
        </p>
        <Link
          to="/chat"
          className="rounded-xl bg-ink px-5 py-3 text-sm text-white"
        >
          New chat
        </Link>
      </div>
    );
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-5 sm:px-8">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">
              {thread?.title || (threadId ? 'Conversation' : 'Chat')}
            </h1>
            <p className="mt-1 text-xs text-muted">
              Your music, in conversation
            </p>
          </div>
          <span className="hidden shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted sm:block">
            Relish
          </span>
        </header>
        {loading && (
          <div className="px-5">
            <SlowOperation />
          </div>
        )}
        <ChatThread
          running={running}
          stopping={request?.status === 'stopping'}
          submitting={pending}
          requestError={request?.errorCode}
          loading={loading}
          error={error}
          connected={connected}
          requestStatus={request?.status}
          loadingMore={status === 'LoadingMore'}
          onLoadMore={
            status === 'CanLoadMore' || status === 'LoadingMore'
              ? () => loadMore(30)
              : undefined
          }
          onDraftChange={(text) => {
            drafts.set(draftKey, text);
            setDraftLength(text.length);
          }}
          onRetry={
            request?.status === 'failed' && !pending
              ? () => {
                  if (submitting.current) return;
                  submitting.current = true;
                  setPending(true);
                  setError('');
                  retryIdentity.current ??= crypto.randomUUID();
                  void retry({
                    requestId: request._id,
                    clientRequestId: retryIdentity.current,
                  })
                    .then(() => {
                      retryIdentity.current = null;
                    })
                    .catch(() => {
                      setError(
                        'Couldn’t retry. Check your connection and try again.',
                      );
                    })
                    .finally(() => {
                      submitting.current = false;
                      if (mounted.current) setPending(false);
                    });
                }
              : undefined
          }
        />
      </div>
    </AssistantRuntimeProvider>
  );
}
