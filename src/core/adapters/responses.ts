import { BridgeError } from '../errors';
import { joinUrl, parseBaseUrl } from '../url';
import type { ChatMessage, ChatRequest, StreamEvent } from '../types';
import type { ProtocolAdapter, StreamParser } from './adapter';
import { parseJsonArgs, parseOpenAiModels, pickOptions, textOf, throwStreamError } from './common';

export function toResponsesInput(messages: ChatMessage[]): { instructions?: string; input: unknown[] } {
  const instructions: string[] = [];
  const input: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      instructions.push(textOf(m));
    } else if (m.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: m.toolCallId, output: textOf(m) });
    } else if (m.role === 'assistant') {
      const text = textOf(m);
      if (text) input.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
      for (const c of m.toolCalls ?? []) input.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.args) });
    } else {
      input.push({
        role: 'user',
        content: m.parts.map((p) =>
          p.type === 'text' ? { type: 'input_text', text: p.text } : { type: 'input_image', image_url: `data:${p.mime};base64,${p.base64}` },
        ),
      });
    }
  }
  return { instructions: instructions.length ? instructions.join('\n\n') : undefined, input };
}

export function buildResponsesBody(req: ChatRequest): Record<string, unknown> {
  const { instructions, input } = toResponsesInput(req.messages);
  const body: Record<string, unknown> = {
    model: req.model,
    input,
    stream: req.stream,
    store: false,
    ...pickOptions(req.modelOptions, ['temperature', 'top_p', 'max_output_tokens']),
  };
  if (instructions) body.instructions = instructions;
  const effort = req.modelOptions?.reasoning_effort;
  if (typeof effort === 'string') body.reasoning = { effort };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }));
    if (req.toolChoice === 'required') body.tool_choice = 'required';
  }
  return body;
}

class ResponsesStream implements StreamParser {
  private sawText = false;

  push(data: string): StreamEvent[] {
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      throw new BridgeError('protocol', 'Received a malformed streaming chunk from the endpoint.');
    }
    switch (json?.type) {
      case 'response.output_text.delta':
        if (typeof json.delta === 'string' && json.delta) {
          this.sawText = true;
          return [{ type: 'text', text: json.delta }];
        }
        return [];
      case 'response.output_item.done':
        if (json.item?.type === 'function_call') {
          const it = json.item;
          return [{ type: 'toolCall', call: { id: it.call_id ?? it.id, name: it.name, args: parseJsonArgs(it.arguments) } }];
        }
        return [];
      case 'response.failed':
        return throwStreamError(json.response?.error ?? 'response failed');
      case 'response.incomplete':
        return [];
      case 'error':
        return throwStreamError(json);
      default:
        return [];
    }
  }

  end(): StreamEvent[] {
    return [];
  }
}

export function parseResponsesResult(json: any): StreamEvent[] {
  if (json?.error) throwStreamError(json.error);
  if (!Array.isArray(json?.output)) throw new BridgeError('protocol', 'Unexpected response shape (no output[]).');
  const out: StreamEvent[] = [];
  for (const item of json.output) {
    if (item.type === 'message') {
      for (const c of item.content ?? []) if (c.type === 'output_text' && c.text) out.push({ type: 'text', text: c.text });
    } else if (item.type === 'function_call') {
      out.push({ type: 'toolCall', call: { id: item.call_id ?? item.id, name: item.name, args: parseJsonArgs(item.arguments) } });
    }
  }
  return out;
}

export const openAiResponsesAdapter: ProtocolAdapter = {
  defaultAuth: 'bearer',
  chatUrl: (ep) => joinUrl(parseBaseUrl(ep), 'responses'),
  modelsUrl: (ep) => joinUrl(parseBaseUrl(ep), 'models'),
  buildBody: (_ep, req) => buildResponsesBody(req),
  createStreamParser: () => new ResponsesStream(),
  parseResponse: parseResponsesResult,
  parseModels: parseOpenAiModels,
};
