import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { registerWorkflow } from '../test-support/workflow';
import { api } from './_generated/api';
import schema from './schema';

vi.mock('convex/server', async (original) => ({
  ...(await original<typeof import('convex/server')>()),
  getServiceToken: vi.fn(async () => 'test-token'),
}));
vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateText: vi.fn(async (args: { prompt: string }) => {
    const input = JSON.parse(args.prompt) as {
      preferences: { id: string; title: string }[];
    };
    return {
      output: {
        overview: 'An early picture emerges from the music you have saved.',
        overviewEvidenceIds: [input.preferences[0].id],
        drawnTo: [
          {
            text: `You return to ${input.preferences[0].title}.`,
            evidenceIds: [input.preferences[0].id],
          },
        ],
        avoids: [],
        nuances: [],
        evidenceLevel:
          input.preferences.length < 3
            ? ('limited' as const)
            : ('developing' as const),
      },
      usage: { totalTokens: 31 },
    };
  }),
}));

const modules = import.meta.glob('./**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  registerWorkflow(t);
  const userId = await t.run((ctx) =>
    ctx.db.insert('users', { name: 'Alice' }),
  );
  return {
    t,
    userId,
    user: t.withIdentity({ subject: `${userId}|session` }),
  };
}

async function addPreference(
  t: Awaited<ReturnType<typeof setup>>['t'],
  userId: Awaited<ReturnType<typeof setup>>['userId'],
  name: string,
  updatedAt: number,
) {
  return t.run(async (ctx) => {
    const artistId = await ctx.db.insert('artists', {
      name,
      identityKey: name.toLowerCase(),
    });
    return ctx.db.insert('preferences', {
      userId,
      target: { kind: 'artist', artistId },
      targetKey: `artist:${artistId}`,
      reaction: 'like',
      originatingMessageId: `message-${updatedAt}`,
      createdAt: updatedAt,
      updatedAt,
      revision: 1,
    });
  });
}

describe('taste profile reviews', () => {
  it('starts and publishes an evidence-backed overview when requested', async () => {
    vi.useFakeTimers();
    try {
      const { t, user, userId } = await setup();
      await addPreference(t, userId, 'Adrianne Lenker', 1);
      await addPreference(t, userId, 'Nora En Pure', 2);

      await user.mutation(api.tasteProfiles.requestRefresh, {});
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      const profile = await user.query(api.tasteProfiles.get, {});
      expect(profile).toMatchObject({
        status: 'ready',
        isCurrent: true,
        reviewedPreferenceCount: 2,
        overview: {
          evidenceLevel: 'limited',
          drawnTo: [{ evidence: [{ title: 'Nora En Pure' }] }],
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not expose a summary after a cited preference is removed', async () => {
    const { t, user, userId } = await setup();
    const preferenceId = await addPreference(t, userId, 'Nora En Pure', 1);
    await t.run((ctx) =>
      ctx.db.insert('tasteProfiles', {
        userId,
        preferencesVersion: 1,
        summaryVersion: 1,
        status: 'ready',
        overview: {
          overview: 'You enjoy spacious electronic music.',
          overviewEvidenceIds: [preferenceId],
          drawnTo: [],
          avoids: [],
          nuances: [],
          evidenceLevel: 'limited',
        },
        generatedAt: 1,
        reviewedPreferenceCount: 1,
        coverage: 'complete',
      }),
    );

    await user.mutation(api.preferences.remove, { preferenceId });

    const profile = await user.query(api.tasteProfiles.get, {});
    expect(profile).toMatchObject({
      status: 'pending',
      isCurrent: false,
    });
    expect(profile.overview).toBeUndefined();
  });

  it('marks an empty profile without invoking the model', async () => {
    vi.useFakeTimers();
    try {
      const generateText = await import('ai').then(
        (module) => module.generateText,
      );
      vi.mocked(generateText).mockClear();
      const { t, user } = await setup();

      await user.mutation(api.tasteProfiles.requestRefresh, {});
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());

      expect(await user.query(api.tasteProfiles.get, {})).toMatchObject({
        status: 'empty',
        hasPreferences: false,
        isCurrent: false,
      });
      expect(generateText).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
