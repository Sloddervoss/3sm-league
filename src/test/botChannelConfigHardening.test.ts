import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const botIndexPath = path.resolve(process.cwd(), "bot/index.js");
const botStreamersPath = path.resolve(process.cwd(), "bot/streamers.js");

describe("Discord bot channel configuration hardening", () => {
  it("does not silently fall back to hard-coded Discord channel IDs", () => {
    const source = readFileSync(botIndexPath, "utf8");

    expect(source).not.toMatch(/\|\|\s*['"]\d{15,25}['"]/);
  });

  it("does not keep hard-coded live notification channel IDs in bot modules", () => {
    const source = [botIndexPath, botStreamersPath]
      .map((filePath) => readFileSync(filePath, "utf8"))
      .join("\n");

    expect(source).not.toMatch(/['"]\d{15,25}['"]/);
  });
});
