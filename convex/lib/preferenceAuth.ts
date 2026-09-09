import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError } from 'convex/values';
import { components } from '../_generated/api';
import type { QueryCtx, MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export async function currentUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId || !(await ctx.db.get(userId)))
    throw new ConvexError('UNAUTHENTICATED');
  return userId;
}
export async function requirePrompt(
  ctx: QueryCtx | MutationCtx,
  args: { userId: Id<'users'>; threadId: string; promptMessageId: string },
) {
  const thread = await ctx.runQuery(components.agent.threads.getThread, {
    threadId: args.threadId,
  });
  if (
    !thread ||
    thread.userId !== args.userId ||
    !(await ctx.db.get(args.userId))
  )
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
  return prompt;
}
