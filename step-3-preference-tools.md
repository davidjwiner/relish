# Step 3: Music research and preference reads

## Scope

Chat can research music and read existing saved preferences. It cannot create, update, or delete preferences, and it must not claim that it did so. A statement such as “I like Noah Kahan” receives a normal conversational reply without starting preference saving or background extraction. The future offline Workflow is the sole owner of preference persistence.

Preference extraction is deferred to a separate PR, following [Background preference extraction](./conversation-preference-extraction.md). This PR adds no extraction cron, extraction workflow, save card, or progress banner.

## Implementation

```text
User → Agent
  ├─ normal conversation → streamed reply
  ├─ listPreferences → authorized query → tool result
  └─ explicitly requested searchMusic → research Workflow
       → Exa search → gateway model interprets evidence
       → sourced completion message
```

Only `searchMusic` and `listPreferences` are exposed to the chat model. Preference mutation endpoints and saved-confirmation handling have been removed. The existing artist, track, and preference schema remains available for reads and future extraction.

Research uses `@exalabs/convex-exa` for at most five pages and the existing gateway model to interpret sources. Supporting quotations and source URLs are checked before returning a sourced answer. Source text is untrusted data. There is no researched-target saving step.

The existing Workflow component coordinates explicit music research only. Starting a workflow and storing its reference on the originating Agent prompt share a transaction. Retries reuse that reference. Completion verifies thread ownership and atomically stores one assistant reply and its completion ID. Stop aborts chat generation; research that has already started continues. There is no status banner.

## Verification

Run `pnpm test`, `pnpm lint`, `pnpm format:check`, and `pnpm build`. Tests cover the read-only tool surface, ordinary chat without preference writes, preference-read ownership, research citations and failures, duplicate completion, and deleted conversations.

Configure backend-only `EXA_API_KEY` and gateway access for live research. Live Exa/model round trips remain unverified because service access was unavailable.
