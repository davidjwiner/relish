import {
  WorkflowManager,
  cleanup as cleanupWorkflow,
  getStatus as getWorkflowStatus,
  restart as restartWorkflow,
  vWorkflowId,
  vResultValidator,
  type WorkflowId,
} from '@convex-dev/workflow';
import { v } from 'convex/values';
import { getServiceToken } from 'convex/server';
import { generateText, Output } from 'ai';
import { components, internal } from './_generated/api';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
} from './_generated/server';
import type { Id } from './_generated/dataModel';
import {
  identityText,
  preferenceExtractor,
  type ExtractionCandidate,
} from './lib/preferenceExtraction';
import { markTasteProfileStale } from './lib/tasteProfileState';
import { currentUser } from './lib/preferenceAuth';

const extractionWorkflow = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: 2 },
});
const MAX_BATCH_USER_MESSAGES = 10;
const MAX_INPUT_CHARACTERS = 24_000;
const COMPLETED_WORKFLOW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const transcriptMessageValidator = v.object({
  id: v.string(),
  role: v.union(v.literal('user'), v.literal('assistant')),
  text: v.string(),
  order: v.number(),
  createdAt: v.number(),
});
const targetValidator = v.union(
  v.object({ kind: v.literal('artist'), name: v.string() }),
  v.object({
    kind: v.literal('track'),
    title: v.string(),
    artists: v.array(v.string()),
    version: v.union(v.string(), v.null()),
  }),
);
const candidateValidator = v.object({
  target: targetValidator,
  operation: v.union(
    v.literal('like'),
    v.literal('dislike'),
    v.literal('remove'),
  ),
  evidence: v.object({ messageId: v.string(), quote: v.string() }),
  reason: v.optional(v.union(v.string(), v.null())),
});
type TranscriptMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  order: number;
  createdAt: number;
};
type SnapshotPage = {
  latestUserOrder: number;
  messages: TranscriptMessage[];
  continueCursor: string;
  isDone: boolean;
};
type ExtractionResult = {
  candidates: ExtractionCandidate[];
  tokenUsage: number;
};
type CommitResult = {
  status: 'committed' | 'obsolete';
  applied: number;
  discarded: number;
};
async function dispatchDueWork(
  ctx: MutationCtx,
  { force, userId }: { force?: boolean; userId?: Id<'users'> },
): Promise<{ started: number; disabled: boolean; inProgress: boolean }> {
  if (!force && process.env.PREFERENCE_EXTRACTION_ENABLED !== 'true')
    return { started: 0, disabled: true, inProgress: false };
  const now = Date.now();
  const due = userId
    ? await ctx.db
        .query('conversationPreferenceState')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect()
    : await ctx.db
        .query('conversationPreferenceState')
        .withIndex('by_next_review', (q) =>
          q.gte('nextReviewAt', 0).lte('nextReviewAt', now),
        )
        .order('asc')
        .take(30);
  let inProgress = false;
  let started = 0;
  for (const state of due) {
    if (!force && (!state.nextReviewAt || state.nextReviewAt > now)) continue;
    if (state.workflowId) {
      inProgress = true;
      continue;
    }
    if (started >= 10 || state.processedThroughOrder >= state.latestUserOrder)
      continue;
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: state.threadId,
    });
    if (!thread || thread.userId !== state.userId) {
      await ctx.db.delete(state._id);
      continue;
    }
    const workflowId = await extractionWorkflow.start(
      ctx,
      internal.preferenceWorkflows.runExtraction,
      {
        userId: state.userId,
        threadId: state.threadId,
        startCheckpoint: state.processedThroughOrder,
        startedAt: now,
      },
      {
        startAsync: true,
        onComplete: internal.preferenceWorkflows.completeExtraction,
        context: { userId: state.userId, threadId: state.threadId },
      },
    );
    await ctx.db.patch(state._id, {
      workflowId,
      nextReviewAt: undefined,
      lastErrorCode: undefined,
    });
    started++;
  }
  console.info('preference extraction dispatch', { started });
  return { started, disabled: false, inProgress };
}

