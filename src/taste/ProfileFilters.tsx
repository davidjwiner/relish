export type ReactionFilter = 'like' | 'dislike';
export type TargetKindFilter = 'artist' | 'track';

type FilterOption<T extends string> = {
  label: string;
  value: T | undefined;
};

const reactionOptions: FilterOption<ReactionFilter>[] = [
  { label: 'All', value: undefined },
  { label: 'Likes', value: 'like' },
  { label: 'Dislikes', value: 'dislike' },
];
const targetKindOptions: FilterOption<TargetKindFilter>[] = [
  { label: 'All music', value: undefined },
  { label: 'Artists', value: 'artist' },
  { label: 'Tracks', value: 'track' },
];

export function ProfileFilters({
  reaction,
  targetKind,
  onReactionChange,
  onTargetKindChange,
}: {
  reaction: ReactionFilter | undefined;
  targetKind: TargetKindFilter | undefined;
  onReactionChange: (reaction: ReactionFilter | undefined) => void;
  onTargetKindChange: (targetKind: TargetKindFilter | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-5 border-b border-line pb-5 sm:flex-row sm:items-center sm:gap-9">
      <FilterGroup
        label="Reaction"
        options={reactionOptions}
        value={reaction}
        onChange={onReactionChange}
      />
      <FilterGroup
        label="Type"
        options={targetKindOptions}
        value={targetKind}
        onChange={onTargetKindChange}
      />
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FilterOption<T>[];
  value: T | undefined;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="mr-2 text-sm font-semibold text-muted">{label}</legend>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              active
                ? 'border-ink bg-ink text-white'
                : 'border-line bg-white text-muted hover:border-ink hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}
