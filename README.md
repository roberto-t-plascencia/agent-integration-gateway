# agent-integration-gateway

[![ci](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

A reference **MCP gateway** for connecting third-party AI agents to an
enterprise platform **without giving up control of the data or the decision
history**.

When a firm brings in AI agents from outside vendors, the hard part isn't the
connection. It's making sure that:

- each agent can only touch the data and tools it's entitled to, for a stated purpose;
- every decision the agent makes is recorded **by the firm**, in a form the firm can audit, evaluate, and keep if the vendor is replaced;
- the vendor's integration is held to a written standard, with acceptance criteria that are executable tests.

This repo is a small, working version of that.

## What's in it

| Piece | What it does | File |
|---|---|---|
| **MCP gateway** | Exposes tools to agents. Every call goes through one guard: authorize → execute → trace. | `src/gateway.ts` |
| **Entitlements** | Default-deny policy per agent: allowed tools, permissible-use purposes, client scope. | `src/policy.ts` |
| **Signed webhooks** | Vendors push decisions back. HMAC signatures, replay window, contract validation, idempotent processing. | `src/webhooks.ts` |
| **Vendor contract** | Versioned, strict schema for agent decisions, corrections, and errors. | `src/contract.ts` |
| **Decision-trace log** | Append-only, SHA-256 hash-chained JSONL. Tamper-evident, exportable, no raw inputs. | `src/traces.ts` |
| **Integration standard** | The vendor-facing spec. Every requirement maps to the test that enforces it. | [`docs/vendor-integration-standard.md`](docs/vendor-integration-standard.md) |

```
             ┌───────────────────── firm-owned ─────────────────────┐
 Vendor  ──MCP──▶  Gateway ──authorize──▶ Policy (default deny)    │
 agent           │   │                                              │
                 │   └──execute──▶ Systems of record                │
                 │   └──trace────▶ Decision-trace log (hash chain) ─┼─▶ export (JSONL)
 Vendor  ──webhook (signed)──▶ verify ▶ contract ▶ dedupe ▶ trace ──┘     → lakehouse / evals
 platform
```

## Run it

```bash
npm install
npm test              # 33 tests: policy, contract, signatures, idempotency, tamper detection, end-to-end MCP
npm run typecheck
```

**MCP server** (stdio). Add to an MCP client config, e.g. Claude Desktop:

```json
{
  "mcpServers": {
    "integration-gateway": {
      "command": "npx",
      "args": ["tsx", "src/server.ts"],
      "cwd": "/path/to/agent-integration-gateway",
      "env": { "AGENT_ID": "acme-assurance-agent" }
    }
  }
}
```

Try `get_engagement` for `client-001` (allowed) and `client-003` (denied, out of scope). Both show up in `data/decision-traces.jsonl`.

**Webhook receiver:**

```bash
npm run webhooks      # POST http://localhost:8787/webhooks/:vendor
npm run verify-traces # recompute the hash chain
```

## Design decisions

- **One guard for every tool.** Authorization and tracing live in `guarded()`, not in each tool, so a new tool can't forget either. Denials are traced too: what an agent *tried* to do matters for review.
- **Purpose is a required input.** Permissible use is enforced per call, not per agent, so the same agent can read for engagement support but not for analytics.
- **Agent writes are drafts.** `record_finding` returns `draft_pending_practitioner_review`. A human approves before anything becomes a firm record.
- **The firm owns the trace, not the vendor.** Vendor events are verified, validated, and written to the firm's log. Swapping vendors doesn't lose history (see O1–O5 in the standard).
- **Hash chain instead of trusting the file.** Editing, deleting, or reordering a record breaks the chain and `verify()` reports where.
- **Hashes, not raw inputs.** Traces prove what was asked without copying client data into another store.
- **Strict contract.** Unknown fields are rejected so a vendor can't drift the schema; changes ship as a new `schema_version`.
- **Traces are built for learning loops.** Each record carries the decision, rationale, evidence references, and (for corrections) what it supersedes, so the log can feed evaluation sets and practitioner-feedback loops, not only audits.

## What production would add

- **HTTP transport with OAuth 2.1** (per the MCP authorization spec) so agent identity comes from a verified token instead of launch config, with entitlements pulled from an entitlement service.
- **Durable storage**: idempotency keys under a database unique constraint, traces in an append-only table (or object storage with object lock) landing as a lakehouse bronze table.
- **Event fan-out** through a queue or pub/sub topic (transactional outbox) so downstream consumers don't block webhook acknowledgements.
- **OpenTelemetry** spans around each guarded call, correlated to trace IDs, plus per-vendor error and latency SLOs.
- **Secret rotation** with two active signing secrets per vendor.

## License

MIT
