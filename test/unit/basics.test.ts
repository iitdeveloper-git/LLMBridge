import { describe, expect, it } from 'vitest';
import { parseBaseUrl, joinUrl } from '../../src/core/url';
import { getAdapter } from '../../src/core/adapters';
import { redactText, redactHeaders } from '../../src/core/redact';
import { authHeaders, assertCredentialBound, validateHeaders } from '../../src/core/security';
import { parseModelId, stableModelId } from '../../src/core/ids';
import { SseParser } from '../../src/core/sse';
import { validateEndpoint, validateEndpoints } from '../../src/core/config';
import { resolveModels, withModelOverride } from '../../src/core/models';
import { exportConfig, parseImport, originChanged } from '../../src/core/portable';
import { estimateTextTokens } from '../../src/core/tokens';
import { ep } from './helpers';

describe('URL construction', () => {
  const cases: Array<[string, any, string]> = [
    ['openai chat', { protocol: 'openai-chat', baseUrl: 'https://api.openai.com/v1' }, 'https://api.openai.com/v1/chat/completions'],
    ['trailing slash', { protocol: 'openai-chat', baseUrl: 'https://h.example/v1/' }, 'https://h.example/v1/chat/completions'],
    ['responses', { protocol: 'openai-responses', baseUrl: 'https://api.openai.com/v1' }, 'https://api.openai.com/v1/responses'],
    ['azure v1 default responses', { protocol: 'azure-openai-v1', baseUrl: 'https://r.openai.azure.com/openai/v1' }, 'https://r.openai.azure.com/openai/v1/responses'],
    ['azure v1 chat', { protocol: 'azure-openai-v1', azureV1Api: 'chat', baseUrl: 'https://r.openai.azure.com/openai/v1' }, 'https://r.openai.azure.com/openai/v1/chat/completions'],
    ['azure legacy', { protocol: 'azure-openai-legacy', apiVersion: '2024-10-21', baseUrl: 'https://r.openai.azure.com' }, 'https://r.openai.azure.com/openai/deployments/my%20dep/chat/completions?api-version=2024-10-21'],
    ['ollama', { protocol: 'ollama', baseUrl: 'http://localhost:11434/v1' }, 'http://localhost:11434/v1/chat/completions'],
  ];
  for (const [name, cfg, expected] of cases) {
    it(name, () => expect(getAdapter(cfg).chatUrl(ep(cfg), 'my dep').toString()).toBe(expected));
  }
  it('models url; azure legacy has none', () => {
    expect(getAdapter({ protocol: 'openai-chat' }).modelsUrl(ep({ baseUrl: 'https://h/v1' }))!.toString()).toBe('https://h/v1/models');
    expect(getAdapter({ protocol: 'azure-openai-legacy' }).modelsUrl(ep({ baseUrl: 'https://h' }))).toBeUndefined();
  });
  it('azure legacy requires api-version', () => {
    expect(() => getAdapter({ protocol: 'azure-openai-legacy' }).chatUrl(ep({ protocol: 'azure-openai-legacy', baseUrl: 'https://h' }), 'd')).toThrow(/apiVersion/);
  });
  it('rejects unsafe base urls', () => {
    expect(() => parseBaseUrl({ baseUrl: 'http://example.com/v1' })).toThrow(/Plain http/);
    expect(parseBaseUrl({ baseUrl: 'http://example.com/v1', allowInsecureHttp: true }).host).toBe('example.com');
    expect(() => parseBaseUrl({ baseUrl: 'https://u:p@example.com' })).toThrow(/credentials/);
    expect(() => parseBaseUrl({ baseUrl: 'https://example.com/v1?api-key=x' })).toThrow(/query/);
    expect(() => parseBaseUrl({ baseUrl: 'ftp://example.com' })).toThrow(/scheme/);
    expect(() => parseBaseUrl({ baseUrl: 'nope' })).toThrow(/Invalid/);
    expect(parseBaseUrl({ baseUrl: 'http://localhost:11434/v1' }).hostname).toBe('localhost');
  });
  it('joinUrl keeps base path', () => expect(joinUrl(new URL('https://h/a/b/'), '/c').pathname).toBe('/a/b/c'));
});

