import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useAction,
  useMutation,
  useQuery,
  useConvexConnectionState,
} from 'convex/react';
import {
  useUIMessages,
  optimisticallySendMessage,
} from '@convex-dev/agent/react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { ConvexError } from 'convex/values';
import { api } from '../../convex/_generated/api';
import { ChatThread } from '../chat/Thread';
import { useChatDrafts } from '../chat/ChatDrafts';
import { toChatMessage } from '../chat/messageAdapter';
import { SlowOperation } from '../components/Recovery';

export function ChatPage() {
  const { threadId } = useParams();
  return <Conversation key={threadId ?? 'new'} initialThreadId={threadId} />;
}
function Conversation({ initialThreadId }: { initialThreadId?: string }) {
  const navigate = useNavigate();
  const drafts = useChatDrafts();
  const [threadId, setThreadId] = useState(initialThreadId);
  const draftKey = initialThreadId ?? 'new';
  const thread = useQuery(api.chat.getThread, threadId ? { threadId } : 'skip');
  const { results, status, loadMore } = useUIMessages(
    api.chat.listMessages,
    threadId && thread ? { threadId } : 'skip',
    { initialNumItems: 30, stream: true },
  );
  const background = useQuery(
    api.preferenceWorkflows.statuses,
    threadId && thread
      ? {
          threadId,
          promptMessageIds: results
            .filter((m) => m.role === 'user' && m.status === 'success')
            .slice(-100)
            .map((m) => m.id),
        }
      : 'skip',
  );
  const backgroundPending = background?.some(
    (item) => item.status === 'inProgress',
  );
  const backgroundFailed = background?.some(
    (item) => item.status === 'failed' || item.status === 'canceled',
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
  const generate = useAction(api.chat.generate);
  const stop = useMutation(api.chat.stop);
  const { isWebSocketConnected: connected } = useConvexConnectionState();
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [draftLength, setDraftLength] = useState(
    () => (drafts.get(draftKey) ?? '').length,
  );
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const streaming = results.some((m) => m.status === 'streaming');
  const running = pending || streaming;
  const loading =
    !!threadId &&
    (thread === undefined ||
      (thread !== null && status === 'LoadingFirstPage'));
  const last = results.at(-1);
  const lastUser = results.filter((m) => m.role === 'user').at(-1);
  // Retry uses the Agent message ID; there is no separate request record.
  const retryPrompt =
    last && (last.role === 'user' || last.status === 'failed' || error)
      ? lastUser?.id
      : undefined;
  async function generateReply(
    promptMessageId: string,
    targetThreadId = threadId,
  ) {
    if (!targetThreadId) return;
    setPending(true);
    setError('');
    try {
      await generate({ threadId: targetThreadId, promptMessageId });
      if (mounted.current && !initialThreadId)
        navigate(`/chat/${targetThreadId}`, { replace: true });
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof ConvexError && cause.data === 'GATEWAY_UNAVAILABLE'
            ? 'Relish’s AI service isn’t available yet. Please try again later.'
            : 'Your message is saved, but the reply didn’t finish. You can retry.',
        );
    } finally {
      if (mounted.current) {
        setPending(false);
        setStopping(false);
      }
    }
  }

  // The core integration: live Agent messages in, assistant-ui send/cancel out.
  const runtime = useExternalStoreRuntime({
    messages: results,
    convertMessage: toChatMessage,
    isRunning: running,
    isLoading: loading,
    isDisabled: saving || (!!threadId && thread === null),
    isSendDisabled: !connected || loading || draftLength > 8000 || running,
    onNew: async (message) => {
      const prompt = message.content
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
        .trim();
      if (busy.current || !prompt || prompt.length > 8000) return;
      busy.current = true;
      setSaving(true);
      setPending(true);
      setError('');
      let saved: { threadId: string; promptMessageId: string };
      try {
        saved = await send({ threadId, prompt });
      } catch {
        if (mounted.current) {
          setError(
            'Couldn’t save your message. Check your connection and send again.',
          );
          runtime.thread.composer.setText(prompt);
          setPending(false);
          setSaving(false);
        }
        busy.current = false;
        return;
      }
      if (mounted.current) {
        setThreadId(saved.threadId);
        setSaving(false);
      }
      await generateReply(saved.promptMessageId, saved.threadId);
      busy.current = false;
    },
    onCancel: async () => {
      if (!threadId) return;
      setStopping(true);
      try {
        await stop({ threadId });
      } catch {
        setError('Couldn’t stop the response. Please try again.');
      } finally {
        setStopping(false);
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
        {(backgroundPending || backgroundFailed) && (
          <p
            role="status"
            className="border-b border-line px-5 py-3 text-sm text-muted sm:px-8"
          >
            {backgroundPending
              ? 'Research is in progress. It continues if you leave this chat or stop the response.'
              : 'A research request did not finish. Check its reply below; you can ask to list saved preferences before trying again.'}
          </p>
        )}
        {loading && (
          <div className="px-5">
            <SlowOperation />
          </div>
        )}
        <ChatThread
          running={running}
          canStop={streaming && !stopping}
          stopping={stopping}
          submitting={saving}
          loading={loading}
          error={error}
          connected={connected}
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
            !running && retryPrompt
              ? () => void generateReply(retryPrompt)
              : undefined
          }
        />
      </div>
    </AssistantRuntimeProvider>
  );
}
