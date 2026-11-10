import { specTypeSchemas, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { checkIntegrity, finalizeReport } from "../domain/report.js";
import { createRun, EvidenceError, type EngineErrorCode } from "../domain/run.js";
import { AGENTS, CHECK_TYPES } from "../domain/types.js";
import { InvalidCheckError, parseCheckValue } from "../engine/parse-check.js";
import { verifyRun } from "../engine/verify-runner.js";

type ToolOutput = Record<string, unknown>;
type ToolErrorCode =
  | EngineErrorCode
  | "invalid_arguments"
  | "invalid_check"
  | "unknown_tool"
  | "verification_failed";

function success(output: ToolOutput): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

export function toolFailure(
  code: ToolErrorCode,
  message: string,
  details?: ToolOutput,
): CallToolResult {
  return {
    ...success({ ...details, code, message }),
    isError: true,
  };
}

function defineTool<Schema extends z.ZodObject>(
  name: string,
  description: string,
  schema: Schema,
  run: (input: z.output<Schema>) => CallToolResult | Promise<CallToolResult>,
) {
  const descriptor = specTypeSchemas.Tool["~standard"].validate({
    name,
    description,
    inputSchema: z.toJSONSchema(schema, { io: "input" }),
  });
  if (descriptor.issues) {
    throw new Error(`invalid MCP descriptor for "${name}"`);
  }

  return {
    descriptor: descriptor.value,
    async call(args: unknown): Promise<CallToolResult> {
      try {
        const input = schema.safeParse(args);
        if (!input.success) {
          return toolFailure("invalid_arguments", z.prettifyError(input.error));
        }
        return await run(input.data);
      } catch (error) {
        if (error instanceof InvalidCheckError) {
          return toolFailure("invalid_check", error.message);
        }
        if (error instanceof EvidenceError) {
          return toolFailure(error.code, error.message);
        }
        return toolFailure(
          "verification_failed",
          "the evidence operation could not be completed",
        );
      }
    },
  };
}

const runInput = z.strictObject({ run_id: z.string() });
const checkInput = z.unknown().meta({
  type: "object",
  properties: { type: { enum: CHECK_TYPES } },
  required: ["type"],
  description: "Use flat check parameters. For final_outcome, pass a nested checks array.",
});

export function evidenceTools(cwd: string) {
  const verifying = new Set<string>();
  function assertIdle(runId: string): void {
    if (verifying.has(runId)) {
      throw new EvidenceError("run_busy", "another call is verifying this run");
    }
  }

  const tools = [
    defineTool(
      "evidence_create_run",
      "Create an evidence run for an agent task.",
      z.strictObject({ agent: z.enum(AGENTS), task: z.string() }),
      (input) => {
        const { run, path } = createRun(input);
        return success({ run_id: run.id, status: run.status, path });
      },
    ),
    defineTool(
      "evidence_verify",
      "Run declarative checks and persist the evidence. FAIL and INCONCLUSIVE are check results.",
      runInput.extend({
        checks: z.array(checkInput),
        screenshot: z.boolean().optional().describe("Capture browser screenshots. Defaults to true."),
        agent: z.string().optional().describe("Accepted for compatibility. The run retains its original agent."),
        task: z.string().optional().describe("Accepted for compatibility. The run retains its original task."),
      }),
      async ({ run_id, checks, screenshot }) => {
        const parsed = checks.map((check) => parseCheckValue(check));
        assertIdle(run_id);
        verifying.add(run_id);
        try {
          const result = await verifyRun({ runId: run_id, checks: parsed, screenshot, cwd });
          return success({ run_id, ...result });
        } finally {
          verifying.delete(run_id);
        }
      },
    ),
    defineTool(
      "evidence_get_report",
      "Return the verified report and its saved path.",
      runInput,
      ({ run_id }) => {
        assertIdle(run_id);
        return success({ run_id, ...finalizeReport({ runId: run_id }) });
      },
    ),
    defineTool(
      "evidence_check_integrity",
      "Rehash stored evidence and compare it with the verified manifest.",
      runInput,
      ({ run_id }) => {
        assertIdle(run_id);
        const result = checkIntegrity({ runId: run_id });
        if (result.ok) {
          return success({ run_id, ...result });
        }
        const missing = result.issues.some((issue) => issue.code === "run_not_found");
        return toolFailure(
          missing ? "run_not_found" : "integrity_mismatch",
          missing ? "unknown run id" : "stored evidence failed integrity checks",
          { run_id, ...result },
        );
      },
    ),
  ];
  return new Map(tools.map((tool) => [tool.descriptor.name, tool]));
}
