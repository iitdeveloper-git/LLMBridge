import { getAdapter } from './adapters';
import { resolveModels } from './models';
import { stableModelId } from './ids';
import type { Credential, DiscoveredModel, EndpointConfig } from './types';

export type KeyState = 'set' | 'missing' | 'mismatch' | 'not-needed';

export interface EndpointNode {
  kind: 'endpoint';
  endpointId: string;
  label: string;
  description: string;
  tooltip: string;
  keyState: KeyState;
  modelCount: number;
}
export interface ModelNode {
  kind: 'model';
  endpointId: string;
  modelId: string;
  label: string;
  description: string;
  tooltip: string;
  source: 'manual' | 'discovered';
}
export interface HintNode {
  kind: 'hint';
  endpointId: string;
  label: string;
  /** Command (without arguments) that the hint runs when clicked. */
  commandSuffix: 'discoverModels' | 'addModel';
}
export type TreeNode = EndpointNode | ModelNode | HintNode;

export function keyState(ep: EndpointConfig, cred: Credential | undefined): KeyState {
  if ((ep.auth ?? getAdapter(ep).defaultAuth) === 'none') return 'not-needed';
  if (!cred) return 'missing';
  try {
    return new URL(ep.baseUrl).origin === cred.origin ? 'set' : 'mismatch';
  } catch {
    return 'mismatch';
  }
}

const KEY_TEXT: Record<KeyState, string> = {
  set: 'API key: set',
  missing: 'API key: not set (run "Set API Key")',
  mismatch: 'API key: saved for a different origin and will NOT be sent. Re-enter it.',
  'not-needed': 'No API key required (auth: none)',
};

export function endpointNodes(
  endpoints: readonly EndpointConfig[],
  creds: Readonly<Record<string, Credential | undefined>>,
  discovered: Readonly<Record<string, readonly DiscoveredModel[]>>,
): EndpointNode[] {
  return endpoints.map((ep) => {
    const state = keyState(ep, creds[ep.id]);
    const modelCount = resolveModels(ep, discovered[ep.id] ?? []).length;
    let host = ep.baseUrl;
    try { host = new URL(ep.baseUrl).host; } catch { /* keep raw */ }
    return {
      kind: 'endpoint', endpointId: ep.id, label: ep.name,
      description: `${ep.protocol} · ${host}`,
      tooltip: `${ep.name}\n${ep.baseUrl}\nProtocol: ${ep.protocol}\n${KEY_TEXT[state]}\nModels: ${modelCount}`,
      keyState: state, modelCount,
    };
  });
}

export function modelNodes(ep: EndpointConfig, discovered: readonly DiscoveredModel[]): Array<ModelNode | HintNode> {
  const models = resolveModels(ep, discovered);
  if (!models.length) {
    const canDiscover = !!getAdapter(ep).modelsUrl(ep);
    return [{
      kind: 'hint', endpointId: ep.id, commandSuffix: canDiscover ? 'discoverModels' : 'addModel',
      label: canDiscover ? 'No models yet: click to discover' : 'No models yet: click to add one',
    }];
  }
  return models.map((m) => {
    const badges = [m.toolCalling ? 'tools' : '', m.vision ? 'vision' : '', m.source === 'discovered' ? 'discovered' : ''].filter(Boolean);
    return {
      kind: 'model' as const, endpointId: ep.id, modelId: m.id, label: m.name,
      description: [m.name !== m.id ? m.id : '', ...badges].filter(Boolean).join(' · '),
      tooltip: `${m.name}\nPicker id: ${stableModelId(ep.id, m.id)}\nContext: ${m.maxInputTokens} in / ${m.maxOutputTokens} out\nTool calling: ${m.toolCalling ? 'yes' : 'no'} · Vision: ${m.vision ? 'yes' : 'no'}\nSource: ${m.source}`,
      source: m.source,
    };
  });
}
