import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const botIndexPath = path.resolve(process.cwd(), "bot/index.js");

describe("Discord bot JSON state hardening", () => {
  it("writes bot JSON state through a per-process private temporary file", () => {
    const source = readFileSync(botIndexPath, "utf8");

    expect(source).toMatch(/const tmpFile = `\$\{file\}\.\$\{process\.pid\}\.\$\{Date\.now\(\)\}\.tmp`;/);
    expect(source).toMatch(/fs\.writeFileSync\(tmpFile, JSON\.stringify\(data, null, 2\), \{ mode: 0o600 \}\);/);
  });
});
