import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { saveMessage } from '@convex-dev/agent';
import { components, internal } from './_generated/api';
import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { currentUser, requirePrompt } from './lib/preferenceAuth';
import {
  normalizeName,
  ownerArgs,
  requestValidator,
  researchValidator,
  validateTarget,
  validatePreferenceRequest,
} from './lib/preferenceTypes';

async function describe(
  ctx: QueryCtx | MutationCtx,
  preference: Doc<'preferences'>,
) {
  if (preference.target.kind === 'artist')
    return (
      (await ctx.db.get(preference.target.artistId))?.name ?? 'Unknown artist'
    );
  const track = await ctx.db.get(preference.target.trackId);
  if (!track) return 'Unknown track';
  const artists = await Promise.all(
    track.artistIds.map((id) => ctx.db.get(id)),
  );
  return `${track.title}${track.version ? ` (${track.version})` : ''} — ${artists.map((a) => a?.name ?? 'Unknown artist').join(', ')}`;
}
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    targetKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await currentUser(ctx);
    const opts = {
      ...args.paginationOpts,
      numItems: Math.min(50, Math.max(1, args.paginationOpts.numItems)),
    };
    const page = args.targetKey
      ? await ctx.db
          .query('preferences')
          .withIndex('by_user_target', (q) =>
            q.eq('userId', userId).eq('targetKey', args.targetKey!),
          )
          .paginate(opts)
      : await ctx.db
          .query('preferences')
          .withIndex('by_user', (q) => q.eq('userId', userId))
          .order('desc')
          .paginate(opts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (p) => ({ ...p, name: await describe(ctx, p) })),
      ),
    };
  },
});
async function artist(ctx: MutationCtx, name: string, sourceUrl?: string) {
  const identityKey = normalizeName(name);
  const existing = await ctx.db
    .query('artists')
    .withIndex('by_identity', (q) => q.eq('identityKey', identityKey))
    .unique();
  return (
    existing?._id ??
    (await ctx.db.insert('artists', {
      name: name.trim(),
      identityKey,
      sourceUrl,
    }))
  );
}

// A normal tool mutation. The write, receipt, and retry result commit together.
export const apply = internalMutation({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    request: requestValidator,
  },
  handler: async (ctx, args): Promise<string> => {
    const userId = await currentUser(ctx);
    const owner = {
      userId,
      threadId: args.threadId,
      promptMessageId: args.promptMessageId,
    };
    const prompt = await requirePrompt(ctx, owner);
    const cached = prompt.providerOptions?.relish?.preferenceResult;
    if (typeof cached === 'string') return cached;
    if (prompt.providerOptions?.relish?.workflowId)
      throw new ConvexError('RESEARCH_ALREADY_STARTED');
    validatePreferenceRequest(args.request, prompt.text);
    if (
      args.request.kind === 'search' ||
      (args.request.kind === 'create' && !args.request.target)
    )
      throw new ConvexError('RESEARCH_REQUIRED');
    const result = await ctx.runMutation(internal.preferences.commit, {
      ...owner,
      request: args.request,
      research: null,
    });
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      promptMessageId: args.promptMessageId,
      message: { role: 'assistant', content: result },
    });
    await ctx.runMutation(components.agent.messages.updateMessage, {
      messageId: prompt._id,
      patch: {
        providerOptions: {
          ...prompt.providerOptions,
          relish: { preferenceResult: result, completionMessageId: messageId },
        },
      },
    });
    return result;
  },
});

// Shared write logic, called transactionally by a tool or as a research workflow step.
export const commit = internalMutation({
  args: {
    ...ownerArgs,
    request: requestValidator,
    research: v.union(researchValidator, v.null()),
  },
  handler: async (ctx, args): Promise<string> => {
    await requirePrompt(ctx, args);
    const request = args.request;
    if (request.kind === 'search')
      return args.research?.answer ?? 'No research result was available.';
    if (request.kind === 'create') {
      const target = request.target ?? args.research?.target;
      if (!target)
        return `No preference was saved. ${args.research?.answer ?? 'Please specify the artist or track you want to save.'}`;
      validateTarget(target);
      const sourceUrl = args.research?.sourceUrls[0];
      let preferenceTarget: Doc<'preferences'>['target'];
      let targetKey: string;
      if (target.kind === 'artist') {
        const artistId = await artist(ctx, target.name, sourceUrl);
        preferenceTarget = { kind: 'artist', artistId };
        targetKey = `artist:${artistId}`;
      } else {
        const artistIds = [];
        for (const name of [...new Set(target.artists.map((a) => a.trim()))])
          artistIds.push(await artist(ctx, name));
        const identityKey = JSON.stringify([
          normalizeName(target.name),
          [...artistIds].sort(),
          normalizeName(target.version ?? ''),
        ]);
        const existing = await ctx.db
          .query('tracks')
          .withIndex('by_identity', (q) => q.eq('identityKey', identityKey))
          .unique();
        const trackId =
          existing?._id ??
          (await ctx.db.insert('tracks', {
            title: target.name.trim(),
            artistIds,
            version: target.version ?? undefined,
            identityKey,
            sourceUrl,
          }));
        preferenceTarget = { kind: 'track', trackId };
        targetKey = `track:${trackId}`;
      }
      const existing = await ctx.db
        .query('preferences')
        .withIndex('by_user_target', (q) =>
          q.eq('userId', args.userId).eq('targetKey', targetKey),
        )
        .unique();
      if (existing)
        return existing.reaction === request.reaction
          ? `${await describe(ctx, existing)} is already saved as a ${existing.reaction}.`
          : `${await describe(ctx, existing)} is currently saved as a ${existing.reaction}. Ask me to update it if you want to change that.`;
      const now = Date.now();
      const id = await ctx.db.insert('preferences', {
        userId: args.userId,
        target: preferenceTarget,
        targetKey,
        reaction: request.reaction,
        reason: request.reason ?? undefined,
        originatingMessageId: args.promptMessageId,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      });
      return `Saved ${await describe(ctx, (await ctx.db.get(id))!)} as a ${request.reaction}.`;
    }
    const preference = await ctx.db.get(request.preferenceId);
    if (!preference || preference.userId !== args.userId)
      return 'That preference is unavailable. Ask me to list your saved preferences.';
    if (preference.revision !== request.expectedRevision)
      return 'That preference changed while I was working. Please ask me to read it again before changing it.';
    const name = await describe(ctx, preference);
    if (request.kind === 'delete') {
      await ctx.db.delete(preference._id);
      return `Removed the saved preference for ${name}.`;
    }
    await ctx.db.patch(preference._id, {
      reaction: request.reaction,
      ...(request.reason !== undefined
        ? { reason: request.reason ?? undefined }
        : {}),
      revision: preference.revision + 1,
      updatedAt: Date.now(),
      originatingMessageId: args.promptMessageId,
    });
    return `Updated ${name} to a ${request.reaction}.`;
  },
});
