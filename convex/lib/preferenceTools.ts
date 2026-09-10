import { createTool } from '@convex-dev/agent';
import { z } from 'zod';
import type { ActionCtx } from '../_generated/server';
import { api, internal } from '../_generated/api';

// Chat can research music and read existing preferences, but cannot change them.
export function preferenceTools(
  ctx: ActionCtx,
  owner: { threadId: string; promptMessageId: string },
) {
  return {
    searchMusic: createTool({
      description:
        'Research music on the web when requested. Starts background research; do not claim findings before completion. Does not save preferences. One background request per user turn.',
      inputSchema: z.object({ query: z.string().trim().min(1).max(1000) }),
      execute: async (_ctx, { query }) =>
        ctx.runMutation(internal.preferenceWorkflows.begin, {
          ...owner,
          request: { kind: 'search', query },
        }),
    }),
    listPreferences: createTool({
      description:
        'Read existing saved preferences. Follow pagination when needed. This tool cannot save or change preferences.',
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
  };
}
