import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as vscode from 'vscode';

const EXT_ID = 'iitdeveloper.llm-bridge-ai';
const VENDOR = 'iitdeveloper-llm-bridge';
const cfg = () => vscode.workspace.getConfiguration('iitdeveloperLlmBridge');

describe('LLM Bridge in a real Extension Development Host', function () {
  let server: http.Server;
  let origin: string;
  const seen: Array<{ url: string; body: any; auth?: string }> = [];

  const mockEndpoints = () => [
    { id: 'mock', name: 'Mock', protocol: 'openai-chat', baseUrl: `${origin}/v1`, auth: 'none', maxRetries: 0, timeoutMs: 5000,
      models: [{ id: 'm-tools', name: 'Tools Model', maxInputTokens: 32000, maxOutputTokens: 4000, toolCalling: true }, { id: 'm-plain' }] },
  ];

  before(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        seen.push({ url: req.url!, body, auth: req.headers.authorization });
        if (req.url === '/unauthorized/v1/chat/completions') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"bad key"}}'); }
        if (req.url === '/slow/v1/chat/completions') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"start"}}]}\n\n'); return; }
        if (req.url!.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[{"id":"discovered-1"}]}'); }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (body.tools?.length) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: body.tools[0].function.name, arguments: '{"q":' } }] } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, finish_reason: 'tool_calls' }] })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'world ✓' }, finish_reason: 'stop' }] })}\n\n`);
        }
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await cfg().update('endpoints', undefined, vscode.ConfigurationTarget.Global);
    server.close();
  });

  it('is installed with the unique id and activates', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, 'extension present');
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });

  it('contributes only namespaced providers, commands and settings', () => {
    const pkg = vscode.extensions.getExtension(EXT_ID)!.packageJSON;
    assert.deepStrictEqual(pkg.contributes.languageModelChatProviders.map((p: any) => p.vendor), [VENDOR]);
    for (const c of pkg.contributes.commands) assert.match(c.command, /^iitdeveloperLlmBridge\./);
    for (const k of Object.keys(pkg.contributes.configuration.properties)) assert.match(k, /^iitdeveloperLlmBridge\./);
    assert.ok(!JSON.stringify(pkg).toLowerCase().includes('copilot'), 'no Copilot dependency or reference in the manifest');
    assert.strictEqual(pkg.extensionDependencies, undefined);
  });

  it('contributes the sidebar: activity bar container, endpoints view, welcome, menus', () => {
    const c = vscode.extensions.getExtension(EXT_ID)!.packageJSON.contributes;
    assert.strictEqual(c.viewsContainers.activitybar[0].id, 'iitdeveloperLlmBridge');
    assert.strictEqual(c.views.iitdeveloperLlmBridge[0].id, 'iitdeveloperLlmBridge.endpoints');
    assert.ok(c.viewsWelcome[0].contents.includes('command:iitdeveloperLlmBridge.addEndpoint'));
    const menuCmds = [...c.menus['view/title'], ...c.menus['view/item/context']].map((m: any) => m.command);
    const declared = c.commands.map((x: any) => x.command);
    for (const m of menuCmds) assert.ok(declared.includes(m), `menu command ${m} is declared`);
    assert.ok(fs.existsSync(vscode.Uri.joinPath(vscode.extensions.getExtension(EXT_ID)!.extensionUri, 'media', 'activitybar.svg').fsPath), 'activity bar icon file exists');
  });

  it('registers all commands', async () => {
    const all = await vscode.commands.getCommands(true);
    const pkg = vscode.extensions.getExtension(EXT_ID)!.packageJSON;
    for (const c of pkg.contributes.commands) assert.ok(all.includes(c.command), `${c.command} registered`);
  });

  it('ignores workspace-defined endpoints (hostile .vscode/settings.json)', async () => {
    const models = await vscode.lm.selectChatModels({ vendor: VENDOR });
    assert.ok(!models.some((m) => m.id.includes('evil')), 'workspace endpoint must not be exposed');
  });

  it('exposes manual models via the native vscode.lm API with stable ids and capabilities', async () => {
    await cfg().update('endpoints', mockEndpoints(), vscode.ConfigurationTarget.Global);
    const models = await waitFor(async () => { const m = await vscode.lm.selectChatModels({ vendor: VENDOR }); return m.length === 2 ? m : undefined; });
    const tools = models.find((m) => m.id === 'mock::m-tools')!;
    assert.ok(tools, `ids: ${models.map((m) => m.id)}`);
    assert.strictEqual(tools.name, 'Tools Model');
    assert.strictEqual(tools.maxInputTokens, 32000);
    assert.strictEqual(tools.vendor, VENDOR);
  });

  it('opens the sidebar view and its commands accept tree-item arguments', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.iitdeveloperLlmBridge');
    await vscode.commands.executeCommand('iitdeveloperLlmBridge.refresh');
    const before = seen.length;
    // Same shape a tree node passes: no QuickPick should be needed (a pick would hang this test).
    await vscode.commands.executeCommand('iitdeveloperLlmBridge.testConnection', { kind: 'endpoint', endpointId: 'mock' });
    await waitFor(async () => (seen.length > before ? true : undefined));
    assert.strictEqual(seen.at(-1)!.url, '/v1/models');
    await vscode.commands.executeCommand('iitdeveloperLlmBridge.testInference', { kind: 'model', endpointId: 'mock', modelId: 'm-plain' });
    await waitFor(async () => (seen.at(-1)!.url === '/v1/chat/completions' && seen.at(-1)!.body.model === 'm-plain' ? true : undefined));
  });

  it('Toggle Tool Calling (sidebar action) changes what VS Code sees for a discovered model', async () => {
    await cfg().update('endpoints', [{ id: 'tg', name: 'Tg', protocol: 'openai-chat', baseUrl: `${origin}/v1`, auth: 'none', models: [] }], vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('iitdeveloperLlmBridge.discoverModels', { kind: 'endpoint', endpointId: 'tg' });
    const tools = async () => { const [m] = await vscode.lm.selectChatModels({ vendor: VENDOR, id: 'tg::discovered-1' }); return m ? (m as any).capabilities?.supportsToolCalling : undefined; };
    await waitFor(async () => ((await tools()) === false ? true : undefined));
    await vscode.commands.executeCommand('iitdeveloperLlmBridge.toggleToolCalling', { kind: 'model', endpointId: 'tg', modelId: 'discovered-1' });
    await waitFor(async () => ((await tools()) ? true : undefined));
    await vscode.commands.executeCommand('iitdeveloperLlmBridge.toggleToolCalling', { kind: 'model', endpointId: 'tg', modelId: 'discovered-1' });
    await waitFor(async () => ((await tools()) === false ? true : undefined));
    // restore the shared fixture for the tests that follow
    await cfg().update('endpoints', mockEndpoints(), vscode.ConfigurationTarget.Global);
    await waitFor(async () => ((await vscode.lm.selectChatModels({ vendor: VENDOR, id: 'mock::m-plain' })).length ? true : undefined));
  });

  it('streams a chat response end-to-end through the native API', async () => {
    const [m] = await vscode.lm.selectChatModels({ vendor: VENDOR, id: 'mock::m-plain' });
    const res = await m!.sendRequest([vscode.LanguageModelChatMessage.User('hi')], {}, new vscode.CancellationTokenSource().token);
    let out = '';
    for await (const chunk of res.text) out += chunk;
    assert.strictEqual(out, 'Hello world ✓');
    assert.strictEqual(seen.at(-1)!.body.model, 'm-plain');
    assert.strictEqual(seen.at(-1)!.body.stream, true);
  });

  it('returns tool calls via LanguageModelToolCallPart and accepts tool results (VS Code owns execution)', async () => {
    const [m] = await vscode.lm.selectChatModels({ vendor: VENDOR, id: 'mock::m-tools' });
    const tool: vscode.LanguageModelChatTool = { name: 'lookup', description: 'look up', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } };
    const res = await m!.sendRequest([vscode.LanguageModelChatMessage.User('find x')], { tools: [tool] });
    const calls: vscode.LanguageModelToolCallPart[] = [];
    for await (const p of res.stream) if (p instanceof vscode.LanguageModelToolCallPart) calls.push(p);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual({ id: calls[0]!.callId, name: calls[0]!.name, input: calls[0]!.input }, { id: 'call_1', name: 'lookup', input: { q: 'x' } });

    const followUp = await m!.sendRequest([
      vscode.LanguageModelChatMessage.User('find x'),
      vscode.LanguageModelChatMessage.Assistant([new vscode.LanguageModelToolCallPart('call_1', 'lookup', { q: 'x' })]),
      vscode.LanguageModelChatMessage.User([new vscode.LanguageModelToolResultPart('call_1', [new vscode.LanguageModelTextPart('found')])]),
    ], { tools: [tool] });
    for await (const _ of followUp.stream) { /* drain */ }
    const msgs = seen.at(-1)!.body.messages;
    assert.deepStrictEqual(msgs.at(-1), { role: 'tool', tool_call_id: 'call_1', content: 'found' });
    assert.strictEqual(msgs.at(-2).tool_calls[0].function.arguments, '{"q":"x"}');
  });

  it('rejects tools for a model not configured for tool calling', async () => {
    const [m] = await vscode.lm.selectChatModels({ vendor: VENDOR, id: 'mock::m-plain' });
    const tool: vscode.LanguageModelChatTool = { name: 'lookup', description: 'd', inputSchema: {} };
    await assert.rejects(async () => { const r = await m!.sendRequest([vscode.LanguageModelChatMessage.User('x')], { tools: [tool] }); for await (const _ of r.stream) { /* */ } }, /tool calling/i);
  });

  it('counts tokens', async () => {
    const [m] = await vscode.lm.selectChatModels({ vendor: VENDOR, id: 'mock::m-plain' });
    assert.strictEqual(await m!.countTokens('abcdefgh'), 2);
  });

  it('surfaces actionable HTTP errors', async () => {
    await cfg().update('endpoints', [{ id: 'bad', name: 'Bad', protocol: 'openai-chat', baseUrl: `${origin}/unauthorized/v1`, auth: 'none', maxRetries: 0, models: [{ id: 'x' }] }], vscode.ConfigurationTarget.Global);
    const [m] = await waitFor(async () => { const r = await vscode.lm.selectChatModels({ vendor: VENDOR, id: 'bad::x' }); return r.length ? r : undefined; });
    await assert.rejects(async () => { const r = await m!.sendRequest([vscode.LanguageModelChatMessage.User('x')]); for await (const _ of r.stream) { /* */ } }, /Authentication failed.*bad key/s);
  });

  it('cancels an in-flight stream', async function () {
    // Observed: 1.104, 1.107 and 1.120 do not propagate a caller's cancellation to the provider's token (the provider
    // never sees it, so the stream stays open); 1.130 and 1.140 do. Strict from 1.130; older hosts skip instead of failing.
    const [maj, min] = vscode.version.split('.').map(Number);
    const propagates = (maj ?? 0) > 1 || ((maj ?? 0) === 1 && (min ?? 0) >= 130);
    if (!propagates) this.timeout(12000);
    await cfg().update('endpoints', [{ id: 'slow', name: 'Slow', protocol: 'openai-chat', baseUrl: `${origin}/slow/v1`, auth: 'none', maxRetries: 0, timeoutMs: 60000, models: [{ id: 'x' }] }], vscode.ConfigurationTarget.Global);
    const [m] = await waitFor(async () => { const r = await vscode.lm.selectChatModels({ vendor: VENDOR, id: 'slow::x' }); return r.length ? r : undefined; });
    const cts = new vscode.CancellationTokenSource();
    const res = await m!.sendRequest([vscode.LanguageModelChatMessage.User('x')], {}, cts.token);
    const started = Date.now();
    const drained = (async () => { try { for await (const _ of res.text) cts.cancel(); } catch { /* cancellation expected */ } return true; })();
    const finished = await Promise.race([drained, new Promise<boolean>((r) => setTimeout(() => r(false), propagates ? 10000 : 6000))]);
    if (!finished && !propagates) return this.skip(); // host limitation on older VS Code, see comment above
    assert.ok(finished && Date.now() - started < 10000, 'stream ended promptly after cancel');
  });

  it('coexists with the real GitHub Copilot Chat extension when it is present', async function () {
    const copilot = vscode.extensions.getExtension('GitHub.copilot-chat');
    console.log(`[coexistence] extensions seen: ${vscode.extensions.all.filter((e) => !e.id.startsWith('vscode.')).map((e) => e.id).join(', ')}`);
    if (process.env.LLMB_REQUIRE_COPILOT === '1') assert.ok(copilot, 'Copilot Chat must be present when LLMB_REQUIRE_COPILOT=1');
    console.log(`[coexistence] Copilot Chat present=${!!copilot} version=${copilot?.packageJSON?.version}`);
    if (!copilot) return this.skip(); // reported as pending, never as a pass
    await copilot.activate().then(undefined, (e) => console.log(`[coexistence] Copilot activation (unauthenticated sandbox): ${e}`));
    await cfg().update('endpoints', [{ id: 'co', name: 'Co', protocol: 'openai-chat', baseUrl: `${origin}/v1`, auth: 'none', models: [{ id: 'x' }] }], vscode.ConfigurationTarget.Global);
    const ours = await waitFor(async () => { const r = await vscode.lm.selectChatModels({ vendor: VENDOR }); return r.length ? r : undefined; });
    assert.ok(ours.every((m) => m.vendor === VENDOR));
    assert.ok(copilot.packageJSON.contributes.languageModelChatProviders?.some((p: any) => p.vendor === 'copilot') ?? true);
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(!cmds.some((c) => c.startsWith('iitdeveloperLlmBridge.') && c.includes('copilot')), 'we register no copilot-named commands');
  });

  it('left Copilot and unrelated settings untouched; only wrote its own namespace', async () => {
    await cfg().update('endpoints', undefined, vscode.ConfigurationTarget.Global);
    await new Promise((r) => setTimeout(r, 500));
    const sentinel = JSON.parse(process.env.LLMB_SENTINEL!);
    const after = JSON.parse(fs.readFileSync(process.env.LLMB_SETTINGS_PATH!, 'utf8'));
    for (const [k, v] of Object.entries(sentinel)) assert.deepStrictEqual(after[k], v, `${k} unchanged`);
    for (const k of Object.keys(after)) if (!(k in sentinel)) assert.match(k, /^iitdeveloperLlmBridge\./, `unexpected new setting ${k}`);
  });
});

async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 200));
  }
}
