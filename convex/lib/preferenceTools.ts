import { createTool } from '@convex-dev/agent';
import { z } from 'zod';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { api, internal } from '../_generated/api';
import { targetSchema, type PreferenceRequest } from './preferenceTypes';

// The model supplies music data; identity and the originating prompt are bound here.
export function preferenceTools(
  ctx: ActionCtx,
  owner: { threadId: string; promptMessageId: string },
) {
  const begin = (request: PreferenceRequest) =>
    ctx.runMutation(internal.preferenceWorkflows.begin, { ...owner, request });
  const apply = (request: PreferenceRequest) =>
    ctx.runMutation(internal.preferences.apply, { ...owner, request });
  return {
    searchMusic: createTool({
      description:
        'Research music on the web. Starts background research; do not claim findings before completion. One background request per user turn.',
      inputSchema: z.object({ query: z.string().trim().min(1).max(1000) }),
      execute: async (_ctx, { query }) => begin({ kind: 'search', query }),
    }),
    listPreferences: createTool({
      description:
        'Read saved preferences, including IDs and revisions required for changes. Follow pagination when needed.',
      inputSchema: z.object({
        cursor: z.string().nullable(),
        targetKey: z.string().nullable(),
      }),
      execute: async (_ctx, args) =>
        ctx.runQuery(api.preferences.list, {
          paginationOpts: { cursor: args.cursor, numItems: 30 },
          ...(args.targetKey ? { targetKey: args.targetKey } : {}),
        }),
    }),
    createPreference: createTool({
      description:
        'Save an explicit user like/dislike. Supply a target only when artist/track identity is clear from the user. For unknown tracks, latest episodes or other research, pass target=null and researchQuery to research AND save in one workflow. Do not call searchMusic first. Reasons must quote this user message verbatim or be null. Track likes never imply artist likes.',
      inputSchema: z.object({
        target: targetSchema.nullable(),
        researchQuery: z.string().max(1000).nullable(),
        reaction: z.enum(['like', 'dislike']),
        reason: z.string().max(1000).nullable(),
      }),
      execute: async (_ctx, input) =>
        input.target
          ? apply({ kind: 'create', ...input })
          : begin({ kind: 'create', ...input }),
    }),
    updatePreference: createTool({
      description:
        'Update an explicitly requested preference after reading its ID and revision. Omit reason to preserve it; null removes it. A new reason must quote this user message verbatim.',
      inputSchema: z.object({
        preferenceId: z.string(),
        expectedRevision: z.number().int().positive(),
        reaction: z.enum(['like', 'dislike']),
        reason: z.string().max(1000).nullable().optional(),
      }),
      execute: async (_ctx, input) =>
        apply({
          kind: 'update',
          ...input,
          preferenceId: input.preferenceId as Id<'preferences'>,
        }),
    }),
    deletePreference: createTool({
      description:
        'Delete a preference explicitly requested by the user, after reading its ID and revision. Do not interpret deleting as a dislike.',
      inputSchema: z.object({
        preferenceId: z.string(),
        expectedRevision: z.number().int().positive(),
      }),
      execute: async (_ctx, input) =>
        apply({
          kind: 'delete',
          ...input,
          preferenceId: input.preferenceId as Id<'preferences'>,
        }),
    }),
  };
}

// Direct writes already persisted their visible receipt; no follow-up model call is needed.
export function hasPreferenceReceipt(
  results: Array<{ toolName: string; output: unknown }>,
) {
  return results.some(
    (result) =>
      ['createPreference', 'updatePreference', 'deletePreference'].includes(
        result.toolName,
      ) && typeof result.output === 'string',
  );
}
