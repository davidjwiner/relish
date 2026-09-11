import { v } from 'convex/values';
import { internal } from './_generated/api';
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import type { Id } from './_generated/dataModel';
import { currentUser } from './lib/preferenceAuth';
import {
  TASTE_REVIEW_COOLDOWN_MS,
  TASTE_REVIEW_PROMPT_VERSION,
} from './lib/tasteProfileState';

const reaction = v.union(v.literal('like'), v.literal('dislike'));
const evidenceValidator = v.object({
  id: v.id('preferences'),
  title: v.string(),
  reaction,
});
const claimValidator = v.object({
  text: v.string(),
  evidence: v.array(evidenceValidator),
});
const overviewValidator = v.object({
  text: v.string(),
  evidence: v.array(evidenceValidator),
  drawnTo: v.array(claimValidator),
  avoids: v.array(claimValidator),
  nuances: v.array(claimValidator),
  evidenceLevel: v.union(v.literal('limited'), v.literal('developing')),
});
const profileResponse = v.object({
  status: v.union(
    v.literal('pending'),
    v.literal('running'),
    v.literal('ready'),
    v.literal('empty'),
    v.literal('failed'),
  ),
  hasPreferences: v.boolean(),
  isCurrent: v.boolean(),
  overview: v.optional(overviewValidator),
  generatedAt: v.optional(v.number()),
  reviewedPreferenceCount: v.number(),
  coverage: v.optional(v.union(v.literal('complete'), v.literal('partial'))),
  lastErrorCode: v.optional(v.string()),
});

export const get = query({
  args: {},
  returns: profileResponse,
  handler: async (ctx) => {
    const userId = await currentUser(ctx);
    const profile = await ctx.db
      .query('tasteProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();
    if (!profile) {
      const recentPreferences = await ctx.db
        .query('preferences')
        .withIndex('by_userId_updatedAt', (q) => q.eq('userId', userId))
        .order('desc')
        .take(50);
      return {
        status: 'empty' as const,
        hasPreferences: recentPreferences.some(
          (preference) => !preference.removed,
        ),
        isCurrent: true,
        reviewedPreferenceCount: 0,
      };
    }
    const isCurrent =
      profile.summaryVersion === profile.preferencesVersion &&
      Boolean(profile.overview);
    return {
      status: profile.status,
      hasPreferences:
        profile.reviewedPreferenceCount > 0 || profile.status !== 'empty',
      isCurrent,
      ...(isCurrent && profile.overview
        ? {
            overview: await presentOverview(ctx, userId, profile.overview),
            ...(profile.generatedAt
              ? { generatedAt: profile.generatedAt }
              : {}),
            ...(profile.coverage ? { coverage: profile.coverage } : {}),
          }
        : {}),
      reviewedPreferenceCount: profile.reviewedPreferenceCount,
      ...(profile.lastErrorCode
        ? { lastErrorCode: profile.lastErrorCode }
        : {}),
    };
  },
});

export const requestRefresh = mutation({
  args: {},
  returns: v.object({
    scheduled: v.boolean(),
    cooldownUntil: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    const userId = await currentUser(ctx);
    const now = Date.now();
    const profile = await ctx.db
      .query('tasteProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();
    if (!profile) {
      await ctx.db.insert('tasteProfiles', {
        userId,
        preferencesVersion: 0,
        status: 'pending',
        reviewedPreferenceCount: 0,
        nextReviewAt: now,
      });
      await scheduleTasteReview(ctx, userId);
      return { scheduled: true };
    }
    if (profile.workflowId) return { scheduled: false };
    const cooldownUntil = (profile.generatedAt ?? 0) + TASTE_REVIEW_COOLDOWN_MS;
    const isStale =
      profile.summaryVersion !== profile.preferencesVersion ||
      profile.promptVersion !== TASTE_REVIEW_PROMPT_VERSION;
    if (!isStale && profile.status !== 'failed' && cooldownUntil > now)
      return { scheduled: false, cooldownUntil };
    await ctx.db.patch(profile._id, {
      status: 'pending',
      nextReviewAt: now,
      lastErrorCode: undefined,
    });
    await scheduleTasteReview(ctx, userId);
    return { scheduled: true };
  },
});

async function scheduleTasteReview(ctx: MutationCtx, userId: Id<'users'>) {
  await ctx.scheduler.runAfter(0, internal.tasteProfileWorkflows.startForUser, {
    userId,
  });
}

async function presentOverview(
  ctx: QueryCtx,
  userId: Id<'users'>,
  overview: {
    overview: string;
    overviewEvidenceIds: Id<'preferences'>[];
    drawnTo: { text: string; evidenceIds: Id<'preferences'>[] }[];
    avoids: { text: string; evidenceIds: Id<'preferences'>[] }[];
    nuances: { text: string; evidenceIds: Id<'preferences'>[] }[];
    evidenceLevel: 'limited' | 'developing';
  },
) {
  const presentClaims = async (
    claims: { text: string; evidenceIds: Id<'preferences'>[] }[],
  ) =>
    Promise.all(
      claims.map(async (claim) => ({
        text: claim.text,
        evidence: await presentEvidence(ctx, userId, claim.evidenceIds),
      })),
    );
  return {
    text: overview.overview,
    evidence: await presentEvidence(ctx, userId, overview.overviewEvidenceIds),
    drawnTo: await presentClaims(overview.drawnTo),
    avoids: await presentClaims(overview.avoids),
    nuances: await presentClaims(overview.nuances),
    evidenceLevel: overview.evidenceLevel,
  };
}

async function presentEvidence(
  ctx: QueryCtx,
  userId: Id<'users'>,
  ids: Id<'preferences'>[],
) {
  const preferences = await Promise.all(ids.map((id) => ctx.db.get(id)));
  return Promise.all(
    preferences
      .flatMap((preference) =>
        !preference || preference.userId !== userId || preference.removed
          ? []
          : [preference],
      )
      .map(async (preference) => ({
        id: preference._id,
        title: await describeEvidence(ctx, preference),
        reaction: preference.reaction,
      })),
  );
}

async function describeEvidence(
  ctx: QueryCtx,
  preference: {
    target:
      | { kind: 'artist'; artistId: Id<'artists'> }
      | {
          kind: 'track';
          trackId: Id<'tracks'>;
        };
  },
) {
  if (preference.target.kind === 'artist')
    return (
      (await ctx.db.get(preference.target.artistId))?.name ?? 'Unknown artist'
    );
  const track = await ctx.db.get(preference.target.trackId);
  if (!track) return 'Unknown track';
  const artists = await Promise.all(
    track.artistIds.map((artistId) => ctx.db.get(artistId)),
  );
  return `${track.title}${track.version ? ` (${track.version})` : ''} — ${artists.map((artist) => artist?.name ?? 'Unknown artist').join(', ')}`;
}
