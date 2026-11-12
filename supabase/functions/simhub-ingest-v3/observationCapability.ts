/**
 * T13-S1 — leesbaarheid van de observation-ontvanger aan de Edge-kant.
 *
 * De parser mag een `observation`-blok alleen doorlaten als de database de
 * hele package heeft (kolom, rijpoort, hash v2, flag). Die vraag wordt per
 * isolate één keer gesteld en daarna begrensd herhaald. Een mislukte of
 * onbekende probe betekent NIET "stil zonder observation verder": de parser
 * krijgt dan de modus `unavailable` en keurt zo'n rij expliciet af.
 *
 * Geen env- of netwerktoegang in dit bestand; de aanroeper injecteert de RPC,
 * zodat de TTL-logica zonder Deno/Supabase te testen is.
 */
import type { LapObservationCaptureMode } from "../_shared/simhubExtensions.ts";

/** Hoe lang een probe-uitslag geldt voordat opnieuw geprobeerd wordt. */
export const ObservationProbeRetryMs = 60_000;

export type ObservationProbeReason =
  | "unprobed"
  | "probe_ok"
  | "probe_failed"
  | "probe_error";

export type ObservationCapability = {
  available: boolean;
  checkedAt: number;
  reason: ObservationProbeReason;
};

export const initialObservationCapability = (): ObservationCapability => ({
  available: false,
  checkedAt: 0,
  reason: "unprobed",
});

/** Alleen bij een ontbrekende of verlopen uitslag opnieuw vragen. */
export const shouldProbeObservation = (
  state: ObservationCapability,
  now: number,
): boolean =>
  state.reason === "unprobed" ||
  now - state.checkedAt >= ObservationProbeRetryMs;

export const afterObservationProbe = (
  available: boolean,
  now: number,
): ObservationCapability => ({
  available,
  checkedAt: now,
  reason: available ? "probe_ok" : "probe_failed",
});

/**
 * De enige plek die de parsermodus bepaalt. De env-vlag is de baas: staat hij
 * uit, dan verandert er niets aan het bestaande gedrag, ook niet als de
 * database de package wel heeft.
 */
export const observationCaptureMode = (
  envEnabled: boolean,
  capability: ObservationCapability,
): LapObservationCaptureMode => {
  if (!envEnabled) return "off";
  return capability.available ? "on" : "unavailable";
};

type ProbeResult = { data: unknown; error: unknown };

type ProbeRpc = (
  fn: string,
  args: Record<string, unknown>,
) => ProbeResult | Promise<ProbeResult>;

/**
 * Vraagt de database of de observation-package aanwezig én actief is.
 * Elke fout (ontbrekende functie, netwerk, onverwachte vorm) is `false`:
 * fail-closed, nooit een aanname dat opslag wel zal lukken.
 */
export const probeObservationV1 = async (rpc: ProbeRpc): Promise<boolean> => {
  try {
    const { data, error } = await rpc("simhub_observation_v1_available", {});
    if (error) return false;
    const row = Array.isArray(data) ? data[0] : data;
    if (row === true) return true;
    if (row && typeof row === "object") {
      const record = row as Record<string, unknown>;
      if (record.simhub_observation_v1_available === true) return true;
      if (record.available === true) return true;
    }
    return false;
  } catch {
    return false;
  }
};
