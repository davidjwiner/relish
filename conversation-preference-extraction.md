# Background preference extraction

**Status: deferred to the next PR.** Workflow is the agreed orchestration approach. The current PR removes chat-triggered preference saving; this document describes the subsequent offline extraction implementation.

## User experience

Chat answers the user's question and offers music suggestions. It does not save preferences, show save cards, announce extraction, or wait for a preference agent. A separate background agent periodically reviews conversations and updates the user's saved taste data.

Preferences are eventually consistent: they normally appear a few minutes after a conversation, not during the reply. Extraction produces no chat messages or notifications. This removes preference tool calls from the response path; it does not eliminate the chat model's own time to first token.

## Architecture

```text
User sends a message
  → Agent saves the message + marks its conversation for review
  → Chat streams its normal response

Every 5 minutes: Convex cron
  → Dispatcher starts one durable Workflow per eligible conversation
      → Snapshot a bounded conversation batch
      → Extract structured preferences with user-message evidence
      → Later: Exa research + identity resolution as separate steps
      → Atomically validate, save preferences, and advance the checkpoint
      → Completion callback releases the conversation for its next batch
```

Use a native [Convex cron job](https://docs.convex.dev/scheduling/cron-jobs) in `convex/crons.ts` to invoke an internal dispatcher mutation. The dispatcher starts background workflows and records their IDs atomically; it does not wait for extraction. Guard dispatch using the conversation's stored workflow ID, since cron execution limits do not limit the workflows it launches.

Use the existing [Workflow component](https://docs.convex.dev/agents/workflows) to orchestrate extraction. Snapshot queries, model actions, and the final commit mutation are separate durable steps. Workflow journals completed step results, allowing retries to reuse completed extraction when a later research step fails. Actions can still repeat if a failure occurs before their result is recorded; preference writes must remain idempotent.

Exa is not part of the initial rollout. When added, research and identity resolution become steps between extraction and commit. Research can clarify which artist or recording the user meant; it cannot supply evidence of the user's taste. Explicitly requested chat research remains independent.

## Minimal processing state

Add one `conversationPreferenceState` row per conversation, indexed by thread and next review time:

| Field                   | Purpose                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `userId`, `threadId`    | Ownership and the Agent conversation reference.                                 |
| `processedThroughOrder` | Last successfully reviewed user-message order.                                  |
| `latestUserOrder`       | Latest user message needing review.                                             |
| `nextReviewAt`          | When the cron should consider this conversation; unset when caught up.          |
| `workflowId`            | Current or failed workflow; prevents overlapping batches for this conversation. |
| `lastErrorCode`         | Backend diagnostics for terminal failures; retries live in Workflow.            |

`chat.send` updates this row in the same transaction that saves the user message. This is a small database write, with no model call or research. Set review eligibility one minute after the latest user message to avoid repeatedly analyzing an active exchange.

This is a conversation checkpoint, not a per-message job or preference-operation table. Agent remains the source of truth for transcript content; do not duplicate conversations or maintain a custom queue/lease system.

## Extraction agent

Define a separate `preferenceExtractor` with its own instructions and structured output, using the existing Convex gateway. Give it the selected transcript explicitly and keep its output out of the user's Agent thread. It does not call preference-writing tools; application code validates and applies its output.

Start with at most 10 new user messages per batch, up to three preceding user/assistant exchanges for context, and a 24,000-character input budget. Preserve complete messages. Capture a fixed end order before the model call; messages arriving later belong to a later batch.

Return at most 20 candidates, each containing:

- A resolved artist or track, including artist/version information where necessary.
- An operation: like, dislike, or removal of a previously stated preference.
- The supporting user-message ID and exact quotation.
- An optional reason quoted from the user, separate from the model's interpretation.

Extract only clear user statements. “I love Stick Season” creates a track like; it does not also like Noah Kahan. “Who sounds like Noah Kahan?” creates nothing. Assistant recommendations are context, never evidence. “The second artist you suggested is great” can count when the reference is unambiguous. Genre-only statements, uncertain references, sarcasm, and unknown track identities are skipped initially.

There is no Exa call or open-ended research loop in the initial extractor. Later work can add background identity resolution without changing chat latency. Treat transcript text as data, not instructions for the extraction agent.

## Applying results safely

The commit mutation rechecks that the user and thread still exist and belong together, that the workflow ID still matches, and that the stored checkpoint matches the batch's starting checkpoint. It verifies each evidence ID is a new user message inside the captured batch and that the quotation is present. Unsupported candidates are discarded.

Reuse the existing artist, track, and preference models and transactional user/target uniqueness checks. Add evidence provenance to preferences: source thread/message, short user quotation, and the source message's creation time. Order competing statements by source time, with message ID as a deterministic tie-breaker—never by extraction completion time. A newer dislike therefore wins over an older like even if two conversations are processed out of order.

Represent removals with a tombstone on the preference record, excluded from normal reads. This prevents an older batch or a backfill from recreating a removed preference. Future direct edits use their edit time as the same ordering boundary. A newer explicit user statement can change the preference again.

Apply valid changes and advance the checkpoint through the batch's captured end order in one mutation, including batches that produce no preferences. If new messages arrived while extraction ran, keep the conversation eligible. Duplicate/stale commits make no changes; a fresh batch rereads the checkpoint. Deleting a conversation prevents subsequent extraction from it; already saved preferences remain separate records.

## Scheduling, failures, and cost

Proposed defaults: dispatch every five minutes, start up to 10 due conversations per tick, and configure the extraction Workflow workpool with `maxParallelism: 2`. This limits concurrent steps, not the number of outstanding workflows. Paginate large conversations across batches and prioritize the oldest eligible work.

Enable bounded retries with exponential backoff for model actions and, later, Exa actions. Validate structured output within the extraction action so invalid output fails that step; a valid empty result advances the checkpoint. Workflow handles retries and durable progress, while the conversation checkpoint tracks which messages have been reviewed.

A completion mutation clears the workflow ID only when it matches the finishing workflow and the run succeeded. It recomputes eligibility from the latest user-message order and checkpoint so messages arriving during extraction are not lost. Failed runs retain their workflow ID and error code, preventing the cron from launching duplicate work every tick. After automatic retries are exhausted, surface the failure in backend diagnostics for operator investigation and restart from the failed step using Workflow's restart API. Recheck ownership and checkpoint validity before restarting; obsolete runs should be canceled or retired instead.

Conversation deletion removes its processing state and requests cancellation of any workflow. The commit guard also blocks late results if cancellation races with execution. Clean up completed workflow journals after a bounded retention period; retain failed runs until resolved.

Record counts, duration, token usage, checkpoint lag, and error codes in backend diagnostics. Do not log full transcripts or emit user-facing progress. Provide a server-side enable/disable setting. Seed checkpoint rows for existing conversations with a bounded, paginated backfill, using the same extraction path.

## Implementation and acceptance

In the next PR:

1. Preserve the current read-only chat behavior: ordinary chat and explicitly requested research remain independent of preference extraction.
2. Add the conversation checkpoint table and the lightweight `chat.send` update.
3. Add the cron dispatcher, extraction Workflow and agent, completion handler, validation/commit mutation, and preference provenance/tombstones. Keep future Exa research as a separate workflow step.
4. Backfill existing conversations and verify behavior before enabling recurring extraction.

Acceptance tests cover explicit versus inferred preferences, assistant-only suggestions, quoted reasons, ambiguous targets, new messages arriving mid-batch, crashes/retries, prevention of overlapping batches, resuming a failed later step without rerunning completed extraction, terminal-failure handling, duplicate commits, cross-thread ordering, removals, ownership, and deleted conversations. Verify that extraction never changes the visible transcript, that no preference model call occurs in chat generation, and that foreground time to first text is measured separately from background extraction latency.