// Preference extraction never appends messages to an Agent thread.
export const dispatchDue = internalMutation({
  args: { force: v.optional(v.boolean()) },
  returns: v.object({
    started: v.number(),
    disabled: v.boolean(),
    inProgress: v.boolean(),
  }),
  handler: (ctx, { force }) => dispatchDueWork(ctx, { force }),
});

export const requestExtraction = mutation({
  args: {},
  returns: v.object({ started: v.number(), inProgress: v.boolean() }),
  handler: async (ctx) => {
    const { started, inProgress } = await dispatchDueWork(ctx, {
      force: true,
      userId: await currentUser(ctx),
    });
    return { started, inProgress };
  },
});

export const snapshotPage = internalQuery({
  args: {
    userId: v.id('users'),
    threadId: v.string(),
    workflowId: vWorkflowId,
    startCheckpoint: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.union(
    v.null(),
    v.object({
      latestUserOrder: v.number(),
      messages: v.array(transcriptMessageValidator),
      continueCursor: v.string(),
      isDone: v.boolean(),
    }),
  ),
  handler: async (ctx, args): Promise<SnapshotPage | null> => {
    const state = await ctx.db
      .query('conversationPreferenceState')
      .withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
      .unique();
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: args.threadId,
    });
    if (
      !state ||
      !thread ||
      thread.userId !== args.userId ||
      state.userId !== args.userId ||
      state.workflowId !== args.workflowId ||
      state.processedThroughOrder !== args.startCheckpoint ||
      !(await ctx.db.get(args.userId))
    )
      return null;
    const page = await ctx.runQuery(
      components.agent.messages.listMessagesByThreadId,
      {
        threadId: args.threadId,
        order: 'asc',
        statuses: ['success'],
        excludeToolMessages: true,
        paginationOpts: { cursor: args.cursor, numItems: 100 },
      },
    );
    return {
      latestUserOrder: state.latestUserOrder,
      messages: page.page.flatMap((message) => {
        const role = message.message?.role;
        if ((role !== 'user' && role !== 'assistant') || !message.text?.trim())
          return [];
        return [
          {
            id: message._id,
            role,
            text: message.text,
            order: message.order,
            createdAt: message._creationTime,
          },
        ];
      }),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const extractPreferences = internalAction({
  args: {
    messages: v.array(transcriptMessageValidator),
    newMessageIds: v.array(v.string()),
  },
  returns: v.object({
    candidates: v.array(candidateValidator),
    tokenUsage: v.number(),
  }),
  handler: async (_ctx, args): Promise<ExtractionResult> => {
    await getServiceToken('ai-gateway');
    const result = await generateText({
      model: preferenceExtractor.model,
      output: Output.object({ schema: preferenceExtractor.output }),
      maxOutputTokens: 4096,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(90_000),
      providerOptions: { convexGateway: { reasoningEffort: 'medium' } },
      system: preferenceExtractor.instructions,
      prompt: JSON.stringify({
        evidenceMessageIds: args.newMessageIds,
        transcript: args.messages,
      }),
    });
    return {
      candidates: result.output.candidates,
      tokenUsage: result.usage.totalTokens ?? 0,
    };
  },
});

function newerEvidence(
  existing: {
    sourceCreatedAt?: number;
    sourceMessageId?: string;
    updatedAt: number;
    originatingMessageId: string;
  },
  createdAt: number,
  messageId: string,
) {
  const oldTime = existing.sourceCreatedAt ?? existing.updatedAt;
  const oldId = existing.sourceMessageId ?? existing.originatingMessageId;
  return createdAt > oldTime || (createdAt === oldTime && messageId > oldId);
}

async function resolveTarget(
  ctx: MutationCtx,
  target: ExtractionCandidate['target'],
) {
  if (target.kind === 'artist') {
    const identityKey = identityText(target.name);
    if (!identityKey) return null;
    let artist = await ctx.db
      .query('artists')
      .withIndex('by_identity', (q) => q.eq('identityKey', identityKey))
      .unique();
    if (!artist) {
      const id = await ctx.db.insert('artists', {
        name: target.name.trim(),
        identityKey,
      });
      artist = (await ctx.db.get(id))!;
    }
    return {
      target: { kind: 'artist' as const, artistId: artist._id },
      targetKey: `artist:${artist._id}`,
    };
  }
  const artistIds: Id<'artists'>[] = [];
  const artistKeys: string[] = [];
  for (const name of target.artists) {
    const identityKey = identityText(name);
    if (!identityKey) return null;
    let artist = await ctx.db
      .query('artists')
      .withIndex('by_identity', (q) => q.eq('identityKey', identityKey))
      .unique();
    if (!artist) {
      const id = await ctx.db.insert('artists', {
        name: name.trim(),
        identityKey,
      });
      artist = (await ctx.db.get(id))!;
    }
    artistIds.push(artist._id);
    artistKeys.push(identityKey);
  }
  const titleKey = identityText(target.title);
  const version = target.version?.trim() || undefined;
  if (!titleKey || !artistIds.length) return null;
  const identityKey = [
    titleKey,
    artistKeys.join('|'),
    identityText(version ?? ''),
  ].join('::');
  let track = await ctx.db
    .query('tracks')
    .withIndex('by_identity', (q) => q.eq('identityKey', identityKey))
    .unique();
  if (!track) {
    const id = await ctx.db.insert('tracks', {
      title: target.title.trim(),
      artistIds,
      version,
      identityKey,
    });
    track = (await ctx.db.get(id))!;
  }
  return {
    target: { kind: 'track' as const, trackId: track._id },
    targetKey: `track:${track._id}`,
  };
}

export const commitExtraction = internalMutation({
  args: {
    userId: v.id('users'),
    threadId: v.string(),
    workflowId: vWorkflowId,
    startCheckpoint: v.number(),
    capturedEndOrder: v.number(),
    evidenceMessageIds: v.array(v.string()),
    candidates: v.array(candidateValidator),
    tokenUsage: v.number(),
    startedAt: v.number(),
  },
  returns: v.object({
    status: v.union(v.literal('committed'), v.literal('obsolete')),
    applied: v.number(),
    discarded: v.number(),
  }),
  handler: async (ctx, args): Promise<CommitResult> => {
    const state = await ctx.db
      .query('conversationPreferenceState')
      .withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
      .unique();
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: args.threadId,
    });
    if (
      !state ||
      !thread ||
      thread.userId !== args.userId ||
      state.userId !== args.userId ||
      state.workflowId !== args.workflowId ||
      state.processedThroughOrder !== args.startCheckpoint ||
      !(await ctx.db.get(args.userId))
    )
      return { status: 'obsolete' as const, applied: 0, discarded: 0 };
    const allowedIds = new Set(args.evidenceMessageIds);
    const ids = [...new Set(args.candidates.map((c) => c.evidence.messageId))];
    const messages = await ctx.runQuery(
      components.agent.messages.getMessagesByIds,
      { messageIds: ids },
    );
    const evidence = new Map(messages.filter(Boolean).map((m) => [m!._id, m!]));
    const valid = args.candidates
      .flatMap((candidate) => {
        const message = evidence.get(candidate.evidence.messageId);
        if (
          !message ||
          !allowedIds.has(message._id) ||
          message.threadId !== args.threadId ||
          message.userId !== args.userId ||
          message.message?.role !== 'user' ||
          message.order <= args.startCheckpoint ||
          message.order > args.capturedEndOrder ||
          !message.text?.includes(candidate.evidence.quote) ||
          (candidate.reason && !message.text.includes(candidate.reason))
        )
          return [];
        return [{ candidate, message }];
      })
      .sort(
        (a, b) =>
          a.message._creationTime - b.message._creationTime ||
          a.message._id.localeCompare(b.message._id),
      );
    let applied = 0;
    for (const { candidate, message } of valid) {
      const resolved = await resolveTarget(ctx, candidate.target);
      if (!resolved) continue;
      const existing = await ctx.db
        .query('preferences')
        .withIndex('by_user_target', (q) =>
          q.eq('userId', args.userId).eq('targetKey', resolved.targetKey),
        )
        .unique();
      if (
        existing &&
        !newerEvidence(existing, message._creationTime, message._id)
      )
        continue;
      const now = Date.now();
      const fields = {
        userId: args.userId,
        target: resolved.target,
        targetKey: resolved.targetKey,
        reaction:
          candidate.operation === 'dislike'
            ? ('dislike' as const)
            : ('like' as const),
        reason: candidate.reason || undefined,
        originatingMessageId: message._id,
        sourceThreadId: args.threadId,
        sourceMessageId: message._id,
        sourceQuote: candidate.evidence.quote.slice(0, 500),
        sourceCreatedAt: message._creationTime,
        removed: candidate.operation === 'remove' || undefined,
        updatedAt: now,
        revision: (existing?.revision ?? 0) + 1,
      };
      if (existing) await ctx.db.patch(existing._id, fields);
      else await ctx.db.insert('preferences', { ...fields, createdAt: now });
      applied++;
    }
    if (applied) await markTasteProfileStale(ctx, args.userId, Date.now());
    await ctx.db.patch(state._id, {
      processedThroughOrder: args.capturedEndOrder,
      nextReviewAt:
        state.latestUserOrder > args.capturedEndOrder
          ? Math.max(state.nextReviewAt ?? 0, Date.now())
          : undefined,
      lastErrorCode: undefined,
    });
    console.info('preference extraction committed', {
      workflowId: args.workflowId,
      candidates: args.candidates.length,
      applied,
      discarded: args.candidates.length - valid.length,
      tokenUsage: args.tokenUsage,
      durationMs: Date.now() - args.startedAt,
      checkpointLag: Math.max(0, state.latestUserOrder - args.capturedEndOrder),
    });
    return {
      status: 'committed' as const,
      applied,
      discarded: args.candidates.length - valid.length,
    };
  },
});

export const runExtraction = extractionWorkflow
  .define({
    args: {
      userId: v.id('users'),
      threadId: v.string(),
      startCheckpoint: v.number(),
      startedAt: v.number(),
    },
    returns: v.object({
      status: v.union(v.literal('committed'), v.literal('obsolete')),
      applied: v.number(),
      discarded: v.number(),
    }),
  })
  .handler(async (step, args): Promise<CommitResult> => {
    let cursor: string | null = null;
    let latestUserOrder: number | undefined;
    let preceding: TranscriptMessage[] = [];
    let batch: typeof preceding = [];
    let capturedEndOrder: number | undefined;
    let stop = false;
    do {
      const page: SnapshotPage | null = await step.runQuery(
        internal.preferenceWorkflows.snapshotPage,
        {
          userId: args.userId,
          threadId: args.threadId,
          startCheckpoint: args.startCheckpoint,
          workflowId: step.workflowId,
          cursor,
        },
        { name: `snapshot-${cursor ?? 'start'}` },
      );
      if (!page)
        return { status: 'obsolete' as const, applied: 0, discarded: 0 };
      latestUserOrder ??= page.latestUserOrder;
      for (const message of page.messages) {
        if (message.order > latestUserOrder!) {
          stop = true;
          break;
        }
        if (message.order <= args.startCheckpoint) {
          preceding.push(message);
          preceding = preceding.slice(-6);
          continue;
        }
        if (
          capturedEndOrder !== undefined &&
          message.order > capturedEndOrder
        ) {
          stop = true;
          break;
        }
        batch.push(message);
        if (
          message.role === 'user' &&
          batch.filter((item) => item.role === 'user').length ===
            MAX_BATCH_USER_MESSAGES
        )
          capturedEndOrder = message.order;
      }
      cursor = page.continueCursor;
      if (page.isDone) stop = true;
    } while (!stop);

    const newUsers = batch.filter((message) => message.role === 'user');
    if (!newUsers.length) {
      // The state can outlive manually removed Agent messages. Do not spin on it.
      capturedEndOrder = latestUserOrder ?? args.startCheckpoint;
      batch = [];
    } else if (capturedEndOrder === undefined) {
      capturedEndOrder = newUsers.at(-1)!.order;
    }

    // Fit complete messages only. New evidence has priority over context, and
    // at least one user prompt always fits because chat limits it to 8k chars.
    const selectedBatch: typeof batch = [];
    let used = 200;
    let selectedEndOrder = args.startCheckpoint;
    for (const message of batch) {
      const cost = message.text.length + 160;
      if (used + cost > MAX_INPUT_CHARACTERS) break;
      selectedBatch.push(message);
      used += cost;
      if (message.role === 'user') selectedEndOrder = message.order;
    }
    if (newUsers.length && selectedEndOrder === args.startCheckpoint) {
      const first = newUsers[0];
      selectedBatch.push(first);
      selectedEndOrder = first.order;
      used += first.text.length + 160;
    }
    capturedEndOrder = Math.min(capturedEndOrder, selectedEndOrder);
    selectedBatch.splice(
      0,
      selectedBatch.length,
      ...selectedBatch.filter((message) => message.order <= capturedEndOrder!),
    );
    const selectedContext: typeof preceding = [];
    for (const message of [...preceding].reverse()) {
      const cost = message.text.length + 160;
      if (used + cost > MAX_INPUT_CHARACTERS) continue;
      selectedContext.unshift(message);
      used += cost;
    }
    const messages = [...selectedContext, ...selectedBatch];
    const evidenceMessageIds = selectedBatch
      .filter((message) => message.role === 'user')
      .map((message) => message.id);
    const extracted = evidenceMessageIds.length
      ? await step.runAction(
          internal.preferenceWorkflows.extractPreferences,
          { messages, newMessageIds: evidenceMessageIds },
          {
            name: 'extract-preferences',
            retry: { maxAttempts: 3, initialBackoffMs: 1000, base: 2 },
          },
        )
      : { candidates: [], tokenUsage: 0 };
    return step.runMutation(internal.preferenceWorkflows.commitExtraction, {
      ...args,
      workflowId: step.workflowId,
      capturedEndOrder,
      evidenceMessageIds,
      candidates: extracted.candidates,
      tokenUsage: extracted.tokenUsage,
      startedAt: args.startedAt,
    });
  });

export const completeExtraction = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ userId: v.id('users'), threadId: v.string() }),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<void> => {
    const state = await ctx.db
      .query('conversationPreferenceState')
      .withIndex('by_thread', (q) => q.eq('threadId', args.context.threadId))
      .unique();
    if (!state || state.workflowId !== args.workflowId) return;
    if (args.result.kind !== 'success') {
      await ctx.db.patch(state._id, {
        lastErrorCode:
          args.result.kind === 'canceled'
            ? 'WORKFLOW_CANCELED'
            : 'EXTRACTION_WORKFLOW_FAILED',
      });
      console.error('preference extraction terminal failure', {
        workflowId: args.workflowId,
        errorCode:
          args.result.kind === 'canceled'
            ? 'WORKFLOW_CANCELED'
            : 'EXTRACTION_WORKFLOW_FAILED',
      });
      return;
    }
    await ctx.db.patch(state._id, {
      workflowId: undefined,
      lastErrorCode: undefined,
      nextReviewAt:
        state.latestUserOrder > state.processedThroughOrder
          ? Math.max(state.nextReviewAt ?? 0, Date.now())
          : undefined,
    });
    await ctx.scheduler.runAfter(
      COMPLETED_WORKFLOW_RETENTION_MS,
      internal.preferenceWorkflows.cleanupCompletedExtraction,
      { workflowId: args.workflowId },
    );
  },
});

