import {
  WorkflowManager,
  cleanup as cleanupWorkflow,
  vResultValidator,
  vWorkflowId,
} from '@convex-dev/workflow';
import { getServiceToken } from 'convex/server';
import { v } from 'convex/values';
import { generateText, Output } from 'ai';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { CHAT_MODEL } from './lib/musicAgent';
import { TASTE_REVIEW_PROMPT_VERSION } from './lib/tasteProfileState';
import {
  tasteReviewAgent,
  tasteReviewOutputFor,
  type TasteReviewOutput,
} from './lib/tasteReviewAgent';

const tasteReviewWorkflow = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: 2 },
});
const MAX_REVIEWED_PREFERENCES = 200;
const MAX_INPUT_CHARACTERS = 40_000;
const COMPLETED_WORKFLOW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const targetKind = v.union(v.literal('artist'), v.literal('track'));
const reaction = v.union(v.literal('like'), v.literal('dislike'));
const reviewPreferenceValidator = v.object({
  id: v.id('preferences'),
  kind: targetKind,
  title: v.string(),
  artistNames: v.array(v.string()),
  version: v.optional(v.string()),
  reaction,
  reason: v.optional(v.string()),
});
const reviewClaimValidator = v.object({
  text: v.string(),
  evidenceIds: v.array(v.string()),
});
const reviewOutputValidator = v.object({
  overview: v.string(),
  overviewEvidenceIds: v.array(v.string()),
  drawnTo: v.array(reviewClaimValidator),
  avoids: v.array(reviewClaimValidator),
  nuances: v.array(reviewClaimValidator),
  evidenceLevel: v.union(v.literal('limited'), v.literal('developing')),
});
const reviewRunResultValidator = v.object({
  status: v.union(
    v.literal('committed'),
    v.literal('empty'),
    v.literal('obsolete'),
    v.literal('rejected'),
  ),
  inputCount: v.number(),
});
const startReviewResultValidator = v.object({
  started: v.boolean(),
  inProgress: v.boolean(),
});

type ReviewPreference = {
  id: Id<'preferences'>;
  kind: 'artist' | 'track';
  title: string;
  artistNames: string[];
  version?: string;
  reaction: 'like' | 'dislike';
  reason?: string;
};
type Snapshot = {
  preferences: ReviewPreference[];
  isPartial: boolean;
};
type ReviewRunResult = {
  status: 'committed' | 'empty' | 'obsolete' | 'rejected';
  inputCount: number;
};

