# Step 2: Chat interface and conversations

**Status: implemented; successful live model verification is blocked by development-team gateway access.**

## Goal

Replace the Chat placeholder with a working music conversation experience built with assistant-ui. A signed-in user can start a conversation, receive a streamed AI response, ask follow-up questions, and return to saved conversations after reloading.

This implements step 2 of [design.md](./design.md). Convex Agent owns conversation history; model calls go through the Convex AI Gateway. The existing authenticated shell, visual theme, Taste Profile placeholder, and Radar placeholder remain the foundation.

## Scope and product boundaries

Include text conversations, streamed Markdown replies, conversation history, new chat, copy response, stop generation, retry failed generation, loading states, and recoverable errors. Support desktop and mobile, direct conversation URLs, and multiple tabs.

Step 3 owns web research, Exa, preference tools, and Convex Workflow orchestration. In this step, Relish can discuss music using model knowledge and the current conversation, but cannot save preferences, look up a current radio tracklist, or verify upcoming shows. Its instructions must make those limits explicit when relevant. Conversation persistence must not be described as saving a taste preference.

Defer attachments, audio input/playback, rich artist cards, message editing and branching, regenerating successful answers, ratings, conversation search, rename/delete/archive controls, sharing, model selection, and cross-conversation memory. These features should not appear as inactive controls.

## Proposed defaults

| Decision             | Proposed choice                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat UI              | assistant-ui primitives styled with the existing Tailwind theme                                                                            |
| UI runtime           | `useExternalStoreRuntime` connected to Convex subscriptions                                                                                |
| Conversation storage | Convex Agent threads, messages, and streaming deltas                                                                                       |
| Generation           | Scheduled internal Convex action after an atomic send mutation                                                                             |
| Model access         | `@convex-dev/ai-sdk-provider` through the Convex AI Gateway                                                                                |
| Initial model        | `openai/gpt-5.6-sol` with medium reasoning, configured on the backend                                                                      |
| Conversation title   | First user message, whitespace normalized and truncated to 60 characters                                                                   |
| Concurrent requests  | One active response per conversation, enforced on the backend                                                                              |
| Draft persistence    | In-memory, per conversation, for the current Chat page session                                                                             |
| History pagination   | 20 conversations per page; 30 recent messages initially                                                                                    |
| Initial limits       | 8,000 characters per user message; 8,192 output tokens including reasoning, with concise visible replies; a two-minute generation deadline |

