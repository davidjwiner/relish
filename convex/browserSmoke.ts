'use node';

import BrowserbaseSDK from '@browserbasehq/sdk';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { browser } from './lib/browser';

// Developer-only, fixed public page. Run: pnpm exec convex run browserSmoke:run
export const run = internalAction({
  args: {},
  returns: v.object({
    title: v.string(),
    text: v.string(),
    extraction: v.string(),
    sessionStatus: v.string(),
  }),
  handler: async (
    ctx,
  ): Promise<{
    title: string;
    text: string;
    extraction: string;
    sessionStatus: string;
  }> => {
    let sessionId: string | undefined;
    const result = await browser.withSession(ctx, async (session) => {
      const page = await session.goto('https://example.com');
      sessionId = session.id;
      const text = await session.text();
      const extraction = await session.stagehand.extract(
        'What is this page for?',
      );
      return {
        title: page.title,
        text: text.text.slice(0, 1000),
        extraction: extraction.text.slice(0, 1000),
      };
    });
    if (!sessionId) throw new Error('No session created');
    const sdk = new BrowserbaseSDK({
      apiKey: process.env.BROWSERBASE_API_KEY,
      maxRetries: 0,
      timeout: 5000,
    });
    const session = await sdk.sessions.retrieve(sessionId);
    return { ...result, sessionStatus: session.status };
  },
});
