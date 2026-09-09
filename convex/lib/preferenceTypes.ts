import { v, type Infer } from 'convex/values';
import { z } from 'zod';

export const targetSchema = z.object({
  kind: z.enum(['artist', 'track']),
  name: z.string().trim().min(1).max(200),
  artists: z.array(z.string().trim().min(1).max(200)).max(10),
  version: z.string().trim().max(200).nullable(),
});
export const targetValidator = v.object({
  kind: v.union(v.literal('artist'), v.literal('track')),
  name: v.string(),
  artists: v.array(v.string()),
  version: v.union(v.string(), v.null()),
});
export type MusicTarget = Infer<typeof targetValidator>;
export const reaction = v.union(v.literal('like'), v.literal('dislike'));
export const requestValidator = v.union(
  v.object({ kind: v.literal('search'), query: v.string() }),
  v.object({
    kind: v.literal('create'),
    target: v.union(targetValidator, v.null()),
    researchQuery: v.union(v.string(), v.null()),
    reaction,
    reason: v.union(v.string(), v.null()),
  }),
  v.object({
    kind: v.literal('update'),
    preferenceId: v.id('preferences'),
    expectedRevision: v.number(),
    reaction,
    reason: v.optional(v.union(v.string(), v.null())),
  }),
  v.object({
    kind: v.literal('delete'),
    preferenceId: v.id('preferences'),
    expectedRevision: v.number(),
  }),
);
export type PreferenceRequest = Infer<typeof requestValidator>;
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
export const researchValidator = v.object({
  answer: v.string(),
  target: v.union(targetValidator, v.null()),
  sourceUrls: v.array(v.string()),
});
export type ResearchResult = Infer<typeof researchValidator>;
export const normalizeName = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export function validateTarget(target: MusicTarget) {
  targetSchema.parse(target);
  if (target.kind === 'track' && !target.artists.length)
    throw new Error('A track needs an artist.');
  if (target.kind === 'artist' && (target.artists.length || target.version))
    throw new Error('Artist targets cannot have track fields.');
}
