export type Protocol = 'openai-chat' | 'openai-responses' | 'azure-openai-v1' | 'azure-openai-legacy' | 'ollama';
export const PROTOCOLS: readonly Protocol[] = ['openai-chat', 'openai-responses', 'azure-openai-v1', 'azure-openai-legacy', 'ollama'];
export type AuthMode = 'bearer' | 'api-key-header' | 'none';

export interface ModelConfig {
  id: string;
  name?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  toolCalling?: boolean;
  vision?: boolean;
  streaming?: boolean;
}

export interface EndpointConfig {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  auth?: AuthMode;
  apiVersion?: string;
  azureV1Api?: 'responses' | 'chat';
  headers?: Record<string, string>;
  allowInsecureHttp?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  autoDiscover?: boolean;
  assumeToolCalling?: boolean;
  models?: ModelConfig[];
}

/** A model after merging manual config and discovery, with defaults applied. */
export interface ResolvedModel {
  id: string;
  name: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  toolCalling: boolean;
  vision: boolean;
  streaming: boolean;
  source: 'manual' | 'discovered';
}

export interface DiscoveredModel {
  id: string;
}

/** Provider-agnostic conversation model. Adapters translate this to wire formats. */
export type Part = { type: 'text'; text: string } | { type: 'image'; mime: string; base64: string };
export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  parts: Part[];
  toolCalls?: ToolCall[];
  /** For role 'tool': the call this result answers. */
  toolCallId?: string;
}
export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  toolChoice?: 'auto' | 'required';
  stream: boolean;
  modelOptions?: Record<string, unknown>;
}

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'toolCall'; call: ToolCall };

export interface Credential { secret: string; origin: string }

export interface Logger {
  error(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
}
export const nullLogger: Logger = { error() {}, info() {}, debug() {} };
