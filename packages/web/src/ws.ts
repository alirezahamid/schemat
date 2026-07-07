import type { IRSchema } from "@alirezahamid/schemat-core";

export type SchemaMessage =
  | { type: "schema"; schema: IRSchema }
  | { type: "error"; message: string };

/** Saved node positions keyed by table name. */
export type Positions = Record<string, { x: number; y: number }>;

/**
 * Load the initial schema. The CLI injects it as a global for the first paint,
 * then live updates arrive over the WebSocket (see {@link connectLiveUpdates}).
 */
export function readInitialSchema(): IRSchema | null {
  const injected = (window as unknown as { __SCHEMAT_SCHEMA__?: IRSchema }).__SCHEMAT_SCHEMA__;
  return injected ?? null;
}

/** Read the saved layout the CLI injected for the first paint. */
export function readInitialLayout(): Positions {
  const injected = (window as unknown as { __SCHEMAT_LAYOUT__?: Positions }).__SCHEMAT_LAYOUT__;
  return injected ?? {};
}

/**
 * Persist node positions to the CLI, which writes .schemat/layout.json.
 * Fire-and-forget: a failed save must never break the canvas.
 */
export async function saveLayout(positions: Positions): Promise<void> {
  try {
    await fetch("/api/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions }),
    });
  } catch {
    // ignore — layout persistence is best-effort
  }
}

/**
 * Connect to the CLI's WebSocket for live schema reloads. Returns a cleanup fn.
 * Silently no-ops if no server is present (e.g. static preview).
 */
export function connectLiveUpdates(onSchema: (schema: IRSchema) => void): () => void {
  const url = `ws://${window.location.host}/ws`;
  let socket: WebSocket | null = null;
  let closed = false;

  try {
    socket = new WebSocket(url);
  } catch {
    return () => {};
  }

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as SchemaMessage;
      if (msg.type === "schema") onSchema(msg.schema);
    } catch {
      // ignore malformed frames
    }
  };

  return () => {
    closed = true;
    if (socket && !closed) socket.close();
    socket?.close();
  };
}
