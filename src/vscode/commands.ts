import * as vscode from 'vscode';
import { getAdapter } from '../core/adapters';
import { validateEndpoint } from '../core/config';
import { discoverModels, testConnection, testInference } from '../core/discovery';
import { BridgeError } from '../core/errors';
import { resolveModels, withModelOverride } from '../core/models';
import { exportConfig, originChanged, parseImport } from '../core/portable';
import { PROTOCOLS, type EndpointConfig, type Logger, type ModelConfig, type Protocol } from '../core/types';
import { parseBaseUrl } from '../core/url';
import { CMD } from './ids';
import type { BridgeProvider } from './provider';
import type { CredentialStore } from './secrets';
import type { EndpointStore } from './store';

const PROTOCOL_INFO: Record<Protocol, { label: string; url: string; detail: string }> = {
  'openai-chat': { label: 'OpenAI-compatible Chat Completions', url: 'https://api.openai.com/v1', detail: '/chat/completions + /models (OpenAI, vLLM, LiteLLM, OpenRouter, ...)' },
  'openai-responses': { label: 'OpenAI Responses API', url: 'https://api.openai.com/v1', detail: '/responses + /models' },
  'azure-openai-v1': { label: 'Azure OpenAI v1', url: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1', detail: '/openai/v1/responses (or chat/completions), api-key or Entra token' },
  'azure-openai-legacy': { label: 'Azure OpenAI (legacy deployments)', url: 'https://YOUR-RESOURCE.openai.azure.com', detail: '/openai/deployments/{name}/chat/completions?api-version=... (manual models only)' },
  ollama: { label: "Ollama (OpenAI-compatible)", url: 'http://localhost:11434/v1', detail: 'Local Ollama /v1 API, no key by default' },
};

export function registerCommands(ctx: vscode.ExtensionContext, store: EndpointStore, creds: CredentialStore, provider: BridgeProvider, log: Logger & { show(): void }): void {
  const reg = (name: string, fn: (...a: any[]) => unknown) =>
    ctx.subscriptions.push(vscode.commands.registerCommand(CMD(name), async (...a: unknown[]) => {
      try { await fn(...a); } catch (e) {
        if (e instanceof vscode.CancellationError) return;
        log.error(`${name}: ${(e as Error).message}`);
        void vscode.window.showErrorMessage(`LLM Bridge: ${(e as Error).message}`);
      }
    }));

  /** Tree items pass `{ endpointId }` as the first argument; the Command Palette passes nothing. */
  const fromArg = (arg: unknown): { endpointId?: string; modelId?: string } =>
    arg && typeof arg === 'object' ? (arg as { endpointId?: string; modelId?: string }) : {};

  const pickEndpoint = async (placeHolder: string, arg?: unknown): Promise<EndpointConfig | undefined> => {
    const { endpoints } = store.read();
    const wanted = fromArg(arg).endpointId;
    if (typeof wanted === 'string') {
      const hit = endpoints.find((e) => e.id === wanted);
      if (hit) return hit;
    }
    if (!endpoints.length) {
      const pick = await vscode.window.showInformationMessage('No LLM Bridge endpoints configured yet.', 'Add Endpoint');
      if (pick) await vscode.commands.executeCommand(CMD('addEndpoint'));
      return undefined;
    }
    const sel = await vscode.window.showQuickPick(endpoints.map((e) => ({ label: e.name, description: e.protocol, detail: e.baseUrl, ep: e })), { placeHolder });
    return sel?.ep;
  };

  const promptKey = async (ep: EndpointConfig, title: string): Promise<boolean> => {
    const key = await vscode.window.showInputBox({ title, prompt: `API key for ${ep.name} (stored in VS Code SecretStorage, sent only to ${new URL(ep.baseUrl).origin})`, password: true, ignoreFocusOut: true });
    if (!key) return false;
    await creds.set(ep.id, key.trim(), parseBaseUrl(ep).origin);
    return true;
  };

  const doDiscover = async (ep: EndpointConfig) =>
    vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Discovering models on ${ep.name}...`, cancellable: true }, async (_p, token) => {
      const ac = new AbortController();
      token.onCancellationRequested(() => ac.abort());
      const models = await discoverModels(ep, await creds.get(ep.id), ac.signal, { log });
      await store.setDiscovered(ep.id, models);
      provider.refresh();
      void vscode.window.showInformationMessage(`Found ${models.length} model(s) on ${ep.name}. In Agent mode VS Code only lists models with tool calling: right-click a model → Toggle Tool Calling (or use Ask mode).`);
    });

  reg('manage', async () => {
    const items = [
      ['Add Endpoint', 'addEndpoint'], ['Set API Key', 'setApiKey'], ['Discover Models', 'discoverModels'], ['Add Model Manually', 'addModel'],
      ['Test Connection', 'testConnection'], ['Test Inference', 'testInference'], ['Edit Endpoints in settings.json', 'openSettings'],
      ['Remove Endpoint', 'removeEndpoint'], ['Clear API Key', 'clearApiKey'], ['Export Configuration (no secrets)', 'exportConfig'],
      ['Import Configuration', 'importConfig'], ['Show Diagnostics Log', 'showLog'],
    ] as const;
    const sel = await vscode.window.showQuickPick(items.map(([label, cmd]) => ({ label, cmd })), { placeHolder: 'LLM Bridge' });
    if (sel) await vscode.commands.executeCommand(CMD(sel.cmd));
  });

  reg('addEndpoint', async () => {
    const proto = await vscode.window.showQuickPick(PROTOCOLS.map((p) => ({ label: PROTOCOL_INFO[p].label, detail: PROTOCOL_INFO[p].detail, p })), { title: 'Protocol', placeHolder: 'Which API does the endpoint speak?' });
    if (!proto) return;
    const name = await vscode.window.showInputBox({ title: 'Endpoint name', prompt: 'Shown in the model picker', ignoreFocusOut: true, validateInput: (v) => (v.trim() ? undefined : 'Required') });
    if (!name) return;
    const baseUrl = await vscode.window.showInputBox({
      title: 'Base URL', value: PROTOCOL_INFO[proto.p].url, ignoreFocusOut: true,
      validateInput: (v) => { try { parseBaseUrl({ baseUrl: v }); return undefined; } catch (e) { return (e as Error).message; } },
    });
    if (!baseUrl) return;
    let apiVersion: string | undefined;
    if (proto.p === 'azure-openai-legacy') {
      apiVersion = await vscode.window.showInputBox({ title: 'Azure api-version', value: '2024-10-21', ignoreFocusOut: true });
      if (!apiVersion) return;
    }
    const { endpoints } = store.read();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'endpoint';
    let id = slug.length >= 2 ? slug : `${slug}-1`;
    for (let i = 2; endpoints.some((e) => e.id === id); i++) id = `${slug}-${i}`;
    const tc = await vscode.window.showQuickPick(
      [
        { label: 'Yes, they support tool calling', description: 'Models show up in Agent mode (VS Code lists only models with tool calling there)', value: true },
        { label: 'No / not sure', description: 'Use Ask mode; you can enable it per model later in the sidebar', value: false },
      ],
      { title: 'Do this endpoint\'s models support tool / function calling?', placeHolder: 'Only choose Yes if you know your models support tool calls', ignoreFocusOut: true },
    );
    const v = validateEndpoint({ id, name, protocol: proto.p, baseUrl: baseUrl.trim(), apiVersion, assumeToolCalling: tc?.value === true ? true : undefined, models: [] });
    if (!v.endpoint) throw new BridgeError('config', v.errors.join(' '));
    await store.write([...endpoints, v.endpoint]);
    const adapter = getAdapter(v.endpoint);
    if ((v.endpoint.auth ?? adapter.defaultAuth) !== 'none') await promptKey(v.endpoint, 'API key (optional now)');
    if (adapter.modelsUrl(v.endpoint)) await doDiscover(v.endpoint).catch((e) => void vscode.window.showWarningMessage(`Endpoint saved, but discovery failed: ${e.message} You can add models manually.`));
    else void vscode.window.showInformationMessage('Endpoint saved. This protocol has no model listing: run "LLM Bridge: Add Model Manually".');
  });

  reg('removeEndpoint', async (arg?: unknown) => {
    const ep = await pickEndpoint('Remove which endpoint?', arg);
    if (!ep) return;
    const ok = await vscode.window.showWarningMessage(`Remove "${ep.name}" and its stored API key?`, { modal: true }, 'Remove');
    if (!ok) return;
    await store.write(store.read().endpoints.filter((e) => e.id !== ep.id));
    await creds.delete(ep.id);
    await store.clearDiscovered(ep.id);
    provider.refresh();
  });

  reg('setApiKey', async (arg?: unknown) => { const ep = await pickEndpoint('Set API key for which endpoint?', arg); if (ep && (await promptKey(ep, 'Set API Key'))) provider.refresh(); });
  reg('clearApiKey', async (arg?: unknown) => { const ep = await pickEndpoint('Clear API key for which endpoint?', arg); if (ep) { await creds.delete(ep.id); void vscode.window.showInformationMessage(`API key cleared for ${ep.name}.`); } });
  reg('discoverModels', async (arg?: unknown) => { const ep = await pickEndpoint('Discover models on which endpoint?', arg); if (ep) await doDiscover(ep); });

  reg('testConnection', async (arg?: unknown) => {
    const ep = await pickEndpoint('Test which endpoint?', arg);
    if (!ep) return;
    const r = await testConnection(ep, await creds.get(ep.id), undefined, { log });
    void (r.ok ? vscode.window.showInformationMessage(`${ep.name}: ${r.message} (${r.latencyMs} ms)`) : vscode.window.showErrorMessage(`${ep.name}: ${r.message}`));
  });

  reg('testInference', async (arg?: unknown) => {
    const ep = await pickEndpoint('Test inference on which endpoint?', arg);
    if (!ep) return;
    const models = resolveModels(ep, store.discovered(ep.id));
    if (!models.length) throw new BridgeError('config', 'No models yet. Discover or add one first.');
    const preset = models.find((x) => x.id === fromArg(arg).modelId);
    const m = preset ? { m: preset } : await vscode.window.showQuickPick(models.map((x) => ({ label: x.name, description: x.id, m: x })), { placeHolder: 'Model' });
    if (!m) return;
    const r = await testInference(ep, m.m.id, m.m.streaming, await creds.get(ep.id), undefined, { log });
    void (r.ok ? vscode.window.showInformationMessage(`${ep.name}/${m.m.id}: ${r.message} (${r.latencyMs} ms)`) : vscode.window.showErrorMessage(`${ep.name}/${m.m.id}: ${r.message}`));
  });

  reg('addModel', async (arg?: unknown) => {
    const ep = await pickEndpoint('Add a model to which endpoint?', arg);
    if (!ep) return;
    const id = await vscode.window.showInputBox({ title: ep.protocol === 'azure-openai-legacy' ? 'Deployment name' : 'Model id', ignoreFocusOut: true, validateInput: (v) => (v.trim() ? undefined : 'Required') });
    if (!id) return;
    const numPrompt = async (title: string, value: string) => {
      const v = await vscode.window.showInputBox({ title, value, ignoreFocusOut: true, validateInput: (x) => (/^[1-9]\d*$/.test(x) ? undefined : 'Positive integer') });
      return v ? Number(v) : undefined;
    };
    const maxInputTokens = await numPrompt('Max input tokens (context window)', '128000');
    if (!maxInputTokens) return;
    const maxOutputTokens = await numPrompt('Max output tokens', '16384');
    if (!maxOutputTokens) return;
    const flags = await vscode.window.showQuickPick(
      [{ label: 'Tool calling', picked: false, k: 'toolCalling' }, { label: 'Image input (vision)', picked: false, k: 'vision' }],
      { canPickMany: true, title: 'Capabilities this model really supports' },
    );
    if (!flags) return;
    const model: ModelConfig = { id: id.trim(), maxInputTokens, maxOutputTokens, toolCalling: flags.some((f) => f.k === 'toolCalling'), vision: flags.some((f) => f.k === 'vision') };
    const eps = store.read().endpoints.map((e) => (e.id === ep.id ? { ...e, models: [...(e.models ?? []).filter((m) => m.id !== model.id), model] } : e));
    await store.write(eps);
    provider.refresh();
  });

  reg('toggleToolCalling', async (arg?: unknown) => {
    const { endpointId, modelId } = fromArg(arg);
    const ep = store.read().endpoints.find((e) => e.id === endpointId);
    const model = ep && resolveModels(ep, store.discovered(ep.id)).find((m) => m.id === modelId);
    if (!ep || !model) throw new BridgeError('config', 'Select a model in the LLM Bridge sidebar first.');
    const next = !model.toolCalling;
    await store.write(store.read().endpoints.map((e) => (e.id === ep.id ? withModelOverride(e, model.id, { toolCalling: next }) : e)));
    provider.refresh();
    void vscode.window.showInformationMessage(next
      ? `Tool calling ON for ${model.name}. It will now appear in Agent mode. Only keep this on if the model really supports tool calls.`
      : `Tool calling OFF for ${model.name}. It is hidden in Agent mode; use Ask mode to chat with it.`);
  });

  reg('removeModel', async (arg?: unknown) => {
    const { endpointId, modelId } = fromArg(arg);
    const ep = store.read().endpoints.find((e) => e.id === endpointId);
    const model = ep?.models?.find((m) => m.id === modelId);
    if (!ep || !model) throw new BridgeError('config', 'Only manually added models can be removed here. Discovered models come from the server.');
    if (!(await vscode.window.showWarningMessage(`Remove model "${model.name ?? model.id}" from ${ep.name}?`, { modal: true }, 'Remove'))) return;
    await store.write(store.read().endpoints.map((e) => (e.id === ep.id ? { ...e, models: (e.models ?? []).filter((m) => m.id !== model.id) } : e)));
    provider.refresh();
  });

  reg('openSettings', () => vscode.commands.executeCommand('workbench.action.openSettingsJson'));
  reg('showLog', () => log.show());

  reg('exportConfig', async () => {
    const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file('llm-bridge-config.json'), filters: { JSON: ['json'] } });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(exportConfig(store.read().endpoints)));
    void vscode.window.showInformationMessage('Exported endpoint configuration. API keys are never included.');
  });

  reg('importConfig', async () => {
    const [uri] = (await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json'] } })) ?? [];
    if (!uri) return;
    const { endpoints: incoming, problems } = parseImport(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
    if (!incoming.length) throw new BridgeError('config', problems.join(' ') || 'The file contains no endpoints.');
    const existing = store.read().endpoints;
    const moved = incoming.filter((i) => originChanged(existing.find((e) => e.id === i.id), i));
    const summary = [`Import ${incoming.length} endpoint(s):`, ...incoming.map((i) => `• ${i.name} → ${i.baseUrl}`)];
    if (moved.length) summary.push('', `Destination changed for: ${moved.map((m) => m.id).join(', ')}. Their stored API keys will be removed (never sent to the new host).`);
    if (problems.length) summary.push('', `${problems.length} invalid entr${problems.length === 1 ? 'y' : 'ies'} skipped.`);
    summary.push('', 'API keys are not imported; set them afterwards.');
    if (!(await vscode.window.showWarningMessage('Review imported endpoints', { modal: true, detail: summary.join('\n') }, 'Import'))) return;
    for (const m of moved) { await creds.delete(m.id); await store.clearDiscovered(m.id); }
    const ids = new Set(incoming.map((i) => i.id));
    await store.write([...existing.filter((e) => !ids.has(e.id)), ...incoming]);
    provider.refresh();
  });
}
