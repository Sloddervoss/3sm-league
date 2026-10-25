/**
 * Live-variant van ontwerp 11: dezelfde compositie, maar met de echte
 * telemetrie van een apparaat in plaats van de vaste fixture.
 *
 * Wat de server niet levert (klassement, stintplan) blijft uit de fixture;
 * alles wat wél binnenkomt — snelheid, toeren, banden, temperaturen, brandstof,
 * anker en graad — komt live uit de database.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fixture, type PitwallFixture } from "@/lab/fixture";
import Design11 from "@/lab/design11";

type FleetRow = { device_id: string; connector_id?: string; device_name?: string; game_running?: boolean; simhub_version?: string };
type Corner = { wear?: number; temperature?: number; pressure?: number };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export default function PitwallLivePage() {
  const [v3, setV3] = useState<Record<string, unknown> | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const [naam, setNaam] = useState<string>("");
  const [estimate, setEstimate] = useState<{ grade?: string; anchor?: { wear?: Record<string, number>; lap?: number } } | null>(null);

  useEffect(() => {
    let stop = false;
    const laden = async () => {
      const { data: vloot } = await supabase.rpc("get_simhub_fleet" as never);
      const rijen = (vloot ?? []) as FleetRow[];
      const actief = rijen.find((r) => r.game_running) ?? rijen[0];
      if (!actief || stop) return;
      setDevice(actief.device_id);
      setNaam(actief.connector_id ?? actief.device_name ?? "");
      const { data } = await supabase.rpc("get_simhub_device_details" as never, { p_device_id: actief.device_id } as never);
      const detail = data as {
        telemetry?: { v3_normalized?: Record<string, unknown> };
        endurance_event?: { id?: string };
        endurance_team?: { id?: string };
      } | null;
      if (stop || !detail) return;
      setV3((detail.telemetry?.v3_normalized ?? null) as Record<string, unknown> | null);
      const ev = detail.endurance_event?.id;
      const tm = detail.endurance_team?.id;
      if (ev && tm) {
        const { data: schatting } = await supabase.rpc("pitwall_tyre_estimate_v1" as never, { p_event_id: ev, p_team_id: tm } as never);
        if (!stop) setEstimate((schatting ?? null) as typeof estimate);
      }
    };
    void laden();
    const t = setInterval(laden, 2000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const live = useMemo<PitwallFixture>(() => {
    if (!v3) return fixture;
    const sessie = (v3.session ?? {}) as Record<string, unknown>;
    const track = (v3.track ?? {}) as Record<string, unknown>;
    const voertuig = (v3.vehicle ?? {}) as Record<string, unknown>;
    const banden = (v3.tyres ?? {}) as Record<string, unknown>;
    const zones = (banden.wearPercent ?? {}) as Record<string, Record<string, number> | number | null>;
    const omgeving = (banden.environment ?? {}) as Record<string, unknown>;

    const hoek = (naam: "fl" | "fr" | "rl" | "rr"): { wear: number; tempC: number } => {
      const uitZones = zones[naam] as Record<string, number> | undefined;
      const uitAuto = voertuig[`${naam === "fl" ? "frontLeft" : naam === "fr" ? "frontRight" : naam === "rl" ? "rearLeft" : "rearRight"}`] as Corner | undefined;
      return {
        wear: num(uitZones?.m) ?? num(uitAuto?.wear) ?? num((uitAuto as unknown as { wearPercent?: number })?.wearPercent) ?? 0,
        tempC: num(uitAuto?.temperature) ?? 0,
      };
    };

    const seconden = num(sessie.sessionTimeSeconds) ?? 0;
    const rest = num(sessie.sessionTimeRemainingSeconds);

    return {
      ...fixture,
      event: {
        ...fixture.event,
        circuit: String(track.trackName ?? fixture.event.circuit),
        timeLeft: rest != null ? `${Math.floor(rest / 3600)}:${String(Math.floor((rest % 3600) / 60)).padStart(2, "0")}` : fixture.event.timeLeft,
      },
      telemetry: {
        ...fixture.telemetry,
        speedKph: num(voertuig.speedKph) ?? 0,
        gear: Number(String(voertuig.gear ?? "1").replace("N", "0")) || 0,
        rpm: num(voertuig.rpm) ?? 0,
      },
      fuel: {
        ...fixture.fuel,
        litres: num((voertuig as { fuelLitres?: number }).fuelLitres) ?? fixture.fuel.litres,
      },
      tyres: {
        ...fixture.tyres,
        fl: hoek("fl"), fr: hoek("fr"), rl: hoek("rl"), rr: hoek("rr"),
        grade: (estimate?.grade as PitwallFixture["tyres"]["grade"]) ?? fixture.tyres.grade,
      },
      weather: {
        airC: num(omgeving.airTempC) ?? fixture.weather.airC,
        trackC: num(omgeving.trackTempC) ?? fixture.weather.trackC,
        rubber: String(omgeving.rubberState ?? fixture.weather.rubber),
      },
    };
  }, [v3, estimate]);

  return (
    <div className="min-h-screen bg-black">
      <Design11 f={live} />
      <footer className="border-t border-white/10 bg-black px-4 py-2 font-mono text-[10px] text-white/40">
        live · {naam || "geen apparaat"} · sessietijd {Math.round(num(((v3?.session ?? {}) as Record<string, unknown>).sessionTimeSeconds) ?? 0)}s
        {estimate?.grade ? ` · graad ${estimate.grade}` : " · nog geen anker"}
      </footer>
    </div>
  );
}