describe('authentication headers', () => {
  it('bearer / api-key / none', () => {
    expect(authHeaders('bearer', 's3cret')).toEqual({ Authorization: 'Bearer s3cret' });
    expect(authHeaders('api-key-header', 's3cret')).toEqual({ 'api-key': 's3cret' });
    expect(authHeaders('none', undefined)).toEqual({});
  });
  it('missing key is an actionable config error', () => expect(() => authHeaders('bearer', undefined)).toThrow(/Set API Key/));
  it('default auth per protocol', () => {
    expect(getAdapter({ protocol: 'openai-chat' }).defaultAuth).toBe('bearer');
    expect(getAdapter({ protocol: 'azure-openai-v1' }).defaultAuth).toBe('api-key-header');
    expect(getAdapter({ protocol: 'azure-openai-legacy' }).defaultAuth).toBe('api-key-header');
    expect(getAdapter({ protocol: 'ollama' }).defaultAuth).toBe('none');
  });
  it('credential destination binding', () => {
    expect(() => assertCredentialBound({ secret: 'k', origin: 'https://a.example' }, new URL('https://a.example/v1'))).not.toThrow();
    expect(() => assertCredentialBound({ secret: 'k', origin: 'https://a.example' }, new URL('https://evil.example/v1'))).toThrow(/NOT sent/);
    expect(() => assertCredentialBound({ secret: 'k', origin: 'https://a.example' }, new URL('http://a.example/v1'))).toThrow(/NOT sent/);
  });
  it('custom headers cannot carry credentials', () => {
    for (const h of ['Authorization', 'api-key', 'X-Api-Key', 'Cookie', 'X-Auth-Token', 'Proxy-Authorization']) {
      expect(validateHeaders({ [h]: 'x' }).length, h).toBeGreaterThan(0);
    }
    expect(validateHeaders({ 'X-Team': 'ml', 'OpenAI-Organization': 'org' })).toEqual([]);
    expect(validateHeaders({ 'X-Team': 'a\r\nInjected: 1' }).length).toBeGreaterThan(0);
    expect(validateHeaders({ 'bad name': 'x' }).length).toBeGreaterThan(0);
  });
});

