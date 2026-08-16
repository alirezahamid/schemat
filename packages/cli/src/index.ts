#!/usr/bin/env node
import { createProgram } from "./program";
import { errorBlock } from "./ui";

createProgram()
  .parseAsync(process.argv)
  .catch((err) => {
    errorBlock(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
