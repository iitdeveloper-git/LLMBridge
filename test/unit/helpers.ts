import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { EndpointConfig } from '../../src/core/types';

export interface Recorded { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }
export interface TestServer { origin: string; port: number; requests: Recorded[]; close(): Promise<void> }

export async function startServer(handler: (req: Recorded, res: http.ServerResponse, n: number) => void): Promise<TestServer> {
  const requests: Recorded[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rec = { method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString() };
      requests.push(rec);
      handler(rec, res, requests.length);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`, port, requests,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

export const ep = (over: Partial<EndpointConfig> & { baseUrl: string }): EndpointConfig => ({
  id: 'test', name: 'Test', protocol: 'openai-chat', maxRetries: 0, timeoutMs: 5000, ...over,
});

export const sseHeaders = { 'content-type': 'text/event-stream' };
export const sseData = (o: unknown) => `data: ${typeof o === 'string' ? o : JSON.stringify(o)}\n\n`;
export const noSleep = async () => {};

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
