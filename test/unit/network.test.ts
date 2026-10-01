import { afterEach, describe, expect, it } from 'vitest';
import { streamChat } from '../../src/core/chat';
import { discoverModels, testConnection, testInference } from '../../src/core/discovery';
import { BridgeError } from '../../src/core/errors';
import type { ChatMessage, Credential, EndpointConfig, StreamEvent } from '../../src/core/types';
import { collect, ep, noSleep, sseData, sseHeaders, startServer, type TestServer } from './helpers';

const servers: TestServer[] = [];
const start = async (h: Parameters<typeof startServer>[0]) => { const s = await startServer(h); servers.push(s); return s; };
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => s.close())); });

const user = (text: string): ChatMessage => ({ role: 'user', parts: [{ type: 'text', text }] });
const run = (e: EndpointConfig, over: Partial<Parameters<typeof streamChat>[0]> = {}) =>
  streamChat({ endpoint: e, model: { id: 'm', streaming: true }, request: { messages: [user('hi')] }, deps: { sleep: noSleep }, ...over });
const cred = (s: TestServer, secret = 'sk-test-secret-1234'): Credential => ({ secret, origin: s.origin });
const text = (evs: StreamEvent[]) => evs.filter((e) => e.type === 'text').map((e: any) => e.text).join('');

describe('OpenAI chat completions', () => {
  it('streams text, sends bearer auth and correct body', async () => {
    const s = await start((req, res) => {
      res.writeHead(200, sseHeaders);
      res.write(sseData({ choices: [{ delta: { content: 'Hel' } }] }));
      res.write(sseData({ choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] }));
      res.end(sseData('[DONE]'));
    });
    const evs = await collect(run(ep({ baseUrl: `${s.origin}/v1` }), { credential: cred(s) }));
    expect(text(evs)).toBe('Hello');
    const r = s.requests[0]!;
    expect(r.url).toBe('/v1/chat/completions');
    expect(r.headers.authorization).toBe('Bearer sk-test-secret-1234');
    expect(JSON.parse(r.body)).toMatchObject({ model: 'm', stream: true, messages: [{ role: 'user', content: 'hi' }] });
  });

  it('handles non-streaming responses', async () => {
    const s = await start((_r, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'plain' } }] })); });
    const evs = await collect(run(ep({ baseUrl: s.origin, auth: 'none' }), { model: { id: 'm', streaming: false } }));
    expect(text(evs)).toBe('plain');
    expect(JSON.parse(s.requests[0]!.body).stream).toBe(false);
  });

  it('falls back to JSON parsing if a server ignores stream=true', async () => {
    const s = await start((_r, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })); });
    expect(text(await collect(run(ep({ baseUrl: s.origin, auth: 'none' }))))).toBe('ok');
  });

  it('handles SSE chunks split at arbitrary byte boundaries with multi-byte UTF-8', async () => {
    const payload = sseData({ choices: [{ delta: { content: 'héllo ✓ 日本 😀' } }] }) + sseData({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + sseData('[DONE]');
    const bytes = Buffer.from(payload);
    const s = await start(async (_r, res) => {
      res.writeHead(200, sseHeaders);
      for (let i = 0; i < bytes.length; i += 3) { res.write(bytes.subarray(i, i + 3)); await new Promise((r) => setTimeout(r, 1)); }
      res.end();
    });
    expect(text(await collect(run(ep({ baseUrl: s.origin, auth: 'none' }))))).toBe('héllo ✓ 日本 😀');
  });

  it('tool-call round trip: assembles streamed args, then sends results back', async () => {
    const s = await start((req, res, n) => {
      res.writeHead(200, sseHeaders);
      if (n === 1) {
        res.write(sseData({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '' } }] } }] }));
        res.write(sseData({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":"Pa' } }] } }] }));
        res.write(sseData({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ris"}' } }] } }] }));
        res.write(sseData({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_2', function: { name: 'b', arguments: '{}' } }] } }] }));
        res.write(sseData({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
      } else {
        res.write(sseData({ choices: [{ delta: { content: 'Sunny' }, finish_reason: 'stop' }] }));
      }
      res.end(sseData('[DONE]'));
    });
    const e = ep({ baseUrl: s.origin, auth: 'none' });
    const tools = [{ name: 'get_weather', description: 'w', parameters: { type: 'object', properties: { city: { type: 'string' } } } }];
    const first = await collect(run(e, { request: { messages: [user('weather?')], tools, toolChoice: 'required' } }));
    const calls = first.filter((x) => x.type === 'toolCall').map((x: any) => x.call);
    expect(calls).toEqual([{ id: 'call_1', name: 'get_weather', args: { city: 'Paris' } }, { id: 'call_2', name: 'b', args: {} }]);
    const body1 = JSON.parse(s.requests[0]!.body);
    expect(body1.tools[0]).toEqual({ type: 'function', function: { name: 'get_weather', description: 'w', parameters: tools[0]!.parameters } });
    expect(body1.tool_choice).toBe('required');

    const history: ChatMessage[] = [
      user('weather?'),
      { role: 'assistant', parts: [], toolCalls: [calls[0]] },
      { role: 'tool', toolCallId: 'call_1', parts: [{ type: 'text', text: '22C sunny' }] },
    ];
    const second = await collect(run(e, { request: { messages: history, tools } }));
    expect(text(second)).toBe('Sunny');
    const msgs = JSON.parse(s.requests[1]!.body).messages;
    expect(msgs[1]).toEqual({ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }] });
    expect(msgs[2]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '22C sunny' });
  });

  it('non-streaming tool calls', async () => {
    const s = await start((_r, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'c', function: { name: 'f', arguments: '{"a":1}' } }] } }] })); });
    const evs = await collect(run(ep({ baseUrl: s.origin, auth: 'none' }), { model: { id: 'm', streaming: false } }));
    expect(evs).toEqual([{ type: 'toolCall', call: { id: 'c', name: 'f', args: { a: 1 } } }]);
  });

  it('invalid tool-call JSON is a protocol error', async () => {
    const s = await start((_r, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'f', arguments: '{bad' } }] } }] })); });
    await expect(collect(run(ep({ baseUrl: s.origin, auth: 'none' }), { model: { id: 'm', streaming: false } }))).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('in-stream errors surface', async () => {
    const s = await start((_r, res) => { res.writeHead(200, sseHeaders); res.end(sseData({ error: { message: 'context too long' } })); });
    await expect(collect(run(ep({ baseUrl: s.origin, auth: 'none' })))).rejects.toThrow(/context too long/);
  });

  it('sends images as data URLs', async () => {
    const s = await start((_r, res) => { res.writeHead(200, sseHeaders); res.end(sseData('[DONE]')); });
    await collect(run(ep({ baseUrl: s.origin, auth: 'none' }), { request: { messages: [{ role: 'user', parts: [{ type: 'text', text: 'see' }, { type: 'image', mime: 'image/png', base64: 'AAAA' }] }] } }));
    expect(JSON.parse(s.requests[0]!.body).messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
  });
});

