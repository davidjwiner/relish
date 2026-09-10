import { defineApp } from 'convex/server';
import browserbase from './components/browserbase/convex.config';
import agent from '@convex-dev/agent/convex.config';
import workflow from '@convex-dev/workflow/convex.config';
import exa from '@exalabs/convex-exa/convex.config';
import { v } from 'convex/values';
import staticHosting from '@convex-dev/static-hosting/convex.config';

const app = defineApp({
  env: {
    EXA_API_KEY: v.string(),
    BROWSERBASE_API_KEY: v.optional(v.string()),
    BROWSERBASE_PROJECT_ID: v.optional(v.string()),
  },
});
app.use(browserbase, {
  env: {
    BROWSERBASE_API_KEY: app.env.BROWSERBASE_API_KEY,
    BROWSERBASE_PROJECT_ID: app.env.BROWSERBASE_PROJECT_ID,
  },
});
app.use(agent);
app.use(workflow);
app.use(exa, { env: { EXA_API_KEY: app.env.EXA_API_KEY } });
app.use(staticHosting);
export default app;
