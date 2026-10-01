import * as vscode from 'vscode';
import { validateEndpoints } from '../core/config';
import type { DiscoveredModel, EndpointConfig } from '../core/types';
import { CONFIG_SECTION, DISCOVERY_STATE_KEY } from './ids';

type DiscoveryCache = Record<string, { models: DiscoveredModel[]; at: number }>;

export class EndpointStore implements vscode.Disposable {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private sub: vscode.Disposable;

  constructor(private state: vscode.Memento) {
    this.sub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${CONFIG_SECTION}.endpoints`)) this.emitter.fire();
    });
  }

  /** Reads USER settings only; workspace/folder values are deliberately ignored so a repo cannot redirect endpoints. */
  read(): { endpoints: EndpointConfig[]; problems: string[] } {
    const raw = vscode.workspace.getConfiguration(CONFIG_SECTION).inspect<unknown[]>('endpoints')?.globalValue;
    return validateEndpoints(raw);
  }

  async write(endpoints: EndpointConfig[]): Promise<void> {
    await vscode.workspace.getConfiguration(CONFIG_SECTION).update('endpoints', endpoints, vscode.ConfigurationTarget.Global);
  }

  discovered(endpointId: string): DiscoveredModel[] {
    return (this.state.get<DiscoveryCache>(DISCOVERY_STATE_KEY) ?? {})[endpointId]?.models ?? [];
  }
  hasDiscovery(endpointId: string): boolean {
    return !!(this.state.get<DiscoveryCache>(DISCOVERY_STATE_KEY) ?? {})[endpointId];
  }
  async setDiscovered(endpointId: string, models: DiscoveredModel[]): Promise<void> {
    const all = { ...(this.state.get<DiscoveryCache>(DISCOVERY_STATE_KEY) ?? {}) };
    all[endpointId] = { models, at: Date.now() };
    await this.state.update(DISCOVERY_STATE_KEY, all);
    this.emitter.fire();
  }
  async clearDiscovered(endpointId: string): Promise<void> {
    const all = { ...(this.state.get<DiscoveryCache>(DISCOVERY_STATE_KEY) ?? {}) };
    delete all[endpointId];
    await this.state.update(DISCOVERY_STATE_KEY, all);
  }

  dispose(): void { this.sub.dispose(); this.emitter.dispose(); }
}
