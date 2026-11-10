import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { EvidenceError } from "../domain/run.js";
import {
  CHECK_STATUSES,
  CHECK_TYPES,
  type CheckStatus,
  type CheckType,
  type Run,
} from "../domain/types.js";
import { aggregateStatuses } from "../engine/aggregate.js";
import { readStoredRun, saveRun } from "./fs-store.js";
import { canonicalJson, sha256 } from "./hash.js";
import { evidenceHome, runDir } from "./paths.js";

export type StoredCheck = {
  readonly id: string;
  readonly run_id: string;
  readonly action_id: string | null;
  readonly type: CheckType;
  readonly params: Readonly<Record<string, unknown>>;
  readonly expected: Readonly<Record<string, unknown>> | null;
  readonly actual: Readonly<Record<string, unknown>> | null;
  readonly status: CheckStatus;
  readonly reason: string | null;
  readonly checked_at: string;
};
export type CapturedArtifact = {
  readonly id: string;
  readonly check_id: string;
  readonly kind: "screenshot_after";
  readonly storage_uri: string;
  readonly sha256: string;
  readonly byte_size: number;
  readonly content_type: "image/png";
  readonly created_at: string;
  readonly source: "verify-engine";
};
export type TimelineEntry = {
  readonly check_id: string;
  readonly parent_check_id: string | null;
  readonly index: readonly number[];
  readonly checked_at: string;
  readonly type: CheckType;
  readonly status: CheckStatus;
};
export type EvidenceReport = {
  readonly version: 1;
  readonly run: Omit<Run, "manifestHash">;
  readonly manifest_hash: string;
  readonly result: CheckStatus;
  readonly checks: readonly StoredCheck[];
  readonly timeline: readonly TimelineEntry[];
  readonly artifacts: readonly CapturedArtifact[];
};
export type IntegrityIssue = {
  readonly code: string;
  readonly path: string;
  readonly expected: string | null;
  readonly actual: string | null;
};
export type IntegrityResult =
  | {
      readonly status: "PASS";
      readonly ok: true;
      readonly manifestHash: string;
      readonly issues: readonly [];
    }
  | {
      readonly status: "FAIL";
      readonly ok: false;
      readonly manifestHash: string | null;
      readonly issues: readonly [IntegrityIssue, ...IntegrityIssue[]];
    };

