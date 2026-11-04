import { supabase } from "@/integrations/supabase/client";

export type TyreStopAnswer = "tyres" | "fuel" | "both" | "none";

export interface TyreStop {
  visitKey: string;
  /** Frame waarop het antwoord wordt vastgelegd; valt altijd binnen het bezoek. */
  anchorSeq: number;
  lap: number | null;
  sessionTimeSeconds: number | null;
  setsUsed: number | null;
  setFl: number | null;
  setFr: number | null;
  setRl: number | null;
  setRr: number | null;
  /** Getankte liters, gemeten uit het niveau vóór en na de stop. */
  fuelBeforeLitres: number | null;
  fuelAfterLitres: number | null;
  answer: TyreStopAnswer | null;
}

export interface TyreStopFeed {
  sessionKey: string | null;
  stops: TyreStop[];
}

export type TyreStopSource = { deviceId?: string | null; eventId?: string | null; teamId?: string | null };

const call = async <T,>(name: string, args: Record<string, unknown>): Promise<T | null> => {
  const { data, error } = await (supabase.rpc as unknown as (n: string, p: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(name, args);
  if (error) throw error;
  return (data ?? null) as T | null;
};

/** De laatste pitbezoeken zoals de ingest ze heeft waargenomen. Geen oordeel, geen setgrens. */
export async function readTyreStops(source: TyreStopSource): Promise<TyreStopFeed | null> {
  const feed = await call<TyreStopFeed>("get_pitwall_tyre_stops", {
    p_device_id: source.deviceId ?? null,
    p_event_id: source.eventId ?? null,
    p_team_id: source.teamId ?? null,
    p_limit: 5,
  });
  if (!feed || !Array.isArray(feed.stops)) return null;
  return feed;
}

/** Eén antwoord per pitbezoek: banden gewisseld, alleen getankt, of beide. */
export async function answerTyreStop(
  source: TyreStopSource,
  stop: TyreStop,
  answer: TyreStopAnswer,
  sessionKey: string,
): Promise<boolean> {
  const result = await call<{ ok?: boolean }>("pitwall_tyre_stop_answer", {
    p_device_id: source.deviceId ?? null,
    p_event_id: source.eventId ?? null,
    p_team_id: source.teamId ?? null,
    p_session_key: sessionKey,
    p_anchor_seq: stop.anchorSeq,
    p_answer: answer,
  });
  return result?.ok === true;
}
