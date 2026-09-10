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

Convex components cannot execute Node actions. The deployable component owns session creation and release over HTTP, while the component package supplies the required host Node action definition. The package hides that boundary:

```ts
const browser = new Browserbase(
  components.browserbase,
  internal.browserActions.execute,
);
```

- `convex/components/browserbase/`: public client, session methods, Agent adapter, Stagehand transport, contracts, and the deployable component.
- `convex/components/browserbase/component/`: lifecycle actions, shared validators, and an empty schema.
- `convex/browserActions.ts`: the required one-line internal Node action registration; no frontend browser-control endpoint.
- `convex/lib/browser.ts`: Relish-specific wiring of generated component references.
- `convex/chat.ts`: authenticated chat integration and generation lifetime.

Consumers import `Browserbase` from `convex/components/browserbase`. The package exposes `session.tool()` and `browser.tool({ sessionId })`; Relish does not implement either adapter.

Stagehand **3.7.3** is pinned because `keepAlive: true` makes its `close()` disconnect without releasing the remote browser. Final cleanup explicitly releases the Browserbase session. The v4 SDK has a different lifecycle and is not a drop-in replacement. [Stagehand v3 lifecycle documentation](https://docs.stagehand.dev/v3/references/stagehand).

Configure `BROWSERBASE_API_KEY` in Convex; project ID is optional. The live development test passed navigation, direct text reading, Stagehand extraction through separate actions, and final provider status `COMPLETED`.

Keep v1 to one page and one generation, with a 25-second operation deadline and a 180-second provider session timeout as the cleanup backstop. No session tables, cross-turn persistence, or authenticated profiles. See the README for usage and `browserSmoke:run` for the repeatable live test.
