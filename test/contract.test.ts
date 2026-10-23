/**
 * Contract tests: the executable acceptance criteria from
 * docs/vendor-integration-standard.md. A vendor runs these against sample
 * payloads before integration sign-off.
 */
import { describe, expect, it } from "vitest";
import { VendorEvent } from "../src/contract.js";

const valid = {
  schema_version: "1.0",
  id: "evt_00000001",
  type: "agent.decision",
  occurred_at: "2026-10-23T18:00:00Z",
  vendor: "acme-ai",
  agent_id: "acme-assurance-agent",
  decision: { action: "flag_revenue_cutoff", rationale: "Invoices booked after period end" },
};

describe("VendorEvent contract v1.0", () => {
  it("accepts a minimal valid decision", () => {
    expect(VendorEvent.safeParse(valid).success).toBe(true);
  });
  it("requires a rationale for every decision (decision traces must be explainable)", () => {
    expect(VendorEvent.safeParse({ ...valid, decision: { action: "x" } }).success).toBe(false);
  });
  it("requires corrections to reference the decision they supersede", () => {
    const correction = { ...valid, type: "agent.correction" };
    expect(VendorEvent.safeParse(correction).success).toBe(false);
    expect(VendorEvent.safeParse({ ...correction, decision: { ...valid.decision, supersedes: "evt_0" } }).success).toBe(true);
  });
  it("rejects unknown fields so the contract can't drift silently", () => {
    expect(VendorEvent.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(VendorEvent.safeParse({ ...valid, decision: { ...valid.decision, extra: 1 } }).success).toBe(false);
  });
  it("rejects unsupported schema versions", () => {
    expect(VendorEvent.safeParse({ ...valid, schema_version: "2.0" }).success).toBe(false);
  });
  it("bounds confidence to [0, 1]", () => {
    expect(VendorEvent.safeParse({ ...valid, decision: { ...valid.decision, confidence: 1.5 } }).success).toBe(false);
  });
});
