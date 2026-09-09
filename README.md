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

## Checks

```sh
pnpm format:check
pnpm lint
pnpm test
pnpm build
```

See [package.json](./package.json) for all commands.
