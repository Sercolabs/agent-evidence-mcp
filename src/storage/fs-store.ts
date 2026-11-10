import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseAgent, parseResultStatus, parseRunStatus, type Run } from "../domain/types.js";
import { runJsonPath } from "./paths.js";

type RunFile = {
  readonly id: string;
  readonly project_id: string | null;
  readonly agent: string;
  readonly task: string;
  readonly status: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly created_at: string;
  readonly closed_at: string | null;
  readonly result_status: string;
  readonly manifest_hash: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`run.json field ${field} is invalid`);
  }
  return value;
}

function parseNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return parseString(value, field);
}

function parseRunFile(value: unknown, expectedId: string): Run {
  if (!isRecord(value)) {
    throw new Error("run.json is not an object");
  }
  const id = parseString(value.id, "id");
  if (id !== expectedId) {
    throw new Error("run.json id does not match the directory");
  }
  const agent = parseAgent(value.agent);
  const status = parseRunStatus(value.status);
  const resultStatus = parseResultStatus(value.result_status);
  if (agent === undefined || status === undefined || resultStatus === undefined) {
    throw new Error("run.json has an invalid enum");
  }
  if (!isRecord(value.metadata)) {
    throw new Error("run.json metadata is invalid");
  }
  return {
    id,
    projectId: parseNullableString(value.project_id, "project_id"),
    agent,
    task: parseString(value.task, "task"),
    status,
    metadata: value.metadata,
    createdAt: parseString(value.created_at, "created_at"),
    closedAt: parseNullableString(value.closed_at, "closed_at"),
    resultStatus,
    manifestHash: parseNullableString(value.manifest_hash, "manifest_hash"),
  };
}

function toRunFile(run: Run): RunFile {
  return {
    id: run.id,
    project_id: run.projectId,
    agent: run.agent,
    task: run.task,
    status: run.status,
    metadata: run.metadata,
    created_at: run.createdAt,
    closed_at: run.closedAt,
    result_status: run.resultStatus,
    manifest_hash: run.manifestHash,
  };
}

export function saveRun(run: Run): string {
  const file = runJsonPath(run.id);
  if (file === undefined) {
    throw new Error("run id is not safe to store");
  }
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, "run.json.tmp");
  const json = `${JSON.stringify(toRunFile(run))}\n`;
  const fd = openSync(temp, "w");
  try {
    writeFileSync(fd, json);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
  return file;
}

export function readStoredRun(id: string): Run | undefined {
  const file = runJsonPath(id);
  if (file === undefined || !existsSync(file)) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return parseRunFile(parsed, id);
}
