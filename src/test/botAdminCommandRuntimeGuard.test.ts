import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const botIndexPath = path.resolve(process.cwd(), "bot/index.js");

function commandCase(source: string, commandName: string): string {
  const match = source.match(new RegExp(`case '${commandName}':[\\s\\S]*?break;`));
  return match?.[0] ?? "";
}

describe("Discord bot admin command runtime guard", () => {
  it("checks Discord Administrator permission inside admin-only command handlers", () => {
    const source = readFileSync(botIndexPath, "utf8");

    expect(source).toContain("async function requireDiscordAdmin(interaction)");
    expect(source).toContain("memberPermissions?.has(PermissionFlagsBits.Administrator)");

    for (const commandName of ["setup-server", "setprofile", "deleteprofile"]) {
      expect(commandCase(source, commandName)).toContain("if (!(await requireDiscordAdmin(interaction))) break;");
    }
  });
});
