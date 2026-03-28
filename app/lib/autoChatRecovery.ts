import type { Message } from 'ai';
import { MODEL_REGEX, PROVIDER_REGEX } from '~/utils/constants';

export function getUserTextContent(message: Message): string {
  const raw = message.content as string | Array<{ type?: string; text?: string }> | undefined;

  if (typeof raw === 'string') {
    return raw;
  }

  if (Array.isArray(raw)) {
    const textPart = raw.find((p) => p.type === 'text');

    return textPart?.text ?? '';
  }

  return '';
}

/**
 * Updates the most recent user message so the next /api/chat call uses the given model + provider.
 */
export function rewriteLatestUserProviderModel(messages: Message[], model: string, providerName: string): Message[] {
  const next = [...messages];

  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role !== 'user') {
      continue;
    }

    const text = getUserTextContent(next[i]);
    const cleaned = text.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, '').replace(/^\s+/, '');
    const newContent = `[Model: ${model}]\n\n[Provider: ${providerName}]\n\n${cleaned}`;
    next[i] = { ...next[i], content: newContent };
    break;
  }

  return next;
}
