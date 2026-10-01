import type { DiscoveredModel, EndpointConfig, ResolvedModel } from './types';

export const DEFAULT_MAX_INPUT = 128_000;
export const DEFAULT_MAX_OUTPUT = 16_384;

/** Manual configuration always wins over discovery. Discovered-only models get conservative defaults. */
export function resolveModels(ep: EndpointConfig, discovered: readonly DiscoveredModel[] = []): ResolvedModel[] {
  const out = new Map<string, ResolvedModel>();
  for (const d of discovered) {
    out.set(d.id, {
      id: d.id, name: d.id, maxInputTokens: DEFAULT_MAX_INPUT, maxOutputTokens: DEFAULT_MAX_OUTPUT,
      toolCalling: ep.assumeToolCalling === true, vision: false, streaming: true, source: 'discovered',
    });
  }
  for (const m of ep.models ?? []) {
    out.set(m.id, {
      id: m.id, name: m.name ?? m.id,
      maxInputTokens: m.maxInputTokens ?? DEFAULT_MAX_INPUT, maxOutputTokens: m.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
      toolCalling: m.toolCalling ?? false, vision: m.vision ?? false, streaming: m.streaming ?? true, source: 'manual',
    });
  }
  return [...out.values()];
}