describe('OpenAI Responses API', () => {
  it('streams text and function calls; maps history', async () => {
    const s = await start((_r, res, n) => {
      res.writeHead(200, sseHeaders);
      if (n === 1) {
        res.write(`event: response.output_text.delta\n${sseData({ type: 'response.output_text.delta', delta: 'Hi ' })}`);
        res.write(sseData({ type: 'response.output_text.delta', delta: 'there' }));
        res.write(sseData({ type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_1', call_id: 'call_9', name: 'f' } }));
        res.write(sseData({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"x"' }));
        res.write(sseData({ type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_1', call_id: 'call_9', name: 'f', arguments: '{"x":1}' } }));
        res.write(sseData({ type: 'response.completed', response: {} }));
      } else res.write(sseData({ type: 'response.output_text.delta', delta: 'done' }));
      res.end();
    });
    const e = ep({ protocol: 'openai-responses', baseUrl: `${s.origin}/v1`, auth: 'none' });
    const evs = await collect(run(e, { request: { messages: [{ role: 'system', parts: [{ type: 'text', text: 'be brief' }] }, user('go')], tools: [{ name: 'f', description: 'd', parameters: { type: 'object' } }] } }));
    expect(text(evs)).toBe('Hi there');
    expect(evs.find((x) => x.type === 'toolCall')).toEqual({ type: 'toolCall', call: { id: 'call_9', name: 'f', args: { x: 1 } } });
    const b1 = JSON.parse(s.requests[0]!.body);
    expect(s.requests[0]!.url).toBe('/v1/responses');
    expect(b1).toMatchObject({ model: 'm', stream: true, store: false, instructions: 'be brief', input: [{ role: 'user', content: [{ type: 'input_text', text: 'go' }] }], tools: [{ type: 'function', name: 'f' }] });

    const second = await collect(run(e, { request: { messages: [user('go'), { role: 'assistant', parts: [], toolCalls: [{ id: 'call_9', name: 'f', args: { x: 1 } }] }, { role: 'tool', toolCallId: 'call_9', parts: [{ type: 'text', text: 'res' }] }] } }));
    expect(text(second)).toBe('done');
    const input = JSON.parse(s.requests[1]!.body).input;
    expect(input[1]).toEqual({ type: 'function_call', call_id: 'call_9', name: 'f', arguments: '{"x":1}' });
    expect(input[2]).toEqual({ type: 'function_call_output', call_id: 'call_9', output: 'res' });
  });

  it('non-streaming output parsing; failed responses error', async () => {
    const s = await start((_r, res, n) => {
      res.writeHead(200, n === 1 ? { 'content-type': 'application/json' } : sseHeaders);
      if (n === 1) res.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }, { type: 'function_call', call_id: 'c', name: 'f', arguments: '{}' }] }));
      else res.end(sseData({ type: 'response.failed', response: { error: { message: 'boom' } } }));
    });
    const e = ep({ protocol: 'openai-responses', baseUrl: s.origin, auth: 'none' });
    expect(await collect(run(e, { model: { id: 'm', streaming: false } }))).toEqual([{ type: 'text', text: 'ok' }, { type: 'toolCall', call: { id: 'c', name: 'f', args: {} } }]);
    await expect(collect(run(e))).rejects.toThrow(/boom/);
  });
});

describe('Azure and Ollama', () => {
  it('azure legacy: deployment URL, api-key header, no model in body', async () => {
    const s = await start((_r, res) => { res.writeHead(200, sseHeaders); res.end(sseData({ choices: [{ delta: { content: 'a' } }] })); });
    const e = ep({ protocol: 'azure-openai-legacy', baseUrl: s.origin, apiVersion: '2024-10-21' });
    await collect(run(e, { model: { id: 'gpt4-prod', streaming: true }, credential: cred(s, 'azure-key-123456') }));
    const r = s.requests[0]!;
    expect(r.url).toBe('/openai/deployments/gpt4-prod/chat/completions?api-version=2024-10-21');
    expect(r.headers['api-key']).toBe('azure-key-123456');
    expect(r.headers.authorization).toBeUndefined();
    expect(JSON.parse(r.body).model).toBeUndefined();
  });
  it('azure v1 responses uses api-key; bearer (Entra) supported via auth override', async () => {
    const s = await start((_r, res) => { res.writeHead(200, sseHeaders); res.end(sseData({ type: 'response.output_text.delta', delta: 'a' })); });
    await collect(run(ep({ protocol: 'azure-openai-v1', baseUrl: `${s.origin}/openai/v1` }), { credential: cred(s, 'k-123456') }));
    expect(s.requests[0]!.url).toBe('/openai/v1/responses');
    expect(s.requests[0]!.headers['api-key']).toBe('k-123456');
    await collect(run(ep({ protocol: 'azure-openai-v1', azureV1Api: 'chat', auth: 'bearer', baseUrl: `${s.origin}/openai/v1` }), { credential: cred(s, 'entra-token') }));
    expect(s.requests[1]!.url).toBe('/openai/v1/chat/completions');
    expect(s.requests[1]!.headers.authorization).toBe('Bearer entra-token');
  });
  it('ollama: no auth header by default; tool calls without index/streamed whole', async () => {
    const s = await start((_r, res) => {
      res.writeHead(200, sseHeaders);
      res.write(sseData({ choices: [{ delta: { tool_calls: [{ id: 'call_a', function: { name: 'f', arguments: '{"q":1}' } }] } }] }));
      res.write(sseData({ choices: [{ delta: { tool_calls: [{ id: 'call_b', function: { name: 'g', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }));
      res.end();
    });
    const evs = await collect(run(ep({ protocol: 'ollama', baseUrl: `${s.origin}/v1` })));
    expect(s.requests[0]!.headers.authorization).toBeUndefined();
    expect(evs.map((e: any) => e.call)).toEqual([{ id: 'call_a', name: 'f', args: { q: 1 } }, { id: 'call_b', name: 'g', args: {} }]);
  });
});

describe('model discovery & connection tests', () => {
  it('discovers models (OpenAI + Ollama shapes), dedupes', async () => {
    const s = await start((_r, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ object: 'list', data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] })); });
    const e = ep({ baseUrl: `${s.origin}/v1` });
    expect(await discoverModels(e, cred(s))).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(s.requests[0]!.url).toBe('/v1/models');
    expect((await testConnection(e, cred(s))).message).toMatch(/2 model/);
  });
  it('bad shape → protocol error; azure legacy → manual-only message', async () => {
    const s = await start((_r, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"nope":1}'); });
    await expect(discoverModels(ep({ baseUrl: s.origin, auth: 'none' }), undefined)).rejects.toMatchObject({ kind: 'protocol' });
    const legacy = ep({ protocol: 'azure-openai-legacy', baseUrl: s.origin, apiVersion: 'v' });
    await expect(discoverModels(legacy, undefined)).rejects.toThrow(/Add Model Manually/);
    expect((await testConnection(legacy, undefined)).ok).toBe(true);
  });
  it('testConnection reports auth failure actionably', async () => {
    const s = await start((_r, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Invalid key' } })); });
    const r = await testConnection(ep({ baseUrl: s.origin }), cred(s));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Authentication failed.*Set API Key.*Invalid key/);
  });
  it('testInference succeeds without exposing content; fails on empty', async () => {
    const s = await start((_r, res, n) => { res.writeHead(200, sseHeaders); res.end(n === 1 ? sseData({ choices: [{ delta: { content: 'ok' } }] }) : sseData({ choices: [{ delta: {} }] })); });
    const e = ep({ baseUrl: s.origin, auth: 'none' });
    const ok = await testInference(e, 'm', true, undefined);
    expect(ok.ok).toBe(true);
    expect(ok.message).not.toContain('"ok"');
    expect((await testInference(e, 'm', true, undefined)).ok).toBe(false);
  });
});

describe('errors, retries, timeouts, cancellation', () => {
  it('maps HTTP statuses to actionable errors and redacts echoed secrets', async () => {
    const s = await start((_r, res) => { res.writeHead(404); res.end('no such model; key was sk-test-secret-1234'); });
    const err = await collect(run(ep({ baseUrl: s.origin }), { credential: cred(s) })).catch((e) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect(err.kind).toBe('not-found');
    expect(err.message).not.toContain('sk-test-secret-1234');
  });
  it('retries 429/5xx with Retry-After, then succeeds', async () => {
    const delays: number[] = [];
    const s = await start((_r, res, n) => {
      if (n === 1) { res.writeHead(429, { 'retry-after': '2' }); res.end('slow down'); }
      else if (n === 2) { res.writeHead(503); res.end('busy'); }
      else { res.writeHead(200, sseHeaders); res.end(sseData({ choices: [{ delta: { content: 'ok' } }] })); }
    });
    const evs = await collect(run(ep({ baseUrl: s.origin, auth: 'none', maxRetries: 2 }), { deps: { sleep: async (ms) => { delays.push(ms); } } }));
    expect(text(evs)).toBe('ok');
    expect(s.requests).toHaveLength(3);
    expect(delays[0]).toBe(2000);
    expect(delays[1]).toBeGreaterThanOrEqual(1000);
  });
  it('gives up after maxRetries', async () => {
    const s = await start((_r, res) => { res.writeHead(500); res.end('x'); });
    await expect(collect(run(ep({ baseUrl: s.origin, auth: 'none', maxRetries: 2 })))).rejects.toMatchObject({ kind: 'server' });
    expect(s.requests).toHaveLength(3);
  });
  it('does not retry 400/401', async () => {
    const s = await start((_r, res) => { res.writeHead(400); res.end('bad'); });
    await expect(collect(run(ep({ baseUrl: s.origin, auth: 'none', maxRetries: 3 })))).rejects.toMatchObject({ kind: 'bad-request' });
    expect(s.requests).toHaveLength(1);
  });
  it('retries connection failures', async () => {
    const s = await start(() => {});
    const dead = ep({ baseUrl: s.origin.replace(String(s.port), '1'), auth: 'none', maxRetries: 1 });
    let slept = 0;
    await expect(collect(run(dead, { deps: { sleep: async () => { slept++; } } }))).rejects.toMatchObject({ kind: 'network' });
    expect(slept).toBe(1);
  });
  it('times out when the server never responds', async () => {
    const s = await start(() => {});
    await expect(collect(run(ep({ baseUrl: s.origin, auth: 'none', timeoutMs: 1000 })))).rejects.toMatchObject({ kind: 'timeout' });
  }, 10000);
  it('idle-times-out a stalled stream', async () => {
    const s = await start((_r, res) => { res.writeHead(200, sseHeaders); res.write(sseData({ choices: [{ delta: { content: 'a' } }] })); });
    const got: StreamEvent[] = [];
    const err = await (async () => { try { for await (const e of run(ep({ baseUrl: s.origin, auth: 'none', timeoutMs: 1000 }))) got.push(e); } catch (e) { return e; } })();
    expect(got).toHaveLength(1);
    expect(err).toMatchObject({ kind: 'timeout' });
  }, 10000);
  it('cancels in flight (before response and mid-stream)', async () => {
    const hang = await start(() => {});
    const ac = new AbortController();
    const p = collect(run(ep({ baseUrl: hang.origin, auth: 'none', timeoutMs: 30000 }), { signal: ac.signal }));
    setTimeout(() => ac.abort(), 50);
    await expect(p).rejects.toMatchObject({ kind: 'cancelled' });

    const s = await start((_r, res) => { res.writeHead(200, sseHeaders); res.write(sseData({ choices: [{ delta: { content: 'a' } }] })); });
    const ac2 = new AbortController();
    const err = await (async () => { try { for await (const _e of run(ep({ baseUrl: s.origin, auth: 'none', timeoutMs: 30000 }), { signal: ac2.signal })) ac2.abort(); } catch (e) { return e; } })();
    expect(err).toMatchObject({ kind: 'cancelled' });
    const pre = new AbortController(); pre.abort();
    await expect(collect(run(ep({ baseUrl: s.origin, auth: 'none' }), { signal: pre.signal }))).rejects.toMatchObject({ kind: 'cancelled' });
  }, 10000);
});

describe('credential safety over the wire', () => {
  it('refuses to send a key bound to another origin; nothing reaches the server', async () => {
    const s = await start((_r, res) => { res.writeHead(200, sseHeaders); res.end(); });
    const err = await collect(run(ep({ baseUrl: s.origin }), { credential: { secret: 'sk-bound-elsewhere', origin: 'https://api.openai.com' } })).catch((e) => e);
    expect(err).toMatchObject({ kind: 'credential-binding' });
    expect(s.requests).toHaveLength(0);
  });
  it('does not follow cross-origin redirects and never sends credentials there', async () => {
    const target = await start((_r, res) => { res.writeHead(200, sseHeaders); res.end(); });
    const origin = await start((_r, res) => { res.writeHead(307, { location: `${target.origin}/steal` }); res.end(); });
    const err = await collect(run(ep({ baseUrl: origin.origin }), { credential: cred(origin) })).catch((e) => e);
    expect(err).toMatchObject({ kind: 'redirect' });
    expect(target.requests).toHaveLength(0);
    // same for GET discovery
    await expect(discoverModels(ep({ baseUrl: origin.origin }), cred(origin))).rejects.toMatchObject({ kind: 'redirect' });
    expect(target.requests).toHaveLength(0);
  });
  it('follows same-origin 307 for POST (and 302 for GET) re-attaching auth', async () => {
    const s = await start((req, res) => {
      if (req.url === '/chat/completions') { res.writeHead(307, { location: '/moved' }); res.end(); }
      else if (req.url === '/models') { res.writeHead(302, { location: '/m2' }); res.end(); }
      else if (req.url === '/m2') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"z"}]}'); }
      else { res.writeHead(200, sseHeaders); res.end(sseData({ choices: [{ delta: { content: 'ok' } }] })); }
    });
    expect(text(await collect(run(ep({ baseUrl: s.origin }), { credential: cred(s) })))).toBe('ok');
    expect(s.requests.at(-1)!.headers.authorization).toBe('Bearer sk-test-secret-1234');
    expect(await discoverModels(ep({ baseUrl: s.origin }), cred(s))).toEqual([{ id: 'z' }]);
  });
  it('POST 302 is refused rather than silently downgraded', async () => {
    const s = await start((_r, res) => { res.writeHead(302, { location: '/other' }); res.end(); });
    await expect(collect(run(ep({ baseUrl: s.origin, auth: 'none' })))).rejects.toMatchObject({ kind: 'redirect' });
  });
  it('custom headers are sent; error messages never contain the key', async () => {
    const s = await start((req, res) => { res.writeHead(500); res.end(`echo ${req.headers.authorization}`); });
    const err = await collect(run(ep({ baseUrl: s.origin, headers: { 'X-Team': 'ml' } }), { credential: cred(s) })).catch((e) => e);
    expect(s.requests[0]!.headers['x-team']).toBe('ml');
    expect(err.message).not.toContain('sk-test-secret-1234');
  });
});
