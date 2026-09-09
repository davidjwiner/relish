import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
const modules = import.meta.glob('./**/*.ts');
describe('current user authorization', () => {
  it('rejects unauthenticated requests', async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(api.users.current, {})).rejects.toThrow(
      'UNAUTHENTICATED',
    );
  });
  it('returns only the calling user and rejects caller-selected IDs', async () => {
    const t = convexTest(schema, modules);
    const [alice, bob] = await t.run(async (ctx) => [
      await ctx.db.insert('users', {
        name: 'Alice',
        email: 'alice@example.test',
      }),
      await ctx.db.insert('users', { name: 'Bob', email: 'bob@example.test' }),
    ]);
    const a = t.withIdentity({ subject: `${alice}|session-a` });
    const b = t.withIdentity({ subject: `${bob}|session-b` });
    expect(await a.query(api.users.current, {})).toEqual({
      id: alice,
      name: 'Alice',
    });
    expect(await b.query(api.users.current, {})).toEqual({
      id: bob,
      name: 'Bob',
    });
    await expect(
      a.query(api.users.current, { userId: bob } as unknown as Record<
        string,
        never
      >),
    ).rejects.toThrow();
  });
  it('rejects a deleted user identity', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const id = await ctx.db.insert('users', {});
      await ctx.db.delete(id);
      return id;
    });
    await expect(
      t.withIdentity({ subject: `${id}|session` }).query(api.users.current, {}),
    ).rejects.toThrow('UNAUTHENTICATED');
  });
});
