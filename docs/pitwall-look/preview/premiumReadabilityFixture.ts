/**
 * Fixture voor de premium Pitwall-leesbaarheidsmeting.
 *
 * Alleen bedoeld voor lokale browsermetingen (Vite dev). Geen route in de
 * productie-app, geen Supabase-sessie, geen writes. De vorm volgt het echte
 * `V3Normalized`-contract; waarden zijn synthetisch en duidelijk herkenbaar.
 */
import type { SimHubDeviceDetail } from "@/features/control-room/connectors/types";
import type { V3Normalized, V3Opponent, PitwallStrategyRow } from "@/features/endurance/pitwall/pitwallHelpers";
import { devicePace, devicePosition, deviceRaceClock, deviceStrategyRow } from "@/features/endurance/pitwall/devicePitwallAdapters";

const nowIso = () => new Date().toISOString();
const oldIso = () => new Date(Date.now() - 12 * 60_000).toISOString();

const names = [
  ["11", "A. van der Berg", "Apex Racing", 1, false],
  ["12", "B. Chase", "Chase Racing", 2, false],
  ["17", "Vincent", "3SM Endurance", 3, true],
  ["21", "M. Kowalski", "Nordwind Motorsport", 4, false],
  ["33", "S. de Vries", "Velocity GT", 5, false],
  ["44", "J. Okafor", "Okafor Motorsport", 6, false],
  ["55", "L. Rossi", "Scuderia Lago", 7, true],
  ["66", "T. Nakamura", "Nakamura Racing", 8, false],
  ["77", "P. Andersson", "Andersson Racing", 9, false],
  ["88", "R. Haddad", "Haddad Competition", 10, false],
] as const;

const opponents = (offline: boolean): V3Opponent[] =>
  names.map(([carNumber, driverName, teamName, position, inPit], index) => ({
    id: `car-${carNumber}`,
    carNumber,
    driverName,
    teamName,
    carClass: "GT3",
    position,
    classPosition: position,
    lap: 48 - (index % 4),
    gapToPlayerSeconds: position === 3 ? 0 : (position - 3) * 3.42,
    lastLapSeconds: 101.9 + index * 0.37,
    bestLapSeconds: 101.4 + index * 0.31,
    inPit,
    connected: position === 10 ? false : !offline,
    isPlayer: position === 3,
  }));

const paceHistory = (offline: boolean) => ({
  schemaRevision: 1,
  observedSessionId: "fixture-session-20261122",
  segmentId: "fixture-segment-1",
  transportSessionId: "fixture-transport-1",
  updatedAt: offline ? oldIso() : nowIso(),
  cars: names.map(([carNumber], index) => {
    const id = `car-${carNumber}`;
    const lap = 101.9 + index * 0.37;
    return {
      id,
      laps: [
        { lap: 45, seconds: lap + 0.4, marker: null },
        { lap: 46, seconds: lap + 0.2, marker: null },
        { lap: 47, seconds: lap + 0.1, marker: null },
        { lap: 48, seconds: lap, marker: null },
      ],
      traces: [],
      sectors: [0, 1, 2].map((sectorIndex) => ({
        id,
        lap: 48,
        sectorIndex,
        sectorCount: 3,
        seconds: Math.round((lap * [0.32, 0.36, 0.32][sectorIndex]) * 1000) / 1000,
        completedSessionTimeSeconds: 3590 + sectorIndex * 30,
        observedSessionTimeSeconds: 3600,
        revision: 1,
        status: "verified",
        referenceSeconds: null,
      })),
      metrics: {
        id,
        observedSessionTimeSeconds: 3600,
        lastLapSeconds: lap,
        bestLapSeconds: lap - 0.4,
        lapValid: true,
        bestLapSectorSeconds: null,
        bestSectorSeconds: null,
        bestLapDeltaToFieldBestSeconds: index === 2 ? 0.649 : index * 0.21,
        bestLapDeltaToPlayerSeconds: index === 2 ? 0 : (index - 2) * 0.21,
        lapHighPrecision: null,
        trackPositionPercentRaw: 0.42,
        sectorMismatchCount: 0,
        sectorCount: 3,
        lastLapSectorSeconds: [
          Math.round((lap * 0.32) * 1000) / 1000,
          Math.round((lap * 0.36) * 1000) / 1000,
          Math.round((lap * 0.32) * 1000) / 1000,
        ],
        sectorLap: 48,
      },
    };
  }),
});

