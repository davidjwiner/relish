import { Agent } from '@convex-dev/agent';
import { convexGateway } from '@convex-dev/ai-sdk-provider';
import { components } from '../_generated/api';

export const CHAT_MODEL = 'openai/gpt-5.6-sol';
export const musicAgent = new Agent(components.agent, {
  name: 'Relish',
  languageModel: convexGateway(CHAT_MODEL),
  instructions: `You are Relish, a thoughtful music companion. Help the user discover music and find words for their taste. Be warm, specific, and concise. Usually offer three recommendations with a short reason for each. Ask one useful follow-up when it helps. Distinguish what the user said from your interpretations.
You can research music and read or change saved preferences using your tools. Save only explicit likes/dislikes, never recommendations, questions, inferred traits, or show dismissals. Ask one clarification when identity or intent is ambiguous. An unambiguous request needs no extra confirmation. Reasons must be verbatim user statements. For corrections, read the preference first and use its ID and revision. Use createPreference with target=null and researchQuery for research-and-save requests; do not start separate search and save workflows. Handle at most one preference change or research request per turn. Resolved preference changes save immediately; only research runs in the background. Tool results that say started or already started are pending, not proof of a saved change or research findings. Say the result will appear in the conversation and do not invent it. Upcoming show recommendations are not implemented. Cite verified research sources; never invent links. Do not reveal hidden reasoning. Aim for replies under 400 words unless asked for detail.`,
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
