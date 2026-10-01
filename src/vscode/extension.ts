import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { CMD, VENDOR } from './ids';
import { createLogger } from './log';
import { BridgeProvider } from './provider';
import { CredentialStore } from './secrets';
import { EndpointStore } from './store';
import { EndpointsTreeProvider } from './treeView';

export function activate(ctx: vscode.ExtensionContext): void {
  const log = createLogger();
  const store = new EndpointStore(ctx.globalState);
  const creds = new CredentialStore(ctx.secrets);
  const provider = new BridgeProvider(store, creds, log);
  // Registers only our own vendor; nothing here touches Copilot's providers, settings, or credentials.
  ctx.subscriptions.push(log, store, provider, vscode.lm.registerLanguageModelChatProvider(VENDOR, provider));
  const tree = new EndpointsTreeProvider(store, creds, ctx.secrets);
  ctx.subscriptions.push(tree, vscode.window.createTreeView('iitdeveloperLlmBridge.endpoints', { treeDataProvider: tree, showCollapseAll: true }));
  ctx.subscriptions.push(vscode.commands.registerCommand(CMD('refresh'), () => { tree.refresh(); provider.refresh(); }));
  registerCommands(ctx, store, creds, provider, log);
  log.info(`LLM Bridge activated (VS Code ${vscode.version}).`);
}

export function deactivate(): void {}
