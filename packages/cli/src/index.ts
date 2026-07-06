#!/usr/bin/env node
import { Command } from "commander";
import { runDev } from "./commands/dev";

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

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
