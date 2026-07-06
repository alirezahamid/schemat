import type { IRSchema } from "@alirezahamid/schemat-core";

export type SchemaMessage =
  | { type: "schema"; schema: IRSchema }
  | { type: "error"; message: string };

/**
 * Load the initial schema. The CLI injects it as a global for the first paint,
 * then live updates arrive over the WebSocket (see {@link connectLiveUpdates}).
 */
export function readInitialSchema(): IRSchema | null {
  const injected = (window as unknown as { __SCHEMAT_SCHEMA__?: IRSchema }).__SCHEMAT_SCHEMA__;
  return injected ?? null;
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
