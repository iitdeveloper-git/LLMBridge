import { describe, expect, it } from 'vitest';
import { toChatMessages, toToolDefs } from '../../src/core/mapping';
import { estimateMessageTokens } from '../../src/core/tokens';
import { CredentialStore } from '../../src/vscode/secrets';

const text = (value: string) => ({ value });
const call = (callId: string, name: string, input: object) => ({ callId, name, input });
const result = (callId: string, content: unknown[]) => ({ callId, content });
const img = (mime: string) => ({ mimeType: mime, data: new Uint8Array([1, 2, 3]) });

describe('VS Code message mapping', () => {
  it('maps a tool round trip: assistant tool call, then results before user text', () => {
    const out = toChatMessages([
      { role: 1, content: [text('weather?')] },
      { role: 2, content: [text('checking'), call('c1', 'w', { city: 'P' })] },
      { role: 1, content: [result('c1', [text('sunny'), text(' 22C')]), text('thanks')] },
    ], { vision: false });
    expect(out).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'weather?' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'checking' }], toolCalls: [{ id: 'c1', name: 'w', args: { city: 'P' } }] },
      { role: 'tool', toolCallId: 'c1', parts: [{ type: 'text', text: 'sunny 22C' }] },
      { role: 'user', parts: [{ type: 'text', text: 'thanks' }] },
    ]);
  });
  it('images require vision', () => {
    expect(() => toChatMessages([{ role: 1, content: [img('image/png')] }], { vision: false })).toThrow(/vision/);
    expect(toChatMessages([{ role: 1, content: [img('image/png')] }], { vision: true })[0]!.parts[0]).toEqual({ type: 'image', mime: 'image/png', base64: 'AQID' });
  });
  it('json tool results and unknown parts are stringified, not dropped', () => {
    const out = toChatMessages([{ role: 1, content: [result('c', [{ value: { a: 1 } }])] }], { vision: false });
    expect(out[0]!.parts[0]).toEqual({ type: 'text', text: '{"a":1}' });
  });
  it('tool defs default to an empty object schema', () => {
    expect(toToolDefs([{ name: 'a', description: 'd' }])[0]!.parameters).toEqual({ type: 'object', properties: {} });
    expect(toToolDefs(undefined)).toEqual([]);
  });
  it('token estimate counts tool calls and images', () => {
    expect(estimateMessageTokens({ role: 'assistant', parts: [], toolCalls: [{ id: 'x', name: 'tool', args: { a: 'b' } }] })).toBeGreaterThan(4);
    expect(estimateMessageTokens({ role: 'user', parts: [{ type: 'image', mime: 'image/png', base64: '' }] })).toBeGreaterThan(500);
  });
});

describe('CredentialStore (SecretStorage wrapper)', () => {
  const fake = () => {
    const m = new Map<string, string>();
    return { m, get: async (k: string) => m.get(k), store: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) } as any;
  };
  it('stores namespaced, origin-bound credentials; tolerates corrupt data', async () => {
    const s = fake();
    const c = new CredentialStore(s);
    await c.set('ep1', 'sk-1', 'https://a.example');
    expect([...s.m.keys()]).toEqual(['iitdeveloper.llmBridge.credential.ep1']);
    expect(await c.get('ep1')).toEqual({ secret: 'sk-1', origin: 'https://a.example' });
    s.m.set('iitdeveloper.llmBridge.credential.ep2', 'garbage');
    expect(await c.get('ep2')).toBeUndefined();
    await c.delete('ep1');
    expect(await c.get('ep1')).toBeUndefined();
  });
});
