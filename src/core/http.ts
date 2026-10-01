import { BridgeError, errorFromStatus } from './errors';
import { redactText, redactUrl } from './redact';
import { assertCredentialBound, authHeaders } from './security';
import { nullLogger, type AuthMode, type Credential, type Logger } from './types';

export interface HttpDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  log?: Logger;
}

export interface RequestOpts {
  method: 'GET' | 'POST';
  url: URL;
  headers?: Record<string, string>;
  body?: string;
  auth: AuthMode;
  credential?: Credential;
  timeoutMs: number;
  maxRetries: number;
  signal?: AbortSignal;
}

/** Aborts the request on timeout; `arm()` restarts the idle timer (call per streamed chunk). */
export class Deadline {
  readonly controller = new AbortController();
  timedOut = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private onExternal = () => this.controller.abort();

  constructor(private ms: number, private external?: AbortSignal) {
    if (external?.aborted) this.controller.abort();
    else external?.addEventListener('abort', this.onExternal, { once: true });
  }
  get signal(): AbortSignal { return this.controller.signal; }
  arm(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timedOut = true;
      this.controller.abort();
    }, this.ms);
  }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  dispose(): void {
    this.clearTimer();
    this.external?.removeEventListener('abort', this.onExternal);
  }
  /** Map an abort-type failure to the right BridgeError. */
  abortError(): BridgeError {
    if (this.external?.aborted) return new BridgeError('cancelled', 'The request was cancelled.');
    return new BridgeError('timeout', `The endpoint did not respond within ${Math.round(this.ms / 1000)}s.`, undefined, true);
  }
}

export interface HttpResult { response: Response; deadline: Deadline }

const MAX_REDIRECTS = 5;
const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new BridgeError('cancelled', 'The request was cancelled.')); }, { once: true });
  });

export async function send(opts: RequestOpts, deps: HttpDeps = {}): Promise<HttpResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const log = deps.log ?? nullLogger;
  let lastErr: BridgeError | undefined;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (opts.signal?.aborted) throw new BridgeError('cancelled', 'The request was cancelled.');
    try {
      return await attemptOnce(opts, deps);
    } catch (e) {
      if (!(e instanceof BridgeError)) throw e;
      lastErr = e;
      if (!e.retryable || attempt === opts.maxRetries) throw e;
      const delay = (e as RetryableError).retryAfterMs ?? Math.min(500 * 2 ** attempt + Math.random() * 250, 8000);
      log.info(`Retrying in ${Math.round(delay)}ms after ${e.kind}${e.status ? ` (HTTP ${e.status})` : ''} [attempt ${attempt + 1}/${opts.maxRetries}]`);
      await sleep(delay, opts.signal);
    }
  }
  throw lastErr ?? new BridgeError('network', 'Request failed.');
}

type RetryableError = BridgeError & { retryAfterMs?: number };

async function attemptOnce(opts: RequestOpts, deps: HttpDeps): Promise<HttpResult> {
  const doFetch = deps.fetch ?? fetch;
  const deadline = new Deadline(opts.timeoutMs, opts.signal);
  deadline.arm();
  try {
    let url = opts.url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Credentials are attached per hop, and only to the origin they were bound to.
      const headers: Record<string, string> = { ...(opts.headers ?? {}) };
      if (opts.auth !== 'none') {
        assertCredentialBound(opts.credential, url);
        Object.assign(headers, authHeaders(opts.auth, opts.credential?.secret));
      }
      let res: Response;
      try {
        res = await doFetch(url, { method: opts.method, headers, body: opts.body, redirect: 'manual', signal: deadline.signal });
      } catch (e) {
        if (deadline.signal.aborted) throw deadline.abortError();
        const msg = redactText(String((e as Error)?.cause instanceof Error ? ((e as Error).cause as Error).message : (e as Error)?.message ?? e), opts.credential ? [opts.credential.secret] : []);
        throw new BridgeError('network', `Could not reach ${url.origin}: ${msg}`, undefined, true);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = new URL(res.headers.get('location')!, url);
        await res.body?.cancel().catch(() => {});
        if (next.origin !== url.origin) {
          throw new BridgeError('redirect', `The endpoint redirected to a different origin (${next.origin}). The redirect was not followed and no credentials were sent there. Update the base URL if this is intended.`);
        }
        const safe = opts.method === 'GET' || res.status === 307 || res.status === 308;
        if (!safe) throw new BridgeError('redirect', `The endpoint answered a ${opts.method} with a ${res.status} redirect to ${redactUrl(next)}. Use the final URL as the base URL.`);
        url = next;
        continue;
      }
      if (!res.ok) {
        const detail = await readErrorDetail(res, opts.credential);
        const err = errorFromStatus(res.status, detail) as RetryableError;
        const ra = Number(res.headers.get('retry-after'));
        if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = Math.min(ra * 1000, 30000);
        throw err;
      }
      return { response: res, deadline };
    }
    throw new BridgeError('redirect', 'Too many redirects.');
  } catch (e) {
    deadline.dispose();
    throw e;
  }
}

async function readErrorDetail(res: Response, cred?: Credential): Promise<string> {
  let text = '';
  try {
    text = (await res.text()).slice(0, 2000);
  } catch { /* ignore */ }
  try {
    const j = JSON.parse(text);
    const m = j?.error?.message ?? j?.message ?? (typeof j?.error === 'string' ? j.error : undefined);
    if (typeof m === 'string') text = m;
  } catch { /* not JSON */ }
  return redactText(text.replace(/\s+/g, ' ').trim(), cred ? [cred.secret] : []).slice(0, 900);
}
