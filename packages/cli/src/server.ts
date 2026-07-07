import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import type { IRSchema } from "@alirezahamid/schemat-core";
import { WebSocketServer, type WebSocket } from "ws";
import { type LayoutFile, type Position, loadLayout, saveLayout } from "./layout";
import { resolveWebDist } from "./web-assets";

const HTML_MIME = "text/html; charset=utf-8";
const JSON_MIME = "application/json; charset=utf-8";

const MIME: Record<string, string> = {
  ".html": HTML_MIME,
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": JSON_MIME,
  ".svg": "image/svg+xml",
  ".map": JSON_MIME,
};

/** Max body size accepted on POST /api/layout (guards against runaway input). */
const MAX_BODY_BYTES = 1_000_000;

/** A running Schemat dev server with a live schema channel. */
export interface SchematServer {
  readonly port: number;
  /** Push a new schema to all connected browsers. */
  broadcast(schema: IRSchema): void;
  close(): Promise<void>;
}

/**
 * Serve the web canvas and expose:
 *  - WebSocket at /ws for live schema updates
 *  - GET  /api/layout  → saved node positions
 *  - POST /api/layout  → persist node positions to .schemat/layout.json
 *
 * The initial schema and saved layout are injected into index.html so the first
 * paint has data without a round-trip.
 */
export async function startServer(
  initial: IRSchema,
  port: number,
  projectPath: string,
): Promise<SchematServer> {
  const distDir = resolveWebDist();
  const layout = await loadLayout(projectPath);
  const indexHtml = await buildIndexHtml(distDir, initial, layout);
  let currentSchema = initial;

  const httpServer = createServer((req, res) => {
    handleHttp(req, res, { distDir, indexHtml, projectPath }).catch(() => {
      if (!res.headersSent) res.statusCode = 500;
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

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    httpServer.once("error", onError);
    httpServer.listen(port, () => {
      httpServer.removeListener("error", onError);
      resolve();
    });
  });

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

async function buildIndexHtml(
  distDir: string,
  schema: IRSchema,
  layout: LayoutFile,
): Promise<string> {
  const raw = await readFile(path.join(distDir, "index.html"), "utf8");
  const inject =
    `<script>window.__SCHEMAT_SCHEMA__ = ${serialize(schema)};` +
    `window.__SCHEMAT_LAYOUT__ = ${serialize(layout.positions)};</script>`;
  return raw.replace("</head>", `${inject}</head>`);
}

/** Serialize JSON safely for inline <script> injection. */
function serialize(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

interface HandlerCtx {
  distDir: string;
  indexHtml: string;
  projectPath: string;
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HandlerCtx,
): Promise<void> {
  let pathname: string;
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.statusCode = 400;
    res.end("bad request");
    return;
  }

  // Layout API.
  if (pathname === "/api/layout") {
    await handleLayoutApi(req, res, ctx.projectPath);
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    res.setHeader("Content-Type", HTML_MIME);
    res.end(ctx.indexHtml);
    return;
  }

  // Prevent path traversal: resolve against distDir and verify the result stays
  // inside it using a path-boundary-aware check (startsWith alone is unsafe:
  // "/dist-evil" starts with "/dist").
  const resolved = path.resolve(ctx.distDir, `.${pathname}`);
  const rel = path.relative(ctx.distDir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
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
    res.end(ctx.indexHtml);
  }
}

async function handleLayoutApi(
  req: IncomingMessage,
  res: ServerResponse,
  projectPath: string,
): Promise<void> {
  if (req.method === "GET") {
    const layout = await loadLayout(projectPath);
    res.setHeader("Content-Type", JSON_MIME);
    res.end(JSON.stringify(layout));
    return;
  }

  if (req.method === "POST") {
    const positions = await readLayoutBody(req, res);
    if (positions === null) return; // response already sent
    await saveLayout(projectPath, positions);
    res.statusCode = 204;
    res.end();
    return;
  }

  res.statusCode = 405;
  res.setHeader("Allow", "GET, POST");
  res.end("method not allowed");
}

/** Read + validate a POST body into a positions map, or send an error and return null. */
async function readLayoutBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, Position> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      res.statusCode = 413;
      res.end("payload too large");
      return null;
    }
    chunks.push(chunk as Buffer);
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const raw = (parsed?.positions ?? parsed) as unknown;
    if (typeof raw !== "object" || raw === null) throw new Error("invalid");

    const positions: Record<string, Position> = {};
    for (const [name, pos] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof pos !== "object" || pos === null) continue;
      const p = pos as Record<string, unknown>;
      if (
        typeof p.x === "number" &&
        typeof p.y === "number" &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y)
      ) {
        positions[name] = { x: p.x, y: p.y };
      }
    }
    return positions;
  } catch {
    res.statusCode = 400;
    res.end("bad request");
    return null;
  }
}
