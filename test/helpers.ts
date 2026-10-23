import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const tempFile = (name: string) => join(mkdtempSync(join(tmpdir(), "aig-")), name);
