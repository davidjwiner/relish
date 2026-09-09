# Step 3: Web research and preference tools

## Goal

Extend the existing chat so users can research music and create, read, update, or delete saved artist and track preferences. For example, “Save the first track in Nora En Pure’s latest radio show” should resolve the episode and track, save the user’s like, and reply with the identified track and source.

This implements [step 3](./design.md). The preferences screen, taste summaries, and Radar remain later steps.

## Approach

Keep Agent as the owner of conversations and messages, assistant-ui as the chat renderer, and the current Convex gateway model configuration. Add [Exa](https://www.convex.dev/components/exalabs/convex-exa) for search and page content, and [Workflow](https://docs.convex.dev/agents/workflows) for durable research and writes. Network and model calls run in actions invoked as workflow steps; database changes run in mutations.

```text
User message → Agent tool
  ├─ read preferences → authorized query → tool result
  └─ search or change preferences → start Workflow → workflow ID
       → research if needed → resolve target → commit change
       → persist outcome + assistant message in the original thread
```

The tool returns promptly with “Research started” or “Saving preference.” The existing message subscription receives the eventual result even after navigation or reload. Ordinary chat keeps its current generation path; do not move every conversation turn into a workflow.

## Data and tools

Add these application tables alongside the auth tables:

| Table         | Fields and indexes                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `artists`     | Name, optional verified external identity/source URL; index external identity.                                                                                                   |
| `tracks`      | Title, artist IDs, optional album/version and verified external identity/source URL; index external identity.                                                                    |
| `preferences` | User ID, a validated artist-or-track target, like/dislike, optional verbatim reason, originating message ID, creation/update timestamps, revision; index user and user + target. |

Use exactly one preference per user and target, enforced by a transactional indexed lookup. Shared music identities contain factual metadata only. Prefer verified external IDs for deduplication; otherwise compare normalized names plus artist/version context and ask when identity remains ambiguous. Liking a track does not also like its artist.

Expose five tools through `convex/lib/musicAgent.ts`:

| Tool               | Behavior                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `searchMusic`      | Start bounded Exa research; return sourced findings without saving preferences.                                     |
| `listPreferences`  | Read the current user’s preferences with optional target filtering and bounded pagination.                          |
| `createPreference` | Resolve a target and save an explicit like/dislike; return an existing match, or request an update if it conflicts. |
| `updatePreference` | Change reaction or reason for an owned preference, checking its expected revision.                                  |
| `deletePreference` | Remove an owned preference, checking its expected revision.                                                         |

Treat “I love Stick Season” as an explicit like. Questions, recommendations, and inferred traits do not create preferences. Ask for clarification when a target or intended change is unclear; do not require an extra confirmation for an unambiguous request. Retargeting means deleting the old preference and creating a new one.

## Workflow and correctness

1. **Authorize and start.** Derive the user from authentication, verify thread and prompt ownership, and pass trusted identity into the internal workflow. Never accept a model-supplied user ID. Every read/write checks ownership again; background steps use the captured identity rather than assuming a browser session exists.
2. **Research when needed.** Search with Exa and fetch relevant results, capped initially at three searches and five pages per operation. Return bounded excerpts, titles, URLs, and retrieval dates. Resolve relative terms such as “latest” at operation start. If an episode or track cannot be verified, finish with a clarification message and no write. Treat web content as evidence, never instructions.
3. **Validate and commit.** Validate structured results and apply the requested change in one mutation. Check the expected preference revision before updating or deleting. A concurrent edit produces a conflict and asks the user to retry against current data. Never save speculative reasons or inferred preferences.
4. **Report.** Use a workflow mutation step to save a deterministic assistant message through Agent. Include the saved/deleted target or a specific failure, plus research links when relevant. A language-model summary is unnecessary for confirming a write.

Workflow owns execution state and retries; Agent stores tool calls, workflow references, and conversation results. Use those component records to reconnect a saved request to its workflow and display its outcome. Do not add a separate application operations table initially. Configure limited backoff for transient Exa/model failures; do not retry invalid input, ambiguous results, or ownership failures.

**Implementation check:** verify how the installed components handle duplicate workflow starts, replayed completion steps, and retries of an entire chat generation. Resuming a workflow and regenerating a tool call are different cases. Reuse a recorded workflow/result when available; do not blindly rerun a write whose outcome is uncertain. A unique user/target preference prevents duplicate records, but cannot prevent an old retried create from restoring a deleted preference. Expected revisions protect updates and deletes, not that create case. If component records cannot close a demonstrated retry gap, document it and add only the minimal bookkeeping needed.

## Chat integration and implementation order

1. Install `@exalabs/convex-exa` and `@convex-dev/workflow` with pnpm, register them in `convex/convex.config.ts`, regenerate bindings, and document backend-only `EXA_API_KEY` setup. Verify compatibility with the installed Agent and AI SDK versions.
2. Add schema and internal preference functions in `convex/preferences.ts`; implement workflow steps in `convex/preferenceWorkflows.ts`, and Exa access in `convex/lib/musicResearch.ts`.
3. Wire the tools into the agent and replace its current “research/saving unavailable” instructions. Configure a bounded multi-step tool loop so Agent can consume tool results and acknowledge pending operations.
4. Expose workflow status through an ownership-checked query using workflow references persisted with Agent tool results, and add a small pending/error indicator in Chat. Verify that the reference belongs to the signed-in user’s thread before querying status. The current message adapter renders only text: keep tool payloads private and use persisted text replies for outcomes. Stop continues to stop the chat response; label the indicator to explain that an already-started save or research operation continues.

## Verification

Test user isolation, malformed targets, duplicate starts/completions, create/update/delete semantics, stale revisions, research ambiguity, and workflow recovery after transient failures. Specifically test whole-generation retries after a successful write, after a later edit or deletion, and after a lost response. Verify that they produce neither a second preference change nor a second completion message; resolve any component integration gaps before enabling automatic write retries.

Run `pnpm test`, `pnpm lint`, `pnpm format:check`, and `pnpm build`. With real gateway and Exa access, exercise direct saving, researched saving with citations, listing, correction, deletion, and reload during research. The README currently records gateway access as blocked by the development team’s plan; live model verification depends on resolving that prerequisite.

## Implementation notes

The implementation uses `@convex-dev/workflow` 0.4.6, `@exalabs/convex-exa` 0.1.1, and Zod 3.25.76 (compatible with Exa and AI SDK 7). It adds no operations table.

Starting a workflow and storing its reference on the saved Agent prompt happen in one Convex mutation. This closes the gap before Agent persists a tool result. Generation retries check that reference before invoking the model; repeated tool calls also reuse it. Workflow journals preference mutations, and its completion callback writes an Agent reply and records the reply ID on the prompt atomically. The status query reads these trusted references after verifying thread ownership.

Research currently uses one Exa search with page text from at most five results, followed by a gateway model call. Exact source quotations and target names are checked before accepting a researched target. Missing or ambiguous evidence produces a clarification without a write. It does not perform an exhaustive crawl or guarantee that an inaccessible tracklist can be resolved. Music identities initially use normalized names plus artist/version context rather than external catalog IDs.

Automated coverage includes the real Agent tool loop with a test model, workflow completion, sourced research with test responses, ownership, transient and permanent research failures, stale revisions, duplicate starts/completions, and retries after deletion. All 23 automated tests, lint, formatting, TypeScript checks, and the production build pass. Convex functions were synced successfully to the development deployment. On September 9, 2026, the development deployment had no `EXA_API_KEY`; live Exa verification remains blocked on that setting. Real model verification also requires the gateway access described in the README.
