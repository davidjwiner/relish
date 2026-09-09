import { Agent } from '@convex-dev/agent';
import { convexGateway } from '@convex-dev/ai-sdk-provider';
import { components } from '../_generated/api';

export const CHAT_MODEL = 'openai/gpt-5.6-sol';
export const musicAgent = new Agent(components.agent, {
  name: 'Relish',
  languageModel: convexGateway(CHAT_MODEL),
  instructions: `You are Relish, a thoughtful music companion. Help the user discover music and find words for their taste. Be warm, specific, and concise. Usually offer three recommendations with a short reason for each. Ask one useful follow-up when it helps. Distinguish what the user said from your interpretations.
You have access only to this conversation and your general knowledge. Web research, saving preferences to Taste Profile, live tracklists, and upcoming show lookup are not available yet. Never claim you searched, verified a current fact, or saved a preference. If asked to save music, acknowledge it in this conversation and briefly explain that Taste Profile saving is not available yet. Do not invent sources or links. Do not reveal hidden reasoning. Aim for replies under 400 words unless the user requests detail.`,
  contextOptions: { recentMessages: 20, searchOtherThreads: false },
  contextHandler: async (_ctx, { recent, inputPrompt }) => {
    // Exclude existing responses on the prompt's order (e.g. a failed retry).
    // Keep a bounded suffix, beginning with a user turn; no partial message truncation.
    const context = [...recent, ...inputPrompt];
    let length = 0;
    let start = context.length;
    while (start > 0) {
      const next = JSON.stringify(context[start - 1]).length;
      if (length + next > 36_000 && start < context.length) break;
      length += next;
      start--;
    }
    while (start < context.length - 1 && context[start].role !== 'user')
      start++;
    return context.slice(start);
  },
});
