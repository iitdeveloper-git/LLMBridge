import { validateEndpoints } from './config';
import { BridgeError } from './errors';
import type { EndpointConfig } from './types';

export const EXPORT_SCHEMA = 'iitdeveloper.llm-bridge/config';
export const EXPORT_VERSION = 1;

/** Endpoint configuration contains no secrets by construction; this re-validates so nothing sensitive can slip through. */
export function exportConfig(endpoints: readonly EndpointConfig[]): string {
  const { endpoints: clean } = validateEndpoints(endpoints);
  return JSON.stringify({ schema: EXPORT_SCHEMA, version: EXPORT_VERSION, endpoints: clean }, null, 2);
}

export interface ImportResult { endpoints: EndpointConfig[]; problems: string[] }

export function parseImport(text: string): ImportResult {
  let json: any;
  try { json = JSON.parse(text); } catch { throw new BridgeError('config', 'Import file is not valid JSON.'); }
  if (json?.schema !== EXPORT_SCHEMA || json?.version !== EXPORT_VERSION) {
    throw new BridgeError('config', `Not an LLM Bridge export (expected schema "${EXPORT_SCHEMA}" version ${EXPORT_VERSION}).`);
  }
  return validateEndpoints(json.endpoints);
}

/** Endpoints whose destination origin changed relative to the existing config; their stored keys no longer apply. */
export function originChanged(existing: EndpointConfig | undefined, incoming: EndpointConfig): boolean {
  if (!existing) return false;
  try { return new URL(existing.baseUrl).origin !== new URL(incoming.baseUrl).origin; } catch { return true; }
}
