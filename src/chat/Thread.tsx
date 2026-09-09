import { useLayoutEffect, useRef, useState } from 'react';
import {
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  useAui,
  useAuiState,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Check,
  Copy,
  Disc3,
  Headphones,
  Sparkles,
  Square,
} from 'lucide-react';

const prompts = [
  {
    icon: Headphones,
    title: 'Find your next favorite',
    text: 'I love Stick Season by Noah Kahan. Who else should I listen to?',
  },
  {
    icon: AudioLines,
    title: 'Put your taste into words',
    text: 'Help me describe what I like about Nora En Pure’s sound.',
  },
  {
    icon: Disc3,
    title: 'Explore your taste',
    text: 'Ask me a few questions about my music taste.',
  },
];
function Welcome() {
  const aui = useAui();
  return (
    <section className="flex flex-1 flex-col items-center justify-center py-8 text-center sm:py-8">
      <div className="mb-5 flex size-14 items-center justify-center rounded-[22px] bg-accent">
        <AudioLines size={30} strokeWidth={1.6} aria-hidden="true" />
      </div>
      <h2 className="text-3xl leading-tight font-semibold tracking-tight sm:text-[34px]">
        What have you been listening to?
      </h2>
      <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
        Tell me about a song, an artist, or a sound you love.
      </p>
      <div className="mt-7 grid w-full gap-3 text-left sm:grid-cols-3">
        {prompts.map(({ icon: Icon, title, text }) => (
          <button
            key={title}
            onClick={() => {
              aui.composer().setText(text);
              document.getElementById('chat-input')?.focus();
            }}
            className="group text-left rounded-2xl border border-line bg-white p-4 transition hover:border-ink/30 hover:shadow-sm"
          >
            <Icon size={20} className="mb-4 text-muted" aria-hidden="true" />
            <span className="block text-sm font-semibold">{title}</span>
            <span className="mt-2 block text-xs leading-relaxed text-muted">
              {text}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
function CopyResponse() {
  const text = useAuiState((s) =>
    s.message.content
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n'),
  );
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        aria-label="Copy response"
        className="rounded-md p-2 text-muted hover:bg-white hover:text-ink"
        onClick={() => {
          void navigator.clipboard
            .writeText(text)
            .then(() => {
              setState('copied');
              setTimeout(() => setState('idle'), 2000);
            })
            .catch(() => setState('error'));
        }}
      >
        {state === 'copied' ? <Check size={15} /> : <Copy size={15} />}
      </button>
      <span role="status" className="text-xs text-muted">
        {state === 'copied'
          ? 'Copied'
          : state === 'error'
            ? 'Couldn’t copy. Select the text to copy it.'
            : ''}
      </span>
    </div>
  );
}
function UserMessage() {
  return (
    <MessagePrimitive.Root className="mb-7 flex justify-end">
      <div className="max-w-[90%] rounded-2xl rounded-br-sm bg-ink px-5 py-3.5 text-sm leading-relaxed whitespace-pre-wrap text-white sm:max-w-[80%]">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}
function MarkdownText() {
  return <MarkdownTextPrimitive />;
}
function AssistantMessage() {
  const hasText = useAuiState((s) =>
    s.message.content.some((p) => p.type === 'text' && p.text.length > 0),
  );
  const incomplete = useAuiState(
    (s) => s.message.status?.type === 'incomplete',
  );
  if (!hasText) return null;
  return (
    <MessagePrimitive.Root className="mb-8 flex min-w-0 gap-3 sm:gap-4">
      <div className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent">
        <AudioLines size={17} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="chat-markdown text-sm leading-7">
          <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
        </div>
        {incomplete && (
          <p className="mt-2 text-xs text-muted">Response interrupted</p>
        )}
        <CopyResponse />
      </div>
    </MessagePrimitive.Root>
  );
}
export function ChatThread({
  running,
  canStop,
  stopping,
  loading,
  error,
  submitting,
  onRetry,
  onLoadMore,
  loadingMore,
  connected,
  onDraftChange,
}: {
  running: boolean;
  canStop: boolean;
  stopping: boolean;
  loading: boolean;
  error: string;
  submitting: boolean;
  onRetry?: () => void;
  onLoadMore?: () => void;
  loadingMore: boolean;
  connected: boolean;
  onDraftChange: (text: string) => void;
}) {
  const text = useAuiState((s) => s.composer.text);
  const empty = useAuiState((s) => s.thread.messages.length === 0);
  const overLimit = text.length > 8000;
  const viewport = useRef<HTMLDivElement>(null);
  const anchor = useRef<{
    height: number;
    top: number;
    firstId?: string;
  } | null>(null);
  const firstId = useAuiState((s) => s.thread.messages[0]?.id);
  const hasStreamingText = useAuiState(
    (s) =>
      s.thread.messages.at(-1)?.role === 'assistant' &&
      s.thread.messages
        .at(-1)
        ?.content.some((p) => p.type === 'text' && p.text.length > 0),
  );
  useLayoutEffect(() => {
    if (
      viewport.current &&
      anchor.current &&
      firstId !== anchor.current.firstId
    ) {
      viewport.current.scrollTop =
        anchor.current.top +
        viewport.current.scrollHeight -
        anchor.current.height;
      anchor.current = null;
    }
  }, [firstId]);
  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
      <ThreadPrimitive.Viewport
        ref={viewport}
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-5 sm:px-8"
        autoScroll={!empty}
        scrollToBottomOnInitialize={!empty}
        scrollToBottomOnRunStart={false}
      >
        <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col pt-7">
          {loading ? (
            <p role="status" className="py-16 text-center text-sm text-muted">
              Loading conversation…
            </p>
          ) : empty ? (
            <Welcome />
          ) : (
            <>
              {onLoadMore && (
                <button
                  disabled={loadingMore}
                  onClick={() => {
                    if (viewport.current)
                      anchor.current = {
                        height: viewport.current.scrollHeight,
                        top: viewport.current.scrollTop,
                        firstId,
                      };
                    onLoadMore();
                  }}
                  className="mx-auto mb-7 rounded-full border border-line bg-white px-4 py-2 text-xs text-muted"
                >
                  {loadingMore ? 'Loading…' : 'Load older messages'}
                </button>
              )}
              <ThreadPrimitive.Messages
                components={{ UserMessage, AssistantMessage }}
              />
            </>
          )}
          {running && (!hasStreamingText || stopping) && (
            <p
              role="status"
              className="mb-5 flex items-center gap-2 text-xs text-muted"
            >
              <Sparkles size={14} />
              {submitting
                ? 'Sending…'
                : stopping
                  ? 'Stopping response…'
                  : 'Relish is thinking…'}
            </p>
          )}
        </div>
        <div className={`sticky bottom-3 mx-auto ${empty ? 'hidden' : ''}`}>
          <ThreadPrimitive.ScrollToBottom
            aria-label="Jump to latest"
            className="rounded-full border border-line bg-white p-2.5 shadow-sm disabled:hidden"
          >
            <ArrowDown size={17} />
          </ThreadPrimitive.ScrollToBottom>
        </div>
      </ThreadPrimitive.Viewport>
      <div className="shrink-0 px-5 pt-2 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-8 sm:pb-6">
        <div className="mx-auto max-w-[760px]">
          {!connected && (
            <p role="status" className="mb-3 text-sm text-muted">
              Reconnecting… Your saved messages are safe.
            </p>
          )}
          {(error || onRetry) && (
            <div
              role="alert"
              className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-sm"
            >
              <span>
                {error || 'This message has no completed reply. You can retry.'}
              </span>
              {onRetry && (
                <button
                  disabled={!connected}
                  onClick={onRetry}
                  className="font-semibold underline underline-offset-4"
                >
                  Retry response
                </button>
              )}
            </div>
          )}
          <ComposerPrimitive.Root className="rounded-2xl border border-line bg-white p-3 shadow-[0_4px_24px_#17213906] focus-within:border-ink/35">
            <ComposerPrimitive.Input
              id="chat-input"
              aria-label="Message Relish"
              placeholder="Message Relish…"
              className="block w-full resize-none border-0 bg-transparent px-2 pt-1 pb-3 text-sm leading-6 outline-none focus-visible:outline-none"
              minRows={2}
              maxRows={7}
              autoFocus
              cancelOnEscape={false}
              addAttachmentOnPaste={false}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (overLimit && event.key === 'Enter' && !event.shiftKey)
                  event.preventDefault();
              }}
            />
            <div className="flex items-center justify-between gap-2 pl-2">
              <span
                className={`text-[11px] ${overLimit ? 'text-red-700' : 'text-muted'}`}
                role={overLimit ? 'alert' : undefined}
              >
                {overLimit
                  ? 'Keep your message under 8,000 characters.'
                  : 'Enter to send · Shift + Enter for a new line'}
              </span>
              {running ? (
                <ComposerPrimitive.Cancel
                  disabled={!canStop || stopping || submitting || !connected}
                  aria-label="Stop response"
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink text-white disabled:opacity-40"
                >
                  <Square size={13} fill="currentColor" />
                </ComposerPrimitive.Cancel>
              ) : (
                <ComposerPrimitive.Send
                  disabled={overLimit || !connected || loading}
                  aria-label="Send message"
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-ink disabled:bg-paper disabled:text-muted/50"
                >
                  <ArrowUp size={19} />
                </ComposerPrimitive.Send>
              )}
            </div>
          </ComposerPrimitive.Root>
          <p className="mt-3 text-center text-[11px] text-muted">
            Good music is personal. Let’s find what resonates.
          </p>
        </div>
      </div>
    </ThreadPrimitive.Root>
  );
}
