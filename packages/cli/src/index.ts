#!/usr/bin/env node
import { createProgram } from "./program";

createProgram()
  .parseAsync(process.argv)
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
