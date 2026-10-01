import { BridgeError } from './errors';
import type { AuthMode, Credential } from './types';

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const SENSITIVE_NAME = /(key|token|secret|auth|password|credential|cookie|signature|session)/i;

/** Validate user-supplied non-secret headers. Credential-like headers are rejected. */
export function validateHeaders(headers: Record<string, string> | undefined): string[] {
  const errors: string[] = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!HEADER_NAME.test(name)) errors.push(`Invalid header name: ${JSON.stringify(name)}`);
    else if (SENSITIVE_NAME.test(name)) errors.push(`Header "${name}" looks credential-bearing and is not allowed in configuration. Use "Set API Key".`);
    if (typeof value !== 'string' || /[\r\n\0]/.test(value)) errors.push(`Invalid value for header "${name}".`);
    if (name.toLowerCase() === 'host' || name.toLowerCase() === 'content-length') errors.push(`Header "${name}" cannot be overridden.`);
  }
  return errors;
}

export function authHeaders(mode: AuthMode, secret: string | undefined): Record<string, string> {
  if (mode === 'none') return {};
  if (!secret) throw new BridgeError('config', 'No API key is set for this endpoint. Run "LLM Bridge: Set API Key" (or set auth to "none").');
  return mode === 'bearer' ? { Authorization: `Bearer ${secret}` } : { 'api-key': secret };
}

/** A stored credential may only be sent to the origin it was saved for. */
export function assertCredentialBound(cred: Credential | undefined, target: URL): void {
  if (cred && cred.origin !== target.origin) {
    throw new BridgeError(
      'credential-binding',
      `The stored API key was saved for ${cred.origin}, but this endpoint now points to ${target.origin}. ` +
        'The key was NOT sent. Run "LLM Bridge: Set API Key" to re-enter it for the new destination.',
    );
  }
}
