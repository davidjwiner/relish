# Step 1: App scaffold

## Goal

Build the foundation described in [design.md](./design.md): a user can sign in to Relish, navigate between Chat, Taste Profile, and Radar, and sign out. The session survives a page reload, and the backend enforces authentication.

The scaffold is implemented and connected to the Relish development deployment. Google OAuth is configured; end-to-end verification remains pending completion of account sign-in. See README.md for setup and verification instructions.

## Scope

Include:

- React application setup and local development tooling.
- Convex backend connection and Convex Auth integration.
- One sign-in method, session restoration, and logout.
- Protected routes and a responsive application shell.
- Placeholder pages for the three product features.
- Minimal authenticated user access, setup documentation, and verification.

Later steps own the chat interface, Agent component, and Convex LLM gateway (step 2), Exa and preference tools with the Workflow component for multi-step research (step 3), saved preferences view (step 4), and Radar recommendations (step 5). Agent, Workflow, and the Convex LLM gateway are required parts of the application architecture. Do not introduce their tables, integrations, or mock music data in this scaffold.

## Proposed technical choices

| Area            | Choice                                                                     | Reason                                                                 |
| --------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Frontend        | React + TypeScript + Vite                                                  | A client-rendered app is sufficient for the authenticated product.     |
| Routing         | React Router                                                               | Give each destination its own URL and support browser navigation.      |
| Backend         | Convex                                                                     | Required by the design; also provides the authenticated data boundary. |
| Authentication  | Convex Auth                                                                | Required by the design; use the standard Convex Auth integration.      |
| Styling         | Tailwind CSS                                                               | Shared theme tokens and utility classes for the responsive shell.      |
| Package manager | pnpm with a committed lockfile                                             | Keep setup straightforward and reproducible.                           |
| Checks          | TypeScript, ESLint, Prettier, production build, targeted auth verification | Catch integration failures without testing static placeholder copy.    |

Use mutually compatible stable package versions at implementation time, recording the selected runtime and package versions. Pin the pnpm version in the package manifest's `packageManager` field and commit `pnpm-lock.yaml`. Use pnpm consistently for installation, scripts, and CLI commands. Avoid adding a separate state-management library for this step.

## Authentication setup

