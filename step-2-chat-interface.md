# Step 2: Agent + assistant-ui proof of concept

## Goal

Show how to connect Convex Agent to assistant-ui with a small, readable integration. Agent owns conversations, messages, and stream persistence. The application has no chat request table, queue, scheduler, polling loop, or custom request lifecycle.

## The integration

```text
assistant-ui composer
  → chat.send mutation: create thread if needed and save user message
  → chat.generate action: ask Agent to stream a response to that message
  → Agent stores messages and stream deltas
  → chat.listMessages query → useUIMessages({ stream: true })
  → useExternalStoreRuntime → assistant-ui thread
```

The key wiring lives in `src/pages/ChatPage.tsx`:

```tsx
const { results } = useUIMessages(
  api.chat.listMessages,
  { threadId },
  { initialNumItems: 30, stream: true },
);

const runtime = useExternalStoreRuntime({
  messages: results,
  convertMessage: toChatMessage,
  onNew: async (message) => {
    const prompt = message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    const saved = await send({ threadId, prompt });
    await generate(saved);
  },
});

return (
  <AssistantRuntimeProvider runtime={runtime}>
    <ChatThread />
  </AssistantRuntimeProvider>
);
```

This excerpt highlights the connection. The actual page also handles initial thread creation, loading, draft text, and errors. `src/chat/messageAdapter.ts` maps Agent messages to assistant-ui's format, preserving stable IDs and showing text while excluding reasoning parts.

## Backend

All chat endpoints live in `convex/chat.ts`:

| Endpoint       | Purpose                                                                          |
| -------------- | -------------------------------------------------------------------------------- |
| `listThreads`  | Paginate the signed-in user's Agent threads                                      |
| `getThread`    | Read the authorized conversation title                                           |
| `listMessages` | Combine `listUIMessages` and `syncStreams` after checking ownership              |
| `send`         | Create an Agent thread if needed, save the prompt, and return thread/message IDs |
| `generate`     | Verify ownership and the prompt's thread, then call `musicAgent.streamText`      |
| `stop`         | Abort currently active Agent streams for the authorized thread                   |

Saving and generating are separate so a failed model call does not lose the user's message. Generation runs directly from a frontend `useAction` call. A retry calls `generate` again with the saved user message ID; it does not resubmit the prompt.

`convex/schema.ts` contains only the authentication tables. The Agent component is registered in `convex/convex.config.ts`. There is no `chatGeneration.ts`, `chatRequests` table definition, request ID, attempt counter, scheduled function ID, or watchdog.

## Model

Use **GPT-5.6 Sol with medium reasoning**, through the Convex AI Gateway. Model setup and music instructions live in `convex/lib/musicAgent.ts`.

As checked September 9, 2026, [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) is newer and calls its lightest reasoning setting `low`. [Convex's published gateway catalog](https://docs.convex.dev/ai-gateway/models) lists Sol but not Astra, so this integration uses the user's suggested Sol medium option. Gateway authentication stays in backend actions; the frontend needs no model API key.

Use up to 8,192 output tokens including reasoning and a two-minute abort timeout. The system prompt asks for concise visible replies. Agent uses recent conversation context, with no cross-conversation retrieval. Web research, saving preferences, and live show lookup remain future steps.

## User experience

Retain the existing responsive chat interface: welcome prompts, multiline composer, Markdown replies, copy, scroll-to-latest, paginated history, and in-memory per-conversation drafts. Routes are `/chat` for a new conversation and `/chat/:threadId` for saved history.

The first send saves the conversation immediately and subscribes to it locally. Once the first generation succeeds, the page changes to its saved URL. If generation fails, the saved conversation is still accessible in history, and the current page offers retry. Reloading an unanswered conversation also permits retry from its last saved prompt.

Pending and error state live in React; active streaming is derived from Agent messages. Stop becomes available once Agent publishes an active stream. A stopped or failed reply can be retried. A lost network connection shows a reconnecting notice.

## Intentional proof-of-concept tradeoffs

- No server-side deduplication or per-thread execution lock. Multiple tabs can submit overlapping turns.
- No durable queue between saving a message and starting generation. If the browser closes between those operations, the saved prompt can be retried later.
- Loading an unanswered conversation can offer retry before another tab has begun streaming; this is not a cross-tab coordination mechanism.
- Error details and pending state are local to the page. Agent retains messages and stream status; React does not maintain a second persistent state machine.
- Stop aborts active streams, not queued or pre-stream work. The action timeout bounds generation.
- There is no automatic retry of uncertain failures. Users choose whether to retry.
- Removing the application schema definition does not itself purge legacy development request records; these records are no longer used by the app. Agent transcripts are unchanged.

These limits are acceptable for demonstrating the integration. Add coordination only when usage requires it.

## Verification

Automated checks cover authentication and ownership of history, stream queries, sends, generation and cancellation; saved prompts and replies; contextual follow-up storage; retry without another user message; malformed input; message conversion; redirect validation; and Sol medium gateway serialization.

Run `pnpm test`, `pnpm lint`, `pnpm format:check`, and `pnpm build`. For the real smoke test, sign in, send a prompt, watch it stream, send a follow-up, reload the saved conversation, and test failure/retry and Stop.

The simplified backend was synced to development and all 11 automated tests passed, along with lint, type checking, and the production build. Live browser verification of this revision remains incomplete: the in-app browser reported a refused localhost connection despite the preview server running. Test-model replies are used only in automated tests; the application has no mock fallback.
