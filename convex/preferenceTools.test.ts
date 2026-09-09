import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import { registerWorkflow } from '../test-support/workflow';
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
              text: 'Saving your preference. The result will appear here.',
            },
          ],
        ],
        initialDelayInMs: 0,
        chunkDelayInMs: 0,
      }),
  };
});
it('runs an Agent tool through streaming and resumes with its result', async () => {
  const t = convexTest(schema, import.meta.glob('./**/*.ts'));
  agentTest.register(t);
  registerWorkflow(t);
  const userId = await t.run((ctx) =>
    ctx.db.insert('users', { name: 'Alice' }),
  );
  const a = t.withIdentity({ subject: `${userId}|session` });
  const saved = await a.mutation(api.chat.send, {
    prompt: 'I like Noah Kahan',
  });
  await a.action(api.chat.generate, saved);
  for (let i = 0; i < 100; i++) {
    const status = await a.query(api.preferenceWorkflows.statuses, {
      threadId: saved.threadId,
      promptMessageIds: [saved.promptMessageId],
    });
    if (status[0].status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await t.finishInProgressScheduledFunctions();
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
});
