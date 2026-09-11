import { useEffect, useRef, useState } from 'react';
import { Disc3, Music2, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import type { Id } from '../../convex/_generated/dataModel';

export type ProfilePreference = {
  id: Id<'preferences'>;
  kind: 'artist' | 'track';
  title: string;
  artistNames: string[];
  version?: string;
  reaction: 'like' | 'dislike';
  reason?: string;
  createdAt: number;
  updatedAt: number;
};

export function PreferenceRow({
  preference,
  removing,
  onRemove,
}: {
  preference: ProfilePreference;
  removing: boolean;
  onRemove: (preference: ProfilePreference) => void;
}) {
  const reasonLabel = 'What you said';
  const date = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(preference.createdAt);
  const isUpdated = preference.updatedAt !== preference.createdAt;
  return (
    <li className="border-b border-line py-5 first:pt-0">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent">
          {preference.kind === 'artist' ? (
            <Disc3 size={20} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <Music2 size={20} strokeWidth={1.8} aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h3 className="wrap-break-word font-semibold">
                {preference.title}
                {preference.version && ` (${preference.version})`}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {preference.kind === 'artist'
                  ? 'Artist'
                  : `${preference.artistNames.join(', ') || 'Unknown artist'} · Track`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <ReactionBadge reaction={preference.reaction} />
              <button
                type="button"
                disabled={removing}
                onClick={() => onRemove(preference)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted underline underline-offset-4 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={`Remove ${preference.title} from your taste profile`}
              >
                <Trash2 size={14} aria-hidden="true" />
                {removing ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
          {preference.reason && (
            <Reason label={reasonLabel} text={preference.reason} />
          )}
          <p className="mt-3 text-xs text-muted">
            Added {date}
            {isUpdated && ' · Updated'}
          </p>
        </div>
      </div>
    </li>
  );
}

function ReactionBadge({ reaction }: { reaction: 'like' | 'dislike' }) {
  const liked = reaction === 'like';
  const Icon = liked ? ThumbsUp : ThumbsDown;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 pt-0.5 text-xs font-medium text-muted">
      <Icon size={14} aria-hidden="true" />
      {liked ? 'Liked' : 'Disliked'}
    </span>
  );
}

function Reason({ label, text }: { label: string; text: string }) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  useEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const measure = () => {
      setCanExpand(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
  return (
    <div className="mt-4 border-l-2 border-line pl-3 text-sm leading-6 text-muted">
      <p className="font-medium text-ink">{label}</p>
      <p
        ref={textRef}
        className={
          expanded
            ? 'mt-1 whitespace-pre-wrap'
            : 'mt-1 line-clamp-3 whitespace-pre-wrap'
        }
      >
        {text}
      </p>
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-sm font-medium text-ink underline underline-offset-4"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
