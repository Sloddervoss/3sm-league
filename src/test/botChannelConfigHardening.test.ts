import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const botIndexPath = path.resolve(process.cwd(), "bot/index.js");

describe("Discord bot channel configuration hardening", () => {
  it("does not silently fall back to hard-coded Discord channel IDs", () => {
    const source = readFileSync(botIndexPath, "utf8");

    expect(source).not.toMatch(/\|\|\s*['"]\d{15,25}['"]/);
  });
});
