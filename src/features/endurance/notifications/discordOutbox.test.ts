import { describe, expect, it } from "vitest";
import { createEnduranceSeed } from "../core/seed";
import { buildDiscordOutboxItem } from "./discordOutbox";

describe("Discord outbox", () => {
  it("stays disabled and excludes sensitive planning content", () => {
    const state = createEnduranceSeed(); const item = buildDiscordOutboxItem(state.notifications[0], state.events[0]);
    expect(item.enabled).toBe(false);
    expect(item.privatePath).toContain("/endurance/races/");
    expect(item.content).not.toMatch(/fuel|wachtwoord|setup|stinttijd/i);
  });
});