Model choice verified September 9, 2026: [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra) is the latest model, and its lowest reasoning setting is `low` (not `light`). The [Convex gateway catalog](https://docs.convex.dev/ai-gateway/models) lists GPT-5.6 Sol but not Astra. Use [Sol with medium reasoning](https://developers.openai.com/api/docs/models/gpt-5.6-sol), as suggested in review, without silently falling back to an older model.

These are implementation defaults, not claims that the integrations are already configured. Verify package compatibility and gateway availability before implementation. Keep the chosen versions in `pnpm-lock.yaml`.

## Interface design

### Layout

Keep the existing Relish navigation: Chat, Taste Profile, Radar, and account/logout controls. On desktop, place a compact conversation section below the primary links, visible while Chat is active. It contains a prominent “New chat” button and a scrollable “Conversations” list. Avoid adding a third persistent column.

The chat content uses the remaining viewport height:

```text
┌──────────────────────┬────────────────────────────────────────┐
│ Relish               │ Conversation title                     │
│                      ├────────────────────────────────────────┤
│ Chat                 │                                        │
│ Taste Profile        │       Scrollable message history       │
│ Radar                │       or welcome + starter prompts     │
│                      │                                        │
│ + New chat           │                                        │
│ Conversations        │                                        │
│   Finding new folk   │                                        │
│   Melodic house      │                                        │
│                      │       ┌──────────────────────────┐     │
│ Account / Log out    │       │ Message Relish…     Send │     │
└──────────────────────┴───────┴──────────────────────────┴─────┘
```

Use the existing navy ink, pale background, lime accent, rounded corners, and typography. Limit the message column to approximately 760px and center it. The composer stays at the bottom of the chat region; the message viewport scrolls independently. Ensure the sidebar account section stays reachable when history grows.

On mobile, keep the existing collapsible navigation and expose conversation history within that menu. Selecting a conversation closes the menu. Use dynamic viewport sizing and safe-area padding so the composer remains usable with the software keyboard. No page-level horizontal scrolling at 320px width.

### New conversation

`/chat` shows an empty conversation without creating a database thread. Display:

- Heading: “What have you been listening to?”
- Supporting text: “Tell me about a song, an artist, or a sound you love.”
- Three starter prompts, for example:
  - “I love Stick Season by Noah Kahan. Who else should I listen to?”
  - “Help me describe what I like about Nora En Pure’s sound.”
  - “Ask me a few questions about my music taste.”

Selecting a starter fills the composer and focuses it; the user sends deliberately. Hide starters after the first message. “New chat” opens a fresh draft without deleting saved conversations or stopping a response in another conversation.

### Composer

Use assistant-ui's composer input and send primitives. Show “Message Relish…” as the placeholder, with a persistent accessible label. Enter sends, Shift+Enter inserts a newline, and IME composition must not accidentally submit. Grow the textarea to a bounded height, then scroll internally.

Disable send for whitespace-only input, over-limit text, an unresolved conversation load, a disconnected client, or an active response in the selected conversation. Show a clear character-limit message when needed. Keep the draft on submission failure and restore focus after successful submission.

While a response is running, replace send with “Stop response.” Preserve any next-message draft while generation runs. Stopping must cancel server work where supported and mark the request stopped; merely hiding text in the browser is insufficient.

### Messages and navigation

User messages appear in compact, right-aligned bubbles; assistant replies use a left-aligned reading layout with a small Relish mark. Render Markdown paragraphs, lists, links, and code blocks. Disable raw HTML and unsafe URL schemes. Long links and code must fit the viewport.

Provide a labeled copy button on assistant messages with transient success feedback and an accessible failure message if clipboard access fails. Do not expose model reasoning or raw provider/tool payloads.

Show a waiting indicator after the prompt is accepted and before the first response text. Replace it with streamed text. Auto-scroll only while the reader is near the bottom; offer “Jump to latest” when they scroll up. Loading older messages must preserve the visible reading position.

Conversation history displays deterministic titles and a selected state. Paginate rather than fetching the entire account history. Order by conversation creation time initially; avoid implying an activity sort unless explicitly implemented. A new conversation appears after its first successful send. A missing or inaccessible conversation shows “Conversation unavailable” and a “New chat” action.

## Routes and authentication

| Route                      | Behavior                                                       |
| -------------------------- | -------------------------------------------------------------- |
| `/chat`                    | Empty draft; no stored conversation created yet                |
| `/chat/:threadId`          | Load the authorized conversation and subscribe to its messages |
| `/taste-profile`, `/radar` | Existing placeholder behavior                                  |

On the first accepted send, replace `/chat` with `/chat/:threadId` so reloading returns to the saved conversation. Selecting history pushes a route so browser back/forward works. Discard message subscriptions and runtime state when switching threads; keep drafts keyed separately so a draft never leaks into another thread.

Extend the existing exact-path return-to allowlist to accept a strictly validated local conversation path. Reject external URLs, protocol-relative paths, and malformed IDs. Backend ownership checks remain authoritative. Auth expiry removes chat content and returns to sign-in; logout clears in-memory drafts and chat runtime state.

## assistant-ui integration

Use `AssistantRuntimeProvider` with `useExternalStoreRuntime`. Convex is the authoritative message store; the runtime adapter supplies ordered messages, running state, send, and cancellation callbacks. This follows assistant-ui's [external store runtime model](https://www.assistant-ui.com/docs/runtimes/custom/external-store).

Use `ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`, and appropriate action primitives for the conversation surface. Use the supported Markdown renderer, such as `@assistant-ui/react-markdown`, with the application's typography. The conversation sidebar may use ordinary React components over paginated Convex queries; it must not create a second independent thread store.

The adapter must:

- Preserve stable Agent message IDs across optimistic, streaming, and completed states.
- Convert Agent user/assistant text parts and statuses to assistant-ui messages without flattening away the future ability to render tool parts.
- Filter internal/system content out of the visible transcript.
- Reconcile optimistic sends by request identity instead of appending a second copy.
- Derive running state from persisted request state, including after reload or in another tab.
- Omit callbacks for unsupported editing, branching, or regeneration features.

Keep the adapter isolated from the visual components so step 3 can add tool results without replacing the chat UI.

## Convex architecture and data ownership

Register the Agent component in `convex/convex.config.ts` and generate the component bindings with Convex tooling. Every thread uses the authenticated Convex user ID as its owner. Agent stores the full transcript; do not introduce duplicate application conversation or message tables.

Add a small application-owned `chatRequests` table for request coordination, distinct from transcript storage:

| Field                                      | Purpose                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `userId`, `threadId`                       | Ownership and association with an Agent thread                          |
| `clientRequestId`                          | Deduplicate the original submission, including creation of a new thread |
| `promptMessageId`                          | Reference the already-saved Agent user message                          |
| `status`                                   | `queued`, `running`, `stopping`, `completed`, `failed`, or `stopped`    |
| `_creationTime`, `startedAt`, `finishedAt` | Diagnose lifecycle and enforce deadlines                                |
| `errorCode`                                | Small, user-safe failure category; no raw provider response             |

Omit `attempt` and `scheduledFunctionId`. Each retry creates a new request record referencing the same prompt; terminal records never reopen. The request ID is the generation identity, and queued actions check status before doing any work. Use indexes for user/request identity and thread creation order; the latest request holds the conversation lock. Reuse Agent stream state for streamed content and cancellation references. If the installed Agent version already provides equivalent durable request coordination, use that capability and omit redundant fields; confirm this in the initial integration task.

Every public function obtains the caller identity on the server, checks that the user still exists, and verifies Agent thread ownership before accessing messages, deltas, request state, or cancellation. Never trust a client-supplied owner ID. Return the same unavailable outcome for a nonexistent thread and another user's thread.

### Proposed API surface

Names below describe application functions, not existing library exports.

| Function                  | Type              | Responsibility                                                                   |
| ------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| `chat.listThreads`        | Public query      | Paginate the caller's Agent threads                                              |
| `chat.getThread`          | Public query      | Authorized title and current request state                                       |
| `chat.listMessages`       | Public query      | Authorized paginated messages and stream deltas                                  |
| `chat.send`               | Public mutation   | Validate, deduplicate, create thread if needed, save prompt, schedule generation |
| `chat.stop`               | Public mutation   | Request cancellation for the caller's active attempt                             |
| `chat.retry`              | Public mutation   | Retry an eligible failed attempt using its existing prompt                       |
| `chatGeneration.generate` | Internal action   | Generate through Agent and gateway, persisting streamed output                   |
| `chat.finishRequest`      | Internal mutation | Apply guarded completion/failure updates                                         |
| `chat.expireRequest`      | Internal mutation | Recover overdue queued/running requests                                          |

### Send and streaming lifecycle

1. The browser generates a request ID and submits the text and optional thread ID. An optimistic user message may appear immediately.
2. The mutation authenticates, validates text, and returns the original result if that request ID was already accepted. Otherwise it checks thread ownership and rejects another active request in the same thread.
3. In the same transaction, create a thread when needed, save the user message through Agent, record the queued request, and schedule the internal generation action. Deduplication must cover first-message thread creation too.
4. The internal action claims the current attempt, obtains context from that thread, and calls Agent streaming with the saved prompt ID. It must not submit the prompt a second time.
5. Persist response deltas through Agent. Expose them through an authorized query and subscribe using `useUIMessages` with streaming enabled, following [Convex's streaming integration](https://docs.convex.dev/agents/streaming).
6. Mark the attempt completed only after generation finishes successfully. Record a failure if the model or stream fails. A deadline task recovers abandoned work so the UI does not remain busy indefinitely.
7. Convex subscriptions reconcile the final message and status in every open tab. Navigating away or disconnecting does not discard an accepted request.

Stop and completion can race: terminal status updates must check the request ID and current state. Cancel queued work before execution where possible; for running work, use the Agent version's supported server cancellation mechanism and verify propagation to generation. Do not enable a new response while an older writer could still append to the same thread.

Retry is available for a failed latest request only when no later turn or active attempt exists. Reuse the saved user prompt and create a new request record. Keep partial failed output visibly marked as interrupted; do not include that partial attempt as a successful assistant answer in retry context. Do not automatically retry an ambiguous generation failure, since it may duplicate work and charges.

## Agent behavior and gateway

Define one Relish music assistant. It should be conversational, concrete, and curious about what the user likes. Offer a small number of recommendations with short explanations, ask useful follow-up questions, and distinguish the user's explicit statements from inferred taste.

The system instructions must say that preference persistence, live research, and local show lookup are unavailable in step 2. If asked to save a song, acknowledge it in the conversation and explain that saving to Taste Profile is not available yet. Do not invent research, citations, tool results, or completed preference updates.

Use the current thread's recent context with an explicit budget; do not load all conversations or enable semantic cross-thread retrieval. Initial target: the latest 20 messages within a 36,000-character serialized context budget (a conservative practical bound, not an exact token count), preserving coherent user/assistant turns. UI history pagination is independent of model context selection.

Use `convexGateway(...)` as the Agent language model according to the [gateway setup guide](https://docs.convex.dev/ai-gateway/setup). Gateway authentication stays inside backend actions; no provider keys or service tokens go to Vite, browser storage, or client responses. No direct-provider fallback should silently bypass the gateway.

Gateway enablement and model access must be verified in the development deployment. If unavailable, record setup as a blocker to real generation and show a recoverable service error; do not substitute fabricated replies. The gateway is currently documented as a beta service in the [Convex overview](https://docs.convex.dev/ai-gateway/overview).

## Failure states and recovery

| Condition                       | User experience                                | Data behavior                                     |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| Initial history load            | Skeleton or labeled loading state              | No false empty-state flash                        |
| Send rejected before acceptance | Inline error; draft retained                   | No accepted prompt or generation                  |
| Submission outcome uncertain    | Reconcile/retry with the same request ID       | No duplicate thread or prompt                     |
| Waiting for first token         | “Relish is thinking…”                          | Durable queued/running status                     |
| Generation fails                | “Relish couldn’t finish this reply.” and Retry | Preserve prompt and mark partial output           |
| User stops                      | “Response stopped”                             | Preserve partial output; cancel active work       |
| Connection lost                 | Reconnecting notice; reading remains possible  | Resubscribe to stored progress on reconnect       |
| Gateway unavailable             | Service-unavailable message                    | No fake response and no automatic provider switch |
| Expired authentication          | Return to sign-in                              | Clear private UI state                            |
| Missing/foreign thread          | Conversation-unavailable state                 | No content or ownership disclosure                |

Expose progress and errors with appropriate live regions, avoiding announcements on every token. All controls need accessible names, keyboard focus, and sufficient contrast. Honor reduced motion and keep focus stable during streaming.

## Proposed project changes

```text
src/
  pages/ChatPage.tsx
  chat/
    ChatRuntimeProvider.tsx
    ConversationList.tsx
    Thread.tsx
    Message.tsx
    Composer.tsx
    Welcome.tsx
    messageAdapter.ts
  app/router.tsx                 # conversation route
  auth/routes.ts                # validated conversation return path
  components/AppShell.tsx        # optional conversation navigation slot
convex/
  convex.config.ts              # register Agent component
  chat.ts                       # public queries and mutations
  chatGeneration.ts             # internal generation lifecycle
  lib/musicAgent.ts             # instructions and gateway model
  schema.ts                     # request coordination metadata, if needed
  chat.test.ts
```

Treat this as a responsibility outline; combine small files when that improves readability. Add focused frontend adapter and routing tests near their modules. Update the README with component setup, gateway prerequisites, and verification steps during implementation. Preserve unrelated existing edits.

## Implementation sequence

1. Verify real Step 1 sign-in/session behavior, gateway enablement, package compatibility, and supported Agent cancellation/retry APIs. Install only the dependencies required for the chosen integration.
2. Register Agent and implement ownership checks, thread queries, atomic sends, request lifecycle, and server generation. Generate bindings with Convex tooling.
3. Implement the Convex-to-assistant-ui adapter, including optimistic reconciliation, streaming statuses, cancellation, and retry.
4. Replace the Chat placeholder, add history and routing, style the welcome state/messages/composer, and complete responsive behavior.
5. Verify failure recovery, auth isolation, concurrency, accessibility, and the real gateway round trip. Document setup and any remaining blockers.

## Verification and acceptance criteria

Automate backend authorization and lifecycle tests with `convex-test`, registering the Agent test component as supported by its installed version. Use a deterministic test model for failures and streaming lifecycle tests, plus a separate real gateway smoke test. Focus frontend tests on adapter reconciliation and return-path validation.

- [x] Real sign-in opens Chat and the new conversation state matches this design.
- [x] First send creates exactly one owned thread, one user prompt, and one generation attempt.
- [ ] A real gateway response streams into assistant-ui and supports a follow-up using prior context.
- [ ] Reloading or reopening a saved URL restores the transcript and active status.
- [ ] History and older messages paginate without duplicates or disruptive scroll jumps.
- [ ] Two users cannot read, send to, retry, or stop each other's conversations, including stream queries.
- [x] Unauthenticated and deleted-user requests fail at the backend boundary.
- [ ] Double submission, uncertain acknowledgments, and two-tab sends do not create duplicate or overlapping turns.
- [ ] Stop works before and during streaming, and completion/stop races leave a consistent terminal state.
- [ ] Failures preserve the prompt, expose a retry, and never leave an indefinite running state.
- [ ] Retry does not duplicate the user message or feed failed partial output back as a completed answer.
- [ ] Thread switching, browser navigation, sign-in redirects, and logout isolate message and draft state correctly.
- [ ] Markdown and links render safely; copy and keyboard submission work accessibly.
- [ ] Desktop and mobile layouts keep the composer reachable and support scrolling without horizontal overflow.
- [ ] The assistant does not claim to research live sources, save preferences, or find current shows.
- [x] Typechecking, lint, targeted tests, formatting checks, and production build pass.
- [x] No secrets, fake production replies, or duplicate transcript storage are introduced.

Step 2 is complete only after the real authenticated chat round trip succeeds. A rendered interface or mocked model alone is insufficient. Step 3 can then add tools and Workflow-backed research to this same Agent and extend assistant-ui message rendering for visible tool activity.

## Implementation verification — September 9, 2026

- assistant-ui 0.15.18, Convex Agent 0.7.2, gateway provider 0.1.0, and AI SDK 7 are installed with a pnpm lockfile.
- The Agent component and chat backend are synced to the existing development deployment.
- All 19 automated tests pass. Typechecking, lint, formatting, and the production build pass. Tests cover ownership, deleted/unsigned users, duplicate sends, conversation locks, stopping, new-record retries, request expiry, message conversion, safe redirects, Agent generation, follow-up context, provider failure, and Sol medium gateway request serialization.
- Browser checks confirm the signed-in chat UI, starter prompts, saved conversation URLs, reload, retry without a duplicate prompt, mobile navigation, isolated drafts, and browser back. At 320px width, the page has no horizontal overflow and the composer remains visible.
- The real gateway test returned: AI Gateway is not enabled for this team; Convex requires a paid plan or support assistance. The app now catches that before creating a stream and presents a recoverable service-unavailable message. Billing or plan settings were not changed.
- Real model streaming and stop behavior must still be smoke-tested after gateway enablement. Automated generation tests use a test model; the application has no mock-model fallback.

Request coordination uses no `attempt` or `scheduledFunctionId`. Retries insert a new immutable request identity; stopping running work holds the lock until the provider call settles. A 120-second action deadline and 180-second watchdog recover abandoned requests. The watchdog aborts remaining streams before releasing the lock. Queued work checks its request state before generation.
