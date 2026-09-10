import { getAuthUserId } from '@convex-dev/auth/server';
import {
  abortStream,
  listStreams,
  createThread,
  saveMessage,
  listUIMessages,
  syncStreams,
  vStreamArgs,
} from '@convex-dev/agent';
import { paginationOptsValidator, getServiceToken } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { api, components } from './_generated/api';
import {
  mutation,
  query,
  action,
  type QueryCtx,
  type MutationCtx,
} from './_generated/server';
import type { Id } from './_generated/dataModel';
import { musicAgent } from './lib/musicAgent';
import { workflowReference } from './preferenceWorkflows';

async function currentUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId || !(await ctx.db.get(userId)))
    throw new ConvexError('UNAUTHENTICATED');
  return userId;
}
async function ownedThread(
  ctx: QueryCtx | MutationCtx,
  threadId: string,
  userId: Id<'users'>,
) {
  try {
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId,
    });
    return thread?.userId === userId ? thread : null;
  } catch (error) {
    // Component IDs are opaque; malformed route IDs should render the same
    // unavailable state as a missing thread, without swallowing service errors.
    if (
      error instanceof Error &&
      /ArgumentValidationError|Validator error|Invalid.*ID/i.test(error.message)
    )
      return null;
    throw error;
  }
}

async function requireThread(ctx: QueryCtx | MutationCtx, threadId: string) {
  const thread = await ownedThread(ctx, threadId, await currentUser(ctx));
  if (!thread) throw new ConvexError('CONVERSATION_UNAVAILABLE');
  return thread;
}

export const listThreads = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) =>
    ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId: await currentUser(ctx),
      paginationOpts,
    }),
});
export const getThread = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const thread = await ownedThread(ctx, threadId, await currentUser(ctx));
    return thread ? { title: thread.title ?? 'Conversation' } : null;
  },
});
export const deleteThread = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    await requireThread(ctx, threadId);
    const streams = await listStreams(ctx, components.agent, {
      threadId,
      includeStatuses: ['streaming'],
    });
    for (const stream of streams)
      await abortStream(ctx, components.agent, {
        streamId: stream.streamId,
        reason: 'Conversation deleted',
      });
    // Remove access immediately while Agent cleans up large histories in batches.
    await ctx.runMutation(components.agent.threads.updateThread, {
      threadId,
      patch: { userId: `deleted:${threadId}` },
    });
    await musicAgent.deleteThreadAsync(ctx, { threadId });
  },
});
// This query is the bridge between Agent's persisted streams and the React hook.
export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    // Active subscriptions can rerun after the conversation is deleted.
    if (!(await ownedThread(ctx, args.threadId, await currentUser(ctx))))
      return { page: [], isDone: true, continueCursor: '', streams: undefined };
    const messages = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, {
      ...args,
      includeStatuses: ['streaming', 'aborted', 'finished'],
    });
    return {
      ...messages,
      page: messages.page.filter(
        (m) => m.role === 'user' || m.role === 'assistant',
      ),
      streams,
    };
  },
});
// Save first so a generation failure never loses the user's message.
export const send = mutation({
  args: { threadId: v.optional(v.string()), prompt: v.string() },
  handler: async (ctx, { threadId, prompt }) => {
    const userId = await currentUser(ctx);
    prompt = prompt.trim();
    if (!prompt || prompt.length > 8000)
      throw new ConvexError('INVALID_MESSAGE');
    if (threadId) await requireThread(ctx, threadId);
    else
      threadId = await createThread(ctx, components.agent, {
        userId,
        title: prompt.replace(/\s+/g, ' ').slice(0, 60),
      });
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      userId,
      prompt,
    });
    return { threadId, promptMessageId: messageId };
  },
});
// Called directly by the browser. Agent owns messages and stream state entirely.
export const generate = action({
  args: { threadId: v.string(), promptMessageId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    if (!(await ctx.runQuery(api.chat.getThread, { threadId: args.threadId })))
      throw new ConvexError('CONVERSATION_UNAVAILABLE');
    const [prompt] = await ctx.runQuery(
      components.agent.messages.getMessagesByIds,
      { messageIds: [args.promptMessageId] },
    );
    if (
      !prompt ||
      prompt.threadId !== args.threadId ||
      prompt.message?.role !== 'user'
    )
      throw new ConvexError('INVALID_MESSAGE');
    // Reuse a research workflow already started for this prompt.
    if (workflowReference(prompt)) return;
    try {
      await getServiceToken('ai-gateway');
    } catch {
      throw new ConvexError('GATEWAY_UNAVAILABLE');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const result = await musicAgent.streamText(
        ctx,
        { threadId: args.threadId },
        {
          promptMessageId: args.promptMessageId,
          abortSignal: controller.signal,
          maxOutputTokens: 8192,
          maxRetries: 0,
          providerOptions: { convexGateway: { reasoningEffort: 'medium' } },
        },
        { saveStreamDeltas: { throttleMs: 100 } },
      );
      if (
        ['error', 'length'].includes(await result.finishReason) ||
        !(await result.text).trim()
      )
        throw new Error('Incomplete response');
    } catch {
      throw new ConvexError('GENERATION_FAILED');
    } finally {
      clearTimeout(timeout);
    }
  },
});
export const stop = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    await requireThread(ctx, threadId);
    const streams = await listStreams(ctx, components.agent, {
      threadId,
      includeStatuses: ['streaming'],
    });
    for (const stream of streams)
      await abortStream(ctx, components.agent, {
        streamId: stream.streamId,
        reason: 'Stopped by user',
      });
  },
});
