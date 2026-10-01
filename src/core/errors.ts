export type ErrorKind =
  | 'auth' | 'rate-limit' | 'not-found' | 'bad-request' | 'server' | 'network'
  | 'timeout' | 'cancelled' | 'redirect' | 'credential-binding' | 'config' | 'protocol';

export class BridgeError extends Error {
  constructor(readonly kind: ErrorKind, message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = 'BridgeError';
  }
}

export function errorFromStatus(status: number, detail: string): BridgeError {
  const d = detail ? ` Server said: ${detail}` : '';
  if (status === 401 || status === 403) {
    return new BridgeError('auth', `Authentication failed (HTTP ${status}). Check the API key (run "LLM Bridge: Set API Key") and the auth mode.${d}`, status);
  }
  if (status === 404) {
    return new BridgeError('not-found', `Not found (HTTP 404). Check the base URL, protocol and model/deployment id.${d}`, status);
  }
  if (status === 408 || status === 429) {
    return new BridgeError('rate-limit', `Request limited (HTTP ${status}). Retry later or reduce usage.${d}`, status, true);
  }
  if (status >= 500) {
    return new BridgeError('server', `The endpoint failed (HTTP ${status}).${d}`, status, true);
  }
  return new BridgeError('bad-request', `The endpoint rejected the request (HTTP ${status}).${d}`, status);
}
