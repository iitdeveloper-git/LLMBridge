export interface SseEvent { event?: string; data: string }

/** Incremental Server-Sent Events parser. Safe against chunk splits inside UTF-8 sequences and CRLF pairs. */
export class SseParser {
  private decoder = new TextDecoder('utf-8');
  private buffer = '';
  private data: string[] = [];
  private event: string | undefined;

  push(chunk: Uint8Array): SseEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  /** Flush at end of stream; a trailing event without a blank line is still delivered. */
  end(): SseEvent[] {
    this.buffer += this.decoder.decode();
    const out = this.drain(true);
    const last = this.dispatch();
    if (last) out.push(last);
    return out;
  }

  private drain(final: boolean): SseEvent[] {
    const out: SseEvent[] = [];
    for (;;) {
      const m = /\r\n|\n|\r/.exec(this.buffer);
      if (!m) break;
      // A lone CR at the very end may be the first half of CRLF; wait for more input.
      if (m[0] === '\r' && m.index === this.buffer.length - 1 && !final) break;
      const line = this.buffer.slice(0, m.index);
      this.buffer = this.buffer.slice(m.index + m[0].length);
      if (line === '') {
        const ev = this.dispatch();
        if (ev) out.push(ev);
      } else this.field(line);
    }
    if (final && this.buffer) {
      this.field(this.buffer);
      this.buffer = '';
    }
    return out;
  }

  private field(line: string): void {
    if (line.startsWith(':')) return;
    const i = line.indexOf(':');
    const name = i === -1 ? line : line.slice(0, i);
    let value = i === -1 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (name === 'data') this.data.push(value);
    else if (name === 'event') this.event = value;
  }

  private dispatch(): SseEvent | undefined {
    if (this.data.length === 0) {
      this.event = undefined;
      return undefined;
    }
    const ev: SseEvent = { event: this.event, data: this.data.join('\n') };
    this.data = [];
    this.event = undefined;
    return ev;
  }
}
