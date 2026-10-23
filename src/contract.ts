/**
 * Vendor event contract (v1.0).
 *
 * This schema is the testable form of docs/vendor-integration-standard.md.
 * A vendor's agent must send every decision, correction, and error it makes on
 * the firm's behalf as one of these events. Unknown fields are rejected so a
 * vendor can't silently drift the contract.
 */
import { z } from "zod";

export const CONTRACT_VERSION = "1.0";

export const VendorEvent = z
  .object({
    schema_version: z.literal(CONTRACT_VERSION),
    id: z.string().min(8).max(128),
    type: z.enum(["agent.decision", "agent.correction", "agent.error"]),
    occurred_at: z.string().datetime(),
    vendor: z.string().min(1),
    agent_id: z.string().min(1),
    client_id: z.string().min(1).optional(),
    decision: z
      .object({
        action: z.string().min(1),
        rationale: z.string().min(1),
        confidence: z.number().min(0).max(1).optional(),
        /** References to the evidence the agent used (document IDs, record keys). */
        evidence_refs: z.array(z.string()).default([]),
        /** For corrections: the decision being corrected. */
        supersedes: z.string().optional(),
        model: z.string().optional(),
      })
      .strict(),
  })
  .strict()
  .refine((e) => e.type !== "agent.correction" || !!e.decision.supersedes, {
    message: "agent.correction events must set decision.supersedes",
    path: ["decision", "supersedes"],
  });

export type VendorEvent = z.infer<typeof VendorEvent>;
