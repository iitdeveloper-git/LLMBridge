import { BridgeError } from './errors';
import type { EndpointConfig } from './types';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.has(hostname.toLowerCase());
}

/** Parse and validate an endpoint base URL. Throws BridgeError('config'). */
export function parseBaseUrl(ep: Pick<EndpointConfig, 'baseUrl' | 'allowInsecureHttp'>): URL {
  let u: URL;
  try {
    u = new URL(ep.baseUrl);
  } catch {
    throw new BridgeError('config', `Invalid base URL: ${JSON.stringify(ep.baseUrl)}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new BridgeError('config', `Unsupported URL scheme ${u.protocol} (use https).`);
  }
  if (u.protocol === 'http:' && !isLoopbackHost(u.hostname) && !ep.allowInsecureHttp) {
    throw new BridgeError('config', 'Plain http is only allowed for localhost. Use https or set "allowInsecureHttp".');
  }
  if (u.username || u.password) {
    throw new BridgeError('config', 'Base URL must not contain embedded credentials. Use "Set API Key".');
  }
  if (u.search || u.hash) {
    throw new BridgeError('config', 'Base URL must not contain a query string or fragment.');
  }
  return u;
}

/** Append path segments to a base URL, preserving the base path and avoiding double slashes. */
export function joinUrl(base: URL, path: string, query?: Record<string, string>): URL {
  const u = new URL(base.toString());
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  if (query) for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u;
}
