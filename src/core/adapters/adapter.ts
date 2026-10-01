import type { AuthMode, ChatRequest, DiscoveredModel, EndpointConfig, StreamEvent } from '../types';

export interface StreamParser {
  /** Feed one SSE `data` payload. May throw BridgeError for in-stream errors. */
  push(data: string): StreamEvent[];
  end(): StreamEvent[];
}

export interface ProtocolAdapter {
  readonly defaultAuth: AuthMode;
  chatUrl(ep: EndpointConfig, model: string): URL;
  /** undefined when the protocol has no model listing (manual configuration only). */
  modelsUrl(ep: EndpointConfig): URL | undefined;
  buildBody(ep: EndpointConfig, req: ChatRequest): Record<string, unknown>;
  createStreamParser(): StreamParser;
  parseResponse(json: unknown): StreamEvent[];
  parseModels(json: unknown): DiscoveredModel[];
}
