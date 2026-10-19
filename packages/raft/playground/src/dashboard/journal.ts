export interface ObservatoryEvent {
  id: number;
  time: number;
  type: string;
  nodeId: string;
  data: Record<string, unknown>;
}

export const HISTORY_LIMIT = 2000;
const encoder = new TextEncoder();
type Client = ReadableStreamDefaultController<Uint8Array>;

export class EventJournal {
  readonly history: ObservatoryEvent[] = [];
  readonly highlights: ObservatoryEvent[] = [];
  sequence = 0;
  private clients = new Map<Client, number>();

  publish(type: string, nodeId: string, data: Record<string, unknown> = {}) {
    // Observability must never throw into consensus or retain snapshot buffers.
    let safe: Record<string, unknown>;
    try {
      const serialized = JSON.stringify(data, (key, value: unknown) =>
        /password|secret|token|authorization/i.test(key) ? "[redacted]" : value,
      );
      safe =
        serialized.length > 4096
          ? { summary: serialized.slice(0, 4000), truncated: true }
          : JSON.parse(serialized);
    } catch {
      safe = { summary: "Non-serializable event data" };
    }
    const event = {
      id: ++this.sequence,
      time: Date.now(),
      type,
      nodeId,
      data: safe,
    };
    this.history.push(event);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    if (!["rpc", "heartbeat_received", "metrics_updated"].includes(type)) {
      this.highlights.push(event);
      if (this.highlights.length > 100) this.highlights.shift();
    }
    return event;
  }

  connect(lastEventId: string | null, state: unknown) {
    const parsed = Number(lastEventId);
    const resume =
      lastEventId &&
      Number.isSafeInteger(parsed) &&
      parsed >= 0 &&
      parsed <= this.sequence;
    const cursor = resume ? parsed : this.sequence;
    let client: Client;
    return new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          client = controller;
          this.clients.set(client, cursor);
          client.enqueue(encoder.encode("retry: 1200\n\n"));
          this.write(client, "state", state);
          if (!resume && this.sequence) {
            const events = [
              ...new Map(
                [...this.highlights, ...this.history.slice(-100)].map(
                  (event) => [event.id, event],
                ),
              ).values(),
            ].sort((a, b) => a.id - b.id);
            this.write(client, "events", { events, omitted: 0 }, this.sequence);
          }
          this.flush();
        },
        cancel: () => {
          this.clients.delete(client);
        },
      },
      { highWaterMark: 1024 * 1024, size: (chunk) => chunk?.byteLength ?? 0 },
    );
  }

  flush() {
    for (const [client, cursor] of this.clients) {
      if (cursor === this.sequence) continue;
      const events = this.history.filter((event) => event.id > cursor);
      const omitted = Math.max(
        0,
        (events[0]?.id ?? this.sequence + 1) - cursor - 1,
      );
      this.write(client, "events", { events, omitted }, this.sequence);
      if (this.clients.has(client)) this.clients.set(client, this.sequence);
    }
  }

  broadcast(type: string, data: unknown) {
    for (const client of this.clients.keys()) this.write(client, type, data);
  }

  private write(client: Client, type: string, data: unknown, id?: number) {
    const frame = `${id === undefined ? "" : `id: ${id}\n`}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    try {
      if ((client.desiredSize ?? 0) <= 0) {
        // A slow observer reconnects and replays without stalling Raft.
        this.clients.delete(client);
        client.close();
      } else client.enqueue(encoder.encode(frame));
    } catch {
      this.clients.delete(client);
    }
  }

  close() {
    this.flush();
    for (const client of this.clients.keys()) {
      try {
        client.close();
      } catch {
        /* Already disconnected. */
      }
    }
    this.clients.clear();
  }
}
