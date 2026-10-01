import { BridgeError } from './errors';
import type { ChatMessage, Part, ToolCall, ToolDef } from './types';

// Duck-typed so this module has no `vscode` dependency (and can be unit-tested directly).
const isToolCall = (p: any) => p && typeof p.callId === 'string' && typeof p.name === 'string' && 'input' in p;
const isToolResult = (p: any) => p && typeof p.callId === 'string' && Array.isArray(p.content);
const isData = (p: any) => p && typeof p.mimeType === 'string' && p.data && typeof p.data.byteLength === 'number';
const isText = (p: any) => p && typeof p.value === 'string' && !('callId' in p) && !('mimeType' in p);

const ROLE_USER = 1;
const ROLE_ASSISTANT = 2;

function dataToText(p: any): string | undefined {
  if (/^(text\/|application\/json)/.test(p.mimeType)) return new TextDecoder().decode(p.data);
  return undefined;
}

function resultToText(content: readonly unknown[]): string {
  return content.map((c: any) => {
    if (isText(c)) return c.value;
    if (isData(c)) return dataToText(c) ?? `[${c.mimeType} data omitted]`;
    try { return JSON.stringify(c?.value ?? c); } catch { return String(c); }
  }).join('');
}

export interface MapOptions { vision: boolean }

export function toChatMessages(messages: readonly { role: number; content: readonly unknown[] }[], opts: MapOptions): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const parts: Part[] = [];
    const toolCalls: ToolCall[] = [];
    const results: ChatMessage[] = [];
    for (const p of m.content as any[]) {
      if (isToolCall(p)) toolCalls.push({ id: p.callId, name: p.name, args: (p.input ?? {}) as Record<string, unknown> });
      else if (isToolResult(p)) results.push({ role: 'tool', toolCallId: p.callId, parts: [{ type: 'text', text: resultToText(p.content) }] });
      else if (isData(p)) {
        if (p.mimeType.startsWith('image/')) {
          if (!opts.vision) throw new BridgeError('config', 'This message contains an image but the model is not configured with "vision": true.');
          parts.push({ type: 'image', mime: p.mimeType, base64: Buffer.from(p.data).toString('base64') });
        } else {
          const t = dataToText(p);
          if (t !== undefined) parts.push({ type: 'text', text: t });
        }
      } else if (isText(p)) parts.push({ type: 'text', text: p.value });
    }
    if (m.role === ROLE_ASSISTANT) {
      if (parts.length || toolCalls.length) out.push({ role: 'assistant', parts, toolCalls: toolCalls.length ? toolCalls : undefined });
    } else if (m.role === ROLE_USER) {
      out.push(...results); // tool results must directly follow the assistant tool-call message
      if (parts.length) out.push({ role: 'user', parts });
    }
  }
  return out;
}

export function toToolDefs(tools: readonly { name: string; description: string; inputSchema?: object }[] | undefined): ToolDef[] {
  return (tools ?? []).map((t) => ({ name: t.name, description: t.description, parameters: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} } }));
}
