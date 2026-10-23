import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TraceStore, hashInput } from "../src/traces.js";
import { tempFile } from "./helpers.js";

const entry = (name: string) => ({
  kind: "tool_call" as const,
  name,
  agentId: "acme-assurance-agent",
  vendor: "acme-ai",
  inputHash: hashInput({ name }),
  decision: "allowed" as const,
  reason: "granted",
});

describe("TraceStore", () => {
  it("chains records and verifies a clean log", () => {
    const store = new TraceStore(tempFile("t.jsonl"));
    const a = store.append(entry("a"));
    const b = store.append(entry("b"));
    expect(b.prevHash).toBe(a.hash);
    expect(store.verify()).toEqual({ ok: true, count: 2 });
  });

  it("resumes the chain after a restart", () => {
    const path = tempFile("t.jsonl");
    new TraceStore(path).append(entry("a"));
    new TraceStore(path).append(entry("b"));
    expect(new TraceStore(path).verify().ok).toBe(true);
  });

  it("detects an edited record", () => {
    const path = tempFile("t.jsonl");
    const store = new TraceStore(path);
    store.append(entry("a"));
    store.append(entry("b"));
    writeFileSync(path, readFileSync(path, "utf8").replace('"decision":"allowed"', '"decision":"denied"'));
    expect(store.verify()).toMatchObject({ ok: false, brokenAt: 0, problem: "hash" });
  });

  it("detects a deleted record", () => {
    const path = tempFile("t.jsonl");
    const store = new TraceStore(path);
    ["a", "b", "c"].forEach((n) => store.append(entry(n)));
    const lines = readFileSync(path, "utf8").trim().split("\n");
    writeFileSync(path, [lines[0], lines[2]].join("\n") + "\n");
    expect(store.verify()).toMatchObject({ ok: false, brokenAt: 1 });
  });

  it("never stores raw inputs, only their hash", () => {
    const path = tempFile("t.jsonl");
    new TraceStore(path).append({ ...entry("a"), inputHash: hashInput({ ssn: "123-45-6789" }) });
    expect(readFileSync(path, "utf8")).not.toContain("123-45-6789");
  });

  it("exports filtered JSONL", () => {
    const store = new TraceStore(tempFile("t.jsonl"));
    store.append(entry("a"));
    store.append({ ...entry("b"), vendor: "other" });
    const lines = store.export({ vendor: "acme-ai" }).split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).name).toBe("a");
  });
});
