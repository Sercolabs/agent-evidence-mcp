import { randomUUID } from "node:crypto";
import { EvidenceError, loadRun } from "../domain/run.js";
import type { CheckStatus } from "../domain/types.js";
import { runDir } from "../storage/paths.js";
import { commitVerification, type StoredCheck } from "../storage/manifest.js";
import { aggregateStatuses, type CheckEvaluation } from "./aggregate.js";
import { evaluateCommandExit } from "./checks/command-exit.js";
import { evaluateFileContains } from "./checks/file-contains.js";
import { evaluateFileExists } from "./checks/file-exists.js";

import type { VerifyCheck, NonBrowserCheck } from "./check-types.js";
import { evaluateApiResponse } from "./checks/api-response.js";
export type { VerifyCheck, NonBrowserCheck } from "./check-types.js";

export type VerifyRow = {
  readonly type: VerifyCheck["type"];
  readonly status: CheckStatus;
  readonly reason: string | null;
};

export type VerifyOutput = {
  readonly result: "PASS" | "FAIL" | "INCONCLUSIVE";
  readonly rows: readonly VerifyRow[];
  readonly screenshots: readonly string[];
};

type CheckRow = StoredCheck;

function paramsOf(check: VerifyCheck): Readonly<Record<string, unknown>> {
  switch (check.type) {
    case "file_exists":
      return { path: check.path };
    case "file_contains":
      switch (check.match.kind) {
        case "text":
          return { path: check.path, text: check.match.value };
        case "regex":
          return { path: check.path, regex: check.match.source };
        default: {
          const unreachable: never = check.match;
          throw new Error(`unhandled match: ${String(unreachable)}`);
        }
      }
    case "command_exit":
      return { command: check.command, code: check.code };
    case "url":
    case "text":
    case "element":
    case "api_response":
    case "final_outcome": {
      const { type, ...params } = check;
      return params;
    }
    default: {
      const unreachable: never = check;
      throw new Error(`unhandled check: ${String(unreachable)}`);
    }
  }
}

function evaluate(check: NonBrowserCheck, cwd: string): CheckEvaluation {
  switch (check.type) {
    case "file_exists":
      return evaluateFileExists(check.path, cwd);
    case "file_contains":
      return evaluateFileContains(check.path, check.match, cwd);
    case "command_exit":
      return evaluateCommandExit(check.command, check.code, cwd);
    default: {
      const unreachable: never = check;
      throw new Error(`unhandled check: ${String(unreachable)}`);
    }
  }
}

export async function verifyRun(input: {
  readonly runId: string;
  readonly checks: readonly VerifyCheck[];
  readonly screenshot?: boolean;
  readonly cwd: string;
}): Promise<VerifyOutput> {
  const run = loadRun(input.runId);
  if (run.status === "closed") {
    throw new EvidenceError("run_closed", "run is closed");
  }
  const checkedAt = new Date().toISOString();
  const dir = runDir(run.id);
  if (dir === undefined)
    throw new EvidenceError("run_not_found", "unknown run id");
  const artifactDir: string = dir;
  async function evaluateCheck(check: VerifyCheck): Promise<CheckRow> {
    let evaluation: CheckEvaluation;
    switch (check.type) {
      case "url":
      case "text":
      case "element": {
        const { evaluateBrowserCheck } =
          await import("../browser/playwright-page.js");
        evaluation = await evaluateBrowserCheck(
          check,
          artifactDir,
          input.screenshot !== false,
        );
        break;
      }
      case "api_response":
        evaluation = await evaluateApiResponse(check);
        break;
      case "final_outcome": {
        const children: CheckRow[] = [];
        for (const child of check.checks)
          children.push(await evaluateCheck(child));
        const status = aggregateStatuses(children.map((child) => child.status));
        evaluation = {
          status,
          expected: { status: "PASS" },
          actual: { checks: children },
          reason: status === "PASS" ? null : "child checks did not all pass",
        };
        break;
      }
      default:
        evaluation = evaluate(check, input.cwd);
    }
    return {
      id: `chk_${randomUUID()}`,
      run_id: run.id,
      action_id: null,
      type: check.type,
      params: paramsOf(check),
      expected: evaluation.expected,
      actual: evaluation.actual,
      status: evaluation.status,
      reason: evaluation.reason,
      checked_at: checkedAt,
    };
  }
  const rows: CheckRow[] = [];
  for (const check of input.checks) rows.push(await evaluateCheck(check));
  const result = aggregateStatuses(rows.map((row) => row.status));
  const committed = commitVerification({ run, checks: rows });
  return {
    result,
    screenshots: committed.screenshots,
    rows: rows.map((row) => ({
      type: row.type,
      status: row.status,
      reason: row.reason,
    })),
  };
}
