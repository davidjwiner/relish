import { defineSchema, defineTable } from 'convex/server';
import { authTables } from '@convex-dev/auth/server';
import { v } from 'convex/values';

export const requestStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('stopping'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('stopped'),
);

export default defineSchema({
  ...authTables,
  chatRequests: defineTable({
    userId: v.id('users'),
    threadId: v.string(),
    clientRequestId: v.string(),
    promptMessageId: v.string(),
    status: requestStatus,
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
  })
    .index('by_user_request', ['userId', 'clientRequestId'])
    .index('by_thread', ['threadId']),
});
