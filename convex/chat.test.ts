import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { listMessages } from '@convex-dev/agent';
import schema from './schema';
import { api, internal, components } from './_generated/api';
const modules = import.meta.glob('./**/*.ts');
afterEach(() => vi.useRealTimers());
async function setup() {
  vi.useFakeTimers();
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
const args = {
  prompt: 'I like melodic house.',
  clientRequestId: 'request-0001',
};
describe('chat ownership and request lifecycle', () => {
  it('rejects unsigned and deleted users', async () => {
    const { t, a, alice } = await setup();
    await expect(t.mutation(api.chat.send, args)).rejects.toThrow(
      'UNAUTHENTICATED',
    );
    await t.run((ctx) => ctx.db.delete(alice));
    await expect(a.mutation(api.chat.send, args)).rejects.toThrow(
      'UNAUTHENTICATED',
    );
  });
  it('returns unavailable for malformed conversation IDs', async () => {
    const { a } = await setup();
    expect(
      await a.query(api.chat.getThread, { threadId: 'not-a-thread' }),
    ).toBeNull();
  });
  it('isolates threads, messages, stop and retry by owner', async () => {
    const { a, b } = await setup();
    const { threadId, requestId } = await a.mutation(api.chat.send, args);
    expect(await b.query(api.chat.getThread, { threadId })).toBeNull();
    expect(
      (
        await b.query(api.chat.listThreads, {
          paginationOpts: { cursor: null, numItems: 20 },
        })
      ).page,
    ).toHaveLength(0);
    await expect(
      b.query(api.chat.listMessages, {
        threadId,
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    ).rejects.toThrow('CONVERSATION_UNAVAILABLE');
    await expect(
      b.mutation(api.chat.send, { ...args, threadId }),
    ).rejects.toThrow('CONVERSATION_UNAVAILABLE');
    await expect(b.mutation(api.chat.stop, { threadId })).rejects.toThrow(
      'CONVERSATION_UNAVAILABLE',
    );
    await expect(
      b.mutation(api.chat.retry, { requestId, clientRequestId: 'retry-0001' }),
    ).rejects.toThrow('CONVERSATION_UNAVAILABLE');
  });
  it('deduplicates first sends and prevents concurrent turns', async () => {
    const { t, a } = await setup();
    const first = await a.mutation(api.chat.send, args);
    expect(await a.mutation(api.chat.send, args)).toEqual(first);
    expect(
      (
        await a.query(api.chat.listThreads, {
          paginationOpts: { cursor: null, numItems: 20 },
        })
      ).page,
    ).toHaveLength(1);
    const messages = await t.run((ctx) =>
      listMessages(ctx, components.agent, {
        threadId: first.threadId,
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    );
    expect(messages.page).toHaveLength(1);
    await expect(
      a.mutation(api.chat.send, {
        ...args,
        threadId: first.threadId,
        clientRequestId: 'request-0002',
      }),
    ).rejects.toThrow('RESPONSE_IN_PROGRESS');
  });
  it('stops queued work and ignores late completion', async () => {
    const { t, a } = await setup();
    const first = await a.mutation(api.chat.send, args);
    await a.mutation(api.chat.stop, { threadId: first.threadId });
    expect(
      await t.mutation(internal.chat.claimRequest, {
        requestId: first.requestId,
      }),
    ).toBeNull();
    await t.mutation(internal.chat.finishRequest, {
      requestId: first.requestId,
    });
    expect(
      (await a.query(api.chat.getThread, { threadId: first.threadId }))?.request
        ?.status,
    ).toBe('stopped');
  });
  it('holds the conversation lock until running cancellation settles', async () => {
    const { t, a } = await setup();
    const first = await a.mutation(api.chat.send, args);
    await t.mutation(internal.chat.claimRequest, {
      requestId: first.requestId,
    });
    await a.mutation(api.chat.stop, { threadId: first.threadId });
    expect(
      (await a.query(api.chat.getThread, { threadId: first.threadId }))?.request
        ?.status,
    ).toBe('stopping');
    await expect(
      a.mutation(api.chat.send, {
        ...args,
        threadId: first.threadId,
        clientRequestId: 'request-0002',
      }),
    ).rejects.toThrow('RESPONSE_IN_PROGRESS');
    await t.mutation(internal.chat.finishRequest, {
      requestId: first.requestId,
    });
    expect(
      (await a.query(api.chat.getThread, { threadId: first.threadId }))?.request
        ?.status,
    ).toBe('stopped');
  });
  it('retries with a new request ID and the same saved prompt', async () => {
    const { t, a } = await setup();
    const first = await a.mutation(api.chat.send, args);
    await t.mutation(internal.chat.claimRequest, {
      requestId: first.requestId,
    });
    await t.mutation(internal.chat.finishRequest, {
      requestId: first.requestId,
      errorCode: 'GENERATION_FAILED',
    });
    const retryArgs = {
      requestId: first.requestId,
      clientRequestId: 'retry-0001',
    };
    const second = await a.mutation(api.chat.retry, retryArgs);
    expect(second.requestId).not.toEqual(first.requestId);
    expect(await a.mutation(api.chat.retry, retryArgs)).toEqual(second);
    const firstState = await t.query(internal.chat.requestState, {
      requestId: first.requestId,
    });
    const secondState = await t.query(internal.chat.requestState, {
      requestId: second.requestId,
    });
    expect(secondState?.promptMessageId).toBe(firstState?.promptMessageId);
    await t.mutation(internal.chat.finishRequest, {
      requestId: first.requestId,
    });
    expect(
      (
        await t.query(internal.chat.requestState, {
          requestId: second.requestId,
        })
      )?.status,
    ).toBe('queued');
  });
  it('expires abandoned work and rejects invalid input', async () => {
    const { t, a } = await setup();
    await expect(
      a.mutation(api.chat.send, { ...args, prompt: ' ' }),
    ).rejects.toThrow('INVALID_MESSAGE');
    await expect(
      a.mutation(api.chat.send, { ...args, prompt: 'a'.repeat(8001) }),
    ).rejects.toThrow('INVALID_MESSAGE');
    const first = await a.mutation(api.chat.send, args);
    vi.setSystemTime(Date.now() + 180_001);
    await t.mutation(internal.chat.expireRequest, {
      requestId: first.requestId,
    });
    expect(
      (
        await t.query(internal.chat.requestState, {
          requestId: first.requestId,
        })
      )?.status,
    ).toBe('failed');
  });
});
