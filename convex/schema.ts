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
    createdAt: v.number(),
    updatedAt: v.number(),
    revision: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_target', ['userId', 'targetKey']),
});
