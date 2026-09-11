import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export const TASTE_REVIEW_DELAY_MS = 60_000;
export const TASTE_REVIEW_COOLDOWN_MS = 5 * 60_000;
export const TASTE_REVIEW_PROMPT_VERSION = 'taste-review-v3';

/**
 * Records a single user-level preference revision. Both preference writers use
 * this helper so an overview always represents all of a user's conversations.
 */
export async function markTasteProfileStale(
  ctx: MutationCtx,
  userId: Id<'users'>,
  now: number,
) {
  const profile = await ctx.db
    .query('tasteProfiles')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
  if (!profile) {
    await ctx.db.insert('tasteProfiles', {
      userId,
      preferencesVersion: 1,
      status: 'pending',
      reviewedPreferenceCount: 0,
      nextReviewAt: now + TASTE_REVIEW_DELAY_MS,
    });
    return;
  }
  await ctx.db.patch(profile._id, {
    preferencesVersion: profile.preferencesVersion + 1,
    status: 'pending',
    nextReviewAt: Math.min(
      profile.nextReviewAt ?? Infinity,
      now + TASTE_REVIEW_DELAY_MS,
    ),
    lastErrorCode: undefined,
  });
}
