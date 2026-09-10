'use node';

import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { executeBrowser } from './lib/browserbaseNode';
import {
  operationValidator,
  resultValidator,
  validateOperation,
  safeBrowserError,
  OPERATION_TIMEOUT_MS,
} from './components/browserbase/validation';

// Components cannot run Node.js. This internal host adapter supplies the SDK runtime.
export const execute = internalAction({
  args: {
    sessionId: v.string(),
    operation: operationValidator,
    timeoutMs: v.number(),
  },
  returns: resultValidator,
  handler: async (_ctx, args) => {
    try {
      const apiKey = process.env.BROWSERBASE_API_KEY;
      if (!apiKey) throw new Error('BROWSER_NOT_CONFIGURED');
      if (
        !args.sessionId ||
        !Number.isFinite(args.timeoutMs) ||
        args.timeoutMs <= 0
      )
        throw new Error('BROWSER_INVALID_INPUT');
      return await executeBrowser(
        { apiKey, projectId: process.env.BROWSERBASE_PROJECT_ID },
        args.sessionId,
        validateOperation(args.operation),
        Math.min(args.timeoutMs, OPERATION_TIMEOUT_MS),
      );
    } catch (error) {
      throw new Error(safeBrowserError(error));
    }
  },
});
