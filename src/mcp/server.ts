import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { evidenceTools, toolFailure } from "./tools.js";

export function startEvidenceMcp(cwd: string): void {
  serveStdio(() => {
    const server = new McpServer(
      { name: "agent-evidence", version: "0.0.0" },
      { capabilities: { tools: {} } },
    );
    const tools = evidenceTools(cwd);
    server.server.setRequestHandler("tools/list", () => ({
      tools: Array.from(tools.values(), (tool) => tool.descriptor),
    }));
    server.server.setRequestHandler("tools/call", ({ params }) => {
      const tool = tools.get(params.name);
      return tool
        ? tool.call(params.arguments)
        : toolFailure("unknown_tool", `unknown tool "${params.name}"`);
    });
    return server;
  }, { onerror: (error) => console.error(error.message) });
}
