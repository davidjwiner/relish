export const destinations = ['/chat', '/taste-profile', '/radar'] as const;
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' &&
    (destinations.some((route) => route === value) ||
      /^\/chat\/[a-zA-Z0-9_-]{1,128}$/.test(value))
    ? value
    : '/chat';
}
export function loginPath(path: string): string {
  return `/login?returnTo=${encodeURIComponent(safeReturnTo(path))}`;
}
