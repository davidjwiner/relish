import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

const modules = import.meta.glob('./**/*.ts');

describe('preference reads', () => {
  it('requires authentication and isolates preferences by user', async () => {
    const t = convexTest(schema, modules);
    const [alice, bob] = await t.run(async (ctx) => [
      await ctx.db.insert('users', { name: 'Alice' }),
      await ctx.db.insert('users', { name: 'Bob' }),
    ]);
    const a = t.withIdentity({ subject: `${alice}|session` });
    const b = t.withIdentity({ subject: `${bob}|session` });
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
});
