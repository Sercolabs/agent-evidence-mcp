import { randomUUID } from "node:crypto";
import { readStoredRun, saveRun } from "../storage/fs-store.js";
import { parseAgent, type Run, type RunStatus } from "./types.js";

export type EngineErrorCode =
  | "run_not_found"
  | "run_closed"
  | "run_busy"
  | "integrity_mismatch";

export class EvidenceError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = "EvidenceError";
    this.code = code;
  }
}

export class InvalidAgentError extends Error {
  readonly agent: string;

  constructor(agent: string) {
    super(`invalid agent "${agent}"`);
    this.name = "InvalidAgentError";
    this.agent = agent;
  }
}

export type CreateRunInput = {
  readonly agent: string;
  readonly task: string;
};

export type CreateRunResult = {
  readonly run: Run;
  readonly path: string;
};

export class RunTransitionError extends Error {
  readonly from: RunStatus;
  readonly to: RunStatus;

  constructor(from: RunStatus, to: RunStatus) {
    super(`cannot transition from ${from} to ${to}`);
    this.name = "RunTransitionError";
    this.from = from;
    this.to = to;
  }
}

function allowedNext(status: RunStatus): readonly RunStatus[] {
  switch (status) {
    case "open":
      return ["verifying"];
    case "verifying":
      return ["closed"];
    case "closed":
      return [];
    default: {
      const unreachable: never = status;
      throw new Error(`unhandled run status: ${String(unreachable)}`);
    }
  }
}

export function createRun(input: CreateRunInput): CreateRunResult {
  const agent = parseAgent(input.agent);
  if (agent === undefined) {
    throw new InvalidAgentError(input.agent);
  }
  if (typeof input.task !== "string") {
    throw new TypeError("task must be a string");
  }
  const run: Run = {
    id: `run_${randomUUID()}`,
    projectId: null,
    agent,
    task: input.task,
    status: "open",
    metadata: {},
    createdAt: new Date().toISOString(),
    closedAt: null,
    resultStatus: "unset",
    manifestHash: null,
  };
  const path = saveRun(run);
  return { run, path };
}

export function loadRun(id: string): Run {
  const run = readStoredRun(id);
  if (run === undefined) {
    throw new EvidenceError("run_not_found", "unknown run id");
  }
  return run;
}

export function transitionRun(run: Run, to: RunStatus): Run {
  const allowed = allowedNext(run.status);
  if (!allowed.includes(to)) {
    if (run.status === "closed") {
      throw new EvidenceError("run_closed", "run is closed");
    }
    throw new RunTransitionError(run.status, to);
  }
  if (to === "closed") {
    return {
      ...run,
      status: to,
      closedAt: new Date().toISOString(),
    };
  }
  return {
    ...run,
    status: to,
  };
}