export function fixtureV3(offline = false): V3Normalized {
  const stamp = offline ? oldIso() : nowIso();
  return {
    capturedAt: stamp,
    transportSessionId: "fixture-transport-1",
    identity: {
      trackId: 596,
      trackName: "Road America",
      trackConfig: "Full Course",
      currentDriverName: "Vincent",
      carName: "Porsche 911 GT3 R",
    },
    session: {
      isInCar: !offline,
      sessionTimeSeconds: 3600,
      sessionTimeRemainingSeconds: 4200,
      sessionLapsRemaining: 34,
      flags: ["green"],
      sessionState: "racing",
    },
    timing: {
      currentLapElapsedSeconds: 38.4,
      lastLapTimeSeconds: 102.417,
      bestLapTimeSeconds: 101.802,
      completedLaps: 48,
    },
    position: { position: 3, classPosition: 2, gapToLeaderSeconds: 12.348 },
    track: { lapDistancePct: 0.42, trackSurface: "dry", onPitRoad: false },
    fuel: { fuelLitres: 55.4, fuelCapacityLitres: 100, fuelPerLapLitres: 3.08, lapsRemaining: 17.9 },
    raceState: { incidents: 2 },
    pitService: { pitServiceFlagsRaw: 0, requiredRepairSeconds: 0, optionalRepairSeconds: 0 },
    vehicle: {
      speedKph: 214,
      rpm: 7420,
      gear: "4",
      tyreDataMode: "live",
      temperatureUnit: "C",
      pressureUnit: "psi",
      frontLeft: { wearPercent: 88, temperature: 84, pressure: 26.1 },
      frontRight: { wearPercent: 86, temperature: 85, pressure: 26.0 },
      rearLeft: { wearPercent: 91, temperature: 80, pressure: 25.4 },
      rearRight: { wearPercent: 90, temperature: 81, pressure: 25.3 },
    },
    tyres: {
      compound: "Medium",
      frontLeft: { wearPercent: 88, temperatureC: 84, pressureKpa: 180 },
      frontRight: { wearPercent: 86, temperatureC: 85, pressureKpa: 179 },
      rearLeft: { wearPercent: 91, temperatureC: 80, pressureKpa: 175 },
      rearRight: { wearPercent: 90, temperatureC: 81, pressureKpa: 174 },
    },
    weather: { airTemperatureC: 21.3, trackTemperatureC: 31.5, humidityPercent: 48, raining: 0 },
    environment: { airTempC: 21.3, trackTempC: 31.5, humidity: 48 },
    opponents: opponents(offline),
    paceHistory: paceHistory(offline),
  } as V3Normalized;
}

export function fixtureDetail(offline = false): SimHubDeviceDetail {
  const v3 = fixtureV3(offline);
  const stamp = offline ? oldIso() : nowIso();
  return {
    device: {
      id: "fixture-device-1",
      device_name: "DESKTOP-GR4NN00",
      device_status: "active_binding",
      device_role: "primary",
      revoked_at: null,
      last_seen_at: stamp,
      last_session_id: "fixture-session-20261122",
      last_sequence: 512,
      endurance_event_id: null,
      endurance_team_id: null,
      endurance_binding_source: null,
      paired_at: stamp,
    },
    health: {
      connector_version: "0.7.6.4",
      simhub_version: "9.0",
      game_connected: !offline,
      telemetry_available: !offline,
      raw_data_available: true,
      raw_telemetry_available: true,
      session_time_read_ok: true,
      session_time_seconds: 1,
      session_time_reader: "simhub",
      sequence: 512,
      client_last_telemetry_attempt_utc: stamp,
      client_last_successful_ingest_utc: stamp,
      client_last_ingest_http_status: 200,
      diagnostic_code: "ok",
      updater_state: "current",
      updater_current_version: "0.7.6.4",
      updater_target_version: null,
      last_update_result: "ok",
      last_update_utc: stamp,
      client_reported_at_utc: stamp,
      received_at: stamp,
    },
    telemetry: {
      device_id: "fixture-device-1",
      owner_user_id: "fixture-owner",
      session_id: "fixture-session-20261122",
      sequence: 512,
      captured_at: stamp,
      received_at: stamp,
      connector_id: "fixture-connector",
      simhub_version: "9.0",
      game: "iRacing",
      telemetry: {},
      endurance_event_id: null,
      endurance_team_id: null,
      driver_id: "Vincent",
      current_driver_id: "Vincent",
      current_driver_name: "Vincent",
      car_id: "porsche",
      car_name: "Porsche 911 GT3 R",
      track_name: "Road America",
      track_config: "Full Course",
      race_run_id: null,
      v3_normalized: v3,
    },
    endurance_event: null,
    endurance_team: null,
    diagnostic_events: [],
  } as unknown as SimHubDeviceDetail;
}

export function fixtureStrategy(v3: V3Normalized): PitwallStrategyRow {
  return deviceStrategyRow(v3);
}

export function fixturePace(v3: V3Normalized) {
  return devicePace(v3);
}

export function fixturePosition(v3: V3Normalized) {
  return devicePosition(v3);
}

export function fixtureRaceClock(v3: V3Normalized) {
  return deviceRaceClock(v3);
}

export const fixturePoints = Array.from({ length: 12 }, (_, index) => ({
  lap: 37 + index,
  seconds: 103.2 - index * 0.07,
}));

export const fixtureSessionPace = { fastest: 101.802, median: 102.417, count: 48 };
