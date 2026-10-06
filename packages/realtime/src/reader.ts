import type { EventStream } from './stream';
import type { StreamEvent } from './events';

export interface StreamReaderOptions {
  /** A stream on a connection used only for this loop: XREAD BLOCK holds it. */
  stream: EventStream;
  onEvents(events: StreamEvent[]): void;
  onError?(e: Error): void;
  blockMs?: number;
  /** Where to start. Default: the current end of the stream, so a restart does not replay old events to everyone. */
  startId?: string;
}

/** Reads the stream forever and hands new events to a callback. Backs off after an error. Stop it with the returned function. */
export function startStreamReader(opts: StreamReaderOptions): { stop(): Promise<void> } {
  let running = true;
  const blockMs = opts.blockMs ?? 2000;
  const done = (async () => {
    let lastId = opts.startId ?? (await opts.stream.newestId().catch(() => '0-0'));
    let backoff = 250;
    while (running) {
      try {
        const r = await opts.stream.readBlocking(lastId, blockMs);
        lastId = r.lastId;
        backoff = 250;
        if (r.entries.length && running) opts.onEvents(r.entries);
      } catch (e) {
        if (!running) break;
        opts.onError?.(e as Error);
        await new Promise((res) => setTimeout(res, backoff));
        backoff = Math.min(backoff * 2, 5000);
      }
    }
  })();
  return { async stop() { running = false; await done.catch(() => {}); } };
}
