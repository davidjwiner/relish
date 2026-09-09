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

Web research, saved taste preferences, and show lookup arrive in later steps. See [Step 2](./step-2-chat-interface.md) for the design and verification status.

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
