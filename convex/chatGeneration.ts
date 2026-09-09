import { v } from 'convex/values';
import { getServiceToken } from 'convex/server';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { musicAgent } from './lib/musicAgent';

export const generate = internalAction({
  args: { requestId: v.id('chatRequests') },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.runMutation(internal.chat.claimRequest, {
      requestId,
    });
    if (!request) return;
    // Fail before creating any stream if this deployment has no gateway access.
    try {
      await getServiceToken('ai-gateway');
    } catch {
      await ctx.runMutation(internal.chat.finishRequest, {
        requestId,
        errorCode: 'GATEWAY_UNAVAILABLE',
      });
      return;
    }
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 120_000);
    let done = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let polling: Promise<void> = Promise.resolve();
    const poll = async () => {
      try {
        const state = await ctx.runQuery(internal.chat.requestState, {
          requestId,
        });
        if (!state || state.status !== 'running') controller.abort();
      } catch {
        controller.abort();
      }
      if (!done && !controller.signal.aborted)
        pollTimer = setTimeout(() => {
          polling = poll();
        }, 500);
    };
    polling = poll();
    await polling;
    let errorCode: string | undefined;
    try {
      const result = await musicAgent.streamText(
        ctx,
        { threadId: request.threadId },
        {
          promptMessageId: request.promptMessageId,
          abortSignal: controller.signal,
          maxOutputTokens: 8192,
          maxRetries: 0,
          providerOptions: { convexGateway: { reasoningEffort: 'medium' } },
        },
        { saveStreamDeltas: { throttleMs: 100 } },
      );
      const reason = await result.finishReason;
      if (controller.signal.aborted) errorCode = 'INTERRUPTED';
      else if (
        reason === 'error' ||
        reason === 'length' ||
        !(await result.text).trim()
      )
        errorCode = 'GENERATION_FAILED';
    } catch {
      // Provider errors may contain raw prompts or credentials. Persist only a safe category.
      errorCode = controller.signal.aborted
        ? 'INTERRUPTED'
        : 'GENERATION_FAILED';
    } finally {
      done = true;
      clearTimeout(deadline);
      if (pollTimer) clearTimeout(pollTimer);
      await polling;
    }
    await ctx.runMutation(internal.chat.finishRequest, {
      requestId,
      errorCode,
    });
  },
});
