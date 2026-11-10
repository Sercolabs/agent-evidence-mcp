import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const workspace = mkdtempSync(join(realpathSync(tmpdir()), "agent-evidence-mcp-proof-"));
const home = join(workspace, "evidence");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../bin/agent-evidence-mcp.mjs", import.meta.url)), "--cwd", workspace],
  env: { AGENT_EVIDENCE_HOME: home },
  stderr: "pipe",
});
const client = new Client({ name: "mcp-export-proof", version: "1.0.0" });
let stderr = "";
transport.stderr?.on("data", (data) => { stderr += data; });
async function call(name, args, error) {
  const reply = await client.callTool({ name, arguments: args }, { timeout: 10000 });
  assert.equal(Boolean(reply.isError), Boolean(error), JSON.stringify(reply));
  assert.ok(reply.structuredContent, name);
  if (error) assert.equal(reply.structuredContent.code ?? reply.structuredContent.error?.code, error);
  return reply.structuredContent;
}
try {
  writeFileSync(join(workspace, "fixture.txt"), "proof\n");
  await client.connect(transport, { timeout: 10000 });
  assert.equal(client.getServerVersion()?.name, "agent-evidence");
  assert.deepEqual((await client.listTools()).tools.map(({ name }) => name).sort(), [
    "evidence_check_integrity", "evidence_create_run", "evidence_get_report", "evidence_verify",
  ]);
  for (const [path, expected] of [["fixture.txt", "PASS"], ["missing.txt", "FAIL"]]) {
    const run = await call("evidence_create_run", { agent: "cursor", task: `Expected ${expected}` });
    assert.equal((await call("evidence_verify", { run_id: run.run_id, checks: [{ type: "file_exists", path }] })).result, expected);
    const report = await call("evidence_get_report", { run_id: run.run_id });
    const saved = JSON.parse(readFileSync(report.path, "utf8"));
    assert.equal(saved.result, expected);
    assert.equal(saved.timeline.length, 1);
    assert.equal((await call("evidence_check_integrity", { run_id: run.run_id })).ok, true);
    writeFileSync(join(home, "runs", run.run_id, "checks.json"), "[]");
    await call("evidence_check_integrity", { run_id: run.run_id }, "integrity_mismatch");
  }
  const empty = await call("evidence_create_run", { agent: "cursor", task: "Empty checks" });
  assert.equal((await call("evidence_verify", { run_id: empty.run_id, checks: [] })).result, "INCONCLUSIVE");
  assert.equal(stderr, "");
  console.log("PASS: stdio handshake, four tools, run creation, file PASS/FAIL, INCONCLUSIVE, persisted reports, integrity, tamper detection");
} finally {
  await client.close();
  rmSync(workspace, { recursive: true, force: true });
}
