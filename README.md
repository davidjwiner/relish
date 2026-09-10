# Relish

A music-taste app built with React and Convex. See [design.md](./design.md) for the product plan.

## Development

Use the Node.js and pnpm versions specified in [package.json](./package.json).

```sh
pnpm install --frozen-lockfile
pnpm dev:backend
```

Select your Convex project when prompted. This creates `.env.local` and syncs the backend. Keep it running, then start the frontend in another terminal:

```sh
pnpm dev
```

Open [localhost:5173](http://localhost:5173).

## Authentication

For a new Convex deployment, run `pnpm setup:auth` and configure a Google OAuth Web client. Use `http://localhost:5173` as the JavaScript origin and your deployment's Convex HTTP actions URL followed by `/api/auth/callback/google` as the redirect URI.

Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in Convex. See [.env.example](./.env.example) for configuration names. Keep secrets out of frontend environment variables and source control.

## Chat

Chat uses assistant-ui with Convex Agent for persisted conversations and streaming. The default model is `openai/gpt-5.6-sol` with medium reasoning through the Convex AI Gateway. Backend requests use deployment-scoped gateway authentication; no OpenAI API key belongs in frontend configuration.

Run `pnpm dev:backend` to install/sync the Agent component and regenerate bindings. Enable AI Gateway for your Convex team before expecting model replies. On September 9, 2026, a real request against this development deployment was rejected because gateway access is not enabled; Convex reports that a paid plan is required. Conversation storage, navigation, and recoverable errors work, but a successful real model round trip remains unverified.

Once gateway access is enabled, open Chat, send a prompt, verify a streamed reply and a contextual follow-up, reload the conversation URL, then test stopping a response. The Retry response button reuses the saved prompt. Threads are private to the signed-in user. Drafts stay in memory while navigating and are cleared on reload/logout.

Chat exposes Exa web search and a Browserbase browser tool, executed directly within the Agent response loop. Set `EXA_API_KEY` in the Convex dashboard, then run `pnpm dev:backend` to sync the Exa and Workflow components. Exa credentials remain backend-only; the agent uses returned source text and URLs to answer within the same response.

Chat does not save, update, or delete preferences in the response path. Likes and dislikes receive normal replies while a silent background workflow extracts explicit artist and track preferences later. The recurring dispatcher is disabled unless `PREFERENCE_EXTRACTION_ENABLED=true` is set in the Convex backend; run the paginated `preferenceWorkflows:backfillPage` operation before enabling it. See the [background extraction design](./conversation-preference-extraction.md).

Music research runs inline with the chat response. The agent can search and continue answering for up to five steps. Search failures are returned to the agent so it can explain that verification is unavailable.

Smoke-test “I like Noah Kahan” and verify a normal reply without a save confirmation or preference write. Ask to research a track and verify that Exa results lead to a sourced answer in the same response. Research must never save a preference. See [Step 3](./step-3-preference-tools.md) for scope and implementation notes.

## Browser API

Set `BROWSERBASE_API_KEY` in the Convex backend. `BROWSERBASE_PROJECT_ID` is optional. Run `pnpm dev:backend` to sync the component. With no key configured, ordinary chat still works and browser calls return `BROWSER_NOT_CONFIGURED`.

```ts
import { browser } from './lib/browser';

await browser.withSession(ctx, async (session) => {
  await session.goto('https://example.com');
  const page = await session.text(); // { url, title, text, actions, truncated }
  const facts = await session.stagehand.extract('What is this page for?');
  return { page, facts };
});
```

Direct methods: `goto(url)`, `click(selector)`, `fill(selector, value)`, and `text()`. Stagehand methods: `session.stagehand.act(instruction)`, `.observe(instruction)`, and `.extract(instruction)`. All return bounded results with the page URL and title. `observe` returns selectors and descriptions in `actions`.

Use `tools: { ...musicTools, browser: session.tool() }` inside `withSession` to give these operations to an Agent. Await generation completion inside the callback. Relish already does this in `chat.generate`. A session starts lazily, is shared by sequential calls during one generation, and is released in `finally`. It does not persist across turns. For manual lifecycle control, use `await browser.open(ctx)` and `await session.close()`; `browser.tool({ sessionId })` binds an existing session, whose caller must close it.

The component manages session creation/release over HTTP. Convex components cannot run Node actions, so `browserActions.execute` supplies the internal Node runtime for the SDK. The reusable client is initialized with `new Browserbase(components.browserbase, internal.browserActions.execute)`. Stagehand is pinned to **3.7.3** for its reconnect and keep-alive disconnect behavior; upgrading to v4 requires revisiting that lifecycle. Node dependencies are configured in `convex.json`.

Operations have a 25-second deadline, with a 180-second provider session timeout as a cleanup backstop. Failed remote operations retire the session and are not retried. Stop prevents further tool work when the Agent supplies an abort signal; a remote operation already running may continue until its deadline. This version uses one page, fresh browser state, and no session tables.

Run the developer-only smoke test after deployment:

```sh
pnpm exec convex run browserSmoke:run '{}'
```

It opens Example Domain, reads it, extracts facts through Stagehand in a separate action, closes the session, and reports the provider's session status. It uses Browserbase browser minutes and Stagehand inference.

## Production deployments

GitHub Actions deploys the committed `main` branch to https://graceful-monitor-911.convex.site whenever a push lands on `main`. You can also run **Deploy production** from the repository's Actions tab with `main` selected. The workflow installs the locked dependencies, runs lint, tests, and the build, then deploys the Convex backend and static frontend. Deployments run one at a time.

One-time setup:

1. In the Convex dashboard, select the `graceful-monitor-911` production deployment and generate a production deploy key.
2. In GitHub → Settings → Secrets and variables → Actions, add it as `CONVEX_DEPLOY_KEY` (a repository secret or a secret in the `production` environment). Never commit the key.
3. Keep application secrets in Convex. Set production `SITE_URL` to `https://graceful-monitor-911.convex.site` and allow `https://graceful-monitor-911.convex.site/api/auth/callback/google` in the Google OAuth client.

The hosting component preserves existing authentication routes and supports direct visits to client-side routes. The workflow supplies deployment credentials; it does not use a developer's `.env.local` or upload their working directory.

## Checks

```sh
pnpm format:check
pnpm lint
pnpm test
pnpm build
```
