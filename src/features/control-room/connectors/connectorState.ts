import type { SimHubFleetRow, SimHubDeviceDetail } from "./types";

export function latestSeen(row: Pick<SimHubFleetRow, "health_received_at" | "last_seen_at" | "telemetry_received_at">) {
  return [row.health_received_at, row.last_seen_at, row.telemetry_received_at]
    .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

export function sitePairing(row: Pick<SimHubFleetRow, "revoked_at" | "device_status">) {
  return row.revoked_at || row.device_status === "revoked" ? "Ingetrokken" : "Site gekoppeld";
}

export function telemetryValues(tele: Partial<NonNullable<SimHubDeviceDetail["telemetry"]>> | null) {
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? value as Record<string, unknown> : {};
  const v3 = object(tele?.v3_normalized);
  const legacy = object(tele?.telemetry);
  const identity = object(v3.identity);
  return {
    fuel: object(v3.fuel).fuelLitres ?? legacy.fuelLitres,
    completedLaps: object(v3.timing).completedLaps ?? legacy.completedLaps,
    inPit: object(v3.track).onPitRoad ?? legacy.inPitLane,
    trackName: tele?.track_name ?? identity.trackName ?? "—",
    carName: tele?.car_name ?? identity.carName ?? "—",
    driverName: tele?.current_driver_name ?? identity.currentDriverName ?? "—",
  };
}
