import { getAdapter } from './adapters';
import { BridgeError } from './errors';
import { send, type HttpDeps } from './http';
import { DEFAULT_RETRIES, DEFAULT_TIMEOUT_MS, streamChat } from './chat';
import type { Credential, DiscoveredModel, EndpointConfig } from './types';

export async function discoverModels(ep: EndpointConfig, credential: Credential | undefined, signal?: AbortSignal, deps?: HttpDeps): Promise<DiscoveredModel[]> {
  const adapter = getAdapter(ep);
  const url = adapter.modelsUrl(ep);
  if (!url) throw new BridgeError('config', 'This protocol has no model listing endpoint. Add models manually ("LLM Bridge: Add Model Manually").');
  const { response, deadline } = await send(
    { method: 'GET', url, headers: { accept: 'application/json', ...(ep.headers ?? {}) }, auth: ep.auth ?? adapter.defaultAuth, credential,
      timeoutMs: ep.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxRetries: ep.maxRetries ?? DEFAULT_RETRIES, signal },
    deps,
  );
  try {
    let json: unknown;
    try { json = await response.json(); } catch { throw new BridgeError('protocol', 'The /models response is not valid JSON.'); }
    return adapter.parseModels(json);
  } finally {
    deadline.dispose();
  }
}

export interface TestResult { ok: boolean; message: string; latencyMs: number }

export async function testConnection(ep: EndpointConfig, credential: Credential | undefined, signal?: AbortSignal, deps?: HttpDeps): Promise<TestResult> {
  const t0 = Date.now();
  try {
    const models = await discoverModels(ep, credential, signal, deps);
    return { ok: true, message: `Connected. ${models.length} model(s) listed.`, latencyMs: Date.now() - t0 };
  } catch (e) {
    if (e instanceof BridgeError && e.kind === 'config' && !getAdapter(ep).modelsUrl(ep)) {
      return { ok: true, message: 'This protocol has no model listing; use "Test Inference" to verify the connection.', latencyMs: 0 };
    }
    return { ok: false, message: (e as Error).message, latencyMs: Date.now() - t0 };
  }
}

/** Sends a tiny prompt. Reports only success and length, never the response content. */
export async function testInference(ep: EndpointConfig, modelId: string, streaming: boolean, credential: Credential | undefined, signal?: AbortSignal, deps?: HttpDeps): Promise<TestResult> {
  const t0 = Date.now();
  try {
    let chars = 0;
    for await (const ev of streamChat({
      endpoint: ep, model: { id: modelId, streaming }, credential, signal, deps,
      request: { messages: [{ role: 'user', parts: [{ type: 'text', text: 'Reply with the single word: ok' }] }] },
    })) if (ev.type === 'text') chars += ev.text.length;
    if (chars === 0) return { ok: false, message: 'The model responded but returned no text.', latencyMs: Date.now() - t0 };
    return { ok: true, message: `Inference succeeded (${chars} chars received, ${streaming ? 'streaming' : 'non-streaming'}).`, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, message: (e as Error).message, latencyMs: Date.now() - t0 };
  }
}
