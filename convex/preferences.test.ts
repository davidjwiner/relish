import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import { registerWorkflow } from '../test-support/workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listMessages } from '@convex-dev/agent';
import { generateText } from 'ai';
import schema from './schema';
import { api, components, internal } from './_generated/api';

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
  return { t, a, b, alice, saved, finish, list };
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
describe('Read-only preferences and music research', () => {
  it('paginates profile preferences and filters them by reaction and target type', async () => {
    const { a, alice, t } = await setup(false);
    await expect(
      t.query(api.preferences.listProfile, {
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    ).rejects.toThrow('UNAUTHENTICATED');
    await t.run(async (ctx) => {
      const [likedArtist, dislikedArtist] = await Promise.all([
        ctx.db.insert('artists', {
          name: 'Nora En Pure',
          identityKey: 'nora en pure',
        }),
        ctx.db.insert('artists', {
          name: 'Noah Kahan',
          identityKey: 'noah kahan',
        }),
      ]);
      const track = await ctx.db.insert('tracks', {
        title: 'Stick Season',
        artistIds: [dislikedArtist],
        version: 'Acoustic',
        identityKey: 'stick season:noah kahan:acoustic',
      });
      await ctx.db.insert('preferences', {
        userId: alice,
        target: { kind: 'artist', artistId: likedArtist },
        targetKey: `artist:${likedArtist}`,
        reaction: 'like',
        reason: 'The melodies keep me moving.',
        originatingMessageId: 'one',
        createdAt: 1,
        updatedAt: 1,
        revision: 1,
      });
      await ctx.db.insert('preferences', {
        userId: alice,
        target: { kind: 'artist', artistId: dislikedArtist },
        targetKey: `artist:${dislikedArtist}`,
        reaction: 'dislike',
        originatingMessageId: 'two',
        createdAt: 2,
        updatedAt: 2,
        revision: 1,
      });
      await ctx.db.insert('preferences', {
        userId: alice,
        target: { kind: 'track', trackId: track },
        targetKey: `track:${track}`,
        reaction: 'like',
        originatingMessageId: 'three',
        createdAt: 3,
        updatedAt: 3,
        revision: 1,
      });
    });
    const firstPage = await a.query(api.preferences.listProfile, {
      paginationOpts: { cursor: null, numItems: 1 },
    });
    expect(firstPage.page).toHaveLength(1);
    const nextPage = await a.query(api.preferences.listProfile, {
      paginationOpts: { cursor: firstPage.continueCursor, numItems: 30 },
    });
    expect([...firstPage.page, ...nextPage.page]).toHaveLength(3);
    expect(
      (
        await a.query(api.preferences.listProfile, {
          paginationOpts: { cursor: null, numItems: 30 },
          reaction: 'like',
          targetKind: 'track',
        })
      ).page,
    ).toMatchObject([
      {
        kind: 'track',
        title: 'Stick Season',
        version: 'Acoustic',
        artistNames: ['Noah Kahan'],
        reaction: 'like',
      },
    ]);
    expect(
      (
        await a.query(api.preferences.listProfile, {
          paginationOpts: { cursor: null, numItems: 30 },
          targetKind: 'artist',
        })
      ).page
        .map((preference) => preference.title)
        .sort(),
    ).toEqual(['Noah Kahan', 'Nora En Pure']);
  });

  it('authenticates preference reads and isolates users', async () => {
    const { t, b, alice, list } = await setup(false);
    await expect(
      t.query(api.preferences.list, {
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    ).rejects.toThrow('UNAUTHENTICATED');
    await t.run(async (ctx) => {
      const artistId = await ctx.db.insert('artists', {
        name: 'Noah Kahan',
        identityKey: 'noah kahan',
      });
      await ctx.db.insert('preferences', {
        userId: alice,
        target: { kind: 'artist', artistId },
        targetKey: `artist:${artistId}`,
        reaction: 'like',
        originatingMessageId: 'existing',
        createdAt: 1,
        updatedAt: 1,
        revision: 1,
      });
    });
    expect((await list()).page[0].name).toBe('Noah Kahan');
    expect(
      (
        await b.query(api.preferences.list, {
          paginationOpts: { cursor: null, numItems: 30 },
        })
      ).page,
    ).toEqual([]);
  });
  it('removes only the current user’s preference', async () => {
    const { a, b, alice, t } = await setup(false);
    const preferenceId = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert('artists', {
        name: 'Nora En Pure',
        identityKey: 'nora en pure',
      });
      return ctx.db.insert('preferences', {
        userId: alice,
        target: { kind: 'artist', artistId },
        targetKey: `artist:${artistId}`,
        reaction: 'like',
        originatingMessageId: 'existing',
        createdAt: 1,
        updatedAt: 1,
        revision: 1,
      });
    });
    await expect(
      t.mutation(api.preferences.remove, { preferenceId }),
    ).rejects.toThrow('UNAUTHENTICATED');
    await expect(
      b.mutation(api.preferences.remove, { preferenceId }),
    ).rejects.toThrow('PREFERENCE_UNAVAILABLE');
    await a.mutation(api.preferences.remove, { preferenceId });
    await expect(
      a.mutation(api.preferences.remove, { preferenceId }),
    ).rejects.toThrow('PREFERENCE_UNAVAILABLE');
    expect(await t.run((ctx) => ctx.db.get(preferenceId))).toBeNull();
  });
  it('rejects research on another user’s conversation and mismatched prompts', async () => {
    const { a, b, saved } = await setup();
    const request = { kind: 'search' as const, query: 'First track' };
    await expect(
      b.mutation(internal.preferenceWorkflows.begin, { ...saved, request }),
    ).rejects.toThrow('CONVERSATION_UNAVAILABLE');
    const other = await a.mutation(api.chat.send, {
      prompt: 'Other conversation',
    });
    await expect(
      a.mutation(internal.preferenceWorkflows.begin, {
        ...saved,
        promptMessageId: other.promptMessageId,
        request,
      }),
    ).rejects.toThrow('INVALID_MESSAGE');
  });
  it('returns cited research without saving a preference', async () => {
    const { a, t, saved, finish, list } = await setup();
    await a.mutation(internal.preferenceWorkflows.begin, {
      ...saved,
      request: { kind: 'search', query: 'First track in the latest episode' },
    });
    await finish();
    expect((await list()).page).toEqual([]);
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
      request: { kind: 'search', query: 'An unknown track' },
    });
    await finish();
    expect((await list()).page).toEqual([]);
  });
  it('retries transient research failures and completes only once', async () => {
    const { t, a, alice, saved, finish, list } = await setup();
    researchMocks.search.mockRejectedValueOnce(new Error('HTTP 503'));
    const started = await a.mutation(internal.preferenceWorkflows.begin, {
      ...saved,
      request: { kind: 'search', query: 'First track' },
    });
    await finish();
    expect(researchMocks.search).toHaveBeenCalledTimes(2);
    expect((await list()).page).toEqual([]);
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
      request: { kind: 'search', query: 'First track' },
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
  it('does not post research to a conversation that lost its owner', async () => {
    const { t, a, saved, finish, list } = await setup();
    await a.mutation(internal.preferenceWorkflows.begin, {
      ...saved,
      request: { kind: 'search', query: 'First track in the episode' },
    });
    await t.run((ctx) =>
      ctx.runMutation(components.agent.threads.updateThread, {
        threadId: saved.threadId,
        patch: { userId: 'deleted' },
      }),
    );
    await finish();
    const messages = await t.run((ctx) =>
      listMessages(ctx, components.agent, {
        threadId: saved.threadId,
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    );
    expect(
      messages.page.filter((m) => m.message?.role === 'assistant'),
    ).toEqual([]);
    expect((await list()).page).toEqual([]);
  });
});
