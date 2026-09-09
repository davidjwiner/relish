import { MessageCircle, Disc3, Radar } from 'lucide-react';
const content = {
  chat: {
    title: 'Chat',
    eyebrow: 'Start with a conversation',
    headline: 'Every great discovery starts with a song.',
    body: 'Soon, this will be a place to talk about the artists and tracks you love. Your conversations will help Relish get to know your taste.',
    icon: MessageCircle,
  },
  taste: {
    title: 'Taste Profile',
    eyebrow: 'Uniquely yours',
    headline: 'Your taste has a story.',
    body: 'The artists and tracks you save will find a home here. Over time, you’ll see the connections that make your music taste yours.',
    icon: Disc3,
  },
  radar: {
    title: 'Radar',
    eyebrow: 'Closer to the music',
    headline: 'Your next great night is out there.',
    body: 'Upcoming local shows matched to your taste will appear here. There are no recommendations to show yet.',
    icon: Radar,
  },
};
export function FeaturePage({ feature }: { feature: keyof typeof content }) {
  const page = content[feature];
  const Icon = page.icon;
  return (
    <>
      <header className="flex items-center justify-between border-b border-line pb-7">
        <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
        <span className="rounded-full border border-line px-3 py-1 text-sm text-muted">
          Coming soon
        </span>
      </header>
      <section className="mx-auto flex min-h-[65dvh] max-w-xl flex-col items-center justify-center py-16 text-center">
        <div className="mb-8 flex size-20 items-center justify-center rounded-3xl bg-accent">
          <Icon size={34} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <p className="text-sm font-semibold uppercase tracking-[0.15em] text-muted">
          {page.eyebrow}
        </p>
        <h2 className="mt-4 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
          {page.headline}
        </h2>
        <p className="mt-5 max-w-md leading-relaxed text-muted">{page.body}</p>
      </section>
    </>
  );
}
