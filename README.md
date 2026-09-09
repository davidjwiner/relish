# Relish

Relish is a music-taste app with Google sign-in and an Agent + assistant-ui chat proof of concept. Taste Profile and Radar remain placeholders for later steps in [design.md](./design.md).

## Requirements

- Node.js 22.12 or newer (developed with 22.22.2).
- pnpm 11.19.0, pinned in `package.json`.
- Access to the Relish Convex project and a Google OAuth Web client.

## Local development

```sh
pnpm install --frozen-lockfile
pnpm dev:backend
```

On a fresh checkout, select the existing **relish** project under **David Winer's team**. Convex writes `.env.local` with the deployment and public frontend URL and generates backend types. Keep this terminal running to sync backend changes.

In a second terminal:

```sh
pnpm dev
```

Open [Relish locally](http://localhost:5173). Use `localhost` consistently for OAuth; switching between `localhost` and `127.0.0.1` changes the browser storage origin. Vite uses a fixed port so callback configuration stays consistent.

Without `VITE_CONVEX_URL`, the frontend displays a setup state with sign-in disabled. It does not simulate an authenticated user.

## Convex development project

- [Project dashboard](https://dashboard.convex.dev/t/david-winer-cac68/relish)
- Development deployment: `accomplished-iguana-922`
- Backend URL: `https://accomplished-iguana-922.convex.cloud`
- HTTP actions URL: `https://accomplished-iguana-922.convex.site`

This is a development backend, not a production frontend deployment.

## Authentication setup

The app uses `@convex-dev/auth` 0.0.95 and `@auth/core` 0.41.1. It follows the official [Convex Auth setup](https://labs.convex.dev/auth/setup) and [Google OAuth guide](https://labs.convex.dev/auth/config/oauth/google).

For a **new deployment only**, initialize the auth signing keys and application URL:

```sh
pnpm setup:auth
```

The initializer sets `SITE_URL`, `JWT_PRIVATE_KEY`, and `JWKS` in Convex. Existing source files already contain the required auth configuration. Do not rotate an existing deployment's signing keys during routine setup; review any overwrite prompt.

For this development deployment, the signing keys, `SITE_URL=http://localhost:5173`, and Google OAuth credentials have been configured. Google recognizes the Relish client and opens its sign-in page.

Configure a Google OAuth client with application type **Web application**:

| Setting                      | Value                                                                  |
| ---------------------------- | ---------------------------------------------------------------------- |
| Authorized JavaScript origin | `http://localhost:5173`                                                |
| Authorized redirect URI      | `https://accomplished-iguana-922.convex.site/api/auth/callback/google` |

If the Google consent screen is in testing mode, add each account used for verification as a test user. Set these variables in the **development deployment's** Convex dashboard Environment Variables:

- `AUTH_GOOGLE_ID`: the OAuth client ID.
- `AUTH_GOOGLE_SECRET`: the OAuth client secret.

Verify the variable names on the selected deployment with `pnpm exec convex env list --names-only`.

Keep secrets in Convex, never in Vite variables, source control, or chat. `.env.example` documents the local public configuration and backend variable names. Model calls use the Convex AI Gateway. Exa and Workflow integrations belong to later phases.

## Chat proof of concept

The connection is small: `chat.send` saves a prompt with Convex Agent, `chat.generate` streams its reply, and `useUIMessages` feeds Agent messages into assistant-ui's `useExternalStoreRuntime`. Start with [ChatPage.tsx](./src/pages/ChatPage.tsx), [messageAdapter.ts](./src/chat/messageAdapter.ts), and [convex/chat.ts](./convex/chat.ts).

Agent owns all conversation storage. There is no application request table, scheduled generation, polling loop, or watchdog. The UI handles pending/errors and retries with a saved prompt ID. Server-side deduplication and cross-tab execution locks are outside this proof of concept. See [Step 2](./step-2-chat-interface.md) for the flow and tradeoffs.

The default is `openai/gpt-5.6-sol` with medium reasoning via the Convex AI Gateway. Run `pnpm dev:backend` to sync Agent and generate bindings. Gateway access must be enabled on the Convex team; no model API key goes in frontend configuration.

Verify by sending a prompt, watching the reply stream, asking a follow-up, and reloading the saved conversation. Stop becomes available once streaming starts. Retry reuses the original prompt. Research and saving preferences are future steps.

## Commands

| Command              | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `pnpm dev`           | Frontend development server                           |
| `pnpm dev:backend`   | Sync Convex code and generate types                   |
| `pnpm setup:backend` | Configure a new deployment or select an existing one  |
| `pnpm setup:auth`    | Initialize auth configuration for a new deployment    |
| `pnpm codegen`       | Regenerate Convex types for the configured deployment |
| `pnpm format`        | Apply Prettier to source and documentation            |
| `pnpm format:check`  | Verify Prettier formatting                            |
| `pnpm lint`          | ESLint checks                                         |
| `pnpm typecheck`     | Frontend and backend TypeScript checks                |
| `pnpm test`          | Authorization and redirect validation tests           |
| `pnpm build`         | Typecheck and build the frontend into `dist/`         |
| `pnpm preview`       | Serve the built frontend locally                      |

Generated files in `convex/_generated/` come from Convex tooling and are excluded from formatting/linting. Keep them and `pnpm-lock.yaml` in source control. The repository has not yet been initialized as a Git repository.

## Verification

Automated coverage verifies unauthenticated rejection, account isolation, deleted-user rejection, rejection of caller-selected user IDs, and allowlisted return destinations. These tests use `convex-test`; they do not establish that Google's OAuth configuration is correct.

Before marking phase 1 complete, perform the real-browser checks:

1. While signed out, open `/radar`; sign in with Google and confirm return to Radar.
2. Navigate through all three pages, use browser back/forward, and reload a protected URL.
3. Verify only the signed-in user's name is shown. Repeat with a second account.
4. Log out; verify protected content disappears and browser Back does not restore access.
5. Cancel a sign-in and retry. Open `/login?code=invalid` to verify a failed callback offers recovery.
6. Test navigation and logout by keyboard and at narrow viewport widths.
7. With the connection interrupted, verify loading states offer recovery rather than silently showing protected data to a signed-out visitor.

Verified so far: the deployed backend rejects unauthenticated access; the browser redirects signed-out Radar visits to sign-in while retaining the destination; the login page fits a 390px mobile viewport; invalid callback codes show a working retry action. The locked install, formatting check, lint, 15 automated tests, and production build pass.

A real sign-in is still required to finish end-to-end verification; provider credentials are now configured. The backend and local shell are implemented; this is not yet a declaration that every acceptance criterion in [the phase plan](./step-1-app-scaffold.md) has passed.

## Architecture notes

`ConvexAuthProvider` owns session storage and token refresh. The app explicitly handles callback code redemption so callback errors are visible and recoverable. Route guards wait for auth restoration, and `users.current` independently enforces server-side authentication and returns only ID and optional name.

Logout first confirms server-side session revocation, then calls Convex Auth's client cleanup. This is deliberate: the installed client's `signOut` swallows backend errors. If revocation fails, the interface reports failure and allows retry.

Tailwind provides the shared theme and responsive shell. A future static frontend host must rewrite application routes to `index.html`. Do not publish this scaffold as a finished product.
