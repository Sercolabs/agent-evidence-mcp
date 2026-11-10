import type { CheckStatus } from "../domain/types.js";

export type CheckEvaluation = {
  readonly status: CheckStatus;
  readonly expected: Readonly<Record<string, unknown>>;
  readonly actual: Readonly<Record<string, unknown>>;
  readonly reason: string | null;
};

export function aggregateStatuses(
  statuses: readonly CheckStatus[],
): "PASS" | "FAIL" | "INCONCLUSIVE" {
  let sawInconclusive = false;
  for (const status of statuses) {
    switch (status) {
      case "FAIL":
        return "FAIL";
      case "INCONCLUSIVE":
        sawInconclusive = true;
        break;
      case "PASS":
        break;
      default: {
        const unreachable: never = status;
        throw new Error(`unhandled check status: ${String(unreachable)}`);
      }
    }
  }
  if (statuses.length === 0 || sawInconclusive) {
    return "INCONCLUSIVE";
  }
  return "PASS";
}
