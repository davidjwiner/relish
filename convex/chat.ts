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
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { components, internal } from './_generated/api';
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

export const MAX_PROMPT_LENGTH = 8000;
export const isActive = (status: string) =>
  ['queued', 'running', 'stopping'].includes(status);

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

async function getLatestRequest(ctx: QueryCtx | MutationCtx, threadId: string) {
  return ctx.db
    .query('chatRequests')
    .withIndex('by_thread', (q) => q.eq('threadId', threadId))
    .order('desc')
    .first();
}
function validateRequestId(id: string) {
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(id))
    throw new ConvexError('INVALID_REQUEST');
}
async function existingRequest(
  ctx: MutationCtx,
  userId: Id<'users'>,
  clientRequestId: string,
) {
  validateRequestId(clientRequestId);
  return ctx.db
    .query('chatRequests')
    .withIndex('by_user_request', (q) =>
      q.eq('userId', userId).eq('clientRequestId', clientRequestId),
    )
    .unique();
}
async function enqueue(
  ctx: MutationCtx,
  data: Pick<
    Doc<'chatRequests'>,
    'userId' | 'threadId' | 'clientRequestId' | 'promptMessageId'
  >,
) {
  const requestId = await ctx.db.insert('chatRequests', {
    ...data,
    status: 'queued',
  });
  await ctx.scheduler.runAfter(0, internal.chatGeneration.generate, {
    requestId,
  });
  await ctx.scheduler.runAfter(180_000, internal.chat.expireRequest, {
    requestId,
  });
  return { threadId: data.threadId, requestId };
}

export const listThreads = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const userId = await currentUser(ctx);
    return await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId,
      paginationOpts,
    });
  },
});
export const getThread = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const userId = await currentUser(ctx);
    const thread = await ownedThread(ctx, threadId, userId);
    if (!thread) return null;
    return {
      title: thread.title ?? 'Conversation',
      request: await getLatestRequest(ctx, threadId),
    };
  },
});
export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const page = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, {
      ...args,
      includeStatuses: ['streaming', 'aborted', 'finished'],
    });
    return {
      ...page,
      page: page.page.filter(
        (m) => m.role === 'user' || m.role === 'assistant',
      ),
      streams,
    };
  },
});
export const send = mutation({
  args: {
    threadId: v.optional(v.string()),
    prompt: v.string(),
    clientRequestId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; requestId: Id<'chatRequests'> }> => {
    const userId = await currentUser(ctx);
    const prompt = args.prompt.trim();
    if (!prompt || prompt.length > MAX_PROMPT_LENGTH)
      throw new ConvexError('INVALID_MESSAGE');
    const existing = await existingRequest(ctx, userId, args.clientRequestId);
    if (existing)
      return { threadId: existing.threadId, requestId: existing._id };
    let threadId = args.threadId;
    if (threadId) {
      const latest = await getLatestRequest(ctx, threadId);
      if (latest && isActive(latest.status))
        throw new ConvexError('RESPONSE_IN_PROGRESS');
    } else {
      threadId = await createThread(ctx, components.agent, {
        userId,
        title: prompt.replace(/\s+/g, ' ').slice(0, 60),
      });
    }
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      userId,
      prompt,
    });
    return enqueue(ctx, {
      userId,
      threadId,
      promptMessageId: messageId,
      clientRequestId: args.clientRequestId,
    });
  },
});
export const stop = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const request = await getLatestRequest(ctx, threadId);
    if (!request || !isActive(request.status)) return;
    // A queued action observes the terminal state and exits without a model call.
    // A running action polls this state and aborts its provider request before releasing the lock.
    await ctx.db.patch(
      request._id,
      request.status === 'queued'
        ? { status: 'stopped', finishedAt: Date.now() }
        : { status: 'stopping' },
    );
  },
});
export const retry = mutation({
  args: { requestId: v.id('chatRequests'), clientRequestId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; requestId: Id<'chatRequests'> }> => {
    const userId = await currentUser(ctx);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.userId !== userId)
      throw new ConvexError('CONVERSATION_UNAVAILABLE');
    const existing = await existingRequest(ctx, userId, args.clientRequestId);
    if (existing)
      return { threadId: existing.threadId, requestId: existing._id };
    const latest = await getLatestRequest(ctx, request.threadId);
    if (latest?._id !== request._id || request.status !== 'failed')
      throw new ConvexError('RETRY_UNAVAILABLE');
    return enqueue(ctx, {
      userId,
      threadId: request.threadId,
      promptMessageId: request.promptMessageId,
      clientRequestId: args.clientRequestId,
    });
  },
});

export const expireRequest = internalMutation({
  args: { requestId: v.id('chatRequests') },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get(requestId);
    if (!request || !isActive(request.status)) return;
    const expiresAt = (request.startedAt ?? request._creationTime) + 180_000;
    if (Date.now() < expiresAt) {
      await ctx.scheduler.runAfter(
        expiresAt - Date.now(),
        internal.chat.expireRequest,
        { requestId },
      );
      return;
    }
    // Fence stream writes before releasing a crashed worker's conversation lock.
    const streams = await listStreams(ctx, components.agent, {
      threadId: request.threadId,
      includeStatuses: ['streaming'],
    });
    for (const stream of streams)
      await abortStream(ctx, components.agent, {
        streamId: stream.streamId,
        reason: 'Request timed out',
      });
    await ctx.db.patch(requestId, {
      status: request.status === 'stopping' ? 'stopped' : 'failed',
      finishedAt: Date.now(),
      errorCode: 'TIMEOUT',
    });
  },
});
