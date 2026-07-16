const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const endpoint = argument("endpoint", "http://127.0.0.1:8787/v1/telemetry");
const token = argument("token", process.env.SIMHUB_BRIDGE_TOKEN ?? "local-3sm-simhub-spike");
const eventId = argument("event", "event-road-america-6h");
const teamId = argument("team", "team-orange-31");
const driverId = argument("driver", "user-jaimy");
const count = Number(argument("count", "60"));
const interval = Number(argument("interval", "1000"));
const sessionId = argument("session", `sim-${Date.now()}`);
const forcePit = argument("force-pit", "false") === "true";

for (let sequence = 0; sequence < count; sequence += 1) {
  const lapProgress = sequence % 20;
  const fuelLitres = Math.max(0, 96 - sequence * 0.14);
  const fuelPerLapLitres = 3.25;
  const payload = {
    protocolVersion: 1,
    sequence,
    capturedAt: new Date().toISOString(),
    source: { connectorId: "3sm-simulator", simHubVersion: "9.11.21-simulated", game: "IRacing" },
    race: { eventId, teamId, sessionId, driverId },
    telemetry: {
      connected: true,
      sessionTimeSeconds: 3600 + sequence,
      lap: 29 + Math.floor(sequence / 20),
      completedLaps: 28 + Math.floor(sequence / 20),
      lapTimeSeconds: lapProgress === 0 ? 128.432 : null,
      position: 7,
      classPosition: 3,
      speedKph: lapProgress > 16 ? 82 : 247 + Math.sin(sequence) * 12,
      fuelLitres,
      fuelPerLapLitres,
      estimatedLapsRemaining: fuelLitres / fuelPerLapLitres,
      inPitLane: forcePit || lapProgress > 17,
      pitLimiter: forcePit || lapProgress > 18,
      stintElapsedSeconds: 2100 + sequence,
      incidents: 4,
      flag: "green",
    },
  };
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Bridge weigerde sample ${sequence}: ${response.status} ${await response.text()}`);
  console.log(`sample=${sequence} lap=${payload.telemetry.lap} fuel=${fuelLitres.toFixed(1)} pit=${payload.telemetry.inPitLane}`);
  if (sequence < count - 1) await sleep(interval);
}
