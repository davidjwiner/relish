import { appendFileSync } from 'node:fs';

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

const urlsResponse = await fetch(
  `${claim.instanceUrl}/api/v1/get_canonical_urls`,
  { headers: { Authorization: `Convex ${claim.adminKey}` } },
);
if (!urlsResponse.ok) {
  throw new Error(`Convex URL lookup failed (${urlsResponse.status}).`);
}

const urls = await urlsResponse.json();
if (!urls.convexSiteUrl) {
  throw new Error('Convex URL lookup did not return a site URL.');
}

process.stdout.write(`::add-mask::${claim.adminKey}\n`);
appendFileSync(
  githubEnv,
  `CONVEX_DEPLOY_KEY=${claim.adminKey}\nPREVIEW_SITE_URL=${urls.convexSiteUrl}\n`,
);
