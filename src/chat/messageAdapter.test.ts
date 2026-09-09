import { describe, expect, it } from 'vitest';
import type { UIMessage } from '@convex-dev/agent/react';
import { toChatMessage } from './messageAdapter';
import { safeReturnTo } from '../auth/routes';

describe('chat adapter and routes', () => {
  it('keeps IDs stable and hides reasoning parts', () => {
    const message = {
      key: 'message-1',
      role: 'assistant',
      _creationTime: 1,
      status: 'streaming',
      parts: [
        { type: 'text', text: 'Try this artist.' },
        { type: 'reasoning', text: 'Private reasoning' },
      ],
    } as UIMessage;
    const streaming = toChatMessage(message);
    const complete = toChatMessage({ ...message, status: 'success' });
    expect(streaming.id).toBe(complete.id);
    expect(streaming.content).toEqual([
      { type: 'text', text: 'Try this artist.' },
    ]);
    expect(streaming.status?.type).toBe('running');
    expect(complete.status?.type).toBe('complete');
  });
  it('restores only local conversation routes', () => {
    expect(safeReturnTo('/chat/abc123')).toBe('/chat/abc123');
    for (const unsafe of [
      '//evil.test/chat/x',
      'https://evil.test',
      '/chat/x/other',
      '/chat/%2f%2fevil.test',
      '/chat/x?returnTo=evil',
    ])
      expect(safeReturnTo(unsafe)).toBe('/chat');
  });
});