export const cleanupCompletedExtraction = internalMutation({
  args: { workflowId: vWorkflowId },
  returns: v.null(),
  handler: async (ctx, { workflowId }): Promise<void> => {
    const referenced = await ctx.db
      .query('conversationPreferenceState')
      .filter((q) => q.eq(q.field('workflowId'), workflowId))
      .first();
    if (!referenced)
      await cleanupWorkflow(ctx, components.workflow, workflowId);
  },
});

export const restartFailedExtraction = internalMutation({
  args: { threadId: v.string() },
  returns: v.object({ restarted: v.boolean() }),
  handler: async (ctx, { threadId }): Promise<{ restarted: boolean }> => {
    const state = await ctx.db
      .query('conversationPreferenceState')
      .withIndex('by_thread', (q) => q.eq('threadId', threadId))
      .unique();
    if (!state?.workflowId || !state.lastErrorCode) return { restarted: false };
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId,
    });
    if (
      !thread ||
      thread.userId !== state.userId ||
      !(await ctx.db.get(state.userId))
    )
      return { restarted: false };
    const workflowId = state.workflowId as WorkflowId;
    const status = await getWorkflowStatus(
      ctx,
      components.workflow,
      workflowId,
    );
    if (status.type !== 'failed') return { restarted: false };
    await restartWorkflow(ctx, components.workflow, workflowId);
    await ctx.db.patch(state._id, { lastErrorCode: undefined });
    return { restarted: true };
  },
});

