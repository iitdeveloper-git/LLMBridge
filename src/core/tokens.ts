import type { ChatMessage } from './types';

/** Heuristic (~4 chars/token). No tokenizer is bundled; counts are estimates, not billing figures. */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const IMAGE_TOKENS = 512;

export function estimateMessageTokens(m: ChatMessage): number {
  let n = 4;
  for (const p of m.parts) n += p.type === 'text' ? estimateTextTokens(p.text) : IMAGE_TOKENS;
  for (const c of m.toolCalls ?? []) n += estimateTextTokens(c.name) + estimateTextTokens(JSON.stringify(c.args));
  return n;
}
