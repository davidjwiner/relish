# Step 3: Web research and preference tools

## Goal

Extend [Chat](./step-2-chat-interface.md) so users can research music and create, read, update, or delete saved artist and track preferences. “I like Noah Kahan” saves immediately. “Save the first track in Nora En Pure’s latest radio show” researches the identity before saving it with a source.

The preferences screen, taste summaries, and Radar remain later steps.

## Implementation

Agent owns conversations, tools, and messages. Resolved preference changes are ordinary tools backed by Convex mutations. Exa and Workflow are used when research is necessary:

```text
User → Agent tool
  ├─ listPreferences → authorized query → tool result
  ├─ create/update/delete resolved preference → mutation + saved confirmation
  └─ search or research-and-save → Workflow
       → Exa search → gateway model resolves evidence
       → preference mutation if requested → sourced completion message
```

A direct write saves the preference, its confirmation message, and its retry result in one transaction. The tool returns that result, and the Agent loop stops without another model call. No workflow is started for ordinary CRUD.

Research returns a workflow reference promptly. Chat subscribes to its status and receives the eventual completion through Agent messages. Stop aborts the chat response; an already-started research workflow continues.

## Data and tools

Three application tables accompany the existing authentication tables:

| Table         | Purpose                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `artists`     | Shared factual names, normalized identity keys, and optional source URLs.                                                                                       |
| `tracks`      | Titles, artist IDs, optional versions/source URLs, and identity keys incorporating artists and version.                                                         |
| `preferences` | User-owned artist-or-track target, like/dislike, optional verbatim reason, originating message ID, timestamps, and revision. Indexed by user and user + target. |

An indexed transactional lookup enforces one preference per user and target. Liking a track does not also like its artist. Normalized names are the initial identity strategy; ambiguous names or versions require clarification.

The agent exposes five tools:

- `listPreferences`: read owned preferences, IDs, and revisions with bounded pagination.
- `createPreference`: save an explicit like/dislike directly when the target is resolved. With an unresolved target and research query, start research-and-save instead.
- `updatePreference`: change an owned preference using its expected revision; omit the reason to preserve it, or pass null to remove it.
- `deletePreference`: remove an owned preference using its expected revision.
- `searchMusic`: research without saving a preference.

Recommendations, questions, inferred traits, and show dismissals do not create preferences. New reasons must quote the originating user message. Unambiguous requests need no extra confirmation.

## Ownership and retries

Every entry point derives the user from authentication and verifies the thread and originating prompt. Internal research steps receive trusted identity and recheck ownership before writing. Model inputs cannot select a user.

For direct writes, `preferences.apply` calls shared mutation logic and atomically saves the result and confirmation ID on the originating Agent prompt. Repeated calls return that result; generation retries detect it and finish without invoking the model. A retried old save therefore cannot restore a preference the user subsequently deleted. Expected revisions reject stale updates and deletes.

For research, starting Workflow and saving its reference on the Agent prompt also share one transaction. Workflow journals its steps. Its completion callback atomically saves a single Agent reply and confirmation ID. Both paths enforce one preference change or research request per saved prompt and reject crossing into another path after work has started. There is no application operations table.

## Research

Use `@exalabs/convex-exa` 0.1.1 for a bounded search with text from at most five pages, then interpret the result through the existing Convex gateway model. Check supporting quotations, source URLs, and target names before accepting a researched identity. Missing or ambiguous evidence produces a clarification without a write. Source content is evidence, never instructions.

`@convex-dev/workflow` 0.4.6 coordinates research and the final mutation. Retry transient Exa failures with limited backoff; do not retry invalid input or permanent configuration failures. A failed model step produces a recoverable research failure. Zod 3.25.76 satisfies Exa and AI SDK 7 compatibility.

## Files and verification

- `convex/preferences.ts`: direct tool mutation, authorized reads, and shared preference write logic.
- `convex/lib/preferenceTools.ts`: Agent tool definitions and stop condition after direct confirmations.
- `convex/preferenceWorkflows.ts`: research startup, durable steps, completion, and status.
- `convex/lib/musicResearch.ts`: Exa access and evidence interpretation.
- `src/pages/ChatPage.tsx`: background research status.

Run `pnpm test`, `pnpm lint`, `pnpm format:check`, and `pnpm build`. Tests exercise direct CRUD without registering Workflow, the Agent tool loop without a follow-up model call, ownership, stale revisions, duplicate requests/completions, retries after deletion, and research failures/evidence.

Configure backend-only `EXA_API_KEY` and gateway access for live research verification. The original implementation was synced to development; live Exa/model round trips remain unverified because service access was unavailable. See the README for setup and smoke-test prompts.
