# Vendor Integration Standard for Third-Party AI Agents (v1.0)

This is the technical standard a vendor's AI agent must meet before it is
connected to the platform. Each requirement is **testable**: the right-hand
column names the check that enforces it, so the same list can be attached to a
contract as acceptance criteria.

## 1. Access: agents call the platform only through the MCP gateway

| # | Requirement | Enforced by |
|---|---|---|
| A1 | Agents reach firm data only through gateway tools, never direct database or storage access. | Architecture; `src/gateway.ts` |
| A2 | Every call declares a **purpose** from the permissible-use list. Calls for any other purpose are denied. | `authorize()` · `test/policy.test.ts` |
| A3 | Each agent is scoped to named tools and named clients. Default is deny. | `authorize()` · `test/policy.test.ts` |
| A4 | Agent writes are drafts until a practitioner approves them. | `record_finding` · `test/gateway.test.ts` |
| A5 | Denied calls are logged the same way as allowed ones. | `guarded()` · `test/gateway.test.ts` |

## 2. Events: vendors push every decision back to the firm

| # | Requirement | Enforced by |
|---|---|---|
| E1 | Every decision, correction, and error is sent as a `VendorEvent` (schema `1.0`). | `src/contract.ts` · `test/contract.test.ts` |
| E2 | Every decision carries a rationale; evidence references are strongly encouraged. | Contract · `test/contract.test.ts` |
| E3 | Corrections reference the decision they supersede. | Contract refinement |
| E4 | Unknown fields are rejected. Schema changes ship as a new version, never silently. | `.strict()` · `test/contract.test.ts` |
| E5 | Webhooks are signed with HMAC-SHA256 over `timestamp.body`, header `x-signature: t=…,v1=…`. | `verifySignature()` · `test/webhooks.test.ts` |
| E6 | Timestamps older than 5 minutes are rejected (replay protection). | `verifySignature()` |
| E7 | Event IDs are unique. Vendors may retry freely; duplicates are acknowledged and not reprocessed. | `IdempotencyStore` · `test/webhooks.test.ts` |
| E8 | A vendor may only send events under its own vendor ID. | `handleVendorWebhook()` |

## 3. Ownership and portability

| # | Requirement | Enforced by |
|---|---|---|
| O1 | The firm keeps its own copy of every decision trace. The vendor's logs are not the system of record. | `TraceStore` |
| O2 | The trace log is append-only and tamper-evident (hash chain). | `verify()` · `test/traces.test.ts` |
| O3 | Raw inputs are not stored in traces, only hashes (data minimization). | `test/traces.test.ts` |
| O4 | Traces export as JSONL on demand, filterable by vendor, agent, and time. | `export_decision_traces` |
| O5 | Replacing a vendor needs no data migration from that vendor: history lives with the firm. | O1 + O4 |

## 4. Production readiness (sign-off checklist)

- [ ] Vendor passes `npm test` against its sample payloads (contract tests).
- [ ] Signing secret issued per vendor and stored in a secret manager; rotation tested.
- [ ] Error and latency budgets agreed; gateway traces show them per vendor.
- [ ] Kill switch: removing the agent's grant stops all access on the next call.
- [ ] Rollback plan: agent can be disabled without affecting other vendors.
