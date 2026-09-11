import { v } from 'convex/values';

export const tasteProfileStatus = v.union(
  v.literal('pending'),
  v.literal('running'),
  v.literal('ready'),
  v.literal('empty'),
  v.literal('failed'),
);

export const tasteProfileCoverage = v.union(
  v.literal('complete'),
  v.literal('partial'),
);

export const tasteClaim = v.object({
  text: v.string(),
  evidenceIds: v.array(v.id('preferences')),
});

export const tasteOverview = v.object({
  overview: v.string(),
  overviewEvidenceIds: v.array(v.id('preferences')),
  drawnTo: v.array(tasteClaim),
  avoids: v.array(tasteClaim),
  nuances: v.array(tasteClaim),
  evidenceLevel: v.union(v.literal('limited'), v.literal('developing')),
});
