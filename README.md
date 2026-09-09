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

Chat now has Exa web research and tools to create, list, update, and delete saved artist/track preferences. Set `EXA_API_KEY` in the Convex dashboard, then run `pnpm dev:backend` to sync the Exa and Workflow components. Exa credentials remain backend-only; research interpretation also requires gateway access. The preference screen and Radar remain future steps.

Research and writes run in background workflows. Their status and final reply survive reloads. Stop only stops the chat response; an already-started workflow continues. Each saved user message can start one background request. Retries reuse its workflow; send a new message for another request. Artist/track names are normalized for initial identity matching, so ambiguous names and versions need clarification.

Smoke-test “I like Noah Kahan,” “List my preferences,” “Change Noah Kahan to a dislike,” and “Delete my Noah Kahan preference.” Then ask to research and save an unknown track, reload during research, and verify the sourced completion. Failed research must not save a guess. See [Step 3](./step-3-preference-tools.md) for the design and implementation notes.

## Checks

```sh
pnpm format:check
pnpm lint
pnpm test
pnpm build
```
