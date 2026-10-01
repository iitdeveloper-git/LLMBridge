import { BridgeError } from '../errors';
import { joinUrl, parseBaseUrl } from '../url';
import type { ChatMessage, ChatRequest, EndpointConfig, StreamEvent, ToolCall } from '../types';
import type { ProtocolAdapter, StreamParser } from './adapter';
import { parseJsonArgs, parseOpenAiModels, pickOptions, textOf, throwStreamError } from './common';

export function toWireMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: textOf(m) };
    if (m.role === 'assistant') {
      const out: Record<string, unknown> = { role: 'assistant', content: textOf(m) || null };
      if (m.toolCalls?.length) {
        out.tool_calls = m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }));
      }
      return out;
    }
    const hasImage = m.parts.some((p) => p.type === 'image');
    if (!hasImage) return { role: m.role, content: textOf(m) };
    return {
      role: m.role,
      content: m.parts.map((p) =>
        p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.base64}` } },
      ),
    };
  });
}

export function buildChatBody(req: ChatRequest, includeModel: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...(includeModel ? { model: req.model } : {}),
    messages: toWireMessages(req.messages),
    stream: req.stream,
    ...pickOptions(req.modelOptions, ['temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'stop', 'reasoning_effort', 'seed']),
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    if (req.toolChoice === 'required') body.tool_choice = 'required';
  }
  return body;
}

class ChatCompletionsStream implements StreamParser {
  private calls = new Map<number, { id: string; name: string; args: string }>();
  private lastIndex = -1;
  private flushed = false;

  push(data: string): StreamEvent[] {
    if (data.trim() === '[DONE]') return this.flush();
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      throw new BridgeError('protocol', 'Received a malformed streaming chunk from the endpoint.');
    }
    if (json?.error) throwStreamError(json.error);
    const out: StreamEvent[] = [];
    const choice = json?.choices?.[0];
    if (!choice) return out;
    const delta = choice.delta ?? {};
    if (typeof delta.content === 'string' && delta.content) out.push({ type: 'text', text: delta.content });
    for (const tc of delta.tool_calls ?? []) {
      let idx: number = typeof tc.index === 'number' ? tc.index : tc.id ? this.calls.size : Math.max(this.lastIndex, 0);
      if (typeof tc.index !== 'number' && tc.id && this.calls.size > 0 && [...this.calls.values()].some((c) => c.id === tc.id)) {
        idx = [...this.calls.entries()].find(([, c]) => c.id === tc.id)![0];
      }
      this.lastIndex = idx;
      const cur = this.calls.get(idx) ?? { id: '', name: '', args: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (typeof tc.function?.arguments === 'string') cur.args += tc.function.arguments;
      this.calls.set(idx, cur);
    }
    if (choice.finish_reason) out.push(...this.flush());
    return out;
  }

  end(): StreamEvent[] {
    return this.flush();
  }

  private flush(): StreamEvent[] {
    if (this.flushed) return [];
    this.flushed = true;
    const out: StreamEvent[] = [];
    for (const [i, c] of [...this.calls.entries()].sort((a, b) => a[0] - b[0])) {
      if (!c.name) continue;
      out.push({ type: 'toolCall', call: { id: c.id || `call_${i}`, name: c.name, args: parseJsonArgs(c.args) } });
    }
    return out;
  }
}

export function parseChatCompletion(json: any): StreamEvent[] {
  if (json?.error) throwStreamError(json.error);
  const msg = json?.choices?.[0]?.message;
  if (!msg) throw new BridgeError('protocol', 'Unexpected response shape (no choices[0].message).');
  const out: StreamEvent[] = [];
  if (typeof msg.content === 'string' && msg.content) out.push({ type: 'text', text: msg.content });
  (msg.tool_calls ?? []).forEach((tc: any, i: number) => {
    const call: ToolCall = { id: tc.id || `call_${i}`, name: tc.function?.name, args: parseJsonArgs(tc.function?.arguments) };
    if (call.name) out.push({ type: 'toolCall', call });
  });
  return out;
}

const base = (ep: EndpointConfig) => parseBaseUrl(ep);

export const openAiChatAdapter: ProtocolAdapter = {
  defaultAuth: 'bearer',
  chatUrl: (ep) => joinUrl(base(ep), 'chat/completions'),
  modelsUrl: (ep) => joinUrl(base(ep), 'models'),
  buildBody: (_ep, req) => buildChatBody(req, true),
  createStreamParser: () => new ChatCompletionsStream(),
  parseResponse: parseChatCompletion,
  parseModels: parseOpenAiModels,
};

/** Ollama's OpenAI-compatible API (default http://localhost:11434/v1): same wire format, no auth by default. */
export const ollamaAdapter: ProtocolAdapter = { ...openAiChatAdapter, defaultAuth: 'none' };

/** Azure OpenAI legacy: deployment-scoped URL with api-version query; the model is the deployment name. */
export const azureLegacyAdapter: ProtocolAdapter = {
  defaultAuth: 'api-key-header',
  chatUrl: (ep, model) => {
    if (!ep.apiVersion) throw new BridgeError('config', 'Azure legacy endpoints require "apiVersion" (e.g. 2024-10-21).');
    return joinUrl(base(ep), `openai/deployments/${encodeURIComponent(model)}/chat/completions`, { 'api-version': ep.apiVersion });
  },
  modelsUrl: () => undefined,
  buildBody: (_ep, req) => buildChatBody(req, false),
  createStreamParser: () => new ChatCompletionsStream(),
  parseResponse: parseChatCompletion,
  parseModels: parseOpenAiModels,
};
