import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { authTables } from '@convex-dev/auth/server';
import { reaction } from './lib/preferenceTypes';

// Agent owns conversation records; Workflow owns background execution state.
export default defineSchema({
  ...authTables,
  artists: defineTable({
    name: v.string(),
    identityKey: v.string(),
    sourceUrl: v.optional(v.string()),
  }).index('by_identity', ['identityKey']),
  tracks: defineTable({
    title: v.string(),
    artistIds: v.array(v.id('artists')),
    version: v.optional(v.string()),
    identityKey: v.string(),
    sourceUrl: v.optional(v.string()),
  }).index('by_identity', ['identityKey']),
  preferences: defineTable({
    userId: v.id('users'),
    target: v.union(
      v.object({ kind: v.literal('artist'), artistId: v.id('artists') }),
      v.object({ kind: v.literal('track'), trackId: v.id('tracks') }),
    ),
    targetKey: v.string(),
    reaction,
    reason: v.optional(v.string()),
    originatingMessageId: v.string(),
    sourceThreadId: v.optional(v.string()),
    sourceMessageId: v.optional(v.string()),
    sourceQuote: v.optional(v.string()),
    sourceCreatedAt: v.optional(v.number()),
    removed: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
    revision: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_target', ['userId', 'targetKey']),
  conversationPreferenceState: defineTable({
    userId: v.id('users'),
    threadId: v.string(),
    processedThroughOrder: v.number(),
    latestUserOrder: v.number(),
    nextReviewAt: v.optional(v.number()),
    workflowId: v.optional(v.string()),
    lastErrorCode: v.optional(v.string()),
  })
    .index('by_thread', ['threadId'])
    .index('by_next_review', ['nextReviewAt']),
});
