import * as vscode from 'vscode';
import { streamChat } from '../core/chat';
import { discoverModels } from '../core/discovery';
import { BridgeError } from '../core/errors';
import { parseModelId, stableModelId } from '../core/ids';
import { toChatMessages, toToolDefs } from '../core/mapping';
import { resolveModels } from '../core/models';
import { estimateMessageTokens, estimateTextTokens } from '../core/tokens';
import type { EndpointConfig, Logger, ResolvedModel } from '../core/types';
import type { CredentialStore } from './secrets';
import type { EndpointStore } from './store';

export class BridgeProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.emitter.event;
  private sub: vscode.Disposable;
  /** Endpoints whose discovery was already attempted this session, to avoid hammering failing servers. */
  private attempted = new Set<string>();

  constructor(private store: EndpointStore, private creds: CredentialStore, private log: Logger) {
    this.sub = store.onDidChange(() => this.emitter.fire());
  }

  refresh(): void { this.emitter.fire(); }

  async provideLanguageModelChatInformation(options: vscode.PrepareLanguageModelChatModelOptions, token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
    const { endpoints, problems } = this.store.read();
    for (const p of problems) this.log.error(`Invalid configuration ignored: ${p}`);
    const out: vscode.LanguageModelChatInformation[] = [];
    for (const ep of endpoints) {
      if (!options.silent && ep.autoDiscover !== false && !this.store.hasDiscovery(ep.id) && !this.attempted.has(ep.id) && !ep.models?.length) {
        this.attempted.add(ep.id);
        await this.tryDiscover(ep, token);
      }
      for (const m of resolveModels(ep, this.store.discovered(ep.id))) out.push(toInfo(ep, m));
    }
    this.log.info(`Model list requested by VS Code (silent=${options.silent}): returning ${out.length} model(s) from ${endpoints.length} endpoint(s), ${out.filter((m) => m.capabilities.toolCalling).length} with tool calling`);
    return out;
  }

  private async tryDiscover(ep: EndpointConfig, token: vscode.CancellationToken): Promise<void> {
    try {
      const ac = new AbortController();
      token.onCancellationRequested(() => ac.abort());
      const models = await discoverModels(ep, await this.creds.get(ep.id), ac.signal, { log: this.log });
      await this.store.setDiscovered(ep.id, models);
    } catch (e) {
      this.log.info(`Model discovery skipped for ${ep.id}: ${(e as Error).message}`);
    }
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const { ep, resolved } = this.lookup(model.id);
    const tools = toToolDefs(options.tools);
    if (tools.length && !resolved.toolCalling) {
      throw new BridgeError('config', `Model "${resolved.name}" is not configured with tool calling. Set "toolCalling": true on the model if the endpoint supports it.`);
    }
    const ac = new AbortController();
    const sub = token.onCancellationRequested(() => ac.abort());
    try {
      const credential = await this.creds.get(ep.id);
      const request = {
        messages: toChatMessages(messages as any, { vision: resolved.vision }),
        tools: tools.length ? tools : undefined,
        toolChoice: options.toolMode === vscode.LanguageModelChatToolMode.Required ? ('required' as const) : ('auto' as const),
        modelOptions: options.modelOptions as Record<string, unknown> | undefined,
      };
      for await (const ev of streamChat({ endpoint: ep, model: resolved, request, credential, signal: ac.signal, deps: { log: this.log } })) {
        if (ev.type === 'text') progress.report(new vscode.LanguageModelTextPart(ev.text));
        else progress.report(new vscode.LanguageModelToolCallPart(ev.call.id, ev.call.name, ev.call.args));
      }
    } catch (e) {
      if (e instanceof BridgeError) {
        if (e.kind === 'cancelled') throw new vscode.CancellationError();
        this.log.error(`${ep.id}: ${e.kind}: ${e.message}`);
      }
      throw e;
    } finally {
      sub.dispose();
    }
  }

  async provideTokenCount(_model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatRequestMessage): Promise<number> {
    if (typeof text === 'string') return estimateTextTokens(text);
    return toChatMessages([text as any], { vision: true }).reduce((n, m) => n + estimateMessageTokens(m), 0);
  }

  private lookup(modelId: string): { ep: EndpointConfig; resolved: ResolvedModel } {
    const parsed = parseModelId(modelId);
    const ep = this.store.read().endpoints.find((e) => e.id === parsed?.endpointId);
    const resolved = ep && resolveModels(ep, this.store.discovered(ep.id)).find((m) => m.id === parsed?.modelId);
    if (!ep || !resolved) throw new BridgeError('config', `Model "${modelId}" is no longer configured. Run "LLM Bridge: Manage Endpoints".`);
    return { ep, resolved };
  }

  dispose(): void { this.sub.dispose(); this.emitter.dispose(); }
}

function toInfo(ep: EndpointConfig, m: ResolvedModel): vscode.LanguageModelChatInformation {
  return {
    id: stableModelId(ep.id, m.id),
    name: m.name,
    family: m.id,
    version: '1',
    detail: ep.name,
    tooltip: `${m.name} via ${ep.name} (${ep.protocol}, ${m.source})`,
    maxInputTokens: m.maxInputTokens,
    maxOutputTokens: m.maxOutputTokens,
    capabilities: { toolCalling: m.toolCalling, imageInput: m.vision },
  };
}
