import { readFileSync } from "node:fs";
import type { CheckEvaluation } from "../aggregate.js";
import { locateFile } from "./file-exists.js";

const MAX_BYTES = 1_048_576;

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") {
      return code;
    }
  }
  return "unknown";
}

export type FileContainsMatch =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "regex"; readonly source: string };

function expectedOf(match: FileContainsMatch): Readonly<Record<string, unknown>> {
  switch (match.kind) {
    case "text":
      return { text: match.value };
    case "regex":
      return { regex: match.source };
    default: {
      const unreachable: never = match;
      throw new Error(`unhandled match: ${String(unreachable)}`);
    }
  }
}

function inconclusive(
  match: FileContainsMatch,
  reason: string,
  error: string,
): CheckEvaluation {
  return {
    status: "INCONCLUSIVE",
    expected: expectedOf(match),
    actual: { error },
    reason,
  };
}

function matches(text: string, match: FileContainsMatch): boolean {
  switch (match.kind) {
    case "text":
      return text.includes(match.value);
    case "regex":
      return new RegExp(match.source).test(text);
    default: {
      const unreachable: never = match;
      throw new Error(`unhandled match: ${String(unreachable)}`);
    }
  }
}

export function evaluateFileContains(
  pathValue: string,
  match: FileContainsMatch,
  cwd: string,
): CheckEvaluation {
  const located = locateFile(cwd, pathValue);
  switch (located.kind) {
    case "illegal":
      return inconclusive(match, "path is outside the working directory", "illegal_path");
    case "missing":
    case "not_file":
      return inconclusive(match, "file is missing or unreadable", located.kind);
    case "unreadable":
      return inconclusive(match, "file is missing or unreadable", located.code);
    case "file": {
      if (located.size > MAX_BYTES) {
        return inconclusive(match, "file is too large to read", "too_large");
      }
      let text: string;
      try {
        text = readFileSync(located.path, "utf8");
      } catch (error) {
        return inconclusive(match, "file is missing or unreadable", errorCode(error));
      }
      const expected = expectedOf(match);
      let matched = false;
      try {
        matched = matches(text, match);
      } catch {
        return inconclusive(match, "pattern is invalid", "invalid_regex");
      }
      if (matched) {
        return {
          status: "PASS",
          expected,
          actual: { matched: true },
          reason: null,
        };
      }
      return {
        status: "FAIL",
        expected,
        actual: { matched: false },
        reason: "contents do not match",
      };
    }
    default: {
      const unreachable: never = located;
      throw new Error(`unhandled located file: ${String(unreachable)}`);
    }
  }
}
