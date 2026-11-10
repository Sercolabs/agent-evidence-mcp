import { homedir } from "node:os";
import { join, resolve } from "node:path";

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function isSafeRunId(runId: string): boolean {
  return SAFE_RUN_ID.test(runId);
}

export function evidenceHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AGENT_EVIDENCE_HOME?.trim() ?? "";
  if (override.length > 0) {
    return resolve(override);
  }
  return join(homedir(), ".agent-evidence");
}

export function runDir(
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!isSafeRunId(runId)) {
    return undefined;
  }
  return join(evidenceHome(env), "runs", runId);
}

export function runJsonPath(
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const dir = runDir(runId, env);
  if (dir === undefined) {
    return undefined;
  }
  return join(dir, "run.json");
}
