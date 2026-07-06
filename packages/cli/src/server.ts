import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import type { IRSchema } from "@alirezahamid/schemat-core";
import { WebSocketServer, type WebSocket } from "ws";
import { resolveWebDist } from "./web-assets";

const HTML_MIME = "text/html; charset=utf-8";

const MIME: Record<string, string> = {
  ".html": HTML_MIME,
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
};

/** A running Schemat dev server with a live schema channel. */
export interface SchematServer {
  readonly port: number;
  /** Push a new schema to all connected browsers. */
  broadcast(schema: IRSchema): void;
  close(): Promise<void>;
}

/**
 * Serve the web canvas and expose a WebSocket at /ws for live updates. The
 * initial schema is injected into index.html so the first paint has data
 * without waiting for the socket.
 */
export async function startServer(initial: IRSchema, port: number): Promise<SchematServer> {
  const distDir = resolveWebDist();
  const indexHtml = await buildIndexHtml(distDir, initial);
  let currentSchema = initial;

  const httpServer = createServer((req, res) => {
    handleHttp(req, res, distDir, indexHtml).catch(() => {
      res.statusCode = 500;
      res.end("internal error");
    });
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Set<WebSocket>();
  wss.on("connection", (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify({ type: "schema", schema: currentSchema }));
    socket.on("close", () => clients.delete(socket));
  });

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));

  return {
    port,
    broadcast(schema: IRSchema) {
      currentSchema = schema;
      const frame = JSON.stringify({ type: "schema", schema });
      for (const socket of clients) {
        if (socket.readyState === socket.OPEN) socket.send(frame);
      }
    },
    async close() {
      for (const socket of clients) socket.close();
      wss.close();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

async function buildIndexHtml(distDir: string, schema: IRSchema): Promise<string> {
  const raw = await readFile(path.join(distDir, "index.html"), "utf8");
  const inject = `<script>window.__SCHEMAT_SCHEMA__ = ${serialize(schema)};</script>`;
  return raw.replace("</head>", `${inject}</head>`);
}

/** Serialize JSON safely for inline <script> injection. */
function serialize(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  distDir: string,
  indexHtml: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/" || pathname === "/index.html") {
    res.setHeader("Content-Type", HTML_MIME);
    res.end(indexHtml);
    return;
  }

  // Prevent path traversal: resolve against distDir and ensure containment.
  const resolved = path.join(distDir, pathname);
  if (!resolved.startsWith(distDir)) {
    res.statusCode = 403;
    res.end("forbidden");
    return;
  }

  try {
    const data = await readFile(resolved);
    const ext = path.extname(resolved);
    res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
    res.end(data);
  } catch {
    // SPA fallback.
    res.setHeader("Content-Type", HTML_MIME);
    res.end(indexHtml);
  }
}
