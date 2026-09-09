import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { query } from './_generated/server';
export const current = query({
  args: {},
  returns: v.object({ id: v.id('users'), name: v.optional(v.string()) }),
  handler: async (ctx) => {
    const id = await getAuthUserId(ctx);
    if (!id) throw new ConvexError('UNAUTHENTICATED');
    const user = await ctx.db.get(id);
    if (!user) throw new ConvexError('UNAUTHENTICATED');
    return { id: user._id, name: user.name };
  },
});
