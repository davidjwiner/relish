import { Component, useEffect, useState, type ReactNode } from 'react';
import { Brand } from './Brand';
export function LoadingScreen({
  label = 'Finding your place…',
}: {
  label?: string;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 12000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-7 p-6">
      <Brand />
      <p role="status" className="text-muted">
        {slow
          ? 'This is taking longer than expected. Check your connection and try again.'
          : label}
      </p>
      {slow && (
        <button
          className="rounded-xl border border-line bg-white px-5 py-3"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      )}
    </main>
  );
}
export class RecoveryBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
          <Brand />
          <h1 className="text-2xl font-semibold">We couldn’t load Relish</h1>
          <p className="max-w-md text-muted">
            Check your connection and try again. If this keeps happening, sign
            in again.
          </p>
          <div className="flex gap-4">
            <button
              className="rounded-xl bg-ink px-5 py-3 text-white"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
            <a
              className="rounded-xl border border-line px-5 py-3"
              href="/login"
            >
              Back to sign-in
            </a>
          </div>
        </main>
      );
    return this.props.children;
  }
}

export function SlowOperation() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 12000);
    return () => window.clearTimeout(timer);
  }, []);
  if (!slow) return null;
  return (
    <div role="status" className="mt-4 text-sm leading-relaxed text-muted">
      <p>This is taking longer than expected. Check your connection.</p>
      <button
        className="mt-2 underline underline-offset-4"
        onClick={() => window.location.reload()}
      >
        Reload and try again
      </button>
    </div>
  );
}
