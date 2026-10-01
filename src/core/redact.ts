const SENSITIVE_QUERY = /([?&](?:key|api[-_]?key|token|access[-_]?token|sig|signature|code)=)[^&#\s]+/gi;

export function redactText(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join('[REDACTED]');
  out = out
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/((?:api[-_]?key|x-api-key|authorization)["']?\s*[:=]\s*["']?(?:Bearer\s+)?)[^\s"',&}]+/gi, '$1[REDACTED]')
    .replace(SENSITIVE_QUERY, '$1[REDACTED]')
    .replace(/(\/\/)[^/@\s]+:[^/@\s]+@/g, '$1[REDACTED]@');
  return out;
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = /(key|token|secret|auth|password|credential|cookie)/i.test(k) ? '[REDACTED]' : redactText(v);
  }
  return out;
}

export function redactUrl(url: URL | string): string {
  return redactText(typeof url === 'string' ? url : url.toString());
}
