export const AGENTS = ["cursor", "grok-bot"] as const;

export type Agent = (typeof AGENTS)[number];

export const RUN_STATUSES = ["open", "verifying", "closed"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const RESULT_STATUSES = ["PASS", "FAIL", "INCONCLUSIVE", "unset"] as const;

export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const CHECK_STATUSES = ["PASS", "FAIL", "INCONCLUSIVE"] as const;

export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const CHECK_TYPES = [
  "element",
  "text",
  "url",
  "api_response",
  "file_exists",
  "file_contains",
  "command_exit",
  "final_outcome",
] as const;

export type CheckType = (typeof CHECK_TYPES)[number];

export const ARTIFACT_KINDS = [
  "screenshot_before",
  "screenshot_after",
  "dom",
  "network_meta",
  "report",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export type Run = {
  readonly id: string;
  readonly projectId: string | null;
  readonly agent: Agent;
  readonly task: string;
  readonly status: RunStatus;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly resultStatus: ResultStatus;
  readonly manifestHash: string | null;
};

export type Check = {
  readonly id: string;
  readonly runId: string;
  readonly actionId: string | null;
  readonly type: CheckType;
  readonly params: Readonly<Record<string, unknown>>;
  readonly expected: Readonly<Record<string, unknown>> | null;
  readonly actual: Readonly<Record<string, unknown>> | null;
  readonly status: CheckStatus;
  readonly reason: string | null;
  readonly checkedAt: string;
};

export type Artifact = {
  readonly id: string;
  readonly runId: string;
  readonly actionId: string | null;
  readonly kind: ArtifactKind;
  readonly contentType: string;
  readonly storageUri: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly createdAt: string;
  readonly source: string;
  readonly redactionFlags: readonly string[];
};

export function parseAgent(value: unknown): Agent | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  for (const agent of AGENTS) {
    if (agent === value) {
      return agent;
    }
  }
  return undefined;
}

export function parseRunStatus(value: unknown): RunStatus | undefined {
  for (const status of RUN_STATUSES) {
    if (value === status) {
      return status;
    }
  }
  return undefined;
}

export function parseResultStatus(value: unknown): ResultStatus | undefined {
  for (const status of RESULT_STATUSES) {
    if (value === status) {
      return status;
    }
  }
  return undefined;
}
