/**
 * Append-only, hash-chained decision-trace log.
 *
 * The firm owns this log, not the vendor. Each record stores a SHA-256 hash of the
 * previous record, so any edit, deletion, or reordering breaks the chain and is
 * detectable with verify(). Raw inputs are not stored, only a hash of them
 * (data minimization); the record still proves what was asked and what was decided.
 *
 * Records are JSONL so they can be loaded as-is into a lakehouse bronze table.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export const TRACE_SCHEMA_VERSION = "1.0";
const GENESIS = "0".repeat(64);

export const TraceRecord = z.object({
  schemaVersion: z.literal(TRACE_SCHEMA_VERSION),
  seq: z.number().int().nonnegative(),
  id: z.string().uuid(),
  ts: z.string().datetime(),
  kind: z.enum(["tool_call", "vendor_event"]),
  name: z.string(),
  agentId: z.string(),
  vendor: z.string(),
  purpose: z.string().optional(),
  clientId: z.string().optional(),
  inputHash: z.string().length(64),
  decision: z.enum(["allowed", "denied", "accepted", "duplicate"]),
  reason: z.string(),
  outcome: z.enum(["ok", "error"]).optional(),
  latencyMs: z.number().nonnegative().optional(),
  /** Vendor-reported decision data, kept for evaluation and learning loops. */
  vendorDecision: z.record(z.string(), z.unknown()).optional(),
  prevHash: z.string().length(64),
  hash: z.string().length(64),
});
export type TraceRecord = z.infer<typeof TraceRecord>;

export type NewTrace = Omit<TraceRecord, "schemaVersion" | "seq" | "id" | "ts" | "prevHash" | "hash">;

/** Stable JSON: sorted keys, so the same record always hashes the same way. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function hashInput(input: unknown): string {
  return sha256(canonical(input));
}

function recordHash(rec: Omit<TraceRecord, "hash">): string {
  return sha256(canonical(rec));
}

export interface VerifyResult {
  ok: boolean;
  count: number;
  brokenAt?: number;
  problem?: string;
}

export class TraceStore {
  private lastHash = GENESIS;
  private nextSeq = 0;

  constructor(private readonly path: string, private readonly now: () => Date = () => new Date()) {
    mkdirSync(dirname(path), { recursive: true });
    const records = this.readAll();
    if (records.length > 0) {
      const last = records[records.length - 1];
      this.lastHash = last.hash;
      this.nextSeq = last.seq + 1;
    }
  }

  append(trace: NewTrace): TraceRecord {
    const base = {
      schemaVersion: TRACE_SCHEMA_VERSION,
      seq: this.nextSeq,
      id: randomUUID(),
      ts: this.now().toISOString(),
      ...trace,
      prevHash: this.lastHash,
    } as const;
    const record: TraceRecord = { ...base, hash: recordHash(base) };
    appendFileSync(this.path, canonical(record) + "\n");
    this.lastHash = record.hash;
    this.nextSeq += 1;
    return record;
  }

  readAll(): TraceRecord[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as TraceRecord);
  }

  /** Recompute the whole chain. Detects edits, deletions, insertions, and reordering. */
  verify(): VerifyResult {
    const records = this.readAll();
    let prev = GENESIS;
    for (let i = 0; i < records.length; i++) {
      const parsed = TraceRecord.safeParse(records[i]);
      if (!parsed.success) return { ok: false, count: records.length, brokenAt: i, problem: "schema" };
      const { hash, ...rest } = parsed.data;
      if (rest.seq !== i) return { ok: false, count: records.length, brokenAt: i, problem: "sequence" };
      if (rest.prevHash !== prev) return { ok: false, count: records.length, brokenAt: i, problem: "chain" };
      if (recordHash(rest) !== hash) return { ok: false, count: records.length, brokenAt: i, problem: "hash" };
      prev = hash;
    }
    return { ok: true, count: records.length };
  }

  /** Portable export (JSONL) — the firm's copy of every decision, filterable for audits. */
  export(filter: { agentId?: string; vendor?: string; since?: string } = {}): string {
    return this.readAll()
      .filter((r) => !filter.agentId || r.agentId === filter.agentId)
      .filter((r) => !filter.vendor || r.vendor === filter.vendor)
      .filter((r) => !filter.since || r.ts >= filter.since)
      .map((r) => canonical(r))
      .join("\n");
  }
}
