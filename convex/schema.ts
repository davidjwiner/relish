import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { authTables } from '@convex-dev/auth/server';
import { reaction } from './lib/preferenceTypes';
import {
  tasteOverview,
  tasteProfileCoverage,
  tasteProfileStatus,
} from './lib/tasteProfileTypes';

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
    .index('by_user_target', ['userId', 'targetKey'])
    .index('by_user_reaction', ['userId', 'reaction'])
    .index('by_user_target_kind', ['userId', 'target.kind'])
    .index('by_user_reaction_target_kind', [
      'userId',
      'reaction',
      'target.kind',
    ])
    .index('by_userId_updatedAt', ['userId', 'updatedAt']),
  tasteProfiles: defineTable({
    userId: v.id('users'),
    // Incremented transactionally whenever an active preference changes.
    preferencesVersion: v.number(),
    summaryVersion: v.optional(v.number()),
    status: tasteProfileStatus,
    overview: v.optional(tasteOverview),
    generatedAt: v.optional(v.number()),
    reviewedPreferenceCount: v.number(),
    coverage: v.optional(tasteProfileCoverage),
    model: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    nextReviewAt: v.optional(v.number()),
    lastErrorCode: v.optional(v.string()),
  })
    .index('by_userId', ['userId'])
    .index('by_nextReviewAt', ['nextReviewAt'])
    .index('by_workflowId', ['workflowId']),
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
