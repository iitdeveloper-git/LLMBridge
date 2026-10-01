import { BridgeError } from '../errors';
import type { ChatMessage, DiscoveredModel } from '../types';

export function parseJsonArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
  } catch {
    throw new BridgeError('protocol', 'The model returned tool-call arguments that are not valid JSON.');
  }
}

export function parseOpenAiModels(json: unknown): DiscoveredModel[] {
  const data = (json as any)?.data ?? (json as any)?.models;
  if (!Array.isArray(data)) throw new BridgeError('protocol', 'Unexpected /models response shape (expected {"data":[...]}).');
  const seen = new Set<string>();
  const out: DiscoveredModel[] = [];
  for (const m of data) {
    const id = typeof m === 'string' ? m : m?.id ?? m?.name;
    if (typeof id === 'string' && id && !seen.has(id)) {
      seen.add(id);
      out.push({ id });
    }
  }
  return out;
}

export function textOf(m: ChatMessage): string {
  return m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
}

/** Pass through only well-known sampling options from VS Code's per-model options. */
export function pickOptions(opts: Record<string, unknown> | undefined, allowed: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) if (opts && opts[k] !== undefined) out[k] = opts[k];
  return out;
}

export function throwStreamError(err: any): never {
  const msg = typeof err === 'string' ? err : err?.message ?? 'unknown error';
  throw new BridgeError('server', `The model stream reported an error: ${String(msg).slice(0, 300)}`);
}
