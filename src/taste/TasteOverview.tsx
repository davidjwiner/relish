import { useState } from 'react';
import {
  LoaderCircle,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

type Evidence = {
  id: string;
  title: string;
  reaction: 'like' | 'dislike';
};
type Claim = { text: string; evidence: Evidence[] };

export function TasteOverview() {
  const profile = useQuery(api.tasteProfiles.get);
  const requestRefresh = useMutation(api.tasteProfiles.requestRefresh);
  const { isWebSocketConnected } = useConvexConnectionState();
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh() {
    if (requesting) return;
    setRequesting(true);
    setMessage('');
    try {
      const result = await requestRefresh({});
      if (result.scheduled) setMessage('Starting your taste review.');
      else if (result.cooldownUntil) {
        const time = new Intl.DateTimeFormat(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        }).format(result.cooldownUntil);
        setMessage(`You can request another review after ${time}.`);
      } else setMessage('A review is already in progress.');
    } catch {
      setMessage('Couldn’t start a taste review. Please try again.');
    } finally {
      setRequesting(false);
    }
  }

  if (profile === undefined) return <OverviewSkeleton />;

  const reviewing =
    profile.status === 'pending' || profile.status === 'running';
  const generatedAt = profile.generatedAt
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(profile.generatedAt)
    : undefined;

  return (
    <section
      className="mt-8 rounded-2xl border border-line bg-white p-6 sm:p-7"
      aria-labelledby="taste-overview-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent">
            <Sparkles size={20} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-[0.12em] text-muted uppercase">
              Your taste at a glance
            </p>
            <h2
              id="taste-overview-title"
              className="mt-1 text-xl font-semibold"
            >
              {profile.overview ? 'A living overview' : 'A profile in progress'}
            </h2>
          </div>
        </div>
        {profile.hasPreferences && (
          <button
            type="button"
            disabled={requesting || reviewing}
            onClick={() => void refresh()}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm font-semibold hover:bg-paper disabled:opacity-60"
          >
            {requesting || reviewing ? (
              <LoaderCircle
                size={16}
                className="animate-spin"
                aria-hidden="true"
              />
            ) : (
              <RefreshCw size={16} aria-hidden="true" />
            )}
            {reviewing ? 'Reviewing…' : 'Review again'}
          </button>
        )}
      </div>

      {!isWebSocketConnected && (
        <p role="status" className="mt-4 text-sm text-muted">
          Reconnecting. Your overview may be out of date.
        </p>
      )}
      {message && (
        <p
          role="status"
          className={`mt-4 text-sm ${message.startsWith('Couldn’t') ? 'text-red-700' : 'text-muted'}`}
        >
          {message}
        </p>
      )}

      {profile.overview ? (
        <div className="mt-5">
          <p className="max-w-3xl whitespace-pre-wrap leading-7">
            {profile.overview.text}
          </p>
          {profile.overview.evidenceLevel === 'limited' && (
            <p className="mt-3 text-sm text-muted">
              An early impression, based on the preferences you’ve shared so
              far.
            </p>
          )}
          {profile.coverage === 'partial' && (
            <p className="mt-3 text-sm text-muted">
              This review is based on a recent subset of your saved preferences.
            </p>
          )}
          <OverviewClaims
            title="You seem drawn to"
            claims={profile.overview.drawnTo as Claim[]}
          />
          <OverviewClaims
            title="You tend to avoid"
            claims={profile.overview.avoids as Claim[]}
          />
          <OverviewClaims
            title="Nuances in your taste"
            claims={profile.overview.nuances as Claim[]}
          />
          <EvidenceList
            label="Overview evidence"
            evidence={profile.overview.evidence as Evidence[]}
          />
          {generatedAt && (
            <p className="mt-5 text-xs text-muted">
              Reviewed {generatedAt} · Based on{' '}
              {profile.reviewedPreferenceCount} saved{' '}
              {profile.reviewedPreferenceCount === 1
                ? 'preference'
                : 'preferences'}
            </p>
          )}
        </div>
      ) : reviewing ? (
        <p role="status" className="mt-5 leading-7 text-muted">
          Reviewing your saved preferences…
        </p>
      ) : profile.status === 'failed' ? (
        <div className="mt-5">
          <p className="leading-7 text-muted">
            We couldn’t finish your taste overview.
          </p>
          <button
            type="button"
            disabled={requesting}
            onClick={() => void refresh()}
            className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            Try again
          </button>
        </div>
      ) : profile.hasPreferences ? (
        <div className="mt-5">
          <p className="max-w-2xl leading-7 text-muted">
            Turn the artists and tracks you’ve saved into a concise picture of
            what you’re drawn to.
          </p>
          <button
            type="button"
            disabled={requesting}
            onClick={() => void refresh()}
            className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {requesting ? 'Starting review…' : 'Create my overview'}
          </button>
        </div>
      ) : (
        <p className="mt-5 max-w-2xl leading-7 text-muted">
          Share a few likes or dislikes to start your taste overview.
        </p>
      )}
    </section>
  );
}

function OverviewClaims({ title, claims }: { title: string; claims: Claim[] }) {
  if (!claims.length) return null;
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-3 space-y-3">
        {claims.map((claim, index) => (
          <li
            key={`${claim.text}-${index}`}
            className="text-sm leading-6 text-muted"
          >
            <p>{claim.text}</p>
            <EvidenceList label="Based on" evidence={claim.evidence} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceList({
  label,
  evidence,
}: {
  label: string;
  evidence: Evidence[];
}) {
  if (!evidence.length) return null;
  return (
    <details className="mt-1.5 text-xs text-muted">
      <summary className="w-fit cursor-pointer underline underline-offset-2">
        {label} ({evidence.length})
      </summary>
      <ul className="mt-1.5 space-y-1">
        {evidence.map((item) => (
          <li key={item.id} className="inline-flex items-center gap-1">
            {item.reaction === 'like' ? (
              <ThumbsUp size={12} aria-hidden="true" />
            ) : (
              <ThumbsDown size={12} aria-hidden="true" />
            )}
            {item.title}
          </li>
        ))}
      </ul>
    </details>
  );
}

function OverviewSkeleton() {
  return (
    <section
      className="mt-8 rounded-2xl border border-line bg-white p-6 sm:p-7"
      role="status"
      aria-label="Loading taste overview"
    >
      <div className="h-4 w-40 animate-pulse rounded bg-line" />
      <div className="mt-3 h-6 w-52 animate-pulse rounded bg-line" />
      <div className="mt-6 h-4 w-full animate-pulse rounded bg-line" />
      <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-line" />
      <span className="sr-only">Loading your taste overview…</span>
    </section>
  );
}
