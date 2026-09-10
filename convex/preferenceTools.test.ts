import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import { it, expect, vi } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';

vi.mock('convex/server', async (original) => ({
  ...(await original<typeof import('convex/server')>()),
  getServiceToken: vi.fn(async () => 'test-token'),
}));
vi.mock('@convex-dev/ai-sdk-provider', async () => {
  const { mockModel } = await import('@convex-dev/agent');
  return {
    convexGateway: () =>
      mockModel({
        contentSteps: [
          [
            {
              type: 'text',
              text: 'Try these three artists based on that sound.',
            },
          ],
        ],
        initialDelayInMs: 0,
        chunkDelayInMs: 0,
      }),
  };
});
it('answers a preference statement without saving or starting background work', async () => {
  const t = convexTest(schema, import.meta.glob('./**/*.ts'));
  agentTest.register(t); // No Workflow registration: ordinary chat must not invoke it.
  const userId = await t.run((ctx) =>
    ctx.db.insert('users', { name: 'Alice' }),
  );
  const a = t.withIdentity({ subject: `${userId}|session` });
  const saved = await a.mutation(api.chat.send, {
    prompt: 'I like Noah Kahan',
  });
  await a.action(api.chat.generate, saved);
  const page = await a.query(api.preferences.list, {
    paginationOpts: { cursor: null, numItems: 30 },
  });
  expect(page.page).toEqual([]);
  const messages = await a.query(api.chat.listMessages, {
    threadId: saved.threadId,
    paginationOpts: { cursor: null, numItems: 30 },
  });
  expect(
    messages.page.some((m) =>
      m.parts.some(
        (p) => p.type === 'text' && p.text.includes('Try these three artists'),
      ),
    ),
  ).toBe(true);
  expect(
    messages.page.some((m) =>
      m.parts.some(
        (p) =>
          p.type === 'text' &&
          /\b(saved|recorded|remembered|updated|deleted)\b/i.test(p.text),
      ),
    ),
  ).toBe(false);
});

it('exposes only research and read tools with no preference write capability', async () => {
  const { preferenceTools } = await import('./lib/preferenceTools');
  const tools = preferenceTools({} as never, {
    threadId: 'thread',
    promptMessageId: 'prompt',
  });
  expect(Object.keys(tools).sort()).toEqual(['listPreferences', 'searchMusic']);
});
