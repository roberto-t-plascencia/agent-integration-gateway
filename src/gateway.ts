/**
 * The MCP gateway: every tool a third-party agent can call goes through the
 * same guard — authorize, execute, trace — so no tool can skip entitlements
 * or the decision log.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { authorize, PURPOSES, vendorOf, type AgentGrant, type Purpose } from "./policy.js";
import { hashInput, type TraceStore } from "./traces.js";

/** Stand-in for a system of record. */
export interface EngagementRepo {
  get(clientId: string): { clientId: string; name: string; type: string; status: string } | undefined;
  addFinding(clientId: string, finding: { title: string; severity: string; detail: string }): string;
}

export function inMemoryRepo(): EngagementRepo {
  const engagements = new Map([
    ["client-001", { clientId: "client-001", name: "Northwind Manufacturing", type: "audit", status: "fieldwork" }],
    ["client-002", { clientId: "client-002", name: "Contoso Health", type: "advisory", status: "planning" }],
    ["client-003", { clientId: "client-003", name: "Fabrikam Retail", type: "tax", status: "review" }],
  ]);
  let n = 0;
  return {
    get: (id) => engagements.get(id),
    addFinding: () => `finding-${++n}`,
  };
}

export interface GatewayContext {
  /** Identity of the calling agent. Over stdio this comes from launch config; over HTTP it would come from a verified OAuth token. */
  agentId: string;
  policy: readonly AgentGrant[];
  traces: TraceStore;
  repo: EngagementRepo;
}

const purpose = z.enum(PURPOSES).describe("Why the agent needs this data (permissible use)");

function text(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

export function createGateway(ctx: GatewayContext): McpServer {
  const server = new McpServer({ name: "agent-integration-gateway", version: "0.1.0" });
  const vendor = vendorOf(ctx.policy, ctx.agentId);

  /** authorize -> run -> trace. Denials and errors are traced too. */
  async function guarded(
    tool: string,
    args: { purpose: Purpose; clientId?: string } & Record<string, unknown>,
    run: () => Promise<unknown> | unknown,
  ): Promise<CallToolResult> {
    const started = Date.now();
    const base = {
      kind: "tool_call" as const,
      name: tool,
      agentId: ctx.agentId,
      vendor,
      purpose: args.purpose,
      clientId: args.clientId,
      inputHash: hashInput(args),
    };
    const decision = authorize(ctx.policy, { agentId: ctx.agentId, tool, purpose: args.purpose, clientId: args.clientId });
    if (!decision.allowed) {
      ctx.traces.append({ ...base, decision: "denied", reason: decision.reason });
      return { ...text(`Denied: ${decision.reason}`), isError: true };
    }
    try {
      const result = await run();
      ctx.traces.append({ ...base, decision: "allowed", reason: decision.reason, outcome: "ok", latencyMs: Date.now() - started });
      return text(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.traces.append({ ...base, decision: "allowed", reason: decision.reason, outcome: "error", latencyMs: Date.now() - started });
      return { ...text(`Error: ${message}`), isError: true };
    }
  }

  server.registerTool(
    "get_engagement",
    {
      title: "Get engagement",
      description: "Read the engagement summary for a client the agent is entitled to.",
      inputSchema: { clientId: z.string(), purpose },
    },
    (args) =>
      guarded("get_engagement", args, () => {
        const e = ctx.repo.get(args.clientId);
        if (!e) throw new Error(`no engagement for ${args.clientId}`);
        return e;
      }),
  );

  server.registerTool(
    "record_finding",
    {
      title: "Record finding",
      description: "Propose a finding on an engagement. Findings are drafts until a practitioner approves them.",
      inputSchema: {
        clientId: z.string(),
        purpose,
        title: z.string().min(3),
        severity: z.enum(["low", "medium", "high"]),
        detail: z.string().min(10),
      },
    },
    (args) =>
      guarded("record_finding", args, () => ({
        findingId: ctx.repo.addFinding(args.clientId, args),
        status: "draft_pending_practitioner_review",
      })),
  );

  server.registerTool(
    "export_decision_traces",
    {
      title: "Export decision traces",
      description: "Export the firm-owned decision trace log as JSONL, optionally filtered by vendor or agent.",
      inputSchema: { purpose, vendor: z.string().optional(), agentId: z.string().optional(), since: z.string().datetime().optional() },
    },
    (args) => guarded("export_decision_traces", args, () => ctx.traces.export(args)),
  );

  server.registerTool(
    "verify_decision_traces",
    {
      title: "Verify decision traces",
      description: "Recompute the hash chain of the decision trace log and report any tampering.",
      inputSchema: { purpose },
    },
    (args) => guarded("verify_decision_traces", args, () => ctx.traces.verify()),
  );

  return server;
}
