# Minimal Browserbase component

Implemented: direct browser methods, Stagehand methods, and an Agent tool adapter over one shared browser session.

```ts
import { browser } from './convex/lib/browser';

await browser.withSession(ctx, async (session) => {
  await session.goto('https://example.com');
  const page = await session.text();
  const facts = await session.stagehand.extract('What is this page for?');
  return { page, facts };
});
```

| API           | Methods                                                            |
| ------------- | ------------------------------------------------------------------ |
| Lifecycle     | `open(ctx)`, `close(ctx, sessionId)`, `withSession(ctx, fn)`       |
| Browser       | `goto(url)`, `click(selector)`, `fill(selector, value)`, `text()`  |
| Stagehand     | `act(instruction)`, `observe(instruction)`, `extract(instruction)` |
| Agent adapter | `browser.tool({ sessionId })`, or bound `session.tool()`           |

Results contain `url`, `title`, bounded `text`, observed `actions`, and a `truncated` flag. Stagehand extraction currently returns natural-language text rather than a caller-defined schema.

Relish's chat generation already uses:

```ts
tools: { ...musicTools, browser: session.tool() }
```

It awaits the response inside `withSession`. The browser starts only if a tool uses it, survives successive operations, and closes after the generation. Calls run sequentially. Failed remote interactions retire the session rather than being retried.

## Implementation boundary

Convex components cannot execute Node actions. The component therefore owns session creation and release over HTTP, while an internal host Node action executes SDK operations. The client hides that boundary:

```ts
const browser = new Browserbase(
  components.browserbase,
  internal.browserActions.execute,
);
```

- `convex/components/browserbase/`: config, lifecycle actions, shared validators, and an empty schema.
- `convex/lib/browserbaseClient.ts`: session methods and Agent adapter.
- `convex/lib/browserbaseNode.ts`: Stagehand connection and operation dispatch.
- `convex/browserActions.ts`: internal Node action; no frontend browser-control endpoint.
- `convex/chat.ts`: authenticated chat integration and generation lifetime.

Stagehand **3.7.3** is pinned because `keepAlive: true` makes its `close()` disconnect without releasing the remote browser. Final cleanup explicitly releases the Browserbase session. The v4 SDK has a different lifecycle and is not a drop-in replacement. [Stagehand v3 lifecycle documentation](https://docs.stagehand.dev/v3/references/stagehand).

Configure `BROWSERBASE_API_KEY` in Convex; project ID is optional. The live development test passed navigation, direct text reading, Stagehand extraction through separate actions, and final provider status `COMPLETED`.

Keep v1 to one page and one generation, with a 25-second operation deadline and a 180-second provider session timeout as the cleanup backstop. No session tables, cross-turn persistence, or authenticated profiles. See the README for usage and `browserSmoke:run` for the repeatable live test.
