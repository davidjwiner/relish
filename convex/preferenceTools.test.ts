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
              type: 'tool-call',
              toolCallId: 'save-like',
              toolName: 'createPreference',
              input: JSON.stringify({
                target: {
                  kind: 'artist',
                  name: 'Noah Kahan',
                  artists: [],
                  version: null,
                },
                researchQuery: null,
                reaction: 'like',
                reason: null,
              }),
            },
          ],
          [
            {
              type: 'text',
              text: 'Unexpected second model call',
            },
          ],
        ],
        initialDelayInMs: 0,
        chunkDelayInMs: 0,
      }),
  };
});
it('saves through an Agent tool without Workflow or a follow-up model call', async () => {
  const t = convexTest(schema, import.meta.glob('./**/*.ts'));
  agentTest.register(t);
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
  expect(page.page).toHaveLength(1);
  expect(page.page[0]).toMatchObject({
    name: 'Noah Kahan',
    reaction: 'like',
    target: { kind: 'artist' },
  });
  const messages = await a.query(api.chat.listMessages, {
    threadId: saved.threadId,
    paginationOpts: { cursor: null, numItems: 30 },
  });
  expect(
    messages.page.some((m) =>
      m.parts.some(
        (p) => p.type === 'text' && p.text.includes('Saved Noah Kahan'),
      ),
    ),
  ).toBe(true);
  expect(
    messages.page.some((m) =>
      m.parts.some(
        (p) =>
          p.type === 'text' && p.text.includes('Unexpected second model call'),
      ),
    ),
  ).toBe(false);
  await a.action(api.chat.generate, saved);
  const retried = await a.query(api.chat.listMessages, {
    threadId: saved.threadId,
    paginationOpts: { cursor: null, numItems: 30 },
  });
  expect(retried.page).toEqual(messages.page);
});
