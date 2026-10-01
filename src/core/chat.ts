import { getAdapter } from './adapters';
import { BridgeError } from './errors';
import { send, type HttpDeps } from './http';
import { SseParser } from './sse';
import { stableModelId } from './ids';
import type { ChatRequest, Credential, EndpointConfig, ResolvedModel, StreamEvent } from './types';

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_RETRIES = 2;

export interface StreamChatArgs {
  endpoint: EndpointConfig;
  model: Pick<ResolvedModel, 'id' | 'streaming'>;
  request: Omit<ChatRequest, 'model' | 'stream'>;
  credential?: Credential;
  signal?: AbortSignal;
  deps?: HttpDeps;
}

/** Send one chat request and yield normalized events. Streams when the model allows it. */
export async function* streamChat(a: StreamChatArgs): AsyncGenerator<StreamEvent> {
  const ep = a.endpoint;
  const adapter = getAdapter(ep);
  const stream = a.model.streaming !== false;
  const req: ChatRequest = { ...a.request, model: a.model.id, stream };
  const url = adapter.chatUrl(ep, a.model.id);
  const log = a.deps?.log;
  const started = Date.now();
  let textChunks = 0;
  let toolCalls = 0;
  // Metadata only: never the prompt, code, or response text.
  log?.info(`Chat request: ${stableModelId(ep.id, a.model.id)} POST ${url.origin}${url.pathname} stream=${stream} messages=${req.messages.length} tools=${req.tools?.length ?? 0}`);

  const { response, deadline } = await send(
    {
      method: 'POST', url,
      headers: { 'content-type': 'application/json', accept: stream ? 'text/event-stream' : 'application/json', ...(ep.headers ?? {}) },
      body: JSON.stringify(adapter.buildBody(ep, req)),
      auth: ep.auth ?? adapter.defaultAuth, credential: a.credential,
      timeoutMs: ep.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxRetries: ep.maxRetries ?? DEFAULT_RETRIES, signal: a.signal,
    },
    a.deps,
  );
  const count = (e: StreamEvent) => { if (e.type === 'text') textChunks++; else toolCalls++; };
  try {
    const type = response.headers.get('content-type') ?? '';
    if (stream && type.includes('text/event-stream') && response.body) {
      const reader = response.body.getReader();
      const sse = new SseParser();
      const parser = adapter.createStreamParser();
      try {
        for (;;) {
          deadline.arm();
          const { done, value } = await reader.read();
          if (done) break;
          for (const ev of sse.push(value)) for (const out of parser.push(ev.data)) { count(out); yield out; }
        }
        for (const ev of sse.end()) for (const out of parser.push(ev.data)) { count(out); yield out; }
        for (const out of parser.end()) { count(out); yield out; }
      } catch (e) {
        if (e instanceof BridgeError) throw e;
        if (deadline.signal.aborted) throw deadline.abortError();
        throw new BridgeError('network', `The stream was interrupted: ${(e as Error).message}`, undefined, false);
      } finally {
        reader.cancel().catch(() => {});
      }
    } else {
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        if (deadline.signal.aborted) throw deadline.abortError();
        throw new BridgeError('protocol', 'The endpoint returned a response that is not valid JSON.');
      }
      for (const out of adapter.parseResponse(json)) { count(out); yield out; }
    }
    log?.info(`Chat response: ${stableModelId(ep.id, a.model.id)} completed in ${Date.now() - started}ms (text chunks=${textChunks}, tool calls=${toolCalls})`);
  } finally {
    deadline.dispose();
  }
}
