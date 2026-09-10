import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import { listMessages } from '@convex-dev/agent';
import { describe, expect, it, vi } from 'vitest';
import { registerWorkflow } from '../test-support/workflow';
import schema from './schema';
import { api, components, internal } from './_generated/api';

vi.mock('convex/server', async (original) => ({
  ...(await original<typeof import('convex/server')>()),
  getServiceToken: vi.fn(async () => 'test-token'),
}));
vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateText: vi.fn(async (args: { prompt: string }) => {
    const input = JSON.parse(args.prompt) as {
      evidenceMessageIds: string[];
    };
    return {
      output: {
        candidates: [
          {
            target: { kind: 'artist', name: 'Adrianne Lenker' },
            operation: 'like',
            evidence: {
              messageId: input.evidenceMessageIds[0],
              quote: 'I love Adrianne Lenker',
            },
          },
        ],
      },
      usage: { totalTokens: 42 },
    };
  }),
}));

const modules = import.meta.glob('./**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  registerWorkflow(t);
  const userId = await t.run((ctx) =>
    ctx.db.insert('users', { name: 'Alice' }),
  );
  const user = t.withIdentity({ subject: `${userId}|session` });
  return { t, user, userId };
}

describe('background conversation preference extraction', () => {
  it('runs extraction end to end without adding a chat message', async () => {
    vi.useFakeTimers();
    try {
      const { t, user } = await setup();
      const saved = await user.mutation(api.chat.send, {
        prompt: 'I love Adrianne Lenker.',
      });
      expect(
        await user.mutation(api.preferenceWorkflows.requestExtraction, {}),
      ).toMatchObject({ started: 1, inProgress: false });
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const preferences = await user.query(api.preferences.list, {
        paginationOpts: { cursor: null, numItems: 30 },
      });
      expect(preferences.page).toHaveLength(1);
      expect(preferences.page[0]).toMatchObject({
        name: 'Adrianne Lenker',
        reaction: 'like',
        sourceMessageId: saved.promptMessageId,
      });
      const messages = await t.run((ctx) =>
        listMessages(ctx, components.agent, {
          threadId: saved.threadId,
          paginationOpts: { cursor: null, numItems: 30 },
        }),
      );
      expect(messages.page.map((message) => message.message?.role)).toEqual([
        'user',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('checkpoints sends and prevents overlapping workflow dispatch', async () => {
    const { t, user, userId } = await setup();
    const saved = await user.mutation(api.chat.send, {
      prompt: 'I love Stick Season because of the storytelling.',
    });
    const initial = await t.run((ctx) =>
      ctx.db
        .query('conversationPreferenceState')
        .withIndex('by_thread', (q) => q.eq('threadId', saved.threadId))
        .unique(),
    );
    expect(initial).toMatchObject({
      userId,
      threadId: saved.threadId,
      processedThroughOrder: -1,
      latestUserOrder: 0,
    });
    expect(initial?.nextReviewAt).toBeTypeOf('number');
    await t.run((ctx) => ctx.db.patch(initial!._id, { nextReviewAt: 0 }));

    expect(
      await t.mutation(internal.preferenceWorkflows.dispatchDue, {
        force: true,
      }),
    ).toMatchObject({ started: 1 });
    expect(
      await t.mutation(internal.preferenceWorkflows.dispatchDue, {
        force: true,
      }),
    ).toMatchObject({ started: 0 });
  });

  it('validates evidence, writes provenance idempotently, and tombstones removals', async () => {
    const { t, user, userId } = await setup();
    const first = await user.mutation(api.chat.send, {
      prompt: 'I love Stick Season because of the storytelling.',
    });
    let state = await t.run((ctx) =>
      ctx.db
        .query('conversationPreferenceState')
        .withIndex('by_thread', (q) => q.eq('threadId', first.threadId))
        .unique(),
    );
    await t.run((ctx) => ctx.db.patch(state!._id, { nextReviewAt: 0 }));
    await t.mutation(internal.preferenceWorkflows.dispatchDue, { force: true });
    state = await t.run((ctx) => ctx.db.get(state!._id));

    const committed = await t.mutation(
      internal.preferenceWorkflows.commitExtraction,
      {
        userId,
        threadId: first.threadId,
        workflowId: state!.workflowId as never,
        startCheckpoint: -1,
        capturedEndOrder: 0,
        evidenceMessageIds: [first.promptMessageId],
        candidates: [
          {
            target: {
              kind: 'track',
              title: 'Stick Season',
              artists: ['Noah Kahan'],
              version: null,
            },
            operation: 'like',
            evidence: {
              messageId: first.promptMessageId,
              quote: 'I love Stick Season',
            },
            reason: 'because of the storytelling',
          },
          {
            target: { kind: 'artist', name: 'Noah Kahan' },
            operation: 'like',
            evidence: {
              messageId: first.promptMessageId,
              quote: 'fabricated quotation',
            },
          },
        ],
        tokenUsage: 100,
        startedAt: Date.now(),
      },
    );
    expect(committed).toMatchObject({
      status: 'committed',
      applied: 1,
      discarded: 1,
    });
    const visible = await user.query(api.preferences.list, {
      paginationOpts: { cursor: null, numItems: 30 },
    });
    expect(visible.page).toHaveLength(1);
    expect(visible.page[0]).toMatchObject({
      reaction: 'like',
      sourceThreadId: first.threadId,
      sourceMessageId: first.promptMessageId,
      sourceQuote: 'I love Stick Season',
    });

    const duplicate = await t.mutation(
      internal.preferenceWorkflows.commitExtraction,
      {
        userId,
        threadId: first.threadId,
        workflowId: state!.workflowId as never,
        startCheckpoint: -1,
        capturedEndOrder: 0,
        evidenceMessageIds: [first.promptMessageId],
        candidates: [],
        tokenUsage: 0,
        startedAt: Date.now(),
      },
    );
    expect(duplicate.status).toBe('obsolete');

    await t.mutation(internal.preferenceWorkflows.completeExtraction, {
      workflowId: state!.workflowId as never,
      result: { kind: 'success', returnValue: committed },
      context: { userId, threadId: first.threadId },
    });
    const second = await user.mutation(api.chat.send, {
      threadId: first.threadId,
      prompt: 'Remove my preference for Stick Season.',
    });
    state = await t.run((ctx) => ctx.db.get(state!._id));
    await t.run((ctx) => ctx.db.patch(state!._id, { nextReviewAt: 0 }));
    await t.mutation(internal.preferenceWorkflows.dispatchDue, { force: true });
    state = await t.run((ctx) => ctx.db.get(state!._id));
    await t.mutation(internal.preferenceWorkflows.commitExtraction, {
      userId,
      threadId: first.threadId,
      workflowId: state!.workflowId as never,
      startCheckpoint: 0,
      capturedEndOrder: 1,
      evidenceMessageIds: [second.promptMessageId],
      candidates: [
        {
          target: {
            kind: 'track',
            title: 'Stick Season',
            artists: ['Noah Kahan'],
            version: null,
          },
          operation: 'remove',
          evidence: {
            messageId: second.promptMessageId,
            quote: 'Remove my preference for Stick Season',
          },
        },
      ],
      tokenUsage: 50,
      startedAt: Date.now(),
    });
    expect(
      (
        await user.query(api.preferences.list, {
          paginationOpts: { cursor: null, numItems: 30 },
        })
      ).page,
    ).toEqual([]);
    const raw = await t.run((ctx) =>
      ctx.db
        .query('preferences')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .unique(),
    );
    expect(raw).toMatchObject({
      removed: true,
      sourceMessageId: second.promptMessageId,
      revision: 2,
    });
  });

  it('deleting a conversation removes its processing state', async () => {
    const { t, user } = await setup();
    const saved = await user.mutation(api.chat.send, {
      prompt: 'I dislike this track.',
    });
    const state = await t.run((ctx) =>
      ctx.db
        .query('conversationPreferenceState')
        .withIndex('by_thread', (q) => q.eq('threadId', saved.threadId))
        .unique(),
    );
    await t.run((ctx) => ctx.db.patch(state!._id, { nextReviewAt: 0 }));
    await t.mutation(internal.preferenceWorkflows.dispatchDue, { force: true });
    await user.mutation(api.chat.deleteThread, { threadId: saved.threadId });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('conversationPreferenceState')
          .withIndex('by_thread', (q) => q.eq('threadId', saved.threadId))
          .unique(),
      ),
    ).toBeNull();
  });
});
