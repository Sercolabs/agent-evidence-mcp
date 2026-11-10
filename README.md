# Agent Evidence MCP

agent-evidence verifies files, command exit codes, web pages, and HTTP responses. It exports JSON reports and checks stored evidence for changes. create-run remains a CLI stub.

## Install

Use Node.js 20 or later. From this repository, run:

```sh
npm ci
npm run build
npm test
```

For browser checks, also run `npx playwright install chromium`. On Linux, use `npx playwright install --with-deps chromium` if system libraries are missing. File, command, and HTTP checks do not need Chromium.

## Connect an MCP client

Set absolute paths for this repository and the workspace you want to verify:

```json
{
	"mcpServers": {
		"agent-evidence": {
			"type": "stdio",
			"command": "node",
			"args": ["/absolute/path/to/agent-evidence-mcp/bin/agent-evidence-mcp.mjs", "--cwd", "/absolute/path/to/workspace"],
			"env": {"AGENT_EVIDENCE_HOME": "/absolute/path/to/private/evidence"}
		}
	}
}
```

Without `--cwd`, the server uses its process working directory. It exposes `evidence_create_run`, `evidence_verify`, `evidence_get_report`, and `evidence_check_integrity`. Evidence persists under `AGENT_EVIDENCE_HOME`, or the platform default. Keep that directory private. Command checks execute commands with the server user's permissions. Browser checks can capture screenshots.

`npm test` drives the built server through the official MCP client. It checks file success and failure, saved reports, and evidence integrity in a temporary private workspace.
