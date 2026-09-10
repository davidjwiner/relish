import { v, type Infer } from 'convex/values';
import { z } from 'zod';

export const MAX_TEXT = 8000;
export const OPERATION_TIMEOUT_MS = 25_000;
export const SESSION_TIMEOUT_SECONDS = 180;

const instruction = z.string().trim().min(1).max(2000);
const selector = z.string().trim().min(1).max(1000);
export const operationSchema = z.discriminatedUnion('operation', [
  z
    .object({ operation: z.literal('goto'), url: z.string().url().max(4000) })
    .strict(),
  z.object({ operation: z.literal('click'), selector }).strict(),
  z
    .object({
      operation: z.literal('fill'),
      selector,
      value: z.string().max(4000),
    })
    .strict(),
  z.object({ operation: z.literal('text') }).strict(),
  z.object({ operation: z.literal('act'), instruction }).strict(),
  z.object({ operation: z.literal('observe'), instruction }).strict(),
  z.object({ operation: z.literal('extract'), instruction }).strict(),
]);
export type BrowserOperation = z.infer<typeof operationSchema>;
export const operationValidator = v.union(
  v.object({ operation: v.literal('goto'), url: v.string() }),
  v.object({ operation: v.literal('click'), selector: v.string() }),
  v.object({
    operation: v.literal('fill'),
    selector: v.string(),
    value: v.string(),
  }),
  v.object({ operation: v.literal('text') }),
  v.object({ operation: v.literal('act'), instruction: v.string() }),
  v.object({ operation: v.literal('observe'), instruction: v.string() }),
  v.object({ operation: v.literal('extract'), instruction: v.string() }),
);
export const resultValidator = v.object({
  url: v.string(),
  title: v.string(),
  text: v.string(),
  truncated: v.boolean(),
  actions: v.array(v.object({ selector: v.string(), description: v.string() })),
});
export type BrowserResult = Infer<typeof resultValidator>;

export function validateOperation(input: unknown): BrowserOperation {
  const result = operationSchema.safeParse(input);
  if (!result.success) throw new Error('BROWSER_INVALID_INPUT');
  if (result.data.operation === 'goto') {
    const url = new URL(result.data.url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('BROWSER_INVALID_URL');
  }
  return result.data;
}

export function safeBrowserError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  // Never copy provider errors, which may include keys, CDP URLs or page content.
  return (
    [
      'BROWSER_NOT_CONFIGURED',
      'BROWSER_INVALID_INPUT',
      'BROWSER_INVALID_URL',
      'BROWSER_TIMEOUT',
      'BROWSER_CLOSED',
      'BROWSER_ABORTED',
      'BROWSER_SESSION_UNAVAILABLE',
      'BROWSER_ACTION_FAILED',
    ].find((code) => message.includes(code)) ?? 'BROWSER_UNAVAILABLE'
  );
}
