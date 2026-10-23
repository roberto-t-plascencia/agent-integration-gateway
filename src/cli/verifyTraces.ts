import { TraceStore } from "../traces.js";

const result = new TraceStore(process.argv[2] ?? "data/decision-traces.jsonl").verify();
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
