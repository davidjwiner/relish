import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval(
  'dispatch conversation preference extraction',
  { minutes: 5 },
  internal.preferenceWorkflows.dispatchDue,
  {},
);

crons.interval(
  'dispatch taste profile reviews',
  { minutes: 1 },
  internal.tasteProfileWorkflows.dispatchDue,
  {},
);

export default crons;
