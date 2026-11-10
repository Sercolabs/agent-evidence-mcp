import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { CheckEvaluation } from "../aggregate.js";

const EXPECTED = { exists: true } as const;

export type LocatedFile =
  | { readonly kind: "file"; readonly path: string; readonly size: number }
  | { readonly kind: "missing" }
  | { readonly kind: "not_file" }
  | { readonly kind: "illegal" }
  | { readonly kind: "unreadable"; readonly code: string };

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") {
      return code;
    }
  }
  return "unknown";
}

function escapesRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  if (isAbsolute(rel)) {
    return true;
  }
  return rel.split(/[/\\]/).includes("..");
}

function containedPath(cwd: string, input: string): string | undefined {
  if (input.length === 0 || input.includes("\0")) {
    return undefined;
  }
  const root = resolve(cwd);
  const abs = resolve(root, input);
  if (escapesRoot(root, abs)) {
    return undefined;
  }
  return abs;
}

export function locateFile(cwd: string, input: string): LocatedFile {
  const lexical = containedPath(cwd, input);
  if (lexical === undefined) {
    return { kind: "illegal" };
  }
  let opened = lexical;
  try {
    opened = realpathSync(lexical);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      return { kind: "missing" };
    }
    return { kind: "unreadable", code };
  }
  let root: string;
  try {
    root = realpathSync(cwd);
  } catch (error) {
    return { kind: "unreadable", code: errorCode(error) };
  }
  if (escapesRoot(root, opened)) {
    return { kind: "illegal" };
  }
  try {
    const stat = statSync(opened);
    if (!stat.isFile()) {
      return { kind: "not_file" };
    }
    return { kind: "file", path: opened, size: stat.size };
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      return { kind: "missing" };
    }
    return { kind: "unreadable", code };
  }
}

export function evaluateFileExists(pathValue: string, cwd: string): CheckEvaluation {
  const located = locateFile(cwd, pathValue);
  switch (located.kind) {
    case "file":
      return {
        status: "PASS",
        expected: EXPECTED,
        actual: { exists: true },
        reason: null,
      };
    case "missing":
      return {
        status: "FAIL",
        expected: EXPECTED,
        actual: { exists: false },
        reason: "file is missing",
      };
    case "not_file":
      return {
        status: "FAIL",
        expected: EXPECTED,
        actual: { exists: false },
        reason: "path is not a file",
      };
    case "illegal":
      return {
        status: "INCONCLUSIVE",
        expected: EXPECTED,
        actual: { error: "illegal_path" },
        reason: "path is outside the working directory",
      };
    case "unreadable":
      return {
        status: "INCONCLUSIVE",
        expected: EXPECTED,
        actual: { error: located.code },
        reason: "path is unreadable",
      };
    default: {
      const unreachable: never = located;
      throw new Error(`unhandled located file: ${String(unreachable)}`);
    }
  }
}
