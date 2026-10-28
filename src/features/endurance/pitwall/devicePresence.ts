/**
 * Hoe een apparaat in de lijst staat. Een oude health-melding mag nooit
 * "Game aan" tonen: staat de verbinding stil, dan is het apparaat offline,
 * ook al was de simulator op het laatste bericht nog actief.
 */
export type DevicePresence = "offline" | "game_on" | "game_off";

export function devicePresence(online: boolean, gameConnected: boolean | null): DevicePresence {
  if (!online) return "offline";
  return gameConnected ? "game_on" : "game_off";
}

export const devicePresenceLabel: Record<DevicePresence, string> = {
  offline: "Offline",
  game_on: "Game aan",
  game_off: "Game uit",
};
