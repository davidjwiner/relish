import type { UIMessage } from '@convex-dev/agent/react';
import type { ThreadMessageLike } from '@assistant-ui/react';

export function toChatMessage(message: UIMessage): ThreadMessageLike {
  return {
    id: message.key,
    role: message.role === 'user' ? 'user' : 'assistant',
    createdAt: new Date(message._creationTime),
    content: message.parts.flatMap((part) =>
      part.type === 'text' ? [{ type: 'text' as const, text: part.text }] : [],
    ),
    ...(message.role === 'assistant'
      ? {
          status:
            message.status === 'streaming' || message.status === 'pending'
              ? { type: 'running' as const }
              : message.status === 'failed'
                ? { type: 'incomplete' as const, reason: 'error' as const }
                : { type: 'complete' as const, reason: 'stop' as const },
        }
      : {}),
  };
}
