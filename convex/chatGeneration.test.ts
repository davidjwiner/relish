import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import { createThread, saveMessage, listMessages } from '@convex-dev/agent';
import { getServiceToken } from 'convex/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import schema from './schema';
import { api, internal, components } from './_generated/api';
import { musicAgent } from './lib/musicAgent';
import { mockModel } from '@convex-dev/agent';

vi.mock('convex/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('convex/server')>()),
  getServiceToken: vi.fn(async () => 'test-token'),
}));
vi.mock('@convex-dev/ai-sdk-provider', async () => {
  const { mockModel } = await import('@convex-dev/agent');
  return {
    convexGateway: () =>
      mockModel({
        content: [
          {
            type: 'text',
            text: 'Try Gregory Alan Isakov for vivid folk storytelling.',
          },
        ],
        chunkDelayInMs: 0,
        initialDelayInMs: 0,
      }),
  };
});
const modules = import.meta.glob('./**/*.ts');
beforeEach(() => {
  vi.mocked(getServiceToken).mockResolvedValue('test-token');
  musicAgent.options.languageModel = mockModel({
    content: [
      {
        type: 'text',
        text: 'Try Gregory Alan Isakov for vivid folk storytelling.',
      },
    ],
    chunkDelayInMs: 0,
    initialDelayInMs: 0,
  });
});
async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const data = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { name: 'Chat test' });
    const threadId = await createThread(ctx, components.agent, { userId });
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      userId,
      prompt: 'I like Noah Kahan. Recommend an artist.',
    });
    const requestId = await ctx.db.insert('chatRequests', {
      userId,
      threadId,
      promptMessageId: messageId,
      clientRequestId: 'generation-test',
      status: 'queued',
    });
    return { userId, threadId, requestId };
  });
  return { t, ...data };
}
describe('generation integration', () => {
  it('persists a model reply through Agent and completes the request', async () => {
    const { t, threadId, requestId } = await setup();
    await t.action(internal.chatGeneration.generate, { requestId });
    expect(
      (await t.query(internal.chat.requestState, { requestId }))?.status,
    ).toBe('completed');
    const messages = await t.run((ctx) =>
      listMessages(ctx, components.agent, {
        threadId,
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    );
    expect(
      messages.page.filter((m) => m.message?.role === 'user'),
    ).toHaveLength(1);
    expect(
      messages.page.some((m) => m.text?.includes('Gregory Alan Isakov')),
    ).toBe(true);
  });
  it('includes the prior exchange in follow-up context', async () => {
    const model = mockModel({
      content: [{ type: 'text', text: 'Try Gregory Alan Isakov.' }],
      chunkDelayInMs: 0,
      initialDelayInMs: 0,
    });
    const calls = vi.spyOn(model, 'doStream');
    musicAgent.options.languageModel = model;
    const { t, userId, threadId, requestId } = await setup();
    await t.action(internal.chatGeneration.generate, { requestId });
    const followup = await t.run(async (ctx) => {
      const { messageId } = await saveMessage(ctx, components.agent, {
        threadId,
        userId,
        prompt: 'Why that artist?',
      });
      return ctx.db.insert('chatRequests', {
        userId,
        threadId,
        promptMessageId: messageId,
        clientRequestId: 'followup-test',
        status: 'queued',
      });
    });
    await t.action(internal.chatGeneration.generate, { requestId: followup });
    const prompt = JSON.stringify(calls.mock.calls[1][0].prompt);
    expect(prompt).toContain('I like Noah Kahan.');
    expect(prompt).toContain('Gregory Alan Isakov');
    expect(prompt).toContain('Why that artist?');
  });
  it('fails immediately and safely when gateway access is unavailable', async () => {
    vi.mocked(getServiceToken).mockRejectedValue(new Error('Gateway disabled'));
    const { t, requestId } = await setup();
    await t.action(internal.chatGeneration.generate, { requestId });
    expect(
      await t.query(internal.chat.requestState, { requestId }),
    ).toMatchObject({ status: 'failed', errorCode: 'GATEWAY_UNAVAILABLE' });
  });
  it('settles a provider failure instead of leaving the request running', async () => {
    musicAgent.options.languageModel = mockModel({ fail: true });
    const { t, requestId } = await setup();
    await t.action(internal.chatGeneration.generate, { requestId });
    expect(
      (await t.query(internal.chat.requestState, { requestId }))?.status,
    ).toBe('failed');
  });
  it('propagates stop to a running generation before releasing the thread', async () => {
    musicAgent.options.languageModel = mockModel({
      initialDelayInMs: 1000,
      chunkDelayInMs: 20,
    });
    const { t, userId, threadId, requestId } = await setup();
    const action = t.action(internal.chatGeneration.generate, { requestId });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await t
      .withIdentity({ subject: `${userId}|session` })
      .mutation(api.chat.stop, { threadId });
    await action;
    expect(
      (await t.query(internal.chat.requestState, { requestId }))?.status,
    ).toBe('stopped');
  });
});
