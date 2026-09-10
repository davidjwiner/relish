import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { query, type QueryCtx, type MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { currentUser } from './lib/preferenceAuth';

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
          .filter((q) => q.neq(q.field('removed'), true))
          .paginate(opts)
      : await ctx.db
          .query('preferences')
          .withIndex('by_user', (q) => q.eq('userId', userId))
          .filter((q) => q.neq(q.field('removed'), true))
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
