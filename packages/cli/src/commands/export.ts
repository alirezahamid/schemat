import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderMermaid, renderSvg } from "@alirezahamid/schemat-render";
import { prismaParser } from "@alirezahamid/schemat-parser-prisma";
import { loadLayout } from "../layout";

export type ExportFormat = "svg" | "mermaid";

export interface ExportOptions {
  root: string;
  format: ExportFormat;
  /** Output file path. Defaults to `schema.<ext>` in the project root. */
  out?: string;
}

const EXT: Record<ExportFormat, string> = { svg: "svg", mermaid: "mmd" };

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

  const outPath = path.resolve(
    process.cwd(),
    options.out ?? path.join(options.root, `schema.${EXT[format]}`),
  );
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, content, "utf8");

  const rel = path.relative(process.cwd(), outPath) || outPath;
  console.log(
    `  ✓ Exported ${schema.tables.length} tables, ${schema.relations.length} relations, ` +
      `${schema.enums.length} enums → ${rel}`,
  );
}
