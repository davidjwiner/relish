import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['src/**/*.test.ts', 'convex/**/*.test.ts'],
    server: {
      deps: { inline: ['convex-test', '@convex-dev/ai-sdk-provider'] },
    },
  },
});
