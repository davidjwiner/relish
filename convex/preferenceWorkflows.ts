import {
  WorkflowManager,
  start,
  getStatus,
  vWorkflowId,
  vResultValidator,
  type WorkflowId,
} from '@convex-dev/workflow';
import { saveMessage, type MessageDoc } from '@convex-dev/agent';
import { ConvexError, v } from 'convex/values';
import { components, internal } from './_generated/api';
import { internalMutation, query } from './_generated/server';
import { currentUser, requirePrompt } from './lib/preferenceAuth';
import {
  ownerArgs,
  requestValidator,
  validateTarget,
  type ResearchResult,
} from './lib/preferenceTypes';

const workflow = new WorkflowManager(components.workflow);
export function workflowReference(prompt: Pick<MessageDoc, 'providerOptions'>) {
  const id = prompt.providerOptions?.relish?.workflowId;
  return typeof id === 'string' ? (id as WorkflowId) : undefined;
}
export const begin = internalMutation({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    request: requestValidator,
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ workflowId: string; status: string }> => {
    const userId = await currentUser(ctx);
    const owner = {
      userId,
      threadId: args.threadId,
      promptMessageId: args.promptMessageId,
    };
    const prompt = await requirePrompt(ctx, owner);
    const existing = workflowReference(prompt);
    if (existing)
      return {
        workflowId: existing,
        status:
          'This message already started a workflow. Its result will appear in this conversation; use a new message for another request.',
      };
    const request = args.request;
    if (
      request.kind === 'search' &&
      (!request.query.trim() || request.query.length > 1000)
    )
      throw new ConvexError('INVALID_RESEARCH_QUERY');
    if (request.kind === 'create') {
      if (request.target) validateTarget(request.target);
      if (!request.target && !request.researchQuery?.trim())
        throw new ConvexError('TARGET_REQUIRED');
      if ((request.researchQuery?.length ?? 0) > 1000)
        throw new ConvexError('INVALID_RESEARCH_QUERY');
    }
    if ('reason' in request && request.reason != null) {
      if (
        request.reason.length > 1000 ||
        !prompt.text?.includes(request.reason)
      )
        throw new ConvexError('REASON_MUST_QUOTE_USER');
    }
    if (
      'expectedRevision' in request &&
      (!Number.isSafeInteger(request.expectedRevision) ||
        request.expectedRevision < 1)
    )
      throw new ConvexError('INVALID_REVISION');
    const workflowId = await start(
      ctx,
      internal.preferenceWorkflows.run,
      { ...owner, request, asOf: Date.now() },
      {
        startAsync: true,
        onComplete: internal.preferenceWorkflows.complete,
        context: owner,
      },
    );
    // One transaction: even a lost tool response cannot orphan a workflow start.
    await ctx.runMutation(components.agent.messages.updateMessage, {
      messageId: prompt._id,
      patch: {
        providerOptions: { ...prompt.providerOptions, relish: { workflowId } },
      },
    });
    return {
      workflowId,
      status:
        request.kind === 'search' ||
        (request.kind === 'create' && !request.target)
          ? 'Research started. The result will appear here.'
          : 'Preference change started. The result will appear here.',
    };
  },
});
export const run = workflow
  .define({
    args: { ...ownerArgs, request: requestValidator, asOf: v.number() },
    returns: v.string(),
  })
  .handler(async (step, args): Promise<string> => {
    let research: ResearchResult | null = null;
    const request = args.request;
    const query =
      request.kind === 'search'
        ? request.query
        : request.kind === 'create' && !request.target
          ? request.researchQuery
          : null;
    if (query) {
      const found = await step.runAction(
        internal.lib.musicResearch.search,
        { query, asOf: args.asOf },
        { retry: { maxAttempts: 3, initialBackoffMs: 1000, base: 2 } },
      );
      if (found.error) return found.error;
      research = await step.runAction(
        internal.lib.musicResearch.interpret,
        {
          query,
          resolveTarget: request.kind === 'create',
          asOf: args.asOf,
          sources: found.sources,
        },
        { retry: false },
      );
    }
    const outcome = await step.runMutation(internal.preferences.commit, {
      userId: args.userId,
      threadId: args.threadId,
      promptMessageId: args.promptMessageId,
      request,
      research,
    });
    const sources = research?.sourceUrls
      .map(
        (url, i) =>
          `[Source ${i + 1}](${url.replaceAll('(', '%28').replaceAll(')', '%29')})`,
      )
      .join(' · ');
    return outcome + (sources ? `\n\n${sources}` : '');
  });
export const complete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object(ownerArgs),
  },
  handler: async (ctx, args) => {
    let prompt;
    try {
      prompt = await requirePrompt(ctx, args.context);
    } catch (error) {
      if (
        error instanceof ConvexError &&
        ['CONVERSATION_UNAVAILABLE', 'INVALID_MESSAGE'].includes(
          String(error.data),
        )
      )
        return;
      throw error;
    }
    if (
      workflowReference(prompt) !== args.workflowId ||
      prompt.providerOptions?.relish?.completionMessageId
    )
      return;
    const text =
      args.result.kind === 'success' &&
      typeof args.result.returnValue === 'string'
        ? args.result.returnValue
        : 'The research or preference request did not finish. Ask me to list your saved preferences before trying the change again.';
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.context.threadId,
      promptMessageId: args.context.promptMessageId,
      message: { role: 'assistant', content: text },
    });
    await ctx.runMutation(components.agent.messages.updateMessage, {
      messageId: prompt._id,
      patch: {
        providerOptions: {
          ...prompt.providerOptions,
          relish: {
            workflowId: args.workflowId,
            completionMessageId: messageId,
          },
        },
      },
    });
  },
});
export const statuses = query({
  args: { threadId: v.string(), promptMessageIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const userId = await currentUser(ctx);
    if (args.promptMessageIds.length > 100)
      throw new ConvexError('TOO_MANY_MESSAGES');
    const thread = await ctx.runQuery(components.agent.threads.getThread, {
      threadId: args.threadId,
    });
    if (!thread || thread.userId !== userId) return [];
    return Promise.all(
      args.promptMessageIds.map(async (promptMessageId) => {
        const prompt = await requirePrompt(ctx, {
          userId,
          threadId: args.threadId,
          promptMessageId,
        });
        const id = workflowReference(prompt);
        if (!id) return { promptMessageId, status: 'none' as const };
        const status = await getStatus(ctx, components.workflow, id);
        return { promptMessageId, status: status.type };
      }),
    );
  },
});
