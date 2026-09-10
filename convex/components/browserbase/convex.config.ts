import { defineComponent } from 'convex/server';
import { v } from 'convex/values';

export default defineComponent('browserbase', {
  env: {
    BROWSERBASE_API_KEY: v.optional(v.string()),
    BROWSERBASE_PROJECT_ID: v.optional(v.string()),
  },
});
