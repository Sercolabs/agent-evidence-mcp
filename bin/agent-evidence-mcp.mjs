#!/usr/bin/env node
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { startEvidenceMcp } from "../dist/mcp/server.js";

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--cwd" || !isAbsolute(args[1]))) {
    throw new Error("Usage: agent-evidence-mcp [--cwd <absolute-directory>]");
  }
  const cwd = args[1] ?? process.cwd();
  if (!statSync(cwd).isDirectory()) throw new Error("--cwd must be an existing directory");
  startEvidenceMcp(cwd);
} catch (error) { console.error(error.message); process.exitCode = 1; }
