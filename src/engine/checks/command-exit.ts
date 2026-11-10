import { spawnSync } from "node:child_process";
import type { CheckEvaluation } from "../aggregate.js";

const TIMEOUT_MS = 15_000;

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") {
      return code;
    }
  }
  return "unknown";
}

export function splitCommand(command: string): readonly string[] | undefined {
  const args: string[] = [];
  let current: string | undefined;
  let quote = false;
  for (const ch of command) {
    if (quote) {
      if (ch === '"') {
        quote = false;
        continue;
      }
      current = (current ?? "") + ch;
      continue;
    }
    if (ch === '"') {
      quote = true;
      current ??= "";
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (current !== undefined) {
        args.push(current);
        current = undefined;
      }
      continue;
    }
    current = (current ?? "") + ch;
  }
  if (quote) {
    return undefined;
  }
  if (current !== undefined) {
    args.push(current);
  }
  if (args.length === 0 || args[0] === "") {
    return undefined;
  }
  return args;
}

function evaluation(
  status: CheckEvaluation["status"],
  expectedCode: number,
  actual: Readonly<Record<string, unknown>>,
  reason: string | null,
): CheckEvaluation {
  return {
    status,
    expected: { exit_code: expectedCode },
    actual,
    reason,
  };
}

export function evaluateCommandExit(
  command: string,
  code: number,
  cwd: string,
): CheckEvaluation {
  const argv = splitCommand(command);
  const bin = argv?.[0];
  if (argv === undefined || bin === undefined) {
    return evaluation("INCONCLUSIVE", code, { error: "invalid_command" }, "command could not start");
  }
  const result = spawnSync(bin, argv.slice(1), {
    cwd,
    windowsHide: true,
    timeout: TIMEOUT_MS,
    shell: false,
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (result.error) {
    const errno = errorCode(result.error);
    if (errno === "ETIMEDOUT") {
      return evaluation("INCONCLUSIVE", code, { error: errno }, "command timed out");
    }
    return evaluation("INCONCLUSIVE", code, { error: errno }, "command could not start");
  }
  if (result.status === null) {
    return evaluation("INCONCLUSIVE", code, { error: "no_exit" }, "command did not exit");
  }
  if (result.status === code) {
    return evaluation("PASS", code, { exit_code: result.status }, null);
  }
  return evaluation("FAIL", code, { exit_code: result.status }, "exit code does not match");
}
