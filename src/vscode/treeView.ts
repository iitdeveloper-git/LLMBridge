import * as vscode from 'vscode';
import { endpointNodes, modelNodes, type KeyState, type TreeNode } from '../core/tree';
import { CMD } from './ids';
import type { CredentialStore } from './secrets';
import type { EndpointStore } from './store';

const KEY_ICON: Record<KeyState, vscode.ThemeIcon> = {
  set: new vscode.ThemeIcon('check'),
  'not-needed': new vscode.ThemeIcon('plug'),
  missing: new vscode.ThemeIcon('key', new vscode.ThemeColor('list.warningForeground')),
  mismatch: new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground')),
};

export class EndpointsTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private subs: vscode.Disposable[];

  constructor(private store: EndpointStore, private creds: CredentialStore, secrets: vscode.SecretStorage) {
    this.subs = [store.onDidChange(() => this.refresh()), secrets.onDidChange(() => this.refresh())];
  }

  refresh(): void { this.emitter.fire(); }

  async getChildren(node?: TreeNode): Promise<TreeNode[]> {
    const { endpoints } = this.store.read();
    if (!node) {
      const entries = await Promise.all(endpoints.map(async (e) => [e.id, await this.creds.get(e.id)] as const));
      const discovered = Object.fromEntries(endpoints.map((e) => [e.id, this.store.discovered(e.id)]));
      return endpointNodes(endpoints, Object.fromEntries(entries), discovered);
    }
    if (node.kind !== 'endpoint') return [];
    const ep = endpoints.find((e) => e.id === node.endpointId);
    return ep ? modelNodes(ep, this.store.discovered(ep.id)) : [];
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === 'endpoint') {
      const item = new vscode.TreeItem(node.label, node.modelCount ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      item.description = node.description;
      item.tooltip = node.tooltip;
      item.iconPath = KEY_ICON[node.keyState];
      item.contextValue = 'endpoint';
      item.id = `endpoint:${node.endpointId}`;
      return item;
    }
    if (node.kind === 'model') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.description = node.description;
      item.tooltip = node.tooltip;
      item.iconPath = new vscode.ThemeIcon('hubot');
      item.contextValue = node.source === 'manual' ? 'model-manual' : 'model-discovered';
      item.id = `model:${node.endpointId}:${node.modelId}`;
      return item;
    }
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('add');
    item.command = { command: CMD(node.commandSuffix), title: node.label, arguments: [node] };
    item.id = `hint:${node.endpointId}`;
    return item;
  }

  dispose(): void { this.subs.forEach((s) => s.dispose()); this.emitter.dispose(); }
}