export const seedBackfillState = internalMutation({
  args: {
    userId: v.id('users'),
    threadId: v.string(),
    latestUserOrder: v.number(),
    latestUserCreatedAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const existing = await ctx.db
      .query('conversationPreferenceState')
      .withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
      .unique();
    if (existing) return false;
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: args.threadId,
    });
    if (
      !thread ||
      thread.userId !== args.userId ||
      !(await ctx.db.get(args.userId))
    )
      return false;
    await ctx.db.insert('conversationPreferenceState', {
      userId: args.userId,
      threadId: args.threadId,
      processedThroughOrder: -1,
      latestUserOrder: args.latestUserOrder,
      nextReviewAt: args.latestUserCreatedAt + REVIEW_DELAY_MS,
    });
    return true;
  },
});

const REVIEW_DELAY_MS = 60_000;

// Processes one user's bounded thread page. The returned cursors make the
// backfill resumable without a custom queue or duplicated transcript data.
export const backfillPage = internalAction({
  args: {
    userCursor: v.optional(v.string()),
    userId: v.optional(v.id('users')),
    nextUserCursor: v.optional(v.string()),
    threadCursor: v.optional(v.string()),
  },
  returns: v.object({
    seeded: v.number(),
    userId: v.optional(v.id('users')),
    userCursor: v.optional(v.string()),
    nextUserCursor: v.optional(v.string()),
    threadCursor: v.optional(v.string()),
    done: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    seeded: number;
    userId?: Id<'users'>;
    userCursor?: string;
    nextUserCursor?: string;
    threadCursor?: string;
    done: boolean;
  }> => {
    let userId = args.userId;
    let nextUserCursor = args.nextUserCursor;
    if (!userId) {
      const users = await ctx.runQuery(
        components.agent.users.listUsersWithThreads,
        {
          paginationOpts: {
            cursor: args.userCursor ?? null,
            numItems: 1,
          },
        },
      );
      const rawUserId = users.page[0];
      if (!rawUserId) return { seeded: 0, done: true };
      userId = rawUserId as Id<'users'>;
      nextUserCursor = users.continueCursor;
    }
    const threads = await ctx.runQuery(
      components.agent.threads.listThreadsByUserId,
      {
        userId,
        order: 'asc',
        paginationOpts: {
          cursor: args.threadCursor ?? null,
          numItems: 20,
        },
      },
    );
    let seeded = 0;
    for (const thread of threads.page) {
      const messages = await ctx.runQuery(
        components.agent.messages.listMessagesByThreadId,
        {
          threadId: thread._id,
          order: 'desc',
          statuses: ['success'],
          excludeToolMessages: true,
          paginationOpts: { cursor: null, numItems: 20 },
        },
      );
      const latest = messages.page.find(
        (message) => message.message?.role === 'user',
      );
      if (
        latest &&
        (await ctx.runMutation(internal.preferenceWorkflows.seedBackfillState, {
          userId,
          threadId: thread._id,
          latestUserOrder: latest.order,
          latestUserCreatedAt: latest._creationTime,
        }))
      )
        seeded++;
    }
    if (!threads.isDone)
      return {
        seeded,
        userId,
        nextUserCursor,
        threadCursor: threads.continueCursor,
        done: false,
      };
    return {
      seeded,
      userCursor: nextUserCursor,
      done: false,
    };
  },
});
