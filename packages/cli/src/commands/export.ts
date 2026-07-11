import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderMermaid, renderSvg } from "@alirezahamid/schemat-render/node";
import { prismaParser } from "@alirezahamid/schemat-parser-prisma";
import { loadLayout } from "../layout";

export type ExportFormat = "svg" | "mermaid";

export interface ExportOptions {
  root: string;
  format: ExportFormat;
  /** Output file path, or a directory (a `schema.<ext>` file is written inside). */
  out?: string;
}

const EXT: Record<ExportFormat, string> = { svg: "svg", mermaid: "mmd" };

/** True if the path already exists and is a directory. */
async function isExistingDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve where to write the export. Rules:
 *  - no --out            → `<root>/schema.<ext>`
 *  - --out is a directory (existing, or a trailing-separator path)
 *                        → `<out>/schema.<ext>`
 *  - --out is a file path → used as-is
 */
async function resolveOutPath(
  out: string | undefined,
  root: string,
  format: ExportFormat,
): Promise<string> {
  const filename = `schema.${EXT[format]}`;
  if (!out) return path.resolve(process.cwd(), root, filename);

  const resolved = path.resolve(process.cwd(), out);
  const looksLikeDir = /[\\/]$/.test(out) || (await isExistingDir(resolved));
  return looksLikeDir ? path.join(resolved, filename) : resolved;
}

/**
 * `schemat export` — parse the project's schema and write a static diagram
 * (SVG or Mermaid) to disk. SVG reuses the saved `.schemat/layout.json` so the
 * export matches the arrangement from `schemat dev`.
 */
export async function runExport(options: ExportOptions): Promise<void> {
  const { format } = options;
  if (format !== "svg" && format !== "mermaid") {
    console.error(`Unknown format "${format}". Use --format svg or --format mermaid.`);
    process.exitCode = 1;
    return;
  }

  const projectPath = path.resolve(process.cwd(), options.root);

  const detected = await prismaParser.detect(projectPath);
  if (!detected) {
    console.error(
      `No Prisma schema found under ${projectPath}/prisma/schema.prisma.\n` +
        "Run schemat export from a project with a Prisma schema, or pass --root <dir>.",
    );
    process.exitCode = 1;
    return;
  }

  const schema = await prismaParser.parse({ projectPath });

  let content: string;
  if (format === "svg") {
    const layout = await loadLayout(projectPath);
    content = await renderSvg(schema, { pinned: layout.positions });
  } else {
    content = renderMermaid(schema);
  }

  const outPath = await resolveOutPath(options.out, options.root, format);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, content, "utf8");

  const rel = path.relative(process.cwd(), outPath) || outPath;
  console.log(
    `  ✓ Exported ${schema.tables.length} tables, ${schema.relations.length} relations, ` +
      `${schema.enums.length} enums → ${rel}`,
  );
}