Use standard Convex Auth and follow the [Convex Auth documentation](https://docs.convex.dev/auth/convex-auth) for React/Vite setup. Record the installed package version and setup instructions in the README.

Configure the chosen sign-in provider, session restoration, and server-side identity lookup. Step 1 is complete when real sign-in and logout work against the development deployment.

## Sign-in experience

Proposed default: **Google OAuth**. This is a planning assumption, not a finalized provider decision. Use one method for the first implementation; provider credentials and callback URLs must be configured before end-to-end verification.

The sign-in page uses a single centered layout with the Relish name, a “Sign in” heading, and a Google sign-in button. Keep the page functional and omit marketing headlines or taglines. Include a pending state that prevents repeated submissions and a recoverable error state for failed or canceled sign-in.

### Routes

| Route            | Signed-out behavior       | Signed-in behavior             |
| ---------------- | ------------------------- | ------------------------------ |
| `/`              | Redirect to `/login`      | Redirect to `/chat`            |
| `/login`         | Show sign-in page         | Redirect to `/chat`            |
| `/chat`          | Sign in, then return here | Show Chat placeholder          |
| `/taste-profile` | Sign in, then return here | Show Taste Profile placeholder |
| `/radar`         | Sign in, then return here | Show Radar placeholder         |

Preserve intended destinations only from an allowlist of application routes; do not accept arbitrary redirect URLs. Handle unknown paths with a small not-found page and a link back to the app.

### Session behavior

- While the session is being restored, show a loading state instead of briefly rendering the sign-in page or protected content.
- Once authenticated, request the current user from Convex and render the app shell.
- Put a logout control in the shell. Successful logout clears the session through the auth library, removes protected content, and returns to `/login`.
- Surface logout failures with a retry action; do not falsely report a successful logout.
- An expired or invalid session returns the user to sign-in. Backend queries remain protected regardless of route state.
- Distinguish connection failures from a confirmed signed-out state; offer retry for recoverable loading errors.

## App shell

Desktop uses a persistent left navigation with the Relish name and three links: Chat, Taste Profile, and Radar. Highlight the active destination and keep logout accessible. At narrow widths, collapse the navigation into an accessible menu.

Each placeholder has a page title and short empty-state description. The Chat page should not have a working-looking composer yet; step 2 introduces actual messaging. Taste Profile and Radar should not display fabricated preferences or recommendations.

Use semantic navigation, visible keyboard focus, labeled controls, and appropriate contrast. Style the shell and pages with Tailwind utilities and establish a small shared Tailwind theme for colors, typography, spacing, and borders. Keep the global stylesheet focused on the Tailwind entry point, theme definitions, and base styles; a larger component system can follow actual product needs.

## Minimal backend and data ownership

Use the auth system's user identity as the canonical identity. Step 1 needs only a protected current-user query that returns the minimal display fields needed by the shell, such as ID and optional display name.

Follow the standard Convex Auth user schema and identity conventions:

- Reuse the auth-managed user identity rather than creating a duplicate identity record.
- Add app-specific profile fields only as needed, following the Convex Auth schema guidance. Do not use email as the identity key.
- Defer location and app-setting fields until their user flows are implemented. The design's Users model remains the place for those future fields.

Every protected function derives identity on the server. A caller cannot select another user by supplying an ID. A route guard improves navigation but does not replace backend authorization.

## Implementation tasks

### 1. Initialize the project

- Preserve the existing design and planning documents.
- Create the React/TypeScript/Vite app using pnpm and install React Router and Tailwind CSS with its supported Vite integration.
- Import the Tailwind entry stylesheet from the app entry point and verify that utility classes are applied.
- Set up TypeScript, ESLint, Prettier, `pnpm-lock.yaml`, and scripts for frontend development, backend development, typechecking, linting, formatting, format checking, and building. Do not introduce npm or Yarn lockfiles.
- Connect a development Convex deployment. Document how to run both frontend and backend locally.
- Add ignore rules for dependency folders, build outputs, and local environment files.

### 2. Configure authentication and user access

- Follow the standard Convex Auth installation instructions for React/Vite.
- Register required backend auth configuration and HTTP callbacks as documented by Convex Auth.
- Configure the chosen sign-in provider, allowed origins, and local callback URLs.
- Implement the protected current-user query and the minimal user mapping, if required.
- Connect the frontend auth provider to Convex without writing custom token storage or refresh logic.

### 3. Implement session-aware routing

- Build the login page, session-loading boundary, and authenticated route boundary.
- Implement sign-in, return-to-route handling, logout, and recoverable errors.
- Ensure private queries run only when auth is ready and that the server rejects unauthenticated access.

### 4. Build the navigation and placeholder pages

- Add the shared shell, route links, active states, and logout control.
- Create the three empty destinations with responsive layouts using Tailwind utilities and shared theme tokens.
- Verify keyboard use, narrow screens, browser back/forward, and direct route loads.

### 5. Verify and document

- Run the checks and acceptance scenarios below.
- Write a README with Node.js and pinned pnpm prerequisites, environment setup, auth configuration, local run commands, and verification commands. Use pnpm commands throughout, including `pnpm install --frozen-lockfile` for a reproducible install.
- Record unresolved issues explicitly; do not mark auth complete based on a mocked session.

## Expected project layout

Paths below are proposed; auth-specific filenames must follow the Convex Auth setup guide.

```text
src/
  main.tsx
  app/
    providers.tsx
    router.tsx
  auth/
    AuthBoundary.tsx
    LoginPage.tsx
  components/
    AppShell.tsx
    Navigation.tsx
  pages/
    ChatPage.tsx
    TasteProfilePage.tsx
    RadarPage.tsx
    NotFoundPage.tsx
  styles/
    global.css
convex/
  users.ts
  [auth configuration required by Convex Auth]
.env.example
.gitignore
package.json
pnpm-lock.yaml
vite.config.ts
README.md
design.md
step-1-app-scaffold.md
```

Add schema/config files only where the chosen Convex setup requires them. Generated Convex files should be produced by its tooling, not hand-authored. Configure the supported Tailwind Vite integration in `vite.config.ts`; `src/styles/global.css` contains the Tailwind entry point and shared theme definitions.

## Environment and setup

Document the public Convex deployment URL needed by the frontend and the backend-only credentials required by the chosen auth provider. Use the variable names documented in the Convex Auth setup guide.

Only public configuration goes into frontend environment variables. OAuth client secrets and auth signing secrets belong in backend configuration. Commit a placeholder-only `.env.example`; never commit real credentials. No LLM gateway or Exa configuration is needed in step 1. Step 2 will configure model access through the Convex LLM gateway on the backend.

Production publishing is outside this step. Document that a future static host must serve the SPA entry point for application routes so direct navigation works after deployment.

## Acceptance criteria

- [ ] A fresh checkout can be installed with the pinned pnpm version and `pnpm install --frozen-lockfile`, then run using the README after credentials are configured.
- [x] Signed-out visitors cannot see protected pages or retrieve protected current-user data.
- [ ] Real sign-in succeeds and opens the intended destination.
- [ ] Reloading a protected route restores the session without flashing private content to signed-out users.
- [ ] Chat, Taste Profile, and Radar support direct URLs and browser back/forward navigation.
- [ ] Logout removes protected content, and back navigation does not restore authenticated access.
- [ ] Canceling or failing sign-in leaves the user able to retry.
- [ ] The app handles connection errors and session expiry without an endless loading screen.
- [ ] Two separate test accounts receive their own current-user identity; unauthenticated backend calls are rejected.
- [ ] Navigation and logout work by keyboard and at mobile widths.
- [ ] Tailwind styles and responsive navigation render correctly in the production build.
- [x] Typechecking, linting, Prettier format checking, and the production build pass through the documented pnpm scripts.
- [ ] `pnpm-lock.yaml` is committed and no competing package-manager lockfiles are present.
- [ ] No credentials or future-feature mock data are committed.

Use focused automated tests for the protected backend identity boundary and any custom redirect validation. Verify the real OAuth flow manually with development credentials, including reload and logout; mocks alone cannot validate provider configuration. Avoid adding tests for static placeholder text.

## Handoff to step 2

Step 2 starts with a working authenticated shell and a stable way to obtain the current user on the backend. It adds the Convex Agent component, user-owned conversations, assistant-ui, and streaming messages inside the existing Chat route, with model calls routed through the Convex LLM gateway. Step 3 introduces the Convex Workflow component for multi-step research and preference-update flows alongside Exa tools. Follow the selected components' current integration documentation when implementing these later steps.
