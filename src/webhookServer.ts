/** Minimal HTTP receiver: POST /webhooks/:vendor */
import { createServer } from "node:http";
import { IdempotencyStore, handleVendorWebhook } from "./webhooks.js";
import { TraceStore } from "./traces.js";

const port = Number(process.env.PORT ?? 8787);
const secrets: Record<string, string> = JSON.parse(process.env.VENDOR_SECRETS ?? '{"acme-ai":"dev-secret-change-me"}');
const deps = {
  secrets,
  traces: new TraceStore(process.env.TRACE_LOG ?? "data/decision-traces.jsonl"),
  idempotency: new IdempotencyStore(process.env.IDEMPOTENCY_LOG ?? "data/processed-events.txt"),
};

createServer((req, res) => {
  const match = req.method === "POST" ? req.url?.match(/^\/webhooks\/([\w-]+)$/) : null;
  if (!match) {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    // Verify against the exact raw bytes received, never a re-serialized body.
    const raw = Buffer.concat(chunks).toString("utf8");
    const result = handleVendorWebhook(match[1], raw, req.headers["x-signature"] as string | undefined, deps);
    res.writeHead(result.status, { "content-type": "application/json" }).end(JSON.stringify(result.body));
  });
}).listen(port, () => console.log(`webhook receiver on http://localhost:${port}/webhooks/:vendor`));
