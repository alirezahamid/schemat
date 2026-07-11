#!/usr/bin/env node
import { Command } from "commander";
import { runDev } from "./commands/dev";
import { type ExportFormat, runExport } from "./commands/export";

const program = new Command();

program
  .name("schemat")
  .description("Git-native database schema documentation — live interactive ER diagrams.")
  .version("0.0.0");

program
  .command("dev")
  .description("Serve an interactive, live-reloading ER diagram for the project's schema.")
  .option("-r, --root <dir>", "project root containing the schema", ".")
  .option("-p, --port <number>", "port to serve on", "5173")
  .action(async (opts: { root: string; port: string }) => {
    await runDev({ root: opts.root, port: Number.parseInt(opts.port, 10) });
  });

program
  .command("export")
  .description("Export a static ER diagram (SVG or Mermaid) — commit it to your repo.")
  .option("-r, --root <dir>", "project root containing the schema", ".")
  .option("-f, --format <format>", "output format: svg | mermaid", "svg")
  .option("-o, --out <file>", "output file path (default: <root>/schema.<ext>)")
  .action(async (opts: { root: string; format: string; out?: string }) => {
    await runExport({
      root: opts.root,
      format: opts.format as ExportFormat,
      out: opts.out,
    });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
