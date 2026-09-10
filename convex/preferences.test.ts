import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

const modules = import.meta.glob('./**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const [alice, bob] = await t.run(async (ctx) => [
    await ctx.db.insert('users', { name: 'Alice' }),
    await ctx.db.insert('users', { name: 'Bob' }),
  ]);
  return {
    t,
    alice,
    a: t.withIdentity({ subject: `${alice}|session` }),
    b: t.withIdentity({ subject: `${bob}|session` }),
  };
}

describe('preference reads', () => {
  it('requires authentication and isolates preferences by user', async () => {
    const { t, alice, a, b } = await setup();
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
    const alicePreferences = await a.query(api.preferences.list, {
      paginationOpts: { cursor: null, numItems: 30 },
    });
    expect(alicePreferences.page[0].name).toBe('Noah Kahan');
    expect(
      (
        await b.query(api.preferences.list, {
          paginationOpts: { cursor: null, numItems: 30 },
        })
      ).page,
    ).toEqual([]);
  });

  it('paginates profile preferences and filters them by reaction and target type', async () => {
    const { a, alice, t } = await setup();
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

  it('tombstones only the current user’s preference', async () => {
    const { a, b, alice, t } = await setup();
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
    expect(
      (
        await a.query(api.preferences.listProfile, {
          paginationOpts: { cursor: null, numItems: 30 },
        })
      ).page,
    ).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(preferenceId))).toMatchObject({
      removed: true,
      revision: 2,
    });
  });
});
