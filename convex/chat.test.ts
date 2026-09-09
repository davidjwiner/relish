import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import { getServiceToken } from 'convex/server';
import { describe, expect, it, vi } from 'vitest';
import { listMessages } from '@convex-dev/agent';
import schema from './schema';
import { api, components } from './_generated/api';

vi.mock('convex/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('convex/server')>()),
  getServiceToken: vi.fn(async () => 'test-token'),
}));
vi.mock('@convex-dev/ai-sdk-provider', async () => {
  const { mockModel } = await import('@convex-dev/agent');
  return {
    convexGateway: () =>
      mockModel({
        content: [{ type: 'text', text: 'Try Gregory Alan Isakov.' }],
        chunkDelayInMs: 0,
        initialDelayInMs: 0,
      }),
  };
});
const modules = import.meta.glob('./**/*.ts');
async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
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
const input = { prompt: 'I like melodic house.' };
describe('Agent chat proof of concept', () => {
  it('rejects unsigned and deleted users', async () => {
    const { t, a, alice } = await setup();
    await expect(t.mutation(api.chat.send, input)).rejects.toThrow(
      'UNAUTHENTICATED',
    );
    await t.run((ctx) => ctx.db.delete(alice));
    await expect(a.mutation(api.chat.send, input)).rejects.toThrow(
      'UNAUTHENTICATED',
    );
  });
  it('isolates history, streams, sending, generation and cancellation', async () => {
    const { a, b } = await setup();
    const saved = await a.mutation(api.chat.send, input);
    expect(
      await b.query(api.chat.getThread, { threadId: saved.threadId }),
    ).toBeNull();
    expect(
      (
        await b.query(api.chat.listThreads, {
          paginationOpts: { cursor: null, numItems: 20 },
        })
      ).page,
    ).toHaveLength(0);
    await expect(
      b.query(api.chat.listMessages, {
        threadId: saved.threadId,
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    ).rejects.toThrow('CONVERSATION_UNAVAILABLE');
    await expect(
      b.mutation(api.chat.send, { ...input, threadId: saved.threadId }),
    ).rejects.toThrow('CONVERSATION_UNAVAILABLE');
    await expect(b.action(api.chat.generate, saved)).rejects.toThrow(
      'CONVERSATION_UNAVAILABLE',
    );
    await expect(
      b.mutation(api.chat.stop, { threadId: saved.threadId }),
    ).rejects.toThrow('CONVERSATION_UNAVAILABLE');
  });
  it('saves and generates directly through Agent without application chat tables', async () => {
    const { t, a } = await setup();
    const saved = await a.mutation(api.chat.send, input);
    await a.action(api.chat.generate, saved);
    const messages = await t.run((ctx) =>
      listMessages(ctx, components.agent, {
        threadId: saved.threadId,
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    );
    expect(
      messages.page.filter((m) => m.message?.role === 'user'),
    ).toHaveLength(1);
    expect(
      messages.page.some((m) => m.text?.includes('Gregory Alan Isakov')),
    ).toBe(true);
    const followup = await a.mutation(api.chat.send, {
      threadId: saved.threadId,
      prompt: 'Why that artist?',
    });
    await a.action(api.chat.generate, followup);
    const page = await a.query(api.chat.listMessages, {
      threadId: saved.threadId,
      paginationOpts: { cursor: null, numItems: 30 },
    });
    expect(page.page.filter((m) => m.role === 'assistant')).toHaveLength(2);
  });
  it('keeps the saved prompt when gateway access fails and retries without resending it', async () => {
    const { t, a } = await setup();
    const saved = await a.mutation(api.chat.send, input);
    vi.mocked(getServiceToken).mockRejectedValueOnce(
      new Error('Gateway disabled'),
    );
    await expect(a.action(api.chat.generate, saved)).rejects.toThrow(
      'GATEWAY_UNAVAILABLE',
    );
    await a.action(api.chat.generate, saved);
    const messages = await t.run((ctx) =>
      listMessages(ctx, components.agent, {
        threadId: saved.threadId,
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    );
    expect(
      messages.page.filter((m) => m.message?.role === 'user'),
    ).toHaveLength(1);
  });
  it('validates prompts and prevents generating against a message in another thread', async () => {
    const { a } = await setup();
    expect(
      await a.query(api.chat.getThread, { threadId: 'invalid-thread' }),
    ).toBeNull();
    await expect(a.mutation(api.chat.send, { prompt: ' ' })).rejects.toThrow(
      'INVALID_MESSAGE',
    );
    await expect(
      a.mutation(api.chat.send, { prompt: 'a'.repeat(8001) }),
    ).rejects.toThrow('INVALID_MESSAGE');
    const first = await a.mutation(api.chat.send, input);
    const second = await a.mutation(api.chat.send, input);
    await expect(
      a.action(api.chat.generate, {
        threadId: first.threadId,
        promptMessageId: second.promptMessageId,
      }),
    ).rejects.toThrow('INVALID_MESSAGE');
  });
});
