/**
 * Inbound vendor webhooks: signature verification, replay protection,
 * contract validation, idempotency, and tracing.
 *
 * Signature header format (same idea as Stripe's):
 *   x-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { VendorEvent } from "./contract.js";
import { hashInput, type TraceStore } from "./traces.js";

export const DEFAULT_TOLERANCE_SEC = 300;

export function sign(rawBody: string, secret: string, timestampSec: number): string {
  const mac = createHmac("sha256", secret).update(`${timestampSec}.${rawBody}`).digest("hex");
  return `t=${timestampSec},v1=${mac}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

export function verifySignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
  nowSec: number,
  toleranceSec = DEFAULT_TOLERANCE_SEC,
): SignatureCheck {
  if (!header) return { ok: false, reason: "missing signature header" };
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return { ok: false, reason: "malformed signature header" };
  if (Math.abs(nowSec - t) > toleranceSec) return { ok: false, reason: "timestamp outside tolerance (possible replay)" };
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"), "hex");
  const given = Buffer.from(parts.v1, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

/** Durable set of processed event IDs (the file plays the role of a unique constraint). */
export class IdempotencyStore {
  private seen = new Set<string>();
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split("\n")) if (line) this.seen.add(line);
    }
  }
  /** Returns true the first time an ID is claimed, false on every repeat. */
  claim(id: string): boolean {
    if (this.seen.has(id)) return false;
    appendFileSync(this.path, id + "\n");
    this.seen.add(id);
    return true;
  }
}

export interface WebhookDeps {
  secrets: Record<string, string>; // vendor -> signing secret
  traces: TraceStore;
  idempotency: IdempotencyStore;
  nowSec?: () => number;
}

export interface WebhookResult {
  status: number;
  body: { result: string; detail?: unknown };
}

export function handleVendorWebhook(
  vendor: string,
  rawBody: string,
  signatureHeader: string | undefined,
  deps: WebhookDeps,
): WebhookResult {
  const secret = deps.secrets[vendor];
  if (!secret) return { status: 404, body: { result: "unknown vendor" } };

  const now = deps.nowSec?.() ?? Math.floor(Date.now() / 1000);
  const sig = verifySignature(rawBody, signatureHeader, secret, now);
  if (!sig.ok) return { status: 401, body: { result: "rejected", detail: sig.reason } };

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { result: "invalid json" } };
  }
  const parsed = VendorEvent.safeParse(json);
  if (!parsed.success) {
    return { status: 422, body: { result: "contract violation", detail: parsed.error.issues } };
  }
  const event = parsed.data;
  if (event.vendor !== vendor) return { status: 403, body: { result: "vendor mismatch" } };

  if (!deps.idempotency.claim(`${vendor}:${event.id}`)) {
    // Acknowledge so the vendor stops retrying, but don't process twice.
    return { status: 200, body: { result: "duplicate" } };
  }

  deps.traces.append({
    kind: "vendor_event",
    name: event.type,
    agentId: event.agent_id,
    vendor,
    clientId: event.client_id,
    inputHash: hashInput(event),
    decision: "accepted",
    reason: "signature, contract, and idempotency checks passed",
    vendorDecision: { eventId: event.id, occurredAt: event.occurred_at, ...event.decision },
  });
  return { status: 202, body: { result: "accepted" } };
}
