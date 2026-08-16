import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { configWritePath } from "../config";
import { ensureProjectDir } from "../project-path";
import {
  PARSER_NAMES,
  detectParser,
  getParserByName,
  noSchemaMessage,
  resolveSchemaResult,
} from "../schema-source";
import { saveSnapshot, snapshotPath } from "../snapshot";
import { suggestCommand } from "../suggest";
import { arrow, counts, detail, errorBlock, heading, info, success, warning } from "../ui";

export interface InitOptions {
  root: string;
  /** Force a parser by name (same values as `--source`). */
  source?: string;
  /** Overwrite an existing schemat.config.json. */
  force?: boolean;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * `schemat init` — detect (or accept) a schema source, write a starter
 * `schemat.config.json`, take an initial snapshot, and print next steps.
 */
export async function runInit(options: InitOptions): Promise<void> {
  const projectPath = path.resolve(process.cwd(), options.root);
  if (!(await ensureProjectDir(projectPath, { command: "init", root: options.root }))) return;

  let parserName: string;
  if (options.source) {
    const forced = getParserByName(options.source);
    if (!forced) {
      errorBlock(`Unknown source "${options.source}".`, `Supported: ${PARSER_NAMES.join(", ")}.`);
      process.exitCode = 1;
      return;
    }
    parserName = forced.name;
  } else {
    const detected = await detectParser(projectPath);
    if (!detected) {
      errorBlock(
        await noSchemaMessage(projectPath, { command: "init", root: options.root }),
        `Pass --source <${PARSER_NAMES.join("|")}> to force a parser.`,
      );
      process.exitCode = 1;
      return;
    }
    parserName = detected.name;
  }

  const configPath = configWritePath(projectPath);
  if ((await fileExists(configPath)) && !options.force) {
    errorBlock(
      `${path.relative(process.cwd(), configPath) || configPath} already exists.`,
      "Re-run with --force to overwrite, or edit the file by hand.",
      [suggestCommand("init", { root: options.root, extra: ["--force"] })],
    );
    process.exitCode = 1;
    return;
  }

  // Parse BEFORE writing the config: a config pointing at a source that can't
  // parse poisons every later command in this directory (including the
  // monorepo hint), so it must never be left behind by a failed init.
  const result = await resolveSchemaResult(projectPath, parserName);
  for (const text of result?.warnings ?? []) warning(text);
  const schema = result?.schema ?? null;
  if (!schema) {
    errorBlock(await noSchemaMessage(projectPath, { command: "init", root: options.root }));
    process.exitCode = 1;
    return;
  }

  const configDoc = `${JSON.stringify({ source: parserName }, null, 2)}\n`;
  await writeFile(configPath, configDoc, "utf8");
  const configRel = path.relative(process.cwd(), configPath) || configPath;

  info(`Detected ${parserName} schema`);
  success(`Wrote ${configRel}`);

  await saveSnapshot(projectPath, schema);
  const snapRel =
    path.relative(process.cwd(), snapshotPath(projectPath)) || snapshotPath(projectPath);
  success(`Snapshot written ${arrow()} ${snapRel}`);
  detail(counts(schema));

  // Suggestions print raw: they are meant to be copied into a shell.
  process.stdout.write(`\n  ${heading("Next steps")}\n`);
  process.stdout.write(`    1. Commit ${configRel} and ${snapRel}\n`);
  process.stdout.write(
    `    2. Add \`${suggestCommand("check", { root: options.root })}\` to CI (see the GitHub Action in the README)\n`,
  );
  process.stdout.write(
    `    3. Run \`${suggestCommand("dev", { root: options.root })}\` for a live ER diagram\n\n`,
  );
}
