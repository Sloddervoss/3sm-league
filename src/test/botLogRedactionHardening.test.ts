import { describe, expect, it } from "vitest";

import { formatLogArg, redactSensitiveText } from "../../bot/logging.js";

describe("Discord bot log redaction hardening", () => {
  it("redacts configured bot and Supabase secrets from log messages", () => {
    const previousToken = process.env.DISCORD_BOT_TOKEN;
    const previousServiceKey = process.env.SUPABASE_SERVICE_KEY;

    process.env.DISCORD_BOT_TOKEN = "discord-token-that-must-not-leak";
    process.env.SUPABASE_SERVICE_KEY = "supabase-service-key-that-must-not-leak";

    try {
      const redacted = redactSensitiveText(
        "Login failed with discord-token-that-must-not-leak and supabase-service-key-that-must-not-leak",
      );

      expect(redacted).toContain("[REDACTED:DISCORD_BOT_TOKEN]");
      expect(redacted).toContain("[REDACTED:SUPABASE_SERVICE_KEY]");
      expect(redacted).not.toContain("discord-token-that-must-not-leak");
      expect(redacted).not.toContain("supabase-service-key-that-must-not-leak");
    } finally {
      if (previousToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
      else process.env.DISCORD_BOT_TOKEN = previousToken;

      if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
      else process.env.SUPABASE_SERVICE_KEY = previousServiceKey;
    }
  });

  it("formats object log arguments as JSON instead of [object Object]", () => {
    expect(formatLogArg({ code: "PGRST200", message: "relationship not found" })).toBe(
      '{"code":"PGRST200","message":"relationship not found"}',
    );
  });
});
