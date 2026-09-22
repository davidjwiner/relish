import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const previewKey = process.env.CONVEX_DEPLOY_KEY;
const previewName = process.env.GITHUB_HEAD_REF;
const githubEnv = process.env.GITHUB_ENV;

if (!previewKey || !previewName || !githubEnv) {
  throw new Error('Missing Convex preview key or GitHub Actions context.');
}

const [keyPrefix] = previewKey.split('|');
const [keyType, teamSlug, projectSlug] = keyPrefix.split(':');
if (keyType !== 'preview' || !teamSlug || !projectSlug) {
  throw new Error('CONVEX_DEPLOY_KEY is not a project preview deploy key.');
}

const claimResponse = await fetch(
  'https://api.convex.dev/api/claim_preview_deployment',
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${previewKey}`,
      'Content-Type': 'application/json',
      'Convex-Client': 'relish-github-actions',
    },
    body: JSON.stringify({
      projectSelection: {
        kind: 'teamAndProjectSlugs',
        teamSlug,
        projectSlug,
      },
      identifier: previewName,
      reuse: true,
    }),
  },
);

if (!claimResponse.ok) {
  throw new Error(`Convex preview claim failed (${claimResponse.status}).`);
}

const claim = await claimResponse.json();
if (!claim.adminKey || !claim.instanceUrl) {
  throw new Error('Convex preview claim returned an invalid response.');
}

process.stdout.write(`::add-mask::${claim.adminKey}\n`);
appendFileSync(
  githubEnv,
  [
    'CONVEX_DEPLOY_KEY=',
    `CONVEX_SELF_HOSTED_URL=${claim.instanceUrl}`,
    `CONVEX_SELF_HOSTED_ADMIN_KEY=${claim.adminKey}`,
    '',
  ].join('\n'),
);

// static-hosting 0.2.1 always adds --prod to its internal Convex commands.
// A claimed preview is already fully identified by its URL and admin key, so
// make the installed helper omit that conflicting selector in this CI job.
const require = createRequire(import.meta.url);
const packageJsonPath =
  require.resolve('@convex-dev/static-hosting/package.json');
const commandsPath = join(dirname(packageJsonPath), 'dist/cli/commands.js');
const original = readFileSync(commandsPath, 'utf8');
const invocation = '[convexBinPath(), ...args]';
const replacement = [
  'convexBinPath(),',
  '...args.filter((arg) =>',
  'process.env.CONVEX_SELF_HOSTED_URL ? arg !== "--prod" : true),',
].join(' ');
const occurrences = original.split(invocation).length - 1;

if (occurrences !== 3) {
  throw new Error(
    `Unexpected static-hosting command layout (${occurrences} invocations).`,
  );
}

writeFileSync(
  commandsPath,
  original.replaceAll(invocation, `[${replacement}]`),
);
