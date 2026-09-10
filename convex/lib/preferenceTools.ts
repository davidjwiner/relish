import { createTool } from '@convex-dev/agent';
import { ExaClient } from '@exalabs/convex-exa';
import { z } from 'zod';
import { components } from '../_generated/api';

const exa = new ExaClient(components.exa);

// Execute tools inside the Agent loop and return their results directly to the
// model so it can answer in the same streamed response.
export const musicTools = {
  webSearch: createTool({
    description:
      'Search the web for music, artists, tracks, and current information. Returns source text and URLs to cite in your answer. Does not save or change preferences.',
    inputSchema: z.object({ query: z.string().trim().min(1).max(1000) }),
    execute: async (ctx, { query }) => {
      try {
        const result = await exa.search(ctx, {
          query,
          numResults: 5,
          type: 'auto',
          contents: {
            text: { maxCharacters: 4000 },
            maxAgeHours: 1,
            livecrawlTimeout: 10000,
          },
        });
        return {
          error: null,
          sources: result.results
            .slice(0, 5)
            .filter((source) => {
              try {
                const url = new URL(source.url);
                return (
                  ['http:', 'https:'].includes(url.protocol) &&
                  !url.username &&
                  !url.password
                );
              } catch {
                return false;
              }
            })
            .map((source) => ({
              title: source.title.slice(0, 300),
              url: source.url,
              text: (source.text ?? source.highlights?.join('\n') ?? '').slice(
                0,
                4000,
              ),
            })),
        };
      } catch {
        return {
          error: 'Web search is unavailable right now. Please try again later.',
          sources: [],
        };
      }
    },
  }),
};