describe('redaction', () => {
  it('redacts known secrets and patterns', () => {
    const s = 'sk-abcdefghijklmnop1234';
    expect(redactText(`failed with ${s}`)).not.toContain(s);
    expect(redactText('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer [REDACTED]');
    expect(redactText('https://h/x?api-key=SECRET&a=1')).toBe('https://h/x?api-key=[REDACTED]&a=1');
    expect(redactText('https://user:pw@h/x')).not.toContain('pw');
    expect(redactText('api_key: "hunter2hunter2"')).not.toContain('hunter2');
    expect(redactText('my custom-secret-value here', ['custom-secret-value'])).toBe('my [REDACTED] here');
  });
  it('redacts headers', () => {
    expect(redactHeaders({ Authorization: 'Bearer x', 'api-key': 'y', 'X-Team': 'ml' })).toEqual({ Authorization: '[REDACTED]', 'api-key': '[REDACTED]', 'X-Team': 'ml' });
  });
});

describe('stable model ids', () => {
  it('round-trips including colons in model names', () => {
    const id = stableModelId('my-ep', 'llama3:8b');
    expect(id).toBe('my-ep::llama3:8b');
    expect(parseModelId(id)).toEqual({ endpointId: 'my-ep', modelId: 'llama3:8b' });
    expect(stableModelId('a', 'm')).toBe(stableModelId('a', 'm'));
    expect(parseModelId('bad')).toBeUndefined();
    expect(parseModelId('::x')).toBeUndefined();
  });
});

describe('SSE parser', () => {
  const enc = new TextEncoder();
  it('parses events, CRLF, comments, multi-line data', () => {
    const p = new SseParser();
    const evs = [...p.push(enc.encode(': c\r\nevent: a\r\ndata: 1\r\ndata: 2\r\n\r\ndata: x\n\n')), ...p.end()];
    expect(evs).toEqual([{ event: 'a', data: '1\n2' }, { event: undefined, data: 'x' }]);
  });
  it('survives splits at every byte, including inside multi-byte UTF-8 and CRLF', () => {
    const text = 'data: {"t":"héllo ✓ 日本 😀"}\r\n\r\ndata: [DONE]\r\n\r\n';
    const bytes = enc.encode(text);
    for (let cut = 1; cut < bytes.length; cut++) {
      const p = new SseParser();
      const evs = [...p.push(bytes.slice(0, cut)), ...p.push(bytes.slice(cut)), ...p.end()];
      expect(evs.map((e) => e.data), `cut ${cut}`).toEqual(['{"t":"héllo ✓ 日本 😀"}', '[DONE]']);
    }
  });
  it('byte-by-byte delivery', () => {
    const bytes = enc.encode('data: 😀✓\n\ndata: b\n\n');
    const p = new SseParser();
    const evs = [...bytes].flatMap((b) => p.push(Uint8Array.of(b)));
    expect(evs.map((e) => e.data)).toEqual(['😀✓', 'b']);
  });
  it('delivers a trailing event without blank line on end()', () => {
    const p = new SseParser();
    expect([...p.push(enc.encode('data: tail')), ...p.end()].map((e) => e.data)).toEqual(['tail']);
  });
});

describe('config validation, manual fallback, import/export', () => {
  const good = { id: 'my-ep', name: 'X', protocol: 'openai-chat', baseUrl: 'https://h/v1' };
  it('accepts good, rejects bad', () => {
    expect(validateEndpoint(good).endpoint?.id).toBe('my-ep');
    expect(validateEndpoint({ ...good, id: 'Bad Id' }).errors.length).toBeGreaterThan(0);
    expect(validateEndpoint({ ...good, protocol: 'nope' }).errors.length).toBeGreaterThan(0);
    expect(validateEndpoint({ ...good, headers: { Authorization: 'x' } }).errors.join()).toMatch(/credential/);
    expect(validateEndpoint({ ...good, protocol: 'azure-openai-legacy' }).errors.join()).toMatch(/apiVersion/);
    expect(validateEndpoint({ ...good, models: [{ id: 'a' }, { id: 'a' }] }).errors.join()).toMatch(/Duplicate/);
  });
  it('drops unknown keys (e.g. smuggled apiKey)', () => {
    const v = validateEndpoint({ ...good, apiKey: 'sk-secret', extra: 1 });
    expect(JSON.stringify(v.endpoint)).not.toContain('sk-secret');
  });
  it('duplicate ids and invalid entries are reported, valid kept', () => {
    const r = validateEndpoints([good, good, { id: 'x' }]);
    expect(r.endpoints).toHaveLength(1);
    expect(r.problems.length).toBeGreaterThanOrEqual(2);
    expect(r.problems.some((p) => /duplicate/.test(p))).toBe(true);
  });
  it('manual models override discovered; discovered get conservative defaults', () => {
    const e = ep({ baseUrl: 'https://h', models: [{ id: 'm1', name: 'Mine', maxInputTokens: 1000, toolCalling: true }] });
    const r = resolveModels(e, [{ id: 'm1' }, { id: 'm2' }]);
    expect(r.find((m) => m.id === 'm1')).toMatchObject({ name: 'Mine', maxInputTokens: 1000, toolCalling: true, source: 'manual' });
    expect(r.find((m) => m.id === 'm2')).toMatchObject({ toolCalling: false, vision: false, source: 'discovered' });
    expect(resolveModels(ep({ baseUrl: 'https://h', assumeToolCalling: true }), [{ id: 'z' }])[0]!.toolCalling).toBe(true);
  });
  it('manual fallback works with zero discovery', () => {
    expect(resolveModels(ep({ baseUrl: 'https://h', models: [{ id: 'only' }] }), [])).toHaveLength(1);
  });
  it('export is secret-free and round-trips; import rejects foreign files', () => {
    const e = { ...good, models: [{ id: 'm' }], apiKey: 'sk-leak-leak-leak' } as any;
    const out = exportConfig([e]);
    expect(out).not.toContain('sk-leak');
    expect(parseImport(out).endpoints[0]!.id).toBe('my-ep');
    expect(() => parseImport('{"x":1}')).toThrow(/Not an LLM Bridge export/);
    expect(() => parseImport('nope')).toThrow(/not valid JSON/);
  });
  it('import cannot smuggle credential headers', () => {
    const file = JSON.stringify({ schema: 'iitdeveloper.llm-bridge/config', version: 1, endpoints: [{ ...good, headers: { 'api-key': 'x' } }] });
    const r = parseImport(file);
    expect(r.endpoints).toHaveLength(0);
    expect(r.problems.join()).toMatch(/credential/);
  });
  it('detects destination change on import', () => {
    const a = validateEndpoint(good).endpoint!;
    expect(originChanged(a, { ...a, baseUrl: 'https://evil.example/v1' })).toBe(true);
    expect(originChanged(a, { ...a, baseUrl: 'https://h/v2' })).toBe(false);
    expect(originChanged(undefined, a)).toBe(false);
  });
});

describe('tool-calling override (Agent mode needs toolCalling=true)', () => {
  it('discovered models default to no tool calling; override turns it on and is idempotent', () => {
    const base = ep({ baseUrl: 'https://h' });
    expect(resolveModels(base, [{ id: 'm' }])[0]!.toolCalling).toBe(false);
    const on = withModelOverride(base, 'm', { toolCalling: true });
    expect(resolveModels(on, [{ id: 'm' }])[0]).toMatchObject({ toolCalling: true, id: 'm' });
    const off = withModelOverride(on, 'm', { toolCalling: false });
    expect(off.models).toHaveLength(1);
    expect(resolveModels(off, [{ id: 'm' }])[0]!.toolCalling).toBe(false);
    expect(base.models).toBeUndefined(); // input not mutated
  });
  it('preserves other manual fields', () => {
    const e = ep({ baseUrl: 'https://h', models: [{ id: 'm', name: 'Mine', maxInputTokens: 1234 }] });
    expect(withModelOverride(e, 'm', { toolCalling: true }).models![0]).toEqual({ id: 'm', name: 'Mine', maxInputTokens: 1234, toolCalling: true });
  });
});

describe('token estimate', () => {
  it('~4 chars per token', () => { expect(estimateTextTokens('abcdefgh')).toBe(2); expect(estimateTextTokens('')).toBe(0); });
});
