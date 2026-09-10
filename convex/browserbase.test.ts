import { convexTest } from 'convex-test';
import agentTest from '@convex-dev/agent/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listMessages } from '@convex-dev/agent';
import schema from './schema';
import browserSchema from './components/browserbase/schema';
import { api, components, internal } from './_generated/api';
import { Browserbase, type BrowserContext } from './lib/browserbaseClient';

const { executeBrowser, calls } = vi.hoisted(() => ({
  executeBrowser: vi.fn(),
  calls: [] as unknown[],
}));
vi.mock('./lib/browserbaseNode', () => ({ executeBrowser }));
vi.mock('convex/server', async (original) => ({
  ...(await original<typeof import('convex/server')>()),
  getServiceToken: vi.fn(async () => 'test-token'),
}));
vi.mock('@convex-dev/ai-sdk-provider', async () => {
  const { mockModel } = await import('@convex-dev/agent');
  return {
    convexGateway: () => {
      const model = mockModel({
        contentSteps: [
          [
            {
              type: 'tool-call',
              toolCallId: 'browser-1',
              toolName: 'browser',
              input: '{"operation":"goto","url":"https://example.com"}',
            },
          ],
          [
            {
              type: 'tool-call',
              toolCallId: 'browser-2',
              toolName: 'browser',
              input: '{"operation":"extract","instruction":"Find tour dates"}',
            },
          ],
          [
            {
              type: 'text',
              text: 'The next show is Friday: https://example.com',
            },
          ],
        ],
        initialDelayInMs: 0,
        chunkDelayInMs: 0,
      });
      const stream = model.doStream.bind(model);
      model.doStream = (args) => {
        calls.push(args);
        return stream(args);
      };
      return model;
    },
  };
});
const fetchMock = vi.fn();
const result = {
  url: 'https://example.com',
  title: 'Example',
  text: 'Friday show',
  actions: [],
  truncated: false,
};

beforeEach(() => {
  vi.stubEnv('BROWSERBASE_API_KEY', 'test-key');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock
    .mockReset()
    .mockImplementation(async () => Response.json({ id: 'session-1' }));
  executeBrowser.mockReset().mockResolvedValue(result);
  calls.length = 0;
});

async function setup() {
  const t = convexTest(schema, import.meta.glob('./**/*.ts'));
  agentTest.register(t);
  t.registerComponent(
    'browserbase',
    browserSchema,
    import.meta.glob('./components/browserbase/**/*.ts'),
  );
  const user = await t.run((ctx) => ctx.db.insert('users', { name: 'Alice' }));
  const a = t.withIdentity({ subject: `${user}|session` });
  const ctx: BrowserContext = {
    runAction: t.action as BrowserContext['runAction'],
  };
  return {
    t,
    a,
    ctx,
    browser: new Browserbase(
      components.browserbase,
      internal.browserActions.execute,
    ),
  };
}

describe('Browserbase component and client', () => {
  it('shares one session across direct and Stagehand operations, then releases it', async () => {
    const { ctx, browser } = await setup();
    await browser.withSession(ctx, async (session) => {
      await session.goto('https://example.com');
      await session.fill('input', 'music');
      await session.click('button');
      await session.text();
      await session.stagehand.observe('Find shows');
      await session.stagehand.act('Open shows');
      expect(await session.stagehand.extract('Get dates')).toEqual(result);
    });
    expect(executeBrowser).toHaveBeenCalledTimes(7);
    expect(executeBrowser.mock.calls.every((c) => c[1] === 'session-1')).toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      keepAlive: true,
      timeout: 180,
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      status: 'REQUEST_RELEASE',
    });
  });

  it('does not start a browser for an unused tool or invalid input', async () => {
    const { ctx, browser } = await setup();
    await browser.withSession(ctx, async (session) => {
      session.tool();
      expect(
        await session.executeTool({
          operation: 'goto',
          url: 'file:///etc/passwd',
        }),
      ).toEqual({ ok: false, error: 'BROWSER_INVALID_URL' });
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serializes calls and refuses further work after an uncertain failure', async () => {
    const { ctx, browser } = await setup();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    executeBrowser.mockImplementationOnce(async () => {
      await wait;
      throw new Error('secret-key in CDP URL');
    });
    await browser.withSession(ctx, async (session) => {
      const first = session.executeTool({
        operation: 'click',
        selector: 'button',
      });
      const second = session.executeTool({ operation: 'text' });
      await vi.waitFor(() => expect(executeBrowser).toHaveBeenCalledTimes(1));
      release();
      expect(await first).toEqual({ ok: false, error: 'BROWSER_UNAVAILABLE' });
      expect(await second).toEqual({
        ok: false,
        error: 'BROWSER_SESSION_UNAVAILABLE',
      });
    });
    expect(executeBrowser).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('closes after a callback failure without replacing the original error', async () => {
    const { ctx, browser } = await setup();
    await expect(
      browser.withSession(ctx, async (session) => {
        await session.text();
        throw new Error('model failed');
      }),
    ).rejects.toThrow('model failed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not start work after cancellation or the generation deadline', async () => {
    const { ctx, browser } = await setup();
    const controller = new AbortController();
    controller.abort();
    for (const options of [{ signal: controller.signal }, { deadlineMs: 0 }]) {
      await browser.withSession(
        ctx,
        async (session) => {
          expect((await session.executeTool({ operation: 'text' })).ok).toBe(
            false,
          );
        },
        options,
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a safe configuration error without breaking ordinary chat', async () => {
    const { ctx, browser } = await setup();
    vi.stubEnv('BROWSERBASE_API_KEY', '');
    await browser.withSession(ctx, async (session) => {
      expect(await session.executeTool({ operation: 'text' })).toEqual({
        ok: false,
        error: 'BROWSER_NOT_CONFIGURED',
      });
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('persists browser results and the final answer in the existing Agent flow', async () => {
    const { t, a } = await setup();
    const saved = await a.mutation(api.chat.send, {
      prompt: 'Find tour dates on example.com',
    });
    await a.action(api.chat.generate, saved);
    expect(executeBrowser).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(calls[2])).toContain('Friday show');
    const messages = await t.run((ctx) =>
      listMessages(ctx, components.agent, {
        threadId: saved.threadId,
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    );
    expect(
      messages.page.some((m) => m.text?.includes('The next show is Friday')),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects another user before opening a browser', async () => {
    const { t, a } = await setup();
    const saved = await a.mutation(api.chat.send, { prompt: 'Browse a page' });
    const user = await t.run((ctx) => ctx.db.insert('users', { name: 'Bob' }));
    await expect(
      t
        .withIdentity({ subject: `${user}|session` })
        .action(api.chat.generate, saved),
    ).rejects.toThrow('CONVERSATION_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
