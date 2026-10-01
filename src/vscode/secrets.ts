import type * as vscode from 'vscode';
import type { Credential } from '../core/types';
import { SECRET_KEY } from './ids';

/** API keys live only in SecretStorage, bound to the origin they were entered for. */
export class CredentialStore {
  constructor(private secrets: vscode.SecretStorage) {}

  async get(endpointId: string): Promise<Credential | undefined> {
    const raw = await this.secrets.get(SECRET_KEY(endpointId));
    if (!raw) return undefined;
    try {
      const c = JSON.parse(raw);
      return typeof c?.secret === 'string' && typeof c?.origin === 'string' ? c : undefined;
    } catch {
      return undefined;
    }
  }
  set(endpointId: string, secret: string, origin: string): Thenable<void> {
    return this.secrets.store(SECRET_KEY(endpointId), JSON.stringify({ secret, origin } satisfies Credential));
  }
  delete(endpointId: string): Thenable<void> {
    return this.secrets.delete(SECRET_KEY(endpointId));
  }
}
