import { PROTOCOLS, type EndpointConfig, type ModelConfig } from './types';
import { parseBaseUrl } from './url';
import { validateHeaders } from './security';
import { BridgeError } from './errors';

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export interface Validation { endpoint?: EndpointConfig; errors: string[] }

/** Validate and sanitize one raw endpoint object; unknown keys are dropped. */
export function validateEndpoint(raw: unknown): Validation {
  const errors: string[] = [];
  const r = raw as Record<string, any>;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { errors: ['Endpoint must be an object.'] };
  if (typeof r.id !== 'string' || !ID.test(r.id)) errors.push('"id" must match ^[a-z0-9][a-z0-9-]{1,40}$.');
  if (typeof r.name !== 'string' || !r.name.trim()) errors.push('"name" is required.');
  if (!PROTOCOLS.includes(r.protocol)) errors.push(`"protocol" must be one of ${PROTOCOLS.join(', ')}.`);
  if (typeof r.baseUrl !== 'string') errors.push('"baseUrl" is required.');
  else {
    try { parseBaseUrl({ baseUrl: r.baseUrl, allowInsecureHttp: r.allowInsecureHttp === true }); }
    catch (e) { errors.push((e as BridgeError).message); }
  }
  if (r.auth !== undefined && !['bearer', 'api-key-header', 'none'].includes(r.auth)) errors.push('"auth" must be bearer, api-key-header or none.');
  if (r.protocol === 'azure-openai-legacy' && (typeof r.apiVersion !== 'string' || !r.apiVersion)) errors.push('azure-openai-legacy requires "apiVersion".');
  if (r.azureV1Api !== undefined && !['responses', 'chat'].includes(r.azureV1Api)) errors.push('"azureV1Api" must be responses or chat.');
  if (r.headers !== undefined) {
    if (typeof r.headers !== 'object' || r.headers === null || Array.isArray(r.headers)) errors.push('"headers" must be an object.');
    else errors.push(...validateHeaders(r.headers));
  }
  if (r.timeoutMs !== undefined && !num(r.timeoutMs, 1000, 3_600_000)) errors.push('"timeoutMs" must be 1000..3600000.');
  if (r.maxRetries !== undefined && !num(r.maxRetries, 0, 10)) errors.push('"maxRetries" must be 0..10.');
  const models: ModelConfig[] = [];
  if (r.models !== undefined) {
    if (!Array.isArray(r.models)) errors.push('"models" must be an array.');
    else {
      const seen = new Set<string>();
      for (const m of r.models) {
        if (!m || typeof m.id !== 'string' || !m.id.trim()) { errors.push('Each model needs a non-empty "id".'); continue; }
        if (seen.has(m.id)) { errors.push(`Duplicate model id "${m.id}".`); continue; }
        seen.add(m.id);
        for (const k of ['maxInputTokens', 'maxOutputTokens'] as const) {
          if (m[k] !== undefined && !num(m[k], 1, 100_000_000)) errors.push(`Model "${m.id}": "${k}" must be a positive number.`);
        }
        models.push({
          id: m.id, name: typeof m.name === 'string' ? m.name : undefined,
          maxInputTokens: m.maxInputTokens, maxOutputTokens: m.maxOutputTokens,
          toolCalling: typeof m.toolCalling === 'boolean' ? m.toolCalling : undefined,
          vision: typeof m.vision === 'boolean' ? m.vision : undefined,
          streaming: typeof m.streaming === 'boolean' ? m.streaming : undefined,
        });
      }
    }
  }
  if (errors.length) return { errors };
  const endpoint: EndpointConfig = {
    id: r.id, name: r.name.trim(), protocol: r.protocol, baseUrl: r.baseUrl,
    auth: r.auth, apiVersion: r.apiVersion, azureV1Api: r.azureV1Api,
    headers: r.headers, allowInsecureHttp: r.allowInsecureHttp === true ? true : undefined,
    timeoutMs: r.timeoutMs, maxRetries: r.maxRetries,
    autoDiscover: typeof r.autoDiscover === 'boolean' ? r.autoDiscover : undefined,
    assumeToolCalling: typeof r.assumeToolCalling === 'boolean' ? r.assumeToolCalling : undefined,
    models,
  };
  return { endpoint: JSON.parse(JSON.stringify(endpoint)), errors };
}

export function validateEndpoints(raw: unknown): { endpoints: EndpointConfig[]; problems: string[] } {
  const problems: string[] = [];
  const endpoints: EndpointConfig[] = [];
  if (raw === undefined) return { endpoints, problems };
  if (!Array.isArray(raw)) return { endpoints, problems: ['"endpoints" must be an array.'] };
  const ids = new Set<string>();
  raw.forEach((item, i) => {
    const v = validateEndpoint(item);
    const label = `endpoints[${i}]${(item as any)?.id ? ` (${(item as any).id})` : ''}`;
    if (!v.endpoint) problems.push(...v.errors.map((e) => `${label}: ${e}`));
    else if (ids.has(v.endpoint.id)) problems.push(`${label}: duplicate id.`);
    else { ids.add(v.endpoint.id); endpoints.push(v.endpoint); }
  });
  return { endpoints, problems };
}
