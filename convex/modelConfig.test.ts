import { afterEach, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import { convexGateway } from '@convex-dev/ai-sdk-provider';
import { CHAT_MODEL } from './lib/musicAgent';

vi.mock('convex/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('convex/server')>()),
  getServiceToken: vi.fn(async () => 'test-token'),
}));
afterEach(() => vi.unstubAllGlobals());
it('sends Sol medium to the Convex gateway with backend-only authentication', async () => {
  let body: Record<string, unknown> = {};
  let endpoint = '';
  let authorization = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      endpoint = String(url);
      body = JSON.parse(String(init.body));
      authorization = new Headers(init.headers).get('Authorization') ?? '';
      return new Response(
        JSON.stringify({
          id: 'test',
          created: 1,
          model: CHAT_MODEL,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Test reply' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }),
  );
  await generateText({
    model: convexGateway(CHAT_MODEL),
    prompt: 'Test',
    maxRetries: 0,
    providerOptions: { convexGateway: { reasoningEffort: 'medium' } },
  });
  expect(endpoint).toBe('https://ai-gateway.convex.dev/v1/chat/completions');
  expect(body.model).toBe('openai/gpt-5.6-sol');
  expect(body.reasoning_effort).toBe('medium');
  expect(body.temperature).toBeUndefined();
  expect(authorization).toBe('Bearer test-token');
});
