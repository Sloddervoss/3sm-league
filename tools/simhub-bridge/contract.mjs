const flags = new Set(["green", "yellow", "red", "white", "checkered", "unknown"]);
const exactKeys = (value, expected, path) => {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) throw new Error(`${path} bevat onbekende of ontbrekende velden`);
};
const object = (value, path) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} moet een object zijn`);
  return value;
};
const string = (value, path, nullable = false) => {
  if (nullable && value === null) return;
  if (typeof value !== "string" || value.length < 1 || value.length > 120) throw new Error(`${path} moet een geldige tekst zijn`);
};
const number = (value, path, { integer = false, nullable = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (nullable && value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${path} bevat een ongeldige waarde`);
};

export const validateTelemetryEnvelope = (input) => {
  const root = object(input, "payload");
  exactKeys(root, ["protocolVersion", "sequence", "capturedAt", "source", "race", "telemetry"], "payload");
  if (root.protocolVersion !== 1 && root.protocolVersion !== 2) throw new Error("protocolVersion wordt niet ondersteund");
  number(root.sequence, "sequence", { integer: true });
  string(root.capturedAt, "capturedAt");
  if (!Number.isFinite(Date.parse(root.capturedAt))) throw new Error("capturedAt is geen geldige ISO-datum");

  const source = object(root.source, "source");
  exactKeys(source, ["connectorId", "simHubVersion", "game"], "source");
  string(source.connectorId, "source.connectorId");
  string(source.simHubVersion, "source.simHubVersion");
  if (source.game !== "IRacing") throw new Error("alleen iRacing wordt in deze spike ondersteund");

  const race = object(root.race, "race");
  const identityKeys = ["currentDriverId", "currentDriverName", "carId", "carName", "trackName", "trackConfig"];
  exactKeys(race, ["eventId", "teamId", "sessionId", "driverId", ...(root.protocolVersion === 2 ? identityKeys : [])], "race");
  if (root.protocolVersion === 2) for (const key of identityKeys) string(race[key], `race.${key}`, true);
  string(race.eventId, "race.eventId");
  string(race.teamId, "race.teamId");
  string(race.sessionId, "race.sessionId");
  string(race.driverId, "race.driverId", true);

  const telemetry = object(root.telemetry, "telemetry");
  exactKeys(telemetry, ["connected", "sessionTimeSeconds", "lap", "completedLaps", "lapTimeSeconds", "position", "classPosition", "speedKph", "fuelLitres", "fuelPerLapLitres", "estimatedLapsRemaining", "inPitLane", "pitLimiter", "stintElapsedSeconds", "incidents", "flag", ...(root.protocolVersion === 2 ? ["isInCar"] : [])], "telemetry");
  if (root.protocolVersion === 2 && typeof telemetry.isInCar !== "boolean") throw new Error("telemetry.isInCar moet true of false zijn");
  for (const key of ["connected", "inPitLane", "pitLimiter"]) if (typeof telemetry[key] !== "boolean") throw new Error(`telemetry.${key} moet true of false zijn`);
  number(telemetry.sessionTimeSeconds, "telemetry.sessionTimeSeconds");
  number(telemetry.lap, "telemetry.lap", { integer: true });
  number(telemetry.completedLaps, "telemetry.completedLaps", { integer: true });
  number(telemetry.lapTimeSeconds, "telemetry.lapTimeSeconds", { nullable: true, min: Number.EPSILON });
  number(telemetry.position, "telemetry.position", { integer: true, nullable: true, min: 1 });
  number(telemetry.classPosition, "telemetry.classPosition", { integer: true, nullable: true, min: 1 });
  number(telemetry.speedKph, "telemetry.speedKph", { max: 500 });
  number(telemetry.fuelLitres, "telemetry.fuelLitres", { max: 250 });
  number(telemetry.fuelPerLapLitres, "telemetry.fuelPerLapLitres", { nullable: true, min: Number.EPSILON, max: 50 });
  number(telemetry.estimatedLapsRemaining, "telemetry.estimatedLapsRemaining", { nullable: true });
  number(telemetry.stintElapsedSeconds, "telemetry.stintElapsedSeconds");
  number(telemetry.incidents, "telemetry.incidents", { integer: true, nullable: true });
  if (!flags.has(telemetry.flag)) throw new Error("telemetry.flag is onbekend");
  return root;
};

export const telemetryStreamKey = (payload) => `${payload.race.eventId}:${payload.race.teamId}:${payload.race.sessionId}:${payload.source.connectorId}`;