export const startForUser = internalMutation({
  args: { userId: v.id('users') },
  returns: startReviewResultValidator,
  handler: async (ctx, { userId }) => {
    const profile = await ctx.db
      .query('tasteProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();
    if (!profile) return { started: false, inProgress: false };
    if (profile.workflowId) return { started: false, inProgress: true };
    return {
      started: await startTasteReview(ctx, profile, Date.now()),
      inProgress: false,
    };
  },
});

export const dispatchDue = internalMutation({
  args: { force: v.optional(v.boolean()) },
  returns: v.object({ started: v.number(), disabled: v.boolean() }),
  handler: async (ctx, { force }) => {
    if (!force && process.env.TASTE_OVERVIEW_ENABLED !== 'true')
      return { started: 0, disabled: true };
    const now = Date.now();
    const due = await ctx.db
      .query('tasteProfiles')
      .withIndex('by_nextReviewAt', (q) =>
        q.gte('nextReviewAt', 0).lte('nextReviewAt', now),
      )
      .order('asc')
      .take(20);
    let started = 0;
    for (const profile of due) {
      if (started >= 5 || profile.workflowId) continue;
      if (await startTasteReview(ctx, profile, now)) started++;
    }
    console.info('taste profile review dispatch', { started });
    return { started, disabled: false };
  },
});

async function startTasteReview(
  ctx: MutationCtx,
  profile: Doc<'tasteProfiles'>,
  startedAt: number,
) {
  if (!(await ctx.db.get(profile.userId))) {
    await ctx.db.delete(profile._id);
    return false;
  }
  const workflowId = await tasteReviewWorkflow.start(
    ctx,
    internal.tasteProfileWorkflows.runTasteReview,
    {
      userId: profile.userId,
      preferencesVersion: profile.preferencesVersion,
      startedAt,
    },
    {
      startAsync: true,
      onComplete: internal.tasteProfileWorkflows.completeTasteReview,
      context: {
        userId: profile.userId,
        preferencesVersion: profile.preferencesVersion,
      },
    },
  );
  await ctx.db.patch(profile._id, {
    workflowId,
    status: 'running',
    nextReviewAt: undefined,
    lastErrorCode: undefined,
  });
  return true;
}

export const snapshotPreferences = internalQuery({
  args: {
    userId: v.id('users'),
    workflowId: vWorkflowId,
    preferencesVersion: v.number(),
  },
  returns: v.union(
    v.null(),
    v.object({
      preferences: v.array(reviewPreferenceValidator),
      isPartial: v.boolean(),
    }),
  ),
  handler: async (ctx, args): Promise<Snapshot | null> => {
    const profile = await ctx.db
      .query('tasteProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique();
    if (
      !profile ||
      profile.workflowId !== args.workflowId ||
      profile.preferencesVersion !== args.preferencesVersion ||
      !(await ctx.db.get(args.userId))
    )
      return null;
    const records = await ctx.db
      .query('preferences')
      .withIndex('by_userId_updatedAt', (q) => q.eq('userId', args.userId))
      .order('desc')
      .take(MAX_REVIEWED_PREFERENCES + 1);
    const active = records
      .filter((preference) => !preference.removed)
      .slice(0, MAX_REVIEWED_PREFERENCES);
    return {
      preferences: await Promise.all(
        active.map((preference) => describePreference(ctx, preference)),
      ),
      isPartial: records.length > MAX_REVIEWED_PREFERENCES,
    };
  },
});

export const generateTasteOverview = internalAction({
  args: { preferences: v.array(reviewPreferenceValidator) },
  returns: v.object({ output: reviewOutputValidator, tokenUsage: v.number() }),
  handler: async (_ctx, args) => {
    await getServiceToken('ai-gateway');
    const preferenceIdsByEvidenceId = new Map<string, Id<'preferences'>>();
    const preferences = args.preferences.map((preference, index) => {
      const evidenceId = `p${index + 1}`;
      const { id, ...details } = preference;
      preferenceIdsByEvidenceId.set(evidenceId, id);
      return { evidenceId, ...details };
    });
    const evidenceIds = preferences.map(
      (preference) => preference.evidenceId,
    ) as [string, ...string[]];
    const result = await generateText({
      model: tasteReviewAgent.model,
      output: Output.object({ schema: tasteReviewOutputFor(evidenceIds) }),
      maxOutputTokens: 2048,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(90_000),
      providerOptions: { convexGateway: { reasoningEffort: 'medium' } },
      system: tasteReviewAgent.instructions,
      prompt: JSON.stringify({ preferences }),
    });
    const restorePreferenceIds = (ids: string[]) =>
      ids.map((id) => {
        const preferenceId = preferenceIdsByEvidenceId.get(id);
        if (!preferenceId)
          throw new Error(
            `Taste review returned unknown evidence alias: ${id}`,
          );
        return preferenceId;
      });
    const restoreClaimIds = (claims: TasteReviewOutput['drawnTo']) =>
      claims.map((claim) => ({
        ...claim,
        evidenceIds: restorePreferenceIds(claim.evidenceIds),
      }));
    return {
      output: {
        ...result.output,
        overviewEvidenceIds: restorePreferenceIds(
          result.output.overviewEvidenceIds,
        ),
        drawnTo: restoreClaimIds(result.output.drawnTo),
        avoids: restoreClaimIds(result.output.avoids),
        nuances: restoreClaimIds(result.output.nuances),
      },
      tokenUsage: result.usage.totalTokens ?? 0,
    };
  },
});

export const commitTasteReview = internalMutation({
  args: {
    userId: v.id('users'),
    workflowId: vWorkflowId,
    preferencesVersion: v.number(),
    reviewedPreferenceIds: v.array(v.id('preferences')),
    isPartial: v.boolean(),
    tokenUsage: v.number(),
    output: v.optional(reviewOutputValidator),
  },
  returns: reviewRunResultValidator,
  handler: async (ctx, args): Promise<ReviewRunResult> => {
    const profile = await ctx.db
      .query('tasteProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique();
    if (
      !profile ||
      profile.workflowId !== args.workflowId ||
      profile.preferencesVersion !== args.preferencesVersion ||
      !(await ctx.db.get(args.userId))
    )
      return {
        status: 'obsolete',
        inputCount: args.reviewedPreferenceIds.length,
      };

    if (!args.reviewedPreferenceIds.length) {
      await ctx.db.patch(profile._id, {
        status: 'empty',
        summaryVersion: args.preferencesVersion,
        overview: undefined,
        generatedAt: Date.now(),
        reviewedPreferenceCount: 0,
        coverage: 'complete',
        model: CHAT_MODEL,
        promptVersion: TASTE_REVIEW_PROMPT_VERSION,
        lastErrorCode: undefined,
      });
      return { status: 'empty', inputCount: 0 };
    }
    if (!args.output) {
      await ctx.db.patch(profile._id, {
        status: 'failed',
        overview: undefined,
        lastErrorCode: 'MISSING_REVIEW_OUTPUT',
      });
      return {
        status: 'rejected',
        inputCount: args.reviewedPreferenceIds.length,
      };
    }

    const expected = new Set(args.reviewedPreferenceIds);
    const evidenceIds = new Set([
      ...args.output.overviewEvidenceIds,
      ...args.output.drawnTo.flatMap((claim) => claim.evidenceIds),
      ...args.output.avoids.flatMap((claim) => claim.evidenceIds),
      ...args.output.nuances.flatMap((claim) => claim.evidenceIds),
    ]);
    const evidenceIsValid =
      evidenceIds.size > 0 &&
      [...evidenceIds].every((id) => expected.has(id as Id<'preferences'>));
    if (!evidenceIsValid) {
      await ctx.db.patch(profile._id, {
        status: 'failed',
        overview: undefined,
        lastErrorCode: 'INVALID_REVIEW_EVIDENCE',
      });
      return {
        status: 'rejected',
        inputCount: args.reviewedPreferenceIds.length,
      };
    }
    const sourcePreferences = await Promise.all(
      [...evidenceIds].map((id) => ctx.db.get(id as Id<'preferences'>)),
    );
    if (
      sourcePreferences.some(
        (preference) =>
          !preference ||
          preference.userId !== args.userId ||
          preference.removed,
      )
    ) {
      await ctx.db.patch(profile._id, {
        status: 'failed',
        overview: undefined,
        lastErrorCode: 'UNAVAILABLE_REVIEW_EVIDENCE',
      });
      return {
        status: 'rejected',
        inputCount: args.reviewedPreferenceIds.length,
      };
    }

    await ctx.db.patch(profile._id, {
      status: 'ready',
      summaryVersion: args.preferencesVersion,
      overview: toStoredOverview(args.output),
      generatedAt: Date.now(),
      reviewedPreferenceCount: args.reviewedPreferenceIds.length,
      coverage: args.isPartial ? 'partial' : 'complete',
      model: CHAT_MODEL,
      promptVersion: TASTE_REVIEW_PROMPT_VERSION,
      lastErrorCode: undefined,
    });
    console.info('taste profile review committed', {
      workflowId: args.workflowId,
      preferencesVersion: args.preferencesVersion,
      preferenceCount: args.reviewedPreferenceIds.length,
      isPartial: args.isPartial,
      tokenUsage: args.tokenUsage,
    });
    return {
      status: 'committed',
      inputCount: args.reviewedPreferenceIds.length,
    };
  },
});

export const runTasteReview = tasteReviewWorkflow
  .define({
    args: {
      userId: v.id('users'),
      preferencesVersion: v.number(),
      startedAt: v.number(),
    },
    returns: reviewRunResultValidator,
  })
  .handler(async (step, args): Promise<ReviewRunResult> => {
    const snapshot = await step.runQuery(
      internal.tasteProfileWorkflows.snapshotPreferences,
      {
        userId: args.userId,
        workflowId: step.workflowId,
        preferencesVersion: args.preferencesVersion,
      },
      { name: 'snapshot-preferences' },
    );
    if (!snapshot) return { status: 'obsolete', inputCount: 0 };

    const selected: ReviewPreference[] = [];
    let usedCharacters = 200;
    for (const preference of snapshot.preferences) {
      const cost = JSON.stringify(preference).length;
      if (selected.length && usedCharacters + cost > MAX_INPUT_CHARACTERS)
        break;
      selected.push(preference);
      usedCharacters += cost;
    }
    const isPartial =
      snapshot.isPartial || selected.length < snapshot.preferences.length;
    if (!selected.length)
      return step.runMutation(
        internal.tasteProfileWorkflows.commitTasteReview,
        {
          userId: args.userId,
          workflowId: step.workflowId,
          preferencesVersion: args.preferencesVersion,
          reviewedPreferenceIds: [],
          isPartial: false,
          tokenUsage: 0,
        },
      );

    const reviewedPreferenceIds = selected.map((preference) => preference.id);
    const generated = await step.runAction(
      internal.tasteProfileWorkflows.generateTasteOverview,
      { preferences: selected },
      {
        name: 'generate-taste-overview',
        retry: { maxAttempts: 3, initialBackoffMs: 1_000, base: 2 },
      },
    );
    return step.runMutation(internal.tasteProfileWorkflows.commitTasteReview, {
      userId: args.userId,
      workflowId: step.workflowId,
      preferencesVersion: args.preferencesVersion,
      reviewedPreferenceIds,
      isPartial,
      tokenUsage: generated.tokenUsage,
      output: generated.output,
    });
  });

export const completeTasteReview = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({
      userId: v.id('users'),
      preferencesVersion: v.number(),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query('tasteProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.context.userId))
      .unique();
    if (!profile || profile.workflowId !== args.workflowId) return null;
    const hasNewPreferences =
      profile.preferencesVersion !== args.context.preferencesVersion;
    if (args.result.kind !== 'success') {
      await ctx.db.patch(profile._id, {
        workflowId: undefined,
        status: hasNewPreferences ? 'pending' : 'failed',
        nextReviewAt: hasNewPreferences
          ? (profile.nextReviewAt ?? Date.now())
          : undefined,
        lastErrorCode:
          args.result.kind === 'canceled'
            ? 'TASTE_REVIEW_CANCELED'
            : 'TASTE_REVIEW_FAILED',
      });
      console.error('taste profile review terminal failure', {
        workflowId: args.workflowId,
        errorCode:
          args.result.kind === 'canceled'
            ? 'TASTE_REVIEW_CANCELED'
            : 'TASTE_REVIEW_FAILED',
      });
      return null;
    }
    const rejected = args.result.returnValue.status === 'rejected';
    await ctx.db.patch(profile._id, {
      workflowId: undefined,
      status: hasNewPreferences
        ? 'pending'
        : rejected
          ? 'failed'
          : profile.status,
      nextReviewAt: hasNewPreferences
        ? (profile.nextReviewAt ?? Date.now())
        : undefined,
    });
    await ctx.scheduler.runAfter(
      COMPLETED_WORKFLOW_RETENTION_MS,
      internal.tasteProfileWorkflows.cleanupCompletedTasteReview,
      { workflowId: args.workflowId },
    );
    return null;
  },
});

export const cleanupCompletedTasteReview = internalMutation({
  args: { workflowId: vWorkflowId },
  returns: v.null(),
  handler: async (ctx, { workflowId }) => {
    const referenced = await ctx.db
      .query('tasteProfiles')
      .withIndex('by_workflowId', (q) => q.eq('workflowId', workflowId))
      .unique();
    if (!referenced)
      await cleanupWorkflow(ctx, components.workflow, workflowId);
    return null;
  },
});

async function describePreference(
  ctx: QueryCtx,
  preference: {
    _id: Id<'preferences'>;
    target:
      | { kind: 'artist'; artistId: Id<'artists'> }
      | {
          kind: 'track';
          trackId: Id<'tracks'>;
        };
    reaction: 'like' | 'dislike';
    reason?: string;
  },
): Promise<ReviewPreference> {
  if (preference.target.kind === 'artist') {
    const artist = await ctx.db.get(preference.target.artistId);
    return {
      id: preference._id,
      kind: 'artist',
      title: artist?.name ?? 'Unknown artist',
      artistNames: [],
      reaction: preference.reaction,
      ...(preference.reason ? { reason: preference.reason } : {}),
    };
  }
  const track = await ctx.db.get(preference.target.trackId);
  if (!track)
    return {
      id: preference._id,
      kind: 'track',
      title: 'Unknown track',
      artistNames: [],
      reaction: preference.reaction,
      ...(preference.reason ? { reason: preference.reason } : {}),
    };
  const artists = await Promise.all(
    track.artistIds.map((artistId) => ctx.db.get(artistId)),
  );
  return {
    id: preference._id,
    kind: 'track',
    title: track.title,
    artistNames: artists.map((artist) => artist?.name ?? 'Unknown artist'),
    ...(track.version ? { version: track.version } : {}),
    reaction: preference.reaction,
    ...(preference.reason ? { reason: preference.reason } : {}),
  };
}

function toStoredOverview(output: TasteReviewOutput) {
  const asPreferenceIds = (ids: string[]) => ids as Id<'preferences'>[];
  const claims = (items: TasteReviewOutput['drawnTo']) =>
    items.map((item) => ({
      text: item.text,
      evidenceIds: asPreferenceIds(item.evidenceIds),
    }));
  return {
    overview: output.overview,
    overviewEvidenceIds: asPreferenceIds(output.overviewEvidenceIds),
    drawnTo: claims(output.drawnTo),
    avoids: claims(output.avoids),
    nuances: claims(output.nuances),
    evidenceLevel: output.evidenceLevel,
  };
}
