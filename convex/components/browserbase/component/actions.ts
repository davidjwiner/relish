import { v } from 'convex/values';
import { action } from './_generated/server';
import { SESSION_TIMEOUT_SECONDS } from './validation';

async function request(path: string, body: Record<string, unknown>) {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error('BROWSER_NOT_CONFIGURED');
  let response: Response;
  try {
    response = await fetch(`https://api.browserbase.com/v1/sessions${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BB-API-Key': apiKey },
      body: JSON.stringify({
        ...(process.env.BROWSERBASE_PROJECT_ID
          ? { projectId: process.env.BROWSERBASE_PROJECT_ID }
          : {}),
        ...body,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('BROWSER_UNAVAILABLE');
  }
  if (path && response.status === 404) return null;
  if (!response.ok) throw new Error('BROWSER_UNAVAILABLE');
  return response.json() as Promise<unknown>;
}

// Public within the component only. The host app owns authorization.
export const open = action({
  args: {},
  returns: v.string(),
  handler: async () => {
    const response = await request('', {
      keepAlive: true,
      timeout: SESSION_TIMEOUT_SECONDS,
    });
    if (
      !response ||
      typeof response !== 'object' ||
      !('id' in response) ||
      typeof response.id !== 'string'
    )
      throw new Error('BROWSER_UNAVAILABLE');
    return response.id;
  },
});
export const close = action({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (_ctx, { sessionId }) => {
    if (!sessionId) throw new Error('BROWSER_INVALID_INPUT');
    await request(`/${encodeURIComponent(sessionId)}`, {
      status: 'REQUEST_RELEASE',
    });
    return null;
  },
});
