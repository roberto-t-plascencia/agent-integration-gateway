import { describe, expect, it } from "vitest";
import { authorize, examplePolicy } from "../src/policy.js";

describe("authorize (default deny)", () => {
  const req = { agentId: "acme-assurance-agent", tool: "get_engagement", purpose: "engagement_support" as const, clientId: "client-001" };

  it("allows a granted tool, purpose, and client", () => {
    expect(authorize(examplePolicy, req).allowed).toBe(true);
  });
  it("denies unknown agents", () => {
    expect(authorize(examplePolicy, { ...req, agentId: "rogue" })).toEqual({ allowed: false, reason: "unknown agent 'rogue'" });
  });
  it("denies tools that were not granted", () => {
    expect(authorize(examplePolicy, { ...req, tool: "export_decision_traces" }).allowed).toBe(false);
  });
  it("denies a purpose outside permissible use", () => {
    expect(authorize(examplePolicy, { ...req, purpose: "analytics" }).reason).toMatch(/purpose 'analytics'/);
  });
  it("denies clients outside the agent's scope", () => {
    expect(authorize(examplePolicy, { ...req, clientId: "client-003" }).reason).toMatch(/outside scope/);
  });
});
