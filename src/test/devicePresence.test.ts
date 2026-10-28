import { describe, expect, it } from "vitest";
import { devicePresence, devicePresenceLabel } from "@/features/endurance/pitwall/devicePresence";

describe("devicePresence", () => {
  it("toont nooit 'Game aan' als het apparaat offline is", () => {
    expect(devicePresence(false, true)).toBe("offline");
    expect(devicePresenceLabel[devicePresence(false, true)]).toBe("Offline");
  });

  it("toont 'Game aan' alleen als het apparaat online is en de sim draait", () => {
    expect(devicePresenceLabel[devicePresence(true, true)]).toBe("Game aan");
  });

  it("toont 'Game uit' als het apparaat online is zonder sim", () => {
    expect(devicePresenceLabel[devicePresence(true, false)]).toBe("Game uit");
    expect(devicePresenceLabel[devicePresence(true, null)]).toBe("Game uit");
  });
});
