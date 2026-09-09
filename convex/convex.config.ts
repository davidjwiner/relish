import { defineApp } from 'convex/server';
import agent from '@convex-dev/agent/convex.config';
import workflow from '@convex-dev/workflow/convex.config';
import exa from '@exalabs/convex-exa/convex.config';
import { v } from 'convex/values';

const app = defineApp({ env: { EXA_API_KEY: v.string() } });
app.use(agent);
app.use(workflow);
app.use(exa, { env: { EXA_API_KEY: app.env.EXA_API_KEY } });
export default app;
