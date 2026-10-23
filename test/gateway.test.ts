/** End-to-end: a real MCP client calls the gateway over an in-memory transport. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createGateway, inMemoryRepo } from "../src/gateway.js";
import { examplePolicy } from "../src/policy.js";
import { TraceStore } from "../src/traces.js";
import { tempFile } from "./helpers.js";

async function connect(agentId: string, traces = new TraceStore(tempFile("t.jsonl"))) {
  const server = createGateway({ agentId, policy: examplePolicy, traces, repo: inMemoryRepo() });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(clientT);
  return { client, traces };
}
const textOf = (r: any) => r.content[0].text as string;

describe("MCP gateway", () => {
  it("lists its tools", async () => {
    const { client } = await connect("acme-assurance-agent");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["export_decision_traces", "get_engagement", "record_finding", "verify_decision_traces"]);
  });

  it("serves an entitled read and traces it", async () => {
    const { client, traces } = await connect("acme-assurance-agent");
    const r = await client.callTool({ name: "get_engagement", arguments: { clientId: "client-001", purpose: "engagement_support" } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(textOf(r)).name).toBe("Northwind Manufacturing");
    expect(traces.readAll()[0]).toMatchObject({ name: "get_engagement", decision: "allowed", outcome: "ok", vendor: "acme-ai" });
  });

  it("denies out-of-scope access and traces the denial", async () => {
    const { client, traces } = await connect("acme-assurance-agent");
    const r = await client.callTool({ name: "get_engagement", arguments: { clientId: "client-003", purpose: "engagement_support" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/outside scope/);
    expect(traces.readAll()[0]).toMatchObject({ decision: "denied" });
  });

  it("keeps agent writes as drafts for practitioner review", async () => {
    const { client } = await connect("acme-assurance-agent");
    const r = await client.callTool({
      name: "record_finding",
      arguments: { clientId: "client-001", purpose: "quality_review", title: "Cutoff issue", severity: "medium", detail: "Three invoices booked after period end." },
    });
    expect(JSON.parse(textOf(r)).status).toBe("draft_pending_practitioner_review");
  });

  it("lets only the auditor export and verify traces", async () => {
    const traces = new TraceStore(tempFile("t.jsonl"));
    const vendor = await connect("acme-assurance-agent", traces);
    await vendor.client.callTool({ name: "get_engagement", arguments: { clientId: "client-001", purpose: "engagement_support" } });
    const denied = await vendor.client.callTool({ name: "export_decision_traces", arguments: { purpose: "audit_export" } });
    expect(denied.isError).toBe(true);

    const auditor = await connect("platform-auditor", traces);
    const exported = await auditor.client.callTool({ name: "export_decision_traces", arguments: { purpose: "audit_export", vendor: "acme-ai" } });
    expect(textOf(exported).split("\n")).toHaveLength(2); // the read + the denied export
    const verified = await auditor.client.callTool({ name: "verify_decision_traces", arguments: { purpose: "audit_export" } });
    expect(JSON.parse(textOf(verified)).ok).toBe(true);
  });
});
