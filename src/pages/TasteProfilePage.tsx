import { useMemo, useState } from 'react';
import {
  useConvexConnectionState,
  useMutation,
  usePaginatedQuery,
} from 'convex/react';
import { useSearchParams } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { api } from '../../convex/_generated/api';
import {
  ProfileFilters,
  type ReactionFilter,
  type TargetKindFilter,
} from '../taste/ProfileFilters';
import { PreferenceRow, type ProfilePreference } from '../taste/PreferenceRow';

const reactions = new Set<ReactionFilter>(['like', 'dislike']);
const targetKinds = new Set<TargetKindFilter>(['artist', 'track']);

export function TasteProfilePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const reactionParam = searchParams.get('reaction');
  const targetKindParam = searchParams.get('type');
  const reaction = reactions.has(reactionParam as ReactionFilter)
    ? (reactionParam as ReactionFilter)
    : undefined;
  const targetKind = targetKinds.has(targetKindParam as TargetKindFilter)
    ? (targetKindParam as TargetKindFilter)
    : undefined;
  const queryArgs = useMemo(
    () => ({
      ...(reaction ? { reaction } : {}),
      ...(targetKind ? { targetKind } : {}),
    }),
    [reaction, targetKind],
  );
  const { results, status, loadMore } = usePaginatedQuery(
    api.preferences.listProfile,
    queryArgs,
    { initialNumItems: 30 },
  );
  const { isWebSocketConnected } = useConvexConnectionState();
  const removePreference = useMutation(api.preferences.remove);
  const hasFilters = Boolean(reaction || targetKind);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');

  function updateFilter(
    key: 'reaction' | 'type',
    value: ReactionFilter | TargetKindFilter | undefined,
  ) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  function clearFilters() {
    setSearchParams({});
  }

  async function remove(preference: ProfilePreference) {
    if (
      removingId ||
      !window.confirm(`Remove “${preference.title}” from your Taste Profile?`)
    )
      return;
    setRemovingId(preference.id);
    setRemoveError('');
    try {
      await removePreference({ preferenceId: preference.id });
    } catch {
      setRemoveError('Couldn’t remove this preference. Please try again.');
    } finally {
      setRemovingId(null);
    }
  }

  const loading = status === 'LoadingFirstPage';
  return (
    <div className="mx-auto max-w-4xl">
      <header>
        <p className="text-sm font-semibold tracking-[0.15em] text-muted uppercase">
          Uniquely yours
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Taste Profile
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          The artists and tracks you’ve shared a preference for.
        </p>
      </header>

      <section className="mt-8" aria-label="Taste profile preferences">
        <ProfileFilters
          reaction={reaction}
          targetKind={targetKind}
          onReactionChange={(value) => updateFilter('reaction', value)}
          onTargetKindChange={(value) => updateFilter('type', value)}
        />

        <div className="mt-8 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 className="text-lg font-semibold">Saved preferences</h2>
          <p className="text-sm text-muted">Recently added</p>
        </div>
        {!isWebSocketConnected && !loading && (
          <p role="status" className="mt-3 text-sm text-muted">
            Reconnecting. Showing the preferences already loaded.
          </p>
        )}
        {removeError && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {removeError}
          </p>
        )}

        {loading ? (
          <ProfileSkeletons />
        ) : results.length === 0 ? (
          hasFilters ? (
            <FilteredEmptyState onClear={clearFilters} />
          ) : (
            <ProfileEmptyState />
          )
        ) : (
          <>
            <ul className="mt-6" aria-live="polite">
              {(results as ProfilePreference[]).map((preference) => (
                <PreferenceRow
                  key={preference.id}
                  preference={preference}
                  removing={removingId === preference.id}
                  onRemove={(item) => void remove(item)}
                />
              ))}
            </ul>
            {(status === 'CanLoadMore' || status === 'LoadingMore') && (
              <div className="mt-7 flex justify-center">
                <button
                  type="button"
                  disabled={status === 'LoadingMore'}
                  onClick={() => loadMore(30)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold hover:bg-paper disabled:opacity-60"
                >
                  {status === 'LoadingMore' && (
                    <LoaderCircle
                      size={16}
                      className="animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {status === 'LoadingMore' ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function ProfileSkeletons() {
  return (
    <div
      className="mt-6 space-y-5"
      role="status"
      aria-label="Loading taste profile"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="flex gap-4 border-b border-line py-5 first:pt-0"
        >
          <div className="size-10 shrink-0 animate-pulse rounded-xl bg-line" />
          <div className="flex-1 space-y-3">
            <div className="h-4 w-2/5 animate-pulse rounded bg-line" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-line" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-line" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading your saved preferences…</span>
    </div>
  );
}

function ProfileEmptyState() {
  return (
    <div className="mt-6 rounded-2xl border border-line bg-white p-7 sm:p-9">
      <h3 className="text-xl font-semibold">Your taste has a story.</h3>
      <p className="mt-3 max-w-lg leading-relaxed text-muted">
        Your saved artist and track preferences will appear here.
      </p>
    </div>
  );
}

function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="mt-6 rounded-2xl border border-line bg-white p-7 sm:p-9">
      <h3 className="text-xl font-semibold">
        No preferences match these filters.
      </h3>
      <button
        type="button"
        onClick={onClear}
        className="mt-5 text-sm font-semibold underline underline-offset-4"
      >
        Clear filters
      </button>
    </div>
  );
}
