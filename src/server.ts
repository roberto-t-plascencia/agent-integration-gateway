/**
 * MCP server over stdio. The agent identity comes from AGENT_ID in the launch
 * config (one process per agent). See README for the HTTP + OAuth version.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGateway, inMemoryRepo } from "./gateway.js";
import { examplePolicy } from "./policy.js";
import { TraceStore } from "./traces.js";

const agentId = process.env.AGENT_ID;
if (!agentId) {
  console.error("Set AGENT_ID to the calling agent's ID (see src/policy.ts).");
  process.exit(1);
}

const server = createGateway({
  agentId,
  policy: examplePolicy,
  traces: new TraceStore(process.env.TRACE_LOG ?? "data/decision-traces.jsonl"),
  repo: inMemoryRepo(),
});

await server.connect(new StdioServerTransport());
console.error(`agent-integration-gateway running on stdio for ${agentId}`);
