import type { ServerMessage } from "@frontdesk/core";
import WebSocket from "ws";

/** A test client that records every server message and can wait for one. Tests only. */
export class TestClient {
  readonly received: ServerMessage[] = [];
  readonly closed: Promise<number>;
  private waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] =
    [];

  private constructor(readonly ws: WebSocket) {
    // The default binaryType is "nodebuffer".
    ws.on("message", (data: Buffer) => {
      const m = JSON.parse(data.toString("utf8")) as ServerMessage;
      this.received.push(m);
      this.waiters = this.waiters.filter((w) => (w.match(m) ? (w.resolve(m), false) : true));
    });
    this.closed = new Promise((resolve) => ws.on("close", (code) => resolve(code)));
  }

  static connect(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
    const ws = new WebSocket(url, { headers });
    const client = new TestClient(ws);
    return new Promise((resolve, reject) => {
      ws.once("open", () => resolve(client));
      ws.once("error", reject);
    });
  }

  next<T extends ServerMessage["type"]>(
    type: T,
    where: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const match = (m: ServerMessage) =>
      m.type === type && where(m as Extract<ServerMessage, { type: T }>);
    const seen = this.received.find(match);
    if (seen) return Promise.resolve(seen as Extract<ServerMessage, { type: T }>);
    return new Promise((resolve) =>
      this.waiters.push({
        match,
        resolve: (m) => resolve(m as Extract<ServerMessage, { type: T }>),
      }),
    );
  }

  say(text: string): void {
    this.ws.send(JSON.stringify({ type: "user_text", text, timings: {} }));
  }

  /** Sends a caller message and waits for that turn's turn_metrics. */
  async turn(text: string): Promise<void> {
    const count = this.received.filter((m) => m.type === "turn_metrics").length;
    this.say(text);
    await new Promise<void>((resolve) => {
      const check = () =>
        this.received.filter((m) => m.type === "turn_metrics").length > count
          ? resolve()
          : setTimeout(check, 5);
      check();
    });
  }

  close(): void {
    this.ws.close();
  }
}
