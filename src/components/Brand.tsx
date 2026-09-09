import { AudioLines } from 'lucide-react';
export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex size-9 items-center justify-center rounded-xl ${dark ? 'bg-accent text-ink' : 'bg-ink text-accent'}`}
      >
        <AudioLines size={22} aria-hidden="true" />
      </span>
      <span className="text-2xl font-bold tracking-tight">
        relish<span className={dark ? 'text-accent' : 'text-muted'}>.</span>
      </span>
    </div>
  );
}
