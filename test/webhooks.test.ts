import { beforeEach, describe, expect, it } from "vitest";
import { IdempotencyStore, handleVendorWebhook, sign, verifySignature, type WebhookDeps } from "../src/webhooks.js";
import { TraceStore } from "../src/traces.js";
import { tempFile } from "./helpers.js";

const SECRET = "test-secret";
const NOW = 1_800_000_000;

const event = (over: Record<string, unknown> = {}) => ({
  schema_version: "1.0",
  id: "evt_00000001",
  type: "agent.decision",
  occurred_at: "2026-10-23T18:00:00Z",
  vendor: "acme-ai",
  agent_id: "acme-assurance-agent",
  client_id: "client-001",
  decision: { action: "flag_revenue_cutoff", rationale: "Invoices dated after period end were booked in period", confidence: 0.82, evidence_refs: ["doc-778"] },
  ...over,
});

describe("verifySignature", () => {
  const body = JSON.stringify(event());
  it("accepts a valid signature", () => {
    expect(verifySignature(body, sign(body, SECRET, NOW), SECRET, NOW)).toEqual({ ok: true });
  });
  it("rejects a tampered body", () => {
    expect(verifySignature(body + " ", sign(body, SECRET, NOW), SECRET, NOW)).toMatchObject({ ok: false, reason: "signature mismatch" });
  });
  it("rejects the wrong secret", () => {
    expect(verifySignature(body, sign(body, "other", NOW), SECRET, NOW).ok).toBe(false);
  });
  it("rejects old timestamps (replay)", () => {
    expect(verifySignature(body, sign(body, SECRET, NOW - 301), SECRET, NOW)).toMatchObject({ ok: false, reason: expect.stringMatching(/replay/) });
  });
  it("rejects missing or malformed headers", () => {
    expect(verifySignature(body, undefined, SECRET, NOW).ok).toBe(false);
    expect(verifySignature(body, "garbage", SECRET, NOW).ok).toBe(false);
  });
});

describe("handleVendorWebhook", () => {
  let deps: WebhookDeps;
  beforeEach(() => {
    deps = {
      secrets: { "acme-ai": SECRET },
      traces: new TraceStore(tempFile("t.jsonl")),
      idempotency: new IdempotencyStore(tempFile("ids.txt")),
      nowSec: () => NOW,
    };
  });
  const send = (payload: unknown, vendor = "acme-ai") => {
    const raw = JSON.stringify(payload);
    return handleVendorWebhook(vendor, raw, sign(raw, SECRET, NOW), deps);
  };

  it("accepts a valid event and traces it with the vendor's decision", () => {
    expect(send(event()).status).toBe(202);
    const [trace] = deps.traces.readAll();
    expect(trace).toMatchObject({ kind: "vendor_event", name: "agent.decision", decision: "accepted" });
    expect(trace.vendorDecision).toMatchObject({ action: "flag_revenue_cutoff", eventId: "evt_00000001" });
  });

  it("processes a retried event only once", () => {
    expect(send(event()).status).toBe(202);
    expect(send(event())).toEqual({ status: 200, body: { result: "duplicate" } });
    expect(deps.traces.readAll()).toHaveLength(1);
  });

  it("remembers processed events across restarts", () => {
    const idsPath = tempFile("ids.txt");
    deps.idempotency = new IdempotencyStore(idsPath);
    send(event());
    deps.idempotency = new IdempotencyStore(idsPath);
    expect(send(event()).body.result).toBe("duplicate");
  });

  it("rejects contract violations with 422", () => {
    expect(send(event({ surprise_field: true })).status).toBe(422);
  });

  it("rejects an event claiming to be from another vendor", () => {
    expect(send(event({ vendor: "someone-else" })).status).toBe(403);
  });

  it("returns 404 for unknown vendors and 401 for bad signatures", () => {
    expect(send(event(), "nobody").status).toBe(404);
    expect(handleVendorWebhook("acme-ai", JSON.stringify(event()), "t=1,v1=00", deps).status).toBe(401);
  });
});