type Manifest = {
  readonly version: 1;
  readonly run: Omit<Run, "manifestHash">;
  readonly checks: {
    readonly path: "checks.json";
    readonly sha256: string;
    readonly byte_size: number;
  };
  readonly artifacts: readonly CapturedArtifact[];
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function timestamp(value: unknown): value is string {
  return text(value) && Number.isFinite(Date.parse(value));
}
function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
function checkType(value: unknown): value is CheckType {
  return CHECK_TYPES.some((type) => type === value);
}
function checkStatus(value: unknown): value is CheckStatus {
  return CHECK_STATUSES.some((status) => status === value);
}
function safeDirectory(runId: string): string {
  const dir = runDir(runId);
  if (dir === undefined)
    throw new EvidenceError("run_not_found", "unknown run id");
  try {
    for (const path of [evidenceHome(), join(evidenceHome(), "runs"), dir]) {
      if (!lstatSync(path).isDirectory())
        throw new Error(`unsafe evidence path: ${path}`);
    }
  } catch (error) {
    if (record(error) && error.code === "ENOENT")
      throw new EvidenceError("run_not_found", "unknown run id");
    throw error;
  }
  return dir;
}
function safeFile(dir: string, relative: string): string {
  if (
    !["run.json", "checks.json", "manifest.json", "report.json"].includes(
      relative,
    ) &&
    !/^artifacts\/[A-Za-z0-9_-]+\.png$/.test(relative)
  )
    throw new Error(`unsafe evidence path: ${relative}`);
  if (
    relative.startsWith("artifacts/") &&
    lstatSync(join(dir, "artifacts")).isSymbolicLink()
  )
    throw new Error("unsafe evidence path: artifacts");
  const file = join(dir, relative);
  try {
    if (!lstatSync(file).isFile())
      throw new Error(`unsafe evidence path: ${relative}`);
  } catch (error) {
    if (!record(error) || error.code !== "ENOENT") throw error;
  }
  return file;
}
function parseChecks(
  value: unknown,
  runId: string,
): {
  checks: readonly StoredCheck[];
  artifacts: CapturedArtifact[];
  timeline: TimelineEntry[];
} {
  const ids = new Set<string>();
  const artifactIds = new Set<string>();
  const paths = new Set<string>();
  const artifacts: CapturedArtifact[] = [];
  const timeline: TimelineEntry[] = [];
  function parseList(
    input: unknown,
    parent: string | null,
    prefix: readonly number[],
  ): StoredCheck[] {
    if (!Array.isArray(input) || prefix.length > 16)
      throw new Error("invalid checks array or nesting");
    return input.map((row: unknown, index) => {
      if (
        !record(row) ||
        !text(row.id) ||
        ids.has(row.id) ||
        row.run_id !== runId ||
        !nullableText(row.action_id) ||
        !checkType(row.type) ||
        !record(row.params) ||
        !(row.expected === null || record(row.expected)) ||
        !(row.actual === null || record(row.actual)) ||
        !checkStatus(row.status) ||
        !nullableText(row.reason) ||
        !timestamp(row.checked_at)
      )
        throw new Error("invalid or duplicate check metadata");
      ids.add(row.id);
      const position = [...prefix, index];
      timeline.push({
        check_id: row.id,
        parent_check_id: parent,
        index: position,
        checked_at: row.checked_at,
        type: row.type,
        status: row.status,
      });
      if (row.type === "final_outcome") {
        const children = parseList(row.actual?.checks, row.id, position);
        if (
          aggregateStatuses(children.map((child) => child.status)) !==
          row.status
        )
          throw new Error("final_outcome status disagrees with children");
      }
      if (row.actual && "screenshot" in row.actual) {
        const art = row.actual.screenshot;
        if (
          !["url", "text", "element"].includes(row.type) ||
          !record(art) ||
          !text(art.id) ||
          artifactIds.has(art.id) ||
          !text(art.storage_uri) ||
          !/^artifacts\/[A-Za-z0-9_-]+\.png$/.test(art.storage_uri) ||
          paths.has(art.storage_uri) ||
          !digest(art.sha256) ||
          typeof art.byte_size !== "number" ||
          !Number.isSafeInteger(art.byte_size) ||
          art.byte_size < 0 ||
          art.kind !== "screenshot_after" ||
          art.content_type !== "image/png" ||
          !timestamp(art.created_at) ||
          art.source !== "verify-engine"
        )
          throw new Error("invalid, duplicate, or unsafe screenshot metadata");
        artifactIds.add(art.id);
        paths.add(art.storage_uri);
        artifacts.push({
          id: art.id,
          check_id: row.id,
          kind: art.kind,
          storage_uri: art.storage_uri,
          sha256: art.sha256,
          byte_size: art.byte_size,
          content_type: art.content_type,
          created_at: art.created_at,
          source: art.source,
        });
      }
      return {
        id: row.id,
        run_id: runId,
        action_id: row.action_id,
        type: row.type,
        params: row.params,
        expected: row.expected,
        actual: row.actual,
        status: row.status,
        reason: row.reason,
        checked_at: row.checked_at,
      };
    });
  }
  const checks = parseList(value, null, []);
  artifacts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { checks, artifacts, timeline };
}
function snapshot(run: Run): Omit<Run, "manifestHash"> {
  const { manifestHash, ...rest } = run;
  return rest;
}
function manifestFor(
  run: Run,
  bytes: Buffer,
  artifacts: readonly CapturedArtifact[],
): Manifest {
  return {
    version: 1,
    run: snapshot(run),
    checks: {
      path: "checks.json",
      sha256: sha256(bytes),
      byte_size: bytes.byteLength,
    },
    artifacts,
  };
}
function reportFor(
  run: Run,
  parsed: ReturnType<typeof parseChecks>,
  hash: string,
): EvidenceReport {
  return {
    version: 1,
    run: snapshot(run),
    manifest_hash: hash,
    result: aggregateStatuses(parsed.checks.map((check) => check.status)),
    ...parsed,
  };
}
function atomicWrite(file: string, bytes: string): void {
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temp, "wx");
  try {
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
}

function withEvidenceWriter<T>(dir: string, write: () => T): T {
  const lock = join(dir, ".evidence-writer");
  try {
    closeSync(openSync(lock, "wx"));
  } catch (error) {
    if (record(error) && error.code === "EEXIST") {
      throw new EvidenceError("run_busy", "another command is writing evidence for this run");
    }
    throw error;
  }
  try {
    return write();
  } finally {
    rmSync(lock);
  }
}
function artifactIssues(
  dir: string,
  artifacts: readonly CapturedArtifact[],
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  for (const artifact of artifacts) {
    try {
      const bytes = readFileSync(safeFile(dir, artifact.storage_uri));
      const actual = sha256(bytes);
      if (actual !== artifact.sha256 || bytes.byteLength !== artifact.byte_size)
        issues.push({
          code: "artifact_mismatch",
          path: artifact.storage_uri,
          expected: `${artifact.sha256}:${artifact.byte_size}`,
          actual: `${actual}:${bytes.byteLength}`,
        });
    } catch (error) {
      issues.push({
        code: "artifact_unreadable",
        path: artifact.storage_uri,
        expected: artifact.sha256,
        actual: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return issues;
}
export function commitVerification(input: {
  readonly run: Run;
  readonly checks: readonly StoredCheck[];
}): { readonly run: Run; readonly screenshots: readonly string[] } {
  const dir = safeDirectory(input.run.id);
  const captured: unknown = JSON.parse(JSON.stringify(input.checks));
  const bytes = Buffer.from(canonicalJson(captured));
  const parsed = parseChecks(JSON.parse(bytes.toString("utf8")), input.run.id);
  const issues = artifactIssues(dir, parsed.artifacts);
  if (issues.length > 0)
    throw new EvidenceError("integrity_mismatch", JSON.stringify(issues));
  const run = {
    ...input.run,
    resultStatus: aggregateStatuses(parsed.checks.map((check) => check.status)),
  };
  const manifest = canonicalJson(manifestFor(run, bytes, parsed.artifacts));
  const anchored = { ...run, manifestHash: sha256(manifest) };
  withEvidenceWriter(dir, () => {
    rmSync(safeFile(dir, "report.json"), { force: true });
    atomicWrite(safeFile(dir, "checks.json"), bytes.toString("utf8"));
    atomicWrite(safeFile(dir, "manifest.json"), manifest);
    saveRun(anchored);
  });
  return {
    run: anchored,
    screenshots: parsed.artifacts.map((art) => join(dir, art.storage_uri)),
  };
}
function inspect(runId: string): {
  readonly result: IntegrityResult;
  readonly report?: EvidenceReport;
  readonly path?: string;
} {
  let manifestHash: string | null = null;
  let currentPath = "run.json";
  const issues: IntegrityIssue[] = [];
  try {
    const dir = safeDirectory(runId);
    safeFile(dir, "run.json");
    const run = readStoredRun(runId);
    if (!run) throw new EvidenceError("run_not_found", "unknown run id");
    manifestHash = run.manifestHash;
    if (!digest(manifestHash))
      throw new Error(
        "evidence unavailable: reverify this run to establish a manifest hash",
      );
    currentPath = "manifest.json";
    const manifestBytes = readFileSync(safeFile(dir, currentPath));
    const manifest: unknown = JSON.parse(manifestBytes.toString("utf8"));
    const actualHash = sha256(canonicalJson(manifest));
    if (actualHash !== manifestHash)
      issues.push({
        code: "manifest_mismatch",
        path: currentPath,
        expected: manifestHash,
        actual: actualHash,
      });
    currentPath = "checks.json";
    const bytes = readFileSync(safeFile(dir, currentPath));
    const parsed = parseChecks(JSON.parse(bytes.toString("utf8")), runId);
    const expected = manifestFor(run, bytes, parsed.artifacts);
    if (canonicalJson(manifest) !== canonicalJson(expected))
      issues.push({
        code: "metadata_mismatch",
        path: "manifest.json",
        expected: canonicalJson(expected),
        actual: canonicalJson(manifest),
      });
    if (
      run.resultStatus !==
      aggregateStatuses(parsed.checks.map((check) => check.status))
    )
      throw new Error("run result disagrees with checks");
    issues.push(...artifactIssues(dir, parsed.artifacts));
    const report = reportFor(run, parsed, manifestHash);
    currentPath = "report.json";
    const path = safeFile(dir, currentPath);
    if (existsSync(path)) {
      const actual = readFileSync(path);
      const expectedBytes = Buffer.from(canonicalJson(report));
      if (!actual.equals(expectedBytes))
        issues.push({
          code: "report_mismatch",
          path: currentPath,
          expected: sha256(expectedBytes),
          actual: sha256(actual),
        });
    }
    const [first, ...rest] = issues;
    if (first)
      return {
        result: {
          status: "FAIL",
          ok: false,
          manifestHash,
          issues: [first, ...rest],
        },
      };
    return {
      result: { status: "PASS", ok: true, manifestHash, issues: [] },
      report,
      path,
    };
  } catch (error) {
    const missingRun =
      (error instanceof EvidenceError && error.code === "run_not_found") ||
      (currentPath === "run.json" && record(error) && error.code === "ENOENT");
    const issue = {
      code: missingRun ? "run_not_found" : "invalid_evidence",
      path: currentPath,
      expected: null,
      actual: error instanceof Error ? error.message : String(error),
    };
    return {
      result: {
        status: "FAIL",
        ok: false,
        manifestHash,
        issues: [issue, ...issues],
      },
    };
  }
}
export function checkIntegrity(input: {
  readonly runId: string;
}): IntegrityResult {
  return inspect(input.runId).result;
}
export function finalizeReport(input: { readonly runId: string }): {
  readonly report: EvidenceReport;
  readonly path: string;
} {
  return withEvidenceWriter(safeDirectory(input.runId), () => {
    const inspected = inspect(input.runId);
    if (!inspected.result.ok || !inspected.report || !inspected.path) {
      if (inspected.result.issues.some((issue) => issue.code === "run_not_found"))
        throw new EvidenceError("run_not_found", "unknown run id");
      throw new EvidenceError(
        "integrity_mismatch",
        JSON.stringify(inspected.result),
      );
    }
    if (!existsSync(inspected.path))
      atomicWrite(inspected.path, canonicalJson(inspected.report));
    return { report: inspected.report, path: inspected.path };
  });
}
