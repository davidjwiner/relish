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

Chat exposes a single Exa web search tool, executed directly within the Agent response loop. Set `EXA_API_KEY` in the Convex dashboard, then run `pnpm dev:backend` to sync the Exa and Workflow components. Exa credentials remain backend-only; the agent uses returned source text and URLs to answer within the same response.

Chat does not save, update, or delete preferences in the response path. Likes and dislikes receive normal replies while a silent background workflow extracts explicit artist and track preferences later. The recurring dispatcher is disabled unless `PREFERENCE_EXTRACTION_ENABLED=true` is set in the Convex backend; run the paginated `preferenceWorkflows:backfillPage` operation before enabling it. See the [background extraction design](./conversation-preference-extraction.md).

Music research runs inline with the chat response. The agent can search and continue answering for up to five steps. Search failures are returned to the agent so it can explain that verification is unavailable.

Smoke-test “I like Noah Kahan” and verify a normal reply without a save confirmation or preference write. Ask to research a track and verify that Exa results lead to a sourced answer in the same response. Research must never save a preference. See [Step 3](./step-3-preference-tools.md) for scope and implementation notes.

## Production deployments

GitHub Actions deploys the committed `main` branch to https://graceful-monitor-911.convex.site whenever a push lands on `main`. You can also run **Deploy production** from the repository's Actions tab with `main` selected. The workflow installs the locked dependencies, runs lint, tests, and the build, then deploys the Convex backend and static frontend. Deployments run one at a time.

One-time setup:

1. In the Convex dashboard, select the `graceful-monitor-911` production deployment and generate a production deploy key.
2. In GitHub → Settings → Secrets and variables → Actions, add it as `CONVEX_DEPLOY_KEY` (a repository secret or a secret in the `production` environment). Never commit the key.
3. Keep application secrets in Convex. Set production `SITE_URL` to `https://graceful-monitor-911.convex.site` and allow `https://graceful-monitor-911.convex.site/api/auth/callback/google` in the Google OAuth client.

The hosting component preserves existing authentication routes and supports direct visits to client-side routes. The workflow supplies deployment credentials; it does not use a developer's `.env.local` or upload their working directory.

## Preview deployments

GitHub Actions creates or updates an isolated Convex preview deployment for every pull request opened from a branch in this repository. The workflow deploys both the backend and frontend, smoke-tests the hosted routes, and links the resulting `convex.site` URL from the GitHub `preview` environment. Each branch keeps its preview data across updates; Convex removes inactive preview deployments automatically according to the project's plan.

One-time setup:

1. In the Convex project settings, generate a preview deploy key.
2. In GitHub, create an environment named `preview` and add the key as an environment secret named `CONVEX_PREVIEW_DEPLOY_KEY`. Keep this separate from the production deploy key.
3. Configure any required default Convex environment variables for preview deployments. OAuth providers must also allow the callback URL for a preview before sign-in can work there.

Preview deployments intentionally do not run for pull requests from forks because GitHub does not expose deployment secrets to forked code.

## Checks

```sh
pnpm format:check
pnpm lint
pnpm test
pnpm build
```
