import { afterEach, expect, it, vi } from 'vitest';
import { generateText, Output } from 'ai';
import { convexGateway } from '@convex-dev/ai-sdk-provider';
import { CHAT_MODEL } from './lib/musicAgent';
import { extractionOutput } from './lib/preferenceExtraction';

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

it('sends the preference extraction schema as strict structured output', async () => {
  let body: Record<string, unknown> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          id: 'test',
          created: 1,
          model: CHAT_MODEL,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  candidates: [
                    {
                      target: { kind: 'artist', name: 'Radiohead' },
                      operation: 'like',
                      evidence: {
                        messageId: 'test-user-message-1',
                        quote: 'I love Radiohead.',
                      },
                      reason: null,
                    },
                  ],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }),
  );

  const result = await generateText({
    model: convexGateway(CHAT_MODEL),
    prompt: 'Extract the preference.',
    output: Output.object({ schema: extractionOutput }),
    maxRetries: 0,
  });
  const responseFormat = body.response_format as {
    type?: string;
    json_schema?: {
      schema?: {
        properties?: {
          candidates?: { items?: { required?: string[] } };
        };
      };
      strict?: boolean;
    };
  };

  expect(responseFormat.type).toBe('json_schema');
  expect(responseFormat.json_schema?.strict).toBe(true);
  expect(
    responseFormat.json_schema?.schema?.properties?.candidates?.items?.required,
  ).toContain('reason');
  expect(result.output.candidates).toHaveLength(1);
  expect(result.warnings).toEqual([]);
});
