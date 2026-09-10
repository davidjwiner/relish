import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server';
import { ConvexError, v } from 'convex/values';
import {
  mutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { currentUser } from './lib/preferenceAuth';
import { reaction } from './lib/preferenceTypes';

const targetKind = v.union(v.literal('artist'), v.literal('track'));
const profilePreference = v.object({
  id: v.id('preferences'),
  kind: targetKind,
  title: v.string(),
  artistNames: v.array(v.string()),
  version: v.optional(v.string()),
  reaction,
  reason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});
const profileResult = paginationResultValidator(profilePreference);

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

export const listProfile = query({
  args: {
    paginationOpts: paginationOptsValidator,
    reaction: v.optional(reaction),
    targetKind: v.optional(targetKind),
  },
  returns: profileResult,
  handler: async (ctx, args) => {
    const userId = await currentUser(ctx);
    const opts = {
      ...args.paginationOpts,
      numItems: Math.min(50, Math.max(1, args.paginationOpts.numItems)),
    };
    const page = await (
      args.reaction && args.targetKind
        ? ctx.db
            .query('preferences')
            .withIndex('by_user_reaction_target_kind', (q) =>
              q
                .eq('userId', userId)
                .eq('reaction', args.reaction!)
                .eq('target.kind', args.targetKind!),
            )
        : args.reaction
          ? ctx.db
              .query('preferences')
              .withIndex('by_user_reaction', (q) =>
                q.eq('userId', userId).eq('reaction', args.reaction!),
              )
          : args.targetKind
            ? ctx.db
                .query('preferences')
                .withIndex('by_user_target_kind', (q) =>
                  q.eq('userId', userId).eq('target.kind', args.targetKind!),
                )
            : ctx.db
                .query('preferences')
                .withIndex('by_user', (q) => q.eq('userId', userId))
    )
      .order('desc')
      .paginate(opts);
    return {
      ...page,
      page: await Promise.all(page.page.map((p) => describeProfile(ctx, p))),
    };
  },
});

export const remove = mutation({
  args: { preferenceId: v.id('preferences') },
  returns: v.null(),
  handler: async (ctx, { preferenceId }) => {
    const preference = await ctx.db.get(preferenceId);
    if (!preference || preference.userId !== (await currentUser(ctx)))
      throw new ConvexError('PREFERENCE_UNAVAILABLE');
    await ctx.db.delete(preferenceId);
    return null;
  },
});

async function describeProfile(
  ctx: QueryCtx | MutationCtx,
  preference: Doc<'preferences'>,
) {
  if (preference.target.kind === 'artist') {
    const artist = await ctx.db.get(preference.target.artistId);
    return {
      id: preference._id,
      kind: 'artist' as const,
      title: artist?.name ?? 'Unknown artist',
      artistNames: [],
      reaction: preference.reaction,
      ...(preference.reason ? { reason: preference.reason } : {}),
      createdAt: preference.createdAt,
      updatedAt: preference.updatedAt,
    };
  }
  const track = await ctx.db.get(preference.target.trackId);
  if (!track)
    return {
      id: preference._id,
      kind: 'track' as const,
      title: 'Unknown track',
      artistNames: [],
      reaction: preference.reaction,
      ...(preference.reason ? { reason: preference.reason } : {}),
      createdAt: preference.createdAt,
      updatedAt: preference.updatedAt,
    };
  const artists = await Promise.all(
    track.artistIds.map((artistId) => ctx.db.get(artistId)),
  );
  return {
    id: preference._id,
    kind: 'track' as const,
    title: track.title,
    artistNames: artists.map((artist) => artist?.name ?? 'Unknown artist'),
    ...(track.version ? { version: track.version } : {}),
    reaction: preference.reaction,
    ...(preference.reason ? { reason: preference.reason } : {}),
    createdAt: preference.createdAt,
    updatedAt: preference.updatedAt,
  };
}
