import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import { registerWorkflow } from '../test-support/workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listMessages } from '@convex-dev/agent';
import { generateText } from 'ai';
import schema from './schema';
import { api, components, internal } from './_generated/api';
import type { PreferenceRequest } from './lib/preferenceTypes';

vi.mock('convex/server', async (original) => ({
  ...(await original<typeof import('convex/server')>()),
  getServiceToken: vi.fn(async () => 'test-token'),
}));
const researchMocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('@exalabs/convex-exa', () => ({
  ExaClient: class {
    search = researchMocks.search;
  },
}));
vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateText: vi.fn(async () => ({
    output: {
      answer: 'The opening track is Stick Season by Noah Kahan.',
      target: {
        kind: 'track',
        name: 'Stick Season',
        artists: ['Noah Kahan'],
        version: null,
      },
      evidence: [
        {
          url: 'https://example.com/episode',
          quote: 'Opening track: Stick Season by Noah Kahan.',
        },
      ],
    },
  })),
}));
const modules = import.meta.glob('./**/*.ts');
const create: PreferenceRequest = {
  kind: 'create',
  target: {
    kind: 'track',
    name: 'Stick Season',
    artists: ['Noah Kahan'],
    version: null,
  },
  researchQuery: null,
  reaction: 'like',
  reason: null,
};
async function setup(withResearch = true) {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  if (withResearch) registerWorkflow(t);
  const [alice, bob] = await t.run(async (ctx) => [
    await ctx.db.insert('users', { name: 'Alice' }),
    await ctx.db.insert('users', { name: 'Bob' }),
  ]);
  const a = t.withIdentity({ subject: `${alice}|session` });
  const b = t.withIdentity({ subject: `${bob}|session` });
  const saved = await a.mutation(api.chat.send, {
    prompt: 'I love Stick Season because of the storytelling.',
  });
  const finish = () => t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const list = () =>
    a.query(api.preferences.list, {
      paginationOpts: { cursor: null, numItems: 30 },
    });
  const next = async (request: PreferenceRequest) => {
    const prompt = await a.mutation(api.chat.send, {
      threadId: saved.threadId,
      prompt: 'Please change my saved preference.',
    });
    await a.mutation(internal.preferences.apply, {
      ...prompt,
      request,
    });
    return prompt;
  };
  return { t, a, b, alice, saved, finish, list, next };
}
beforeEach(() => {
  vi.useFakeTimers();
  researchMocks.search.mockReset().mockResolvedValue({
    results: [
      {
        title: 'Tracklist',
        url: 'https://example.com/episode',
        text: 'Opening track: Stick Season by Noah Kahan.',
      },
    ],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe('Preference tools and workflows', () => {
  it('saves a track without also liking its artist, and reuses its result without a workflow', async () => {
    const { t, a, saved, list } = await setup(false);
    const first = await a.mutation(internal.preferences.apply, {
      ...saved,
      request: create,
    });
    const second = await a.mutation(internal.preferences.apply, {
      ...saved,
      request: create,
    });
    expect(second).toBe(first);
    expect(first).toBe('Saved Stick Season — Noah Kahan as a like.');
    const preferences = (await list()).page;
    expect(preferences).toHaveLength(1);
    expect(preferences[0]).toMatchObject({
      reaction: 'like',
      revision: 1,
      target: { kind: 'track' },
      name: 'Stick Season — Noah Kahan',
    });
    const [prompt] = await t.run((ctx) =>
      ctx.runQuery(components.agent.messages.getMessagesByIds, {
        messageIds: [saved.promptMessageId],
      }),
    );
    expect(prompt?.providerOptions?.relish).toMatchObject({
      preferenceResult: first,
      completionMessageId: expect.any(String),
    });
    expect(prompt?.providerOptions?.relish?.workflowId).toBeUndefined();
    await a.action(api.chat.generate, saved); // Reuses the committed receipt without making a model call.
    const messages = await t.run((ctx) =>
      listMessages(ctx, components.agent, {
        threadId: saved.threadId,
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    );
    expect(
      messages.page.filter((m) => m.text?.startsWith('Saved ')),
    ).toHaveLength(1);
  });
  it('enforces user ownership for list, status and direct writes', async () => {
    const { t, a, b, saved, list } = await setup(false);
    await expect(
      t.query(api.preferences.list, {
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    ).rejects.toThrow('UNAUTHENTICATED');
    await expect(
      b.mutation(internal.preferences.apply, {
        ...saved,
        request: create,
      }),
    ).rejects.toThrow('CONVERSATION_UNAVAILABLE');
    expect(
      await b.query(api.preferenceWorkflows.statuses, {
        threadId: saved.threadId,
        promptMessageIds: [saved.promptMessageId],
      }),
    ).toEqual([]);
    await a.mutation(internal.preferences.apply, {
      ...saved,
      request: create,
    });
    const preference = (await list()).page[0];
    expect(
      (
        await b.query(api.preferences.list, {
          paginationOpts: { cursor: null, numItems: 30 },
        })
      ).page,
    ).toEqual([]);
    const bPrompt = await b.mutation(api.chat.send, { prompt: 'Delete it' });
    await b.mutation(internal.preferences.apply, {
      ...bPrompt,
      request: {
        kind: 'delete',
        preferenceId: preference._id,
        expectedRevision: 1,
      },
    });
    expect((await list()).page).toHaveLength(1);
  });
  it('preserves reasons on reaction changes and rejects stale revisions', async () => {
    const { a, saved, list, next } = await setup(false);
    await a.mutation(internal.preferences.apply, {
      ...saved,
      request: { ...create, reason: 'because of the storytelling' },
    });
    const p = (await list()).page[0];
    await next({
      kind: 'update',
      preferenceId: p._id,
      expectedRevision: 1,
      reaction: 'dislike',
    });
    expect((await list()).page[0]).toMatchObject({
      reaction: 'dislike',
      revision: 2,
      reason: 'because of the storytelling',
    });
    await next({ kind: 'delete', preferenceId: p._id, expectedRevision: 1 });
    expect((await list()).page).toHaveLength(1);
    await next({ kind: 'delete', preferenceId: p._id, expectedRevision: 2 });
    expect((await list()).page).toHaveLength(0);
    await a.action(api.chat.generate, saved);
    await a.mutation(internal.preferences.apply, {
      ...saved,
      request: create,
    });
    expect((await list()).page).toHaveLength(0); // An old retry cannot restore the deleted like.
  });
  it('deduplicates equivalent artist and track names across new prompts', async () => {
    const { a, saved, list, next } = await setup(false);
    await a.mutation(internal.preferences.apply, {
      ...saved,
      request: create,
    });
    await next({
      ...create,
      target: {
        kind: 'track',
        name: '  stick   season ',
        artists: ['noah kahan'],
        version: null,
      },
    });
    expect((await list()).page).toHaveLength(1);
  });
  it('rejects malformed targets, revisions, mismatched prompts and invented reasons', async () => {
    const { a, saved } = await setup(false);
    await expect(
      a.mutation(internal.preferences.apply, {
        ...saved,
        request: {
          ...create,
          target: { kind: 'track', name: 'Track', artists: [], version: null },
        },
      }),
    ).rejects.toThrow('needs an artist');
    await expect(
      a.mutation(internal.preferences.apply, {
        ...saved,
        request: { ...create, reason: 'I love the banjo' },
      }),
    ).rejects.toThrow('REASON_MUST_QUOTE_USER');
    const other = await a.mutation(api.chat.send, {
      prompt: 'Other conversation',
    });
    await expect(
      a.mutation(internal.preferences.apply, {
        ...saved,
        promptMessageId: other.promptMessageId,
        request: create,
      }),
    ).rejects.toThrow('INVALID_MESSAGE');
  });
  it('rejects research workflows for resolved CRUD and keeps retry paths separate', async () => {
    const { a, saved, finish, list } = await setup();
    await expect(
      a.mutation(internal.preferenceWorkflows.begin, {
        ...saved,
        request: create,
      }),
    ).rejects.toThrow('RESEARCH_NOT_REQUIRED');
    await a.mutation(internal.preferences.apply, { ...saved, request: create });
    await expect(
      a.mutation(internal.preferenceWorkflows.begin, {
        ...saved,
        request: { kind: 'search', query: 'Another request' },
      }),
    ).rejects.toThrow('PREFERENCE_ALREADY_HANDLED');
    const researchPrompt = await a.mutation(api.chat.send, {
      threadId: saved.threadId,
      prompt: 'Save an unknown track',
    });
    await a.mutation(internal.preferenceWorkflows.begin, {
      ...researchPrompt,
      request: { ...create, target: null, researchQuery: 'First track' },
    });
    await expect(
      a.mutation(internal.preferences.apply, {
        ...researchPrompt,
        request: create,
      }),
    ).rejects.toThrow('RESEARCH_ALREADY_STARTED');
    await finish();
    expect((await list()).page).toHaveLength(1);
  });
  it('researches and saves a verified target with citations', async () => {
    const { a, t, saved, finish, list } = await setup();
    await a.mutation(internal.preferenceWorkflows.begin, {
      ...saved,
      request: {
        ...create,
        target: null,
        researchQuery: 'First track in the latest episode',
      },
    });
    await finish();
    expect((await list()).page).toHaveLength(1);
    const messages = await t.run((ctx) =>
      listMessages(ctx, components.agent, {
        threadId: saved.threadId,
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    );
    expect(
      messages.page.some((m) =>
        m.text?.includes('[Source 1](https://example.com/episode)'),
      ),
    ).toBe(true);
  });
  it('does not save when evidence is fabricated or research is ambiguous', async () => {
    const { a, saved, finish, list } = await setup();
    vi.mocked(generateText).mockResolvedValueOnce({
      output: {
        answer: 'A guess',
        target: create.kind === 'create' ? create.target : null,
        evidence: [
          {
            url: 'https://example.com/episode',
            quote: 'Not present in the source',
          },
        ],
      },
    } as never);
    await a.mutation(internal.preferenceWorkflows.begin, {
      ...saved,
      request: { ...create, target: null, researchQuery: 'An unknown track' },
    });
    await finish();
    expect((await list()).page).toEqual([]);
  });
  it('retries transient research failures and completes only once', async () => {
    const { t, a, alice, saved, finish, list } = await setup();
    researchMocks.search.mockRejectedValueOnce(new Error('HTTP 503'));
    const started = await a.mutation(internal.preferenceWorkflows.begin, {
      ...saved,
      request: { ...create, target: null, researchQuery: 'First track' },
    });
    await finish();
    expect(researchMocks.search).toHaveBeenCalledTimes(2);
    expect((await list()).page).toHaveLength(1);
    await t.mutation(internal.preferenceWorkflows.complete, {
      workflowId: started.workflowId as never,
      result: { kind: 'success', returnValue: 'Duplicate completion' },
      context: { ...saved, userId: alice },
    });
    const messages = await t.run((ctx) =>
      listMessages(ctx, components.agent, {
        threadId: saved.threadId,
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    );
    expect(messages.page.some((m) => m.text === 'Duplicate completion')).toBe(
      false,
    );
  });
  it('reports permanent research failures without retrying or saving', async () => {
    const { a, saved, finish, list } = await setup();
    researchMocks.search.mockRejectedValueOnce(
      new Error('HTTP 401 invalid key'),
    );
    await a.mutation(internal.preferenceWorkflows.begin, {
      ...saved,
      request: { ...create, target: null, researchQuery: 'First track' },
    });
    await finish();
    expect(researchMocks.search).toHaveBeenCalledTimes(1);
    expect((await list()).page).toEqual([]);
  });
  it('research-only requests do not write preferences', async () => {
    const { a, saved, finish, list } = await setup();
    await a.mutation(internal.preferenceWorkflows.begin, {
      ...saved,
      request: { kind: 'search', query: 'What opened the episode?' },
    });
    await finish();
    expect((await list()).page).toEqual([]);
  });
  it('stops background writes when the originating conversation loses its owner', async () => {
    const { t, a, saved, finish, list } = await setup();
    await a.mutation(internal.preferenceWorkflows.begin, {
      ...saved,
      request: {
        ...create,
        target: null,
        researchQuery: 'First track in the episode',
      },
    });
    await t.run((ctx) =>
      ctx.runMutation(components.agent.threads.updateThread, {
        threadId: saved.threadId,
        patch: { userId: 'deleted' },
      }),
    );
    await finish();
    expect((await list()).page).toEqual([]);
  });
});
