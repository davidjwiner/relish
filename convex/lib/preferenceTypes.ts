import { v } from 'convex/values';

export const requestValidator = v.object({
  kind: v.literal('search'),
  query: v.string(),
});
export const ownerArgs = {
  userId: v.id('users'),
  threadId: v.string(),
  promptMessageId: v.string(),
};
export const sourceValidator = v.object({
  title: v.string(),
  url: v.string(),
  text: v.string(),
  retrievedAt: v.number(),
});
export type ResearchResult = { answer: string; sourceUrls: string[] };
export const reaction = v.union(v.literal('like'), v.literal('dislike'));
